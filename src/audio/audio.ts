// 音频：全部使用 WebAudio 实时合成（不依赖音频文件）。包含音效与程序化音乐。

import type { SoundName } from '../game/fx';
import type { ShotSfx } from '../data/bullets';

type Ctx = AudioContext;

export class AudioEngine {
  ctx: Ctx | null = null;
  master!: GainNode;
  sfx!: GainNode;
  musicBus!: GainNode;
  noiseBuf!: AudioBuffer;
  private last = new Map<string, number>();
  private active = 0;
  listenerX = 0;
  listenerY = 0;
  volumes = { master: 0.8, music: 0.55, sfx: 0.8 };
  music: Music | null = null;
  private geigerT = 0;
  private heartT = 0;

  /** 必须在用户手势中调用 */
  init(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx: Ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(comp);
    comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.music = new Music(this);
  }

  private muted = false;

  /** 失焦静音：淡出 / 淡入总音量（不改变音量设置） */
  setMuted(m: boolean): void {
    this.muted = m;
    if (!this.ctx) return;
    const g = this.master.gain;
    g.cancelScheduledValues(this.ctx.currentTime);
    g.setTargetAtTime(m ? 0 : this.volumes.master, this.ctx.currentTime, 0.08);
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : this.volumes.master;
    this.sfx.gain.value = this.volumes.sfx;
    this.musicBus.gain.value = this.volumes.music * 0.55;
  }

