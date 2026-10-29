// 曼巴僵尸（第六区“隐秘核心”的最终 Boss，第3次调整）：
// 30 万生命（v4.3.7；普通难度 24 万），攻击力高于牢大丧尸。技能：旋转激光、冲击波（玩家太近时强制击退）、
// 投石（范围更大的连续投掷）、冲撞（狂暴后连续冲撞），并且每损失 1/5 生命召唤一批精英丧尸。
// 与牢大一样，AI 只在单人 / 房主处运行，其他玩家处于镜像模式。
// 第4.3次调整：生命归零时先倒地，过场动画中再次爬起并狂暴，进入耐久战（v4.3.7：36 → 52 秒；v4.3.10：50 秒）——
// 免疫一切伤害，生命条变为红金色的计时条，并解锁新技能“跃起”（锁定玩家后从天而降）。坚持到计时结束即获胜。
// v4.3.7：转阶段（4 次召唤与半血狂暴）时获得伤害减免；冲撞、冲击波、跃起、激光与召唤附带音频文件音效。

import { MAMBA } from '../config';
import { clamp, damp, wrapAngle } from '../util/math';
import { globalRng } from '../util/rng';
import { BossAI, decodeTele, MirrorContact, PhaseShield, releaseVoice, Telegraph, throwRock, tickTeles } from './boss';
import { VO } from './fx';
import type { Enemy } from './enemies';
import type { Target } from './net';
import type { World } from './world';

export type MambaState =
  | 'intro' | 'chase' | 'windCharge' | 'charge' | 'recover' | 'windThrow' | 'barrage'
  | 'windLaser' | 'laser' | 'windWave' | 'summon' | 'stunned'
  // 第4.3次调整：倒地 → 爬起 → 怒吼（过场动画），以及跃起
  | 'down' | 'rise' | 'roar' | 'windLeap' | 'leap' | 'land';
export const MAMBA_STATES: MambaState[] = [
  'intro', 'chase', 'windCharge', 'charge', 'recover', 'windThrow', 'barrage', 'windLaser', 'laser', 'windWave', 'summon', 'stunned',
  'down', 'rise', 'roar', 'windLeap', 'leap', 'land',
];

/**
 * 第4.3次调整：倒地后的过场动画（秒）。down = 倒在地上（心跳声越来越快），rise = 爬起，roar = 怒吼、生命条重新填满。
 * 世界的过场动画（镜头、黑边、音效）与这里的时间一致，total 之后进入耐久战。
 * v4.3.7：耐久战 36 → 52 秒。10 号音乐（58.2 秒）在过场动画开始时响起。
 * v4.3.10：耐久战改为 50 秒，音乐照常播放：曼巴僵尸在 6.2 + 50 = 56.2 秒时倒下，之后音乐再播放约 2 秒到结尾。
 */
export const MAMBA_CINE = { down: 2.4, rise: 1.5, roar: 2.3, total: 6.2, finalTime: 50 };

/** 技能参数（自定） */
const SK = {
  waveRange: 5.5, // 玩家进入该距离时触发冲击波
  waveRadius: 7.5,
  waveKnock: 26,
  laserLen: 26,
  laserHalfW: 0.6,
  rockAoe: 3.6, // 牢大为 2.4
  summonAt: [0.8, 0.6, 0.4, 0.2],
  // 跃起（第4.3次调整）：预警 1.7 秒（投石为 0.85~1.15 秒），范围半径 6.4 米（投石为 3.6 米）
  leapWind: 0.5, // 下蹲蓄力
  leapAir: 1.7, // 起跳到落地的时间，也就是红圈的预警时间
  leapAim: 0.8, // 前 0.8 秒红圈跟着目标玩家移动，之后锁定
  leapR: 6.4,
  leapDmg: 0.9, // × 攻击力（投石为 0.55）
  leapKnock: 18,
  leapH: 11, // 跃起的最大高度（米，渲染用）
};

export { SK as MAMBA_SKILL };

const tmpV = { x: 0, y: 0 };
const tmpP = { x: 0, y: 0 };
const CINE_STATES = new Set<MambaState>(['down', 'rise', 'roar']);

