// 菜单：主菜单、新游戏（难度/种子）、联机（创建/加入房间、房间大厅）、暂停、设置（含亮度与键位）、
// 操作说明、图鉴、结算（死亡/胜利）。

import { BOSS, CHEST_HP, COOP, CREEPER, DIFFICULTY, Difficulty, ELITE_CSS, ELITE_MUL, ENEMIES, GUN_LIMITS, MAMBA, MUTANT, RARITY_CSS, RARITY_NAMES, ZONES } from '../config';
import { BULLETS, BULLET_IDS, BUTTER } from '../data/bullets';
import { GUN_BUDGET_K, GUN_MOD_IDS, GUN_MODS, makeFixedGun, MOD_TONE_CSS } from '../data/guns';
import { ItemId, ITEMS, ITEM_IDS, ITEM_VALUES, itemSize, JAR_VALUE, QUICK_ORDER } from '../data/items';
import { STARTER_GUNS } from '../game/state';
import { CORE_PURIFY } from '../game/world';
import { QUEST, QUEST_IDS, QUEST_INFO } from '../game/quest';
import { RELIC_IDS, RELICS } from '../data/relics';
import { Rng } from '../util/rng';
import { KEY_ACTIONS, KeyAction, keyLabel, Records, Settings, DEFAULT_KEYS } from '../core/settings';
import type { LobbyState } from '../net/transport';
import type { RunExportMeta, RunState } from '../game/state';
import { fmtNum, fmtTime } from '../util/math';
import { clear, h } from './dom';
import { bulletIcon, gunIcon, itemIcon } from './icons';
import { enemyIcon, questIcon, relicIcon } from './art';

export interface MenuActions {
  start(diff: Difficulty, seed: number | null): void;
  multiplayer(): void;
  resume(): void;
  quit(): void;
  settingsChanged(s: Settings): void;
  sound(name: 'click' | 'hover'): void;
}

/** 联机房间的操作 */
export interface MpActions {
  create(name: string): void;
  join(code: string, name: string): void;
  setName(name: string): void;
  setCfg(diff: Difficulty, seed: string): void;
  start(diff: Difficulty, seed: string): void;
  leave(): void;
}

export interface TeamLine { name: string; slotColor: string; kills: number; state: string }

const KEY_NAMES: Record<KeyAction, string> = {
  interact: '交互（拾取 / 拉起队友 / 祭坛、商店、防护服柜、医疗箱）', bag: '背包（同时暂停游戏）', reload: '提前换弹',
  autoL: '主手自动射击开关', autoR: '副手自动射击开关', special: '特殊交互（聚精会神的技巧检定）',
  item1: '道具：止痛药', item2: '道具：奶白金', item3: '道具：过热模块', item4: '道具：鳗',
  item5: '道具：净化血清', item6: '道具：零件1型', item7: '道具：零件2型',
};

const DIFF_DESC: Record<Difficulty, string> = {
  easy: '丧尸更脆弱、伤害更低、数量更少。适合熟悉系统。',
  normal: '推荐第一次游玩。',
  hard: '丧尸更耐打、下手更狠。',
  nightmare: '丧尸成群结队，又强又多。',
};

export class Menus {
  root: HTMLDivElement;
  private bg: HTMLDivElement;
  private box: HTMLDivElement;
  current: 'main' | 'new' | 'pause' | 'settings' | 'help' | 'codex' | 'end' | 'mp' | 'lobby' | 'none' = 'none';
  private back: () => void = () => {};
  /** 正在等待重新绑定的按键 */
  private rebinding: KeyAction | null = null;
  private rebindDone: (() => void) | null = null;

