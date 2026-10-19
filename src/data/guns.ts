// 枪械系统（模拟 Noita 法杖），第2版公式：
// (稀有度+2)*1.75*(0.7~1.4) = 攻击倍率*(1/射击延迟)*(1/换弹延迟) + 最大载弹量
// 最大载弹量 2~10；基础射击延迟 ≤ 0.40s；换弹延迟 ≥ 0.40s；散射 -40~40°；攻击倍率 ≥ 0.50x
// 命名规律：名称 =（修饰语）+ 代号（按稀有度分档的词库）+ 类别（由数据决定）；型号 = 类别代码 + 厂商字母 - 稀有度 + 载弹量
// 第3次调整：Rarity5；枪械修饰语（40% 没有，60% 随机一个）；射击延迟 ≥ 0.05s、换弹延迟 ≥ 0.25s 的硬下限。

import { GUN_LIMITS } from '../config';
import { Rng } from '../util/rng';
import { Bullet, BULLETS, bulletCount, nextUid } from './bullets';

export const GUN_BUDGET_K = 1.75;
export const GUN_ROLL: [number, number] = [0.7, 1.4];
export const GUN_SPREAD: [number, number] = [-40, 40];

export interface Gun {
  uid: number;
  kind: 'gun';
  name: string; // 例如 “野牛冲锋枪”（带修饰语时为 “凶险野牛冲锋枪”）
  model: string; // 例如 “CFR-52”
  rarity: number; // 1..5
  mod?: GunModId; // 修饰语
  atk: number;
  delay: number;
  reload: number;
  cap: number;
  spread: number;
  bullets: (Bullet | null)[];
  look: GunLook;
}

export interface GunLook {
  seed: number;
  bodyLen: number;
  barrelLen: number;
  bulky: number;
  stock: boolean;
  scope: boolean;
  drum: boolean;
  wideMuzzle: boolean;
  color: number;
  accent: number;
}

/** 代号词库：稀有度越高，代号越“唬人” */
const CODENAMES: string[][] = [
  [],
  ['打工人', '加班狗', '保温杯', '电饭煲', '拖拉机', '二踢脚', '扳手', '大喇叭', '全家桶', '老伙计', '拆迁办', '平头哥'],
  ['野牛', '蝮蛇', '灰狼', '豺狗', '黄蜂', '犀牛', '铁肺', '狂犬', '毒蛛', '暴雨', '红隼', '铁砧'],
  ['渡鸦', '猫头鹰', '秃鹫', '霜狐', '白鲸', '夜枭', '野火', '雷鸟', '碎颅者'],
  ['黑曜石', '断头台', '收割者', '天启', '审判日', '末日钟', '归零者', '尸王克星'],
  ['终焉', '弑神者', '诸神黄昏', '永夜', '湮灭', '零号', '灭世者', '曼巴克星'],
];

// —— 修饰语（第3次调整） ——

export type GunModId =
  | 'shatter' | 'crude' | 'premium' | 'godly' | 'forceful' | 'ruthless' | 'dangerous' | 'heavy' | 'light' | 'brutal' | 'sinister';

export interface GunModDef {
  id: GunModId;
  name: string;
  desc: string;
  tone: 'good' | 'bad' | 'mixed';
  dmg?: number; // 造成伤害倍率
  delay?: number; // 射击延迟（秒，加算）
  reload?: number; // 换弹延迟（秒，加算）
  recoil?: number; // 后坐力倍率
  speed?: number; // 装备时的玩家移动速度（比例，加算）
  knock?: boolean; // 子弹按攻击力击退丧尸
  reverse?: boolean; // 朝反方向发射子弹
}

export const GUN_MODS: Record<GunModId, GunModDef> = {
  shatter: { id: 'shatter', name: '碎裂', desc: '-30% 造成伤害', tone: 'bad', dmg: 0.7 },
  crude: { id: 'crude', name: '粗劣', desc: '-10% 造成伤害', tone: 'bad', dmg: 0.9 },
  premium: { id: 'premium', name: '高端', desc: '+10% 造成伤害', tone: 'good', dmg: 1.1 },
  godly: { id: 'godly', name: '神级', desc: '+30% 造成伤害', tone: 'good', dmg: 1.3 },
  forceful: { id: 'forceful', name: '强劲', desc: '子弹会按造成的伤害击退丧尸；+40% 后坐力', tone: 'mixed', recoil: 1.4, knock: true },
  ruthless: { id: 'ruthless', name: '无情', desc: '-0.15s 换弹延迟；+0.05s 射击延迟', tone: 'mixed', reload: -0.15, delay: 0.05 },
  dangerous: { id: 'dangerous', name: '危险', desc: '+0.15s 换弹延迟；-0.05s 射击延迟', tone: 'mixed', reload: 0.15, delay: -0.05 },
  heavy: { id: 'heavy', name: '笨重', desc: '装备时 -15% 玩家速度', tone: 'bad', speed: -0.15 },
  light: { id: 'light', name: '轻盈', desc: '装备时 +20% 玩家速度', tone: 'good', speed: 0.2 },
  brutal: { id: 'brutal', name: '残暴', desc: '+44% 造成伤害；+0.20s 射击延迟', tone: 'mixed', dmg: 1.44, delay: 0.2 },
  sinister: { id: 'sinister', name: '凶险', desc: '+44% 造成伤害；这把枪会朝反方向发射子弹', tone: 'mixed', dmg: 1.44, reverse: true },
};
export const GUN_MOD_IDS = Object.keys(GUN_MODS) as GunModId[];
/** 枪械带有修饰语的概率 */
export const GUN_MOD_CHANCE = 0.6;
export const MOD_TONE_CSS = { good: '#6aff8a', bad: '#ff7a6a', mixed: '#ffd24a' };
const LETTERS = 'ABCDEFGHJKLMNPRSTVWXZ';

