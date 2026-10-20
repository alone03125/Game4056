// 区域地图生成：每个区域是一块大致矩形的废墟街区，起点与安全屋位于对角。
// 安全屋位于区域上方的角落，出入口均在房间角落；出口随机设在左上角或右上角，
// 决定下一个区域向左还是向右延伸，因此整条路线是一条向上蜿蜒的折线。

import { AABB, pointInAABB, aabbOverlap } from '../util/math';
import { Rng } from '../util/rng';
import { ZoneCfg, ZONES, ZONE_W, ZONE_H, BOSS_W, BOSS_H, SAFEHOUSE } from '../config';

export type ObKind =
  | 'wall' | 'tower' | 'car' | 'barrier' | 'rubble' | 'crate' | 'barrel' | 'tree' | 'container'
  | 'pillar' | 'border' | 'roomwall' | 'door' | 'station' | 'sandbag' | 'lamp' | 'fountain' | 'bleacher'
  | 'pyre'; // 第4.1次调整：区域任务“点燃火堆”的可燃物堆（由 quest.ts 放置，单独渲染）

export interface Obstacle extends AABB {
  id: number;
  h: number;
  kind: ObKind;
  variant: number;
  open?: boolean; // 门
  fade?: boolean; // 高楼遮挡淡出
  rot?: number; // 车辆等的朝向（仅视觉；碰撞仍为 AABB）
  mark?: number; // 空间查询去重用
}

export type PropKind = 'debris' | 'tire' | 'fire' | 'puddle' | 'bones' | 'bench' | 'sign' | 'papers' | 'cone' | 'bed' | 'rack';
export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  rot: number;
  s: number;
}

export type BlockType = 'ruin' | 'tower' | 'parking' | 'park' | 'rubble' | 'industrial' | 'plaza';
export interface Block {
  rect: AABB;
  type: BlockType;
  inner?: AABB; // 建筑室内地面
}

export type Side = 'L' | 'R';

export interface RoomInfo {
  rect: AABB;
  interior: AABB;
  entranceDoor: Obstacle;
  exitDoor: Obstacle;
  exitSide: Side;
  exitTrigger: AABB;
  altar: { x: number; y: number };
  shop: { x: number; y: number };
  suit: { x: number; y: number }; // 第2版：防护服柜（需手动拿取高一阶的防护服）
  medkit: { x: number; y: number }; // 第3次调整：医疗箱（进入安全屋不再自动回满生命）
  /** 第3次调整：第五区（尸王广场）的安全屋没有祭坛、商店和防护服柜（这些位置为 NaN） */
  minimal: boolean;
  zoneIndex: number; // 属于第几区的安全屋
  obstacles: Obstacle[];
  props: Prop[];
}

export interface ZoneLayout {
  index: number;
  cfg: ZoneCfg;
  rect: AABB;
  bounds: AABB;
  isBoss: boolean;
  startSide: Side;
  safeSide: Side;
  prevRoom: RoomInfo | null;
  safeRoom: RoomInfo | null;
  startPos: { x: number; y: number };
  obstacles: Obstacle[];
  props: Prop[];
  blocks: Block[];
  streets: AABB[];
  itemSpots: { x: number; y: number }[];
  bossSpawn?: { x: number; y: number };
  seed: number;
}

let obId = 1;

class Builder {
  obstacles: Obstacle[] = [];
  props: Prop[] = [];
  constructor(public rng: Rng) {}
  ob(x0: number, y0: number, x1: number, y1: number, h: number, kind: ObKind, variant = 0, extra?: Partial<Obstacle>): Obstacle {
    const o: Obstacle = {
      id: obId++,
      x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1),
      h, kind, variant, ...extra,
    };
    this.obstacles.push(o);
    return o;
  }
  prop(kind: PropKind, x: number, y: number, rot = 0, s = 1): void {
    this.props.push({ kind, x, y, rot, s });
  }
  free(x: number, y: number, r: number): boolean {
    const box = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
    for (const o of this.obstacles) if (aabbOverlap(box, o)) return false;
    return true;
  }
  freeBox(b: AABB): boolean {
    for (const o of this.obstacles) if (aabbOverlap(b, o)) return false;
    return true;
  }
}

