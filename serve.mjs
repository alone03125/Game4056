// 本地服务器：node serve.mjs [port]，默认 4056。
// 1) 服务 dist/ 目录下的游戏页面（局域网内的其他电脑可以通过 http://<本机局域网IP>:4056 打开）；
// 2) 第2版联机：/ws 上的 WebSocket 房间服务。房主创建房间（4 位英文字母房间号），其他玩家输入房间号加入，
//    游戏中的所有消息由这里转发（不做任何游戏逻辑）。不依赖第三方库，WebSocket 协议按 RFC 6455 手写。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] || process.env.PORT || 4056);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const MAX_PLAYERS = 4;

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) out.push(a.address);
  }
  return out;
}

// —— HTTP ——
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ port, lan: lanAddresses().map((a) => `http://${a}:${port}`), rooms: rooms.size }));
    return;
  }
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

// —— WebSocket（最小实现）——
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = null; // 分片消息
    this.fragOp = 0;
    this.open = true;
    this.room = null;
    this.id = -1;
    this.name = '';
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.onClose());
    socket.on('error', () => this.onClose());
  }

  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > 8 * 1024 * 1024) { this.close(); return; }
      const mOff = off;
      if (masked) off += 4;
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      if (masked) {
        const m = b.subarray(mOff, mOff + 4);
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ m[i & 3];
        payload = out;
      } else payload = Buffer.from(payload);
      this.buf = b.subarray(off + len);
      if (op === 0x8) { this.close(); return; }
      if (op === 0x9) { this.sendFrame(0xa, payload); continue; }
      if (op === 0xa) continue;
      if (op === 0x0) {
        if (!this.frag) continue;
        this.frag.push(payload);
        if (fin) { const all = Buffer.concat(this.frag); const fop = this.fragOp; this.frag = null; this.onMessage(fop, all); }
        continue;
      }
      if (!fin) { this.frag = [payload]; this.fragOp = op; continue; }
      this.onMessage(op, payload);
    }
  }

  sendFrame(op, data) {
    if (!this.open) return;
    const len = data.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    try { this.socket.write(Buffer.concat([head, data])); } catch { this.onClose(); }
  }

  sendJson(o) { this.sendFrame(0x1, Buffer.from(JSON.stringify(o))); }
  sendBin(b) { this.sendFrame(0x2, b); }

  close() {
    if (!this.open) return;
    try { this.sendFrame(0x8, Buffer.alloc(0)); this.socket.end(); } catch { /* */ }
    this.onClose();
  }

  onClose() {
    if (!this.open) return;
    this.open = false;
    leaveRoom(this);
  }

  onMessage(op, data) {
    if (op === 0x2) { relayBin(this, data); return; }
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
    handle(this, msg);
  }
}

