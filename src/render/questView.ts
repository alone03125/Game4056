// 区域任务与奇物宝箱的渲染（第4.1次调整）：信号区域（饼图进度）、可燃物堆、物资球与运载点、瘴气、奇物宝箱，
// 以及苦力怕爆炸前的红色危险范围。

import * as THREE from 'three';
import { CREEPER } from '../config';
import { creeperRadius } from '../game/enemies';
import { QUEST } from '../game/quest';
import type { World } from '../game/world';
import type { Particles } from './particles';
import type { ZoneView } from './zoneView';
import * as T from './textures';

const dummy = new THREE.Object3D();
const MAX_DANGER = 48;

const SIGNAL_VS = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// 饼图：已完成的扇区明亮，未完成的部分暗淡并有向内收缩的波纹；外圈为边框
const SIGNAL_FS = `uniform float uProg;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = fract(atan(p.x, p.y) / 6.2831853 + 1.0);
  float ring = smoothstep(0.88, 0.95, r) * (1.0 - smoothstep(0.97, 1.0, r));
  float done = step(ang, uProg);
  float wave = 0.5 + 0.5 * sin(uTime * 4.0 + r * 10.0);
  float edge = (1.0 - smoothstep(0.0, 0.012, abs(ang - uProg))) * step(0.001, uProg) * step(uProg, 0.999);
  float a = ring * 0.95 + done * (0.32 + 0.08 * wave) + (1.0 - done) * (0.06 + 0.06 * wave) + edge * 0.8;
  vec3 col = mix(uColor * 0.55, uColor, done);
  gl_FragColor = vec4(col + edge * 0.4, a);
}`;

interface PyreView { g: THREE.Group; flag: THREE.Mesh; ring: THREE.Mesh; flames: THREE.Mesh[]; lit: boolean; lightZone: ZoneView | null }

export class QuestView {
  root = new THREE.Group();
  private zoneRoot = new THREE.Group();
  private key = '';
  private sig: THREE.Mesh | null = null;
  private sigMat: THREE.ShaderMaterial;
  private pyres: PyreView[] = [];
  private balls: THREE.Mesh[] = [];
  private drop: THREE.Group | null = null;
  private dropRing: THREE.Mesh | null = null;
  // 第4.3次调整：送达后的消失动效
  private dropPadMat: THREE.MeshBasicMaterial | null = null;
  private dropBeamMat: THREE.MeshBasicMaterial | null = null;
  private cargoFx = false;
  private miasma: { mesh: THREE.Mesh; tex: THREE.DataTexture; data: Uint8Array; t: number } | null = null;
  private chest: THREE.Group;
  private chestBody: THREE.MeshLambertMaterial;
  private chestGlow: THREE.MeshBasicMaterial;
  private dangerFill: THREE.InstancedMesh;
  private dangerRing: THREE.InstancedMesh;
  private flameGeo = new THREE.PlaneGeometry(1, 1);
  private flameMat: THREE.MeshBasicMaterial;
  private ballMat: THREE.MeshLambertMaterial;
  private mistT = 0;
  private disposables: { dispose(): void }[] = [];

