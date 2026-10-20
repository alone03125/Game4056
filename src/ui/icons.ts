// 程序化图标（Canvas → dataURL，带缓存）：枪械侧视剪影、子弹、道具。

import { BULLETS, BulletId } from '../data/bullets';
import { Gun } from '../data/guns';
import { ItemId, ITEMS } from '../data/items';
import { RARITY_CSS } from '../config';

/** 第4.1次调整的逻辑模块图标符号 */
const MODULE_SYM: Partial<Record<BulletId, string>> = {
  mShine: '✦', mLoop: '∞', mShort: '½', mPre: '↺', mStrip: '✂', mSplit2: '⇉', mCopy: '❐',
};

const cache = new Map<string, string>();

function mk(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g);
  return c.toDataURL();
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function gunIcon(gun: Gun): string {
  const key = 'g' + gun.uid + gun.rarity;
  const c = cache.get(key);
  if (c) return c;
  const L = gun.look;
  const url = mk(192, 80, (g) => {
    const s = 150 / (L.bodyLen * 1.6 + L.barrelLen + 0.15);
    const ox = 18, oy = 36;
    const body = hex(L.color), metal = '#26282c', acc = RARITY_CSS[gun.rarity];
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.lineWidth = 3;
    const rect = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.strokeRect(ox + x * s, oy + y * s, w * s, h * s);
      g.fillRect(ox + x * s, oy + y * s, w * s, h * s);
    };
    const B = L.bulky;
    const stockLen = L.stock ? L.bodyLen * 0.4 : 0;
    const bx = stockLen;
    if (L.stock) rect(0, -0.03, stockLen + 0.02, 0.1 * B, body);
    rect(bx, -0.06 * B, L.bodyLen, 0.12 * B, body);
    rect(bx + L.bodyLen, -0.025 * B, L.barrelLen, 0.045 * B, metal);
    if (L.wideMuzzle) rect(bx + L.bodyLen + L.barrelLen - 0.03, -0.05 * B, 0.07, 0.1 * B, metal);
    if (L.drum) {
      g.fillStyle = metal;
      g.beginPath();
      g.arc(ox + (bx + L.bodyLen * 0.45) * s, oy + 0.12 * B * s, 0.1 * B * s, 0, 7);
      g.stroke(); g.fill();
    } else rect(bx + L.bodyLen * 0.42, 0.05 * B, 0.07, 0.17 * B, metal);
    // 握把
    g.fillStyle = metal;
    g.beginPath();
    g.moveTo(ox + (bx + L.bodyLen * 0.1) * s, oy + 0.05 * B * s);
    g.lineTo(ox + (bx + L.bodyLen * 0.22) * s, oy + 0.05 * B * s);
    g.lineTo(ox + (bx + L.bodyLen * 0.17) * s, oy + 0.24 * s);
    g.lineTo(ox + (bx + L.bodyLen * 0.05) * s, oy + 0.24 * s);
    g.closePath();
    g.stroke(); g.fill();
    if (L.scope) rect(bx + L.bodyLen * 0.3, -0.13 * B, L.bodyLen * 0.4, 0.06, metal);
    g.fillStyle = acc;
    g.fillRect(ox + (bx + 0.03) * s, oy - 0.02 * B * s, (L.bodyLen - 0.06) * s, 0.025 * s);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(ox + bx * s, oy - 0.06 * B * s, L.bodyLen * s, 0.025 * s);
  });
  cache.set(key, url);
  return url;
}

