// 游戏内 HUD：生命/状态、区域与辐射、小地图、双枪面板、背包指示、快捷栏、提示、Boss 血条等。

import { ELITE_CSS, enhanceCoef, RARITY_CSS, RECOIL, ZONES } from '../config';
import { BULLETS, bulletName, recoilOf } from '../data/bullets';
import { DEFAULT_KEYS, KeyAction, keyLabel } from '../core/settings';
import { SLOT_CSS } from '../render/entities';
import { SUIT_NAMES } from '../game/world';
import { Gun, gunStats } from '../data/guns';
import { ITEMS, QUICK_ORDER } from '../data/items';
import type { World } from '../game/world';
import { fmtNum, fmtTime } from '../util/math';
import { clear, h } from './dom';
import { bulletIcon, itemIcon } from './icons';
import { PIXEL_FONT } from './font';

interface HandView { auto: boolean; cursor: number; reloading: boolean; prog: number }

/** HUD 显示的数据来源：自己，或者阵亡观战时被观战的队友（第4次调整） */
interface HudSrc {
  watching: string | null;
  alive: boolean;
  downed: boolean;
  hp: number;
  maxHp: number;
  suit: number;
  speed: number;
  recoilResist: number;
  kills: number;
  buffs: [number, number, number];
  rad: number;
  radLevel: number;
  thresh: readonly [number, number, number];
  gold: number;
  bank: number;
  bagUsed: number;
  bagCap: number;
  guns: [Gun | null, Gun | null];
  hands: HandView[];
  counts: number[];
}

function escHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}

const BAG_SVG = `<svg viewBox="0 0 48 48"><path fill="currentColor" d="M18 8h12a3 3 0 0 1 3 3v3h3a6 6 0 0 1 6 6v18a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5V20a6 6 0 0 1 6-6h3v-3a3 3 0 0 1 3-3zm1 3v3h10v-3H19z" opacity=".9"/><rect x="14" y="24" width="20" height="8" rx="2" fill="#000" opacity=".35"/><rect x="21" y="22" width="6" height="6" rx="1" fill="#000" opacity=".5"/></svg>`;

