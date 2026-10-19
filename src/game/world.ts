// 游戏世界：当前区域、实体、流程（探索 → 安全屋 → 下一区 → Boss）、辐射、受伤。
// 第3次调整：在辐射进入橙色之前击败牢大丧尸，尸王广场的安全屋打开，可以前往第六区“隐秘核心”挑战曼巴僵尸。
// 第2版：支持 1~4 人局域网联机（见 net.ts）。流程推进与丧尸 AI 由“权威端”（单人 / 房主）负责，
// 其他玩家收到房主的流程消息后在本地执行同样的流程函数（地图由同一个种子生成，因此完全一致）。

import { ZONES, SAFEHOUSE, PLAYER, DIFFICULTY, SUIT_MAX, COOP, REVIVE_INVULN } from '../config';
import { itemValue, ITEMS, JAR_VALUE, makeConsumable } from '../data/items';
import { pointInAABB } from '../util/math';
import { Rng } from '../util/rng';
import { CollisionWorld } from '../world/collision';
import { NavGrid } from '../world/navgrid';
import { generateZone, nextZoneOrigin, Obstacle, ZoneLayout } from '../world/zone';
import { Boss, BossAI } from './boss';
import { Mamba } from './mamba';
import { Enemies, Enemy } from './enemies';
import { Fx, SoundName } from './fx';
import type { NetHooks, RemotePlayer, Target } from './net';
import { Pickups } from './pickups';
import { Input, Player } from './player';
import { Projectiles } from './projectiles';
import { generateShop, ShopState } from './shop';
import { RunState } from './state';

export type Phase = 'explore' | 'safehouse' | 'boss' | 'dead' | 'victory';

/** 房主广播的流程消息（core = 牢大倒下且满足条件，通往隐秘核心的安全屋打开） */
export type PhaseMsg = 'safe' | 'leave' | 'boss' | 'victory' | 'over' | 'door' | 'core';

/** 第五区安全屋提供的净化血清：每名玩家 5 支，每支按第四区的数值减少 14K 辐射 */
export const CORE_PURIFY = { perPlayer: 5, power: 14 };

export const SUIT_NAMES = ['', 'I', 'II', 'III', 'IV', 'V'];

export interface WorldSettings {
  damageNumbers: boolean;
}

export interface WorldEvents {
  zoneBuilt(layout: ZoneLayout): void;
  enterSafehouse(): void;
  leaveSafehouse(): void;
  bossStart(): void;
  death(): void;
  victory(): void;
  doorChanged(o: Obstacle): void;
  /** 联机：本地玩家倒地 / 被拉起 / 阵亡后进入观战 */
  downed?(): void;
  /** 第3次调整：牢大倒下，通往隐秘核心的安全屋打开 */
  coreOpened?(): void;
  revived?(): void;
  spectate?(): void;
}

class Combo {
  count = 0;
  t = 0;
  constructor(private w: World) {}
  add(): void {
    this.count++;
    this.t = 2.6;
    if (this.count > this.w.run.stats.bestCombo) this.w.run.stats.bestCombo = this.count;
  }
  update(dt: number): void {
    if (this.t > 0) { this.t -= dt; if (this.t <= 0) this.count = 0; }
  }
}

/** 站立中的玩家（流程判断用） */
interface Standing { x: number; y: number }

