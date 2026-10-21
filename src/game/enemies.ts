// 敌人：生成（个体生成 + 类型判别两层逻辑）、AI（全图流场追踪）、受伤与死亡。
// 第4.1次调整：
// - 联机时的碰撞伤害改为由被打的玩家本地判定（见 updateMirror），受伤后通知房主，房主再同步给所有人；
// - 奇物宝箱（type = 'chest'）也是一种“敌人”：不会移动和攻击，被打破后掉落奇物；
// - 异变体（区域任务）：普通丧尸的强化版，带有虹彩特效。

import {
  ENEMIES, ENEMY_SPEED_SCALE, ENEMY_TYPES, ELITE_MUL, EnemyType, enhanceCoef, DIFFICULTY, BOSS, MAMBA, CREEPER,
  COOP, COOP_BOSS_HP_MUL, COOP_COUNT_MUL, COOP_HP_MUL, MUTANT, CHEST_R, ZoneCfg, Difficulty,
} from '../config';
import { SpatialHash } from '../util/spatial';
import { clamp, damp, wrapAngle } from '../util/math';
import { globalRng } from '../util/rng';
import type { World } from './world';
import { randomBullet } from '../data/bullets';
import { ITEM_IDS, ITEMS } from '../data/items';
import { RELIC } from '../data/relics';
import { DMG_BURN, DMG_CORRODE, DMG_EXEC, DMG_GOLD, DMG_PRE, DMG_SLOW, Target } from './net';

/** 伤害来源附带的效果 */
export interface DmgSrc {
  gold?: boolean;
  burnDps?: number;
  slow?: boolean;
  corrode?: boolean; // 腐蚀疗法：3 秒内受到的伤害 +25%
  execute?: boolean; // 要害一击：第 3 次暴击直接击杀普通丧尸
  pre?: boolean; // 联机：伤害已经计算过腐蚀加成
}

/** 招财弹：每名玩家每个区域最多触发 4 次必定掉落道具（第4.1次调整） */
export const GOLD_DROP_MAX = 4;

/** 敌人的攻击力（房主与镜像端用同一个公式计算，镜像端用于本地判定碰撞伤害） */
export function enemyAtk(type: EnemyType, elite: number, cfg: ZoneCfg, diff: Difficulty, mutant: boolean): number {
  return ENEMIES[type].atk * cfg.dmgMul * ELITE_MUL[elite] * DIFFICULTY[diff].dmg * (mutant ? MUTANT.atk : 1);
}

export function creeperBoomDmg(elite: number, cfg: ZoneCfg, diff: Difficulty): number {
  return CREEPER.boom * cfg.dmgMul * ELITE_MUL[elite] * DIFFICULTY[diff].dmg;
}

export function creeperRadius(elite: number): number {
  return CREEPER.radius * (elite ? 1.15 : 1);
}

/** 要害一击可以直接击杀的“普通丧尸”：非精英、非异变体、非苦力怕、非 Boss、非宝箱 */
export function isNormalZombie(e: Enemy): boolean {
  return !e.elite && !e.mutant && (e.type === 'office' || e.type === 'iron' || e.type === 'runner' || e.type === 'spitter');
}

export interface Enemy {
  id: number;
  type: EnemyType | 'boss' | 'chest';
  dead: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kx: number;
  ky: number;
  r: number;
  mass: number;
  hp: number;
  maxHp: number;
  speed: number;
  atk: number;
  gold: number;
  elite: number;
  hitCd: number;
  flash: number;
  slowT: number;
  burnT: number;
  burnDps: number;
  burnTick: number;
  phase: number;
  face: number;
  spitCd: number;
  dmgAcc: number;
  dmgTimer: number;
  goldBonus: boolean;
  age: number;
  strafe: number;
  stuckT: number;
  lastX: number;
  lastY: number;
  recycle: boolean; // 远离后是否回收到玩家附近（区域初始生成的个体不回收）
  windup: number; // 接触玩家后的出手蓄力
  lastBy: number; // 最后一次伤害来自哪个玩家（金币归属）
  burnBy: number;
  // 联机镜像（非主机）：最近一次快照
  sx: number;
  sy: number;
  svx: number;
  svy: number;
  sface: number;
  stime: number;
  shp: number;
  predT: number; // 本地预判已死亡，等待主机确认的剩余时间
  stunT: number; // 第4次调整：晕眩（黄油）
  fuse: number; // 第4次调整：苦力怕的爆炸倒计时（< 0 表示未触发）
  fuseKill: boolean; // 苦力怕是被打死后才开始倒计时（决定金币）
  boom: number; // 苦力怕爆炸对玩家的伤害
  mutant: boolean; // 第4.1次调整：异变体
  corrodeT: number; // 第4.1次调整：腐蚀（受到的伤害 +25%，第4.3次调整）
  critN: number; // 第4.3次调整：被本地玩家暴击命中的次数（要害一击：普通丧尸 3 次直接击杀）
}

export const TYPE_CODE: (EnemyType | 'boss' | 'chest')[] = ['office', 'iron', 'runner', 'spitter', 'boss', 'creeper', 'chest'];

export interface EnemyShot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dmg: number;
  r: number;
  life: number;
  dead: boolean;
  kind: 'spit' | 'rock';
  hitPlayer?: boolean;
  // 抛物线（boss 丢石头）
  tx?: number;
  ty?: number;
  t?: number;
  dur?: number;
  sx?: number;
  sy?: number;
  aoe?: number;
}

const MAX_ENEMY_R = 1.6;
/** 第2版：吐口水丧尸的口水弹——弹速 9→6，弹丸半径 0.32→0.22，攻击距离 15→11 米 */
export const SPIT = { speed: 6, r: 0.22, life: 2.1, range: 11 };
const tmpV = { x: 0, y: 0 };
const tmpP = { x: 0, y: 0 };

export class Enemies {
  list: Enemy[] = [];
  pool: Enemy[] = [];
  shots: EnemyShot[] = [];
  hash = new SpatialHash<Enemy>(2);
  eliteCount = 0;
  spawnAcc = 0;
  private nextId = 1;
  nearCount = 0;
  groanT = 2;
  /** 非主机：id → 镜像敌人 */
  byId = new Map<number, Enemy>();
  private mirrorSeen = new Set<number>();
  /** 招财弹在本区已触发的次数（按玩家） */
  goldDrops = new Map<number, number>();
  /** 黑曜羽毛：累计造成伤害的次数 */
  private featherN = 0;
  private procing = false;
  /** “免疫”跳字的间隔（第4.3次调整：曼巴僵尸的耐久战） */
  private immuneT = 0;

  constructor(private w: World) {}

  /** 参与碰撞检测的敌人：跃起在空中的曼巴僵尸不会被子弹、爆炸与追踪命中（第4.3次调整） */
  private hashList(): Enemy[] {
    const b = this.w.boss;
    if (!b || !b.airborne()) return this.list;
    return this.list.filter((x) => x !== b.e);
  }

