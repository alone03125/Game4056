// 规则测试：第3次调整（枪械修饰语、参数硬下限、道具前缀、Rarity5、金币公式）与第4次调整（盲盒、玉米粒、苦力怕、奇点吸引投掷物、安全屋试枪、拉起无敌），
// 以及第4.1次调整（权重、新模块、全局强化零件1型、招财弹、临时整备区、区域任务、奇物宝箱与奇物、联机本地判定碰撞伤害）；
// 第4.2次调整更新了权重、盲盒、模块的攻击倍率与瘴气的完成比例，删除了熔炼模块；
// 第4.3次调整：追踪模块与环形弹幕、增幅模块的散射、奇物的削弱与新奇物、曼巴僵尸的耐久战、区域倍率与宝箱生命；
// v4.3.5：防护服的属性补正、聚精会神的叠层、伤害跳字、子弹的攻击力与范围、苦力怕倒计时中的移速、友伤跳字；
// v4.3.6：丧尸被杀死时掉落地图道具（概率逐次减半，联机时每人各拿一次）；
// v4.3.7：Boss 转阶段的伤害减免与分界线截断、Boss 生命、奇点弹的范围、耐久战时长、Boss 战的音频文件音效、结算标题的判定。
// 用法：npx esbuild tools/modtest.ts --bundle --platform=node --outfile=tools/.modtest.cjs && node tools/.modtest.cjs
import { RunState } from '../src/game/state';
import { World } from '../src/game/world';
import { nullFx, VO } from '../src/game/fx';
import { BULLETS, BULLET_IDS, BulletId, makeBullet, RARE_BULLETS } from '../src/data/bullets';
import { castOnce, GUN_MODS, gunStats, makeFixedGun, makeGun, rollRarity } from '../src/data/guns';
import { altarBuy, altarValue, buyBullet, buyGun } from '../src/game/shop';
import { bulletToSlot, moveItem } from '../src/game/inventory';
import { QUEST, QUEST_IDS, questOrder, QuestId } from '../src/game/quest';
import { Coop } from '../src/net/coop';
import { isNormalZombie, MAP_DROP } from '../src/game/enemies';
import { MemHub } from '../src/net/transport';
import { itemValue, makeConsumable, rollGrade } from '../src/data/items';
import { BOSS, CHEST_HP, COOP_HP_MUL, CREEPER, DIFFICULTY, enhanceCoef, MAMBA, PLAYER, ZONES } from '../src/config';
import { Boss, BOSS_SHIELD, releaseVoice } from '../src/game/boss';
import { Mamba, MAMBA_CINE } from '../src/game/mamba';
import { QTE, RELIC, RELIC_IDS } from '../src/data/relics';
import { CORE_PURIFY, suitBoost } from '../src/game/world';
import { dmgText } from '../src/render/overlay';
import type { Fx } from '../src/game/fx';
import { Rng } from '../src/util/rng';

let fails = 0;
const check = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };
const ev = { zoneBuilt() {}, enterSafehouse() {}, leaveSafehouse() {}, bossStart() {}, death() {}, victory() {}, doorChanged() {} };

function freshWorld() {
  const run = new RunState(7, 'normal');
  const w = new World(run, nullFx, { damageNumbers: false }, ev);
  w.start();
  w.enemies.clearAll();
  return w;
}

// 1. 凶险：子弹朝反方向射出
{
  const w = freshWorld();
  const rng = new Rng(3);
  const g = makeFixedGun('测试', 'T-1', 2, 1, 0.3, 3, 0, 1, rng);
  g.bullets = [makeBullet('std', rng, 1), null, null];
  g.mod = 'sinister';
  w.run.guns = [g, null];
  const p = w.player;
  w.input.aimX = p.x + 10; w.input.aimY = p.y;
  w.input.fire = [true, false];
  for (let i = 0; i < 30 && w.projs.list.length === 0; i++) w.update(1 / 60, true);
  const pr = w.projs.list[0];
  check('凶险：子弹朝身后飞', !!pr && pr.vx < 0, pr ? `vx=${pr.vx.toFixed(1)}` : 'no proj');
  check('凶险：伤害 ×1.44', !!pr && Math.abs(pr.dmg - BULLETS.std.atk * 1.44) < 0.5, pr ? `dmg=${pr.dmg.toFixed(1)}` : '');
}
// 2. 强劲：击退力度随伤害增加；后坐力 ×1.4
{
  const w = freshWorld();
  const rng = new Rng(4);
  const g = makeFixedGun('测试', 'T-1', 2, 2, 0.3, 3, 0, 1, rng);
  g.bullets = [makeBullet('std', rng, 1), null, null];
  g.mod = 'forceful';
  w.run.guns = [g, null];
  w.input.aimX = w.player.x + 10; w.input.aimY = w.player.y;
  w.input.fire = [true, false];
  for (let i = 0; i < 30 && w.projs.list.length === 0; i++) w.update(1 / 60, true);
  const pr = w.projs.list[0];
  check('强劲：子弹带击退', !!pr && pr.kb > 1, pr ? `kb=${pr.kb.toFixed(2)}` : '');
  check('强劲：后坐力倍率 1.4', gunStats(g).recoilMul === 1.4);
}
// 3. 笨重 / 轻盈：装备时影响移速
{
  const w = freshWorld();
  const base = w.player.speed();
  const rng = new Rng(5);
  const g = makeFixedGun('测试', 'T-1', 2, 1, 0.3, 3, 0, 1, rng);
  g.mod = 'light';
  w.run.guns = [g, w.run.guns[1]];
  const fast = w.player.speed();
  g.mod = 'heavy';
  const slow = w.player.speed();
  check('轻盈 +20% 移速', Math.abs(fast / base - 1.2) < 1e-6, `${base.toFixed(2)} → ${fast.toFixed(2)}`);
  check('笨重 -15% 移速', Math.abs(slow / base - 0.85) < 1e-6, `${base.toFixed(2)} → ${slow.toFixed(2)}`);
}
// 4. 硬下限：射击延迟 ≥ 0.05，换弹延迟 ≥ 0.25
{
  const run = new RunState(9, 'normal');
  const rng = new Rng(6);
  const g = makeFixedGun('测试', 'T-1', 2, 1, 0.07, 4, 0, 1, rng);
  g.bullets = [makeBullet('light', rng, 1), makeBullet('light', rng, 1), makeBullet('beam', rng, 1), makeBullet('light', rng, 1)];
  g.mod = 'dangerous';
  g.reload = 0.4;
  run.guns = [g, null];
  for (let i = 0; i < 10; i++) run.addReloadAll(-0.15);
  const st = gunStats(g);
  check('射击延迟下限 0.05s', st.delay === 0.05, `delay=${st.delay}`);
  check('换弹延迟下限 0.25s（强化后）', g.reload === 0.25 && st.reload >= 0.25, `base=${g.reload} eff=${st.reload}`);
}
// 5. 修饰语分布（约 60% 有修饰语，11 种都会出现）
{
  const rng = new Rng(11);
  let withMod = 0;
  const seen = new Set<string>();
  const N = 4000;
  for (let i = 0; i < N; i++) { const g = makeGun(2, rng); if (g.mod) { withMod++; seen.add(g.mod); if (!g.name.startsWith(GUN_MODS[g.mod].name)) check('名字带修饰语', false, g.name); } }
  check('修饰语概率约 60%', Math.abs(withMod / N - 0.6) < 0.03, `${((withMod / N) * 100).toFixed(1)}%`);
  check('11 种修饰语都出现', seen.size === 11, String(seen.size));
}
// 6. 道具前缀：35% 高级、15% 顶级（顶级顶替高级），数值 ×1.25 / ×1.6
{
  const rng = new Rng(12);
  const c = [0, 0, 0];
  const N = 20000;
  for (let i = 0; i < N; i++) c[rollGrade('part1', rng)]++;
  check('顶级约 15%', Math.abs(c[2] / N - 0.15) < 0.01, `${((c[2] / N) * 100).toFixed(1)}%`);
  check('高级约 29.75%（35% × 未出顶级）', Math.abs(c[1] / N - 0.2975) < 0.012, `${((c[1] / N) * 100).toFixed(1)}%`);
  check('非强化道具没有前缀', rollGrade('painkiller', rng) === 0);
  check('零件2型 顶级 = 0.24s', Math.abs(itemValue(makeConsumable('part2', 0, 2)) - 0.24) < 1e-9);
  check('下盘功夫 高级 = 12.5%', Math.abs(itemValue(makeConsumable('kungfu', 0, 1)) - 12.5) < 1e-9);
}
// 7. Rarity5：只在第三 / 四区（3% / 9%）
{
  const rng = new Rng(13);
  const N = 40000;
  for (const z of [1, 2, 3, 4]) {
    let r5 = 0;
    for (let i = 0; i < N; i++) if (rollRarity(rng, ZONES[z - 1].gunRarityW) === 5) r5++;
    const want = [0, 0, 0.03, 0.09][z - 1];
    check(`第${z}区 Rarity5 ≈ ${want * 100}%`, Math.abs(r5 / N - want) < 0.005, `${((r5 / N) * 100).toFixed(2)}%`);
  }
}
// 8. 金币：不再乘区域值，乘强化系数
{
  check('强化系数（辐射 10K）= 1', enhanceCoef(10) === 1);
  check('强化系数（辐射 100K）= 1.5', Math.abs(enhanceCoef(100) - 1.5) < 1e-9);
  const w = freshWorld();
  w.run.rad = 100;
  const e = w.enemies.spawn('office', w.player.x + 3, w.player.y, 0);
  check('社畜丧尸基础金币 15（不乘区域值）', e.gold === 15, String(e.gold));
  const before = w.pickups.coins.length;
  w.enemies.kill(e);
  const coin = w.pickups.coins[before];
  check('击杀掉落 ≈ 15 × 1.5', !!coin && coin.amount >= 20 && coin.amount <= 25, coin ? String(coin.amount) : 'none');
}

