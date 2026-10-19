// 一局游戏的持久状态：玩家属性、背包、银行金币、祭坛次数、统计数据。

import { Difficulty, GUN_LIMITS, PLAYER, ZONES } from '../config';
import { Bullet, makeBullet } from '../data/bullets';
import { Gun, makeFixedGun, setGunCap } from '../data/guns';
import { BagItem, itemSize, ITEMS } from '../data/items';
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
  gold = 0; // 背包携带金币
  totalTime = 0;
  stats: RunStats = {
    kills: 0, eliteKills: 0, damageDealt: 0, damageTaken: 0, goldEarned: 0, itemsFound: 0, shotsFired: 0,
    zoneTimes: [], bestCombo: 0,
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

  bagUsed(extraGold = 0): number {
    let u = 0;
    for (const it of this.bag) u += itemSize(it);
    u += Math.ceil((this.gold + extraGold) / PLAYER.goldPerUnit);
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
    return Math.max(0, unitsForGold * PLAYER.goldPerUnit - this.gold);
  }

  allGuns(): Gun[] {
    const out: Gun[] = [];
    for (const g of this.guns) if (g) out.push(g);
    for (const it of this.bag) if (it.kind === 'gun') out.push(it);
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
