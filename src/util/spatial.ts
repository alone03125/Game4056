// 敌人用的均匀网格空间哈希（每帧重建）。

export interface HasPos {
  x: number;
  y: number;
  dead: boolean;
}

export class SpatialHash<T extends HasPos> {
  readonly cell: number;
  x0 = 0;
  y0 = 0;
  w = 1;
  h = 1;
  private head = new Int32Array(1);
  private next = new Int32Array(1024);
  private items: T[] = [];

  constructor(cell = 2) {
    this.cell = cell;
  }

  setBounds(x0: number, y0: number, x1: number, y1: number): void {
    this.x0 = x0;
    this.y0 = y0;
    this.w = Math.max(1, Math.ceil((x1 - x0) / this.cell));
    this.h = Math.max(1, Math.ceil((y1 - y0) / this.cell));
    this.head = new Int32Array(this.w * this.h).fill(-1);
  }

  rebuild(items: T[]): void {
    // 拷贝一份引用：外部列表在帧末会被压缩，不能直接用下标引用
    const arr = this.items;
    arr.length = items.length;
    for (let i = 0; i < items.length; i++) arr[i] = items[i];
    this.head.fill(-1);
    if (this.next.length < items.length) this.next = new Int32Array(items.length * 2);
    for (let i = 0; i < items.length; i++) {
      const it = arr[i];
      if (it.dead) continue;
      const c = this.cellIndex(it.x, it.y);
      this.next[i] = this.head[c];
      this.head[c] = i;
    }
  }

  private cellIndex(x: number, y: number): number {
    let cx = Math.floor((x - this.x0) / this.cell);
    let cy = Math.floor((y - this.y0) / this.cell);
    if (cx < 0) cx = 0; else if (cx >= this.w) cx = this.w - 1;
    if (cy < 0) cy = 0; else if (cy >= this.h) cy = this.h - 1;
    return cy * this.w + cx;
  }

  /** 遍历盒子范围内的元素；fn 返回 true 时提前结束 */
  queryBox(x0: number, y0: number, x1: number, y1: number, fn: (it: T, idx: number) => boolean | void): void {
    let cx0 = Math.floor((x0 - this.x0) / this.cell), cx1 = Math.floor((x1 - this.x0) / this.cell);
    let cy0 = Math.floor((y0 - this.y0) / this.cell), cy1 = Math.floor((y1 - this.y0) / this.cell);
    if (cx0 < 0) cx0 = 0;
    if (cy0 < 0) cy0 = 0;
    if (cx1 >= this.w) cx1 = this.w - 1;
    if (cy1 >= this.h) cy1 = this.h - 1;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        let i = this.head[cy * this.w + cx];
        while (i >= 0) {
          const it = this.items[i];
          if (!it.dead && fn(it, i) === true) return;
          i = this.next[i];
        }
      }
    }
  }

  queryRadius(x: number, y: number, r: number, fn: (it: T, d2: number) => boolean | void): void {
    const r2 = r * r;
    this.queryBox(x - r, y - r, x + r, y + r, (it) => {
      const dx = it.x - x, dy = it.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2) return fn(it, d2);
    });
  }
}