export class Mamba implements BossAI {
  readonly kind = 'mamba';
  e: Enemy;
  state: MambaState = 'intro';
  stateT = 0;
  attackCd = 3;
  waveCd = 2;
  enraged = false;
  telegraphs: Telegraph[] = [];
  anim = 0;
  throwPose = 0;
  mirror: boolean;
  /** 耐久战（第4.3次调整） */
  final = false;
  finalT = 0;
  /** v4.3.7：4 次召唤（4/5、3/5、2/5、1/5 血）与半血狂暴，共 5 次转阶段 */
  readonly shield = new PhaseShield([...SK.summonAt, 0.5].sort((a, b) => b - a));
  private summoned = 0;
  private dashA = 0;
  private dashHit = new Set<number>();
  private chargesLeft = 0;
  private volley = 0;
  private volleyT = 0;
  private laserDir = 1;
  private windDur = 0.85;
  private contactCd = new Map<number, number>();
  private beamCd = new Map<number, number>();
  private focus: Target | null = null;
  private mc: MirrorContact;
  private mBeamCd = 0;
  private mWave = false;
  private mSlam = false;
  // 跃起
  private leapId = -1;
  private leapFrom = { x: 0, y: 0 };
  private leapTo = { x: 0, y: 0 };
  private leapTele: Telegraph | null = null;

  constructor(private w: World, e: Enemy, mirror = false) {
    this.e = e;
    this.mirror = mirror;
    this.mc = new MirrorContact(w, e);
    if (!mirror) {
      w.fxAll('sound', 'bossRoar', e.x, e.y, 1);
      w.fxAll('shake', 1);
    }
  }

  get name(): string {
    return MAMBA.name;
  }

  stateIndex(): number {
    return MAMBA_STATES.indexOf(this.state);
  }

  phaseInfo(): { phase: number; total: number } {
    return { phase: 1, total: 1 };
  }

  private set(s: MambaState): void {
    this.state = s;
    this.stateT = 0;
  }

  /** 过场动画中与耐久战里免疫一切伤害 */
  immune(): boolean {
    return this.final || CINE_STATES.has(this.state);
  }

  airborne(): boolean {
    return this.state === 'leap';
  }

  timer(): number {
    if (!this.final) return -1;
    if (!this.mirror && this.state !== 'roar') return Math.max(0, this.finalT);
    return MAMBA_CINE.finalTime * Math.max(0, this.e.hp) / Math.max(1, this.e.maxHp);
  }

  /** 房主：第一次生命归零时倒地，开始过场动画 */
  preventDeath(): boolean {
    if (this.final) return true;
    if (CINE_STATES.has(this.state)) { this.e.hp = 0; return true; }
    const e = this.e;
    e.hp = 0;
    e.vx = e.vy = e.kx = e.ky = 0;
    this.telegraphs = [];
    this.chargesLeft = 0;
    this.volley = 0;
    this.leapTele = null;
    this.throwPose = 0;
    this.set('down');
    // 所有玩家同时开始过场动画（world.startCine）
    this.w.fxAll('cine');
    return true;
  }

  onDamaged(e: Enemy, amt: number): void {
    if (!this.enraged && e.hp < e.maxHp * 0.5) {
      this.enraged = true;
      this.w.fxAll('banner', '曼巴僵尸狂暴化', '激光更多、冲撞连发，攻击更加凶猛', '#ff3a3a');
      this.w.fxAll('sound', 'bossRoar', e.x, e.y, 1);
      this.w.fxAll('voice', VO.cantWrite);
      this.w.fxAll('shake', 1);
    }
    void amt;
  }

  applyState(state: number, anim: number, enraged: boolean, throwPose: number, tele: number[][], fin = 0): void {
    this.state = MAMBA_STATES[state] ?? 'chase';
    this.anim = anim;
    this.enraged = enraged;
    this.throwPose = throwPose;
    this.final = !!fin;
    this.telegraphs = tele.map(decodeTele);
    this.clipBeams();
  }