function makeRoom(b: Builder, rx0: number, ry0: number, entranceInnerSide: Side, exitSide: Side, zoneIndex: number, minimal = false): RoomInfo {
  const RW = SAFEHOUSE.roomW, RH = SAFEHOUSE.roomH, t = 0.8, dw = 3.0;
  const ob0 = b.obstacles.length, pr0 = b.props.length;
  const rx1 = rx0 + RW, ry1 = ry0 + RH;
  const rect = { x0: rx0, y0: ry0, x1: rx1, y1: ry1 };
  const interior = { x0: rx0 + t, y0: ry0 + t, x1: rx1 - t, y1: ry1 - t };
  // 门的位置（房间角落）
  const entX0 = entranceInnerSide === 'L' ? rx0 + t + 0.6 : rx1 - t - 0.6 - dw;
  const exX0 = exitSide === 'L' ? rx0 + t + 0.6 : rx1 - t - 0.6 - dw;
  // 底墙（含入口）
  b.ob(rx0, ry0, entX0, ry0 + t, 4.2, 'roomwall');
  b.ob(entX0 + dw, ry0, rx1, ry0 + t, 4.2, 'roomwall');
  const entranceDoor = b.ob(entX0, ry0, entX0 + dw, ry0 + t, 3.6, 'door', 0, { open: true });
  // 顶墙（含出口）
  b.ob(rx0, ry1 - t, exX0, ry1, 4.2, 'roomwall');
  b.ob(exX0 + dw, ry1 - t, rx1, ry1, 4.2, 'roomwall');
  const exitDoor = b.ob(exX0, ry1 - t, exX0 + dw, ry1, 3.6, 'door', 1, { open: false });
  // 侧墙
  b.ob(rx0, ry0 + t, rx0 + t, ry1 - t, 4.2, 'roomwall');
  b.ob(rx1 - t, ry0 + t, rx1, ry1 - t, 4.2, 'roomwall');
  // 设施
  const cy = ry0 + RH / 2;
  const none = { x: NaN, y: NaN };
  const altar = minimal ? none : { x: rx0 + 5.2, y: cy };
  const shop = minimal ? none : { x: rx1 - 5.2, y: cy };
  const suit = minimal ? none : { x: rx0 + RW / 2, y: ry1 - t - 1.0 };
  if (!minimal) {
    b.ob(altar.x - 0.7, altar.y - 0.7, altar.x + 0.7, altar.y + 0.7, 1.6, 'station', 0);
    b.ob(shop.x - 0.9, shop.y - 0.5, shop.x + 0.9, shop.y + 0.5, 2.0, 'station', 1);
    b.ob(suit.x - 0.6, suit.y - 0.5, suit.x + 0.6, suit.y + 0.5, 2.2, 'station', 2);
  }
  // 医疗箱：防护服柜旁边（没有防护服柜时放在同样的位置）
  const medkit = { x: rx0 + RW / 2 + (minimal ? 0 : 2.3), y: ry1 - t - 0.9 };
  b.ob(medkit.x - 0.45, medkit.y - 0.35, medkit.x + 0.45, medkit.y + 0.35, 1.4, 'station', 3);
  b.prop('bed', rx0 + RW / 2, ry0 + t + 1.4, 0, 1);
  const exitTrigger = { x0: exX0 - 1, y0: ry1 - t - 3.2, x1: exX0 + dw + 1, y1: ry1 };
  return {
    rect, interior, entranceDoor, exitDoor, exitSide, exitTrigger, altar, shop, suit, medkit, minimal, zoneIndex,
    obstacles: b.obstacles.slice(ob0), props: b.props.slice(pr0),
  };
}