export class Hud {
  root: HTMLDivElement;
  private hpFill!: HTMLDivElement;
  private hpLag!: HTMLDivElement;
  private hpText!: HTMLDivElement;
  private statRow!: HTMLDivElement;
  private buffs!: HTMLDivElement;
  private zoneName!: HTMLDivElement;
  private zoneSub!: HTMLDivElement;
  private rad!: HTMLDivElement;
  private radHead!: HTMLDivElement;
  private radFill!: HTMLDivElement;
  private radMarks: HTMLDivElement[] = [];
  private radLbls: HTMLDivElement[] = [];
  private radSig = '';
  private bossPips!: HTMLDivElement;
  private bossSig = '';
  private mini!: HTMLCanvasElement;
  private trStats!: HTMLDivElement;
  private gunCards: HTMLDivElement[] = [];
  private bagInd!: HTMLDivElement;
  private bagCap!: HTMLDivElement;
  private quick!: HTMLDivElement;
  private toasts!: HTMLDivElement;
  private banner!: HTMLDivElement;
  private bossBar!: HTMLDivElement;
  private bossFill!: HTMLDivElement;
  private bossName!: HTMLDivElement;
  private hints!: HTMLDivElement;
  fps!: HTMLDivElement;
  private vignette!: HTMLDivElement;
  hurt!: HTMLDivElement;
  private tick = 0;
  private miniStatic: HTMLCanvasElement | null = null;
  private explored: HTMLCanvasElement | null = null;
  private miniTmp = document.createElement('canvas');
  private miniScale = 1;
  private miniLayoutSeed = -1;
  private exploreT = 0;
  private quickSig = '';
  private gunSig = ['', ''];
  keys: Record<KeyAction, string> = { ...DEFAULT_KEYS };
  private team!: HTMLDivElement;
  private teamSig = '';
  private bagHint!: HTMLDivElement;
  onBagClick: () => void = () => {};
  onQuickUse: (i: number) => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = h('div', { id: 'hud', class: 'layer' });
    parent.appendChild(this.root);
    this.vignette = h('div', { class: 'vignette' });
    this.hurt = h('div', { class: 'hurt-flash' });
    this.root.append(this.vignette, this.hurt);
    // 左上
    this.hpFill = h('div', { class: 'hp-fill' });
    this.hpLag = h('div', { class: 'hp-lag' });
    this.hpText = h('div', { class: 'hp-text' });
    this.statRow = h('div', { class: 'stat-row' });
    this.buffs = h('div', { class: 'buffs' });
    this.team = h('div', { class: 'team hidden' });
    this.root.append(h('div', { class: 'hud-tl' }, h('div', { class: 'panel' },
      h('div', { class: 'hp-row' }, h('span', { style: 'font-weight:800;color:#ff6a5a;font-size:12px' }, 'HP'), h('div', { class: 'hp-bar' }, this.hpLag, this.hpFill, this.hpText)),
      this.statRow, this.buffs), this.team));
    // 中上
    this.zoneName = h('div', { class: 'zone-name' });
    this.zoneSub = h('div', { class: 'zone-sub' });
    this.radHead = h('div', { class: 'rad-head' });
    this.radFill = h('div', { class: 'rad-fill' });
    const radBar = h('div', { class: 'rad-bar' }, this.radFill);
    for (let i = 0; i < 3; i++) {
      const col = ['#ffe14a', '#ff8a1a', '#ff3030'][i];
      const m = h('div', { class: 'rad-mark', style: `background:${col}` });
      this.radMarks.push(m);
      radBar.appendChild(m);
      // 第3次调整：不再用文字显示辐射状态，只在刻度线上标出阈值（橙色标在上方，避免与相邻刻度重叠）
      const l = h('div', { class: 'rad-lbl ' + (i === 1 ? 'up' : 'down'), style: `color:${col}` });
      this.radLbls.push(l);
      radBar.appendChild(l);
    }
    this.rad = h('div', { class: 'rad' }, this.radHead, radBar);
    this.root.append(h('div', { class: 'hud-tc panel' }, this.zoneName, this.zoneSub, this.rad));
    // 右上
    this.mini = h('canvas', { class: 'minimap', width: 200, height: 250 });
    this.trStats = h('div', { class: 'tr-stats' });
    this.root.append(h('div', { class: 'hud-tr panel' }, this.mini, this.trStats));
    // 左下：枪
    const bl = h('div', { class: 'hud-bl' });
    for (let i = 0; i < 2; i++) {
      const c = h('div', { class: 'gun-card panel' });
      this.gunCards.push(c);
      bl.appendChild(c);
    }
    this.root.appendChild(bl);
    // 右下
    this.quick = h('div', { class: 'quickbar' });
    this.bagCap = h('div', { class: 'cap' });
    this.bagInd = h('div', { class: 'bag-ind panel', html: BAG_SVG, onclick: () => this.onBagClick() });
    this.bagHint = h('div', { class: 'hint' }, 'TAB 背包');
    this.bagInd.append(this.bagCap, this.bagHint);
    this.root.append(h('div', { class: 'hud-br' }, this.quick, this.bagInd));
    this.toasts = h('div', { class: 'toasts' });
    this.banner = h('div', { class: 'banner' });
    this.bossName = h('div', { class: 'bn' });
    this.bossFill = h('div', { class: 'bf' });
    this.bossPips = h('div', { class: 'boss-pips' });
    this.bossBar = h('div', { class: 'boss-bar hidden' }, this.bossName, h('div', { class: 'bb' }, this.bossFill), this.bossPips);
    this.hints = h('div', { class: 'hints panel' });
    this.fps = h('div', { class: 'fps hidden' });
    this.root.append(this.toasts, this.banner, this.bossBar, this.hints, this.fps);
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  toast(text: string, color = '#ff9a3c'): void {
    const t = h('div', { class: 'toast', style: `border-right-color:${color}` }, text);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 6) this.toasts.firstChild!.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  showBanner(title: string, sub: string, color = '#fff'): void {
    clear(this.banner);
    this.banner.className = 'banner';
    void this.banner.offsetWidth;
    this.banner.append(h('div', { class: 'b1', style: `color:${color}` }, title), h('div', { class: 'b2' }, sub));
    this.banner.classList.add('show');
  }