// —— 第4次调整 ——
const fireOnce = (w: World, defs: string[], hand = 0) => {
  const rng = new Rng(21);
  const g = makeFixedGun('测试', 'T-1', 2, 1, 0.3, defs.length, 0, 1, rng);
  g.bullets = defs.map((d) => makeBullet(d as any, rng, 1));
  w.run.guns = hand === 0 ? [g, null] : [null, g];
  w.input.aimX = w.player.x + 10; w.input.aimY = w.player.y;
  w.input.fire = [hand === 0, hand === 1];
  for (let i = 0; i < 40 && w.projs.list.length === 0; i++) w.update(1 / 60, true);
  w.input.fire = [false, false];
  return g;
};
// 9. 盲盒：发射时变成别的子弹；装填后射击延迟 +0.12（第4.2次调整）
{
  const kinds = new Set<string>();
  for (let k = 0; k < 40; k++) {
    const w = freshWorld();
    fireOnce(w, ['mystery']);
    for (const p of w.projs.list) kinds.add(p.def.id);
  }
  check('盲盒发射出来的不是盲盒', kinds.size > 5 && !kinds.has('mystery'), [...kinds].slice(0, 8).join(','));
  const rng = new Rng(22);
  const g = makeFixedGun('测试', 'T-1', 2, 1, 0.3, 2, 0, 1, rng);
  const base = gunStats(g);
  g.bullets = [makeBullet('mystery', rng, 1), null];
  const st = gunStats(g);
  check('盲盒：不改变攻击倍率', Math.abs(st.atk - base.atk) < 1e-9, `${base.atk} → ${st.atk}`);
  check('盲盒：射击延迟 +0.12', Math.abs(st.delay - (g.delay + 0.12)) < 1e-9, `${g.delay} → ${st.delay}`);
  check('盲盒不会是闪耀 / 虹彩', !makeBullet('mystery', new Rng(5)).shiny);
}
// 10. 玉米粒：约 12% 变成黄油（攻击 ×7），黄油让附近的丧尸晕眩 6 秒，Boss 免疫
{
  // 直接调用 5000 次发射，统计每发是否变成黄油
  let butter = 0, total = 0;
  let dmgOk = true;
  {
    const w = freshWorld();
    const rng = new Rng(23);
    const g = makeFixedGun('测试', 'T-1', 2, 1, 0.3, 1, 0, 1, rng);
    const corn = makeBullet('corn', rng, 1);
    const st = gunStats(g);
    for (let i = 0; i < 5000; i++) {
      w.projs.clear();
      w.projs.fire(st, corn, w.player.x, w.player.y, 0);
      for (const p of w.projs.list) { total++; if (p.butter) { butter++; if (Math.abs(p.dmg - corn.atk * 7) > 0.5) dmgOk = false; } }
    }
  }
  check('黄油概率约 12%', Math.abs(butter / total - 0.12) < 0.018, `${butter}/${total}`);
  check('黄油攻击力 = 玉米粒 × 7', dmgOk);
  const w = freshWorld();
  const a = w.enemies.spawn('iron', w.player.x + 6, w.player.y, 0);
  const b = w.enemies.spawn('office', w.player.x + 6.8, w.player.y + 0.6, 0);
  const far = w.enemies.spawn('office', w.player.x + 12, w.player.y + 4, 0);
  w.enemies.hash.rebuild(w.enemies.list);
  const proj: any = { def: BULLETS.corn, vx: 1, vy: 0, ghost: false, butter: true, blast: false, kb: 0 };
  w.projs.hitEnemy(proj, a, 10);
  check('黄油：命中目标晕眩 6 秒', Math.abs(a.stunT - 6) < 1e-9, String(a.stunT));
  check('黄油：附近的丧尸也晕眩', b.stunT > 5.9, String(b.stunT));
  check('黄油：远处的丧尸不受影响', far.stunT === 0);
  const x0 = a.x; for (let i = 0; i < 60; i++) w.update(1 / 60, true);
  check('晕眩的丧尸不会移动', Math.abs(a.x - x0) < 0.3, `moved ${(a.x - x0).toFixed(2)}`);
  const boss = w.enemies.spawnBoss(w.player.x, w.player.y + 20);
  w.enemies.applyStun(boss, 6);
  check('Boss 免疫晕眩', boss.stunT === 0);
}
// 11. 苦力怕：靠近触发倒计时，2 秒后爆炸（对丧尸伤害 ×5），金币 17；被打死的金币 34
{
  check('苦力怕在每一区都占 3 点权重、从第一区开始出现', ZONES.every((z) => z.weights.creeper === 3));
  const w = freshWorld();
  (w as any).__god = false;
  w.zoneStarted = false; // 停止刷怪，只测这只苦力怕
  const c = w.enemies.spawn('creeper', w.player.x + 1.5, w.player.y, 0);
  c.hitCd = 99; // 不让它先用接触攻击打人
  const victim = w.enemies.spawn('iron', w.player.x + 2.5, w.player.y + 1, 0);
  victim.hitCd = 99;
  const hp0 = w.run.hp, vhp0 = victim.hp;
  w.update(1 / 60, true);
  check('靠近后开始倒计时', c.fuse > 1.9, String(c.fuse));
  const coins0 = w.pickups.coins.length;
  for (let i = 0; i < 130 && !c.dead; i++) w.update(1 / 60, true);
  check('2 秒后爆炸', c.dead);
  const playerDmg = hp0 - w.run.hp;
  // 普通难度、第一区：34 × 1.0 × 0.8 = 27.2
  check('爆炸伤害玩家 = 34 × 区域伤害 × 难度', Math.abs(playerDmg - 27.2) < 0.1, playerDmg.toFixed(1));
  check('爆炸殃及丧尸（伤害 ×5）', vhp0 - victim.hp > 100 || victim.dead, `${(vhp0 - victim.hp).toFixed(0)}`);
  const coin = w.pickups.coins[coins0];
  check('靠近触发的爆炸掉落约 17 金币', !!coin && coin.amount >= 15 && coin.amount <= 19, coin ? String(coin.amount) : 'none');
  const w2 = freshWorld();
  const c2 = w2.enemies.spawn('creeper', w2.player.x + 9, w2.player.y, 0);
  w2.enemies.damage(c2, 9999, null);
  check('被打死后不会立刻消失，而是开始倒计时', !c2.dead && c2.fuse > 1.9 && c2.fuseKill);
  const k0 = w2.pickups.coins.length;
  for (let i = 0; i < 130 && !c2.dead; i++) w2.update(1 / 60, true);
  const coin2 = w2.pickups.coins[k0];
  check('被打死的苦力怕爆炸后掉落约 34 金币', c2.dead && !!coin2 && coin2.amount >= 30 && coin2.amount <= 38, coin2 ? String(coin2.amount) : 'none');
  check('倒计时中移速降为 2.2（v4.3.5：3.2 再降低约 30%）', CREEPER.fuseSpeed === 2.2);
}
// 12. 奇点会吸引炸弹和丧尸的口水
{
  const w = freshWorld();
  fireOnce(w, ['bomb']);
  const bomb = w.projs.list.find((p) => p.kind === 'bomb')!;
  for (let i = 0; i < 40; i++) w.update(1 / 60, true);
  const bx = bomb.x, by = bomb.y;
  w.projs.hazards.push({ kind: 'vortex', dead: false, x: bx, y: by + 3, r: 6, t: 0, dur: 3, atk: 0, tick: 99, ghost: false, pullOnly: false });
  for (let i = 0; i < 30; i++) w.update(1 / 60, true);
  check('炸弹被奇点吸过去', bomb.y - by > 0.3, `dy=${(bomb.y - by).toFixed(2)}`);
  // 出生点附近 3 米内一定没有障碍物
  w.enemies.shots.push({ x: w.player.x + 2, y: w.player.y - 2, vx: 0.5, vy: 0, dmg: 1, r: 0.2, life: 3, dead: false, kind: 'spit' });
  const sp = w.enemies.shots[w.enemies.shots.length - 1];
  w.projs.hazards.push({ kind: 'vortex', dead: false, x: sp.x, y: sp.y + 3, r: 6, t: 0, dur: 3, atk: 0, tick: 99, ghost: false, pullOnly: false });
  for (let i = 0; i < 10; i++) w.update(1 / 60, true);
  check('口水被奇点吸偏', sp.vy > 0.5, `vy=${sp.vy.toFixed(2)}`);
}
// 13. 安全屋：可以开枪，但不伤害丧尸、不伤自己；拉起后 4 秒无敌
{
  const w = freshWorld();
  w.debugAdvance();
  check('进入安全屋', w.phase === 'safehouse');
  fireOnce(w, ['std']);
  check('安全屋里可以开枪', w.projs.list.length > 0);
  const e = w.enemies.spawn('office', w.player.x + 2, w.player.y, 0);
  check('安全屋里打不伤丧尸', !w.enemies.damage(e, 999, null) && e.hp === e.maxHp);
  const hp = w.run.hp;
  w.friendlyFire(100, w.player.x, w.player.y);
  check('安全屋里不会自伤', w.run.hp === hp);
  const w2 = freshWorld();
  w2.player.downed = true;
  w2.revived('队友');
  check('被拉起后 4 秒无敌', Math.abs(w2.run.invulnT - 4) < 1e-9, String(w2.run.invulnT));
}
// —— 第4.1次调整 ——
const freshGun = (defs: (string | null)[], cap = defs.length, delay = 0.3) => {
  const rng = new Rng(31);
  const g = makeFixedGun('测试', 'T-1', 2, 1, delay, cap, 0, 1, rng);
  g.bullets = defs.map((d) => {
    if (!d) return null;
    const b = makeBullet(d as any, rng, 1);
    b.shiny = false; b.iri = false; b.atk = BULLETS[b.def].atk;
    return b;
  });
  while (g.bullets.length < cap) g.bullets.push(null);
  return g;
};
const pushBag = (w: World, id: string) => { const b = makeBullet(id as BulletId, new Rng(3), 1); w.run.bag.push(b); return b.uid; };
/** 打完一整轮弹匣，返回射出的子弹数（fireOne 的次数）与期间生成的投射物 */
const fireMag = (w: World, g: ReturnType<typeof freshGun>) => {
  w.projs.clear();
  w.run.guns = [g, null];
  w.player.resetHands();
  w.input.aimX = w.player.x + 10; w.input.aimY = w.player.y;
  w.input.fire = [true, false];
  const shots0 = w.run.stats.shotsFired;
  const projs: any[] = [];
  const seen = new Set<any>();
  for (let i = 0; i < 300; i++) {
    w.update(1 / 60, true);
    for (const p of w.projs.list) if (!seen.has(p) && !p.dead) { seen.add(p); projs.push({ dmg: p.dmg, fancy: p.fancy, id: p.def.id }); }
    if (w.player.hands[0].reloading) break;
  }
  w.input.fire = [false, false];
  return { shots: w.run.stats.shotsFired - shots0, projs };
};
// 14. 权重（第4.2次调整）：普通子弹 25、稀有子弹 10，模块 10（闪耀虹彩 / 循环模块 5）；熔炼模块已删除
{
  const bullets = BULLET_IDS.filter((id) => !BULLETS[id].logic);
  const mods = BULLET_IDS.filter((id) => BULLETS[id].logic);
  check('普通子弹权重 25、稀有子弹 10', bullets.every((id) => BULLETS[id].weight === (RARE_BULLETS.includes(id) ? 10 : 25)));
  check('模块权重 10，闪耀虹彩 / 循环模块 5', mods.every((id) => BULLETS[id].weight === (id === 'mShine' || id === 'mLoop' ? 5 : 10)));
  check('第4.1次调整的 7 种逻辑模块（熔炼模块已删除）', ['mShine', 'mLoop', 'mShort', 'mPre', 'mStrip', 'mSplit2', 'mCopy'].every((id) => BULLET_IDS.includes(id as BulletId) && BULLETS[id as BulletId].logic) && !BULLET_IDS.includes('mSmelt' as BulletId));
  check('六种模块附带 -0.20x 攻击倍率', ['mShine', 'mLoop', 'mShort', 'mStrip', 'mSplit2', 'mCopy'].every((id) => BULLETS[id as BulletId].mods.atk === -0.2));
}
// 15. 全局强化零件1型：对之后拿到的枪也生效，最多 +1.60x
{
  const w = freshWorld();
  w.debugAdvance();
  w.run.bank = 1e7;
  for (let i = 0; i < 20; i++) altarBuy(w.run, 'atk', 1);
  check('全局攻击倍率加成最多 +1.60x', Math.abs(w.run.globalAtk - 1.6) < 1e-9, String(w.run.globalAtk));
  check('达到上限后不能再买', !!altarBuy(w.run, 'atk', 1));
  const g = makeGun(3, new Rng(5));
  check('之后拿到的枪也获得加成', Math.abs(w.run.handStats(g).atk - (g.atk + 1.6) * (g.mod ? GUN_MODS[g.mod].dmg ?? 1 : 1)) < 1e-9);
  check('第一区安全屋的数值为 0.10x', altarValue('atk', 1) === 0.1 && altarValue('atk', 4) === 0.2);
}
// 16. 新模块
{
  const w = freshWorld();
  (w as any).__god = true;
  const loop = fireMag(w, freshGun(['mLoop', 'std', 'brass', 'light']));
  check('循环模块：A、B+A、C+A 共射出 5 发', loop.shots === 5, String(loop.shots));
  const copy = fireMag(w, freshGun(['std', 'mCopy']));
  check('复制模块：视为上一发子弹', copy.shots === 2 && copy.projs.every((p) => p.id === 'std'), `${copy.shots}`);
  const st = gunStats(freshGun(['light', 'mCopy']));
  check('复制模块：枪械数值影响再生效一次', Math.abs(st.delay - Math.max(0.05, 0.3 - 0.12)) < 1e-9, st.delay.toFixed(2));
  check('复制模块：自身的 -0.20x 攻击倍率照常生效', Math.abs(st.atk - 0.8) < 1e-9, st.atk.toFixed(2));
  const split = fireMag(w, freshGun(['mSplit2', 'std']));
  check('二重分裂模块：射出 2 枚', split.projs.length === 2, String(split.projs.length));
  const shine = fireMag(w, freshGun(['mShine', 'std']));
  check('闪耀虹彩模块：伤害 ×1.25×1.6（攻击倍率 -0.20x）、带特效', shine.projs.length === 1 && Math.abs(shine.projs[0].dmg - BULLETS.std.atk * 1.25 * 1.6 * 0.8) < 0.5 && shine.projs[0].fancy === 3, shine.projs[0]?.dmg?.toFixed(1));
  const g = freshGun(['mPre', 'std']);
  const pre = gunStats(g);
  check('预行程模块：换弹 -30%、攻击倍率 -0.20x', Math.abs(pre.reload - Math.max(0.25, g.reload * 0.7)) < 1e-9 && Math.abs(pre.atk - 0.8) < 1e-9, `${g.reload} → ${pre.reload}`);
  const strip = freshGun(['std', 'std', null, null, null, null]);
  w.run.guns = [strip, null];
  const uid = pushBag(w, 'mStrip');
  check('拆卸模块：装入后载弹量减半', bulletToSlot(w.run, { from: 'bag', uid }, strip.uid, 2) === null && gunStats(strip).cap === 3);
  check('拆卸模块：射击延迟 -0.25s', gunStats(strip).delay === 0.05);
  check('装满一半后不能再装子弹', !!bulletToSlot(w.run, { from: 'bag', uid: pushBag(w, 'std') }, strip.uid, 3));
  const full = freshGun(['std', 'std', 'std', null, null, null]);
  w.run.guns = [full, null];
  check('已经装了超过一半时无法装入拆卸模块', !!bulletToSlot(w.run, { from: 'bag', uid: pushBag(w, 'mStrip') }, full.uid, 3));
  // 短行程模块：90% 减半 / 10% 变为 4 倍
  let half = 0;
  const hs = w.player.hands[0];
  for (let i = 0; i < 4000; i++) { w.player.startReload(0, hs, 2, 1); if (hs.reloadTotal < 1.5) half++; }
  check('短行程模块：约 90% 换弹时间减半', Math.abs(half / 4000 - 0.9) < 0.02, `${((half / 4000) * 100).toFixed(1)}%`);
}
// 17. 招财弹：被击杀的丧尸必定掉落道具，每区最多 4 次
{
  const w = freshWorld();
  w.zoneStarted = false;
  // 只数招财弹的掉落（v4.3.6 起丧尸还会随机掉落地图道具）
  const items0 = w.pickups.items.filter((i) => !i.dead && !i.map).length;
  for (let i = 0; i < 6; i++) {
    const e = w.enemies.spawn('office', w.player.x + 6 + i, w.player.y + 4, 0);
    w.enemies.damage(e, 1e6, { gold: true });
  }
  const got = w.pickups.items.filter((i) => !i.dead && !i.map).length - items0;
  check('招财弹：每区最多掉落 4 件道具', got === 4, String(got));
}
// 18. 临时整备区：背包满时买的东西进临时整备区，关闭界面 / 离开安全屋时掉在地上
{
  const w = freshWorld();
  w.debugAdvance();
  w.run.bank = 1e6;
  while (w.run.canFit(1)) w.run.bag.push(makeBullet('std', new Rng(1)));
  const shop = w.shop!;
  check('背包满时买子弹进入临时整备区', buyBullet(w.run, shop, 0) === null && w.run.temp.length === 1);
  check('背包满时买枪进入临时整备区', buyGun(w.run, shop, 0) === null && w.run.temp.length === 2);
  const n0 = w.pickups.items.filter((i) => !i.dead).length;
  w.flushTemp();
  check('关闭界面后掉在地上', w.run.temp.length === 0 && w.pickups.items.filter((i) => !i.dead).length === n0 + 2);
  const b = w.run.bag.find((x) => x.kind === 'bullet')!;
  check('物品可以在背包和临时整备区之间移动', moveItem(w.run, b.uid, 'bag', 'temp') === null && w.run.temp.length === 1);
  w.debugAdvance();
  check('离开安全屋时临时整备区清空', w.run.temp.length === 0);
}
// 19. 区域任务
const questWorld = (id: QuestId) => {
  const run = new RunState(7, 'normal');
  const w = new World(run, nullFx, { damageNumbers: false }, ev);
  (w.quests as any).order = [id, id, id, id];
  w.start();
  (w as any).__god = true;
  return w;
};
const tick = (w: World, sec: number, each?: () => void) => { for (let i = 0; i < sec * 60; i++) { each?.(); w.update(1 / 60, true); } };
{
  const order = questOrder(1234);
  check('任务：每局 4 个互不相同的任务', order.length === 4 && new Set(order).size === 4 && order.every((q) => QUEST_IDS.includes(q)));
  check('任务：同一种子结果相同', questOrder(1234).join() === order.join());
  // 发送信号
  const w = questWorld('signal');
  const q = w.quests;
  check('发送信号：信号区域可以到达', w.nav.reachable(q.sig.x, q.sig.y) && !w.col.overlapsCircle(q.sig.x, q.sig.y, 0.5));
  w.player.place(q.sig.x, q.sig.y);
  tick(w, 10, () => w.enemies.clearAll());
  check('发送信号：站在圈里进度增加', Math.abs(q.progress - 10) < 0.2, q.progress.toFixed(2));
  check('发送信号：圈会随进度缩小', q.sig.r < QUEST.signalR - 0.5, q.sig.r.toFixed(2));
  w.player.place(q.sig.x + 20, q.sig.y);
  if (w.col.overlapsCircle(w.player.x, w.player.y, 0.5)) w.player.place(w.layout.startPos.x, w.layout.startPos.y);
  tick(w, 4, () => w.enemies.clearAll());
  check('发送信号：离开后以 75% 的速度回退', Math.abs(q.progress - 7) < 0.3, q.progress.toFixed(2));
  w.player.place(q.sig.x, q.sig.y);
  tick(w, 14, () => w.enemies.clearAll());
  check('发送信号：20 秒后完成', q.done);
  w.debugAdvance(); w.debugAdvance();
  const chest = w.quests.chest();
  check('完成任务后下一区出现奇物宝箱（第二区 2000 生命）', !!chest && chest.maxHp === CHEST_HP[2] && w.layout.index === 2, chest ? String(chest.maxHp) : 'none');
  if (chest) {
    w.enemies.damage(chest, 1e6, null);
    const relic = w.pickups.items.find((i) => !i.dead && i.thing.kind === 'relic');
    check('打破宝箱掉落奇物', !!relic);
    if (relic) {
      w.player.place(relic.x, relic.y);
      tick(w, 0.2, () => w.enemies.clearAll());
      const offer = w.relicFx.offer;
      check('捡起奇物后出现三选一', !!offer && offer.length === 3, offer?.join(','));
      if (offer) { w.relicFx.choose(offer[0]); check('选择后获得增益', w.run.relics.includes(offer[0]) && !w.relicFx.offer); }
    }
  }
  check('宝箱不会被追踪子弹锁定', !w.enemies.nearest(w.player.x, w.player.y, 999, () => false) || w.enemies.nearest(w.player.x, w.player.y, 999)!.type !== 'chest');
}
{
  const w = questWorld('pyre');
  const q = w.quests;
  check('点燃火堆：生成 7 个可燃物堆（作为障碍物）', q.pyres.length === 7 && w.layout.obstacles.filter((o) => o.kind === 'pyre').length === 7);
  check('点燃火堆：都可以到达', q.pyres.every((p) => w.nav.reachable(p.x + 2.2, p.y) || w.nav.reachable(p.x - 2.2, p.y) || w.nav.reachable(p.x, p.y + 2.2) || w.nav.reachable(p.x, p.y - 2.2)));
  // 用真实的子弹打可燃物堆
  const p0 = q.pyres[0];
  let ok = false;
  for (const [dx, dy] of [[-4, 0], [4, 0], [0, -4], [0, 4]]) {
    if (!w.nav.isFree(p0.x + dx, p0.y + dy)) continue;
    w.player.place(p0.x + dx, p0.y + dy);
    const g = freshGun(['std']);
    w.run.guns = [g, null];
    w.player.resetHands();
    w.input.aimX = p0.x; w.input.aimY = p0.y; w.input.fire = [true, false];
    tick(w, 1, () => w.enemies.clearAll());
    w.input.fire = [false, false];
    ok = p0.lit;
    break;
  }
  check('点燃火堆：子弹打中可燃物堆会点燃它', ok);
  for (const p of q.pyres.slice(1, 6)) q.onShot(p.x, p.y, 0.1);
  tick(w, 0.1, () => w.enemies.clearAll());
  check('点燃火堆：点燃 6 个后完成', q.done && q.litCount() === 6);
}
{
  const w = questWorld('cargo');
  const q = w.quests;
  check('运送物资：3 个物资球与 1 个运载点', q.balls.length === 3 && w.nav.reachable(q.drop.x, q.drop.y));
  const b = q.balls[0];
  // 玩家推着球走
  w.player.place(b.x - 1.0, b.y);
  const x0 = b.x;
  w.input.moveX = 1; w.input.moveY = 0;
  tick(w, 0.5, () => w.enemies.clearAll());
  w.input.moveX = 0;
  check('运送物资：碰到物资球会推着它走', Math.abs(b.x - x0) > 0.5 || Math.abs(b.y - q.balls[0].y) > 0, `dx=${(b.x - x0).toFixed(2)}`);
  b.x = q.drop.x - 3; b.y = q.drop.y; b.vx = 6; b.vy = 0;
  tick(w, 1.5, () => w.enemies.clearAll());
  check('运送物资：推进运载点后完成', q.done && b.done);
}
{
  const w = questWorld('miasma');
  const q = w.quests;
  check('清除瘴气：主要道路被污染', !!q.mz && q.mz.total > 500, String(q.mz?.total));
  const c0 = q.mz!.clean;
  const st = w.layout.streets.find((s) => s.x1 - s.x0 >= 6 && s.x1 - s.x0 < 10)!;
  const cx = (st.x0 + st.x1) / 2;
  w.player.place(cx, st.y0 + 10);
  w.input.moveY = 1;
  tick(w, 3, () => w.enemies.clearAll());
  w.input.moveY = 0;
  check('清除瘴气：走过的道路被净化', q.mz!.clean > c0 + 30, String(q.mz!.clean - c0));
  q.mz!.clean = Math.ceil(q.mz!.total * 0.49);
  tick(w, 0.1, () => w.enemies.clearAll());
  check('清除瘴气：单人 49% 时还没完成', !q.done);
  q.mz!.clean = Math.ceil(q.mz!.total * 0.51);
  tick(w, 0.1, () => w.enemies.clearAll());
  check('清除瘴气：单人净化 50% 后完成', q.done);
}
{
  const w = questWorld('mutant');
  const m = w.quests.mutant();
  check('击杀异变体：生成异变体（不是苦力怕）', !!m && m.type !== 'creeper' && m.mutant && !m.recycle);
  if (m) {
    check('异变体：生命 ×24', m.maxHp > 100 * 0.6 * 24 * 0.8 * 0.9, m.maxHp.toFixed(0));
    w.enemies.damage(m, 1e7, null);
    check('击杀异变体后任务完成', w.quests.done);
  }
}
// 20. 奇物
{
  const w = freshWorld();
  const run = w.run;
  const hp0 = run.maxHp, sp0 = w.player.speed();
  w.relicFx.offer = ['might', 'crit', 'bow'];
  w.relicFx.choose('might');
  check('天生神力：生命上限 ×1.8、碰撞范围 ×1.8，移速不变（v4.3.9）', Math.abs(run.maxHp - hp0 * 1.8) < 1e-6 && Math.abs(w.player.speed() - sp0) < 1e-6 && Math.abs(w.player.r - 0.72) < 1e-9);
  check('天生神力：攻击倍率 +0.80x', Math.abs(run.atkBonus() - 0.8) < 1e-9);
  const g = run.guns[0]!;
  const d0 = run.handStats(g, 0).delay;
  run.relics.push('breath');
  check('神息刀：主手射击延迟减半', Math.abs(run.handStats(g, 0).delay - Math.max(0.05, d0 / 2)) < 1e-9 && Math.abs(run.handStats(g, 1).delay - d0) < 1e-9);
  run.relics.push('scepter');
  run.bank = 10000;
  check('王杖：每 100 金币 +0.01x', Math.abs(run.atkBonus() - 0.8 - 1.0) < 1e-9);
  run.bank = 1e6;
  check('王杖：最高 +2.00x', Math.abs(run.atkBonus() - 0.8 - 2.0) < 1e-9);
  run.relics.push('shield');
  let blocked = 0;
  for (let i = 0; i < 4000; i++) { w.relicFx.shieldCd = 0; if (w.relicFx.blocks()) blocked++; }
  check('圣盾：约 50% 免疫', Math.abs(blocked / 4000 - 0.5) < 0.03, String(blocked));
  w.relicFx.shieldCd = 0;
  for (let i = 0; i < 100 && !w.relicFx.blocks(); i++) w.relicFx.shieldCd = 0;
  check('圣盾：5 秒内不会再次触发', !w.relicFx.blocks() && w.relicFx.shieldCd > 4.9);
  check('圣盾：触发后 5 秒内造成的伤害 -30%', Math.abs(w.relicFx.dmgMul() - 0.7) < 1e-9 && w.relicFx.weakT > 4.9);
  w.relicFx.weakT = 0;
  run.relics.push('suit');
  check('超级防护服：单人辐射 -33%', Math.abs(w.relicFx.radMul() - 0.67) < 1e-9);
  const e = w.enemies.spawn('office', w.player.x + 8, w.player.y, 0);
  check('要害一击：直接击杀普通丧尸', isNormalZombie(e) && w.enemies.damage(e, 1, { execute: true }) && e.dead);
  const el = w.enemies.spawn('office', w.player.x + 8, w.player.y + 3, 2);
  const cr = w.enemies.spawn('creeper', w.player.x + 8, w.player.y - 3, 0);
  check('要害一击：精英、苦力怕不会被直接击杀', !isNormalZombie(el) && !isNormalZombie(cr));
  const c = w.enemies.spawn('iron', w.player.x + 9, w.player.y - 3, 0);
  w.enemies.damage(c, 100, { corrode: true });
  const h1 = c.hp;
  w.enemies.damage(c, 100, null);
  check('腐蚀疗法：之后受到的伤害 +25%', Math.abs(h1 - c.hp - 125) < 1e-6, (h1 - c.hp).toFixed(1));
  check('电击 30% / 灼烧 20% / 暴击 3 次才直接击杀', RELIC.shockPct === 0.3 && RELIC.burnPct === 0.2 && RELIC.critKills === 3);
  check('奇物不会重复出现', (() => { w.relicFx.offer = null; w.relicFx.grant(); return !!w.relicFx.offer && w.relicFx.offer.every((id) => !run.has(id)); })());
}
// 21. 联机：碰撞伤害由被打的玩家本地判定，再通知房主
{
  const hub = new MemHub();
  const players = [{ id: 0, name: 'A' }, { id: 1, name: 'B' }];
  const ws: World[] = [], coops: Coop[] = [];
  for (const p of players) {
    const end = hub.add(p.id);
    const coop = new Coop(end, 0, players);
    const w = new World(new RunState(99, 'normal', p.id), nullFx, { damageNumbers: false }, ev, coop);
    coop.attach(w);
    w.start(p.id);
    ws.push(w); coops.push(coop);
  }
  const [host, cli] = ws;
  host.zoneStarted = false;
  host.enemies.clearAll();
  const step = (n: number) => { for (let i = 0; i < n; i++) { hub.update(1 / 60); for (let k = 0; k < 2; k++) { ws[k].update(1 / 60, true); coops[k].tick(1 / 60); } } };
  step(20);
  const e = host.enemies.spawn('office', cli.player.x + 0.6, cli.player.y, 0);
  e.speed = 0;
  const hp0 = cli.run.hp;
  for (let i = 0; i < 150 && cli.run.hp >= hp0; i++) step(1);
  step(3);
  const m = cli.enemies.byId.get(e.id);
  check('联机：远程玩家本地判定被丧尸撞到', cli.run.hp < hp0 && !!m, `${hp0} → ${cli.run.hp.toFixed(1)}`);
  check('联机：房主收到后让那只丧尸进入出手冷却', e.hitCd > 0.9, `hitCd=${e.hitCd.toFixed(2)}`);
  check('联机：房主那边的血量同步', coops[0].remoteList()[0] && Math.abs(coops[0].remoteList()[0].hp - cli.run.hp) < 1);
}
// 22. 第4.3次调整：模块、新奇物与数值
{
  check('环形弹幕 27（v4.3.5：19 × 1.4）/ 感应地雷 180 / 炸弹 160', BULLETS.nova.atk === 27 && BULLETS.mine.atk === 180 && BULLETS.bomb.atk === 160);
  check('区域倍率：第二区 1.2~2.2 … 第六区 3.0~6.0（v4.3.4）', ZONES.map((z) => z.hpMul.join('~')).join(' ') === '0.6~1.6 1.2~2.2 1.8~3.2 2.6~4.5 3~4.5 3~6');
  check('奇物宝箱生命 2000 / 3500 / 6500 / 10000', CHEST_HP.slice(2).join('/') === '2000/3500/6500/10000');
  check('隐秘核心前的净化血清每人 2 支', CORE_PURIFY.perPlayer === 2);
  check('清除瘴气的净化半径缩小 20%', Math.abs(QUEST.miasmaR - 4.2 * 0.8) < 1e-9);
  const w = freshWorld();
  const rng = new Rng(5);
  // 追踪模块对环形弹幕无效
  const g = makeFixedGun('测试', 'T-1', 2, 1, 0.3, 3, 0, 1, rng);
  g.bullets = [makeBullet('mHoming', rng), makeBullet('nova', rng, 1), null];
  w.run.guns = [g, null];
  w.projs.clear();
  w.input.aimX = w.player.x + 10; w.input.aimY = w.player.y;
  w.input.fire = [true, false];
  for (let i = 0; i < 30 && w.projs.list.length === 0; i++) w.update(1 / 60, true);
  w.input.fire = [false, false];
  check('追踪模块：对环形弹幕无效', w.projs.list.length > 0 && w.projs.list.every((p) => !p.homing), String(w.projs.list.length));
  // 增幅模块：散射 +30°
  const g2 = makeFixedGun('测试', 'T-2', 2, 1, 0.3, 3, 0, 1, rng);
  g2.bullets = [makeBullet('mPower', rng), makeBullet('std', rng, 1), null];
  const shots = castOnce(g2, { cursor: 0, loops: [], pendLoop: 0 });
  check('增幅模块：伤害 ×1.6、散射 +30°', shots.length === 1 && shots[0].mods.dmg === 1.6 && shots[0].mods.spread === 30);
  // 新奇物
  const run = w.run;
  check('奇物共 20 种；单人时不会出现友谊地久天长', RELIC_IDS.length === 20 && !w.relicFx.pool().includes('friend'));
  run.relics.push('herb');
  run.hp = run.maxHp * 0.5;
  w.phase = 'safehouse';
  w.useMedkit();
  check('精研百草：医疗箱回复到生命上限的 1.5 倍', Math.abs(run.hp - run.maxHp * 1.5) < 1e-6, `${run.hp}/${run.maxHp}`);
  w.healPlayer(10, true);
  check('精研百草：普通治疗不会扣掉超出上限的生命', Math.abs(run.hp - run.maxHp * 1.5) < 1e-6);
  w.phase = 'explore';
  const a0 = run.atkBonus(), s0 = w.player.speed();
  w.relicFx.offer = ['focus', 'crit', 'bow'];
  w.relicFx.choose('focus');
  check('聚精会神：每枚代币 +5% / +0.15x，普通判定最多 6 枚', RELIC.focusSpeed === 0.05 && RELIC.focusAtk === 0.15 && RELIC.focusMax === 6);
  check('聚精会神：获得时 2 枚代币（攻击倍率 +0.10x、移速 +4%）', run.focusTokens === 2 && Math.abs(run.atkBonus() - a0 - 0.1) < 1e-9 && Math.abs(w.player.speed() / s0 - 1.04) < 1e-9);
  run.focusTokens = 0;
  check('聚精会神：没有代币时 -0.20x、-6%', Math.abs(run.atkBonus() - a0 + 0.2) < 1e-9 && Math.abs(w.player.speed() / s0 - 0.94) < 1e-9);
  run.focusTokens = 2;
  w.relicFx.qteT = 0;
  w.update(1 / 60, true);
  const q = w.relicFx.qte;
  check('聚精会神：出现技巧检定，判定区不在最开始的 120°', !!q && q.start >= (120 * Math.PI) / 180);
  check('聚精会神：间隔 6~22 秒、转一圈 1.5 秒、完美区 18°', QTE.max === 22 && QTE.spin === 1.5 && Math.abs(QTE.great - (18 * Math.PI) / 180) < 1e-9);
  if (q) {
    for (let i = 0; i < 300 && q.ang < q.start + 0.02; i++) w.update(1 / 120, true);
    w.relicFx.qtePress();
    check('聚精会神：完美判定 +1 枚代币', q.res === 'great' && run.focusTokens === 3, `${q.res} ${run.focusTokens}`);
    // 普通判定 +1（最多 6 枚），完美判定不受上限限制
    const rf = w.relicFx as any;
    run.focusTokens = 5;
    rf.qte = { ...q, res: null, resT: 0 };
    rf.resolve('good'); const n1 = run.focusTokens;
    rf.resolve('good'); const n2 = run.focusTokens;
    rf.resolve('great'); const n3 = run.focusTokens;
    rf.resolve('good'); const n4 = run.focusTokens;
    check('聚精会神：普通判定 +1 枚（最多 6 枚），完美判定可以超过 6 枚', n1 === 6 && n2 === 6 && n3 === 7 && n4 === 7, `${n1} ${n2} ${n3} ${n4}`);
    run.focusTokens = 3;
    w.relicFx.qte = null;
    w.relicFx.qteT = 0;
    w.update(1 / 60, true);
    const q2 = w.relicFx.qte!;
    for (let i = 0; i < 400 && w.relicFx.qte === q2 && !q2.res; i++) w.update(1 / 60, true);
    check('聚精会神：没有按键就是错过，代币清空', q2.res === 'miss' && run.focusTokens === 0, `${q2.res} ${run.focusTokens}`);
  }
}
// 23. 第4.3次调整：曼巴僵尸倒下后爬起，进入 36 秒的耐久战
{
  const w = freshWorld();
  (w as any).__god = true;
  w.zoneStarted = false;
  const e = w.enemies.spawnBoss(w.player.x, w.player.y + 24, 'mamba');
  const mb = new Mamba(w, e);
  w.boss = mb;
  w.bossEnemy = e;
  // v4.3.7：一次伤害不会越过阶段分界线，先把生命压到最后一条分界线以下
  e.hp = e.maxHp * 0.1;
  w.enemies.damage(e, e.maxHp * 2, null);
  check('曼巴僵尸：生命归零时没有死亡，而是倒地并开始过场动画', !e.dead && mb.state === 'down' && !!w.cine);
  check('曼巴僵尸：过场动画中免疫伤害', !w.enemies.damage(e, 100, null) && e.hp === 0);
  for (let i = 0; i < Math.ceil((MAMBA_CINE.total + 0.5) * 60); i++) w.update(1 / 60, true);
  check('过场动画结束：进入耐久战，生命条重新填满', mb.final && !w.cine && e.hp > e.maxHp * 0.9, `${mb.state} ${(e.hp / e.maxHp).toFixed(2)}`);
  const hp1 = e.hp;
  w.enemies.damage(e, 1e7, null);
  check('耐久战：免疫一切伤害', !e.dead && e.hp === hp1);
  w.run.rad = 999;
  const php = w.run.hp;
  for (let i = 0; i < 60; i++) w.update(1 / 60, true);
  check('耐久战：辐射值照常上升，但不会扣血', w.run.hp === php && w.run.rad > 999, `${php} → ${w.run.hp}`);
  for (let i = 0; i < MAMBA_CINE.finalTime * 60 + 60 && w.phase !== 'victory'; i++) w.update(1 / 60, true);
  check('坚持到计时结束：胜利', w.phase === 'victory');
}
/** 两名玩家用内存中转联机（第4.3次调整的测试用） */
function pair(n = 2) {
  const hub = new MemHub();
  const players = Array.from({ length: n }, (_, i) => ({ id: i, name: 'P' + i }));
  const ws: World[] = [], coops: Coop[] = [];
  for (const p of players) {
    const end = hub.add(p.id);
    const coop = new Coop(end, 0, players);
    const w = new World(new RunState(77, 'normal', p.id), nullFx, { damageNumbers: false }, ev, coop);
    coop.attach(w);
    w.start(p.id);
    (w as any).__god = true;
    ws.push(w); coops.push(coop);
  }
  const step = (k: number) => { for (let i = 0; i < k; i++) { hub.update(1 / 60); for (let j = 0; j < ws.length; j++) { ws[j].run.invulnT = 99; ws[j].update(1 / 60, true); coops[j].tick(1 / 60); } } };
  return { ws, coops, step };
}