/** 生成一个普通区域（1~4）或 boss 区域（5 尸王广场 / 6 隐秘核心） */
export function generateZone(index: number, origin: { x0: number; y0: number }, startSide: Side, prevRoom: RoomInfo | null, seed: number): ZoneLayout {
  const rng = new Rng(seed);
  const cfg = ZONES[index - 1];
  const isBoss = index >= 5;
  const W = isBoss ? BOSS_W : ZONE_W;
  const H = isBoss ? BOSS_H : ZONE_H;
  const X0 = origin.x0, Y0 = origin.y0, X1 = X0 + W, Y1 = Y0 + H;
  const rect = { x0: X0, y0: Y0, x1: X1, y1: Y1 };
  const b = new Builder(rng);
  const safeSide: Side = startSide === 'L' ? 'R' : 'L';
  if (prevRoom) {
    for (const o of prevRoom.obstacles) b.obstacles.push(o);
    for (const pr of prevRoom.props) b.props.push(pr);
  }

  // 安全屋
  let safeRoom: RoomInfo | null = null;
  if (!isBoss) {
    const RW = SAFEHOUSE.roomW;
    const rx0 = safeSide === 'R' ? X1 - RW - 3 : X0 + 3;
    const inner: Side = safeSide === 'R' ? 'L' : 'R';
    safeRoom = makeRoom(b, rx0, Y1, inner, rng.chance(0.5) ? 'L' : 'R', index);
  } else if (index === 5) {
    // 第3次调整：尸王广场的看台后面有一间上锁的安全屋，只有在辐射进入橙色之前击败牢大丧尸才会打开（通往第六区）
    const RW = SAFEHOUSE.roomW;
    const rx0 = Math.round((X0 + X1) / 2 - RW / 2);
    safeRoom = makeRoom(b, rx0, Y1, rng.chance(0.5) ? 'L' : 'R', rng.chance(0.5) ? 'L' : 'R', index, true);
    safeRoom.entranceDoor.open = false;
  }

  // 边界墙（在房间所在的 x 范围留出缺口，由房间墙体接替）
  const bt = 0.9;
  const borderH = 3.2;
  const hSeg = (y0: number, y1: number, gap: AABB | null) => {
    if (!gap) { b.ob(X0 - bt, y0, X1 + bt, y1, borderH, 'border'); return; }
    if (gap.x0 > X0 - bt) b.ob(X0 - bt, y0, gap.x0, y1, borderH, 'border');
    if (gap.x1 < X1 + bt) b.ob(gap.x1, y0, X1 + bt, y1, borderH, 'border');
  };
  hSeg(Y0 - bt, Y0, prevRoom ? prevRoom.rect : null);
  hSeg(Y1, Y1 + bt, safeRoom ? safeRoom.rect : null);
  b.ob(X0 - bt, Y0, X0, Y1, borderH, 'border');
  b.ob(X1, Y0, X1 + bt, Y1, borderH, 'border');

  const blocks: Block[] = [];
  const streets: AABB[] = [];
  let startPos: { x: number; y: number };
  let bossSpawn: { x: number; y: number } | undefined;

  if (prevRoom) {
    const d = prevRoom.exitDoor;
    startPos = { x: (d.x0 + d.x1) / 2, y: d.y0 - 2.2 };
  } else {
    startPos = { x: startSide === 'L' ? X0 + 6 : X1 - 6, y: Y0 + 6 };
  }

  if (isBoss) {
    const gate = safeRoom ? { x0: safeRoom.entranceDoor.x0 - 2.5, x1: safeRoom.entranceDoor.x1 + 2.5 } : null;
    genBossArena(b, rect, rng, blocks, gate, index);
    bossSpawn = { x: (X0 + X1) / 2, y: Y1 - 18 };
  } else {
    genCity(b, rect, rng, cfg, startSide, safeSide, blocks, streets, prevRoom, safeRoom);
  }

  // 清理出生点/门口附近的障碍
  const keepClear: AABB[] = [];
  keepClear.push({ x0: startPos.x - 3, y0: startPos.y - 3, x1: startPos.x + 3, y1: startPos.y + 3 });
  if (prevRoom) { const d = prevRoom.exitDoor; keepClear.push({ x0: d.x0 - 2.5, y0: d.y1, x1: d.x1 + 2.5, y1: d.y1 + 5 }); }
  if (safeRoom) { const d = safeRoom.entranceDoor; keepClear.push({ x0: d.x0 - 2.5, y0: d.y0 - 5, x1: d.x1 + 2.5, y1: d.y0 }); }
  b.obstacles = b.obstacles.filter((o) => {
    if (o.kind === 'border' || o.kind === 'roomwall' || o.kind === 'door' || o.kind === 'station') return true;
    return !keepClear.some((k) => aabbOverlap(k, o));
  });

  // 道具点
  const itemSpots: { x: number; y: number }[] = [];
  if (!isBoss) {
    const cands: { x: number; y: number; w: number }[] = [];
    for (const bl of blocks) {
      if (bl.type === 'plaza') continue;
      const area = bl.inner ?? bl.rect;
      for (let i = 0; i < 6; i++) {
        const x = rng.range(area.x0 + 1.2, area.x1 - 1.2);
        const y = rng.range(area.y0 + 1.2, area.y1 - 1.2);
        if (!b.free(x, y, 0.9)) continue;
        cands.push({ x, y, w: bl.type === 'ruin' ? 3 : 1 });
      }
    }
    for (const s of streets) {
      for (let i = 0; i < 2; i++) {
        const x = rng.range(s.x0 + 1, s.x1 - 1), y = rng.range(s.y0 + 1, s.y1 - 1);
        if (b.free(x, y, 0.9)) cands.push({ x, y, w: 0.4 });
      }
    }
    rng.shuffle(cands);
    cands.sort((a, c) => c.w * rng.next() - a.w * rng.next());
    for (const c of cands) {
      if (itemSpots.length >= 40) break;
      if (Math.hypot(c.x - startPos.x, c.y - startPos.y) < 14) continue;
      if (itemSpots.some((s) => Math.hypot(s.x - c.x, s.y - c.y) < 9)) continue;
      itemSpots.push({ x: c.x, y: c.y });
    }
  }

  const bounds = {
    x0: Math.min(X0, prevRoom ? prevRoom.rect.x0 : X0, safeRoom ? safeRoom.rect.x0 : X0) - 2,
    y0: (prevRoom ? prevRoom.rect.y0 : Y0) - 2,
    x1: Math.max(X1, prevRoom ? prevRoom.rect.x1 : X1, safeRoom ? safeRoom.rect.x1 : X1) + 2,
    y1: (safeRoom ? safeRoom.rect.y1 : Y1) + 2,
  };

  return {
    index, cfg, rect, bounds, isBoss, startSide, safeSide, prevRoom, safeRoom, startPos,
    obstacles: b.obstacles, props: b.props, blocks, streets, itemSpots, bossSpawn, seed,
  };
}

/** 根据上一个安全屋的出口位置计算下一区域的原点与起点方向 */
export function nextZoneOrigin(room: RoomInfo, nextIndex: number): { origin: { x0: number; y0: number }; startSide: Side } {
  const W = nextIndex >= 5 ? BOSS_W : ZONE_W;
  if (room.exitSide === 'L') {
    return { origin: { x0: room.rect.x1 + 3 - W, y0: room.rect.y1 }, startSide: 'R' };
  }
  return { origin: { x0: room.rect.x0 - 3, y0: room.rect.y1 }, startSide: 'L' };
}

