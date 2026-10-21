// 图鉴里的敌人、区域任务与奇物图标（第4.2次调整）：和子弹图标一样用 Canvas 程序化绘制——
// 背景光 + 带黑色描边的简单造型。奇物图标另有深色底和彩色边框，在 HUD 上缩小成 24 像素也能分辨。
// 第4.3次调整：新增精研百草、友谊地久天长、聚精会神的图标。

import { RelicId, RELICS } from '../data/relics';
import type { QuestId } from '../game/quest';
import { PIXEL_FONT } from './font';
import { cachedIcon } from './icons';

type G = CanvasRenderingContext2D;
type Fill = string | CanvasGradient;
const OUT = 'rgba(0,0,0,0.85)';
const TAU = Math.PI * 2;

// —— 绘制工具 ——

function glow(g: G, color: string): void {
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, color + '55');
  grd.addColorStop(1, color + '00');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
}

/** 描边后填充当前路径 */
function fs(g: G, fill: Fill, lw = 2.5): void {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = lw;
  g.strokeStyle = OUT;
  g.stroke();
  g.fillStyle = fill;
  g.fill();
}

function poly(g: G, ...p: number[]): void {
  g.beginPath();
  g.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
  g.closePath();
}

function circ(g: G, x: number, y: number, r: number): void {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
}

function rrect(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 带黑边的线条 */
function stroke(g: G, color: string, w: number, ...p: number[]): void {
  g.beginPath();
  g.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = OUT;
  g.lineWidth = w + 2.5;
  g.stroke();
  g.strokeStyle = color;
  g.lineWidth = w;
  g.stroke();
}

function lin(g: G, x0: number, y0: number, x1: number, y1: number, ...stops: string[]): CanvasGradient {
  const grd = g.createLinearGradient(x0, y0, x1, y1);
  stops.forEach((c, i) => grd.addColorStop(i / Math.max(1, stops.length - 1), c));
  return grd;
}

/** 四角星闪光 */
function sparkle(g: G, x: number, y: number, r: number, color = '#ffffff'): void {
  poly(g, x, y - r, x + r * 0.28, y - r * 0.28, x + r, y, x + r * 0.28, y + r * 0.28, x, y + r, x - r * 0.28, y + r * 0.28, x - r, y, x - r * 0.28, y - r * 0.28);
  g.fillStyle = color;
  g.fill();
}

/** 火焰（水滴形，外红内黄） */
function flame(g: G, x: number, y: number, w: number, h: number, outer = '#ff6a1a', inner = '#ffe08a'): void {
  const shape = (s: number) => {
    g.beginPath();
    g.moveTo(x, y - h * s);
    g.bezierCurveTo(x + w * 0.9 * s, y - h * 0.35 * s, x + w * s, y + h * 0.45 * s, x, y + h * 0.5 * s);
    g.bezierCurveTo(x - w * s, y + h * 0.45 * s, x - w * 0.9 * s, y - h * 0.35 * s, x, y - h * s);
    g.closePath();
  };
  shape(1);
  fs(g, lin(g, x, y - h, x, y + h * 0.5, '#ffd24a', outer));
  shape(0.55);
  g.save();
  g.translate(0, h * 0.2);
  g.fillStyle = inner;
  g.fill();
  g.restore();
}

/** 爱心 */
function heart(g: G, x: number, y: number, s: number): void {
  g.beginPath();
  g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.3, y, x - s * 0.9, y - s * 0.95, x, y - s * 0.4);
  g.bezierCurveTo(x + s * 0.9, y - s * 0.95, x + s * 1.3, y, x, y + s * 0.9);
  g.closePath();
}

/** 辐射标志 */
function trefoil(g: G, x: number, y: number, r: number, color: string, bg: string): void {
  circ(g, x, y, r);
  g.fillStyle = bg;
  g.fill();
  g.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i * TAU) / 3;
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, r * 0.85, a - 0.5, a + 0.5);
    g.closePath();
    g.fill();
  }
  circ(g, x, y, r * 0.22);
  g.fillStyle = bg;
  g.fill();
  circ(g, x, y, r * 0.14);
  g.fillStyle = color;
  g.fill();
}

