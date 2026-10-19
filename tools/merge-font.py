# 生成游戏用的像素字体 assets/fonts/pixel4056.ttf：
#   中文与其他字符 = 缝合像素字体 Fusion Pixel 12px（OFL 1.1，assets/fonts/fusion-pixel-12px-proportional-zh_hans.ttf）
#   数字、英文字母与 ASCII 符号 = NoitaPixel（assets/fonts/NoitaPixel.ttf，第3次调整由策划提供；版权属于 Nolla Games，不随公开仓库发布）
#
# NoitaPixel 的 1 个像素放大为 Fusion 的 2 个像素（字号 12px 时 = 2 个屏幕像素），所有坐标对齐到像素网格，
# 并整体下移 1 个 Fusion 像素，让数字和汉字的视觉中心对齐。12 的整数倍字号下两种字形都保持清晰。
#
# 用法（需要 Python 与 fontTools）：python tools/merge-font.py
# 构建（npm run build）只读取生成好的 pixel4056.ttf，不需要 Python。

import os
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUSION = os.path.join(ROOT, 'assets', 'fonts', 'fusion-pixel-12px-proportional-zh_hans.ttf')
NOITA = os.path.join(ROOT, 'assets', 'fonts', 'NoitaPixel.ttf')
OUT = os.path.join(ROOT, 'assets', 'fonts', 'pixel4056.ttf')

NOITA_PX = 102.4  # NoitaPixel：UPM 768，1 像素 ≈ 102.4 单位
SCALE = 200       # Fusion：UPM 1200（12px），1 像素 = 100 单位；Noita 的 1 像素放大为 2 个 Fusion 像素
SHIFT = 100       # 整体下移 1 个 Fusion 像素
# NoitaPixel 里的 ~ 与 " 字形相同（占位字形），范围写法“2 ~ 4”会被看成引号，保留 Fusion 的 ~
KEEP_FUSION = set('~')


def main() -> None:
    if not os.path.exists(NOITA):
        # 公开仓库里没有 NoitaPixel（版权属于 Nolla Games）；没有它时构建直接使用 Fusion Pixel
        print('assets/fonts/NoitaPixel.ttf not found: skip (build will use Fusion Pixel only)')
        return
    fus = TTFont(FUSION)
    noi = TTFont(NOITA)
    fcmap = fus.getBestCmap()
    ncmap = noi.getBestCmap()
    nglyf = noi['glyf']
    nhmtx = noi['hmtx']
    fglyf = fus['glyf']
    fhmtx = fus['hmtx']
    replaced = 0
    for cp in range(0x20, 0x7F):
        if cp not in ncmap or cp not in fcmap or chr(cp) in KEEP_FUSION:
            continue
        nname, fname = ncmap[cp], fcmap[cp]
        g = nglyf[nname]
        adv = nhmtx[nname][0]
        if g.numberOfContours == 0:
            # 空格
            fglyf[fname] = TTGlyphPen(None).glyph()
            fhmtx[fname] = (round(adv / NOITA_PX) * SCALE, 0)
            replaced += 1
            continue
        coords = g.getCoordinates(nglyf)[0]
        xmin = min(x for x, _ in coords)
        xmax = max(x for x, _ in coords)
        rec = RecordingPen()
        g.draw(rec, nglyf)

        def snap(pt):
            x, y = pt
            return (round((x - xmin) / NOITA_PX) * SCALE, round(y / NOITA_PX) * SCALE - SHIFT)

        pen = TTGlyphPen(None)
        for op, args in rec.value:
            if op == 'moveTo':
                pen.moveTo(snap(args[0]))
            elif op == 'lineTo':
                pen.lineTo(snap(args[0]))
            elif op == 'qCurveTo':
                # 像素字体只有直线；保险起见把曲线控制点也当作折线
                for a in args:
                    if a is not None:
                        pen.lineTo(snap(a))
            elif op == 'curveTo':
                pen.lineTo(snap(args[-1]))
            elif op == 'closePath' or op == 'endPath':
                pen.closePath()
        width_px = round((xmax - xmin) / NOITA_PX)
        adv_px = max(round(adv / NOITA_PX), width_px + 1)
        fglyf[fname] = pen.glyph()
        fhmtx[fname] = (adv_px * SCALE, 0)
        replaced += 1
    # 字距与上下文替换只针对原来的拉丁字形，替换后不再适用
    for t in ('GPOS', 'GSUB'):
        if t in fus:
            del fus[t]
    # 改名：这是一个修改后的版本
    name = fus['name']
    for rec in list(name.names):
        if rec.nameID in (1, 3, 4, 6, 16, 17):
            name.removeNames(nameID=rec.nameID)
    name.setName('Pixel4056', 1, 3, 1, 0x409)
    name.setName('Pixel4056-Regular', 3, 3, 1, 0x409)
    name.setName('Pixel4056 Regular', 4, 3, 1, 0x409)
    name.setName('Pixel4056-Regular', 6, 3, 1, 0x409)
    name.setName('Copyright (c) 2022, TakWolf (https://takwolf.com). Latin glyphs: NoitaPixel, Copyright (c) 2020, Nolla Games', 0, 3, 1, 0x409)
    fus['head'].recalcBBoxes = True
    fus.save(OUT)
    print(f'merged {replaced} glyphs -> {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT) // 1024} KB)')


if __name__ == '__main__':
    sys.exit(main())
