// 数值配置：直接来自策划案的表格，以及策划案未规定、由实现方决定的平衡参数（标注“自定”）。

export type EnemyType = 'office' | 'iron' | 'runner' | 'spitter' | 'creeper';
export const ENEMY_TYPES: EnemyType[] = ['office', 'iron', 'runner', 'spitter', 'creeper'];

export interface ZoneCfg {
  index: number; // 1..6（5 = 尸王广场，6 = 隐秘核心）
  name: string;
  subtitle: string;
  hpMul: [number, number]; // 区域倍率（丧尸生命值的额外乘区；第4.3次调整提高了第二区起的倍率）
  weights: Record<EnemyType, number>; // 生成权重（第4次调整：苦力怕在每一区都挤占社畜丧尸 3 点权重）
  elite: [number, number, number]; // 黄/橙/红 变异概率
  eliteMin: number; // 精英最少数量
  radRate: number; // 每秒辐射增长 (K)
  radThresh: [number, number, number]; // 黄/橙/红 阈值 (K)
  dmgMul: number; // 区域伤害乘区（自定）
  /** 地图中枪械的稀有度权重 R1..R5（第3次调整：第三/四区有 3%/9% 出现 Rarity5，从 Rarity3 中扣除；商店不出 Rarity5） */
  gunRarityW: [number, number, number, number, number];
  purify: number; // 净化血清（道具）减少值
  // 刷怪（自定）
  spawnRate: number; // 基础每秒刷怪数
  initialCount: number; // 区域生成之初均匀分布的数量
  maxAlive: number;
  densityLow: number; // 玩家周围敌人过少阈值
  densityHigh: number; // 玩家周围敌人过多阈值
  palette: ZonePalette;
}

export interface ZonePalette {
  fog: number;
  sky: number;
  ground: number;
  hemiSky: number;
  hemiGround: number;
  sun: number;
  sunIntensity: number;
  hemiIntensity: number;
  asphalt: string;
  dirt: string;
  wall: string;
  accent: string;
}