  bagFlash(): void {
    this.bagInd.classList.remove('flash');
    void this.bagInd.offsetWidth;
    this.bagInd.classList.add('flash');
  }

  hurtFlash(): void {
    this.hurt.style.transition = 'none';
    this.hurt.style.opacity = '1';
    void this.hurt.offsetWidth;
    this.hurt.style.transition = 'opacity .45s';
    this.hurt.style.opacity = '0';
  }

  setHints(on: boolean, inSafe: boolean, mp: boolean, minimal = false): void {
    const K = this.keys;
    this.bagHint.textContent = `${keyLabel(K.bag)} 背包`;
    this.hints.classList.toggle('hidden', !on);
    if (!on) return;
    clear(this.hints);
    const items: [string, string][] = inSafe
      ? [[keyLabel(K.interact), minimal ? '医疗箱 / 拾取' : '祭坛 / 商店 / 防护服柜 / 医疗箱'], [keyLabel(K.bag), '背包整备'], ['左键 / 右键', '试枪'], ['走到黄色区域', mp ? '所有人到齐后出发' : '出发']]
      : [['WASD', '移动'], ['左键', '主手射击'], ['右键', '副手射击'], [keyLabel(K.interact), mp ? '拾取 / 拉起队友' : '拾取'], [keyLabel(K.bag), '背包（暂停）'],
        [`${keyLabel(K.autoL)}/${keyLabel(K.autoR)}`, '自动射击'], [keyLabel(K.reload), '换弹'], ['ESC', '暂停']];
    for (const [k, v] of items) this.hints.append(h('span', null, h('span', { class: 'kbd' }, k), ' ', v));
  }

