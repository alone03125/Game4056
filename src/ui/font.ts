// 界面字体：像素字体（缝合像素字体 Fusion Pixel Font，由 build.mjs 按需裁剪后内嵌），缺字时回退到系统字体。
// 像素字体的设计尺寸是 12px，字号取 12 的倍数时最清晰。

export const PIXEL_FONT = '"Pixel4056", "Microsoft YaHei", "PingFang SC", sans-serif';

/** 让画布在字体加载完成后再绘制文字（字体以 data URL 内嵌，几乎瞬间完成） */
export function preloadFont(): void {
  try { void document.fonts?.load(`12px ${PIXEL_FONT}`); } catch { /* */ }
}
