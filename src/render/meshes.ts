// 程序化模型：丧尸（带骨骼分段属性，用于着色器行走动画）、玩家、枪械、Boss、各类场景物件。
// 模型朝向本地 +X。

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GunLook } from '../data/guns';
import { Rng } from '../util/rng';

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();

/** 生成带顶点色与分段属性的几何体片段 */
export function part(
  geo: THREE.BufferGeometry, color: number | string, partId: number,
  x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1,
): THREE.BufferGeometry {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  tmpE.set(rx, ry, rz);
  tmpQ.setFromEuler(tmpE);
  tmpP.set(x, y, z);
  tmpS.set(sx, sy, sz);
  tmpM.compose(tmpP, tmpQ, tmpS);
  g.applyMatrix4(tmpM);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  tmpC.set(color as THREE.ColorRepresentation);
  tmpC.convertSRGBToLinear();
  for (let i = 0; i < n; i++) { col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new Float32Array(n).fill(partId);
  g.setAttribute('aPart', new THREE.BufferAttribute(p, 1));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts, false)!;
  m.computeBoundingSphere();
  return m;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const SPH = new THREE.IcosahedronGeometry(0.5, 1);
const CONE = new THREE.ConeGeometry(0.5, 1, 6);
const DODE = new THREE.DodecahedronGeometry(0.5, 0);

function bx(c: number | string, p: number, x: number, y: number, z: number, w: number, h: number, d: number, rx = 0, ry = 0, rz = 0) {
  return part(BOX, c, p, x, y, z, rx, ry, rz, w, h, d);
}

// —— 丧尸 ——
// aPart: 0 静止 1 左腿 2 右腿 3 左臂 4 右臂；腿的轴心在 y=HIP，手臂在 y=SHOULDER
export const HIP = 0.86;
export const SHOULDER = 1.38;

export function zombieGeometry(type: string): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [];
  const skin = type === 'spitter' ? 0x9aae4a : type === 'runner' ? 0x8a9a7a : 0x7f9a6e;
  if (type === 'office') {
    P.push(bx(0x3a3e48, 1, 0, 0.43, -0.12, 0.2, 0.86, 0.2), bx(0x3a3e48, 2, 0, 0.43, 0.12, 0.2, 0.86, 0.2));
    P.push(bx(0x1a1a1a, 1, 0.05, 0.05, -0.12, 0.3, 0.1, 0.22), bx(0x1a1a1a, 2, 0.05, 0.05, 0.12, 0.3, 0.1, 0.22));
    P.push(bx(0xcfc9b8, 0, 0, 1.16, 0, 0.32, 0.62, 0.52));
    P.push(bx(0x8a1a1a, 0, 0.165, 1.2, 0, 0.02, 0.42, 0.08));
    P.push(bx(0x6a2a1a, 0, 0.17, 1.0, 0.1, 0.02, 0.14, 0.12)); // 血迹
    P.push(bx(0xcfc9b8, 3, 0.28, SHOULDER, -0.32, 0.6, 0.14, 0.14), bx(0xcfc9b8, 4, 0.28, SHOULDER, 0.32, 0.6, 0.14, 0.14));
    P.push(bx(skin, 3, 0.62, SHOULDER, -0.32, 0.12, 0.12, 0.12), bx(skin, 4, 0.62, SHOULDER, 0.32, 0.12, 0.12, 0.12));
    P.push(bx(skin, 0, 0.02, 1.64, 0, 0.3, 0.32, 0.3));
    P.push(bx(0x2a2a2a, 0, -0.02, 1.8, 0, 0.3, 0.06, 0.3)); // 头发
    P.push(bx(0xff3a2a, 0, 0.155, 1.67, -0.07, 0.02, 0.05, 0.06), bx(0xff3a2a, 0, 0.155, 1.67, 0.07, 0.02, 0.05, 0.06));
  } else if (type === 'iron') {
    P.push(bx(0x2a2a2e, 1, 0, 0.43, -0.16, 0.26, 0.86, 0.26), bx(0x2a2a2e, 2, 0, 0.43, 0.16, 0.26, 0.86, 0.26));
    P.push(bx(0x4a3a28, 0, 0, 1.2, 0, 0.46, 0.72, 0.7));
    P.push(bx(0x6a5a3a, 0, 0.24, 1.2, 0, 0.04, 0.6, 0.5));
    P.push(bx(0x4a3a28, 3, 0.3, SHOULDER + 0.06, -0.44, 0.64, 0.22, 0.22), bx(0x4a3a28, 4, 0.3, SHOULDER + 0.06, 0.44, 0.64, 0.22, 0.22));
    P.push(bx(skin, 3, 0.66, SHOULDER + 0.06, -0.44, 0.16, 0.18, 0.18), bx(skin, 4, 0.66, SHOULDER + 0.06, 0.44, 0.16, 0.18, 0.18));
    P.push(bx(skin, 0, 0.02, 1.72, 0, 0.32, 0.3, 0.32));
    // 铁桶头盔
    P.push(part(CYL, 0x80868c, 0, 0.0, 1.82, 0, 0, 0, 0, 0.46, 0.34, 0.46));
    P.push(bx(0x30343a, 0, 0.2, 1.76, 0, 0.06, 0.06, 0.34));
  } else if (type === 'runner') {
    P.push(bx(0xa8382a, 1, 0, 0.46, -0.1, 0.17, 0.92, 0.17), bx(0xa8382a, 2, 0, 0.46, 0.1, 0.17, 0.92, 0.17));
    P.push(bx(0xeeeeee, 1, 0, 0.46, -0.19, 0.17, 0.92, 0.02), bx(0xeeeeee, 2, 0, 0.46, 0.19, 0.17, 0.92, 0.02));
    P.push(bx(0xa8382a, 0, 0.08, 1.14, 0, 0.28, 0.58, 0.42, 0, 0, -0.4));
    P.push(bx(0xa8382a, 3, 0.3, SHOULDER - 0.1, -0.26, 0.56, 0.12, 0.12), bx(0xa8382a, 4, 0.3, SHOULDER - 0.1, 0.26, 0.56, 0.12, 0.12));
    P.push(bx(skin, 3, 0.62, SHOULDER - 0.1, -0.26, 0.12, 0.1, 0.1), bx(skin, 4, 0.62, SHOULDER - 0.1, 0.26, 0.12, 0.1, 0.1));
    P.push(bx(skin, 0, 0.32, 1.5, 0, 0.27, 0.28, 0.27));
    P.push(bx(0xff3a2a, 0, 0.46, 1.52, -0.06, 0.02, 0.05, 0.05), bx(0xff3a2a, 0, 0.46, 1.52, 0.06, 0.02, 0.05, 0.05));
  } else if (type === 'creeper') {
    // 苦力怕（第4次调整）：方块身体、四条短腿、方块脑袋上的黑色“哭脸”，绿色带深浅斑块
    const G = 0x5aa84a, D = 0x3a7a32, L = 0x8acc6a;
    for (const [x, z] of [[0.17, -0.15], [0.17, 0.15], [-0.17, -0.15], [-0.17, 0.15]]) P.push(bx(D, 0, x, 0.18, z, 0.22, 0.36, 0.22));
    P.push(bx(G, 0, 0, 0.82, 0, 0.36, 0.92, 0.46));
    P.push(bx(D, 0, 0.181, 0.7, 0.12, 0.01, 0.2, 0.14), bx(L, 0, 0.181, 1.0, -0.1, 0.01, 0.16, 0.16), bx(D, 0, -0.181, 0.9, -0.05, 0.01, 0.24, 0.2));
    P.push(bx(G, 0, 0, 1.53, 0, 0.52, 0.52, 0.52));
    P.push(bx(L, 0, -0.05, 1.79, 0.1, 0.3, 0.01, 0.2), bx(D, 0, 0.1, 1.79, -0.12, 0.2, 0.01, 0.18));
    // 脸（朝 +X）：两只眼睛 + 竖着的嘴
    P.push(bx(0x101410, 0, 0.262, 1.62, -0.12, 0.01, 0.13, 0.13), bx(0x101410, 0, 0.262, 1.62, 0.12, 0.01, 0.13, 0.13));
    P.push(bx(0x101410, 0, 0.262, 1.47, 0, 0.01, 0.16, 0.1), bx(0x101410, 0, 0.262, 1.37, -0.08, 0.01, 0.16, 0.07), bx(0x101410, 0, 0.262, 1.37, 0.08, 0.01, 0.16, 0.07));
  } else {
    // 吐口水丧尸：肚子鼓起
    P.push(bx(0x4a4a3a, 1, 0, 0.43, -0.14, 0.22, 0.86, 0.22), bx(0x4a4a3a, 2, 0, 0.43, 0.14, 0.22, 0.86, 0.22));
    P.push(part(SPH, 0xa8b850, 0, 0.06, 1.12, 0, 0, 0, 0, 0.78, 0.78, 0.74));
    P.push(part(SPH, 0x6a8a2a, 0, 0.3, 1.0, 0, 0, 0, 0, 0.3, 0.3, 0.3));
    P.push(bx(skin, 3, 0.2, SHOULDER, -0.36, 0.44, 0.12, 0.12), bx(skin, 4, 0.2, SHOULDER, 0.36, 0.44, 0.12, 0.12));
    P.push(bx(skin, 0, 0.04, 1.62, 0, 0.32, 0.32, 0.32));
    P.push(bx(0xc8ff3a, 0, 0.2, 1.56, 0, 0.03, 0.12, 0.18)); // 发光的嘴
  }
  return merge(P);
}