  update(w: World, dt: number): void {
    this.tick += dt;
    this.exploreT -= dt;
    if (this.exploreT <= 0) { this.exploreT = 0.2; this.reveal(w); }
    this.drawMinimap(w);
    if (this.tick < 1 / 30) return;
    this.tick = 0;
    const src = this.source(w);
    // 生命
    const hpf = Math.max(0, src.hp / Math.max(1, src.maxHp));
    this.hpFill.style.width = hpf * 100 + '%';
    this.hpLag.style.width = hpf * 100 + '%';
    const hpNum = `${Math.ceil(Math.max(0, src.hp))} / ${Math.round(src.maxHp)}`;
    this.hpText.textContent = src.watching !== null
      ? (src.watching ? `观战 ${src.watching}　${src.downed ? '倒地' : hpNum}` : '阵亡（观战中）')
      : src.downed ? '倒地，等待队友拉起' : hpNum;
    this.statRow.innerHTML = `<span>防护服 <b>${SUIT_NAMES[Math.min(5, src.suit)]}</b></span><span>移速 <b>${src.speed.toFixed(1)}</b> m/s</span><span>后坐减免 <b>${Math.round(src.recoilResist * 100)}%</b></span><span>击杀 <b>${fmtNum(src.kills)}</b></span>`;
    this.updateTeam(w);
    const bf: string[] = [];
    const [iv, oh, ee] = src.buffs;
    if (iv > 0) bf.push(`<span class="buff" style="color:#fff6d8">无敌 ${iv.toFixed(1)}s</span>`);
    if (oh > 0) bf.push(`<span class="buff" style="color:#ff6a3a">过热 +3.00x ${oh.toFixed(1)}s</span>`);
    if (ee > 0) bf.push(`<span class="buff" style="color:#5a9aff">鳗 +160% ${ee.toFixed(1)}s</span>`);
    if (src.watching === null && w.combo.count >= 5) bf.push(`<span class="buff" style="color:#ffd24a">连杀 ×${w.combo.count}</span>`);
    this.buffs.innerHTML = bf.join('');
    // 区域
    const cfg = w.layout.cfg;
    if (w.phase === 'safehouse') {
      this.zoneName.textContent = `安全屋　${ZONES[w.safehouseZone - 1].name}`;
      this.zoneSub.textContent = `整备中，下一站：${cfg.name} ${cfg.subtitle}`;
    } else {
      this.zoneName.textContent = `${cfg.name}　${cfg.subtitle}`;
      this.zoneSub.innerHTML = `探索计时 <b class="num">${fmtTime(w.zoneTime)}</b>　丧尸强化 <b class="num">×${enhanceCoef(src.rad).toFixed(2)}</b>　难度 ${w.diffName()}`;
    }
    const th = src.thresh;
    const maxV = th[2] * 1.12;
    this.radFill.style.width = Math.min(100, (src.rad / maxV) * 100) + '%';
    this.radFill.style.background = src.radLevel === 0 ? '#6aff6a' : ELITE_CSS[src.radLevel];
    const sigR = th.join('/');
    if (sigR !== this.radSig) {
      this.radSig = sigR;
      th.forEach((t, i) => {
        const pct = (t / maxV) * 100;
        this.radMarks[i].style.left = pct + '%';
        const l = this.radLbls[i];
        l.textContent = `${t}K`;
        l.style.left = pct + '%';
        // 贴近两端时改为左 / 右对齐，避免超出面板
        l.style.transform = pct < 6 ? 'none' : pct > 94 ? 'translateX(-100%)' : 'translateX(-50%)';
      });
    }
    const rate = w.phaseActive() ? `+${cfg.radRate.toFixed(1)}K/s` : '已暂停';
    this.radHead.innerHTML = `<span>☢ 辐射 <b class="num">${src.rad.toFixed(1)}K</b> <span style="color:#888">${rate}</span></span>`;
    this.rad.className = 'rad' + (src.radLevel ? ' warn' + src.radLevel : '');
    // 右上
    this.trStats.innerHTML = `<span>携带 <b style="color:#ffd24a">${fmtNum(src.gold)}</b></span><span>已存 <b style="color:#ffd24a">${fmtNum(src.bank)}</b></span><span>在场 <b>${w.enemies.list.length}</b></span>`;
    // 枪
    for (let i = 0; i < 2; i++) this.updateGunCard(src, i);
    // 背包
    const used = src.bagUsed, cap = src.bagCap, free = cap - used;
    this.bagCap.textContent = `${used}/${cap}`;
    this.bagInd.classList.toggle('orange', free <= 5 && free > 0);
    this.bagInd.classList.toggle('red', free <= 0);
    // 快捷栏
    const counts = QUICK_ORDER.map((_, i) => src.counts[i] ?? 0);
    const sig = counts.join(',') + JSON.stringify(this.keys);
    if (sig !== this.quickSig) {
      this.quickSig = sig;
      clear(this.quick);
      QUICK_ORDER.forEach((id, i) => {
        const c = counts[i];
        const q = h('div', { class: 'quick panel', style: c ? '' : 'opacity:.3', title: ITEMS[id].name, onclick: () => this.onQuickUse(i) },
          h('span', { class: 'k' }, keyLabel(this.keys[('item' + (i + 1)) as KeyAction])), h('img', { src: itemIcon(id), draggable: 'false' }), h('span', { class: 'c' }, c ? String(c) : ''));
        this.quick.appendChild(q);
      });
    }
    // Boss：牢大丧尸分 4 个阶段，每个阶段一条生命条（下方的小格表示剩余阶段）
    const be = w.bossEnemy;
    if (be && !be.dead && w.boss) {
      this.bossBar.classList.remove('hidden');
      const B = w.boss;
      const { phase, total } = B.phaseInfo();
      const per = be.maxHp / total;
      const cur = Math.max(0, be.hp - per * (total - phase));
      const phaseText = total > 1 ? `　第 ${phase}/${total} 阶段` : '';
      this.bossName.textContent = `${B.name}${B.enraged ? '（狂暴）' : ''}${phaseText}　${fmtNum(cur)} / ${fmtNum(per)}`;
      this.bossFill.style.width = Math.min(100, (cur / per) * 100) + '%';
      const sigB = `${total}|${phase}`;
      if (sigB !== this.bossSig) {
        this.bossSig = sigB;
        clear(this.bossPips);
        if (total > 1) for (let i = 0; i < total; i++) this.bossPips.appendChild(h('i', { class: i < total - phase + 1 ? 'on' : '' }));
      }
    } else this.bossBar.classList.add('hidden');
    // 暗角：辐射 + 低血量
    const lowHp = hpf < 0.3 && src.alive ? (0.3 - hpf) / 0.3 : 0;
    const radC = ['0,0,0', '255,225,74', '255,138,26', '255,40,40'][src.radLevel];
    const radA = [0.55, 0.25, 0.32, 0.45][src.radLevel];
    this.vignette.style.boxShadow = `inset 0 0 ${160 + lowHp * 80}px ${lowHp > 0 ? `rgba(200,0,0,${0.35 + lowHp * 0.4})` : `rgba(${radC},${radA})`}`;
  }

