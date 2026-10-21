// 区域任务（第4.1次调整）。
// - 第一 ~ 第四区各有一项区域任务，从 5 种任务里按本局种子随机抽取 4 种，不会重复；
//   任务在离开安全屋（第一区为开局）时发布。
// - 完成任务后，下一个区域会在随机位置出现一个奇物宝箱（第四区的任务完成后出现在尸王广场）。
// - 联机时任务进度由房主结算并同步（随流程信息每 0.1 秒发送一次）：
//   非房主点燃火堆、踢动物资球时先在本地生效，再交给房主；净化瘴气每个人都在本地按所有玩家的位置计算，
//   是否完成以房主为准。
// 第4.2次调整：信号区域扩大 1 倍；瘴气改为单人 50% / 多人 80%；多人时要点燃全部火堆；区域报幕结束后再报幕一次任务；
// 击杀异变体的进度条实时显示异变体已损失的生命。

import { CHEST_HP, ENEMY_TYPES, EnemyType } from '../config';
import { fmtNum } from '../util/math';
import { globalRng, Rng } from '../util/rng';
import { NavGrid } from '../world/navgrid';
import { Obstacle, ZoneLayout } from '../world/zone';
import type { Enemy } from './enemies';
import type { World } from './world';

export type QuestId = 'signal' | 'pyre' | 'mutant' | 'cargo' | 'miasma';
export const QUEST_IDS: QuestId[] = ['signal', 'pyre', 'mutant', 'cargo', 'miasma'];

/** 任务数值（未在调整文档中规定的为自定） */
export const QUEST = {
  signalR: 11, // 信号区域半径（第4.2次调整：5.5 → 11）；接近完成时缩小到 2/3
  signalTime: 20, // 单人需要停留的秒数，2 人及以上 ×2
  signalDecay: 0.75, // 区域里没人时进度回退的速度
  pyres: 7,
  pyreNeed: 6, // 单人；2 人及以上需要点燃全部（第4.2次调整）
  pyreHalf: 0.75, // 可燃物堆的半边长（自定）
  pyreH: 1.3,
  balls: 3,
  ballR: 0.85, // 物资球半径（自定）
  dropR: 3.4, // 运载点半径（自定）
  miasmaR: 3.36, // 净化半径（第4.3次调整：4.2 → 3.36，缩小 20%）
  miasmaNeed: [0.5, 0.8], // 单人 / 2 人及以上（第4.2次调整：33% / 67% → 50% / 80%）
  /** 离开安全屋多少秒后显示目标的方向箭头（找到之后也会显示） */
  arrow: { signal: 45, mutant: 45, cargo: 30, chest: 75 },
  foundDist: 18, // 走到这么近算“找到”（自定）
  bannerDelay: 3.3, // 区域报幕（3.2 秒）结束后再报幕任务
};

export const QUEST_INFO: Record<QuestId, { name: string; desc: string; color: string }> = {
  signal: { name: '发送信号', color: '#4affe0', desc: '在信号区域里停留，直到信号发送完毕。几个人一起站在里面进度更快；区域里没人时进度会慢慢回退。' },
  pyre: { name: '点燃火堆', color: '#ff8a2a', desc: '区域里散落着 7 个插着红旗的可燃物堆，用子弹或爆炸点燃其中 6 个；2 人及以上需要全部点燃。' },
  mutant: { name: '击杀异变体', color: '#ff7aff', desc: '区域里出现了一只带有虹彩光芒的异变体：生命值是同类的 24 倍，攻击力是 4 倍，移动较慢，而且不会消失。找到并击杀它。' },
  cargo: { name: '运送物资', color: '#ffd24a', desc: '区域里有 3 个物资球，碰到物资球就能推着它走，撞到墙会反弹。把任意 1 个推进运载点即可完成。' },
  miasma: { name: '清除瘴气', color: '#7aff5a', desc: '主要道路被深绿色的瘴气污染了。走过道路就能净化身边的地面，净化 50% 的道路（2 人及以上为 80%）即可完成。' },
};

