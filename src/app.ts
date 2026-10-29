// 应用主控：状态机（主菜单 / 游戏中 / 暂停 / 结算）、主循环、输入分发、把游戏事件接到渲染/音频/界面。
// 第2版：联机（房间大厅、联机对局的创建与结束、暂停同步、观战、后台标签页时的模拟）。

import { AudioEngine } from './audio/audio';
import { COOP, Difficulty, PLAYER } from './config';
import { BulletDef, bulletName } from './data/bullets';
import { Consumable, ITEM_GRADE, itemName, ITEMS, QUICK_ORDER } from './data/items';
import { InputState } from './core/input';
import { KEY_ACTIONS, KeyAction, keyLabel, loadRecords, loadSettings, Records, saveRecords, saveSettings, Settings } from './core/settings';
import { Bot } from './debug/bot';
import { Fx, SoundName } from './game/fx';
import { RunState } from './game/state';
import { SUIT_NAMES, World, WorldEvents } from './game/world';
import { Coop } from './net/coop';
import { LobbyState, NetClient, StartInfo } from './net/transport';
import { SLOT_CSS } from './render/entities';
import { Overlay } from './render/overlay';
import { Quality, Renderer } from './render/renderer';
import { BagView } from './ui/bag';
import { h } from './ui/dom';
import { Hud } from './ui/hud';
import { Menus, MpActions, parseSeed, TeamLine } from './ui/menus';
import { RelicView } from './ui/relic';
import { SafehouseView } from './ui/safehouse';
import { Tooltip } from './ui/tooltip';
import { RARITY_CSS } from './config';
import css from './ui/style.css';

type AppState = 'menu' | 'playing' | 'paused' | 'end';

export class App {
  root: HTMLElement;
  gameEl: HTMLDivElement;
  uiEl: HTMLDivElement;
  settings: Settings;
  records: Records;
  renderer!: Renderer;
  overlay: Overlay;
  audio = new AudioEngine();
  input: InputState;
  hud: Hud;
  menus: Menus;
  tip: Tooltip;
  bag: BagView;
  safe: SafehouseView;
  relicUi: RelicView;
  fadeEl: HTMLDivElement;
  state: AppState = 'menu';
  world: World | null = null;
  menuWorld: World | null = null;
  bot: Bot | null = null;
  botMode = false;
  // —— 联机 ——
  net: NetClient | null = null;
  coop: Coop | null = null;
  private lobbyState: LobbyState | null = null;
  private lanUrls: string[] = [];
  private mp: MpActions;
  private bgWorker: Worker | null = null;
  private lastRaf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;
  private fpsT = 0;
  private fpsN = 0;
  private endShown = false;
  private aim = { x: 0, y: 0 };
  private menuCam = { x: 0, y: 0, t: 0 };
  private ambientT = 0;
  private lastHints = '';
  /** 第4.3次调整（流畅性）：暂停时画面不变，只重绘最开始的几帧；主菜单背景隔一帧渲染一次 */
  private stillFrames = 0;
  private menuSkip = false;

  constructor(root: HTMLElement) {
    this.root = root;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    this.settings = loadSettings();
    this.records = loadRecords();
    this.botMode = /[?&]bot=1/.test(location.search);
    this.gameEl = h('div', { class: 'layer', style: 'pointer-events:auto' });
    this.uiEl = h('div', { class: 'layer' });
    root.append(this.gameEl, this.uiEl);
    this.createRenderer();
    this.overlay = new Overlay(this.gameEl);
    this.input = new InputState(this.gameEl);
    this.hud = new Hud(this.uiEl);
    this.tip = new Tooltip(document.body);
    const cb = {
      sound: (n: string) => this.audio.play(n as SoundName),
      toast: (t: string, c?: string) => this.hud.toast(t, c),
    };
    this.bag = new BagView(() => this.world, this.tip, cb, false);
    this.uiEl.appendChild(this.bag.root);
    this.safe = new SafehouseView(() => this.world, this.tip, cb);
    this.safe.onClose = () => { this.safe.setOpen(false); this.audio.play('click'); };
    this.uiEl.appendChild(this.safe.root);
    // 第4.1次调整：奇物三选一
    this.relicUi = new RelicView(this.uiEl, (id) => { this.world?.relicFx.choose(id); this.audio.play('click'); });
    this.menus = new Menus(this.uiEl, this.settings, () => this.records, {
      start: (d, s) => this.startGame(d, s),
      multiplayer: () => { void this.openMultiplayer(); },
      resume: () => this.resume(),
      quit: () => this.quit(),
      settingsChanged: (s) => this.applySettings(s),
      sound: (n) => { this.audio.init(); this.audio.play(n); },
    });
    this.mp = {
      create: (name) => this.net?.create(name),
      join: (code, name) => {
        if (!/^[A-Z]{4}$/.test(code)) { this.menus.mpEntry(this.mp, '房间号是 4 位英文字母'); return; }
        this.net?.join(code, name);
      },
      setName: (n) => this.net?.setName(n),
      setCfg: (d, seed) => this.net?.setCfg(d, seed),
      start: (d, seed) => this.net?.start(parseSeed(seed) ?? ((Math.random() * 1e9) >>> 0), d),
      leave: () => this.leaveRoom(),
    };
    this.fadeEl = h('div', { class: 'fade' });
    this.uiEl.appendChild(this.fadeEl);
    this.hud.onBagClick = () => this.toggleBag();
    this.hud.onQuickUse = (i) => this.quickUse(i);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('blur', () => {
      if (this.settings.autoPause && this.state === 'playing' && !this.botMode && !this.coop) this.pause();
      this.updateMute();
    });
    window.addEventListener('focus', () => this.updateMute());
    document.addEventListener('pointerdown', () => this.audio.init(), { once: false });
    document.addEventListener('visibilitychange', () => this.onVisibility());
    this.gameEl.addEventListener('pointerdown', () => { if (this.world && !this.world.player.alive && this.coop) this.world.nextSpectate(); });
    this.resize();
    this.applySettings(this.settings, true);
    this.toMenu();
    (window as any).__game = this;
    requestAnimationFrame((t) => this.loop(t));
    if (this.botMode && !/[?&]mp=1/.test(location.search)) setTimeout(() => this.startGame(this.settings.difficulty, Number(new URLSearchParams(location.search).get('seed')) || null), 300);
  }