  /** 自己，或者阵亡后被观战的队友 */
  private source(w: World): HudSrc {
    const run = w.run, p = w.player;
    const r = w.net && !p.alive && w.spectate >= 0 ? w.remote(w.spectate) : null;
    if (r) {
      const pf = r.prof;
      const th = ZONES[Math.min(5, Math.max(1, r.suit)) - 1].radThresh;
      return {
        watching: r.name, alive: !r.dead, downed: r.downed, hp: r.hp, maxHp: r.maxHp, suit: r.suit, speed: r.speed, recoilResist: pf?.recoilResist ?? 0,
        kills: r.kills, buffs: r.buffs, rad: r.rad, radLevel: r.rad >= th[2] ? 3 : r.rad >= th[1] ? 2 : r.rad >= th[0] ? 1 : 0, thresh: th,
        gold: pf?.gold ?? 0, bank: pf?.bank ?? 0, bagUsed: pf?.bagUsed ?? 0, bagCap: pf?.bagCap ?? 16,
        guns: pf ? pf.guns : [null, null], hands: r.hands, counts: pf?.counts ?? [],
      };
    }
    return {
      watching: w.net && !p.alive ? '' : null, alive: p.alive, downed: p.downed, hp: run.hp, maxHp: run.maxHp, suit: run.suit, speed: p.speed(),
      recoilResist: run.recoilResist, kills: run.stats.kills, buffs: [run.invulnT, run.overheatT, run.eelT], rad: run.rad, radLevel: w.radLevel,
      thresh: w.radThresh(), gold: run.gold, bank: run.bank, bagUsed: run.bagUsed(), bagCap: run.bagCap, guns: run.guns,
      hands: p.hands.map((hs) => ({ auto: hs.auto, cursor: hs.cursor, reloading: hs.reloading, prog: hs.reloading ? 1 - Math.max(0, hs.cooldown) / Math.max(0.01, hs.reloadTotal) : 1 })),
      counts: QUICK_ORDER.map((id) => run.countItem(id)),
    };
  }