/** 本局 4 个区域的任务：由种子决定，所有玩家一致 */
export function questOrder(seed: number): QuestId[] {
  const rng = new Rng((seed ^ 0x51ed270b) >>> 0);
  return rng.shuffle(QUEST_IDS.slice()).slice(0, 4);
}

export interface Pyre { x: number; y: number; lit: boolean; seen: boolean; litT: number }
export interface Ball {
  x: number; y: number; vx: number; vy: number; done: boolean;
  kickT: number; // 本地刚踢过（联机时暂时以本地为准）
  sendT: number;
  sx: number; sy: number; svx: number; svy: number; stime: number; // 房主同步的状态
  spin: number;
}
export interface Miasma {
  x0: number; y0: number; w: number; h: number;
  cells: Uint8Array; // 0 不是道路 / 1 被污染 / 2 已净化
  total: number;
  clean: number;
  changed: boolean;
}

interface Spot { x: number; y: number }

const tmpP = { x: 0, y: 0 };

export class Quests {
  readonly order: QuestId[];
  id: QuestId | null = null;
  zone = 0;
  done = false;
  /** 任务完成后经过的时间（第4.3次调整：运送物资完成后的消失动效） */
  doneT = 0;
  /** 上一个区域的任务已完成：本区会出现奇物宝箱 */
  chestZone = false;
  progress = 0; // 发送信号：已累积的秒数
  sig = { x: 0, y: 0, r: QUEST.signalR, inside: 0 };
  pyres: Pyre[] = [];
  balls: Ball[] = [];
  drop = { x: 0, y: 0, r: QUEST.dropR };
  mz: Miasma | null = null;
  /** 本地：是否已经找到过目标（方向箭头） */
  found = { signal: false, mutant: false, cargo: false, chest: false };
  /** 联机：房主同步的瘴气净化进度（非房主显示用） */
  private netClean = -1;
  /** 任务报幕倒计时（区域报幕结束后） */
  private bannerT = -1;

  constructor(private w: World, seed: number) {
    this.order = questOrder(seed);
  }