// 24. 第4.3次调整：联机时地图道具每名玩家都可以各拿一次；丧尸掉落、丢下的物品仍然只能被一个人拿走
{
  const { ws, step } = pair();
  const [host, cli] = ws;
  host.zoneStarted = false;
  host.enemies.clearAll();
  step(30);
  const mapItems = (w: World) => w.pickups.items.filter((it) => !it.dead && it.map);
  check('两名玩家各有同样的 15 个地图道具', mapItems(host).length === 15 && mapItems(cli).length === 15
    && mapItems(host).every((it) => { const c = cli.pickups.find(it.uid); return !!c && c.thing.kind === it.thing.kind; }));
  const it0 = mapItems(host)[0];
  const hFound = host.run.stats.itemsFound, cFound = cli.run.stats.itemsFound;
  host.pickups.tryPickup(it0);
  step(30);
  check('房主拿走地图道具后，队友那里的这件道具还在', host.pickups.find(it0.uid) === null && !!cli.pickups.find(it0.uid));
  const c0 = cli.pickups.find(it0.uid)!;
  cli.pickups.tryPickup(c0);
  check('队友在本地直接拿到同一件地图道具（不需要房主同意）', c0.dead && c0.pending <= 0);
  step(30);
  check('两人都拿到了这件道具', host.run.stats.itemsFound === hFound + 1 && cli.run.stats.itemsFound === cFound + 1, `${host.run.stats.itemsFound - hFound} / ${cli.run.stats.itemsFound - cFound}`);
  // 丢下的物品：只能被一个人拿走
  const rng = new Rng(9);
  const dropped = host.pickups.dropThing(makeBullet('std', rng, 1), host.player.x + 40, host.player.y, true);
  step(30);
  const dc = cli.pickups.find(dropped.uid);
  check('丢下的物品会同步给队友', !!dc && !dc.map);
  if (dc) cli.pickups.tryPickup(dc);
  step(30);
  check('丢下的物品被队友拿走后，房主那里也消失', host.pickups.find(dropped.uid) === null && cli.pickups.find(dropped.uid) === null);
}
// 25. 第4.3次调整：联机时金币也从全图吸取；丧尸的人数生命倍率 2 人 ×1.2、3 人 ×1.4、4 人 ×1.6
{
  check('联机丧尸生命倍率 1.2 / 1.4 / 1.6', COOP_HP_MUL.slice(2).join('/') === '1.2/1.4/1.6');
  const { ws, step } = pair();
  const cli = ws[1];
  check('联机时金币的吸取范围是全图', cli.goldMagnet() === Infinity);
  const g0 = cli.run.gold;
  cli.pickups.dropGold(cli.player.x + 60, cli.player.y, 10);
  step(300);
  check('60 米外的金币也会飞到身上', cli.run.gold === g0 + 10, `${g0} → ${cli.run.gold}`);
}
// 26. 联机：曼巴僵尸的过场动画与耐久战同步
{
  const { ws, coops, step } = pair();
  const [host, cli] = ws;
  host.zoneStarted = false;
  host.enemies.clearAll();
  step(20);
  const e = host.enemies.spawnBoss(host.player.x, host.player.y + 24, 'mamba');
  // 镜像端按第六区的曼巴创建（测试里直接设置）
  (host.layout as any).index = 6; (cli.layout as any).index = 6;
  host.bossEnemy = e; host.boss = new Mamba(host, e);
  step(30);
  check('镜像端出现曼巴', !!cli.boss && cli.boss.kind === 'mamba');
  e.hp = e.maxHp * 0.1;
  host.enemies.damage(e, e.maxHp * 2, null);
  step(10);
  check('其他玩家也开始了过场动画', !!host.cine && !!cli.cine);
  step(Math.ceil(6.6 * 60));
  check('过场动画结束后双方都进入耐久战', !!host.boss?.final && !!cli.boss?.final && !host.cine && !cli.cine);
  const ce = cli.bossEnemy!;
  check('镜像端的计时条与房主一致', Math.abs(ce.hp / ce.maxHp - e.hp / e.maxHp) < 0.05, `${(ce.hp / ce.maxHp).toFixed(3)} / ${(e.hp / e.maxHp).toFixed(3)}`);
  const hp0 = ce.hp;
  cli.enemies.damage(ce, 1e6, null);
  check('镜像端也免疫伤害', ce.hp === hp0 && !ce.dead);
  cli.run.rad = 999; const h = cli.run.hp; cli.run.invulnT = 0;
  for (let i = 0; i < 60; i++) { cli.update(1 / 60, true); }
  check('镜像端辐射不扣血', cli.run.hp === h);
  step((MAMBA_CINE.finalTime + 1) * 60);
  check('计时结束：双方胜利', host.phase === 'victory' && cli.phase === 'victory', `${host.phase} ${cli.phase}`);
  void coops;
}
// 27. v4.3.5：防护服的属性补正、伤害跳字、子弹的攻击力与范围、友伤跳字
{
  // 防护服的属性补正
  const eq = (b: { hp: number; speed: number }, hp: number, sp: number) => Math.abs(b.hp - hp) < 1e-6 && Math.abs(b.speed - sp) < 1e-6;
  check('II 级：生命上限与移速分别补到 140 / 4.5', eq(suitBoost(2, 100, 4.0), 40, 0.5) && eq(suitBoost(2, 150, 4.2), 0, 0.3) && eq(suitBoost(2, 150, 4.6), 0, 0));
  check('III 级：两项都不足时补到 180 / 5.0', eq(suitBoost(3, 170, 4.8), 10, 0.2) && eq(suitBoost(3, 140, 4.5), 40, 0.5));
  check('III 级：只有一项不足时固定 +15 / +0.2；都不缺时没有补正', eq(suitBoost(3, 170, 5.2), 15, 0.2) && eq(suitBoost(3, 200, 4.9), 15, 0.2) && eq(suitBoost(3, 190, 5.2), 0, 0));
  check('IV 级：220 / 5.7；V 级没有补正', eq(suitBoost(4, 200, 6), 20, 0) && eq(suitBoost(4, 230, 5.0), 0, 0.7) && eq(suitBoost(5, 100, 4), 0, 0));
  const w = freshWorld();
  const floats: string[] = [];
  w.fx = { ...nullFx, floatText: (_x: number, _y: number, s: string) => { floats.push(s); } } as Fx;
  w.phase = 'safehouse';
  w.safehouseZone = 1;
  const run = w.run;
  run.hp = 80;
  w.takeSuit();
  w.phase = 'explore';
  check('换上 II 级防护服：生命上限 100 → 140、基础移速 4.0 → 4.5', run.suit === 2 && run.maxHp === 140 && run.hp === 120 && Math.abs(run.baseSpeed() - 4.5) < 1e-9, `${run.maxHp} ${run.hp} ${run.baseSpeed()}`);
  check('先弹出防护服，增幅还没弹出', floats.join('|') === 'II 级防护服');
  for (let i = 0; i < 60; i++) w.update(1 / 60, true);
  check('之后依次弹出生命上限与移动速度的增幅', floats.join('|') === 'II 级防护服|生命上限 +40|移动速度 +0.5', floats.join('|'));
  w.safehouseZone = 2;
  run.speedPct = (5.2 / PLAYER.speed - 1) * 100;
  floats.length = 0;
  w.phase = 'safehouse';
  w.takeSuit();
  w.phase = 'explore';
  for (let i = 0; i < 60; i++) w.update(1 / 60, true);
  check('换上 III 级防护服：只有生命上限不足，固定 +15 / +0.2', run.maxHp === 155 && Math.abs(run.baseSpeed() - 5.4) < 1e-9 && floats.join('|') === 'III 级防护服|生命上限 +15|移动速度 +0.2', floats.join('|'));
  // 伤害跳字
  check('伤害跳字：不足 1000 显示 1 位小数', dmgText(12.34) === '12.3' && dmgText(7) === '7.0' && dmgText(999.94) === '999.9');
  check('伤害跳字：1000 以上写成带千位分隔符的整数', dmgText(999.96) === '1,000' && dmgText(1234.4) === '1,234' && dmgText(1234567) === '1,234,567');
  // 子弹
  const OLD_ATK: Record<string, number> = {
    std: 60, brass: 45, lead: 120, tri: 24, buck: 20, ricochet: 48, homing: 42, fire: 33, cryo: 33, chain: 54, split: 62,
    saw: 22, boomer: 54, light: 22, sniper: 190, nova: 19, beam: 23, leech: 38, gold: 33, jet: 4, corn: 22,
  };
  // v4.3.7：奇点弹的大小改回 7（不再 -40%）
  const OLD_AOE: Record<string, [number, number, number?]> = { bomb: [160, 9], rocket: [240, 7], mine: [180, 8], toxic: [18, 7], singular: [13, 7, 1] };
  const bad = Object.entries(OLD_ATK).filter(([id, a]) => Math.abs(BULLETS[id as BulletId].atk / a - 1.4) > (a < 10 ? 0.15 : 0.03));
  check('没有范围伤害的子弹攻击力约 +40%', bad.length === 0, bad.map(([id]) => id).join(','));
  const bad2 = Object.entries(OLD_AOE).filter(([id, [a, r, k]]) => BULLETS[id as BulletId].atk !== a || Math.abs(BULLETS[id as BulletId].rng - r * (k ?? 0.6)) > 1e-9);
  check('有范围伤害的子弹攻击力不变、基础大小 -40%（奇点弹 v4.3.7 改回 7）', bad2.length === 0, bad2.map(([id]) => id).join(','));
  const plain = BULLET_IDS.filter((id) => !BULLETS[id].logic && !BULLETS[id].flags?.mystery);
  check('所有子弹都在上面两张表里', plain.every((id) => id in OLD_ATK || id in OLD_AOE), plain.filter((id) => !(id in OLD_ATK || id in OLD_AOE)).join(','));
  // 联机：友伤在队友那边显示红色跳字
  const { ws, step } = pair();
  const [host, cli] = ws;
  const nums: [number, string][] = [];
  host.fx = { ...nullFx, damageNumber: (_x: number, _y: number, a: number, c: string) => { nums.push([a, c]); } } as Fx;
  step(10);
  (cli as any).__god = false;
  cli.run.invulnT = 0;
  cli.friendlyFire(200, cli.player.x + 1, cli.player.y);
  (cli as any).__god = true;
  step(10);
  check('联机：队友受到友伤时，在他身上显示红色跳字', nums.some(([a, c]) => Math.abs(a - 10) < 0.05 && c === '#ff4a4a'), JSON.stringify(nums));
}
// 28. v4.3.6：丧尸被杀死时掉落地图道具，本区每掉落一次概率减半；联机时每人各拿一次
{
  check('掉落概率 2%，每次掉落后减半', MAP_DROP.chance === 0.02 && MAP_DROP.decay === 0.5);
  const w = freshWorld();
  check('区域开始时概率为 2%', w.enemies.mapDropP === 0.02);
  w.enemies.mapDropP = 1;
  const n0 = w.pickups.items.length;
  const z = w.enemies.spawn('office', w.player.x + 6, w.player.y, 0);
  w.enemies.damage(z, 1e6, null);
  const got = w.pickups.items.slice(n0);
  check('丧尸被杀死时掉落一件地图道具', got.length === 1 && !!got[0].map && got[0].auto, String(got.length));
  check('掉落后本区的概率减半', w.enemies.mapDropP === 0.5);
  w.enemies.mapDropP = 1;
  const c = w.enemies.spawn('creeper', w.player.x + 8, w.player.y, 0);
  w.enemies.damage(c, 1e6, null);
  for (let i = 0; i < 150 && !c.dead; i++) w.update(1 / 60, true);
  check('苦力怕爆炸后也会掉落', c.dead && w.enemies.mapDropP === 0.5 && w.pickups.items.filter((it) => it.map && !it.dead).length >= 1);
  // 统计：本区掉落概率逐次减半，杀很多丧尸也只会掉落少数几件
  const w2 = freshWorld();
  const m0 = w2.pickups.items.length;
  for (let i = 0; i < 3000; i++) { const o = w2.enemies.spawn('office', w2.player.x + 30, w2.player.y, 0); w2.enemies.damage(o, 1e6, null); }
  const drops = w2.pickups.items.length - m0;
  check('连杀 3000 只：掉落次数与概率相符（每次掉落后减半）', drops >= 2 && drops <= 9 && Math.abs(w2.enemies.mapDropP - 0.02 * 0.5 ** drops) < 1e-12, `${drops} 件，当前概率 ${(w2.enemies.mapDropP * 100).toFixed(3)}%`);
  w2.enemies.reset();
  check('换区后概率恢复为 2%', w2.enemies.mapDropP === 0.02);
  // 联机：每名玩家都可以各拿一次
  const { ws, step } = pair();
  const [host, cli] = ws;
  host.zoneStarted = false;
  host.enemies.clearAll();
  step(10);
  host.enemies.mapDropP = 1;
  const h0 = host.pickups.items.length, c0 = cli.pickups.items.length;
  const hz = host.enemies.spawn('office', host.player.x + 5, host.player.y, 0);
  host.enemies.damage(hz, 1e6, null);
  step(10);
  const hi = host.pickups.items.slice(h0).find((it) => it.map);
  const ci = hi && cli.pickups.find(hi.uid);
  check('联机：队友那里也出现这件地图道具', !!hi && !!ci && !!ci.map && cli.pickups.items.length === c0 + 1);
  check('联机：其他玩家的掉落概率由房主结算', host.enemies.mapDropP === 0.5);
  if (hi && ci) {
    const hf = host.run.stats.itemsFound, cf = cli.run.stats.itemsFound;
    host.pickups.tryPickup(hi);
    step(20);
    check('房主拿走后，队友那里的这件道具还在', !!cli.pickups.find(hi.uid) && !host.pickups.find(hi.uid));
    cli.pickups.tryPickup(ci);
    step(20);
    check('两人都拿到了这件掉落的道具', host.run.stats.itemsFound === hf + 1 && cli.run.stats.itemsFound === cf + 1, `${host.run.stats.itemsFound - hf} / ${cli.run.stats.itemsFound - cf}`);
  }
}
// 29. v4.3.7：Boss 转阶段的伤害减免、Boss 生命、奇点弹、耐久战时长、音频文件音效、结算标题
{
  check('转阶段减伤 80%，每秒 -4%', BOSS_SHIELD.max === 0.8 && BOSS_SHIELD.decay === 0.04);
  check('普通难度：牢大每阶段 24000、曼巴 240000', BOSS.hpPerPhase * DIFFICULTY.normal.hp === 24000 && MAMBA.hp * DIFFICULTY.normal.hp === 240000);
  check('奇点弹的大小改回 7', BULLETS.singular.rng === 7);
  check('耐久战 50 秒（v4.3.10）：曼巴在 10 号音乐的 56.2 秒倒下，音乐照常播完', MAMBA_CINE.finalTime === 50 && Math.abs(MAMBA_CINE.total + MAMBA_CINE.finalTime - 56.2) < 1e-9);
  const voices: string[] = [];
  const spy = () => ({ ...nullFx, voice: (ids: number[], d = 0) => { voices.push(ids.join(',') + (d ? '@' + d : '')); } }) as Fx;
  // 牢大
  const w = freshWorld();
  (w as any).__god = true;
  w.zoneStarted = false;
  w.fx = spy();
  const e = w.enemies.spawnBoss(w.player.x, w.player.y + 24, 'laoda');
  check('单人普通难度：牢大总生命 96000', e.maxHp === 96000, String(e.maxHp));
  const lb = new Boss(w, e);
  w.boss = lb; w.bossEnemy = e;
  w.enemies.damage(e, 1e7, null);
  check('一次伤害停在 3/4 分界线下 1 点，减伤补满 80%', Math.abs(e.hp - (e.maxHp * 0.75 - 1)) < 1e-6 && lb.shield.dr === 0.8, `${e.hp} ${lb.shield.dr}`);
  const h1 = e.hp;
  w.enemies.damage(e, 1000, null);
  check('减伤期间受到的伤害 -80%', Math.abs(h1 - e.hp - 200) < 1e-6, (h1 - e.hp).toFixed(2));
  for (let i = 0; i < 300; i++) w.update(1 / 60, true);
  check('5 秒后减伤降到约 60%', Math.abs(lb.shield.dr - 0.6) < 0.01, lb.shield.dr.toFixed(3));
  check('召唤精英时播放 5 号音效', voices.includes(String(VO.teammates)), voices.join(' '));
  voices.length = 0;
  w.enemies.damage(e, 1e7, null);
  check('减伤期间再次转阶段（半血狂暴）：重新补满 80%，播放 9 号音效', lb.enraged && lb.shield.dr === 0.8 && Math.abs(e.hp - (e.maxHp * 0.5 - 1)) < 1e-6 && voices.includes(String(VO.cantWrite)), voices.join(' '));
  for (let i = 0; i < 21 * 60; i++) { lb.shield.tick(1 / 60); }
  check('20 秒后减伤消退为 0', lb.shield.dr === 0);
  const h2 = e.hp;
  w.enemies.damage(e, 1000, null);
  check('减伤消退后受到全额伤害', Math.abs(h2 - e.hp - 1000) < 1e-6);
  // 冲刺释放时播放 4 号音效（蓄力时不播放）
  voices.length = 0;
  (lb as any).set('windElbow');
  lb.telegraphs.push({ kind: 'line', x: e.x, y: e.y, a: 0, len: 17, r: 1.5, t: 0, dur: 1, dead: false });
  w.update(1 / 60, true);
  const windV = voices.length;
  for (let i = 0; i < 90 && lb.state !== 'dash'; i++) w.update(1 / 60, true);
  check('牢大：冲刺释放时播放 4 号音效（或依次 2、8 号），蓄力时不播放', windV === 0 && lb.state === 'dash' && (voices.includes(String(VO.man)) || voices.includes(`${VO.laugh},${VO.whatCanISay}`)), voices.join(' '));
  // v4.3.8：出手音效 70% 为 4 号、30% 为 2、8 号
  const rel: string[] = [];
  const wr = freshWorld();
  wr.fx = { ...nullFx, voice: (ids: number[]) => { rel.push(ids.join(',')); } } as Fx;
  for (let i = 0; i < 2000; i++) releaseVoice(wr);
  const p4 = rel.filter((v) => v === String(VO.man)).length / rel.length;
  check('出手音效：约 70% 为 4 号，其余依次播放 2、8 号', Math.abs(p4 - 0.7) < 0.04 && rel.every((v) => v === String(VO.man) || v === `${VO.laugh},${VO.whatCanISay}`), (p4 * 100).toFixed(1) + '%');
  // v4.3.8：投掷石块时播放 8 号音效
  voices.length = 0;
  (lb as any).set('windThrow');
  for (let i = 0; i < 40 && lb.state === 'windThrow'; i++) w.update(1 / 60, true);
  check('牢大：投掷石块时播放 8 号音效', lb.state === 'barrage' && voices.includes(String(VO.whatCanISay)), voices.join(' '));
  // Boss 战中受伤与倒下
  (w as any).__god = false;
  w.phase = 'boss';
  voices.length = 0;
  const p = w.player;
  w.run.invulnT = 0;
  for (let k = 0; k < 2; k++) { p.iframe = 0; w.damagePlayer(1, e.x, e.y); }
  check('Boss 战中每受伤 2 次播放 2 号音效', voices.filter((v) => v === String(VO.laugh)).length === 1, voices.join(' '));
  voices.length = 0;
  p.iframe = 0;
  w.damagePlayer(1e6, e.x, e.y);
  check('在 Boss 战中倒下：依次播放 8、3 号音效，结算为“没肘过牢大”', voices.includes(`${VO.whatCanISay},${VO.mambaOut}@1.25`) && w.run.fellIn === 'laoda', voices.join(' ') + ' ' + w.run.fellIn);
  // 牢大倒下（没有打开隐秘核心）：依次播放 2、1 号音效
  const w2 = freshWorld();
  w2.fx = spy();
  voices.length = 0;
  const e2 = w2.enemies.spawnBoss(w2.player.x, w2.player.y + 24, 'laoda');
  w2.boss = new Boss(w2, e2); w2.bossEnemy = e2;
  w2.onBossKilled(e2);
  check('牢大倒下：依次播放 2、1 号音效', voices.includes(`${VO.laugh},${VO.years}@1.25`), voices.join(' '));
  // 曼巴倒下：依次播放 2、3 号音效；转阶段 5 次
  const w3 = freshWorld();
  w3.fx = spy();
  (w3.layout as any).index = 6;
  voices.length = 0;
  const e3 = w3.enemies.spawnBoss(w3.player.x, w3.player.y + 24, 'mamba');
  const mb = new Mamba(w3, e3);
  w3.boss = mb; w3.bossEnemy = e3;
  check('曼巴：4 次召唤与半血狂暴，共 5 条阶段分界线', mb.shield.marks.join(',') === '0.8,0.6,0.5,0.4,0.2');
  check('单人普通难度：曼巴总生命 240000', e3.maxHp === 240000, String(e3.maxHp));
  w3.onBossKilled(e3);
  check('曼巴倒下：依次播放 2、8、3 号音效', voices.includes(`${VO.laugh},${VO.whatCanISay},${VO.mambaOut}@1.25`), voices.join(' '));
  // 联机：减伤由房主同步给其他玩家
  const { ws, step } = pair();
  const [host, cli] = ws;
  host.zoneStarted = false;
  host.enemies.clearAll();
  step(10);
  const he = host.enemies.spawnBoss(host.player.x, host.player.y + 24, 'laoda');
  host.bossEnemy = he; host.boss = new Boss(host, he);
  step(30);
  host.enemies.damage(he, 1e7, null);
  step(12);
  check('联机：其他玩家那里的 Boss 也获得了减伤', !!cli.boss && cli.boss.shield.dr > 0.75 && cli.boss.shield.dr <= 0.8, cli.boss ? cli.boss.shield.dr.toFixed(3) : 'no boss');
  const ce = cli.bossEnemy!;
  const ch0 = ce.hp;
  cli.enemies.damage(ce, 1000, null);
  check('联机：其他玩家本地预判的伤害同样减免', ch0 - ce.hp < 260 && ch0 - ce.hp > 150, (ch0 - ce.hp).toFixed(1));
  const hh0 = he.hp;
  step(10);
  check('联机：房主按已减免的伤害结算（不重复减免）', hh0 - he.hp > 150 && hh0 - he.hp < 260, (hh0 - he.hp).toFixed(1));
}

