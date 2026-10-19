// 子弹（弹药模块）目录。子弹是人为设计的，生成实例时其基础数值（攻击/弹速/大小/额外散射/后坐系数）
// 会各自随机进行 0.7~1.4 倍偏移。数值补正在装填进枪械时改变枪械本身的数据。

import { Rng } from '../util/rng';

export type BulletId =
  | 'std' | 'brass' | 'lead' | 'tri' | 'buck' | 'bomb' | 'rocket' | 'ricochet' | 'homing'
  | 'fire' | 'cryo' | 'chain' | 'split' | 'saw' | 'boomer' | 'mine' | 'toxic' | 'light'
  | 'sniper' | 'nova' | 'beam' | 'singular' | 'leech' | 'gold' | 'jet'
  // 第4次调整
  | 'mystery' | 'corn'
  // 逻辑模块（不射出子弹，而是改变后续子弹的发射逻辑）
  | 'mDouble' | 'mTriple' | 'mHoming' | 'mPierce' | 'mBlast' | 'mPower' | 'mSpeed' | 'mFocus';

export interface LogicFx {
  cast?: number; // 接下来的 N 发同时射出
  homing?: boolean;
  pierce?: number;
  blast?: boolean;
  dmg?: number;
  speed?: number;
  focus?: number; // 散射减少（度）
}

/** 投射物模拟方式 */
export type ProjKind = 'bullet' | 'bomb' | 'rocket' | 'saw' | 'boomer' | 'mine' | 'toxic' | 'singular' | 'split';
/** 射击音效分类 */
export type ShotSfx = 'pistol' | 'heavy' | 'shotgun' | 'laser' | 'launcher' | 'saw' | 'magic' | 'thump' | 'zap';

export interface BulletDef {
  id: BulletId;
  name: string;
  atk: number;
  spd: number;
  rng: number;
  deg: number;
  rc: number;
  mods: { delay?: number; reload?: number; spread?: number; atk?: number }; // atk：装填后枪械攻击倍率的加成（第4次调整，盲盒）
  effect: string;
  weight: number;
  color: number;
  kind: ProjKind;
  sfx: ShotSfx;
  count?: number; // 一次射出的弹丸数
  pierce?: number; // 穿透数，-1 无限
  range?: number; // 射程（米），默认 26
  flags?: {
    homing?: boolean;
    wallBounce?: number;
    enemyBounce?: number;
    chain?: number;
    burn?: boolean;
    slow?: boolean;
    leech?: boolean;
    gold?: boolean;
    knock?: number;
    ring?: boolean;
    beam?: boolean;
    mystery?: boolean; // 盲盒：发射时随机变成其他任意子弹
    butter?: number; // 玉米粒：每发变成黄油的概率
  };
  logic?: LogicFx;
}

