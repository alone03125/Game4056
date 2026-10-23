// 奇物增益的运行时效果（第4.1次调整）：沉眠长弓、刺客短刀、圣盾、超级防护服，以及奇物的选择。
// 只作用于本地玩家；攻击倍率类的增益在 RunState.atkBonus / handStats 里计算。
// 第4.3次调整：圣盾触发后的减伤、友谊地久天长的叠层、聚精会神的技巧检定（QTE）。

import { QTE, RELIC, RELIC_IDS, RELIC_WEIGHT, RelicId, RELICS } from '../data/relics';
import { globalRng } from '../util/rng';
import type { World } from './world';

export type QteResult = '' | 'great' | 'good' | 'miss';

/** 聚精会神的一次技巧检定：t < 0 时提示音已经响起、转轮还没出现 */
export interface QteState {
  t: number;
  /** 判定区起点（弧度，从正上方顺时针） */
  start: number;
  res: QteResult;
  resT: number;
  /** 指针停下的角度 */
  ang: number;
}

export class RelicFx {
  /** 沉眠长弓：距离下一箭的时间与当前间隔 */
  bowT: number = RELIC.bowStart;
  bowCd: number = RELIC.bowStart;
  shieldCd = 0;
  /** 圣盾触发后造成的伤害降低的剩余时间（第4.3次调整） */
  weakT = 0;
  /** 等待选择的奇物增益（三选一）；排队的奇物数量 */
  offer: RelicId[] | null = null;
  queue = 0;
  /** 聚精会神：距离下一次技巧检定的时间，当前的检定 */
  qteT = 0;
  qte: QteState | null = null;

  constructor(private w: World) {}

  update(dt: number): void {
    const w = this.w;
    const run = w.run;
    if (this.shieldCd > 0) this.shieldCd -= dt;
    if (this.weakT > 0) this.weakT -= dt;
    if (!this.offer && this.queue > 0) this.makeOffer();
    // 沉眠长弓：只在区域里计时（安全屋里不计时）
    if (run.has('bow') && w.phaseActive() && w.player.standing && !w.arrived && !w.cine) {
      this.bowT -= dt;
      if (this.bowT <= 0) {
        if (this.shoot('xBow')) {
          this.bowCd = Math.max(RELIC.bowMin, this.bowCd - RELIC.bowStep);
          this.bowT = this.bowCd;
        } else this.bowT = 0;
      }
    }
    if (run.has('focus')) this.updateQte(dt);
  }

  /** 造成伤害的倍率（圣盾触发后 5 秒内 -30%） */
  dmgMul(): number {
    return this.weakT > 0 ? RELIC.shieldWeak : 1;
  }

  /** 刺客短刀：副手每射出一发子弹，向最近的敌人掷出一把短刀 */
  onOffhandShot(): void {
    if (this.w.run.has('knife')) this.shoot('xKnife');
  }

  /** 向最近的敌人射出奇物的投射物；没有目标时返回 false */
  private shoot(id: 'xBow' | 'xKnife'): boolean {
    const w = this.w;
    const p = w.player;
    const t = w.enemies.nearest(p.x, p.y, RELIC.aimRange);
    if (!t) return false;
    const a = Math.atan2(t.y - p.y, t.x - p.x);
    w.projs.fireSpecial(id, p.x + Math.cos(a) * 0.6, p.y + Math.sin(a) * 0.6, a, t);
    w.fx.sound(id === 'xBow' ? 'zap' : 'ricochet', p.x, p.y, id === 'xBow' ? 0.5 : 0.25);
    return true;
  }

  /** 圣盾：受到伤害时有 50% 的概率免疫（触发后 5 秒内不会再次触发，并且造成的伤害 -30%） */
  blocks(): boolean {
    const w = this.w;
    if (!w.run.has('shield') || this.shieldCd > 0 || !globalRng.chance(RELIC.shieldChance)) return false;
    this.shieldCd = RELIC.shieldCd;
    this.weakT = RELIC.shieldWeakT;
    w.fx.floatText(w.player.x, w.player.y, '圣盾', '#fff2a0');
    w.fx.sound('buff', w.player.x, w.player.y, 0.6);
    w.fx.sparks(w.player.x, w.player.y, 0xfff2a0, 14, 4);
    return true;
  }

  /** 超级防护服：受到的辐射倍率（有存活的队友时减免更多） */
  radMul(): number {
    if (!this.w.run.has('suit')) return 1;
    return this.teammateAlive() ? RELIC.suitTeam : RELIC.suitSolo;
  }

  teammateAlive(): boolean {
    const net = this.w.net;
    if (!net) return false;
    for (const r of net.remotes()) if (!r.dead) return true;
    return false;
  }

  /** 友谊地久天长：拉起了一名队友 */
  onRevive(): void {
    const w = this.w;
    const run = w.run;
    if (!run.has('friend') || run.friendN >= RELIC.friendMax) return;
    run.friendN++;
    w.fx.floatText(w.player.x, w.player.y, `友谊 ×${run.friendN}`, RELICS.friend.color);
    w.fx.sound('buff', w.player.x, w.player.y, 0.6);
  }

  // —— 聚精会神：技巧检定 ——

