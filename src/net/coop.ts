// 联机控制器（第2版）：实现 NetHooks，负责消息的打包、发送、接收与分发。
//
// 发送频率：玩家状态 20 次/秒；房主的丧尸快照（二进制）20 次/秒；流程信息与 Boss 状态 10 次/秒；
// 其余事件（射击、伤害、击杀、拾取……）在每帧末尾合并成一条消息发送。

import { BULLETS, BULLET_IDS } from '../data/bullets';
import { GunLook } from '../data/guns';
import { WorldThing } from '../data/items';
import { nextUid } from '../data/bullets';
import { Enemy, EnemyShot, TYPE_CODE } from '../game/enemies';
import { NetHooks, RemotePlayer, RemoteProfile } from '../game/net';
import { QUICK_ORDER } from '../data/items';
import type { Gun } from '../data/guns';
import { WorldItem } from '../game/pickups';
import { Proj, Projectiles } from '../game/projectiles';
import type { PhaseMsg, World } from '../game/world';
import { encodeTele } from '../game/boss';
import { damp, wrapAngle } from '../util/math';
import { TO_ALL, TO_HOST, Transport } from './transport';

export interface CoopPlayerInfo { id: number; name: string }

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const SNAP_BYTES = 28;

export class Coop implements NetHooks {
  readonly isHost: boolean;
  readonly myId: number;
  readonly hostId: number;
  readonly names = new Map<number, string>();
  w!: World;
  private rem = new Map<number, RemotePlayer>();
  private qAll: any[] = [];
  private qHost: any[] = [];
  private qTo = new Map<number, any[]>();
  private psT = 0;
  private snapT = 0;
  private bsT = 0;
  private clock = 0;
  private lastLook: [number, number] = [-2, -2];
  private profT = 0;
  private profSig = '';
  private uidN = 0;
  localPaused = false;
  /** 统计：发送的字节数（调试用） */
  sent = 0;
  onLeave: (name: string) => void = () => {};

  constructor(private tr: Transport, hostId: number, players: CoopPlayerInfo[]) {
    this.myId = tr.myId;
    this.hostId = hostId;
    this.isHost = tr.myId === hostId;
    for (const p of players) {
      this.names.set(p.id, p.name);
      if (p.id !== this.myId) this.rem.set(p.id, makeRemote(p.id, p.name));
    }
    tr.onEvents = (from, d) => this.onEvents(from, d);
    tr.onBin = (from, v) => this.onBin(from, v);
    tr.onLeft = (id, name) => this.onLeft(id, name);
  }

  attach(w: World): void {
    this.w = w;
    for (const r of this.rem.values()) {
      r.x = r.tx = w.player.x; r.y = r.ty = w.player.y;
    }
  }

  name(id: number): string {
    return this.names.get(id) ?? `玩家${id + 1}`;
  }

  // —— NetHooks ——

  aliveCount(): number {
    let n = this.w.player.alive ? 1 : 0;
    for (const r of this.rem.values()) if (!r.dead) n++;
    return Math.max(1, n);
  }

  remotes(): Iterable<RemotePlayer> {
    return this.rem.values();
  }

  remoteList(): RemotePlayer[] {
    return [...this.rem.values()];
  }

  hitRemote(id: number, dmg: number, sx: number, sy: number, kx: number, ky: number): void {
    this.to(id, { k: 'hit', d: r1(dmg), sx: r2(sx), sy: r2(sy), kx: r2(kx), ky: r2(ky) });
  }

  enemyKilled(e: Enemy, gold: number, by: number): void {
    this.batch(this.qAll, 'kill', [e.id, r2(e.x), r2(e.y), gold, by, TYPE_CODE.indexOf(e.type), e.elite, r2(e.face)]);
  }

  enemyShot(s: EnemyShot): void {
    this.qAll.push({ k: 'shot', s: s.kind === 'spit' ? [0, r2(s.x), r2(s.y), r2(s.vx), r2(s.vy), r1(s.dmg), s.r, r2(s.life)]
      : [1, r2(s.sx!), r2(s.sy!), r2(s.tx!), r2(s.ty!), r1(s.dmg), r2(s.dur!), r2(s.aoe!)] });
  }

  enemyDamage(e: Enemy, amount: number, flags: number, burnDps: number): void {
    this.batch(this.qHost, 'dmg', [e.id, r1(amount), flags, r1(burnDps)]);
  }

  enemyKnock(e: Enemy, kx: number, ky: number): void {
    this.batch(this.qHost, 'kb', [e.id, r2(kx), r2(ky)]);
  }