  get t(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private throttle(key: string, minGap: number): boolean {
    const now = performance.now();
    const l = this.last.get(key) ?? 0;
    if (now - l < minGap * 1000) return false;
    this.last.set(key, now);
    return true;
  }

  /** 距离衰减与立体声 */
  private spatial(x?: number, y?: number): { vol: number; pan: number } {
    if (x === undefined || y === undefined) return { vol: 1, pan: 0 };
    const dx = x - this.listenerX, dy = y - this.listenerY;
    const d = Math.hypot(dx, dy);
    const vol = Math.max(0, 1 - d / 34);
    return { vol: vol * vol, pan: Math.max(-0.8, Math.min(0.8, dx / 18)) };
  }

  private out(vol: number, pan: number): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfx);
    } else g.connect(this.sfx);
    this.active++;
    setTimeout(() => { this.active--; try { g.disconnect(); } catch { /* */ } }, 2500);
    return g;
  }

  private noise(dest: AudioNode, t: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, q = 1): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, dur: number, vol: number, type: OscillatorType, f0: number, f1: number, attack = 0.002): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot(kind: ShotSfx, hand: number, atk: number): void {
    if (!this.ctx || this.active > 60) return;
    if (!this.throttle('shot' + hand + kind, 0.035)) return;
    this.shotSound(kind, 0.5, hand === 0 ? 0.15 : -0.15, atk);
  }

  /** 第2版联机：队友开火，带距离衰减与立体声 */
  remoteShot(kind: ShotSfx, x: number, y: number, atk: number): void {
    if (!this.ctx || this.active > 50) return;
    const sp = this.spatial(x, y);
    if (sp.vol < 0.03 || !this.throttle('rshot' + kind, 0.05)) return;
    this.shotSound(kind, 0.38 * sp.vol, sp.pan, atk);
  }

  private shotSound(kind: ShotSfx, vol: number, pan: number, atk: number): void {
    const t = this.t;
    const heavy = Math.min(1, atk / 200);
    const o = this.out(vol, pan);
    switch (kind) {
      case 'pistol':
        this.noise(o, t, 0.09, 0.55, 'bandpass', 2600 - heavy * 1200, 700, 0.8);
        this.tone(o, t, 0.07, 0.3, 'square', 420 - heavy * 150, 90);
        break;
      case 'heavy':
        this.noise(o, t, 0.22, 0.7, 'lowpass', 2400, 200, 0.7);
        this.tone(o, t, 0.18, 0.55, 'sawtooth', 160, 40);
        break;
      case 'shotgun':
        this.noise(o, t, 0.28, 0.8, 'lowpass', 3800, 300, 0.5);
        this.tone(o, t, 0.12, 0.45, 'triangle', 120, 45);
        break;
      case 'laser':
        this.tone(o, t, 0.12, 0.22, 'sawtooth', 1800, 300);
        this.tone(o, t, 0.1, 0.2, 'sine', 2400, 900);
        break;
      case 'zap':
        this.tone(o, t, 0.1, 0.22, 'square', 900 + Math.random() * 300, 1500);
        this.noise(o, t, 0.06, 0.25, 'highpass', 4000, 6000);
        break;
      case 'launcher':
        this.noise(o, t, 0.4, 0.6, 'bandpass', 800, 200, 0.6);
        this.tone(o, t, 0.25, 0.6, 'sine', 140, 50);
        break;
      case 'thump':
        this.tone(o, t, 0.15, 0.6, 'sine', 180, 60);
        this.noise(o, t, 0.08, 0.3, 'lowpass', 1200, 300);
        break;
      case 'saw':
        this.tone(o, t, 0.18, 0.18, 'sawtooth', 600, 1400);
        this.noise(o, t, 0.12, 0.25, 'highpass', 3000, 5000);
        break;
      case 'magic':
        this.tone(o, t, 0.6, 0.35, 'sine', 220, 55, 0.05);
        this.tone(o, t, 0.6, 0.2, 'triangle', 330, 82, 0.05);
        break;
    }
  }

  play(name: SoundName, x?: number, y?: number, vol = 1): void {
    if (!this.ctx) return;
    const sp = this.spatial(x, y);
    const v = vol * sp.vol;
    if (v < 0.02) return;
    const gaps: Partial<Record<SoundName, number>> = {
      hit: 0.03, kill: 0.04, coin: 0.05, groan: 0.4, step: 0.2, ricochet: 0.08, drop: 0.08, smallExplosion: 0.05, explosion: 0.06,
      splat: 0.08, spit: 0.15, zap: 0.06, hurt: 0.1, reload: 0.08, hover: 0.04,
    };
    if (!this.throttle(name, gaps[name] ?? 0.02)) return;
    if (this.active > 70 && name !== 'hurt' && name !== 'explosion') return;
    const t = this.t;
    const o = this.out(v, sp.pan);
    switch (name) {
      case 'hit': this.noise(o, t, 0.05, 0.35, 'bandpass', 1800, 900, 2); this.tone(o, t, 0.04, 0.15, 'square', 240, 120); break;
      case 'kill': this.noise(o, t, 0.16, 0.5, 'lowpass', 900, 120, 1); this.tone(o, t, 0.12, 0.3, 'sine', 110, 40); break;
      case 'coin': {
        const f = 1400 + Math.random() * 400;
        this.tone(o, t, 0.09, 0.18, 'square', f, f);
        this.tone(o, t + 0.05, 0.14, 0.15, 'square', f * 1.5, f * 1.5);
        break;
      }
      case 'pickup': this.tone(o, t, 0.08, 0.3, 'triangle', 660, 660); this.tone(o, t + 0.07, 0.12, 0.3, 'triangle', 990, 990); break;
      case 'pickupBig':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(o, t + i * 0.06, 0.18, 0.28, 'triangle', f, f));
        break;
      case 'buff':
        [440, 554, 659, 880].forEach((f, i) => this.tone(o, t + i * 0.05, 0.25, 0.22, 'sine', f, f * 1.01));
        this.noise(o, t, 0.4, 0.15, 'highpass', 3000, 8000);
        break;
      case 'heal': [392, 523, 659].forEach((f, i) => this.tone(o, t + i * 0.08, 0.3, 0.25, 'sine', f, f)); break;
      case 'hurt': this.tone(o, t, 0.18, 0.5, 'sawtooth', 220, 70); this.noise(o, t, 0.12, 0.4, 'lowpass', 1500, 200); break;
      case 'explosion':
        this.noise(o, t, 0.9, 1.0, 'lowpass', 3000, 60, 0.7);
        this.tone(o, t, 0.6, 0.9, 'sine', 90, 28);
        this.noise(o, t, 0.15, 0.5, 'highpass', 2000, 800);
        break;
      case 'smallExplosion': this.noise(o, t, 0.45, 0.7, 'lowpass', 2500, 100, 0.7); this.tone(o, t, 0.3, 0.5, 'sine', 120, 40); break;
      case 'reload':
        this.noise(o, t, 0.03, 0.3, 'bandpass', 3000, 2500, 4);
        this.noise(o, t + 0.09, 0.04, 0.35, 'bandpass', 2000, 1800, 4);
        break;
      case 'spit': this.noise(o, t, 0.2, 0.4, 'bandpass', 600, 1800, 3); break;
      case 'splat': this.noise(o, t, 0.18, 0.45, 'lowpass', 900, 200, 2); break;
      case 'door':
        this.noise(o, t, 1.2, 0.5, 'lowpass', 300, 120, 1);
        this.tone(o, t, 1.2, 0.2, 'sawtooth', 55, 50, 0.1);
        this.tone(o, t + 1.1, 0.2, 0.4, 'square', 90, 40);
        break;
      case 'beep': this.tone(o, t, 0.12, 0.3, 'square', 880, 880); break;
      case 'beepHigh': this.tone(o, t, 0.25, 0.3, 'square', 1320, 1320); break;
      case 'countdown': this.tone(o, t, 0.12, 0.3, 'square', 660, 660); break;
      case 'bossRoar':
        this.noise(o, t, 1.6, 0.8, 'bandpass', 300, 120, 1.5);
        this.tone(o, t, 1.5, 0.5, 'sawtooth', 90, 45, 0.15);
        this.tone(o, t, 1.5, 0.3, 'sawtooth', 93, 47, 0.15);
        break;
      case 'bossDash': this.noise(o, t, 0.7, 0.7, 'bandpass', 400, 1600, 1); break;
      case 'bossThrow': this.noise(o, t, 0.4, 0.5, 'bandpass', 500, 1200, 1); this.tone(o, t, 0.3, 0.3, 'sine', 200, 100); break;
      case 'bossLaser':
        // 激光：持续的高频嗡鸣 + 低频共振
        this.tone(o, t, 4.2, 0.22, 'sawtooth', 880, 980, 0.3);
        this.tone(o, t, 4.2, 0.18, 'square', 110, 120, 0.3);
        this.noise(o, t, 0.6, 0.4, 'highpass', 4000, 2000, 1);
        break;
      case 'fuse': this.noise(o, t, 1.9, 0.45, 'highpass', 3500, 5200, 0.2); this.noise(o, t, 1.9, 0.2, 'bandpass', 900, 1400, 2); break;
      case 'bossWave': this.noise(o, t, 0.9, 0.9, 'lowpass', 2200, 60, 0.8); this.tone(o, t, 0.6, 0.8, 'sine', 90, 30); this.tone(o, t, 0.3, 0.4, 'square', 300, 60); break;
      case 'bossSlam': this.noise(o, t, 0.7, 0.9, 'lowpass', 1500, 50, 0.8); this.tone(o, t, 0.5, 0.8, 'sine', 70, 25); break;
      case 'zap': this.tone(o, t, 0.08, 0.2, 'square', 1200 + Math.random() * 800, 600); this.noise(o, t, 0.08, 0.2, 'highpass', 5000, 3000); break;
      case 'empty': this.tone(o, t, 0.05, 0.2, 'square', 300, 300); break;
      case 'denied': this.tone(o, t, 0.12, 0.25, 'square', 200, 200); this.tone(o, t + 0.12, 0.16, 0.25, 'square', 150, 150); break;
      case 'buy': [784, 1046, 1318].forEach((f, i) => this.tone(o, t + i * 0.05, 0.18, 0.22, 'square', f, f)); break;
      case 'altar':
        [262, 330, 392, 523, 659].forEach((f, i) => this.tone(o, t + i * 0.07, 0.6, 0.2, 'sine', f, f));
        this.noise(o, t, 0.8, 0.15, 'highpass', 5000, 9000);
        break;
      case 'groan': {
        const ctx = this.ctx;
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        const f = 70 + Math.random() * 50;
        osc.frequency.setValueAtTime(f, t);
        osc.frequency.linearRampToValueAtTime(f * (0.7 + Math.random() * 0.2), t + 0.9);
        const flt = ctx.createBiquadFilter();
        flt.type = 'bandpass';
        flt.frequency.value = 500 + Math.random() * 300;
        flt.Q.value = 4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.15);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
        osc.connect(flt); flt.connect(g); g.connect(o);
        osc.start(t); osc.stop(t + 1.05);
        break;
      }
      case 'step': this.noise(o, t, 0.05, 0.12, 'lowpass', 600, 200); break;
      case 'ricochet': this.tone(o, t, 0.15, 0.12, 'sine', 2400, 3600); break;
      case 'drop': this.noise(o, t, 0.08, 0.3, 'lowpass', 900, 300); this.tone(o, t, 0.06, 0.2, 'triangle', 300, 200); break;
      case 'mineArm': this.tone(o, t, 0.05, 0.15, 'square', 1800, 1800); break;
      case 'vortex': this.tone(o, t, 1.2, 0.35, 'sine', 60, 160, 0.3); this.noise(o, t, 1.0, 0.3, 'bandpass', 200, 800, 3); break;
      case 'victory': [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.tone(o, t + i * 0.13, 0.4, 0.25, 'triangle', f, f)); break;
      case 'death': [330, 294, 247, 196, 147].forEach((f, i) => this.tone(o, t + i * 0.18, 0.5, 0.3, 'triangle', f, f * 0.98)); break;
      case 'click': this.tone(o, t, 0.04, 0.18, 'square', 1200, 900); break;
      case 'hover': this.tone(o, t, 0.025, 0.06, 'sine', 1800, 1800); break;
    }
  }

  /** 每帧：盖革计数器、低血量心跳 */
  ambience(dt: number, radLevel: number, radFrac: number, hpFrac: number, active: boolean): void {
    if (!this.ctx || !active) return;
    const rate = radLevel === 0 ? 0.6 + radFrac * 3 : radLevel === 1 ? 6 : radLevel === 2 ? 14 : 30;
    this.geigerT -= dt;
    if (this.geigerT <= 0) {
      this.geigerT = (-Math.log(Math.random() + 1e-6) / rate);
      const t = this.t;
      const o = this.out(0.12 + radLevel * 0.06, (Math.random() - 0.5) * 0.4);
      this.noise(o, t, 0.012, 0.8, 'highpass', 3000, 3000);
    }
    if (hpFrac < 0.3) {
      this.heartT -= dt;
      if (this.heartT <= 0) {
        this.heartT = 0.75 + hpFrac;
        const t = this.t;
        const o = this.out(0.5, 0);
        this.tone(o, t, 0.12, 0.6, 'sine', 70, 40);
        this.tone(o, t + 0.18, 0.12, 0.45, 'sine', 65, 38);
      }
    }
  }
}