export const ZONES: ZoneCfg[] = [
  {
    index: 1, name: '第一区', subtitle: '灰烬街区',
    hpMul: [0.6, 1.6],
    weights: { office: 69, iron: 28, runner: 0, spitter: 0, creeper: 3 },
    elite: [0.089, 0.027, 0.014], eliteMin: 10,
    radRate: 0.1, radThresh: [16, 20, 22],
    dmgMul: 1.0,
    gunRarityW: [50, 40, 10, 0, 0], purify: 6,
    spawnRate: 1.2, initialCount: 24, maxAlive: 160, densityLow: 14, densityHigh: 34,
    palette: {
      fog: 0x2a2a2c, sky: 0x2a2a2c, ground: 0x3a3836, hemiSky: 0x9aa4b0, hemiGround: 0x4a3c30,
      sun: 0xffc690, sunIntensity: 1.5, hemiIntensity: 1.25,
      asphalt: '#3a3a3c', dirt: '#4a4237', wall: '#8a8378', accent: '#ff9a3c',
    },
  },
  {
    index: 2, name: '第二区', subtitle: '锈蚀工业带',
    hpMul: [1.4, 2.4],
    weights: { office: 52, iron: 20, runner: 25, spitter: 0, creeper: 3 },
    elite: [0.099, 0.037, 0.018], eliteMin: 14,
    radRate: 0.2, radThresh: [40, 48, 52],
    dmgMul: 1.15,
    gunRarityW: [30, 40, 20, 10, 0], purify: 12,
    spawnRate: 1.8, initialCount: 32, maxAlive: 220, densityLow: 20, densityHigh: 48,
    palette: {
      fog: 0x2e2620, sky: 0x2e2620, ground: 0x3d342b, hemiSky: 0xb09a80, hemiGround: 0x4a3420,
      sun: 0xffa060, sunIntensity: 1.45, hemiIntensity: 1.2,
      asphalt: '#3b3632', dirt: '#55402c', wall: '#8a6a50', accent: '#ff6a2a',
    },
  },
  {
    index: 3, name: '第三区', subtitle: '沉默医院区',
    hpMul: [2.2, 4.5],
    weights: { office: 42, iron: 20, runner: 25, spitter: 10, creeper: 3 },
    elite: [0.109, 0.047, 0.024], eliteMin: 18,
    radRate: 0.3, radThresh: [80, 96, 104],
    dmgMul: 1.3,
    gunRarityW: [20, 30, 27, 20, 3], purify: 18,
    spawnRate: 2.4, initialCount: 40, maxAlive: 280, densityLow: 26, densityHigh: 62,
    palette: {
      fog: 0x1e2a22, sky: 0x1e2a22, ground: 0x2f3a30, hemiSky: 0x9ec0a0, hemiGround: 0x2a3a28,
      sun: 0xc8ffb0, sunIntensity: 1.3, hemiIntensity: 1.2,
      asphalt: '#323a34', dirt: '#3b4a33', wall: '#7f8c80', accent: '#7dff5a',
    },
  },
  {
    index: 4, name: '第四区', subtitle: '血色中枢',
    hpMul: [3.0, 6.0],
    weights: { office: 32, iron: 20, runner: 25, spitter: 20, creeper: 3 },
    elite: [0.15, 0.06, 0.04], eliteMin: 22,
    radRate: 0.4, radThresh: [120, 144, 156],
    dmgMul: 1.45,
    gunRarityW: [10, 20, 31, 30, 9], purify: 24,
    spawnRate: 3.0, initialCount: 48, maxAlive: 340, densityLow: 32, densityHigh: 78,
    palette: {
      fog: 0x2a1616, sky: 0x2a1616, ground: 0x3a2626, hemiSky: 0xc09090, hemiGround: 0x3a1a1a,
      sun: 0xff7060, sunIntensity: 1.4, hemiIntensity: 1.15,
      asphalt: '#382e2e', dirt: '#4a2c28', wall: '#86625c', accent: '#ff3a3a',
    },
  },
  {
    index: 5, name: '第五区', subtitle: '尸王广场',
    hpMul: [4.0, 6.0],
    weights: { office: 32, iron: 20, runner: 25, spitter: 20, creeper: 3 },
    elite: [0.08, 0.03, 0.01], eliteMin: 4,
    // 第3次调整：radThresh 同时是 V 级防护服（4 区安全屋提供）的阈值：黄 0（第五区始终处于黄色级别）/ 橙 200 / 红 240
    radRate: 0.5, radThresh: [0, 200, 240],
    dmgMul: 1.45,
    gunRarityW: [10, 20, 40, 30, 0], purify: 24,
    spawnRate: 0.9, initialCount: 0, maxAlive: 60, densityLow: 6, densityHigh: 18,
    palette: {
      fog: 0x1c1424, sky: 0x1c1424, ground: 0x2c2430, hemiSky: 0xa898c8, hemiGround: 0x2a1a30,
      sun: 0xd0a0ff, sunIntensity: 1.35, hemiIntensity: 1.15,
      asphalt: '#2e2a34', dirt: '#3a2c3c', wall: '#7a6e86', accent: '#c06aff',
    },
  },
  {
    // 第3次调整：在辐射进入橙色之前击败牢大丧尸才能到达。辐射每秒 +0.6K，阈值与 V 级防护服相同
    index: 6, name: '第六区', subtitle: '隐秘核心',
    hpMul: [5.0, 6.0],
    weights: { office: 27, iron: 22, runner: 26, spitter: 22, creeper: 3 },
    elite: [0.12, 0.05, 0.025], eliteMin: 8,
    radRate: 0.6, radThresh: [0, 200, 240],
    dmgMul: 1.55,
    gunRarityW: [10, 20, 40, 30, 0], purify: 24,
    spawnRate: 1.5, initialCount: 0, maxAlive: 90, densityLow: 10, densityHigh: 26,
    palette: {
      fog: 0x10161c, sky: 0x10161c, ground: 0x1c2228, hemiSky: 0x8ab0c8, hemiGround: 0x1a2a30,
      sun: 0x9adfff, sunIntensity: 1.3, hemiIntensity: 1.15,
      asphalt: '#252b31', dirt: '#2a3038', wall: '#5e6e7a', accent: '#ffc83a',
    },
  },
];

export interface EnemyDef {
  name: string;
  hp: number;
  atk: number;
  speed: number; // 策划案原值
  gold: number;
  radius: number;
  mass: number;
}

