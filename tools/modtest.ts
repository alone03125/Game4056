// 规则测试：第3次调整（枪械修饰语、参数硬下限、道具前缀、Rarity5、金币公式）与第4次调整（盲盒、玉米粒、苦力怕、奇点吸引投掷物、安全屋试枪、拉起无敌）。
// 用法：npx esbuild tools/modtest.ts --bundle --platform=node --outfile=tools/.modtest.cjs && node tools/.modtest.cjs
import { RunState } from '../src/game/state';
import { World } from '../src/game/world';
import { nullFx } from '../src/game/fx';
import { BULLETS, makeBullet } from '../src/data/bullets';
import { GUN_MODS, gunStats, makeFixedGun, makeGun, rollRarity } from '../src/data/guns';
import { itemValue, makeConsumable, rollGrade } from '../src/data/items';
import { CREEPER, enhanceCoef, ZONES } from '../src/config';
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
// 9. 盲盒：发射时变成别的子弹；装填后攻击倍率 +0.20、射击延迟 -0.04
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
  check('盲盒：攻击倍率 +0.20', Math.abs(st.atk - base.atk - 0.2) < 1e-9, `${base.atk} → ${st.atk}`);
  check('盲盒：射击延迟 -0.04', Math.abs(st.delay - (g.delay - 0.04)) < 1e-9, `${g.delay} → ${st.delay}`);
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
console.log(fails ? `${fails} 项失败` : '全部通过');
