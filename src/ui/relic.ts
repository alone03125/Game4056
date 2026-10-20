// 奇物三选一（第4.1次调整）：有人捡起奇物后，每个玩家各自从三个随机增益中选择一个。
// 选择期间游戏暂停（联机时所有队友一起暂停，与打开背包相同）。

import { RelicId, RELICS } from '../data/relics';
import type { World } from '../game/world';
import { clear, h } from './dom';
import { relicIcon } from './icons';

export class RelicView {
  root: HTMLDivElement;
  private sig = '';

  constructor(parent: HTMLElement, private onPick: (id: RelicId) => void) {
    this.root = h('div', { class: 'relic-wrap hidden' });
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** 每帧调用：有待选择的奇物时显示 */
  update(w: World | null, allowed: boolean): void {
    const offer = w && allowed && w.player.alive ? w.relicFx.offer : null;
    const sig = offer ? offer.join(',') : '';
    if (sig === this.sig) return;
    this.sig = sig;
    this.root.classList.toggle('hidden', !offer);
    clear(this.root);
    if (!offer) return;
    const cards = h('div', { class: 'relic-cards' });
    offer.forEach((id, i) => {
      const d = RELICS[id];
      cards.appendChild(h('div', { class: 'relic-card', style: `border-color:${d.color}88`, onclick: () => this.onPick(id) },
        h('img', { src: relicIcon(id), draggable: 'false' }),
        h('h4', { style: `color:${d.color}` }, d.name),
        h('p', null, d.desc),
        h('div', { class: 'key' }, `按 ${i + 1} 选择`)));
    });
    this.root.appendChild(h('div', { class: 'relic-panel' },
      h('h2', null, '奇物'),
      h('div', { class: 'sub' }, `选择一个增益，它对你拿着的所有枪都会生效${w!.net ? '（队友各自选择自己的增益）' : ''}`),
      cards));
  }

  /** 数字键 1~3 选择 */
  pickIndex(w: World, i: number): boolean {
    const offer = w.relicFx.offer;
    if (!this.open || !offer || !offer[i]) return false;
    this.onPick(offer[i]);
    return true;
  }
}