export const ENEMIES: Record<EnemyType, EnemyDef> = {
  office: { name: '社畜丧尸', hp: 100, atk: 13, speed: 4.6, gold: 15, radius: 0.42, mass: 1 },
  iron: { name: '头铁丧尸', hp: 700, atk: 20, speed: 3.8, gold: 56, radius: 0.62, mass: 3 },
  runner: { name: '跑得快丧尸', hp: 150, atk: 15, speed: 5.0, gold: 25, radius: 0.38, mass: 0.8 },
  spitter: { name: '吐口水丧尸', hp: 150, atk: 12, speed: 3.0, gold: 45, radius: 0.46, mass: 1.2 },
  // 第4次调整：接触伤害 13；被杀死时（爆炸后）掉落 34 金币，靠近触发的爆炸掉落 17 金币（见 CREEPER）
  creeper: { name: '苦力怕', hp: 150, atk: 13, speed: 4.6, gold: 34, radius: 0.44, mass: 1 },
};

/**
 * 苦力怕（第4次调整）：靠近玩家一定范围后、或者生命值归零后，倒计时 2 秒爆炸；
 * 爆炸会殃及丧尸，对丧尸的伤害是对玩家的 5 倍。触发倒计时后移速 4.6 → 3.2。
 * 范围与触发距离为自定。
 */
export const CREEPER = { boom: 34, enemyMul: 5, fuse: 2, fuseSpeed: 3.2, radius: 3.2, trigger: 2.2, nearGold: 17 };

/** 第4次调整：被拉起的玩家获得 4 秒无敌 */
export const REVIVE_INVULN = 4;

/** 牢大丧尸：第3次调整——每个阶段 24000 生命（共 4 个阶段：3/4 血召唤精英、半血狂暴、1/4 血再次召唤） */
export const BOSS = { name: '牢大丧尸', hpPerPhase: 24000, phases: 4, atk: 96, speed: 2.4, radius: 1.5 };
/** 曼巴僵尸（第六区）：24 万生命，攻击力高于牢大（自定 120） */
export const MAMBA = { name: '曼巴僵尸', hp: 240000, atk: 120, speed: 2.7, radius: 1.75 };

/** 自定：策划案中丧尸移速高于玩家初始移速，直接使用会无法拉扯，这里统一乘以该系数。 */
export const ENEMY_SPEED_SCALE = 0.58;

export const ELITE_MUL = [1, 1.5, 2.0, 3.0]; // 0 普通 / 1 黄 / 2 橙 / 3 红
export const ELITE_COLORS = [0xffffff, 0xffe14a, 0xff8a1a, 0xff2a2a];
export const ELITE_CSS = ['#ffffff', '#ffe14a', '#ff8a1a', '#ff3030'];
export const ELITE_NAMES = ['', '黄色变异', '橙色变异', '红色变异'];

export const PLAYER = {
  hp: 100,
  speed: 4.0,
  radius: 0.4,
  bagCapacity: 16,
  goldPerUnit: 1750,
  magnetRadius: 3.2,
  pickupRadius: 2.2,
  autoPickupRadius: 1.25, // 第2版：经过地图生成的道具时自动拾取
  contactIFrame: 0.5, // 自定：受击后的短暂无敌，防止被包围瞬间秒杀
};

/** 第2版联机：丧尸生成时按存活玩家数量额外增加生命值（不包括牢大），下标为人数 */
export const COOP_HP_MUL = [1, 1, 1.6, 2.2, 2.8];
/** 第2版联机：牢大丧尸的额外生命值倍率 */
export const COOP_BOSS_HP_MUL = [1, 1, 2, 3, 4];
/** 自定：联机时刷怪速率与场上上限的倍率（人越多需要的丧尸越多，否则每人分到的金币太少）。
 * 与生命值倍率相乘后，丧尸的“总血量” ≈ 人数 × 单人时的水平（2人 1.92、3人 3.08、4人 4.48）。 */
export const COOP_COUNT_MUL = [1, 1, 1.2, 1.4, 1.6];
export const COOP = {
  maxPlayers: 4,
  friendlyFire: 0.05, // 玩家子弹对玩家（含自己）的伤害比例
  reviveTime: 0.5, // 拉起倒地队友所需时间（秒）
  reviveRange: 1.8,
  reviveHp: 0.3, // 被拉起后恢复的生命比例
  goldShare: 0.25, // 非击杀者获得的金币比例
  magnet: 12, // 联机时的金币吸取范围（米）；单人模式为全图
  closeGrace: 5, // 有队友倒在外面时，安全屋关门前的等待时间（自定）
};

/** 第4.1次调整：商店祭坛的全局强化零件1型最多叠加到 +1.60x */
export const GLOBAL_ATK_MAX = 1.6;

