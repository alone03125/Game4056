// 玩家投射物与区域效果（爆炸、毒雾、奇点）。
// 第2版：每个投射物记录发射者；其他玩家射出的子弹在本地以“影子”模拟（只负责显示和友伤判定，
// 对丧尸的伤害由发射者本人结算）。玩家的子弹对玩家（包括自己）只造成 5% 的伤害。

import { Bullet, BulletDef, BULLETS, BUTTER, CastMods, IRI, PROJ_IDS, projDef, SHINY, SPECIAL_DEFS, SpecialId, areaRadius, hitRadius } from '../data/bullets';
import { GunStats } from '../data/guns';
import { RELIC } from '../data/relics';
import { clamp, DEG, wrapAngle } from '../util/math';
import { globalRng } from '../util/rng';
import { DmgSrc, Enemy, isNormalZombie, MAX_ENEMY_R } from './enemies';
import type { World } from './world';

export type { CastMods };

export const PROJ_SPEED = 0.45; // 子弹 Spd 数值 → 米/秒 的换算
const MAX_PROJ = 1400;
const MAX_MINES = 36;

export const FANCY_SHINY = 1;
export const FANCY_IRI = 2;

export interface Proj {
  dead: boolean;
  kind: BulletDef['kind'];
  def: BulletDef;
  x: number;
  y: number;
  px: number; // 上一帧位置（渲染拖尾）
  py: number;
  vx: number;
  vy: number;
  dmg: number;
  r: number;
  area: number;
  age: number;
  life: number;
  traveled: number;
  maxDist: number;
  pierce: number;
  wallBounce: number;
  enemyBounce: number;
  hits: number[];
  hitT: number[];
  state: number;
  color: number;
  scale: number;
  spin: number;
  target: Enemy | null;
  retarget: number;
  fragment: boolean;
  z: number; // 视觉高度
  homing: boolean; // 逻辑模块赋予的追踪
  blast: boolean; // 逻辑模块赋予的命中爆炸
  owner: number; // 发射者（玩家编号）
  ghost: boolean; // 其他玩家的子弹（不对丧尸结算伤害）
  bounced: boolean; // 已经反弹过（反弹后可以打到自己）
  hitP: number[]; // 已命中过的玩家
  fancy: number; // 闪耀 / 虹彩（显示用）
  fuse: number; // 感应地雷：触发后的引信倒计时（秒）
  kb: number; // 修饰语“强劲”：按伤害附加的击退力度
  butter: boolean; // 第4次调整：玉米粒变成的黄油
  relic: boolean; // 第4.1次调整：奇物射出的箭 / 短刀（固定伤害，不触发奇物的命中效果）
}

/** 感应地雷被触发后延迟爆炸的时间：给玩家留出离开的机会，不会每次都炸到自己 */
export const MINE_FUSE = 0.5;

export interface Hazard {
  kind: 'toxic' | 'vortex';
  dead: boolean;
  x: number;
  y: number;
  r: number;
  t: number;
  dur: number;
  atk: number;
  tick: number;
  ghost: boolean; // 其他玩家的区域效果：只显示与友伤
  pullOnly: boolean; // 主机替其他玩家模拟的奇点吸引（不显示、不伤害）
}

interface HitRec { t: number; e: Enemy }
const hitScratch: HitRec[] = [];
const nTmp = { x: 0, y: 0 };

/** 可被子弹命中的玩家（本地或远程） */
interface PlayerCircle { id: number; x: number; y: number; r: number; local: boolean }

export class Projectiles {
  list: Proj[] = [];
  pool: Proj[] = [];
  hazards: Hazard[] = [];
  mines = 0;
  private circles: PlayerCircle[] = [];

  constructor(private w: World) {}

  clear(): void {
    for (const p of this.list) this.pool.push(p);
    this.list = [];
    this.hazards = [];
    this.mines = 0;
  }

  private alloc(): Proj {
    const p = this.pool.pop();
    if (p) { p.hits.length = 0; p.hitT.length = 0; p.hitP.length = 0; return p; }
    return {
      dead: false, kind: 'bullet', def: BULLETS.std, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, dmg: 0, r: 0.1, area: 0,
      age: 0, life: 1, traveled: 0, maxDist: 26, pierce: 0, wallBounce: 0, enemyBounce: 0, hits: [], hitT: [],
      state: 0, color: 0xffffff, scale: 1, spin: 0, target: null, retarget: 0, fragment: false, z: 1.1, homing: false, blast: false,
      owner: 0, ghost: false, bounced: false, hitP: [], fancy: 0, fuse: 0, kb: 0, butter: false, relic: false,
    };
  }

