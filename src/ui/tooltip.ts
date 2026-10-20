// 物品提示框：枪械（基础/实际数据、DPS）、子弹（随机偏移、数值补正、特效、后坐力表现）、道具。

import { RARITY_CSS, RARITY_NAMES, RECOIL } from '../config';
import { Bullet, BULLETS, bulletName, bulletQualityName, recoilOf, rollColor, spreadColor } from '../data/bullets';
import { Gun, gunDps, gunStats, GUN_MODS, MOD_TONE_CSS } from '../data/guns';
import { BagItem, consumableName, ITEM_GRADE, itemEffect, ITEMS, itemSize } from '../data/items';
import { PLAYER } from '../config';
import type { RunState } from '../game/state';
import { esc } from './dom';

export class Tooltip {
  el: HTMLDivElement;
  visible = false;
  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tooltip hidden';
    parent.appendChild(this.el);
    window.addEventListener('pointermove', (e) => { if (this.visible) this.place(e.clientX, e.clientY); });
  }
  show(html: string, x: number, y: number): void {
    this.el.innerHTML = html;
    this.el.classList.remove('hidden');
    this.visible = true;
    this.place(x, y);
  }
  hide(): void {
    this.el.classList.add('hidden');
    this.visible = false;
  }
  private place(x: number, y: number): void {
    const z = parseFloat((this.el.style as any).zoom || '1') || 1;
    const r = this.el.getBoundingClientRect();
    let tx = x + 18, ty = y + 14;
    if (tx + r.width > window.innerWidth - 8) tx = x - r.width - 18;
    if (ty + r.height > window.innerHeight - 8) ty = window.innerHeight - r.height - 8;
    // 元素自身带 zoom 时，left/top 也会被缩放
    this.el.style.left = Math.max(4, tx) / z + 'px';
    this.el.style.top = Math.max(4, ty) / z + 'px';
  }
}

const f2 = (v: number) => v.toFixed(2);
const sg = (v: number, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d);

/** hand：装备在哪只手上（-1 不在手上）；数值含全局强化零件1型与奇物的加成（第4.1次调整） */
export function gunTip(g: Gun, run: RunState | null, extra = '', hand = -1): string {
  const st = run ? run.handStats(g, hand) : gunStats(g);
  const bonus = run ? run.atkBonus() : 0;
  const cmp = (base: number, eff: number, lowerBetter: boolean, fmt: (v: number) => string) => {
    if (Math.abs(base - eff) < 0.005) return `<b>${fmt(eff)}</b>`;
    const better = lowerBetter ? eff < base : eff > base;
    return `<b style="color:${better ? '#6aff8a' : '#ff7a6a'}">${fmt(eff)}</b> <span style="color:#777">(${fmt(base)})</span>`;
  };
  const bl = g.bullets.map((b, i) => b ? (BULLETS[b.def].logic
    ? `<div>${i + 1}. <span style="color:#8ae8ff">⚙ ${BULLETS[b.def].name}</span></div>`
    : `<div>${i + 1}. <span class="${b.iri ? 'iri-text' : b.shiny ? 'shiny-text' : ''}" style="color:${rollColor(b.rolls[0])}">${bulletName(b)}</span> <span style="color:#888">Atk ${b.atk.toFixed(0)}</span></div>`) : `<div style="color:#555">${i + 1}. （空）</div>`).join('');
  const negNote = g.spread < 0 ? `<div class="mods" style="color:#6aff8a">负散射：可以抵消子弹自带的散射</div>` : '';
  const md = g.mod ? GUN_MODS[g.mod] : null;
  const modNote = md ? `<div class="mods" style="color:${MOD_TONE_CSS[md.tone]}">修饰语【${md.name}】${md.desc}</div>` : '';
  return `<h4 style="color:${RARITY_CSS[g.rarity]}">${esc(g.model)} ${esc(g.name)}</h4>
<div class="sub">${RARITY_NAMES[g.rarity]}　占用背包 4 单位</div>
<div class="grid">
<span>攻击倍率</span><span>${cmp(g.atk, st.atk, false, (v) => f2(v) + 'x')}</span><span></span>
<span>射击延迟</span><span>${cmp(g.delay, st.delay, true, (v) => f2(v) + 's')}</span><span></span>
<span>换弹延迟</span><span>${cmp(g.reload, st.reload, true, (v) => f2(v) + 's')}</span><span></span>
<span>最大载弹</span><span><b style="${st.cap < g.cap ? 'color:#ff9a6a' : ''}">${st.cap}</b>${st.cap < g.cap ? ` <span style="color:#777">(${g.cap})</span>` : ''} <span style="color:#777">（已装 ${st.loaded}）</span></span><span></span>
<span>散射角度</span><span><b style="color:${st.spread > 0 ? '#ff8a6a' : '#6aff8a'}">${st.spread.toFixed(0)}°</b>${Math.abs(st.spread - g.spread) > 0.5 ? ` <span style="color:#777">(${g.spread}°)</span>` : ''}</span><span></span>
</div>
${modNote}${bonus > 0.001 ? `<div class="mods" style="color:#ffb03a">攻击倍率加成 +${f2(bonus)}x（对所有枪生效）</div>` : ''}<div class="mods">理论单体 DPS ≈ ${gunDps(g, bonus).toFixed(0)}</div>${negNote}
<hr>${bl}${extra}`;
}

