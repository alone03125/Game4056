// 程序化贴图（全部用 Canvas 绘制，不依赖外部资源）。

import * as THREE from 'three';
import { Rng } from '../util/rng';
import { ZoneLayout } from '../world/zone';
import { AABB } from '../util/math';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  return [c, g];
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, amt: number, rng: Rng, mono = true): void {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amt;
    if (mono) { d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    else { d[i] += n; d[i + 1] += (rng.next() - 0.5) * amt; d[i + 2] += (rng.next() - 0.5) * amt; }
  }
  g.putImageData(img, 0, 0);
}

function blotches(g: CanvasRenderingContext2D, w: number, h: number, n: number, color: string, rmin: number, rmax: number, rng: Rng, alpha = 0.15): void {
  for (let i = 0; i < n; i++) {
    const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(rmin, rmax);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color.replace('A', String(alpha)));
    grd.addColorStop(1, color.replace('A', '0'));
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function cracks(g: CanvasRenderingContext2D, w: number, h: number, n: number, rng: Rng, color = 'rgba(0,0,0,0.5)', len = 40): void {
  g.strokeStyle = color;
  for (let i = 0; i < n; i++) {
    let x = rng.range(0, w), y = rng.range(0, h);
    let a = rng.range(0, Math.PI * 2);
    g.lineWidth = rng.range(0.6, 2);
    g.beginPath();
    g.moveTo(x, y);
    const segs = rng.int(3, 9);
    for (let s = 0; s < segs; s++) {
      a += rng.range(-0.8, 0.8);
      const l = rng.range(len * 0.2, len * 0.6);
      x += Math.cos(a) * l;
      y += Math.sin(a) * l;
      g.lineTo(x, y);
      if (rng.chance(0.25)) {
        const bx = x, by = y;
        const ba = a + rng.range(-1.5, 1.5);
        g.moveTo(bx, by);
        g.lineTo(bx + Math.cos(ba) * l * 0.6, by + Math.sin(ba) * l * 0.6);
        g.moveTo(x, y);
      }
    }
    g.stroke();
  }
}

function tex(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const cache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = cache.get(key);
  if (!t) { t = make(); cache.set(key, t); }
  return t;
}

/** 混凝土墙（变体：0 灰混凝土 1 医院白墙 2 红砖） */
export function wallTexture(variant: number, tint: string): THREE.Texture {
  return cached(`wall${variant}${tint}`, () => {
    const rng = new Rng(77 + variant);
    const [c, g] = canvas(256, 256);
    if (variant === 2) {
      g.fillStyle = '#6a3a2c';
      g.fillRect(0, 0, 256, 256);
      const bh = 16, bw = 42;
      for (let row = 0; row < 256 / bh; row++) {
        const off = row % 2 ? bw / 2 : 0;
        for (let x = -bw; x < 256 + bw; x += bw) {
          const shade = rng.range(-18, 18);
          g.fillStyle = `rgb(${120 + shade},${62 + shade * 0.6},${46 + shade * 0.4})`;
          g.fillRect(x + off + 1, row * bh + 1, bw - 2, bh - 2);
        }
      }
      noise(g, 256, 256, 26, rng);
    } else {
      g.fillStyle = variant === 1 ? '#b9bbb4' : tint;
      g.fillRect(0, 0, 256, 256);
      noise(g, 256, 256, 30, rng);
      blotches(g, 256, 256, 30, 'rgba(20,18,14,A)', 10, 60, rng, 0.22);
      // 水平模板缝
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 2;
      for (let y = 64; y < 256; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
      for (let i = 0; i < 18; i++) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(rng.range(0, 256), rng.range(0, 256), rng.range(1, 3), 0, 7); g.fill(); }
      if (variant === 1) {
        g.fillStyle = 'rgba(60,140,120,0.5)';
        g.fillRect(0, 200, 256, 14);
      }
    }
    // 底部污渍
    const grd = g.createLinearGradient(0, 256, 0, 150);
    grd.addColorStop(0, 'rgba(10,10,6,0.55)');
    grd.addColorStop(1, 'rgba(10,10,6,0)');
    g.fillStyle = grd;
    g.fillRect(0, 150, 256, 106);
    cracks(g, 256, 256, 6, rng, 'rgba(0,0,0,0.45)', 60);
    return tex(c);
  });
}

export function towerTexture(variant: number): THREE.Texture {
  return cached(`tower${variant}`, () => {
    const rng = new Rng(300 + variant);
    const [c, g] = canvas(256, 256);
    const base = ['#55575a', '#5d5148', '#4a5258'][variant % 3];
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 20, rng);
    for (let y = 8; y < 256; y += 32) {
      for (let x = 6; x < 256; x += 32) {
        const lit = rng.chance(0.06);
        const broken = rng.chance(0.3);
        g.fillStyle = lit ? '#e8c070' : broken ? '#0a0a0c' : `rgb(${30 + rng.int(0, 20)},${36 + rng.int(0, 20)},${44 + rng.int(0, 24)})`;
        g.fillRect(x, y, 20, 18);
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(x, y, 20, 3);
      }
    }
    blotches(g, 256, 256, 20, 'rgba(0,0,0,A)', 10, 50, rng, 0.25);
    return tex(c);
  });
}