export const BULLETS: Record<BulletId, BulletDef> = {
  std: {
    id: 'std', name: '标准弹', atk: 60, spd: 70, rng: 3, deg: 0, rc: 1.0, mods: {},
    effect: '最基础的金属弹头，稳定可靠。', weight: 14, color: 0xffd27a, kind: 'bullet', sfx: 'pistol',
  },
  brass: {
    id: 'brass', name: '穿透型黄铜子弹', atk: 45, spd: 85, rng: 2.5, deg: -2, rc: 0.8, mods: { delay: 0.02 },
    effect: '本子弹可以穿透 3 个单位。', weight: 10, color: 0xffb84a, kind: 'bullet', sfx: 'pistol', pierce: 3,
  },
  lead: {
    id: 'lead', name: '重型铅弹', atk: 120, spd: 55, rng: 5, deg: 3, rc: 4.5, mods: { delay: 0.08, reload: 0.1 },
    effect: '沉重的铅弹，击退命中的敌人，可以穿透 1 个单位。', weight: 8, color: 0xb0b8c8, kind: 'bullet', sfx: 'heavy',
    pierce: 1, flags: { knock: 4 },
  },
  tri: {
    id: 'tri', name: '三发弹丸', atk: 24, spd: 90, rng: 4.5, deg: 75, rc: 3.3, mods: { delay: 0.03, reload: 0.07 },
    effect: '一次可以射出 3 发子弹，子弹会射向不同的方向。本子弹可以穿透 1 个单位。', weight: 9, color: 0xffe08a,
    kind: 'bullet', sfx: 'shotgun', count: 3, pierce: 1,
  },
  buck: {
    id: 'buck', name: '鹿弹', atk: 20, spd: 75, rng: 3, deg: 40, rc: 2.5, mods: { delay: 0.06, reload: 0.12 },
    effect: '一次射出 7 发弹丸，射程较短（13 米）。', weight: 8, color: 0xffc66a, kind: 'bullet', sfx: 'shotgun',
    count: 7, range: 13,
  },
  bomb: {
    id: 'bomb', name: '炸弹', atk: 210, spd: 22, rng: 9, deg: -10, rc: 5, mods: { delay: 0.05, spread: -5 },
    effect: '向前方抛出一枚炸弹，2.5 秒后爆炸，伤害范围内的所有单位。', weight: 6,
    color: 0xff6a3a, kind: 'bomb', sfx: 'thump',
  },
  rocket: {
    id: 'rocket', name: '三级火箭', atk: 240, spd: 30, rng: 7, deg: 0, rc: 30, mods: { delay: 0.3, reload: 0.3 },
    effect: '发射后逐级加速，命中敌人或墙壁时爆炸。后坐力极大，可以把你推飞。', weight: 4, color: 0xff8a2a,
    kind: 'rocket', sfx: 'launcher',
  },
  ricochet: {
    id: 'ricochet', name: '弹跳弹', atk: 48, spd: 65, rng: 3, deg: 0, rc: 1.0, mods: { delay: 0.01 },
    effect: '遇到墙壁会反弹（最多 4 次），命中敌人后会弹向附近的另一个敌人（最多 2 次）。', weight: 8,
    color: 0x8affc8, kind: 'bullet', sfx: 'pistol', flags: { wallBounce: 4, enemyBounce: 2 },
  },
  homing: {
    id: 'homing', name: '追踪飞镖', atk: 42, spd: 38, rng: 2.5, deg: 20, rc: 0.6, mods: { delay: 0.02 },
    effect: '飞镖会自动追踪附近的敌人。', weight: 8, color: 0xff6ad8, kind: 'bullet', sfx: 'zap',
    range: 60, flags: { homing: true },
  },
  fire: {
    id: 'fire', name: '燃烧弹', atk: 33, spd: 60, rng: 3.5, deg: 5, rc: 1.2, mods: { reload: 0.04 },
    effect: '点燃敌人：3 秒内每秒额外造成 40% 攻击力的伤害。燃烧中的敌人死亡时会引燃身边的同伴。', weight: 8,
    color: 0xff5a1a, kind: 'bullet', sfx: 'pistol', flags: { burn: true },
  },
  cryo: {
    id: 'cryo', name: '液氮弹', atk: 33, spd: 60, rng: 3.5, deg: 0, rc: 1.0, mods: { delay: 0.02 },
    effect: '冻结敌人，使其移动速度降低 50%，持续 2.5 秒。可以穿透 1 个单位。', weight: 7, color: 0x7ad8ff,
    kind: 'bullet', sfx: 'zap', pierce: 1, flags: { slow: true },
  },
  chain: {
    id: 'chain', name: '电弧弹', atk: 45, spd: 100, rng: 2, deg: 0, rc: 0.5, mods: { delay: 0.05 },
    effect: '命中后释放电弧，在 7 米内跳跃 4 次，每次跳跃伤害为上一次的 80%。', weight: 6, color: 0x9ab8ff,
    kind: 'bullet', sfx: 'zap', flags: { chain: 4 },
  },
  split: {
    id: 'split', name: '分裂弹', atk: 54, spd: 60, rng: 4, deg: 0, rc: 1.5, mods: { delay: 0.05 },
    effect: '飞行片刻或命中敌人后分裂为 6 枚碎片，每枚碎片造成 40% 攻击力的伤害。', weight: 6,
    color: 0xd8ff6a, kind: 'split', sfx: 'pistol',
  },
  saw: {
    id: 'saw', name: '圆锯片', atk: 22, spd: 22, rng: 6, deg: 0, rc: 0.5, mods: { delay: 0.1 },
    effect: '缓慢飞行的锯片，无限穿透，持续切割接触的敌人，遇墙反弹。', weight: 5,
    color: 0xd0d6e0, kind: 'saw', sfx: 'saw', pierce: -1,
  },
  boomer: {
    id: 'boomer', name: '回旋镖', atk: 54, spd: 32, rng: 5, deg: 0, rc: 0.8, mods: { delay: 0.04 },
    effect: '飞出后会返回你的身边，往返都能造成伤害，无限穿透。', weight: 6, color: 0xffa83a, kind: 'boomer',
    sfx: 'saw', pierce: -1,
  },
  mine: {
    id: 'mine', name: '感应地雷', atk: 220, spd: 10, rng: 8, deg: 0, rc: 0.3, mods: { delay: 0.12 },
    effect: '布置一枚地雷，敌人靠近时触发，片刻后爆炸。地雷最多存在 20 秒。', weight: 5, color: 0xff3a3a,
    kind: 'mine', sfx: 'thump',
  },
  toxic: {
    id: 'toxic', name: '毒雾弹', atk: 15, spd: 28, rng: 7, deg: 5, rc: 0.8, mods: { reload: 0.06 },
    effect: '命中或飞行片刻后形成毒雾，4 秒内每秒对其中的敌人造成 3 倍攻击力的伤害。', weight: 5,
    color: 0x8aff3a, kind: 'toxic', sfx: 'thump',
  },
  light: {
    id: 'light', name: '轻量化弹头', atk: 22, spd: 95, rng: 2, deg: 4, rc: 0.4, mods: { delay: -0.06, reload: -0.12 },
    effect: '牺牲威力换来更快的射速与换弹。', weight: 8, color: 0xfff2b0, kind: 'bullet', sfx: 'pistol',
  },
  sniper: {
    id: 'sniper', name: '钨芯穿甲弹', atk: 190, spd: 150, rng: 2.5, deg: -15, rc: 6, mods: { delay: 0.18, reload: 0.15 },
    effect: '高速穿甲弹，可以穿透 10 个单位，射程 42 米。', weight: 5, color: 0xe0f0ff, kind: 'bullet',
    sfx: 'heavy', pierce: 10, range: 42,
  },
  nova: {
    id: 'nova', name: '环形弹幕', atk: 24, spd: 45, rng: 3, deg: 0, rc: 0, mods: { delay: 0.08 },
    effect: '向四周 360° 射出 12 发子弹，射程 14 米。', weight: 5, color: 0xc08aff, kind: 'bullet', sfx: 'zap',
    count: 12, range: 14, flags: { ring: true },
  },
  beam: {
    id: 'beam', name: '等离子射线', atk: 19, spd: 160, rng: 2, deg: -5, rc: 0.2, mods: { delay: -0.03 },
    effect: '高速等离子束，无限穿透，射程 15 米。', weight: 6, color: 0x5affff, kind: 'bullet', sfx: 'laser',
    pierce: -1, range: 15, flags: { beam: true },
  },
  singular: {
    id: 'singular', name: '奇点弹', atk: 15, spd: 12, rng: 8, deg: 0, rc: 2, mods: { delay: 0.4, reload: 0.5 },
    effect: '飞行片刻后形成引力奇点，3 秒内吸引周围的敌人并持续伤害，结束时坍缩造成 10 倍攻击力的伤害。',
    weight: 3, color: 0xa040ff, kind: 'singular', sfx: 'magic',
  },
  leech: {
    id: 'leech', name: '吸血弹', atk: 38, spd: 70, rng: 3, deg: 0, rc: 0.8, mods: { reload: 0.02 },
    effect: '每次命中回复相当于所造成伤害 4% 的生命值（每发最多 3 点）。', weight: 5, color: 0xff2a5a,
    kind: 'bullet', sfx: 'pistol', flags: { leech: true },
  },
  gold: {
    id: 'gold', name: '招财弹', atk: 33, spd: 70, rng: 3, deg: 0, rc: 0.8, mods: {},
    effect: '被该子弹击杀的敌人掉落的金币 +60%。', weight: 4, color: 0xffd700, kind: 'bullet', sfx: 'pistol',
    flags: { gold: true },
  },
  jet: {
    id: 'jet', name: '喷射推进弹', atk: 4, spd: 40, rng: 3, deg: 0, rc: 45, mods: { delay: -0.02 },
    effect: '几乎没有伤害，但后坐力惊人——朝身后开火可以高速位移。', weight: 3, color: 0x6ac8ff, kind: 'bullet',
    sfx: 'launcher', range: 6,
  },
  // —— 第4次调整 ——
  mystery: {
    id: 'mystery', name: '盲盒', atk: 0, spd: 0, rng: 0, deg: 0, rc: 0, mods: { delay: -0.04, atk: 0.2 },
    effect: '发射时随机变成其他任意一种子弹，数值也会随机浮动。', weight: 5, color: 0xff7ad8, kind: 'bullet', sfx: 'pistol',
    flags: { mystery: true },
  },
  corn: {
    id: 'corn', name: '玉米粒', atk: 22, spd: 90, rng: 1.5, deg: 5, rc: 1.8, mods: { delay: 0.05, reload: -0.07 },
    effect: '发射一颗轻量小型的子弹，但有 12% 的概率变为黄油：黄油的攻击力为玉米粒的 7 倍，命中时让附近小范围的敌人晕眩 6 秒。',
    weight: 7, color: 0xffd84a, kind: 'bullet', sfx: 'pistol', flags: { butter: 0.12 },
  },
  // —— 逻辑模块 ——
  mDouble: {
    id: 'mDouble', name: '双重施放模块', atk: 0, spd: 0, rng: 0, deg: 0, rc: 0, mods: { delay: 0.03 },
    effect: '逻辑模块：接下来的 2 发子弹同时射出。', weight: 4, color: 0x8ae8ff, kind: 'bullet', sfx: 'pistol', logic: { cast: 2 },
  },
  mTriple: {
    id: 'mTriple', name: '三重施放模块', atk: 0, spd: 0, rng: 0, deg: 0, rc: 0, mods: { delay: 0.06, reload: 0.08 },
    effect: '逻辑模块：接下来的 3 发子弹同时射出。', weight: 2, color: 0x6ab8ff, kind: 'bullet', sfx: 'pistol', logic: { cast: 3 },
  },
  mHoming: {
    id: 'mHoming', name: '追踪模块', atk: 0, spd: 0, rng: 0, deg: 0, rc: 0, mods: { delay: 0.01 },
    effect: '逻辑模块：下一发子弹获得追踪能力。', weight: 4, color: 0xff8ae8, kind: 'bullet', sfx: 'pistol', logic: { homing: true },
  },
  mPierce: {
    id: 'mPierce', name: '穿透模块', atk: 0, spd: 0, rng: 0, deg: 0, rc: 0, mods: { delay: 0.01 },
    effect: '逻辑模块：下一发子弹额外穿透 3 个单位。', weight: 4, color: 0xffe08a, kind: 'bullet', sfx: 'pistol', logic: { pierce: 3 },
  },
  mBlast: {
    id: 'mBlast', name: '爆裂模块', atk: 0, spd: 0, rng: 0, deg: 0, rc: 0, mods: { delay: 0.04 },
    effect: '逻辑模块：下一发子弹命中时引发小型爆炸（半径 2 米，60% 伤害）。', weight: 3, color: 0xff8a4a, kind: 'bullet', sfx: 'pistol', logic: { blast: true },
  },
  mPower: {
    id: 'mPower', name: '增幅模块', atk: 0, spd: 0, rng: 0, deg: 0, rc: 0, mods: { delay: 0.06, reload: 0.05 },
    effect: '逻辑模块：下一发子弹伤害 ×1.6。', weight: 4, color: 0xff5a5a, kind: 'bullet', sfx: 'pistol', logic: { dmg: 1.6 },
  },
  mSpeed: {
    id: 'mSpeed', name: '加速模块', atk: 0, spd: 0, rng: 0, deg: 0, rc: 0, mods: { delay: -0.02 },
    effect: '逻辑模块：下一发子弹弹速 ×1.8，伤害 ×1.15。', weight: 3, color: 0x8aff8a, kind: 'bullet', sfx: 'pistol', logic: { speed: 1.8, dmg: 1.15 },
  },
  mFocus: {
    id: 'mFocus', name: '聚焦模块', atk: 0, spd: 0, rng: 0, deg: 0, rc: 0, mods: {},
    effect: '逻辑模块：下一发子弹的散射角度 -60°。', weight: 3, color: 0xd8d8ff, kind: 'bullet', sfx: 'pistol', logic: { focus: 60 },
  },
};

