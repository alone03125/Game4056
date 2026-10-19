// 无头联机测试（第2版）：N 个玩家各自运行一份 World，通过内存中转（可模拟延迟）互相通信，每人由 AI 操作。
// 用法：npm run mptest -- 3 normal        （GOD=1 全员无敌，验证流程；LAT=0.05 模拟 50ms 单程延迟；FAST=1 Boss 每帧额外损失 0.4% 生命）
import { RunState } from '../src/game/state';
import { World } from '../src/game/world';
import { nullFx } from '../src/game/fx';
import { Bot } from '../src/debug/bot';
import { Difficulty } from '../src/config';
import { Coop } from '../src/net/coop';
import { MemHub } from '../src/net/transport';

const N = Number(process.argv[2] || 3);
const diff = (process.argv[3] || 'normal') as Difficulty;
const seed = Number(process.env.SEED || 4242);
const god = process.env.GOD === '1';
const hub = new MemHub();
hub.latency = Number(process.env.LAT || 0.03);
const players = Array.from({ length: N }, (_, i) => ({ id: i, name: 'P' + (i + 1) }));
const evLog: string[] = [];
const ffSum: number[] = [];
const ffKinds: Record<string, number> = {};
(globalThis as any).__ff = (k: string, d: number) => { ffKinds[k] = (ffKinds[k] || 0) + d * 0.05; };
for (let i = 0; i < 8; i++) ffSum.push(0);

interface Peer { w: World; coop: Coop; bot: Bot; end: ReturnType<MemHub['add']> }
const peers: Peer[] = [];
for (let i = 0; i < N; i++) {
  const end = hub.add(i);
  const coop = new Coop(end, 0, players);
  const run = new RunState(seed, diff, i);
  const tag = 'P' + (i + 1);
  const events = {
    zoneBuilt() {}, enterSafehouse() {}, leaveSafehouse() {}, bossStart() {}, doorChanged() {},
    death() { evLog.push(`${t.toFixed(0)}s ${tag} 游戏结束`); },
    victory() { evLog.push(`${t.toFixed(0)}s ${tag} 胜利`); },
    downed() { evLog.push(`${t.toFixed(0)}s ${tag} 倒地`); },
    revived() { evLog.push(`${t.toFixed(0)}s ${tag} 被拉起`); },
    spectate() { evLog.push(`${t.toFixed(0)}s ${tag} 阵亡观战`); },
  };
  const w = new World(run, nullFx, { damageNumbers: false }, events, coop);
  coop.attach(w);
  const ff = w.friendlyFire.bind(w);
  w.friendlyFire = (d, x, y) => { const before = w.run.hp; ff(d, x, y); ffSum[i] += before - w.run.hp; };
  w.start(i);
  peers.push({ w, coop, bot: new Bot(w), end });
}

const dt = 1 / 60;
let t = 0;
let last = '';
let maxDiff = 0;
let diffSamples = 0, diffSum = 0;
const host = peers[0].w;
while (t < Number(process.env.T || 1500)) {
  t += dt;
  hub.update(dt);
  if (process.env.FAST && host.bossEnemy && !host.bossEnemy.dead && host.phase === 'boss') host.enemies.damage(host.bossEnemy, host.bossEnemy.maxHp * 0.004, null);
  for (const p of peers) {
    if (god) { p.w.run.invulnT = 99; }
    if (process.env.LOWRAD) p.w.run.rad = Math.min(p.w.run.rad, 100); // 测试隐秘核心：辐射不超过 100K
    p.bot.update(dt);
    p.w.update(dt, true);
    p.coop.tick(dt);
  }
  const key = peers.map((p) => `${p.w.phase}${p.w.layout.index}`).join(',');
  if (key !== last) { evLog.push(`${t.toFixed(0)}s 阶段 ${key}`); last = key; }
  // 一致性：各客户端镜像的敌人数量与位置与房主相比
  if (Math.floor(t * 2) !== Math.floor((t - dt) * 2) && host.enemies.list.length) {
    for (const p of peers.slice(1)) {
      if (p.w.layout.seed !== host.layout.seed) continue;
      let sum = 0, n = 0;
      for (const e of host.enemies.list) {
        const m = p.w.enemies.byId.get(e.id);
        if (!m) continue;
        sum += Math.hypot(m.x - e.x, m.y - e.y); n++;
      }
      if (n) {
        const avg = sum / n; diffSum += avg; diffSamples++; maxDiff = Math.max(maxDiff, avg);
        if (avg > 3 && process.env.DIAG) {
          const bad = host.enemies.list.map((e) => { const m = p.w.enemies.byId.get(e.id); return m ? [e.id, e.type, Math.hypot(m.x - e.x, m.y - e.y).toFixed(1), m.dead, m.predT.toFixed(2)] : null; }).filter((x) => x && Number(x[2]) > 3).slice(0, 5);
          console.log(`DIAG t=${t.toFixed(2)} peer=${peers.indexOf(p)} phase=${p.w.phase}/${host.phase} n=${n} avg=${avg.toFixed(1)} bad=${JSON.stringify(bad)}`);
        }
      }
    }
  }
  if (process.env.TRACE && Math.floor(t / 10) !== Math.floor((t - dt) / 10)) {
    console.log(`t=${t.toFixed(0)} ` + peers.map((p, i) => `P${i + 1}[${p.w.phase}${p.w.layout.index} hp=${p.w.run.hp.toFixed(0)} dn=${p.w.player.downed ? 1 : 0} en=${p.w.enemies.list.length} k=${p.w.run.stats.kills} g=${p.w.run.stats.goldEarned}]`).join(' '));
  }
  if (host.phase === 'victory' || host.phase === 'dead') { if (host.victoryT > 1 || host.deathT > 1) break; }
}

for (const l of evLog) console.log(l);
console.log('—— 结果 ——');
peers.forEach((p, i) => {
  const r = p.w.run;
  console.log(`P${i + 1}: 阶段=${p.w.phase} 区域=${p.w.layout.index} 牢大=${r.laodaKilled} 曼巴=${r.mambaKilled} 背包净化=${r.countItem('purify')} 击杀=${r.stats.kills} 金币=${r.stats.goldEarned} 已存=${r.bank} 防护服=${r.suit} 辐射=${r.rad.toFixed(1)} 承伤=${r.stats.damageTaken.toFixed(0)}(友伤${ffSum[i].toFixed(0)}) 发送=${(p.end.bytes / 1024 / t).toFixed(1)}KB/s 布局种子=${p.w.layout.seed}`);
});
console.log(`镜像敌人与房主的平均位置误差：平均 ${(diffSum / Math.max(1, diffSamples)).toFixed(3)}m，最大 ${maxDiff.toFixed(3)}m（单程延迟 ${hub.latency * 1000}ms）`);
console.log('友伤来源（未计无敌帧）', JSON.stringify(Object.fromEntries(Object.entries(ffKinds).map(([k, v]) => [k, Math.round(v)]))));
console.log(`用时 ${t.toFixed(0)}s，房主在场敌人 ${host.enemies.list.length}`);
// 第4次调整：观战用的装备概况是否送达
peers.forEach((p, i) => {
  const got = p.coop.remoteList().map((r) => `${r.name}:${r.prof ? `枪=${r.prof.guns.filter(Boolean).length} 道具=${r.prof.counts.reduce((a, b) => a + b, 0)}` : '无'} 手=${r.hands.map((h) => h.cursor).join('/')}`);
  console.log(`P${i + 1} 收到的队友概况：${got.join('　')}`);
});