  /** 生成区域时调用（在构建碰撞与导航之前）：放置任务物件；可燃物堆会作为障碍物加入地图 */
  setup(L: ZoneLayout): void {
    this.chestZone = this.done && L.index >= 2 && L.index <= 5;
    this.zone = L.index;
    this.id = L.index <= 4 ? this.order[L.index - 1] ?? null : null;
    this.done = false;
    this.doneT = 0;
    this.progress = 0;
    this.pyres = [];
    this.balls = [];
    this.mz = null;
    this.netClean = -1;
    this.found = { signal: false, mutant: false, cargo: false, chest: false };
    if (!this.id) return;
    const rng = new Rng((L.seed ^ 0x2c1b3c6d) >>> 0);
    const nav = new NavGrid(L);
    const d = L.prevRoom?.exitDoor;
    const seedPt = d ? { x: (d.x0 + d.x1) / 2, y: d.y1 + 2.5 } : L.startPos;
    nav.computeFlow(seedPt.x, seedPt.y);
    switch (this.id) {
      case 'signal': {
        // 圈很大，街区里很难找到完全空旷的地方：依次放宽空旷程度的要求
        let s: Spot | null = null;
        for (const minFree of [0.8, 0.65, 0.5, 0]) {
          s = this.pickSpot(L, nav, rng, { clear: QUEST.signalR, minStart: 34, avoid: [], best: true, minFree });
          if (s) break;
        }
        if (s) { this.sig.x = s.x; this.sig.y = s.y; }
        this.sig.r = QUEST.signalR;
        break;
      }
      case 'pyre': {
        const avoid: { x: number; y: number; d: number }[] = [];
        for (let i = 0; i < QUEST.pyres; i++) {
          let s = this.pickSpot(L, nav, rng, { clear: 1.7, minStart: 14, avoid, best: false, minFree: 1 });
          if (!s) s = this.pickSpot(L, nav, rng, { clear: 1.4, minStart: 10, avoid: avoid.map((a) => ({ ...a, d: 9 })), best: false, minFree: 0.95 });
          if (!s) continue;
          avoid.push({ x: s.x, y: s.y, d: 18 });
          this.pyres.push({ x: s.x, y: s.y, lit: false, seen: false, litT: 0 });
          const h = QUEST.pyreHalf;
          const ob: Obstacle = { id: 900000 + L.index * 100 + i, x0: s.x - h, y0: s.y - h, x1: s.x + h, y1: s.y + h, h: QUEST.pyreH, kind: 'pyre', variant: i };
          L.obstacles.push(ob);
        }
        break;
      }
      case 'cargo': {
        const dp = this.pickSpot(L, nav, rng, { clear: QUEST.dropR + 0.6, minStart: 30, avoid: [], best: true });
        if (dp) { this.drop.x = dp.x; this.drop.y = dp.y; }
        const avoid = [{ x: this.drop.x, y: this.drop.y, d: 30 }];
        for (let i = 0; i < QUEST.balls; i++) {
          let s = this.pickSpot(L, nav, rng, { clear: 1.8, minStart: 10, avoid, best: false, minFree: 1 });
          if (!s) s = this.pickSpot(L, nav, rng, { clear: 1.4, minStart: 6, avoid: avoid.map((a) => ({ ...a, d: a.d * 0.6 })), best: false, minFree: 0.9 });
          if (!s) continue;
          avoid.push({ x: s.x, y: s.y, d: 14 });
          this.balls.push({ x: s.x, y: s.y, vx: 0, vy: 0, done: false, kickT: 0, sendT: 0, sx: s.x, sy: s.y, svx: 0, svy: 0, stime: -1, spin: 0 });
        }
        break;
      }
      case 'miasma': this.mz = buildMiasma(L, nav); break;
      case 'mutant': break;
    }
  }

  /** 在地图上找一个可以到达的空旷位置 */
  private pickSpot(L: ZoneLayout, nav: NavGrid, rng: Rng, o: { clear: number; minStart: number; avoid: { x: number; y: number; d: number }[]; best: boolean; minFree?: number }): Spot | null {
    const r = L.rect;
    const d = L.prevRoom?.exitDoor;
    const st = d ? { x: (d.x0 + d.x1) / 2, y: d.y1 } : L.startPos;
    const minFree = o.minFree ?? 0.86;
    let best: Spot | null = null, bestScore = -1;
    let found = 0;
    for (let i = 0; i < 900; i++) {
      const x = rng.range(r.x0 + o.clear + 1, r.x1 - o.clear - 1), y = rng.range(r.y0 + o.clear + 1, r.y1 - o.clear - 1);
      if (!nav.reachable(x, y)) continue;
      // 中心附近一定是空地（放宽空旷程度的要求时也不会贴着障碍物）
      if (!nav.isFree(x + 1, y) || !nav.isFree(x - 1, y) || !nav.isFree(x, y + 1) || !nav.isFree(x, y - 1)) continue;
      if (Math.hypot(x - st.x, y - st.y) < o.minStart) continue;
      if (L.safeRoom && x > L.safeRoom.rect.x0 - 6 && x < L.safeRoom.rect.x1 + 6 && y > L.safeRoom.rect.y0 - 8) continue;
      if (o.avoid.some((a) => Math.hypot(a.x - x, a.y - y) < a.d)) continue;
      const free = freeFrac(nav, x, y, o.clear);
      if (free < minFree) continue;
      if (!o.best) return { x, y };
      const score = free + rng.next() * 0.02;
      if (score > bestScore) { bestScore = score; best = { x, y }; }
      if (++found >= 60 || free >= 0.999) break;
    }
    return best;
  }