export function bulletIcon(id: BulletId): string {
  const key = 'b' + id;
  const c = cache.get(key);
  if (c) return c;
  const def = BULLETS[id];
  const col = hex(def.color);
  const url = mk(64, 64, (g) => {
    // 背景光
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, col + '55');
    grd.addColorStop(1, col + '00');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.fillStyle = col;
    if (def.logic) {
      // 逻辑模块：芯片外观
      g.fillStyle = '#1e2a30';
      g.beginPath(); g.rect(14, 14, 36, 36); g.stroke(); g.fill();
      g.fillStyle = '#c8a040';
      for (let i = 0; i < 4; i++) { g.fillRect(18 + i * 8, 8, 4, 6); g.fillRect(18 + i * 8, 50, 4, 6); g.fillRect(8, 18 + i * 8, 6, 4); g.fillRect(50, 18 + i * 8, 6, 4); }
      g.strokeStyle = col; g.lineWidth = 1.5; g.strokeRect(18, 18, 28, 28);
      g.fillStyle = col;
      g.font = 'bold 16px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const lg = def.logic;
      const sym = MODULE_SYM[id] ?? (lg.cast ? `×${lg.cast}` : lg.homing ? '◎' : lg.pierce ? '➤' : lg.blast ? '✸' : lg.speed ? '»' : lg.dmg ? '▲' : lg.focus ? '◇' : '?');
      g.fillText(sym, 32, 33);
      return;
    }
    const shell = () => {
      g.fillStyle = '#c8962a';
      g.beginPath(); g.rect(24, 30, 16, 24); g.stroke(); g.fill();
      g.fillStyle = '#8a6418';
      g.fillRect(24, 50, 16, 4);
      g.fillStyle = col;
      g.beginPath(); g.moveTo(24, 30); g.quadraticCurveTo(32, 6, 40, 30); g.closePath(); g.stroke(); g.fill();
    };
    switch (def.kind) {
      case 'bomb':
        g.beginPath(); g.arc(30, 38, 16, 0, 7); g.fillStyle = '#2a2a2a'; g.stroke(); g.fill();
        g.strokeStyle = '#c8a060'; g.beginPath(); g.moveTo(40, 26); g.quadraticCurveTo(48, 16, 52, 12); g.stroke();
        g.fillStyle = col; g.beginPath(); g.arc(52, 11, 4, 0, 7); g.fill();
        break;
      case 'rocket':
        g.save(); g.translate(32, 32); g.rotate(-0.8);
        g.fillStyle = '#8a8e94'; g.beginPath(); g.rect(-6, -14, 12, 26); g.stroke(); g.fill();
        g.fillStyle = col; g.beginPath(); g.moveTo(-6, -14); g.lineTo(0, -26); g.lineTo(6, -14); g.closePath(); g.stroke(); g.fill();
        g.fillStyle = '#c83a2a'; g.beginPath(); g.moveTo(-6, 6); g.lineTo(-12, 16); g.lineTo(-6, 12); g.fill(); g.beginPath(); g.moveTo(6, 6); g.lineTo(12, 16); g.lineTo(6, 12); g.fill();
        g.fillStyle = '#ffd24a'; g.beginPath(); g.moveTo(-4, 13); g.lineTo(0, 24); g.lineTo(4, 13); g.fill();
        g.restore();
        break;
      case 'saw':
        g.save(); g.translate(32, 32);
        g.fillStyle = '#c8ccd4';
        g.beginPath();
        for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, r = i % 2 ? 18 : 24; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        g.closePath(); g.stroke(); g.fill();
        g.fillStyle = '#3a3a3a'; g.beginPath(); g.arc(0, 0, 5, 0, 7); g.fill();
        g.restore();
        break;
      case 'boomer':
        g.fillStyle = col; g.beginPath(); g.moveTo(10, 46); g.quadraticCurveTo(32, 4, 54, 46); g.lineTo(46, 50); g.quadraticCurveTo(32, 22, 18, 50); g.closePath(); g.stroke(); g.fill();
        break;
      case 'mine':
        g.fillStyle = '#4a4e3a'; g.beginPath(); g.ellipse(32, 38, 22, 11, 0, 0, 7); g.stroke(); g.fill();
        g.fillStyle = col; g.beginPath(); g.arc(32, 34, 5, 0, 7); g.fill();
        break;
      case 'toxic':
        g.fillStyle = col;
        for (const [x, y, r] of [[24, 36, 12], [38, 32, 13], [32, 24, 10], [42, 42, 9]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
        g.fillStyle = '#1a2a0a'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText('☣', 33, 41);
        break;
      case 'singular':
        g.strokeStyle = col; g.lineWidth = 3;
        g.beginPath();
        for (let i = 0; i < 60; i++) { const a = i * 0.3, r = 2 + i * 0.4; g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
        g.stroke();
        g.fillStyle = '#000'; g.beginPath(); g.arc(32, 32, 5, 0, 7); g.fill();
        break;
      case 'split':
        shell();
        g.fillStyle = col;
        for (const [x, y] of [[14, 14], [50, 14], [10, 30], [54, 30]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
        break;
      default:
        if (def.count && def.count > 1 && !def.flags?.ring) {
          for (const [x, y] of [[20, 34], [32, 26], [44, 34], [26, 46], [38, 46]].slice(0, Math.min(5, def.count))) {
            g.fillStyle = col; g.beginPath(); g.arc(x, y, 6, 0, 7); g.stroke(); g.fill();
          }
        } else if (def.flags?.ring) {
          for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.fillStyle = col; g.beginPath(); g.arc(32 + Math.cos(a) * 20, 32 + Math.sin(a) * 20, 3.5, 0, 7); g.fill(); }
          g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 5, 0, 7); g.fill();
        } else if (def.flags?.beam) {
          g.fillStyle = col; g.fillRect(6, 28, 52, 8);
          g.fillStyle = '#fff'; g.fillRect(6, 30, 52, 4);
        } else if (def.flags?.mystery) {
          // 盲盒：系着丝带的礼物盒，中间一个问号
          g.fillStyle = '#c84aa8'; g.beginPath(); g.rect(12, 24, 40, 30); g.stroke(); g.fill();
          g.fillStyle = '#e86ac8'; g.beginPath(); g.rect(9, 16, 46, 10); g.stroke(); g.fill();
          g.fillStyle = '#ffd24a'; g.fillRect(28, 16, 8, 38);
          g.beginPath(); g.ellipse(25, 12, 7, 4, -0.5, 0, 7); g.ellipse(39, 12, 7, 4, 0.5, 0, 7); g.fill();
          g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 3;
          g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.strokeText('?', 32, 41); g.fillText('?', 32, 41);
        } else if (def.flags?.butter) {
          // 玉米粒：一颗金黄的玉米粒，旁边一小块黄油
          g.fillStyle = '#f0f0d0'; g.beginPath(); g.rect(36, 36, 18, 12); g.stroke(); g.fill();
          g.fillStyle = '#fff2a0'; g.fillRect(38, 38, 14, 4);
          g.fillStyle = col; g.beginPath(); g.moveTo(26, 10); g.quadraticCurveTo(42, 14, 38, 34); g.quadraticCurveTo(34, 48, 22, 46); g.quadraticCurveTo(10, 40, 14, 24); g.quadraticCurveTo(16, 12, 26, 10); g.closePath(); g.stroke(); g.fill();
          g.fillStyle = '#fff6c0'; g.beginPath(); g.ellipse(22, 20, 4, 6, -0.4, 0, 7); g.fill();
        } else {
          shell();
          if (def.flags?.chain) { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(46, 6); g.lineTo(38, 22); g.lineTo(46, 22); g.lineTo(36, 40); g.lineTo(50, 18); g.lineTo(42, 18); g.closePath(); g.fill(); }
          if (def.flags?.burn) { g.fillStyle = '#ff6a1a'; g.beginPath(); g.moveTo(12, 30); g.quadraticCurveTo(6, 16, 16, 6); g.quadraticCurveTo(16, 18, 22, 22); g.quadraticCurveTo(22, 30, 12, 30); g.fill(); }
          if (def.flags?.slow) { g.strokeStyle = '#dff6ff'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(14 - Math.cos(a) * 8, 16 - Math.sin(a) * 8); g.lineTo(14 + Math.cos(a) * 8, 16 + Math.sin(a) * 8); g.stroke(); } }
          if (def.flags?.homing) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(48, 16, 8, 0, 7); g.moveTo(48, 6); g.lineTo(48, 26); g.moveTo(38, 16); g.lineTo(58, 16); g.stroke(); }
          if (def.flags?.leech) { g.fillStyle = '#ff2a4a'; g.beginPath(); g.moveTo(14, 6); g.quadraticCurveTo(22, 18, 14, 24); g.quadraticCurveTo(6, 18, 14, 6); g.fill(); }
          if (def.flags?.gold) { g.fillStyle = '#ffd700'; g.beginPath(); g.arc(14, 16, 8, 0, 7); g.fill(); g.fillStyle = '#8a6a00'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillText('$', 14, 20); }
          if (def.flags?.wallBounce) { g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(6, 10); g.lineTo(14, 22); g.lineTo(20, 8); g.stroke(); }
          if (def.id === 'jet') { g.fillStyle = '#6ac8ff'; g.beginPath(); g.moveTo(26, 56); g.lineTo(32, 64); g.lineTo(38, 56); g.fill(); }
          if (def.id === 'sniper') { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(48, 16, 9, 0, 7); g.moveTo(48, 4); g.lineTo(48, 28); g.moveTo(36, 16); g.lineTo(60, 16); g.stroke(); }
          if (def.id === 'light') { g.fillStyle = '#fff'; g.beginPath(); g.moveTo(10, 26); g.quadraticCurveTo(16, 6, 22, 4); g.quadraticCurveTo(18, 18, 10, 26); g.fill(); }
          if (def.id === 'lead') { g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(24, 30, 16, 6); }
        }
    }
  });
  cache.set(key, url);
  return url;
}

