// 地面上的金币与物品。
// 第2版：
// - 地图生成的道具（以及丧尸掉落）只要经过就会自动拾取；玩家自己丢下的物品需要按 F 拾取。
// - 金币从全图吸取（第4.3次调整：联机时也是全图）。金币在每个玩家本地各自生成
//   （击杀者 100%，其他玩家 25%），因此不会出现重复吸取同一枚金币的问题。
// - 联机时地面物品由房主裁决归属：非房主拾取前需要先向房主申请。
// 第4.1次调整：奇物——任意玩家捡起后，所有玩家各自从三个增益中选择一个；1 秒内拾取的金币合并成一个跳字。
// 第4.3次调整：地图生成的 15 个道具每名玩家都可以各拿一次（每个人在本地拾取，不需要房主裁决）；
// 丧尸被杀死时有概率掉落的地图道具也一样（v4.3.6）。精英掉落的子弹、招财弹的道具、玩家丢下的物品仍然只能被一个人拿走。

import { PLAYER } from '../config';
import { randomBullet } from '../data/bullets';
import { makeGun, rollRarity } from '../data/guns';
import { BagItem, ITEMS, ItemId, ITEM_IDS, makeConsumable, WorldThing, itemSize, itemName, itemValue, rollGrade, consumableName } from '../data/items';
import { globalRng, Rng } from '../util/rng';
import type { World } from './world';

export interface Coin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  amount: number;
  dead: boolean;
  age: number;
  blockT: number;
}

export interface WorldItem {
  uid: number;
  thing: WorldThing;
  x: number;
  y: number;
  dead: boolean;
  age: number;
  seen: boolean;
  auto: boolean; // 经过即可自动拾取（地图生成 / 丧尸掉落）
  pending: number; // 联机：正在向房主申请拾取
  failT: number; // 自动拾取失败（背包满）后的冷却
  map?: boolean; // 地图道具（区域开始时生成的 15 个，以及丧尸有概率掉落的）：联机时每名玩家都可以各拿一次
}

export class Pickups {
  coins: Coin[] = [];
  items: WorldItem[] = [];
  private fullToastT = 0;

  constructor(private w: World) {}

  clear(): void {
    this.coins = [];
    this.items = [];
  }