// —— 程序化音乐 ——

export type TrackName = 'menu' | 'explore' | 'safe' | 'boss' | 'none';

interface TrackDef {
  bpm: number;
  root: number; // MIDI
  chords: number[][]; // 每小节的和弦（相对根音的半音）
  kick?: string;
  snare?: string;
  hat?: string;
  bass?: string; // 'r' 根音 'f' 五度 'o' 八度 '.' 休止
  arp?: string; // 'x' 触发
  pad: boolean;
  bell?: (number | null)[]; // 每 16 分音符的旋律音（相对根音），null 休止
  tom?: string;
  bassType?: OscillatorType;
  padCut?: number;
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function exploreTrack(zone: number): TrackDef {
  const z = Math.max(1, Math.min(4, zone));
  return {
    bpm: 96 + z * 8,
    root: 45 - (z % 2) * 2,
    chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]],
    kick: z >= 3 ? 'x...x...x...x.x.' : 'x.......x.......',
    snare: z >= 2 ? '....x.......x...' : '........x.......',
    hat: z >= 3 ? 'x.xxx.xxx.xxx.xx' : z >= 2 ? 'x.x.x.x.x.x.x.x.' : '..x...x...x...x.',
    bass: z >= 2 ? 'r.r.f.r.r.r.o.f.' : 'r.......r...f...',
    arp: z >= 2 ? 'x.xxx.xxx.xxx.xx' : undefined,
    pad: true,
    bassType: 'sawtooth',
    padCut: 600 + z * 200,
  };
}