  tickTelegraphs(dt: number): void {
    this.telegraphs = tickTeles(this.telegraphs, dt, this.e);
    this.clipBeams();
    if (this.mirror && this.state === 'windCharge') {
      const tg = this.telegraphs.find((t) => t.kind === 'line' && !t.follow);
      if (tg) { tg.x = this.e.x; tg.y = this.e.y; tg.a = this.e.face; }
    }
  }

  /** 激光被高大的障碍物（柱子、墙、看台）挡住 */
  private clipBeams(): void {
    const col = this.w.col;
    for (const t of this.telegraphs) {
      if (t.kind !== 'beam' && !(t.kind === 'line' && t.follow)) continue;
      const ex = t.x + Math.cos(t.a) * SK.laserLen, ey = t.y + Math.sin(t.a) * SK.laserLen;
      const k = col.raycast(t.x, t.y, ex, ey, 0, undefined, 1.0);
      t.len = k >= 0 ? Math.max(this.e.r, SK.laserLen * k) : SK.laserLen;
    }
  }

  /** 房主只结算自己，其他玩家在本地判定（见 mirrorHits） */
  private hit(t: Target, dmg: number, kx: number, ky: number): boolean {
    const w = this.w;
    if (!t.local) return false;
    if (!w.damagePlayer(dmg, this.e.x, this.e.y, this.e.id)) return false;
    w.player.kx += kx;
    w.player.ky += ky;
    return true;
  }

  /** 镜像模式：本地判定冲撞、接触、激光、冲击波与跃起落地（第4.1 / 4.3次调整） */
  mirrorHits(dt: number): void {
    const w = this.w, e = this.e, p = w.player;
    const cine = CINE_STATES.has(this.state);
    if (!cine && this.state !== 'leap') this.mc.update(dt, this.state === 'charge', 16, 9);
    if (this.mBeamCd > 0) this.mBeamCd -= dt;
    const ring = this.telegraphs.some((t) => t.kind === 'ring');
    if (!ring) this.mWave = false;
    const slam = this.telegraphs.find((t) => t.kind === 'slam');
    if (!slam) this.mSlam = false;
    if (cine || e.dead || !w.phaseActive() || !w.localTargetable()) return;
    if (slam && !this.mSlam) {
      this.mSlam = true;
      const ox = p.x - slam.x, oy = p.y - slam.y;
      const dd = Math.hypot(ox, oy) || 0.01;
      if (dd <= slam.r + p.r && w.damagePlayer(e.atk * SK.leapDmg, slam.x, slam.y, e.id)) {
        p.kx += (ox / dd) * SK.leapKnock; p.ky += (oy / dd) * SK.leapKnock;
        w.fx.shake(0.6);
      }
    }
    const ox = p.x - e.x, oy = p.y - e.y;
    if (ring && !this.mWave) {
      this.mWave = true;
      const dd = Math.hypot(ox, oy) || 0.01;
      if (dd <= SK.waveRadius + p.r) {
        // 强制击退：即使处于无敌时间也会被推开
        w.damagePlayer(e.atk * 0.5, e.x, e.y, e.id);
        p.kx += (ox / dd) * SK.waveKnock; p.ky += (oy / dd) * SK.waveKnock;
      }
    }
    if (this.state !== 'laser' || this.mBeamCd > 0) return;
    for (const b of this.telegraphs) {
      if (b.kind !== 'beam') continue;
      const c = Math.cos(b.a), s = Math.sin(b.a);
      const along = ox * c + oy * s;
      if (along < e.r * 0.5 || along > b.len + p.r) continue;
      const perp = -ox * s + oy * c;
      if (Math.abs(perp) > b.r + p.r) continue;
      this.mBeamCd = 0.4;
      const side = perp >= 0 ? 1 : -1;
      if (w.damagePlayer(e.atk * 0.32, e.x, e.y, e.id)) { p.kx += -s * side * 7; p.ky += c * side * 7; }
      break;
    }
  }

