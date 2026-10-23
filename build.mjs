// 构建脚本：把 src/ 打包成单个 IIFE 脚本（可直接用 file:// 打开），并生成单文件版 HTML。
// 像素字体在构建时按游戏里实际用到的字符裁剪，以 base64 内嵌进页面，保证离线可用且体积很小。
// 字体文件 assets/fonts/pixel4056.ttf 由 tools/merge-font.py 生成：汉字 = 缝合像素字体 Fusion Pixel 12px（OFL），
// 数字与英文 = NoitaPixel（第3次调整）。
// v4.3.7：src/audio 下以编号开头的 mp3（如“0.The Hills.mp3”）以 base64 写进 dist/audio.js（window.__AUDIO4056__），
// 单文件版 HTML 直接内嵌；没有这些文件时不生成，游戏里对应的音乐与音效会被跳过。
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';

const watch = process.argv.includes('--watch');
const outDir = 'dist';
// 公开仓库里没有 NoitaPixel（版权属于 Nolla Games，没有开源协议），这时退回只用 Fusion Pixel（数字与英文也是 Fusion 的字形）
const FONT_CANDIDATES = ['assets/fonts/pixel4056.ttf', 'assets/fonts/fusion-pixel-12px-proportional-zh_hans.ttf'];
const FONT_SRC = FONT_CANDIDATES.find((f) => fs.existsSync(f)) ?? FONT_CANDIDATES[0];
const FONT_FAMILY = 'Pixel4056';
fs.mkdirSync(outDir, { recursive: true });

const htmlTemplate = (scriptTag, fontCss) => `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>末日4056</title>
<style>${fontCss}html,body{margin:0;height:100%;background:#07090a;overflow:hidden}</style>
</head>
<body>
<div id="app"></div>
${scriptTag}
</body>
</html>
`;

/** 收集源码里出现过的所有字符（界面文字都写在源码里），再加上 ASCII 与常用标点 */
function collectChars() {
  const set = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|css)$/.test(e.name)) for (const ch of fs.readFileSync(p, 'utf8')) if (ch.codePointAt(0) >= 0x20) set.add(ch);
    }
  };
  walk('src');
  for (let c = 0x20; c < 0x7f; c++) set.add(String.fromCharCode(c));
  for (const ch of '，。、：；！？（）【】《》「」“”‘’…—～·×÷±→←↑↓％＋－　0123456789') set.add(ch);
  return [...set].sort().join('');
}

const fontCache = { key: '', css: '' };
async function fontCss() {
  if (!fs.existsSync(FONT_SRC)) { console.warn('[build] font not found, using system fonts'); return ''; }
  const chars = collectChars();
  if (chars === fontCache.key) return fontCache.css;
  const buf = await subsetFont(fs.readFileSync(FONT_SRC), chars, { targetFormat: 'woff2' });
  fontCache.key = chars;
  fontCache.css = `@font-face{font-family:"${FONT_FAMILY}";src:url(data:font/woff2;base64,${buf.toString('base64')}) format("woff2");font-display:block}`;
  console.log(`[build] pixel font subset (${path.basename(FONT_SRC)}): ${chars.length} chars, ${(buf.length / 1024).toFixed(0)} KB`);
  return fontCache.css;
}

const AUDIO_DIR = 'src/audio';
const audioCache = { key: '', js: '' };
/** 音频文件：{ 编号: base64 }，按文件名与修改时间缓存 */
function audioJs() {
  if (!fs.existsSync(AUDIO_DIR)) return '';
  const files = fs.readdirSync(AUDIO_DIR).filter((f) => /^\d+\..*\.mp3$/i.test(f));
  const key = files.map((f) => `${f}:${fs.statSync(path.join(AUDIO_DIR, f)).mtimeMs}`).join('|');
  if (key === audioCache.key) return audioCache.js;
  const map = {};
  let bytes = 0;
  for (const f of files) {
    const buf = fs.readFileSync(path.join(AUDIO_DIR, f));
    map[parseInt(f, 10)] = buf.toString('base64');
    bytes += buf.length;
  }
  audioCache.key = key;
  audioCache.js = files.length ? `window.__AUDIO4056__=${JSON.stringify(map)};` : '';
  if (files.length) console.log(`[build] audio clips: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB`);
  return audioCache.js;
}

async function writeHtml() {
  const css = await fontCss();
  const audio = audioJs();
  const audioFile = path.join(outDir, 'audio.js');
  if (audio) fs.writeFileSync(audioFile, audio);
  else if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
  fs.writeFileSync(path.join(outDir, 'index.html'), htmlTemplate(`${audio ? '<script src="audio.js"></script>\n' : ''}<script src="game.js"></script>`, css));
  const js = fs.readFileSync(path.join(outDir, 'game.js'), 'utf8').replace(/<\/script/g, '<\/script');
  fs.writeFileSync(path.join(outDir, 'Game4056.html'), htmlTemplate(`${audio ? `<script>${audio}</script>\n` : ''}<script>\n${js}\n</script>`, css));
}

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: path.join(outDir, 'game.js'),
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  loader: { '.css': 'text' },
  logLevel: 'info',
  plugins: [{
    name: 'html',
    setup(build) {
      build.onEnd(async (r) => { if (r.errors.length === 0) { await writeHtml(); console.log('[build] html written'); } });
    },
  }],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[build] watching...');
} else {
  await esbuild.build(options);
}