const TRACKS: Record<Exclude<TrackName, 'explore' | 'none'>, TrackDef> = {
  menu: {
    bpm: 68, root: 45, chords: [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-5, -1, 2]], pad: true,
    bell: [12, null, null, null, 15, null, 14, null, 10, null, null, null, 7, null, null, null],
    hat: '........x.......', padCut: 900,
  },
  safe: {
    bpm: 76, root: 48, chords: [[0, 4, 7, 11], [-3, 0, 4, 7], [5, 9, 12, 16], [7, 11, 14, 17]], pad: true,
    arp: 'x.x.x.x.x.x.x.x.', bass: 'r.......f.......', bassType: 'triangle', padCut: 1400,
  },
  boss: {
    bpm: 146, root: 38, chords: [[0, 3, 7], [1, 5, 8], [-2, 1, 5], [-4, 0, 3]], pad: true,
    kick: 'x...x...x...x...', snare: '....x.......x..x', hat: 'xxxxxxxxxxxxxxxx', bass: 'rrrorrfrrrorrfro',
    tom: '..............xx', arp: 'x.x.x.x.x.x.x.x.', bassType: 'sawtooth', padCut: 1600,
  },
};

class Music {
  private a: AudioEngine;
  private out: GainNode;
  private track: TrackDef | null = null;
  private name: TrackName = 'none';
  private zone = 1;
  private nextT = 0;
  private step = 0;
  private timer: number;
  private gainNode: GainNode | null = null;

