// 安全屋：商店（4 把枪 + 5 枚子弹，可刷新）与祭坛（属性提升），以及出售（自定）。

import { ALTAR, AltarId, altarCost, ZONES } from '../config';
import { Bullet, randomBullet } from '../data/bullets';
import { Gun, makeGun, rollRarity } from '../data/guns';
import { BagItem, ITEMS, JAR_VALUE } from '../data/items';
import { RunState } from './state';

export interface ShopEntry<T> {
  item: T;
  price: number;
  sold: boolean;
}

export interface ShopState {
  zone: number; // 该安全屋所属区域（决定祭坛数值、商店稀有度）
  guns: ShopEntry<Gun>[];
  bullets: ShopEntry<Bullet>[];
  refreshes: number;
}

export const REFRESH_COST = 600;

export function generateShop(run: RunState, zone: number): ShopState {
  const s: ShopState = { zone, guns: [], bullets: [], refreshes: 0 };
  restock(run, s);
  return s;
}

export function restock(run: RunState, s: ShopState): void {
  const rng = run.rng;
  // 商店不出 Rarity5：地图里 Rarity5 的权重原本是从 Rarity3 中扣除的，这里还给 Rarity3
  const zw = ZONES[Math.min(4, s.zone) - 1].gunRarityW;
  const w = [zw[0], zw[1], zw[2] + zw[4], zw[3], 0];
  s.guns = [];
  for (let i = 0; i < 4; i++) {
    let r = rollRarity(rng, w);
    // 商店中一定会出现一支至少 Rarity3 以上的枪械
    if (i === 3 && !s.guns.some((g) => g.item.rarity >= 3)) r = Math.max(3, r);
    const g = makeGun(r, rng);
    // 购买枪械的花费是（稀有度+1）*700 +（-1000~1000 的随机数）；枪械中不带有子弹
    const price = Math.max(300, (r + 1) * 700 + rng.int(-1000, 1000));
    s.guns.push({ item: g, price, sold: false });
  }
  rng.shuffle(s.guns);
  s.bullets = [];
  for (let i = 0; i < 5; i++) {
    s.bullets.push({ item: randomBullet(rng), price: rng.int(700, 1700), sold: false });
  }
}

export function refreshShop(run: RunState, s: ShopState): string | null {
  if (run.bank < REFRESH_COST) return '金币不足';
  run.bank -= REFRESH_COST;
  s.refreshes++;
  restock(run, s);
  return null;
}

export function buyGun(run: RunState, s: ShopState, i: number): string | null {
  const e = s.guns[i];
  if (!e || e.sold) return '已售出';
  if (run.bank < e.price) return '金币不足';
  // 空手时直接装备
  const slot: number = run.guns[0] ? (run.guns[1] ? -1 : 1) : 0;
  if (slot < 0 && !run.canFit(4)) return '背包空间不足（需要 4 单位）';
  run.bank -= e.price;
  e.sold = true;
  if (slot >= 0) run.guns[slot as 0 | 1] = e.item;
  else run.bag.push(e.item);
  return null;
}

export function buyBullet(run: RunState, s: ShopState, i: number): string | null {
  const e = s.bullets[i];
  if (!e || e.sold) return '已售出';
  if (run.bank < e.price) return '金币不足';
  if (!run.canFit(1)) return '背包空间不足';
  run.bank -= e.price;
  e.sold = true;
  run.bag.push(e.item);
  return null;
}

export function altarPrice(run: RunState): number {
  return run.freeAltar > 0 ? 0 : altarCost(run.altarCount);
}

export function altarValue(id: AltarId, zone: number): number {
  const o = ALTAR.find((a) => a.id === id)!;
  return o.values[Math.min(4, Math.max(1, zone)) - 1];
}

export function altarBuy(run: RunState, id: AltarId, zone: number): string | null {
  const free = run.freeAltar > 0;
  const cost = free ? 0 : altarCost(run.altarCount);
  if (!free && run.bank < cost) return '金币不足';
  if (id === 'recoil' && run.recoilResist >= 0.8) return '后坐力减免已达上限';
  const v = altarValue(id, zone);
  switch (id) {
    case 'hp': run.maxHp += v; run.hp += v; break;
    case 'spd': run.speedPct += v; break;
    case 'atk': run.addAtkAll(v); break;
    case 'cap': run.addCapAll(v); break;
    case 'recoil': run.recoilResist = Math.min(0.8, run.recoilResist + v / 100); break;
    case 'purify': run.rad = Math.max(0, run.rad - v); break;
    case 'bag': run.bagCap += v; break;
  }
  if (free) run.freeAltar--;
  else { run.bank -= cost; run.altarCount++; }
  return null;
}

/** 出售价格（自定）：约为购入价的三成 */
export function sellPrice(it: BagItem): number {
  if (it.kind === 'gun') {
    let p = (it.rarity + 2) * 230;
    for (const b of it.bullets) if (b) p += 380;
    return p;
  }
  if (it.kind === 'bullet') return 380;
  if (it.id === 'jar') return JAR_VALUE;
  if (it.id === 'valuable') return 600;
  return ITEMS[it.id].keep ? 300 : 0;
}

export function sellItem(run: RunState, uid: number): string | null {
  const it = run.bag.find((b) => b.uid === uid);
  if (!it) return '无效的操作';
  run.removeFromBag(uid);
  run.bank += sellPrice(it);
  return null;
}
