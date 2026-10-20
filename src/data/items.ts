// 道具系统：每个区域在随机位置生成 15 个道具。可保留道具可以被暂时放在背包里。

import { Bullet, BULLETS, nextUid } from './bullets';
import { Gun } from './guns';
import type { Rng } from '../util/rng';

export type ItemId =
  | 'jar' | 'serumHp' | 'serumSpd' | 'part1' | 'part2' | 'purify' | 'gun' | 'valuable'
  | 'milkgold' | 'overheat' | 'painkiller' | 'kungfu' | 'eel';

export interface ItemDef {
  id: ItemId;
  name: string;
  desc: string;
  weight: number;
  size: number; // 占用背包单位
  keep: boolean; // 可保留（放进背包）
  usable: boolean; // 可主动使用
  color: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  jar: { id: 'jar', name: '大金币罐', desc: '占据 1 单位存储空间，到达安全屋后可换为 3250 币。', weight: 8, size: 1, keep: true, usable: false, color: '#ffd23a' },
  serumHp: { id: 'serumHp', name: '强化血清（生命）', desc: '拾取后立即生效：增加 25 生命值和上限。', weight: 10, size: 0, keep: false, usable: false, color: '#ff4a5a' },
  serumSpd: { id: 'serumSpd', name: '强化血清（脚力）', desc: '拾取后立即生效：增加 14% 移动速度。', weight: 10, size: 0, keep: false, usable: false, color: '#4affb0' },
  part1: { id: 'part1', name: '全局强化零件1型', desc: '使用后：现有的所有枪增加 0.25x 攻击倍率。', weight: 6, size: 1, keep: true, usable: true, color: '#ff9a3a' },
  part2: { id: 'part2', name: '全局强化零件2型', desc: '使用后：现有的所有枪减少 0.15s 换弹延迟。', weight: 6, size: 1, keep: true, usable: true, color: '#3ac8ff' },
  purify: { id: 'purify', name: '净化血清', desc: '使用后：减少辐射值。', weight: 7, size: 1, keep: true, usable: true, color: '#9aff4a' },
  gun: { id: 'gun', name: '枪械', desc: '可能自带几枚子弹，占用 4 单位背包。', weight: 14, size: 4, keep: true, usable: false, color: '#c9cfd6' },
  valuable: { id: 'valuable', name: '贵重品', desc: '占据 1 单位存储空间，到达安全屋后可以免费在祭坛加点一次。', weight: 7, size: 1, keep: true, usable: false, color: '#e07aff' },
  milkgold: { id: 'milkgold', name: '奶白金', desc: '使用后：获得 9 秒无敌。', weight: 6, size: 1, keep: true, usable: true, color: '#fff6d8' },
  overheat: { id: 'overheat', name: '过热模块', desc: '使用后：现有的所有枪增加 3.00x 攻击倍率，持续 9 秒。', weight: 6, size: 1, keep: true, usable: true, color: '#ff4a1a' },
  painkiller: { id: 'painkiller', name: '止痛药', desc: '使用后：回复 60% 最大生命值的生命。', weight: 10, size: 1, keep: true, usable: true, color: '#ffffff' },
  kungfu: { id: 'kungfu', name: '下盘功夫', desc: '拾取后立即生效：受到的后坐力影响 -10%。', weight: 5, size: 0, keep: false, usable: false, color: '#c8a070' },
  eel: { id: 'eel', name: '鳗', desc: '使用后：增加 160% 移动速度，持续 9 秒。', weight: 5, size: 1, keep: true, usable: true, color: '#5a9aff' },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

/** 大金币罐在安全屋兑换的金币（第2版：8250 → 2000；第3次调整：→ 3250） */
export const JAR_VALUE = 3250;

/** 道具效果的标准数值（第3次调整：零件2型 0.20s → 0.15s，下盘功夫 18% → 10%） */
export const ITEM_VALUES = {
  serumHp: 25, // 生命值和上限
  serumSpd: 14, // 移动速度 %
  part1: 0.25, // 攻击倍率
  part2: 0.15, // 换弹延迟（秒）
  kungfu: 10, // 后坐力影响 %
  painkiller: 60, // 回复最大生命 %
  buffTime: 9, // 奶白金 / 过热模块 / 鳗 的持续时间
  overheat: 3, // 过热模块的攻击倍率
  eel: 160, // 鳗的移动速度 %
};

/**
 * 第3次调整：以下五种道具在地图中生成时，有 35% 的概率带有“高级”前缀、15% 的概率带有“顶级”前缀
 * （两者分别判定、不叠加，顶级顶替高级），强化数额分别 ×1.25 / ×1.6。
 */
export const GRADE_ITEMS: ItemId[] = ['serumHp', 'serumSpd', 'part1', 'part2', 'kungfu'];
export const ITEM_GRADE = { names: ['', '高级', '顶级'], mul: [1, 1.25, 1.6], chance: [0, 0.35, 0.15], color: ['', '#9ad8ff', '#ffd24a'] };

export function rollGrade(id: ItemId, rng: Rng): number {
  if (!GRADE_ITEMS.includes(id)) return 0;
  const hi = rng.chance(ITEM_GRADE.chance[1]);
  const top = rng.chance(ITEM_GRADE.chance[2]);
  return top ? 2 : hi ? 1 : 0;
}

export interface Consumable {
  uid: number;
  kind: 'item';
  id: ItemId;
  power: number; // 例如净化血清的数值（取决于拾取区域）
  grade?: number; // 0 无 / 1 高级 / 2 顶级
}

/** 带前缀的道具的实际强化数额 */
export function itemValue(it: Consumable): number {
  const base = (ITEM_VALUES as Record<string, number>)[it.id] ?? 0;
  return base * ITEM_GRADE.mul[it.grade ?? 0];
}

const trim = (v: number, d: number) => String(Number(v.toFixed(d)));

/** 道具效果描述（含前缀加成后的实际数值） */
export function itemEffect(it: Consumable): string {
  const v = itemValue(it);
  switch (it.id) {
    case 'serumHp': return `拾取后立即生效：增加 ${trim(v, 1)} 生命值和上限。`;
    case 'serumSpd': return `拾取后立即生效：增加 ${trim(v, 1)}% 移动速度。`;
    case 'part1': return `使用后：现有的所有枪增加 ${trim(v, 3)}x 攻击倍率。`;
    case 'part2': return `使用后：现有的所有枪减少 ${trim(v, 3)}s 换弹延迟。`;
    case 'kungfu': return `拾取后立即生效：受到的后坐力影响 -${trim(v, 1)}%。`;
    case 'purify': return it.power ? `使用后：减少 ${it.power}K 辐射值。` : ITEMS.purify.desc;
    default: return ITEMS[it.id].desc;
  }
}

export interface GoldStack {
  uid: number;
  kind: 'gold';
  amount: number;
}

/** 奇物（第4.1次调整）：奇物宝箱掉落，捡起后所有玩家各自选择一个增益 */
export interface RelicThing {
  uid: number;
  kind: 'relic';
}

export type BagItem = Gun | Bullet | Consumable;
export type WorldThing = BagItem | GoldStack | RelicThing;

export function makeConsumable(id: ItemId, power = 0, grade = 0): Consumable {
  const c: Consumable = { uid: nextUid(), kind: 'item', id, power };
  if (grade) c.grade = grade;
  return c;
}

/** 道具显示名（带高级 / 顶级前缀） */
export function consumableName(it: Consumable): string {
  const g = it.grade ?? 0;
  return g ? `${ITEM_GRADE.names[g]} ${ITEMS[it.id].name}` : ITEMS[it.id].name;
}

export function itemSize(it: BagItem): number {
  if (it.kind === 'gun') return 4;
  if (it.kind === 'bullet') return 1;
  return ITEMS[it.id].size;
}

export function itemName(it: WorldThing): string {
  if (it.kind === 'gun') return `${it.model} ${it.name}`;
  if (it.kind === 'bullet') return BULLETS[it.def].name;
  if (it.kind === 'gold') return `${it.amount} 金币`;
  if (it.kind === 'relic') return '奇物';
  return consumableName(it);
}

/** 快捷栏使用顺序（数字键 1~7） */
export const QUICK_ORDER: ItemId[] = ['painkiller', 'milkgold', 'overheat', 'eel', 'purify', 'part1', 'part2'];