export function zombieScale(type: string): number {
  return type === 'iron' ? 1.18 : type === 'runner' ? 0.95 : 1;
}

// —— 玩家 ——

export interface PlayerRig {
  root: THREE.Group;
  body: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  suitMats: THREE.MeshLambertMaterial[];
  visor: THREE.MeshBasicMaterial;
  gunL: THREE.Group;
  gunR: THREE.Group;
}

export const SUIT_COLORS = [0, 0xe8c030, 0xff7a20, 0x2ac8c0, 0x6a5aff, 0xffd84a];

export function playerRig(): PlayerRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const suit = new THREE.MeshLambertMaterial({ color: SUIT_COLORS[1] });
  const suit2 = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1e2024 });
  const tank = new THREE.MeshLambertMaterial({ color: 0x8a9096 });
  const visor = new THREE.MeshBasicMaterial({ color: 0x6affe8 });
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, parent: THREE.Object3D) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const legL = new THREE.Group(); legL.position.set(0, HIP, -0.13); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0, HIP, 0.13); body.add(legR);
  mk(BOX, suit, 0, -0.42, 0, 0.22, 0.84, 0.22, legL);
  mk(BOX, dark, 0.05, -0.82, 0, 0.32, 0.12, 0.24, legL);
  mk(BOX, suit, 0, -0.42, 0, 0.22, 0.84, 0.22, legR);
  mk(BOX, dark, 0.05, -0.82, 0, 0.32, 0.12, 0.24, legR);
  mk(BOX, suit, 0, 1.18, 0, 0.36, 0.66, 0.56, body);
  mk(BOX, suit2, 0.01, 0.9, 0, 0.38, 0.1, 0.58, body);
  mk(CYL, tank, -0.3, 1.2, -0.1, 0.18, 0.56, 0.18, body);
  mk(CYL, tank, -0.3, 1.2, 0.1, 0.18, 0.56, 0.18, body);
  mk(BOX, suit, 0, 1.66, 0, 0.36, 0.34, 0.36, body);
  mk(BOX, dark, 0.1, 1.62, 0, 0.22, 0.24, 0.3, body);
  const v = mk(BOX, visor, 0.19, 1.7, 0, 0.04, 0.1, 0.26, body);
  v.castShadow = false;
  mk(CYL6, dark, 0.24, 1.55, -0.12, 0.1, 0.12, 0.1, body).rotation.z = Math.PI / 2;
  mk(CYL6, dark, 0.24, 1.55, 0.12, 0.1, 0.12, 0.1, body).rotation.z = Math.PI / 2;
  const armL = new THREE.Group(); armL.position.set(0, SHOULDER, -0.34); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0, SHOULDER, 0.34); body.add(armR);
  mk(BOX, suit, 0.22, -0.06, 0, 0.5, 0.15, 0.15, armL);
  mk(BOX, dark, 0.5, -0.06, 0, 0.12, 0.14, 0.14, armL);
  mk(BOX, suit, 0.22, -0.06, 0, 0.5, 0.15, 0.15, armR);
  mk(BOX, dark, 0.5, -0.06, 0, 0.12, 0.14, 0.14, armR);
  const gunL = new THREE.Group(); gunL.position.set(0.52, -0.05, 0); armL.add(gunL);
  const gunR = new THREE.Group(); gunR.position.set(0.52, -0.05, 0); armR.add(gunR);
  return { root, body, legL, legR, armL, armR, suitMats: [suit], visor, gunL, gunR };
}