export function towerEmissive(variant: number): THREE.Texture {
  return cached(`towerE${variant}`, () => {
    const rng = new Rng(300 + variant);
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 256, 256);
    rng.next();
    for (let y = 8; y < 256; y += 32) {
      for (let x = 6; x < 256; x += 32) {
        const lit = rng.chance(0.06);
        rng.chance(0.3);
        if (lit) { g.fillStyle = '#c08a40'; g.fillRect(x, y, 20, 18); }
      }
    }
    return tex(c);
  });
}

export function metalTexture(color: string, ribs = true, seed = 1): THREE.Texture {
  return cached(`metal${color}${ribs}${seed}`, () => {
    const rng = new Rng(500 + seed);
    const [c, g] = canvas(128, 128);
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 128);
    if (ribs) {
      for (let x = 0; x < 128; x += 8) {
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(x, 0, 3, 128);
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x + 4, 0, 3, 128);
      }
    }
    noise(g, 128, 128, 18, rng);
    blotches(g, 128, 128, 14, 'rgba(110,60,20,A)', 4, 24, rng, 0.45);
    return tex(c);
  });
}

export function woodTexture(): THREE.Texture {
  return cached('wood', () => {
    const rng = new Rng(9);
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#6a4a2a';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) {
      g.fillStyle = `rgb(${100 + rng.int(-14, 14)},${70 + rng.int(-10, 10)},${40 + rng.int(-8, 8)})`;
      g.fillRect(0, y + 1, 128, 14);
    }
    g.strokeStyle = 'rgba(30,20,10,0.6)';
    g.lineWidth = 3;
    g.strokeRect(2, 2, 124, 124);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(128, 128); g.stroke();
    noise(g, 128, 128, 16, rng);
    return tex(c);
  });
}

export function concreteTexture(): THREE.Texture {
  return cached('concrete', () => {
    const rng = new Rng(13);
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#7a7a76';
    g.fillRect(0, 0, 128, 128);
    noise(g, 128, 128, 34, rng);
    blotches(g, 128, 128, 10, 'rgba(0,0,0,A)', 6, 30, rng, 0.2);
    return tex(c);
  });
}

export function stripeTexture(): THREE.Texture {
  return cached('stripe', () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#2a2a2a';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#e8b020';
    for (let i = -128; i < 256; i += 32) {
      g.beginPath();
      g.moveTo(i, 0); g.lineTo(i + 16, 0); g.lineTo(i + 16 + 128, 128); g.lineTo(i + 128, 128);
      g.fill();
    }
    noise(g, 128, 128, 20, new Rng(5));
    return tex(c);
  });
}

export function roomWallTexture(): THREE.Texture {
  return cached('roomwall', () => {
    const rng = new Rng(21);
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#3e4a52';
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 64) {
      for (let x = 0; x < 256; x += 64) {
        g.fillStyle = `rgb(${58 + rng.int(-6, 6)},${70 + rng.int(-6, 6)},${80 + rng.int(-6, 6)})`;
        g.fillRect(x + 2, y + 2, 60, 60);
        g.fillStyle = 'rgba(0,0,0,0.5)';
        for (const [bx, by] of [[6, 6], [54, 6], [6, 54], [54, 54]]) { g.beginPath(); g.arc(x + bx, y + by, 2, 0, 7); g.fill(); }
      }
    }
    g.fillStyle = '#d8a018';
    g.fillRect(0, 226, 256, 12);
    noise(g, 256, 256, 14, rng);
    return tex(c);
  });
}

/** 柔和圆形光斑（粒子/光晕） */
export function glowTexture(): THREE.Texture {
  return cached('glow', () => {
    const [c, g] = canvas(64, 64);
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const t = tex(c, false);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });
}

export function smokeTexture(): THREE.Texture {
  return cached('smoke', () => {
    const rng = new Rng(3);
    const [c, g] = canvas(64, 64);
    for (let i = 0; i < 18; i++) {
      const x = 32 + rng.range(-12, 12), y = 32 + rng.range(-12, 12), r = rng.range(8, 20);
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.25)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    }
    const t = tex(c, false);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });
}

