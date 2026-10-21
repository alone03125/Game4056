// 规则测试：第3次调整（枪械修饰语、参数硬下限、道具前缀、Rarity5、金币公式）与第4次调整（盲盒、玉米粒、苦力怕、奇点吸引投掷物、安全屋试枪、拉起无敌），
// 以及第4.1次调整（权重、新模块、全局强化零件1型、招财弹、临时整备区、区域任务、奇物宝箱与奇物、联机本地判定碰撞伤害）；
// 第4.2次调整更新了权重、盲盒、模块的攻击倍率与瘴气的完成比例，删除了熔炼模块；
// 第4.3次调整：追踪模块与环形弹幕、增幅模块的散射、奇物的削弱与新奇物、曼巴僵尸的耐久战、区域倍率与宝箱生命。
// 用法：npx esbuild tools/modtest.ts --bundle --platform=node --outfile=tools/.modtest.cjs && node tools/.modtest.cjs
import { RunState } from '../src/game/state';
import { World } from '../src/game/world';
import { nullFx } from '../src/game/fx';
import { BULLETS, BULLET_IDS, BulletId, makeBullet, RARE_BULLETS } from '../src/data/bullets';
import { castOnce, GUN_MODS, gunStats, makeFixedGun, makeGun, rollRarity } from '../src/data/guns';
import { altarBuy, altarValue, buyBullet, buyGun } from '../src/game/shop';
import { bulletToSlot, moveItem } from '../src/game/inventory';
import { QUEST, QUEST_IDS, questOrder, QuestId } from '../src/game/quest';
import { Coop } from '../src/net/coop';
import { isNormalZombie } from '../src/game/enemies';
import { MemHub } from '../src/net/transport';
import { itemValue, makeConsumable, rollGrade } from '../src/data/items';
import { CHEST_HP, CREEPER, enhanceCoef, ZONES } from '../src/config';
import { Mamba, MAMBA_CINE } from '../src/game/mamba';
import { QTE, RELIC, RELIC_IDS } from '../src/data/relics';
import { CORE_PURIFY } from '../src/game/world';
import { ITEM_REFILL } from '../src/game/pickups';
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
  check('凶险：伤害 ×1.44', !!pr && Math.abs(pr.dmg - 60 * 1.44) < 0.5, pr ? `dmg=${pr.dmg.toFixed(1)}` : '');
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
  check('倒计时中移速降为 3.2（相对 4.6）', Math.abs(CREEPER.fuseSpeed / 4.6 - 0.6957) < 0.001);
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
  check('闪耀虹彩模块：伤害 ×1.25×1.6（攻击倍率 -0.20x）、带特效', shine.projs.length === 1 && Math.abs(shine.projs[0].dmg - 60 * 1.25 * 1.6 * 0.8) < 0.5 && shine.projs[0].fancy === 3, shine.projs[0]?.dmg?.toFixed(1));
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
  const items0 = w.pickups.items.filter((i) => !i.dead).length;
  for (let i = 0; i < 6; i++) {
    const e = w.enemies.spawn('office', w.player.x + 6 + i, w.player.y + 4, 0);
    w.enemies.damage(e, 1e6, { gold: true });
  }
  const got = w.pickups.items.filter((i) => !i.dead).length - items0;
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
  check('天生神力：生命上限 ×1.8、移速 ×1.8、碰撞范围 ×1.8', Math.abs(run.maxHp - hp0 * 1.8) < 1e-6 && Math.abs(w.player.speed() - sp0 * 1.8) < 1e-6 && Math.abs(w.player.r - 0.72) < 1e-9);
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
  check('环形弹幕 19 / 感应地雷 180 / 炸弹 160', BULLETS.nova.atk === 19 && BULLETS.mine.atk === 180 && BULLETS.bomb.atk === 160);
  check('区域倍率：第二区 1.4~2.4 … 第六区 5.0~6.0', ZONES.map((z) => z.hpMul.join('~')).join(' ') === '0.6~1.6 1.4~2.4 2.2~4.5 3~6 4~6 5~6');
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
  check('聚精会神：获得时 2 枚代币（攻击倍率 +0.20x、移速 +6%）', run.focusTokens === 2 && Math.abs(run.atkBonus() - a0 - 0.2) < 1e-9 && Math.abs(w.player.speed() / s0 - 1.06) < 1e-9);
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

// 24. 第4.3次调整：联机时把地图道具补满 6 个
{
  const { ws, step } = pair();
  const [host, cli] = ws;
  host.zoneStarted && host.enemies.clearAll();
  step(30);
  const mapItems = (w: World) => w.pickups.items.filter((it) => !it.dead && it.map);
  check('区域开始时 15 个地图道具', mapItems(host).length === 15, String(mapItems(host).length));
  // 拿走 12 个（只剩 3 个）
  const list = mapItems(host);
  for (let i = 0; i < 12; i++) list[i].dead = true;
  step(90);
  const after = mapItems(host);
  check('不足 6 个时补到 6 个', after.length === ITEM_REFILL.min, String(after.length));
  const views = [host.player, cli.player];
  const fresh = after.filter((it) => !list.slice(0, 15).includes(it));
  check('补充了 3 个新道具', fresh.length === 3, String(fresh.length));
  check('补充的位置都在两名玩家的视野外', fresh.every((it) => views.every((v) => Math.abs(it.x - v.x) > ITEM_REFILL.viewX || Math.abs(it.y - v.y) > ITEM_REFILL.viewY)));
  check('补充的位置都能走到', fresh.every((it) => host.nav.reachable(it.x, it.y)));
  check('其他玩家也收到了补充的道具（小地图上暂不显示）', fresh.every((it) => { const c = cli.pickups.find(it.uid); return !!c && !!c.map && !c.seen; }));
  // 只剩 1 名存活玩家时不再补充
  cli.player.alive = false;
  step(30);
  check('房主收到队友阵亡', (host.net as Coop).remoteList()[0].dead);
  for (const it of mapItems(host)) it.dead = true;
  step(90);
  check('只剩 1 名存活玩家时不补充', mapItems(host).length === 0, String(mapItems(host).length));
}
// 25. 单人模式不补充地图道具
{
  const run = new RunState(5, 'normal');
  const w = new World(run, nullFx, { damageNumbers: false }, ev);
  w.start();
  w.enemies.clearAll();
  for (const it of w.pickups.items) it.dead = true;
  for (let i = 0; i < 120; i++) w.update(1 / 60, true);
  check('单人模式不补充地图道具', w.pickups.items.filter((it) => !it.dead && it.map).length === 0);
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
  step(37 * 60);
  check('计时结束：双方胜利', host.phase === 'victory' && cli.phase === 'victory', `${host.phase} ${cli.phase}`);
  void coops;
}
console.log(fails ? `${fails} 项失败` : '全部通过');