export function isLogic(id: BulletId): boolean {
  return !!BULLETS[id].logic;
}

export const BULLET_IDS = Object.keys(BULLETS) as BulletId[];

export interface Bullet {
  uid: number;
  kind: 'bullet';
  def: BulletId;
  atk: number;
  spd: number;
  rng: number;
  deg: number;
  rc: number;
  rolls: [number, number, number, number, number];
  shiny?: boolean; // 第2版：闪耀子弹（20%，攻击力 ×1.25）
  iri?: boolean; // 第2版：虹彩子弹（5%，攻击力 ×1.6），与闪耀分别判定、可以叠加
}

export const SHINY = { chance: 0.2, mul: 1.25 };
export const IRI = { chance: 0.05, mul: 1.6 };

let uidCounter = 1;
export function nextUid(): number {
  return uidCounter++;
}

export function makeBullet(def: BulletId, rng: Rng, fixedRoll?: number): Bullet {
  const d = BULLETS[def];
  const roll = () => (fixedRoll !== undefined || d.logic ? fixedRoll ?? 1 : rng.range(0.7, 1.4));
  const r: [number, number, number, number, number] = [roll(), roll(), roll(), roll(), roll()];
  // 闪耀 / 虹彩：所有来源（商店、地图、枪里自带……）的子弹都会判定；逻辑模块与盲盒没有自己的攻击力，不参与
  const plain = !!d.logic || !!d.flags?.mystery;
  const shiny = !plain && rng.chance(SHINY.chance);
  const iri = !plain && rng.chance(IRI.chance);
  const b: Bullet = {
    uid: nextUid(),
    kind: 'bullet',
    def,
    atk: d.atk * r[0] * (shiny ? SHINY.mul : 1) * (iri ? IRI.mul : 1),
    spd: d.spd * r[1],
    rng: d.rng * r[2],
    deg: d.deg * r[3],
    rc: d.rc * r[4],
    rolls: r,
  };
  if (shiny) b.shiny = true;
  if (iri) b.iri = true;
  return b;
}

