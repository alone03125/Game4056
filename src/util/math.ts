// 2D 数学工具。游戏逻辑全部在 XY 平面（y 为“北/屏幕上方”），渲染时映射到 three 的 (x, h, -y)。

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}
export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(dist2(ax, ay, bx, by));
}
export function angleTo(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax);
}
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
export function approach(cur: number, target: number, step: number): number {
  if (cur < target) return Math.min(target, cur + step);
  return Math.max(target, cur - step);
}
/** 指数平滑系数：给定每秒保留比例 */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

export interface AABB {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

export function pointInAABB(x: number, y: number, b: AABB, pad = 0): boolean {
  return x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;
}

/** 圆与 AABB 的最小分离向量；不相交时返回 false。结果写入 out。 */
export function circleAABBPush(cx: number, cy: number, r: number, b: AABB, out: { x: number; y: number }): boolean {
  const nx = clamp(cx, b.x0, b.x1);
  const ny = clamp(cy, b.y0, b.y1);
  let dx = cx - nx, dy = cy - ny;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return false;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    out.x = dx * k;
    out.y = dy * k;
    return true;
  }
  // 圆心在盒内：沿最近边推出
  const left = cx - b.x0, right = b.x1 - cx, down = cy - b.y0, up = b.y1 - cy;
  const m = Math.min(left, right, down, up);
  out.x = 0;
  out.y = 0;
  if (m === left) out.x = -(left + r);
  else if (m === right) out.x = right + r;
  else if (m === down) out.y = -(down + r);
  else out.y = up + r;
  return true;
}

/** 线段与 AABB 相交（slab 法），返回进入参数 t∈[0,1]，不相交返回 -1；同时写出法线。 */
export function segAABB(
  x0: number, y0: number, x1: number, y1: number, b: AABB, pad: number, nOut?: { x: number; y: number },
): number {
  const dx = x1 - x0, dy = y1 - y0;
  let tmin = 0, tmax = 1;
  let nx = 0, ny = 0;
  const bx0 = b.x0 - pad, bx1 = b.x1 + pad, by0 = b.y0 - pad, by1 = b.y1 + pad;
  if (Math.abs(dx) < 1e-9) {
    if (x0 < bx0 || x0 > bx1) return -1;
  } else {
    let t1 = (bx0 - x0) / dx, t2 = (bx1 - x0) / dx;
    let n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = n; ny = 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) {
    if (y0 < by0 || y0 > by1) return -1;
  } else {
    let t1 = (by0 - y0) / dy, t2 = (by1 - y0) / dy;
    let n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) { tmin = t1; nx = 0; ny = n; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmin <= 0 && pointInAABB(x0, y0, { x0: bx0, y0: by0, x1: bx1, y1: by1 })) {
    // 起点已在盒内
    if (nOut) { nOut.x = -Math.sign(dx) || 0; nOut.y = -Math.sign(dy) || 0; }
    return 0;
  }
  if (nOut) { nOut.x = nx; nOut.y = ny; }
  return tmin;
}

export function fmtTime(sec: number): string {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function round(v: number, d = 2): number {
  const k = Math.pow(10, d);
  return Math.round(v * k) / k;
}