// 30. 真人试玩数据导出：伤害来源分类、最低血量、每区快照、装备过的槍械
{
  const w = freshWorld();
  const run = w.run;
  const p = w.player;

  // 接触伤害：命中点附近有丧尸
  const near = w.enemies.spawn('office', p.x + 1, p.y, 0);
  w.enemies.hash.rebuild(w.enemies.list);
  p.iframe = 0; run.invulnT = 0;
  w.damagePlayer(10, near.x, near.y, near.id);
  check('导出数据：接触伤害计入 contact 桶', run.stats.dmgBySource.contact === 10 && run.stats.dmgBySource.spit === 0 && run.stats.dmgBySource.boss === 0, JSON.stringify(run.stats.dmgBySource));

  // 远程伤害：命中点附近没有敌人
  w.enemies.clearAll();
  p.iframe = 0; run.invulnT = 0;
  w.damagePlayer(20, p.x + 30, p.y + 30);
  check('导出数据：命中点附近无敌人时计入 spit 桶', run.stats.dmgBySource.spit === 20, JSON.stringify(run.stats.dmgBySource));

  // Boss 伤害：命中点在 Boss 3 米以内
  const be = w.enemies.spawnBoss(p.x, p.y + 2, 'laoda');
  w.bossEnemy = be; w.boss = new Boss(w, be);
  p.iframe = 0; run.invulnT = 0;
  w.damagePlayer(30, be.x, be.y, be.id);
  check('导出数据：Boss 附近命中计入 boss 桶', run.stats.dmgBySource.boss === 30, JSON.stringify(run.stats.dmgBySource));

  // 自伤（友伤）
  p.ffIframe = 0; run.invulnT = 0;
  const hpBefore = run.hp;
  w.friendlyFire(100, p.x, p.y);
  const selfDmg = hpBefore - run.hp;
  check('导出数据：友伤计入 self 桶', selfDmg > 0 && Math.abs(run.stats.dmgBySource.self - selfDmg) < 1e-9, `self=${run.stats.dmgBySource.self.toFixed(2)}`);

  // 辐射伤害（独立的世界，避免上面的 Boss / 丧尸干扰判定）
  const wr = freshWorld();
  wr.run.rad = 1e9;
  (wr as any).updateRadiation(1);
  check('导出数据：辐射伤害计入 rad 桶，且与承受伤害总数一致', wr.run.stats.dmgBySource.rad > 0 && Math.abs(wr.run.stats.dmgBySource.rad - wr.run.stats.damageTaken) < 1e-9, wr.run.stats.dmgBySource.rad.toFixed(2));

  // 最低血量：曾经掉到的最低值要被记住，回血后不会被覆盖
  const w2 = freshWorld();
  const run2 = w2.run;
  w2.update(1 / 60, true);
  run2.hp = run2.maxHp * 0.2;
  w2.update(1 / 60, true);
  run2.hp = run2.maxHp;
  w2.update(1 / 60, true);
  check('导出数据：minHpFrac 记住曾经的最低值，不会被之后的回血覆盖', Math.abs(run2.stats.minHpFrac - 0.2) < 1e-6, run2.stats.minHpFrac.toFixed(2));

  // 每区快照：kills/gold 是相对本区开始的增量，minHp 是本区内的最低值
  const killsBefore = run2.stats.kills, goldBefore = run2.stats.goldEarned;
  run2.stats.kills = killsBefore + 5;
  run2.stats.goldEarned = goldBefore + 300;
  w2.debugAdvance();
  check('进入安全屋（触发每区快照）', w2.phase === 'safehouse');
  const zr = run2.stats.zoneRecords[run2.stats.zoneRecords.length - 1];
  check('导出数据：每区快照的 kills/gold 是本区增量而不是总数', zr.kills === 5 && zr.gold === 300, JSON.stringify(zr));
  check('导出数据：每区快照记录了本区内的最低血量', Math.abs(zr.minHp - 0.2) < 1e-6, zr.minHp.toFixed(2));

  // 装备过的枪械：开局两把武器已经被记录；新装备的枪会追加，同一把枪换手不会重复
  check('导出数据：开局武器自动进入 gunsEquipped', run2.gunsEquipped.length === 2, String(run2.gunsEquipped.length));
  const newGun = makeFixedGun('测试枪', 'T-9', 2, 1, 0.3, 4, 0, 1, new Rng(9));
  run2.guns[0] = newGun;
  w2.update(1 / 60, true);
  check('导出数据：新装备的枪加入 gunsEquipped', run2.gunsEquipped.some((g) => g.uid === newGun.uid));
  const before = run2.gunsEquipped.length;
  run2.guns[1] = run2.guns[0]; run2.guns[0] = null;
  w2.update(1 / 60, true);
  check('导出数据：同一把枪换手不会重复记录', run2.gunsEquipped.length === before, String(run2.gunsEquipped.length));
}