/** 子弹的显示名（带闪耀 / 虹彩前缀） */
export function bulletName(b: Bullet): string {
  const pre = (b.shiny ? '闪耀' : '') + (b.iri ? '虹彩' : '');
  return pre ? `${pre} ${BULLETS[b.def].name}` : BULLETS[b.def].name;
}

/** 散射一栏的颜色（第2版）：散射是坏属性，加大散射的子弹显示红色，减小散射显示绿色 */
export function spreadColor(deg: number, roll: number): string {
  if (Math.abs(deg) < 0.5) return '#e8e8e8';
  if (deg > 0) return roll >= 1.12 ? '#ff4a3a' : roll <= 0.82 ? '#ffa080' : '#ff7a5a';
  return rollColor(roll); // 负散射：偏移越大越精准
}

export function randomBulletDef(rng: Rng): BulletId {
  return rng.weighted(BULLET_IDS.map((id) => [id, BULLETS[id].weight] as const));
}

export function randomBullet(rng: Rng): Bullet {
  return makeBullet(randomBulletDef(rng), rng);
}

/** 盲盒发射时变成的子弹：除盲盒以外的任意子弹（不含逻辑模块），数值照常随机浮动 */
const MYSTERY_POOL = BULLET_IDS.filter((id) => !BULLETS[id].logic && !BULLETS[id].flags?.mystery);
export function mysteryBullet(rng: Rng): Bullet {
  return makeBullet(rng.pick(MYSTERY_POOL), rng);
}

