// 动态实体的渲染：丧尸（实例化 + 着色器行走动画）、Boss、玩家与枪械、投射物、金币、地面道具、贴花等。

import * as THREE from 'three';
import { ELITE_COLORS, ENEMY_TYPES, RARITY_HEX } from '../config';
import { BULLETS } from '../data/bullets';
import { Gun } from '../data/guns';
import { ITEMS } from '../data/items';
import type { World } from '../game/world';
import type { WorldItem } from '../game/pickups';
import type { RemotePlayer } from '../game/net';
import { FANCY_IRI, FANCY_SHINY } from '../game/projectiles';
import { RELIC } from '../data/relics';

/** 第2版联机：每名玩家的标识颜色（按房间内的编号） */
export const SLOT_COLORS = [0x4affe0, 0xffb03a, 0xff5ac8, 0x9aff4a];
export const SLOT_CSS = ['#4affe0', '#ffb03a', '#ff5ac8', '#9aff4a'];

interface RemoteRig {
  rig: M.PlayerRig;
  ring: THREE.Mesh;
  gunKey: [string, string];
  suit: number;
}
import * as M from './meshes';
import * as T from './textures';

const dummy = new THREE.Object3D();
const tmpCol = new THREE.Color();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const timeUniform = { value: 0 };

function zombieMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aPart;
attribute float aPhase;
attribute float aFlash;
attribute float aAmp;
attribute vec3 aGlow;
varying float vFlash;
varying vec3 vGlow;
uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float sw = sin(aPhase) * 0.75 * aAmp;
if (aPart > 0.5 && aPart < 2.5) {
  float s = aPart < 1.5 ? sw : -sw;
  vec2 p = transformed.xy - vec2(0.0, ${M.HIP.toFixed(3)});
  transformed.xy = vec2(p.x * cos(s) - p.y * sin(s), p.x * sin(s) + p.y * cos(s)) + vec2(0.0, ${M.HIP.toFixed(3)});
} else if (aPart > 2.5) {
  float s = (aPart < 3.5 ? sw : -sw) * 0.3 + sin(uTime * 3.0 + aPhase * 0.5) * 0.08;
  vec2 p = transformed.xy - vec2(0.0, ${M.SHOULDER.toFixed(3)});
  transformed.xy = vec2(p.x * cos(s) - p.y * sin(s), p.x * sin(s) + p.y * cos(s)) + vec2(0.0, ${M.SHOULDER.toFixed(3)});
}
vFlash = aFlash;
vGlow = aGlow;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vFlash;
varying vec3 vGlow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vGlow;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.96, 0.9), vFlash);`);
  };
  return mat;
}

interface ZombieBatch {
  mesh: THREE.InstancedMesh;
  phase: THREE.InstancedBufferAttribute;
  flash: THREE.InstancedBufferAttribute;
  amp: THREE.InstancedBufferAttribute;
  glow: THREE.InstancedBufferAttribute;
  scale: number;
}

const MAX_Z = 520;

export class EntityView {
  root = new THREE.Group();
  zombies = new Map<string, ZombieBatch>();
  eliteRings: THREE.InstancedMesh;
  player: M.PlayerRig;
  playerGunUid: [number, number] = [-1, -1];
  playerSuit = -1;
  playerRing: THREE.Mesh;
  boss: M.BossRig | null = null;
  remoteRigs = new Map<number, RemoteRig>();
  private ringGeoP = new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2);
  orbs: THREE.InstancedMesh;
  bombs: THREE.InstancedMesh;
  rockets: THREE.InstancedMesh;
  saws: THREE.InstancedMesh;
  boomers: THREE.InstancedMesh;
  mines: THREE.InstancedMesh;
  coins: THREE.InstancedMesh;
  spits: THREE.InstancedMesh;
  rocks: THREE.InstancedMesh;
  decals: THREE.InstancedMesh;
  decalIdx = 0;
  decalCount = 0;
  hazardGlow: THREE.InstancedMesh;
  vortexCore: THREE.InstancedMesh;
  teleLine: THREE.InstancedMesh;
  teleCircle: THREE.InstancedMesh;
  beamGlow: THREE.InstancedMesh; // 曼巴僵尸的激光（外层光晕）
  beamCore: THREE.InstancedMesh; // 激光内芯
  teleRing: THREE.InstancedMesh; // 冲击波
  items = new Map<number, { g: THREE.Group; model: THREE.Object3D; beam: THREE.Mesh; ring: THREE.Mesh }>();
  shadowOn = true;
  private itemBeamGeo = new THREE.CylinderGeometry(0.12, 0.3, 7, 10, 1, true);
  private ringGeo = new THREE.PlaneGeometry(1.6, 1.6);

  constructor(scene: THREE.Scene, shadows: boolean) {
    this.shadowOn = shadows;
    scene.add(this.root);
    for (const t of ENEMY_TYPES) {
      const geo = M.zombieGeometry(t);
      const phase = new THREE.InstancedBufferAttribute(new Float32Array(MAX_Z), 1).setUsage(THREE.DynamicDrawUsage);
      const flash = new THREE.InstancedBufferAttribute(new Float32Array(MAX_Z), 1).setUsage(THREE.DynamicDrawUsage);
      const amp = new THREE.InstancedBufferAttribute(new Float32Array(MAX_Z), 1).setUsage(THREE.DynamicDrawUsage);
      const glow = new THREE.InstancedBufferAttribute(new Float32Array(MAX_Z * 3), 3).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aPhase', phase);
      geo.setAttribute('aFlash', flash);
      geo.setAttribute('aAmp', amp);
      geo.setAttribute('aGlow', glow);
      const mesh = new THREE.InstancedMesh(geo, zombieMaterial(), MAX_Z);
      mesh.castShadow = shadows;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.root.add(mesh);
      this.zombies.set(t, { mesh, phase, flash, amp, glow, scale: M.zombieScale(t) });
    }
    const add = (color = 0xffffff) => new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.eliteRings = this.instanced(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: T.ringTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 160);
    this.player = M.playerRig();
    this.root.add(this.player.root);
    this.playerRing = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: T.ringTexture(), color: 0x4affe0, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.playerRing.renderOrder = 2;
    this.root.add(this.playerRing);
    this.orbs = this.instanced(new THREE.SphereGeometry(1, 8, 6), add(), 1600);
    this.orbs.renderOrder = 4;
    this.bombs = this.instanced(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshLambertMaterial({ color: 0x2a2a2a }), 120, true);
    this.rockets = this.instanced(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 8).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x8a3a2a }), 120, true);
    const sawGeo = new THREE.CylinderGeometry(1, 1, 0.08, 12);
    this.saws = this.instanced(sawGeo, new THREE.MeshLambertMaterial({ color: 0xc8ccd4, emissive: 0x222222 }), 120, true);
    const boomGeo = M.merge([
      M.part(new THREE.BoxGeometry(1, 1, 1), 0xd08a3a, 0, 0.35, 0, 0.2, 0, 0.5, 0, 0.8, 0.08, 0.18),
      M.part(new THREE.BoxGeometry(1, 1, 1), 0xd08a3a, 0, 0.35, 0, -0.2, 0, -0.5, 0, 0.8, 0.08, 0.18),
    ]);
    this.boomers = this.instanced(boomGeo, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x3a1a00 }), 120, true);
    this.mines = this.instanced(new THREE.CylinderGeometry(0.35, 0.4, 0.12, 10), new THREE.MeshLambertMaterial({ color: 0x3a3e2a }), 80, true);
    this.coins = this.instanced(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffc83a, emissive: 0x7a5000 }), 700, true);
    this.spits = this.instanced(new THREE.SphereGeometry(1, 8, 6), add(0x9aff3a), 120);
    this.rocks = this.instanced(new THREE.DodecahedronGeometry(0.6, 0), new THREE.MeshLambertMaterial({ color: 0x6a5a4a, emissive: 0x401000 }), 20, true);
    this.decals = this.instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: T.splatTexture(), transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), 500);
    this.decals.count = 0;
    this.decals.renderOrder = 1;
    this.hazardGlow = this.instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: T.glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 40);
    this.vortexCore = this.instanced(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0x050008 }), 20);
    this.teleLine = this.instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), add(0xff2a1a), 8);
    this.teleCircle = this.instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: T.ringTexture(), color: 0xff3a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 24);
    this.beamGlow = this.instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), add(0xb04aff), 6);
    this.beamCore = this.instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), add(0xffe8ff), 6);
    this.teleRing = this.instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: T.ringTexture(), color: 0x6ae8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 4);
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, shadow = false): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.frustumCulled = false;
    m.count = 0;
    m.castShadow = shadow && this.shadowOn;
    this.root.add(m);
    return m;
  }

  clearZone(): void {
    this.decalCount = 0;
    this.decalIdx = 0;
    this.decals.count = 0;
    for (const v of this.items.values()) v.g.removeFromParent();
    this.items.clear();
    if (this.boss) { this.boss.root.removeFromParent(); this.boss = null; }
  }

  addDecal(x: number, y: number, color: number, size: number): void {
    const i = this.decalIdx;
    this.decalIdx = (this.decalIdx + 1) % 500;
    this.decalCount = Math.min(500, this.decalCount + 1);
    dummy.position.set(x, 0.015 + (i % 7) * 0.001, -y);
    dummy.rotation.set(0, Math.random() * 6.28, 0);
    dummy.scale.set(size, 1, size);
    dummy.updateMatrix();
    this.decals.setMatrixAt(i, dummy.matrix);
    this.decals.setColorAt(i, tmpCol.setHex(color));
    this.decals.count = this.decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
  }

  update(w: World, dt: number, time: number, camera: THREE.Camera): void {
    timeUniform.value = time;
    this.updateZombies(w, time);
    this.updatePlayer(w, dt, time);
    this.updateRemotes(w, dt, time);
    this.updateBoss(w, dt, time);
    this.updateProjectiles(w, time, camera);
    this.updateCoins(w, time);
    this.updateItems(w, time);
    this.updateHazards(w, time);
  }

  private updateZombies(w: World, time: number): void {
    const counts: Record<string, number> = {};
    for (const t of ENEMY_TYPES) counts[t] = 0;
    let rings = 0;
    for (const e of w.enemies.list) {
      if (e.dead || e.type === 'boss' || e.type === 'chest') continue;
      const b = this.zombies.get(e.type)!;
      const i = counts[e.type]++;
      if (i >= MAX_Z) continue;
      let s = b.scale * (e.elite ? 1.12 : 1);
      // 苦力怕点燃后会一边闪白一边膨胀
      let sx = s;
      if (e.fuse >= 0) { const k = 1 - Math.max(0, e.fuse) / 2; sx = s * (1 + k * 0.25 + Math.sin(time * 30) * 0.03); s *= 1 + k * 0.12; }
      const stun = e.stunT > 0;
      dummy.position.set(e.x, stun ? 0 : Math.abs(Math.sin(e.phase)) * 0.05, -e.y);
      dummy.rotation.set(0, e.face, stun ? Math.sin(time * 9 + e.id) * 0.12 : Math.sin(e.phase * 0.5) * 0.06);
      dummy.scale.set(sx, s, sx);
      dummy.updateMatrix();
      b.mesh.setMatrixAt(i, dummy.matrix);
      b.phase.setX(i, e.phase);
      b.flash.setX(i, e.flash > 0 ? 0.85 : 0);
      const sp = Math.hypot(e.vx, e.vy);
      b.amp.setX(i, stun ? 0 : Math.min(1, sp / 2));
      let gr = 0, gg = 0, gb = 0;
      if (e.elite) {
        tmpCol.setHex(ELITE_COLORS[e.elite]);
        const k = 0.1 + Math.sin(time * 5 + e.id) * 0.05;
        gr = tmpCol.r * k; gg = tmpCol.g * k; gb = tmpCol.b * k;
      }
      if (e.burnT > 0) { gr += 0.5; gg += 0.18; }
      if (e.slowT > 0) { gb += 0.45; gg += 0.25; }
      if (stun) { const k = 0.35 + Math.sin(time * 8 + e.id) * 0.1; gr += k; gg += k * 0.85; }
      // 第4.1次调整：异变体——全身流转的虹彩光芒
      if (e.mutant) { tmpCol.setHSL((time * 0.35 + e.id * 0.1) % 1, 1, 0.5); gr += tmpCol.r * 0.55; gg += tmpCol.g * 0.55; gb += tmpCol.b * 0.55; }
      b.glow.setXYZ(i, gr, gg, gb);
      if ((e.elite || e.mutant) && rings < 160) {
        dummy.position.set(e.x, 0.04, -e.y);
        dummy.rotation.set(-Math.PI / 2, 0, time * 2);
        const rs = e.r * (e.mutant ? 4.4 + Math.sin(time * 5) * 0.4 : 3.2);
        dummy.scale.set(rs, rs, 1);
        dummy.updateMatrix();
        this.eliteRings.setMatrixAt(rings, dummy.matrix);
        this.eliteRings.setColorAt(rings, e.mutant ? tmpCol.setHSL((time * 0.5 + e.id * 0.1) % 1, 1, 0.6) : tmpCol.setHex(ELITE_COLORS[e.elite]));
        rings++;
      }
    }
    // 尸体：向后倒下并沉入地面
    for (const c of w.corpses) {
      const b = this.zombies.get(c.type);
      if (!b) continue;
      const i = counts[c.type]++;
      if (i >= MAX_Z) continue;
      const fall = Math.min(1, c.t / 0.35);
      const sink = Math.max(0, c.t - 1.2) * 0.5;
      const s = b.scale * (c.elite ? 1.12 : 1);
      dummy.position.set(c.x, -sink, -c.y);
      dummy.rotation.set(fall * 0.25 * c.side, c.face, fall * (Math.PI / 2) * 0.96, 'YXZ');
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      b.mesh.setMatrixAt(i, dummy.matrix);
      b.phase.setX(i, 0);
      b.flash.setX(i, 0);
      b.amp.setX(i, 0);
      b.glow.setXYZ(i, 0, 0, 0);
    }
    for (const [t, b] of this.zombies) {
      b.mesh.count = Math.min(MAX_Z, counts[t]);
      b.mesh.instanceMatrix.needsUpdate = true;
      b.phase.needsUpdate = true;
      b.flash.needsUpdate = true;
      b.amp.needsUpdate = true;
      b.glow.needsUpdate = true;
    }
    this.eliteRings.count = rings;
    this.eliteRings.instanceMatrix.needsUpdate = true;
    if (this.eliteRings.instanceColor) this.eliteRings.instanceColor.needsUpdate = true;
  }

  private updatePlayer(w: World, dt: number, time: number): void {
    const p = w.player;
    const rig = this.player;
    const run = w.run;
    rig.root.position.set(p.x, 0, -p.y);
    rig.root.rotation.y = p.face;
    // 第4.1次调整：天生神力——体型 +80%
    const big = run.has('might') ? RELIC.mightScale : 1;
    rig.root.scale.setScalar(big);
    this.playerRing.scale.setScalar(big);
    // 主菜单背景（showcase）里的世界没有玩家：不显示玩家模型，避免在巡游镜头中央看到穿墙的人物
    rig.root.visible = !w.showcase && (p.alive || !w.net);
    this.playerRing.position.set(p.x, 0.05, -p.y);
    this.playerRing.visible = p.standing && !w.showcase;
    (this.playerRing.material as THREE.MeshBasicMaterial).color.setHex(w.net ? SLOT_COLORS[w.myId % 4] : 0x4affe0);
    (this.playerRing.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(time * 4) * 0.15;
    // 防护服颜色
    if (this.playerSuit !== run.suit) {
      this.playerSuit = run.suit;
      for (const m of rig.suitMats) m.color.setHex(M.SUIT_COLORS[Math.min(5, run.suit)]);
    }
    // 枪
    for (let h = 0; h < 2; h++) {
      const g = run.guns[h];
      const uid = g ? g.uid : -1;
      if (this.playerGunUid[h] !== uid) {
        this.playerGunUid[h] = uid;
        const holder = h === 0 ? rig.gunR : rig.gunL;
        holder.clear();
        if (g) holder.add(M.gunMesh(g.look));
      }
    }
    const sw = Math.sin(p.walkPhase) * 0.6 * p.moving;
    rig.legL.rotation.z = sw;
    rig.legR.rotation.z = -sw;
    // 手臂：持枪 + 后坐
    for (let h = 0; h < 2; h++) {
      const hs = p.hands[h];
      const arm = h === 0 ? rig.armR : rig.armL;
      const kick = hs.firingT < 0.08 ? (0.08 - hs.firingT) * 1.6 : 0;
      arm.position.x = -kick;
      arm.rotation.z = hs.reloading ? -0.5 + Math.sin(time * 14) * 0.08 : 0.02 + kick * 2;
    }
    if (!p.alive || p.downed) {
      rig.body.rotation.z = Math.min(Math.PI / 2, rig.body.rotation.z + dt * 4);
      rig.body.position.y = -0.2;
    } else {
      rig.body.rotation.z = 0;
      rig.body.position.y = Math.abs(Math.sin(p.walkPhase)) * 0.05 * p.moving;
    }
    // 受伤/无敌闪烁
    const inv = run.invulnT > 0;
    rig.visor.color.setHex(inv ? (Math.floor(time * 10) % 2 ? 0xffffff : 0xffe08a) : p.hurtT > 0 ? 0xff3a3a : 0x6affe8);
    rig.body.visible = !(p.iframe > 0 && Math.floor(time * 30) % 2 === 0 && p.alive);
  }

  /** 其他玩家 */
  private updateRemotes(w: World, dt: number, time: number): void {
    const seen = new Set<number>();
    if (w.net) {
      for (const r of w.net.remotes()) {
        seen.add(r.id);
        let v = this.remoteRigs.get(r.id);
        if (!v) {
          const rig = M.playerRig();
          const ring = new THREE.Mesh(this.ringGeoP, new THREE.MeshBasicMaterial({ map: T.ringTexture(), color: SLOT_COLORS[r.slot % 4], transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
          ring.renderOrder = 2;
          this.root.add(rig.root, ring);
          v = { rig, ring, gunKey: ['', ''], suit: -1 };
          this.remoteRigs.set(r.id, v);
        }
        this.poseRemote(v, r, dt, time);
      }
    }
    for (const [id, v] of this.remoteRigs) {
      if (seen.has(id)) continue;
      v.rig.root.removeFromParent();
      v.ring.removeFromParent();
      this.remoteRigs.delete(id);
    }
  }

  private poseRemote(v: RemoteRig, r: RemotePlayer, dt: number, time: number): void {
    const rig = v.rig;
    rig.root.visible = !r.dead;
    v.ring.visible = !r.dead && !r.downed;
    if (r.dead) return;
    rig.root.position.set(r.x, 0, -r.y);
    rig.root.rotation.y = r.face;
    const big = r.prof?.relics?.includes('might') ? RELIC.mightScale : 1;
    rig.root.scale.setScalar(big);
    v.ring.scale.setScalar(big);
    v.ring.position.set(r.x, 0.05, -r.y);
    (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.4 + Math.sin(time * 4 + r.id) * 0.12;
    if (v.suit !== r.suit) {
      v.suit = r.suit;
      for (const m of rig.suitMats) m.color.setHex(M.SUIT_COLORS[Math.min(5, r.suit)]);
    }
    for (let h = 0; h < 2; h++) {
      const look = r.looks[h];
      const key = look ? String(look.seed) + ':' + r.lookRarity[h] : '';
      if (v.gunKey[h] !== key) {
        v.gunKey[h] = key;
        const holder = h === 0 ? rig.gunR : rig.gunL;
        holder.clear();
        if (look) holder.add(M.gunMesh(look));
      }
    }
    const sw = Math.sin(r.walkPhase) * 0.6 * r.moving;
    rig.legL.rotation.z = sw;
    rig.legR.rotation.z = -sw;
    for (let h = 0; h < 2; h++) {
      const arm = h === 0 ? rig.armR : rig.armL;
      const ft = r.firingT[h];
      const kick = ft < 0.08 ? (0.08 - ft) * 1.6 : 0;
      arm.position.x = -kick;
      arm.rotation.z = r.reloading[h] ? -0.5 + Math.sin(time * 14) * 0.08 : 0.02 + kick * 2;
    }
    if (r.downed) {
      rig.body.rotation.z = Math.min(Math.PI / 2, rig.body.rotation.z + dt * 4);
      rig.body.position.y = -0.2;
    } else {
      rig.body.rotation.z = 0;
      rig.body.position.y = Math.abs(Math.sin(r.walkPhase)) * 0.05 * r.moving;
    }
    rig.visor.color.setHex(r.invuln ? (Math.floor(time * 10) % 2 ? 0xffffff : 0xffe08a) : r.hurtT > 0 ? 0xff3a3a : SLOT_COLORS[r.slot % 4]);
  }

  private updateBoss(w: World, dt: number, time: number): void {
    const be = w.bossEnemy;
    if (!be || be.dead) {
      this.teleLine.count = 0;
      this.teleCircle.count = 0;
      this.beamGlow.count = 0;
      this.beamCore.count = 0;
      this.teleRing.count = 0;
      // 倒下的 Boss（胜利，或第五区击败牢大后打开隐秘核心）
      if (this.boss) {
        this.boss.body.rotation.z = Math.min(Math.PI / 2, this.boss.body.rotation.z + dt * 1.2);
        this.boss.body.position.y = Math.max(-0.6, this.boss.body.position.y - dt * 0.5);
      }
      return;
    }
    const kind = w.boss?.kind ?? (w.layout.index >= 6 ? 'mamba' : 'laoda');
    if (this.boss && this.boss.kind !== kind) { this.boss.root.removeFromParent(); this.boss = null; }
    if (!this.boss) {
      this.boss = M.bossRig(kind);
      this.boss.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = this.shadowOn; });
      this.root.add(this.boss.root);
    }
    const r = this.boss;
    const B = w.boss;
    r.root.position.set(be.x, 0, -be.y);
    r.root.rotation.y = be.face;
    const anim = B ? B.anim : 0;
    const sw = Math.sin(be.phase) * 0.45;
    r.legL.rotation.z = anim === 2 ? 0.6 : sw;
    r.legR.rotation.z = anim === 2 ? -0.6 : -sw;
    let lean = 0, armL = -sw * 0.5, armR = sw * 0.5;
    if (anim === 1) { lean = -0.15; armL = armR = -1.2 + Math.sin(time * 20) * 0.05; }
    else if (anim === 2) { lean = 0.45; armL = armR = 1.3; }
    else if (anim === 3) { armR = -2.4 * (B?.throwPose ?? 0); armL = 0.3; lean = -0.1; }
    else if (anim === 4) { lean = Math.sin(time * 6) * 0.1; armL = armR = 0.4; }
    r.body.rotation.z += (-lean - r.body.rotation.z) * Math.min(1, dt * 10);
    r.armL.rotation.z += (armL - r.armL.rotation.z) * Math.min(1, dt * 12);
    r.armR.rotation.z += (armR - r.armR.rotation.z) * Math.min(1, dt * 12);
    const enraged = B?.enraged;
    const mb = r.kind === 'mamba';
    r.flesh.emissive.setHex(be.flash > 0 ? 0x888888 : enraged ? (mb ? 0x2a0440 : 0x3a0400) : 0x000000);
    r.eyes.color.setHex(enraged ? 0xff2a1a : mb ? 0x4affe0 : 0xffd23a);
    // 蛇尾摆动
    for (let i = 0; i < r.tail.length; i++) r.tail[i].rotation.y = Math.sin(time * 3 + i * 0.7) * 0.25 + (anim === 2 ? 0 : 0.05);
    // 预警与技能范围
    let li = 0, ci = 0, bi = 0, ri = 0;
    for (const t of B?.telegraphs ?? []) {
      const k = t.t / t.dur;
      if (t.kind === 'beam' && bi < 6) {
        // 激光：从 Boss 身边射出，长度会被柱子 / 墙挡住
        const cx = t.x + Math.cos(t.a) * t.len / 2, cy = t.y + Math.sin(t.a) * t.len / 2;
        const flick = 0.85 + Math.sin(time * 40 + bi) * 0.15;
        dummy.position.set(cx, 1.15, -cy);
        dummy.rotation.set(0, t.a, 0);
        dummy.scale.set(t.len, 1, t.r * 2.6 * flick);
        dummy.updateMatrix();
        this.beamGlow.setMatrixAt(bi, dummy.matrix);
        dummy.position.y = 1.17;
        dummy.scale.set(t.len, 1, t.r * 0.8);
        dummy.updateMatrix();
        this.beamCore.setMatrixAt(bi, dummy.matrix);
        bi++;
        continue;
      }
      if (t.kind === 'ring' && ri < 4) {
        dummy.position.set(t.x, 0.08, -t.y);
        dummy.rotation.set(0, 0, 0);
        const rr = t.r * 2 * (0.3 + k * 0.85);
        dummy.scale.set(rr, 1, rr);
        dummy.updateMatrix();
        this.teleRing.setMatrixAt(ri++, dummy.matrix);
        continue;
      }
      if (t.kind === 'line' && li < 8) {
        dummy.position.set(t.x + Math.cos(t.a) * t.len / 2, 0.05, -(t.y + Math.sin(t.a) * t.len / 2));
        dummy.rotation.set(0, t.a, 0);
        dummy.scale.set(t.len, 1, t.r * 2 * (0.5 + k * 0.5));
        dummy.updateMatrix();
        this.teleLine.setMatrixAt(li++, dummy.matrix);
      } else if (t.kind === 'circle' && ci < 12) {
        dummy.position.set(t.x, 0.06, -t.y);
        dummy.rotation.set(0, 0, 0);
        const rr = t.r * 2 * (1.2 - k * 0.2);
        dummy.scale.set(rr, 1, rr);
        dummy.updateMatrix();
        this.teleCircle.setMatrixAt(ci++, dummy.matrix);
      }
    }
    (this.teleLine.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(time * 18) * 0.12;
    (this.beamGlow.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(time * 30) * 0.1;
    this.teleLine.count = li;
    this.teleCircle.count = ci;
    this.beamGlow.count = bi;
    this.beamCore.count = bi;
    this.teleRing.count = ri;
    this.teleLine.instanceMatrix.needsUpdate = true;
    this.teleCircle.instanceMatrix.needsUpdate = true;
    this.beamGlow.instanceMatrix.needsUpdate = true;
    this.beamCore.instanceMatrix.needsUpdate = true;
    this.teleRing.instanceMatrix.needsUpdate = true;
  }

  private updateProjectiles(w: World, time: number, camera: THREE.Camera): void {
    let no = 0, nb = 0, nr = 0, ns = 0, nm = 0, nbm = 0;
    const setOrb = (x: number, y: number, z: number, ang: number, len: number, rad: number, color: number, k = 1) => {
      if (no >= 1600) return;
      dummy.position.set(x, z, -y);
      dummy.rotation.set(0, ang, 0);
      dummy.scale.set(len, rad, rad);
      dummy.updateMatrix();
      this.orbs.setMatrixAt(no, dummy.matrix);
      tmpCol.setHex(color).multiplyScalar(k);
      this.orbs.setColorAt(no, tmpCol);
      no++;
    };
    for (const p of w.projs.list) {
      if (p.dead) continue;
      const ang = Math.atan2(p.vy, p.vx);
      const sp = Math.hypot(p.vx, p.vy);
      switch (p.kind) {
        case 'bomb': {
          dummy.position.set(p.x, 0.3, -p.y);
          dummy.rotation.set(p.spin, ang, 0);
          dummy.scale.setScalar(0.3);
          dummy.updateMatrix();
          this.bombs.setMatrixAt(nb++, dummy.matrix);
          const blink = Math.sin(p.age * (8 + p.age * 10)) > 0 ? 1.4 : 0.3;
          setOrb(p.x, p.y, 0.62, 0, 0.12, 0.12, 0xff3a2a, blink);
          break;
        }
        case 'rocket':
          dummy.position.set(p.x, 1.1, -p.y);
          dummy.rotation.set(0, ang, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          this.rockets.setMatrixAt(nr++, dummy.matrix);
          setOrb(p.x - Math.cos(ang) * 0.55, p.y - Math.sin(ang) * 0.55, 1.1, ang, 0.5, 0.22, 0xff8a2a, 1.4);
          break;
        case 'saw':
          dummy.position.set(p.x, 0.9, -p.y);
          dummy.rotation.set(0, p.spin, 0);
          dummy.scale.set(p.r, 1, p.r);
          dummy.updateMatrix();
          this.saws.setMatrixAt(ns++, dummy.matrix);
          break;
        case 'boomer':
          dummy.position.set(p.x, 1.0, -p.y);
          dummy.rotation.set(0, p.spin, 0);
          dummy.scale.setScalar(p.r * 2.4);
          dummy.updateMatrix();
          this.boomers.setMatrixAt(nbm++, dummy.matrix);
          break;
        case 'mine':
          dummy.position.set(p.x, 0.06, -p.y);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          this.mines.setMatrixAt(nm++, dummy.matrix);
          // 已触发的地雷快速闪烁并放大指示灯
          if (p.state === 2) setOrb(p.x, p.y, 0.18, 0, 0.2, 0.2, 0xff2a1a, Math.sin(time * 40) > 0 ? 2.4 : 0.6);
          else setOrb(p.x, p.y, 0.16, 0, 0.1, 0.1, p.state ? 0xff2a1a : 0xffd23a, Math.sin(time * 10 + p.x) > 0 ? 1.6 : 0.4);
          break;
        default: {
          const beam = p.def.flags?.beam;
          const len = beam ? 2.4 : p.r * 1.6 + sp * 0.012;
          const rad = beam ? 0.06 : p.r * (p.kind === 'singular' ? 2.5 : p.kind === 'toxic' ? 1.6 : 0.75);
          // 虹彩子弹：颜色随时间流转；闪耀子弹：更亮
          let col = p.color, k = 1.0;
          if (p.fancy & FANCY_IRI) col = tmpCol.setHSL((time * 0.8 + p.x * 0.05) % 1, 1, 0.6).getHex();
          if (p.fancy & FANCY_SHINY) k = 1.6;
          setOrb(p.x - Math.cos(ang) * len * 0.4, p.y - Math.sin(ang) * len * 0.4, p.z, ang, len, rad, col, k);
        }
      }
    }
    // 敌方投射物
    let nsp = 0, nrk = 0;
    for (const s of w.enemies.shots) {
      if (s.dead) continue;
      if (s.kind === 'spit') {
        dummy.position.set(s.x, 1.1, -s.y);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(s.r);
        dummy.updateMatrix();
        if (nsp < 120) this.spits.setMatrixAt(nsp++, dummy.matrix);
      } else if (nrk < 20) {
        const k = Math.min(1, s.t! / s.dur!);
        dummy.position.set(s.x, 1.2 + Math.sin(k * Math.PI) * 6, -s.y);
        dummy.rotation.set(time * 3, time * 2, 0);
        dummy.scale.setScalar(1.1);
        dummy.updateMatrix();
        this.rocks.setMatrixAt(nrk++, dummy.matrix);
      }
    }
    const fin = (m: THREE.InstancedMesh, n: number) => {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
    fin(this.orbs, no); fin(this.bombs, nb); fin(this.rockets, nr); fin(this.saws, ns); fin(this.boomers, nbm); fin(this.mines, nm);
    fin(this.spits, nsp); fin(this.rocks, nrk);
    void camera;
  }

  private updateCoins(w: World, time: number): void {
    let n = 0;
    for (const c of w.pickups.coins) {
      if (c.dead || n >= 700) continue;
      const s = 1 + Math.min(1.4, Math.log10(Math.max(1, c.amount)) * 0.35);
      dummy.position.set(c.x, 0.25 + c.z + Math.sin(time * 4 + c.x) * 0.05, -c.y);
      dummy.rotation.set(0, time * 3 + c.x, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.coins.setMatrixAt(n++, dummy.matrix);
    }
    this.coins.count = n;
    this.coins.instanceMatrix.needsUpdate = true;
  }

  private updateItems(w: World, time: number): void {
    const alive = new Set<number>();
    for (const it of w.pickups.items) {
      if (it.dead) continue;
      alive.add(it.uid);
      let v = this.items.get(it.uid);
      if (!v) {
        v = this.makeItem(it);
        this.items.set(it.uid, v);
        this.root.add(v.g);
      }
      v.g.position.set(it.x, 0, -it.y);
      v.model.position.y = 0.75 + Math.sin(time * 2.2 + it.uid) * 0.12;
      v.model.rotation.y = time * 1.2 + it.uid;
      (v.beam.material as THREE.MeshBasicMaterial).opacity = 0.45 + Math.sin(time * 3 + it.uid) * 0.15;
      v.ring.rotation.z = time;
      // 奇物：颜色流转
      if (it.thing.kind === 'relic') {
        const c = tmpCol.setHSL((time * 0.3) % 1, 1, 0.65);
        (v.beam.material as THREE.MeshBasicMaterial).color.copy(c);
        (v.ring.material as THREE.MeshBasicMaterial).color.copy(c);
        v.model.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (m && (m as any).isMeshBasicMaterial) m.color.copy(c); });
      }
    }
    for (const [uid, v] of this.items) {
      if (!alive.has(uid)) { v.g.removeFromParent(); this.items.delete(uid); }
    }
  }

  private makeItem(it: WorldItem): { g: THREE.Group; model: THREE.Object3D; beam: THREE.Mesh; ring: THREE.Mesh } {
    const g = new THREE.Group();
    const th = it.thing;
    let color = 0xffffff;
    let model: THREE.Object3D;
    if (th.kind === 'gun') {
      color = RARITY_HEX[th.rarity];
      model = M.gunMesh(th.look, 1.8);
      model.children.forEach((c) => (c.position.x -= th.look.bodyLen * 0.4));
    } else if (th.kind === 'bullet') {
      color = BULLETS[th.def].color;
      model = bulletModel(color);
    } else if (th.kind === 'item') {
      color = new THREE.Color(ITEMS[th.id].color).getHex();
      model = itemModel(th.id, color);
    } else if (th.kind === 'relic') {
      model = relicModel();
    } else {
      model = new THREE.Group();
    }
    g.add(model);
    const beam = new THREE.Mesh(this.itemBeamGeo, new THREE.MeshBasicMaterial({ map: T.beamTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 3.5;
    g.add(beam);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ map: T.ringTexture(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    return { g, model, beam, ring };
  }

  private updateHazards(w: World, time: number): void {
    let ng = 0, nv = 0;
    for (const h of w.projs.hazards) {
      if (h.dead) continue;
      const fadeIn = Math.min(1, h.t * 4), fadeOut = Math.min(1, (h.dur - h.t) * 2);
      if (ng < 40) {
        dummy.position.set(h.x, 0.07, -h.y);
        dummy.rotation.set(0, time * 0.5, 0);
        const s = h.r * 2.6 * fadeIn;
        dummy.scale.set(s, 1, s);
        dummy.updateMatrix();
        this.hazardGlow.setMatrixAt(ng, dummy.matrix);
        this.hazardGlow.setColorAt(ng, tmpCol.setHex(h.kind === 'toxic' ? 0x4aff1a : 0x8a2aff).multiplyScalar(0.6 * fadeOut));
        ng++;
      }
      if (h.kind === 'vortex' && nv < 20) {
        dummy.position.set(h.x, 1.0, -h.y);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.5 + Math.sin(time * 20) * 0.05 + (h.t / h.dur) * 0.4);
        dummy.updateMatrix();
        this.vortexCore.setMatrixAt(nv++, dummy.matrix);
      }
    }
    this.hazardGlow.count = ng;
    this.vortexCore.count = nv;
    this.hazardGlow.instanceMatrix.needsUpdate = true;
    if (this.hazardGlow.instanceColor) this.hazardGlow.instanceColor.needsUpdate = true;
    this.vortexCore.instanceMatrix.needsUpdate = true;
  }
}

/** 奇物：悬浮的八面体晶体与环绕的金环 */
function relicModel(): THREE.Object3D {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  core.scale.set(1, 1.5, 1);
  const shell = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.6 }));
  shell.scale.set(1, 1.5, 1);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 6, 24), new THREE.MeshLambertMaterial({ color: 0xffc83a, emissive: 0x6a4a00 }));
  ring.rotation.x = Math.PI / 2.4;
  g.add(core, shell, ring);
  g.scale.setScalar(1.2);
  return g;
}

function bulletModel(color: number): THREE.Object3D {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.42, 10), new THREE.MeshLambertMaterial({ color: 0xc89a3a, emissive: 0x3a2400 }));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 10), new THREE.MeshBasicMaterial({ color }));
  tip.position.y = 0.32;
  g.add(shell, tip);
  g.rotation.z = 0.5;
  g.scale.setScalar(1.3);
  return g;
}

function itemModel(id: string, color: number): THREE.Object3D {
  const g = new THREE.Group();
  const glow = new THREE.MeshBasicMaterial({ color });
  const lam = (c: number, e = 0x000000) => new THREE.MeshLambertMaterial({ color: c, emissive: e });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  switch (id) {
    case 'jar':
      add(new THREE.SphereGeometry(0.42, 12, 10), lam(0xc8962a, 0x4a3000), 0, 0, 0);
      add(new THREE.CylinderGeometry(0.22, 0.26, 0.2, 12), lam(0x8a6a2a), 0, 0.42, 0);
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), glow, 0, 0.55, 0);
      break;
    case 'serumHp': case 'serumSpd': case 'purify':
      add(new THREE.CylinderGeometry(0.13, 0.13, 0.55, 10), new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }), 0, 0, 0);
      add(new THREE.CylinderGeometry(0.1, 0.1, 0.42, 10), glow, 0, -0.04, 0);
      add(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 10), lam(0x3a3a3a), 0, 0.3, 0);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), lam(0xaaaaaa), 0, 0.44, 0);
      break;
    case 'part1': case 'part2': {
      const ring = add(new THREE.TorusGeometry(0.26, 0.09, 6, 12), lam(0x8a8e94, color), 0, 0, 0);
      ring.rotation.x = Math.PI / 2;
      for (let i = 0; i < 8; i++) {
        const t = add(new THREE.BoxGeometry(0.12, 0.12, 0.14), lam(0x8a8e94), Math.cos(i * Math.PI / 4) * 0.38, 0, Math.sin(i * Math.PI / 4) * 0.38);
        t.rotation.y = -i * Math.PI / 4;
      }
      add(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8), glow, 0, 0, 0);
      break;
    }
    case 'valuable':
      add(new THREE.OctahedronGeometry(0.32, 0), glow, 0, 0, 0).scale.set(1, 1.4, 1);
      break;
    case 'milkgold': {
      // 第4次调整：立着的防暴盾牌，正面一颗金色的星星
      const shield = new THREE.Shape();
      shield.moveTo(-0.3, 0.4); shield.lineTo(0.3, 0.4); shield.lineTo(0.3, -0.05);
      shield.quadraticCurveTo(0.3, -0.32, 0, -0.45); shield.quadraticCurveTo(-0.3, -0.32, -0.3, -0.05); shield.closePath();
      add(new THREE.ExtrudeGeometry(shield, { depth: 0.06, bevelEnabled: false }), lam(0xdde6ee, 0x30404a), 0, 0, -0.03);
      add(new THREE.BoxGeometry(0.44, 0.1, 0.02), new THREE.MeshLambertMaterial({ color: 0x506e8c, transparent: true, opacity: 0.7 }), 0, 0.27, 0.04);
      const star = new THREE.Shape();
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.07 : 0.17;
        if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      star.closePath();
      add(new THREE.ExtrudeGeometry(star, { depth: 0.03, bevelEnabled: false }), new THREE.MeshBasicMaterial({ color: 0xffd24a }), 0, -0.02, 0.035);
      break;
    }
    case 'overheat':
      add(new THREE.BoxGeometry(0.5, 0.12, 0.5), lam(0x2a2a2a), 0, 0, 0);
      add(new THREE.BoxGeometry(0.3, 0.08, 0.3), glow, 0, 0.08, 0);
      for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.04, 0.04, 0.6), lam(0xc8a040), -0.18 + i * 0.12, -0.04, 0);
      break;
    case 'painkiller':
      add(new THREE.CylinderGeometry(0.18, 0.18, 0.4, 12), lam(0xf0f0f0), 0, 0, 0);
      add(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12), lam(0xd82a2a, 0x400000), 0, 0.25, 0);
      add(new THREE.BoxGeometry(0.37, 0.16, 0.02), glow, 0, 0, 0.18);
      break;
    case 'kungfu':
      add(new THREE.BoxGeometry(0.55, 0.18, 0.24), lam(0x2a2a2a), 0, 0, 0);
      add(new THREE.BoxGeometry(0.3, 0.26, 0.24), lam(0x1a1a1a), -0.12, 0.18, 0);
      add(new THREE.BoxGeometry(0.56, 0.04, 0.25), lam(0xeeeeee), 0, -0.1, 0);
      break;
    case 'eel': {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) pts.push(new THREE.Vector3(-0.5 + i / 12, 0, Math.sin(i / 12 * Math.PI * 2) * 0.15));
      add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.07, 6), lam(0x2a4a7a, 0x10204a), 0, 0, 0);
      add(new THREE.SphereGeometry(0.03, 6, 4), glow, 0.47, 0.04, 0.03);
      break;
    }
    default:
      add(new THREE.BoxGeometry(0.4, 0.4, 0.4), glow);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}

export { timeUniform, tmpQ, UP };