  constructor(a: AudioEngine) {
    this.a = a;
    this.out = a.ctx!.createGain();
    this.out.connect(a.musicBus);
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  play(name: TrackName, zone = 1): void {
    if (name === this.name && (name !== 'explore' || zone === this.zone)) return;
    const ctx = this.a.ctx!;
    const now = ctx.currentTime;
    // 淡出旧轨
    if (this.gainNode) {
      const g = this.gainNode;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0, now + 1.2);
      setTimeout(() => { try { g.disconnect(); } catch { /* */ } }, 1500);
      this.gainNode = null;
    }
    this.name = name;
    this.zone = zone;
    if (name === 'none') { this.track = null; return; }
    this.track = name === 'explore' ? exploreTrack(zone) : TRACKS[name];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + 1.5);
    g.connect(this.out);
    this.gainNode = g;
    this.nextT = now + 0.1;
    this.step = 0;
  }

  stinger(kind: 'victory' | 'death'): void {
    this.play('none');
    this.a.play(kind);
  }

  private tick(): void {
    const ctx = this.a.ctx;
    if (!ctx || !this.track || !this.gainNode || ctx.state !== 'running') return;
    const tr = this.track;
    const stepDur = 60 / tr.bpm / 4;
    while (this.nextT < ctx.currentTime + 0.12) {
      this.schedule(tr, this.step, this.nextT, stepDur, this.gainNode);
      this.nextT += stepDur;
      this.step++;
    }
  }

  private schedule(tr: TrackDef, step: number, t: number, sd: number, dest: AudioNode): void {
    const ctx = this.a.ctx!;
    const s = step % 16;
    const bar = Math.floor(step / 16) % tr.chords.length;
    const chord = tr.chords[bar];
    const root = tr.root + chord[0];
    const ch = (p?: string) => p && p[s] !== '.';
    if (ch(tr.kick)) this.kick(dest, t);
    if (ch(tr.snare)) this.snare(dest, t);
    if (ch(tr.hat)) this.hat(dest, t, s % 4 === 0 ? 0.09 : 0.05);
    if (ch(tr.tom)) this.tomHit(dest, t, s);
    if (tr.bass && tr.bass[s] !== '.') {
      const c = tr.bass[s];
      const n = c === 'f' ? root + 7 : c === 'o' ? root + 12 : root;
      this.bass(dest, t, sd * 1.8, mtof(n - 12), tr.bassType ?? 'sawtooth');
    }
    if (tr.pad && s === 0) {
      for (const iv of chord) this.pad(dest, t, sd * 16, mtof(tr.root + iv), tr.padCut ?? 900);
    }
    if (tr.arp && tr.arp[s] !== '.') {
      const notes = chord.concat(chord.map((c) => c + 12));
      const n = tr.root + 12 + notes[(step * 3 + Math.floor(step / 4)) % notes.length];
      this.pluck(dest, t, sd * 1.5, mtof(n));
    }
    if (tr.bell) {
      const n = tr.bell[s];
      if (n !== null && n !== undefined && Math.floor(step / 16) % 2 === 0) this.bell(dest, t, mtof(tr.root + 12 + n));
    }
    void ctx;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private kick(dest: AudioNode, t: number): void {
    const ctx = this.a.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.9, 0.25);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.3);
  }

  private snare(dest: AudioNode, t: number): void {
    const ctx = this.a.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.a.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.45, 0.16);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random()); src.stop(t + 0.2);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.08);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.002, 0.3, 0.08);
    o.connect(g2); g2.connect(dest);
    o.start(t); o.stop(t + 0.12);
  }

  private hat(dest: AudioNode, t: number, v: number): void {
    const ctx = this.a.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.a.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain();
    this.env(g, t, 0.001, v, 0.04);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random()); src.stop(t + 0.06);
  }

  private tomHit(dest: AudioNode, t: number, s: number): void {
    const ctx = this.a.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(s % 2 ? 130 : 170, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.2);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.5, 0.22);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + 0.3);
  }

  private bass(dest: AudioNode, t: number, dur: number, f: number, type: OscillatorType): void {
    const ctx = this.a.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 6;
    flt.frequency.setValueAtTime(900, t);
    flt.frequency.exponentialRampToValueAtTime(140, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.005, 0.32, dur);
    o.connect(flt); flt.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private pad(dest: AudioNode, t: number, dur: number, f: number, cut: number): void {
    const ctx = this.a.ctx!;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = cut;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.02);
    flt.connect(g); g.connect(dest);
    for (const det of [-8, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(flt);
      o.start(t); o.stop(t + dur * 1.05);
    }
  }

  private pluck(dest: AudioNode, t: number, dur: number, f: number): void {
    const ctx = this.a.ctx!;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(3000, t);
    flt.frequency.exponentialRampToValueAtTime(400, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.06, dur);
    o.connect(flt); flt.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private bell(dest: AudioNode, t: number, f: number): void {
    const ctx = this.a.ctx!;
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 3.5;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(f * 1.5, t);
    mg.gain.exponentialRampToValueAtTime(1, t + 1.5);
    mod.connect(mg); mg.connect(car.frequency);
    const g = ctx.createGain();
    this.env(g, t, 0.005, 0.12, 2.2);
    car.connect(g); g.connect(dest);
    car.start(t); mod.start(t);
    car.stop(t + 2.4); mod.stop(t + 2.4);
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}

export type { Music };