/** 黄油（玉米粒变异）：攻击力 ×7，命中时晕眩附近的敌人 */
export const BUTTER = { atkMul: 7, stun: 6, radius: 1.8, color: 0xfff0a0 };

export function bulletCount(b: Bullet): number {
  return BULLETS[b.def].count ?? 1;
}

/** 爆炸/毒雾半径（策划案中“对 9 米范围内”按直径理解） */
export function areaRadius(b: Bullet): number {
  return b.rng / 2;
}

/** 普通弹丸的命中半径 */
export function hitRadius(b: Bullet): number {
  const k = BULLETS[b.def].kind;
  if (k === 'saw') return b.rng * 0.12;
  if (k === 'boomer') return b.rng * 0.1;
  if (k === 'bomb' || k === 'mine' || k === 'rocket' || k === 'toxic' || k === 'singular') return 0.3;
  return Math.max(0.08, b.rng * 0.06);
}

export type RecoilTier = 'slow' | 'push' | 'dash' | 'none';
export interface RecoilInfo {
  value: number;
  tier: RecoilTier;
  amount: number; // slow: 比例(0~1)；push: 米/秒；dash: 米
  label: string;
}

/**
 * 实际后坐力 = (1/射击延迟) * 后坐系数 * (1 - 下盘功夫减免)
 * < 第一阈值：移速降低 (R/15)²；介于两阈值：定向后坐移速 (R-15)/2；超过第二阈值：定向冲力位移 (R-30)/2
 */