  /** 枪械射出一发子弹（可能包含多个弹丸） */
  fire(stats: GunStats, b: Bullet, ox: number, oy: number, aim: number, mods: CastMods = {}): void {
    const def = BULLETS[b.def];
    // 第4.1次调整：二重分裂模块让这一发分裂成 2 倍
    const multi = Math.max(1, Math.round(mods.multi ?? 1));
    const count = (def.count ?? 1) * multi;
    let S = clamp(stats.spread + b.deg - (mods.focus ?? 0), 0, 360) * DEG;
    // 分裂出来的子弹至少稍微错开，不会完全重叠
    if (multi > 1 && !def.flags?.ring) S = Math.max(S, 10 * DEG * (multi - 1));
    let dmg = b.atk * stats.atk * (mods.dmg ?? 1);
    let fancy = (b.shiny ? FANCY_SHINY : 0) | (b.iri ? FANCY_IRI : 0);
    // 闪耀虹彩模块：发射时变为闪耀虹彩（已经是闪耀 / 虹彩的部分不重复加成）
    if (mods.shine) {
      if (!b.shiny) dmg *= SHINY.mul;
      if (!b.iri) dmg *= IRI.mul;
      fancy = FANCY_SHINY | FANCY_IRI;
    }
    const spdMul = mods.speed ?? 1;
    for (let i = 0; i < count; i++) {
      let a: number;
      if (def.flags?.ring) a = aim + (i / count) * Math.PI * 2;
      else if (count > 1) a = aim - S / 2 + (S * (i + 0.5)) / count + globalRng.range(-0.3, 0.3) * (S / count);
      else a = aim + globalRng.range(-S / 2, S / 2);
      const spdJitter = count > 1 && !def.flags?.ring ? globalRng.range(0.85, 1.1) : 1;
      const p = this.spawn(def, b, ox, oy, a, dmg, b.spd * PROJ_SPEED * spdJitter * spdMul);
      if (p) {
        if (mods.homing) { p.homing = true; p.life = Math.max(p.life, 3); p.maxDist = Math.max(p.maxDist, 40); }
        if (mods.pierce && p.pierce >= 0) p.pierce += mods.pierce;
        if (mods.blast) p.blast = true;
        p.fancy = fancy;
        // 玉米粒：一定概率变成黄油（攻击力 ×7，命中时晕眩附近的敌人）
        if (def.flags?.butter && globalRng.chance(def.flags.butter)) this.makeButter(p);
        // 修饰语“强劲”：击退力度取决于这一发造成的伤害
        if (stats.knock) p.kb = Math.min(12, 1 + p.dmg / 25);
        this.w.net?.projSpawned(p);
      }
    }
  }

  /** 奇物射出的箭 / 短刀（第4.1次调整）：固定伤害，追踪目标 */
  fireSpecial(id: SpecialId, x: number, y: number, a: number, target: Enemy | null): void {
    const def = SPECIAL_DEFS[id];
    if (this.list.length >= MAX_PROJ) return;
    const p = this.alloc();
    const sp = def.spd * PROJ_SPEED;
    this.init(p, def, x, y, Math.cos(a) * sp, Math.sin(a) * sp, def.atk, 0.16, 0, 1);
    p.owner = this.w.myId;
    p.ghost = false;
    p.relic = true;
    p.target = target;
    p.retarget = 0.4;
    p.life = 2;
    this.list.push(p);
    this.w.net?.projSpawned(p);
  }

  private makeButter(p: Proj): void {
    p.butter = true;
    p.dmg *= BUTTER.atkMul;
    p.color = BUTTER.color;
    p.r *= 1.6;
    p.scale *= 1.8;
  }

  private spawn(def: BulletDef, b: Bullet, x: number, y: number, a: number, dmg: number, speed: number): Proj | null {
    if (this.list.length >= MAX_PROJ) return null;
    const p = this.alloc();
    this.init(p, def, x, y, Math.cos(a) * speed, Math.sin(a) * speed, dmg, hitRadius(b), areaRadius(b), Math.max(0.5, b.rng / 3));
    p.owner = this.w.myId;
    p.ghost = false;
    this.list.push(p);
    return p;
  }

  private init(p: Proj, def: BulletDef, x: number, y: number, vx: number, vy: number, dmg: number, r: number, area: number, scale: number): void {
    p.dead = false;
    p.kind = def.kind;
    p.def = def;
    p.x = x; p.y = y; p.px = x; p.py = y;
    p.vx = vx;
    p.vy = vy;
    p.dmg = dmg;
    p.r = r;
    p.area = area;
    p.age = 0;
    p.life = 6;
    p.traveled = 0;
    p.maxDist = def.range ?? 26;
    p.pierce = def.pierce ?? 0;
    p.wallBounce = def.flags?.wallBounce ?? 0;
    p.enemyBounce = def.flags?.enemyBounce ?? 0;
    p.state = 0;
    p.color = def.color;
    p.scale = scale;
    p.spin = 0;
    p.target = null;
    p.retarget = 0;
    p.fragment = false;
    p.z = 1.1;
    p.homing = false;
    p.blast = false;
    p.bounced = false;
    p.fancy = 0;
    p.fuse = 0;
    p.kb = 0;
    p.butter = false;
    p.relic = false;
    switch (def.kind) {
      case 'bomb': p.life = 2.5; p.maxDist = 999; break;
      case 'rocket': p.life = 3; p.maxDist = 60; break;
      case 'saw': p.life = 2.2; p.maxDist = 999; break;
      case 'boomer': p.life = 4; p.maxDist = 999; break;
      case 'mine':
        p.life = 20; p.maxDist = 999;
        this.mines++;
        if (this.mines > MAX_MINES) {
          const old = this.list.find((q) => q.kind === 'mine' && !q.dead);
          if (old) this.explodeProj(old);
        }
        break;
      case 'toxic': p.life = 0.6; p.maxDist = 999; break;
      case 'singular': p.life = 1.2; p.maxDist = 999; break;
    }
    if (def.flags?.homing) p.life = 3;
  }