server.on('upgrade', (req, socket) => {
  if ((req.url || '').split('?')[0] !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  new Conn(socket);
});

// —— 房间 ——
/** @type {Map<string, {code: string, conns: Conn[], hostId: number, started: boolean, cfg: object}>} */
const rooms = new Map();
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function newCode() {
  for (let i = 0; i < 1000; i++) {
    let c = '';
    for (let k = 0; k < 4; k++) c += LETTERS[crypto.randomInt(26)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
}

function lobbyState(room) {
  return {
    t: 'lobby', code: room.code, started: room.started, cfg: room.cfg, hostId: room.hostId,
    players: room.conns.map((c) => ({ id: c.id, name: c.name, host: c.id === room.hostId })),
  };
}

function broadcastLobby(room) {
  const s = lobbyState(room);
  for (const c of room.conns) c.sendJson(s);
}

function freeId(room) {
  for (let i = 0; i < MAX_PLAYERS; i++) if (!room.conns.some((c) => c.id === i)) return i;
  return -1;
}

function handle(conn, m) {
  switch (m.t) {
    case 'create': {
      if (conn.room) leaveRoom(conn);
      const code = newCode();
      if (!code) { conn.sendJson({ t: 'error', msg: '无法创建房间' }); return; }
      const room = { code, conns: [conn], hostId: 0, started: false, cfg: { diff: 'normal', seed: '' } };
      rooms.set(code, room);
      conn.room = room; conn.id = 0; conn.name = cleanName(m.name);
      conn.sendJson({ t: 'joined', code, id: 0, host: true });
      broadcastLobby(room);
      console.log(`[room ${code}] created`);
      return;
    }
    case 'join': {
      const code = String(m.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { conn.sendJson({ t: 'error', msg: `房间 ${code || '----'} 不存在` }); return; }
      if (room.started) { conn.sendJson({ t: 'error', msg: '该房间的游戏已经开始' }); return; }
      const id = freeId(room);
      if (id < 0) { conn.sendJson({ t: 'error', msg: `房间已满（最多 ${MAX_PLAYERS} 人）` }); return; }
      if (conn.room) leaveRoom(conn);
      conn.room = room; conn.id = id; conn.name = cleanName(m.name);
      room.conns.push(conn);
      room.conns.sort((a, b) => a.id - b.id);
      conn.sendJson({ t: 'joined', code, id, host: false });
      broadcastLobby(room);
      console.log(`[room ${code}] player ${id} joined`);
      return;
    }
    case 'name': {
      if (!conn.room) return;
      conn.name = cleanName(m.name);
      broadcastLobby(conn.room);
      return;
    }
    case 'cfg': {
      const room = conn.room;
      if (!room || conn.id !== room.hostId || room.started) return;
      room.cfg = { diff: String(m.diff || 'normal'), seed: String(m.seed || '').slice(0, 24) };
      broadcastLobby(room);
      return;
    }
    case 'start': {
      const room = conn.room;
      if (!room || conn.id !== room.hostId || room.started) return;
      if (room.conns.some((c) => !c.name)) { conn.sendJson({ t: 'error', msg: '还有玩家没有起名字' }); return; }
      room.started = true;
      const msg = { t: 'start', seed: Number(m.seed) >>> 0, diff: String(m.diff || 'normal'), hostId: room.hostId, players: room.conns.map((c) => ({ id: c.id, name: c.name })) };
      for (const c of room.conns) c.sendJson(msg);
      console.log(`[room ${room.code}] started with ${room.conns.length} player(s)`);
      return;
    }
    case 'reset': {
      // 一局结束后，房主带大家回到房间大厅
      const room = conn.room;
      if (!room || conn.id !== room.hostId || !room.started) return;
      room.started = false;
      for (const c of room.conns) c.sendJson({ t: 'reset' });
      broadcastLobby(room);
      return;
    }
    case 'leave': leaveRoom(conn); return;
    case 'r': relay(conn, m); return;
    case 'ping': conn.sendJson({ t: 'pong', ts: m.ts }); return;
  }
}

/** 转发 JSON：to = -1 其他所有人，-2 房主，>= 0 指定玩家 */
function relay(conn, m) {
  const room = conn.room;
  if (!room) return;
  const out = JSON.stringify({ t: 'm', f: conn.id, d: m.d });
  const buf = Buffer.from(out);
  for (const c of room.conns) {
    if (c === conn) continue;
    if (m.to === -1 || (m.to === -2 && c.id === room.hostId) || m.to === c.id) c.sendFrame(0x1, buf);
  }
}

/** 转发二进制：首字节为目标（255 所有人，254 房主），转发时替换为发送者编号 */
function relayBin(conn, data) {
  const room = conn.room;
  if (!room || data.length < 1) return;
  const to = data[0];
  const out = Buffer.from(data);
  out[0] = conn.id;
  for (const c of room.conns) {
    if (c === conn) continue;
    if (to === 255 || (to === 254 && c.id === room.hostId) || to === c.id) c.sendBin(out);
  }
}

function leaveRoom(conn) {
  const room = conn.room;
  if (!room) return;
  conn.room = null;
  room.conns = room.conns.filter((c) => c !== conn);
  if (conn.id === room.hostId || room.conns.length === 0) {
    // 房主离开：房间解散
    for (const c of room.conns) { c.sendJson({ t: 'closed', msg: '房主已离开，房间已解散' }); c.room = null; }
    rooms.delete(room.code);
    console.log(`[room ${room.code}] closed`);
    return;
  }
  if (room.started) for (const c of room.conns) c.sendJson({ t: 'left', id: conn.id, name: conn.name });
  broadcastLobby(room);
}

server.listen(port, '0.0.0.0', () => {
  console.log(`末日4056 服务器已启动：http://localhost:${port}`);
  const lan = lanAddresses();
  if (lan.length) {
    console.log('局域网联机：同一网络下的其他玩家在浏览器打开');
    for (const a of lan) console.log(`  http://${a}:${port}`);
  }
});