// 31. 真人试玩数据导出：exportData() 的结算类型、联机元信息与 AI/真人来源
{
  const meta = { mode: 'solo' as const, playerCount: 1, isHost: null, source: 'human' as const };
  const r1 = new RunState(1, 'normal'); r1.laodaKilled = true;
  check('exportData：击败牢大、未击败曼巴 → laoda_win', r1.exportData(true, meta).outcome === 'laoda_win');
  const r2 = new RunState(1, 'normal'); r2.laodaKilled = true; r2.mambaKilled = true;
  check('exportData：击败曼巴 → mamba_win（真结局优先于 win 参数）', r2.exportData(false, meta).outcome === 'mamba_win');
  const r3 = new RunState(1, 'normal'); r3.fellIn = 'laoda';
  check('exportData：在牢大战中阵亡 → died_laoda', r3.exportData(false, meta).outcome === 'died_laoda');
  const r4 = new RunState(1, 'normal'); r4.fellIn = 'mamba';
  check('exportData：在曼巴战中阵亡 → died_mamba', r4.exportData(false, meta).outcome === 'died_mamba');
  const r5 = new RunState(1, 'normal');
  check('exportData：在普通区域阵亡 → died', r5.exportData(false, meta).outcome === 'died');
  check('exportData：真人数据标记 source=human', r5.exportData(false, meta).source === 'human');
  const coopMeta = { mode: 'coop' as const, playerCount: 3, isHost: true, source: 'ai' as const };
  const d = r5.exportData(false, coopMeta);
  check('exportData：联机元信息（mode/playerCount/isHost）透传', d.mode === 'coop' && d.playerCount === 3 && d.isHost === true, JSON.stringify(d).slice(0, 80));
  check('exportData：AI 模拟数据标记 source=ai', d.source === 'ai');
}
console.log(fails ? `${fails} 项失败` : '全部通过');