/** 第4.1次调整：异变体（区域任务“击杀异变体”）——生命 ×24、攻击 ×4、移速 ×0.8，不会被回收；金币 ×8（自定） */
export const MUTANT = { hp: 24, atk: 4, speed: 0.8, gold: 8 };

/** 第4.1次调整：奇物宝箱的生命值（按所在区域：第二 ~ 第五区；第4.3次调整提高） */
export const CHEST_HP = [0, 0, 2000, 3500, 6500, 10000];
export const CHEST_R = 0.95;

/** 防护服最高等级（第3次调整：4 区安全屋也提供一次升级，最高 V 级） */
export const SUIT_MAX = 5;
/** 第3次调整：枪械参数的硬下限（无论经过多少强化） */
export const GUN_LIMITS = { delay: 0.05, reload: 0.25 };

export const RECOIL = { t1: 15, t2: 30, maxSlow: 0.85, maxPush: 7, maxDash: 8 };

export const SAFEHOUSE = {
  roomW: 18,
  roomH: 14,
  exitCountdown: 5,
};

/** 祭坛花费：100→200→400→700→1100→1600→2200→2900…（差值每次 +100） */
export function altarCost(n: number): number {
  let c = 100, d = 100;
  for (let i = 0; i < n; i++) { c += d; d += 100; }
  return c;
}

export type AltarId = 'hp' | 'spd' | 'atk' | 'cap' | 'recoil' | 'purify' | 'bag';
export interface AltarOption { id: AltarId; name: string; values: [number, number, number, number]; fmt: (v: number) => string }
export const ALTAR: AltarOption[] = [
  { id: 'hp', name: '强化血清（生命）', values: [15, 25, 35, 45], fmt: (v) => `增加 ${v} 生命值和上限` },
  { id: 'spd', name: '强化血清（脚力）', values: [7, 10, 13, 16], fmt: (v) => `增加 ${v}% 移动速度` },
  // 第4.1次调整：改为全局增益——现有的以及之后拿到的所有枪（包括地图里、商店里的）都会生效，最多叠加到 +1.60x
  { id: 'atk', name: '全局强化零件1型', values: [0.10, 0.14, 0.17, 0.20], fmt: (v) => `所有枪（包括之后拿到的）攻击倍率 +${v.toFixed(2)}x` },
  { id: 'cap', name: '全局强化零件3型', values: [1, 1, 2, 2], fmt: (v) => `现有的所有枪增加 ${v} 最大载弹量` },
  { id: 'recoil', name: '下盘功夫', values: [9, 12, 15, 18], fmt: (v) => `受到的后坐力影响 -${v}%` },
  { id: 'purify', name: '净化血清', values: [3, 6, 9, 14], fmt: (v) => `减少 ${v}K 辐射值` },
  { id: 'bag', name: '强化背包', values: [2, 2, 2, 2], fmt: (v) => `背包容量增加 ${v} 单位` },
];

export const RARITY_NAMES = ['', 'Rarity1（普通）', 'Rarity2（精良）', 'Rarity3（稀有）', 'Rarity4（传说）', 'Rarity5（神话）'];
export const RARITY_CSS = ['#999', '#c9cfd6', '#5fe36a', '#4aa8ff', '#ffb03a', '#ff5ad2'];
export const RARITY_HEX = [0x999999, 0xc9cfd6, 0x5fe36a, 0x4aa8ff, 0xffb03a, 0xff5ad2];

// 自定：普通难度对策划案数值略作下调；困难 = 策划案原始数值
export const DIFFICULTY = {
  easy: { name: '简单', hp: 0.6, dmg: 0.55, spawn: 0.75 },
  normal: { name: '普通', hp: 0.8, dmg: 0.8, spawn: 0.9 },
  hard: { name: '困难', hp: 1.0, dmg: 1.0, spawn: 1.0 },
  nightmare: { name: '噩梦', hp: 1.35, dmg: 1.3, spawn: 1.2 },
};
export type Difficulty = keyof typeof DIFFICULTY;

/** 强化系数 = log10(当前辐射值K) - 0.5，最低为 1 */
export function enhanceCoef(radK: number): number {
  return Math.max(1, Math.log10(Math.max(radK, 1e-6)) - 0.5);
}

export const ZONE_W = 104;
export const ZONE_H = 136;
export const BOSS_W = 72;
export const BOSS_H = 72;