interface ClassInfo { name: string; code: string }

/** 类别由数据决定（规律见文件头） */
function classOf(g: { atk: number; delay: number; reload: number; cap: number; spread: number }): ClassInfo {
  if (g.delay <= 0.1 && g.cap >= 6) return { name: '转轮机枪', code: 'MG' };
  if (g.atk >= 2.6 && g.delay >= 0.28) return { name: '榴弹发射器', code: 'GL' };
  if (g.spread >= 25) return g.cap <= 3 ? { name: '喷子', code: 'SG' } : { name: '霰弹枪', code: 'SG' };
  if (g.delay <= 0.12) return { name: '冲锋枪', code: 'SM' };
  if (g.atk >= 1.8 || g.spread <= -25) return { name: '狙击枪', code: 'SR' };
  if (g.cap <= 3) return { name: '手枪', code: 'HG' };
  if (g.cap >= 7) return { name: '轻机枪', code: 'LM' };
  return g.reload < 1.0 ? { name: '卡宾枪', code: 'CB' } : { name: '步枪', code: 'AR' };
}

/** 型号：类别代码 + 厂商字母 - 稀有度 + 载弹量（如 SMK-47 = 冲锋枪、K 厂、Rarity4、7 发） */
function modelCode(rng: Rng, cls: ClassInfo, rarity: number, cap: number): string {
  const L = LETTERS[rng.int(0, LETTERS.length - 1)];
  return `${cls.code}${L}-${rarity}${cap === 10 ? 0 : cap}`;
}

const GUN_COLORS = [0x3a3c40, 0x4a4036, 0x2c3238, 0x50483e, 0x34383a, 0x3c3028];

export function makeLook(rng: Rng, g: { atk: number; delay: number; reload: number; cap: number; spread: number; rarity: number }): GunLook {
  const accents = [0x9aa0a8, 0xc9cfd6, 0x5fe36a, 0x4aa8ff, 0xffb03a, 0xff5ad2];
  return {
    seed: rng.int(1, 1e9),
    bodyLen: 0.42 + Math.min(0.3, g.delay * 0.6) + rng.range(-0.04, 0.04),
    barrelLen: 0.18 + Math.min(0.55, g.atk * 0.12) + rng.range(-0.03, 0.06),
    bulky: 0.9 + Math.min(0.6, g.atk * 0.08) + rng.range(-0.05, 0.1),
    stock: g.delay > 0.16 || g.atk > 1.6,
    scope: g.atk >= 1.8,
    drum: g.cap >= 7,
    wideMuzzle: g.spread >= 25,
    color: rng.pick(GUN_COLORS),
    accent: accents[g.rarity],
  };
}

export function rollRarity(rng: Rng, w: readonly number[]): number {
  return rng.weighted([[1, w[0]], [2, w[1]], [3, w[2]], [4, w[3]], [5, w[4] ?? 0]] as const);
}

/** makeGun 之后调用：60% 的概率获得一个随机修饰语（名字前面加上修饰语） */
export function rollGunMod(g: Gun, rng: Rng): void {
  if (!rng.chance(GUN_MOD_CHANCE)) return;
  const m = rng.pick(GUN_MOD_IDS);
  g.mod = m;
  g.name = GUN_MODS[m].name + g.name;
}

export function makeGun(rarity: number, rng: Rng): Gun {
  const budget = (rarity + 2) * GUN_BUDGET_K * rng.range(GUN_ROLL[0], GUN_ROLL[1]);
  const capMax = Math.max(2, Math.min(10, Math.floor(budget - 1.0)));
  // 载弹量偏向中间值
  const cap = Math.round(2 + (capMax - 2) * ((rng.next() + rng.next()) / 2));
  const R = budget - cap; // = 攻击倍率 / (射击延迟 * 换弹延迟)
  let atk = 1, delay = 0.25, reload = 1;
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) {
    delay = Math.exp(rng.range(Math.log(0.06), Math.log(0.4)));
    atk = Math.exp(rng.range(Math.log(0.5), Math.log(4.5)));
    reload = atk / (R * delay);
    if (reload >= 0.4 && reload <= 2.6) ok = true;
  }
  if (!ok) {
    delay = 0.3;
    reload = 1.2;
    atk = Math.max(0.5, R * delay * reload);
    reload = atk / (R * delay);
  }
  // 散射角度 -40~40° 均匀随机：负值会抵消子弹自带的散射
  const spread = Math.round(rng.range(GUN_SPREAD[0], GUN_SPREAD[1]));
  const stats = { atk, delay, reload, cap, spread };
  const cls = classOf(stats);
  const gun: Gun = {
    uid: nextUid(),
    kind: 'gun',
    name: rng.pick(CODENAMES[rarity]) + cls.name,
    model: modelCode(rng, cls, rarity, cap),
    rarity,
    atk: round2(atk),
    delay: round2(delay),
    reload: round2(reload),
    cap,
    spread,
    bullets: new Array(cap).fill(null),
    look: makeLook(rng, { ...stats, rarity }),
  };
  rollGunMod(gun, rng);
  return gun;
}

