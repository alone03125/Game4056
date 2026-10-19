// CPU 粒子系统（Points + 自定义着色器），分为加法混合（火花/火焰/光）与普通混合（烟/血）两组。

import * as THREE from 'three';
import { glowTexture, smokeTexture } from './textures';

const VS = `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FS = `
uniform sampler2D uTex;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (gl_FragColor.a < 0.01) discard;
}`;

class Pool {
  max: number;
  n = 0;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; maxLife: Float32Array;
  size0: Float32Array; size1: Float32Array;
  r: Float32Array; g: Float32Array; b: Float32Array;
  grav: Float32Array; drag: Float32Array;
  geo: THREE.BufferGeometry;
  pos: Float32Array; col: Float32Array; siz: Float32Array;
  points: THREE.Points;
  mat: THREE.ShaderMaterial;

  constructor(max: number, additive: boolean, tex: THREE.Texture) {
    this.max = max;
    const f = () => new Float32Array(max);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.maxLife = f(); this.size0 = f(); this.size1 = f();
    this.r = f(); this.g = f(); this.b = f(); this.grav = f(); this.drag = f();
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.siz = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uScale: { value: 400 } },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, color: number, grav: number, drag: number): void {
    let i: number;
    if (this.n < this.max) i = this.n++;
    else i = Math.floor(Math.random() * this.max);
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = s0; this.size1[i] = s1;
    this.r[i] = ((color >> 16) & 255) / 255;
    this.g[i] = ((color >> 8) & 255) / 255;
    this.b[i] = (color & 255) / 255;
    this.grav[i] = grav; this.drag[i] = drag;
  }

  update(dt: number, intensity: number): void {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        if (i !== n) this.copy(n, i);
        i--;
        continue;
      }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vx[i] *= d; this.vy[i] *= d; this.vz[i] *= d;
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.02) { this.py[i] = 0.02; this.vy[i] *= -0.3; this.vx[i] *= 0.6; this.vz[i] *= 0.6; }
    }
    this.n = n;
    for (let i = 0; i < n; i++) {
      const t = 1 - this.life[i] / this.maxLife[i];
      this.pos[i * 3] = this.px[i]; this.pos[i * 3 + 1] = this.py[i]; this.pos[i * 3 + 2] = this.pz[i];
      const a = t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9;
      this.col[i * 4] = this.r[i] * intensity; this.col[i * 4 + 1] = this.g[i] * intensity; this.col[i * 4 + 2] = this.b[i] * intensity;
      this.col[i * 4 + 3] = a;
      this.siz[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  private copy(from: number, to: number): void {
    this.px[to] = this.px[from]; this.py[to] = this.py[from]; this.pz[to] = this.pz[from];
    this.vx[to] = this.vx[from]; this.vy[to] = this.vy[from]; this.vz[to] = this.vz[from];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from]; this.size1[to] = this.size1[from];
    this.r[to] = this.r[from]; this.g[to] = this.g[from]; this.b[to] = this.b[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
  }

  clear(): void {
    this.n = 0;
    this.geo.setDrawRange(0, 0);
  }
}

const R = () => Math.random() * 2 - 1;

export class Particles {
  add: Pool;
  norm: Pool;
  density = 1;

  constructor(scene: THREE.Scene, max: number) {
    this.add = new Pool(max, true, glowTexture());
    this.norm = new Pool(Math.floor(max * 0.6), false, smokeTexture());
    scene.add(this.add.points, this.norm.points);
  }

  setScale(px: number): void {
    this.add.mat.uniforms.uScale.value = px;
    this.norm.mat.uniforms.uScale.value = px;
  }

  update(dt: number): void {
    this.add.update(dt, 1.6);
    this.norm.update(dt, 1);
  }

  clear(): void {
    this.add.clear();
    this.norm.clear();
  }

  private count(n: number): number {
    const v = n * this.density;
    return Math.floor(v) + (Math.random() < v % 1 ? 1 : 0);
  }

  // 世界坐标：游戏 (x, y) → three (x, h, -y)
  sparks(x: number, y: number, color: number, n: number, speed: number, h = 1.1): void {
    for (let i = 0, c = this.count(n); i < c; i++) {
      this.add.emit(x, h, -y, R() * speed, Math.random() * speed * 0.8, R() * speed, 0.2 + Math.random() * 0.25, 0.35, 0.05, color, 9, 2);
    }
  }

  muzzle(x: number, y: number, angle: number, color: number): void {
    const dx = Math.cos(angle), dz = -Math.sin(angle);
    this.add.emit(x, 1.15, -y, dx * 2, 0, dz * 2, 0.06, 1.6, 0.6, color, 0, 0);
    for (let i = 0, c = this.count(3); i < c; i++) {
      const s = 4 + Math.random() * 6;
      const a = angle + R() * 0.4;
      this.add.emit(x, 1.15, -y, Math.cos(a) * s, R() * 1.5, -Math.sin(a) * s, 0.1 + Math.random() * 0.1, 0.3, 0.05, 0xffe0a0, 2, 4);
    }
  }

  blood(x: number, y: number, color: number, n: number, dirX = 0, dirY = 0): void {
    for (let i = 0, c = this.count(n); i < c; i++) {
      const s = 1.5 + Math.random() * 3;
      this.norm.emit(x, 0.8 + Math.random() * 0.6, -y, (R() + dirX * 0.8) * s, Math.random() * 3, (R() - dirY * 0.8) * s, 0.4 + Math.random() * 0.4, 0.35, 0.2, color, 12, 1);
    }
  }

  explosion(x: number, y: number, r: number, color: number): void {
    const n = this.count(18 + r * 10);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.5 + Math.random()) * r * 3.2;
      this.add.emit(x, 0.6 + Math.random(), -y, Math.cos(a) * s, Math.random() * r * 2, Math.sin(a) * s, 0.25 + Math.random() * 0.35, 1.4 + r * 0.25, 0.2, i % 3 ? color : 0xffe8a0, 3, 5);
    }
    this.add.emit(x, 1, -y, 0, 0, 0, 0.18, r * 3.2, r * 4.2, 0xfff0c0, 0, 0);
    for (let i = 0, c = this.count(8 + r * 3); i < c; i++) {
      const a = Math.random() * Math.PI * 2, s = Math.random() * r * 1.2;
      this.norm.emit(x + Math.cos(a) * r * 0.3, 0.5 + Math.random(), -y + Math.sin(a) * r * 0.3, Math.cos(a) * s, 0.6 + Math.random() * 1.6, Math.sin(a) * s, 1.0 + Math.random() * 1.0, r * 0.8, r * 1.8, 0x2a2826, -0.4, 1.2);
    }
  }

  smoke(x: number, y: number, n: number, color = 0x6a6660): void {
    for (let i = 0, c = this.count(n); i < c; i++) {
      this.norm.emit(x + R() * 0.3, 0.5 + Math.random() * 0.6, -y + R() * 0.3, R() * 0.6, 0.6 + Math.random(), R() * 0.6, 0.7 + Math.random() * 0.8, 0.6, 2.0, color, -0.3, 1);
    }
  }

  trail(x: number, y: number, h: number, color: number): void {
    this.add.emit(x, h, -y, R() * 0.2, R() * 0.2, R() * 0.2, 0.18, 0.5, 0.05, color, 0, 0);
  }

  cloud(x: number, y: number, r: number, color: number): void {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
    this.norm.emit(x + Math.cos(a) * d, 0.3 + Math.random() * 0.6, -y + Math.sin(a) * d, R() * 0.3, 0.2 + Math.random() * 0.3, R() * 0.3, 1.2 + Math.random(), 1.5, 3.2, color, -0.05, 0.5);
  }

  vortex(x: number, y: number, r: number): void {
    const a = Math.random() * Math.PI * 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    const s = 6;
    this.add.emit(px, 0.4 + Math.random() * 1.2, -py, -Math.cos(a) * s + Math.sin(a) * 3, 0, Math.sin(a) * s + Math.cos(a) * 3, r / s, 0.5, 0.1, 0xb060ff, 0, 0);
  }

  ambient(x: number, y: number, color: number): void {
    // 漂浮的灰烬
    this.add.emit(x + R() * 22, 3 + Math.random() * 6, -y + R() * 18, R() * 0.4 + 0.3, -0.4 - Math.random() * 0.4, R() * 0.4, 5 + Math.random() * 4, 0.18, 0.12, color, 0, 0);
  }

  heal(x: number, y: number): void {
    for (let i = 0, c = this.count(14); i < c; i++) {
      this.add.emit(x + R() * 0.5, 0.3 + Math.random(), -y + R() * 0.5, 0, 1.5 + Math.random() * 1.5, 0, 0.7, 0.4, 0.1, 0x6aff8a, 0, 0.5);
    }
  }

  coinBurst(x: number, y: number): void {
    for (let i = 0, c = this.count(4); i < c; i++) this.add.emit(x, 1.0, -y, R() * 2, Math.random() * 2, R() * 2, 0.3, 0.3, 0.05, 0xffd24a, 4, 2);
  }
}