  reset(): void {
    for (const e of this.list) this.pool.push(e);
    this.list = [];
    this.byId.clear();
    this.shots = [];
    this.eliteCount = 0;
    this.spawnAcc = 0;
    this.goldDrops.clear();
    const b = this.w.layout.bounds;
    this.hash.setBounds(b.x0, b.y0, b.x1, b.y1);
  }

  private alloc(): Enemy {
    const e = this.pool.pop();
    if (e) return e;
    return {
      id: 0, type: 'office', dead: false, x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, r: 0.4, mass: 1, hp: 1, maxHp: 1,
      speed: 1, atk: 1, gold: 1, elite: 0, hitCd: 0, flash: 0, slowT: 0, burnT: 0, burnDps: 0, burnTick: 0, phase: 0,
      face: 0, spitCd: 0, dmgAcc: 0, dmgTimer: 0, goldBonus: false, age: 0, strafe: 1, stuckT: 0, lastX: 0, lastY: 0, recycle: true, windup: 0,
      lastBy: 0, burnBy: 0, sx: 0, sy: 0, svx: 0, svy: 0, sface: 0, stime: 0, shp: 1, predT: 0,
      stunT: 0, fuse: -1, fuseKill: false, boom: 0, mutant: false, corrodeT: 0, critN: 0,
    };
  }

  /** 联机人数倍率（存活玩家数） */
  private coopN(): number {
    return Math.max(1, Math.min(4, this.w.net ? this.w.net.aliveCount() : 1));
  }

  /** 类型判别：临近降重——生成点附近每有一个同类，该类权重 ×0.72 */
  pickType(x: number, y: number, ignoreNeighbors: boolean): EnemyType {
    const cfg = this.w.layout.cfg;
    const counts: Record<EnemyType, number> = { office: 0, iron: 0, runner: 0, spitter: 0, creeper: 0 };
    if (!ignoreNeighbors) {
      this.hash.queryRadius(x, y, 12, (e) => {
        if (e.type !== 'boss' && e.type !== 'chest') counts[e.type]++;
      });
    }
    const entries = ENEMY_TYPES.map((t) => [t, cfg.weights[t] * Math.pow(0.72, counts[t])] as const);
    return globalRng.weighted(entries);
  }

  rollElite(): number {
    const [y, o, r] = this.w.layout.cfg.elite;
    const v = globalRng.next();
    if (v < r) return 3;
    if (v < r + o) return 2;
    if (v < r + o + y) return 1;
    return 0;
  }

  forcedEliteTier(): number {
    const [y, o, r] = this.w.layout.cfg.elite;
    return globalRng.weighted([[1, y], [2, o], [3, r]] as const);
  }

