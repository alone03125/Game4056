// 一局游戏的持久状态：玩家属性、背包、银行金币、祭坛次数、统计数据。

import { Difficulty, GUN_LIMITS, PLAYER, ZONES } from '../config';
import { Bullet, makeBullet } from '../data/bullets';
import { Gun, GunStats, gunStats, makeFixedGun, setGunCap } from '../data/guns';
import { BagItem, itemSize, ITEMS } from '../data/items';
import { RELIC, RelicId } from '../data/relics';
import { Rng } from '../util/rng';

export interface RunStats {
  kills: number;
  eliteKills: number;
  damageDealt: number;
  damageTaken: number;
  goldEarned: number;
  itemsFound: number;
  shotsFired: number;
  zoneTimes: number[];
  bestCombo: number;
  /** 第4.3次调整：当前区域造成的伤害、在区域里战斗的总时间（输出统计） */
  zoneDamage: number;
  fightTime: number;
}

/** 开局武器（数据依然由公式推出；图鉴里也会显示） */
export const STARTER_GUNS = [
  { name: '老伙计手枪', model: 'HGK-13', rarity: 1, atk: 1.11, delay: 0.26, cap: 3, spread: 4, roll: 1.2 },
  { name: '拆迁办短喷', model: 'SGB-12', rarity: 1, atk: 1.55, delay: 0.35, cap: 2, spread: 14, roll: 1.15 },
] as const;

export class RunState {
  seed: number;
  difficulty: Difficulty;
  rng: Rng; // 掉落/商店
  zoneIndex = 1;
  maxHp = PLAYER.hp;
  hp = PLAYER.hp;
  speedPct = 0; // 额外移动速度百分比（加算）
  recoilResist = 0; // 0..0.8
  bagCap = PLAYER.bagCapacity;
  bank = 0;
  altarCount = 0;
  freeAltar = 0;
  rad = 0; // K
  /** 第3次调整：击败了牢大丧尸（之后若在隐秘核心倒下，仍然算作通关） */
  laodaKilled = false;
  /** 击败了曼巴僵尸（真结局） */
  mambaKilled = false;
  suit = 1;
  guns: [Gun | null, Gun | null] = [null, null];
  bag: BagItem[] = [];
  /** 第4.1次调整：安全屋里的临时整备区（不限格数，关闭背包或商店界面时全部掉在地上） */
  temp: BagItem[] = [];
  /** 第4.1次调整：商店祭坛“全局强化零件1型”的全局攻击倍率加成（最多 +1.60x） */
  globalAtk = 0;
  /** 第4.1次调整：拥有的奇物增益 */
  relics: RelicId[] = [];
  /** 当前连杀数（愈战愈勇） */
  combo = 0;
  /** 第4.3次调整：友谊地久天长的层数、聚精会神的专注代币 */
  friendN = 0;
  focusTokens = 0;
  gold = 0; // 背包携带金币
  totalTime = 0;
  stats: RunStats = {
    kills: 0, eliteKills: 0, damageDealt: 0, damageTaken: 0, goldEarned: 0, itemsFound: 0, shotsFired: 0,
    zoneTimes: [], bestCombo: 0, zoneDamage: 0, fightTime: 0,
  };
  // 增益
  invulnT = 0;
  overheatT = 0;
  eelT = 0;

  /** slot：联机时的玩家序号（让每名玩家的商店与开局子弹各不相同） */
  constructor(seed: number, difficulty: Difficulty, slot = 0) {
    this.seed = seed;
    this.difficulty = difficulty;
    this.rng = new Rng((seed ^ 0xa5a5a5 ^ Math.imul(slot, 0x9e3779b1)) >>> 0);
    // 开局武器：主手一把手枪 + 副手一把短喷（数据依然由公式推出）
    const [s1, s2] = STARTER_GUNS;
    const g1 = makeFixedGun(s1.name, s1.model, s1.rarity, s1.atk, s1.delay, s1.cap, s1.spread, s1.roll, this.rng);
    g1.bullets[0] = makeBullet('std', this.rng, 1.05);
    g1.bullets[1] = makeBullet('std', this.rng, 1.0);
    g1.bullets[2] = makeBullet('brass', this.rng, 1.0);
    const g2 = makeFixedGun(s2.name, s2.model, s2.rarity, s2.atk, s2.delay, s2.cap, s2.spread, s2.roll, this.rng);
    g2.bullets[0] = makeBullet('buck', this.rng, 1.0);
    this.guns = [g1, g2];
  }