  constructor(parent: HTMLElement, private settings: Settings, private records: () => Records, private act: MenuActions) {
    this.bg = h('div', { class: 'menu-bg' });
    this.box = h('div', { class: 'menu-box' });
    this.root = h('div', { class: 'menu-wrap hidden' }, this.bg, this.box);
    parent.appendChild(this.root);
    this.root.addEventListener('pointerover', (e) => { if ((e.target as HTMLElement).classList?.contains('btn')) this.act.sound('hover'); });
    // 键位绑定：捕获下一次按键
    window.addEventListener('keydown', (e) => {
      if (!this.rebinding) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code !== 'Escape') {
        const k = this.rebinding;
        // 同一个按键只能绑定一个动作：冲突时互换
        const other = KEY_ACTIONS.find((a) => a !== k && this.settings.keys[a] === e.code);
        if (other) this.settings.keys[other] = this.settings.keys[k];
        this.settings.keys[k] = e.code;
        this.act.settingsChanged(this.settings);
      }
      this.rebinding = null;
      this.rebindDone?.();
    }, true);
  }

  get capturingKey(): boolean {
    return !!this.rebinding;
  }

  hide(): void {
    this.current = 'none';
    this.rebinding = null;
    this.root.classList.add('hidden');
  }

  private showBox(kind: Menus['current'], content: HTMLElement, dim = true): void {
    this.current = kind;
    this.root.classList.remove('hidden');
    this.bg.style.background = dim ? '' : 'transparent';
    clear(this.box);
    this.box.appendChild(content);
  }

  private btn(label: string, fn: () => void, primary = false, disabled = false): HTMLButtonElement {
    return h('button', { class: 'btn' + (primary ? ' primary' : ''), disabled, onclick: () => { this.act.sound('click'); fn(); } }, label);
  }

  main(): void {
    const r = this.records();
    const rec = r.runs
      ? `已游玩 ${r.runs} 局　通关 ${r.wins} 次${r.trueWins ? `（击败曼巴 ${r.trueWins} 次）` : ''}　最远到达 ${ZONES[Math.max(0, Math.min(ZONES.length, r.bestZone) - 1)]?.subtitle ?? '-'}　累计击杀 ${fmtNum(r.totalKills)}${r.bestTime ? `　最快通关 ${fmtTime(r.bestTime)}` : ''}`
      : '在末日中突破尸潮，构筑武器，击败尸王。';
    this.showBox('main', h('div', { class: 'menu-main' },
      h('div', { class: 'logo-sub', style: 'margin:0 0 6px;font-size:24px;letter-spacing:14px;color:#e8c8a0' }, '末 日'),
      h('div', { class: 'logo' }, '4056'),
      h('div', { class: 'logo-en' }, 'DOOMSDAY 4056'),
      h('div', { class: 'menu-btns' },
        this.btn('单人游戏', () => this.newGame(), true),
        this.btn('联机游戏（局域网）', () => this.act.multiplayer(), true),
        this.btn('操作与玩法', () => { this.back = () => this.main(); this.help(); }),
        this.btn('图鉴', () => { this.back = () => this.main(); this.codex(); }),
        this.btn('设置', () => { this.back = () => this.main(); this.settingsDlg(); })),
      h('div', { class: 'menu-foot' }, rec),
      h('div', { class: 'menu-foot', style: 'margin-top:6px' }, '建议使用 Chrome / Edge 浏览器')));
  }

  private diffCards(get: () => Difficulty, set: (d: Difficulty) => void, enabled = true): HTMLDivElement {
    const cards = h('div', { class: 'diff-cards' });
    const render = () => {
      clear(cards);
      (Object.keys(DIFFICULTY) as Difficulty[]).forEach((d) => {
        cards.appendChild(h('div', {
          class: 'diff-card' + (d === get() ? ' on' : '') + (enabled ? '' : ' locked'),
          onclick: () => { if (!enabled) return; set(d); this.act.sound('click'); render(); },
        }, h('h4', null, DIFFICULTY[d].name), h('p', null, DIFF_DESC[d])));
      });
    };
    render();
    return cards;
  }

  newGame(): void {
    let diff: Difficulty = this.settings.difficulty;
    const seedIn = h('input', { type: 'text', placeholder: '留空则随机' }) as HTMLInputElement;
    this.showBox('new', h('div', { class: 'dialog' },
      h('h2', null, '单人游戏'),
      h('h3', null, '难度'), this.diffCards(() => diff, (d) => { diff = d; }),
      h('div', { class: 'row' }, h('span', null, '地图种子（可选，相同种子生成相同地图与掉落）'), seedIn),
      h('div', { class: 'actions' },
        this.btn('返回', () => this.main()),
        this.btn('出发！', () => {
          this.settings.difficulty = diff;
          this.act.settingsChanged(this.settings);
          this.act.start(diff, parseSeed(seedIn.value));
        }, true))));
  }

  // —— 联机 ——

  /** 页面不是通过服务器打开的（例如直接双击了 HTML 文件） */
  mpUnavailable(): void {
    this.showBox('mp', h('div', { class: 'dialog', style: 'width:600px' },
      h('h2', null, '联机游戏'),
      h('p', null, '联机需要通过本地服务器打开游戏页面（直接双击 HTML 文件无法联机）：'),
      h('ol', { style: 'font-size:12px;line-height:1.9;color:#d0ccc4' },
        h('li', null, '房主在游戏目录中运行 ', h('span', { class: 'kbd' }, 'node serve.mjs'), '（需要安装 Node.js）。'),
        h('li', null, '房主在浏览器打开 http://localhost:4056 ，点击「联机游戏」创建房间。'),
        h('li', null, '其他玩家（同一局域网）打开服务器窗口里显示的局域网地址，例如 http://192.168.1.5:4056 ，输入房间号加入。')),
      h('p', { style: 'color:#8d939a' }, '如果其他电脑打不开，请在房主电脑的防火墙中允许 Node.js 访问专用网络。'),
      h('div', { class: 'actions' }, this.btn('返回', () => this.main(), true))));
  }

  mpMessage(title: string, text: string, onBack: () => void): void {
    this.showBox('mp', h('div', { class: 'dialog', style: 'width:520px;text-align:center' },
      h('h2', null, title), h('p', null, text),
      h('div', { class: 'actions', style: 'justify-content:center' }, this.btn('返回', onBack, true))));
  }

  /** 创建 / 加入房间 */
  mpEntry(a: MpActions, err = ''): void {
    const nameIn = h('input', { type: 'text', maxlength: 12, placeholder: '你的名字', value: this.settings.playerName }) as HTMLInputElement;
    const codeIn = h('input', { type: 'text', maxlength: 4, placeholder: 'ABCD', style: 'text-transform:uppercase;width:90px;letter-spacing:4px;text-align:center' }) as HTMLInputElement;
    const saveName = () => { this.settings.playerName = nameIn.value.trim().slice(0, 12); this.act.settingsChanged(this.settings); };
    codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { saveName(); a.join(codeIn.value.trim().toUpperCase(), this.settings.playerName); } });
    this.showBox('mp', h('div', { class: 'dialog', style: 'width:560px' },
      h('h2', null, '联机游戏'),
      h('p', { style: 'color:#8d939a' }, `局域网 1~${COOP.maxPlayers} 人合作。房主创建房间后会得到一个房间号，其他玩家输入房间号即可加入。`),
      h('div', { class: 'row' }, h('span', null, '名字（进入房间后也可以修改）'), nameIn),
      h('div', { class: 'row' }, h('span', null, '创建一个新房间，由你担任房主'), this.btn('创建房间', () => { saveName(); a.create(this.settings.playerName); }, true)),
      h('div', { class: 'row' }, h('span', null, '加入房间'), h('span', { style: 'display:flex;gap:8px;align-items:center' }, codeIn,
        this.btn('加入', () => { saveName(); a.join(codeIn.value.trim().toUpperCase(), this.settings.playerName); }, true))),
      err ? h('div', { class: 'mp-err' }, err) : null,
      h('div', { class: 'actions' }, this.btn('返回', () => { a.leave(); this.main(); }))));
    setTimeout(() => (this.settings.playerName ? codeIn : nameIn).focus(), 30);
  }

  /** 房间大厅 */
  lobby(s: LobbyState, myId: number, lan: string[], a: MpActions, err = ''): void {
    const isHost = s.hostId === myId;
    const me = s.players.find((p) => p.id === myId);
    let diff = (s.cfg.diff in DIFFICULTY ? s.cfg.diff : 'normal') as Difficulty;
    const seedIn = h('input', { type: 'text', placeholder: '留空则随机', value: s.cfg.seed, disabled: !isHost }) as HTMLInputElement;
    seedIn.addEventListener('change', () => a.setCfg(diff, seedIn.value.trim()));
    const nameIn = h('input', { type: 'text', maxlength: 12, placeholder: '请输入名字', value: me?.name ?? '' }) as HTMLInputElement;
    const applyName = () => {
      const n = nameIn.value.trim().slice(0, 12);
      if (!n || n === me?.name) return;
      this.settings.playerName = n;
      this.act.settingsChanged(this.settings);
      a.setName(n);
    };
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyName(); });
    nameIn.addEventListener('change', applyName);
    const colors = ['#4affe0', '#ffb03a', '#ff5ac8', '#9aff4a'];
    const list = h('div', { class: 'lobby-list' });
    for (let i = 0; i < COOP.maxPlayers; i++) {
      const p = s.players.find((x) => x.id === i);
      list.appendChild(h('div', { class: 'lobby-slot' + (p ? '' : ' empty') },
        h('i', { style: `background:${colors[i]}` }),
        h('span', { class: 'nm' }, p ? (p.name || '（还没有起名字）') : '等待玩家加入…'),
        p?.host ? h('span', { class: 'tag' }, '房主') : null,
        p && p.id === myId ? h('span', { class: 'tag me' }, '你') : null));
    }
    const allNamed = s.players.every((p) => !!p.name);
    const lanText = lan.length ? lan.join('  或  ') : 'http://<房主电脑的局域网 IP>:4056';
    this.showBox('lobby', h('div', { class: 'dialog', style: 'width:min(720px,94vw)' },
      h('h2', null, '联机房间'),
      h('div', { class: 'lobby-code' }, h('span', null, '房间号'), h('b', null, s.code)),
      h('p', { style: 'color:#8d939a;margin:6px 0 10px' }, `其他玩家在同一局域网的电脑上用浏览器打开 ${lanText}，点击「联机游戏」并输入房间号 ${s.code}。`),
      list,
      h('div', { class: 'row' }, h('span', null, '你的名字（加入房间后需要起一个名字）'), h('span', { style: 'display:flex;gap:8px' }, nameIn, this.btn('确定', applyName))),
      h('h3', null, isHost ? '难度（由房主选择）' : `难度：${DIFFICULTY[diff].name}（由房主选择）`),
      this.diffCards(() => diff, (d) => { diff = d; a.setCfg(d, seedIn.value.trim()); }, isHost),
      h('div', { class: 'row' }, h('span', null, '地图种子（可选）'), seedIn),
      h('p', { style: 'color:#8d939a;font-size:12px' }, `人越多丧尸越强。生命归零会倒地，队友在身边按 ${keyLabel(this.settings.keys.interact)} 并保持不动即可拉起；没被拉起就被留在安全屋外的队友会在本局阵亡。任何人暂停或打开背包，所有人一起暂停。小心别打到队友。`),
      err ? h('div', { class: 'mp-err' }, err) : null,
      h('div', { class: 'actions' },
        this.btn('离开房间', () => { a.leave(); this.main(); }),
        isHost
          ? this.btn(allNamed ? `开始游戏（${s.players.length} 人）` : '等待所有玩家起名字', () => a.start(diff, seedIn.value.trim()), true, !allNamed)
          : h('span', { style: 'color:#8d939a;font-size:12px;align-self:center' }, '等待房主开始游戏…'))));
    if (!me?.name) setTimeout(() => nameIn.focus(), 30);
  }

  pause(run: RunState, mp: boolean): void {
    this.showBox('pause', h('div', { class: 'dialog', style: 'width:420px;text-align:center' },
      h('h2', null, '暂停'),
      h('div', { style: 'font-size:12px;color:#8d939a;margin-bottom:14px' }, `种子 ${run.seed}　难度 ${DIFFICULTY[run.difficulty].name}　用时 ${fmtTime(run.totalTime)}　击杀 ${fmtNum(run.stats.kills)}`),
      mp ? h('div', { style: 'font-size:12px;color:#ffb03a;margin:-6px 0 12px' }, '联机中：你的暂停也会让所有队友暂停') : null,
      h('div', { class: 'menu-btns', style: 'margin-top:0' },
        this.btn('继续游戏', () => this.act.resume(), true),
        this.btn('设置', () => { this.back = () => this.pause(run, mp); this.settingsDlg(); }),
        this.btn('操作与玩法', () => { this.back = () => this.pause(run, mp); this.help(); }),
        this.btn('图鉴', () => { this.back = () => this.pause(run, mp); this.codex(); }),
        this.btn(mp ? '离开房间，回到主菜单' : '放弃本局，回到主菜单', () => this.act.quit()))));
  }

  settingsDlg(): void {
    const s = this.settings;
    const apply = () => this.act.settingsChanged(s);
    const slider = (label: string, key: 'master' | 'music' | 'sfx' | 'zoom' | 'brightness', min: number, max: number) => {
      const val = h('span', { class: 'num', style: 'width:40px;text-align:right' }, String(s[key]));
      const inp = h('input', { type: 'range', min, max, value: s[key] }) as HTMLInputElement;
      inp.addEventListener('input', () => { s[key] = Number(inp.value); val.textContent = inp.value; apply(); });
      return h('div', { class: 'row' }, h('span', null, label), h('span', { style: 'display:flex;gap:10px;align-items:center' }, inp, val));
    };
    const toggle = (label: string, key: 'shake' | 'damageNumbers' | 'showFps' | 'hints' | 'autoPause' | 'muteOnBlur') => {
      const t = h('div', { class: 'toggle' + (s[key] ? ' on' : '') });
      t.addEventListener('click', () => { s[key] = !s[key]; t.classList.toggle('on', s[key]); this.act.sound('click'); apply(); });
      return h('div', { class: 'row' }, h('span', null, label), t);
    };
    const seg = h('div', { class: 'seg' });
    const renderSeg = () => {
      clear(seg);
      (['低', '中', '高'] as const).forEach((n, i) => seg.appendChild(h('button', { class: s.quality === i ? 'on' : '', onclick: () => { s.quality = i as 0 | 1 | 2; this.act.sound('click'); renderSeg(); apply(); } }, n)));
    };
    renderSeg();
    // 键位
    const keys = h('div', { class: 'keybinds' });
    const renderKeys = () => {
      clear(keys);
      for (const a of KEY_ACTIONS) {
        const waiting = this.rebinding === a;
        keys.appendChild(h('div', { class: 'row' }, h('span', null, KEY_NAMES[a]),
          h('button', {
            class: 'btn small keybtn' + (waiting ? ' waiting' : ''),
            onclick: () => { this.act.sound('click'); this.rebinding = a; this.rebindDone = renderKeys; renderKeys(); },
          }, waiting ? '请按下新按键（ESC 取消）' : keyLabel(s.keys[a]))));
      }
      keys.appendChild(h('div', { class: 'row' }, h('span', { style: 'color:#8d939a' }, '移动 WASD / 方向键、射击 鼠标左右键、暂停 ESC 不可修改'),
        this.btn('恢复默认键位', () => { s.keys = { ...DEFAULT_KEYS }; apply(); renderKeys(); })));
    };
    renderKeys();
    this.showBox('settings', h('div', { class: 'dialog', style: 'width:600px' },
      h('h2', null, '设置'),
      h('h3', null, '声音'),
      slider('主音量', 'master', 0, 100),
      slider('音乐', 'music', 0, 100),
      slider('音效', 'sfx', 0, 100),
      h('h3', null, '画面'),
      slider('场景整体亮度 %', 'brightness', 50, 150),
      h('div', { class: 'row' }, h('span', null, '画质（高：阴影和泛光；中：阴影；低：都关闭）'), seg),
      slider('镜头距离 %', 'zoom', 80, 130),
      toggle('屏幕震动', 'shake'),
      toggle('伤害数字', 'damageNumbers'),
      toggle('显示帧率', 'showFps'),
      h('h3', null, '键位'),
      keys,
      h('h3', null, '其他'),
      toggle('操作提示条', 'hints'),
      toggle('窗口失去焦点时自动暂停（仅单人游戏）', 'autoPause'),
      toggle('窗口失去焦点时自动静音', 'muteOnBlur'),
      h('div', { class: 'actions' }, this.btn('返回', () => { this.rebinding = null; this.back(); }, true))));
  }

  help(): void {
    const K = this.settings.keys;
    const k = (key: string, desc: string) => [h('span', null, h('span', { class: 'kbd' }, key)), h('span', null, desc)];
    const items = (['item1', 'item2', 'item3', 'item4', 'item5', 'item6', 'item7'] as KeyAction[]).map((a) => keyLabel(K[a])).join(' ');
    this.showBox('help', h('div', { class: 'dialog' },
      h('h2', null, '操作与玩法'),
      h('h3', null, '操作（可以在设置里修改键位）'),
      h('div', { class: 'keys-grid' },
        k('W A S D', '移动（方向键亦可）'), k('鼠标', '瞄准'), k('左键', '主手枪械射击'), k('右键', '副手枪械射击（两把枪可同时使用）'),
        k(`${keyLabel(K.autoL)} / ${keyLabel(K.autoR)}`, '主手 / 副手 自动射击开关'), k(keyLabel(K.reload), '提前换弹'),
        k(keyLabel(K.interact), '拉起倒地的队友、拾取地上的物品、使用安全屋里的设施'),
        k(keyLabel(K.bag), '打开背包（同时暂停游戏）'), k(items, '使用快捷栏道具：止痛药、奶白金、过热模块、鳗、净化血清、零件1型、零件2型；选择奇物时按 1 ~ 3 选择'),
        k(keyLabel(K.special), '特殊交互：奇物“聚精会神”的技巧检定'),
        k('ESC', '暂停与菜单'), k('空格', '观战时切换队友')),
      h('h3', null, '基本循环'),
      h('p', null, '持枪杀敌开路并获取金币，在区域中寻找枪械、子弹与道具，抵达区域对角的安全屋休整、改装枪械并升级自身。共 4 个区域，之后是尸王“牢大丧尸”。据说在辐射进入橙色之前击败尸王，就能找到通往隐秘核心的路……'),
      h('h3', null, '枪械与子弹'),
      h('ul', null,
        h('li', null, '射击不消耗子弹。枪械按顺序打出装填的每一枚子弹，打完一轮后换弹，再从头开始。'),
        h('li', null, '子弹决定伤害与效果（穿透、爆炸、追踪、连锁闪电……），也会改变枪的射速与散射。散射越大，子弹越容易射歪。'),
        h('li', null, '闪耀与虹彩子弹比普通子弹威力更强，背包里会闪闪发光。'),
        h('li', null, '逻辑模块（芯片外观）也装在枪的槽位里：它不射出子弹，而是强化排在它后面的子弹。例如“双重施放”让接下来两发同时射出。'),
        h('li', null, '枪的散射为负数时，可以收拢子弹自带的散射。'),
        h('li', null, '后坐力：轻的会让你走得慢一点【轻松射击】，中等的会持续把你往后推【太空步】，很强的会把你猛地推出去【肩胛粉碎者】，朝反方向开火可以当作冲刺！'),
        h('li', null, '枪名前面可能带有修饰语（如“神级”“凶险”），会改变枪的伤害、射速或手感，详见图鉴。'),
        h('li', null, '奇点会把附近的炸弹、地雷和丧尸的口水吸过去，爆炸会把它们推开。'),
        h('li', null, '小心自己的炸弹、地雷和毒雾，它们也会伤到你。')),
      h('h3', null, '背包与拾取'),
      h('ul', null,
        h('li', null, '枪械占 4 格，子弹和大部分道具占 1 格。装在枪里的子弹不占空间。'),
        h('li', null, '携带的金币以金币堆的形式放在背包格子里，每堆占 1 格；背包挤满时可以把金币堆丢在地上腾出空间。'),
        h('li', null, '地图里的部分强化道具带有【高级】或【顶级】前缀，效果更强。'),
        h('li', null, `经过地上的道具就能自动拾取，自己丢下的物品需要按 ${keyLabel(K.interact)} 捡回来。金币会自动飞向你。`),
        h('li', null, '背包图标变橙表示快满了，变红表示满了，满了就捡不了金币。把物品拖出背包面板即可丢在地上。'),
        h('li', null, '只有在安全屋里才能拆装枪械和子弹；在区域中打开背包只能丢弃背包里的物品和金币、使用道具。'),
        h('li', null, '获取金币时，1 秒内捡到的金币会合并成一个数字显示。')),
      h('h3', null, '区域任务与奇物'),
      h('ul', null,
        h('li', null, '第一 ~ 第四区各有一项区域任务（发送信号、点燃火堆、击杀异变体、运送物资、清除瘴气中的 4 种，不会重复），离开安全屋时发布，任务进度显示在小地图下方。'),
        h('li', null, '离开安全屋一段时间后，或者找到过目标之后，屏幕边缘会出现目标的方向箭头。'),
        h('li', null, '完成任务后，下一个区域会出现奇物宝箱（第四区的任务对应尸王广场）。打破宝箱会掉落奇物，任何人捡起后，每个人都能从三个增益中选择一个。'),
        h('li', null, '奇物增益是全局的，不管拿着什么枪都会生效，以小图标显示在生命条下方，详见图鉴。')),
      h('h3', null, '辐射'),
      h('ul', null,
        h('li', null, '辐射随时间不断上升，不会自然下降。越过橙色、红色阈值后会持续掉血。'),
        h('li', null, '辐射越高，新出现的丧尸越强，拖得越久越危险。'),
        h('li', null, '安全屋里的防护服柜可以换上更高级的防护服，提高辐射阈值；生命上限或移动速度偏低时，换上防护服还会提升这些属性。净化血清可以降低辐射。'),
        h('li', null, '尸王广场的辐射特别强，速战速决。')),
      h('h3', null, '丧尸'),
      h('ul', null,
        h('li', null, '社畜丧尸、头铁丧尸（皮糙肉厚）、跑得快丧尸、吐口水丧尸（会保持距离远程吐口水）。'),
        h('li', null, '苦力怕：靠近你或者被打死后会嘶嘶作响、一边闪白一边膨胀，地面会出现红色的爆炸范围，2 秒后爆炸，连周围的丧尸也一起炸（对丧尸伤害更高）。远远打死它能拿到更多金币。'),
        h('li', null, '带黄、橙、红光环的是变异精英：更强，掉落更多金币，偶尔还会掉落子弹。'),
        h('li', null, '丧尸被打倒时偶尔会掉落道具，同一个区域里掉落得越多，之后就越难再掉。联机时每个人都能各拿一次。')),
      h('h3', null, '安全屋'),
      h('ul', null,
        h('li', null, '进入即关门：身上的金币和金币罐都会存起来，贵重品可以换一次免费的祭坛加点。走到医疗箱旁按交互键回满生命。'),
        h('li', null, '祭坛：花金币提升属性。商店：购买枪械和子弹，也可以刷新货架、出售用不上的物品。'),
        h('li', null, '安全屋里可以开枪试试手感，子弹不会伤到自己和队友。'),
        h('li', null, '安全屋的背包和商店里有一个不限格数的临时整备区，方便拆下枪里的子弹、存放背包放不下的东西；关闭背包或商店界面时，里面的物品会全部掉在地上。'),
        h('li', null, '准备好后走到出口前的黄色区域，倒计时结束后开门进入下一区。')),
      h('h3', null, '联机'),
      h('ul', null,
        h('li', null, '生命归零会倒地。站到倒地队友身边按交互键并保持不动，片刻后就能把 TA 拉起来，刚被拉起的人有几秒无敌。阵亡后观战时，界面显示被观战队友的武器、道具和属性。'),
        h('li', null, '如果倒地的队友没被拉起，大家就进了下一个安全屋，TA 会在本局阵亡，只能观战。所有人都倒下则游戏结束。'),
        h('li', null, '队友击杀丧尸时你也能分到一部分金币。小心别打到队友。'),
        h('li', null, '有人打开背包或暂停菜单时，所有人一起暂停。')),
      h('div', { class: 'actions' }, this.btn('返回', () => this.back(), true))));
  }

  codex(tab: 'bullet' | 'module' | 'gun' | 'item' | 'enemy' | 'quest' | 'relic' = 'bullet'): void {
    // 第3次调整：图鉴显示道具 / 枪械 / 子弹 / 模块的标准数值与变动（不含随机浮动和前缀）
    const sgn = (v: number, d = 2) => `${v > 0 ? '+' : ''}${v.toFixed(d)}`;
    const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
    const stat = (k: string, v: string | HTMLElement, cls = '') => h('span', { class: 'cx-s ' + cls }, h('i', null, k), typeof v === 'string' ? h('b', null, v) : v);
    const card = (icon: string, title: HTMLElement, ...body: (HTMLElement | null)[]) =>
      h('div', { class: 'cx-card' }, h('img', { src: icon }), h('div', { class: 'cx-body' }, title, ...body));
    const modLine = (m: { delay?: number; reload?: number; spread?: number; atk?: number }) => {
      const out: HTMLElement[] = [];
      if (m.atk) out.push(stat('攻击倍率', sgn(m.atk) + 'x', m.atk > 0 ? 'good' : 'bad'));
      if (m.delay) out.push(stat('射击延迟', sgn(m.delay) + 's', m.delay > 0 ? 'bad' : 'good'));
      if (m.reload) out.push(stat('换弹延迟', sgn(m.reload) + 's', m.reload > 0 ? 'bad' : 'good'));
      if (m.spread) out.push(stat('散射', sgn(m.spread, 0) + '°', m.spread > 0 ? 'bad' : 'good'));
      return out.length ? h('div', { class: 'cx-row cx-mods' }, h('em', null, '装填后'), ...out) : null;
    };
    const tabs = h('div', { class: 'tabs', style: 'margin-bottom:10px' });
    const names: [typeof tab, string][] = [['bullet', '子弹'], ['module', '逻辑模块'], ['gun', '枪械'], ['item', '道具'], ['enemy', '敌人'], ['quest', '区域任务'], ['relic', '奇物']];
    for (const [id, nm] of names) tabs.appendChild(h('div', { class: 'tab' + (tab === id ? ' on' : ''), onclick: () => { this.act.sound('click'); this.codex(id); } }, nm));
    const body = h('div', null);
    if (tab === 'bullet') {
      body.appendChild(h('p', { style: 'color:#8d939a;margin:0 0 8px' }, '以下为子弹的标准数值。实际拿到的子弹数值会在标准值上下浮动；攻击力最终还要乘以枪械的攻击倍率。'));
      const grid = h('div', { class: 'cx-grid' });
      for (const id of BULLET_IDS) {
        const d = BULLETS[id];
        if (d.logic) continue;
        const f = d.flags ?? {};
        const extra: HTMLElement[] = [];
        if ((d.count ?? 1) > 1) extra.push(stat('弹丸', `${d.count} 发`));
        if (d.pierce) extra.push(stat('穿透', d.pierce < 0 ? '无限' : `${d.pierce} 个`));
        extra.push(stat('射程', `${d.range ?? 26} 米`));
        if (f.wallBounce) extra.push(stat('墙面反弹', `${f.wallBounce} 次`));
        if (f.enemyBounce) extra.push(stat('敌间弹射', `${f.enemyBounce} 次`));
        if (f.chain) extra.push(stat('电弧跳跃', `${f.chain} 次`));
        if (f.knock) extra.push(stat('击退', '强'));
        if (f.homing) extra.push(stat('追踪', '是'));
        if (f.butter) extra.push(stat('变成黄油', `${Math.round(f.butter * 100)}%（攻击力 ×${BUTTER.atkMul}，晕眩 ${BUTTER.stun} 秒）`, 'good'));
        const statsRow = f.mystery
          ? h('div', { class: 'cx-row' }, h('span', { class: 'cx-s' }, h('b', null, '发射时随机变成其他任意子弹')))
          : h('div', { class: 'cx-row' },
            stat('攻击力', String(d.atk)), stat('弹速', String(d.spd)), stat('大小', String(d.rng)),
            stat('额外散射', `${d.deg > 0 ? '+' : ''}${d.deg}°`, d.deg > 0 ? 'bad' : d.deg < 0 ? 'good' : ''), stat('后坐系数', String(d.rc)));
        if (f.mystery) extra.length = 0;
        grid.appendChild(card(bulletIcon(id), h('b', { class: 'cx-t', style: `color:${hex(d.color)}` }, d.name),
          statsRow,
          modLine(d.mods),
          h('div', { class: 'cx-row' }, ...extra),
          h('div', { class: 'cx-eff' }, d.effect)));
      }
      body.appendChild(grid);
    } else if (tab === 'module') {
      body.appendChild(h('p', { style: 'color:#8d939a;margin:0 0 8px' }, '逻辑模块装进枪械的槽位，不射出子弹，而是强化排在它后面的子弹。模块的数值是固定的。'));
      const grid = h('div', { class: 'cx-grid' });
      for (const id of BULLET_IDS) {
        const d = BULLETS[id];
        const L = d.logic;
        if (!L) continue;
        const fx: HTMLElement[] = [];
        if (L.cast) fx.push(stat('同时射出', `${L.cast} 发`, 'good'));
        if (L.homing) fx.push(stat('追踪', '下一发', 'good'));
        if (L.pierce) fx.push(stat('额外穿透', `+${L.pierce}`, 'good'));
        if (L.blast) fx.push(stat('命中爆炸', '半径 2 米，60% 伤害', 'good'));
        if (L.dmg) fx.push(stat('伤害', `×${L.dmg}`, 'good'));
        if (L.speed) fx.push(stat('弹速', `×${L.speed}`, 'good'));
        if (L.focus) fx.push(stat('散射', `-${L.focus}°`, 'good'));
        if (L.spread) fx.push(stat('散射', `+${L.spread}°`, 'bad'));
        if (L.shine) fx.push(stat('闪耀虹彩', '下一发', 'good'));
        if (L.loop) fx.push(stat('循环', '下一发', 'good'));
        if (L.short) fx.push(stat('换弹时间', '90% 减半 / 10% ×4'));
        if (L.multi) fx.push(stat('分裂', `×${L.multi}`, 'good'));
        if (L.copy) fx.push(stat('复制', '前一发子弹', 'good'));
        if (d.mods.reloadMul) fx.push(stat('换弹时间', `-${Math.round((1 - d.mods.reloadMul) * 100)}%`, 'good'));
        if (d.mods.half) fx.push(stat('载弹量', '减半', 'bad'));
        grid.appendChild(card(bulletIcon(id), h('b', { class: 'cx-t', style: `color:${hex(d.color)}` }, d.name),
          h('div', { class: 'cx-row' }, h('em', null, '效果'), ...fx),
          modLine(d.mods) ?? h('div', { class: 'cx-row cx-mods' }, h('em', null, '装填后'), h('span', { class: 'cx-s' }, h('b', null, '不改变枪械数值'))),
          h('div', { class: 'cx-eff' }, d.effect)));
      }
      body.appendChild(grid);
    } else if (tab === 'gun') {
      const rows = [1, 2, 3, 4, 5].map((r) => {
        const capMax = Math.max(2, Math.min(10, Math.floor((r + 2) * GUN_BUDGET_K - 1)));
        return h('tr', null, h('td', { style: `color:${RARITY_CSS[r]}` }, RARITY_NAMES[r]), h('td', null, `2 ~ ${capMax}`),
          h('td', null, r === 5 ? '只在第三、第四区的地图中出现，商店不出售' : r === 4 ? '第二区起出现' : '地图与商店'));
      });
      body.append(
        h('h3', null, '稀有度'),
        h('p', { style: 'color:#8d939a;margin:0 0 6px' }, '稀有度越高，枪的综合性能（攻击倍率、射速、换弹、载弹量）越强。'),
        h('table', { class: 'cx-table' }, h('tr', null, h('th', null, '稀有度'), h('th', null, '载弹量（标准）'), h('th', null, '出现位置')), ...rows),
        h('h3', null, '基础属性'),
        h('table', { class: 'cx-table' },
          h('tr', null, h('th', null, '属性'), h('th', null, '范围'), h('th', null, '说明')),
          h('tr', null, h('td', null, '攻击倍率'), h('td', null, '0.50x ~ 4.50x'), h('td', null, '子弹攻击力 × 攻击倍率 = 实际伤害')),
          h('tr', null, h('td', null, '射击延迟'), h('td', null, '0.06s ~ 0.40s'), h('td', null, `越小射速越快；无论怎样强化都不会低于 ${GUN_LIMITS.delay.toFixed(2)}s`)),
          h('tr', null, h('td', null, '换弹延迟'), h('td', null, '0.40s ~ 2.60s'), h('td', null, `打完一轮后的换弹时间；不会低于 ${GUN_LIMITS.reload.toFixed(2)}s`)),
          h('tr', null, h('td', null, '最大载弹量'), h('td', null, '2 ~ 10'), h('td', null, '可以装填的子弹 / 模块数量')),
          h('tr', null, h('td', null, '散射角度'), h('td', null, '-40° ~ +40°'), h('td', null, '为负数时可以抵消子弹自带的散射'))),
        h('h3', null, '类别（由数值决定）'),
        h('table', { class: 'cx-table' },
          h('tr', null, h('th', null, '类别'), h('th', null, '条件')),
          ...([
            ['转轮机枪 MG', '射击延迟 ≤ 0.10s，且载弹量 ≥ 6'],
            ['榴弹发射器 GL', '攻击倍率 ≥ 2.60x，且射击延迟 ≥ 0.28s'],
            ['霰弹枪 / 喷子 SG', '散射 ≥ 25°（载弹量 ≤ 3 为喷子）'],
            ['冲锋枪 SM', '射击延迟 ≤ 0.12s'],
            ['狙击枪 SR', '攻击倍率 ≥ 1.80x，或散射 ≤ -25°'],
            ['手枪 HG', '载弹量 ≤ 3'],
            ['轻机枪 LM', '载弹量 ≥ 7'],
            ['卡宾枪 CB / 步枪 AR', '其余（换弹延迟 < 1s 为卡宾枪）'],
          ] as const).map(([a, b]) => h('tr', null, h('td', null, a), h('td', null, b)))),
        h('p', { style: 'color:#8d939a;margin:4px 0 0' }, '型号 = 类别代码 + 厂商字母 - 稀有度 + 载弹量，例如 SMK-47 是一把 Rarity4、载弹量 7 的冲锋枪。'),
        h('h3', null, '修饰语（名字前面的词）'),
        h('table', { class: 'cx-table' },
          h('tr', null, h('th', null, '修饰语'), h('th', null, '效果')),
          ...GUN_MOD_IDS.map((m) => h('tr', null, h('td', { style: `color:${MOD_TONE_CSS[GUN_MODS[m].tone]}` }, GUN_MODS[m].name), h('td', null, GUN_MODS[m].desc)))),
        h('h3', null, '开局武器'));
      const sg = h('div', { class: 'cx-grid' });
      const rng = new Rng(1);
      for (const s of STARTER_GUNS) {
        const g = makeFixedGun(s.name, s.model, s.rarity, s.atk, s.delay, s.cap, s.spread, s.roll, rng);
        sg.appendChild(card(gunIcon(g), h('b', { class: 'cx-t', style: `color:${RARITY_CSS[g.rarity]}` }, `${g.model} ${g.name}`),
          h('div', { class: 'cx-row' }, stat('攻击倍率', g.atk.toFixed(2) + 'x'), stat('射击延迟', g.delay.toFixed(2) + 's'), stat('换弹延迟', g.reload.toFixed(2) + 's'),
            stat('载弹量', String(g.cap)), stat('散射', `${g.spread}°`, g.spread > 0 ? 'bad' : 'good'))));
      }
      body.appendChild(sg);
    } else if (tab === 'enemy') {
      body.appendChild(h('p', { style: 'color:#8d939a;margin:0 0 8px' }, '以下为第一区、普通难度下的基础数值。越往后的区域、辐射越高，丧尸越强。'));
      const grid = h('div', { class: 'cx-grid' });
      const spd = (v: number) => (v >= 4.8 ? '快' : v >= 4.2 ? '中等' : '慢');
      const zombie = (icon: string, color: string, name: string, s: [string, string][], desc: string) =>
        grid.appendChild(card(icon, h('b', { class: 'cx-t', style: `color:${color}` }, name),
          h('div', { class: 'cx-row' }, ...s.map(([k, v]) => stat(k, v))), h('div', { class: 'cx-eff' }, desc)));
      const base = (t: keyof typeof ENEMIES): [string, string][] => [['生命', String(ENEMIES[t].hp)], ['攻击', String(ENEMIES[t].atk)], ['速度', spd(ENEMIES[t].speed)], ['金币', String(ENEMIES[t].gold)]];
      zombie(enemyIcon('office'), '#c8b8a0', ENEMIES.office.name, base('office'), '最常见的丧尸，数量众多。');
      zombie(enemyIcon('iron'), '#9aa4b0', ENEMIES.iron.name, base('iron'), '皮糙肉厚、体型高大，不容易被击退，受伤后头顶会显示血条。');
      zombie(enemyIcon('runner'), '#ff9a6a', ENEMIES.runner.name, base('runner'), '跑得飞快，从第二区开始出现。');
      zombie(enemyIcon('spitter'), '#9aff4a', ENEMIES.spitter.name, base('spitter'), '会和你保持距离，远远地吐出口水；从第三区开始出现。');
      zombie(enemyIcon('creeper'), '#6aff6a', ENEMIES.creeper.name, [['生命', String(ENEMIES.creeper.hp)], ['爆炸伤害', String(CREEPER.boom)], ['金币', `${ENEMIES.creeper.gold}（被打死）/ ${CREEPER.nearGold}`]],
        '靠近你或者被打死后会嘶嘶作响，地面出现红色的爆炸范围，2 秒后爆炸；爆炸也会波及周围的丧尸，对丧尸的伤害更高。');
      zombie(enemyIcon('mutant'), '#ff7aff', '异变体', [['生命', `同类的 ${MUTANT.hp} 倍`], ['攻击', `同类的 ${MUTANT.atk} 倍`], ['速度', `同类的 ${MUTANT.speed} 倍`]],
        '区域任务“击杀异变体”中出现的特殊丧尸，全身散发虹彩光芒，不会消失。可能是除苦力怕以外的任何一种丧尸。');
      zombie(enemyIcon('elite'), ELITE_CSS[2], '变异精英', ELITE_MUL.slice(1).map((v, i) => [['黄色', '橙色', '红色'][i], `生命、攻击 ×${v}`] as [string, string]),
        '脚下带有黄 / 橙 / 红色光环，更强也更值钱，偶尔会掉落子弹。');
      zombie(enemyIcon('laoda'), '#ff4a3a', BOSS.name, [['生命', `每阶段 ${fmtNum(BOSS.hpPerPhase * DIFFICULTY.normal.hp)}，共 ${BOSS.phases} 阶段`], ['攻击', String(BOSS.atk)]],
        '尸王广场的主人：会蓄力冲刺、连续投掷石块，血量降低时召唤精英丧尸，半血后狂暴。冲刺撞墙会眩晕。');
      zombie(enemyIcon('mamba'), '#c06aff', MAMBA.name, [['生命', fmtNum(MAMBA.hp * DIFFICULTY.normal.hp)], ['攻击', String(MAMBA.atk)]],
        '隐秘核心的主人：旋转激光、近身冲击波、大范围投石，狂暴后连续冲撞，并不断召唤精英丧尸。激光会被柱子挡住。据说它倒下之后还会再爬起来……');
      zombie(enemyIcon('chest'), '#ffd24a', '奇物宝箱', [['生命', CHEST_HP.slice(2).map((v) => fmtNum(v)).join(' / ')]],
        '完成区域任务后，下一个区域会出现奇物宝箱（生命值按第二 ~ 第五区递增）。它不会动也不会攻击，打破后掉落奇物。');
      body.appendChild(grid);
      body.appendChild(h('p', { style: 'color:#8d939a;margin:8px 0 0' },
        '两名 Boss 每次转阶段（召唤精英、狂暴）时，都会获得 80% 的伤害减免，之后在约 20 秒内逐渐消退；减免还没消退时再次转阶段，会重新补满。一次伤害也不会直接越过下一个阶段。生命条下方的小盾显示当前的减免。'));
    } else if (tab === 'quest') {
      body.appendChild(h('p', { style: 'color:#8d939a;margin:0 0 8px' }, '第一 ~ 第四区各有一项区域任务，从下面 5 种里抽取 4 种，不会重复。完成任务后，下一个区域会出现奇物宝箱。'));
      const grid = h('div', { class: 'cx-grid' });
      const A = QUEST.arrow;
      const arrow: Record<string, string> = { signal: `${A.signal} 秒`, mutant: `${A.mutant} 秒`, cargo: `${A.cargo} 秒（运载点）`, pyre: '无', miasma: '无' };
      for (const id of QUEST_IDS) {
        const q = QUEST_INFO[id];
        grid.appendChild(card(questIcon(id), h('b', { class: 'cx-t', style: `color:${q.color}` }, q.name),
          h('div', { class: 'cx-row' }, stat('方向箭头', arrow[id])), h('div', { class: 'cx-eff' }, q.desc)));
      }
      body.append(grid, h('p', { style: 'color:#8d939a;margin:8px 0 0' }, `离开安全屋一段时间后，或者找到过目标之后，屏幕边缘会显示目标的方向。奇物宝箱在离开安全屋 ${A.chest} 秒后显示方向。`));
    } else if (tab === 'relic') {
      body.appendChild(h('p', { style: 'color:#8d939a;margin:0 0 8px' }, '打破奇物宝箱会掉落奇物。任何人捡起奇物后，每个人都能从随机的三个增益中选择一个。增益是全局的，不管拿着什么枪都会生效，同一个增益不会重复出现。'));
      const grid = h('div', { class: 'cx-grid' });
      for (const id of RELIC_IDS) {
        const d = RELICS[id];
        grid.appendChild(card(relicIcon(id), h('b', { class: 'cx-t', style: `color:${d.color}` }, d.name), h('div', { class: 'cx-eff' }, d.desc)));
      }
      body.appendChild(grid);
    } else {
      const K = this.settings.keys;
      const V = ITEM_VALUES;
      const purify = ZONES.slice(0, 4).map((z) => `${z.purify}K`).join(' / ');
      const fx: Record<ItemId, [string, string][]> = {
        jar: [['兑换', `${fmtNum(JAR_VALUE)} 金币`]],
        serumHp: [['生命值和上限', `+${V.serumHp}`]],
        serumSpd: [['移动速度', `+${V.serumSpd}%`]],
        part1: [['所有枪攻击倍率', `+${V.part1.toFixed(2)}x`]],
        part2: [['所有枪换弹延迟', `-${V.part2.toFixed(2)}s`]],
        purify: [['减少辐射', `${purify}（第一 ~ 第四区拾取）`], ['尸王广场安全屋', `每支 ${CORE_PURIFY.power}K`]],
        gun: [['占用背包', '4 格'], ['自带子弹', '可能有几枚']],
        valuable: [['祭坛加点', '免费 1 次']],
        milkgold: [['无敌', `${V.buffTime} 秒`]],
        overheat: [['所有枪攻击倍率', `+${V.overheat.toFixed(2)}x`], ['持续', `${V.buffTime} 秒`]],
        painkiller: [['回复生命', `最大生命的 ${V.painkiller}%`]],
        kungfu: [['后坐力影响', `-${V.kungfu}%`]],
        eel: [['移动速度', `+${V.eel}%`], ['持续', `${V.buffTime} 秒`]],
      };
      const grid = h('div', { class: 'cx-grid' });
      for (const id of ITEM_IDS) {
        const d = ITEMS[id];
        const qi = QUICK_ORDER.indexOf(id);
        const how = !d.keep ? '拾取后立即生效' : d.usable ? `可保留，快捷键 ${keyLabel(K[('item' + (qi + 1)) as KeyAction])} 或在背包里右键使用` : id === 'gun' ? '可保留' : '可保留，到达安全屋时自动兑换';
        grid.appendChild(card(itemIcon(id), h('b', { class: 'cx-t', style: `color:${d.color}` }, d.name),
          h('div', { class: 'cx-row' }, ...fx[id].map(([k, v]) => stat(k, v, 'good'))),
          h('div', { class: 'cx-row' }, d.keep ? stat('占用背包', `${itemSize({ uid: 0, kind: 'item', id, power: 0 })} 格`) : null, h('span', { class: 'cx-s' }, h('i', null, how))),
          h('div', { class: 'cx-eff' }, d.desc)));
      }
      body.append(grid, h('p', { style: 'color:#8d939a;margin:8px 0 0' }, '地图中的强化血清（生命 / 脚力）、全局强化零件 1 型 / 2 型和下盘功夫可能带有【高级】或【顶级】前缀，效果分别提升 25% / 60%。'));
    }
    this.showBox('codex', h('div', { class: 'dialog', style: 'width:min(940px,96vw)' },
      h('h2', null, '图鉴'), tabs, body,
      h('div', { class: 'actions' }, this.btn('返回', () => this.back(), true))));
  }

  end(win: boolean, run: RunState, onRetry: (() => void) | null, team: TeamLine[] | null = null, retryLabel = '再来一局', meta: RunExportMeta = { mode: 'solo', playerCount: 1, isHost: null, source: 'human' }): void {
    const s = run.stats;
    const zc = ZONES[Math.min(ZONES.length, run.zoneIndex) - 1];
    const zoneName = `${zc.name}　${zc.subtitle}`;
    // 第3次调整：击败曼巴僵尸为真结局；击败牢大后在隐秘核心倒下仍算通关
    const trueEnd = run.mambaKilled;
    const coreFall = !win && run.laodaKilled;
    // v4.3.7：结算标题——击败牢大“牢大坠机了”、击败曼巴“曼巴坠机了”；在 Boss 战中倒下“没肘过牢大 / 曼巴”，其他情况“坠机了”
    const title = trueEnd ? '曼 巴 坠 机 了' : win ? '牢 大 坠 机 了'
      : run.fellIn === 'mamba' ? '没 肘 过 曼 巴' : run.fellIn === 'laoda' ? '没 肘 过 牢 大' : '坠 机 了';
    const titleColor = trueEnd ? '#ffc83a' : win ? '#ffd24a' : coreFall ? '#c06aff' : '#ff4a3a';
    const sub = trueEnd ? '曼巴僵尸倒下了，隐秘核心归于沉寂。'
      : win ? '尸王倒下了。这座城市终于安静了下来。'
      : coreFall ? '尸王已被击败，但没能走出隐秘核心。'
      : `止步于 ${zoneName}`;
    const hint = win && !trueEnd ? '传闻：在辐射进入橙色之前击败尸王，尸王广场深处的大门就会打开……' : '';
    const zt = s.zoneTimes.map((t, i) => `${i + 1}区 ${fmtTime(t)}`).join('　');
    this.showBox('end', h('div', { class: 'dialog', style: 'width:620px' },
      h('div', { class: 'end-title', style: `color:${titleColor}` }, title),
      h('div', { style: 'text-align:center;color:#8d939a;font-size:12px;margin-top:6px' }, sub),
      hint ? h('div', { style: 'text-align:center;color:#c06aff;font-size:12px;margin-top:4px' }, hint) : null,
      team ? h('div', { class: 'team-end' }, ...team.map((t) => h('div', null, h('i', { style: `background:${t.slotColor}` }), h('span', null, t.name), h('span', { style: 'color:#8d939a' }, t.state), h('b', null, `击杀 ${fmtNum(t.kills)}`)))) : null,
      h('div', { class: 'stats-grid' },
        h('div', null, h('span', null, '总用时'), h('b', null, fmtTime(run.totalTime))),
        h('div', null, h('span', null, '难度'), h('b', null, DIFFICULTY[run.difficulty].name)),
        h('div', null, h('span', null, '击杀'), h('b', null, fmtNum(s.kills))),
        h('div', null, h('span', null, '精英击杀'), h('b', null, fmtNum(s.eliteKills))),
        h('div', null, h('span', null, '最高连杀'), h('b', null, fmtNum(s.bestCombo))),
        h('div', null, h('span', null, '造成伤害'), h('b', null, fmtNum(s.damageDealt))),
        h('div', null, h('span', null, '承受伤害'), h('b', null, fmtNum(s.damageTaken))),
        h('div', null, h('span', null, '获得金币'), h('b', null, fmtNum(s.goldEarned))),
        h('div', null, h('span', null, '拾取道具'), h('b', null, fmtNum(s.itemsFound))),
        h('div', null, h('span', null, '开火次数'), h('b', null, fmtNum(s.shotsFired))),
        h('div', null, h('span', null, '最终辐射'), h('b', null, run.rad.toFixed(1) + 'K')),
        h('div', null, h('span', null, '种子'), h('b', null, String(run.seed)))),
      zt ? h('div', { style: 'font-size:12px;color:#8d939a;text-align:center' }, zt) : null,
      h('div', { class: 'actions', style: 'justify-content:center' },
        this.btn(team ? '离开房间' : '回到主菜单', () => this.act.quit()),
        this.btn('导出数据', () => downloadJson(`g4056-${run.seed}-${Date.now()}.json`, run.exportData(win, meta))),
        onRetry ? this.btn(retryLabel, onRetry, true) : team ? h('span', { style: 'color:#8d939a;font-size:12px;align-self:center' }, '等待房主返回房间…') : null)));
  }

  showLoading(text: string): void {
    this.showBox('none', h('div', { style: 'font-size:24px;letter-spacing:6px;color:#8d939a' }, text));
  }
}

/** 真人试玩数据导出：把数据对象序列化成 JSON 文件并触发浏览器下载 */
function downloadJson(filename: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseSeed(s: string): number | null {
  s = s.trim();
  if (!s) return null;
  return /^\d+$/.test(s) ? Number(s) >>> 0 : hashStr(s);
}

export function hashStr(s: string): number {
  let h2 = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h2 ^= s.charCodeAt(i); h2 = Math.imul(h2, 16777619); }
  return h2 >>> 0;
}

export { parseSeed };
