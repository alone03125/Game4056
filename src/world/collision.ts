// 静态障碍的空间索引与碰撞查询（圆 vs AABB），以及射线检测。

import { AABB, circleAABBPush, segAABB } from '../util/math';
import { Obstacle } from './zone';

const CELL = 4;
let stampG = 1; // 全局递增，避免多个碰撞世界共享障碍时冲突

export class CollisionWorld {
  private cells = new Map<number, Obstacle[]>();
  private dynamic: Obstacle[] = []; // 门
  readonly all: Obstacle[];

  constructor(obstacles: Obstacle[]) {
    this.all = obstacles;
    for (const o of obstacles) {
      if (o.kind === 'door') { this.dynamic.push(o); continue; }
      const cx0 = Math.floor(o.x0 / CELL), cx1 = Math.floor(o.x1 / CELL);
      const cy0 = Math.floor(o.y0 / CELL), cy1 = Math.floor(o.y1 / CELL);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const k = key(cx, cy);
          let arr = this.cells.get(k);
          if (!arr) { arr = []; this.cells.set(k, arr); }
          arr.push(o);
        }
      }
    }
  }

  /** 遍历与盒子相交的障碍（去重） */
  query(x0: number, y0: number, x1: number, y1: number, fn: (o: Obstacle) => boolean | void): void {
    const s = ++stampG;
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cy0 = Math.floor(y0 / CELL), cy1 = Math.floor(y1 / CELL);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const arr = this.cells.get(key(cx, cy));
        if (!arr) continue;
        for (const o of arr) {
          if (o.mark === s) continue;
          o.mark = s;
          if (o.x1 < x0 || o.x0 > x1 || o.y1 < y0 || o.y0 > y1) continue;
          if (fn(o) === true) return;
        }
      }
    }
    for (const o of this.dynamic) {
      if (o.open) continue;
      if (o.x1 < x0 || o.x0 > x1 || o.y1 < y0 || o.y0 > y1) continue;
      if (fn(o) === true) return;
    }
  }

  private tmp = { x: 0, y: 0 };
  /** 把圆推出所有障碍，返回修正后的位置（写入 out），以及是否发生碰撞 */
  resolveCircle(x: number, y: number, r: number, out: { x: number; y: number }): boolean {
    let hit = false;
    let px = x, py = y;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      this.query(px - r, py - r, px + r, py + r, (o) => {
        if (circleAABBPush(px, py, r, o, this.tmp)) {
          px += this.tmp.x;
          py += this.tmp.y;
          moved = true;
          hit = true;
        }
      });
      if (!moved) break;
    }
    out.x = px;
    out.y = py;
    return hit;
  }

  overlapsCircle(x: number, y: number, r: number): boolean {
    let hit = false;
    this.query(x - r, y - r, x + r, y + r, (o) => {
      if (circleAABBPush(x, y, r, o, this.tmp)) { hit = true; return true; }
    });
    return hit;
  }

  /** 线段检测：返回最先命中的 t（0..1）与法线，未命中返回 -1 */
  raycast(x0: number, y0: number, x1: number, y1: number, pad: number, nOut?: { x: number; y: number }, ignoreLow = 0): number {
    let best = -1;
    const n = { x: 0, y: 0 };
    this.query(Math.min(x0, x1) - pad, Math.min(y0, y1) - pad, Math.max(x0, x1) + pad, Math.max(y0, y1) + pad, (o) => {
      if (o.h < ignoreLow) return;
      const t = segAABB(x0, y0, x1, y1, o, pad, n);
      if (t >= 0 && (best < 0 || t < best)) {
        best = t;
        if (nOut) { nOut.x = n.x; nOut.y = n.y; }
      }
    });
    return best;
  }

  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.raycast(x0, y0, x1, y1, 0) < 0;
  }

  boxFree(b: AABB): boolean {
    let free = true;
    this.query(b.x0, b.y0, b.x1, b.y1, () => { free = false; return true; });
    return free;
  }
}

function key(cx: number, cy: number): number {
  return (cx + 4096) * 8192 + (cy + 4096);
}
