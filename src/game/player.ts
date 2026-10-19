// 玩家实体：移动、双枪射击循环、后坐力（减速 / 太空步 / 冲力）、受伤与增益。

import { PLAYER, RECOIL } from '../config';
import { Bullet, BULLETS, mysteryBullet, recoilOf } from '../data/bullets';
import { globalRng } from '../util/rng';
import { Gun, GunStats, gunSpeedMod, gunStats } from '../data/guns';
import type { CastMods } from './projectiles';
import { damp, wrapAngle } from '../util/math';
import type { World } from './world';

export interface HandState {
  cursor: number; // 下一发子弹的槽位
  cooldown: number;
  reloading: boolean;
  reloadTotal: number;
  firingT: number; // 距离上次射击的时间
  slow: number; // 当前减速比例
  pushX: number;
  pushY: number;
  auto: boolean;
  lastGunUid: number;
  shots: number;
}

export interface Input {
  moveX: number;
  moveY: number;
  aimX: number; // 世界坐标
  aimY: number;
  fire: [boolean, boolean];
}

const tmp = { x: 0, y: 0 };

export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  kx = 0; // 外力（击退）
  ky = 0;
  dashX = 0;
  dashY = 0;
  dashT = 0;
  r = PLAYER.radius;
  face = Math.PI / 2;
  iframe = 0;
  ffIframe = 0; // 友伤的独立无敌时间（不影响丧尸的伤害判定）
  walkPhase = 0;
  moving = 0;
  alive = true; // false = 本局阵亡（单人死亡 / 联机中没被拉起就进了安全屋）
  downed = false; // 联机：倒地，等待队友拉起
  hurtT = 0;
  hands: [HandState, HandState] = [makeHand(), makeHand()];
  stepT = 0;

  constructor(private w: World) {}

  place(x: number, y: number): void {
    this.x = x; this.y = y;
    this.vx = this.vy = this.kx = this.ky = this.dashX = this.dashY = 0;
    this.dashT = 0;
  }

  speed(): number {
    const run = this.w.run;
    // 第3次调整：装备中的枪械修饰语（笨重 -15% / 轻盈 +20%）
    const mod = Math.max(0.2, 1 + gunSpeedMod(run.guns[0]) + gunSpeedMod(run.guns[1]));
    return PLAYER.speed * (1 + run.speedPct / 100) * (run.eelT > 0 ? 2.6 : 1) * mod;
  }

  muzzle(hand: number, out: { x: number; y: number }): void {
    // 主手（右手）在朝向右侧，副手在左侧
    const side = hand === 0 ? -1 : 1;
    const c = Math.cos(this.face), s = Math.sin(this.face);
    const fwd = 0.75, lat = 0.32 * side;
    out.x = this.x + c * fwd - s * lat;
    out.y = this.y + s * fwd + c * lat;
  }

  get standing(): boolean {
    return this.alive && !this.downed;
  }

  /** allowAuto：安全屋里可以手动试枪，但自动射击不生效（第4次调整） */
  update(dt: number, inp: Input, canFire: boolean, allowAuto = true): void {
    const w = this.w;
    const run = w.run;
    if (!this.alive) return;
    if (this.iframe > 0) this.iframe -= dt;
    if (this.ffIframe > 0) this.ffIframe -= dt;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.downed) {
      // 倒地：无法移动和射击
      this.vx = this.vy = 0;
      this.kx *= Math.max(0, 1 - 7 * dt);
      this.ky *= Math.max(0, 1 - 7 * dt);
      this.moving = 0;
      for (const hs of this.hands) { hs.firingT += dt; hs.slow = 0; hs.pushX = 0; hs.pushY = 0; }
      return;
    }

    // 朝向鼠标
    const ta = Math.atan2(inp.aimY - this.y, inp.aimX - this.x);
    this.face += wrapAngle(ta - this.face) * damp(22, dt);

    // —— 射击 ——
    let slowMul = 1;
    let pushX = 0, pushY = 0;
    for (let h = 0; h < 2; h++) {
      const gun = run.guns[h];
      const hs = this.hands[h];
      hs.firingT += dt;
      if (!gun) { hs.cursor = 0; hs.cooldown = 0; hs.reloading = false; continue; }
      if (hs.lastGunUid !== gun.uid) {
        hs.lastGunUid = gun.uid;
        hs.cursor = 0;
        hs.cooldown = Math.max(hs.cooldown, 0.25);
        hs.reloading = false;
      }
      const trigger = canFire && (inp.fire[h] || (hs.auto && allowAuto));
      this.updateGun(h, gun, hs, dt, trigger);
      const st = gunStats(gun);
      // 射击中才会产生减速/推力
      if (hs.firingT < st.delay + 0.12) {
        slowMul *= 1 - hs.slow;
        pushX += hs.pushX;
        pushY += hs.pushY;
      }
    }
    slowMul = Math.max(1 - RECOIL.maxSlow, slowMul);

    // —— 移动 ——
    let mx = inp.moveX, my = inp.moveY;
    const ml = Math.hypot(mx, my);
    if (ml > 1) { mx /= ml; my /= ml; }
    const spd = this.speed() * slowMul;
    const k = damp(16, dt);
    this.vx += (mx * spd - this.vx) * k;
    this.vy += (my * spd - this.vy) * k;
    this.kx *= Math.max(0, 1 - 7 * dt);
    this.ky *= Math.max(0, 1 - 7 * dt);
    if (this.dashT > 0) {
      this.dashT -= dt;
      if (this.dashT <= 0) { this.dashX = 0; this.dashY = 0; }
    }
    const tvx = this.vx + this.kx + pushX + this.dashX;
    const tvy = this.vy + this.ky + pushY + this.dashY;
    // 分步移动避免高速穿墙
    const dist = Math.hypot(tvx, tvy) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.25));
    for (let i = 0; i < steps; i++) {
      this.x += (tvx * dt) / steps;
      this.y += (tvy * dt) / steps;
      if (w.col.resolveCircle(this.x, this.y, this.r, tmp)) {
        this.x = tmp.x; this.y = tmp.y;
        if (this.dashT > 0) { this.dashX *= 0.5; this.dashY *= 0.5; }
      }
    }
    this.moving = Math.min(1, Math.hypot(this.vx, this.vy) / 3);
    this.walkPhase += dt * Math.hypot(this.vx, this.vy) * 2.4;
    if (this.moving > 0.3) {
      this.stepT -= dt * Math.hypot(this.vx, this.vy);
      if (this.stepT <= 0) { this.stepT = 1.6; w.fx.sound('step', this.x, this.y, 0.2); }
    }
  }

  private updateGun(h: number, gun: Gun, hs: HandState, dt: number, trigger: boolean): void {
    const w = this.w;
    const run = w.run;
    if (hs.cooldown > 0) hs.cooldown -= dt;
    if (hs.reloading && hs.cooldown <= 0) {
      hs.reloading = false;
      hs.cursor = 0;
    }
    const tempAtk = run.overheatT > 0 ? 3 : 0;
    const st = gunStats(gun, tempAtk);
    if (st.loaded === 0) return;
    let guard = 0;
    const len = gun.bullets.length;
    while (trigger && hs.cooldown <= 0 && !hs.reloading && guard++ < 8) {
      // 一次“施放”：逻辑模块会累积到下一发子弹上，多重施放模块让接下来的多发同时射出
      let toCast = 1;
      let mods: CastMods = {};
      let fired = 0;
      let castGuard = 0;
      while (toCast > 0 && castGuard++ < 32) {
        while (hs.cursor < len && !gun.bullets[hs.cursor]) hs.cursor++;
        if (hs.cursor >= len) break;
        const b = gun.bullets[hs.cursor++]!;
        const lg = BULLETS[b.def].logic;
        if (lg) {
          if (lg.cast) toCast += lg.cast - 1;
          if (lg.homing) mods.homing = true;
          if (lg.pierce) mods.pierce = (mods.pierce ?? 0) + lg.pierce;
          if (lg.blast) mods.blast = true;
          if (lg.dmg) mods.dmg = (mods.dmg ?? 1) * lg.dmg;
          if (lg.speed) mods.speed = (mods.speed ?? 1) * lg.speed;
          if (lg.focus) mods.focus = (mods.focus ?? 0) + lg.focus;
          continue;
        }
        this.fireOne(h, hs, st, b, mods);
        mods = {};
        fired++;
        toCast--;
      }
      // 下一发
      while (hs.cursor < len && !gun.bullets[hs.cursor]) hs.cursor++;
      if (hs.cursor >= len) this.startReload(h, hs, st.reload);
      else hs.cooldown += st.delay;
      if (fired === 0) break;
    }
    if (hs.cooldown < -0.05) hs.cooldown = 0;
  }

  private fireOne(h: number, hs: HandState, st: GunStats, b: Bullet, mods: CastMods): void {
    const w = this.w;
    const run = w.run;
    // 第4次调整：盲盒在发射的瞬间随机变成其他任意子弹（数值也随机浮动）
    if (BULLETS[b.def].flags?.mystery) b = mysteryBullet(globalRng);
    this.muzzle(h, tmp);
    // 枪口在墙内时从身体中心发射
    let ox = tmp.x, oy = tmp.y;
    if (w.col.raycast(this.x, this.y, ox, oy, 0.05, undefined, 1.0) >= 0) { ox = this.x; oy = this.y; }
    const aim = Math.atan2(w.input.aimY - oy, w.input.aimX - ox);
    let aimAngle = Math.hypot(w.input.aimX - ox, w.input.aimY - oy) < 1.2 ? this.face : aim;
    if (st.reverse) {
      // 修饰语“凶险”：子弹朝身后射出（从身体后方发射，后坐力也随之反向）
      aimAngle += Math.PI;
      ox = this.x + Math.cos(aimAngle) * 0.55; oy = this.y + Math.sin(aimAngle) * 0.55;
      if (w.col.raycast(this.x, this.y, ox, oy, 0.05, undefined, 1.0) >= 0) { ox = this.x; oy = this.y; }
    }
    w.projs.fire(st, b, ox, oy, aimAngle, mods);
    w.fx.shoot(ox, oy, aimAngle, BULLETS[b.def], h);
    run.stats.shotsFired++;
    hs.shots++;
    hs.firingT = 0;
    // 后坐力
    const rc = recoilOf(b.rc * st.recoilMul, st.delay, run.recoilResist, RECOIL.t1, RECOIL.t2);
    hs.slow = 0; hs.pushX = 0; hs.pushY = 0;
    const bx = -Math.cos(aimAngle), by = -Math.sin(aimAngle);
    if (rc.tier === 'slow') hs.slow = rc.amount;
    else if (rc.tier === 'push') {
      const a = Math.min(RECOIL.maxPush, rc.amount);
      hs.pushX = bx * a; hs.pushY = by * a;
    } else if (rc.tier === 'dash') {
      const d = Math.min(RECOIL.maxDash, rc.amount);
      const T = 0.14;
      this.dashX += (bx * d) / T;
      this.dashY += (by * d) / T;
      this.dashT = T;
      w.fx.shake(0.25 + d * 0.04);
    }
  }

  startReload(h: number, hs: HandState, reload: number): void {
    hs.reloading = true;
    hs.cooldown = reload;
    hs.reloadTotal = reload;
    this.w.fx.sound('reload', this.x, this.y, 0.35);
    void h;
  }

  /** 手动换弹（R 键） */
  manualReload(): void {
    const run = this.w.run;
    for (let h = 0; h < 2; h++) {
      const g = run.guns[h];
      const hs = this.hands[h];
      if (!g || hs.reloading || hs.cursor === 0) continue;
      const st = gunStats(g);
      this.startReload(h, hs, st.reload);
    }
  }

  resetHands(): void {
    for (const hs of this.hands) {
      hs.cursor = 0; hs.cooldown = 0; hs.reloading = false; hs.slow = 0; hs.pushX = 0; hs.pushY = 0; hs.firingT = 9;
    }
  }
}

function makeHand(): HandState {
  return { cursor: 0, cooldown: 0, reloading: false, reloadTotal: 1, firingT: 9, slow: 0, pushX: 0, pushY: 0, auto: false, lastGunUid: -1, shots: 0 };
}
