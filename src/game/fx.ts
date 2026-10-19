// 游戏逻辑 → 表现层（渲染/音频/界面）的单向事件接口。

import { BulletDef } from '../data/bullets';

export type SoundName =
  | 'hit' | 'kill' | 'coin' | 'pickup' | 'pickupBig' | 'hurt' | 'explosion' | 'smallExplosion' | 'reload'
  | 'spit' | 'splat' | 'door' | 'beep' | 'beepHigh' | 'heal' | 'buff' | 'bossRoar' | 'bossDash' | 'bossThrow'
  | 'bossSlam' | 'zap' | 'empty' | 'denied' | 'buy' | 'altar' | 'groan' | 'step' | 'ricochet' | 'drop'
  | 'mineArm' | 'vortex' | 'victory' | 'death' | 'click' | 'hover' | 'countdown' | 'bossLaser' | 'bossWave' | 'fuse';

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
  damageNumber(x: number, y: number, amount: number, color: string, big?: boolean): void;
  floatText(x: number, y: number, text: string, color: string): void;
  decal(x: number, y: number, color: number, size: number): void;
  shake(amount: number): void;
  playerHurt(amount: number): void;
  toast(text: string, color?: string): void;
  bagFlash(): void;
  banner(title: string, subtitle: string, color?: string): void;
  muzzle(x: number, y: number, color: number): void;
}

/** 空实现（用于无头测试） */
export const nullFx: Fx = {
  shoot() {}, remoteShot() {}, sound() {}, sparks() {}, blood() {}, explosion() {}, smoke() {}, arcs() {}, damageNumber() {},
  floatText() {}, decal() {}, shake() {}, playerHurt() {}, toast() {}, bagFlash() {}, banner() {}, muzzle() {},
};
