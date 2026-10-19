import { makeGun, gunDps } from '../src/data/guns';
import { makeBullet } from '../src/data/bullets';
import { Rng } from '../src/util/rng';
const rng = new Rng(42);
for (let r = 1; r <= 4; r++) {
  const dps: number[] = [];
  for (let i = 0; i < 400; i++) {
    const g = makeGun(r, rng);
    for (let k = 0; k < g.cap; k++) g.bullets[k] = makeBullet('std', rng, 1);
    dps.push(gunDps(g));
    if (i < 5) console.log(`R${r} ${g.model} ${g.name}  atk ${g.atk} delay ${g.delay} reload ${g.reload} cap ${g.cap} spread ${g.spread}  dps(std×cap)=${gunDps(g).toFixed(0)}`);
  }
  dps.sort((a, b) => a - b);
  console.log(`  R${r} DPS with all-standard bullets: p10 ${dps[40].toFixed(0)} median ${dps[200].toFixed(0)} p90 ${dps[360].toFixed(0)}`);
}
