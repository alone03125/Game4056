// 无头平衡模拟：用 src/debug/bot.ts 的 AI 自动游玩，统计各区用时/击杀/金币/死亡情况。
// 用法：npm run sim -- 8 normal    （或 SEED=123 TRACE=1 node tools/sim.cjs 1 normal）
import { RunState } from '../src/game/state';
import { World } from '../src/game/world';
import { nullFx } from '../src/game/fx';
import { gunDps } from '../src/data/guns';
import { Bot } from '../src/debug/bot';
import { Difficulty } from '../src/config';

interface ZoneRec { zone: number; time: string; kills: number; gold: number; rad: string; maxHp: number; minHp: string; bank: number; dps: string }

function runOne(seed: number, diff: Difficulty) {
  const run = new RunState(seed, diff);
  const events = { zoneBuilt() {}, enterSafehouse() {}, leaveSafehouse() {}, bossStart() {}, death() {}, victory() {}, doorChanged() {} };
  const w = new World(run, nullFx, { damageNumbers: false }, events);
  w.start();
  const bot = new Bot(w);
  const src: Record<string, number> = { contact: 0, spit: 0, boss: 0, self: 0, rad: 0 };
  const ffOrig = w.friendlyFire.bind(w);
  w.friendlyFire = (d: number, x: number, y: number) => { const hp0 = run.hp; ffOrig(d, x, y); src.self += hp0 - run.hp; };
  const origDmg = w.damagePlayer.bind(w);
  const dmgScale = Number(process.env.DMG || 1);
  w.damagePlayer = (a: number, x: number, y: number) => {
    const ok = origDmg(a * dmgScale, x, y);
    if (ok) {
      if (w.bossEnemy && Math.hypot(w.bossEnemy.x - x, w.bossEnemy.y - y) < 3) src.boss += a;
      else if (w.enemies.nearest(x, y, 1.5)) src.contact += a; else src.spit += a;
    }
    return ok;
  };
  const dt = 1 / 60;
  let t = 0;
  let zoneStartKills = 0, zoneStartGold = 0;
  let lastPhase = w.phase;
  const zoneLog: ZoneRec[] = [];
  let minHpFrac = 1;
  const dps = () => [run.guns[0] ? gunDps(run.guns[0]).toFixed(0) : '-', run.guns[1] ? gunDps(run.guns[1]).toFixed(0) : '-'].join('/');
  while (t < 3600) {
    t += dt;
    bot.update(dt);
    const hpBefore = run.hp, takenBefore = run.stats.damageTaken, selfBefore = src.self;
    w.update(dt, true);
    void hpBefore;
    const other = run.stats.damageTaken - takenBefore - (src.self - selfBefore);
    if (other > 0 && w.radLevel >= 2) src.rad += Math.min(other, run.maxHp * 0.03 * dt * 1.01);
    if (process.env.TRACE && Math.floor(t / 4) !== Math.floor((t - dt) / 4)) {
      let near = 0; w.enemies.hash.queryRadius(w.player.x, w.player.y, 10, () => { near++; });
      console.log(`t=${t.toFixed(0)} ph=${w.phase} z=${w.layout.index} hp=${run.hp.toFixed(0)}/${run.maxHp} kills=${run.stats.kills} near10=${near} alive=${w.enemies.list.length} rad=${run.rad.toFixed(1)} gold=${run.gold}`);
    }
    minHpFrac = Math.min(minHpFrac, run.hp / run.maxHp);
    if (w.phase !== lastPhase) {
      if (w.phase === 'safehouse') {
        zoneLog.push({
          zone: w.safehouseZone, time: (run.stats.zoneTimes[run.stats.zoneTimes.length - 1] ?? 0).toFixed(0),
          kills: run.stats.kills - zoneStartKills, gold: run.stats.goldEarned - zoneStartGold, rad: run.rad.toFixed(1),
          maxHp: Math.round(run.maxHp), minHp: minHpFrac.toFixed(2), bank: run.bank, dps: dps(),
        });
        zoneStartKills = run.stats.kills; zoneStartGold = run.stats.goldEarned; minHpFrac = 1;
      }
      lastPhase = w.phase;
    }
    if (w.phase === 'dead' || w.phase === 'victory') break;
  }
  return {
    seed, result: w.phase, zone: run.zoneIndex, zt: w.zoneTime.toFixed(0), time: run.totalTime.toFixed(0), kills: run.stats.kills,
    bossHp: w.bossEnemy ? Math.round(w.bossEnemy.hp) : null, rad: run.rad.toFixed(1), dps: dps(), alive: w.enemies.list.length,
    src: Object.entries(src).map(([k, v]) => `${k}:${v.toFixed(0)}`).join(' '), zoneLog,
  };
}

const ffKinds: Record<string, number> = {};
(globalThis as any).__ff = (k: string, d: number) => { ffKinds[k] = (ffKinds[k] || 0) + d * 0.05; };
(globalThis as any).BOT_DW = process.env.DW; (globalThis as any).BOT_AW = process.env.AW;
const N = Number(process.argv[2] || 6);
const diff = (process.argv[3] || 'normal') as Difficulty;
let wins = 0;
const reached = [0, 0, 0, 0, 0, 0];
for (let i = 0; i < N; i++) {
  const r = runOne(Number(process.env.SEED || 0) || 1000 + i * 7919, diff);
  if (r.result === 'victory') wins++;
  reached[r.zone]++;
  const { zoneLog, ...rest } = r;
  console.log(JSON.stringify(rest));
  for (const z of zoneLog) console.log('   ', JSON.stringify(z));
}
console.log('self-damage sources (before iframes)', JSON.stringify(Object.fromEntries(Object.entries(ffKinds).map(([k, v]) => [k, Math.round(v)]))));
console.log(`wins ${wins}/${N}  final-zone histogram ${JSON.stringify(reached.slice(1))}`);