  private createRenderer(): void {
    this.renderer = new Renderer(this.gameEl, this.settings.quality as Quality);
    this.renderer.renderer.domElement.style.zIndex = '0';
  }

  private resize(): void {
    const w = window.innerWidth, h2 = window.innerHeight;
    this.stillFrames = 0;
    this.renderer.resize(w, h2);
    this.overlay.resize(w, h2, window.devicePixelRatio || 1);
    // 小窗口时整体缩放界面（以 1280×760 为参考分辨率）
    const z = Math.max(0.55, Math.min(1, w / 1280, h2 / 760));
    (this.uiEl.style as any).zoom = String(z);
    (this.tip.el.style as any).zoom = String(z);
  }

  applySettings(s: Settings, initial = false): void {
    this.settings = s;
    saveSettings(s);
    this.audio.volumes = { master: s.master / 100, music: s.music / 100, sfx: s.sfx / 100 };
    this.audio.applyVolumes();
    if (!initial) this.updateMute();
    if (!initial && s.quality !== this.renderer.quality) {
      // 重建渲染器
      this.renderer.dispose();
      this.overlay.canvas.remove();
      this.createRenderer();
      this.gameEl.appendChild(this.overlay.canvas);
      this.resize();
      const w = this.world ?? this.menuWorld;
      if (w) this.renderer.buildZone(w.layout);
    }
    this.renderer.zoom = s.zoom / 100;
    this.renderer.shakeEnabled = s.shake;
    this.renderer.setBrightness(s.brightness);
    if (this.world) this.world.settings.damageNumbers = s.damageNumbers;
    this.hud.fps.classList.toggle('hidden', !s.showFps);
    this.hud.keys = s.keys;
    this.lastHints = '';
  }

