// 背包与枪械改装操作（拖拽的逻辑部分）。所有函数返回 null 表示成功，否则返回失败原因。
// 第4.1次调整：
// - 安全屋里多了“临时整备区”（run.temp，不限格数），物品可以在背包、临时整备区与枪之间移动；
// - 拆卸模块会让载弹量减半：装填后的子弹数量超过实际载弹量时不允许装入；
// - 只能在安全屋里拆装枪械和子弹（由界面层判断）。

import { Bullet } from '../data/bullets';
import { effectiveCap, Gun, loadedCount } from '../data/guns';
import { BagItem, itemSize } from '../data/items';
import { RunState } from './state';

/** 物品所在的容器：背包 / 临时整备区 */
export type Holder = 'bag' | 'temp';

function holderList(run: RunState, h: Holder): BagItem[] {
  return h === 'bag' ? run.bag : run.temp;
}

export function findGun(run: RunState, uid: number): Gun | null {
  for (const g of run.guns) if (g && g.uid === uid) return g;
  for (const it of run.bag) if (it.kind === 'gun' && it.uid === uid) return it;
  for (const it of run.temp) if (it.kind === 'gun' && it.uid === uid) return it;
  return null;
}

export function isEquipped(run: RunState, uid: number): number {
  if (run.guns[0]?.uid === uid) return 0;
  if (run.guns[1]?.uid === uid) return 1;
  return -1;
}

/** 从容器里取出一件物品 */
export function takeFrom(run: RunState, h: Holder, uid: number): BagItem | null {
  const list = holderList(run, h);
  const i = list.findIndex((it) => it.uid === uid);
  return i < 0 ? null : list.splice(i, 1)[0];
}

export type BulletSource = { from: Holder; uid: number } | { from: 'slot'; gunUid: number; slot: number };

function peekBullet(run: RunState, src: BulletSource): Bullet | null {
  if (src.from !== 'slot') {
    const it = holderList(run, src.from).find((b) => b.uid === src.uid);
    return it && it.kind === 'bullet' ? it : null;
  }
  const g = findGun(run, src.gunUid);
  return g ? g.bullets[src.slot] ?? null : null;
}

/** 拆卸模块：装填后的数量不能超过实际载弹量 */
function capError(g: Gun, after: (Bullet | null)[]): string | null {
  const cap = effectiveCap(g.cap, after);
  return loadedCount(after) > cap ? `载弹量已满（实际载弹量 ${cap}）` : null;
}

/** 把子弹放进某把枪的某个槽位（若槽位已有子弹则交换；从容器拖来时，换下的子弹回到同一个容器） */
export function bulletToSlot(run: RunState, src: BulletSource, gunUid: number, slot: number): string | null {
  const b = peekBullet(run, src);
  const g = findGun(run, gunUid);
  if (!b || !g || slot < 0 || slot >= g.cap) return '无效的操作';
  if (src.from === 'slot' && src.gunUid === gunUid && src.slot === slot) return null;
  const existing = g.bullets[slot];
  if (src.from !== 'slot') {
    const after = g.bullets.slice();
    after[slot] = b;
    const err = capError(g, after);
    if (err) return err;
    takeFrom(run, src.from, b.uid);
    if (existing) holderList(run, src.from).push(existing);
    g.bullets[slot] = b;
    return null;
  }
  const sg = findGun(run, src.gunUid)!;
  if (sg === g) {
    const after = g.bullets.slice();
    after[src.slot] = existing ?? null;
    after[slot] = b;
    const err = capError(g, after);
    if (err) return err;
  } else {
    const afterT = g.bullets.slice();
    afterT[slot] = b;
    const afterS = sg.bullets.slice();
    afterS[src.slot] = existing ?? null;
    const err = capError(g, afterT) ?? capError(sg, afterS);
    if (err) return err;
  }
  sg.bullets[src.slot] = existing ?? null;
  g.bullets[slot] = b;
  return null;
}

/** 把槽位中的子弹取到背包 / 临时整备区 */
export function slotTo(run: RunState, gunUid: number, slot: number, to: Holder = 'bag'): string | null {
  const g = findGun(run, gunUid);
  if (!g) return '无效的操作';
  const b = g.bullets[slot];
  if (!b) return null;
  // 装在枪里的子弹不额外占空间；取出到背包需要 1 单位
  if (to === 'bag' && !run.canFit(1)) return '背包空间不足';
  g.bullets[slot] = null;
  holderList(run, to).push(b);
  return null;
}

export function slotToBag(run: RunState, gunUid: number, slot: number): string | null {
  return slotTo(run, gunUid, slot, 'bag');
}

/** 从容器装备枪械到某只手（原有枪械放回同一个容器；背包里是 4 格换 4 格） */
export function equipFrom(run: RunState, from: Holder, gunUid: number, hand: number): string | null {
  const it = holderList(run, from).find((b) => b.uid === gunUid);
  if (!it || it.kind !== 'gun') return '无效的操作';
  const old = run.guns[hand];
  takeFrom(run, from, gunUid);
  run.guns[hand] = it;
  if (old) holderList(run, from).push(old);
  return null;
}

export function equipFromBag(run: RunState, gunUid: number, hand: number): string | null {
  return equipFrom(run, 'bag', gunUid, hand);
}

export function unequipTo(run: RunState, hand: number, to: Holder = 'bag'): string | null {
  const g = run.guns[hand];
  if (!g) return null;
  if (to === 'bag' && !run.canFit(4)) return '背包空间不足（枪械需要 4 单位）';
  run.guns[hand] = null;
  holderList(run, to).push(g);
  return null;
}

export function unequipToBag(run: RunState, hand: number): string | null {
  return unequipTo(run, hand, 'bag');
}

/** 在背包与临时整备区之间移动物品 */
export function moveItem(run: RunState, uid: number, from: Holder, to: Holder): string | null {
  if (from === to) return null;
  const it = holderList(run, from).find((b) => b.uid === uid);
  if (!it) return '无效的操作';
  if (to === 'bag' && !run.canFit(itemSize(it))) return `背包空间不足（需要 ${itemSize(it)} 单位）`;
  takeFrom(run, from, uid);
  holderList(run, to).push(it);
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
