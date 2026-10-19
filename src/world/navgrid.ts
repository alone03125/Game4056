// 导航网格 + 流场：寻路采取简单的全图追踪模式，所有丧尸沿流场始终追踪玩家。

import { AABB, pointInAABB } from '../util/math';
import { Obstacle, ZoneLayout } from './zone';

const INF = 0x3fffffff;

export class NavGrid {
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
  readonly cell = 1;
  readonly blocked: Uint8Array;
  readonly dist: Int32Array;
  private heapIdx: Int32Array;
  private heapKey: Int32Array;
  private heapSize = 0;
  private walkable: AABB[];
  targetCell = -1;

  constructor(layout: ZoneLayout) {
    const b = layout.bounds;
    this.x0 = Math.floor(b.x0);
    this.y0 = Math.floor(b.y0);
    this.w = Math.ceil(b.x1) - this.x0;
    this.h = Math.ceil(b.y1) - this.y0;
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.dist = new Int32Array(n).fill(INF);
    this.heapIdx = new Int32Array(n * 4);
    this.heapKey = new Int32Array(n * 4);
    this.walkable = [layout.rect];
    if (layout.prevRoom) this.walkable.push(layout.prevRoom.rect);
    if (layout.safeRoom) this.walkable.push(layout.safeRoom.rect);
    for (let cy = 0; cy < this.h; cy++) {
      for (let cx = 0; cx < this.w; cx++) {
        const x = this.x0 + cx + 0.5, y = this.y0 + cy + 0.5;
        if (!this.walkable.some((r) => pointInAABB(x, y, r))) this.blocked[cy * this.w + cx] = 1;
      }
    }
    for (const o of layout.obstacles) {
      if (o.kind === 'door') { if (!o.open) this.markBox(o, 0.35, 1); continue; }
      this.markBox(o, 0.35, 1);
    }
  }

  private markBox(o: AABB, pad: number, v: number): void {
    const cx0 = Math.max(0, Math.floor(o.x0 - pad - this.x0));
    const cx1 = Math.min(this.w - 1, Math.floor(o.x1 + pad - this.x0 - 1e-6));
    const cy0 = Math.max(0, Math.floor(o.y0 - pad - this.y0));
    const cy1 = Math.min(this.h - 1, Math.floor(o.y1 + pad - this.y0 - 1e-6));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.blocked[cy * this.w + cx] = v;
  }

  setDoor(o: Obstacle): void {
    this.markBox(o, 0.35, o.open ? 0 : 1);
  }

  cellOf(x: number, y: number): number {
    const cx = Math.floor(x - this.x0), cy = Math.floor(y - this.y0);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return -1;
    return cy * this.w + cx;
  }

  isFree(x: number, y: number): boolean {
    const c = this.cellOf(x, y);
    return c >= 0 && this.blocked[c] === 0;
  }

  reachable(x: number, y: number): boolean {
    const c = this.cellOf(x, y);
    return c >= 0 && this.blocked[c] === 0 && this.dist[c] < INF;
  }

  distAt(x: number, y: number): number {
    const c = this.cellOf(x, y);
    if (c < 0) return INF;
    return this.dist[c];
  }

  /** 从目标点（玩家）计算整图距离场：Dijkstra，直线代价 10，斜线 14 */
  computeFlow(tx: number, ty: number): void {
    this.computeFlowMulti([{ x: tx, y: ty }]);
  }

