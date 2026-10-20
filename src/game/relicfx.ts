// 奇物增益的运行时效果（第4.1次调整）：沉眠长弓、刺客短刀、圣盾、超级防护服，以及奇物的选择。
// 只作用于本地玩家；攻击倍率类的增益在 RunState.atkBonus / handStats 里计算。

import { RELIC, RELIC_IDS, RelicId, RELICS } from '../data/relics';
import { globalRng } from '../util/rng';
import type { World } from './world';

export class RelicFx {
  /** 沉眠长弓：距离下一箭的时间与当前间隔 */
  bowT: number = RELIC.bowStart;
  bowCd: number = RELIC.bowStart;
  shieldCd = 0;
  /** 等待选择的奇物增益（三选一）；排队的奇物数量 */
  offer: RelicId[] | null = null;
  queue = 0;

  constructor(private w: World) {}

  update(dt: number): void {
    const w = this.w;
    const run = w.run;
    if (this.shieldCd > 0) this.shieldCd -= dt;
    if (!this.offer && this.queue > 0) this.makeOffer();
    // 沉眠长弓：只在区域里计时（安全屋里不计时）
    if (run.has('bow') && w.phaseActive() && w.player.standing && !w.arrived) {
      this.bowT -= dt;
      if (this.bowT <= 0) {
        if (this.shoot('xBow')) {
          this.bowCd = Math.max(RELIC.bowMin, this.bowCd - RELIC.bowStep);
          this.bowT = this.bowCd;
        } else this.bowT = 0;
      }
    }
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

  /** 圣盾：受到伤害时有 50% 的概率免疫（触发后 5 秒内不会再次触发） */
  blocks(): boolean {
    const w = this.w;
    if (!w.run.has('shield') || this.shieldCd > 0 || !globalRng.chance(RELIC.shieldChance)) return false;
    this.shieldCd = RELIC.shieldCd;
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

  // —— 选择奇物 ——

  /** 有人捡起了奇物：每个玩家都会得到一次三选一 */
  grant(): void {
    if (!this.w.player.alive) return;
    this.queue++;
    if (!this.offer) this.makeOffer();
  }

  private makeOffer(): void {
    const run = this.w.run;
    const pool = RELIC_IDS.filter((id) => !run.has(id));
    this.queue = Math.max(0, this.queue - 1);
    if (!pool.length) { this.w.fx.toast('你已经拥有全部的奇物增益了', '#ffd24a'); return; }
    globalRng.shuffle(pool);
    this.offer = pool.slice(0, 3);
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
      run.hp = Math.min(run.maxHp, run.hp * RELIC.mightScale);
      w.player.r = w.player.baseR * RELIC.mightScale;
    }
    if (id === 'bow') { this.bowCd = RELIC.bowStart; this.bowT = RELIC.bowStart; }
    w.fx.toast(`获得奇物增益：${RELICS[id].name}`, RELICS[id].color);
    w.fx.sound('buff');
    w.fx.bagFlash();
  }
}