// —— 枪械 ——

export function gunMesh(look: GunLook, scale = 1.35): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: look.color });
  const metal = new THREE.MeshLambertMaterial({ color: 0x2a2c30 });
  const accent = new THREE.MeshLambertMaterial({ color: look.accent, emissive: look.accent, emissiveIntensity: 0.6 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.z = rz;
    m.castShadow = true;
    g.add(m);
  };
  const L = look.bodyLen, B = look.bulky;
  add(BOX, body, L * 0.35, 0, 0, L, 0.11 * B, 0.08 * B);
  add(BOX, accent, L * 0.35, 0.058 * B, 0, L * 0.8, 0.012, 0.085 * B);
  add(CYL, metal, L * 0.85 + look.barrelLen / 2, 0.01, 0, 0.045 * B, look.barrelLen, 0.045 * B, Math.PI / 2);
  if (look.wideMuzzle) add(BOX, metal, L * 0.85 + look.barrelLen, 0.01, 0, 0.06, 0.1 * B, 0.12 * B);
  if (look.drum) add(CYL, metal, L * 0.4, -0.1 * B, 0, 0.2 * B, 0.08, 0.2 * B, 0);
  else add(BOX, metal, L * 0.45, -0.1 * B, 0, 0.07, 0.16 * B, 0.05);
  add(BOX, metal, L * 0.12, -0.08 * B, 0, 0.06, 0.14, 0.05, -0.3);
  if (look.stock) add(BOX, body, -L * 0.12, -0.02, 0, L * 0.35, 0.09 * B, 0.06 * B);
  if (look.scope) add(CYL, metal, L * 0.45, 0.1 * B, 0, 0.05, L * 0.4, 0.05, Math.PI / 2);
  g.scale.setScalar(scale);
  return g;
}

