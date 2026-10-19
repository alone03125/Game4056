// 背包与枪械改装操作（拖拽的逻辑部分）。所有函数返回 null 表示成功，否则返回失败原因。

import { Bullet } from '../data/bullets';
import { Gun } from '../data/guns';
import { BagItem, itemSize } from '../data/items';
import { RunState } from './state';

export function findGun(run: RunState, uid: number): Gun | null {
  for (const g of run.guns) if (g && g.uid === uid) return g;
  for (const it of run.bag) if (it.kind === 'gun' && it.uid === uid) return it;
  return null;
}

export function isEquipped(run: RunState, uid: number): number {
  if (run.guns[0]?.uid === uid) return 0;
  if (run.guns[1]?.uid === uid) return 1;
  return -1;
}

export type BulletSource = { from: 'bag'; uid: number } | { from: 'slot'; gunUid: number; slot: number };

function takeBullet(run: RunState, src: BulletSource): Bullet | null {
  if (src.from === 'bag') {
    const it = run.bag.find((b) => b.uid === src.uid);
    if (!it || it.kind !== 'bullet') return null;
    return it;
  }
  const g = findGun(run, src.gunUid);
  if (!g) return null;
  return g.bullets[src.slot] ?? null;
}

/** 把子弹放进某把枪的某个槽位（若槽位已有子弹则交换） */
export function bulletToSlot(run: RunState, src: BulletSource, gunUid: number, slot: number): string | null {
  const b = takeBullet(run, src);
  const g = findGun(run, gunUid);
  if (!b || !g || slot < 0 || slot >= g.cap) return '无效的操作';
  if (src.from === 'slot' && src.gunUid === gunUid && src.slot === slot) return null;
  const existing = g.bullets[slot];
  if (src.from === 'bag') {
    run.removeFromBag(b.uid);
    if (existing) run.bag.push(existing);
    g.bullets[slot] = b;
    return null;
  }
  const sg = findGun(run, src.gunUid)!;
  sg.bullets[src.slot] = existing ?? null;
  g.bullets[slot] = b;
  return null;
}

/** 把槽位中的子弹取回背包 */
export function slotToBag(run: RunState, gunUid: number, slot: number): string | null {
  const g = findGun(run, gunUid);
  if (!g) return '无效的操作';
  const b = g.bullets[slot];
  if (!b) return null;
  // 背包里的枪内部子弹不额外占空间；取出到背包需要 1 单位
  if (!run.canFit(1)) return '背包空间不足';
  g.bullets[slot] = null;
  run.bag.push(b);
  return null;
}

/** 从背包装备枪械到某只手（原有枪械放回背包，空间等价交换） */
export function equipFromBag(run: RunState, gunUid: number, hand: number): string | null {
  const it = run.bag.find((b) => b.uid === gunUid);
  if (!it || it.kind !== 'gun') return '无效的操作';
  const old = run.guns[hand];
  run.removeFromBag(gunUid);
  run.guns[hand] = it;
  if (old) run.bag.push(old);
  return null;
}

export function unequipToBag(run: RunState, hand: number): string | null {
  const g = run.guns[hand];
  if (!g) return null;
  if (!run.canFit(4)) return '背包空间不足（枪械需要 4 单位）';
  run.guns[hand] = null;
  run.bag.push(g);
  return null;
}

export function swapHands(run: RunState): void {
  const t = run.guns[0];
  run.guns[0] = run.guns[1];
  run.guns[1] = t;
}

/** 把整理后的子弹排列紧凑（去掉空槽间隙） */
export function compactGun(g: Gun): void {
  const list = g.bullets.filter((b): b is Bullet => !!b);
  for (let i = 0; i < g.bullets.length; i++) g.bullets[i] = list[i] ?? null;
}

export function bagItemSize(it: BagItem): number {
  return itemSize(it);
}