  /** 离开安全屋（第一区为开局）：发布任务；房主生成异变体与奇物宝箱 */
  begin(): void {
    const w = this.w;
    // 区域报幕结束后，再报幕一次区域任务（见 update）
    this.bannerT = this.id ? QUEST.bannerDelay : -1;
    if (this.chestZone) w.fx.toast(this.zone >= 5 ? '尸王广场里出现了奇物宝箱' : '这个区域里出现了奇物宝箱', '#ffd24a');
    if (!w.isAuthority) return;
    const L = w.layout;
    if (this.id === 'mutant') {
      const s = this.hostSpot(40);
      if (s) {
        const types = ENEMY_TYPES.filter((t) => t !== 'creeper' && L.cfg.weights[t] > 0);
        const type = globalRng.weighted(types.map((t) => [t, L.cfg.weights[t]] as const)) as EnemyType;
        const e = w.enemies.spawn(type, s.x, s.y, w.enemies.rollElite());
        w.enemies.makeMutant(e);
      }
    }
    if (this.chestZone) {
      const s = this.hostSpot(L.isBoss ? 16 : 34);
      if (s) w.enemies.spawnChest(s.x, s.y, CHEST_HP[Math.min(5, this.zone)]);
    }
  }

  /** 房主：随机找一个可以到达、离起点足够远的位置 */
  private hostSpot(minStart: number): Spot | null {
    const w = this.w, L = w.layout, r = L.rect;
    const sp = L.startPos;
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 600; i++) {
        const x = globalRng.range(r.x0 + 3, r.x1 - 3), y = globalRng.range(r.y0 + 3, r.y1 - 3);
        if (!w.nav.reachable(x, y) || w.col.overlapsCircle(x, y, 1.2)) continue;
        if (Math.hypot(x - sp.x, y - sp.y) < minStart * (k ? 0.5 : 1)) continue;
        if (L.safeRoom && x > L.safeRoom.rect.x0 - 4 && x < L.safeRoom.rect.x1 + 4 && y > L.safeRoom.rect.y0 - 6) continue;
        if (L.bossSpawn && Math.hypot(x - L.bossSpawn.x, y - L.bossSpawn.y) < 8) continue;
        return { x, y };
      }
    }
    return null;
  }

  // —— 查询 ——

  mutant(): Enemy | null {
    for (const e of this.w.enemies.list) if (!e.dead && e.mutant) return e;
    return null;
  }

  chest(): Enemy | null {
    for (const e of this.w.enemies.list) if (!e.dead && e.type === 'chest') return e;
    return null;
  }

  /** 发送信号需要的秒数（2 人及以上翻倍） */
  signalNeed(): number {
    return QUEST.signalTime * (this.players() >= 2 ? 2 : 1);
  }

  miasmaNeed(): number {
    return QUEST.miasmaNeed[this.players() >= 2 ? 1 : 0];
  }

  /** 需要点燃的火堆数：单人 6 个，2 人及以上全部 */
  pyreNeed(): number {
    return this.players() >= 2 ? this.pyres.length : Math.min(QUEST.pyreNeed, this.pyres.length);
  }

  /** 任务报幕的副标题 */
  brief(): string {
    switch (this.id) {
      case 'signal': return `在信号区域里停留 ${this.signalNeed()} 秒`;
      case 'pyre': return `用子弹点燃 ${this.pyreNeed()} 个可燃物堆`;
      case 'mutant': return '找到并击杀带有虹彩光芒的异变体';
      case 'cargo': return '把任意 1 个物资球推进运载点';
      case 'miasma': return `净化 ${Math.round(this.miasmaNeed() * 100)}% 被瘴气污染的道路`;
      default: return '';
    }
  }

  private players(): number {
    return this.w.net ? this.w.net.aliveCount() : 1;
  }

  litCount(): number {
    let n = 0;
    for (const p of this.pyres) if (p.lit) n++;
    return n;
  }

  miasmaFrac(): number {
    const m = this.mz;
    if (!m || !m.total) return 0;
    if (this.netClean >= 0 && !this.w.isAuthority) return Math.max(this.netClean, m.clean / m.total);
    return m.clean / m.total;
  }

  /** HUD：任务名称、说明、进度 */
  hud(): { name: string; color: string; text: string; frac: number; done: boolean } | null {
    if (!this.id) return null;
    const q = QUEST_INFO[this.id];
    let text = '', frac = 0;
    switch (this.id) {
      case 'signal': { const need = this.signalNeed(); frac = this.progress / need; text = `信号 ${Math.floor(Math.min(need, this.progress))} / ${need} 秒`; break; }
      case 'pyre': frac = this.litCount() / this.pyreNeed(); text = `已点燃 ${this.litCount()} / ${this.pyreNeed()}`; break;
      case 'mutant': {
        // 第4.2次调整：进度条实时显示异变体已损失的生命
        const m = this.mutant();
        if (m) { frac = 1 - Math.max(0, m.hp) / Math.max(1, m.maxHp); text = `异变体生命 ${fmtNum(Math.max(0, Math.ceil(m.hp)))} / ${fmtNum(Math.round(m.maxHp))}`; }
        else { frac = this.done ? 1 : 0; text = this.done ? '异变体已被击杀' : '寻找异变体'; }
        break;
      }
      case 'cargo': frac = this.done ? 1 : 0; text = this.done ? '物资已送达' : '把物资球推进运载点'; break;
      case 'miasma': { const need = this.miasmaNeed(); frac = this.miasmaFrac() / need; text = `已净化 ${Math.floor(this.miasmaFrac() * 100)}% / ${Math.round(need * 100)}%`; break; }
    }
    if (this.done) { frac = 1; text = '已完成'; }
    return { name: q.name, color: q.color, text, frac: Math.max(0, Math.min(1, frac)), done: this.done };
  }

  /** 方向箭头：离开安全屋一段时间后，或者找到过目标后显示 */
  arrows(): { x: number; y: number; color: string; label: string }[] {
    const w = this.w;
    const out: { x: number; y: number; color: string; label: string }[] = [];
    if (!w.phaseActive()) return out;
    const t = w.zoneTime;
    const A = QUEST.arrow;
    if (!this.done) {
      if (this.id === 'signal' && (this.found.signal || t >= A.signal)) out.push({ x: this.sig.x, y: this.sig.y, color: '#4affe0', label: '信号区域' });
      if (this.id === 'cargo' && (this.found.cargo || t >= A.cargo)) out.push({ x: this.drop.x, y: this.drop.y, color: '#ffd24a', label: '运载点' });
      if (this.id === 'mutant' && (this.found.mutant || t >= A.mutant)) { const m = this.mutant(); if (m) out.push({ x: m.x, y: m.y, color: '#ff7aff', label: '异变体' }); }
    }
    const c = this.chest();
    if (c && (this.found.chest || t >= A.chest)) out.push({ x: c.x, y: c.y, color: '#ffd24a', label: '奇物宝箱' });
    return out;
  }

  // —— 每帧 ——

  update(dt: number): void {
    if (this.done) this.doneT += dt;
    const w = this.w;
    if (!w.zoneStarted || !w.phaseActive()) return;
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0 && this.id) {
        const q = QUEST_INFO[this.id];
        w.fx.banner(`区域任务：${q.name}`, this.brief(), q.color);
        w.fx.sound('beep');
      }
    }
    const v = w.view;
    const near = (x: number, y: number, r = QUEST.foundDist) => Math.hypot(x - v.x, y - v.y) < r;
    if (this.id === 'signal' && !this.found.signal && near(this.sig.x, this.sig.y, QUEST.foundDist + this.sig.r)) this.found.signal = true;
    if (this.id === 'cargo' && !this.found.cargo && near(this.drop.x, this.drop.y)) this.found.cargo = true;
    if (this.id === 'mutant' && !this.found.mutant) { const m = this.mutant(); if (m && near(m.x, m.y)) this.found.mutant = true; }
    if (!this.found.chest) { const c = this.chest(); if (c && near(c.x, c.y)) this.found.chest = true; }
    for (const p of this.pyres) {
      if (!p.seen && near(p.x, p.y, 22)) p.seen = true;
      if (p.lit) p.litT += dt;
    }
    if (this.id === 'miasma') this.updateMiasma();
    if (this.id === 'cargo') this.updateBalls(dt);
    if (this.done || !w.isAuthority) {
      if (this.id === 'signal') this.sig.r = QUEST.signalR * (1 - Math.min(1, this.progress / this.signalNeed()) / 3);
      return;
    }
    // —— 房主结算 ——
    switch (this.id) {
      case 'signal': {
        let inside = 0;
        for (const s of this.standing()) if (Math.hypot(s.x - this.sig.x, s.y - this.sig.y) < this.sig.r) inside++;
        this.sig.inside = inside;
        const need = this.signalNeed();
        // 多名玩家同时在区域里时进度成倍累积；没人时以 75% 的速度回退
        this.progress = Math.max(0, Math.min(need, this.progress + (inside > 0 ? inside * dt : -QUEST.signalDecay * dt)));
        this.sig.r = QUEST.signalR * (1 - (this.progress / need) / 3);
        if (this.progress >= need) this.complete();
        break;
      }
      case 'pyre': if (this.litCount() >= this.pyreNeed()) this.complete(); break;
      case 'miasma': if (this.miasmaFrac() >= this.miasmaNeed()) this.complete(); break;
    }
  }

  private standing(): { x: number; y: number }[] {
    const w = this.w;
    const out: { x: number; y: number }[] = [];
    if (w.player.standing) out.push(w.player);
    if (w.net) for (const r of w.net.remotes()) if (!r.dead && !r.downed && !r.arrived) out.push(r);
    return out;
  }

  /** 房主：任务完成 */
  private complete(): void {
    if (this.done) return;
    this.done = true;
    const w = this.w;
    const next = this.zone >= 4 ? '尸王广场里将会出现奇物宝箱' : '下一个区域将会出现奇物宝箱';
    w.fxAll('banner', '区域任务完成', next, '#ffd24a');
    w.fxAll('sound', 'altar', w.view.x, w.view.y, 1);
  }

  // —— 点燃火堆 ——

  /** 子弹 / 爆炸碰到了可燃物堆 */
  onShot(x: number, y: number, r: number): void {
    if (this.id !== 'pyre' || this.done || !this.w.phaseActive()) return;
    const h = QUEST.pyreHalf + 0.35 + r;
    for (let i = 0; i < this.pyres.length; i++) {
      const p = this.pyres[i];
      if (p.lit || Math.abs(x - p.x) > h || Math.abs(y - p.y) > h) continue;
      this.ignite(i, true);
    }
  }

  ignite(i: number, local: boolean): void {
    const w = this.w;
    const p = this.pyres[i];
    if (!p || p.lit) return;
    p.lit = true;
    p.litT = 0;
    w.fx.sound('explosion', p.x, p.y, 0.4);
    w.fx.sparks(p.x, p.y, 0xff8a2a, 16, 5);
    if (local && w.net && !w.isAuthority) { w.net.questIgnite(i); return; }
    w.fxAll('toast', `点燃了可燃物堆（${this.litCount()} / ${this.pyreNeed()}）`, '#ff8a2a');
  }

  // —— 运送物资 ——

  private updateBalls(dt: number): void {
    // 第4.3次调整：送达之后，运载点与剩下的物资球消失，不能再推动
    if (this.done) return;
    const w = this.w;
    const p = w.player;
    const host = w.isAuthority;
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (b.done) continue;
      if (b.kickT > 0) b.kickT -= dt;
      if (b.sendT > 0) b.sendT -= dt;
      // 非房主：没在踢球时向房主同步的位置靠拢
      if (!host && b.kickT <= 0 && b.stime >= 0) {
        const age = Math.min(0.3, Math.max(0, w.time - b.stime));
        const tx = b.sx + b.svx * age, ty = b.sy + b.svy * age;
        if (Math.hypot(tx - b.x, ty - b.y) > 4) { b.x = tx; b.y = ty; }
        else { const k = Math.min(1, dt * 10); b.x += (tx - b.x) * k; b.y += (ty - b.y) * k; }
        b.vx = b.svx; b.vy = b.svy;
      }
      // 本地玩家碰到物资球：推着它走
      if (p.standing && !w.arrived) {
        const dx = b.x - p.x, dy = b.y - p.y;
        const d = Math.hypot(dx, dy);
        const rr = QUEST.ballR + p.r;
        if (d < rr && d > 1e-4) {
          const nx = dx / d, ny = dy / d;
          b.x = p.x + nx * rr; b.y = p.y + ny * rr;
          const pv = (p.vx + p.kx + p.dashX) * nx + (p.vy + p.ky + p.dashY) * ny;
          const bv = b.vx * nx + b.vy * ny;
          const want = Math.max(pv * 1.55, 3.2);
          if (bv < want) { b.vx += nx * (want - bv); b.vy += ny * (want - bv); }
          b.kickT = 0.4;
          if (!host && w.net && b.sendT <= 0) { b.sendT = 0.08; w.net.questKick(i, b.x, b.y, b.vx, b.vy); }
        }
      }
      if (host || b.kickT > 0) this.moveBall(b, dt);
      b.spin += Math.hypot(b.vx, b.vy) * dt / QUEST.ballR;
      if (host && Math.hypot(b.x - this.drop.x, b.y - this.drop.y) < this.drop.r - QUEST.ballR * 0.3) {
        b.done = true;
        w.fxAll('smoke', this.drop.x, this.drop.y, 12);
        this.complete();
      }
    }
  }

  /** 物资球的移动：摩擦减速，碰到墙和障碍物时反弹 */
  private moveBall(b: Ball, dt: number): void {
    const col = this.w.col;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 16) { b.vx *= 16 / sp; b.vy *= 16 / sp; }
    const k = Math.max(0, 1 - 1.1 * dt);
    b.vx *= k; b.vy *= k;
    const steps = Math.max(1, Math.ceil((sp * dt) / 0.3));
    for (let s = 0; s < steps; s++) {
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;
      if (col.resolveCircle(b.x, b.y, QUEST.ballR, tmpP)) {
        const nx = tmpP.x - b.x, ny = tmpP.y - b.y;
        const nl = Math.hypot(nx, ny) || 1;
        const ux = nx / nl, uy = ny / nl;
        const vn = b.vx * ux + b.vy * uy;
        if (vn < 0) { b.vx -= 1.75 * vn * ux; b.vy -= 1.75 * vn * uy; }
        b.x = tmpP.x; b.y = tmpP.y;
      }
    }
  }

  /** 房主：非房主踢动了物资球 */
  onKick(i: number, x: number, y: number, vx: number, vy: number): void {
    const b = this.balls[i];
    if (!b || b.done) return;
    b.x = x; b.y = y; b.vx = vx; b.vy = vy;
  }

  // —— 清除瘴气 ——

  private updateMiasma(): void {
    const m = this.mz;
    if (!m) return;
    for (const s of this.standing()) this.cleanAt(m, s.x, s.y);
  }

  private cleanAt(m: Miasma, x: number, y: number): void {
    const R = QUEST.miasmaR;
    const cx0 = Math.max(0, Math.floor(x - R - m.x0)), cx1 = Math.min(m.w - 1, Math.floor(x + R - m.x0));
    const cy0 = Math.max(0, Math.floor(y - R - m.y0)), cy1 = Math.min(m.h - 1, Math.floor(y + R - m.y0));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const i = cy * m.w + cx;
        if (m.cells[i] !== 1) continue;
        const dx = m.x0 + cx + 0.5 - x, dy = m.y0 + cy + 0.5 - y;
        if (dx * dx + dy * dy > R * R) continue;
        m.cells[i] = 2;
        m.clean++;
        m.changed = true;
      }
    }
  }

  // —— 宝箱、异变体 ——

  /** 房主：异变体被击杀 */
  onMutantKilled(e: Enemy): void {
    if (this.id !== 'mutant') return;
    this.w.fxAll('banner', '异变体倒下了', '', '#ff7aff');
    void e;
    this.complete();
  }

  /** 房主：奇物宝箱被打破，掉落奇物 */
  onChestBroken(e: Enemy): void {
    const w = this.w;
    w.pickups.dropThing({ uid: 0, kind: 'relic' }, e.x, e.y, true);
    w.fxAll('banner', '奇物宝箱被打破了', '捡起奇物，每个人都可以选择一个增益', '#ffd24a');
  }

  // —— 联机同步 ——

  netState(): unknown[] {
    const r2 = (v: number) => Math.round(v * 100) / 100;
    let lit = 0;
    this.pyres.forEach((p, i) => { if (p.lit) lit |= 1 << i; });
    const balls = this.balls.map((b) => [r2(b.x), r2(b.y), r2(b.vx), r2(b.vy), b.done ? 1 : 0]);
    const clean = this.mz && this.mz.total ? Math.round((this.mz.clean / this.mz.total) * 1000) / 1000 : 0;
    return [this.zone, this.done ? 1 : 0, r2(this.progress), lit, balls, clean];
  }

  applyNet(s: unknown[]): void {
    const w = this.w;
    if (!Array.isArray(s) || s[0] !== this.zone) return;
    this.done = !!s[1];
    this.progress = Number(s[2]) || 0;
    const lit = Number(s[3]) || 0;
    this.pyres.forEach((p, i) => { if (lit & (1 << i) && !p.lit) { p.lit = true; p.litT = 0; w.fx.sparks(p.x, p.y, 0xff8a2a, 12, 4); } });
    const balls = s[4] as number[][];
    if (Array.isArray(balls)) {
      balls.forEach((a, i) => {
        const b = this.balls[i];
        if (!b) return;
        b.sx = a[0]; b.sy = a[1]; b.svx = a[2]; b.svy = a[3]; b.stime = w.time;
        if (a[4] && !b.done) { b.done = true; b.x = a[0]; b.y = a[1]; }
      });
    }
    this.netClean = Number(s[5]) || 0;
  }
}