// —— Boss ——

export interface BossRig {
  kind: 'laoda' | 'mamba';
  root: THREE.Group;
  body: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  flesh: THREE.MeshLambertMaterial;
  eyes: THREE.MeshBasicMaterial;
  tail: THREE.Group[]; // 曼巴僵尸的蛇尾（逐节摆动）
}

/** Boss 模型；mamba = 第六区的曼巴僵尸（紫金配色、更大、带一条蛇尾） */
export function bossRig(kind: 'laoda' | 'mamba' = 'laoda'): BossRig {
  const mb = kind === 'mamba';
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const flesh = new THREE.MeshLambertMaterial({ color: mb ? 0x3e2a52 : 0x7a3026, emissive: 0x000000 });
  const cloth = new THREE.MeshLambertMaterial({ color: mb ? 0xd8a020 : 0x2a1a3a });
  const bone = new THREE.MeshLambertMaterial({ color: mb ? 0xffe08a : 0xd8ccb0 });
  const eyes = new THREE.MeshBasicMaterial({ color: mb ? 0x4affe0 : 0xffd23a });
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, parent: THREE.Object3D, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.x = rx;
    m.rotation.z = rz;
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  const legL = new THREE.Group(); legL.position.set(0, 1.3, -0.45); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0, 1.3, 0.45); body.add(legR);
  for (const leg of [legL, legR]) {
    mk(BOX, cloth, 0, -0.65, 0, 0.5, 1.3, 0.5, leg);
    mk(BOX, flesh, 0.08, -1.25, 0, 0.7, 0.2, 0.55, leg);
  }
  mk(BOX, cloth, 0, 1.55, 0, 0.9, 0.6, 1.3, body);
  mk(BOX, flesh, 0.05, 2.25, 0, 1.0, 1.0, 1.55, body);
  mk(BOX, flesh, 0.3, 2.05, 0, 0.5, 0.6, 1.0, body);
  for (let i = 0; i < 5; i++) mk(CONE, bone, -0.45, 2.3 + (i % 2) * 0.25, -0.6 + i * 0.3, 0.18, 0.6, 0.18, body, 0, Math.PI / 2 + 0.3);
  mk(BOX, flesh, 0.25, 3.0, 0, 0.6, 0.55, 0.6, body);
  mk(BOX, eyes, 0.56, 3.05, -0.14, 0.04, 0.08, 0.12, body);
  mk(BOX, eyes, 0.56, 3.05, 0.14, 0.04, 0.08, 0.12, body);
  mk(BOX, bone, 0.55, 2.86, 0, 0.06, 0.08, 0.36, body);
  const armL = new THREE.Group(); armL.position.set(0.1, 2.6, -0.95); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.1, 2.6, 0.95); body.add(armR);
  for (const arm of [armL, armR]) {
    mk(BOX, flesh, 0.1, -0.5, 0, 0.45, 1.1, 0.45, arm);
    mk(BOX, flesh, 0.35, -1.15, 0, 0.6, 0.5, 0.55, arm);
    mk(CONE, bone, 0.1, 0.05, 0, 0.2, 0.5, 0.2, arm);
  }
  const tail: THREE.Group[] = [];
  if (mb) {
    // 球衣上的紫色条纹与胸口的金色号码块
    const trim = new THREE.MeshLambertMaterial({ color: 0x5a2a8a });
    mk(BOX, trim, 0.02, 1.86, 0, 0.95, 0.08, 1.35, body);
    mk(BOX, trim, 0.56, 2.3, 0, 0.04, 0.5, 0.5, body);
    // 蛇尾：从背后拖到地面，逐节变细
    let parent: THREE.Object3D = body;
    let px = -0.55, py = 1.4;
    for (let i = 0; i < 7; i++) {
      const seg = new THREE.Group();
      seg.position.set(px, py, 0);
      parent.add(seg);
      const s = 0.5 - i * 0.055;
      mk(BOX, i % 2 ? trim : flesh, -0.3, 0, 0, 0.62, s, s, seg);
      tail.push(seg);
      parent = seg;
      px = -0.55; py = i === 0 ? -0.6 : -0.12;
    }
    root.scale.setScalar(1.12);
  }
  return { kind, root, body, legL, legR, armL, armR, flesh, eyes, tail };
}