function genCity(
  b: Builder, rect: AABB, rng: Rng, cfg: ZoneCfg, startSide: Side, safeSide: Side,
  blocks: Block[], streets: AABB[], prevRoom: RoomInfo | null, safeRoom: RoomInfo | null,
): void {
  const W = rect.x1 - rect.x0, H = rect.y1 - rect.y0;
  const nX = 4, nY = 5;
  const sw = 7; // 街道宽
  const edge = 3.2; // 边界街道宽
  const xs: number[] = [rect.x0];
  for (let i = 1; i < nX; i++) xs.push(rect.x0 + (i * W) / nX + rng.range(-2.5, 2.5));
  xs.push(rect.x1);
  const ys: number[] = [rect.y0];
  for (let j = 1; j < nY; j++) ys.push(rect.y0 + (j * H) / nY + rng.range(-2.5, 2.5));
  ys.push(rect.y1);
  const half = (arr: number[], i: number) => (i === 0 || i === arr.length - 1 ? edge : sw / 2);

  // 街道矩形（用于地面绘制与杂物）
  for (let i = 1; i < nX; i++) streets.push({ x0: xs[i] - sw / 2, y0: rect.y0, x1: xs[i] + sw / 2, y1: rect.y1 });
  for (let j = 1; j < nY; j++) streets.push({ x0: rect.x0, y0: ys[j] - sw / 2, x1: rect.x1, y1: ys[j] + sw / 2 });
  streets.push({ x0: rect.x0, y0: rect.y0, x1: rect.x0 + edge, y1: rect.y1 });
  streets.push({ x0: rect.x1 - edge, y0: rect.y0, x1: rect.x1, y1: rect.y1 });
  streets.push({ x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y0 + edge });
  streets.push({ x0: rect.x0, y0: rect.y1 - edge, x1: rect.x1, y1: rect.y1 });

  const typeWeights: [BlockType, number][] = (() => {
    switch (cfg.index) {
      case 2: return [['ruin', 34], ['tower', 8], ['parking', 12], ['park', 6], ['rubble', 12], ['industrial', 28]];
      case 3: return [['ruin', 42], ['tower', 12], ['parking', 10], ['park', 20], ['rubble', 10], ['industrial', 6]];
      case 4: return [['ruin', 48], ['tower', 14], ['parking', 10], ['park', 6], ['rubble', 16], ['industrial', 6]];
      default: return [['ruin', 44], ['tower', 12], ['parking', 16], ['park', 12], ['rubble', 10], ['industrial', 6]];
    }
  })();

  const startCol = startSide === 'L' ? 0 : nX - 1;
  const safeCol = safeSide === 'L' ? 0 : nX - 1;
  // 上一个安全屋出口下方的格子也保持开阔
  const prevCol = prevRoom ? Math.max(0, Math.min(nX - 1, xs.findIndex((x) => x > (prevRoom.exitDoor.x0 + prevRoom.exitDoor.x1) / 2) - 1)) : -1;
  const safeEntCol = safeRoom ? Math.max(0, Math.min(nX - 1, xs.findIndex((x) => x > (safeRoom.entranceDoor.x0 + safeRoom.entranceDoor.x1) / 2) - 1)) : -1;

  for (let j = 0; j < nY; j++) {
    for (let i = 0; i < nX; i++) {
      const r: AABB = {
        x0: xs[i] + half(xs, i), x1: xs[i + 1] - half(xs, i + 1),
        y0: ys[j] + half(ys, j), y1: ys[j + 1] - half(ys, j + 1),
      };
      let type: BlockType;
      if ((j === 0 && (i === startCol || i === prevCol)) || (j === nY - 1 && (i === safeCol || i === safeEntCol))) type = 'plaza';
      else type = rng.weighted(typeWeights);
      const bl: Block = { rect: r, type };
      blocks.push(bl);
      switch (type) {
        case 'ruin': genRuin(b, bl, rng, cfg); break;
        case 'tower': genTower(b, bl, rng); break;
        case 'parking': genParking(b, bl, rng); break;
        case 'park': genPark(b, bl, rng, cfg); break;
        case 'rubble': genRubble(b, bl, rng, cfg); break;
        case 'industrial': genIndustrial(b, bl, rng); break;
        case 'plaza': genPlaza(b, bl, rng); break;
      }
    }
  }

  // 街道杂物（不完全堵塞街道）
  for (let i = 1; i < nX; i++) {
    for (let k = 0; k < 6; k++) {
      const y = rng.range(rect.y0 + 8, rect.y1 - 8);
      const x = xs[i] + rng.sign() * rng.range(0.8, 2.0);
      streetClutter(b, rng, x, y, true, cfg);
    }
  }
  for (let j = 1; j < nY; j++) {
    for (let k = 0; k < 5; k++) {
      const x = rng.range(rect.x0 + 8, rect.x1 - 8);
      const y = ys[j] + rng.sign() * rng.range(0.8, 2.0);
      streetClutter(b, rng, x, y, false, cfg);
    }
  }
  // 路灯
  for (let i = 1; i < nX; i++) {
    for (let y = rect.y0 + 10; y < rect.y1 - 6; y += rng.range(14, 22)) {
      const x = xs[i] + (rng.chance(0.5) ? -sw / 2 + 0.4 : sw / 2 - 0.4);
      if (b.free(x, y, 0.5)) b.ob(x - 0.15, y - 0.15, x + 0.15, y + 0.15, 4.5, 'lamp', rng.int(0, 3));
    }
  }
  // 散落杂物（视觉）
  for (let k = 0; k < 140; k++) {
    const x = rng.range(rect.x0 + 1, rect.x1 - 1), y = rng.range(rect.y0 + 1, rect.y1 - 1);
    const r = rng.next();
    if (r < 0.55) b.prop('debris', x, y, rng.range(0, 6.28), rng.range(0.5, 1.4));
    else if (r < 0.7) b.prop('papers', x, y, rng.range(0, 6.28), 1);
    else if (r < 0.8) b.prop('tire', x, y, rng.range(0, 6.28), 1);
    else if (r < 0.88) b.prop('bones', x, y, rng.range(0, 6.28), 1);
    else if (r < 0.94) b.prop('cone', x, y, rng.range(0, 6.28), 1);
    else if (cfg.index >= 3) b.prop('puddle', x, y, rng.range(0, 6.28), rng.range(0.8, 2.0));
  }
  if (cfg.index === 4 || cfg.index === 2) {
    for (let k = 0; k < (cfg.index === 4 ? 16 : 7); k++) {
      const x = rng.range(rect.x0 + 3, rect.x1 - 3), y = rng.range(rect.y0 + 3, rect.y1 - 3);
      if (b.free(x, y, 0.8)) b.prop('fire', x, y, 0, rng.range(0.8, 1.4));
    }
  }
}