/** 竖直的短刀（以中心旋转后绘制） */
function dagger(g: G, cx: number, cy: number, rot: number, blade: Fill, guard: string, grip: string, len = 1): void {
  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  g.scale(len, len);
  poly(g, 0, -26, 5, -18, 5, 6, -5, 6, -5, -18);
  fs(g, blade);
  stroke(g, 'rgba(255,255,255,0.55)', 1.2, 0, -22, 0, 3);
  rrect(g, -12, 6, 24, 5, 2);
  fs(g, guard);
  rrect(g, -3.5, 11, 7, 12, 2);
  fs(g, grip);
  circ(g, 0, 26, 3.5);
  fs(g, guard);
  g.restore();
}

// —— 丧尸 ——

interface Head {
  skin: Fill;
  shirt?: string;
  eye?: string;
  y?: number;
  s?: number;
  open?: boolean;
}

/** 丧尸的头和肩膀 */
function zombie(g: G, o: Head): void {
  const s = o.s ?? 1, cy = o.y ?? 28;
  poly(g, 12, 66, 15, 52, 49, 52, 52, 66);
  fs(g, o.shirt ?? '#4a5058');
  rrect(g, 32 - 13 * s, cy - 15 * s, 26 * s, 30 * s, 8 * s);
  fs(g, o.skin);
  // 眼窝与发光的眼睛（一大一小，显得歪斜）
  g.fillStyle = '#1a0e0c';
  circ(g, 32 - 5.5 * s, cy - 2 * s, 3.9 * s); g.fill();
  circ(g, 32 + 5.5 * s, cy - 3 * s, 3.2 * s); g.fill();
  g.fillStyle = o.eye ?? '#ffe14a';
  circ(g, 32 - 5.5 * s, cy - 2 * s, 1.5 * s); g.fill();
  circ(g, 32 + 5.5 * s, cy - 3 * s, 1.2 * s); g.fill();
  // 嘴
  g.fillStyle = '#2a0806';
  if (o.open) {
    g.beginPath();
    g.ellipse(32, cy + 8 * s, 4.8 * s, 4 * s, 0, 0, TAU);
    g.fill();
  } else {
    poly(g, 32 - 6 * s, cy + 6.5 * s, 32 + 6 * s, cy + 5.5 * s, 32 + 5 * s, cy + 10 * s, 32 - 5 * s, cy + 10.5 * s);
    g.fill();
    g.fillStyle = '#e8dcc0';
    for (let k = 0; k < 4; k++) g.fillRect(32 - 4.5 * s + k * 2.8 * s, cy + 6.5 * s, 1.5 * s, 1.8 * s);
  }
  // 缝线
  stroke(g, '#4a2a1a', 1, 32 + 7 * s, cy + 4 * s, 32 + 11 * s, cy + 9 * s);
}

export type EnemyArtId = 'office' | 'iron' | 'runner' | 'spitter' | 'creeper' | 'mutant' | 'elite' | 'laoda' | 'mamba' | 'chest';

/** 奇物宝箱 */
function chest(g: G): void {
  rrect(g, 12, 30, 40, 24, 3);
  fs(g, lin(g, 0, 30, 0, 54, '#8a5a30', '#5a3a1e'));
  g.beginPath();
  g.moveTo(12, 32);
  g.lineTo(12, 26);
  g.bezierCurveTo(12, 12, 52, 12, 52, 26);
  g.lineTo(52, 32);
  g.closePath();
  fs(g, lin(g, 0, 14, 0, 32, '#a06a3a', '#6a4422'));
  for (const x of [17, 32, 47]) { rrect(g, x - 2.5, 16, 5, 38, 1.5); fs(g, '#ffc83a', 1.5); }
  rrect(g, 27, 28, 10, 10, 2);
  fs(g, '#fff0a0');
  g.fillStyle = '#3a2a10';
  g.fillRect(31, 31, 2, 4);
  sparkle(g, 52, 12, 6, '#fff6c0');
  sparkle(g, 10, 18, 4, '#ffe08a');
}