  /** 过场动画：倒地 → 爬起 → 怒吼（生命条重新填满）→ 耐久战 */
  private updateCine(e: Enemy, dt: number): void {
    const C = MAMBA_CINE;
    e.vx = e.vy = 0;
    e.kx = e.ky = 0;
    e.phase += dt * 2;
    switch (this.state) {
      case 'down':
        this.anim = 5;
        this.throwPose = 0;
        if (this.stateT >= C.down) this.set('rise');
        break;
      case 'rise':
        this.anim = 6;
        this.throwPose = clamp(this.stateT / C.rise, 0, 1);
        if (this.stateT >= C.rise) {
          this.set('roar');
          this.final = true;
          this.enraged = true;
          this.finalT = C.finalTime;
        }
        break;
      case 'roar':
        this.anim = 1;
        this.throwPose = 0;
        // 生命条重新填满（之后变为计时条）
        e.hp = e.maxHp * clamp(this.stateT / 1.0, 0, 1);
        if (this.stateT >= C.roar) {
          e.hp = e.maxHp;
          this.finalT = C.finalTime;
          this.set('chase');
          this.attackCd = 1.2;
          this.waveCd = 1.5;
        }
        break;
    }
  }

  /** 耐久战结束：曼巴僵尸力竭倒下 */
  private endure(e: Enemy): void {
    const w = this.w;
    this.telegraphs = [];
    e.hp = 0;
    w.fxAll('banner', '曼巴僵尸力竭倒下', '你们撑过了它最后的狂怒', '#ffd24a');
    w.enemies.kill(e);
  }