  private updateGunCard(src: HudSrc, i: number): void {
    const g = src.guns[i];
    const c = this.gunCards[i];
    const hs = src.hands[i] ?? { auto: false, cursor: 0, reloading: false, prog: 1 };
    const heat = src.buffs[1] > 0;
    const sig = (src.watching ?? '@') + (g ? `${g.uid}|${g.bullets.map((b) => (b ? b.uid : 0)).join(',')}|${g.cap}|${g.atk}|${g.reload}|${hs.auto}|${heat}` : 'none' + hs.auto) + this.keys.autoL + this.keys.autoR;
    if (sig !== this.gunSig[i]) {
      this.gunSig[i] = sig;
      clear(c);
      const key = i === 0 ? `左键（${keyLabel(this.keys.autoL)} 自动）` : `右键（${keyLabel(this.keys.autoR)} 自动）`;
      if (!g) {
        c.style.borderLeftColor = '#444';
        c.append(h('div', { class: 'gun-head' }, h('span', { class: 'gun-name', style: 'color:#666' }, '（空手）'), hs.auto ? h('span', { class: 'auto-badge' }, 'AUTO') : null, h('span', { class: 'gun-key' }, key)),
          h('div', { class: 'gun-stats' }, '拾取枪械后自动装备到空手位'));
        return;
      }
      const st = gunStats(g, heat ? 3 : 0);
      c.style.borderLeftColor = RARITY_CSS[g.rarity];
      c.append(
        h('div', { class: 'gun-head' },
          // 名字过长时只截断名字本身，自动射击标记与按键提示始终可见
          h('span', { class: 'gun-name', style: `color:${RARITY_CSS[g.rarity]}`, title: `${g.model} ${g.name}` }, g.name),
          hs.auto ? h('span', { class: 'auto-badge' }, 'AUTO') : null,
          h('span', { class: 'gun-key' }, key)),
        h('div', { class: 'gun-stats', html: `Atk ${st.atk.toFixed(2)}x　延迟 ${st.delay.toFixed(2)}s　换弹 ${st.reload.toFixed(2)}s　散射 <span style="color:${st.spread > 0 ? '#ff8a6a' : '#6aff8a'}">${st.spread.toFixed(0)}°</span>` }),
      );
      const slots = h('div', { class: 'gun-slots' });
      g.bullets.forEach((b, k) => {
        const s = h('div', { class: 'slot-mini' + (b?.shiny ? ' shiny' : '') + (b?.iri ? ' iri' : ''), 'data-k': k });
        if (b) s.appendChild(h('img', { src: bulletIcon(b.def), draggable: 'false' }));
        slots.appendChild(s);
      });
      c.append(slots, h('div', { class: 'reload-bar' }, h('div', { class: 'reload-fill' })), h('div', { class: 'recoil-line' }));
    }
    if (!g) return;
    // 动态部分
    const slotEls = c.querySelectorAll<HTMLDivElement>('.slot-mini');
    slotEls.forEach((el, k) => {
      el.classList.toggle('cur', !hs.reloading && k === hs.cursor && !!g.bullets[k]);
      el.classList.toggle('spent', !hs.reloading && k < hs.cursor);
    });
    const fill = c.querySelector<HTMLDivElement>('.reload-fill');
    if (fill) {
      const r = hs.reloading ? hs.prog : 1;
      fill.style.width = r * 100 + '%';
      fill.style.background = hs.reloading ? '#6ad8ff' : '#3a6a7a';
    }
    const rl = c.querySelector<HTMLDivElement>('.recoil-line');
    if (rl) {
      let k = hs.cursor;
      while (k < g.bullets.length && (!g.bullets[k] || BULLETS[g.bullets[k]!.def].logic)) k++;
      const b = g.bullets[k] ?? g.bullets.find((x) => x && !BULLETS[x.def].logic);
      if (b) {
        const st = gunStats(g);
        const info = recoilOf(b.rc * st.recoilMul, st.delay, src.recoilResist, RECOIL.t1, RECOIL.t2);
        // 盲盒发射时才知道会变成什么，后坐力也是随机的
        rl.textContent = `下一发：${bulletName(b)} ${BULLETS[b.def].flags?.mystery ? '【随机】' : info.label}`;
      } else rl.textContent = src.watching !== null ? '未装填子弹' : `未装填子弹，打开背包（${keyLabel(this.keys.bag)}）把子弹拖进枪里`;
    }
  }

