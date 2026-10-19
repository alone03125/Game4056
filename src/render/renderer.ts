// 渲染器：three.js 场景、俯视相机、灯光（阴影/手电/枪口火光/爆炸光/环境光源）、后期泛光。

import * as THREE from 'three';
import { SUIT_MAX } from '../config';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { World } from '../game/world';
import { ZoneLayout } from '../world/zone';
import { EntityView } from './entities';
import { Particles } from './particles';
import { ZoneView } from './zoneView';
import { ScreenPt } from './overlay';
import { damp } from '../util/math';

export type Quality = 0 | 1 | 2; // 低 / 中 / 高

interface PooledLight { light: THREE.PointLight; t: number; dur: number; peak: number }

export class Renderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  flash: THREE.SpotLight;
  muzzleLights: PooledLight[] = [];
  boomLights: PooledLight[] = [];
  envLights: THREE.PointLight[] = [];
  zone: ZoneView | null = null;
  entities: EntityView;
  particles: Particles;
  quality: Quality;
  zoom = 1;
  shakeAmt = 0;
  shakeEnabled = true;
  camX = 0;
  camY = 0;
  private envT = 0;
  private boomIdx = 0;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.0);
  private v3 = new THREE.Vector3();
  private ndc = new THREE.Vector2();
  width = 1;
  height = 1;

  constructor(container: HTMLElement, quality: Quality) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality >= 1, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.shadowMap.enabled = quality >= 1;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'gl-canvas';
    container.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 220);
    this.hemi = new THREE.HemisphereLight(0x9aa4b0, 0x4a3c30, 1.2);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffc690, 1.5);
    this.sun.castShadow = quality >= 1;
    const sm = quality >= 2 ? 2048 : 1024;
    this.sun.shadow.mapSize.set(sm, sm);
    const sc = this.sun.shadow.camera;
    sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 90;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.flash = new THREE.SpotLight(0xfff0d0, 60, 26, Math.PI / 6.5, 0.55, 1.4);
    this.scene.add(this.flash, this.flash.target);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffc070, 0, 9, 1.8);
      this.scene.add(l);
      this.muzzleLights.push({ light: l, t: 1, dur: 0.06, peak: 30 });
    }
    const nBoom = quality >= 1 ? 3 : 1;
    for (let i = 0; i < nBoom; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 16, 1.6);
      this.scene.add(l);
      this.boomLights.push({ light: l, t: 1, dur: 0.35, peak: 120 });
    }
    const nEnv = quality >= 2 ? 6 : quality === 1 ? 4 : 2;
    for (let i = 0; i < nEnv; i++) {
      const l = new THREE.PointLight(0xffc880, 0, 14, 1.6);
      this.scene.add(l);
      this.envLights.push(l);
    }
    this.entities = new EntityView(this.scene, quality >= 1);
    this.particles = new Particles(this.scene, quality >= 2 ? 6000 : quality === 1 ? 4000 : 2000);
    this.particles.density = quality >= 2 ? 1 : quality === 1 ? 0.8 : 0.5;
    if (quality >= 2) this.setupComposer();
  }

  private setupComposer(): void {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.55, 0.45, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality >= 2 ? 2 : this.quality === 1 ? 1.5 : 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    this.particles.setScale(h * pr * 0.9);
  }

  buildZone(layout: ZoneLayout): void {
    if (this.zone) this.zone.dispose();
    this.entities.clearZone();
    this.particles.clear();
    this.zone = new ZoneView(layout, this.quality);
    this.scene.add(this.zone.root);
    const pal = layout.cfg.palette;
    this.scene.background = new THREE.Color(pal.fog);
    this.scene.fog = new THREE.Fog(pal.fog, 34, 82);
    this.hemi.color.setHex(pal.hemiSky);
    this.hemi.groundColor.setHex(pal.hemiGround);
    this.hemi.intensity = pal.hemiIntensity * 2.5;
    this.sun.color.setHex(pal.sun);
    this.sun.intensity = pal.sunIntensity * 1.6;
  }

  shake(a: number): void {
    if (!this.shakeEnabled) return;
    this.shakeAmt = Math.min(1.4, this.shakeAmt + a);
  }

  muzzle(hand: number, x: number, y: number, color: number): void {
    const m = this.muzzleLights[hand];
    m.light.position.set(x, 1.3, -y);
    m.light.color.setHex(color);
    m.t = 0;
  }

  boom(x: number, y: number, r: number, color: number): void {
    const b = this.boomLights[this.boomIdx];
    this.boomIdx = (this.boomIdx + 1) % this.boomLights.length;
    b.light.position.set(x, 2, -y);
    b.light.color.setHex(color);
    b.light.distance = 8 + r * 3;
    b.peak = 60 + r * 25;
    b.t = 0;
  }

  /** 屏幕坐标 → 游戏地面坐标（瞄准平面高度 1m） */
  screenToGround(sx: number, sy: number, out: { x: number; y: number }): void {
    this.ndc.set((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.plane, this.v3);
    if (hit) { out.x = hit.x; out.y = -hit.z; }
  }

  project(x: number, y: number, h: number): ScreenPt {
    this.v3.set(x, h, -y).project(this.camera);
    return { x: (this.v3.x * 0.5 + 0.5) * this.width, y: (-this.v3.y * 0.5 + 0.5) * this.height, ok: this.v3.z < 1 };
  }

  /** 第2版：设置里的整体亮度（50%~150%） */
  setBrightness(pct: number): void {
    this.renderer.toneMappingExposure = 1.25 * Math.max(0.3, pct / 100);
  }

  frame(w: World, dt: number, time: number, aimX: number, aimY: number): void {
    // 镜头关注点：自己；阵亡观战时为队友
    const p = w.view;
    const own = w.player.alive || !w.net;
    // —— 相机 ——
    const lx = own ? Math.max(-6, Math.min(6, (aimX - p.x) * 0.18)) : 0;
    const ly = own ? Math.max(-5, Math.min(5, (aimY - p.y) * 0.18)) : 0;
    const tx = p.x + lx, ty = p.y + ly;
    const k = damp(7, dt);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    if (Math.hypot(tx - this.camX, ty - this.camY) > 30) { this.camX = tx; this.camY = ty; }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.4);
    const sh = this.shakeAmt * this.shakeAmt * 0.9;
    const sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
    const H = 23 * this.zoom, D = 12.5 * this.zoom;
    this.camera.position.set(this.camX + sx, H, -this.camY + D + sy);
    this.camera.lookAt(this.camX + sx * 0.5, 0, -this.camY + sy * 0.5);
    // —— 灯光 ——
    const snap = 0.5;
    const ox = Math.round(p.x / snap) * snap, oy = Math.round(p.y / snap) * snap;
    this.sun.position.set(ox - 14, 40, -oy + 12);
    this.sun.target.position.set(ox, 0, -oy);
    this.sun.target.updateMatrixWorld();
    const fa = p.face;
    this.flash.position.set(p.x + Math.cos(fa) * 0.3, 1.7, -(p.y + Math.sin(fa) * 0.3));
    this.flash.target.position.set(p.x + Math.cos(fa) * 9, 0, -(p.y + Math.sin(fa) * 9));
    this.flash.target.updateMatrixWorld();
    this.flash.intensity = w.player.standing || !own ? 60 : 0;
    for (const m of this.muzzleLights) {
      m.t += dt;
      m.light.intensity = m.t < m.dur ? m.peak * (1 - m.t / m.dur) : 0;
    }
    for (const b of this.boomLights) {
      b.t += dt;
      b.light.intensity = b.t < b.dur ? b.peak * (1 - b.t / b.dur) ** 1.5 : 0;
    }
    // 环境光源：选取最近的几盏
    if (this.zone) {
      this.envT -= dt;
      const L = this.zone.lights;
      if (this.envT <= 0) {
        this.envT = 0.4;
        const sorted = L.map((s) => ({ s, d: (s.x - p.x) ** 2 + (s.y - p.y) ** 2 })).filter((o) => o.d < 40 * 40).sort((a, b) => a.d - b.d);
        this.envLights.forEach((l, i) => {
          const o = sorted[i];
          l.userData.src = o ? o.s : null;
          if (o) { l.position.set(o.s.x, o.s.h, -o.s.y); l.color.setHex(o.s.color); }
        });
      }
      for (const l of this.envLights) {
        const s = l.userData.src as { intensity: number; flicker: number } | null;
        if (!s) { l.intensity = 0; continue; }
        let f = 1;
        if (s.flicker === 1) f = Math.sin(time * 23 + l.position.x) > 0.85 ? 0.2 : 1;
        else if (s.flicker === 2) f = 0.8 + Math.sin(time * 13 + l.position.x) * 0.12 + Math.sin(time * 31) * 0.08;
        l.intensity = s.intensity * f;
      }
      this.zone.update(dt, time, p.x, p.y, this.camera);
      this.zone.updateSuit(w.layout.prevRoom, w.suitOffer(), w.layout.safeRoom, Math.min(SUIT_MAX, w.run.suit + 1), time);
    }
    this.entities.update(w, dt, time, this.camera);
    this.particles.update(dt);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.zone?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
