#!/usr/bin/env python3
"""
Generate publication-quality figures for:
"Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases"

Produces 6 figures (PDF + PNG) for a PVLDB-style research paper.
"""

import json
import os
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
from matplotlib.patches import Patch

# =============================================================================
# Paths
# =============================================================================
BASE_DIR = "/Users/kcbalusu/Desktop/Project/DataPup/evaluation/results"
PHASE1_DIR = os.path.join(BASE_DIR, "phase1")
PHASE2_DIR = os.path.join(BASE_DIR, "phase2")
FIG_DIR = os.path.join(BASE_DIR, "figures")
os.makedirs(FIG_DIR, exist_ok=True)

# =============================================================================
# Load data
# =============================================================================
with open(os.path.join(PHASE1_DIR, "phase1_summary.json")) as f:
    phase1 = json.load(f)

with open(os.path.join(PHASE2_DIR, "phase2_summary.json")) as f:
    phase2 = json.load(f)

# =============================================================================
# Colorblind-friendly palette  (Okabe-Ito inspired, PVLDB-suitable)
# =============================================================================
COLORS = {
    'blue':    '#0072B2',
    'orange':  '#E69F00',
    'green':   '#009E73',
    'red':     '#D55E00',
    'purple':  '#CC79A7',
    'cyan':    '#56B4E9',
    'yellow':  '#F0E442',
    'grey':    '#999999',
}

# Three-metric palette used in Figs 1-4
METRIC_COLORS = [COLORS['blue'], COLORS['orange'], COLORS['green']]
# Two-metric palette (EX, RC only)
METRIC_COLORS_2 = [COLORS['blue'], COLORS['orange']]

# =============================================================================
# Global style
# =============================================================================
plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['Times New Roman', 'DejaVu Serif', 'Times', 'serif'],
    'font.size': 10,
    'axes.labelsize': 11,
    'axes.titlesize': 11,
    'xtick.labelsize': 9,
    'ytick.labelsize': 9,
    'legend.fontsize': 8.5,
    'figure.dpi': 300,
    'savefig.dpi': 300,
    'axes.spines.top': False,
    'axes.spines.right': False,
    'axes.linewidth': 0.6,
    'xtick.major.width': 0.6,
    'ytick.major.width': 0.6,
    'lines.linewidth': 1.0,
    'patch.linewidth': 0.4,
    'pdf.fonttype': 42,       # TrueType fonts in PDF (required by many venues)
    'ps.fonttype': 42,
})


def save_figure(fig, name):
    """Save a figure as both PDF and PNG."""
    pdf_path = os.path.join(FIG_DIR, f"{name}.pdf")
    png_path = os.path.join(FIG_DIR, f"{name}.png")
    fig.savefig(pdf_path, bbox_inches='tight', pad_inches=0.02)
    fig.savefig(png_path, bbox_inches='tight', pad_inches=0.02, dpi=300)
    plt.close(fig)
    print(f"  Saved {pdf_path}")
    print(f"  Saved {png_path}")


def grouped_bar(ax, labels, metric_values, metric_names, colors,
                ylabel="Score", ylim_top=1.05, bar_width=0.22,
                value_fontsize=7, show_values=True):
    """
    Draw a grouped bar chart on the given axes.

    metric_values: list of arrays, one per metric
    metric_names: list of str
    """
    n_groups = len(labels)
    n_metrics = len(metric_values)
    x = np.arange(n_groups)

    # Centre the group of bars
    total_width = n_metrics * bar_width
    offsets = np.linspace(-(total_width - bar_width) / 2,
                           (total_width - bar_width) / 2, n_metrics)

    bars_list = []
    for i, (vals, name, color) in enumerate(zip(metric_values, metric_names, colors)):
        bars = ax.bar(x + offsets[i], vals, bar_width, label=name,
                      color=color, edgecolor='white', linewidth=0.3,
                      zorder=3)
        bars_list.append(bars)
        if show_values:
            for bar, v in zip(bars, vals):
                if v > 0:
                    ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.01,
                            f'{v:.2f}', ha='center', va='bottom', fontsize=value_fontsize,
                            fontweight='medium')

    ax.set_xticks(x)
    ax.set_xticklabels(labels)
    ax.set_ylabel(ylabel)
    ax.set_ylim(0, ylim_top)
    ax.yaxis.set_major_locator(mticker.MultipleLocator(0.2))
    ax.yaxis.set_minor_locator(mticker.MultipleLocator(0.1))
    ax.tick_params(axis='x', length=0)
    # Light horizontal reference lines
    for yval in np.arange(0.2, 1.01, 0.2):
        ax.axhline(yval, color='#e0e0e0', linewidth=0.4, zorder=0)

    return bars_list