  updateAI(e: Enemy, dt: number): void {
    const w = this.w;
    this.stateT += dt;
    if (this.waveCd > 0) this.waveCd -= dt;
    for (const [k, v] of this.contactCd) if (v > 0) this.contactCd.set(k, v - dt);
    for (const [k, v] of this.beamCd) if (v > 0) this.beamCd.set(k, v - dt);
    this.tickTelegraphs(dt);
    if (CINE_STATES.has(this.state)) { this.updateCine(e, dt); return; }
    // 耐久战：生命条是计时条
    if (this.final) {
      if (w.phaseActive()) this.finalT -= dt;
      e.hp = e.maxHp * Math.max(0, this.finalT) / MAMBA_CINE.finalTime;
      if (this.finalT <= 0) { this.endure(e); return; }
    }
    const near = w.enemies.nearestTarget(e.x, e.y);
    if (this.state !== 'charge' || !this.focus) this.focus = near;
    const p = this.focus;
    const px = p ? p.x : e.x + Math.cos(e.face) * 5, py = p ? p.y : e.y + Math.sin(e.face) * 5;
    const dx = px - e.x, dy = py - e.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const toP = Math.atan2(dy, dx);
    const nearD = near ? Math.hypot(near.x - e.x, near.y - e.y) : 99;
    let vx = 0, vy = 0;
    const slow = e.slowT > 0 ? 0.85 : 1;
    const active = w.phaseActive();

    // 跃起在空中：沿弧线飞向红圈，落地时造成范围伤害
    if (this.state === 'leap') { this.updateLeap(e, dt); return; }

    // 召唤：每损失 1/5 生命召唤一批精英（耐久战里不再召唤）
    const frac = e.hp / e.maxHp;
    if (!this.final && (this.state === 'chase' || this.state === 'recover') && this.summoned < SK.summonAt.length && frac < SK.summonAt[this.summoned]) {
      this.summoned++;
      this.set('summon');
      w.fxAll('banner', '尸群响应了曼巴的召唤', '大批精英丧尸正在靠近', '#ff8a1a');
      w.fxAll('sound', 'bossRoar', e.x, e.y, 1);
    }
    // 冲击波：有玩家贴得太近时强制击退（不受普通技能冷却限制）
    if (active && (this.state === 'chase' || this.state === 'recover') && this.waveCd <= 0 && nearD < SK.waveRange + e.r) {
      this.set('windWave');
      this.telegraphs.push({ kind: 'circle', x: e.x, y: e.y, a: 0, len: 0, r: SK.waveRadius, t: 0, dur: this.waveWind(), dead: false, follow: true });
      w.fxAll('sound', 'bossRoar', e.x, e.y, 0.6);
    }

    switch (this.state) {
      case 'intro':
        this.anim = 1;
        if (this.stateT > 3) this.set('chase');
        break;
      case 'chase': {
        this.anim = 0;
        if (!p) break;
        const spd = MAMBA.speed * (this.enraged ? 1.3 : 1) * slow;
        let mx = dx / d, my = dy / d;
        if ((d > 4 || !w.col.lineOfSight(e.x, e.y, px, py)) && w.nav.dirAt(e.x, e.y, tmpV)) { mx = tmpV.x; my = tmpV.y; }
        vx = mx * spd; vy = my * spd;
        e.face += wrapAngle(toP - e.face) * damp(5, dt);
        this.attackCd -= dt;
        if (this.attackCd <= 0 && active) {
          const wCharge = d > 6 ? 0.32 : 0.18;
          const wLaser = this.enraged ? 0.42 : 0.34;
          // 耐久战：解锁跃起
          const wLeap = this.final ? (d > 8 ? 0.55 : 0.4) : 0;
          const pick = globalRng.weighted([['charge', wCharge], ['throw', 0.3], ['laser', wLaser], ['leap', wLeap]] as const);
          if (pick === 'charge') {
            this.chargesLeft = this.enraged ? 2 : 0;
            this.startCharge(e, toP, this.enraged ? 0.65 : 0.85);
          } else if (pick === 'throw') {
            this.set('windThrow');
          } else if (pick === 'leap') {
            this.leapId = p.id;
            this.set('windLeap');
            w.fxAll('sound', 'bossRoar', e.x, e.y, 0.7);
          } else {
            this.startLaser(e, toP);
          }
        }
        break;
      }
      case 'windCharge': {
        this.anim = 1;
        e.face += wrapAngle(toP - e.face) * damp(this.enraged ? 8 : 6, dt);
        const tg = this.telegraphs.find((t) => t.kind === 'line' && !t.follow);
        if (tg) { tg.x = e.x; tg.y = e.y; tg.a = e.face; }
        if (this.stateT >= this.windDur) {
          if (tg) tg.dead = true;
          this.telegraphs = this.telegraphs.filter((t) => !t.dead);
          this.dashA = e.face;
          this.dashHit.clear();
          this.set('charge');
          w.fxAll('sound', 'bossDash', e.x, e.y, 1);
          releaseVoice(w);
        }
        break;
      }
      case 'charge': {
        this.anim = 2;
        const sp = 21;
        vx = Math.cos(this.dashA) * sp;
        vy = Math.sin(this.dashA) * sp;
        if (globalRng.chance(0.7)) w.fx.smoke(e.x, e.y, 1);
        for (const t of w.targets) {
          if (this.dashHit.has(t.id)) continue;
          if (Math.hypot(t.x - e.x, t.y - e.y) < e.r + t.r + 0.5) {
            this.dashHit.add(t.id);
            if (this.hit(t, e.atk, Math.cos(this.dashA) * 16, Math.sin(this.dashA) * 16) && t.local) w.fx.shake(1);
          }
        }
        if (this.stateT > 1.0) this.afterCharge(e, toP);
        break;
      }
      case 'recover':
        this.anim = 4;
        if (this.stateT > (this.enraged ? 0.4 : 0.6)) this.set('chase');
        break;
      case 'land':
        // 落地后的硬直
        this.anim = 4;
        if (this.stateT > 0.7) { this.set('chase'); this.attackCd = this.cd(); }
        break;
      case 'stunned':
        this.anim = 4;
        if (this.stateT > 1.3) { this.set('chase'); this.attackCd = this.cd() * 0.6; }
        break;
      case 'windLeap': {
        // 下蹲蓄力，然后起跳
        this.anim = 1;
        e.face += wrapAngle(toP - e.face) * damp(8, dt);
        if (this.stateT >= SK.leapWind) this.startLeap(e, px, py);
        break;
      }
      case 'windThrow':
        this.anim = 3;
        this.throwPose = clamp(this.stateT / 0.45, 0, 1);
        e.face += wrapAngle(toP - e.face) * damp(6, dt);
        if (this.stateT >= 0.45) {
          this.volley = this.enraged ? 7 : 5;
          this.volleyT = 0;
          this.set('barrage');
          // v4.3.8：投掷石块时播放 8 号音效（每一轮投掷一次）
          w.fxAll('voice', VO.whatCanISay);
        }
        break;
      case 'barrage': {
        // 范围更大的连续投石，每一块都重新锁定玩家当前的位置
        this.anim = 3;
        e.face += wrapAngle(toP - e.face) * damp(8, dt);
        const gap = this.enraged ? 0.27 : 0.34;
        this.volleyT -= dt;
        this.throwPose = 0.4 + 0.6 * clamp(1 - this.volleyT / gap, 0, 1);
        if (this.volleyT <= 0 && this.volley > 0) {
          this.volley--;
          this.volleyT = gap;
          if (p) {
            const dur = 0.85 + Math.min(0.3, d / 40);
            throwRock(w, e, px + globalRng.range(-0.5, 0.5), py + globalRng.range(-0.5, 0.5), e.atk * 0.55, SK.rockAoe, dur, this.telegraphs);
          }
          this.throwPose = 0;
        }
        if (this.volley <= 0 && this.volleyT <= 0) { this.set('recover'); this.attackCd = this.cd(); }
        break;
      }
      case 'windLaser':
        this.anim = 1;
        if (this.stateT >= this.laserWind()) {
          // 预警线变成真正的激光
          const n = this.enraged ? 3 : 2;
          const base = this.telegraphs.find((t) => t.kind === 'line' && t.follow)?.a ?? e.face;
          this.telegraphs = this.telegraphs.filter((t) => !(t.kind === 'line' && t.follow));
          const dur = this.enraged ? 5 : 4.2;
          const wv = this.laserDir * (this.enraged ? 1.0 : 0.78);
          for (let i = 0; i < n; i++) {
            this.telegraphs.push({ kind: 'beam', x: e.x, y: e.y, a: base + (i / n) * Math.PI * 2, len: SK.laserLen, r: SK.laserHalfW, t: 0, dur, dead: false, w: wv, follow: true });
          }
          this.beamCd.clear();
          this.set('laser');
          w.fxAll('sound', 'bossLaser', e.x, e.y, 1);
          w.fxAll('voice', VO.noPass);
          w.fxAll('shake', 0.5);
        }
        break;
      case 'laser': {
        this.anim = 1;
        const beams = this.telegraphs.filter((t) => t.kind === 'beam');
        if (active) {
          for (const t of w.targets) {
            if ((this.beamCd.get(t.id) ?? 0) > 0) continue;
            const ox = t.x - e.x, oy = t.y - e.y;
            for (const b of beams) {
              const c = Math.cos(b.a), s = Math.sin(b.a);
              const along = ox * c + oy * s;
              if (along < e.r * 0.5 || along > b.len + t.r) continue;
              const perp = -ox * s + oy * c;
              if (Math.abs(perp) > b.r + t.r) continue;
              this.beamCd.set(t.id, 0.4);
              // 把玩家推出光束
              const side = perp >= 0 ? 1 : -1;
              this.hit(t, e.atk * 0.32, -s * side * 7, c * side * 7);
              break;
            }
          }
        }
        if (beams.length === 0 || this.stateT > 6) { this.set('recover'); this.attackCd = this.cd(); }
        break;
      }
      case 'windWave':
        this.anim = 1;
        if (this.stateT >= this.waveWind()) {
          this.telegraphs = this.telegraphs.filter((t) => !(t.kind === 'circle' && t.follow));
          this.telegraphs.push({ kind: 'ring', x: e.x, y: e.y, a: 0, len: 0, r: SK.waveRadius, t: 0, dur: 0.45, dead: false });
          w.fxAll('sound', 'bossWave', e.x, e.y, 1);
          releaseVoice(w);
          w.fxAll('shake', 0.9);
          w.fxAll('smoke', e.x, e.y, 16);
          if (active) {
            for (const t of w.targets) {
              const ox = t.x - e.x, oy = t.y - e.y;
              const dd = Math.hypot(ox, oy) || 0.01;
              if (dd > SK.waveRadius + t.r) continue;
              // 强制击退：即使处于无敌时间也会被推开
              const kx = (ox / dd) * SK.waveKnock, ky = (oy / dd) * SK.waveKnock;
              // 远程玩家在本地判定（见 mirrorHits）
              if (t.local) {
                w.damagePlayer(e.atk * 0.5, e.x, e.y, e.id);
                w.player.kx += kx; w.player.ky += ky;
              }
            }
          }
          this.waveCd = this.enraged ? 3.5 : 5;
          this.set('recover');
          this.attackCd = Math.max(this.attackCd, 1.2);
        }
        break;
      case 'summon':
        this.anim = 1;
        if (this.stateT > 1.4) {
          const n = 8;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + globalRng.range(-0.2, 0.2);
            const x = e.x + Math.cos(a) * 6, y = e.y + Math.sin(a) * 6;
            if (!w.nav.isFree(x, y)) continue;
            const r = globalRng.next();
            const tier = r < 0.15 ? 3 : r < 0.5 ? 2 : 1;
            const type = globalRng.pick(['office', 'runner', 'iron', 'spitter'] as const);
            w.enemies.spawn(type, x, y, tier);
            w.fxAll('smoke', x, y, 6);
          }
          w.fxAll('voice', VO.teammates);
          this.set('chase');
          this.attackCd = 1.6;
        }
        break;
    }