export function itemIcon(id: ItemId): string {
  const key = 'i' + id;
  const c = cache.get(key);
  if (c) return c;
  const col = ITEMS[id].color;
  const url = mk(64, 64, (g) => {
    const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grd.addColorStop(0, col + '44');
    grd.addColorStop(1, col + '00');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    const vial = () => {
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.beginPath(); g.rect(22, 14, 20, 40); g.stroke(); g.fill();
      g.fillStyle = col; g.fillRect(24, 26, 16, 26);
      g.fillStyle = '#3a3a3a'; g.beginPath(); g.rect(20, 8, 24, 8); g.stroke(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(26, 28, 3, 20);
    };
    switch (id) {
      case 'jar':
        g.fillStyle = '#c8962a'; g.beginPath(); g.ellipse(32, 38, 20, 18, 0, 0, 7); g.stroke(); g.fill();
        g.fillStyle = '#8a6a2a'; g.beginPath(); g.rect(22, 14, 20, 8); g.stroke(); g.fill();
        g.fillStyle = '#ffe080'; g.font = 'bold 20px sans-serif'; g.textAlign = 'center'; g.fillText('$', 32, 46);
        break;
      case 'serumHp': vial(); g.fillStyle = '#fff'; g.fillRect(29, 33, 6, 14); g.fillRect(25, 37, 14, 6); break;
      case 'serumSpd': vial(); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(26, 44); g.lineTo(32, 32); g.lineTo(38, 44); g.closePath(); g.fill(); break;
      case 'purify': vial(); g.fillStyle = '#1a3a0a'; g.font = 'bold 14px sans-serif'; g.textAlign = 'center'; g.fillText('☢', 32, 45); break;
      case 'part1': case 'part2': {
        g.save(); g.translate(32, 32);
        g.fillStyle = '#8a8e94';
        g.beginPath();
        for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = i % 2 ? 18 : 24; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        g.closePath(); g.stroke(); g.fill();
        g.fillStyle = col; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill();
        g.fillStyle = '#000'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.fillText(id === 'part1' ? '1' : '2', 0, 4);
        g.restore();
        break;
      }
      case 'valuable':
        g.fillStyle = col; g.beginPath(); g.moveTo(32, 8); g.lineTo(52, 26); g.lineTo(32, 56); g.lineTo(12, 26); g.closePath(); g.stroke(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.moveTo(32, 8); g.lineTo(40, 26); g.lineTo(24, 26); g.closePath(); g.fill();
        break;
      case 'milkgold': {
        // 第4次调整：防暴盾牌，中间一颗星星
        g.fillStyle = '#e8eef4';
        g.beginPath();
        g.moveTo(14, 10); g.lineTo(50, 10); g.lineTo(50, 34);
        g.quadraticCurveTo(50, 50, 32, 58); g.quadraticCurveTo(14, 50, 14, 34); g.closePath();
        g.stroke(); g.fill();
        g.strokeStyle = '#8a96a4'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(18, 14); g.lineTo(46, 14); g.lineTo(46, 33); g.quadraticCurveTo(46, 46, 32, 53); g.quadraticCurveTo(18, 46, 18, 33); g.closePath(); g.stroke();
        g.fillStyle = 'rgba(80,110,140,0.35)'; g.fillRect(20, 16, 24, 6); // 观察窗
        g.fillStyle = '#ffd24a'; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.5;
        g.beginPath();
        for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4.5 : 11; g.lineTo(32 + Math.cos(a) * r, 35 + Math.sin(a) * r); }
        g.closePath(); g.fill(); g.stroke();
        break;
      }
      case 'overheat':
        g.fillStyle = '#2a2a2a'; g.beginPath(); g.rect(14, 14, 36, 36); g.stroke(); g.fill();
        g.fillStyle = col; g.fillRect(22, 22, 20, 20);
        g.fillStyle = '#c8a040'; for (let i = 0; i < 4; i++) { g.fillRect(16 + i * 9, 8, 4, 6); g.fillRect(16 + i * 9, 50, 4, 6); }
        break;
      case 'painkiller':
        g.fillStyle = '#f0f0f0'; g.beginPath(); g.rect(20, 20, 24, 34); g.stroke(); g.fill();
        g.fillStyle = '#d82a2a'; g.beginPath(); g.rect(18, 12, 28, 10); g.stroke(); g.fill();
        g.fillStyle = '#d82a2a'; g.fillRect(29, 30, 6, 16); g.fillRect(24, 35, 16, 6);
        break;
      case 'kungfu':
        g.fillStyle = '#1a1a1a'; g.beginPath(); g.moveTo(10, 44); g.lineTo(10, 30); g.lineTo(28, 26); g.lineTo(36, 34); g.lineTo(54, 38); g.lineTo(54, 46); g.closePath(); g.stroke(); g.fill();
        g.fillStyle = '#eee'; g.fillRect(10, 44, 44, 5);
        break;
      case 'eel':
        g.strokeStyle = '#2a4a7a'; g.lineWidth = 9; g.lineCap = 'round';
        g.beginPath(); g.moveTo(8, 40); g.bezierCurveTo(20, 16, 34, 52, 56, 24); g.stroke();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(54, 24, 2, 0, 7); g.fill();
        break;
      case 'gun':
        g.fillStyle = '#888'; g.fillRect(10, 26, 44, 10);
        break;
    }
  });
  cache.set(key, url);
  return url;
}

export function goldIcon(): string {
  const c = cache.get('gold');
  if (c) return c;
  const url = mk(64, 64, (g) => {
    for (const [x, y] of [[24, 40], [40, 40], [32, 28]]) {
      g.fillStyle = '#ffc83a'; g.strokeStyle = '#7a5000'; g.lineWidth = 2.5;
      g.beginPath(); g.ellipse(x, y, 12, 8, 0, 0, 7); g.stroke(); g.fill();
      g.fillStyle = '#ffe9a0'; g.beginPath(); g.ellipse(x - 2, y - 2, 5, 3, 0, 0, 7); g.fill();
    }
  });
  cache.set('gold', url);
  return url;
}

/** 带缓存的图标（图鉴与奇物的图标见 art.ts） */
export function cachedIcon(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): string {
  const c = cache.get(key);
  if (c) return c;
  const url = mk(w, h, draw);
  cache.set(key, url);
  return url;
}
