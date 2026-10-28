#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""分析真人试玩与 AI 模拟（tools/sim.ts）导出的数据，产出对比图表。

输入：一个放满 JSON 文件的资料夹，每个文件是一局游戏的导出数据
      （真人：结算画面「导出数据」按钮下载；AI：tools/sim.ts 自动写到 analysis/data/），
      字段格式完全相同，用 "source": "ai" / "human" 区分。
输出：几张 PNG 图表，存到指定的输出资料夹。

用法：
    pip install -r requirements.txt
    python analyze.py [数据资料夹=data] [输出资料夹=output]
"""
import argparse
import json
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use('Agg')  # 不需要显示窗口，直接存文件
import matplotlib.pyplot as plt
import numpy as np

# Windows/macOS 常见的中文字体，按顺序尝试；都没有的话中文会变成方框，
# 可以把你系统里有的中文字体名加到这个列表最前面。
matplotlib.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'PingFang SC', 'Noto Sans CJK SC', 'Arial Unicode MS', 'DejaVu Sans']
matplotlib.rcParams['axes.unicode_minus'] = False

SOURCE_LABEL = {'ai': 'AI', 'human': '真人'}
SOURCE_COLOR = {'ai': '#5b8def', 'human': '#f2994a'}
DAMAGE_SOURCE_LABEL = {'contact': '接触', 'spit': '口水', 'boss': 'Boss', 'self': '自伤', 'rad': '辐射'}


def load_runs(data_dir: Path) -> list:
    runs = []
    for f in sorted(data_dir.glob('*.json')):
        try:
            with open(f, encoding='utf-8') as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError) as e:
            print(f'跳过无法解析的文件 {f.name}：{e}')
            continue
        data['_file'] = f.name
        runs.append(data)
    return runs


def by_source(runs: list, source: str) -> list:
    return [r for r in runs if r.get('source') == source]


def plot_zone_distribution(runs: list, out_dir: Path) -> None:
    """到达区域分布：每种来源各局最终到达第几区的次数"""
    max_zone = max((r.get('finalZone', 0) for r in runs), default=0)
    if max_zone <= 0:
        return
    zones = list(range(1, max_zone + 1))
    sources = [s for s in ('ai', 'human') if by_source(runs, s)]
    fig, ax = plt.subplots(figsize=(8, 5))
    width = 0.8 / max(1, len(sources))
    for i, src in enumerate(sources):
        rs = by_source(runs, src)
        counts = [sum(1 for r in rs if r.get('finalZone') == z) for z in zones]
        x = np.array(zones) + (i - (len(sources) - 1) / 2) * width
        ax.bar(x, counts, width, label=SOURCE_LABEL[src], color=SOURCE_COLOR[src])
    ax.set_xlabel('最终到达区域')
    ax.set_ylabel('局数')
    ax.set_title('到达区域分布')
    ax.set_xticks(zones)
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_dir / 'zone_distribution.png', dpi=150)
    plt.close(fig)


def plot_zone_time(runs: list, out_dir: Path) -> None:
    """各区用时：每种来源在每个区域花费时间的平均值（秒）"""
    times_by_source = {'ai': defaultdict(list), 'human': defaultdict(list)}
    for r in runs:
        src = r.get('source')
        if src not in times_by_source:
            continue
        for z in r.get('zones', []):
            times_by_source[src][z['zone']].append(z['time'])
    max_zone = max((z for d in times_by_source.values() for z in d), default=0)
    if max_zone <= 0:
        return
    zones = list(range(1, max_zone + 1))
    sources = [s for s in ('ai', 'human') if times_by_source[s]]
    fig, ax = plt.subplots(figsize=(8, 5))
    width = 0.8 / max(1, len(sources))
    for i, src in enumerate(sources):
        means = [np.mean(times_by_source[src][z]) if times_by_source[src].get(z) else 0 for z in zones]
        x = np.array(zones) + (i - (len(sources) - 1) / 2) * width
        ax.bar(x, means, width, label=SOURCE_LABEL[src], color=SOURCE_COLOR[src])
    ax.set_xlabel('区域')
    ax.set_ylabel('平均用时（秒）')
    ax.set_title('各区用时')
    ax.set_xticks(zones)
    ax.legend()
    fig.tight_layout()
    fig.savefig(out_dir / 'zone_time.png', dpi=150)
    plt.close(fig)


def plot_damage_source(runs: list, out_dir: Path) -> None:
    """伤害来源比例：按来源各自汇总 damageBySource 的总量，画成圆饼图"""
    order = ['contact', 'spit', 'boss', 'self', 'rad']
    groups = {}
    for src in ('ai', 'human'):
        totals = {k: 0.0 for k in order}
        rs = by_source(runs, src)
        if not rs:
            continue
        for r in rs:
            d = r.get('damageBySource', {})
            for k in order:
                totals[k] += d.get(k, 0)
        if sum(totals.values()) > 0:
            groups[src] = totals
    if not groups:
        return
    fig, axes = plt.subplots(1, len(groups), figsize=(6 * len(groups), 6))
    if len(groups) == 1:
        axes = [axes]
    for ax, (src, totals) in zip(axes, groups.items()):
        vals = [totals[k] for k in order]
        # 占比很小的来源用内嵌标签会和相邻扇区重叠，改用图例显示名字，饼图上只标百分比
        wedges, _, _ = ax.pie(vals, autopct=lambda p: f'{p:.1f}%' if p >= 1 else '', colors=plt.cm.Set2.colors, pctdistance=0.8)
        ax.legend(wedges, [DAMAGE_SOURCE_LABEL[k] for k in order], loc='center left', bbox_to_anchor=(1, 0.5), fontsize=9)
        ax.set_title(f'伤害来源比例（{SOURCE_LABEL[src]}）')
    fig.tight_layout()
    fig.savefig(out_dir / 'damage_source.png', dpi=150)
    plt.close(fig)


def plot_ai_vs_human(runs: list, out_dir: Path) -> None:
    """AI 与真人对比：几个关键指标的平均值并排比较（每个指标单位不同，分开子图）"""
    metrics = [
        ('kills', '击杀'), ('goldEarned', '金币'), ('totalTime', '总用时（秒）'),
        ('damageTaken', '承受伤害'), ('finalZone', '到达区域'),
    ]
    ai, human = by_source(runs, 'ai'), by_source(runs, 'human')
    if not ai and not human:
        return
    fig, axes = plt.subplots(1, len(metrics), figsize=(3 * len(metrics), 4.2))
    for ax, (key, label) in zip(axes, metrics):
        ai_mean = np.mean([r[key] for r in ai]) if ai else 0
        human_mean = np.mean([r[key] for r in human]) if human else 0
        ax.bar(['AI', '真人'], [ai_mean, human_mean], color=[SOURCE_COLOR['ai'], SOURCE_COLOR['human']])
        ax.set_title(label)
    fig.suptitle(f'AI 与真人对比（AI {len(ai)} 局 / 真人 {len(human)} 局，各指标平均值）')
    fig.tight_layout()
    fig.savefig(out_dir / 'ai_vs_human.png', dpi=150)
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('data_dir', nargs='?', default='data', help='放 JSON 导出文件的资料夹（默认 data）')
    parser.add_argument('out_dir', nargs='?', default='output', help='PNG 图表输出资料夹（默认 output）')
    args = parser.parse_args()
    data_dir, out_dir = Path(args.data_dir), Path(args.out_dir)

    runs = load_runs(data_dir)
    if not runs:
        print(f'{data_dir} 里没有找到可解析的 JSON 文件')
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    n_ai, n_human = len(by_source(runs, 'ai')), len(by_source(runs, 'human'))
    print(f'读取到 {len(runs)} 局数据（AI {n_ai} 局，真人 {n_human} 局）')

    plot_zone_distribution(runs, out_dir)
    plot_zone_time(runs, out_dir)
    plot_damage_source(runs, out_dir)
    plot_ai_vs_human(runs, out_dir)
    print(f'图表已输出到 {out_dir}')


if __name__ == '__main__':
    main()
