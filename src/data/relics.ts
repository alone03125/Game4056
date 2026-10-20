// 奇物（第4.1次调整）：打破奇物宝箱后掉落，任意玩家捡起后，所有玩家各自从随机的三个增益中选择一个。
// 增益是全局的，不管拿着什么枪都会生效；同一个增益不会重复出现。

export type RelicId =
  | 'brave' | 'unyield' | 'antique' | 'bandage' | 'might' | 'crit' | 'bow' | 'knife' | 'shield'
  | 'suit' | 'breath' | 'golden' | 'scepter' | 'feather' | 'shock' | 'burn' | 'corrode';

export interface RelicDef {
  id: RelicId;
  name: string;
  desc: string;
  color: string;
  glyph: string; // 图标上的字
}

export const RELICS: Record<RelicId, RelicDef> = {
  brave: { id: 'brave', name: '愈战愈勇', glyph: '勇', color: '#ff7a3a', desc: '连杀超过 10 之后，每 1 连杀让所有枪械的攻击倍率 +0.02x，最高 +2.00x。' },
  unyield: { id: 'unyield', name: '百折不挠', glyph: '韧', color: '#ff4a5a', desc: '生命值低于 50% 时，所有枪械的攻击倍率 +0.90x、换弹延迟 -0.09s、射击延迟 -0.09s，移动速度 +9%。' },
  antique: { id: 'antique', name: '老古董', glyph: '古', color: '#d8b06a', desc: '背包里每 1 格金币堆可以放 3500 金币；你击杀的敌人掉落的金币 +100%。' },
  bandage: { id: 'bandage', name: '快速包扎', glyph: '包', color: '#6aff8a', desc: '枪械每次换弹时，回复 4 点生命值。' },
  might: { id: 'might', name: '天生神力', glyph: '力', color: '#ffb03a', desc: '体型、视野和碰撞范围 +80%；移动速度、生命值和生命上限 +80%；所有枪械的攻击倍率 +0.80x。' },
  crit: { id: 'crit', name: '要害一击', glyph: '暴', color: '#ff3a3a', desc: '你的子弹命中时有 10% 的概率暴击，造成 3 倍伤害；暴击命中普通丧尸时直接将其击杀。持续伤害不会暴击。' },
  bow: { id: 'bow', name: '沉眠长弓', glyph: '弓', color: '#9ad8ff', desc: '每 6 秒向最近的敌人射出一支箭，造成 250 点伤害。每射出一支，间隔缩短 0.1 秒，最短 0.3 秒。在安全屋里不计时。' },
  knife: { id: 'knife', name: '刺客短刀', glyph: '刃', color: '#e8eef4', desc: '副手武器每射出一发子弹，都会向最近的敌人掷出一把短刀，造成 80 点伤害。' },
  shield: { id: 'shield', name: '圣盾', glyph: '盾', color: '#fff2a0', desc: '受到伤害时有 50% 的概率免疫这次伤害。触发后 5 秒内不会再次触发。' },
  suit: { id: 'suit', name: '超级防护服', glyph: '服', color: '#7affc0', desc: '你受到的辐射 -33%。有存活的队友时改为 -66%，并且每次进入安全屋时，所有玩家的辐射值会被平分。' },
  breath: { id: 'breath', name: '神息刀', glyph: '息', color: '#c8a0ff', desc: '主手武器的射击延迟减半。' },
  golden: { id: 'golden', name: '金刀', glyph: '金', color: '#ffd24a', desc: '你对敌人造成伤害时，有 5% 的概率再对它造成一次 150 点伤害。' },
  scepter: { id: 'scepter', name: '王杖', glyph: '杖', color: '#ffc83a', desc: '你每拥有 100 金币（携带与已暂存的合计），所有枪械的攻击倍率 +0.01x，最高 +2.00x。' },
  feather: { id: 'feather', name: '黑曜羽毛', glyph: '羽', color: '#8a7aaa', desc: '你每对敌人造成 50 次伤害，回复 3 点生命值。' },
  shock: { id: 'shock', name: '电击疗法', glyph: '电', color: '#6ab8ff', desc: '你的子弹造成的伤害会以 45% 的比例传导给附近的 2 名敌人。' },
  burn: { id: 'burn', name: '灼烧疗法', glyph: '灼', color: '#ff8a2a', desc: '你的子弹会让敌人灼烧：3 秒内每秒受到该子弹 30% 的额外伤害。再次命中会刷新持续时间。' },
  corrode: { id: 'corrode', name: '腐蚀疗法', glyph: '蚀', color: '#9aff4a', desc: '你的子弹会腐蚀命中的敌人，使其在接下来 3 秒内受到的伤害 +40%。再次命中会刷新持续时间。' },
};

export const RELIC_IDS = Object.keys(RELICS) as RelicId[];

/** 奇物效果的数值 */
export const RELIC = {
  braveFrom: 10, bravePer: 0.02, braveMax: 2,
  unyieldHp: 0.5, unyieldAtk: 0.9, unyieldTime: 0.09, unyieldSpeed: 0.09,
  antiqueStack: 3500, antiqueGold: 2,
  bandageHeal: 4,
  mightScale: 1.8, mightAtk: 0.8,
  critChance: 0.1, critMul: 3,
  bowDmg: 250, bowStart: 6, bowStep: 0.1, bowMin: 0.3,
  knifeDmg: 80,
  shieldChance: 0.5, shieldCd: 5,
  suitSolo: 0.67, suitTeam: 0.34,
  goldenChance: 0.05, goldenDmg: 150,
  scepterPer: 100, scepterStep: 0.01, scepterMax: 2,
  featherHits: 50, featherHeal: 3,
  shockPct: 0.45, shockTargets: 2, shockRange: 6,
  burnPct: 0.3, burnTime: 3,
  corrodeMul: 1.4, corrodeTime: 3,
  /** 自动锁定（长弓、短刀）的最远距离 */
  aimRange: 30,
};