function streetClutter(b: Builder, rng: Rng, x: number, y: number, vertical: boolean, cfg: ZoneCfg): void {
  const r = rng.next();
  if (r < 0.4) {
    // 车辆残骸：沿街道方向
    const w = 2.0, l = 4.3;
    const box = vertical ? { x0: x - w / 2, y0: y - l / 2, x1: x + w / 2, y1: y + l / 2 } : { x0: x - l / 2, y0: y - w / 2, x1: x + l / 2, y1: y + w / 2 };
    if (b.freeBox(pad(box, 1.2))) b.ob(box.x0, box.y0, box.x1, box.y1, 1.45, 'car', rng.int(0, 5), { rot: vertical ? (rng.chance(0.5) ? 0 : Math.PI) : (rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2) });
  } else if (r < 0.6) {
    const box = vertical ? { x0: x - 0.35, y0: y - 1.3, x1: x + 0.35, y1: y + 1.3 } : { x0: x - 1.3, y0: y - 0.35, x1: x + 1.3, y1: y + 0.35 };
    if (b.freeBox(pad(box, 1))) b.ob(box.x0, box.y0, box.x1, box.y1, 0.95, 'barrier', rng.int(0, 2));
  } else if (r < 0.8) {
    const s = rng.range(0.8, 1.5);
    if (b.free(x, y, s + 1)) b.ob(x - s, y - s * 0.8, x + s, y + s * 0.8, rng.range(0.7, 1.4), 'rubble', rng.int(0, 5));
  } else {
    if (b.free(x, y, 1.2)) b.ob(x - 0.4, y - 0.4, x + 0.4, y + 0.4, 1.05, 'barrel', cfg.index >= 2 && rng.chance(0.5) ? 1 : 0);
  }
}

function pad(a: AABB, p: number): AABB {
  return { x0: a.x0 - p, y0: a.y0 - p, x1: a.x1 + p, y1: a.y1 + p };
}