export class World {
  run: RunState;
  fx: Fx;
  settings: WorldSettings;
  events: WorldEvents;
  layout!: ZoneLayout;
  col!: CollisionWorld;
  nav!: NavGrid;
  player: Player;
  enemies: Enemies;
  projs: Projectiles;
  pickups: Pickups;
  boss: BossAI | null = null;
  bossEnemy: Enemy | null = null;
  phase: Phase = 'explore';
  zoneTime = 0;
  time = 0;
  input: Input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: [false, false] };
  combo: Combo;
  flowT = 0;
  countdown = -1;
  countdownBeep = 0;
  shop: ShopState | null = null;
  safehouseZone = 0;
  zoneStarted = false;
  prevDoorClosed = false;
  deathT = 0;
  victoryT = 0;
  radLevel = 0; // 0 无 1 黄 2 橙 3 红
  corpses: { type: string; x: number; y: number; face: number; t: number; elite: number; side: number }[] = [];
  private mapRng: Rng;
  bagOpen = false;
  /** 主菜单背景用的世界：没有玩家 */
  showcase = false;
  // —— 联机 ——
  net: NetHooks | null = null;
  myId = 0;
  /** 丧尸可追击的目标（每帧刷新） */
  targets: Target[] = [];
  /** 镜头关注的位置：自己，或阵亡后观战的队友 */
  view = { x: 0, y: 0, face: 0 };
  arrived = false; // 本地玩家已进入下一个安全屋（等待队友）
  closeT = -1; // 有队友倒在外面时的关门倒计时
  waitInfo = ''; // 流程提示（等待队友……）
  reviveTarget = -1;
  reviveT = 0;
  spectate = -1;
  suitTakenAt = 0; // 在第几区的安全屋拿过防护服（每个安全屋只能拿一次）
  /** 第五区：牢大丧尸已被击败，通往隐秘核心的安全屋已打开 */
  bossCleared = false;
  private uidCounter = 1_000_000;
  private wsT = 0;

  constructor(run: RunState, fx: Fx, settings: WorldSettings, events: WorldEvents, net: NetHooks | null = null) {
    this.run = run;
    this.fx = fx;
    this.settings = settings;
    this.events = events;
    this.net = net;
    this.myId = net ? net.myId : 0;
    this.mapRng = new Rng(run.seed);
    this.player = new Player(this);
    this.enemies = new Enemies(this);
    this.projs = new Projectiles(this);
    this.pickups = new Pickups(this);
    this.combo = new Combo(this);
  }

  /** 单人 / 房主：负责丧尸 AI 与流程推进 */
  get isAuthority(): boolean {
    return !this.net || this.net.isHost;
  }

  /** 开始一局：生成第一区 */
  start(spawnIndex = 0): void {
    const startSide = this.mapRng.chance(0.5) ? 'L' : 'R';
    const layout = generateZone(1, { x0: 0, y0: 0 }, startSide, null, this.mapRng.int(1, 1e9));
    this.setLayout(layout);
    // 多人时出生点稍微错开
    const off = [[0, 0], [1.4, 0], [-1.4, 0], [0, -1.4]][spawnIndex % 4];
    this.player.place(layout.startPos.x + off[0], layout.startPos.y + off[1]);
    this.player.face = Math.PI / 2;
    this.view.x = this.player.x; this.view.y = this.player.y;
    this.beginZone();
  }

  private setLayout(layout: ZoneLayout): void {
    this.layout = layout;
    // 上一区的 Boss（已倒下）会回到对象池里被复用，换区时一并清掉引用
    this.boss = null;
    this.bossEnemy = null;
    this.col = new CollisionWorld(layout.obstacles);
    this.nav = new NavGrid(layout);
    this.enemies.reset();
    this.projs.clear();
    this.pickups.clear();
    this.flowT = 0;
    this.corpses = [];
    this.nav.computeFlow(this.player.x, this.player.y);
    this.events.zoneBuilt(layout);
  }

  /** 区域开始：开始探索计时、刷怪、生成道具 */
  private beginZone(): void {
    const L = this.layout;
    this.run.zoneIndex = L.index;
    this.zoneTime = 0;
    this.zoneStarted = true;
    this.prevDoorClosed = false;
    this.phase = 'explore';
    this.arrived = false;
    this.closeT = -1;
    this.pickups.spawnZoneItems(this.mapRng.fork());
    this.nav.computeFlow(this.player.x, this.player.y);
    if (this.isAuthority) this.enemies.initialSpawn();
    this.bossCleared = false;
    const sub = L.index >= 6 ? '击败曼巴僵尸，终结一切' : L.isBoss ? '击败尸王，结束这场噩梦' : '向安全屋前进，注意辐射值';
    this.fx.banner(`${L.cfg.name}　${L.cfg.subtitle}`, sub, '#ffffff');
  }

  spawningActive(): boolean {
    return this.zoneStarted && (this.phase === 'explore' || this.phase === 'boss') && !this.bossCleared;
  }

  /** 安全屋的大门是否已打开（第五区的安全屋要先击败牢大丧尸） */
  safeRoomOpen(): boolean {
    const sr = this.layout.safeRoom;
    return !!sr && (!this.layout.isBoss || this.bossCleared);
  }

  phaseActive(): boolean {
    return this.phase === 'explore' || this.phase === 'boss';
  }

  canCollect(): boolean {
    return this.player.standing;
  }

  /** 本地玩家当前能否被攻击 / 命中 */
  localTargetable(): boolean {
    return this.player.standing && !this.arrived && this.phase !== 'safehouse' && this.phase !== 'victory';
  }

  /** 金币吸取范围：单人模式为全图，联机时有一定范围（第2版） */
  goldMagnet(): number {
    return this.net ? COOP.magnet : Infinity;
  }

  newItemUid(): number {
    return this.net ? this.net.newItemUid() : this.uidCounter++;
  }

  /** 表现层事件：本地执行，房主还会广播给其他玩家 */
  fxAll(kind: string, ...args: (string | number)[]): void {
    this.applyFx(kind, args);
    if (this.net?.isHost) this.net.fx(kind, args);
  }

  applyFx(kind: string, a: (string | number)[]): void {
    const fx = this.fx;
    switch (kind) {
      case 'banner': fx.banner(String(a[0]), String(a[1]), String(a[2])); break;
      case 'sound': fx.sound(a[0] as SoundName, Number(a[1]), Number(a[2]), Number(a[3])); break;
      case 'shake': fx.shake(Number(a[0])); break;
      case 'toast': fx.toast(String(a[0]), String(a[1])); break;
      case 'smoke': fx.smoke(Number(a[0]), Number(a[1]), Number(a[2])); break;
    }
  }

  private refreshTargets(): void {
    const T = this.targets;
    T.length = 0;
    const p = this.player;
    if (this.localTargetable()) T.push({ id: this.myId, x: p.x, y: p.y, vx: p.vx, vy: p.vy, r: p.r, local: true });
    if (this.net) {
      for (const r of this.net.remotes()) {
        if (r.dead || r.downed || r.arrived) continue;
        T.push({ id: r.id, x: r.x, y: r.y, vx: r.vx, vy: r.vy, r: 0.4, local: false });
      }
    }
  }

  /** 站立中的玩家（包括已进入安全屋的） */
  private standingPlayers(): Standing[] {
    const out: Standing[] = [];
    if (this.player.standing) out.push(this.player);
    if (this.net) for (const r of this.net.remotes()) if (!r.dead && !r.downed) out.push(r);
    return out;
  }

  private downedPlayers(): Standing[] {
    const out: Standing[] = [];
    if (this.player.alive && this.player.downed) out.push(this.player);
    if (this.net) for (const r of this.net.remotes()) if (!r.dead && r.downed) out.push(r);
    return out;
  }

  remote(id: number): RemotePlayer | null {
    if (!this.net) return null;
    for (const r of this.net.remotes()) if (r.id === id) return r;
    return null;
  }

  update(dt: number, canFire: boolean): void {
    this.time += dt;
    const run = this.run;
    const p = this.player;
    if (this.phase === 'explore' || this.phase === 'boss') {
      this.zoneTime += dt;
      run.totalTime += dt;
    } else if (this.phase === 'safehouse') {
      run.totalTime += dt;
    }

    // 增益计时
    if (run.invulnT > 0) run.invulnT -= dt;
    if (run.overheatT > 0) run.overheatT -= dt;
    if (run.eelT > 0) run.eelT -= dt;

    // 第4次调整：安全屋里可以手动开枪试手感（不会伤到队友和自己，也打不到门外的丧尸；自动射击不生效）
    const allowFire = canFire && p.standing && this.phase !== 'victory';
    p.update(dt, this.input, allowFire, this.phase !== 'safehouse');
    // 是否已进入下一个安全屋（联机时先到的玩家在门内等待队友）
    const sr = this.layout.safeRoom;
    this.arrived = !!this.net && this.phase === 'explore' && !!sr && p.standing && this.inRoom(p, sr.interior);
    // Boss 的身体会把玩家挤开
    const be = this.bossEnemy;
    if (be && !be.dead && p.standing) {
      const dx = p.x - be.x, dy = p.y - be.y;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d < be.r + p.r) { p.x += (dx / d) * (be.r + p.r - d); p.y += (dy / d) * (be.r + p.r - d); }
    }
    this.refreshTargets();
    this.updateView();

    // 流场：以所有可追击的玩家为起点
    if (this.isAuthority) {
      this.flowT -= dt;
      if (this.flowT <= 0) {
        this.flowT = 0.25;
        if (this.targets.length) this.nav.computeFlowMulti(this.targets);
      }
    }

    this.enemies.update(dt);
    if (this.boss?.mirror) this.boss.tickTelegraphs(dt);
    this.projs.update(dt);
    this.pickups.update(dt);
    this.combo.update(dt);
    for (const c of this.corpses) c.t += dt;
    if (this.corpses.length && this.corpses[0].t > 2.2) this.corpses = this.corpses.filter((c) => c.t <= 2.2);

    this.updateRadiation(dt);
    if (this.isAuthority) this.updateFlow(dt);
    else this.updateClientCountdown();
    this.updateRevive(dt);

    if (this.phase === 'dead') this.deathT += dt;
    if (this.phase === 'victory') this.victoryT += dt;
  }

  private updateView(): void {
    const p = this.player;
    if (p.alive || !this.net) { this.view.x = p.x; this.view.y = p.y; this.view.face = p.face; return; }
    // 阵亡后观战：跟随一名仍在场的队友
    let r = this.spectate >= 0 ? this.remote(this.spectate) : null;
    if (!r || r.dead) {
      r = null;
      for (const o of this.net.remotes()) if (!o.dead) { r = o; break; }
      this.spectate = r ? r.id : -1;
    }
    if (r) { this.view.x = r.x; this.view.y = r.y; this.view.face = r.face; }
  }

  /** 观战时切换到下一名队友 */
  nextSpectate(): void {
    if (!this.net) return;
    const list = [...this.net.remotes()].filter((r) => !r.dead);
    if (!list.length) return;
    const i = list.findIndex((r) => r.id === this.spectate);
    this.spectate = list[(i + 1) % list.length].id;
  }

  /** 当前生效的辐射阈值：取决于身上的防护服（第3次调整：V 级防护服为 0/200/240K） */
  radThresh(): readonly [number, number, number] {
    return ZONES[Math.min(SUIT_MAX, this.run.suit) - 1].radThresh;
  }

  /** 安全屋防护服柜提供的防护服等级（0 = 没有可拿的）：每次只能换上高一阶的防护服；第五区的安全屋没有防护服柜 */
  suitOffer(): number {
    if (this.phase !== 'safehouse' || this.safehouseZone >= 5 || this.suitTakenAt === this.safehouseZone) return 0;
    return this.run.suit < SUIT_MAX ? this.run.suit + 1 : 0;
  }

  private updateRadiation(dt: number): void {
    const run = this.run;
    // 倒地时辐射值也会继续累积
    if (!(this.phase === 'explore' || this.phase === 'boss') || !this.player.alive) return;
    run.rad += this.layout.cfg.radRate * dt;
    const th = this.radThresh();
    let lvl = 0;
    if (run.rad >= th[2]) lvl = 3;
    else if (run.rad >= th[1]) lvl = 2;
    else if (run.rad >= th[0]) lvl = 1;
    if (lvl > this.radLevel) {
      const msg = ['', this.layout.isBoss ? '黄色辐射警告：速战速决' : '黄色辐射警告：尽快前往安全屋', '橙色辐射警告：生命开始流失', '红色辐射警告：生命正在快速流失！'][lvl];
      this.fx.toast(msg, ['#fff', '#ffe14a', '#ff8a1a', '#ff3030'][lvl]);
      this.fx.sound('beepHigh');
    }
    this.radLevel = lvl;
    if (run.invulnT > 0 || !this.player.standing || this.arrived) return;
    if (lvl >= 2) {
      const pct = lvl === 3 ? 0.03 : 0.003;
      const dmg = run.maxHp * pct * dt;
      run.hp -= dmg;
      run.stats.damageTaken += dmg;
      if (run.hp <= 0) this.die();
    }
  }

  private inRoom(s: Standing, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
    return pointInAABB(s.x, s.y, r) && s.y > r.y0 + 0.6;
  }

  /** 权威端：流程推进 */
  private updateFlow(dt: number): void {
    const L = this.layout;
    const stand = this.standingPlayers();
    this.waitInfo = '';
    // 离开上一个安全屋后（所有人都出来了），关闭身后的门
    if (this.phase === 'explore' && L.prevRoom && !this.prevDoorClosed && stand.length && stand.every((s) => s.y > L.prevRoom!.rect.y1 + 3.5)) {
      this.closePrevDoor();
      this.net?.phase('door');
    }
    // 抵达新的安全屋：所有站着的玩家都进门后关门，进入整备状态
    if (this.phase === 'explore' && L.safeRoom && this.safeRoomOpen() && stand.length) {
      const inside = stand.filter((s) => this.inRoom(s, L.safeRoom!.interior)).length;
      if (inside === stand.length) {
        const out = this.downedPlayers().filter((s) => !this.inRoom(s, L.safeRoom!.interior));
        if (out.length === 0) { this.hostEnterSafehouse(); return; }
        // 还有倒地的队友在外面：给一点时间回去救人
        if (this.closeT < 0) this.closeT = COOP.closeGrace;
        this.closeT -= dt;
        if (this.closeT <= 0) { this.hostEnterSafehouse(); return; }
      } else {
        this.closeT = -1;
        if (inside > 0) this.waitInfo = `等待队友进入安全屋（${inside}/${stand.length}）`;
      }
    }
    // Boss 区：有人进入场地后召唤 Boss
    if (this.phase === 'explore' && L.isBoss && !this.boss && !this.bossCleared && stand.some((s) => s.y > L.rect.y0 + 7)) {
      this.startBoss();
      this.net?.phase('boss');
    }
    // 安全屋出口倒计时：所有人都站到出口的黄色区域
    if (this.phase === 'safehouse' && L.prevRoom) {
      const n = stand.filter((s) => pointInAABB(s.x, s.y, L.prevRoom!.exitTrigger)).length;
      if (n > 0 && n === stand.length) {
        if (this.countdown < 0) { this.countdown = SAFEHOUSE.exitCountdown; this.countdownBeep = Math.ceil(this.countdown); this.fx.sound('beep'); }
        this.countdown -= dt;
        const c = Math.ceil(this.countdown);
        if (c < this.countdownBeep && c > 0) { this.countdownBeep = c; this.fx.sound('beep'); }
        if (this.countdown <= 0) {
          this.countdown = -1;
          this.fx.sound('beepHigh');
          this.leaveSafehouse();
          this.net?.phase('leave');
        }
      } else {
        if (this.countdown >= 0) this.countdown = -1;
        if (n > 0) this.waitInfo = `等待队友到出口集合（${n}/${stand.length}）`;
      }
    }
    // 联机：所有玩家都倒下 → 游戏结束
    if (this.net && this.phaseActive() && stand.length === 0) {
      this.gameOver();
      this.net.phase('over');
    }
  }

  /** 非房主：倒计时提示音 */
  private updateClientCountdown(): void {
    if (this.countdown >= 0) {
      const c = Math.ceil(this.countdown);
      if (c !== this.countdownBeep && c > 0) { this.countdownBeep = c; this.fx.sound('beep'); }
    }
  }

  /** 房主同步的流程信息（倒计时、关门等待、提示文字） */
  applyWorldState(cd: number, ct: number, info: string, zt: number): void {
    this.countdown = cd;
    this.closeT = ct;
    this.waitInfo = info;
    if (Math.abs(zt - this.zoneTime) > 1) this.zoneTime = zt;
  }

  /** 收到房主的流程消息 */
  onPhaseMsg(m: PhaseMsg): void {
    switch (m) {
      case 'safe': if (this.phase === 'explore' && this.layout.safeRoom) this.enterSafehouse(); break;
      case 'leave': if (this.phase === 'safehouse') { this.countdown = -1; this.fx.sound('beepHigh'); this.leaveSafehouse(); } break;
      case 'boss': if (this.phase === 'explore' && this.layout.isBoss) this.startBoss(); break;
      case 'door': this.closePrevDoor(); break;
      case 'core': if (!this.bossCleared && this.layout.index === 5) this.openCore(); break;
      case 'victory': if (this.phase !== 'victory') this.onVictory(); break;
      case 'over': this.gameOver(); break;
    }
  }

  private closePrevDoor(): void {
    const L = this.layout;
    if (this.prevDoorClosed || !L.prevRoom) return;
    this.prevDoorClosed = true;
    this.setDoor(L.prevRoom.exitDoor, false);
  }

  setDoor(o: Obstacle, open: boolean): void {
    if (o.open === open) return;
    o.open = open;
    this.nav.setDoor(o);
    this.fx.sound('door', (o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, 1);
    this.events.doorChanged(o);
  }

  private hostEnterSafehouse(): void {
    this.net?.phase('safe');
    this.enterSafehouse();
  }

  private enterSafehouse(): void {
    const L = this.layout;
    const room = L.safeRoom!;
    const run = this.run;
    const p = this.player;
    this.closeT = -1;
    this.waitInfo = '';
    // 联机：没被拉起、也没进安全屋的倒地玩家将在本局阵亡；站着的玩家若因延迟还在门外则拉进门内
    if (p.alive) {
      const inside = this.inRoom(p, room.interior);
      if (p.downed && !inside) this.permaDeath();
      else if (!inside) p.place((room.interior.x0 + room.interior.x1) / 2, (room.interior.y0 + room.interior.y1) / 2);
      if (p.downed) { p.downed = false; run.hp = Math.max(run.hp, run.maxHp * COOP.reviveHp); this.events.revived?.(); }
    }
    this.setDoor(room.entranceDoor, false);
    run.stats.zoneTimes.push(this.zoneTime);
    // 第3次调整：进入安全屋不再自动回满生命，需要走到医疗箱旁交互
    // 币和换金道具全部暂存
    let banked = run.gold;
    run.bank += run.gold;
    run.gold = 0;
    let jars = 0, vals = 0;
    run.bag = run.bag.filter((it) => {
      if (it.kind === 'item' && it.id === 'jar') { jars++; return false; }
      if (it.kind === 'item' && it.id === 'valuable') { vals++; return false; }
      return true;
    });
    run.bank += jars * JAR_VALUE;
    banked += jars * JAR_VALUE;
    run.freeAltar += vals;
    run.invulnT = 0; run.overheatT = 0; run.eelT = 0;
    this.player.resetHands();
    this.safehouseZone = L.index;
    this.shop = room.minimal ? null : generateShop(run, L.index);
    this.radLevel = 0;
    this.reviveTarget = -1;
    // 生成下一区域（此时房间成为下一区域的起点房间）
    const nextIndex = L.index + 1;
    const { origin, startSide } = nextZoneOrigin(room, nextIndex);
    const next = generateZone(nextIndex, origin, startSide, room, this.mapRng.int(1, 1e9));
    this.enemies.clearAll();
    this.zoneStarted = false;
    this.phase = 'safehouse';
    this.countdown = -1;
    this.arrived = false;
    this.setLayout(next);
    if (room.minimal) this.spawnCorePurify(room);
    if (p.alive) {
      this.fx.toast('安全屋：在医疗箱旁可以回满生命', '#7affc0');
      if (L.index === 4) this.fx.toast('前方是尸王广场：那里的辐射极强，速战速决', '#ff8a6a');
      if (room.minimal) this.fx.toast('这里只有医疗箱和一批净化血清，前方就是隐秘核心', '#9aff4a');
      if (banked > 0) this.fx.toast(`已暂存 ${banked} 金币${jars ? `（含 ${jars} 个金币罐）` : ''}`, '#ffd24a');
      if (vals > 0) this.fx.toast(`贵重品兑换：免费祭坛加点 ×${vals}`, '#e07aff');
    }
    this.events.enterSafehouse();
  }

  /** 第五区安全屋：在房间里放上 玩家数 × 5 支净化血清（所有玩家用同样的编号生成，由房主裁决归属） */
  private spawnCorePurify(room: { interior: { x0: number; y0: number; x1: number; y1: number } }): void {
    const players = 1 + (this.net ? [...this.net.remotes()].length : 0);
    const n = players * CORE_PURIFY.perPlayer;
    const r = room.interior;
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    const cols = Math.min(5, n);
    for (let i = 0; i < n; i++) {
      const col = i % cols, row = Math.floor(i / cols);
      const x = cx + (col - (cols - 1) / 2) * 2.2, y = cy - 2.5 + row * 1.7;
      const thing = makeConsumable('purify', CORE_PURIFY.power);
      this.pickups.items.push({ uid: 5000 + i, thing, x, y, dead: false, age: i * 0.3, seen: true, auto: false, pending: 0, failT: 0 });
    }
  }

  private leaveSafehouse(): void {
    const L = this.layout;
    // 清掉试枪留下的子弹、地雷与毒雾
    this.projs.clear();
    this.setDoor(L.prevRoom!.exitDoor, true);
    this.shop = null;
    this.events.leaveSafehouse();
    this.beginZone();
  }

  private startBoss(): void {
    const L = this.layout;
    const mamba = L.index >= 6;
    if (this.isAuthority) {
      const bs = L.bossSpawn!;
      this.bossEnemy = this.enemies.spawnBoss(bs.x, bs.y, mamba ? 'mamba' : 'laoda');
      this.boss = mamba ? new Mamba(this, this.bossEnemy) : new Boss(this, this.bossEnemy);
    }
    this.phase = 'boss';
    if (mamba) this.fx.banner('曼巴僵尸', '隐秘核心的主人', '#c06aff');
    else this.fx.banner('牢大丧尸', '尸潮之王', '#ff4a3a');
    this.events.bossStart();
  }

  /** 非房主：快照中出现了 Boss */
  onBossMirror(e: Enemy): void {
    this.bossEnemy = e;
    this.boss = this.layout.index >= 6 ? new Mamba(this, e, true) : new Boss(this, e, true);
    this.fx.sound('bossRoar', e.x, e.y, 1);
    this.fx.shake(0.8);
  }

  /** 牢大倒下时能否打开隐秘核心：所有仍在场的玩家的辐射都还没进入橙色 */
  private coreUnlockOk(): boolean {
    const ok = (rad: number, suit: number) => rad < ZONES[Math.min(SUIT_MAX, Math.max(1, suit)) - 1].radThresh[1];
    let any = false;
    if (this.player.alive) { any = true; if (!ok(this.run.rad, this.run.suit)) return false; }
    if (this.net) for (const r of this.net.remotes()) { if (r.dead) continue; any = true; if (!ok(r.rad, r.suit)) return false; }
    return any;
  }

  /** 牢大倒下且满足条件：清场，打开通往隐秘核心的安全屋 */
  private openCore(e: Enemy | null = this.bossEnemy): void {
    const L = this.layout;
    this.bossCleared = true;
    this.run.laodaKilled = true;
    this.phase = 'explore';
    if (e) {
      e.dead = true;
      this.fx.explosion(e.x, e.y, 6, 0xff6a2a);
      this.fx.sound('explosion', e.x, e.y, 1);
    }
    this.fx.shake(1.2);
    for (const o of this.enemies.list) {
      if (o.dead || o === e) continue;
      o.dead = true;
      this.fx.blood(o.x, o.y, 0x6a1a14, 6);
    }
    this.enemies.eliteCount = 0;
    this.enemies.shots = [];
    this.boss = null;
    if (L.safeRoom) this.setDoor(L.safeRoom.entranceDoor, true);
    this.fx.banner('尸王倒下了', '隐秘核心的大门打开了：进入安全屋，前往第六区', '#c06aff');
    this.fx.sound('victory');
    this.events.coreOpened?.();
  }

  /** 玩家受伤；返回是否实际造成了伤害 */
  damagePlayer(amount: number, sx: number, sy: number): boolean {
    const run = this.run;
    const p = this.player;
    if (!this.localTargetable()) return false;
    if (run.invulnT > 0 || p.iframe > 0) return false;
    if ((this as any).__god) return false;
    run.hp -= amount;
    run.stats.damageTaken += amount;
    p.iframe = PLAYER.contactIFrame;
    p.hurtT = 0.3;
    this.fx.playerHurt(amount);
    this.fx.damageNumber(p.x, p.y, amount, '#ff4a4a', false);
    this.fx.blood(p.x, p.y, 0xaa1010, 6, p.x - sx, p.y - sy);
    if (run.hp <= 0) this.die();
    return true;
  }

  /** 友伤（第2版）：玩家的子弹对玩家只造成 5% 伤害，包括自己的爆炸；有独立的短暂无敌 */
  friendlyFire(dmg: number, sx: number, sy: number): void {
    const run = this.run;
    const p = this.player;
    if (!this.localTargetable() || run.invulnT > 0 || p.ffIframe > 0) return;
    if ((this as any).__god) return;
    const amount = dmg * COOP.friendlyFire;
    if (amount < 0.05) return;
    p.ffIframe = 0.5;
    run.hp -= amount;
    run.stats.damageTaken += amount;
    p.hurtT = 0.2;
    this.fx.damageNumber(p.x, p.y, amount, '#ff9a5a', false);
    this.fx.blood(p.x, p.y, 0xaa1010, 3, p.x - sx, p.y - sy);
    if (run.hp <= 0) this.die();
  }

  healPlayer(amount: number, quiet = false): void {
    const run = this.run;
    if (!this.player.standing) return;
    const before = run.hp;
    run.hp = Math.min(run.maxHp, run.hp + amount);
    if (!quiet && run.hp > before) this.fx.floatText(this.player.x, this.player.y, `+${Math.round(run.hp - before)}`, '#6aff8a');
  }

  private die(): void {
    const p = this.player;
    if (!p.standing) return;
    this.run.hp = 0;
    if (this.net) {
      // 联机：倒地，等待队友拉起
      p.downed = true;
      p.iframe = 0;
      this.reviveTarget = -1;
      this.fx.sound('death');
      this.fx.shake(0.8);
      this.fx.toast('你倒下了！等待队友拉起', '#ff5a4a');
      this.events.downed?.();
      return;
    }
    p.alive = false;
    this.phase = 'dead';
    this.deathT = 0;
    this.fx.sound('death');
    this.fx.shake(1);
    this.events.death();
  }

  /** 被队友拉起：恢复 30% 生命值 */
  revived(by: string): void {
    const p = this.player;
    if (!p.alive || !p.downed) return;
    p.downed = false;
    this.run.hp = this.run.maxHp * COOP.reviveHp;
    p.iframe = 1.5;
    // 第4次调整：刚被拉起的玩家有 4 秒无敌
    this.run.invulnT = Math.max(this.run.invulnT, REVIVE_INVULN);
    this.fx.sound('heal');
    this.fx.toast(`${by} 把你拉了起来`, '#6aff8a');
    this.fx.floatText(p.x, p.y, '已被拉起', '#6aff8a');
    this.events.revived?.();
  }

  /** 本局阵亡（倒地后没被拉起，队友进入了安全屋）：之后观战其他玩家 */
  private permaDeath(): void {
    const p = this.player;
    p.alive = false;
    p.downed = false;
    this.run.hp = 0;
    this.fx.toast('你在本局中阵亡了，正在观战队友', '#ff5a4a');
    this.events.spectate?.();
  }

  /** 拉起倒地的队友：在其身边按 F 并站立不动约 0.5 秒 */
  startRevive(): boolean {
    const p = this.player;
    if (!this.net || !p.standing || !this.phaseActive()) return false;
    let best: RemotePlayer | null = null, bd = COOP.reviveRange;
    for (const r of this.net.remotes()) {
      if (!r.downed || r.dead) continue;
      const d = Math.hypot(r.x - p.x, r.y - p.y);
      if (d < bd) { bd = d; best = r; }
    }
    if (!best) return false;
    this.reviveTarget = best.id;
    this.reviveT = 0;
    return true;
  }

  private updateRevive(dt: number): void {
    if (this.reviveTarget < 0) return;
    const p = this.player;
    const r = this.remote(this.reviveTarget);
    const moving = Math.abs(this.input.moveX) + Math.abs(this.input.moveY) > 0.1;
    if (!r || !r.downed || r.dead || !p.standing || moving || Math.hypot(r.x - p.x, r.y - p.y) > COOP.reviveRange + 0.4) {
      this.reviveTarget = -1;
      return;
    }
    this.reviveT += dt;
    if (this.reviveT >= COOP.reviveTime) {
      this.net!.revive(r.id);
      this.fx.toast(`拉起了 ${r.name}`, '#6aff8a');
      this.reviveTarget = -1;
    }
  }

  onBossKilled(e: Enemy): void {
    if (this.layout.index === 5 && this.layout.safeRoom && this.coreUnlockOk()) {
      this.net?.phase('core');
      this.openCore(e);
      return;
    }
    this.net?.phase('victory');
    this.onVictory(e);
  }

  private onVictory(e: Enemy | null = this.bossEnemy): void {
    this.phase = 'victory';
    this.victoryT = 0;
    if (this.layout.index >= 6) this.run.mambaKilled = true;
    this.run.laodaKilled = true;
    if (e) {
      this.fx.explosion(e.x, e.y, 6, 0xff6a2a);
      this.fx.sound('explosion', e.x, e.y, 1);
    }
    this.fx.shake(1.2);
    this.run.stats.zoneTimes.push(this.zoneTime);
    // 其余丧尸一同倒下
    for (const o of this.enemies.list) {
      if (o.dead || o === e) continue;
      o.dead = true;
      this.fx.blood(o.x, o.y, 0x6a1a14, 6);
    }
    if (e) e.dead = true;
    this.enemies.eliteCount = 0;
    this.boss = null;
    this.events.victory();
  }

  /** 联机：所有玩家都倒下了 */
  private gameOver(): void {
    if (this.phase === 'dead') return;
    this.phase = 'dead';
    this.deathT = 0;
    this.fx.shake(1);
    this.events.death();
  }

  /** 使用背包中的消耗品 */
  useItem(uid: number): string | null {
    const run = this.run;
    const it = run.bag.find((b) => b.uid === uid);
    if (!it || it.kind !== 'item') return '无法使用';
    const def = ITEMS[it.id];
    if (!def.usable) return '该物品无法直接使用';
    if (!this.player.standing) return '倒地时无法使用道具';
    const p = this.player;
    switch (it.id) {
      case 'painkiller':
        if (run.hp >= run.maxHp) return '生命值已满';
        this.healPlayer(run.maxHp * 0.6);
        this.fx.sound('heal');
        break;
      case 'milkgold': run.invulnT = 9; this.fx.sound('buff'); this.fx.floatText(p.x, p.y, '无敌 9 秒', '#fff6d8'); break;
      case 'overheat': run.overheatT = 9; this.fx.sound('buff'); this.fx.floatText(p.x, p.y, '攻击倍率 +3.00x', '#ff6a3a'); break;
      case 'eel': run.eelT = 9; this.fx.sound('buff'); this.fx.floatText(p.x, p.y, '移动速度 +160%', '#5a9aff'); break;
      case 'purify': {
        if (run.rad <= 0.01) return '当前没有辐射';
        const v = Math.min(run.rad, it.power || this.layout.cfg.purify);
        run.rad = Math.max(0, run.rad - v);
        this.fx.sound('heal');
        this.fx.floatText(p.x, p.y, `辐射 -${v.toFixed(1)}K`, '#9aff4a');
        this.radLevel = 0;
        break;
      }
      case 'part1': {
        const v = itemValue(it);
        run.addAtkAll(v); this.fx.sound('buff'); this.fx.floatText(p.x, p.y, `所有枪攻击倍率 +${Number(v.toFixed(3))}x`, '#ff9a3a');
        break;
      }
      case 'part2': {
        // 第3次调整：-0.15s（可保留）；换弹延迟不会低于 0.25s
        const v = itemValue(it);
        run.addReloadAll(-v); this.fx.sound('buff'); this.fx.floatText(p.x, p.y, `所有枪换弹 -${Number(v.toFixed(3))}s`, '#3ac8ff');
        break;
      }
      default: return '无法使用';
    }
    run.removeFromBag(uid);
    return null;
  }

  /** 把背包物品丢到地上（之后需要按 F 拾取） */
  dropFromBag(uid: number): void {
    const it = this.run.removeFromBag(uid);
    if (!it) return;
    const p = this.player;
    const a = p.face + Math.PI + (Math.random() - 0.5);
    const wi = this.pickups.dropThing(it, p.x + Math.cos(a) * 1.2, p.y + Math.sin(a) * 1.2, false);
    wi.age = 0;
    this.fx.sound('drop');
  }

  dropGold(amount: number): void {
    const run = this.run;
    amount = Math.min(amount, run.gold);
    if (amount <= 0) return;
    run.gold -= amount;
    const p = this.player;
    this.pickups.dropThing({ uid: 0, kind: 'gold', amount }, p.x - Math.cos(p.face) * 1.4, p.y - Math.sin(p.face) * 1.4, false);
    this.fx.sound('drop');
  }

  /** 拿取防护服柜里高一阶的防护服 */
  takeSuit(): boolean {
    const t = this.suitOffer();
    if (!t) return false;
    this.run.suit = t;
    this.suitTakenAt = this.safehouseZone;
    const th = ZONES[t - 1].radThresh;
    this.fx.sound('buff');
    this.fx.toast(`换上 ${SUIT_NAMES[t]} 级防护服：辐射阈值 ${th[0]}/${th[1]}/${th[2]}K`, '#7affc0');
    this.fx.floatText(this.player.x, this.player.y, `${SUIT_NAMES[t]} 级防护服`, '#7affc0');
    return true;
  }

  /** 医疗箱：回满生命值 */
  useMedkit(): boolean {
    const run = this.run;
    const p = this.player;
    if (run.hp >= run.maxHp - 0.01) { this.fx.toast('生命值已满', '#8d939a'); this.fx.sound('denied'); return false; }
    const before = run.hp;
    run.hp = run.maxHp;
    this.fx.sound('heal');
    this.fx.floatText(p.x, p.y, `+${Math.round(run.hp - before)}`, '#6aff8a');
    this.fx.toast('医疗箱：生命值已回满', '#6aff8a');
    return true;
  }

  /** 按 F：拉起队友 / 与安全屋设施交互 / 拾取 */
  interact(): 'altar' | 'shop' | 'suit' | 'medkit' | 'revive' | null {
    const p = this.player;
    if (!p.standing) return null;
    if (this.phase === 'safehouse' && this.layout.prevRoom) {
      const r = this.layout.prevRoom;
      if (!r.minimal) {
        if (Math.hypot(p.x - r.altar.x, p.y - r.altar.y) < 2.4) return 'altar';
        if (Math.hypot(p.x - r.shop.x, p.y - r.shop.y) < 2.4) return 'shop';
        if (Math.hypot(p.x - r.suit.x, p.y - r.suit.y) < 1.6) { if (this.takeSuit()) return 'suit'; }
      }
      if (Math.hypot(p.x - r.medkit.x, p.y - r.medkit.y) < 1.6) { this.useMedkit(); return 'medkit'; }
    }
    if (this.startRevive()) return 'revive';
    const it = this.pickups.nearestItem(p.x, p.y, PLAYER.pickupRadius);
    if (it) this.pickups.tryPickup(it);
    return null;
  }

  /** 调试：直接推进流程（进入安全屋 / 离开安全屋），仅限权威端 */
  debugAdvance(): void {
    const L = this.layout;
    if (!this.isAuthority) return;
    if (this.phase === 'explore' && L.safeRoom) {
      const r = L.safeRoom.interior;
      this.player.place((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
      this.hostEnterSafehouse();
    } else if (this.phase === 'safehouse' && L.prevRoom) {
      const t = L.prevRoom.exitTrigger;
      this.player.place((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2 - 0.5);
      this.countdown = -1;
      this.net?.phase('leave');
      this.leaveSafehouse();
    }
  }

  /** 房主：定期广播的流程信息 */
  worldStateDue(dt: number): boolean {
    this.wsT -= dt;
    if (this.wsT > 0) return false;
    this.wsT = 0.1;
    return true;
  }

  diffName(): string {
    return DIFFICULTY[this.run.difficulty].name;
  }
}