export function enemyIcon(id: EnemyArtId): string {
  return cachedIcon('en' + id, 64, 64, (g) => {
    switch (id) {
      case 'office':
        glow(g, '#c8b8a0');
        zombie(g, { skin: '#8aa070', shirt: '#e8e4dc' });
        poly(g, 32, 52, 35.5, 55, 33.5, 66, 30.5, 66, 28.5, 55);
        fs(g, '#c02a2a', 1.5);
        // 乱糟糟的头发
        poly(g, 19, 18, 22, 10, 26, 15, 30, 8, 34, 14, 39, 9, 41, 16, 45, 13, 45, 20, 19, 22);
        fs(g, '#2a2420', 1.5);
        break;
      case 'iron':
        glow(g, '#9aa4b0');
        zombie(g, { skin: '#7a9070', shirt: '#5a5048', s: 1.12, y: 31 });
        g.beginPath();
        g.arc(32, 22, 17, Math.PI, 0);
        g.lineTo(49, 24);
        g.lineTo(15, 24);
        g.closePath();
        fs(g, lin(g, 0, 5, 0, 24, '#c8d0d8', '#6a727a'));
        g.fillStyle = '#3a4048';
        for (const x of [20, 32, 44]) { circ(g, x, 20, 1.6); g.fill(); }
        stroke(g, '#3a4048', 1.2, 24, 12, 27, 16);
        break;
      case 'runner':
        glow(g, '#ff9a6a');
        for (const [y, l] of [[22, 12], [32, 16], [42, 10]]) stroke(g, '#ffb08a', 2, 4, y, 4 + l, y);
        g.save();
        g.translate(36, 34);
        g.rotate(0.22);
        g.translate(-32, -34);
        zombie(g, { skin: '#9a8a60', shirt: '#b04a2a', eye: '#ff6a3a' });
        g.restore();
        break;
      case 'spitter':
        glow(g, '#9aff4a');
        zombie(g, { skin: '#8acc5a', shirt: '#3a5a2a', eye: '#ffffff', open: true });
        for (const [x, y, r] of [[44, 40, 3.2], [50, 34, 4], [57, 26, 5]]) { circ(g, x, y, r); fs(g, '#9aff3a', 1.5); }
        break;
      case 'creeper': {
        glow(g, '#6aff6a');
        rrect(g, 14, 8, 36, 44, 3);
        fs(g, '#5aaa4a');
        // 方块花纹
        const shades = ['#4a9a3a', '#6aba5a', '#7aca6a', '#3a8a2a'];
        for (let y = 0; y < 5; y++) for (let x = 0; x < 4; x++) {
          g.fillStyle = shades[(x * 3 + y * 5) % 4];
          g.globalAlpha = 0.55;
          g.fillRect(16 + x * 8, 10 + y * 8, 8, 8);
        }
        g.globalAlpha = 1;
        g.fillStyle = '#10200c';
        g.fillRect(19, 18, 9, 9);
        g.fillRect(36, 18, 9, 9);
        g.fillRect(28, 27, 8, 10);
        g.fillRect(24, 32, 4, 12);
        g.fillRect(36, 32, 4, 12);
        poly(g, 20, 52, 44, 52, 46, 64, 18, 64);
        fs(g, '#4a8a3a');
        break;
      }
      case 'mutant':
        glow(g, '#ff7aff');
        zombie(g, { skin: lin(g, 18, 12, 46, 44, '#ff6a6a', '#ffd24a', '#6aff8a', '#4ad8ff', '#c06aff'), shirt: '#4a3a5a', eye: '#ffffff' });
        sparkle(g, 12, 14, 6);
        sparkle(g, 53, 20, 5, '#ffe8ff');
        sparkle(g, 50, 46, 4, '#d8f8ff');
        break;
      case 'elite':
        glow(g, '#ff8a1a');
        for (const [r, c] of [[29, '#ff3030'], [25, '#ff8a1a'], [21, '#ffe14a']] as const) {
          circ(g, 32, 30, r);
          g.lineWidth = 3;
          g.strokeStyle = c;
          g.stroke();
        }
        zombie(g, { skin: '#8aa070', shirt: '#4a5058', eye: '#ff3a1a' });
        break;
      case 'laoda':
        glow(g, '#ff4a3a');
        zombie(g, { skin: '#9a6a4a', shirt: '#6a1a14', eye: '#ff3a1a', s: 1.18, y: 35 });
        // 王冠
        poly(g, 18, 20, 20, 6, 26, 14, 32, 3, 38, 14, 44, 6, 46, 20);
        fs(g, lin(g, 0, 3, 0, 20, '#fff0a0', '#e0a020'));
        g.fillStyle = '#ff3a3a';
        circ(g, 32, 14, 2.2); g.fill();
        stroke(g, '#5a2a1a', 1.4, 20, 30, 27, 38);
        break;
      case 'mamba':
        glow(g, '#c06aff');
        // 盘起来的身体
        g.beginPath();
        g.ellipse(32, 54, 24, 9, 0, 0, TAU);
        fs(g, lin(g, 0, 45, 0, 63, '#9a4ad8', '#4a1a7a'));
        // 头
        g.beginPath();
        g.moveTo(32, 50);
        g.bezierCurveTo(10, 48, 8, 14, 32, 10);
        g.bezierCurveTo(56, 14, 54, 48, 32, 50);
        g.closePath();
        fs(g, lin(g, 0, 10, 0, 50, '#c88aff', '#6a2aa0'));
        // 竖瞳
        for (const x of [23, 41]) {
          g.beginPath();
          g.ellipse(x, 24, 5, 4, 0, 0, TAU);
          fs(g, '#ffe14a', 1.5);
          g.fillStyle = '#1a0a10';
          g.fillRect(x - 0.9, 20.5, 1.8, 7);
        }
        // 毒牙与信子
        poly(g, 25, 38, 28, 38, 26.5, 46); fs(g, '#ffffff', 1.2);
        poly(g, 36, 38, 39, 38, 37.5, 46); fs(g, '#ffffff', 1.2);
        stroke(g, '#ff3a5a', 1.6, 32, 40, 32, 50, 29, 55);
        stroke(g, '#ff3a5a', 1.6, 32, 50, 35, 55);
        break;
      case 'chest':
        glow(g, '#ffd24a');
        chest(g);
        break;
    }
  });
}