  // —— 表现层事件 ——
  private makeFx(silent: boolean): Fx {
    const r = () => this.renderer;
    const a = this.audio;
    return {
      shoot: (x, y, angle, def: BulletDef, hand) => {
        r().particles.muzzle(x, y, angle, def.color);
        r().muzzle(hand, x, y, def.color);
        if (!silent) a.shot(def.sfx, hand, def.atk);
      },
      remoteShot: (x, y, angle, def: BulletDef) => {
        r().particles.muzzle(x, y, angle, def.color);
        if (!silent) a.remoteShot(def.sfx, x, y, def.atk);
      },
      sound: (name, x, y, vol) => { if (!silent) a.play(name, x, y, vol); },
      sparks: (x, y, c, n = 6, s = 4) => r().particles.sparks(x, y, c, n, s),
      blood: (x, y, c, n = 8, dx = 0, dy = 0) => {
        const l = Math.hypot(dx, dy) || 1;
        r().particles.blood(x, y, c, n, dx / l, dy / l);
      },
      explosion: (x, y, rad, c) => { r().particles.explosion(x, y, rad, c); r().boom(x, y, rad, c); },
      smoke: (x, y, n = 4) => r().particles.smoke(x, y, n),
      arcs: (pts) => {
        for (let i = 0; i < pts.length; i += 4) {
          const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
          const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3);
          for (let k = 0; k <= n; k++) {
            const t = k / n;
            const j = (Math.random() - 0.5) * 0.5;
            r().particles.add.emit(x0 + (x1 - x0) * t + j, 1.1 + (Math.random() - 0.5) * 0.4, -(y0 + (y1 - y0) * t) + j, 0, 0, 0, 0.18, 0.5, 0.2, 0xb0d0ff, 0, 0);
          }
        }
      },
      damageNumber: (x, y, amt, color, big, hurt) => { if (this.settings.damageNumbers) this.overlay.damage(x, y, amt, color, !!big, !!hurt); },
      floatText: (x, y, text, color) => this.overlay.text(x, y, text, color),
      goldText: (x, y, amount) => this.overlay.goldText(x, y, amount),
      decal: (x, y, c, s) => r().entities.addDecal(x, y, c, s),
      shake: (amt) => r().shake(amt),
      playerHurt: (amt) => {
        if (!silent) { a.play('hurt'); this.hud.hurtFlash(); }
        r().shake(Math.min(0.6, 0.15 + amt / 80));
      },
      toast: (t, c) => { if (!silent) this.hud.toast(t, c); },
      bagFlash: () => this.hud.bagFlash(),
      banner: (t, s, c) => { if (!silent) this.hud.showBanner(t, s, c); },
      muzzle: () => {},
      voice: (ids, delay, solo) => { if (!silent) a.voice(ids, delay, solo); },
    };
  }

  private makeEvents(isMenu: boolean): WorldEvents {
    return {
      zoneBuilt: (layout) => {
        this.renderer.buildZone(layout);
        this.overlay.clear();
        if (!isMenu) this.flashFade();
      },
      enterSafehouse: () => {
        if (isMenu) return;
        // 第3次调整：进入安全屋时不再自动弹出商店 / 祭坛面板，可以亲眼看到被堵在门外的丧尸
        this.bag.setOpen(false);
        this.input.releaseFire();
        // v4.3.7：击败牢大后 0 号音乐以 40% 音量继续播放，安全屋里不换成程序化音乐
        if (this.audio.file?.id !== 0) this.audio.music?.play('safe');
      },
      coreOpened: () => {
        if (isMenu) return;
        if (this.audio.file?.id === 0) this.audio.file.volume(0.4, 1);
        else this.audio.music?.play('safe');
      },
      leaveSafehouse: () => {
        if (isMenu) return;
        this.safe.setOpen(false);
        const z = this.world!.layout.index;
        // v4.3.7：从隐秘核心前的安全屋出来时，0 号音乐跳到 1:17 并恢复音量
        const f = this.audio.file;
        if (f?.id === 0) { f.seek(77); f.volume(1, 0.8); return; }
        this.audio.music?.play('explore', Math.min(4, z));
      },
      bossStart: () => {
        if (isMenu) return;
        // v4.3.7：Boss 战播放 0 号音乐（淡入）；进入曼巴的 Boss 战时它已经在播放
        const f = this.audio.file;
        if (f && (f.id === 0 || f.play(0, { fade: 2.5, loop: true }))) { f.volume(1, 0.5); this.audio.music?.play('none'); }
        else this.audio.music?.play('boss');
      },
      cine: (on) => {
        if (isMenu) return;
        const f = this.audio.file;
        // v4.3.7：曼巴僵尸爬起时快速切换到 10 号音乐（与耐久战计时同步，播完时曼巴倒下）
        if (on) { this.audio.music?.play('none'); if (!f?.play(10, { fade: 0.35, xfade: 0.6, hold: true })) f?.stop(0.6); }
        else if (f?.id !== 10) this.audio.music?.play('boss');
      },
      death: () => { if (!isMenu) { this.audio.music?.stinger('death'); this.audio.file?.stop(0.8); this.bag.setOpen(false); } },
      victory: () => {
        if (isMenu) return;
        this.audio.music?.stinger('victory');
        // v4.3.7：击败牢大后 0 号音乐降到 40% 继续播放；10 号音乐此时正好播完
        if (this.audio.file?.id === 0) this.audio.file.volume(0.4, 1);
        this.bag.setOpen(false);
      },
      doorChanged: () => {},
      downed: () => { if (!isMenu) { this.bag.setOpen(false); this.input.releaseFire(); this.hud.hurtFlash(); } },
      spectate: () => { if (!isMenu) { this.bag.setOpen(false); this.safe.setOpen(false); this.audio.music?.stinger('death'); } },
    };
  }

  private flashFade(): void {
    this.fadeEl.classList.add('on');
    setTimeout(() => this.fadeEl.classList.remove('on'), 120);
  }

  // —— 状态切换 ——
  toMenu(): void {
    this.state = 'menu';
    this.world = null;
    this.bot = null;
    this.coop = null;
    this.stopBgWorker();
    this.bag.setOpen(false);
    this.safe.setOpen(false);
    this.hud.show(false);
    this.root.classList.remove('ingame');
    // 背景：一个没有玩家的区域，镜头缓慢巡游
    const run = new RunState((Math.random() * 1e9) >>> 0, 'normal');
    const mw = new World(run, this.makeFx(true), { damageNumbers: false }, this.makeEvents(true));
    mw.showcase = true;
    mw.start();
    mw.player.alive = false;
    mw.phase = 'dead';
    this.menuWorld = mw;
    this.menuCam = { x: mw.layout.startPos.x, y: mw.layout.startPos.y, t: 0 };
    this.menus.main();
    this.audio.file?.stop(0.5);
    this.audio.music?.play('menu');
    this.endShown = false;
  }

  /** 菜单里的“退出”：联机时离开房间 */
  private quit(): void {
    if (this.net) this.leaveRoom();
    this.toMenu();
  }

  // —— 联机房间 ——

  private async openMultiplayer(): Promise<void> {
    this.audio.init();
    if (!NetClient.available()) { this.menus.mpUnavailable(); return; }
    if (this.net?.connected) {
      if (this.lobbyState && this.net.code) this.menus.lobby(this.lobbyState, this.net.myId, this.lanUrls, this.mp);
      else this.menus.mpEntry(this.mp);
      return;
    }
    this.menus.showLoading('正在连接服务器…');
    const net = new NetClient();
    net.onLobby = (s) => {
      this.lobbyState = s;
      if (this.state === 'menu' && (this.menus.current === 'mp' || this.menus.current === 'lobby' || this.menus.current === 'none')) {
        this.menus.lobby(s, net.myId, this.lanUrls, this.mp);
      }
    };
    net.onError = (msg) => {
      if (this.state !== 'menu') { this.hud.toast(msg, '#ff5a4a'); return; }
      if (this.menus.current === 'lobby' && this.lobbyState) this.menus.lobby(this.lobbyState, net.myId, this.lanUrls, this.mp, msg);
      else this.menus.mpEntry(this.mp, msg);
    };
    net.onStart = (info) => this.startMultiplayer(info);
    net.onReset = () => {
      // 房主带大家回到房间大厅
      if (this.state !== 'menu') this.toMenu();
      if (this.lobbyState) this.menus.lobby({ ...this.lobbyState, started: false }, net.myId, this.lanUrls, this.mp);
    };
    net.onClosed = (msg) => this.netEnded(msg);
    net.onDisconnect = () => this.netEnded('与服务器的连接已断开');
    try {
      await net.connect();
    } catch {
      this.menus.mpMessage('联机游戏', '无法连接到服务器。请确认房主电脑上的 node serve.mjs 正在运行，并且两台电脑在同一个局域网中。', () => this.menus.main());
      return;
    }
    this.net = net;
    fetch('/api/info').then((r) => r.json()).then((j) => { this.lanUrls = j.lan ?? []; }).catch(() => {});
    this.menus.mpEntry(this.mp);
  }

  private leaveRoom(): void {
    const net = this.net;
    this.net = null;
    this.lobbyState = null;
    if (net) {
      net.onDisconnect = () => {};
      net.leave();
      setTimeout(() => net.close(), 100);
    }
  }

  /** 房间解散或断线 */
  private netEnded(msg: string): void {
    const inGame = !!this.coop && (this.state === 'playing' || this.state === 'paused');
    this.net = null;
    this.lobbyState = null;
    if (inGame) {
      this.toMenu();
      this.menus.mpMessage('联机已结束', msg, () => this.menus.main());
    } else if (this.state === 'menu' && (this.menus.current === 'lobby' || this.menus.current === 'mp')) {
      this.menus.mpMessage('联机游戏', msg, () => this.menus.main());
    } else if (this.state === 'end') {
      this.hud.toast(msg, '#ff9a3c');
    }
  }

  private startMultiplayer(info: StartInfo): void {
    if (!this.net) return;
    const coop = new Coop(this.net, info.hostId, info.players);
    this.startGame(info.diff as Difficulty, info.seed, coop, info.players.findIndex((p) => p.id === this.net!.myId));
  }

  startGame(diff: Difficulty, seed: number | null, coop: Coop | null = null, spawnIndex = 0): void {
    this.audio.init();
    this.menus.hide();
    this.menuWorld = null;
    const run = new RunState(seed ?? ((Math.random() * 1e9) >>> 0), diff, coop ? coop.myId : 0);
    const w = new World(run, this.makeFx(false), { damageNumbers: this.settings.damageNumbers }, this.makeEvents(false), coop);
    this.world = w;
    this.coop = coop;
    if (coop) coop.attach(w);
    w.start(Math.max(0, spawnIndex));
    this.state = 'playing';
    this.endShown = false;
    this.hud.show(true);
    this.root.classList.add('ingame');
    this.audio.file?.stop(0.3);
    this.audio.music?.play('explore', 1);
    this.records.runs++;
    saveRecords(this.records);
    this.renderer.camX = w.player.x;
    this.renderer.camY = w.player.y;
    if (this.botMode) this.bot = new Bot(w);
    this.lastHints = '';
    if (coop) {
      this.hud.toast(coop.isHost ? '你是房主，请不要关闭本页面' : '已进入联机对局', '#4affe0');
      this.startBgWorker();
      return;
    }
    // 调试参数：?zone=N 直接跳到第 N 区；?god=1 无敌；?gold=N 给予金币
    const qs = new URLSearchParams(location.search);
    const jump = Number(qs.get('zone') || 0);
    if (jump > 1) {
      for (let k = 0; k < (jump - 1) * 2; k++) w.debugAdvance();
      if (qs.get('safe') === '1') w.debugAdvance();
    }
    if (qs.get('gold')) w.run.bank += Number(qs.get('gold'));
    if (qs.get('god') === '1') (w as any).__god = true;
  }

  pause(): void {
    if (this.state !== 'playing' || !this.world) return;
    this.state = 'paused';
    this.input.releaseFire();
    this.bag.setOpen(false);
    this.safe.setOpen(false);
    this.menus.pause(this.world.run, !!this.coop);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.menus.hide();
    this.last = performance.now();
  }

  toggleBag(): void {
    const w = this.world;
    if (!w || this.state !== 'playing' || !w.player.alive) return;
    if (this.safe.open) { this.safe.setOpen(true, 'bag'); return; }
    this.bag.setOpen(!this.bag.open);
    this.input.releaseFire();
    this.audio.play('click');
  }

  quickUse(i: number): void {
    const w = this.world;
    if (!w || this.state !== 'playing' || this.simPaused() || !w.player.alive) return;
    const id = QUICK_ORDER[i];
    if (!id) return;
    // 有多个时优先使用前缀等级最高的（顶级 > 高级 > 普通）
    let it: Consumable | null = null;
    for (const b of w.run.bag) if (b.kind === 'item' && b.id === id && (!it || (b.grade ?? 0) > (it.grade ?? 0))) it = b;
    if (!it) { this.hud.toast(`没有 ${ITEMS[id].name}`, '#888'); this.audio.play('denied'); return; }
    const err = w.useItem(it.uid);
    if (err) { this.hud.toast(err, '#ff5a4a'); this.audio.play('denied'); }
  }

  /** 本地是否处于暂停：单人时 ESC 或打开背包；联机时任何一名玩家暂停 */
  private simPaused(): boolean {
    const w = this.world;
    if (!w) return false;
    if (this.coop) return this.coop.anyPaused() && w.phaseActive();
    return this.state === 'paused' || ((this.bag.open || this.relicUi.open) && w.phaseActive());
  }

  private handleKeys(): void {
    const keys = this.input.consume();
    const w = this.world;
    const K = this.settings.keys;
    for (const k of keys) {
      if (this.menus.capturingKey) continue;
      if (k === 'Escape') {
        if (this.state === 'playing') {
          if (this.bag.open) { this.bag.setOpen(false); continue; }
          if (this.safe.open) { this.safe.setOpen(false); continue; }
          this.pause();
        } else if (this.state === 'paused') {
          if (this.menus.current === 'pause') this.resume();
          else this.menus.pause(w!.run, !!this.coop);
        }
        continue;
      }
      if (this.state !== 'playing' || !w) continue;
      if (k === 'Space' && !w.player.alive && this.coop) { w.nextSpectate(); continue; }
      // 奇物三选一：数字键 1~3
      if (this.relicUi.open) {
        const m = /^(?:Digit|Numpad)([1-3])$/.exec(k);
        if (m) this.relicUi.pickIndex(w, Number(m[1]) - 1);
        continue;
      }
      const action = KEY_ACTIONS.find((a) => K[a] === k) as KeyAction | undefined;
      if (!action) continue;
      if (action === 'bag') { this.toggleBag(); continue; }
      if (this.simPaused()) continue;
      if (action === 'interact') {
        if (this.safe.open) continue;
        const r = w.interact();
        if (r === 'altar' || r === 'shop') { this.safe.setOpen(true, r); this.audio.play('click'); }
      } else if (action === 'reload') w.player.manualReload();
      else if (action === 'special') w.relicFx.qtePress();
      else if (action === 'autoL' || action === 'autoR') {
        const hs = w.player.hands[action === 'autoL' ? 0 : 1];
        hs.auto = !hs.auto;
        this.hud.toast(`${action === 'autoL' ? '主手' : '副手'}自动射击：${hs.auto ? '开' : '关'}`, hs.auto ? '#6aff8a' : '#888');
        this.audio.play('click');
      } else if (action.startsWith('item')) this.quickUse(Number(action.slice(4)) - 1);
    }
  }

  // —— 主循环 ——
  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    this.lastRaf = performance.now();
    let dt = (now - (this.last || now)) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this.fpsT += dt;
    this.fpsN++;
    if (this.fpsT >= 0.5) {
      if (this.settings.showFps) {
        const ping = this.net && this.coop && !this.coop.isHost ? `　延迟 ${Math.round(this.net.rtt)}ms` : '';
        const R = this.renderer;
        const res = `　渲染 ${Math.round(R.renderScale * 100)}%（GPU ${R.gpuMs.toFixed(1)}ms）`;
        this.hud.fps.textContent = `${Math.round(this.fpsN / this.fpsT)} FPS　${this.world ? this.world.enemies.list.length : 0} 敌人　${this.world ? this.world.projs.list.length : 0} 弹${ping}${res}`;
      }
      this.fpsT = 0; this.fpsN = 0;
    }
    try {
      this.handleKeys();
      if (this.state === 'menu' && this.menuWorld) this.frameMenu(dt);
      else if (this.world) this.frameGame(dt, true);
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * 联机时的保底计时：页面切到后台、窗口最小化或被浏览器节流时 requestAnimationFrame 会停下来，
   * 但房主的电脑负责丧尸与流程，不能停。这里用 Worker 计时，发现超过 0.2 秒没有画面帧时就只做模拟。
   */
  private onVisibility(): void {
    if (this.coop && this.world) this.startBgWorker();
    // v4.3.7：单人时切到后台游戏会停下，10 号音乐也立即暂停（联机时后台仍在模拟，音乐继续）
    if (document.hidden && !this.coop) this.audio.file?.hold(true);
    this.updateMute();
  }

  /** 第4次调整：窗口失去焦点（或切到后台）时自动静音 */
  private updateMute(): void {
    const away = document.hidden || !document.hasFocus();
    this.audio.setMuted(this.settings.muteOnBlur && away);
  }

  private startBgWorker(): void {
    if (this.bgWorker) return;
    try {
      const src = 'setInterval(()=>postMessage(0),33)';
      this.bgWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.bgWorker.onmessage = () => {
        const now = performance.now();
        if (!this.world || !this.coop || now - this.lastRaf < 200) return;
        const dt = Math.min(0.1, (now - this.last) / 1000);
        this.last = now;
        try { this.frameGame(dt, false); } catch (err) { console.error(err); }
      };
    } catch { /* */ }
  }

  private stopBgWorker(): void {
    if (!this.bgWorker) return;
    this.bgWorker.terminate();
    this.bgWorker = null;
  }

  private frameMenu(dt: number): void {
    const w = this.menuWorld!;
    w.update(dt, false);
    const L = w.layout;
    const c = this.menuCam;
    c.t += dt;
    const cx = (L.rect.x0 + L.rect.x1) / 2, cy = (L.rect.y0 + L.rect.y1) / 2;
    c.x = cx + Math.sin(c.t * 0.05) * (L.rect.x1 - L.rect.x0) * 0.35;
    c.y = cy + Math.cos(c.t * 0.037) * (L.rect.y1 - L.rect.y0) * 0.35;
    w.player.x = c.x; w.player.y = c.y;
    w.view.x = c.x; w.view.y = c.y;
    this.renderer.flash.intensity = 0;
    // 主菜单的背景只是缓慢移动的镜头：30 帧足够，省下的 GPU 让菜单按钮的响应更及时
    this.menuSkip = !this.menuSkip;
    if (this.menuSkip) return;
    this.renderer.frame(w, dt * 2, this.time, c.x, c.y + 6);
    this.overlay.begin();
    this.ambient(dt * 2, c.x, c.y, L.cfg.palette.accent);
  }

  private frameGame(dt: number, render: boolean): void {
    const w = this.world!;
    const p = w.player;
    const playing = this.state === 'playing';
    const coop = this.coop;
    // 暂停：单人时 ESC / 背包；联机时把本地的暂停状态广播给所有人
    this.relicUi.update(w, this.state === 'playing' || this.state === 'paused');
    if (coop) coop.setLocalPaused((this.state === 'paused' || this.bag.open || this.relicUi.open) && w.phaseActive() && p.alive);
    const paused = this.simPaused();
    const running = coop ? !paused : playing && !paused;
    // v4.3.7：10 号音乐与曼巴僵尸的耐久战计时同步，游戏暂停时一起暂停，偏差过大时校正
    this.audio.file?.hold(!running);
    if (running) this.audio.file?.sync(10, w.mambaClock());
    // 输入 → 世界
    if (render) this.renderer.screenToGround(this.input.mouseX, this.input.mouseY, this.aim);
    if (running) {
      const uiBlock = this.safe.open || this.relicUi.open || this.state !== 'playing';
      const mv = uiBlock ? { x: 0, y: 0 } : this.input.moveVector();
      w.input.moveX = mv.x;
      w.input.moveY = mv.y;
      w.input.aimX = this.aim.x;
      w.input.aimY = this.aim.y;
      w.input.fire = [this.input.fire[0] && !this.bag.open && !uiBlock, this.input.fire[1] && !this.bag.open && !uiBlock];
      if (this.bot) this.bot.update(dt);
      // 固定步长更新
      this.acc += dt;
      const step = 1 / 60;
      let n = 0;
      while (this.acc >= step && n < 5) {
        if ((w as any).__god) { w.run.invulnT = Math.max(w.run.invulnT, 1); w.run.hp = Math.max(w.run.hp, 1); }
        w.update(step, true);
        this.acc -= step;
        n++;
      }
      if (n === 5) this.acc = 0;
    }
    coop?.tick(dt);
    this.net?.tick(dt);
    // 结算
    if (!this.endShown && ((w.phase === 'dead' && w.deathT > 2.6) || (w.phase === 'victory' && w.victoryT > 4))) {
      this.endShown = true;
      this.showEnd(w.phase === 'victory');
    }
    if (!render) return;
    const v = w.view;
    this.audio.listenerX = v.x;
    this.audio.listenerY = v.y;
    const th = w.radThresh();
    this.audio.ambience(dt, w.radLevel, Math.min(1, w.run.rad / th[0]), w.run.hp / w.run.maxHp, running && p.standing && w.phaseActive());
    const aimX = this.bot ? w.input.aimX : this.aim.x, aimY = this.bot ? w.input.aimY : this.aim.y;
    // 暂停时（暂停菜单、背包、奇物三选一）场景是静止的：画好几帧之后就不再重复渲染 3D 画面，画布会保留最后一帧
    this.stillFrames = running ? 0 : this.stillFrames + 1;
    if (this.stillFrames < 4) this.renderer.frame(w, running ? dt : 0, this.time, aimX, aimY);
    // 特效：区域效果粒子
    if (running) {
      for (const hz of w.projs.hazards) {
        if (hz.dead || hz.pullOnly) continue;
        if (hz.kind === 'toxic') { if (Math.random() < 0.6) this.renderer.particles.cloud(hz.x, hz.y, hz.r, 0x6acc2a); }
        else for (let i = 0; i < 3; i++) this.renderer.particles.vortex(hz.x, hz.y, hz.r * (0.4 + Math.random() * 0.6));
      }
      for (const pr of w.projs.list) {
        if (pr.dead) continue;
        if (pr.def.flags?.homing && Math.random() < 0.5) this.renderer.particles.trail(pr.x, pr.y, 1.1, pr.color);
        if (pr.def.flags?.burn && Math.random() < 0.3) this.renderer.particles.trail(pr.x, pr.y, 1.1, 0xff6a1a);
        if (pr.fancy && Math.random() < 0.25) this.renderer.particles.trail(pr.x, pr.y, 1.1, pr.fancy & 2 ? 0xffffff : 0xffe8a0);
      }
    }
    // 第4.3次调整：曼巴僵尸耐久战时身上飘出红金色的火星
    const be = w.bossEnemy;
    if (running && be && !be.dead && w.boss?.final && Math.random() < 0.7) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.6;
      this.renderer.particles.trail(be.x + Math.cos(a) * r, be.y + Math.sin(a) * r, 0.6 + Math.random() * 2.6, Math.random() < 0.5 ? 0xffb020 : 0xff4a1a);
    }
    // 叠加层
    const ov = this.overlay;
    ov.begin();
    if (running) this.ambient(dt, v.x, v.y, w.layout.cfg.palette.accent);
    // 过场动画中不显示场景里的标签与指示
    if (!w.cine) this.drawWorldUI(w);
    ov.drawFloaters(running ? dt : 0, (x, y, hh) => this.renderer.project(x, y, hh));
    if (w.countdown >= 0) ov.countdown(w.countdown, coop ? '安全门即将开启，任何人离开黄色区域都会取消' : '安全门即将开启，离开黄色区域可取消');
    if (w.combo.count >= 10 && !w.cine) { const ca = this.hud.comboAnchor(); ov.combo(w.combo.count, w.combo.t, ca.x, ca.y); }
    // 第4.3次调整：聚精会神的技巧检定
    const qte = w.relicFx.qte;
    if (qte && p.standing) ov.qte(qte, keyLabel(this.settings.keys.special), w.run.focusTokens);
    this.drawNotices(w, paused);
    if (playing && !w.cine && !this.bag.open && !this.safe.open && !this.relicUi.open && p.standing && this.input.hasMouse && !paused) {
      const r: [number, number] = [1, 1];
      for (let i = 0; i < 2; i++) {
        const hs = p.hands[i];
        r[i] = hs.reloading ? 1 - Math.max(0, hs.cooldown) / Math.max(0.01, hs.reloadTotal) : 1;
      }
      ov.crosshair(this.input.mouseX, this.input.mouseY, r, [!!w.run.guns[0], !!w.run.guns[1]], w.radLevel >= 2 ? '#ff8a6a' : '#ffffff');
    }
    // HUD
    this.hud.setMouse(this.input.mouseX, this.input.mouseY, this.input.hasMouse && playing);
    this.hud.update(w, dt);
    const minimal = w.phase === 'safehouse' && !!w.layout.prevRoom?.minimal;
    const hintKey = `${this.settings.hints}|${w.phase === 'safehouse'}|${minimal}|${!!coop}|${JSON.stringify(this.settings.keys)}`;
    if (hintKey !== this.lastHints) { this.lastHints = hintKey; this.hud.setHints(this.settings.hints, w.phase === 'safehouse', !!coop, minimal); }
    if (this.bag.open) this.bag.refresh();
    if (this.safe.open) this.safe.tickRefresh();
  }

  private ambient(dt: number, x: number, y: number, accent: string): void {
    this.ambientT -= dt;
    while (this.ambientT <= 0) {
      this.ambientT += 0.08;
      this.renderer.particles.ambient(x, y, Math.random() < 0.3 ? parseInt(accent.slice(1), 16) : 0x9a9088);
    }
  }

  /** 屏幕中央的提示：其他人暂停、等待队友、倒地、观战、关门倒计时 */
  private drawNotices(w: World, paused: boolean): void {
    const ov = this.overlay;
    const lines: [string, string, number][] = [];
    const coop = this.coop;
    if (coop && paused) {
      const who = coop.pausers();
      const self = coop.localPaused;
      lines.push([who.length ? `${who.join('、')} 玩家正在暂停游戏` : self ? '你暂停了游戏（所有队友都已暂停）' : '游戏已暂停', '#ffd24a', 24]);
    }
    if (w.closeT >= 0) lines.push([`${Math.ceil(w.closeT)} 秒后关闭安全屋：仍倒在外面的队友将在本局阵亡`, '#ff5a4a', 24]);
    else if (w.waitInfo) lines.push([w.waitInfo, '#ffffff', 24]);
    const p = w.player;
    if (coop && p.alive && p.downed) lines.push([`你倒下了！等待队友拉起（辐射仍在累积 ${w.run.rad.toFixed(1)}K）`, '#ff5a4a', 24]);
    if (coop && !p.alive && w.phase !== 'dead' && w.phase !== 'victory') {
      const r = w.remote(w.spectate);
      lines.push([`你在本局中阵亡了　观战中：${r ? r.name : '无'}（空格 / 点击切换）`, '#c8c8c8', 24]);
    }
    if (w.reviveTarget >= 0) {
      const r = w.remote(w.reviveTarget);
      if (r) lines.push([`正在拉起 ${r.name}…保持不动`, '#6aff8a', 24]);
    }
    if (lines.length) ov.notices(lines);
  }

  private drawWorldUI(w: World): void {
    const ov = this.overlay;
    const p = w.player;
    const v = w.view;
    const K = this.settings.keys;
    const F = keyLabel(K.interact);
    const proj = (x: number, y: number, hh: number) => this.renderer.project(x, y, hh);
    // 附近物品标签
    const near = p.standing ? w.pickups.nearestItem(p.x, p.y, PLAYER.pickupRadius) : null;
    // 同名物品挤在一起时（例如安全屋里的一排净化血清）只标出其中一部分，避免标签互相遮挡
    const shown: { x: number; y: number; n: string }[] = [];
    if (near) shown.push({ x: near.x, y: near.y, n: itemName(near.thing) });
    for (const it of w.pickups.items) {
      if (it.dead) continue;
      const d = Math.hypot(it.x - v.x, it.y - v.y);
      if (d > 7) continue;
      if (it !== near) {
        const nm = itemName(it.thing);
        if (shown.some((s) => s.n === nm && Math.hypot(s.x - it.x, s.y - it.y) < 3.2)) continue;
        shown.push({ x: it.x, y: it.y, n: nm });
      }
      const th = it.thing;
      let color = '#ffffff', title = itemName(th), sub = '';
      if (th.kind === 'gun') { color = RARITY_CSS[th.rarity]; sub = `Rarity${th.rarity}　${th.bullets.filter(Boolean).length} 枚子弹　4 格`; }
      else if (th.kind === 'bullet') { color = th.iri ? '#ff8aff' : th.shiny ? '#ffe28a' : '#ffd27a'; title = bulletName(th); sub = '子弹　1 格'; }
      else if (th.kind === 'item') {
        color = th.grade ? ITEM_GRADE.color[th.grade] : ITEMS[th.id].color;
        sub = ITEMS[th.id].keep ? `可保留　${ITEMS[th.id].size} 格` : '即时生效';
      }
      else if (th.kind === 'gold') { color = '#ffd24a'; sub = '金币'; }
      else if (th.kind === 'relic') { color = `hsl(${(w.time * 120) % 360},100%,70%)`; sub = '捡起后每个人都可以选择一个增益'; }
      const isNear = it === near;
      const how = it.auto ? '经过即可拾取' : `[${F}] 拾取`;
      ov.label(proj(it.x, it.y, 1.6), title, isNear ? `${how}　${sub}` : sub, color, isNear);
    }
    // 安全屋设施提示
    if (w.phase === 'safehouse' && w.layout.prevRoom && !this.safe.open && p.alive) {
      const r = w.layout.prevRoom;
      if (!r.minimal) {
        const da = Math.hypot(p.x - r.altar.x, p.y - r.altar.y), ds = Math.hypot(p.x - r.shop.x, p.y - r.shop.y), dsu = Math.hypot(p.x - r.suit.x, p.y - r.suit.y);
        ov.label(proj(r.altar.x, r.altar.y, 2.8), '祭坛', da < 2.4 ? `[${F}] 打开` : '属性提升', '#e0a0ff', da < 2.4);
        ov.label(proj(r.shop.x, r.shop.y, 2.8), '商店', ds < 2.4 ? `[${F}] 打开` : '枪械　子弹', '#4affd8', ds < 2.4);
        const offer = w.suitOffer();
        const suitSub = offer ? (dsu < 1.6 ? `[${F}] 换上 ${SUIT_NAMES[offer]} 级防护服` : `${SUIT_NAMES[offer]} 级防护服`)
          : w.suitTakenAt === w.safehouseZone ? '已换上' : '已是最高级';
        ov.label(proj(r.suit.x, r.suit.y, 2.9), '防护服柜', suitSub, offer ? '#7affc0' : '#8d939a', offer > 0 && dsu < 1.6);
      }
      const dm = Math.hypot(p.x - r.medkit.x, p.y - r.medkit.y);
      const full = w.run.hp >= w.medkitCap() - 0.01;
      ov.label(proj(r.medkit.x, r.medkit.y, 2.0), '医疗箱', dm < 1.6 ? (full ? '生命值已满' : `[${F}] 回满生命`) : full ? '生命值已满' : '回满生命', full ? '#8d939a' : '#ff6a7a', dm < 1.6 && !full);
    }
    this.drawQuestUI(w);
    // 队友：头顶名字与血条；倒地时显示拉起进度
    if (w.net) {
      for (const r of w.net.remotes()) {
        if (r.dead) continue;
        const col = SLOT_CSS[r.slot % 4];
        const status = r.downed ? (r.reviveK > 0 ? '正在被拉起' : `倒地　靠近按 ${F} 拉起`) : r.arrived ? '已进入安全屋' : r.paused ? '暂停中' : '';
        ov.nameTag(proj(r.x, r.y, 2.4), r.name, col, r.hp / Math.max(1, r.maxHp), status);
        if (w.reviveTarget === r.id) ov.ring(proj(r.x, r.y, 1.0), w.reviveT / COOP.reviveTime, '#6aff8a');
      }
      // 自己倒地时：显示队友拉起的进度
      if (p.downed) {
        for (const r of w.net.remotes()) if (r.reviveBy === w.myId && r.reviveK > 0) ov.ring(proj(p.x, p.y, 1.0), r.reviveK / COOP.reviveTime, '#6aff8a');
      }
    }
    // 方向指示
    const cx = ov.w / 2, cy = ov.h / 2;
    if (w.phase === 'explore' && w.layout.safeRoom && w.safeRoomOpen()) {
      const d = w.layout.safeRoom.entranceDoor;
      const tx = (d.x0 + d.x1) / 2, ty = d.y0;
      ov.arrow(proj(tx, ty, 0), cx, cy, '#6aff8a', `安全屋 ${Math.round(Math.hypot(tx - v.x, ty - v.y))}m`);
    } else if (w.phase === 'safehouse' && w.layout.prevRoom) {
      const t = w.layout.prevRoom.exitTrigger;
      ov.arrow(proj((t.x0 + t.x1) / 2, (t.y0 + t.y1) / 2, 0), cx, cy, '#ffd24a', '出口');
    } else if (w.phase === 'explore' && w.layout.isBoss && !w.bossCleared) {
      ov.arrow(proj(w.layout.bossSpawn!.x, w.layout.bossSpawn!.y, 0), cx, cy, '#ff4a3a', w.layout.index >= 6 ? '曼巴' : '尸王');
    }
    if (w.bossEnemy && !w.bossEnemy.dead) {
      const be = w.bossEnemy;
      ov.arrow(proj(be.x, be.y, 1), cx, cy, '#ff4a3a', w.boss?.kind === 'mamba' ? '曼巴' : '牢大');
    }
    // 第4.1次调整：区域任务的目标（离开安全屋一段时间后或找到过之后显示）
    for (const a of w.quests.arrows()) ov.arrow(proj(a.x, a.y, 0.5), cx, cy, a.color, `${a.label} ${Math.round(Math.hypot(a.x - v.x, a.y - v.y))}m`);
    // 联机：倒地队友的相对位置（红色），其他队友（标识色）
    if (w.net) {
      for (const r of w.net.remotes()) {
        if (r.dead) continue;
        const dist = Math.round(Math.hypot(r.x - v.x, r.y - v.y));
        if (r.downed) ov.arrow(proj(r.x, r.y, 0.5), cx, cy, '#ff3a3a', `${r.name} 倒地 ${dist}m`);
        else ov.arrow(proj(r.x, r.y, 0.5), cx, cy, SLOT_CSS[r.slot % 4], `${r.name} ${dist}m`);
      }
    }
    // 精英头顶血条（受伤时）；异变体与奇物宝箱始终显示
    for (const e of w.enemies.list) {
      if (e.dead || e.type === 'boss') continue;
      if (e.type === 'chest' || e.mutant) {
        if (Math.abs(e.x - v.x) > 22 || Math.abs(e.y - v.y) > 18) continue;
        const chest = e.type === 'chest';
        const pt = proj(e.x, e.y, chest ? 2.2 : 2.6);
        ov.hpBar(pt, e.hp / e.maxHp, chest ? 60 : 54, chest ? '#ffd24a' : '#ff7aff');
        ov.label(pt, chest ? '奇物宝箱' : '异变体', '', chest ? '#ffd24a' : `hsl(${(w.time * 120) % 360},100%,72%)`, false);
        continue;
      }
      if (e.hp >= e.maxHp || (!e.elite && e.type !== 'iron')) continue;
      if (Math.abs(e.x - v.x) > 20 || Math.abs(e.y - v.y) > 16) continue;
      const pt = proj(e.x, e.y, 2.3 * (e.type === 'iron' ? 1.18 : 1));
      ov.hpBar(pt, e.hp / e.maxHp, 30, e.elite ? ['#fff', '#ffe14a', '#ff8a1a', '#ff3030'][e.elite] : '#c8c8c8');
    }
  }

  /** 区域任务的场景标签（第4.1次调整） */
  private drawQuestUI(w: World): void {
    const q = w.quests;
    if (!q.id || q.done || !w.phaseActive()) return;
    const ov = this.overlay;
    const v = w.view;
    const proj = (x: number, y: number, hh: number) => this.renderer.project(x, y, hh);
    const near = (x: number, y: number, r: number) => Math.hypot(x - v.x, y - v.y) < r;
    if (q.id === 'signal' && near(q.sig.x, q.sig.y, 22)) {
      const need = q.signalNeed();
      ov.label(proj(q.sig.x, q.sig.y, 3.8), '信号区域', `站在圈里发送信号　${Math.floor(Math.min(need, q.progress))} / ${need} 秒`, '#4affe0', Math.hypot(q.sig.x - v.x, q.sig.y - v.y) < q.sig.r);
    }
    if (q.id === 'pyre') {
      for (const p of q.pyres) if (!p.lit && near(p.x, p.y, 12)) ov.label(proj(p.x, p.y, 3.1), '可燃物堆', '用子弹或爆炸点燃', '#ff8a2a', false);
    }
    if (q.id === 'cargo') {
      if (near(q.drop.x, q.drop.y, 24)) ov.label(proj(q.drop.x, q.drop.y, 2.4), '运载点', '把物资球推进来', '#ffd24a', false);
      for (const b of q.balls) if (!b.done && near(b.x, b.y, 10)) ov.label(proj(b.x, b.y, 2.2), '物资球', '碰到它就能推着走', '#ffd24a', false);
    }
  }

  private showEnd(win: boolean): void {
    const w = this.world!;
    const run = w.run;
    this.state = 'end';
    this.bag.setOpen(false);
    this.safe.setOpen(false);
    const r = this.records;
    // 击败牢大丧尸即算通关（之后在隐秘核心倒下也算）；击败曼巴僵尸另外记录
    const cleared = win || run.laodaKilled;
    if (cleared) { r.wins++; if (!r.bestTime || run.totalTime < r.bestTime) r.bestTime = run.totalTime; }
    if (run.mambaKilled) r.trueWins = (r.trueWins ?? 0) + 1;
    r.bestZone = Math.max(r.bestZone, run.zoneIndex);
    r.totalKills += run.stats.kills;
    r.bestKills = Math.max(r.bestKills, run.stats.kills);
    saveRecords(r);
    const coop = this.coop;
    // 真人试玩数据导出：单人/联机、人数、是否房主
    const exportMeta = { mode: (coop ? 'coop' : 'solo') as 'solo' | 'coop', playerCount: coop ? 1 + coop.remoteList().length : 1, isHost: coop ? coop.isHost : null, source: 'human' as const };
    if (coop) {
      const stateOf = (dead: boolean, downed: boolean) => (dead ? '阵亡' : downed ? '倒地' : '存活');
      const team: TeamLine[] = [{ name: `${coop.name(coop.myId)}（你）`, slotColor: SLOT_CSS[coop.myId % 4], kills: run.stats.kills, state: stateOf(!w.player.alive, w.player.downed) }];
      for (const rp of coop.remoteList()) team.push({ name: rp.name, slotColor: SLOT_CSS[rp.slot % 4], kills: rp.kills, state: stateOf(rp.dead, rp.downed) });
      const net = this.net;
      this.menus.end(win, run, coop.isHost && net ? () => net.reset() : null, team, '返回房间', exportMeta);
      return;
    }
    this.menus.end(win, run, () => this.startGame(run.difficulty, null), null, '再来一局', exportMeta);
    if (this.botMode) setTimeout(() => this.startGame(run.difficulty, null), 4000);
  }
}
