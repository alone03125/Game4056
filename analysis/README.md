# 数据分析脚本

把真人试玩和 AI 模拟（`tools/sim.ts`）导出的数据放在一起对比，看看 AI 模拟是否能代表真实体验。
这是独立于游戏本体的 Python 小工具，不影响 `npm run build`/`typecheck`/`modtest`，也不会被 CI 跑到。

## 数据从哪里来

- **AI**：跑 `npm run sim -- <局数> <难度>`，每局结束会自动写一份 JSON 到 `analysis/data/`（`source: "ai"`）。
- **真人**：在游戏结算画面点「导出数据」按钮下载 JSON，手动把下载下来的文件拷贝到 `analysis/data/`（`source: "human"`）。

两者字段格式完全相同（见 `src/game/state.ts` 的 `RunExportData`），放进同一个资料夹即可，分析脚本靠 `source` 字段区分。

`analysis/data/`（原始数据）和 `analysis/output/`（图表）都已加入 `.gitignore`，不会被提交进仓库——每个人自己跑自己的数据。

## 怎么运行

```bash
cd analysis
pip install -r requirements.txt
python analyze.py              # 默认读 analysis/data/，图表输出到 analysis/output/
python analyze.py 其他资料夹 其他输出资料夹   # 也可以指定别的路径
```

## 输出哪些图

- `zone_distribution.png` —— 到达区域分布：AI / 真人各局最终停在第几区的次数。
- `zone_time.png` —— 各区用时：AI / 真人在每个区域平均花费的时间。
- `damage_source.png` —— 伤害来源比例：承受伤害按接触 / 口水 / Boss / 自伤 / 辐射分类的圆饼图。
- `ai_vs_human.png` —— AI 与真人对比：击杀、金币、总用时、承受伤害、到达区域这几项指标的平均值并排比较。

如果某一类数据暂时没有（比如还没有真人数据），对应的图会只画出有数据的那一边，不会报错。

## 中文字体

图表默认依次尝试微软雅黑 / 黑体等中文字体（`analyze.py` 顶部的 `font.sans-serif` 列表）。如果你的系统上这些字体都没有，中文会显示成方框，把你系统里装的中文字体名加到那个列表最前面即可。


