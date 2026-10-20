// 安全屋界面：祭坛（属性提升）、商店（枪械/子弹/刷新）、整备（背包 + 出售）。

import { ALTAR, altarCost, GLOBAL_ATK_MAX, RARITY_CSS, RARITY_NAMES, ZONES } from '../config';
import { BULLETS, bulletName, spreadColor } from '../data/bullets';
import { gunDps } from '../data/guns';
import { altarBuy, altarValue, buyBullet, buyGun, REFRESH_COST, refreshShop } from '../game/shop';
import type { World } from '../game/world';
import { fmtNum } from '../util/math';
import { BagView, BagCallbacks } from './bag';
import { clear, h } from './dom';
import { bulletIcon, gunIcon } from './icons';
import { bulletTip, gunTip, Tooltip } from './tooltip';

export type ShTab = 'altar' | 'shop' | 'bag';

export class SafehouseView {
  root: HTMLDivElement;
  private body: HTMLDivElement;
  private wallet: HTMLDivElement;
  private tabsEl: HTMLDivElement;
  private titleEl: HTMLHeadingElement;
  tab: ShTab = 'altar';
  private footNote!: HTMLSpanElement;
  bag: BagView;
  onClose: () => void = () => {};

  constructor(private getWorld: () => World | null, private tip: Tooltip, private cb: BagCallbacks & { sound(name: string): void }) {
    this.root = h('div', { class: 'sh-wrap hidden' });
    this.wallet = h('div', { class: 'wallet' });
    this.tabsEl = h('div', { class: 'tabs' });
    this.titleEl = h('h2', null, '安全屋');
    this.body = h('div', { class: 'sh-body' });
    const closeBtn = h('button', { class: 'btn primary', onclick: () => this.onClose() }, '完成整备（前往出口）');
    this.root.appendChild(h('div', { class: 'sh-panel' },
      h('div', { class: 'sh-top' }, this.titleEl, this.tabsEl, this.wallet),
      this.body,
      h('div', { class: 'sh-foot' }, this.footNote = h('span', null, ''), closeBtn)));
    this.bag = new BagView(getWorld, tip, cb, true);
    this.bag.sellMode = true;
    this.body.addEventListener('pointerout', () => tip.hide());
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setOpen(v: boolean, tab?: ShTab): void {
    const was = this.open;
    if (tab) this.tab = tab;
    this.root.classList.toggle('hidden', !v);
    if (v) this.render();
    else {
      this.tip.hide();
      // 第4.1次调整：关闭商店界面时，临时整备区里的物品掉在地上
      if (was) this.getWorld()?.flushTemp();
    }
  }

  /** 买下的东西背包放不下时进了临时整备区 */
  private tempNote(w: World, item: unknown): void {
    if (w.run.temp.includes(item as never)) this.cb.toast('背包放不下，已放进临时整备区（在“整备 / 出售”里整理，关闭界面时会掉在地上）', '#ffb03a');
  }

  render(): void {
    const w = this.getWorld();
    if (!w) return;
    const z = w.safehouseZone;
    this.titleEl.textContent = `安全屋　${ZONES[z - 1].name}`;
    this.footNote.textContent = `关闭面板后可以在房间里走动，靠近祭坛或商店可重新打开，准备好后走到出口的黄色区域${w.net ? '，所有队友到齐后出发' : '出发'}`;
    this.wallet.textContent = `💰 ${fmtNum(w.run.bank)}`;
    clear(this.tabsEl);
    const tabs: [ShTab, string][] = [['altar', '祭坛'], ['shop', '商店'], ['bag', '整备 / 出售']];
    for (const [id, name] of tabs) {
      this.tabsEl.appendChild(h('div', { class: 'tab' + (this.tab === id ? ' on' : ''), onclick: () => { this.tab = id; this.cb.sound('click'); this.render(); } }, name));
    }
    clear(this.body);
    if (this.tab === 'altar') this.renderAltar(w);
    else if (this.tab === 'shop') this.renderShop(w);
    else { this.body.appendChild(this.bag.root); this.bag.refresh(true); }
  }

  /** 背包内容在其他地方变化时调用 */
  tickRefresh(): void {
    const w = this.getWorld();
    if (!w) return;
    this.wallet.textContent = `💰 ${fmtNum(w.run.bank)}`;
    if (this.tab === 'bag') this.bag.refresh();
  }

  private renderAltar(w: World): void {
    const run = w.run;
    const z = w.safehouseZone;
    const free = run.freeAltar > 0;
    const cost = free ? 0 : altarCost(run.altarCount);
    this.body.appendChild(h('div', { class: 'altar-info' },
      h('div', null, h('div', { style: 'font-size:12px;color:#8d939a' }, free ? '免费加点（贵重品）' : '本次加点花费'), h('div', { class: 'big' }, free ? `免费 ×${run.freeAltar}` : fmtNum(cost))),
      h('div', { style: 'font-size:12px;color:#8d939a;line-height:1.7' }, `已加点 ${run.altarCount} 次。每次加点都会让下一次更贵，越往后的安全屋提升越多。`)));
    const grid = h('div', { class: 'altar-grid' });
    for (const o of ALTAR) {
      const v = altarValue(o.id, z);
      let cur = '';
      switch (o.id) {
        case 'hp': cur = `当前生命上限 ${Math.round(run.maxHp)}`; break;
        case 'spd': cur = `当前移速加成 +${run.speedPct}%`; break;
        case 'atk': cur = `当前加成 +${run.globalAtk.toFixed(2)}x，最多 +${GLOBAL_ATK_MAX.toFixed(2)}x`; break;
        case 'cap': cur = `作用于当前持有的 ${run.allGuns().length} 把枪`; break;
        case 'recoil': cur = `当前减免 ${Math.round(run.recoilResist * 100)}%`; break;
        case 'purify': cur = `当前辐射 ${run.rad.toFixed(1)}K`; break;
        case 'bag': cur = `当前容量 ${run.bagCap} 单位`; break;
      }
      const can = free || run.bank >= cost;
      grid.appendChild(h('div', {
        class: 'altar-card' + (can ? '' : ' disabled'),
        onclick: () => {
          const err = altarBuy(run, o.id, z);
          if (err) { this.cb.sound('denied'); this.cb.toast(err, '#ff5a4a'); return; }
          this.cb.sound('altar');
          this.cb.toast(`祭坛：${o.name}，${o.fmt(v)}`, '#e0a0ff');
          this.render();
        },
      }, h('h4', null, o.name), h('div', { class: 'v' }, o.fmt(v)), h('div', { class: 'cur' }, cur)));
    }
    this.body.appendChild(grid);
  }

  private renderShop(w: World): void {
    const run = w.run;
    const shop = w.shop;
    if (!shop) return;
    const gunsSec = h('div', { class: 'shop-sec' });
    gunsSec.appendChild(h('h3', null, h('span', null, '枪械（不含子弹）'),
      h('button', {
        class: 'btn small', onclick: () => {
          const err = refreshShop(run, shop);
          if (err) { this.cb.sound('denied'); this.cb.toast(err, '#ff5a4a'); return; }
          this.cb.sound('buy');
          this.render();
        },
      }, `⟳ 刷新商店（${REFRESH_COST}）`)));
    const gg = h('div', { class: 'shop-grid' });
    shop.guns.forEach((e, i) => {
      const g = e.item;
      const card = h('div', { class: 'shop-card' + (e.sold ? ' sold' : ''), style: `border-top-color:${RARITY_CSS[g.rarity]}` },
        h('img', { class: 'gi', src: gunIcon(g), draggable: 'false' }),
        h('div', { class: 'nm', style: `color:${RARITY_CSS[g.rarity]}` }, `${g.model} ${g.name}`),
        h('div', { class: 'st' }, `${RARITY_NAMES[g.rarity]}`, h('br'), `Atk ${g.atk.toFixed(2)}x`, run.globalAtk > 0 ? h('span', { style: 'color:#ffb03a' }, `+${run.globalAtk.toFixed(2)}`) : '', `　延迟 ${g.delay.toFixed(2)}s`, h('br'), `换弹 ${g.reload.toFixed(2)}s　载弹 ${g.cap}　`, h('span', { style: `color:${g.spread > 0 ? '#ff8a6a' : '#6aff8a'}` }, `散射 ${g.spread}°`)),
        h('div', { class: 'row' }, h('span', { class: 'pr' }, e.sold ? '已售出' : `💰 ${fmtNum(e.price)}`),
          h('button', {
            class: 'btn small', disabled: e.sold || run.bank < e.price,
            onclick: () => {
              const err = buyGun(run, shop, i);
              if (err) { this.cb.sound('denied'); this.cb.toast(err, '#ff5a4a'); return; }
              this.cb.sound('buy');
              this.cb.toast(`购买 ${g.model} ${g.name}`, RARITY_CSS[g.rarity]);
              this.tempNote(w, g);
              this.render();
            },
          }, '购买')));
      card.addEventListener('pointerover', (ev) => this.tip.show(gunTip(g, run, `<div class="act">满载时的参考 DPS 取决于装填的子弹</div>`), ev.clientX, ev.clientY));
      gg.appendChild(card);
    });
    gunsSec.appendChild(gg);
    const bSec = h('div', { class: 'shop-sec' }, h('h3', null, h('span', null, '子弹'), h('span', { style: 'font-size:12px' }, '购买后放进背包，拖进枪的槽位即可使用')));
    const bg = h('div', { class: 'shop-grid b5' });
    shop.bullets.forEach((e, i) => {
      const b = e.item;
      const d = BULLETS[b.def];
      const col = '#' + d.color.toString(16).padStart(6, '0');
      const card = h('div', { class: 'shop-card' + (e.sold ? ' sold' : ''), style: `border-top-color:${col}` },
        h('div', { class: 'bi-wrap' + (b.shiny ? ' shiny' : '') + (b.iri ? ' iri' : '') }, h('img', { class: 'bi', src: bulletIcon(b.def), draggable: 'false' })),
        h('div', { class: 'nm' + (b.iri ? ' iri-text' : b.shiny ? ' shiny-text' : ''), style: `color:${col}` }, bulletName(b)),
        h('div', { class: 'st' }, `Atk ${b.atk.toFixed(0)}　Spd ${b.spd.toFixed(0)}`, h('br'), `Rng ${b.rng.toFixed(1)}　后坐 ${b.rc.toFixed(1)}　`,
          d.logic ? '' : h('span', { style: `color:${spreadColor(b.deg, b.rolls[3])}` }, `Deg ${b.deg >= 0 ? '+' : ''}${b.deg.toFixed(0)}°`)),
        h('div', { class: 'row' }, h('span', { class: 'pr' }, e.sold ? '已售出' : `💰 ${fmtNum(e.price)}`),
          h('button', {
            class: 'btn small', disabled: e.sold || run.bank < e.price,
            onclick: () => {
              const err = buyBullet(run, shop, i);
              if (err) { this.cb.sound('denied'); this.cb.toast(err, '#ff5a4a'); return; }
              this.cb.sound('buy');
              const inTemp = run.temp.includes(b);
              this.cb.toast(`购买 ${bulletName(b)}（已放入${inTemp ? '临时整备区' : '背包'}）`, col);
              this.render();
            },
          }, '购买')));
      card.addEventListener('pointerover', (ev) => this.tip.show(bulletTip(b, run), ev.clientX, ev.clientY));
      bg.appendChild(card);
    });
    bSec.appendChild(bg);
    // 当前装备速览
    const bonus = run.atkBonus();
    const eq = h('div', { style: 'font-size:12px;color:#8d939a;margin-top:4px' },
      `当前装备：主手 ${run.guns[0] ? `${run.guns[0].model}（DPS≈${gunDps(run.guns[0], bonus).toFixed(0)}）` : '空'}　副手 ${run.guns[1] ? `${run.guns[1].model}（DPS≈${gunDps(run.guns[1], bonus).toFixed(0)}）` : '空'}　背包 ${run.bagUsed()}/${run.bagCap}`,
      run.temp.length ? h('span', { style: 'color:#ffb03a' }, `　临时整备区 ${run.temp.length} 件`) : '');
    this.body.append(gunsSec, bSec, eq);
  }
}