export function recoilOf(rc: number, delay: number, resist: number, t1 = 15, t2 = 30): RecoilInfo {
  const value = (1 / Math.max(0.01, delay)) * rc * (1 - resist);
  if (value <= 0.001) return { value: 0, tier: 'none', amount: 0, label: '【无后坐】' };
  if (value < t1) {
    // 实际减速上限 85%（自定，避免完全无法移动）
    const amount = Math.min(0.85, (value / t1) ** 2);
    return { value, tier: 'slow', amount, label: `【轻松射击：${(amount * 100).toFixed(1)}%↓】` };
  }
  if (value <= t2) {
    const amount = (value - t1) / 2;
    return { value, tier: 'push', amount, label: `【太空步：${amount.toFixed(2)}+】` };
  }
  const amount = (value - t2) / 2;
  return { value, tier: 'dash', amount, label: `【肩胛粉碎者：${amount.toFixed(1)}※】` };
}

export function rollColor(r: number): string {
  if (r >= 1.28) return '#ffcf4a';
  if (r >= 1.12) return '#6aff8a';
  if (r <= 0.82) return '#ff7a6a';
  return '#e8e8e8';
}

export function bulletQualityName(b: Bullet): string {
  if (BULLETS[b.def].logic) return '逻辑模块';
  const r = b.rolls[0];
  if (r >= 1.3) return '极品';
  if (r >= 1.15) return '优良';
  if (r <= 0.8) return '劣质';
  return '标准';
}
