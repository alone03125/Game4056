// 牢大丧尸（Boss）：碰（接触）+ 肘（蓄力冲刺）+ 丢（连续投掷石块）。
// 第3次调整：每个阶段 24000 生命，共 4 个阶段——3/4 血召唤精英、半血狂暴、1/4 血再次召唤；
// 投掷技能改为连续锁定玩家当前位置、连续投出多块石头，预警到砸落的时间更短。
// 第2版联机：AI 只在房主处运行，追击最近的玩家；其他玩家的 Boss 处于镜像模式，只接收状态。
// 第4.1次调整：Boss 的碰撞、冲刺等伤害改为由被打的玩家本地判定（镜像模式下的 mirrorHits）。
// 第4.3次调整：接口增加曼巴僵尸耐久战需要的免疫、跃起与计时。
// v4.3.7：生命 ×1.25（普通难度每阶段 24000）；转阶段时获得伤害减免（PhaseShield）；关键技能附带音频文件音效。

import { BOSS } from '../config';
import { VO } from './fx';
import { damp, wrapAngle, clamp } from '../util/math';
import { globalRng } from '../util/rng';
import type { Enemy, EnemyShot } from './enemies';
import type { Target } from './net';
import type { World } from './world';

export type TeleKind = 'line' | 'circle' | 'beam' | 'ring' | 'slam';
export const TELE_KINDS: TeleKind[] = ['line', 'circle', 'beam', 'ring', 'slam'];

/** 地面预警 / 技能范围（line = 冲刺路线，circle = 落点，beam = 激光，ring = 冲击波，slam = 曼巴僵尸跃起后落地的冲击） */
export interface Telegraph {
  kind: TeleKind;
  x: number;
  y: number;
  a: number; // line / beam 方向
  len: number;
  r: number; // circle 半径 / line、beam 半宽
  t: number;
  dur: number;
  dead: boolean;
  w?: number; // 旋转角速度（激光）
  follow?: boolean; // 跟随 Boss 的位置
}

/**
 * v4.3.7：Boss 转阶段的伤害减免。每次转阶段（召唤精英、狂暴……）时获得 80% 伤害减免，之后每秒下降 4 个百分点（20 秒消退完）；
 * 减免期间再进入下一阶段会重新补满。一次伤害不会越过下一条阶段分界线（停在分界线下 1 点），
 * 防止用特别强的配置一口气跳过几个阶段。
 */
export const BOSS_SHIELD = { max: 0.8, decay: 0.04 };

export class PhaseShield {
  /** 当前的伤害减免（0 ~ 0.8）；联机时由房主同步 */
  dr = 0;

  /** marks：各阶段的分界线（生命比例，从高到低） */
  constructor(readonly marks: readonly number[]) {}

  tick(dt: number): void {
    if (this.dr > 0) this.dr = Math.max(0, this.dr - BOSS_SHIELD.decay * dt);
  }

  /** 截断一次伤害：会越过下一条分界线时停在分界线下 1 点，并补满减伤；返回截断后的伤害 */
  clamp(e: Enemy, amount: number): number {
    for (const m of this.marks) {
      const line = e.maxHp * m;
      if (e.hp <= line) continue;
      if (e.hp - amount < line) {
        this.dr = BOSS_SHIELD.max;
        return Math.max(0, Math.min(amount, e.hp - line + 1));
      }
      break;
    }
    return amount;
  }
}