function genRuin(b: Builder, bl: Block, rng: Rng, cfg: ZoneCfg): void {
  const m = rng.range(1.2, 2.6);
  const r = { x0: bl.rect.x0 + m, y0: bl.rect.y0 + m, x1: bl.rect.x1 - m, y1: bl.rect.y1 - m };
  bl.inner = r;
  const t = 0.6;
  const baseH = rng.range(2.3, 4.2);
  const variant = cfg.index === 3 && rng.chance(0.6) ? 1 : rng.int(0, 2) === 0 ? 2 : 0; // 0 混凝土 1 白墙 2 红砖
  // 每条边的门洞
  const sides = [0, 1, 2, 3];
  rng.shuffle(sides);
  const doorCount = rng.int(2, 3);
  const doorSides = new Set(sides.slice(0, doorCount));
  const wallSide = (a: number, c: number, fixed: number, horizontal: boolean, hasDoor: boolean) => {
    const len = c - a;
    const gaps: [number, number][] = [];
    if (hasDoor) {
      const dw = rng.range(2.8, 3.6);
      const p = rng.range(a + 1.6, c - 1.6 - dw);
      gaps.push([p, p + dw]);
    }
    // 坍塌缺口
    if (len > 10 && rng.chance(0.35)) {
      const gw = rng.range(1.8, 3.0);
      const p = rng.range(a + 1.5, c - 1.5 - gw);
      if (!gaps.some((g) => p < g[1] + 1 && p + gw > g[0] - 1)) {
        gaps.push([p, p + gw]);
        const cx = horizontal ? p + gw / 2 : fixed, cy = horizontal ? fixed : p + gw / 2;
        b.prop('debris', cx, cy, rng.range(0, 6), 1.6);
      }
    }
    gaps.sort((g1, g2) => g1[0] - g2[0]);
    let cur = a;
    const segs: [number, number][] = [];
    for (const g of gaps) { if (g[0] > cur) segs.push([cur, g[0]]); cur = g[1]; }
    if (cur < c) segs.push([cur, c]);
    for (const s of segs) {
      // 切分为高度参差的块
      let p = s[0];
      while (p < s[1] - 0.01) {
        const l = Math.min(s[1] - p, rng.range(1.6, 3.6));
        const h = Math.max(0.9, baseH * rng.range(0.55, 1.15));
        if (horizontal) b.ob(p, fixed - t / 2, p + l, fixed + t / 2, h, 'wall', variant);
        else b.ob(fixed - t / 2, p, fixed + t / 2, p + l, h, 'wall', variant);
        p += l;
      }
    }
  };
  wallSide(r.x0, r.x1, r.y0, true, doorSides.has(0));
  wallSide(r.x0, r.x1, r.y1, true, doorSides.has(1));
  wallSide(r.y0 + t / 2, r.y1 - t / 2, r.x0, false, doorSides.has(2));
  wallSide(r.y0 + t / 2, r.y1 - t / 2, r.x1, false, doorSides.has(3));
  // 内部隔墙
  if (rng.chance(0.55)) {
    const horizontal = rng.chance(0.5);
    if (horizontal) {
      const y = rng.range(r.y0 + 5, r.y1 - 5);
      const gx = rng.range(r.x0 + 2, r.x1 - 5);
      if (gx - r.x0 > 0.8) b.ob(r.x0 + t / 2, y - 0.25, gx, y + 0.25, baseH * 0.8, 'wall', variant);
      if (r.x1 - (gx + 3.2) > 0.8) b.ob(gx + 3.2, y - 0.25, r.x1 - t / 2, y + 0.25, baseH * 0.8, 'wall', variant);
    } else {
      const x = rng.range(r.x0 + 5, r.x1 - 5);
      const gy = rng.range(r.y0 + 2, r.y1 - 5);
      if (gy - r.y0 > 0.8) b.ob(x - 0.25, r.y0 + t / 2, x + 0.25, gy, baseH * 0.8, 'wall', variant);
      if (r.y1 - (gy + 3.2) > 0.8) b.ob(x - 0.25, gy + 3.2, x + 0.25, r.y1 - t / 2, baseH * 0.8, 'wall', variant);
    }
  }
  // 室内杂物
  const n = rng.int(1, 4);
  for (let i = 0; i < n; i++) {
    const x = rng.range(r.x0 + 2, r.x1 - 2), y = rng.range(r.y0 + 2, r.y1 - 2);
    const s = rng.range(0.45, 0.8);
    if (b.free(x, y, s + 1.4)) b.ob(x - s, y - s, x + s, y + s, rng.range(0.7, 1.4), rng.chance(0.7) ? 'crate' : 'rubble', rng.int(0, 3));
  }
  for (let i = 0; i < 4; i++) b.prop('debris', rng.range(r.x0 + 1, r.x1 - 1), rng.range(r.y0 + 1, r.y1 - 1), rng.range(0, 6), rng.range(0.6, 1.3));
}

function genTower(b: Builder, bl: Block, rng: Rng): void {
  const m = rng.range(1.5, 3);
  const r = { x0: bl.rect.x0 + m, y0: bl.rect.y0 + m, x1: bl.rect.x1 - m, y1: bl.rect.y1 - m };
  const h = rng.range(8, 15);
  if (rng.chance(0.5)) {
    b.ob(r.x0, r.y0, r.x1, r.y1, h, 'tower', rng.int(0, 2), { fade: true });
  } else {
    // L 形
    const cx = rng.range(r.x0 + 6, r.x1 - 6), cy = rng.range(r.y0 + 6, r.y1 - 6);
    b.ob(r.x0, r.y0, r.x1, cy, h, 'tower', rng.int(0, 2), { fade: true });
    if (rng.chance(0.5)) b.ob(r.x0, cy, cx, r.y1, h * rng.range(0.6, 0.9), 'tower', rng.int(0, 2), { fade: true });
    else b.ob(cx, cy, r.x1, r.y1, h * rng.range(0.6, 0.9), 'tower', rng.int(0, 2), { fade: true });
  }
  for (let i = 0; i < 6; i++) {
    const x = rng.range(bl.rect.x0, bl.rect.x1), y = rng.range(bl.rect.y0, bl.rect.y1);
    b.prop('debris', x, y, rng.range(0, 6), rng.range(0.6, 1.4));
  }
}