  constructor(scene: THREE.Scene, private particles: Particles) {
    scene.add(this.root);
    this.root.add(this.zoneRoot);
    this.sigMat = new THREE.ShaderMaterial({
      uniforms: { uProg: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0x4affe0) } },
      vertexShader: SIGNAL_VS, fragmentShader: SIGNAL_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.flameMat = new THREE.MeshBasicMaterial({ map: T.glowTexture(), color: 0xff7a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.ballMat = new THREE.MeshLambertMaterial({ map: ballTexture(), emissive: 0x2a2000 });
    // 苦力怕的危险范围：外圈 + 随倒计时扩大的填充
    const disc = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    this.dangerFill = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.22, depthWrite: false }), MAX_DANGER);
    this.dangerRing = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: T.ringTexture(), color: 0xff3a1a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), MAX_DANGER);
    for (const m of [this.dangerFill, this.dangerRing]) { m.frustumCulled = false; m.count = 0; m.renderOrder = 3; this.root.add(m); }
    // 奇物宝箱
    this.chest = new THREE.Group();
    this.chestBody = new THREE.MeshLambertMaterial({ color: 0x5a3a20, emissive: 0x000000 });
    const gold = new THREE.MeshLambertMaterial({ color: 0xffc83a, emissive: 0x6a4a00 });
    this.chestGlow = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      this.chest.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(1.5, 0.8, 1.0), this.chestBody, 0, 0.4, 0);
    const lid = add(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 14, 1, false, 0, Math.PI), this.chestBody, 0, 0.8, 0);
    lid.rotation.z = Math.PI / 2;
    lid.scale.set(1, 1, 1);
    for (const x of [-0.62, 0, 0.62]) add(new THREE.BoxGeometry(0.12, 0.84, 1.04), gold, x, 0.4, 0);
    const band = add(new THREE.TorusGeometry(0.5, 0.05, 6, 16, Math.PI), gold, 0, 0.8, 0);
    band.rotation.y = Math.PI / 2;
    add(new THREE.BoxGeometry(0.22, 0.26, 0.06), this.chestGlow, 0, 0.62, 0.52);
    add(new THREE.BoxGeometry(1.52, 0.04, 1.02), this.chestGlow, 0, 0.8, 0);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.5, 10, 12, 1, true), new THREE.MeshBasicMaterial({ map: T.beamTexture(), color: 0xffd24a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 5;
    this.chest.add(beam);
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: T.ringTexture(), color: 0xffd24a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.y = 0.05;
    ring.name = 'ring';
    this.chest.add(ring);
    this.chest.visible = false;
    this.root.add(this.chest);
  }

  private track<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  /** 换区：重建本区的任务物件 */
  private rebuild(w: World): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.zoneRoot.clear();
    this.sig = null;
    this.pyres = [];
    this.balls = [];
    this.drop = null;
    this.dropRing = null;
    this.dropPadMat = null;
    this.dropBeamMat = null;
    this.cargoFx = false;
    this.miasma = null;
    const q = w.quests;
    if (q.id === 'signal') {
      this.sig = new THREE.Mesh(this.track(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)), this.sigMat);
      this.sig.position.set(q.sig.x, 0.06, -q.sig.y);
      this.sig.renderOrder = 2;
      this.zoneRoot.add(this.sig);
      // 中央的信号塔
      const mast = new THREE.Group();
      const steel = this.track(new THREE.MeshLambertMaterial({ color: 0x8a9098 }));
      const glow = this.track(new THREE.MeshBasicMaterial({ color: 0x4affe0 }));
      const pole = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.08, 0.14, 3.2, 8)), steel);
      pole.position.y = 1.6;
      const dish = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.55, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.6)), steel);
      dish.position.y = 2.6;
      dish.rotation.x = -Math.PI / 2.4;
      const tip = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.14, 8, 6)), glow);
      tip.position.y = 3.3;
      const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.9, 0.4, 0.9)), steel);
      base.position.y = 0.2;
      mast.add(pole, dish, tip, base);
      mast.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      mast.position.set(q.sig.x, 0, -q.sig.y);
      mast.name = 'mast';
      this.zoneRoot.add(mast);
    }
    if (q.id === 'pyre') {
      const wood = this.track(new THREE.MeshLambertMaterial({ color: 0x6a4428 }));
      const dark = this.track(new THREE.MeshLambertMaterial({ color: 0x222222 }));
      const pole = this.track(new THREE.MeshLambertMaterial({ color: 0xc8c8c8 }));
      const flagMat = this.track(new THREE.MeshLambertMaterial({ color: 0xff2a1a, emissive: 0x500800, side: THREE.DoubleSide }));
      const logGeo = this.track(new THREE.CylinderGeometry(0.13, 0.15, 1.5, 7).rotateZ(Math.PI / 2));
      const tireGeo = this.track(new THREE.TorusGeometry(0.42, 0.16, 6, 12).rotateX(Math.PI / 2));
      const poleGeo = this.track(new THREE.CylinderGeometry(0.04, 0.04, 2.8, 6));
      const flagGeo = this.track(new THREE.PlaneGeometry(0.9, 0.55).translate(0.45, 0, 0));
      const ringGeo = this.track(new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2));
      for (const p of q.pyres) {
        const g = new THREE.Group();
        g.position.set(p.x, 0, -p.y);
        for (let k = 0; k < 6; k++) {
          const log = new THREE.Mesh(logGeo, wood);
          const layer = Math.floor(k / 2);
          log.position.set(k % 2 ? 0.28 : -0.28, 0.16 + layer * 0.26, 0);
          log.rotation.y = layer % 2 ? Math.PI / 2 : 0;
          if (layer % 2) log.position.set(0, 0.16 + layer * 0.26, k % 2 ? 0.28 : -0.28);
          log.castShadow = true;
          g.add(log);
        }
        const tire = new THREE.Mesh(tireGeo, dark);
        tire.position.y = 0.95;
        g.add(tire);
        const pl = new THREE.Mesh(poleGeo, pole);
        pl.position.set(0.55, 1.4, 0.55);
        g.add(pl);
        const flag = new THREE.Mesh(flagGeo, flagMat);
        flag.position.set(0.55, 2.5, 0.55);
        g.add(flag);
        const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: T.ringTexture(), color: 0xff8a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        this.track(ring.material as THREE.Material);
        ring.position.y = 0.05;
        g.add(ring);
        const flames: THREE.Mesh[] = [];
        for (let k = 0; k < 4; k++) {
          const f = new THREE.Mesh(this.flameGeo, this.flameMat);
          f.visible = false;
          g.add(f);
          flames.push(f);
        }
        this.zoneRoot.add(g);
        this.pyres.push({ g, flag, ring, flames, lit: false, lightZone: null });
      }
    }
    if (q.id === 'cargo') {
      const geo = this.track(new THREE.SphereGeometry(QUEST.ballR, 20, 14));
      for (let i = 0; i < q.balls.length; i++) {
        const m = new THREE.Mesh(geo, this.ballMat);
        m.castShadow = true;
        this.zoneRoot.add(m);
        this.balls.push(m);
      }
      const g = new THREE.Group();
      g.position.set(q.drop.x, 0, -q.drop.y);
      const padMat = this.track(new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.16, depthWrite: false }));
      const pad = new THREE.Mesh(this.track(new THREE.CircleGeometry(q.drop.r, 36).rotateX(-Math.PI / 2)), padMat);
      pad.position.y = 0.04;
      const ring = new THREE.Mesh(this.track(new THREE.PlaneGeometry(q.drop.r * 2.3, q.drop.r * 2.3).rotateX(-Math.PI / 2)), this.track(new THREE.MeshBasicMaterial({ map: T.ringTexture(), color: 0xffd24a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      ring.position.y = 0.06;
      const beamMat = this.track(new THREE.MeshBasicMaterial({ map: T.beamTexture(), color: 0xffd24a, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      const beam = new THREE.Mesh(this.track(new THREE.CylinderGeometry(q.drop.r * 0.9, q.drop.r, 6, 24, 1, true)), beamMat);
      beam.position.y = 3;
      g.add(pad, ring, beam);
      this.zoneRoot.add(g);
      this.drop = g;
      this.dropRing = ring;
      this.dropPadMat = padMat;
      this.dropBeamMat = beamMat;
    }
    if (q.id === 'miasma' && q.mz) {
      const m = q.mz;
      const data = new Uint8Array(m.w * m.h * 4);
      const tex = this.track(new THREE.DataTexture(data, m.w, m.h, THREE.RGBAFormat));
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = this.track(new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
      const mesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(m.w, m.h).rotateX(-Math.PI / 2)), mat);
      mesh.position.set(m.x0 + m.w / 2, 0.035, -(m.y0 + m.h / 2));
      mesh.renderOrder = 1;
      mesh.receiveShadow = true;
      this.zoneRoot.add(mesh);
      this.miasma = { mesh, tex, data, t: 0 };
      m.changed = true;
    }
  }

  update(w: World, dt: number, time: number, camera: THREE.Camera, zone: ZoneView | null): void {
    const q = w.quests;
    const key = `${w.layout.seed}|${q.zone}|${q.id}`;
    if (key !== this.key) { this.key = key; this.rebuild(w); }
    // 信号区域
    if (this.sig) {
      const need = q.signalNeed();
      this.sigMat.uniforms.uProg.value = q.done ? 1 : Math.min(1, q.progress / need);
      this.sigMat.uniforms.uTime.value = time;
      this.sig.scale.setScalar(q.sig.r);
      const mast = this.zoneRoot.getObjectByName('mast');
      if (mast) mast.children[2].scale.setScalar(1 + Math.sin(time * 6) * 0.3);
    }
    // 可燃物堆
    const cq = (camera as THREE.PerspectiveCamera).quaternion;
    q.pyres.forEach((p, i) => {
      const v = this.pyres[i];
      if (!v) return;
      v.flag.rotation.y = Math.sin(time * 3 + i) * 0.35;
      (v.ring.material as THREE.MeshBasicMaterial).opacity = p.lit ? 0 : 0.55 + Math.sin(time * 4 + i) * 0.3;
      if (p.lit && !v.lit) {
        v.lit = true;
        v.flag.visible = false;
        for (const f of v.flames) f.visible = true;
      }
      if (p.lit && zone && v.lightZone !== zone) {
        v.lightZone = zone;
        zone.lights.push({ x: p.x, y: p.y, h: 2.0, color: 0xff8a3a, intensity: 26, flicker: 2 });
      }
      if (v.lit) {
        v.flames.forEach((f, k) => {
          const ph = time * (5 + k) + i * 1.7 + k * 2;
          const grow = Math.min(1, p.litT * 2);
          const s = (1.5 - k * 0.22) * (0.9 + Math.sin(ph) * 0.2) * grow;
          f.position.set(Math.sin(ph * 0.7) * 0.12, 1.0 + k * 0.45, Math.cos(ph * 0.5) * 0.1);
          f.quaternion.copy(cq);
          f.scale.set(s * 1.1, s * 1.6, 1);
        });
        if (Math.random() < dt * 8) this.particles.sparks(p.x, p.y, 0xffa040, 1, 1.5, 1.6);
        if (Math.random() < dt * 3) this.particles.smoke(p.x, p.y, 1, 0x3a3634);
      }
    });
    // 物资球与运载点（第4.3次调整：送达后，送达的物资球沉入运载点，运载点收拢成一道光柱消失，剩下的物资球沉入地面）
    const cargoDone = q.id === 'cargo' && q.done;
    const fade = cargoDone ? Math.min(1, q.doneT / 1.4) : 0;
    if (cargoDone && !this.cargoFx) {
      this.cargoFx = true;
      if (q.doneT < 1) {
        this.particles.sparks(q.drop.x, q.drop.y, 0xffd24a, 36, 6, 0.6);
        for (const b of q.balls) if (!b.done) { this.particles.smoke(b.x, b.y, 6, 0x8a7a5a); this.particles.sparks(b.x, b.y, 0xffe08a, 10, 3, 0.8); }
      }
    }
    q.balls.forEach((b, i) => {
      const m = this.balls[i];
      if (!m) return;
      if (b.done || cargoDone) {
        // 送达的物资球滑向运载点中心并沉下去；其余的直接沉入地面
        const k = b.done ? Math.min(1, q.doneT / 0.9) : fade;
        const e = k * k * (3 - 2 * k);
        const tx = b.done ? q.drop.x : b.x, ty = b.done ? q.drop.y : b.y;
        m.visible = k < 1;
        m.position.set(b.x + (tx - b.x) * e, QUEST.ballR * (1 - e * 2.1), -(b.y + (ty - b.y) * e));
        m.scale.setScalar(1 - e * 0.45);
        m.rotateY(dt * 6 * e);
        return;
      }
      m.visible = true;
      m.scale.setScalar(1);
      m.position.set(b.x, QUEST.ballR, -b.y);
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0.05) m.rotation.set(0, Math.atan2(b.vx, b.vy) + Math.PI, 0);
      m.rotateX(b.spin);
    });
    if (this.drop && this.dropRing) {
      this.dropRing.rotation.y = time * 0.6 + fade * fade * 9;
      this.dropRing.scale.setScalar((1 + Math.sin(time * 3) * 0.05) * (1 + fade * 0.35));
      // 收拢：平面缩小、光柱拉长后消失
      this.drop.scale.set(1 - fade, 1 + fade * 2.2, 1 - fade);
      if (this.dropPadMat) this.dropPadMat.opacity = 0.16 * (1 - fade);
      if (this.dropBeamMat) this.dropBeamMat.opacity = 0.2 + Math.sin(Math.PI * fade) * 0.6;
      this.drop.visible = fade < 1;
    }
    // 瘴气
    const mz = this.miasma;
    if (mz && q.mz) {
      mz.t -= dt;
      if (q.mz.changed && mz.t <= 0) {
        mz.t = 0.1;
        q.mz.changed = false;
        const c = q.mz.cells, d = mz.data;
        for (let i = 0; i < c.length; i++) {
          const k = i * 4;
          // 被污染的地面：深绿色，带一点斑驳
          if (c[i] === 1) { const n = (Math.imul(i, 2654435761) >>> 28) & 15; d[k] = 14 + n; d[k + 1] = 42 + n * 2; d[k + 2] = 18 + (n >> 1); d[k + 3] = 225; }
          else d[k + 3] = 0;
        }
        mz.tex.needsUpdate = true;
      }
      (mz.mesh.material as THREE.MeshLambertMaterial).opacity = 0.9 + Math.sin(time * 1.3) * 0.06;
      // 被污染的道路上飘起淡淡的瘴气
      this.mistT -= dt;
      if (this.mistT <= 0 && !q.done) {
        this.mistT = 0.08;
        const m = q.mz, v = w.view;
        for (let k = 0; k < 3; k++) {
          const x = v.x + (Math.random() - 0.5) * 30, y = v.y + (Math.random() - 0.5) * 24;
          const cx = Math.floor(x - m.x0), cy = Math.floor(y - m.y0);
          if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h || m.cells[cy * m.w + cx] !== 1) continue;
          this.particles.cloud(x, y, 0.6, 0x2a5a26);
        }
      }
    }
    // 奇物宝箱
    const chest = q.chest();
    this.chest.visible = !!chest;
    if (chest) {
      this.chest.position.set(chest.x, Math.abs(Math.sin(time * 2)) * 0.05, -chest.y);
      this.chest.rotation.y = Math.sin(time * 0.8) * 0.25;
      this.chestBody.emissive.setHex(chest.flash > 0 ? 0x888888 : 0x000000);
      this.chestGlow.color.setHSL((time * 0.4) % 1, 0.9, 0.7);
      const ring = this.chest.getObjectByName('ring');
      if (ring) ring.rotation.y = time;
      if (Math.random() < dt * 10) this.particles.sparks(chest.x + (Math.random() - 0.5) * 1.6, chest.y + (Math.random() - 0.5) * 1.6, 0xffe08a, 1, 1.2, 0.4 + Math.random() * 1.2);
    }
    // 苦力怕：爆炸前的危险范围
    let n = 0;
    for (const e of w.enemies.list) {
      if (e.dead || e.type !== 'creeper' || e.fuse < 0 || n >= MAX_DANGER) continue;
      const R = creeperRadius(e.elite);
      const k = Math.min(1, 1 - Math.max(0, e.fuse) / CREEPER.fuse);
      dummy.position.set(e.x, 0.07, -e.y);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(R * 2.3, 1, R * 2.3);
      dummy.updateMatrix();
      this.dangerRing.setMatrixAt(n, dummy.matrix);
      dummy.position.y = 0.065;
      dummy.scale.set(R * k, 1, R * k);
      dummy.updateMatrix();
      this.dangerFill.setMatrixAt(n, dummy.matrix);
      n++;
    }
    this.dangerFill.count = n;
    this.dangerRing.count = n;
    this.dangerFill.instanceMatrix.needsUpdate = true;
    this.dangerRing.instanceMatrix.needsUpdate = true;
    (this.dangerRing.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.sin(time * 16) * 0.3;
  }
}

/** 物资球：黄黑相间的条纹，中间印着“物资” */
function ballTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e8b030';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#2a2622';
  for (let i = 0; i < 8; i++) g.fillRect(i * 32, 0, 12, 128);
  g.fillStyle = '#d8d0c0';
  g.fillRect(0, 54, 256, 20);
  g.fillStyle = '#c02a1a';
  g.font = 'bold 18px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) g.fillText('物资', 32 + i * 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
