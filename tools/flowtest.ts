// 流程测试：清除所有敌人、玩家无敌，验证全部区域都能走通（地图连通性、安全屋、Boss 区、第3次调整的隐秘核心）。
// FAST=1：Boss 每帧额外损失 0.4% 生命（只测流程，不测战斗）。
import { RunState } from '../src/game/state';
import { World } from '../src/game/world';
import { nullFx } from '../src/game/fx';
import { Bot } from '../src/debug/bot';
for (let s = 0; s < Number(process.argv[2] || 10); s++) {
  const seed = 5000 + s * 1237;
  const run = new RunState(seed, 'normal');
  const events = { zoneBuilt() {}, enterSafehouse() {}, leaveSafehouse() {}, bossStart() {}, death() {}, victory() {}, doorChanged() {} };
  const w = new World(run, nullFx, { damageNumbers: false }, events);
  w.start();
  const bot = new Bot(w);
  const dt = 1 / 60;
  let t = 0;
  const log: string[] = [];
  let last = w.phase + w.layout.index;
  let stuck = '';
  let lastPos = { x: w.player.x, y: w.player.y, t: 0 };
  while (t < Number(process.env.T || 3000)) {
    t += dt;
    run.invulnT = 99;
    if (w.phase !== 'boss') w.enemies.clearAll();
    else for (const e of w.enemies.list) if (e.type !== 'boss') e.dead = true;
    bot.update(dt);
    if (process.env.FAST && w.bossEnemy && !w.bossEnemy.dead && w.phase === 'boss') w.enemies.damage(w.bossEnemy, w.bossEnemy.maxHp * 0.004, null);
    w.update(dt, true);
    const k = w.phase + w.layout.index;
    if (k !== last) { log.push(`${t.toFixed(0)}s:${k}`); last = k; }
    if (t - lastPos.t > 20) {
      if (Math.hypot(w.player.x - lastPos.x, w.player.y - lastPos.y) < 3) stuck = `STUCK at ${w.player.x.toFixed(1)},${w.player.y.toFixed(1)} phase=${w.phase} z=${w.layout.index}`;
      lastPos = { x: w.player.x, y: w.player.y, t };
    }
    if (w.phase === 'victory') break;
  }
  console.log(seed, w.phase, log.join(' '), stuck, w.bossEnemy ? `bossHp=${Math.round(w.bossEnemy.hp)}` : '', `rad=${run.rad.toFixed(0)} suit=${run.suit} laoda=${run.laodaKilled} mamba=${run.mambaKilled} hp=${Math.round(run.hp)}/${run.maxHp}`);
}
