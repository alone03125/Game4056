// 2D 叠加层（Canvas）：伤害数字、飘字、拾取提示、准星（含换弹进度）、屏幕外指示箭头。

import { fmtNum } from '../util/math';
import { PIXEL_FONT } from '../ui/font';
import { QTE } from '../data/relics';
import type { QteState } from '../game/relicfx';

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

  /** 第4.1次调整：1 秒内拾取的金币合并成一个跳字（数值累加，跳字跟着玩家） */
  private gold: { f: Floater; amount: number; born: number } | null = null;
  goldText(x: number, y: number, amount: number): void {
    const now = performance.now() / 1000;
    const g = this.gold;
    if (g && now - g.born < 1 && this.floaters.includes(g.f)) {
      g.amount += amount;
      g.f.text = `+${g.amount}`;
      g.f.x = x; g.f.y = y;
      g.f.t = Math.min(g.f.t, 0.1);
      return;
    }
    if (this.floaters.length > 160) this.floaters.shift();
    const f: Floater = { x, y, h: 2.6, text: `+${amount}`, color: '#ffd24a', t: 0, life: 1.4, big: true, dx: 0 };
    this.floaters.push(f);
    this.gold = { f, amount, born: now };
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

  /**
   * 聚精会神的技巧检定（第4.3次调整）：屏幕中间偏下的转轮。指针从正上方顺时针转一圈，
   * 白色为判定区，开头的金色一段为完美区；中间显示当前的专注代币数。
   */
  qte(q: QteState, key: string, tokens: number): void {
    const g = this.g;
    const TAU = Math.PI * 2;
    // 第4.3次调整（续）：转轮整体放大约 30%
    const R = 60;
    const cx = this.w / 2, cy = this.h * 0.7;
    // 角度从正上方开始顺时针
    const A = (a: number) => a - Math.PI / 2;
    g.save();
    g.translate(cx, cy);
    if (q.t < 0) {
      // 提示音之后、转轮出现之前：向内收拢的提示圈
      const k = 1 + q.t / QTE.lead;
      g.globalAlpha = 0.2 + 0.5 * k;
      g.strokeStyle = '#4ad8ff';
      g.lineWidth = 2 + k * 2;
      g.beginPath();
      g.arc(0, 0, R * (1.8 - 0.8 * k), 0, TAU);
      g.stroke();
      g.restore();
      return;
    }
    const res = q.res;
    const pop = res ? 1 + Math.max(0, 0.16 - q.resT) * 1.2 : Math.min(1, 0.72 + q.t * 3.5);
    g.globalAlpha = res ? Math.max(0, 1 - Math.max(0, q.resT - QTE.show * 0.45) / (QTE.show * 0.55)) : 1;
    g.scale(pop, pop);
    // 底盘
    const grd = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R + 18);
    grd.addColorStop(0, 'rgba(6,14,18,0.88)');
    grd.addColorStop(0.72, 'rgba(6,14,18,0.72)');
    grd.addColorStop(1, 'rgba(6,14,18,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, R + 18, 0, TAU);
    g.fill();
    // 刻度与外圈
    for (let i = 0; i < 36; i++) {
      const a = A((i / 36) * TAU);
      const r0 = i % 3 === 0 ? R - 10 : R - 5;
      g.strokeStyle = i % 3 === 0 ? 'rgba(190,235,250,0.45)' : 'rgba(190,235,250,0.22)';
      g.lineWidth = i % 3 === 0 ? 2 : 1;
      g.beginPath();
      g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      g.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      g.stroke();
    }
    g.strokeStyle = 'rgba(190,235,250,0.6)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, R + 4, 0, TAU);
    g.stroke();
    // 判定区（白）与开头的完美区（金）
    g.lineCap = 'butt';
    g.shadowColor = '#4ad8ff';
    g.shadowBlur = 10;
    g.strokeStyle = '#eaf8ff';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(0, 0, R - 1, A(q.start + QTE.great), A(q.start + QTE.width));
    g.stroke();
    g.shadowColor = '#ffb020';
    g.strokeStyle = '#ffd24a';
    g.lineWidth = 15;
    g.beginPath();
    g.arc(0, 0, R - 1, A(q.start), A(q.start + QTE.great));
    g.stroke();
    g.shadowBlur = 0;
    // 指针扫过的残影
    const ang = q.ang;
    const trail = Math.min(ang, 1.1);
    for (let i = 0; i < 6; i++) {
      const a1 = ang - (trail * i) / 6, a0 = ang - (trail * (i + 1)) / 6;
      if (a1 <= 0) break;
      g.fillStyle = `rgba(255,60,40,${(0.2 * (1 - i / 6)).toFixed(3)})`;
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, R - 8, A(Math.max(0, a0)), A(a1));
      g.closePath();
      g.fill();
    }
    // 指针
    const col = res === 'great' ? '#ffd24a' : res === 'good' ? '#eaf8ff' : '#ff4a3a';
    const na = A(ang);
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.lineWidth = 9;
    g.beginPath();
    g.moveTo(Math.cos(na) * 18, Math.sin(na) * 18);
    g.lineTo(Math.cos(na) * (R + 12), Math.sin(na) * (R + 12));
    g.stroke();
    g.strokeStyle = col;
    g.lineWidth = 4;
    g.shadowColor = col;
    g.shadowBlur = 10;
    g.stroke();
    g.shadowBlur = 0;
    // 结果：外圈闪一下
    if (res) {
      g.strokeStyle = col;
      g.globalAlpha *= Math.max(0, 1 - q.resT * 2.5);
      g.lineWidth = 4;
      g.beginPath();
      g.arc(0, 0, R + 6 + q.resT * 40, 0, TAU);
      g.stroke();
      g.globalAlpha = Math.max(0, 1 - Math.max(0, q.resT - QTE.show * 0.45) / (QTE.show * 0.55));
    }
    // 中心：专注代币数
    g.fillStyle = '#0a1418';
    g.beginPath();
    g.arc(0, 0, 19, 0, TAU);
    g.fill();
    g.strokeStyle = '#4ad8ff';
    g.lineWidth = 2;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `24px ${PIXEL_FONT}`;
    g.fillStyle = '#bff4ff';
    g.fillText(String(tokens), 0, 1);
    // 按键提示 / 判定结果
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    if (!res) {
      g.font = `12px ${PIXEL_FONT}`;
      const s = `按 ${key}`;
      g.strokeText(s, 0, R + 24);
      g.fillStyle = '#eaf8ff';
      g.fillText(s, 0, R + 24);
    } else {
      g.font = `24px ${PIXEL_FONT}`;
      const s = res === 'great' ? '完美' : res === 'good' ? '普通' : '错过';
      const y = -R - 26 - q.resT * 16;
      g.strokeText(s, 0, y);
      g.fillStyle = col;
      g.fillText(s, 0, y);
    }
    g.restore();
  }

  /** 连杀播报（第4.3次调整：移到屏幕左侧，x / y 为左对齐的位置） */
  combo(n: number, t: number, x: number, y: number): void {
    if (n < 10) return;
    const g = this.g;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const pulse = 1 + Math.max(0, t - 2.3) * 0.8;
    g.font = `${Math.round(36 * pulse)}px ${PIXEL_FONT}`;
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    const s = `${fmtNum(n)} 连杀`;
    g.globalAlpha = Math.min(1, t / 0.6);
    g.strokeText(s, x, y);
    g.fillStyle = n >= 100 ? '#ff5a3a' : n >= 50 ? '#ffb03a' : '#ffe08a';
    g.fillText(s, x, y);
    g.globalAlpha = 1;
  }
}
