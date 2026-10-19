// Boss 测试：直接跳到第五区（ZONE=6 时跳到第六区打曼巴僵尸），给予一套典型的后期装备，用 AI 对战。
import { RunState } from '../src/game/state';
import { World } from '../src/game/world';
import { nullFx } from '../src/game/fx';
import { Bot } from '../src/debug/bot';
import { makeGun } from '../src/data/guns';
import { makeBullet, BulletId } from '../src/data/bullets';
import { Rng } from '../src/util/rng';
import { gunDps } from '../src/data/guns';
const N = Number(process.argv[2] || 6);
const loadouts: BulletId[][] = [['bomb', 'std', 'brass', 'chain', 'lead', 'split'], ['sniper', 'fire', 'tri', 'homing', 'std', 'cryo'], ['rocket', 'buck', 'buck', 'saw', 'boomer', 'nova']];
for (let i = 0; i < N; i++) {
  const run = new RunState(9000 + i * 31, (process.argv[3] || 'normal') as any);
  const ev = { zoneBuilt() {}, enterSafehouse() {}, leaveSafehouse() {}, bossStart() {}, death() {}, victory() {}, doorChanged() {} };
  const w = new World(run, nullFx, { damageNumbers: false }, ev);
  w.start();
  for (let k = 0; k < (process.env.ZONE === '6' ? 10 : 8); k++) w.debugAdvance();
  const rng = new Rng(77 + i);
  // 典型后期：两把 R3/R4，约 8 次祭坛（生命/攻击/载弹），HP ~300
  const g1 = makeGun(Number(process.env.R1 || 4), rng), g2 = makeGun(Number(process.env.R2 || 3), rng);
  const lo = loadouts[i % loadouts.length];
  g1.cap = Math.max(g1.cap, 4); g2.cap = Math.max(g2.cap, 4);
  g1.bullets = new Array(g1.cap).fill(null); g2.bullets = new Array(g2.cap).fill(null);
  for (let s = 0; s < g1.cap; s++) g1.bullets[s] = makeBullet(lo[s % lo.length], rng);
  for (let s = 0; s < g2.cap; s++) g2.bullets[s] = makeBullet(lo[(s + 3) % lo.length], rng);
  run.guns = [g1, g2];
  run.addAtkAll(Number(process.env.ATK || 1.2));
  run.maxHp = Number(process.env.HP || 300); run.hp = run.maxHp; run.speedPct = 40; run.recoilResist = 0.3;
  run.rad = 120; run.suit = 5;
  const bot = new Bot(w);
  const src: Record<string, number> = {};
  const orig = w.damagePlayer.bind(w);
  w.damagePlayer = (a, x, y) => {
    const ok = orig(a, x, y);
    if (ok) {
      let k = 'mob';
      const B = w.boss;
      if (w.bossEnemy && Math.hypot(w.bossEnemy.x - x, w.bossEnemy.y - y) < 0.01) k = 'boss-' + (B ? B.state : '?');
      else if (w.enemies.shots.some((s) => s.kind === 'rock' && Math.hypot(s.x - x, s.y - y) < 0.01)) k = 'rock';
      src[k] = (src[k] || 0) + a;
    }
    return ok;
  };
  const dt = 1 / 60;
  let t = 0;
  while (t < Number(process.env.T || 600) && w.phase !== 'dead' && w.phase !== 'victory' && !(w.layout.index === 5 && w.bossCleared)) {
    t += dt; if (process.env.GOD) run.invulnT = 99;
    // OLDHP=1：把 Boss 的生命改回第3次调整之前（总共 24000，对比用）
    if (process.env.OLDHP && w.bossEnemy && !(w.bossEnemy as any).__old) { (w.bossEnemy as any).__old = 1; const k = 0.25; w.bossEnemy.maxHp *= k; w.bossEnemy.hp *= k; }
    bot.update(dt); w.update(dt, true);
  }
  console.log(`seed ${i} ${w.bossCleared ? 'core-open' : w.phase} t=${t.toFixed(0)} bossHp=${w.bossEnemy ? Math.round(w.bossEnemy.hp) + '/' + Math.round(w.bossEnemy.maxHp) : 'n/a'} hp=${Math.round(run.hp)} dps=${gunDps(g1).toFixed(0)}/${gunDps(g2).toFixed(0)} rad=${run.rad.toFixed(0)} kills=${run.stats.kills} src=${JSON.stringify(src)}`);
}