  get zoneCfg() {
    return ZONES[Math.min(this.zoneIndex, ZONES.length) - 1];
  }

  has(id: RelicId): boolean {
    return this.relics.includes(id);
  }

  /** 每格金币堆的容量（老古董：3500） */
  goldUnit(): number {
    return this.has('antique') ? RELIC.antiqueStack : PLAYER.goldPerUnit;
  }

  /** 对所有枪生效的攻击倍率加成：全局强化零件1型、过热模块与奇物 */
  atkBonus(): number {
    let a = this.globalAtk + (this.overheatT > 0 ? 3 : 0);
    if (this.has('brave') && this.combo > RELIC.braveFrom) a += Math.min(RELIC.braveMax, this.combo * RELIC.bravePer);
    if (this.has('unyield') && this.lowHp()) a += RELIC.unyieldAtk;
    if (this.has('might')) a += RELIC.mightAtk;
    if (this.has('scepter')) a += Math.min(RELIC.scepterMax, Math.floor((this.gold + this.bank) / RELIC.scepterPer) * RELIC.scepterStep);
    if (this.has('friend')) a += this.friendN * RELIC.friendAtk;
    if (this.has('focus')) a += (this.focusTokens - 1) * RELIC.focusAtk;
    return a;
  }

  /** 移动速度的奇物倍率（聚精会神：-6%，每枚代币 +6%） */
  focusSpeed(): number {
    return this.has('focus') ? 1 + (this.focusTokens - 1) * RELIC.focusSpeed : 1;
  }

  /** 奇物图标角落显示的数字（友谊地久天长的层数、聚精会神的代币） */
  relicBadge(id: RelicId): number | null {
    if (id === 'friend') return this.friendN;
    if (id === 'focus') return this.focusTokens;
    return null;
  }

  lowHp(): boolean {
    return this.hp < this.maxHp * RELIC.unyieldHp;
  }

  /** 实际生效的枪械数值（含全局加成与奇物；hand：0 主手 / 1 副手 / -1 不在手上） */
  handStats(g: Gun, hand = -1): GunStats {
    const st = gunStats(g, this.atkBonus());
    if (hand === 0 && this.has('breath')) st.delay = Math.max(GUN_LIMITS.delay, st.delay * 0.5);
    if (this.has('unyield') && this.lowHp()) {
      st.delay = Math.max(GUN_LIMITS.delay, st.delay - RELIC.unyieldTime);
      st.reload = Math.max(GUN_LIMITS.reload, st.reload - RELIC.unyieldTime);
    }
    return st;
  }

  bagUsed(extraGold = 0): number {
    let u = 0;
    for (const it of this.bag) u += itemSize(it);
    u += Math.ceil((this.gold + extraGold) / this.goldUnit());
    return u;
  }

  bagFree(): number {
    return this.bagCap - this.bagUsed();
  }

  canFit(size: number): boolean {
    return this.bagUsed() + size <= this.bagCap;
  }

  /** 可再装入的金币数量（考虑当前堆叠的剩余空间） */
  goldRoom(): number {
    let u = 0;
    for (const it of this.bag) u += itemSize(it);
    const unitsForGold = this.bagCap - u;
    return Math.max(0, unitsForGold * this.goldUnit() - this.gold);
  }

  allGuns(): Gun[] {
    const out: Gun[] = [];
    for (const g of this.guns) if (g) out.push(g);
    for (const it of this.bag) if (it.kind === 'gun') out.push(it);
    for (const it of this.temp) if (it.kind === 'gun') out.push(it);
    return out;
  }

  addAtkAll(v: number): void {
    for (const g of this.allGuns()) g.atk = Math.round((g.atk + v) * 1000) / 1000;
  }
  addReloadAll(v: number): void {
    for (const g of this.allGuns()) g.reload = Math.max(GUN_LIMITS.reload, Math.round((g.reload + v) * 1000) / 1000);
  }
  addCapAll(v: number): void {
    for (const g of this.allGuns()) setGunCap(g, g.cap + v);
  }

  removeFromBag(uid: number): BagItem | null {
    const i = this.bag.findIndex((it) => it.uid === uid);
    if (i < 0) return null;
    return this.bag.splice(i, 1)[0];
  }

  countItem(id: string): number {
    let n = 0;
    for (const it of this.bag) if (it.kind === 'item' && it.id === id) n++;
    return n;
  }

  bulletsInBag(): Bullet[] {
    return this.bag.filter((b): b is Bullet => b.kind === 'bullet');
  }

  itemName(id: keyof typeof ITEMS): string {
    return ITEMS[id].name;
  }
}