  spawn(type: EnemyType, x: number, y: number, elite: number): Enemy {
    const w = this.w;
    const cfg = w.layout.cfg;
    const def = ENEMIES[type];
    const diff = DIFFICULTY[w.run.difficulty];
    const coef = enhanceCoef(w.run.rad);
    const e = this.alloc();
    e.id = this.nextId++;
    e.type = type;
    e.dead = false;
    e.x = x; e.y = y; e.vx = 0; e.vy = 0; e.kx = 0; e.ky = 0;
    e.elite = elite;
    e.r = def.radius * (elite ? 1.12 : 1);
    e.mass = def.mass * (elite ? 1.3 : 1);
    // 生命值 = 基础 * 区域倍率区间随机 * 强化系数（第2版：联机时再乘以存活玩家数倍率）
    e.maxHp = def.hp * globalRng.range(cfg.hpMul[0], cfg.hpMul[1]) * coef * diff.hp * COOP_HP_MUL[this.coopN()];
    e.hp = e.maxHp;
    e.speed = def.speed * ENEMY_SPEED_SCALE * coef * globalRng.range(0.92, 1.08);
    e.atk = enemyAtk(type, elite, cfg, w.run.difficulty, false);
    // 金币基础值 × 变异倍率；第3次调整：不再乘以区域值，改为在死亡时乘以当时的强化系数（见 deathFx）
    e.gold = def.gold * ELITE_MUL[elite];
    e.hitCd = 0.3; e.flash = 0; e.slowT = 0; e.burnT = 0; e.burnDps = 0; e.burnTick = 0;
    e.phase = globalRng.range(0, 6.28);
    e.face = globalRng.range(-3.14, 3.14);
    e.spitCd = globalRng.range(1, 3);
    e.dmgAcc = 0; e.dmgTimer = 0; e.goldBonus = false; e.age = 0;
    e.strafe = globalRng.sign();
    e.stuckT = 0; e.lastX = x; e.lastY = y;
    e.recycle = true;
    e.windup = 0;
    e.lastBy = this.w.myId; e.burnBy = this.w.myId; e.predT = 0;
    e.stunT = 0; e.fuse = -1; e.fuseKill = false;
    e.boom = creeperBoomDmg(elite, cfg, w.run.difficulty);
    e.mutant = false; e.corrodeT = 0; e.critN = 0;
    if (elite) this.eliteCount++;
    this.list.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  /** 异变体（第4.1次调整）：生命 ×24、攻击 ×4（与其他加成叠加）、移速 ×0.8，不会被回收 */
  makeMutant(e: Enemy): void {
    e.mutant = true;
    e.maxHp *= MUTANT.hp;
    e.hp = e.maxHp;
    e.atk *= MUTANT.atk;
    e.speed *= MUTANT.speed;
    e.gold *= MUTANT.gold;
    e.recycle = false;
  }

  /** 奇物宝箱（第4.1次调整）：不会移动和攻击，被打破后掉落奇物 */
  spawnChest(x: number, y: number, hp: number): Enemy {
    const e = this.alloc();
    e.id = this.nextId++;
    e.type = 'chest';
    e.dead = false;
    e.x = x; e.y = y; e.vx = 0; e.vy = 0; e.kx = 0; e.ky = 0;
    e.elite = 0; e.r = CHEST_R; e.mass = 999;
    e.maxHp = hp; e.hp = hp; e.speed = 0; e.atk = 0; e.gold = 0;
    e.hitCd = 0; e.flash = 0; e.slowT = 0; e.burnT = 0; e.burnDps = 0; e.burnTick = 0;
    e.phase = 0; e.face = 0; e.spitCd = 0; e.dmgAcc = 0; e.dmgTimer = 0; e.goldBonus = false; e.age = 0;
    e.strafe = 1; e.stuckT = 0; e.lastX = x; e.lastY = y; e.recycle = false; e.windup = 0;
    e.lastBy = this.w.myId; e.burnBy = this.w.myId; e.predT = 0;
    e.stunT = 0; e.fuse = -1; e.fuseKill = false; e.boom = 0; e.mutant = false; e.corrodeT = 0; e.critN = 0;
    this.list.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  /** kind：laoda = 牢大丧尸（第五区），mamba = 曼巴僵尸（第六区） */
  spawnBoss(x: number, y: number, kind: 'laoda' | 'mamba' = 'laoda'): Enemy {
    const e = this.alloc();
    const diff = DIFFICULTY[this.w.run.difficulty];
    const coop = COOP_BOSS_HP_MUL[this.coopN()];
    e.id = this.nextId++;
    e.type = 'boss';
    e.dead = false;
    e.x = x; e.y = y; e.vx = 0; e.vy = 0; e.kx = 0; e.ky = 0;
    e.elite = 0;
    if (kind === 'mamba') {
      e.r = MAMBA.radius;
      e.mass = 60;
      e.maxHp = MAMBA.hp * diff.hp * coop;
      e.speed = MAMBA.speed;
      e.atk = MAMBA.atk * diff.dmg;
    } else {
      // 第3次调整：每个阶段 24000 生命（4 个阶段）
      e.r = BOSS.radius;
      e.mass = 40;
      e.maxHp = BOSS.hpPerPhase * BOSS.phases * diff.hp * coop;
      e.speed = BOSS.speed;
      e.atk = BOSS.atk * diff.dmg;
    }
    e.hp = e.maxHp;
    e.gold = 0;
    e.hitCd = 0; e.flash = 0; e.slowT = 0; e.burnT = 0; e.burnDps = 0; e.burnTick = 0;
    e.phase = 0; e.face = -Math.PI / 2; e.spitCd = 0; e.dmgAcc = 0; e.dmgTimer = 0; e.goldBonus = false; e.age = 0;
    e.strafe = 1; e.stuckT = 0; e.lastX = x; e.lastY = y;
    e.lastBy = this.w.myId; e.burnBy = this.w.myId; e.predT = 0; e.windup = 0; e.recycle = false;
    e.stunT = 0; e.fuse = -1; e.fuseKill = false; e.boom = 0; e.mutant = false; e.corrodeT = 0; e.critN = 0;
    this.list.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  /** 在摄像机外寻找一个刷怪点：围绕某个玩家，并且离所有玩家都足够远 */
  findSpawnPoint(minD: number, maxD: number, around?: Target | null): { x: number; y: number } | null {
    const w = this.w;
    const T = w.targets;
    const c = around ?? (T.length ? T[Math.floor(globalRng.next() * T.length)] : w.player);
    const rect = w.layout.rect;
    for (let i = 0; i < 14; i++) {
      const a = globalRng.range(0, Math.PI * 2);
      const d = globalRng.range(minD, maxD);
      const x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d;
      if (x < rect.x0 + 1 || x > rect.x1 - 1 || y < rect.y0 + 1 || y > rect.y1 - 1) continue;
      if (!w.nav.reachable(x, y)) continue;
      if (w.layout.safeRoom && pointIn(x, y, w.layout.safeRoom.rect, 2)) continue;
      if (T.length > 1 && T.some((t) => Math.hypot(t.x - x, t.y - y) < minD * 0.85)) continue;
      return { x, y };
    }
    return null;
  }

  /** 离 (x,y) 最近的可追击玩家 */
  nearestTarget(x: number, y: number): Target | null {
    let best: Target | null = null, bd = Infinity;
    for (const t of this.w.targets) {
      const d = (t.x - x) ** 2 + (t.y - y) ** 2;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  initialSpawn(): void {
    const w = this.w;
    const rect = w.layout.rect;
    const cfg = w.layout.cfg;
    const sp = w.layout.startPos;
    let n = Math.round(cfg.initialCount * DIFFICULTY[w.run.difficulty].spawn);
    let guard = 0;
    while (n > 0 && guard++ < n * 20) {
      const x = globalRng.range(rect.x0 + 2, rect.x1 - 2), y = globalRng.range(rect.y0 + 2, rect.y1 - 2);
      if (Math.hypot(x - sp.x, y - sp.y) < 26) continue;
      if (!w.nav.reachable(x, y)) continue;
      if (w.layout.safeRoom && pointIn(x, y, w.layout.safeRoom.rect, 4)) continue;
      this.hash.rebuild(this.list);
      this.spawn(this.pickType(x, y, false), x, y, this.rollElite()).recycle = false;
      n--;
    }
    // 区域初始的精英同样分散在全图（之后阵亡的精英才在玩家附近立即补充）
    guard = 0;
    while (this.eliteCount < this.eliteMin() && guard++ < 400) {
      const x = globalRng.range(rect.x0 + 2, rect.x1 - 2), y = globalRng.range(rect.y0 + 2, rect.y1 - 2);
      if (Math.hypot(x - sp.x, y - sp.y) < 30) continue;
      if (!w.nav.reachable(x, y)) continue;
      if (w.layout.safeRoom && pointIn(x, y, w.layout.safeRoom.rect, 4)) continue;
      this.spawn(this.pickType(x, y, true), x, y, this.forcedEliteTier()).recycle = false;
    }
    this.hash.rebuild(this.list);
    this.topUpElites();
  }

  eliteMin(): number {
    return Math.round(this.w.layout.cfg.eliteMin * (1 + 0.15 * (this.coopN() - 1)));
  }

  /** 精英最低数量：不足时一次性补足（无视临近降重） */
  topUpElites(): void {
    const min = this.eliteMin();
    let need = min - this.eliteCount;
    let guard = 0;
    while (need > 0 && guard++ < 60) {
      const p = this.findSpawnPoint(28, 40);
      if (!p) continue;
      this.spawn(this.pickType(p.x, p.y, true), p.x, p.y, this.forcedEliteTier());
      need--;
    }
  }

  update(dt: number): void {
    const w = this.w;
    if (this.immuneT > 0) this.immuneT -= dt;
    if (!w.isAuthority) { this.updateMirror(dt); return; }
    const cfg = w.layout.cfg;
    const spawning = w.spawningActive();
    const T = w.targets;
    const coopMul = COOP_COUNT_MUL[this.coopN()];

    this.hash.rebuild(this.hashList());

    // —— 个体生成：每个玩家周围分别判断“敌人过少 / 过多”，刷怪点优先选在缺怪的玩家附近 ——
    if (spawning && T.length) {
      const zt = w.zoneTime;
      const ramp = (0.4 + 0.6 * Math.min(1, zt / 100)) * (1 + Math.min(1, zt / 240) * 0.5);
      const low = cfg.densityLow * (0.4 + 0.6 * Math.min(1, zt / 90));
      let densSum = 0, nearMin = Infinity;
      const dens: number[] = [];
      for (const t of T) {
        let near = 0;
        this.hash.queryRadius(t.x, t.y, 26, () => { near++; });
        nearMin = Math.min(nearMin, near);
        const d = near < low ? 1.8 : near > cfg.densityHigh ? 0.15 : 1;
        dens.push(d);
        densSum += d;
      }
      this.nearCount = nearMin;
      const density = densSum / T.length;
      const rate = cfg.spawnRate * DIFFICULTY[w.run.difficulty].spawn * ramp * density * coopMul;
      const maxAlive = Math.min(480, Math.round(cfg.maxAlive * coopMul));
      if (this.list.length < maxAlive) {
        this.spawnAcc += rate * dt;
        let guard = 0;
        while (this.spawnAcc >= 1 && guard++ < 10) {
          this.spawnAcc -= 1;
          let focus = T[0];
          if (T.length > 1) {
            let r = globalRng.next() * densSum;
            for (let i = 0; i < T.length; i++) { r -= dens[i]; if (r <= 0) { focus = T[i]; break; } }
          }
          const sp = this.findSpawnPoint(28, 38, focus);
          if (!sp) continue;
          this.spawn(this.pickType(sp.x, sp.y, false), sp.x, sp.y, this.rollElite());
        }
      }
      if (this.eliteCount < this.eliteMin()) this.topUpElites();
    }

    // —— AI 与移动 ——
    const nav = w.nav, col = w.col;
    const active = w.phaseActive();
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.dead) continue;
      e.age += dt;
      if (e.hitCd > 0) e.hitCd -= dt;
      if (e.flash > 0) e.flash -= dt;
      if (e.slowT > 0) e.slowT -= dt;
      if (e.corrodeT > 0) e.corrodeT -= dt;
      this.tickNumbers(e, dt);
      // 燃烧
      if (e.burnT > 0) {
        e.burnT -= dt;
        e.burnTick -= dt;
        if (e.burnTick <= 0) {
          e.burnTick = 0.5;
          this.damage(e, e.burnDps * 0.5, null, '#ff8a3a', e.burnBy);
          if (e.dead) continue;
          if (globalRng.chance(0.5)) w.fx.sparks(e.x, e.y, 0xff7a20, 2, 2);
        }
      }
      if (e.type === 'boss') { w.boss?.updateAI(e, dt); continue; }
      if (e.type === 'chest') continue;
      if (e.stunT > 0) e.stunT -= dt;
      // 苦力怕：倒计时结束时爆炸
      if (e.fuse >= 0) {
        e.fuse -= dt;
        e.flash = Math.sin(e.fuse * 18) > 0.2 ? 0.1 : 0;
        if (e.fuse <= 0) { this.creeperBoom(e); continue; }
      }

      const t = this.nearestTarget(e.x, e.y);
      let dx = 0, dy = 0, d = 99;
      if (t) {
        dx = t.x - e.x; dy = t.y - e.y;
        d = Math.hypot(dx, dy) || 0.001;
      }

      // 苦力怕：靠近玩家后开始倒计时
      if (e.type === 'creeper' && e.fuse < 0 && t && active && d < CREEPER.trigger + e.r) this.startFuse(e, false, t.id);

      // 回收远离的个体（已经点燃的苦力怕不回收）
      if (t && d > 50 && spawning && e.recycle && e.fuse < 0) {
        const sp = this.findSpawnPoint(28, 38);
        if (sp) { e.x = sp.x; e.y = sp.y; e.vx = 0; e.vy = 0; continue; }
      }

      let dirX = t ? dx / d : 0, dirY = t ? dy / d : 0;
      let speedMul = 1;
      if (!t) {
        // 没有可追击的玩家（都倒下了 / 都进了安全屋）：沿流场慢慢游荡
        if (nav.dirAt(e.x, e.y, tmpV)) { dirX = tmpV.x; dirY = tmpV.y; }
        speedMul = 0.35;
      } else if (e.type === 'spitter') {
        // 故意远离玩家到一定距离
        if (d < 6) { dirX = -dirX; dirY = -dirY; speedMul = 0.9; }
        else if (d < 9) { const sx = -dirY * e.strafe, sy = dirX * e.strafe; dirX = sx; dirY = sy; speedMul = 0.45; }
        else if (d > 5 && nav.dirAt(e.x, e.y, tmpV)) { dirX = tmpV.x; dirY = tmpV.y; }
        e.spitCd -= dt;
        if (e.spitCd <= 0 && d < SPIT.range && active && e.stunT <= 0) {
          if (col.lineOfSight(e.x, e.y, t.x, t.y)) {
            e.spitCd = globalRng.range(2.0, 2.8);
            const lead = Math.min(0.6, d / 9);
            const tx = t.x + t.vx * lead, ty = t.y + t.vy * lead;
            const a = Math.atan2(ty - e.y, tx - e.x) + globalRng.range(-0.06, 0.06);
            const s: EnemyShot = { x: e.x, y: e.y, vx: Math.cos(a) * SPIT.speed, vy: Math.sin(a) * SPIT.speed, dmg: e.atk, r: SPIT.r, life: SPIT.life, dead: false, kind: 'spit' };
            this.shots.push(s);
            w.net?.enemyShot(s);
            w.fx.sound('spit', e.x, e.y, 0.6);
          } else e.spitCd = 0.5;
        }
      } else if (d > 5.5 || !col.lineOfSight(e.x, e.y, t.x, t.y)) {
        if (nav.dirAt(e.x, e.y, tmpV)) { dirX = tmpV.x; dirY = tmpV.y; }
      }
      if (!active) speedMul *= 0.35; // 安全屋/死亡时游荡
      const slow = e.slowT > 0 ? 0.5 : 1;
      // 苦力怕点燃后减速（4.6 → 3.2）；晕眩时无法移动
      if (e.fuse >= 0) speedMul *= CREEPER.fuseSpeed / ENEMIES.creeper.speed;
      if (e.stunT > 0) speedMul = 0;
      const spd = e.speed * speedMul * slow;
      const k = damp(9, dt);
      e.vx += (dirX * spd - e.vx) * k;
      e.vy += (dirY * spd - e.vy) * k;

      // 分离
      const er = e.r;
      this.hash.queryBox(e.x - er - MAX_ENEMY_R, e.y - er - MAX_ENEMY_R, e.x + er + MAX_ENEMY_R, e.y + er + MAX_ENEMY_R, (o) => {
        if (o === e) return;
        const ox = e.x - o.x, oy = e.y - o.y;
        const rr = er + o.r;
        const d2 = ox * ox + oy * oy;
        if (d2 < rr * rr && d2 > 1e-6) {
          const dd = Math.sqrt(d2);
          const push = (rr - dd) / dd;
          const share = o.mass / (o.mass + e.mass);
          e.x += ox * push * share * 0.5;
          e.y += oy * push * share * 0.5;
        }
      });

      // 击退衰减
      e.kx *= Math.max(0, 1 - 6 * dt);
      e.ky *= Math.max(0, 1 - 6 * dt);
      e.x += (e.vx + e.kx) * dt;
      e.y += (e.vy + e.ky) * dt;
      if (col.resolveCircle(e.x, e.y, er, tmpP)) { e.x = tmpP.x; e.y = tmpP.y; }

      // 卡住检测：若长时间没有位移，随机侧移
      e.stuckT += dt;
      if (e.stuckT > 1.2) {
        const moved = Math.hypot(e.x - e.lastX, e.y - e.lastY);
        if (moved < 0.3 && d > 3) { e.kx += globalRng.range(-3, 3); e.ky += globalRng.range(-3, 3); }
        e.stuckT = 0; e.lastX = e.x; e.lastY = e.y;
      }

      // 朝向与动画
      const sp2 = Math.hypot(e.vx, e.vy);
      if (sp2 > 0.1) {
        const target = e.type === 'spitter' && t && d < 16 ? Math.atan2(dy, dx) : Math.atan2(e.vy, e.vx);
        e.face += wrapAngle(target - e.face) * damp(8, dt);
      }
      e.phase += dt * (2 + sp2 * 2.6);

      // 碰撞玩家：接触持续一小段时间（出手蓄力）后才造成伤害
      if (!t) { if (e.windup > 0) e.windup = Math.max(0, e.windup - dt * 2); continue; }
      const cr = er + t.r;
      if (d < cr + 0.15) {
        if (d < cr) {
          const push = (cr - d) * 0.5;
          e.x -= (dx / d) * push;
          e.y -= (dy / d) * push;
        }
        if (e.stunT <= 0) e.windup += dt;
        // 第4.1次调整：远程玩家由其本人判定碰撞伤害（见 updateMirror），房主只结算自己
        if (t.local && e.hitCd <= 0 && e.windup >= 0.3 && active && e.stunT <= 0) {
          e.hitCd = 1.2;
          e.windup = 0;
          if (w.damagePlayer(e.atk, e.x, e.y, e.id)) { w.player.kx += (dx / d) * 5; w.player.ky += (dy / d) * 5; }
        }
      } else if (e.windup > 0) e.windup = Math.max(0, e.windup - dt * 2);
    }

    this.groan(dt);
    this.updateShots(dt);
    this.compact();
  }

  private tickNumbers(e: Enemy, dt: number): void {
    // 伤害数字聚合
    if (e.dmgTimer > 0) {
      e.dmgTimer -= dt;
      if (e.dmgTimer <= 0 && e.dmgAcc > 0) {
        this.w.fx.damageNumber(e.x, e.y, e.dmgAcc, e.elite ? '#ffd24a' : '#ffffff', e.dmgAcc > 300);
        e.dmgAcc = 0;
      }
    }
  }

  private groan(dt: number): void {
    const w = this.w;
    const p = w.view;
    this.groanT -= dt;
    if (this.groanT <= 0 && this.list.length > 0) {
      this.groanT = globalRng.range(1.2, 3.5);
      const e = this.list[Math.floor(globalRng.next() * this.list.length)];
      if (!e.dead && e.type !== 'boss' && Math.hypot(e.x - p.x, e.y - p.y) < 22) w.fx.sound('groan', e.x, e.y, 0.5);
    }
  }

  // —— 联机镜像（非主机）：敌人的位置与生命值来自主机的快照，本地只做平滑、预判与表现 ——

  private updateMirror(dt: number): void {
    const w = this.w;
    const now = w.time;
    const p = w.player;
    const canHit = w.localTargetable() && w.phaseActive();
    for (const e of this.list) {
      if (e.flash > 0) e.flash -= dt;
      if (e.slowT > 0) e.slowT -= dt;
      if (e.burnT > 0) e.burnT -= dt;
      if (e.stunT > 0) e.stunT -= dt;
      if (e.hitCd > 0) e.hitCd -= dt;
      if (e.corrodeT > 0) e.corrodeT -= dt;
      if (e.fuse >= 0) { e.fuse = Math.max(0, e.fuse - dt); e.flash = Math.sin(e.fuse * 18) > 0.2 ? 0.1 : 0; }
      this.tickNumbers(e, dt);
      if (e.predT > 0) {
        e.predT -= dt;
        // 主机没有确认死亡：恢复（以主机的生命值为准）
        if (e.predT <= 0 && e.dead) { e.dead = false; e.hp = Math.max(1, e.shp); }
      }
      const age = Math.min(0.25, Math.max(0, now - e.stime));
      const px = e.sx + e.svx * age, py = e.sy + e.svy * age;
      const dx = px - e.x, dy = py - e.y;
      if (dx * dx + dy * dy > 9) { e.x = px; e.y = py; }
      else { const k = damp(14, dt); e.x += dx * k; e.y += dy * k; }
      e.vx = e.svx; e.vy = e.svy;
      e.face += wrapAngle(e.sface - e.face) * damp(10, dt);
      e.phase += dt * (2 + Math.hypot(e.vx, e.vy) * (e.type === 'boss' ? 1.6 : 2.6));
      // 第4.1次调整：碰撞伤害由自己本地判定（看到的就是打到的），之后通知房主
      if (e.type === 'boss' || e.type === 'chest' || e.dead) continue;
      const ux = p.x - e.x, uy = p.y - e.y;
      const d = Math.hypot(ux, uy) || 0.001;
      if (canHit && d < e.r + p.r + 0.15 && e.stunT <= 0) {
        e.windup += dt;
        if (e.hitCd <= 0 && e.windup >= 0.3) {
          e.hitCd = 1.2;
          e.windup = 0;
          if (w.damagePlayer(e.atk, e.x, e.y, e.id)) { p.kx += (ux / d) * 5; p.ky += (uy / d) * 5; }
        }
      } else if (e.windup > 0) e.windup = Math.max(0, e.windup - dt * 2);
    }
    this.hash.rebuild(this.hashList());
    this.groan(dt);
    this.updateShots(dt);
  }

  mirrorBegin(): void {
    this.mirrorSeen.clear();
  }

  mirrorEntry(id: number, tcode: number, flags: number, x: number, y: number, vx: number, vy: number, face: number, hp: number, maxHp: number): void {
    const w = this.w;
    let e = this.byId.get(id);
    const type = TYPE_CODE[tcode] ?? 'office';
    if (!e) {
      e = this.alloc();
      e.id = id; e.type = type; e.dead = false;
      e.x = x; e.y = y; e.kx = 0; e.ky = 0;
      e.elite = flags & 3;
      e.mutant = !!(flags & 64);
      const cfg = w.layout.cfg, diff = w.run.difficulty;
      e.atk = 0; e.boom = 0;
      if (type === 'boss') {
        const mb = w.layout.index >= 6;
        e.r = mb ? MAMBA.radius : BOSS.radius; e.mass = mb ? 60 : 40;
        e.atk = (mb ? MAMBA.atk : BOSS.atk) * DIFFICULTY[diff].dmg;
      } else if (type === 'chest') { e.r = CHEST_R; e.mass = 999; }
      else {
        const def = ENEMIES[type];
        e.r = def.radius * (e.elite ? 1.12 : 1); e.mass = def.mass * (e.elite ? 1.3 : 1);
        e.atk = enemyAtk(type, e.elite, cfg, diff, e.mutant);
        e.boom = creeperBoomDmg(e.elite, cfg, diff);
      }
      e.hp = hp; e.maxHp = maxHp; e.flash = 0; e.slowT = 0; e.burnT = 0; e.predT = 0; e.stunT = 0; e.fuse = -1;
      e.phase = globalRng.range(0, 6.28); e.face = face; e.dmgAcc = 0; e.dmgTimer = 0;
      e.lastBy = -1; e.burnBy = -1; e.gold = 0; e.hitCd = 0.3; e.windup = 0; e.corrodeT = 0; e.critN = 0;
      this.byId.set(id, e);
      this.list.push(e);
      if (type === 'boss') w.onBossMirror(e);
    }
    e.sx = x; e.sy = y; e.svx = vx; e.svy = vy; e.sface = face; e.stime = w.time;
    e.shp = hp;
    e.maxHp = maxHp;
    if (type === 'boss' && w.boss?.final) e.hp = hp;
    else if (e.predT <= 0) e.hp = Math.min(e.hp, hp);
    if (flags & 4) e.burnT = Math.max(e.burnT, 0.3);
    if (flags & 8) e.slowT = Math.max(e.slowT, 0.3);
    if (flags & 32) e.stunT = Math.max(e.stunT, 0.3);
    if (flags & 128) e.corrodeT = Math.max(e.corrodeT, 0.3);
    // 苦力怕的倒计时：房主只发送“已点燃”，镜像端自己计时
    if (flags & 16) { if (e.fuse < 0) e.fuse = CREEPER.fuse; } else e.fuse = -1;
    this.mirrorSeen.add(id);
  }

  mirrorEnd(): void {
    let j = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (this.mirrorSeen.has(e.id)) this.list[j++] = e;
      else { this.byId.delete(e.id); e.dead = true; this.pool.push(e); }
    }
    this.list.length = j;
  }

  /** 非主机：收到主机的击杀通知 */
  remoteKill(id: number, x: number, y: number, gold: number, by: number, tcode: number, elite: number, face: number): void {
    const w = this.w;
    const e = this.byId.get(id);
    if (e) {
      x = e.x; y = e.y; face = e.face;
      this.byId.delete(id);
      const i = this.list.indexOf(e);
      if (i >= 0) this.list.splice(i, 1);
      e.dead = true;
      if (e.dmgAcc > 0 && w.settings.damageNumbers) w.fx.damageNumber(e.x, e.y, e.dmgAcc, e.elite ? '#ffd24a' : '#ffffff', false);
      e.dmgAcc = 0;
      this.pool.push(e);
    }
    const type = TYPE_CODE[tcode] ?? 'office';
    if (type === 'boss') return;
    if (type === 'chest') { this.chestFx(x, y); return; }
    // 第4.1次调整：苦力怕的爆炸由自己本地判定是否被炸到
    if (type === 'creeper') this.localBoom(x, y, elite);
    this.deathFx(type, x, y, face, elite, by, gold);
  }

  /** 苦力怕爆炸波及本地玩家 */
  private localBoom(x: number, y: number, elite: number): void {
    const w = this.w;
    const p = w.player;
    if (!w.localTargetable() || !w.phaseActive()) return;
    const dx = p.x - x, dy = p.y - y;
    const d = Math.hypot(dx, dy) || 0.01;
    if (d > creeperRadius(elite) + p.r) return;
    if (w.damagePlayer(creeperBoomDmg(elite, w.layout.cfg, w.run.difficulty), x, y)) { p.kx += (dx / d) * 10; p.ky += (dy / d) * 10; }
  }

  /** 奇物宝箱被打破 */
  private chestFx(x: number, y: number): void {
    const w = this.w;
    w.fx.explosion(x, y, 2.4, 0xffd24a);
    w.fx.sparks(x, y, 0xffe08a, 24, 7);
    w.fx.sound('explosion', x, y, 0.7);
    w.fx.shake(0.5);
  }

  /** 死亡表现与金币：击杀者获得全部金币，其他玩家获得 25%（第2版联机） */
  private deathFx(type: EnemyType, x: number, y: number, face: number, elite: number, by: number, gold: number): void {
    const w = this.w;
    const mine = by === w.myId;
    if (mine) {
      w.run.stats.kills++;
      if (elite) w.run.stats.eliteKills++;
      w.combo.add();
    }
    if (type === 'creeper') {
      // 苦力怕炸成碎片，没有尸体
      w.fx.explosion(x, y, CREEPER.radius, 0x9aff6a);
      w.fx.sound('explosion', x, y, 0.9);
      w.fx.shake(0.45);
      w.fx.decal(x, y, 0x101410, CREEPER.radius * 1.2);
    } else if (w.corpses.length < 160) w.corpses.push({ type, x, y, face, t: 0, elite, side: globalRng.sign() });
    // 第3次调整：金币 = 基础 × 变异倍率 × 强化系数（log10(辐射值) - 0.5，按自己当前的辐射值计算）
    // 第4.1次调整：老古董——自己击杀的敌人金币 +100%
    const total = Math.max(1, Math.round(gold * enhanceCoef(w.run.rad) * (mine && w.run.has('antique') ? RELIC.antiqueGold : 1)));
    const share = mine ? total : Math.round(total * COOP.goldShare);
    if (share > 0 && w.player.alive) w.pickups.dropGold(x, y, share);
    if (type === 'creeper') return;
    const r = ENEMIES[type].radius * (elite ? 1.12 : 1);
    const col = type === 'spitter' ? 0x8acc3a : 0x6a1a14;
    w.fx.blood(x, y, col, type === 'iron' ? 22 : 14);
    w.fx.decal(x, y, type === 'spitter' ? 0x4a6a1a : 0x3a0a08, r * 2.6);
    w.fx.sound('kill', x, y, elite ? 1 : 0.6);
  }

  addRemoteShot(s: EnemyShot): void {
    this.shots.push(s);
    if (s.kind === 'spit') this.w.fx.sound('spit', s.x, s.y, 0.6);
  }

  private updateShots(dt: number): void {
    const w = this.w, p = w.player;
    const canHit = w.localTargetable();
    for (const s of this.shots) {
      if (s.dead) continue;
      if (s.kind === 'rock') {
        s.t! += dt;
        const k = Math.min(1, s.t! / s.dur!);
        s.x = s.sx! + (s.tx! - s.sx!) * k;
        s.y = s.sy! + (s.ty! - s.sy!) * k;
        if (k >= 1) {
          s.dead = true;
          w.fx.explosion(s.x, s.y, s.aoe!, 0xff7a3a);
          w.fx.sound('bossSlam', s.x, s.y, 0.8);
          w.fx.shake(0.4);
          if (canHit && Math.hypot(p.x - s.x, p.y - s.y) < s.aoe! + p.r) w.damagePlayer(s.dmg, s.x, s.y);
        }
        continue;
      }
      s.life -= dt;
      const nx = s.x + s.vx * dt, ny = s.y + s.vy * dt;
      if (s.life <= 0 || w.col.raycast(s.x, s.y, nx, ny, 0, undefined, 1.0) >= 0) {
        s.dead = true;
        w.fx.blood(s.x, s.y, 0x9aff3a, 6);
        w.fx.decal(s.x, s.y, 0x5a9a2a, 0.9);
        continue;
      }
      s.x = nx; s.y = ny;
      // 受击判定由被击中的玩家本地完成（命中远程玩家时只在本地消失）
      if (canHit && Math.hypot(p.x - s.x, p.y - s.y) < s.r + p.r) {
        s.dead = true;
        w.fx.blood(s.x, s.y, 0x9aff3a, 10);
        w.fx.sound('splat', s.x, s.y, 0.8);
        w.damagePlayer(s.dmg, s.x - s.vx, s.y - s.vy);
        continue;
      }
      if (w.net) {
        for (const r of w.net.remotes()) {
          if (r.dead || r.downed || r.arrived) continue;
          if (Math.hypot(r.x - s.x, r.y - s.y) < s.r + 0.4) { s.dead = true; w.fx.blood(s.x, s.y, 0x9aff3a, 8); break; }
        }
      }
    }
    if (this.shots.length > 64) this.shots = this.shots.filter((s) => !s.dead);
  }

  /** 对敌人造成伤害；返回是否击杀。by = 造成伤害的玩家（默认本地玩家） */
  damage(e: Enemy, amount: number, src: DmgSrc | null, color?: string, by?: number): boolean {
    if (e.dead || amount <= 0) return false;
    const w = this.w;
    // 第4次调整：安全屋里可以试枪，但不会伤到门外的丧尸
    if (w.phase === 'safehouse') return false;
    // 已经被打死、正在倒计时的苦力怕不再受伤
    if (e.type === 'creeper' && e.fuseKill) return false;
    const who = by ?? w.myId;
    const mine = who === w.myId;
    // 第4.3次调整：曼巴僵尸倒下后再次爬起，进入耐久战时免疫一切伤害
    if (e.type === 'boss' && w.boss?.immune()) {
      if (mine && color !== '#ff8a3a' && this.immuneT <= 0) { this.immuneT = 0.35; w.fx.floatText(e.x, e.y, '免疫', '#ffd24a'); }
      return false;
    }
    // 第4.3次调整：圣盾触发后 5 秒内，自己造成的伤害 -30%
    if (mine && !src?.pre) amount *= w.relicFx.dmgMul();
    // 第4.1次调整：腐蚀（受到的伤害 +25%，这一击本身不算）；要害一击直接击杀普通丧尸
    if (e.corrodeT > 0 && !src?.pre) amount *= RELIC.corrodeMul;
    if (src?.execute) amount = Math.max(amount, e.hp);
    if (src?.corrode) e.corrodeT = RELIC.corrodeTime;
    const dealt = Math.min(e.hp, amount);
    if (mine) {
      w.run.stats.damageDealt += dealt;
      w.run.stats.zoneDamage += dealt;
      if (w.settings.damageNumbers) {
        if (color) w.fx.damageNumber(e.x, e.y, amount, color, false);
        else {
          e.dmgAcc += amount;
          if (e.dmgTimer <= 0) e.dmgTimer = 0.12;
        }
      }
    }
    e.flash = 0.08;
    if (src?.burnDps) { e.burnT = 3; e.burnDps = Math.max(e.burnDps, src.burnDps); e.burnBy = who; if (e.burnTick <= 0) e.burnTick = 0.5; }
    if (src?.slow) e.slowT = 2.5;
    if (mine) this.relicProcs(e);
    // 非主机：本地预判，交给主机结算
    if (!w.isAuthority) {
      e.hp -= amount;
      const flags = (src?.burnDps ? DMG_BURN : 0) | (src?.slow ? DMG_SLOW : 0) | (src?.gold ? DMG_GOLD : 0)
        | (src?.corrode ? DMG_CORRODE : 0) | (src?.execute ? DMG_EXEC : 0) | DMG_PRE;
      w.net!.enemyDamage(e, amount, flags, src?.burnDps ?? 0);
      // 苦力怕被打死后还会倒计时 2 秒再爆炸，不做“预判死亡”
      if (e.hp <= 0 && e.type !== 'creeper' && e.type !== 'boss') { e.dead = true; e.predT = 0.6; }
      if (e.type === 'boss') e.hp = Math.max(0, e.hp);
      if (e.type === 'creeper') e.hp = Math.max(0, e.hp);
      return false;
    }
    e.hp -= amount;
    e.lastBy = who;
    if (e.type === 'boss') {
      w.boss?.onDamaged(e, amount);
      // 第4.3次调整：曼巴僵尸第一次倒下时不会死亡，而是进入过场动画
      if (e.hp <= 0 && w.boss?.preventDeath()) return false;
    }
    if (e.type === 'creeper' && e.hp <= 0) {
      e.hp = 0;
      if (src?.gold) e.goldBonus = true;
      this.startFuse(e, true, who);
      return true;
    }
    if (e.hp <= 0) {
      if (src?.gold) e.goldBonus = true;
      this.kill(e);
      return true;
    }
    return false;
  }

  /** 苦力怕开始倒计时（kill = 被打死，金币 34；否则是靠近触发，金币 17） */
  startFuse(e: Enemy, kill: boolean, by: number): void {
    if (kill) e.fuseKill = true;
    if (e.fuse >= 0) return;
    e.fuse = CREEPER.fuse;
    e.lastBy = by;
    this.w.fxAll('sound', 'fuse', e.x, e.y, 0.9);
  }

  /** 苦力怕爆炸：伤害范围内的玩家与丧尸（对丧尸 ×5），然后按“击杀”结算金币 */
  private creeperBoom(e: Enemy): void {
    const w = this.w;
    if (e.dead) return;
    const R = creeperRadius(e.elite);
    e.dead = true;
    if (e.elite) this.eliteCount--;
    // 玩家（本地直接结算，远程玩家发送命中消息）
    // 第4.1次调整：远程玩家收到击杀消息后自己判定是否被炸到（见 remoteKill）
    if (w.phaseActive() && w.localTargetable()) {
      const p = w.player;
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d <= R + p.r && w.damagePlayer(e.boom, e.x, e.y)) { p.kx += (dx / d) * 10; p.ky += (dy / d) * 10; }
    }
    // 殃及丧尸：伤害为对玩家的 5 倍，记在引爆者名下
    const by = e.lastBy;
    this.hash.queryRadius(e.x, e.y, R + MAX_ENEMY_R, (o, d2) => {
      if (o === e || o.dead) return;
      const rr = R + o.r;
      if (d2 > rr * rr) return;
      const d = Math.sqrt(d2) || 0.01;
      o.kx += ((o.x - e.x) / d) * 8 / o.mass;
      o.ky += ((o.y - e.y) / d) * 8 / o.mass;
      this.damage(o, e.boom * CREEPER.enemyMul, null, '#9aff6a', by);
    });
    // 金币：被打死的 34，靠近触发的 17（再乘变异倍率；强化系数在 deathFx 里乘）
    const base = e.fuseKill ? ENEMIES.creeper.gold : CREEPER.nearGold;
    let gold = base * ELITE_MUL[e.elite];
    gold = Math.max(1, Math.round(gold * globalRng.range(0.9, 1.1)));
    w.net?.enemyKilled(e, gold, by);
    this.deathFx('creeper', e.x, e.y, e.face, e.elite, by, gold);
    if (e.goldBonus) this.goldDrop(e, by);
  }

  /** 招财弹（第4.1次调整）：被招财弹击杀的丧尸必定掉落一件随机道具（权重与地图道具相同），每名玩家每区最多 4 次 */
  private goldDrop(e: Enemy, by: number): void {
    const w = this.w;
    const n = this.goldDrops.get(by) ?? 0;
    if (n >= GOLD_DROP_MAX) return;
    this.goldDrops.set(by, n + 1);
    const cfg = w.layout.cfg;
    const id = globalRng.weighted(ITEM_IDS.map((k) => [k, ITEMS[k].weight] as const));
    const thing = w.pickups.makeItem(id, globalRng, cfg.index, cfg.gunRarityW, cfg.purify);
    w.pickups.dropThing(thing, e.x, e.y, true);
    w.fxAll('sound', 'pickupBig', e.x, e.y, 0.5);
  }

  /** 金刀 / 黑曜羽毛：自己造成伤害时触发（金刀的追加伤害不会再次触发） */
  private relicProcs(e: Enemy): void {
    if (this.procing) return;
    const w = this.w, run = w.run;
    if (run.has('feather') && ++this.featherN >= RELIC.featherHits) {
      this.featherN = 0;
      w.healPlayer(RELIC.featherHeal);
    }
    if (run.has('golden') && globalRng.chance(RELIC.goldenChance)) {
      this.procing = true;
      w.fx.sparks(e.x, e.y, 0xffd24a, 8, 5);
      this.damage(e, RELIC.goldenDmg, null, '#ffd24a');
      this.procing = false;
    }
  }

  /** 晕眩（黄油）：Boss 免疫；非房主把晕眩交给房主结算 */
  applyStun(e: Enemy, t: number): void {
    if (e.dead || e.type === 'boss' || e.type === 'chest') return;
    e.stunT = Math.max(e.stunT, t);
    if (!this.w.isAuthority) this.w.net?.enemyStun(e, t);
  }

  /** 房主：其他玩家造成的晕眩 */
  applyRemoteStun(id: number, t: number): void {
    const e = this.byId.get(id);
    if (!e || e.dead || e.type === 'boss' || e.type === 'chest') return;
    e.stunT = Math.max(e.stunT, t);
  }

  kill(e: Enemy): void {
    if (e.dead) return;
    const w = this.w;
    e.dead = true;
    if (e.dmgAcc > 0 && w.settings.damageNumbers) w.fx.damageNumber(e.x, e.y, e.dmgAcc, e.elite ? '#ffd24a' : '#ffffff', false);
    e.dmgAcc = 0;
    if (e.elite) this.eliteCount--;
    if (e.type === 'boss') { w.net?.enemyKilled(e, 0, e.lastBy); w.onBossKilled(e); return; }
    if (e.type === 'chest') { w.net?.enemyKilled(e, 0, e.lastBy); this.chestFx(e.x, e.y); w.quests.onChestBroken(e); return; }
    if (e.mutant) w.quests.onMutantKilled(e);
    // 金币掉落 = 基础 × 变异倍率；强化系数在 deathFx 里按各玩家自己的辐射值相乘
    let gold = e.gold;
    gold = Math.max(1, Math.round(gold * globalRng.range(0.9, 1.1)));
    w.net?.enemyKilled(e, gold, e.lastBy);
    this.deathFx(e.type, e.x, e.y, e.face, e.elite, e.lastBy, gold);
    if (e.goldBonus) this.goldDrop(e, e.lastBy);
    // 精英有概率掉落子弹（自定）
    if (e.elite > 0) {
      const ch = [0, 0.05, 0.12, 0.25][e.elite];
      if (globalRng.chance(ch)) w.pickups.dropThing(randomBullet(w.run.rng), e.x, e.y, true);
    }
    // 燃烧传染
    if (e.burnT > 0) {
      this.hash.queryRadius(e.x, e.y, 1.9, (o) => {
        if (o === e || o.type === 'boss' || o.type === 'chest') return;
        o.burnT = 3;
        o.burnDps = Math.max(o.burnDps, e.burnDps * 0.8);
        o.burnBy = e.burnBy;
      });
    }
  }

  private compact(): void {
    let j = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.dead) { this.pool.push(e); this.byId.delete(e.id); }
      else this.list[j++] = e;
    }
    this.list.length = j;
  }

  clearAll(): void {
    for (const e of this.list) { e.dead = true; this.pool.push(e); }
    this.list = [];
    this.byId.clear();
    this.shots = [];
    this.eliteCount = 0;
  }

  /** 最近的敌人（不含奇物宝箱：追踪、电弧、奇物的箭都不会去找宝箱） */
  nearest(x: number, y: number, maxR: number, exclude?: (e: Enemy) => boolean): Enemy | null {
    let best: Enemy | null = null, bd = maxR * maxR;
    this.hash.queryRadius(x, y, maxR, (e, d2) => {
      if (e.dead || e.type === 'chest' || (exclude && exclude(e))) return;
      if (d2 < bd) { bd = d2; best = e; }
    });
    return best;
  }

  applyKnock(e: Enemy, dx: number, dy: number, force: number): void {
    const m = clamp(1 / e.mass, 0.02, 1.2);
    if (!this.w.isAuthority) { this.w.net!.enemyKnock(e, dx * force * m, dy * force * m); return; }
    e.kx += dx * force * m;
    e.ky += dy * force * m;
  }

  /** 主机：应用远程玩家造成的伤害与效果 */
  applyRemote(id: number, amount: number, flags: number, burnDps: number, by: number): void {
    const e = this.byId.get(id);
    if (!e || e.dead) return;
    this.damage(e, amount, {
      gold: !!(flags & DMG_GOLD), burnDps: flags & DMG_BURN ? burnDps : 0, slow: !!(flags & DMG_SLOW),
      corrode: !!(flags & DMG_CORRODE), execute: !!(flags & DMG_EXEC), pre: !!(flags & DMG_PRE),
    }, undefined, by);
  }

  /** 房主：远程玩家本地判定被某个丧尸撞到后，这个丧尸进入出手冷却 */
  onRemoteHurt(id: number): void {
    const e = this.byId.get(id);
    if (!e || e.dead) return;
    e.hitCd = Math.max(e.hitCd, 1.2);
    e.windup = 0;
  }

  applyRemoteKnock(id: number, kx: number, ky: number): void {
    const e = this.byId.get(id);
    if (!e || e.dead) return;
    e.kx += kx;
    e.ky += ky;
  }
}

function pointIn(x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }, pad: number): boolean {
  return x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;
}

export { MAX_ENEMY_R };