  enemyStun(e: Enemy, t: number): void {
    this.batch(this.qHost, 'stn', [e.id, r1(t)]);
  }

  projSpawned(p: Proj): void {
    this.batch(this.qAll, 'pj', Projectiles.encode(p));
  }

  vortex(x: number, y: number, r: number, dur: number): void {
    this.qHost.push({ k: 'vx', x: r2(x), y: r2(y), r: r2(r), dur });
  }

  claimItem(it: WorldItem): void {
    this.qHost.push({ k: 'claim', uid: it.uid });
  }

  itemTaken(uid: number, by: number): void {
    this.qAll.push({ k: 'take', uid, by });
  }

  itemDropped(it: WorldItem, thing: WorldThing): void {
    this.qAll.push({ k: 'drop', uid: it.uid, x: r2(it.x), y: r2(it.y), auto: it.auto ? 1 : 0, th: thing });
  }

  revive(id: number): void {
    this.to(id, { k: 'rev' });
  }

  phase(m: PhaseMsg): void {
    this.qAll.push({ k: 'ph', p: m });
  }

  fx(kind: string, args: (string | number)[]): void {
    this.qAll.push({ k: 'fx', n: kind, a: args });
  }

  newItemUid(): number {
    return (this.myId + 1) * 1_000_000 + ++this.uidN;
  }

  // —— 暂停：任何一名玩家暂停，所有人都会暂停 ——

  setLocalPaused(on: boolean): void {
    if (this.localPaused === on) return;
    this.localPaused = on;
    this.qAll.push({ k: 'pz', on: on ? 1 : 0 });
    this.flush();
  }

  /** 正在暂停游戏的其他玩家 */
  pausers(): string[] {
    const out: string[] = [];
    for (const r of this.rem.values()) if (r.paused) out.push(r.name);
    return out;
  }

  anyPaused(): boolean {
    if (this.localPaused) return true;
    for (const r of this.rem.values()) if (r.paused) return true;
    return false;
  }

  // —— 每帧 ——

  /** 每帧调用（暂停时也要调用，以便收发消息） */
  tick(dt: number): void {
    const w = this.w;
    this.clock += dt;
    for (const r of this.rem.values()) this.smooth(r, dt);
    // 枪械外观变化
    for (let h = 0; h < 2; h++) {
      const g = w.run.guns[h];
      const uid = g ? g.uid : -1;
      if (uid !== this.lastLook[h]) {
        this.lastLook[h] = uid;
        this.qAll.push({ k: 'gl', h, look: g ? g.look : null, ra: g ? g.rarity : 0 });
      }
    }
    this.psT -= dt;
    if (this.psT <= 0) { this.psT = 0.05; this.qAll.push(this.myState()); }
    // 装备概况：有变化时最多每 0.25 秒发送一次，否则每 3 秒发送一次（给观战的队友看）
    this.profT -= dt;
    if (this.profT <= 0) {
      const sig = this.profileSig();
      if (sig !== this.profSig || this.profT < -2.75) {
        this.profSig = sig;
        this.profT = 0.25;
        this.qAll.push(this.myProfile());
      }
    }
    if (this.isHost) {
      if (w.worldStateDue(dt)) this.qAll.push({ k: 'ws', cd: r2(w.countdown), ct: r2(w.closeT), info: w.waitInfo, zt: r1(w.zoneTime) });
      this.bsT -= dt;
      if (this.bsT <= 0 && w.boss && !w.boss.mirror) {
        this.bsT = 0.1;
        const b = w.boss;
        this.qAll.push({
          k: 'bs', s: b.stateIndex(), an: b.anim, en: b.enraged ? 1 : 0, tp: r2(b.throwPose),
          tl: b.telegraphs.map(encodeTele),
        });
      }
    }
    this.flush();
    if (this.isHost) {
      this.snapT -= dt;
      if (this.snapT <= 0) { this.snapT = 0.05; this.sendSnapshot(); }
    }
  }