# =====================================================================
# Figure 1: Schema Format Comparison (RQ1)
# =====================================================================
def fig1_format_comparison():
    print("Generating Figure 1: Format Comparison ...")
    runs = phase1['runs']

    # Order: DDL, Markdown, JSON, NL
    order = {'ddl': 0, 'markdown': 1, 'json': 2, 'natural_language': 3}
    runs_sorted = sorted(runs, key=lambda r: order.get(r['schema_format'], 99))

    labels = ['DDL', 'Markdown', 'JSON Schema', 'Natural Lang.']
    ex = [r['execution_accuracy'] for r in runs_sorted]
    rc = [r['result_correctness'] for r in runs_sorted]
    sl = [r['schema_linking_f1'] for r in runs_sorted]

    fig, ax = plt.subplots(figsize=(3.5, 2.5))
    grouped_bar(ax, labels, [ex, rc, sl],
                ['EX', 'RC', 'SL-F1'], METRIC_COLORS,
                ylabel='Score', bar_width=0.20, ylim_top=1.15,
                value_fontsize=6.5)
    ax.legend(loc='upper right', frameon=False, ncol=3, handlelength=1.2,
              bbox_to_anchor=(1.0, 1.02))
    ax.set_title('(a) Schema Format Comparison (RQ1)', fontsize=10, pad=6)
    fig.tight_layout()
    save_figure(fig, 'fig1_format_comparison')


# =====================================================================
# Figure 2: Schema Scope Comparison (RQ2)
# =====================================================================
def fig2_scope_comparison():
    print("Generating Figure 2: Scope Comparison ...")
    runs = phase2['rq2_scope']['runs']

    scope_order = {'full': 0, 'relevant_subset': 1, 'progressive': 2, 'user_guided': 3}
    runs_sorted = sorted(runs, key=lambda r: scope_order.get(r['schema_scope'], 99))

    labels = ['Full', 'Relevant\nSubset', 'Progressive', 'User-\nGuided']
    ex = [r['execution_accuracy'] for r in runs_sorted]
    rc = [r['result_correctness'] for r in runs_sorted]

    fig, ax = plt.subplots(figsize=(3.5, 2.4))
    grouped_bar(ax, labels, [ex, rc],
                ['EX', 'RC'], METRIC_COLORS_2,
                ylabel='Score', bar_width=0.28)
    ax.legend(loc='upper right', frameon=False, ncol=2, handlelength=1.2)
    ax.set_title('(b) Schema Scope Comparison (RQ2)', fontsize=10, pad=6)
    fig.tight_layout()
    save_figure(fig, 'fig2_scope_comparison')


# =====================================================================
# Figure 3: Metadata Level Comparison (RQ3)
# =====================================================================
def fig3_metadata_comparison():
    print("Generating Figure 3: Metadata Comparison ...")
    runs = phase2['rq3_metadata']['runs']

    meta_order = {'none': 0, 'descriptions': 1, 'sample_values': 2, 'statistics': 3, 'all': 4}
    runs_sorted = sorted(runs, key=lambda r: meta_order.get(r['metadata_level'], 99))

    labels = ['None', 'Descriptions', 'Sample\nValues', 'Statistics', 'All']
    ex = [r['execution_accuracy'] for r in runs_sorted]
    rc = [r['result_correctness'] for r in runs_sorted]

    fig, ax = plt.subplots(figsize=(3.5, 2.4))
    grouped_bar(ax, labels, [ex, rc],
                ['EX', 'RC'], METRIC_COLORS_2,
                ylabel='Score', bar_width=0.25, value_fontsize=6.5)
    ax.legend(loc='upper right', frameon=False, ncol=2, handlelength=1.2)
    ax.set_title('(c) Metadata Enrichment Comparison (RQ3)', fontsize=10, pad=6)
    fig.tight_layout()
    save_figure(fig, 'fig3_metadata_comparison')


