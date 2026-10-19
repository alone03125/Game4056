import { RunState } from '../src/game/state';
import { World } from '../src/game/world';
import { nullFx } from '../src/game/fx';
import { makeBullet } from '../src/data/bullets';
import { makeFixedGun, gunDps } from '../src/data/guns';
import { Rng } from '../src/util/rng';
const run = new RunState(1, 'normal');
const ev = { zoneBuilt() {}, enterSafehouse() {}, leaveSafehouse() {}, bossStart() {}, death() {}, victory() {}, doorChanged() {} };
const w = new World(run, nullFx, { damageNumbers: false }, ev);
w.start();
w.enemies.clearAll();
const rng = new Rng(5);
const g = makeFixedGun('测试枪', 'T-1', 4, 1.0, 0.3, 6, 0, 1.0, rng);
g.bullets = [makeBullet('mDouble', rng), makeBullet('std', rng), makeBullet('std', rng), makeBullet('mHoming', rng), makeBullet('mPower', rng), makeBullet('brass', rng)];
run.guns = [g, null];
const p = w.player;
w.input.aimX = p.x + 10; w.input.aimY = p.y;
w.input.fire = [true, false];
const counts: number[] = [];
for (let f = 0; f < 120; f++) {
  const before = run.stats.shotsFired;
  w.update(1 / 60, true);
  if (run.stats.shotsFired > before) { counts.push(f, run.stats.shotsFired - before); console.log('  frame', f, 'projs', w.projs.list.map((q) => q.def.id + (q.homing ? '+homing' : '') + ' dmg=' + q.dmg.toFixed(1)).join(', ')); }
}
console.log('fire events [frame, shots]:', JSON.stringify(counts));
console.log('homing proj present:', w.projs.list.some((q) => q.homing), 'dmg of homing:', w.projs.list.filter((q) => q.homing).map((q) => q.dmg.toFixed(1)));
console.log('dps est', gunDps(g).toFixed(1), 'delay', g.delay, 'reload', g.reload);