  /** 联机：队友列表 */
  private updateTeam(w: World): void {
    const net = w.net;
    this.team.classList.toggle('hidden', !net);
    if (!net) return;
    const rows: string[] = [];
    for (const r of net.remotes()) {
      const st = r.dead ? '阵亡' : r.downed ? '倒地' : r.arrived ? '已进入安全屋' : r.paused ? '暂停中' : '';
      const hp = r.dead ? 0 : Math.max(0, r.hp / Math.max(1, r.maxHp));
      rows.push(`<div class="tm${r.dead ? ' dead' : r.downed ? ' down' : ''}"><i style="background:${SLOT_CSS[r.slot % 4]}"></i><span class="n">${escHtml(r.name)}</span><span class="b"><span style="width:${(hp * 100).toFixed(0)}%"></span></span><span class="s">${st || `${Math.ceil(r.hp)}`}</span></div>`);
    }
    const sig = rows.join('');
    if (sig !== this.teamSig) { this.teamSig = sig; this.team.innerHTML = sig; }
  }

  // —— 小地图 ——
  private buildMinimap(w: World): void {
    const L = w.layout;
    const b = L.bounds;
    const W = this.mini.width, H = this.mini.height;
    const sx = (W - 8) / (b.x1 - b.x0), sy = (H - 8) / (b.y1 - b.y0);
    this.miniScale = Math.min(sx, sy);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const tx = (x: number) => 4 + (x - b.x0) * this.miniScale;
    const ty = (y: number) => H - 4 - (y - b.y0) * this.miniScale;
    g.fillStyle = '#1e2224';
    const r = L.rect;
    g.fillRect(tx(r.x0), ty(r.y1), (r.x1 - r.x0) * this.miniScale, (r.y1 - r.y0) * this.miniScale);
    for (const room of [L.prevRoom, L.safeRoom]) {
      if (!room) continue;
      g.fillStyle = room === L.safeRoom ? '#1a4a2a' : '#26303a';
      g.fillRect(tx(room.rect.x0), ty(room.rect.y1), (room.rect.x1 - room.rect.x0) * this.miniScale, (room.rect.y1 - room.rect.y0) * this.miniScale);
    }
    for (const o of L.obstacles) {
      if (o.kind === 'door') continue;
      g.fillStyle = o.kind === 'tower' ? '#5a5e62' : o.kind === 'wall' || o.kind === 'roomwall' || o.kind === 'border' ? '#7a7e80' : '#454a4c';
      g.fillRect(tx(o.x0), ty(o.y1), Math.max(1, (o.x1 - o.x0) * this.miniScale), Math.max(1, (o.y1 - o.y0) * this.miniScale));
    }
    this.miniStatic = c;
    const e = document.createElement('canvas');
    e.width = W; e.height = H;
    this.explored = e;
    this.miniTmp.width = W; this.miniTmp.height = H;
    this.miniLayoutSeed = L.seed;
  }

  private reveal(w: World): void {
    if (!this.explored || this.miniLayoutSeed !== w.layout.seed) this.buildMinimap(w);
    const g = this.explored!.getContext('2d')!;
    const b = w.layout.bounds;
    const x = 4 + (w.view.x - b.x0) * this.miniScale;
    const y = this.mini.height - 4 - (w.view.y - b.y0) * this.miniScale;
    const grd = g.createRadialGradient(x, y, 0, x, y, 24 * this.miniScale);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.75, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(x - 30 * this.miniScale, y - 30 * this.miniScale, 60 * this.miniScale, 60 * this.miniScale);
  }