# =====================================================================
# Figure 4: Example Strategy Comparison (RQ4)
# =====================================================================
def fig4_example_comparison():
    print("Generating Figure 4: Example Strategy Comparison ...")
    runs = phase2['rq4_examples']['runs']

    ex_order = {'zero_shot': 0, 'static_few_shot': 1, 'dynamic_few_shot': 2, 'schema_matched': 3}
    runs_sorted = sorted(runs, key=lambda r: ex_order.get(r['example_strategy'], 99))

    labels = ['Zero-Shot', 'Static\nFew-Shot', 'Dynamic\nFew-Shot', 'Schema-\nMatched']
    ex = [r['execution_accuracy'] for r in runs_sorted]
    rc = [r['result_correctness'] for r in runs_sorted]

    fig, ax = plt.subplots(figsize=(3.5, 2.4))
    grouped_bar(ax, labels, [ex, rc],
                ['EX', 'RC'], METRIC_COLORS_2,
                ylabel='Score', bar_width=0.28)
    ax.legend(loc='upper right', frameon=False, ncol=2, handlelength=1.2)
    ax.set_title('(d) Example Strategy Comparison (RQ4)', fontsize=10, pad=6)
    fig.tight_layout()
    save_figure(fig, 'fig4_example_comparison')


# =====================================================================
# Figure 5: Token Efficiency Scatter
# =====================================================================
def fig5_token_efficiency():
    print("Generating Figure 5: Token Efficiency ...")

    # Collect all configs from both phases
    configs = []

    # Phase 1 (RQ1) -- format comparison
    for r in phase1['runs']:
        configs.append({
            'label': r['schema_format'].replace('_', ' ').title(),
            'short': _short_label(r['config_name']),
            'ex': r['execution_accuracy'],
            'tokens': r['avg_input_tokens'],
            'rq': 'RQ1: Format',
        })

    # Phase 2 RQ2 -- scope (skip duplicates with phase1 markdown_full)
    for r in phase2['rq2_scope']['runs']:
        if r['config_name'] == 'markdown_full_none_zero_shot':
            continue  # already in RQ1
        configs.append({
            'label': r['schema_scope'].replace('_', ' ').title(),
            'short': _short_label(r['config_name']),
            'ex': r['execution_accuracy'],
            'tokens': r['avg_input_tokens'],
            'rq': 'RQ2: Scope',
        })

    # Phase 2 RQ3 -- metadata (skip duplicate none)
    for r in phase2['rq3_metadata']['runs']:
        if r['config_name'] == 'markdown_user_guided_none_zero_shot':
            continue
        configs.append({
            'label': r['metadata_level'].replace('_', ' ').title(),
            'short': _short_label(r['config_name']),
            'ex': r['execution_accuracy'],
            'tokens': r['avg_input_tokens'],
            'rq': 'RQ3: Metadata',
        })

    # Phase 2 RQ4 -- examples (skip duplicate zero_shot)
    for r in phase2['rq4_examples']['runs']:
        if r['config_name'] == 'markdown_user_guided_none_zero_shot':
            continue
        configs.append({
            'label': r['example_strategy'].replace('_', ' ').title(),
            'short': _short_label(r['config_name']),
            'ex': r['execution_accuracy'],
            'tokens': r['avg_input_tokens'],
            'rq': 'RQ4: Examples',
        })

    # Add back the shared configs once with a combined label
    # markdown_full_none_zero_shot appears in both RQ1 and RQ2
    # markdown_user_guided_none_zero_shot appears in RQ2, RQ3, RQ4
    # They are already included once; that is fine.

    rq_markers = {
        'RQ1: Format': 'o',
        'RQ2: Scope': 's',
        'RQ3: Metadata': '^',
        'RQ4: Examples': 'D',
    }
    rq_colors = {
        'RQ1: Format': COLORS['blue'],
        'RQ2: Scope': COLORS['orange'],
        'RQ3: Metadata': COLORS['green'],
        'RQ4: Examples': COLORS['red'],
    }

    fig, ax = plt.subplots(figsize=(3.5, 3.0))

    for rq in ['RQ1: Format', 'RQ2: Scope', 'RQ3: Metadata', 'RQ4: Examples']:
        pts = [c for c in configs if c['rq'] == rq]
        if not pts:
            continue
        tokens = [p['tokens'] for p in pts]
        exs = [p['ex'] for p in pts]
        ax.scatter(tokens, exs, marker=rq_markers[rq], color=rq_colors[rq],
                   s=50, label=rq, edgecolors='white', linewidths=0.4, zorder=5)

    # Annotate best and worst
    best = max(configs, key=lambda c: c['ex'])
    worst = min(configs, key=lambda c: c['ex'])

    # Best: Full scope (top-left cluster near ~1829 tokens)
    ax.annotate(best['label'],
                xy=(best['tokens'], best['ex']),
                xytext=(best['tokens'] + 400, best['ex'] - 0.10),
                fontsize=7, arrowprops=dict(arrowstyle='->', color='#444444', lw=0.7),
                color='#333333')
    # Worst: Natural Language (bottom, ~1284 tokens, EX=0.0)
    ax.annotate(worst['label'],
                xy=(worst['tokens'], worst['ex']),
                xytext=(worst['tokens'] + 500, worst['ex'] + 0.12),
                fontsize=7, arrowprops=dict(arrowstyle='->', color='#444444', lw=0.7),
                color='#333333')

    # Also annotate the highest-token / low-accuracy outlier (JSON Schema)
    json_pt = next(c for c in configs if c['rq'] == 'RQ1: Format' and 'Json' in c['label'])
    ax.annotate('JSON Schema',
                xy=(json_pt['tokens'], json_pt['ex']),
                xytext=(json_pt['tokens'] - 200, json_pt['ex'] - 0.12),
                fontsize=7, arrowprops=dict(arrowstyle='->', color='#444444', lw=0.7),
                color='#333333')

    ax.set_xlabel('Avg. Input Tokens')
    ax.set_ylabel('Execution Accuracy (EX)')
    ax.set_ylim(-0.05, 1.10)
    ax.legend(loc='center right', frameon=False, fontsize=7.5, markerscale=0.8,
              handletextpad=0.3, labelspacing=0.35)
    # Light grid
    ax.yaxis.set_major_locator(mticker.MultipleLocator(0.2))
    for yval in np.arange(0.2, 1.01, 0.2):
        ax.axhline(yval, color='#e8e8e8', linewidth=0.4, zorder=0)

    ax.set_title('(e) Token Efficiency', fontsize=10, pad=6)
    fig.tight_layout()
    save_figure(fig, 'fig5_token_efficiency')