// —— 场景物件 ——

export function carGeometry(variant: number): THREE.BufferGeometry {
  const colors = [0x7a2a1e, 0x2e4a6a, 0xb8b4a8, 0x1a1c20, 0xc8a020, 0x2a2622];
  const c = colors[variant % colors.length];
  const P: THREE.BufferGeometry[] = [];
  // 本地：长度沿 X
  P.push(bx(c, 0, 0, 0.55, 0, 4.2, 0.6, 1.9));
  P.push(bx(c, 0, -0.3, 1.05, 0, 2.2, 0.5, 1.7));
  P.push(bx(0x101418, 0, -0.3, 1.07, 0, 2.1, 0.42, 1.74));
  P.push(bx(0x101418, 0, 0.82, 1.0, 0, 0.1, 0.36, 1.6, 0, 0, 0.6));
  P.push(bx(0x3a2a20, 0, 1.3, 0.86, 0, 1.3, 0.04, 1.8)); // 生锈的引擎盖
  for (const [x, z] of [[1.3, 0.9], [-1.3, 0.9], [1.3, -0.9], [-1.3, -0.9]]) P.push(part(CYL, 0x141414, 0, x, 0.32, z, Math.PI / 2, 0, 0, 0.62, 0.24, 0.62));
  P.push(bx(0x9a2a1a, 0, 2.11, 0.62, 0.65, 0.02, 0.12, 0.3), bx(0x9a2a1a, 0, 2.11, 0.62, -0.65, 0.02, 0.12, 0.3));
  return merge(P);
}

export function treeGeometry(variant: number): THREE.BufferGeometry {
  const rng = new Rng(40 + variant);
  const P: THREE.BufferGeometry[] = [];
  const bark = 0x6a5644;
  P.push(part(CYL6, bark, 0, 0, 0.5, 0, 0, 0, 0, 0.32, 1, 0.32));
  const n = 4 + variant;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const h = rng.range(0.45, 0.95);
    const len = rng.range(0.35, 0.6);
    const tilt = rng.range(0.5, 1.0);
    P.push(part(CYL6, bark, 0, Math.cos(a) * len * 0.4, h + len * 0.3, Math.sin(a) * len * 0.4, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt, 0.08, len, 0.08));
  }
  return merge(P);
}

