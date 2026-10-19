// 联机传输层：浏览器里用 WebSocket 连接 serve.mjs；无头测试里用内存中转（MemHub）。
// 目标编号：-1 = 除自己外的所有人，-2 = 房主，>= 0 = 指定玩家。

export const TO_ALL = -1;
export const TO_HOST = -2;

export interface Transport {
  readonly myId: number;
  sendEvents(to: number, d: unknown[]): void;
  /** payload 的第 0 个字节会被替换为目标 / 发送者编号 */
  sendBin(to: number, payload: Uint8Array): void;
  onEvents: (from: number, d: any[]) => void;
  onBin: (from: number, view: DataView) => void;
  onLeft: (id: number, name: string) => void;
  onClosed: (msg: string) => void;
}

export interface LobbyPlayer { id: number; name: string; host: boolean }
export interface LobbyState { code: string; started: boolean; hostId: number; players: LobbyPlayer[]; cfg: { diff: string; seed: string } }
export interface StartInfo { seed: number; diff: string; hostId: number; players: { id: number; name: string }[] }

/** 浏览器端：连接本地服务器的房间 */
export class NetClient implements Transport {
  private ws: WebSocket | null = null;
  myId = -1;
  code = '';
  isHost = false;
  onEvents: (from: number, d: any[]) => void = () => {};
  onBin: (from: number, view: DataView) => void = () => {};
  onLeft: (id: number, name: string) => void = () => {};
  onClosed: (msg: string) => void = () => {};
  onLobby: (s: LobbyState) => void = () => {};
  onJoined: (code: string, id: number, host: boolean) => void = () => {};
  onError: (msg: string) => void = () => {};
  onStart: (info: StartInfo) => void = () => {};
  onDisconnect: () => void = () => {};
  onReset: () => void = () => {};
  /** 网络往返延迟（毫秒） */
  rtt = 0;
  private pingT = 0;

  static available(): boolean {
    return typeof WebSocket !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:');
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let ws: WebSocket;
      try { ws = new WebSocket(url); } catch (e) { reject(e); return; }
      ws.binaryType = 'arraybuffer';
      const timer = setTimeout(() => { reject(new Error('timeout')); try { ws.close(); } catch { /* */ } }, 5000);
      ws.onopen = () => { clearTimeout(timer); this.ws = ws; resolve(); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('无法连接服务器')); };
      ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.onDisconnect(); } };
      ws.onmessage = (ev) => this.onMessage(ev);
    });
  }

  get connected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  private onMessage(ev: MessageEvent): void {
    if (ev.data instanceof ArrayBuffer) {
      const v = new DataView(ev.data);
      if (v.byteLength >= 1) this.onBin(v.getUint8(0), v);
      return;
    }
    let m: any;
    try { m = JSON.parse(ev.data as string); } catch { return; }
    switch (m.t) {
      case 'm': this.onEvents(m.f, m.d); break;
      case 'lobby': this.onLobby(m); break;
      case 'joined': this.myId = m.id; this.code = m.code; this.isHost = m.host; this.onJoined(m.code, m.id, m.host); break;
      case 'error': this.onError(m.msg); break;
      case 'start': this.onStart(m); break;
      case 'left': this.onLeft(m.id, m.name); break;
      case 'closed': this.onClosed(m.msg); break;
      case 'pong': this.rtt = performance.now() - m.ts; break;
      case 'reset': this.onReset(); break;
    }
  }

  private raw(o: unknown): void {
    if (this.connected) this.ws!.send(JSON.stringify(o));
  }

  create(name: string): void { this.raw({ t: 'create', name }); }
  join(code: string, name: string): void { this.raw({ t: 'join', code, name }); }
  setName(name: string): void { this.raw({ t: 'name', name }); }
  setCfg(diff: string, seed: string): void { this.raw({ t: 'cfg', diff, seed }); }
  start(seed: number, diff: string): void { this.raw({ t: 'start', seed, diff }); }
  leave(): void { this.raw({ t: 'leave' }); this.code = ''; this.myId = -1; this.isHost = false; }
  reset(): void { this.raw({ t: 'reset' }); }

  sendEvents(to: number, d: unknown[]): void {
    if (d.length) this.raw({ t: 'r', to, d });
  }

  sendBin(to: number, payload: Uint8Array): void {
    if (!this.connected) return;
    payload[0] = to === TO_ALL ? 255 : to === TO_HOST ? 254 : to;
    this.ws!.send(payload);
  }

  /** 每秒测一次延迟 */
  tick(dt: number): void {
    this.pingT -= dt;
    if (this.pingT <= 0) { this.pingT = 1; this.raw({ t: 'ping', ts: performance.now() }); }
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    try { ws?.close(); } catch { /* */ }
  }
}

/** 无头测试：内存中的消息中转（可以模拟延迟） */
export class MemHub {
  ends: MemEnd[] = [];
  hostId = 0;
  latency = 0; // 秒
  private q: { t: number; fn: () => void }[] = [];
  time = 0;

  add(id: number): MemEnd {
    const e = new MemEnd(this, id);
    this.ends.push(e);
    return e;
  }

  post(fn: () => void): void {
    if (this.latency <= 0) fn();
    else this.q.push({ t: this.time + this.latency, fn });
  }

  update(dt: number): void {
    this.time += dt;
    while (this.q.length && this.q[0].t <= this.time) this.q.shift()!.fn();
  }

  targets(from: number, to: number): MemEnd[] {
    return this.ends.filter((e) => e.myId !== from && (to === TO_ALL || (to === TO_HOST && e.myId === this.hostId) || to === e.myId));
  }
}

export class MemEnd implements Transport {
  onEvents: (from: number, d: any[]) => void = () => {};
  onBin: (from: number, view: DataView) => void = () => {};
  onLeft: (id: number, name: string) => void = () => {};
  onClosed: (msg: string) => void = () => {};
  bytes = 0;
  constructor(private hub: MemHub, readonly myId: number) {}

  sendEvents(to: number, d: unknown[]): void {
    if (!d.length) return;
    const s = JSON.stringify(d);
    this.bytes += s.length;
    const from = this.myId;
    for (const e of this.hub.targets(from, to)) this.hub.post(() => e.onEvents(from, JSON.parse(s)));
  }

  sendBin(to: number, payload: Uint8Array): void {
    this.bytes += payload.length;
    const from = this.myId;
    for (const e of this.hub.targets(from, to)) {
      const copy = new Uint8Array(payload);
      copy[0] = from;
      this.hub.post(() => e.onBin(from, new DataView(copy.buffer)));
    }
  }
}