def _short_label(config_name):
    """Create a short label from the config name."""
    parts = config_name.replace('__claude-3-5-sonnet-20241022', '').split('_')
    return config_name


# =====================================================================
# Figure 6: Category Heatmap
# =====================================================================
def fig6_category_heatmap():
    print("Generating Figure 6: Category Heatmap ...")

    # Categories (rows)
    categories = ['Aggregation', 'Simple-SELECT', 'Time_Series',
                   'ClickHouse_Specific', 'Window_Functions', 'Complex_JOINs']
    cat_labels = ['Aggregation', 'Simple SELECT', 'Time Series',
                  'ClickHouse\nSpecific', 'Window\nFunctions', 'Complex\nJOINs']

    # Columns: best config from each RQ
    # RQ1 best format: markdown  (phase1)
    # RQ2 best scope:  full (highest EX in rq2_scope)
    # RQ3 best metadata: none (or descriptions -- phase2 says "none")
    # RQ4 best examples: zero_shot

    # Gather the per-category EX for each best config
    col_configs = []

    # RQ1: best = markdown from phase1
    rq1_best = next(r for r in phase1['runs'] if r['schema_format'] == 'markdown')
    col_configs.append(('Markdown\n(RQ1)', rq1_best))

    # RQ2: best = full scope from phase2
    rq2_best = next(r for r in phase2['rq2_scope']['runs'] if r['schema_scope'] == 'full')
    col_configs.append(('Full Scope\n(RQ2)', rq2_best))

    # RQ3: best = descriptions (highest EX)
    rq3_runs = phase2['rq3_metadata']['runs']
    rq3_best = max(rq3_runs, key=lambda r: r['execution_accuracy'])
    meta_label = rq3_best['metadata_level'].replace('_', ' ').title()
    col_configs.append((f'Desc.\n(RQ3)', rq3_best))

    # RQ4: best = zero_shot (highest EX)
    rq4_runs = phase2['rq4_examples']['runs']
    rq4_best = max(rq4_runs, key=lambda r: r['execution_accuracy'])
    ex_label = rq4_best['example_strategy'].replace('_', ' ').title()
    col_configs.append((f'Zero-Shot\n(RQ4)', rq4_best))

    # Also include the worst from RQ1 for contrast
    rq1_worst = next(r for r in phase1['runs'] if r['schema_format'] == 'natural_language')
    col_configs.append(('Nat. Lang.\n(Baseline)', rq1_worst))

    n_rows = len(categories)
    n_cols = len(col_configs)
    data = np.zeros((n_rows, n_cols))

    for j, (col_label, run_data) in enumerate(col_configs):
        for i, cat in enumerate(categories):
            if cat in run_data.get('per_category', {}):
                data[i, j] = run_data['per_category'][cat]['execution_accuracy']
            else:
                data[i, j] = 0.0

    fig, ax = plt.subplots(figsize=(3.5, 2.8))

    # Custom colormap: white -> blue
    from matplotlib.colors import LinearSegmentedColormap
    cmap = LinearSegmentedColormap.from_list('pvldb',
                                              ['#f7fbff', '#deebf7', '#9ecae1', '#3182bd', '#08519c'])

    im = ax.imshow(data, cmap=cmap, aspect='auto', vmin=0, vmax=1.0)

    # Text annotations
    for i in range(n_rows):
        for j in range(n_cols):
            val = data[i, j]
            text_color = 'white' if val > 0.7 else 'black'
            ax.text(j, i, f'{val:.2f}', ha='center', va='center',
                    fontsize=8, color=text_color, fontweight='medium')

    col_labels = [cl for cl, _ in col_configs]
    ax.set_xticks(np.arange(n_cols))
    ax.set_xticklabels(col_labels, fontsize=7.5)
    ax.set_yticks(np.arange(n_rows))
    ax.set_yticklabels(cat_labels, fontsize=8)

    # Colorbar
    cbar = fig.colorbar(im, ax=ax, fraction=0.035, pad=0.04)
    cbar.set_label('EX', fontsize=9)
    cbar.ax.tick_params(labelsize=7)

    ax.set_title('(f) Execution Accuracy by Category', fontsize=10, pad=6)

    # Remove spines for heatmap
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_visible(False)
    ax.spines['left'].set_visible(False)
    ax.tick_params(length=0)

    fig.tight_layout()
    save_figure(fig, 'fig6_category_heatmap')


# =====================================================================
# Main
# =====================================================================
if __name__ == '__main__':
    print("=" * 60)
    print("Generating publication figures")
    print("=" * 60)
    fig1_format_comparison()
    fig2_scope_comparison()
    fig3_metadata_comparison()
    fig4_example_comparison()
    fig5_token_efficiency()
    fig6_category_heatmap()
    print("=" * 60)
    print("All figures generated successfully.")
    print(f"Output directory: {FIG_DIR}")
