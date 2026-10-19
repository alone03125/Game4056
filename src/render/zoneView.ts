// 把区域布局数据构建为 three.js 场景物体（静态合批 + 实例化）。

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../util/rng';
import { Obstacle, RoomInfo, ZoneLayout, Prop } from '../world/zone';
import * as T from './textures';
import * as M from './meshes';

const dummy = new THREE.Object3D();

/** 世界坐标、按面尺寸缩放 UV 的盒子（用于墙体合批） */
function worldBox(x0: number, y0: number, x1: number, y1: number, h: number, base: number, texScale: number): THREE.BufferGeometry {
  const w = x1 - x0, d = y1 - y0;
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[f][0] / texScale, uv.getY(i) * dims[f][1] / texScale);
    }
  }
  g.translate((x0 + x1) / 2, base + h / 2, -(y0 + y1) / 2);
  return g;
}

export interface LightSource {
  x: number;
  y: number;
  h: number;
  color: number;
  intensity: number;
  flicker: number;
}

export interface FireSprite {
  x: number;
  y: number;
  s: number;
  phase: number;
}

export class ZoneView {
  root = new THREE.Group();
  towers: { o: Obstacle; mesh: THREE.Mesh; mat: THREE.MeshLambertMaterial; fade: number }[] = [];
  doors = new Map<number, { o: Obstacle; mesh: THREE.Mesh; open: number }>();
  lights: LightSource[] = [];
  fires: FireSprite[] = [];
  fireMesh: THREE.InstancedMesh | null = null;
  /** 第2版：安全屋的防护服柜（展示下一阶防护服的人台） */
  suitStands: { room: RoomInfo; rig: M.PlayerRig; glow: THREE.MeshBasicMaterial; tier: number }[] = [];
  altarCrystal: THREE.Mesh | null = null;
  altarRing: THREE.Mesh | null = null;
  shopScreen: THREE.MeshBasicMaterial | null = null;
  puddleMat: THREE.MeshBasicMaterial | null = null;
  private disposables: { dispose(): void }[] = [];

  constructor(public layout: ZoneLayout, quality: number) {
    this.build(quality);
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.removeFromParent();
  }

