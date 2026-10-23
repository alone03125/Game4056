// 游戏逻辑 → 表现层（渲染/音频/界面）的单向事件接口。

import { BulletDef } from '../data/bullets';

export type SoundName =
  | 'hit' | 'kill' | 'coin' | 'pickup' | 'pickupBig' | 'hurt' | 'explosion' | 'smallExplosion' | 'reload'
  | 'spit' | 'splat' | 'door' | 'beep' | 'beepHigh' | 'heal' | 'buff' | 'bossRoar' | 'bossDash' | 'bossThrow'
  | 'bossSlam' | 'zap' | 'empty' | 'denied' | 'buy' | 'altar' | 'groan' | 'step' | 'ricochet' | 'drop'
  | 'mineArm' | 'vortex' | 'victory' | 'death' | 'click' | 'hover' | 'countdown' | 'bossLaser' | 'bossWave' | 'fuse'
  // 第4.3次调整：曼巴僵尸的过场动画、聚精会神的技巧检定
  | 'heartbeat' | 'rageRoar' | 'qteAlert' | 'qteGreat' | 'qteGood' | 'qteMiss';

/**
 * v4.3.7：音频文件里的音效（src/audio 下文件名开头的编号）。0 号与 10 号是音乐，由 app 按流程播放。
 * 没有这些文件时（公开仓库）直接跳过。
 */
export const VO = { years: 1, laugh: 2, mambaOut: 3, man: 4, teammates: 5, noPass: 6, thisHasBeen: 7, whatCanISay: 8, cantWrite: 9 } as const;

export interface Fx {
  shoot(x: number, y: number, angle: number, def: BulletDef, hand: number): void;
  /** 其他玩家开火（枪口火光 + 有距离衰减的枪声） */
  remoteShot(x: number, y: number, angle: number, def: BulletDef): void;
  sound(name: SoundName, x?: number, y?: number, vol?: number): void;
  sparks(x: number, y: number, color: number, n?: number, speed?: number): void;
  blood(x: number, y: number, color: number, n?: number, dirX?: number, dirY?: number): void;
  explosion(x: number, y: number, r: number, color: number): void;
  smoke(x: number, y: number, n?: number): void;
  arcs(points: number[]): void; // x0,y0,x1,y1,...
  /** hurt：自己受到的伤害（字号稍大，第4.3次调整） */
  damageNumber(x: number, y: number, amount: number, color: string, big?: boolean, hurt?: boolean): void;
  floatText(x: number, y: number, text: string, color: string): void;
  /** 第4.1次调整：拾取金币的跳字（1 秒内的金币合并成一个） */
  goldText(x: number, y: number, amount: number): void;
  decal(x: number, y: number, color: number, size: number): void;
  shake(amount: number): void;
  playerHurt(amount: number): void;
  toast(text: string, color?: string): void;
  bagFlash(): void;
  banner(title: string, subtitle: string, color?: string): void;
  muzzle(x: number, y: number, color: number): void;
  /** v4.3.7：依次播放音频文件音效（前一个播完再播下一个），delay 秒后开始；solo = 同一个音效还在播放时不再重复 */
  voice(ids: number[], delay?: number, solo?: boolean): void;
}

/** 空实现（用于无头测试） */
export const nullFx: Fx = {
  shoot() {}, remoteShot() {}, sound() {}, sparks() {}, blood() {}, explosion() {}, smoke() {}, arcs() {}, damageNumber() {},
  floatText() {}, goldText() {}, decal() {}, shake() {}, playerHurt() {}, toast() {}, bagFlash() {}, banner() {}, muzzle() {}, voice() {},
};
