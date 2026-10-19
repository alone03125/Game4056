// 入口
import { App } from './app';
import { preloadFont } from './ui/font';

declare global {
  interface Window { __game?: unknown }
}

function boot(): void {
  preloadFont();
  const root = document.getElementById('app')!;
  try {
    new App(root);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div style="color:#eee;font-family:sans-serif;padding:40px;max-width:640px;margin:auto;line-height:1.7">
      <h2>游戏启动失败</h2><p>你的浏览器可能不支持 WebGL，或显卡驱动被禁用。请使用最新版 Chrome / Edge，并确认已开启硬件加速。</p>
      <pre style="color:#f88;white-space:pre-wrap">${String(err)}</pre></div>`;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