/** 地面污渍贴花（血迹/焦痕） */
export function splatTexture(): THREE.Texture {
  return cached('splat', () => {
    const rng = new Rng(11);
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#fff';
    for (let i = 0; i < 14; i++) {
      const a = rng.range(0, 6.28), d = rng.range(0, 34), r = rng.range(6, 22);
      g.globalAlpha = rng.range(0.5, 1);
      g.beginPath();
      g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, 7);
      g.fill();
    }
    for (let i = 0; i < 20; i++) {
      const a = rng.range(0, 6.28), d = rng.range(36, 60), r = rng.range(1.5, 5);
      g.globalAlpha = rng.range(0.4, 0.9);
      g.beginPath();
      g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
    const t = tex(c, false);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });
}

export function ringTexture(): THREE.Texture {
  return cached('ring', () => {
    const [c, g] = canvas(128, 128);
    const grd = g.createRadialGradient(64, 64, 30, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.15)');
    grd.addColorStop(0.92, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const t = tex(c, false);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });
}

export function beamTexture(): THREE.Texture {
  return cached('beam', () => {
    const [c, g] = canvas(32, 128);
    const grd = g.createLinearGradient(0, 128, 0, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 128);
    const g2 = g.createLinearGradient(0, 0, 32, 0);
    g2.addColorStop(0, 'rgba(0,0,0,1)');
    g2.addColorStop(0.5, 'rgba(0,0,0,0)');
    g2.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = g2;
    g.fillRect(0, 0, 32, 128);
    const t = tex(c, false);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });
}

export function voidTexture(color: string): THREE.Texture {
  return cached('void' + color, () => {
    const rng = new Rng(99);
    const [c, g] = canvas(256, 256);
    g.fillStyle = color;
    g.fillRect(0, 0, 256, 256);
    noise(g, 256, 256, 24, rng);
    blotches(g, 256, 256, 40, 'rgba(0,0,0,A)', 10, 50, rng, 0.35);
    for (let i = 0; i < 160; i++) {
      g.fillStyle = `rgba(${rng.int(40, 90)},${rng.int(40, 80)},${rng.int(30, 70)},0.8)`;
      g.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(2, 7), rng.range(2, 6));
    }
    const t = tex(c);
    return t;
  });
}

const PX = 12; // 每米像素

function rectPx(r: AABB, b: AABB, H: number): [number, number, number, number] {
  return [(r.x0 - b.x0) * PX, H - (r.y1 - b.y0) * PX, (r.x1 - r.x0) * PX, (r.y1 - r.y0) * PX];
}