/** 空旷程度：以 (x, y) 为圆心、半径 r 的圆内可通行的比例 */
function freeFrac(nav: NavGrid, x: number, y: number, r: number): number {
  let n = 0, free = 0;
  for (let ring = 0; ring <= 3; ring++) {
    const rr = (r * ring) / 3;
    const k = ring === 0 ? 1 : 8 + ring * 6;
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2 + ring * 0.37;
      n++;
      if (nav.isFree(x + Math.cos(a) * rr, y + Math.sin(a) * rr)) free++;
    }
  }
  return free / n;
}

/** 瘴气：主要道路（宽度 ≥ 6 米的街道）上可以走到的地面 */
function buildMiasma(L: ZoneLayout, nav: NavGrid): Miasma {
  const r = L.rect;
  const x0 = Math.floor(r.x0), y0 = Math.floor(r.y0);
  const w = Math.ceil(r.x1) - x0, h = Math.ceil(r.y1) - y0;
  const cells = new Uint8Array(w * h);
  const main = L.streets.filter((s) => Math.min(s.x1 - s.x0, s.y1 - s.y0) >= 6);
  let total = 0;
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const x = x0 + cx + 0.5, y = y0 + cy + 0.5;
      if (!main.some((s) => x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1)) continue;
      // 可以走到的格子（导航网格已经避开了障碍物）
      if (!nav.reachable(x, y)) continue;
      cells[cy * w + cx] = 1;
      total++;
    }
  }
  return { x0, y0, w, h, cells, total, clean: 0, changed: true };
}