    // 移动与碰撞
    e.kx *= Math.max(0, 1 - 6 * dt);
    e.ky *= Math.max(0, 1 - 6 * dt);
    e.vx = vx; e.vy = vy;
    e.x += (vx + e.kx) * dt;
    e.y += (vy + e.ky) * dt;
    if (w.col.resolveCircle(e.x, e.y, e.r, tmpP)) {
      e.x = tmpP.x; e.y = tmpP.y;
      if (this.state === 'charge' && this.stateT > 0.12) {
        this.chargesLeft = 0;
        this.set('stunned');
        w.fxAll('shake', 1);
        w.fxAll('sound', 'bossSlam', e.x, e.y, 1);
        w.fxAll('smoke', e.x + Math.cos(this.dashA) * 1.6, e.y + Math.sin(this.dashA) * 1.6, 14);
        w.fxAll('toast', '曼巴撞墙眩晕！趁现在输出！', '#ffd24a');
      }
    }
    e.phase += dt * (2 + Math.hypot(vx, vy) * 1.4);

    // 接触伤害
    if (active) {
      for (const t of w.targets) {
        const dd = Math.hypot(t.x - e.x, t.y - e.y) || 0.01;
        if (dd >= e.r + t.r || (this.contactCd.get(t.id) ?? 0) > 0) continue;
        this.contactCd.set(t.id, 1.2);
        this.hit(t, e.atk, ((t.x - e.x) / dd) * 9, ((t.y - e.y) / dd) * 9);
      }
    }
  }

  /** 起跳：在目标玩家脚下放出红圈（预警比投石更长、范围更大） */
  private startLeap(e: Enemy, tx: number, ty: number): void {
    const w = this.w;
    this.leapFrom.x = e.x; this.leapFrom.y = e.y;
    this.leapTo.x = tx; this.leapTo.y = ty;
    this.leapTele = { kind: 'circle', x: tx, y: ty, a: 0, len: 0, r: SK.leapR, t: 0, dur: SK.leapAir, dead: false };
    this.telegraphs.push(this.leapTele);
    this.set('leap');
    w.fxAll('sound', 'bossDash', e.x, e.y, 1);
    releaseVoice(w);
    w.fxAll('smoke', e.x, e.y, 14);
    w.fxAll('shake', 0.5);
  }

  private updateLeap(e: Enemy, dt: number): void {
    const w = this.w;
    this.anim = 7;
    const k = clamp(this.stateT / SK.leapAir, 0, 1);
    // 瞄准：前一段时间红圈跟着目标玩家，之后锁定
    if (this.stateT < SK.leapAim) {
      const t = w.targets.find((x) => x.id === this.leapId);
      if (t) {
        this.leapTo.x = t.x; this.leapTo.y = t.y;
        if (this.leapTele) { this.leapTele.x = t.x; this.leapTele.y = t.y; }
      }
    }
    // 水平：先升空，再飞向红圈；高度：快速升起、悬停、急速落下
    const hk = clamp((k - 0.15) / 0.7, 0, 1);
    const s = hk * hk * (3 - 2 * hk);
    const nx = this.leapFrom.x + (this.leapTo.x - this.leapFrom.x) * s;
    const ny = this.leapFrom.y + (this.leapTo.y - this.leapFrom.y) * s;
    e.vx = (nx - e.x) / Math.max(1e-3, dt);
    e.vy = (ny - e.y) / Math.max(1e-3, dt);
    e.x = nx; e.y = ny;
    e.kx = e.ky = 0;
    this.throwPose = k < 0.25 ? 1 - (1 - k / 0.25) ** 2 : k < 0.85 ? 1 : 1 - ((k - 0.85) / 0.15) ** 2;
    if (k >= 1) this.land(e);
  }

  /** 落地：红圈范围内的玩家受到伤害并被震飞 */
  private land(e: Enemy): void {
    const w = this.w;
    e.x = this.leapTo.x; e.y = this.leapTo.y;
    e.vx = e.vy = 0;
    if (w.col.resolveCircle(e.x, e.y, e.r, tmpP)) { e.x = tmpP.x; e.y = tmpP.y; }
    this.throwPose = 0;
    if (this.leapTele) this.leapTele.dead = true;
    this.leapTele = null;
    this.telegraphs = this.telegraphs.filter((t) => !t.dead);
    this.telegraphs.push({ kind: 'slam', x: this.leapTo.x, y: this.leapTo.y, a: 0, len: 0, r: SK.leapR, t: 0, dur: 0.5, dead: false });
    w.fxAll('sound', 'bossSlam', e.x, e.y, 1);
    w.fxAll('sound', 'explosion', e.x, e.y, 1);
    w.fxAll('shake', 1.3);
    w.fxAll('smoke', e.x, e.y, 22);
    if (w.phaseActive()) {
      for (const t of w.targets) {
        const ox = t.x - this.leapTo.x, oy = t.y - this.leapTo.y;
        const dd = Math.hypot(ox, oy) || 0.01;
        if (dd > SK.leapR + t.r) continue;
        // 远程玩家在本地判定（见 mirrorHits）
        this.hit(t, e.atk * SK.leapDmg, (ox / dd) * SK.leapKnock, (oy / dd) * SK.leapKnock);
      }
    }
    this.set('land');
  }

  private startCharge(e: Enemy, toP: number, wind: number): void {
    this.set('windCharge');
    this.windDur = wind;
    this.telegraphs.push({ kind: 'line', x: e.x, y: e.y, a: toP, len: 20, r: 1.7, t: 0, dur: wind + 0.1, dead: false });
    this.w.fxAll('sound', 'bossRoar', e.x, e.y, 0.5);
  }

  private afterCharge(e: Enemy, toP: number): void {
    if (this.chargesLeft > 0) {
      // 狂暴后连续冲撞：重新瞄准，很短的预警
      this.chargesLeft--;
      this.startCharge(e, toP, 0.45);
      return;
    }
    this.set('recover');
    this.attackCd = this.cd();
  }

  private startLaser(e: Enemy, toP: number): void {
    this.set('windLaser');
    this.laserDir = globalRng.sign();
    const n = this.enraged ? 3 : 2;
    // 激光不会一开始就扫到正对着的玩家：从与玩家错开的角度开始
    const base = toP + Math.PI / n;
    for (let i = 0; i < n; i++) {
      this.telegraphs.push({ kind: 'line', x: e.x, y: e.y, a: base + (i / n) * Math.PI * 2, len: SK.laserLen, r: 0.35, t: 0, dur: this.laserWind() + 0.15, dead: false, w: this.laserDir * 0.25, follow: true });
    }
    this.w.fxAll('sound', 'vortex', e.x, e.y, 0.8);
    this.w.fxAll('voice', VO.noPass);
  }

  private laserWind(): number {
    return this.enraged ? 0.9 : 1.15;
  }

  private waveWind(): number {
    return this.enraged ? 0.55 : 0.75;
  }

  private cd(): number {
    return this.enraged ? globalRng.range(1.3, 2.2) : globalRng.range(2.0, 3.2);
  }
}