// —— 区域任务 ——

export function questIcon(id: QuestId): string {
  return cachedIcon('qu' + id, 64, 64, (g) => {
    switch (id) {
      case 'signal':
        glow(g, '#4affe0');
        // 电波
        for (let k = 0; k < 3; k++) {
          const r = 10 + k * 7;
          for (const side of [-1, 1]) {
            g.beginPath();
            g.arc(32, 16, r, side < 0 ? Math.PI * 0.75 : -Math.PI * 0.25, side < 0 ? Math.PI * 1.25 : Math.PI * 0.25);
            g.lineWidth = 2.5;
            g.strokeStyle = `rgba(74,255,224,${0.9 - k * 0.25})`;
            g.stroke();
          }
        }
        // 信号塔
        stroke(g, '#c8d0d8', 3, 22, 60, 32, 18, 42, 60);
        stroke(g, '#c8d0d8', 2, 26, 44, 38, 44);
        stroke(g, '#c8d0d8', 2, 24, 52, 40, 52);
        stroke(g, '#c8d0d8', 1.5, 26, 44, 40, 52);
        circ(g, 32, 16, 5);
        fs(g, '#4affe0');
        break;
      case 'pyre':
        glow(g, '#ff8a2a');
        g.save();
        g.translate(32, 52);
        for (const a of [-0.35, 0.35]) {
          g.save();
          g.rotate(a);
          rrect(g, -18, -4, 36, 8, 4);
          fs(g, lin(g, 0, -4, 0, 4, '#9a6a3a', '#5a3a1e'));
          g.restore();
        }
        g.restore();
        flame(g, 30, 34, 13, 26);
        // 红旗
        stroke(g, '#d8d8d8', 1.8, 49, 58, 49, 12);
        poly(g, 49, 12, 61, 16, 49, 21);
        fs(g, '#ff2a1a', 1.5);
        break;
      case 'mutant':
        glow(g, '#ff7aff');
        zombie(g, { skin: lin(g, 18, 12, 46, 44, '#ff6a6a', '#ffd24a', '#6aff8a', '#4ad8ff', '#c06aff'), shirt: '#4a3a5a', eye: '#ffffff' });
        // 准星
        circ(g, 32, 30, 22);
        g.lineWidth = 2.5;
        g.strokeStyle = '#ff3a3a';
        g.stroke();
        for (const [x0, y0, x1, y1] of [[32, 2, 32, 12], [32, 48, 32, 58], [4, 30, 14, 30], [50, 30, 60, 30]]) stroke(g, '#ff3a3a', 2.5, x0, y0, x1, y1);
        break;
      case 'cargo':
        glow(g, '#ffd24a');
        // 运载点
        g.beginPath();
        g.ellipse(45, 50, 15, 7, 0, 0, TAU);
        fs(g, 'rgba(255,210,74,0.35)', 2);
        g.beginPath();
        g.ellipse(45, 50, 8, 3.6, 0, 0, TAU);
        g.lineWidth = 2;
        g.strokeStyle = '#ffd24a';
        g.stroke();
        // 物资球
        circ(g, 22, 26, 13);
        fs(g, '#e8b030');
        g.save();
        circ(g, 22, 26, 12);
        g.clip();
        g.fillStyle = '#2a2622';
        for (let k = -2; k <= 2; k++) {
          g.save();
          g.translate(22 + k * 8, 26);
          g.rotate(0.5);
          g.fillRect(-2, -16, 4, 32);
          g.restore();
        }
        g.restore();
        // 箭头
        stroke(g, '#ffffff', 2.5, 34, 36, 42, 44);
        poly(g, 44, 46, 37, 45, 43, 39);
        fs(g, '#ffffff', 1.5);
        break;
      case 'miasma':
        glow(g, '#7aff5a');
        // 道路
        poly(g, 0, 40, 64, 26, 64, 46, 0, 60);
        fs(g, '#4a4a4c', 2);
        for (let k = 0; k < 4; k++) stroke(g, '#d8c050', 2, 4 + k * 16, 49 - k * 3.5, 12 + k * 16, 47.3 - k * 3.5);
        // 瘴气
        g.fillStyle = 'rgba(40,110,40,0.85)';
        for (const [x, y, r] of [[18, 38, 11], [30, 30, 13], [44, 34, 11], [54, 26, 8], [10, 30, 7]]) { circ(g, x, y, r); g.fill(); }
        g.fillStyle = 'rgba(120,255,90,0.55)';
        for (const [x, y, r] of [[26, 26, 5], [42, 30, 4], [14, 34, 3]]) { circ(g, x, y, r); g.fill(); }
        // 净化的闪光
        sparkle(g, 50, 46, 7, '#e8ffe0');
        sparkle(g, 58, 54, 4, '#e8ffe0');
        break;
    }
  });
}