export function barrierGeometry(variant: number): THREE.BufferGeometry {
  const c = 0x8a8880;
  const P = [bx(c, 0, 0, 0.2, 0, 2.6, 0.4, 0.6), bx(c, 0, 0, 0.62, 0, 2.6, 0.5, 0.28)];
  if (variant === 1) { P.push(bx(0xc83a2a, 0, -0.6, 0.62, 0, 0.5, 0.5, 0.3), bx(0xeeeeee, 0, 0.1, 0.62, 0, 0.5, 0.5, 0.3), bx(0xc83a2a, 0, 0.8, 0.62, 0, 0.5, 0.5, 0.3)); }
  return merge(P);
}

export function barrelGeometry(variant: number): THREE.BufferGeometry {
  const c = variant === 1 ? 0xc8a820 : 0x2e4a6a;
  const P = [part(CYL, c, 0, 0, 0.5, 0, 0, 0, 0, 0.76, 1, 0.76)];
  P.push(part(CYL, 0x1a1a1a, 0, 0, 0.3, 0, 0, 0, 0, 0.78, 0.05, 0.78), part(CYL, 0x1a1a1a, 0, 0, 0.72, 0, 0, 0, 0, 0.78, 0.05, 0.78));
  if (variant === 1) P.push(part(CYL, 0x8aff3a, 0, 0, 1.0, 0, 0, 0, 0, 0.6, 0.02, 0.6));
  return merge(P);
}

export function rubbleGeometry(o: { x0: number; y0: number; x1: number; y1: number; h: number; id: number; variant: number }): THREE.BufferGeometry {
  const rng = new Rng(o.id * 31 + 7);
  const P: THREE.BufferGeometry[] = [];
  const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2;
  const w = o.x1 - o.x0, d = o.y1 - o.y0;
  const n = 5 + Math.floor(w * d * 1.5);
  for (let i = 0; i < n; i++) {
    const sx = rng.range(0.4, 1.1) * Math.min(w, d) * 0.6;
    const px = cx + rng.range(-w * 0.35, w * 0.35);
    const pz = -(cy + rng.range(-d * 0.35, d * 0.35));
    const shade = rng.range(0.32, 0.55);
    const col = new THREE.Color(shade, shade * 0.96, shade * 0.9).getHex();
    const geo = rng.chance(0.5) ? DODE : BOX;
    P.push(part(geo, col, 0, px, rng.range(0.1, o.h * 0.6), pz, rng.range(0, 3), rng.range(0, 3), rng.range(0, 3), sx, sx * rng.range(0.5, 1), sx * rng.range(0.6, 1.2)));
  }
  // 钢筋
  for (let i = 0; i < 3; i++) P.push(part(BOX, 0x5a3a2a, 0, cx + rng.range(-w * 0.3, w * 0.3), o.h * 0.5, -(cy + rng.range(-d * 0.3, d * 0.3)), rng.range(-1, 1), rng.range(0, 3), rng.range(-1, 1), 0.04, rng.range(0.8, 1.6), 0.04));
  return merge(P);
}

export function sandbagGeometry(len: number): THREE.BufferGeometry {
  const rng = new Rng(Math.floor(len * 100));
  const P: THREE.BufferGeometry[] = [];
  const n = Math.max(2, Math.round(len / 0.55));
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < n - row; i++) {
      const x = -len / 2 + 0.3 + i * (len - 0.6) / Math.max(1, n - 1) + row * 0.27;
      const shade = rng.range(0.85, 1.05);
      P.push(part(SPH, new THREE.Color(0.55 * shade, 0.5 * shade, 0.34 * shade).getHex(), 0, x, 0.2 + row * 0.36, 0, 0, rng.range(-0.2, 0.2), 0, 0.6, 0.4, 0.75));
    }
  }
  return merge(P);
}

export function lampGeometry(): THREE.BufferGeometry {
  return merge([
    part(CYL6, 0x2a2c30, 0, 0, 2.25, 0, 0, 0, 0, 0.14, 4.5, 0.14),
    part(BOX, 0x2a2c30, 0, 0.6, 4.45, 0, 0, 0, 0, 1.3, 0.08, 0.08),
    part(BOX, 0x3a3c40, 0, 1.2, 4.38, 0, 0, 0, 0, 0.5, 0.14, 0.3),
  ]);
}