  dropGold(x: number, y: number, amount: number): void {
    if (this.coins.length > 420) {
      // 合并到附近的金币上
      let best: Coin | null = null, bd = 9;
      for (const c of this.coins) {
        if (c.dead) continue;
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      if (best) { best.amount += amount; return; }
    }
    const a = globalRng.range(0, Math.PI * 2), s = globalRng.range(0.5, 2.2);
    this.coins.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, z: 0.6, vz: 3, amount, dead: false, age: 0, blockT: 0 });
  }

  /** 在地上放一个物品。local = 本地产生（需要广播给其他玩家）；uid 由联机消息指定时直接使用 */
  dropThing(thing: WorldThing, x: number, y: number, auto = false, uid?: number, local = true): WorldItem {
    const it: WorldItem = { uid: uid ?? this.w.newItemUid(), thing, x, y, dead: false, age: 0, seen: true, auto, pending: 0, failT: 0 };
    this.items.push(it);
    if (local) this.w.net?.itemDropped(it, thing);
    return it;
  }

  /** v4.3.6：丧尸掉落的地图道具——和区域开始时生成的一样，联机时每名玩家都可以各拿一次（由房主或单人时调用） */
  dropMapThing(thing: WorldThing, x: number, y: number): WorldItem {
    const it = this.dropThing(thing, x, y, true, undefined, false);
    it.map = true;
    this.w.net?.itemDropped(it, thing);
    return it;
  }

  /** 一件随机的地图道具：权重与区域开始时生成的相同（招财弹、丧尸掉落也用它） */
  randomZoneItem(rng: Rng): BagItem {
    const cfg = this.w.layout.cfg;
    const id = rng.weighted(ITEM_IDS.map((k) => [k, ITEMS[k].weight] as const));
    return this.makeItem(id, rng, cfg.index, cfg.gunRarityW, cfg.purify);
  }

  /** 每个区域在随机位置生成 15 个道具（所有玩家用同一个随机种子生成，编号一致） */
  spawnZoneItems(rng: Rng): void {
    const w = this.w;
    const cfg = w.layout.cfg;
    const spots = w.layout.itemSpots.slice();
    rng.shuffle(spots);
    const n = Math.min(15, spots.length);
    for (let i = 0; i < n; i++) {
      const thing = this.randomZoneItem(rng);
      const s = spots[i];
      this.items.push({ uid: cfg.index * 1000 + i, thing, x: s.x, y: s.y, dead: false, age: rng.range(0, 5), seen: false, auto: true, pending: 0, failT: 0, map: true });
    }
  }

  makeItem(id: ItemId, rng: Rng, zone: number, rarityW: readonly number[], purify: number): BagItem {
    if (id === 'gun') {
      const g = makeGun(rollRarity(rng, rarityW), rng);
      const nb = Math.min(g.cap, rng.int(1, 4));
      for (let i = 0; i < nb; i++) g.bullets[i] = randomBullet(rng);
      return g;
    }
    void zone;
    // 第3次调整：部分强化道具可能带有高级 / 顶级前缀
    return makeConsumable(id, id === 'purify' ? purify : 0, rollGrade(id, rng));
  }

  update(dt: number): void {
    const w = this.w;
    const p = w.player;
    const run = w.run;
    this.fullToastT -= dt;
    const mag = w.goldMagnet();
    const collect = w.canCollect();
    for (const c of this.coins) {
      if (c.dead) continue;
      c.age += dt;
      if (c.blockT > 0) c.blockT -= dt;
      // 弹跳落地
      if (c.z > 0 || c.vz > 0) {
        c.vz -= 14 * dt;
        c.z += c.vz * dt;
        if (c.z <= 0) { c.z = 0; c.vz = c.vz < -2 ? -c.vz * 0.35 : 0; }
      }
      const dx = p.x - c.x, dy = p.y - c.y;
      const d = Math.hypot(dx, dy) || 0.001;
      if (d < mag && c.blockT <= 0 && c.age > 0.25 && collect) {
        const room = run.goldRoom();
        if (room <= 0) {
          c.blockT = 1;
          if (this.fullToastT <= 0) { this.fullToastT = 4; w.fx.toast('背包已满，无法拾取金币', '#ff5a4a'); }
        } else {
          // 越远飞得越快（单人模式会从全图飞来）
          const sp = Math.min(42, 7 + d * 0.9 + Math.max(0, 3.2 - d) * 4);
          c.vx += ((dx / d) * sp - c.vx) * Math.min(1, 10 * dt);
          c.vy += ((dy / d) * sp - c.vy) * Math.min(1, 10 * dt);
          if (d < p.r + 0.35) {
            const take = Math.min(room, c.amount);
            run.gold += take;
            run.stats.goldEarned += take;
            c.amount -= take;
            w.fx.sound('coin', c.x, c.y, 0.4);
            w.fx.goldText(p.x, p.y, take);
            if (c.amount <= 0) c.dead = true;
            else c.blockT = 1;
          }
        }
      } else {
        c.vx *= Math.max(0, 1 - 5 * dt);
        c.vy *= Math.max(0, 1 - 5 * dt);
      }
      c.x += c.vx * dt;
      c.y += c.vy * dt;
    }
    if (this.coins.length > 200 && this.coins.some((c) => c.dead)) this.coins = this.coins.filter((c) => !c.dead);
    const ar = PLAYER.autoPickupRadius;
    const auto = collect && w.phase !== 'safehouse';
    for (const it of this.items) {
      if (it.dead) continue;
      it.age += dt;
      if (it.pending > 0) it.pending -= dt;
      if (it.failT > 0) it.failT -= dt;
      const d2 = (it.x - p.x) ** 2 + (it.y - p.y) ** 2;
      if (!it.seen && d2 < 22 * 22) it.seen = true;
      // 经过即拾取
      if (auto && it.auto && it.failT <= 0 && it.pending <= 0 && d2 < ar * ar) {
        if (!this.tryPickup(it, true)) it.failT = 2.5;
      }
    }
    if (this.items.length > 80 && this.items.some((i) => i.dead)) this.items = this.items.filter((i) => !i.dead);
  }

  nearestItem(x: number, y: number, r: number): WorldItem | null {
    let best: WorldItem | null = null, bd = r * r;
    for (const it of this.items) {
      if (it.dead) continue;
      const d = (it.x - x) ** 2 + (it.y - y) ** 2;
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  }

  find(uid: number): WorldItem | null {
    for (const it of this.items) if (it.uid === uid && !it.dead) return it;
    return null;
  }

  /** 背包能否放下这件物品；不能放下时返回原因 */
  private fitError(th: WorldThing): string | null {
    const run = this.w.run;
    if (th.kind === 'gold') return run.goldRoom() > 0 ? null : '背包已满，无法拾取金币';
    if (th.kind === 'relic') return null;
    if (th.kind === 'item' && !ITEMS[th.id].keep) return null;
    if (th.kind === 'gun' && (!run.guns[0] || !run.guns[1])) return null;
    const size = itemSize(th);
    return run.canFit(size) ? null : `背包空间不足（需要 ${size} 单位）`;
  }

  /** 拾取（自动或按 F）。联机的非房主会先向房主申请，申请通过后才真正放进背包 */
  tryPickup(it: WorldItem, quiet = false): boolean {
    const w = this.w;
    const err = this.fitError(it.thing);
    if (err) {
      if (!quiet || this.fullToastT <= 0) {
        if (quiet) this.fullToastT = 3;
        w.fx.sound('denied');
        w.fx.toast(err, '#ff5a4a');
      }
      return false;
    }
    // 第4.3次调整：地图道具每名玩家各拿一次，直接在本地拾取（不通知其他玩家，他们那里的这件道具还在）
    if (it.map) {
      it.dead = true;
      this.give(it.thing);
      return true;
    }
    if (w.net && !w.net.isHost) {
      if (it.pending > 0) return true;
      it.pending = 1.2;
      w.net.claimItem(it);
      return true;
    }
    it.dead = true;
    this.give(it.thing);
    w.net?.itemTaken(it.uid, w.myId);
    return true;
  }

  /** 兼容旧接口：按 F 拾取 */
  pickup(it: WorldItem): boolean {
    return this.tryPickup(it);
  }

  /** 房主裁决的结果：物品被某人拿走 */
  onTaken(uid: number, by: number): void {
    const w = this.w;
    const it = this.items.find((i) => i.uid === uid);
    if (!it || it.map) return;
    const was = !it.dead;
    it.dead = true;
    // 奇物：不管是谁捡起的，每个人都可以选择一个增益
    if (it.thing.kind === 'relic') {
      if (was || it.pending > 0) this.relicTaken(by === w.myId);
      return;
    }
    if (by === w.myId && (was || it.pending > 0)) {
      // 申请通过；若期间背包被占满，就重新丢回地上
      if (this.fitError(it.thing)) { this.dropThing(it.thing, w.player.x, w.player.y, false); w.fx.toast('背包空间不足，物品掉在了脚下', '#ff5a4a'); return; }
      this.give(it.thing);
    }
  }

  /** 房主：处理其他玩家的拾取申请 */
  hostClaim(uid: number): boolean {
    const it = this.find(uid);
    if (!it) return false;
    // 地图道具每个人各有一份：房主自己的那份不受影响
    if (it.map) return true;
    it.dead = true;
    if (it.thing.kind === 'relic') this.relicTaken(false);
    return true;
  }

  /** 奇物被捡起：打开三选一 */
  private relicTaken(mine: boolean): void {
    const w = this.w;
    w.fx.toast(mine ? '你捡起了奇物：选择一个增益' : '队友捡起了奇物：选择一个增益', '#ffd24a');
    w.fx.sound('pickupBig');
    w.relicFx.grant();
  }

  onDenied(uid: number): void {
    const it = this.items.find((i) => i.uid === uid);
    if (it) { it.pending = 0; it.dead = true; }
  }

  /** 把物品交给本地玩家（立即生效的道具直接生效） */
  private give(th: WorldThing): void {
    const w = this.w;
    const run = w.run;
    const p = w.player;
    if (th.kind === 'relic') { this.relicTaken(true); return; }
    if (th.kind === 'gold') {
      const take = Math.min(run.goldRoom(), th.amount);
      run.gold += take;
      w.fx.sound('coin', p.x, p.y, 0.6);
      w.fx.goldText(p.x, p.y, take);
      if (take < th.amount) this.dropThing({ uid: 0, kind: 'gold', amount: th.amount - take }, p.x, p.y, false);
      return;
    }
    run.stats.itemsFound++;
    if (th.kind === 'item' && !ITEMS[th.id].keep) {
      // 立即生效的道具（数值含高级 / 顶级前缀的加成）
      const v = itemValue(th);
      const n = (x: number) => String(Number(x.toFixed(1)));
      if (th.id === 'serumHp') { run.maxHp += v; run.hp += v; w.fx.floatText(p.x, p.y, `生命上限 +${n(v)}`, '#ff6a7a'); }
      else if (th.id === 'serumSpd') { run.speedPct += v; w.fx.floatText(p.x, p.y, `移动速度 +${n(v)}%`, '#4affb0'); }
      else if (th.id === 'kungfu') { run.recoilResist = Math.min(0.8, run.recoilResist + v / 100); w.fx.floatText(p.x, p.y, `后坐力影响 -${n(v)}%`, '#e0c090'); }
      w.fx.sound('buff');
      w.fx.bagFlash();
      w.fx.toast(`获得 ${consumableName(th)}`, ITEMS[th.id].color);
      return;
    }
    // 空手时直接装备枪械
    if (th.kind === 'gun') {
      const slot: number = run.guns[0] ? (run.guns[1] ? -1 : 1) : 0;
      if (slot >= 0) {
        run.guns[slot as 0 | 1] = th;
        w.fx.sound('pickupBig');
        w.fx.bagFlash();
        w.fx.toast(`装备 ${itemName(th)}（${slot === 0 ? '主手' : '副手'}）`, '#ffffff');
        return;
      }
    }
    run.bag.push(th);
    w.fx.sound(th.kind === 'gun' ? 'pickupBig' : 'pickup');
    w.fx.bagFlash();
    w.fx.toast(`拾取 ${itemName(th)}`, th.kind === 'item' ? ITEMS[th.id].color : '#ffffff');
  }
}

