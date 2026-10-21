// 联机接口（第2版）：游戏逻辑只通过这里与联机层（src/net/coop.ts）交互，单人模式下 world.net 为 null。
//
// 同步模型：每个玩家在本地游玩自己的角色（移动、射击、背包、辐射、金币都在本地结算），
// 房主的浏览器额外负责“世界”：丧尸与 Boss 的 AI、刷怪、地面道具的归属、流程推进（进入/离开安全屋）。
// 所有消息经由房主电脑上的服务器（serve.mjs）转发。

import type { Gun, GunLook } from '../data/guns';
import type { WorldThing } from '../data/items';
import type { RelicId } from '../data/relics';
import type { Enemy, EnemyShot } from './enemies';
import type { WorldItem } from './pickups';
import type { Proj } from './projectiles';
import type { PhaseMsg } from './world';

/** 丧尸可以追击的目标（站立中的玩家） */
export interface Target {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  local: boolean;
}

/** 其他玩家在本地的表示（由其定期发送的状态驱动） */
export interface RemotePlayer {
  id: number;
  name: string;
  slot: number; // 0..3，决定标识颜色
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: number;
  hp: number;
  maxHp: number;
  downed: boolean;
  dead: boolean;
  arrived: boolean; // 已进入下一个安全屋（不再被追击）
  suit: number;
  moving: number;
  walkPhase: number;
  firingT: [number, number];
  reloading: [boolean, boolean];
  looks: [GunLook | null, GunLook | null];
  lookRarity: [number, number];
  invuln: boolean;
  paused: boolean;
  rad: number;
  kills: number;
  /** 第4.3次调整：本局总输出、当前区域输出（输出排行） */
  dmgTotal: number;
  dmgZone: number;
  // 平滑
  tx: number;
  ty: number;
  tf: number;
  stamp: number; // 最近一次收到状态的本地时间
  hurtT: number;
  reviveBy: number; // 正在被谁拉起（-1 无）
  reviveK: number;
  // 第4次调整：观战时显示被观战玩家自己的武器、道具与属性
  speed: number;
  buffs: [number, number, number]; // 无敌 / 过热 / 鳗 的剩余时间
  hands: { auto: boolean; cursor: number; reloading: boolean; prog: number }[];
  prof: RemoteProfile | null;
}

/** 其他玩家的装备与背包概况（变化时发送，观战时显示） */
export interface RemoteProfile {
  guns: [Gun | null, Gun | null];
  counts: number[]; // 快捷栏道具数量
  recoilResist: number;
  gold: number;
  bank: number;
  bagUsed: number;
  bagCap: number;
  relics: RelicId[]; // 第4.1次调整：拥有的奇物
}

export interface NetHooks {
  readonly isHost: boolean;
  readonly myId: number;
  /** 当前存活（未阵亡）的玩家数量，用于丧尸 / 牢大的生命值倍率 */
  aliveCount(): number;
  remotes(): Iterable<RemotePlayer>;
  /** 第4.1次调整：本地玩家受到伤害（碰撞伤害由被打的人本地判定）；src = 造成伤害的敌人编号（没有时为 -1） */
  hurt(src: number, dmg: number): void;
  /** 主机：敌人死亡（附击杀者，用于金币分配） */
  enemyKilled(e: Enemy, gold: number, by: number): void;
  /** 主机：敌方投射物（口水 / 石块） */
  enemyShot(s: EnemyShot): void;
  /** 非主机：对镜像敌人造成的伤害，交给主机结算 */
  enemyDamage(e: Enemy, amount: number, flags: number, burnDps: number): void;
  enemyKnock(e: Enemy, kx: number, ky: number): void;
  /** 非主机：黄油造成的晕眩，交给主机结算（第4次调整） */
  enemyStun(e: Enemy, t: number): void;
  /** 本地玩家射出的投射物（广播给其他玩家，用于显示与友伤） */
  projSpawned(p: Proj): void;
  /** 非主机：奇点的吸引效果由主机模拟 */
  vortex(x: number, y: number, r: number, dur: number): void;
  /** 地面物品：非主机向主机申请拾取 */
  claimItem(it: WorldItem): void;
  /** 主机：物品被拿走 */
  itemTaken(uid: number, by: number): void;
  /** 本地丢弃 / 主机生成（敌人掉落）的物品 */
  itemDropped(it: WorldItem, thing: WorldThing): void;
  /** 拉起倒地的队友 */
  revive(id: number): void;
  /** 主机：广播流程消息（进入 / 离开安全屋、Boss、胜利、全员倒下、关门） */
  phase(m: PhaseMsg): void;
  /** 主机：广播表现层事件（横幅、音效、震屏……） */
  fx(kind: string, args: (string | number)[]): void;
  /** 生成联机唯一的地面物品编号 */
  newItemUid(): number;
  /** 第4.1次调整：区域任务——非房主点燃可燃物堆 / 踢动物资球，交给房主结算 */
  questIgnite(i: number): void;
  questKick(i: number, x: number, y: number, vx: number, vy: number): void;
  /** 第4.1次调整：房主——超级防护服把所有玩家的辐射平分 */
  radAvg(v: number): void;
}

/** 伤害事件的标记位 */
export const DMG_BURN = 1;
export const DMG_SLOW = 2;
export const DMG_GOLD = 4;
export const DMG_CORRODE = 8; // 第4.1次调整：腐蚀疗法
export const DMG_EXEC = 16; // 要害一击：直接击杀
export const DMG_PRE = 32; // 伤害已在本地计算过腐蚀加成