// —— 奇物 ——

/** 奇物图标：深色底、彩色边框 */
function relicFrame(g: G, color: string): void {
  rrect(g, 2, 2, 60, 60, 9);
  g.fillStyle = '#14181c';
  g.fill();
  g.save();
  rrect(g, 2, 2, 60, 60, 9);
  g.clip();
  glow(g, color);
  g.restore();
  rrect(g, 3.5, 3.5, 57, 57, 8);
  g.lineWidth = 3;
  g.strokeStyle = color;
  g.stroke();
}

export function relicIcon(id: RelicId): string {
  const d = RELICS[id];
  return cachedIcon('re' + id, 64, 64, (g) => {
    relicFrame(g, d.color);
    switch (id) {
      case 'brave': // 愈战愈勇：燃烧的剑
        flame(g, 32, 28, 15, 22, '#ff4a1a');
        dagger(g, 32, 34, 0, lin(g, 27, 0, 37, 0, '#ffffff', '#a8b0bc'), '#ffc83a', '#6a3a1e');
        break;
      case 'unyield': // 百折不挠：裂开但缠着绷带的心
        heart(g, 32, 32, 21);
        fs(g, lin(g, 0, 10, 0, 52, '#ff6a7a', '#b01a2a'));
        stroke(g, '#3a0a0a', 2, 33, 14, 28, 26, 36, 33, 29, 44);
        g.save();
        g.translate(32, 33);
        g.rotate(-0.5);
        rrect(g, -20, -4, 40, 8, 2);
        fs(g, '#f0e4c8', 1.5);
        g.fillStyle = '#c8b898';
        for (let k = -2; k <= 2; k++) g.fillRect(k * 7 - 1, -2, 2, 4);
        g.restore();
        break;
      case 'antique': // 老古董：古瓶与金币
        g.beginPath();
        g.moveTo(24, 10);
        g.lineTo(40, 10);
        g.lineTo(38, 18);
        g.bezierCurveTo(54, 24, 52, 48, 40, 54);
        g.lineTo(24, 54);
        g.bezierCurveTo(12, 48, 10, 24, 26, 18);
        g.closePath();
        fs(g, lin(g, 12, 0, 52, 0, '#5a8aa8', '#a8d8e8', '#4a7a98'));
        stroke(g, '#2a4a6a', 2, 18, 32, 46, 32);
        stroke(g, '#2a4a6a', 1.5, 22, 40, 26, 36, 30, 40, 34, 36, 38, 40, 42, 36);
        for (const [x, y] of [[46, 52], [50, 47], [44, 45]]) {
          g.beginPath();
          g.ellipse(x, y, 7, 3.5, 0, 0, TAU);
          fs(g, '#ffd24a', 1.5);
        }
        break;
      case 'bandage': // 快速包扎：绷带卷与十字
        g.save();
        g.translate(30, 36);
        g.rotate(-0.7);
        rrect(g, -22, -8, 44, 16, 6);
        fs(g, '#f0e4c8');
        rrect(g, -7, -6, 14, 12, 2);
        fs(g, '#e8c8b0', 1.2);
        g.fillStyle = '#c8a888';
        for (let k = 0; k < 3; k++) for (let j = 0; j < 2; j++) { circ(g, -4 + k * 4, -2 + j * 4, 0.9); g.fill(); }
        g.restore();
        poly(g, 44, 8, 50, 8, 50, 14, 56, 14, 56, 20, 50, 20, 50, 26, 44, 26, 44, 20, 38, 20, 38, 14, 44, 14);
        fs(g, '#6aff8a', 2);
        break;
      case 'might': // 天生神力：哑铃
        g.save();
        g.translate(32, 34);
        g.rotate(-0.45);
        rrect(g, -18, -3, 36, 6, 2);
        fs(g, '#c8ccd2');
        for (const x of [-22, 16]) {
          rrect(g, x, -13, 6, 26, 2);
          fs(g, '#3a3e44');
          rrect(g, x + (x < 0 ? -5 : 6), -9, 5, 18, 2);
          fs(g, '#5a5e64');
        }
        g.restore();
        stroke(g, '#ffb03a', 2.5, 12, 14, 18, 20);
        stroke(g, '#ffb03a', 2.5, 22, 8, 24, 16);
        stroke(g, '#ffb03a', 2.5, 50, 50, 44, 46);
        break;
      case 'crit': // 要害一击：准星与红心
        circ(g, 32, 32, 20);
        g.lineWidth = 5;
        g.strokeStyle = OUT;
        g.stroke();
        g.lineWidth = 3;
        g.strokeStyle = '#ff3a3a';
        g.stroke();
        for (const [x0, y0, x1, y1] of [[32, 6, 32, 20], [32, 44, 32, 58], [6, 32, 20, 32], [44, 32, 58, 32]]) stroke(g, '#ffffff', 2.5, x0, y0, x1, y1);
        sparkle(g, 32, 32, 9, '#ff5aff');
        circ(g, 32, 32, 3);
        g.fillStyle = '#ffffff';
        g.fill();
        break;
      case 'bow': // 沉眠长弓：弓、箭与 z
        g.beginPath();
        g.arc(14, 34, 24, -1.05, 1.05);
        g.lineWidth = 6;
        g.strokeStyle = OUT;
        g.stroke();
        g.lineWidth = 3.5;
        g.strokeStyle = '#a0703a';
        g.stroke();
        stroke(g, '#e8e8e8', 1, 26, 13, 26, 55);
        stroke(g, '#c8ccd2', 2, 10, 34, 50, 34);
        poly(g, 56, 34, 47, 29, 47, 39);
        fs(g, '#9ad8ff', 1.5);
        poly(g, 10, 34, 5, 29, 14, 34, 5, 39);
        fs(g, '#9ad8ff', 1.2);
        g.fillStyle = '#c8ecff';
        g.font = `12px ${PIXEL_FONT}`;
        g.textAlign = 'center';
        g.fillText('z', 44, 18);
        g.font = `24px ${PIXEL_FONT}`;
        g.fillText('z', 54, 14);
        break;
      case 'knife': // 刺客短刀
        dagger(g, 32, 32, Math.PI / 4, lin(g, -5, 0, 5, 0, '#ffffff', '#8a929e'), '#3a3e44', '#2a1a2a', 1.05);
        stroke(g, '#e8eef4', 1.5, 46, 18, 54, 10);
        stroke(g, '#e8eef4', 1.5, 50, 24, 58, 18);
        break;
      case 'shield': // 圣盾
        g.beginPath();
        g.moveTo(12, 12);
        g.lineTo(52, 12);
        g.lineTo(52, 30);
        g.quadraticCurveTo(52, 50, 32, 58);
        g.quadraticCurveTo(12, 50, 12, 30);
        g.closePath();
        fs(g, lin(g, 0, 12, 0, 58, '#fffbe0', '#e8c060'));
        poly(g, 29, 18, 35, 18, 35, 28, 45, 28, 45, 34, 35, 34, 35, 50, 29, 50, 29, 34, 19, 34, 19, 28, 29, 28);
        fs(g, '#ffd24a', 1.5);
        sparkle(g, 48, 10, 6, '#ffffff');
        break;
      case 'suit': // 超级防护服：防护头盔与辐射标志
        rrect(g, 13, 10, 38, 44, 16);
        fs(g, lin(g, 0, 10, 0, 54, '#ffe060', '#c89a20'));
        rrect(g, 18, 18, 28, 18, 8);
        fs(g, lin(g, 0, 18, 0, 36, '#4a7a9a', '#1a3a5a'));
        stroke(g, 'rgba(255,255,255,0.7)', 2, 22, 22, 28, 22);
        trefoil(g, 32, 46, 7, '#1a1a1a', '#ffe060');
        break;
      case 'breath': // 神息刀：弯刀与风
        g.beginPath();
        g.moveTo(14, 52);
        g.quadraticCurveTo(22, 14, 54, 8);
        g.quadraticCurveTo(32, 22, 22, 54);
        g.closePath();
        fs(g, lin(g, 14, 52, 54, 8, '#ffffff', '#c8a0ff'));
        rrect(g, 10, 50, 12, 6, 2);
        fs(g, '#6a4a9a');
        for (const [x, y, r] of [[40, 36, 6], [48, 46, 4]]) {
          g.beginPath();
          g.arc(x, y, r, Math.PI * 0.2, Math.PI * 1.7);
          g.lineWidth = 2;
          g.strokeStyle = '#e0c8ff';
          g.stroke();
        }
        break;
      case 'golden': // 金刀
        dagger(g, 32, 33, -Math.PI / 4, lin(g, -5, 0, 5, 0, '#fff6c0', '#e0a020'), '#a06a1a', '#5a3a1a', 1.05);
        sparkle(g, 48, 14, 7, '#fff6c0');
        sparkle(g, 14, 20, 4, '#ffe08a');
        break;
      case 'scepter': // 王杖
        stroke(g, '#ffc83a', 4, 16, 56, 40, 24);
        circ(g, 44, 19, 9);
        fs(g, lin(g, 36, 10, 52, 28, '#ff8a8a', '#c01a2a'));
        poly(g, 36, 12, 38, 4, 42, 9, 46, 3, 49, 10, 53, 6, 52, 14);
        fs(g, '#ffd24a', 1.5);
        circ(g, 41, 16, 2.5);
        g.fillStyle = 'rgba(255,255,255,0.8)';
        g.fill();
        rrect(g, 13, 52, 8, 6, 2);
        fs(g, '#ffd24a', 1.5);
        break;
      case 'feather': // 黑曜羽毛
        g.save();
        g.translate(32, 32);
        g.rotate(0.6);
        g.beginPath();
        g.moveTo(0, -26);
        g.bezierCurveTo(13, -14, 12, 10, 0, 22);
        g.bezierCurveTo(-12, 10, -13, -14, 0, -26);
        g.closePath();
        fs(g, lin(g, -12, 0, 12, 0, '#2a1a3a', '#6a5a9a', '#2a1a3a'));
        stroke(g, '#c8b8ff', 1.2, 0, -24, 0, 28);
        for (const y of [-10, 2]) {
          g.fillStyle = '#14181c';
          poly(g, 13, y, 6, y + 2, 13, y + 5);
          g.fill();
        }
        g.restore();
        sparkle(g, 48, 16, 5, '#c8b8ff');
        break;
      case 'shock': // 电击疗法：闪电与十字
        poly(g, 38, 4, 16, 36, 29, 36, 22, 60, 48, 24, 35, 24, 44, 4);
        fs(g, lin(g, 0, 4, 0, 60, '#ffffff', '#6ab8ff'));
        poly(g, 47, 42, 51, 42, 51, 46, 55, 46, 55, 50, 51, 50, 51, 54, 47, 54, 47, 50, 43, 50, 43, 46, 47, 46);
        fs(g, '#ffffff', 1.5);
        break;
      case 'burn': // 灼烧疗法：火焰
        flame(g, 32, 38, 17, 28, '#ff4a1a');
        sparkle(g, 14, 18, 4, '#ffd24a');
        sparkle(g, 50, 22, 3, '#ffd24a');
        break;
      case 'corrode': // 腐蚀疗法：酸液滴与气泡
        g.beginPath();
        g.ellipse(32, 52, 20, 6, 0, 0, TAU);
        fs(g, 'rgba(120,230,60,0.85)', 2);
        g.beginPath();
        g.moveTo(30, 8);
        g.bezierCurveTo(42, 24, 44, 34, 30, 42);
        g.bezierCurveTo(16, 34, 18, 24, 30, 8);
        g.closePath();
        fs(g, lin(g, 0, 8, 0, 42, '#d8ff8a', '#4aaa1a'));
        circ(g, 26, 30, 3);
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fill();
        for (const [x, y, r] of [[46, 40, 4], [50, 30, 2.6], [16, 44, 3]]) { circ(g, x, y, r); fs(g, '#9aff4a', 1.4); }
        break;
      case 'herb': { // 精研百草：药碾里长出的草药，上方是溢出的爱心
        for (const [x, y, rot] of [[24, 30, -0.6], [32, 26, 0], [40, 30, 0.6]] as const) {
          g.save();
          g.translate(x, y);
          g.rotate(rot);
          g.beginPath();
          g.moveTo(0, 12);
          g.bezierCurveTo(9, 4, 8, -8, 0, -14);
          g.bezierCurveTo(-8, -8, -9, 4, 0, 12);
          g.closePath();
          fs(g, lin(g, -8, 0, 8, 0, '#4ab83a', '#b8ff8a'), 2);
          stroke(g, '#2a6a1a', 1, 0, 10, 0, -10);
          g.restore();
        }
        g.beginPath();
        g.moveTo(12, 38);
        g.lineTo(52, 38);
        g.quadraticCurveTo(50, 56, 32, 57);
        g.quadraticCurveTo(14, 56, 12, 38);
        g.closePath();
        fs(g, lin(g, 0, 38, 0, 57, '#a89a8a', '#5a5048'));
        g.beginPath();
        g.ellipse(32, 38, 20, 4, 0, 0, TAU);
        fs(g, '#3a3430', 2);
        heart(g, 50, 13, 8);
        fs(g, lin(g, 0, 5, 0, 22, '#ff8a9a', '#d02a3a'), 2);
        sparkle(g, 58, 5, 4, '#fff6c0');
        break;
      }
      case 'friend': { // 友谊地久天长：扣在一起的两个环与爱心
        for (const [x, color] of [[24, '#ff9ac8'], [40, '#ffd24a']] as const) {
          circ(g, x, 36, 13);
          g.lineWidth = 9;
          g.strokeStyle = OUT;
          g.stroke();
          g.lineWidth = 6;
          g.strokeStyle = color;
          g.stroke();
        }
        // 让粉色的环压在金色的环上方，显得扣在一起
        g.beginPath();
        g.arc(24, 36, 13, -0.55, 0.55);
        g.lineWidth = 9;
        g.strokeStyle = OUT;
        g.stroke();
        g.lineWidth = 6;
        g.strokeStyle = '#ff9ac8';
        g.stroke();
        heart(g, 32, 14, 8);
        fs(g, lin(g, 0, 6, 0, 22, '#ffc0dc', '#ff4a8a'), 2);
        sparkle(g, 12, 14, 4, '#ffffff');
        sparkle(g, 53, 56, 3.5, '#ffffff');
        break;
      }
      case 'focus': { // 聚精会神：技巧检定的转轮（判定区、完美区与指针）
        circ(g, 32, 33, 22);
        g.fillStyle = '#0a1a22';
        g.fill();
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(190,235,250,0.6)';
        g.stroke();
        g.lineCap = 'butt';
        g.beginPath();
        g.arc(32, 33, 19, 0.35, 1.3);
        g.lineWidth = 6;
        g.strokeStyle = '#eaf8ff';
        g.stroke();
        g.beginPath();
        g.arc(32, 33, 19, 0.05, 0.38);
        g.lineWidth = 9;
        g.strokeStyle = '#ffd24a';
        g.stroke();
        stroke(g, '#ff4a3a', 3, 32, 33, 32 + Math.cos(0.2) * 25, 33 + Math.sin(0.2) * 25);
        circ(g, 32, 33, 6);
        fs(g, '#4ad8ff', 2);
        sparkle(g, 14, 12, 5, '#bff4ff');
        break;
      }
    }
  });
}