export function bulletTip(b: Bullet, run: RunState | null, extra = ''): string {
  const d = BULLETS[b.def];
  if (d.flags?.mystery) {
    const mods: string[] = [];
    if (d.mods.atk) mods.push(`${sg(d.mods.atk)} 攻击倍率`);
    if (d.mods.delay) mods.push(`${sg(d.mods.delay)} 射击延迟`);
    return `<h4 style="color:#${d.color.toString(16).padStart(6, '0')}">${d.name}</h4>
<div class="sub">子弹　占用背包 1 单位</div>
<div class="eff">${d.effect}</div>
${mods.length ? `<div class="mods">数值补正：${mods.join('  ')}</div>` : ''}${extra}`;
  }
  if (d.logic) {
    const mods: string[] = [];
    if (d.mods.atk) mods.push(`${sg(d.mods.atk)} 攻击倍率`);
    if (d.mods.delay) mods.push(`${sg(d.mods.delay)} 射击延迟`);
    if (d.mods.reload) mods.push(`${sg(d.mods.reload)} 换弹延迟`);
    if (d.mods.reloadMul) mods.push(`换弹时间 -${Math.round((1 - d.mods.reloadMul) * 100)}%`);
    if (d.mods.half) mods.push('载弹量减半');
    return `<h4 style="color:#${d.color.toString(16).padStart(6, '0')}">${d.name}</h4>
<div class="sub">逻辑模块　占用背包 1 单位　装进枪械槽位使用</div>
<div class="eff">${d.effect}</div>
${mods.length ? `<div class="mods">数值补正：${mods.join('  ')}</div>` : ''}
<div class="rc">${d.logic.copy ? '复制模块会当作它前面的那发子弹射出。' : '模块本身不射出子弹，也不产生后坐力；它作用于排在它后面的子弹。'}</div>${extra}`;
  }
  const row = (name: string, v: string, r: number) => `<span>${name}</span><span><b style="color:${rollColor(r)}">${v}</b></span><span></span>`;
  const mods: string[] = [];
  if (d.mods.atk) mods.push(`${sg(d.mods.atk)} 攻击倍率`);
  if (d.mods.delay) mods.push(`${sg(d.mods.delay)} 射击延迟`);
  if (d.mods.reload) mods.push(`${sg(d.mods.reload)} 换弹延迟`);
  if (d.mods.spread) mods.push(`<span style="color:${d.mods.spread > 0 ? '#ff6a5a' : '#6aff8a'}">${sg(d.mods.spread, 0)} 散射角度</span>`);
  let rc = '';
  if (run) {
    const lines: string[] = [];
    run.guns.forEach((g, h) => {
      if (!g) return;
      const st = run.handStats(g, h);
      const info = recoilOf(b.rc * st.recoilMul, st.delay, run.recoilResist, RECOIL.t1, RECOIL.t2);
      lines.push(`${h === 0 ? '主手' : '副手'}：${info.label}`);
    });
    if (lines.length) rc = `<div class="rc">${lines.join('<br>')}</div>`;
  }
  const fancy: string[] = [];
  if (b.shiny) fancy.push('<span class="shiny-text">闪耀：攻击力提升</span>');
  if (b.iri) fancy.push('<span class="iri-text">虹彩：攻击力大幅提升</span>');
  return `<h4 class="${b.iri ? 'iri-text' : b.shiny ? 'shiny-text' : ''}" style="color:#${d.color.toString(16).padStart(6, '0')}">${bulletName(b)}</h4>
<div class="sub">子弹　${bulletQualityName(b)}　占用背包 1 单位</div>
${fancy.length ? `<div class="mods">${fancy.join('　')}</div>` : ''}
<div class="grid">
${row('攻击力 Atk', b.atk.toFixed(1), b.rolls[0])}
${row('弹速 Spd', b.spd.toFixed(0), b.rolls[1])}
${row('大小 Rng', b.rng.toFixed(1), b.rolls[2])}
<span>额外散射 Deg</span><span><b style="color:${spreadColor(b.deg, b.rolls[3])}">${(b.deg >= 0 ? '+' : '') + b.deg.toFixed(0)}°</b></span><span></span>
${row('后坐系数', b.rc.toFixed(1), b.rolls[4])}
</div>
${mods.length ? `<div class="mods">数值补正：${mods.join('  ')}</div>` : ''}
<div class="eff">${d.effect}</div>${rc}${extra}`;
}

export function itemTip(it: BagItem, run: RunState | null, extra = ''): string {
  if (it.kind === 'gun') return gunTip(it, run, extra);
  if (it.kind === 'bullet') return bulletTip(it, run, extra);
  const d = ITEMS[it.id];
  const g = it.grade ?? 0;
  const gradeNote = g ? `<div class="mods" style="color:${ITEM_GRADE.color[g]}">${ITEM_GRADE.names[g]}：强化数额 ×${ITEM_GRADE.mul[g]}</div>` : '';
  return `<h4 style="color:${d.color}">${esc(consumableName(it))}</h4>
<div class="sub">${d.keep ? '可保留道具' : '即时道具'}　占用背包 ${itemSize(it)} 单位</div>
${gradeNote}<div class="eff">${itemEffect(it)}</div>${extra}`;
}

export function goldTip(amount: number, unit = PLAYER.goldPerUnit): string {
  return `<h4 style="color:#ffd24a">金币 ×${amount}</h4><div class="sub">一堆最多 ${unit} 金币，占用 1 单位背包</div><div class="eff">到达安全屋时会全部暂存，之后无需携带。</div><div class="act">拖出背包 / 右键：丢在地上，腾出背包空间</div>`;
}