/** 两种 Boss（牢大丧尸 / 曼巴僵尸）共用的接口：世界、联机与渲染只通过它访问 Boss */
export interface BossAI {
  readonly kind: 'laoda' | 'mamba';
  readonly name: string;
  e: Enemy;
  mirror: boolean;
  enraged: boolean;
  anim: number; // 动画：0 走 1 蓄力/施法 2 冲刺 3 投掷 4 眩晕 5 倒地 6 爬起 7 跃起在空中
  throwPose: number; // 投掷的姿势；爬起时为进度，跃起时为高度（0~1）
  telegraphs: Telegraph[];
  /** v4.3.7：转阶段的伤害减免 */
  readonly shield: PhaseShield;
  /** 第4.3次调整：曼巴僵尸的耐久战（免疫伤害，生命条变为计时条） */
  final: boolean;
  stateIndex(): number;
  updateAI(e: Enemy, dt: number): void;
  onDamaged(e: Enemy, amt: number): void;
  tickTelegraphs(dt: number): void;
  applyState(state: number, anim: number, enraged: boolean, throwPose: number, tele: number[][], fin?: number): void;
  /** 当前是否免疫玩家的伤害 */
  immune(): boolean;
  /** 跃起在空中：不会被命中，也不会撞到玩家 */
  airborne(): boolean;
  /** 房主：生命归零时是否阻止死亡（曼巴僵尸第一次倒下后会再次爬起） */
  preventDeath(): boolean;
  /** 耐久战的剩余时间（秒）；没有时为 -1 */
  timer(): number;
  /** 生命条显示：当前阶段 / 总阶段数 */
  phaseInfo(): { phase: number; total: number };
  /** 镜像模式：本地判定 Boss 对自己造成的伤害（第4.1次调整） */
  mirrorHits(dt: number): void;
}

/** 镜像模式下本地判定的接触伤害与冲刺伤害（两种 Boss 共用） */
export class MirrorContact {
  private hitCd = 0;
  private dashHit = false;

  constructor(private w: World, private e: Enemy) {}

