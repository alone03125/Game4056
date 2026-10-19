// 设置与本地记录（localStorage，读写均容错）。

import { Difficulty } from '../config';

/** 第2版：可以自定义的按键 */
export type KeyAction = 'interact' | 'bag' | 'reload' | 'autoL' | 'autoR' | 'item1' | 'item2' | 'item3' | 'item4' | 'item5' | 'item6' | 'item7';
export const KEY_ACTIONS: KeyAction[] = ['interact', 'bag', 'reload', 'autoL', 'autoR', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6', 'item7'];
export const DEFAULT_KEYS: Record<KeyAction, string> = {
  interact: 'KeyF', bag: 'Tab', reload: 'KeyR', autoL: 'KeyQ', autoR: 'KeyE',
  item1: 'Digit1', item2: 'Digit2', item3: 'Digit3', item4: 'Digit4', item5: 'Digit5', item6: 'Digit6', item7: 'Digit7',
};

/** 按键代码 → 显示名 */
export function keyLabel(code: string): string {
  if (!code) return '未设置';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return '小键盘' + code.slice(6);
  const map: Record<string, string> = {
    Tab: 'TAB', Space: '空格', ShiftLeft: '左Shift', ShiftRight: '右Shift', ControlLeft: '左Ctrl', ControlRight: '右Ctrl',
    AltLeft: '左Alt', AltRight: '右Alt', CapsLock: 'Caps', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Enter: '回车', Backspace: '退格',
  };
  return map[code] ?? code;
}

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  quality: 0 | 1 | 2;
  shake: boolean;
  damageNumbers: boolean;
  showFps: boolean;
  zoom: number; // 80~130
  hints: boolean;
  autoPause: boolean;
  muteOnBlur: boolean; // 第4次调整：窗口失去焦点时自动静音
  difficulty: Difficulty;
  brightness: number; // 第2版：场景整体亮度 50~150%
  keys: Record<KeyAction, string>; // 第2版：键位
  playerName: string; // 联机名字
}

export const DEFAULT_SETTINGS: Settings = {
  master: 80,
  music: 55,
  sfx: 80,
  quality: 2,
  shake: true,
  damageNumbers: true,
  showFps: false,
  zoom: 100,
  hints: true,
  autoPause: true,
  muteOnBlur: true,
  difficulty: 'normal',
  brightness: 100,
  keys: { ...DEFAULT_KEYS },
  playerName: '',
};

const KEY = 'g4056.settings.v1';
const REC = 'g4056.records.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as Settings;
      s.keys = { ...DEFAULT_KEYS, ...(s.keys ?? {}) };
      return s;
    }
  } catch { /* 无痕模式等 */ }
  return { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_KEYS } };
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* */ }
}

export interface Records {
  runs: number;
  wins: number;
  bestZone: number;
  trueWins?: number; // 第3次调整：击败曼巴僵尸的次数
  bestTime: number; // 通关最快时间（秒），0 表示无
  totalKills: number;
  bestKills: number;
}

export function loadRecords(): Records {
  const d: Records = { runs: 0, wins: 0, bestZone: 0, bestTime: 0, totalKills: 0, bestKills: 0 };
  try {
    const raw = localStorage.getItem(REC);
    if (raw) return { ...d, ...JSON.parse(raw) };
  } catch { /* */ }
  return d;
}

export function saveRecords(r: Records): void {
  try { localStorage.setItem(REC, JSON.stringify(r)); } catch { /* */ }
}