/** 手动指定数据的枪（开局初始武器）；数据依然满足公式（以随机数=给定值计算） */
export function makeFixedGun(name: string, model: string, rarity: number, atk: number, delay: number, cap: number, spread: number, roll: number, rng: Rng): Gun {
  const budget = (rarity + 2) * GUN_BUDGET_K * roll;
  const R = budget - cap;
  const reload = atk / (R * delay);
  return {
    uid: nextUid(),
    kind: 'gun',
    name,
    model,
    rarity,
    atk: round2(atk),
    delay: round2(delay),
    reload: round2(reload),
    cap,
    spread,
    bullets: new Array(cap).fill(null),
    look: makeLook(rng, { atk, delay, reload, cap, spread, rarity }),
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface GunStats {
  atk: number; // 实际攻击倍率（含修饰语的伤害倍率）
  delay: number;
  reload: number;
  spread: number; // 枪械散射 + 子弹数值补正（未截断，可为负）
  cap: number;
  loaded: number;
  recoilMul: number; // 修饰语：后坐力倍率
  knock: boolean; // 修饰语“强劲”
  reverse: boolean; // 修饰语“凶险”
}

export function gunStats(g: Gun, tempAtk = 0): GunStats {
  const md = g.mod ? GUN_MODS[g.mod] : null;
  let delay = g.delay + (md?.delay ?? 0), reload = g.reload + (md?.reload ?? 0), spread = g.spread, loaded = 0, atkAdd = 0;
  for (const b of g.bullets) {
    if (!b) continue;
    loaded++;
    const m = BULLETS[b.def].mods;
    delay += m.delay ?? 0;
    reload += m.reload ?? 0;
    spread += m.spread ?? 0;
    atkAdd += m.atk ?? 0;
  }
  return {
    atk: (g.atk + tempAtk + atkAdd) * (md?.dmg ?? 1),
    delay: Math.max(GUN_LIMITS.delay, delay),
    reload: Math.max(GUN_LIMITS.reload, reload),
    spread: Math.max(-360, Math.min(360, spread)), // 可为负：发射时与子弹散射相加后再截断到 0~360
    cap: g.cap,
    loaded,
    recoilMul: md?.recoil ?? 1,
    knock: !!md?.knock,
    reverse: !!md?.reverse,
  };
}

/** 装备中的枪械修饰语对玩家移动速度的影响（比例，加算） */
export function gunSpeedMod(g: Gun | null): number {
  return g?.mod ? GUN_MODS[g.mod].speed ?? 0 : 0;
}

/** 理论每秒伤害（单体估算）：按真实的施放顺序走一遍弹匣（含逻辑模块） */
export function gunDps(g: Gun, tempAtk = 0): number {
  const s = gunStats(g, tempAtk);
  if (s.loaded === 0) return 0;
  let dmg = 0, steps = 0, i = 0;
  const L = g.bullets.length;
  let guard = 0;
  while (i < L && guard++ < 64) {
    let toCast = 1, mul = 1, fired = 0;
    while (toCast > 0 && i < L) {
      const b = g.bullets[i++];
      if (!b) continue;
      const d = BULLETS[b.def];
      if (d.logic) {
        if (d.logic.cast) toCast += d.logic.cast - 1;
        if (d.logic.dmg) mul *= d.logic.dmg;
        if (d.logic.blast) mul *= 1.6;
        if (d.logic.pierce) mul *= 1.3;
        continue;
      }
      let m = bulletCount(b);
      // 盲盒：按所有子弹的平均水平估算
      const atk = d.flags?.mystery ? 55 : d.flags?.butter ? b.atk * (1 + d.flags.butter * 6) : b.atk;
      if (d.kind === 'toxic') m = 12;
      if (d.kind === 'singular') m = 25;
      if (d.kind === 'saw') m = 6;
      if (d.flags?.burn) m *= 2.2;
      dmg += atk * s.atk * m * mul;
      mul = 1;
      toCast--;
      fired++;
    }
    while (i < L && !g.bullets[i]) i++;
    if (i < L && fired > 0) steps++;
  }
  const cycle = steps * s.delay + s.reload;
  return dmg / Math.max(0.05, cycle);
}

export function gunValue(g: Gun): number {
  return (g.rarity + 2) * 700;
}

export function setGunCap(g: Gun, cap: number): void {
  cap = Math.max(1, Math.min(24, Math.round(cap)));
  g.cap = cap;
  while (g.bullets.length < cap) g.bullets.push(null);
}