  private myState(): any {
    const w = this.w;
    const p = w.player;
    const run = w.run;
    return {
      k: 'ps', x: r2(p.x), y: r2(p.y), vx: r2(p.vx + p.kx + p.dashX), vy: r2(p.vy + p.ky + p.dashY), f: r2(p.face),
      hp: r1(run.hp), mhp: Math.round(run.maxHp), dn: p.downed ? 1 : 0, dd: p.alive ? 0 : 1, ar: w.arrived ? 1 : 0,
      su: run.suit, mv: r2(p.moving), ft: [r2(Math.min(9, p.hands[0].firingT)), r2(Math.min(9, p.hands[1].firingT))],
      rl: [p.hands[0].reloading ? 1 : 0, p.hands[1].reloading ? 1 : 0], pz: this.localPaused ? 1 : 0, iv: run.invulnT > 0 ? 1 : 0,
      rad: r1(run.rad), kl: run.stats.kills, rv: w.reviveTarget, rk: r2(w.reviveT),
      sp: r1(p.speed()), bt: [r1(run.invulnT), r1(run.overheatT), r1(run.eelT)],
      hd: p.hands.map((h) => [h.auto ? 1 : 0, h.cursor, h.reloading ? 1 : 0, r2(h.reloading ? 1 - Math.max(0, h.cooldown) / Math.max(0.01, h.reloadTotal) : 1)]),
    };
  }

  private profileSig(): string {
    const run = this.w.run;
    const g = run.guns.map((x) => (x ? `${x.uid}:${x.bullets.map((b) => b?.uid ?? 0).join('.')}:${x.atk}:${x.reload}:${x.cap}` : '-')).join('|');
    return `${g}#${QUICK_ORDER.map((id) => run.countItem(id)).join(',')}#${run.recoilResist}#${run.gold}#${run.bank}#${run.bagUsed()}#${run.bagCap}`;
  }

  private myProfile(): any {
    const run = this.w.run;
    return {
      k: 'pf', g: run.guns, q: QUICK_ORDER.map((id) => run.countItem(id)), rr: run.recoilResist, gd: run.gold, bk: run.bank, bu: run.bagUsed(), bc: run.bagCap,
    };
  }

  private smooth(r: RemotePlayer, dt: number): void {
    const age = Math.min(0.2, Math.max(0, this.clock - r.stamp));
    const px = r.tx + r.vx * age, py = r.ty + r.vy * age;
    const dx = px - r.x, dy = py - r.y;
    if (dx * dx + dy * dy > 16) { r.x = px; r.y = py; }
    else { const k = damp(16, dt); r.x += dx * k; r.y += dy * k; }
    r.face += wrapAngle(r.tf - r.face) * damp(16, dt);
    r.walkPhase += dt * Math.hypot(r.vx, r.vy) * 2.4;
    for (let h = 0; h < 2; h++) r.firingT[h] += dt;
    if (r.hurtT > 0) r.hurtT -= dt;
  }

  private batch(q: any[], k: string, a: number[]): void {
    const last = q[q.length - 1];
    if (last && last.k === k) last.a.push(a);
    else q.push({ k, a: [a] });
  }

  private to(id: number, ev: any): void {
    let q = this.qTo.get(id);
    if (!q) { q = []; this.qTo.set(id, q); }
    q.push(ev);
  }

  flush(): void {
    if (this.qAll.length) { this.tr.sendEvents(TO_ALL, this.qAll); this.qAll = []; }
    if (this.qHost.length) {
      if (this.isHost) { const q = this.qHost; this.qHost = []; this.onEvents(this.myId, q); }
      else { this.tr.sendEvents(TO_HOST, this.qHost); this.qHost = []; }
    }
    for (const [id, q] of this.qTo) if (q.length) this.tr.sendEvents(id, q);
    this.qTo.clear();
  }

  // —— 快照（房主 → 所有人） ——