  /** 检定只在区域里站着战斗时出现（过场动画、倒地、进入安全屋时取消，不算错过） */
  private qteAllowed(): boolean {
    const w = this.w;
    return w.phaseActive() && w.player.standing && !w.arrived && !w.cine && !this.offer;
  }

  private updateQte(dt: number): void {
    const q = this.qte;
    if (!this.qteAllowed()) {
      if (q && !q.res) this.qte = null;
      if (q?.res) { q.resT += dt; if (q.resT >= QTE.show) this.qte = null; }
      return;
    }
    if (!q) {
      this.qteT -= dt;
      if (this.qteT <= 0) this.startQte();
      return;
    }
    if (q.res) {
      q.resT += dt;
      if (q.resT >= QTE.show) { this.qte = null; this.qteT = globalRng.range(QTE.min, QTE.max); }
      return;
    }
    q.t += dt;
    if (q.t >= 0) {
      q.ang = (q.t / QTE.spin) * Math.PI * 2;
      // 转满一圈也没有按键：错过
      if (q.ang >= Math.PI * 2) { q.ang = Math.PI * 2; this.resolve('miss'); }
    }
  }

  /** 新的检定：先响提示音，片刻后出现转轮 */
  private startQte(): void {
    const start = globalRng.range(QTE.safe, Math.PI * 2 - QTE.width - 0.15);
    this.qte = { t: -QTE.lead, start, res: '', resT: 0, ang: 0 };
    this.w.fx.sound('qteAlert');
  }

  /** 按下特殊交互键；返回是否用掉了这次按键 */
  qtePress(): boolean {
    const q = this.qte;
    if (!q || q.res || q.t < 0) return false;
    const a = q.ang;
    if (a >= q.start && a < q.start + QTE.great) this.resolve('great');
    else if (a >= q.start && a <= q.start + QTE.width) this.resolve('good');
    else this.resolve('miss');
    return true;
  }

  private resolve(r: QteResult): void {
    const w = this.w;
    const run = w.run;
    const q = this.qte;
    if (!q) return;
    q.res = r;
    q.resT = 0;
    const before = run.focusTokens;
    // 第4.3次调整（续）：普通判定 +1 枚（最多叠到 6 枚）；完美判定 +1 枚，不受数量上限的限制；错过清空
    if (r === 'great') run.focusTokens += 1;
    else if (r === 'good') run.focusTokens = Math.max(run.focusTokens, Math.min(RELIC.focusMax, run.focusTokens + 1));
    else run.focusTokens = 0;
    w.fx.sound(r === 'great' ? 'qteGreat' : r === 'good' ? 'qteGood' : 'qteMiss');
    const p = w.player;
    // 代币数量变化时，头顶跳字
    if (run.focusTokens !== before) {
      const d = run.focusTokens - before;
      const color = d > 0 ? RELICS.focus.color : '#ff6a5a';
      w.fx.floatText(p.x, p.y, run.focusTokens === 0 ? '专注代币清空' : `专注 ${d > 0 ? '+' : ''}${d}（${run.focusTokens}）`, color);
    }
  }

  // —— 选择奇物 ——

  /** 有人捡起了奇物：每个玩家都会得到一次三选一 */
  grant(): void {
    if (!this.w.player.alive) return;
    this.queue++;
    if (!this.offer) this.makeOffer();
  }

  /** 可以出现的奇物（没有拥有的；友谊地久天长只在多人游戏中出现） */
  pool(): RelicId[] {
    const run = this.w.run;
    const mp = !!this.w.net;
    return RELIC_IDS.filter((id) => !run.has(id) && (mp || !RELICS[id].mp));
  }

  private makeOffer(): void {
    const pool = this.pool();
    this.queue = Math.max(0, this.queue - 1);
    if (!pool.length) { this.w.fx.toast('你已经拥有全部的奇物增益了', '#ffd24a'); return; }
    // 按权重不放回地抽取 3 个
    const out: RelicId[] = [];
    while (out.length < 3 && pool.length) {
      const id = globalRng.weighted(pool.map((k) => [k, RELIC_WEIGHT[k] ?? 1] as const));
      out.push(id);
      pool.splice(pool.indexOf(id), 1);
    }
    this.offer = out;
    this.w.fx.sound('altar');
  }

  /** 选择了一个增益 */
  choose(id: RelicId): void {
    const w = this.w;
    const run = w.run;
    if (!this.offer || !this.offer.includes(id) || run.has(id)) return;
    this.offer = null;
    run.relics.push(id);
    if (id === 'might') {
      // 天生神力：生命值和上限 +80%
      run.maxHp *= RELIC.mightScale;
      run.hp *= RELIC.mightScale;
      w.player.r = w.player.baseR * RELIC.mightScale;
    }
    if (id === 'bow') { this.bowCd = RELIC.bowStart; this.bowT = RELIC.bowStart; }
    if (id === 'focus') { run.focusTokens = RELIC.focusStart; this.qteT = globalRng.range(QTE.min, QTE.max); }
    w.fx.toast(`获得奇物增益：${RELICS[id].name}`, RELICS[id].color);
    w.fx.sound('buff');
    w.fx.bagFlash();
  }
}
