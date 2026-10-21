// 渲染器：three.js 场景、俯视相机、灯光（阴影/手电/枪口火光/爆炸光/环境光源）、后期泛光。
// 第4.3次调整（流畅性）：用 GPU 计时查询测量每帧的实际 GPU 耗时，超出预算时自动降低 3D 画面的渲染分辨率，
// 有余量时再升回去（UI 与文字不受影响）。GPU 跟不上时浏览器会阻塞主线程，连带让按钮的音效与特效延迟。

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
import { QuestView } from './questView';
import { RELIC } from '../data/relics';
import { ZoneView } from './zoneView';
import { ScreenPt } from './overlay';
import { damp } from '../util/math';

export type Quality = 0 | 1 | 2; // 低 / 中 / 高

interface PooledLight { light: THREE.PointLight; t: number; dur: number; peak: number }

/**
 * 自动渲染分辨率（自定）：GPU 每帧耗时的平滑值超过 13ms 时降低 15%，低于 7ms 时（至少 4 秒后）升高 12%；
 * 渲染倍率最低为原来的 0.55 倍、像素比不低于 0.7。不支持 GPU 计时的浏览器改用帧间隔判断（> 22ms 降低，< 13ms 升高）。
 */
export const AUTO_RES = { high: 13, low: 7, frameHigh: 22, frameLow: 13, down: 0.85, up: 1.12, minScale: 0.55, minPr: 0.7, settle: 1.5, upWait: 4 };

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
  quests: QuestView;
  quality: Quality;
  zoom = 1;
  /** 第4.1次调整：天生神力——视野 +80%（平滑过渡） */
  viewMul = 1;
  shakeAmt = 0;
  /** 第4.3次调整：过场动画时镜头推向曼巴僵尸（0~1） */
  cineK = 0;
  private cineX = 0;
  private cineY = 0;
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
  /** 自动渲染分辨率：相对设备像素比的倍率（1 = 不降低） */
  renderScale = 1;
  /** 平滑后的 GPU 每帧耗时（毫秒；不支持计时查询时为帧间隔） */
  gpuMs = 0;
  private basePr = 1;
  private gl: WebGL2RenderingContext;
  private gpuExt: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private gpuQ: WebGLQuery | null = null;
  private gpuN = 0;
  private scaleT = 0;
  private lastFrameAt = 0;

  constructor(container: HTMLElement, quality: Quality) {
    this.quality = quality;
    // 高画质经过后期合成（泛光）绘制，默认帧缓冲的多重采样用不上，只会白白增加显存带宽
    this.renderer = new THREE.WebGLRenderer({ antialias: quality === 1, powerPreference: 'high-performance' });
    this.gl = this.renderer.getContext() as WebGL2RenderingContext;
    try { this.gpuExt = this.gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch { this.gpuExt = null; }
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
    this.quests = new QuestView(this.scene, this.particles);
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
    this.basePr = Math.min(window.devicePixelRatio || 1, this.quality >= 2 ? 2 : this.quality === 1 ? 1.5 : 1);
    this.applyPixelRatio();
  }

  /** 当前实际使用的像素比 */
  get pixelRatio(): number {
    return Math.max(Math.min(AUTO_RES.minPr, this.basePr), this.basePr * this.renderScale);
  }

  private applyPixelRatio(): void {
    const w = this.width, h = this.height;
    const pr = this.pixelRatio;
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
    // 第4.3次调整（流畅性）：新区域生成时就开始编译着色器（显卡驱动支持并行编译时不会阻塞），减少第一次画出来时的卡顿。
    // 不用 compileAsync：它的轮询在区域连续重建时会报错
    try { this.renderer.compile(this.scene, this.camera); } catch { /* 跳过 */ }
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
    // 第4.3次调整：过场动画中镜头缓缓推向曼巴僵尸
    const cb = w.cine && w.bossEnemy ? w.bossEnemy : null;
    this.cineK += ((cb ? 1 : 0) - this.cineK) * Math.min(1, dt * (cb ? 1.6 : 2.4));
    if (cb) { this.cineX = cb.x; this.cineY = cb.y - 1; }
    const ck = this.cineK * this.cineK * (3 - 2 * this.cineK);
    const tx = p.x + lx + (this.cineX - p.x - lx) * ck, ty = p.y + ly + (this.cineY - p.y - ly) * ck;
    const k = damp(7, dt);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    if (Math.hypot(tx - this.camX, ty - this.camY) > 30) { this.camX = tx; this.camY = ty; }
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.4);
    const sh = this.shakeAmt * this.shakeAmt * 0.9;
    const sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
    const vm = w.run.has('might') && !w.showcase ? RELIC.mightScale : 1;
    this.viewMul += (vm - this.viewMul) * Math.min(1, dt * 2);
    const cz = 1 - 0.42 * ck;
    const H = 23 * this.zoom * this.viewMul * cz, D = 12.5 * this.zoom * this.viewMul * cz;
    if (this.scene.fog instanceof THREE.Fog) { this.scene.fog.near = 34 * this.viewMul; this.scene.fog.far = 82 * this.viewMul; }
    const far = 220 * Math.max(1, this.viewMul);
    if (Math.abs(this.camera.far - far) > 1) { this.camera.far = far; this.camera.updateProjectionMatrix(); }
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
    this.quests.update(w, dt, time, this.camera, this.zone);
    this.particles.update(dt);
    const timing = this.gpuBegin();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    if (timing) this.gl.endQuery(this.gpuExt!.TIME_ELAPSED_EXT);
    this.autoRes();
  }

  /** 开始本帧的 GPU 计时（同一时间只有一个查询；上一个的结果出来后才开始下一个） */
  private gpuBegin(): boolean {
    const ext = this.gpuExt, gl = this.gl;
    if (!ext) return false;
    if (this.gpuQ) {
      if (!gl.getQueryParameter(this.gpuQ, gl.QUERY_RESULT_AVAILABLE)) return false;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) this.sampleGpu(gl.getQueryParameter(this.gpuQ, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(this.gpuQ);
      this.gpuQ = null;
    }
    const q = gl.createQuery();
    if (!q) return false;
    this.gpuQ = q;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    return true;
  }

  private sampleGpu(ms: number): void {
    if (!(ms > 0 && ms < 500)) return;
    this.gpuMs = this.gpuN === 0 ? ms : this.gpuMs + (ms - this.gpuMs) * 0.12;
    this.gpuN++;
  }

  /** 根据 GPU 耗时（或帧间隔）调整渲染分辨率 */
  private autoRes(): void {
    const now = performance.now();
    const gap = this.lastFrameAt ? (now - this.lastFrameAt) / 1000 : 0;
    this.lastFrameAt = now;
    // 切到后台、暂停后恢复等长间隔不计入
    if (gap <= 0 || gap > 0.25) return;
    this.scaleT += gap;
    if (!this.gpuExt) this.sampleGpu(gap * 1000);
    if (this.gpuN < 20 || this.scaleT < AUTO_RES.settle) return;
    const high = this.gpuExt ? AUTO_RES.high : AUTO_RES.frameHigh;
    const low = this.gpuExt ? AUTO_RES.low : AUTO_RES.frameLow;
    let s = this.renderScale;
    if (this.gpuMs > high && s > AUTO_RES.minScale && this.basePr * s > AUTO_RES.minPr) s = Math.max(AUTO_RES.minScale, s * AUTO_RES.down);
    else if (this.gpuMs < low && s < 1 && this.scaleT > AUTO_RES.upWait) s = Math.min(1, s * AUTO_RES.up);
    else return;
    this.renderScale = s;
    this.applyPixelRatio();
    // 重新测量
    this.scaleT = 0;
    this.gpuN = 0;
  }

  dispose(): void {
    this.zone?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