  private build(quality: number): void {
    const L = this.layout;
    const pal = L.cfg.palette;
    const shadows = quality >= 1;
    const b = L.bounds;

    // 地面
    const gtex = this.track(T.paintGround(L));
    const gw = b.x1 - b.x0, gh = b.y1 - b.y0;
    const ground = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(gw, gh)),
      this.track(new THREE.MeshLambertMaterial({ map: gtex })),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((b.x0 + b.x1) / 2, 0, -(b.y0 + b.y1) / 2);
    ground.receiveShadow = shadows;
    this.root.add(ground);
    // 外部荒地
    const vt = T.voidTexture('#202020');
    vt.repeat.set(40, 40);
    const voidMesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(500, 500)), this.track(new THREE.MeshLambertMaterial({ map: vt, color: 0x6a6a6a })));
    voidMesh.rotation.x = -Math.PI / 2;
    voidMesh.position.set((b.x0 + b.x1) / 2, -0.03, -(b.y0 + b.y1) / 2);
    voidMesh.receiveShadow = shadows;
    this.root.add(voidMesh);

    // 分类
    const groups: Record<string, Obstacle[]> = {};
    for (const o of L.obstacles) (groups[o.kind] ??= []).push(o);

    // 墙体合批（按变体）
    const wallGeos: THREE.BufferGeometry[][] = [[], [], []];
    for (const o of groups.wall ?? []) wallGeos[o.variant % 3].push(worldBox(o.x0, o.y0, o.x1, o.y1, o.h, 0, 3));
    wallGeos.forEach((geos, v) => {
      if (!geos.length) return;
      const mat = this.track(new THREE.MeshLambertMaterial({ map: T.wallTexture(v, pal.wall) }));
      this.addMerged(geos, mat, shadows);
    });
    // 边界墙 + 铁丝网
    const borderGeos: THREE.BufferGeometry[] = [];
    const wireGeos: THREE.BufferGeometry[] = [];
    for (const o of groups.border ?? []) {
      borderGeos.push(worldBox(o.x0, o.y0, o.x1, o.y1, o.h, 0, 3));
      const along = o.x1 - o.x0 > o.y1 - o.y0;
      const len = along ? o.x1 - o.x0 : o.y1 - o.y0;
      for (let t = 0; t < len; t += 2.5) {
        const px = along ? o.x0 + t : (o.x0 + o.x1) / 2, py = along ? (o.y0 + o.y1) / 2 : o.y0 + t;
        wireGeos.push(worldBox(px - 0.05, py - 0.05, px + 0.05, py + 0.05, 1.1, o.h, 1));
      }
      wireGeos.push(along ? worldBox(o.x0, (o.y0 + o.y1) / 2 - 0.03, o.x1, (o.y0 + o.y1) / 2 + 0.03, 0.05, o.h + 0.9, 1) : worldBox((o.x0 + o.x1) / 2 - 0.03, o.y0, (o.x0 + o.x1) / 2 + 0.03, o.y1, 0.05, o.h + 0.9, 1));
      wireGeos.push(along ? worldBox(o.x0, (o.y0 + o.y1) / 2 - 0.03, o.x1, (o.y0 + o.y1) / 2 + 0.03, 0.05, o.h + 0.5, 1) : worldBox((o.x0 + o.x1) / 2 - 0.03, o.y0, (o.x0 + o.x1) / 2 + 0.03, o.y1, 0.05, o.h + 0.5, 1));
    }
    if (borderGeos.length) this.addMerged(borderGeos, this.track(new THREE.MeshLambertMaterial({ map: T.concreteTexture(), color: 0x9a968c })), shadows);
    if (wireGeos.length) this.addMerged(wireGeos, this.track(new THREE.MeshLambertMaterial({ color: 0x2a2a2a })), false);
    // 房间墙
    const rw = (groups.roomwall ?? []).map((o) => worldBox(o.x0, o.y0, o.x1, o.y1, o.h, 0, 2));
    if (rw.length) this.addMerged(rw, this.track(new THREE.MeshLambertMaterial({ map: T.roomWallTexture() })), shadows);
    // 柱子
    const pl = (groups.pillar ?? []).map((o) => worldBox(o.x0, o.y0, o.x1, o.y1, o.h, 0, 2));
    if (pl.length) this.addMerged(pl, this.track(new THREE.MeshLambertMaterial({ map: T.concreteTexture(), color: 0xb0a8b8 })), shadows);
    // 喷泉
    const fo = (groups.fountain ?? []).flatMap((o) => [
      worldBox(o.x0, o.y0, o.x1, o.y1, o.h, 0, 2),
    ]);
    if (fo.length) this.addMerged(fo, this.track(new THREE.MeshLambertMaterial({ map: T.concreteTexture(), color: 0x8a8a90 })), shadows);
    // 看台
    for (const o of groups.bleacher ?? []) {
      const g = M.bleacherGeometry(o.x1 - o.x0, o.y1 - o.y0, o.h);
      g.translate((o.x0 + o.x1) / 2, 0, -(o.y0 + o.y1) / 2);
      this.addMerged([g], this.track(new THREE.MeshLambertMaterial({ vertexColors: true })), shadows);
    }

    // 高楼（单独网格，遮挡玩家时淡出）
    for (const o of groups.tower ?? []) {
      const mat = this.track(new THREE.MeshLambertMaterial({
        map: T.towerTexture(o.variant), emissiveMap: T.towerEmissive(o.variant), emissive: 0xffffff, emissiveIntensity: 0.9, transparent: false,
      }));
      const geo = this.track(worldBox(o.x0, o.y0, o.x1, o.y1, o.h, 0, 8));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      this.root.add(mesh);
      // 顶部边缘
      const cap = new THREE.Mesh(this.track(worldBox(o.x0 - 0.2, o.y0 - 0.2, o.x1 + 0.2, o.y1 + 0.2, 0.4, o.h, 2)), mat);
      mesh.add(cap);
      this.towers.push({ o, mesh, mat, fade: 1 });
    }

    // 门
    for (const o of groups.door ?? []) {
      const mat = this.track(new THREE.MeshLambertMaterial({ map: T.stripeTexture() }));
      const mesh = new THREE.Mesh(this.track(new THREE.BoxGeometry(o.x1 - o.x0, o.h, o.y1 - o.y0)), mat);
      mesh.position.set((o.x0 + o.x1) / 2, o.h / 2, -(o.y0 + o.y1) / 2);
      mesh.castShadow = shadows;
      this.root.add(mesh);
      this.doors.set(o.id, { o, mesh, open: o.open ? 1 : 0 });
      // 门框灯
      const lampMat = this.track(new THREE.MeshBasicMaterial({ color: o.variant === 1 ? 0xff3a2a : 0x3aff8a }));
      const lamp = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.3, 0.3, 0.3)), lampMat);
      lamp.position.set(o.x1 + 0.3, o.h + 0.6, -(o.y0 + o.y1) / 2);
      lamp.userData.doorLamp = o.id;
      this.root.add(lamp);
      (this.doors.get(o.id) as any).lampMat = lampMat;
    }

    // 安全屋设施
    for (const room of [L.prevRoom, L.safeRoom]) {
      if (!room) continue;
      // 医疗箱（第3次调整）：墙边的白色急救箱 + 红十字
      const mk = room.medkit;
      const caseMat = this.track(new THREE.MeshLambertMaterial({ color: 0xe8e4dc }));
      const redMat = this.track(new THREE.MeshBasicMaterial({ color: 0xe02a2a }));
      const stand = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.9, 0.9, 0.6)), this.track(new THREE.MeshLambertMaterial({ color: 0x3a3e44 })));
      stand.position.set(mk.x, 0.45, -mk.y);
      stand.castShadow = shadows;
      this.root.add(stand);
      const box = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.8, 0.5, 0.5)), caseMat);
      box.position.set(mk.x, 1.15, -mk.y);
      box.castShadow = shadows;
      this.root.add(box);
      for (const [sx, sz] of [[0.42, 0.12], [0.12, 0.42]]) {
        const cross = new THREE.Mesh(this.track(new THREE.BoxGeometry(sx, 0.02, sz)), redMat);
        cross.position.set(mk.x, 1.41, -mk.y);
        this.root.add(cross);
        const front = new THREE.Mesh(this.track(new THREE.BoxGeometry(sx * 0.7, sz * 0.7 * 2.4, 0.02)), redMat);
        front.position.set(mk.x, 1.15, -mk.y + 0.26);
        this.root.add(front);
      }
      this.lights.push({ x: mk.x, y: mk.y - 0.8, h: 2.0, color: 0xff6a6a, intensity: 4, flicker: 0 });
      this.lights.push({ x: (room.rect.x0 + room.rect.x1) / 2, y: (room.rect.y0 + room.rect.y1) / 2, h: 3.6, color: 0xffd8a0, intensity: 12, flicker: 0 });
      if (room.minimal) continue;
      const a = room.altar;
      const base = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.8, 1.0, 1.0, 8)), this.track(new THREE.MeshLambertMaterial({ color: 0x2a2630 })));
      base.position.set(a.x, 0.5, -a.y);
      base.castShadow = shadows;
      this.root.add(base);
      const crystal = new THREE.Mesh(this.track(new THREE.OctahedronGeometry(0.45, 0)), this.track(new THREE.MeshBasicMaterial({ color: 0xc06aff })));
      crystal.position.set(a.x, 2.0, -a.y);
      this.root.add(crystal);
      const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(0.75, 0.04, 6, 24)), this.track(new THREE.MeshBasicMaterial({ color: 0xe0a0ff })));
      ring.position.copy(crystal.position);
      this.root.add(ring);
      if (room === L.prevRoom || !L.prevRoom) { this.altarCrystal = crystal; this.altarRing = ring; }
      const s = room.shop;
      const vend = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.8, 2.0, 1.0)), this.track(new THREE.MeshLambertMaterial({ color: 0x8a2a2a })));
      vend.position.set(s.x, 1.0, -s.y);
      vend.castShadow = shadows;
      this.root.add(vend);
      const scrMat = this.track(new THREE.MeshBasicMaterial({ color: 0x4affd8 }));
      const scr = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.3, 0.9)), scrMat);
      scr.position.set(s.x, 1.35, -s.y + 0.51);
      this.root.add(scr);
      this.shopScreen = scrMat;
      // 防护服柜：玻璃柜 + 人台
      const su = room.suit;
      const frameMat = this.track(new THREE.MeshLambertMaterial({ color: 0x3a3e44 }));
      const baseS = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.2, 0.2, 1.0)), frameMat);
      baseS.position.set(su.x, 0.1, -su.y);
      this.root.add(baseS);
      const topS = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.2, 0.12, 1.0)), frameMat);
      topS.position.set(su.x, 2.2, -su.y);
      this.root.add(topS);
      for (const [dx, dz] of [[-0.56, -0.46], [0.56, -0.46], [-0.56, 0.46], [0.56, 0.46]]) {
        const post = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.08, 2.0, 0.08)), frameMat);
        post.position.set(su.x + dx, 1.2, -su.y + dz);
        this.root.add(post);
      }
      const glass = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.1, 1.95, 0.9)), this.track(new THREE.MeshLambertMaterial({ color: 0x9ad8ff, transparent: true, opacity: 0.16, depthWrite: false })));
      glass.position.set(su.x, 1.2, -su.y);
      this.root.add(glass);
      const glowMat = this.track(new THREE.MeshBasicMaterial({ color: 0x7affc0 }));
      const strip = new THREE.Mesh(this.track(new THREE.BoxGeometry(1.0, 0.04, 0.04)), glowMat);
      strip.position.set(su.x, 2.12, -su.y + 0.5);
      this.root.add(strip);
      const rig = M.playerRig();
      rig.root.position.set(su.x, 0.2, -su.y);
      rig.root.rotation.y = -Math.PI / 2;
      rig.root.scale.setScalar(0.92);
      this.root.add(rig.root);
      this.suitStands.push({ room, rig, glow: glowMat, tier: -1 });
      this.lights.push({ x: su.x, y: su.y - 1.0, h: 2.2, color: 0x7affc0, intensity: 6, flicker: 0 });
      this.lights.push({ x: a.x, y: a.y, h: 2.4, color: 0xc06aff, intensity: 9, flicker: 0 });
      this.lights.push({ x: s.x, y: s.y - 1.2, h: 2.2, color: 0x4affd8, intensity: 7, flicker: 0 });
    }

    // —— 实例化物件 ——
    const cars = groups.car ?? [];
    for (let v = 0; v < 6; v++) {
      const list = cars.filter((o) => o.variant % 6 === v);
      if (!list.length) continue;
      const mesh = this.inst(M.carGeometry(v), this.track(new THREE.MeshLambertMaterial({ vertexColors: true })), list.length, shadows);
      list.forEach((o, i) => {
        dummy.position.set((o.x0 + o.x1) / 2, 0, -(o.y0 + o.y1) / 2);
        const longX = o.x1 - o.x0 > o.y1 - o.y0;
        dummy.rotation.set(0, (longX ? 0 : Math.PI / 2) + (o.rot ? (o.rot % Math.PI === 0 ? 0 : 0) : 0) + (o.id % 2 ? Math.PI : 0) + ((o.id * 0.37) % 0.16 - 0.08), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
    }
    this.instBoxes(groups.barrier ?? [], (o) => M.barrierGeometry(o.variant % 2), shadows, true);
    this.instBoxes(groups.barrel ?? [], (o) => M.barrelGeometry(o.variant % 2), shadows, false, 2);
    // 木箱
    const crates = groups.crate ?? [];
    if (crates.length) {
      const mesh = this.inst(this.track(new THREE.BoxGeometry(1, 1, 1)), this.track(new THREE.MeshLambertMaterial({ map: T.woodTexture() })), crates.length, shadows);
      crates.forEach((o, i) => {
        dummy.position.set((o.x0 + o.x1) / 2, o.h / 2, -(o.y0 + o.y1) / 2);
        dummy.rotation.set(0, (o.id % 7) * 0.1, 0);
        dummy.scale.set(o.x1 - o.x0, o.h, o.y1 - o.y0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
    }
    // 集装箱
    const cons = groups.container ?? [];
    if (cons.length) {
      const mesh = this.inst(this.track(new THREE.BoxGeometry(1, 1, 1)), this.track(new THREE.MeshLambertMaterial({ map: T.metalTexture('#b8b8b8', true, 2) })), cons.length, shadows);
      const cols = [0x9a3a2a, 0x2a5a8a, 0x3a7a4a, 0xc87a2a, 0x7a7a80];
      cons.forEach((o, i) => {
        dummy.position.set((o.x0 + o.x1) / 2, o.h / 2, -(o.y0 + o.y1) / 2);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(o.x1 - o.x0, o.h, o.y1 - o.y0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, new THREE.Color(cols[o.variant % cols.length]));
      });
    }
    // 树
    const trees = groups.tree ?? [];
    for (let v = 0; v < 4; v++) {
      const list = trees.filter((o) => o.variant % 4 === v);
      if (!list.length) continue;
      const mesh = this.inst(M.treeGeometry(v), this.track(new THREE.MeshLambertMaterial({ vertexColors: true })), list.length, false);
      list.forEach((o, i) => {
        dummy.position.set((o.x0 + o.x1) / 2, 0, -(o.y0 + o.y1) / 2);
        dummy.rotation.set(0, o.id * 1.3, 0);
        dummy.scale.set(o.h * 0.9, o.h, o.h * 0.9);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
    }
    // 路灯
    const lamps = groups.lamp ?? [];
    if (lamps.length) {
      const mesh = this.inst(M.lampGeometry(), this.track(new THREE.MeshLambertMaterial({ vertexColors: true })), lamps.length, shadows);
      const bulbs = this.inst(this.track(new THREE.BoxGeometry(0.4, 0.06, 0.24)), this.track(new THREE.MeshBasicMaterial({ color: 0xffd890 })), lamps.length, false);
      const rng = new Rng(L.seed + 5);
      lamps.forEach((o, i) => {
        const x = (o.x0 + o.x1) / 2, y = (o.y0 + o.y1) / 2;
        const rot = (o.variant % 4) * Math.PI / 2;
        dummy.position.set(x, 0, -y);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        const hx = x + Math.cos(rot) * 1.2, hy = y + Math.sin(rot) * 1.2;
        const on = rng.chance(0.55);
        dummy.position.set(hx, on ? 4.3 : -5, -hy);
        dummy.updateMatrix();
        bulbs.setMatrixAt(i, dummy.matrix);
        if (on) this.lights.push({ x: hx, y: hy, h: 4.0, color: 0xffc880, intensity: 26, flicker: rng.chance(0.3) ? 1 : 0 });
      });
    }
    // 沙袋 / 碎石（每个障碍物独立几何，合批）
    const sb = (groups.sandbag ?? []).map((o) => {
      const along = o.x1 - o.x0 > o.y1 - o.y0;
      const g = M.sandbagGeometry(along ? o.x1 - o.x0 : o.y1 - o.y0);
      if (!along) g.rotateY(Math.PI / 2);
      g.translate((o.x0 + o.x1) / 2, 0, -(o.y0 + o.y1) / 2);
      return g;
    });
    if (sb.length) this.addMerged(sb, this.track(new THREE.MeshLambertMaterial({ vertexColors: true })), shadows);
    const rb = (groups.rubble ?? []).map((o) => M.rubbleGeometry(o));
    if (rb.length) this.addMerged(rb, this.track(new THREE.MeshLambertMaterial({ vertexColors: true })), shadows);

    // —— 装饰物 ——
    const props: Record<string, Prop[]> = {};
    for (const p of L.props) (props[p.kind] ??= []).push(p);
    this.instProps(props.debris, M.debrisGeometry(), shadows);
    this.instProps(props.tire, M.tireGeometry(), false);
    this.instProps(props.bones, M.bonesGeometry(), false);
    this.instProps(props.cone, M.coneGeometry(), shadows);
    this.instProps(props.bench, M.benchGeometry(), shadows);
    this.instProps(props.sign, M.signGeometry(), shadows);
    this.instProps(props.bed, M.bedGeometry(), shadows);
    this.instProps(props.rack, M.rackGeometry(), shadows);
    if (props.papers?.length) {
      const mesh = this.inst(this.track(new THREE.PlaneGeometry(0.3, 0.4)), this.track(new THREE.MeshLambertMaterial({ color: 0xc8c4b0, side: THREE.DoubleSide })), props.papers.length, false);
      props.papers.forEach((p, i) => {
        dummy.position.set(p.x, 0.02, -p.y);
        dummy.rotation.set(-Math.PI / 2, 0, p.rot);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
    }
    if (props.puddle?.length) {
      this.puddleMat = this.track(new THREE.MeshBasicMaterial({ color: 0x5aff2a, map: T.splatTexture(), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }));
      const mesh = this.inst(this.track(new THREE.PlaneGeometry(1, 1)), this.puddleMat, props.puddle.length, false);
      props.puddle.forEach((p, i) => {
        dummy.position.set(p.x, 0.03, -p.y);
        dummy.rotation.set(-Math.PI / 2, 0, p.rot);
        dummy.scale.set(p.s * 1.6, p.s * 1.6, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      for (const p of props.puddle.slice(0, 12)) this.lights.push({ x: p.x, y: p.y, h: 0.8, color: 0x6aff3a, intensity: 4, flicker: 0 });
    }
    if (props.fire?.length) {
      // 燃烧的杂物堆：底座 + 火焰面片
      const baseG = M.merge([M.part(new THREE.CylinderGeometry(0.4, 0.45, 0.9, 8), 0x3a2a1a, 0, 0, 0.45, 0)]);
      this.instProps(props.fire, baseG, shadows);
      for (const p of props.fire) {
        this.fires.push({ x: p.x, y: p.y, s: p.s, phase: p.x * 3.1 + p.y });
        this.lights.push({ x: p.x, y: p.y, h: 1.6, color: 0xff8a3a, intensity: 18 * p.s, flicker: 2 });
      }
      const fireMat = this.track(new THREE.MeshBasicMaterial({ map: T.glowTexture(), color: 0xff7a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      this.fireMesh = new THREE.InstancedMesh(this.track(new THREE.PlaneGeometry(1, 1)), fireMat, this.fires.length * 3);
      this.fireMesh.frustumCulled = false;
      this.root.add(this.fireMesh);
    }
  }

  private addMerged(geos: THREE.BufferGeometry[], mat: THREE.Material, shadows: boolean): void {
    const g = this.track(mergeGeometries(geos, false)!);
    for (const x of geos) x.dispose();
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    this.root.add(mesh);
  }

  private inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadows: boolean): THREE.InstancedMesh {
    this.track(geo);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    this.track({ dispose: () => mesh.dispose() });
    this.root.add(mesh);
    return mesh;
  }

  private instBoxes(list: Obstacle[], geoOf: (o: Obstacle) => THREE.BufferGeometry, shadows: boolean, orient: boolean, variants = 2): void {
    for (let v = 0; v < variants; v++) {
      const l = list.filter((o) => o.variant % variants === v);
      if (!l.length) continue;
      const mesh = this.inst(geoOf(l[0]), this.track(new THREE.MeshLambertMaterial({ vertexColors: true })), l.length, shadows);
      l.forEach((o, i) => {
        dummy.position.set((o.x0 + o.x1) / 2, 0, -(o.y0 + o.y1) / 2);
        const longX = o.x1 - o.x0 > o.y1 - o.y0;
        dummy.rotation.set(0, orient ? (longX ? 0 : Math.PI / 2) : o.id * 0.7, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
    }
  }

  private instProps(list: Prop[] | undefined, geo: THREE.BufferGeometry, shadows: boolean): void {
    if (!list || !list.length) { geo.dispose(); return; }
    const mesh = this.inst(geo, this.track(new THREE.MeshLambertMaterial({ vertexColors: true })), list.length, shadows);
    list.forEach((p, i) => {
      dummy.position.set(p.x, 0, -p.y);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
  }

  /** 每帧：门动画、高楼淡出、火焰/设施动画 */
  /** 防护服柜：当前安全屋显示可拿取的防护服（拿走后柜子变空），前方的安全屋预告下一阶 */
  updateSuit(cur: RoomInfo | null, curTier: number, next: RoomInfo | null, nextTier: number, time: number): void {
    for (const st of this.suitStands) {
      const tier = st.room === cur ? curTier : st.room === next ? nextTier : 0;
      if (tier !== st.tier) {
        st.tier = tier;
        st.rig.root.visible = tier > 0;
        if (tier > 0) for (const m of st.rig.suitMats) m.color.setHex(M.SUIT_COLORS[Math.min(5, tier)]);
      }
      st.glow.color.setHex(tier > 0 ? (Math.sin(time * 4) > 0 ? 0x7affc0 : 0x3a9a70) : 0x3a3e44);
      st.rig.root.rotation.y = -Math.PI / 2 + Math.sin(time * 0.8) * 0.3;
    }
  }

  update(dt: number, time: number, px: number, py: number, camera: THREE.Camera): void {
    for (const d of this.doors.values()) {
      const target = d.o.open ? 1 : 0;
      d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), dt * 1.6);
      d.mesh.position.y = d.o.h / 2 - d.open * (d.o.h - 0.2);
      const lm = (d as any).lampMat as THREE.MeshBasicMaterial;
      lm.color.setHex(d.o.open ? 0x3aff8a : 0xff3a2a);
    }
    for (const t of this.towers) {
      const o = t.o;
      const occl = px > o.x0 - 1 && px < o.x1 + 1 && py > o.y0 - 0.5 && py < o.y1 + o.h * 0.62;
      const target = occl ? 0.28 : 1;
      t.fade += (target - t.fade) * Math.min(1, dt * 6);
      const transparent = t.fade < 0.98;
      if (t.mat.transparent !== transparent) { t.mat.transparent = transparent; t.mat.needsUpdate = true; }
      t.mat.opacity = t.fade;
      t.mat.depthWrite = !transparent;
    }
    if (this.altarCrystal) {
      this.altarCrystal.rotation.y = time * 1.4;
      this.altarCrystal.position.y = 2.0 + Math.sin(time * 2) * 0.15;
      this.altarRing!.rotation.x = Math.PI / 2 + Math.sin(time) * 0.3;
      this.altarRing!.rotation.y = time * 0.8;
      this.altarRing!.position.y = this.altarCrystal.position.y;
    }
    if (this.fireMesh) {
      const q = (camera as THREE.PerspectiveCamera).quaternion;
      let i = 0;
      for (const f of this.fires) {
        for (let k = 0; k < 3; k++) {
          const ph = time * (5 + k) + f.phase + k * 2;
          const s = f.s * (0.9 + Math.sin(ph) * 0.25) * (1.1 - k * 0.25);
          dummy.position.set(f.x + Math.sin(ph * 0.7) * 0.1, 1.0 + k * 0.35 + Math.sin(ph) * 0.06, -f.y);
          dummy.quaternion.copy(q);
          dummy.scale.set(s * 1.1, s * 1.5, 1);
          dummy.updateMatrix();
          this.fireMesh.setMatrixAt(i++, dummy.matrix);
        }
      }
      this.fireMesh.instanceMatrix.needsUpdate = true;
    }
    if (this.puddleMat) this.puddleMat.opacity = 0.3 + Math.sin(time * 1.5) * 0.08;
    void dt;
  }
}