function genParking(b: Builder, bl: Block, rng: Rng): void {
  const r = bl.rect;
  const vertical = rng.chance(0.5);
  const w = 2.0, l = 4.3;
  if (vertical) {
    for (let x = r.x0 + 1.5; x < r.x1 - 2; x += rng.range(2.6, 4.2)) {
      for (const y of [r.y0 + 1 + l / 2, r.y1 - 1 - l / 2]) {
        if (rng.chance(0.55)) b.ob(x, y - l / 2, x + w, y + l / 2, 1.45, 'car', rng.int(0, 5), { rot: rng.chance(0.5) ? 0 : Math.PI });
      }
    }
  } else {
    for (let y = r.y0 + 1.5; y < r.y1 - 2; y += rng.range(2.6, 4.2)) {
      for (const x of [r.x0 + 1 + l / 2, r.x1 - 1 - l / 2]) {
        if (rng.chance(0.55)) b.ob(x - l / 2, y, x + l / 2, y + w, 1.45, 'car', rng.int(0, 5), { rot: rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2 });
      }
    }
  }
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  b.ob(cx - 0.15, cy - 0.15, cx + 0.15, cy + 0.15, 4.5, 'lamp', rng.int(0, 3));
  for (let i = 0; i < 3; i++) b.prop('tire', rng.range(r.x0, r.x1), rng.range(r.y0, r.y1), rng.range(0, 6), 1);
}

function genPark(b: Builder, bl: Block, rng: Rng, cfg: ZoneCfg): void {
  const r = bl.rect;
  const n = rng.int(5, 10);
  for (let i = 0; i < n; i++) {
    const x = rng.range(r.x0 + 1.5, r.x1 - 1.5), y = rng.range(r.y0 + 1.5, r.y1 - 1.5);
    if (b.free(x, y, 2.2)) b.ob(x - 0.3, y - 0.3, x + 0.3, y + 0.3, rng.range(3.5, 6), 'tree', rng.int(0, 3));
  }
  if (rng.chance(0.4)) {
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    if (b.free(cx, cy, 2.5)) b.ob(cx - 1.6, cy - 1.6, cx + 1.6, cy + 1.6, 0.9, 'fountain', 0);
  }
  for (let i = 0; i < 3; i++) b.prop('bench', rng.range(r.x0 + 1, r.x1 - 1), rng.range(r.y0 + 1, r.y1 - 1), rng.chance(0.5) ? 0 : Math.PI / 2, 1);
  if (cfg.index >= 3) for (let i = 0; i < 3; i++) b.prop('puddle', rng.range(r.x0, r.x1), rng.range(r.y0, r.y1), rng.range(0, 6), rng.range(1, 2.4));
}

function genRubble(b: Builder, bl: Block, rng: Rng, cfg: ZoneCfg): void {
  const r = bl.rect;
  const n = rng.int(5, 9);
  for (let i = 0; i < n; i++) {
    const x = rng.range(r.x0 + 1.5, r.x1 - 1.5), y = rng.range(r.y0 + 1.5, r.y1 - 1.5);
    const k = rng.next();
    if (k < 0.45) {
      const s = rng.range(0.9, 2.0);
      if (b.free(x, y, s + 1.3)) b.ob(x - s, y - s * 0.8, x + s, y + s * 0.8, rng.range(0.8, 1.8), 'rubble', rng.int(0, 5));
    } else if (k < 0.7) {
      const hz = rng.chance(0.5);
      const box = hz ? { x0: x - 1.3, y0: y - 0.35, x1: x + 1.3, y1: y + 0.35 } : { x0: x - 0.35, y0: y - 1.3, x1: x + 0.35, y1: y + 1.3 };
      if (b.freeBox(pad(box, 1.2))) b.ob(box.x0, box.y0, box.x1, box.y1, 0.9, 'sandbag', 0);
    } else if (k < 0.85) {
      if (b.free(x, y, 1.3)) b.ob(x - 0.4, y - 0.4, x + 0.4, y + 0.4, 1.05, 'barrel', cfg.index >= 2 && rng.chance(0.6) ? 1 : 0);
    } else {
      const box = { x0: x - 1.0, y0: y - 2.15, x1: x + 1.0, y1: y + 2.15 };
      if (b.freeBox(pad(box, 1.2))) b.ob(box.x0, box.y0, box.x1, box.y1, 1.45, 'car', rng.int(0, 5), { rot: rng.range(-0.2, 0.2) });
    }
  }
  for (let i = 0; i < 10; i++) b.prop('debris', rng.range(r.x0, r.x1), rng.range(r.y0, r.y1), rng.range(0, 6), rng.range(0.8, 1.8));
}