  update(dt: number, dashing: boolean, dashKnock: number, bodyKnock: number): void {
    const w = this.w, e = this.e, p = w.player;
    if (this.hitCd > 0) this.hitCd -= dt;
    if (!dashing) this.dashHit = false;
    if (e.dead || !w.phaseActive() || !w.localTargetable()) return;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 0.01;
    if (dashing && !this.dashHit && d < e.r + p.r + 0.5) {
      this.dashHit = true;
      const sp = Math.hypot(e.vx, e.vy);
      const a = sp > 1 ? Math.atan2(e.vy, e.vx) : e.face;
      if (w.damagePlayer(e.atk, e.x, e.y, e.id)) { p.kx += Math.cos(a) * dashKnock; p.ky += Math.sin(a) * dashKnock; w.fx.shake(1); }
      return;
    }
    if (d < e.r + p.r && this.hitCd <= 0) {
      this.hitCd = 1.2;
      if (w.damagePlayer(e.atk, e.x, e.y, e.id)) { p.kx += (dx / d) * bodyKnock; p.ky += (dy / d) * bodyKnock; }
    }
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function encodeTele(t: Telegraph): number[] {
  return [TELE_KINDS.indexOf(t.kind), r2(t.x), r2(t.y), r2(t.a), r2(t.len), r2(t.r), r2(t.t), r2(t.dur), r2(t.w ?? 0), t.follow ? 1 : 0];
}

export function decodeTele(a: number[]): Telegraph {
  return { kind: TELE_KINDS[a[0]] ?? 'line', x: a[1], y: a[2], a: a[3], len: a[4], r: a[5], t: a[6], dur: a[7], dead: false, w: a[8] || 0, follow: !!a[9] };
}

/** 推进预警计时：旋转、跟随 Boss、到时消失（镜像模式也要调用，保证动画连续） */
export function tickTeles(list: Telegraph[], dt: number, e: Enemy): Telegraph[] {
  for (const t of list) {
    t.t += dt;
    if (t.w) t.a += t.w * dt;
    if (t.follow) { t.x = e.x; t.y = e.y; }
    if (t.t >= t.dur) t.dead = true;
  }
  return list.filter((t) => !t.dead);
}

/** 抛出一块石头：落点预警圈 + 抛物线投射物（命中判定由各玩家本地完成） */
export function throwRock(w: World, e: Enemy, tx: number, ty: number, dmg: number, aoe: number, dur: number, teles: Telegraph[]): void {
  const s: EnemyShot = { x: e.x, y: e.y, vx: 0, vy: 0, dmg, r: 0.6, life: 9, dead: false, kind: 'rock', tx, ty, t: 0, dur, sx: e.x, sy: e.y, aoe };
  w.enemies.shots.push(s);
  w.net?.enemyShot(s);
  teles.push({ kind: 'circle', x: tx, y: ty, a: 0, len: 0, r: aoe, t: 0, dur, dead: false });
  w.fxAll('sound', 'bossThrow', e.x, e.y, 0.8);
}

export type BossState = 'intro' | 'chase' | 'windElbow' | 'dash' | 'recover' | 'windThrow' | 'stunned' | 'summon' | 'barrage';
export const BOSS_STATES: BossState[] = ['intro', 'chase', 'windElbow', 'dash', 'recover', 'windThrow', 'stunned', 'summon', 'barrage'];

const tmpV = { x: 0, y: 0 };
const tmpP = { x: 0, y: 0 };

export class Boss implements BossAI {
  readonly kind = 'laoda';
  e: Enemy;
  state: BossState = 'intro';
  stateT = 0;
  attackCd = 3;
  enraged = false;
  dashA = 0;
  dashHit = new Set<number>();
  contactCd = new Map<number, number>();
  summoned = 0;
  telegraphs: Telegraph[] = [];
  anim = 0;
  throwPose = 0;
  mirror: boolean;
  final = false;
  /** v4.3.7：3/4 血（召唤）、半血（狂暴）、1/4 血（召唤）三次转阶段 */
  readonly shield = new PhaseShield([0.75, 0.5, 0.25]);
  private focus: Target | null = null;
  private volley = 0; // 本轮还要投出的石头数
  private volleyT = 0;
  private mc: MirrorContact;

  constructor(private w: World, e: Enemy, mirror = false) {
    this.e = e;
    this.mirror = mirror;
    this.mc = new MirrorContact(w, e);
    if (!mirror) {
      w.fxAll('sound', 'bossRoar', e.x, e.y, 1);
      w.fxAll('shake', 0.8);
    }
  }

  get name(): string {
    return BOSS.name;
  }

  stateIndex(): number {
    return BOSS_STATES.indexOf(this.state);
  }

  phaseInfo(): { phase: number; total: number } {
    const f = Math.max(0, this.e.hp) / Math.max(1, this.e.maxHp);
    return { phase: Math.min(BOSS.phases, Math.floor((1 - f) * BOSS.phases) + 1), total: BOSS.phases };
  }

  private set(s: BossState): void {
    this.state = s;
    this.stateT = 0;
  }

  onDamaged(e: Enemy, amt: number): void {
    // 第 3 阶段（半血）开始狂暴
    if (!this.enraged && e.hp < e.maxHp * 0.5) {
      this.enraged = true;
      this.w.fxAll('banner', '牢大丧尸狂暴化', '移动更快，攻击更加频繁', '#ff3a3a');
      this.w.fxAll('sound', 'bossRoar', e.x, e.y, 1);
      this.w.fxAll('voice', VO.cantWrite);
      this.w.fxAll('shake', 0.8);
    }
    void amt;
  }

  immune(): boolean { return false; }
  airborne(): boolean { return false; }
  preventDeath(): boolean { return false; }
  timer(): number { return -1; }

  /** 镜像模式：应用房主发来的状态 */
  applyState(state: number, anim: number, enraged: boolean, throwPose: number, tele: number[][]): void {
    this.state = BOSS_STATES[state] ?? 'chase';
    this.anim = anim;
    this.enraged = enraged;
    this.throwPose = throwPose;
    this.telegraphs = tele.map(decodeTele);
  }

  tickTelegraphs(dt: number): void {
    this.telegraphs = tickTeles(this.telegraphs, dt, this.e);
    if (this.mirror && this.state === 'windElbow') {
      const tg = this.telegraphs.find((t) => t.kind === 'line');
      if (tg) { tg.x = this.e.x; tg.y = this.e.y; tg.a = this.e.face; }
    }
  }

  /** 对一名玩家造成伤害：房主只结算自己，其他玩家在本地判定（见 mirrorHits） */
  private hit(t: Target, dmg: number, kx: number, ky: number): boolean {
    const w = this.w;
    if (!t.local) return false;
    if (!w.damagePlayer(dmg, this.e.x, this.e.y, this.e.id)) return false;
    w.player.kx += kx;
    w.player.ky += ky;
    return true;
  }

  mirrorHits(dt: number): void {
    this.mc.update(dt, this.state === 'dash', 14, 8);
  }

  updateAI(e: Enemy, dt: number): void {
    const w = this.w;
    this.stateT += dt;
    for (const [k, v] of this.contactCd) if (v > 0) this.contactCd.set(k, v - dt);
    this.tickTelegraphs(dt);
    // 追击最近的玩家（冲刺途中保持原目标）
    const near = w.enemies.nearestTarget(e.x, e.y);
    if (this.state !== 'dash' || !this.focus) this.focus = near;
    const p = this.focus;
    const px = p ? p.x : e.x + Math.cos(e.face) * 5, py = p ? p.y : e.y + Math.sin(e.face) * 5;
    const dx = px - e.x, dy = py - e.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const toP = Math.atan2(dy, dx);
    let vx = 0, vy = 0;
    const slow = e.slowT > 0 ? 0.8 : 1;

    // 召唤：进入第 2 阶段（3/4 血）与第 4 阶段（1/4 血）时
    const frac = e.hp / e.maxHp;
    if (this.state === 'chase' && ((this.summoned === 0 && frac < 0.75) || (this.summoned === 1 && frac < 0.25))) {
      this.summoned++;
      this.set('summon');
      w.fxAll('banner', '尸群响应了召唤', '精英丧尸正在靠近', '#ff8a1a');
      w.fxAll('sound', 'bossRoar', e.x, e.y, 1);
    }

    switch (this.state) {
      case 'intro':
        this.anim = 1;
        if (this.stateT > 2.6) this.set('chase');
        break;
      case 'chase': {
        this.anim = 0;
        if (!p) break;
        const spd = BOSS.speed * (this.enraged ? 1.35 : 1) * slow;
        let mx = dx / d, my = dy / d;
        if ((d > 4 || !w.col.lineOfSight(e.x, e.y, px, py)) && w.nav.dirAt(e.x, e.y, tmpV)) { mx = tmpV.x; my = tmpV.y; }
        vx = mx * spd; vy = my * spd;
        e.face += wrapAngle(toP - e.face) * damp(5, dt);
        this.attackCd -= dt;
        if (this.attackCd <= 0 && w.phaseActive()) {
          const r = globalRng.next();
          const elbowP = d > 10 ? 0.4 : 0.68;
          if (r < elbowP) {
            this.set('windElbow');
            this.telegraphs.push({ kind: 'line', x: e.x, y: e.y, a: toP, len: 17, r: 1.5, t: 0, dur: this.windElbowDur(), dead: false });
            w.fxAll('sound', 'bossRoar', e.x, e.y, 0.5);
          } else {
            this.set('windThrow');
          }
        }
        break;
      }
      case 'windElbow': {
        this.anim = 1;
        e.face += wrapAngle(toP - e.face) * damp(this.enraged ? 7 : 5, dt);
        const tg = this.telegraphs[this.telegraphs.length - 1];
        if (tg) { tg.x = e.x; tg.y = e.y; tg.a = e.face; }
        if (this.stateT >= this.windElbowDur()) {
          this.dashA = e.face;
          this.dashHit.clear();
          this.set('dash');
          w.fxAll('sound', 'bossDash', e.x, e.y, 1);
          w.fxAll('voice', VO.man);
        }
        break;
      }
      case 'dash': {
        this.anim = 2;
        const sp = 17;
        vx = Math.cos(this.dashA) * sp;
        vy = Math.sin(this.dashA) * sp;
        if (globalRng.chance(0.6)) w.fx.smoke(e.x, e.y, 1);
        for (const t of w.targets) {
          if (this.dashHit.has(t.id)) continue;
          if (Math.hypot(t.x - e.x, t.y - e.y) < e.r + t.r + 0.5) {
            this.dashHit.add(t.id);
            if (this.hit(t, e.atk, Math.cos(this.dashA) * 14, Math.sin(this.dashA) * 14) && t.local) w.fx.shake(1);
          }
        }
        if (this.stateT > 1.05) { this.set('recover'); this.attackCd = this.cd(); }
        break;
      }
      case 'recover':
        this.anim = 4;
        if (this.stateT > (this.enraged ? 0.5 : 0.85)) this.set('chase');
        break;
      case 'stunned':
        this.anim = 4;
        if (this.stateT > 1.7) { this.set('chase'); this.attackCd = this.cd() * 0.6; }
        break;
      case 'windThrow': {
        // 举起石块
        this.anim = 3;
        this.throwPose = clamp(this.stateT / 0.5, 0, 1);
        e.face += wrapAngle(toP - e.face) * damp(6, dt);
        if (this.stateT >= 0.5) {
          this.volley = this.enraged ? 6 : 4;
          this.volleyT = 0;
          this.set('barrage');
        }
        break;
      }
      case 'barrage': {
        // 连续投掷：每一块都重新锁定目标玩家当前的位置
        this.anim = 3;
        e.face += wrapAngle(toP - e.face) * damp(8, dt);
        this.volleyT -= dt;
        this.throwPose = 0.4 + 0.6 * clamp(1 - this.volleyT / this.throwGap(), 0, 1);
        if (this.volleyT <= 0 && this.volley > 0) {
          this.volley--;
          this.volleyT = this.throwGap();
          if (p) {
            // 预警到砸落 0.72~1.05 秒（原来 0.95~1.45 秒）：以初始移速一直跑动刚好能躲开，站着不动必中
            const dur = 0.72 + Math.min(0.33, d / 36);
            throwRock(w, e, px + globalRng.range(-0.4, 0.4), py + globalRng.range(-0.4, 0.4), e.atk * 0.6, 2.4, dur, this.telegraphs);
          }
          this.throwPose = 0;
        }
        if (this.volley <= 0 && this.volleyT <= 0) { this.set('recover'); this.attackCd = this.cd(); }
        break;
      }
      case 'summon': {
        this.anim = 1;
        if (this.stateT > 1.2) {
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            const x = e.x + Math.cos(a) * 5, y = e.y + Math.sin(a) * 5;
            if (!w.nav.isFree(x, y)) continue;
            const tier = globalRng.chance(0.35) ? 2 : 1;
            const type = globalRng.pick(['office', 'runner', 'iron', 'spitter'] as const);
            w.enemies.spawn(type, x, y, tier);
            w.fxAll('smoke', x, y, 6);
          }
          w.fxAll('voice', VO.teammates);
          this.set('chase');
          this.attackCd = 2;
        }
        break;
      }
    }

    // 移动与碰撞
    e.kx *= Math.max(0, 1 - 6 * dt);
    e.ky *= Math.max(0, 1 - 6 * dt);
    e.vx = vx; e.vy = vy;
    e.x += (vx + e.kx) * dt;
    e.y += (vy + e.ky) * dt;
    if (w.col.resolveCircle(e.x, e.y, e.r, tmpP)) {
      e.x = tmpP.x; e.y = tmpP.y;
      if (this.state === 'dash' && this.stateT > 0.12) {
        // 撞墙眩晕
        this.set('stunned');
        w.fxAll('shake', 1);
        w.fxAll('sound', 'bossSlam', e.x, e.y, 1);
        w.fxAll('smoke', e.x + Math.cos(this.dashA) * 1.5, e.y + Math.sin(this.dashA) * 1.5, 12);
        w.fxAll('toast', '牢大撞墙眩晕！趁现在输出！', '#ffd24a');
      }
    }
    e.phase += dt * (2 + Math.hypot(vx, vy) * 1.6);

    // 碰（接触伤害）：每名玩家单独计算冷却
    if (w.phaseActive()) {
      for (const t of w.targets) {
        const dd = Math.hypot(t.x - e.x, t.y - e.y) || 0.01;
        if (dd >= e.r + t.r || (this.contactCd.get(t.id) ?? 0) > 0) continue;
        this.contactCd.set(t.id, 1.2);
        this.hit(t, e.atk, ((t.x - e.x) / dd) * 8, ((t.y - e.y) / dd) * 8);
      }
    }
  }

  private throwGap(): number {
    return this.enraged ? 0.3 : 0.38;
  }

  private windElbowDur(): number {
    return this.enraged ? 0.7 : 1.0;
  }

  private cd(): number {
    return this.enraged ? globalRng.range(1.6, 2.6) : globalRng.range(2.6, 3.8);
  }
}