  private drawMinimap(w: World): void {
    if (!this.miniStatic || this.miniLayoutSeed !== w.layout.seed) this.buildMinimap(w);
    const g = this.mini.getContext('2d')!;
    const W = this.mini.width, H = this.mini.height;
    const L = w.layout, b = L.bounds;
    const s = this.miniScale;
    const tx = (x: number) => 4 + (x - b.x0) * s;
    const ty = (y: number) => H - 4 - (y - b.y0) * s;
    g.fillStyle = '#0a0c0e';
    g.fillRect(0, 0, W, H);
    // 迷雾：只显示探索过的区域
    const t = this.miniTmp.getContext('2d')!;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, W, H);
    t.drawImage(this.miniStatic!, 0, 0);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(this.explored!, 0, 0);
    g.globalAlpha = 0.22;
    g.drawImage(this.miniStatic!, 0, 0);
    g.globalAlpha = 1;
    g.drawImage(this.miniTmp, 0, 0);
    const time = w.time;
    // 安全屋（第五区的安全屋在击败牢大之前是锁着的，不标出来）
    if (L.safeRoom && w.safeRoomOpen()) {
      const r = L.safeRoom.rect;
      g.strokeStyle = `rgba(106,255,138,${0.6 + Math.sin(time * 4) * 0.4})`;
      g.lineWidth = 2;
      g.strokeRect(tx(r.x0), ty(r.y1), (r.x1 - r.x0) * s, (r.y1 - r.y0) * s);
      g.fillStyle = '#6aff8a';
      g.font = `12px ${PIXEL_FONT}`;
      g.textAlign = 'center';
      g.fillText('安全屋', tx((r.x0 + r.x1) / 2), ty((r.y0 + r.y1) / 2) + 3);
    }
    // 道具
    for (const it of w.pickups.items) {
      if (it.dead || !it.seen) continue;
      const th = it.thing;
      g.fillStyle = th.kind === 'gun' ? RARITY_CSS[th.rarity] : th.kind === 'bullet' ? '#ffd27a' : th.kind === 'item' ? ITEMS[th.id].color : '#fff';
      g.beginPath();
      g.arc(tx(it.x), ty(it.y), 2.6, 0, 7);
      g.fill();
    }
    // 精英与 Boss
    const p = w.player;
    for (const e of w.enemies.list) {
      if (e.dead) continue;
      if (e.type === 'boss') {
        g.fillStyle = '#ff2a1a';
        g.beginPath(); g.arc(tx(e.x), ty(e.y), 5, 0, 7); g.fill();
      } else if (Math.abs(e.x - p.x) < 28 && Math.abs(e.y - p.y) < 28) {
        g.fillStyle = e.elite ? ELITE_CSS[e.elite] : 'rgba(200,60,50,0.7)';
        g.fillRect(tx(e.x) - 1, ty(e.y) - 1, e.elite ? 3 : 2, e.elite ? 3 : 2);
      }
    }
    // 队友
    if (w.net) {
      for (const r of w.net.remotes()) {
        if (r.dead || (!w.player.alive && r.id === w.spectate)) continue;
        g.fillStyle = r.downed ? (Math.sin(time * 8) > 0 ? '#ff3a3a' : '#ffffff') : SLOT_CSS[r.slot % 4];
        g.strokeStyle = '#000';
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(tx(r.x), ty(r.y), r.downed ? 4.5 : 3.5, 0, 7); g.stroke(); g.fill();
      }
    }
    // 玩家（观战时为被观战的队友）
    g.save();
    g.translate(tx(w.view.x), ty(w.view.y));
    g.rotate(-w.view.face);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(6, 0); g.lineTo(-4, -4); g.lineTo(-2, 0); g.lineTo(-4, 4); g.closePath();
    g.stroke(); g.fill();
    g.restore();
  }
}
