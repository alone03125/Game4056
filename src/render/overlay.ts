// 2D 叠加层（Canvas）：伤害数字、飘字、拾取提示、准星（含换弹进度）、屏幕外指示箭头。

import { fmtNum } from '../util/math';
import { PIXEL_FONT } from '../ui/font';

export interface ScreenPt { x: number; y: number; ok: boolean }

interface Floater {
  x: number; y: number; h: number;
  text: string; color: string;
  t: number; life: number;
  big: boolean;
  dx: number;
}

export class Overlay {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  floaters: Floater[] = [];
  dpr = 1;
  w = 0;
  h = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay-canvas';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
  }

  resize(w: number, h: number, dpr: number): void {
    this.dpr = Math.min(2, dpr);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  damage(x: number, y: number, amount: number, color: string, big: boolean): void {
    if (this.floaters.length > 160) this.floaters.shift();
    const txt = amount >= 1000 ? (amount / 1000).toFixed(1) + 'K' : amount >= 10 ? Math.round(amount).toString() : amount.toFixed(1);
    this.floaters.push({ x: x + (Math.random() - 0.5) * 0.6, y, h: 2.1, text: txt, color, t: 0, life: big ? 1.0 : 0.7, big, dx: (Math.random() - 0.5) * 30 });
  }

  text(x: number, y: number, text: string, color: string): void {
    if (this.floaters.length > 160) this.floaters.shift();
    this.floaters.push({ x, y, h: 2.6, text, color, t: 0, life: 1.4, big: true, dx: 0 });
  }

  clear(): void {
    this.floaters = [];
  }

  begin(): void {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
  }

  drawFloaters(dt: number, project: (x: number, y: number, h: number) => ScreenPt): void {
    const g = this.g;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const f of this.floaters) f.t += dt;
    this.floaters = this.floaters.filter((f) => f.t < f.life);
    for (const f of this.floaters) {
      const p = project(f.x, f.y, f.h);
      if (!p.ok) continue;
      const k = f.t / f.life;
      const rise = f.big ? 46 * k : 34 * k;
      const scale = f.t < 0.08 ? 1 + (0.08 - f.t) * 6 : 1;
      const alpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      const size = (f.big ? 24 : 12) * scale;
      g.globalAlpha = alpha;
      g.font = `${size}px ${PIXEL_FONT}`;
      g.lineWidth = 3.5;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.strokeText(f.text, p.x + f.dx * k, p.y - rise);
      g.fillStyle = f.color;
      g.fillText(f.text, p.x + f.dx * k, p.y - rise);
    }
    g.globalAlpha = 1;
  }

  label(p: ScreenPt, title: string, sub: string, color: string, highlight: boolean): void {
    if (!p.ok) return;
    const g = this.g;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `12px ${PIXEL_FONT}`;
    const w = Math.max(g.measureText(title).width, sub ? g.measureText(sub).width : 0) + 22;
    const h = sub ? 44 : 26;
    const x = p.x - w / 2, y = p.y - h - 18;
    g.fillStyle = 'rgba(8,10,12,0.82)';
    g.fillRect(x, y, w, h);
    g.fillStyle = color;
    g.fillRect(x, y, 3, h);
    g.strokeStyle = highlight ? color : 'rgba(255,255,255,0.15)';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.fillStyle = color;
    g.fillText(title, p.x, y + 13);
    if (sub) {
      g.font = `12px ${PIXEL_FONT}`;
      g.fillStyle = highlight ? '#ffffff' : '#9aa0a6';
      g.fillText(sub, p.x, y + 31);
    }
  }

  /** 准星：两侧弧线分别表示主手/副手的换弹进度 */
  crosshair(mx: number, my: number, reload: [number, number], hasGun: [boolean, boolean], color: string): void {
    const g = this.g;
    g.save();
    g.translate(mx, my);
    // 第4次调整：准星更显眼——更粗的黑色描边、更长的十字、外圈细环
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.lineWidth = 6;
    this.cross(g, 0);
    g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.lineWidth = 4; g.stroke();
    g.strokeStyle = color;
    g.lineWidth = 3;
    this.cross(g, 0);
    g.globalAlpha = 0.75;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
    for (let h = 0; h < 2; h++) {
      if (!hasGun[h]) continue;
      const r = reload[h];
      const a0 = h === 0 ? Math.PI * 0.6 : -Math.PI * 0.4;
      const span = Math.PI * 0.8;
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.beginPath();
      g.arc(0, 0, 20, a0, a0 + span);
      g.stroke();
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.beginPath();
      g.arc(0, 0, 20, a0, a0 + span);
      g.stroke();
      if (r < 1) {
        g.strokeStyle = h === 0 ? '#ffd24a' : '#6ad8ff';
        g.beginPath();
        g.arc(0, 0, 20, a0 + span * (1 - r), a0 + span);
        g.stroke();
      }
    }
    g.restore();
  }

  private cross(g: CanvasRenderingContext2D, _r: number): void {
    g.beginPath();
    g.moveTo(-15, 0); g.lineTo(-5, 0);
    g.moveTo(15, 0); g.lineTo(5, 0);
    g.moveTo(0, -15); g.lineTo(0, -5);
    g.moveTo(0, 15); g.lineTo(0, 5);
    g.stroke();
    g.fillStyle = g.strokeStyle as string;
    g.fillRect(-1.5, -1.5, 3, 3);
  }

  /** 屏幕边缘的方向箭头 */
  arrow(p: ScreenPt, cx: number, cy: number, color: string, text: string): void {
    const g = this.g;
    const margin = 48;
    let x = p.x, y = p.y;
    const inside = p.ok && x > margin && x < this.w - margin && y > margin && y < this.h - margin;
    if (inside) return;
    let dx = x - cx, dy = y - cy;
    if (!p.ok) { dx = -dx; dy = -dy; }
    const a = Math.atan2(dy, dx);
    // 与屏幕边框求交
    const hw = this.w / 2 - margin, hh = this.h / 2 - margin;
    const t = Math.min(Math.abs(hw / (Math.cos(a) || 1e-6)), Math.abs(hh / (Math.sin(a) || 1e-6)));
    x = cx + Math.cos(a) * t;
    y = cy + Math.sin(a) * t;
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.fillStyle = color;
    g.strokeStyle = 'rgba(0,0,0,0.7)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(16, 0); g.lineTo(-8, -11); g.lineTo(-3, 0); g.lineTo(-8, 11); g.closePath();
    g.stroke();
    g.fill();
    g.restore();
    g.font = `12px ${PIXEL_FONT}`;
    g.textAlign = 'center';
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    const tx = x - Math.cos(a) * 30, ty = y - Math.sin(a) * 30;
    g.strokeText(text, tx, ty);
    g.fillStyle = color;
    g.fillText(text, tx, ty);
  }

  hpBar(p: ScreenPt, frac: number, w: number, color: string): void {
    if (!p.ok) return;
    const g = this.g;
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(p.x - w / 2 - 1, p.y - 1, w + 2, 6);
    g.fillStyle = color;
    g.fillRect(p.x - w / 2, p.y, w * Math.max(0, frac), 4);
  }

  countdown(sec: number, text: string): void {
    const g = this.g;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `72px ${PIXEL_FONT}`;
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    const t = `${Math.ceil(sec)}`;
    g.strokeText(t, this.w / 2, this.h * 0.3);
    g.fillStyle = '#ffd24a';
    g.fillText(t, this.w / 2, this.h * 0.3);
    g.font = `24px ${PIXEL_FONT}`;
    g.lineWidth = 4;
    g.strokeText(text, this.w / 2, this.h * 0.3 + 52);
    g.fillStyle = '#ffffff';
    g.fillText(text, this.w / 2, this.h * 0.3 + 52);
  }

  /** 屏幕上方居中的提示文字（多行） */
  notices(lines: [string, string, number][]): void {
    const g = this.g;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    let y = this.h * 0.2;
    for (const [text, color, size] of lines) {
      g.font = `${size}px ${PIXEL_FONT}`;
      const w = g.measureText(text).width + 28;
      g.fillStyle = 'rgba(8,10,12,0.72)';
      g.fillRect(this.w / 2 - w / 2, y - size * 0.85, w, size * 1.7);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.8)';
      g.strokeText(text, this.w / 2, y);
      g.fillStyle = color;
      g.fillText(text, this.w / 2, y);
      y += size * 1.9;
    }
  }

  /** 队友头顶：名字 + 血条 + 状态 */
  nameTag(p: ScreenPt, name: string, color: string, hpFrac: number, status: string): void {
    if (!p.ok) return;
    const g = this.g;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `12px ${PIXEL_FONT}`;
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(name, p.x, p.y - 14);
    g.fillStyle = color;
    g.fillText(name, p.x, p.y - 14);
    const w = 44;
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(p.x - w / 2 - 1, p.y - 5, w + 2, 6);
    g.fillStyle = hpFrac > 0.5 ? '#6aff8a' : hpFrac > 0.25 ? '#ffd24a' : '#ff4a3a';
    g.fillRect(p.x - w / 2, p.y - 4, w * Math.max(0, Math.min(1, hpFrac)), 4);
    if (status) {
      g.font = `12px ${PIXEL_FONT}`;
      g.strokeText(status, p.x, p.y + 10);
      g.fillStyle = status.startsWith('倒地') || status.startsWith('正在') ? '#ff6a5a' : '#c8c8c8';
      g.fillText(status, p.x, p.y + 10);
    }
  }

  /** 圆环进度（拉起队友） */
  ring(p: ScreenPt, frac: number, color: string): void {
    if (!p.ok) return;
    const g = this.g;
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.beginPath();
    g.arc(p.x, p.y, 24, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = color;
    g.beginPath();
    g.arc(p.x, p.y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, frac)));
    g.stroke();
  }

  combo(n: number, t: number): void {
    if (n < 10) return;
    const g = this.g;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    const pulse = 1 + Math.max(0, t - 2.3) * 0.8;
    g.font = `${Math.round(36 * pulse)}px ${PIXEL_FONT}`;
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    const s = `${fmtNum(n)} 连杀`;
    const x = this.w - 24, y = this.h * 0.42;
    g.globalAlpha = Math.min(1, t / 0.6);
    g.strokeText(s, x, y);
    g.fillStyle = n >= 100 ? '#ff5a3a' : n >= 50 ? '#ffb03a' : '#ffe08a';
    g.fillText(s, x, y);
    g.globalAlpha = 1;
  }
}