  /** 联机：把投射物编码成数组发送给其他玩家 */
  static encode(p: Proj): number[] {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return [PROJ_IDS.indexOf(p.def.id), r2(p.x), r2(p.y), r2(p.vx), r2(p.vy), Math.round(p.dmg * 10) / 10, r2(p.r), r2(p.area), r2(p.life), r2(p.maxDist), p.pierce,
      p.wallBounce, p.enemyBounce, (p.homing ? 1 : 0) | (p.blast ? 2 : 0) | (p.fancy << 2) | (p.butter ? 16 : 0), r2(p.scale)];
  }

  /** 联机：其他玩家射出的子弹（影子） */
  spawnGhost(a: number[], owner: number): void {
    if (this.list.length >= MAX_PROJ) return;
    const def = projDef(PROJ_IDS[a[0]]);
    if (!def) return;
    const p = this.alloc();
    this.init(p, def, a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[14]);
    p.life = a[8]; p.maxDist = a[9]; p.pierce = a[10]; p.wallBounce = a[11]; p.enemyBounce = a[12];
    p.homing = !!(a[13] & 1); p.blast = !!(a[13] & 2); p.fancy = (a[13] >> 2) & 3;
    if (a[13] & 16) { p.butter = true; p.color = BUTTER.color; }
    p.owner = owner;
    p.ghost = true;
    p.relic = def.weight === 0;
    this.list.push(p);
  }

  /** 收集本帧可被子弹命中的玩家 */
  private gatherCircles(): void {
    const w = this.w;
    const c = this.circles;
    c.length = 0;
    // 安全屋里试枪：子弹直接穿过所有玩家
    if (w.phase === 'safehouse') return;
    if (w.localTargetable()) c.push({ id: w.myId, x: w.player.x, y: w.player.y, r: w.player.r, local: true });
    if (w.net) for (const r of w.net.remotes()) if (!r.dead && !r.downed && !r.arrived) c.push({ id: r.id, x: r.x, y: r.y, r: 0.4, local: false });
  }