/** 为区域绘制整张地面贴图（街道、人行道、各类地块、裂缝、污渍） */
export function paintGround(layout: ZoneLayout): THREE.CanvasTexture {
  const b = layout.bounds;
  const W = Math.ceil((b.x1 - b.x0) * PX), H = Math.ceil((b.y1 - b.y0) * PX);
  const [c, g] = canvas(W, H);
  const rng = new Rng(layout.seed ^ 0x1234);
  const pal = layout.cfg.palette;
  g.fillStyle = '#1a1a1a';
  g.fillRect(0, 0, W, H);
  // 区域底色：柏油
  const zr = rectPx(layout.rect, b, H);
  g.fillStyle = pal.asphalt;
  g.fillRect(...zr);
  // 地块
  for (const bl of layout.blocks) {
    const r = rectPx(bl.rect, b, H);
    // 人行道边缘
    g.fillStyle = '#5a5852';
    g.fillRect(r[0] - 10, r[1] - 10, r[2] + 20, r[3] + 20);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(r[0] - 10, r[1] - 10, r[2] + 20, 2);
    switch (bl.type) {
      case 'park':
        g.fillStyle = pal.dirt;
        g.fillRect(...r);
        for (let i = 0; i < r[2] * r[3] / 60; i++) {
          g.fillStyle = `rgba(${rng.int(70, 110)},${rng.int(70, 100)},${rng.int(30, 50)},0.6)`;
          g.fillRect(r[0] + rng.range(0, r[2]), r[1] + rng.range(0, r[3]), rng.range(1, 3), rng.range(3, 7));
        }
        break;
      case 'parking':
        g.fillStyle = '#34363a';
        g.fillRect(...r);
        g.strokeStyle = 'rgba(220,220,200,0.45)';
        g.lineWidth = 2;
        for (let x = r[0] + 18; x < r[0] + r[2] - 10; x += 36) {
          g.beginPath(); g.moveTo(x, r[1] + 4); g.lineTo(x, r[1] + 60); g.stroke();
          g.beginPath(); g.moveTo(x, r[1] + r[3] - 60); g.lineTo(x, r[1] + r[3] - 4); g.stroke();
        }
        break;
      case 'plaza': {
        g.fillStyle = '#5c5a54';
        g.fillRect(...r);
        g.strokeStyle = 'rgba(0,0,0,0.22)';
        g.lineWidth = 1;
        for (let x = r[0]; x < r[0] + r[2]; x += 24) { g.beginPath(); g.moveTo(x, r[1]); g.lineTo(x, r[1] + r[3]); g.stroke(); }
        for (let y = r[1]; y < r[1] + r[3]; y += 24) { g.beginPath(); g.moveTo(r[0], y); g.lineTo(r[0] + r[2], y); g.stroke(); }
        break;
      }
      case 'industrial':
        g.fillStyle = '#4a4a46';
        g.fillRect(...r);
        for (let i = 0; i < 8; i++) {
          const x = r[0] + rng.range(0, r[2]), y = r[1] + rng.range(0, r[3]), rr = rng.range(10, 40);
          const grd = g.createRadialGradient(x, y, 0, x, y, rr);
          grd.addColorStop(0, 'rgba(10,8,6,0.6)');
          grd.addColorStop(1, 'rgba(10,8,6,0)');
          g.fillStyle = grd;
          g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
        }
        break;
      default:
        g.fillStyle = '#4e4b46';
        g.fillRect(...r);
    }
    if (bl.inner) {
      // 室内地砖
      const ir = rectPx(bl.inner, b, H);
      g.fillStyle = layout.cfg.index === 3 ? '#8a8e88' : '#6a645a';
      g.fillRect(...ir);
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = 1;
      for (let x = ir[0]; x < ir[0] + ir[2]; x += 12) { g.beginPath(); g.moveTo(x, ir[1]); g.lineTo(x, ir[1] + ir[3]); g.stroke(); }
      for (let y = ir[1]; y < ir[1] + ir[3]; y += 12) { g.beginPath(); g.moveTo(ir[0], y); g.lineTo(ir[0] + ir[2], y); g.stroke(); }
      for (let i = 0; i < 20; i++) {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(ir[0] + rng.int(0, ir[2] / 12) * 12, ir[1] + rng.int(0, ir[3] / 12) * 12, 12, 12);
      }
    }
  }
  // 街道标线
  g.strokeStyle = 'rgba(230,200,90,0.5)';
  g.lineWidth = 3;
  g.setLineDash([30, 26]);
  for (const s of layout.streets) {
    const r = rectPx(s, b, H);
    if (r[2] < r[3] && r[2] > 50) { g.beginPath(); g.moveTo(r[0] + r[2] / 2, r[1]); g.lineTo(r[0] + r[2] / 2, r[1] + r[3]); g.stroke(); }
    else if (r[3] > 50) { g.beginPath(); g.moveTo(r[0], r[1] + r[3] / 2); g.lineTo(r[0] + r[2], r[1] + r[3] / 2); g.stroke(); }
  }
  g.setLineDash([]);
  // 房间地板
  for (const room of [layout.prevRoom, layout.safeRoom]) {
    if (!room) continue;
    const r = rectPx(room.rect, b, H);
    g.fillStyle = '#2e3438';
    g.fillRect(...r);
    g.strokeStyle = 'rgba(120,140,150,0.25)';
    g.lineWidth = 1;
    for (let x = r[0]; x < r[0] + r[2]; x += 8) { g.beginPath(); g.moveTo(x, r[1]); g.lineTo(x, r[1] + r[3]); g.stroke(); }
    // 出口警示条
    const t = rectPx(room.exitTrigger, b, H);
    g.fillStyle = 'rgba(232,176,32,0.35)';
    g.fillRect(...t);
    g.strokeStyle = 'rgba(232,176,32,0.8)';
    g.lineWidth = 3;
    g.strokeRect(...t);
  }
  // 噪点 + 污渍 + 裂缝
  noise(g, W, H, 22, rng);
  blotches(g, W, H, Math.floor(W * H / 9000), 'rgba(0,0,0,A)', 20, 90, rng, 0.28);
  blotches(g, W, H, Math.floor(W * H / 40000), 'rgba(80,60,30,A)', 20, 70, rng, 0.2);
  cracks(g, W, H, Math.floor(W * H / 6000), rng, 'rgba(0,0,0,0.5)', 80);
  if (layout.cfg.index === 3) blotches(g, W, H, 30, 'rgba(80,200,40,A)', 20, 60, rng, 0.12);
  if (layout.cfg.index === 4) blotches(g, W, H, 50, 'rgba(120,10,10,A)', 10, 50, rng, 0.25);
  // 区域外更暗
  g.fillStyle = 'rgba(0,0,0,0.55)';
  const outside = [layout.rect, layout.prevRoom?.rect, layout.safeRoom?.rect].filter(Boolean) as AABB[];
  g.save();
  g.beginPath();
  g.rect(0, 0, W, H);
  for (const r of outside) { const p = rectPx(r, b, H); g.rect(p[0] + p[2], p[1], -p[2], p[3]); }
  g.fill('evenodd');
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