export function benchGeometry(): THREE.BufferGeometry {
  return merge([
    part(BOX, 0x5a4028, 0, 0, 0.45, 0, 0, 0, 0, 1.6, 0.06, 0.45),
    part(BOX, 0x5a4028, 0, 0, 0.75, -0.2, 0.2, 0, 0, 1.6, 0.4, 0.05),
    part(BOX, 0x2a2a2a, 0, -0.7, 0.22, 0, 0, 0, 0, 0.06, 0.45, 0.45),
    part(BOX, 0x2a2a2a, 0, 0.7, 0.22, 0, 0, 0, 0, 0.06, 0.45, 0.45),
  ]);
}

export function signGeometry(): THREE.BufferGeometry {
  return merge([
    part(CYL6, 0x3a3a3a, 0, 0, 1.2, 0, 0, 0, 0, 0.08, 2.4, 0.08),
    part(BOX, 0x2a6a3a, 0, 0, 2.3, 0, 0, 0, 0.1, 1.4, 0.6, 0.06),
  ]);
}

export function debrisGeometry(): THREE.BufferGeometry {
  return merge([
    part(DODE, 0x5a5650, 0, 0, 0.08, 0, 0, 0, 0, 0.3, 0.16, 0.26),
    part(DODE, 0x4a4640, 0, 0.22, 0.05, 0.12, 1, 0, 0, 0.18, 0.1, 0.16),
    part(BOX, 0x6a6258, 0, -0.18, 0.04, -0.1, 0, 0.6, 0, 0.22, 0.06, 0.12),
  ]);
}

export function bonesGeometry(): THREE.BufferGeometry {
  return merge([
    part(BOX, 0xd8d0b8, 0, 0, 0.04, 0, 0, 0.3, 0, 0.5, 0.06, 0.06),
    part(BOX, 0xd8d0b8, 0, 0.1, 0.04, 0.15, 0, -0.5, 0, 0.4, 0.05, 0.05),
    part(SPH, 0xe0d8c0, 0, -0.3, 0.1, -0.05, 0, 0, 0, 0.22, 0.2, 0.2),
  ]);
}

export function coneGeometry(): THREE.BufferGeometry {
  return merge([
    part(CONE, 0xe86a1a, 0, 0, 0.35, 0, 0, 0, 0, 0.36, 0.7, 0.36),
    part(BOX, 0x1a1a1a, 0, 0, 0.02, 0, 0, 0, 0, 0.45, 0.04, 0.45),
  ]);
}

export function tireGeometry(): THREE.BufferGeometry {
  const t = new THREE.TorusGeometry(0.35, 0.13, 6, 12);
  return merge([part(t, 0x161616, 0, 0, 0.13, 0, Math.PI / 2, 0, 0, 1, 1, 1)]);
}

export function containerGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(1, 1, 1);
}

export function bleacherGeometry(w: number, d: number, h: number): THREE.BufferGeometry {
  const P: THREE.BufferGeometry[] = [];
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const hh = (h * (i + 1)) / steps;
    P.push(part(BOX, i % 2 ? 0x4a3a5a : 0x5a4a6a, 0, 0, hh / 2, 0, 0, 0, 0, w * (1 - i / steps), hh, d));
  }
  return merge(P);
}

export function bedGeometry(): THREE.BufferGeometry {
  return merge([
    part(BOX, 0x4a4e52, 0, 0, 0.25, 0, 0, 0, 0, 2.0, 0.3, 0.9),
    part(BOX, 0x7a8a6a, 0, 0, 0.45, 0, 0, 0, 0, 1.9, 0.12, 0.85),
    part(BOX, 0xd8d8d0, 0, 0.75, 0.55, 0, 0, 0, 0, 0.35, 0.1, 0.6),
  ]);
}

export function rackGeometry(): THREE.BufferGeometry {
  const P = [part(BOX, 0x3a3226, 0, 0, 0.9, 0, 0, 0, 0, 2.4, 1.8, 0.3)];
  for (let i = 0; i < 4; i++) P.push(part(BOX, 0x1e1e20, 0, -0.9 + i * 0.6, 1.0, 0.2, 0, 0, 0.12, 0.12, 1.3, 0.08));
  return merge(P);
}