  update(dt: number): void {
    const w = this.w;
    this.gatherCircles();
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      if (p.dead) continue;
      p.age += dt;
      p.px = p.x; p.py = p.y;
      switch (p.kind) {
        case 'bomb': this.updBomb(p, dt); break;
        case 'mine': this.updMine(p, dt); break;
        case 'saw': this.updSaw(p, dt); break;
        case 'boomer': this.updBoomer(p, dt); break;
        default: this.updBullet(p, dt); break;
      }
    }
    // 区域效果
    const auth = w.isAuthority;
    for (const h of this.hazards) {
      if (h.dead) continue;
      h.t += dt;
      h.tick -= dt;
      if (h.kind === 'toxic') {
        if (h.tick <= 0) {
          h.tick = 0.25;
          if (!h.ghost) {
            w.enemies.hash.queryRadius(h.x, h.y, h.r + MAX_ENEMY_R, (e, d2) => {
              const rr = h.r + e.r;
              if (d2 <= rr * rr) w.enemies.damage(e, h.atk * 3 * 0.25, null);
            });
          }
          if (this.localIn(h.x, h.y, h.r)) { (globalThis as any).__ff?.('toxic', h.atk * 3 * 0.25); w.friendlyFire(h.atk * 3 * 0.25, h.x, h.y); }
        }
      } else {
        // 第4次调整：奇点也会吸引投掷物（炸弹、地雷、毒雾弹、奇点弹）和丧尸的口水（每个人在本地模拟）
        if (!h.pullOnly) this.pullThrown(h.x, h.y, h.r, dt);
        // 奇点：吸引（由主机模拟）+ 持续伤害（由发射者结算）
        if (auth && (!h.ghost || h.pullOnly)) {
          w.enemies.hash.queryRadius(h.x, h.y, h.r, (e, d2) => {
            if (e.type === 'boss') return;
            const d = Math.sqrt(d2) || 0.01;
            const pull = 9 * (1 - d / h.r) + 2;
            e.kx += ((h.x - e.x) / d) * pull * dt * 6 / e.mass;
            e.ky += ((h.y - e.y) / d) * pull * dt * 6 / e.mass;
          });
        }
        if (h.tick <= 0) {
          h.tick = 0.2;
          if (!h.ghost) w.enemies.hash.queryRadius(h.x, h.y, 2.5, (e) => { w.enemies.damage(e, h.atk, null); });
          if (!h.pullOnly && this.localIn(h.x, h.y, 2.5)) { (globalThis as any).__ff?.('vortex', h.atk); w.friendlyFire(h.atk, h.x, h.y); }
        }
      }
      if (h.t >= h.dur) {
        h.dead = true;
        if (h.kind === 'vortex' && !h.pullOnly) {
          this.explode(h.x, h.y, 4, h.atk * 9, 0xa040ff, 6, null, h.ghost);
          w.fx.sound('explosion', h.x, h.y, 0.8);
        }
      }
    }
    if (this.hazards.length > 30) this.hazards = this.hazards.filter((h) => !h.dead);
    this.compact();
  }

  /** 受力影响的投掷物：玩家的炸弹、地雷、毒雾弹、奇点弹，以及丧尸的口水 */
  private static THROWN = new Set(['bomb', 'mine', 'toxic', 'singular']);

  /** 奇点把附近的投掷物吸过去（越靠近中心越强） */
  private pullThrown(x: number, y: number, r: number, dt: number): void {
    const pull = (px: number, py: number): [number, number] | null => {
      const dx = x - px, dy = y - py;
      const d = Math.hypot(dx, dy);
      if (d > r || d < 0.05) return null;
      const k = (14 * (1 - d / r) + 4) * dt;
      return [(dx / d) * k, (dy / d) * k];
    };
    for (const p of this.list) {
      if (p.dead || !Projectiles.THROWN.has(p.kind)) continue;
      const f = pull(p.x, p.y);
      if (f) { p.vx += f[0]; p.vy += f[1]; }
    }
    for (const s of this.w.enemies.shots) {
      if (s.dead || s.kind !== 'spit') continue;
      const f = pull(s.x, s.y);
      if (f) { s.vx += f[0] * 1.6; s.vy += f[1] * 1.6; }
    }
  }

  /** 爆炸的冲击波把附近的投掷物推开 */
  private pushThrown(x: number, y: number, r: number, force: number): void {
    const R = r + 1;
    for (const p of this.list) {
      if (p.dead || !Projectiles.THROWN.has(p.kind)) continue;
      const dx = p.x - x, dy = p.y - y;
      const d = Math.hypot(dx, dy);
      if (d > R || d < 0.05) continue;
      const k = force * (1 - d / R) * 1.5;
      p.vx += (dx / d) * k; p.vy += (dy / d) * k;
    }
    for (const s of this.w.enemies.shots) {
      if (s.dead || s.kind !== 'spit') continue;
      const dx = s.x - x, dy = s.y - y;
      const d = Math.hypot(dx, dy);
      if (d > R || d < 0.05) continue;
      const k = force * (1 - d / R) * 1.5;
      s.vx += (dx / d) * k; s.vy += (dy / d) * k;
    }
  }

  private localIn(x: number, y: number, r: number): boolean {
    const w = this.w;
    if (!w.localTargetable()) return false;
    return Math.hypot(w.player.x - x, w.player.y - y) < r + w.player.r;
  }

  private compact(): void {
    let j = 0;
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      if (p.dead) { if (p.kind === 'mine') this.mines--; this.pool.push(p); }
      else this.list[j++] = p;
    }
    this.list.length = j;
  }

  /** 扫掠检测：从当前位置移动 (dx,dy) 途中命中的敌人，按先后排序写入 hitScratch */
  private sweep(p: Proj, x1: number, y1: number, maxT: number): number {
    hitScratch.length = 0;
    const x0 = p.x, y0 = p.y;
    const dx = x1 - x0, dy = y1 - y0;
    const dd = dx * dx + dy * dy;
    const pad = p.r + MAX_ENEMY_R;
    this.w.enemies.hash.queryBox(Math.min(x0, x1) - pad, Math.min(y0, y1) - pad, Math.max(x0, x1) + pad, Math.max(y0, y1) + pad, (e) => {
      const fx = x0 - e.x, fy = y0 - e.y;
      let t = dd > 1e-9 ? -(fx * dx + fy * dy) / dd : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = x0 + dx * t - e.x, cy = y0 + dy * t - e.y;
      const rr = p.r + e.r;
      if (cx * cx + cy * cy <= rr * rr && t <= maxT) hitScratch.push({ t, e });
    });
    if (hitScratch.length > 1) hitScratch.sort((a, b) => a.t - b.t);
    return hitScratch.length;
  }

  /** 扫掠检测玩家：返回最先命中的玩家及其位置参数 t（没有命中返回 null） */
  private sweepPlayers(p: Proj, x1: number, y1: number, maxT: number): { c: PlayerCircle; t: number } | null {
    let best: PlayerCircle | null = null, bt = maxT;
    const x0 = p.x, y0 = p.y;
    const dx = x1 - x0, dy = y1 - y0;
    const dd = dx * dx + dy * dy;
    for (const c of this.circles) {
      if (c.id === p.owner && !p.bounced) continue;
      if (p.hitP.includes(c.id)) continue;
      const fx = x0 - c.x, fy = y0 - c.y;
      let t = dd > 1e-9 ? -(fx * dx + fy * dy) / dd : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = x0 + dx * t - c.x, cy = y0 + dy * t - c.y;
      const rr = p.r + c.r;
      if (cx * cx + cy * cy <= rr * rr && t <= bt) { bt = t; best = c; }
    }
    return best ? { c: best, t: bt } : null;
  }

  /** 子弹命中玩家：本地玩家受到友伤，远程玩家只显示（由其本人结算） */
  private hitPlayer(p: Proj, c: PlayerCircle): void {
    p.hitP.push(c.id);
    const vl = Math.hypot(p.vx, p.vy) || 1;
    this.w.fx.blood(c.x, c.y, 0xaa1010, 3, p.vx / vl, p.vy / vl);
    if (c.local) { (globalThis as any).__ff?.(p.ghost ? 'ghost-' + p.kind + (p.bounced ? '-b' : '') : 'own-' + p.kind, p.dmg); this.w.friendlyFire(p.dmg, p.x - p.vx * 0.05, p.y - p.vy * 0.05); }
  }

  private updBullet(p: Proj, dt: number): void {
    const w = this.w;
    // 火箭加速（三级）
    if (p.kind === 'rocket') {
      const stage = p.age < 0.22 ? 0 : p.age < 0.44 ? 1 : 2;
      if (stage > p.state) {
        p.state = stage;
        p.vx *= 1.7; p.vy *= 1.7;
        w.fx.smoke(p.x, p.y, 3);
        w.fx.sparks(p.x, p.y, 0xffaa40, 4, 3);
      }
      if (globalRng.chance(0.5)) w.fx.smoke(p.x, p.y, 1);
    }
    // 追踪
    if (p.def.flags?.homing || p.homing) {
      p.retarget -= dt;
      if (p.retarget <= 0 || !p.target || p.target.dead) {
        p.retarget = 0.15;
        p.target = w.enemies.nearest(p.x, p.y, 13, (e) => p.hits.includes(e.id));
      }
      if (p.target) {
        const cur = Math.atan2(p.vy, p.vx);
        const want = Math.atan2(p.target.y - p.y, p.target.x - p.x);
        const da = clamp(wrapAngle(want - cur), -7 * dt, 7 * dt);
        const sp = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(cur + da) * sp;
        p.vy = Math.sin(cur + da) * sp;
      }
    }
    if (p.kind === 'singular' || p.kind === 'toxic') {
      p.vx *= Math.max(0, 1 - 1.2 * dt);
      p.vy *= Math.max(0, 1 - 1.2 * dt);
    }
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
    const tWall = w.col.raycast(p.x, p.y, nx, ny, Math.min(p.r, 0.12), nTmp, 1.0);
    let maxT = tWall >= 0 ? tWall : 1;
    // 命中玩家（友伤）：比墙和丧尸更早时截断本帧的移动
    const ph = p.kind === 'singular' || p.kind === 'bomb' || p.kind === 'toxic' ? null : this.sweepPlayers(p, nx, ny, maxT);
    if (ph) maxT = ph.t;
    const n = p.kind === 'singular' || p.kind === 'bomb' ? 0 : this.sweep(p, nx, ny, maxT);
    let stopT = -1;
    for (let i = 0; i < n; i++) {
      const { t, e } = hitScratch[i];
      if (e.dead || p.hits.includes(e.id)) continue;
      const hx = p.x + (nx - p.x) * t, hy = p.y + (ny - p.y) * t;
      if (p.kind === 'rocket') { p.x = hx; p.y = hy; this.explodeProj(p); return; }
      if (p.kind === 'toxic') { p.x = hx; p.y = hy; this.toCloud(p); return; }
      this.hitEnemy(p, e, p.dmg);
      p.hits.push(e.id);
      if (p.kind === 'split' && !p.fragment) { p.x = hx; p.y = hy; this.doSplit(p); return; }
      if (p.enemyBounce > 0) {
        p.enemyBounce--;
        const t2 = w.enemies.nearest(e.x, e.y, 10, (o) => p.hits.includes(o.id));
        if (t2) {
          const a = Math.atan2(t2.y - e.y, t2.x - e.x);
          const sp = Math.hypot(p.vx, p.vy);
          p.x = hx; p.y = hy;
          p.vx = Math.cos(a) * sp; p.vy = Math.sin(a) * sp;
          p.traveled = Math.max(0, p.traveled - 6);
          return;
        }
      }
      if (p.pierce === 0) { stopT = t; break; }
      if (p.pierce > 0) p.pierce--;
    }
    if (stopT >= 0) {
      p.x = p.x + (nx - p.x) * stopT;
      p.y = p.y + (ny - p.y) * stopT;
      p.dead = true;
      return;
    }
    if (ph) {
      p.x = p.x + (nx - p.x) * ph.t;
      p.y = p.y + (ny - p.y) * ph.t;
      if (p.kind === 'rocket') { this.explodeProj(p); return; }
      this.hitPlayer(p, ph.c);
      if (p.kind === 'split' && !p.fragment) { this.doSplit(p); return; }
      if (p.pierce === 0) { p.dead = true; return; }
      return;
    }
    if (tWall >= 0) {
      const hx = p.x + (nx - p.x) * tWall, hy = p.y + (ny - p.y) * tWall;
      // 第4.1次调整：子弹打中可燃物堆时点燃它
      if (!p.ghost) w.quests.onShot(hx, hy, p.r);
      if (p.kind === 'rocket') { p.x = hx - nTmp.x * 0.1; p.y = hy - nTmp.y * 0.1; this.explodeProj(p); return; }
      if (p.kind === 'toxic') { p.x = hx - nTmp.x * 0.3; p.y = hy - nTmp.y * 0.3; this.toCloud(p); return; }
      if (p.kind === 'singular') { p.x = hx - nTmp.x * 0.4; p.y = hy - nTmp.y * 0.4; this.toVortex(p); return; }
      if (p.kind === 'split' && !p.fragment) { p.x = hx - nTmp.x * 0.2; p.y = hy - nTmp.y * 0.2; this.doSplit(p); return; }
      if (p.wallBounce > 0) {
        p.wallBounce--;
        p.bounced = true;
        p.x = hx + nTmp.x * 0.05; p.y = hy + nTmp.y * 0.05;
        if (nTmp.x !== 0) p.vx = -p.vx;
        if (nTmp.y !== 0) p.vy = -p.vy;
        p.hits.length = 0;
        w.fx.sparks(hx, hy, p.color, 3, 3);
        w.fx.sound('ricochet', hx, hy, 0.25);
        return;
      }
      p.dead = true;
      w.fx.sparks(hx, hy, p.color, 4, 4);
      return;
    }
    const step = Math.hypot(nx - p.x, ny - p.y);
    p.x = nx; p.y = ny;
    p.traveled += step;
    if (p.kind === 'split' && !p.fragment && p.age >= 0.3) { this.doSplit(p); return; }
    if (p.kind === 'toxic' && p.age >= p.life) { this.toCloud(p); return; }
    if (p.kind === 'singular' && p.age >= p.life) { this.toVortex(p); return; }
    if (p.traveled >= p.maxDist || p.age >= p.life) {
      if (p.kind === 'rocket') { this.explodeProj(p); return; }
      p.dead = true;
    }
  }

  private moveBouncy(p: Proj, dt: number, restitution: number): boolean {
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
    const t = this.w.col.raycast(p.x, p.y, nx, ny, p.r, nTmp, 0.5);
    if (t >= 0) {
      p.x += (nx - p.x) * t + nTmp.x * 0.02;
      p.y += (ny - p.y) * t + nTmp.y * 0.02;
      if (!p.ghost) this.w.quests.onShot(p.x, p.y, p.r);
      if (nTmp.x !== 0) p.vx = -p.vx * restitution;
      if (nTmp.y !== 0) p.vy = -p.vy * restitution;
      return true;
    }
    p.x = nx; p.y = ny;
    return false;
  }

  private updBomb(p: Proj, dt: number): void {
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 0.01) {
      const ns = Math.max(0, sp - 6 * dt);
      p.vx *= ns / sp; p.vy *= ns / sp;
    }
    if (this.moveBouncy(p, dt, 0.5)) this.w.fx.sound('drop', p.x, p.y, 0.25);
    p.spin += sp * dt * 2;
    p.z = 0.35;
    if (p.age >= p.life) this.explodeProj(p);
  }

  private updMine(p: Proj, dt: number): void {
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 0.01) {
      const ns = Math.max(0, sp - 9 * dt);
      p.vx *= ns / sp; p.vy *= ns / sp;
    }
    this.moveBouncy(p, dt, 0.3);
    p.z = 0.08;
    // 已触发：引信倒计时结束后爆炸
    if (p.state === 2) {
      p.fuse -= dt;
      if (p.fuse <= 0) this.explodeProj(p);
      return;
    }
    if (p.age >= 0.5) {
      if (p.state === 0) { p.state = 1; this.w.fx.sound('mineArm', p.x, p.y, 0.3); }
      let trig = false;
      this.w.enemies.hash.queryRadius(p.x, p.y, 1.3 + MAX_ENEMY_R, (e, d2) => {
        const rr = 1.3 + e.r;
        if (d2 < rr * rr) { trig = true; return true; }
      });
      if (trig) { p.state = 2; p.fuse = MINE_FUSE; this.w.fx.sound('beepHigh', p.x, p.y, 0.4); return; }
    }
    if (p.age >= p.life) this.explodeProj(p);
  }

  private updSaw(p: Proj, dt: number): void {
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 3) { p.vx *= 1 - 0.35 * dt; p.vy *= 1 - 0.35 * dt; }
    if (this.moveBouncy(p, dt, 0.9)) { this.w.fx.sparks(p.x, p.y, 0xffffff, 4, 4); p.bounced = true; }
    p.spin += dt * 30;
    this.multiHit(p, 0.12);
    if (p.age >= p.life) { p.dead = true; this.w.fx.sparks(p.x, p.y, 0xcccccc, 5, 3); }
  }

  /** 回旋镖飞回发射者 */
  private ownerPos(p: Proj): { x: number; y: number } | null {
    const w = this.w;
    if (!p.ghost) return w.player;
    if (w.net) for (const r of w.net.remotes()) if (r.id === p.owner) return r;
    return null;
  }

  private updBoomer(p: Proj, dt: number): void {
    const pl = this.ownerPos(p);
    p.spin += dt * 18;
    if (p.state === 0 || !pl) {
      p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.6 * dt;
      if (p.age >= 0.7 && p.state === 0) { p.state = 1; p.hits.length = 0; p.hitT.length = 0; }
    } else {
      const dx = pl.x - p.x, dy = pl.y - p.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const sp = Math.min(26, Math.hypot(p.vx, p.vy) + 30 * dt);
      p.vx += ((dx / d) * sp - p.vx) * Math.min(1, 6 * dt);
      p.vy += ((dy / d) * sp - p.vy) * Math.min(1, 6 * dt);
      if (d < 0.9) { p.dead = true; return; }
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.multiHit(p, 999);
    if (p.age >= p.life) p.dead = true;
  }

  /** 多段命中：同一敌人在 cd 秒内只受伤一次；每名玩家只会被同一个投射物伤害一次 */
  private multiHit(p: Proj, cd: number): void {
    const w = this.w;
    w.enemies.hash.queryRadius(p.x, p.y, p.r + MAX_ENEMY_R, (e, d2) => {
      const rr = p.r + e.r;
      if (d2 > rr * rr) return;
      const idx = p.hits.indexOf(e.id);
      if (idx >= 0) {
        if (p.age - p.hitT[idx] < cd) return;
        p.hitT[idx] = p.age;
      } else {
        p.hits.push(e.id);
        p.hitT.push(p.age);
        if (p.hits.length > 40) { p.hits.shift(); p.hitT.shift(); }
      }
      this.hitEnemy(p, e, p.dmg);
    });
    // 回旋镖回到自己手里不算伤害；圆锯片反弹后可能误伤自己
    for (const c of this.circles) {
      if ((c.id === p.owner && (p.kind === 'boomer' || !p.bounced)) || p.hitP.includes(c.id)) continue;
      if (Math.hypot(c.x - p.x, c.y - p.y) < p.r + c.r) this.hitPlayer(p, c);
    }
  }

  /** 命中敌人：伤害 + 子弹特效（影子子弹只有表现） */
  hitEnemy(p: Proj, e: Enemy, dmg: number): void {
    const w = this.w;
    const f = p.def.flags;
    const vlen = Math.hypot(p.vx, p.vy) || 1;
    const dirX = p.vx / vlen, dirY = p.vy / vlen;
    w.fx.blood(e.x, e.y, e.type === 'spitter' ? 0x8acc3a : 0x8a1a10, 3, dirX, dirY);
    w.fx.sound('hit', e.x, e.y, p.ghost ? 0.2 : 0.35);
    if (p.butter) w.fx.sparks(e.x, e.y, BUTTER.color, 8, 4);
    if (p.ghost) {
      e.flash = 0.06;
      if (p.blast) { w.fx.explosion(e.x, e.y, 2, 0xff8a4a); this.ffBlast(e.x, e.y, 2, dmg * 0.6); }
      if (f?.chain) this.chain(e, dmg, f.chain, true);
      return;
    }
    if (p.butter) {
      // 黄油：命中点附近小范围的敌人晕眩
      w.enemies.hash.queryRadius(e.x, e.y, BUTTER.radius + MAX_ENEMY_R, (o, d2) => {
        const rr = BUTTER.radius + o.r;
        if (d2 <= rr * rr) w.enemies.applyStun(o, BUTTER.stun);
      });
      w.fx.floatText(e.x, e.y, '晕眩', '#ffe680');
      w.fx.sound('splat', e.x, e.y, 0.6);
    }
    w.enemies.applyKnock(e, dirX, dirY, (f?.knock ?? 0.8) + p.kb);
    if (f?.leech) w.healPlayer(Math.min(3, dmg * 0.04), true);
    // 第4.1次调整：奇物的命中效果（奇物自己射出的箭和短刀不触发）
    const run = w.run;
    const own = !p.relic;
    let color: string | undefined;
    let execute = false;
    if (own && run.has('crit') && globalRng.chance(RELIC.critChance)) {
      dmg *= RELIC.critMul;
      color = '#ff5aff';
      execute = isNormalZombie(e);
      w.fx.sparks(e.x, e.y, 0xff5aff, 8, 5);
    }
    const src: DmgSrc = this.relicSrc(dmg, own);
    src.gold = f?.gold;
    src.slow = f?.slow;
    if (f?.burn) src.burnDps = (src.burnDps ?? 0) + dmg * 0.4;
    src.execute = execute;
    w.enemies.damage(e, dmg, src, color);
    if (p.blast) {
      this.explode(e.x, e.y, 2, dmg * 0.6, 0xff8a4a, 3, { ...this.relicSrc(dmg * 0.6, own), gold: f?.gold });
      w.fx.sound('smallExplosion', e.x, e.y, 0.5);
    }
    if (f?.chain) this.chain(e, dmg, f.chain, false);
    if (own && run.has('shock')) this.shock(e, dmg);
  }

  /** 灼烧疗法 / 腐蚀疗法附带在伤害上的效果 */
  private relicSrc(dmg: number, own: boolean): DmgSrc {
    const run = this.w.run;
    const src: DmgSrc = {};
    if (!own) return src;
    if (run.has('burn')) src.burnDps = dmg * RELIC.burnPct;
    if (run.has('corrode')) src.corrode = true;
    return src;
  }

  /** 电击疗法：把这次伤害的 45% 传导给附近的 2 名敌人 */
  private shock(from: Enemy, dmg: number): void {
    const w = this.w;
    const pts: number[] = [];
    const used = new Set<number>([from.id]);
    for (let i = 0; i < RELIC.shockTargets; i++) {
      const o = w.enemies.nearest(from.x, from.y, RELIC.shockRange, (x) => used.has(x.id));
      if (!o) break;
      used.add(o.id);
      pts.push(from.x, from.y, o.x, o.y);
      o.flash = 0.1;
      w.enemies.damage(o, dmg * RELIC.shockPct, null, '#9ab8ff');
    }
    if (pts.length) w.fx.arcs(pts);
  }

  private chain(from: Enemy, dmg: number, jumps: number, ghost: boolean): void {
    const w = this.w;
    const pts: number[] = [];
    const visited = new Set<number>([from.id]);
    let cur = from;
    let d = dmg;
    for (let i = 0; i < jumps; i++) {
      const nx = w.enemies.nearest(cur.x, cur.y, 7, (e) => visited.has(e.id));
      if (!nx) break;
      d *= 0.8;
      pts.push(cur.x, cur.y, nx.x, nx.y);
      visited.add(nx.id);
      if (!ghost) w.enemies.damage(nx, d, null);
      nx.flash = 0.12;
      cur = nx;
    }
    if (pts.length) { w.fx.arcs(pts); w.fx.sound('zap', from.x, from.y, 0.4); }
  }

  private doSplit(p: Proj): void {
    p.dead = true;
    const base = Math.atan2(p.vy, p.vx);
    for (let i = 0; i < 6; i++) {
      const a = base + ((i - 2.5) / 6) * 1.6 + globalRng.range(-0.1, 0.1);
      const q = this.alloc();
      Object.assign(q, {
        dead: false, kind: 'bullet', def: p.def, x: p.x, y: p.y, px: p.x, py: p.y,
        vx: Math.cos(a) * 24, vy: Math.sin(a) * 24, dmg: p.dmg * 0.4, r: Math.max(0.08, p.r * 0.6), area: 0,
        age: 0, life: 1, traveled: 0, maxDist: 8, pierce: 0, wallBounce: 0, enemyBounce: 0,
        state: 0, color: p.color, scale: p.scale * 0.6, spin: 0, target: null, retarget: 0, fragment: true, z: 1.1,
        homing: false, blast: false, owner: p.owner, ghost: p.ghost, bounced: p.bounced, fancy: p.fancy, fuse: 0, kb: p.kb * 0.4, butter: false,
      });
      q.hits.length = 0;
      for (const id of p.hits) q.hits.push(id);
      q.hitP.length = 0;
      for (const id of p.hitP) q.hitP.push(id);
      this.list.push(q);
    }
    this.w.fx.sparks(p.x, p.y, p.color, 6, 4);
  }

  private toCloud(p: Proj): void {
    p.dead = true;
    this.hazards.push({ kind: 'toxic', dead: false, x: p.x, y: p.y, r: p.area, t: 0, dur: 4, atk: p.dmg, tick: 0, ghost: p.ghost, pullOnly: false });
    this.w.fx.sound('splat', p.x, p.y, 0.6);
  }

  private toVortex(p: Proj): void {
    p.dead = true;
    const r = Math.max(3, p.area * 2);
    this.hazards.push({ kind: 'vortex', dead: false, x: p.x, y: p.y, r, t: 0, dur: 3, atk: p.dmg, tick: 0, ghost: p.ghost, pullOnly: false });
    this.w.fx.sound('vortex', p.x, p.y, 0.8);
    // 非主机：吸引效果需要在主机上模拟
    if (!p.ghost && !this.w.isAuthority) this.w.net?.vortex(p.x, p.y, r, 3);
  }

  /** 主机：替其他玩家模拟奇点吸引 */
  addPullVortex(x: number, y: number, r: number, dur: number): void {
    this.hazards.push({ kind: 'vortex', dead: false, x, y, r, t: 0, dur, atk: 0, tick: 0, ghost: true, pullOnly: true });
  }

  explodeProj(p: Proj): void {
    if (p.dead) return;
    p.dead = true;
    const r = p.area;
    this.explode(p.x, p.y, r, p.dmg, p.color, 5 + r + p.kb, p.ghost ? null : this.relicSrc(p.dmg, !p.relic), p.ghost);
    this.w.fx.sound(r > 3.2 ? 'explosion' : 'smallExplosion', p.x, p.y, 1);
  }

  /** 爆炸友伤：玩家在爆炸范围内（包括自己的爆炸）受到伤害，中心为 5%，随距离衰减到边缘的 1%（自定） */
  private ffBlast(x: number, y: number, r: number, dmg: number): void {
    if (!this.localIn(x, y, r)) return;
    const pl = this.w.player;
    const k = Math.max(0.2, 1 - Math.hypot(pl.x - x, pl.y - y) / Math.max(0.5, r + pl.r));
    (globalThis as any).__ff?.('blast' + (r <= 2.01 ? '-module' : ''), dmg * k);
    this.w.friendlyFire(dmg * k, x, y);
  }

  /** 范围爆炸：对范围内的所有敌人造成伤害并击退 */
  explode(x: number, y: number, r: number, dmg: number, color: number, knock: number, src: DmgSrc | null, ghost = false): void {
    const w = this.w;
    if (!ghost) {
      w.quests.onShot(x, y, r);
      w.enemies.hash.queryRadius(x, y, r + MAX_ENEMY_R, (e, d2) => {
        const rr = r + e.r;
        if (d2 > rr * rr) return;
        const d = Math.sqrt(d2) || 0.01;
        w.enemies.applyKnock(e, (e.x - x) / d, (e.y - y) / d, knock);
        w.enemies.damage(e, dmg, src);
      });
    }
    w.fx.explosion(x, y, r, color);
    w.fx.decal(x, y, 0x101010, r * 1.1);
    if (r >= 2.5) w.fx.shake(Math.min(1, 0.15 + r * 0.06));
    this.pushThrown(x, y, r, knock);
    this.ffBlast(x, y, r, dmg);
    // 玩家被冲击波推开
    const pl = w.player;
    const dpx = pl.x - x, dpy = pl.y - y;
    const dp = Math.hypot(dpx, dpy);
    if (dp < r + 1 && dp > 0.01 && w.localTargetable()) { pl.kx += (dpx / dp) * 3; pl.ky += (dpy / dp) * 3; }
  }
}