function genIndustrial(b: Builder, bl: Block, rng: Rng): void {
  const r = bl.rect;
  const vertical = rng.chance(0.5);
  const cw = 2.5, cl = 6.1;
  if (vertical) {
    for (let x = r.x0 + 1.2; x < r.x1 - cw; x += cw + rng.range(2.4, 4.5)) {
      if (rng.chance(0.25)) continue;
      const y = rng.range(r.y0 + 1, r.y1 - 1 - cl);
      b.ob(x, y, x + cw, y + cl, rng.chance(0.25) ? 5.2 : 2.6, 'container', rng.int(0, 4));
    }
  } else {
    for (let y = r.y0 + 1.2; y < r.y1 - cw; y += cw + rng.range(2.4, 4.5)) {
      if (rng.chance(0.25)) continue;
      const x = rng.range(r.x0 + 1, r.x1 - 1 - cl);
      b.ob(x, y, x + cl, y + cw, rng.chance(0.25) ? 5.2 : 2.6, 'container', rng.int(0, 4));
    }
  }
  for (let i = 0; i < 5; i++) {
    const x = rng.range(r.x0 + 1, r.x1 - 1), y = rng.range(r.y0 + 1, r.y1 - 1);
    if (b.free(x, y, 1.3)) {
      if (rng.chance(0.6)) b.ob(x - 0.4, y - 0.4, x + 0.4, y + 0.4, 1.05, 'barrel', 1);
      else b.ob(x - 0.6, y - 0.6, x + 0.6, y + 0.6, 1.2, 'crate', rng.int(0, 3));
    }
  }
}

function genPlaza(b: Builder, bl: Block, rng: Rng): void {
  const r = bl.rect;
  for (let i = 0; i < 2; i++) b.prop('bench', rng.range(r.x0 + 2, r.x1 - 2), rng.range(r.y0 + 2, r.y1 - 2), rng.chance(0.5) ? 0 : Math.PI / 2, 1);
  for (let i = 0; i < 2; i++) {
    const x = rng.range(r.x0 + 2, r.x1 - 2), y = rng.range(r.y0 + 2, r.y1 - 2);
    if (b.free(x, y, 3)) b.ob(x - 0.3, y - 0.3, x + 0.3, y + 0.3, rng.range(3.5, 5.5), 'tree', rng.int(0, 3));
  }
  for (let i = 0; i < 5; i++) b.prop('debris', rng.range(r.x0, r.x1), rng.range(r.y0, r.y1), rng.range(0, 6), rng.range(0.5, 1));
  b.prop('sign', (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0, 1);
}

/** Boss 场地：gate = 顶部看台为安全屋入口留出的缺口；index 6（隐秘核心）的柱子更多、掩体更少 */
function genBossArena(b: Builder, rect: AABB, rng: Rng, blocks: Block[], gate: { x0: number; x1: number } | null = null, index = 5): void {
  blocks.push({ rect, type: 'plaza' });
  const cx = (rect.x0 + rect.x1) / 2, cy = (rect.y0 + rect.y1) / 2;
  const core = index >= 6;
  // 环形柱子
  const n = core ? 10 : 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 8;
    const rr = core ? 22 : 20;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    b.ob(x - 1.1, y - 1.1, x + 1.1, y + 1.1, 6, 'pillar', i % 2);
  }
  if (core) {
    // 隐秘核心：内圈四根矮柱，可以躲避激光
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = cx + Math.cos(a) * 12, y = cy + Math.sin(a) * 12;
      b.ob(x - 0.8, y - 0.8, x + 0.8, y + 0.8, 3, 'pillar', 1);
    }
  }
  // 掩体
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = cx + Math.cos(a) * 11, y = cy + Math.sin(a) * 11;
    if (i % 2 === 0) b.ob(x - 1.4, y - 0.4, x + 1.4, y + 0.4, 0.9, 'sandbag', 0);
    else b.ob(x - 0.4, y - 1.4, x + 0.4, y + 1.4, 0.9, 'sandbag', 0);
  }
  // 看台（顶部看台在安全屋入口处断开）
  if (gate) {
    b.ob(rect.x0, rect.y1 - 3, gate.x0, rect.y1, 2.6, 'bleacher', 0);
    b.ob(gate.x1, rect.y1 - 3, rect.x1, rect.y1, 2.6, 'bleacher', 0);
  } else b.ob(rect.x0, rect.y1 - 3, rect.x1, rect.y1, 2.6, 'bleacher', 0);
  b.ob(rect.x0, rect.y0 + 6, rect.x0 + 3, rect.y1 - 3, 2.6, 'bleacher', 1);
  b.ob(rect.x1 - 3, rect.y0 + 6, rect.x1, rect.y1 - 3, 2.6, 'bleacher', 1);
  for (let i = 0; i < 40; i++) b.prop('debris', rng.range(rect.x0 + 4, rect.x1 - 4), rng.range(rect.y0 + 4, rect.y1 - 4), rng.range(0, 6), rng.range(0.6, 1.6));
  for (let i = 0; i < 10; i++) b.prop('fire', rng.range(rect.x0 + 5, rect.x1 - 5), rng.range(rect.y0 + 8, rect.y1 - 6), 0, rng.range(0.8, 1.3));
  for (let i = 0; i < 12; i++) b.prop('bones', rng.range(rect.x0 + 4, rect.x1 - 4), rng.range(rect.y0 + 4, rect.y1 - 4), rng.range(0, 6), 1);
}

export function inRect(x: number, y: number, r: AABB, pad = 0): boolean {
  return pointInAABB(x, y, r, pad);
}