  private sendSnapshot(): void {
    const list = this.w.enemies.list;
    let n = 0;
    for (const e of list) if (!e.dead) n++;
    const buf = new Uint8Array(4 + n * SNAP_BYTES);
    const v = new DataView(buf.buffer);
    v.setUint8(1, 1);
    v.setUint16(2, n, true);
    let o = 4;
    for (const e of list) {
      if (e.dead) continue;
      v.setUint32(o, e.id, true);
      v.setUint8(o + 4, TYPE_CODE.indexOf(e.type));
      v.setUint8(o + 5, (e.elite & 3) | (e.burnT > 0 ? 4 : 0) | (e.slowT > 0 ? 8 : 0) | (e.fuse >= 0 ? 16 : 0) | (e.stunT > 0 ? 32 : 0));
      v.setFloat32(o + 6, e.x, true);
      v.setFloat32(o + 10, e.y, true);
      v.setInt16(o + 14, Math.max(-32000, Math.min(32000, Math.round(e.vx * 100))), true);
      v.setInt16(o + 16, Math.max(-32000, Math.min(32000, Math.round(e.vy * 100))), true);
      const f = ((e.face % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      v.setUint16(o + 18, Math.round((f / (Math.PI * 2)) * 65535), true);
      v.setFloat32(o + 20, Math.max(0, e.hp), true);
      v.setFloat32(o + 24, e.maxHp, true);
      o += SNAP_BYTES;
    }
    this.sent += buf.length;
    this.tr.sendBin(TO_ALL, buf);
  }

  private onBin(from: number, v: DataView): void {
    if (from !== this.hostId || this.isHost || !this.w || v.byteLength < 4) return;
    if (v.getUint8(1) !== 1) return;
    const n = v.getUint16(2, true);
    if (v.byteLength < 4 + n * SNAP_BYTES) return;
    const en = this.w.enemies;
    en.mirrorBegin();
    let o = 4;
    for (let i = 0; i < n; i++) {
      en.mirrorEntry(
        v.getUint32(o, true), v.getUint8(o + 4), v.getUint8(o + 5),
        v.getFloat32(o + 6, true), v.getFloat32(o + 10, true),
        v.getInt16(o + 14, true) / 100, v.getInt16(o + 16, true) / 100,
        (v.getUint16(o + 18, true) / 65535) * Math.PI * 2,
        v.getFloat32(o + 20, true), v.getFloat32(o + 24, true),
      );
      o += SNAP_BYTES;
    }
    en.mirrorEnd();
  }

  // —— 接收事件 ——

  private inBounds(x: number, y: number): boolean {
    const b = this.w.layout.bounds;
    return x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2;
  }

  private onEvents(from: number, list: any[]): void {
    const w = this.w;
    if (!w || !Array.isArray(list)) return;
    for (const ev of list) {
      try { this.handle(from, ev); } catch (err) { console.error('net event', ev?.k, err); }
    }
  }

  private handle(from: number, ev: any): void {
    const w = this.w;
    const r = this.rem.get(from);
    switch (ev.k) {
      case 'ps': if (r) this.applyState(r, ev); break;
      case 'gl': if (r) { r.looks[ev.h] = ev.look as GunLook | null; r.lookRarity[ev.h] = ev.ra; } break;
      case 'pf':
        if (r) {
          const prof: RemoteProfile = {
            guns: [(ev.g?.[0] ?? null) as Gun | null, (ev.g?.[1] ?? null) as Gun | null], counts: ev.q ?? [], recoilResist: ev.rr ?? 0,
            gold: ev.gd ?? 0, bank: ev.bk ?? 0, bagUsed: ev.bu ?? 0, bagCap: ev.bc ?? 16,
          };
          r.prof = prof;
        }
        break;
      case 'pz': if (r) r.paused = !!ev.on; break;
      case 'pj': {
        let fxDone = false;
        for (const a of ev.a as number[][]) {
          if (!this.inBounds(a[1], a[2])) continue;
          w.projs.spawnGhost(a, from);
          if (!fxDone) {
            fxDone = true;
            const def = BULLETS[BULLET_IDS[a[0]]];
            if (def) w.fx.remoteShot(a[1], a[2], Math.atan2(a[4], a[3]), def);
            if (r) r.firingT[0] = 0;
          }
        }
        break;
      }
      case 'dmg': if (this.isHost) for (const a of ev.a as number[][]) w.enemies.applyRemote(a[0], a[1], a[2], a[3], from); break;
      case 'kb': if (this.isHost) for (const a of ev.a as number[][]) w.enemies.applyRemoteKnock(a[0], a[1], a[2]); break;
      case 'stn': if (this.isHost) for (const a of ev.a as number[][]) w.enemies.applyRemoteStun(a[0], a[1]); break;
      case 'vx': if (this.isHost) w.projs.addPullVortex(ev.x, ev.y, ev.r, ev.dur); break;
      case 'hit':
        if (w.damagePlayer(ev.d, ev.sx, ev.sy)) { w.player.kx += ev.kx; w.player.ky += ev.ky; }
        break;
      case 'kill':
        if (this.isHost) break;
        for (const a of ev.a as number[][]) {
          if (!this.inBounds(a[1], a[2])) continue;
          w.enemies.remoteKill(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]);
        }
        break;
      case 'shot': {
        const s = ev.s as number[];
        if (s[0] === 0) w.enemies.addRemoteShot({ x: s[1], y: s[2], vx: s[3], vy: s[4], dmg: s[5], r: s[6], life: s[7], dead: false, kind: 'spit' });
        else w.enemies.addRemoteShot({ x: s[1], y: s[2], vx: 0, vy: 0, dmg: s[5], r: 0.6, life: 9, dead: false, kind: 'rock', sx: s[1], sy: s[2], tx: s[3], ty: s[4], t: 0, dur: s[6], aoe: s[7] });
        break;
      }
      case 'ph': if (from === this.hostId) w.onPhaseMsg(ev.p as PhaseMsg); break;
      case 'ws': if (from === this.hostId) w.applyWorldState(ev.cd, ev.ct, String(ev.info ?? ''), ev.zt); break;
      case 'bs': if (from === this.hostId && w.boss?.mirror) w.boss.applyState(ev.s, ev.an, !!ev.en, ev.tp, ev.tl); break;
      case 'fx': if (from === this.hostId) w.applyFx(ev.n, ev.a); break;
      case 'claim':
        if (!this.isHost) break;
        if (w.pickups.hostClaim(ev.uid)) this.qAll.push({ k: 'take', uid: ev.uid, by: from });
        else this.to(from, { k: 'deny', uid: ev.uid });
        break;
      case 'take': w.pickups.onTaken(ev.uid, ev.by); break;
      case 'deny': w.pickups.onDenied(ev.uid); break;
      case 'drop':
        if (!this.inBounds(ev.x, ev.y) || w.pickups.find(ev.uid)) break;
        w.pickups.dropThing(reuid(ev.th as WorldThing), ev.x, ev.y, !!ev.auto, ev.uid, false);
        break;
      case 'rev': w.revived(this.name(from)); break;
    }
  }

  private applyState(r: RemotePlayer, s: any): void {
    const w = this.w;
    const first = r.stamp === 0;
    const wasDown = r.downed, wasDead = r.dead;
    r.tx = s.x; r.ty = s.y; r.vx = s.vx; r.vy = s.vy; r.tf = s.f;
    if (first || Math.hypot(r.x - s.x, r.y - s.y) > 6) { r.x = s.x; r.y = s.y; r.face = s.f; }
    if (s.hp < r.hp - 0.5 && !first) r.hurtT = 0.25;
    r.hp = s.hp; r.maxHp = s.mhp;
    r.downed = !!s.dn; r.dead = !!s.dd; r.arrived = !!s.ar;
    r.suit = s.su; r.moving = s.mv;
    if (s.ft[0] < r.firingT[0]) r.firingT[0] = s.ft[0];
    if (s.ft[1] < r.firingT[1]) r.firingT[1] = s.ft[1];
    r.reloading = [!!s.rl[0], !!s.rl[1]];
    r.paused = !!s.pz; r.invuln = !!s.iv; r.rad = s.rad; r.kills = s.kl;
    r.reviveBy = s.rv; r.reviveK = s.rk;
    if (typeof s.sp === 'number') r.speed = s.sp;
    if (Array.isArray(s.bt)) r.buffs = [s.bt[0], s.bt[1], s.bt[2]];
    if (Array.isArray(s.hd)) r.hands = s.hd.map((a: number[]) => ({ auto: !!a[0], cursor: a[1], reloading: !!a[2], prog: a[3] }));
    r.stamp = this.clock;
    if (!first) {
      if (!wasDown && r.downed) w.fx.toast(`${r.name} 倒下了！快去把 TA 拉起来`, '#ff5a4a');
      if (wasDown && !r.downed && !r.dead) w.fx.toast(`${r.name} 被拉了起来`, '#6aff8a');
      if (!wasDead && r.dead) w.fx.toast(`${r.name} 在本局中阵亡了`, '#ff3030');
    }
  }

  private onLeft(id: number, name: string): void {
    const r = this.rem.get(id);
    this.rem.delete(id);
    this.w?.fx.toast(`${r?.name ?? name} 离开了游戏`, '#ff9a3c');
    this.onLeave(r?.name ?? name);
  }
}

function makeRemote(id: number, name: string): RemotePlayer {
  return {
    id, name, slot: id, x: 0, y: 0, vx: 0, vy: 0, face: Math.PI / 2, hp: 100, maxHp: 100, downed: false, dead: false, arrived: false,
    suit: 1, moving: 0, walkPhase: 0, firingT: [9, 9], reloading: [false, false], looks: [null, null], lookRarity: [0, 0],
    invuln: false, paused: false, rad: 0, kills: 0, tx: 0, ty: 0, tf: Math.PI / 2, stamp: 0, hurtT: 0, reviveBy: -1, reviveK: 0,
    speed: 4, buffs: [0, 0, 0], hands: [{ auto: false, cursor: 0, reloading: false, prog: 1 }, { auto: false, cursor: 0, reloading: false, prog: 1 }], prof: null,
  };
}

/** 收到别人丢下的物品：重新分配本地编号，避免与自己背包里的物品冲突 */
function reuid(th: WorldThing): WorldThing {
  th.uid = nextUid();
  if (th.kind === 'gun') for (const b of th.bullets) if (b) b.uid = nextUid();
  return th;
}