  /** 多源流场（第2版联机）：以所有可追击的玩家为起点，丧尸沿流场追踪最近的玩家 */
  computeFlowMulti(pts: readonly { x: number; y: number }[]): void {
    const dist = this.dist;
    const w = this.w, blocked = this.blocked;
    this.heapSize = 0;
    let seeded = 0;
    for (const p of pts) {
      let start = this.cellOf(p.x, p.y);
      if (start < 0) continue;
      if (blocked[start]) {
        // 找最近的空格
        let found = -1;
        for (let r = 1; r < 4 && found < 0; r++) {
          for (let dy = -r; dy <= r && found < 0; dy++) for (let dx = -r; dx <= r; dx++) {
            const c = start + dy * w + dx;
            if (c >= 0 && c < blocked.length && !blocked[c]) { found = c; break; }
          }
        }
        if (found < 0) continue;
        start = found;
      }
      if (!seeded) dist.fill(INF);
      if (dist[start] === 0) continue;
      dist[start] = 0;
      this.push(start, 0);
      if (!seeded) this.targetCell = start;
      seeded++;
    }
    if (!seeded) return;
    const h = this.h;
    while (this.heapSize > 0) {
      const k = this.heapKey[0];
      const c = this.pop();
      if (k > dist[c]) continue;
      const cx = c % w, cy = (c - cx) / w;
      const l = cx > 0, r = cx < w - 1, d = cy > 0, u = cy < h - 1;
      const fl = l && !blocked[c - 1], fr = r && !blocked[c + 1], fd = d && !blocked[c - w], fu = u && !blocked[c + w];
      if (fl) this.relax(c - 1, k + 10);
      if (fr) this.relax(c + 1, k + 10);
      if (fd) this.relax(c - w, k + 10);
      if (fu) this.relax(c + w, k + 10);
      if (fl && fd && !blocked[c - w - 1]) this.relax(c - w - 1, k + 14);
      if (fr && fd && !blocked[c - w + 1]) this.relax(c - w + 1, k + 14);
      if (fl && fu && !blocked[c + w - 1]) this.relax(c + w - 1, k + 14);
      if (fr && fu && !blocked[c + w + 1]) this.relax(c + w + 1, k + 14);
    }
  }

  private relax(c: number, nd: number): void {
    if (nd < this.dist[c]) {
      this.dist[c] = nd;
      this.push(c, nd);
    }
  }

  private push(idx: number, key: number): void {
    if (this.heapSize >= this.heapIdx.length) return;
    let i = this.heapSize++;
    const hi = this.heapIdx, hk = this.heapKey;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] <= key) break;
      hi[i] = hi[p];
      hk[i] = hk[p];
      i = p;
    }
    hi[i] = idx;
    hk[i] = key;
  }

  private pop(): number {
    const hi = this.heapIdx, hk = this.heapKey;
    const top = hi[0];
    const n = --this.heapSize;
    if (n > 0) {
      const idx = hi[n], key = hk[n];
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && hk[c + 1] < hk[c]) c++;
        if (hk[c] >= key) break;
        hi[i] = hi[c];
        hk[i] = hk[c];
        i = c;
      }
      hi[i] = idx;
      hk[i] = key;
    }
    return top;
  }

  /** 流场方向：取 8 邻格中距离最小者；返回 false 表示无可用方向 */
  dirAt(x: number, y: number, out: { x: number; y: number }): boolean {
    const c = this.cellOf(x, y);
    if (c < 0) return false;
    const w = this.w, dist = this.dist, blocked = this.blocked;
    const cx = c % w, cy = (c - cx) / w;
    let best = dist[c], bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= this.h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        if (nx < 0 || nx >= w) continue;
        const n = ny * w + nx;
        if (blocked[n]) continue;
        if (dx && dy && (blocked[cy * w + nx] || blocked[ny * w + cx])) continue;
        const v = dist[n];
        if (v < best) { best = v; bx = dx; by = dy; }
      }
    }
    if (bx === 0 && by === 0) return false;
    // 朝向邻格中心（带亚格修正，防止贴墙抖动）
    const tx = this.x0 + cx + bx + 0.5, ty = this.y0 + cy + by + 0.5;
    let vx = tx - x, vy = ty - y;
    const l = Math.hypot(vx, vy) || 1;
    out.x = vx / l;
    out.y = vy / l;
    return true;
  }
}
