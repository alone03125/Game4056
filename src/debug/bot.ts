// 自动游玩 AI（用于无头平衡模拟与 ?bot=1 演示/测试）。

import type { World } from '../game/world';
import { NavGrid } from '../world/navgrid';
import { gunDps, gunStats, Gun } from '../data/guns';
import { BULLETS } from '../data/bullets';
import { bulletToSlot, equipFromBag } from '../game/inventory';
import { altarBuy, altarPrice, buyGun, buyBullet } from '../game/shop';
import type { WorldItem } from '../game/pickups';
import type { Enemy } from '../game/enemies';

function gunPotential(g: Gun): number {
  const s = gunStats(g);
  return (s.atk * g.cap) / ((g.cap - 1) * g.delay + g.reload);
}

export class Bot {
  private nav: NavGrid | null = null;
  private goalKey = '';
  private navT = 0;
  private shopDone = false;
  private stuckT = 0;
  private lastX = 0;
  private lastY = 0;
  private jitterA = 0;
  private jitterT = 0;
  private giveUp = new Set<number>();
  private committed: WorldItem | null = null;
  threat = 0;
  private prevX = 0;
  private prevY = 0;

  constructor(private w: World) {}

  reset(): void {
    this.nav = null;
    this.goalKey = '';
  }

  update(dt: number): void {
    const w = this.w;
    const run = w.run;
    const p = w.player;
    const L = w.layout;
    if (this.nav && (this.nav as any).__layout !== L) this.nav = null;
    let gx = 0, gy = 0, key = '';
    if (w.phase === 'safehouse') {
      if (!this.shopDone) { this.shopDone = true; if (w.shop) this.safehouseBuy(); }
      const room = L.prevRoom!;
      const tr = room.exitTrigger;
      gx = (tr.x0 + tr.x1) / 2; gy = (tr.y0 + tr.y1) / 2 - 0.5; key = 'exit';
      // 第五区的安全屋：捡起地上的净化血清
      const loot = run.canFit(1) ? w.pickups.items.find((it) => !it.dead && !this.giveUp.has(it.uid)) : undefined;
      if (loot) {
        gx = loot.x; gy = loot.y - 0.6; key = 'loot' + loot.uid;
        if (Math.hypot(p.x - loot.x, p.y - loot.y) < 1.8 && !w.pickups.pickup(loot)) this.giveUp.add(loot.uid);
      }
      // 第2版：先去防护服柜换上高一阶的防护服
      if (w.suitOffer()) {
        const s = room.suit;
        gx = s.x; gy = s.y - 1.3; key = 'suit';
        if (Math.hypot(p.x - s.x, p.y - s.y) < 1.5) w.takeSuit();
      } else if (run.hp < run.maxHp - 0.5) {
        // 第3次调整：去医疗箱回满生命
        const m = room.medkit;
        gx = m.x; gy = m.y - 1.2; key = 'medkit';
        if (Math.hypot(p.x - m.x, p.y - m.y) < 1.5) w.useMedkit();
      }
    } else if (w.phase === 'boss' && w.bossEnemy) {
      gx = (L.rect.x0 + L.rect.x1) / 2; gy = (L.rect.y0 + L.rect.y1) / 2; key = 'arena';
    } else if (L.safeRoom && w.safeRoomOpen()) {
      const d = L.safeRoom.entranceDoor;
      gx = (d.x0 + d.x1) / 2; gy = d.y1 + 3; key = 'safe';
      this.shopDone = false;
    } else {
      gx = (L.rect.x0 + L.rect.x1) / 2; gy = L.rect.y0 + 20; key = 'bossin';
    }
    // 联机：去拉起倒地的队友（12 米内）
    let rescue = null as null | { x: number; y: number; id: number };
    if (w.net && p.standing && w.phaseActive()) {
      let bd = 12;
      for (const r of w.net.remotes()) {
        if (!r.downed || r.dead) continue;
        const d = Math.hypot(r.x - p.x, r.y - p.y);
        if (d < bd) { bd = d; rescue = r; }
      }
    }
    if (this.committed && (this.committed.dead || this.giveUp.has(this.committed.uid) || w.phase !== 'explore')) this.committed = null;
    if (!this.committed && w.phase === 'explore' && w.radLevel === 0 && this.threat < 3) {
      let bd = 12 * 12;
      for (const it of w.pickups.items) {
        if (it.dead || !it.seen || this.giveUp.has(it.uid)) continue;
        const d = (it.x - p.x) ** 2 + (it.y - p.y) ** 2;
        if (d < bd) { bd = d; this.committed = it; }
      }
    }
    const itemTarget = rescue ? null : this.committed;
    if (rescue) { gx = rescue.x; gy = rescue.y; key = 'rescue' + rescue.id; }
    else if (itemTarget) { gx = itemTarget.x; gy = itemTarget.y; key = 'item' + itemTarget.uid; }
    else if (w.phase === 'explore' || w.phase === 'boss') {
      let bc = 7 * 7;
      let coin: { x: number; y: number } | null = null;
      for (const c of w.pickups.coins) { if (c.dead || c.blockT > 0) continue; const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2; if (d < bc) { bc = d; coin = c; } }
      if (coin && run.goldRoom() > 0) { gx = coin.x; gy = coin.y; key = 'coin'; }
    }
    this.navT -= dt;
    if (!this.nav || key !== this.goalKey || this.navT <= 0) {
      if (!this.nav || this.navT <= 0) { this.nav = new NavGrid(L); (this.nav as any).__layout = L; }
      this.nav.computeFlow(gx, gy);
      this.goalKey = key;
      this.navT = 3;
    }
    let mx = 0, my = 0;
    const v = { x: 0, y: 0 };
    if (Math.hypot(gx - p.x, gy - p.y) < 1.2) { mx = gx - p.x; my = gy - p.y; }
    else if (this.nav.dirAt(p.x, p.y, v)) { mx = v.x; my = v.y; }
    else { mx = gx - p.x; my = gy - p.y; const l = Math.hypot(mx, my) || 1; mx /= l; my /= l; }
    // 转向：目标牵引 + 近距离丧尸排斥 + 避障
    let threat = 0;
    w.enemies.hash.queryRadius(p.x, p.y, 6, () => { threat++; });
    this.threat = threat;
    if (w.phase !== 'safehouse') {
      const gl = Math.hypot(mx, my) || 1;
      let dx = mx / gl, dy = my / gl;
      let rx = 0, ry = 0;
      const RR = 4.5;
      w.enemies.hash.queryRadius(p.x, p.y, RR + 1.5, (e, d2) => {
        const d = Math.sqrt(d2) - e.r;
        if (d > RR) return;
        // 第4次调整：点燃的苦力怕要躲远一点
        const k = Math.pow(Math.max(0, (RR - Math.max(0, d)) / RR), 2) * (e.type === 'boss' ? 4 : e.fuse >= 0 ? 5 : e.type === 'iron' ? 1.6 : e.elite ? 1.4 : 1);
        const l = Math.sqrt(d2) || 0.1;
        rx += ((p.x - e.x) / l) * k; ry += ((p.y - e.y) / l) * k;
      });
      for (const sh of w.enemies.shots) {
        if (sh.dead) continue;
        const tx = sh.kind === 'rock' ? sh.tx! : sh.x, ty = sh.kind === 'rock' ? sh.ty! : sh.y;
        const d = Math.hypot(p.x - tx, p.y - ty);
        const R = sh.kind === 'rock' ? sh.aoe! + 1.2 : 3.5;
        if (d < R) { rx += ((p.x - tx) / (d || 0.1)) * 2; ry += ((p.y - ty) / (d || 0.1)) * 2; }
      }
      // 避开毒雾 / 奇点，以及快要爆炸的炸弹（第2版：自己的子弹也会造成 5% 伤害）
      for (const hz of w.projs.hazards) {
        if (hz.dead || hz.pullOnly) continue;
        const d = Math.hypot(p.x - hz.x, p.y - hz.y);
        const R = (hz.kind === 'vortex' ? 2.5 : hz.r) + 1.2;
        if (d < R) { rx += ((p.x - hz.x) / (d || 0.1)) * 2.5; ry += ((p.y - hz.y) / (d || 0.1)) * 2.5; }
      }
      for (const pr of w.projs.list) {
        if (pr.dead || (pr.kind !== 'bomb' && pr.kind !== 'mine') || (pr.kind === 'bomb' && pr.age < 1.2)) continue;
        const d = Math.hypot(p.x - pr.x, p.y - pr.y);
        if (d < pr.area + 1) { rx += ((p.x - pr.x) / (d || 0.1)) * 2; ry += ((p.y - pr.y) / (d || 0.1)) * 2; }
      }
      for (const tg of w.boss?.telegraphs ?? []) {
        if (tg.kind === 'circle' && tg.follow) {
          // 冲击波：远离 Boss
          const d = Math.hypot(p.x - tg.x, p.y - tg.y);
          if (d < tg.r + 1.5) { rx += ((p.x - tg.x) / (d || 0.1)) * 4; ry += ((p.y - tg.y) / (d || 0.1)) * 4; }
          continue;
        }
        if (tg.kind !== 'line' && tg.kind !== 'beam') continue;
        const ux = Math.cos(tg.a), uy = Math.sin(tg.a);
        const qx = p.x - tg.x, qy = p.y - tg.y;
        const along = qx * ux + qy * uy, side = -qx * uy + qy * ux;
        if (along > -1 && along < tg.len && Math.abs(side) < tg.r + 1.5) { const sgn = side >= 0 ? 1 : -1; rx += -uy * sgn * 3; ry += ux * sgn * 3; }
      }
      const RW = Number((globalThis as any).BOT_DW) || 1.2;
      dx += rx * RW; dy += ry * RW;
      let l = Math.hypot(dx, dy) || 1;
      dx /= l; dy /= l;
      // 避障：被挡住时旋转寻找可走方向
      const base = Math.atan2(dy, dx);
      for (const off of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, 3.14]) {
        const a = base + off;
        const cx = Math.cos(a), cy = Math.sin(a);
        if (w.nav.isFree(p.x + cx * 0.9, p.y + cy * 0.9) && w.nav.isFree(p.x + cx * 1.8, p.y + cy * 1.8)) { dx = cx; dy = cy; break; }
      }
      // 平滑
      const sx = this.prevX * 0.55 + dx * 0.45, sy = this.prevY * 0.55 + dy * 0.45;
      l = Math.hypot(sx, sy) || 1;
      this.prevX = sx / l; this.prevY = sy / l;
      mx = this.prevX; my = this.prevY;
    }
    this.stuckT += dt;
    if (this.stuckT > 1.5 && Math.hypot(gx - p.x, gy - p.y) > 1.6) {
      if (Math.hypot(p.x - this.lastX, p.y - this.lastY) < 0.8) { this.jitterA = Math.random() * 6.28; this.jitterT = 0.8; }
      this.stuckT = 0; this.lastX = p.x; this.lastY = p.y;
    }
    if (this.jitterT > 0) { this.jitterT -= dt; mx += Math.cos(this.jitterA) * 1.5; my += Math.sin(this.jitterA) * 1.5; }
    const ml = Math.hypot(mx, my) || 1;
    w.input.moveX = mx / ml; w.input.moveY = my / ml;
    if (rescue && Math.hypot(rescue.x - p.x, rescue.y - p.y) < 1.4) {
      // 站定并按 F
      w.input.moveX = 0; w.input.moveY = 0;
      if (w.reviveTarget < 0) w.startRevive();
    }
    const be = w.bossEnemy;
    let tgt: Enemy | null = be && !be.dead && Math.hypot(be.x - p.x, be.y - p.y) < 18 ? be : null;
    if (!tgt) {
      let bs = 1e9;
      w.enemies.hash.queryRadius(p.x, p.y, 15, (e, d2) => {
        const d = Math.sqrt(d2);
        const sc = d + (e.type === 'iron' && d > 3 ? 7 : 0) - (e.type === 'spitter' ? 3 : 0);
        if (sc < bs) { bs = sc; tgt = e; }
      });
    }
    if (tgt) {
      const t: Enemy = tgt;
      w.input.aimX = t.x; w.input.aimY = t.y;
      // 联机：队友挡在射线上时不开火
      let blocked = false;
      if (w.net) {
        const ax = t.x - p.x, ay = t.y - p.y, al = Math.hypot(ax, ay) || 1;
        const ux = ax / al, uy = ay / al;
        for (const r of w.net.remotes()) {
          if (r.dead || r.downed) continue;
          const bx = r.x - p.x, by = r.y - p.y;
          const along = bx * ux + by * uy, lat = Math.abs(bx * uy - by * ux);
          if (along > 0 && along < 26 && lat < 1.3 + along * 0.3) { blocked = true; break; }
        }
      }
      w.input.fire = blocked ? [false, false] : [true, true];
      // 不要在贴脸时打出爆炸类子弹（会炸到自己）
      const dT = Math.hypot(t.x - p.x, t.y - p.y);
      for (let h = 0; h < 2; h++) {
        const g = run.guns[h];
        if (!g) continue;
        let k = p.hands[h].cursor;
        while (k < g.bullets.length && (!g.bullets[k] || BULLETS[g.bullets[k]!.def].logic)) k++;
        const nb = g.bullets[k];
        if (!nb) continue;
        const def = BULLETS[nb.def];
        if ((def.kind === 'rocket' || def.kind === 'bomb' || def.kind === 'singular') && dT < nb.rng / 2 + 2.5) w.input.fire[h] = false;
      }
    }
    else { w.input.aimX = p.x + w.input.moveX * 5; w.input.aimY = p.y + w.input.moveY * 5; w.input.fire = [false, false]; }
    if (itemTarget && Math.hypot(itemTarget.x - p.x, itemTarget.y - p.y) < 1.8) {
      if (!w.pickups.pickup(itemTarget)) this.giveUp.add(itemTarget.uid);
    }
    for (const it of [...run.bag]) {
      if (it.kind !== 'item') continue;
      if (it.id === 'part1' || it.id === 'part2') w.useItem(it.uid);
      else if (it.id === 'painkiller' && run.hp < run.maxHp * 0.4) w.useItem(it.uid);
      else if (it.id === 'milkgold' && run.hp < run.maxHp * 0.25) w.useItem(it.uid);
      else if (it.id === 'purify' && (w.radLevel >= 2 || (w.radLevel >= 1 && !L.isBoss) || (L.isBoss && run.rad > w.radThresh()[1] - 25))) w.useItem(it.uid);
      else if (it.id === 'overheat' && (w.phase === 'boss' || threat > 8)) w.useItem(it.uid);
      else if (it.id === 'eel' && threat > 10) w.useItem(it.uid);
    }
    for (const b of run.bulletsInBag()) {
      for (const g of run.guns) {
        if (!g) continue;
        const slot = g.bullets.findIndex((x) => !x);
        if (slot >= 0) { bulletToSlot(run, { from: 'bag', uid: b.uid }, g.uid, slot); break; }
      }
    }
    for (const it of [...run.bag]) {
      if (it.kind !== 'gun') continue;
      if (!run.guns[0] || !run.guns[1]) { equipFromBag(run, it.uid, run.guns[0] ? 1 : 0); continue; }
      const worst = gunDps(run.guns[0]) < gunDps(run.guns[1]) ? 0 : 1;
      if (gunDps(it) > gunDps(run.guns[worst]!) * 1.1) {
        const old = run.guns[worst]!;
        equipFromBag(run, it.uid, worst);
        old.bullets.forEach((b, i) => { if (b && i < it.cap && !it.bullets[i]) bulletToSlot(run, { from: 'slot', gunUid: old.uid, slot: i }, it.uid, i); });
      }
    }
  }

  private safehouseBuy(): void {
    const w = this.w;
    const run = w.run;
    const shop = w.shop!;
    let bestI = -1, best = 0;
    shop.guns.forEach((e, i) => { const v = gunPotential(e.item); if (e.price <= run.bank && v > best) { best = v; bestI = i; } });
    const g0 = run.guns[0], g1 = run.guns[1];
    const worstHand = !g0 ? 0 : !g1 ? 1 : gunPotential(g0) < gunPotential(g1) ? 0 : 1;
    const worstG = run.guns[worstHand];
    if (bestI >= 0 && (!worstG || best > gunPotential(worstG) * 1.25) && run.bank - shop.guns[bestI].price > 1500) {
      const g = shop.guns[bestI].item;
      if (!buyGun(run, shop, bestI) && worstG && run.bag.includes(g)) {
        equipFromBag(run, g.uid, worstHand);
        worstG.bullets.forEach((b, i) => { if (b && i < g.cap) bulletToSlot(run, { from: 'slot', gunUid: worstG.uid, slot: i }, g.uid, i); });
      }
    }
    for (let i = 0; i < shop.bullets.length; i++) {
      const free = run.guns.some((g) => g && g.bullets.some((b) => !b));
      if (free && shop.bullets[i].price < run.bank * 0.5) {
        if (!buyBullet(run, shop, i)) {
          const b = shop.bullets[i].item;
          for (const g of run.guns) { if (!g) continue; const s = g.bullets.findIndex((x) => !x); if (s >= 0) { bulletToSlot(run, { from: 'bag', uid: b.uid }, g.uid, s); break; } }
        }
      }
    }
    let guard = 0;
    while (guard++ < 30 && run.bank >= altarPrice(run)) {
      const id = run.maxHp < 100 + 45 * w.safehouseZone ? 'hp' : guard % 3 === 0 ? 'cap' : guard % 3 === 1 ? 'atk' : 'spd';
      if (altarBuy(run, id, w.safehouseZone)) break;
    }
  }
}
