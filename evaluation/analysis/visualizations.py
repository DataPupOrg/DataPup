"""
Publication-quality visualizations for the VLDB paper:
"Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases."

Generates 6 figures for the Results and Discussion sections:
    Figure 1 (RQ1): Schema format comparison -- grouped bar chart
    Figure 2 (RQ2): Schema scope comparison -- grouped bar chart with token overlay
    Figure 3 (RQ3): Metadata enrichment heatmap -- RC by metadata level x category
    Figure 4 (RQ4): Example selection strategies -- line chart across categories
    Figure 5: Interaction effects matrix -- delta-vs-additive heatmap
    Figure 6: Ablation study -- waterfall / horizontal bar chart

All figures follow VLDB/ACM two-column formatting conventions:
    - Single-column width: 3.5 in (88.9 mm)
    - Double-column width: 7.0 in (177.8 mm)
    - Font: 10pt serif (Times / Computer Modern, compatible with LaTeX)
    - DPI: 300 for print quality
    - Saved as both PDF (for LaTeX includegraphics) and PNG (for review)

Color palette: seaborn "colorblind" palette for accessibility.

Dependencies: matplotlib, seaborn, numpy.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import matplotlib
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import seaborn as sns

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SINGLE_COL_WIDTH = 3.5   # inches (VLDB single column)
DOUBLE_COL_WIDTH = 7.0   # inches (VLDB double column)
GOLDEN_RATIO = 1.618
DEFAULT_DPI = 300

# Colorblind-friendly palette from seaborn
_CB_PALETTE = sns.color_palette("colorblind")

# Marker and line style cycles for line charts
_MARKERS = ["o", "s", "^", "D", "v", "P", "X", "*"]
_LINESTYLES = ["-", "--", "-.", ":"]


# ---------------------------------------------------------------------------
# Global style setup
# ---------------------------------------------------------------------------


def setup_vldb_style() -> None:
    """Configure matplotlib rcParams for VLDB publication-quality figures.

    Sets 10pt serif font (Times family), removes unnecessary spines,
    configures tick directions, and applies a clean whitegrid seaborn
    style.  Call this once before generating any figures.
    """
    plt.rcParams.update(
        {
            # Fonts -- 10pt serif as required by VLDB format
            "font.family": "serif",
            "font.serif": [
                "Times New Roman",
                "Times",
                "Computer Modern Roman",
                "DejaVu Serif",
            ],
            "font.size": 10,
            "axes.labelsize": 10,
            "axes.titlesize": 11,
            "legend.fontsize": 8,
            "xtick.labelsize": 9,
            "ytick.labelsize": 9,
            # Resolution
            "figure.dpi": 150,
            "savefig.dpi": DEFAULT_DPI,
            "savefig.bbox": "tight",
            "savefig.pad_inches": 0.05,
            # Lines and markers
            "lines.linewidth": 1.5,
            "lines.markersize": 6,
            # Axes
            "axes.linewidth": 0.8,
            "axes.grid": False,
            "axes.spines.top": False,
            "axes.spines.right": False,
            # Ticks
            "xtick.major.width": 0.8,
            "ytick.major.width": 0.8,
            "xtick.direction": "out",
            "ytick.direction": "out",
            # Legend
            "legend.frameon": True,
            "legend.framealpha": 0.9,
            "legend.edgecolor": "0.8",
            # LaTeX text rendering (disabled for portability)
            "text.usetex": False,
            # Grid (used selectively per figure)
            "grid.alpha": 0.3,
            "grid.linewidth": 0.5,
        }
    )

    sns.set_style(
        "whitegrid",
        {
            "axes.edgecolor": "0.2",
            "grid.color": "0.9",
            "grid.linestyle": "--",
        },
    )


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------


def _save_figure(fig: plt.Figure, output_path: str) -> None:
    """Save *fig* to *output_path* as both PDF and PNG.

    The caller supplies a path without extension (or with one -- it is
    stripped).  Two files are written: ``<output_path>.pdf`` and
    ``<output_path>.png``.
    """
    base = os.path.splitext(output_path)[0]
    parent = os.path.dirname(base)
    if parent:
        os.makedirs(parent, exist_ok=True)
    fig.savefig(f"{base}.pdf", format="pdf", dpi=DEFAULT_DPI)
    fig.savefig(f"{base}.png", format="png", dpi=DEFAULT_DPI)
    logger.info("Saved figure to %s.pdf and %s.png", base, base)


def _wilson_ci(outcomes: np.ndarray, z: float = 1.96) -> Tuple[float, float, float]:
    """Compute Wilson score confidence interval for a binary proportion.

    Args:
        outcomes: 1-D array of 0/1 values.
        z: Z-score for the desired confidence level (1.96 for 95%).

    Returns:
        ``(mean_pct, ci_lower_pct, ci_upper_pct)`` -- all in percentage
        points (0--100 scale).
    """
    n = len(outcomes)
    if n == 0:
        return (0.0, 0.0, 0.0)
    p = float(np.mean(outcomes))
    denom = 1 + z ** 2 / n
    center = (p + z ** 2 / (2 * n)) / denom
    margin = z * np.sqrt((p * (1 - p) + z ** 2 / (4 * n)) / n) / denom
    lower = max(0.0, center - margin) * 100
    upper = min(1.0, center + margin) * 100
    return (p * 100, lower, upper)


def _extract_rc_pct(data: Any) -> float:
    """Extract a scalar RC percentage from various input shapes.

    Accepts:
        - A list/array of booleans  -> returns mean * 100
        - A float in [0, 1]         -> returns value * 100
        - A float > 1               -> returns value as-is (already %)
    """
    if isinstance(data, (list, np.ndarray)):
        arr = np.asarray(data, dtype=float)
        return float(np.mean(arr)) * 100.0
    val = float(data)
    return val * 100.0 if val <= 1.0 else val


def _placeholder_figure(message: str) -> plt.Figure:
    """Return a 1-axis figure with centered placeholder text."""
    fig, ax = plt.subplots(figsize=(SINGLE_COL_WIDTH, SINGLE_COL_WIDTH / GOLDEN_RATIO))
    ax.text(
        0.5,
        0.5,
        message,
        ha="center",
        va="center",
        fontsize=10,
        color="0.4",
        transform=ax.transAxes,
    )
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    return fig


# ---------------------------------------------------------------------------
# Figure 1 -- RQ1: Schema Format Comparison (grouped bar chart)
# ---------------------------------------------------------------------------


def plot_format_comparison(
    results_dict: Dict[str, Any],
    output_path: str,
) -> plt.Figure:
    """Generate Figure 1: Schema format comparison grouped bar chart.

    Shows EX (Execution Accuracy) and RC (Result Correctness) side by
    side for each of the 4 schema formats, with separate bar groups for
    each model.  Error bars display 95% Wilson confidence intervals.

    Args:
        results_dict: Expected structure::

            {
                "models": {
                    "Sonnet": {
                        "CREATE TABLE": {"EX": [bool...], "RC": [bool...]},
                        "Markdown":     {"EX": [...], "RC": [...]},
                        "JSON":         {"EX": [...], "RC": [...]},
                        "Natural Language": {"EX": [...], "RC": [...]},
                    },
                    "Haiku": { ... same ... },
                }
            }

        output_path: File path (without extension) for saving the figure.

    Returns:
        The matplotlib ``Figure`` object.
    """
    models_data = results_dict.get("models", {})
    model_names = list(models_data.keys())

    if not model_names:
        fig = _placeholder_figure("Figure 1: No model data available")
        _save_figure(fig, output_path)
        return fig

    format_names = list(models_data[model_names[0]].keys())
    n_formats = len(format_names)
    metrics = ["EX", "RC"]
    n_metrics = len(metrics)
    n_models = len(model_names)

    # Layout: one subplot per model, shared y-axis
    fig, axes = plt.subplots(
        1,
        n_models,
        figsize=(DOUBLE_COL_WIDTH, DOUBLE_COL_WIDTH / GOLDEN_RATIO / 1.4),
        sharey=True,
        squeeze=False,
    )
    axes = axes.ravel()

    bar_width = 0.35

    for ax_idx, model_name in enumerate(model_names):
        ax = axes[ax_idx]
        model_configs = models_data[model_name]
        x = np.arange(n_formats)

        for m_idx, metric in enumerate(metrics):
            values = []
            err_lo = []
            err_hi = []

            for fmt in format_names:
                cfg = model_configs.get(fmt, {})
                if metric in cfg:
                    outcomes = np.asarray(cfg[metric], dtype=float)
                    mean_pct, ci_lo, ci_hi = _wilson_ci(outcomes)
                    values.append(mean_pct)
                    err_lo.append(mean_pct - ci_lo)
                    err_hi.append(ci_hi - mean_pct)
                else:
                    values.append(0.0)
                    err_lo.append(0.0)
                    err_hi.append(0.0)

            offset = (m_idx - (n_metrics - 1) / 2) * bar_width
            bars = ax.bar(
                x + offset,
                values,
                bar_width * 0.9,
                yerr=[err_lo, err_hi],
                label=metric,
                color=_CB_PALETTE[m_idx],
                edgecolor="white",
                linewidth=0.5,
                capsize=3,
                error_kw={"linewidth": 0.8, "capthick": 0.8},
            )

            # Value labels above bars
            for bar in bars:
                h = bar.get_height()
                if np.isfinite(h) and h > 0:
                    ax.annotate(
                        f"{h:.1f}",
                        xy=(bar.get_x() + bar.get_width() / 2, h),
                        xytext=(0, 1),
                        textcoords="offset points",
                        ha="center",
                        va="bottom",
                        fontsize=7,
                    )

        display_name = model_name.replace("_", " ").title()
        ax.set_title(f"Claude {display_name}", fontweight="bold", pad=8)
        ax.set_xticks(x)
        ax.set_xticklabels(format_names, rotation=20, ha="right")
        ax.set_ylim(0, 105)
        ax.yaxis.set_major_locator(mticker.MultipleLocator(20))
        ax.yaxis.set_minor_locator(mticker.MultipleLocator(10))
        ax.set_axisbelow(True)
        ax.grid(axis="y", alpha=0.3, linewidth=0.5)
        if ax_idx == 0:
            ax.set_ylabel("Accuracy (%)")
        ax.legend(loc="upper right", framealpha=0.9)

    fig.tight_layout()
    _save_figure(fig, output_path)
    return fig


# ---------------------------------------------------------------------------
# Figure 2 -- RQ2: Schema Scope Comparison (grouped bar + line overlay)
# ---------------------------------------------------------------------------


def plot_scope_comparison(
    results_dict: Dict[str, Any],
    output_path: str,
    external_cis: Optional[Dict[str, Tuple[float, float]]] = None,
) -> plt.Figure:

    """Generate Figure 2: Schema scope comparison with token efficiency overlay.

    Grouped bar chart with scope strategies on the x-axis and Result
    Correctness (%) on the primary y-axis.  A secondary y-axis shows
    Token Efficiency (average prompt tokens) as a line overlay.

    Args:
        results_dict: Expected structure::

            {
                "models": {
                    "Sonnet": {
                        "Full":           {"RC": [bool...], "TE": [float...]},
                        "Relevant Subset":{"RC": [...], "TE": [...]},
                        "Progressive":    {"RC": [...], "TE": [...]},
                        "User-Guided":    {"RC": [...], "TE": [...]},
                    },
                    "Haiku": { ... same ... },
                }
            }

        output_path: File path (without extension) for saving.

    Returns:
        The matplotlib ``Figure`` object.
    """
    models_data = results_dict.get("models", {})
    model_names = list(models_data.keys())

    if not model_names:
        fig = _placeholder_figure("Figure 2: No model data available")
        _save_figure(fig, output_path)
        return fig

    scope_names = list(models_data[model_names[0]].keys())
    n_scopes = len(scope_names)
    n_models = len(model_names)

    fig, ax1 = plt.subplots(
        figsize=(DOUBLE_COL_WIDTH, DOUBLE_COL_WIDTH / GOLDEN_RATIO / 1.3)
    )

    x = np.arange(n_scopes)
    total_group_width = 0.7
    bar_width = total_group_width / n_models

    for m_idx, model_name in enumerate(model_names):
        model_configs = models_data[model_name]
        rc_values = []
        err_lo = []
        err_hi = []

        for scope in scope_names:
            cfg = model_configs.get(scope, {})
            if "RC" in cfg:
                outcomes = np.asarray(cfg["RC"], dtype=float)
                mean_pct, ci_lo, ci_hi = _wilson_ci(outcomes)
                rc_values.append(mean_pct)
                err_lo.append(mean_pct - ci_lo)
                err_hi.append(ci_hi - mean_pct)
            else:
                rc_values.append(0.0)
                err_lo.append(0.0)
                err_hi.append(0.0)

        # Override with external CIs if provided
        if external_cis is not None:
            for s_idx_ci, scope in enumerate(scope_names):
                if scope in external_cis:
                    ci_lo_ext, ci_hi_ext = external_cis[scope]
                    err_lo[s_idx_ci] = rc_values[s_idx_ci] - ci_lo_ext
                    err_hi[s_idx_ci] = ci_hi_ext - rc_values[s_idx_ci]

        offset = (m_idx - (n_models - 1) / 2) * bar_width
        display = model_name.replace("_", " ").title()
        ax1.bar(
            x + offset,
            rc_values,
            bar_width * 0.85,
            yerr=[err_lo, err_hi],
            label=f"{display} (RC)",
            color=_CB_PALETTE[m_idx],
            edgecolor="white",
            linewidth=0.5,
            capsize=3,
            error_kw={"linewidth": 0.8, "capthick": 0.8},
        )

    ax1.set_xlabel("Schema Scope Strategy")
    ax1.set_ylabel("Result Correctness (%)")
    ax1.set_xticks(x)
    ax1.set_xticklabels(scope_names, rotation=15, ha="right")
    ax1.set_ylim(0, 105)
    ax1.yaxis.set_major_locator(mticker.MultipleLocator(20))
    ax1.set_axisbelow(True)
    ax1.grid(axis="y", alpha=0.3, linewidth=0.5)

    # Secondary y-axis: Token Efficiency (line overlay)
    ax2 = ax1.twinx()
    ax2.spines["right"].set_visible(True)
    ax2.spines["top"].set_visible(False)

    for m_idx, model_name in enumerate(model_names):
        model_configs = models_data[model_name]
        te_values = []
        for scope in scope_names:
            cfg = model_configs.get(scope, {})
            if "TE" in cfg:
                te_raw = cfg["TE"]
                if isinstance(te_raw, (list, np.ndarray)):
                    te_values.append(float(np.mean(te_raw)))
                else:
                    te_values.append(float(te_raw))
            else:
                te_values.append(0.0)

        if any(v > 0 for v in te_values):
            display = model_name.replace("_", " ").title()
            ax2.plot(
                x,
                te_values,
                marker=_MARKERS[m_idx],
                linestyle="--",
                color=_CB_PALETTE[m_idx],
                alpha=0.7,
                linewidth=1.2,
                markersize=5,
                label=f"{display} (Tokens)",
            )

    ax2.set_ylabel("Avg. Prompt Tokens", color="0.4")
    ax2.tick_params(axis="y", colors="0.4")

    # Combine legends from both axes
    handles1, labels1 = ax1.get_legend_handles_labels()
    handles2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(
        handles1 + handles2,
        labels1 + labels2,
        loc="upper left",
        fontsize=7,
        framealpha=0.9,
    )

    fig.tight_layout()
    _save_figure(fig, output_path)
    return fig


# ---------------------------------------------------------------------------
# Figure 3 -- RQ3: Metadata Enrichment Heatmap
# ---------------------------------------------------------------------------


def plot_metadata_heatmap(
    results_dict: Dict[str, Any],
    output_path: str,
) -> plt.Figure:
    """Generate Figure 3: Metadata enrichment heatmap.

    Rows correspond to 5 metadata levels, columns to 6 query categories.
    Cell values show RC accuracy as percentages, annotated directly.

    Args:
        results_dict: Expected structure::

            {
                "metadata_levels": ["None", "Descriptions", "Sample Values",
                                    "Statistics", "All"],
                "categories": ["Simple SELECT", "Aggregation",
                               "Window Functions", "Time-Series",
                               "Complex JOINs", "ClickHouse-Specific"],
                "matrix": {
                    "None": {
                        "Simple SELECT": <float_or_bool_list>,
                        ...
                    },
                    ...
                }
            }

            Alternatively, *matrix* values can be plain floats (0--100)
            or lists of booleans.

        output_path: File path (without extension) for saving.

    Returns:
        The matplotlib ``Figure`` object.
    """
    metadata_levels = results_dict.get(
        "metadata_levels",
        ["None", "Descriptions", "Sample Values", "Statistics", "All"],
    )
    categories = results_dict.get(
        "categories",
        [
            "Simple SELECT",
            "Aggregation",
            "Window Functions",
            "Time-Series",
            "Complex JOINs",
            "ClickHouse-Specific",
        ],
    )
    matrix_data = results_dict.get("matrix", {})

    if not matrix_data:
        fig = _placeholder_figure("Figure 3: No matrix data available")
        _save_figure(fig, output_path)
        return fig

    n_levels = len(metadata_levels)
    n_cats = len(categories)

    # Build numeric matrix (rows = metadata levels, cols = categories)
    matrix = np.full((n_levels, n_cats), np.nan)
    for i, level in enumerate(metadata_levels):
        level_data = matrix_data.get(level, {})
        for j, cat in enumerate(categories):
            if cat in level_data:
                matrix[i, j] = _extract_rc_pct(level_data[cat])

    fig, ax = plt.subplots(
        figsize=(DOUBLE_COL_WIDTH, DOUBLE_COL_WIDTH / GOLDEN_RATIO / 1.1)
    )

    # Choose color range
    valid = matrix[~np.isnan(matrix)]
    if len(valid) > 0:
        vmin = max(0, np.min(valid) - 5)
        vmax = min(100, np.max(valid) + 5)
    else:
        vmin, vmax = 0, 100

    hm = sns.heatmap(
        matrix,
        annot=True,
        fmt=".1f",
        cmap="YlGnBu",
        xticklabels=categories,
        yticklabels=metadata_levels,
        vmin=vmin,
        vmax=vmax,
        linewidths=1.0,
        linecolor="white",
        cbar_kws={
            "label": "Result Correctness (%)",
            "shrink": 0.8,
        },
        annot_kws={"fontsize": 9, "fontweight": "bold"},
        ax=ax,
    )

    # Highlight best cell per column (category)
    for j in range(n_cats):
        col = matrix[:, j]
        if np.all(np.isnan(col)):
            continue
        best_row = int(np.nanargmax(col))
        ax.add_patch(
            plt.Rectangle(
                (j, best_row),
                1,
                1,
                fill=False,
                edgecolor=_CB_PALETTE[3],
                linewidth=2.5,
            )
        )

    ax.set_xlabel("Query Category", labelpad=8)
    ax.set_ylabel("Metadata Level", labelpad=8)
    ax.set_title(
        "Figure 3: Metadata Enrichment Effect on Result Correctness",
        fontweight="bold",
        pad=10,
    )
    plt.xticks(rotation=30, ha="right")
    plt.yticks(rotation=0)
    fig.tight_layout()
    _save_figure(fig, output_path)
    return fig


# ---------------------------------------------------------------------------
# Figure 4 -- RQ4: Example Selection (line chart)
# ---------------------------------------------------------------------------


def plot_example_comparison(
    results_dict: Dict[str, Any],
    output_path: str,
) -> plt.Figure:
    """Generate Figure 4: Example selection strategy line chart.

    One line per example strategy across 6 query categories on the
    x-axis, with RC accuracy on the y-axis.  Distinct markers and line
    styles differentiate the strategies.

    Args:
        results_dict: Expected structure::

            {
                "strategies": ["Zero-shot", "Static", "Dynamic",
                               "Schema-matched"],
                "categories": ["Simple SELECT", "Aggregation", ...],
                "data": {
                    "Zero-shot": {
                        "Simple SELECT": <float_or_bool_list>,
                        "Aggregation": ...,
                        ...
                    },
                    "Static": { ... },
                    ...
                }
            }

        output_path: File path (without extension) for saving.

    Returns:
        The matplotlib ``Figure`` object.
    """
    strategies = results_dict.get(
        "strategies", list(results_dict.get("data", {}).keys())
    )
    categories = results_dict.get(
        "categories",
        [
            "Simple SELECT",
            "Aggregation",
            "Window Functions",
            "Time-Series",
            "Complex JOINs",
            "ClickHouse-Specific",
        ],
    )
    data = results_dict.get("data", {})

    if not data:
        fig = _placeholder_figure("Figure 4: No strategy data available")
        _save_figure(fig, output_path)
        return fig

    n_cats = len(categories)
    x = np.arange(n_cats)

    fig, ax = plt.subplots(
        figsize=(DOUBLE_COL_WIDTH, DOUBLE_COL_WIDTH / GOLDEN_RATIO / 1.2)
    )

    for s_idx, strategy in enumerate(strategies):
        strat_data = data.get(strategy, {})
        values = []
        for cat in categories:
            if cat in strat_data:
                values.append(_extract_rc_pct(strat_data[cat]))
            else:
                values.append(np.nan)

        color = _CB_PALETTE[s_idx % len(_CB_PALETTE)]
        marker = _MARKERS[s_idx % len(_MARKERS)]
        linestyle = _LINESTYLES[s_idx % len(_LINESTYLES)]

        ax.plot(
            x,
            values,
            marker=marker,
            linestyle=linestyle,
            color=color,
            linewidth=1.8,
            markersize=7,
            label=strategy,
            markeredgecolor="white",
            markeredgewidth=0.5,
        )

    ax.set_xticks(x)
    ax.set_xticklabels(categories, rotation=25, ha="right")
    ax.set_ylabel("Result Correctness (%)")
    ax.set_xlabel("Query Category")
    ax.set_ylim(0, 105)
    ax.yaxis.set_major_locator(mticker.MultipleLocator(20))
    ax.yaxis.set_minor_locator(mticker.MultipleLocator(10))
    ax.set_axisbelow(True)
    ax.grid(axis="y", alpha=0.3, linewidth=0.5)
    ax.legend(loc="best", framealpha=0.9)
    ax.set_title(
        "Figure 4: Example Selection Strategy Comparison",
        fontweight="bold",
        pad=10,
    )

    fig.tight_layout()
    _save_figure(fig, output_path)
    return fig


# ---------------------------------------------------------------------------
# Figure 5 -- Interaction Effects Matrix (heatmap)
# ---------------------------------------------------------------------------


def plot_interaction_matrix(
    results_dict: Dict[str, Any],
    output_path: str,
) -> plt.Figure:
    """Generate Figure 5: Interaction effects heatmap.

    Displays a matrix of interaction effects (e.g., Format x Scope or
    Metadata x Examples).  Each cell shows the delta between observed
    combined accuracy and the expected additive accuracy, highlighting
    synergies (positive) and redundancies (negative).

    Args:
        results_dict: Expected structure::

            {
                "row_labels": ["CREATE TABLE", "Markdown", "JSON",
                               "Natural Language"],
                "col_labels": ["Full", "Relevant Subset", "Progressive",
                               "User-Guided"],
                "observed": {
                    "CREATE TABLE": {
                        "Full": <float_pct>, "Relevant Subset": ..., ...
                    },
                    ...
                },
                "expected": {
                    "CREATE TABLE": {
                        "Full": <float_pct>, ...
                    },
                    ...
                },
                "row_axis_label": "Schema Format",
                "col_axis_label": "Schema Scope",
            }

            Cell delta = observed - expected.

        output_path: File path (without extension) for saving.

    Returns:
        The matplotlib ``Figure`` object.
    """
    row_labels = results_dict.get("row_labels", [])
    col_labels = results_dict.get("col_labels", [])
    observed = results_dict.get("observed", {})
    expected = results_dict.get("expected", {})
    row_axis_label = results_dict.get("row_axis_label", "Factor A")
    col_axis_label = results_dict.get("col_axis_label", "Factor B")

    if not row_labels or not col_labels or not observed:
        fig = _placeholder_figure("Figure 5: No interaction data available")
        _save_figure(fig, output_path)
        return fig

    n_rows = len(row_labels)
    n_cols = len(col_labels)

    delta_matrix = np.full((n_rows, n_cols), np.nan)
    for i, rl in enumerate(row_labels):
        obs_row = observed.get(rl, {})
        exp_row = expected.get(rl, {})
        for j, cl in enumerate(col_labels):
            obs_val = obs_row.get(cl)
            exp_val = exp_row.get(cl)
            if obs_val is not None and exp_val is not None:
                delta_matrix[i, j] = float(obs_val) - float(exp_val)

    fig, ax = plt.subplots(
        figsize=(SINGLE_COL_WIDTH * 1.6, SINGLE_COL_WIDTH * 1.2)
    )

    # Diverging colormap centered at 0
    abs_max = np.nanmax(np.abs(delta_matrix)) if not np.all(np.isnan(delta_matrix)) else 5.0
    limit = max(abs_max, 1.0)  # Avoid degenerate color scale

    sns.heatmap(
        delta_matrix,
        annot=True,
        fmt="+.1f",
        cmap="RdBu_r",
        center=0,
        vmin=-limit,
        vmax=limit,
        xticklabels=col_labels,
        yticklabels=row_labels,
        linewidths=1.0,
        linecolor="white",
        cbar_kws={
            "label": "Delta vs. Additive Expectation (pp)",
            "shrink": 0.85,
        },
        annot_kws={"fontsize": 9, "fontweight": "bold"},
        ax=ax,
    )

    ax.set_xlabel(col_axis_label, labelpad=8)
    ax.set_ylabel(row_axis_label, labelpad=8)
    ax.set_title(
        "Figure 5: Interaction Effects\n"
        f"({row_axis_label} $\\times$ {col_axis_label})",
        fontweight="bold",
        pad=10,
    )
    plt.xticks(rotation=25, ha="right")
    plt.yticks(rotation=0)
    fig.tight_layout()
    _save_figure(fig, output_path)
    return fig


# ---------------------------------------------------------------------------
# Figure 6 -- Ablation Study (waterfall / horizontal bar chart)
# ---------------------------------------------------------------------------


def plot_ablation_waterfall(
    results_dict: Dict[str, Any],
    output_path: str,
) -> plt.Figure:
    """Generate Figure 6: Ablation study waterfall chart.

    Shows the progressive contribution of each component to overall
    accuracy, starting from a baseline and adding components one at a
    time.  Implemented as a horizontal bar chart for readability.

    Args:
        results_dict: Expected structure (ordered from baseline to best)::

            {
                "components": [
                    {"name": "Baseline",          "RC": <float_pct>},
                    {"name": "+ Schema Pruning",   "RC": <float_pct>},
                    {"name": "+ Descriptions",     "RC": <float_pct>},
                    {"name": "+ Sample Values",    "RC": <float_pct>},
                    {"name": "+ Dynamic Examples",  "RC": <float_pct>},
                    {"name": "Full Best",          "RC": <float_pct>},
                ]
            }

            Alternatively, a flat dict ``{"Baseline": float, ...}`` is
            accepted (ordering by value ascending).

        output_path: File path (without extension) for saving.

    Returns:
        The matplotlib ``Figure`` object.
    """
    # Normalize input
    components_list = results_dict.get("components", None)
    if components_list is None:
        # Flat dict fallback
        flat = {
            k: v
            for k, v in results_dict.items()
            if k != "components" and not k.startswith("_")
        }
        if not flat:
            fig = _placeholder_figure("Figure 6: No ablation data available")
            _save_figure(fig, output_path)
            return fig
        # Convert values
        items = []
        for name, val in flat.items():
            items.append({"name": name, "RC": _extract_rc_pct(val) if not isinstance(val, (int, float)) or val <= 1.0 else float(val)})
        # Sort ascending by RC so the waterfall goes up
        items.sort(key=lambda d: d["RC"])
        components_list = items

    if not components_list:
        fig = _placeholder_figure("Figure 6: No ablation data available")
        _save_figure(fig, output_path)
        return fig

    names = [c["name"] for c in components_list]
    values = [float(c["RC"]) for c in components_list]
    n = len(names)

    fig, ax = plt.subplots(
        figsize=(DOUBLE_COL_WIDTH, max(2.5, 0.45 * n + 1.0))
    )

    # Compute deltas for the waterfall segments
    deltas = [values[0]]  # first bar starts from 0
    for i in range(1, n):
        deltas.append(values[i] - values[i - 1])

    # Compute left edge for each bar (cumulative start)
    starts = [0.0]
    for i in range(1, n):
        starts.append(values[i - 1])

    y_pos = np.arange(n)

    # Color: baseline/total in blue, increments in green, decrements in red
    colors = []
    for i, d in enumerate(deltas):
        if i == 0 or i == n - 1:
            colors.append(_CB_PALETTE[0])  # blue for baseline / total
        elif d >= 0:
            colors.append(_CB_PALETTE[2])  # green for positive contribution
        else:
            colors.append(_CB_PALETTE[5])  # vermillion for negative

    bars = ax.barh(
        y_pos,
        deltas,
        left=starts,
        color=colors,
        edgecolor="white",
        linewidth=0.6,
        height=0.6,
        alpha=0.85,
    )

    # Annotate each bar with delta and cumulative value
    for i, (bar, delta, cumulative) in enumerate(zip(bars, deltas, values)):
        # Cumulative value at the right end
        ax.annotate(
            f"{cumulative:.1f}%",
            xy=(cumulative, bar.get_y() + bar.get_height() / 2),
            xytext=(4, 0),
            textcoords="offset points",
            ha="left",
            va="center",
            fontsize=8,
            fontweight="bold",
        )
        # Delta label inside or beside the bar (for non-baseline)
        if i > 0:
            mid_x = starts[i] + delta / 2
            ax.annotate(
                f"{delta:+.1f}",
                xy=(mid_x, bar.get_y() + bar.get_height() / 2),
                ha="center",
                va="center",
                fontsize=7,
                color="white" if abs(delta) > 3 else "0.3",
                fontweight="bold",
            )

    # Connector lines between bars
    for i in range(n - 1):
        ax.plot(
            [values[i], values[i]],
            [y_pos[i] + 0.3, y_pos[i + 1] - 0.3],
            color="0.6",
            linewidth=0.6,
            linestyle=":",
        )

    ax.set_yticks(y_pos)
    ax.set_yticklabels(names)
    ax.set_xlabel("Result Correctness (%)")
    ax.set_title(
        "Figure 6: Ablation Study -- Component Contributions",
        fontweight="bold",
        pad=10,
    )
    ax.set_xlim(0, max(values) * 1.15)
    ax.xaxis.set_major_locator(mticker.MultipleLocator(10))
    ax.set_axisbelow(True)
    ax.grid(axis="x", alpha=0.3, linewidth=0.5)
    ax.invert_yaxis()  # baseline at top

    fig.tight_layout()
    _save_figure(fig, output_path)
    return fig



def plot_ablation_prompt_waterfall(
    results_dict: Dict[str, Any],
    output_path: str,
) -> plt.Figure:
    """Generate a prompt ablation waterfall chart.

    Shows the progressive contribution of each prompt component to overall
    accuracy, starting from a minimal prompt and adding components.

    Args:
        results_dict: Expected structure (ordered from minimal to full)::

            {
                "components": [
                    {"name": "Minimal",                    "RC": <float_pct>},
                    {"name": "+ ClickHouse Dialect",       "RC": <float_pct>},
                    {"name": "+ JOIN Guidance",             "RC": <float_pct>},
                    {"name": "+ Window Functions",          "RC": <float_pct>},
                    {"name": "Full V6 Prompt",             "RC": <float_pct>},
                ]
            }

        output_path: File path (without extension) for saving.

    Returns:
        The matplotlib Figure object.
    """
    # Reuse the existing waterfall chart implementation
    return plot_ablation_waterfall(results_dict, output_path)

# ---------------------------------------------------------------------------
# Generate all figures
# ---------------------------------------------------------------------------


def generate_all_figures(
    results_dir: str,
    output_dir: str,
) -> Dict[str, plt.Figure]:
    """Load processed results and generate all 6 figures.

    Looks for JSON files in *results_dir* with the following names
    (any missing file is skipped with a warning):

        - ``rq1_format_comparison.json``
        - ``rq2_scope_comparison.json``
        - ``rq3_metadata_heatmap.json``
        - ``rq4_example_comparison.json``
        - ``interaction_matrix.json``
        - ``ablation_waterfall.json``

    Args:
        results_dir: Directory containing processed experiment results
            as JSON files.
        output_dir: Directory where figures will be saved (created if
            it does not exist).

    Returns:
        Dict mapping figure name to the matplotlib ``Figure`` object.
    """
    setup_vldb_style()

    results_path = Path(results_dir)
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    figures: Dict[str, plt.Figure] = {}

    mapping = [
        ("rq1_format_comparison.json", "fig1_format_comparison", plot_format_comparison),
        ("rq2_scope_comparison.json", "fig2_scope_comparison", plot_scope_comparison),
        ("rq3_metadata_heatmap.json", "fig3_metadata_heatmap", plot_metadata_heatmap),
        ("rq4_example_comparison.json", "fig4_example_comparison", plot_example_comparison),
        ("interaction_matrix.json", "fig5_interaction_matrix", plot_interaction_matrix),
        ("ablation_waterfall.json", "fig6_ablation_waterfall", plot_ablation_waterfall),
    ]

    for json_name, fig_name, plot_fn in mapping:
        json_path = results_path / json_name
        if json_path.exists():
            logger.info("Loading %s", json_path)
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            fig_output = str(out_path / fig_name)
            try:
                fig = plot_fn(data, fig_output)
                figures[fig_name] = fig
                logger.info("Generated %s", fig_name)
            except Exception:
                logger.exception("Failed to generate %s", fig_name)
        else:
            logger.warning(
                "Results file not found: %s -- skipping %s", json_path, fig_name
            )

    logger.info(
        "Generated %d/%d figures. Saved to %s", len(figures), 6, out_path
    )
    return figures


# ---------------------------------------------------------------------------
# Backward-compatible class wrapper (used by __init__.py)
# ---------------------------------------------------------------------------


class PaperVisualizations:
    """Class-based wrapper around the module-level plotting functions.

    Maintains backward compatibility with code that imports
    ``PaperVisualizations`` from the analysis package.

    Attributes:
        results_dir: Path to directory containing processed results.
        output_dir: Path to directory where figures are saved.
    """

    SINGLE_COL_WIDTH = SINGLE_COL_WIDTH
    DOUBLE_COL_WIDTH = DOUBLE_COL_WIDTH

    def __init__(self, results_dir: str, output_dir: str) -> None:
        self.results_dir = Path(results_dir)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        setup_vldb_style()

    def _out(self, name: str) -> str:
        """Return the full output path (without extension) for *name*."""
        return str(self.output_dir / name)

    def fig1_format_comparison(self, results: Dict[str, Any]) -> plt.Figure:
        """Delegate to :func:`plot_format_comparison`."""
        return plot_format_comparison(results, self._out("fig1_format_comparison"))

    def fig2_scope_comparison(self, results: Dict[str, Any]) -> plt.Figure:
        """Delegate to :func:`plot_scope_comparison`."""
        return plot_scope_comparison(results, self._out("fig2_scope_comparison"))

    def fig3_metadata_heatmap(self, results: Dict[str, Any]) -> plt.Figure:
        """Delegate to :func:`plot_metadata_heatmap`."""
        return plot_metadata_heatmap(results, self._out("fig3_metadata_heatmap"))

    def fig4_example_comparison(self, results: Dict[str, Any]) -> plt.Figure:
        """Delegate to :func:`plot_example_comparison`."""
        return plot_example_comparison(results, self._out("fig4_example_comparison"))

    def fig5_interaction_matrix(self, results: Dict[str, Any]) -> plt.Figure:
        """Delegate to :func:`plot_interaction_matrix`."""
        return plot_interaction_matrix(results, self._out("fig5_interaction_matrix"))

    def fig6_ablation_waterfall(self, results: Dict[str, Any]) -> plt.Figure:
        """Delegate to :func:`plot_ablation_waterfall`."""
        return plot_ablation_waterfall(results, self._out("fig6_ablation_waterfall"))

    def generate_all(self, results: Dict[str, Any]) -> Dict[str, plt.Figure]:
        """Generate all 6 figures from a master results dict.

        Args:
            results: Dict with top-level keys matching each figure::

                {
                    "format_comparison": { ... },
                    "scope_comparison": { ... },
                    "metadata_heatmap": { ... },
                    "example_comparison": { ... },
                    "interaction_matrix": { ... },
                    "ablation": { ... },
                }

        Returns:
            Dict mapping figure name to ``Figure`` object.
        """
        figures: Dict[str, plt.Figure] = {}

        dispatch = [
            ("format_comparison", "fig1_format_comparison", plot_format_comparison),
            ("scope_comparison", "fig2_scope_comparison", plot_scope_comparison),
            ("metadata_heatmap", "fig3_metadata_heatmap", plot_metadata_heatmap),
            ("example_comparison", "fig4_example_comparison", plot_example_comparison),
            ("interaction_matrix", "fig5_interaction_matrix", plot_interaction_matrix),
            ("ablation", "fig6_ablation_waterfall", plot_ablation_waterfall),
        ]

        for data_key, fig_name, plot_fn in dispatch:
            if data_key in results:
                logger.info("Generating %s", fig_name)
                try:
                    fig = plot_fn(results[data_key], self._out(fig_name))
                    figures[fig_name] = fig
                except Exception:
                    logger.exception("Failed to generate %s", fig_name)
            else:
                logger.warning(
                    "Missing data key '%s' -- skipping %s", data_key, fig_name
                )

        logger.info(
            "Generated %d/%d figures. Saved to %s",
            len(figures),
            6,
            self.output_dir,
        )
        return figures


# ---------------------------------------------------------------------------
# Main: generate sample figures with synthetic data for testing
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import tempfile

    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    rng = np.random.RandomState(42)
    n = 150  # queries per configuration

    setup_vldb_style()

    with tempfile.TemporaryDirectory() as tmpdir:
        logger.info("Generating sample figures in %s", tmpdir)

        # ==================================================================
        # Figure 1: Schema Format Comparison
        # ==================================================================
        fmt_results = {
            "models": {
                "Sonnet": {
                    "CREATE TABLE": {
                        "EX": rng.binomial(1, 0.85, n).astype(bool).tolist(),
                        "RC": rng.binomial(1, 0.72, n).astype(bool).tolist(),
                    },
                    "Markdown": {
                        "EX": rng.binomial(1, 0.88, n).astype(bool).tolist(),
                        "RC": rng.binomial(1, 0.78, n).astype(bool).tolist(),
                    },
                    "JSON": {
                        "EX": rng.binomial(1, 0.82, n).astype(bool).tolist(),
                        "RC": rng.binomial(1, 0.70, n).astype(bool).tolist(),
                    },
                    "Natural Language": {
                        "EX": rng.binomial(1, 0.75, n).astype(bool).tolist(),
                        "RC": rng.binomial(1, 0.65, n).astype(bool).tolist(),
                    },
                },
                "Haiku": {
                    "CREATE TABLE": {
                        "EX": rng.binomial(1, 0.78, n).astype(bool).tolist(),
                        "RC": rng.binomial(1, 0.62, n).astype(bool).tolist(),
                    },
                    "Markdown": {
                        "EX": rng.binomial(1, 0.80, n).astype(bool).tolist(),
                        "RC": rng.binomial(1, 0.68, n).astype(bool).tolist(),
                    },
                    "JSON": {
                        "EX": rng.binomial(1, 0.74, n).astype(bool).tolist(),
                        "RC": rng.binomial(1, 0.60, n).astype(bool).tolist(),
                    },
                    "Natural Language": {
                        "EX": rng.binomial(1, 0.68, n).astype(bool).tolist(),
                        "RC": rng.binomial(1, 0.55, n).astype(bool).tolist(),
                    },
                },
            }
        }
        fig1 = plot_format_comparison(
            fmt_results, os.path.join(tmpdir, "fig1_format_comparison")
        )
        plt.close(fig1)

        # ==================================================================
        # Figure 2: Schema Scope Comparison
        # ==================================================================
        scope_results = {
            "models": {
                "Sonnet": {
                    "Full": {
                        "RC": rng.binomial(1, 0.68, n).astype(bool).tolist(),
                        "TE": rng.normal(2800, 200, n).tolist(),
                    },
                    "Relevant Subset": {
                        "RC": rng.binomial(1, 0.80, n).astype(bool).tolist(),
                        "TE": rng.normal(1200, 150, n).tolist(),
                    },
                    "Progressive": {
                        "RC": rng.binomial(1, 0.76, n).astype(bool).tolist(),
                        "TE": rng.normal(1600, 180, n).tolist(),
                    },
                    "User-Guided": {
                        "RC": rng.binomial(1, 0.82, n).astype(bool).tolist(),
                        "TE": rng.normal(900, 100, n).tolist(),
                    },
                },
                "Haiku": {
                    "Full": {
                        "RC": rng.binomial(1, 0.60, n).astype(bool).tolist(),
                        "TE": rng.normal(2800, 200, n).tolist(),
                    },
                    "Relevant Subset": {
                        "RC": rng.binomial(1, 0.72, n).astype(bool).tolist(),
                        "TE": rng.normal(1200, 150, n).tolist(),
                    },
                    "Progressive": {
                        "RC": rng.binomial(1, 0.68, n).astype(bool).tolist(),
                        "TE": rng.normal(1600, 180, n).tolist(),
                    },
                    "User-Guided": {
                        "RC": rng.binomial(1, 0.74, n).astype(bool).tolist(),
                        "TE": rng.normal(900, 100, n).tolist(),
                    },
                },
            }
        }
        fig2 = plot_scope_comparison(
            scope_results, os.path.join(tmpdir, "fig2_scope_comparison")
        )
        plt.close(fig2)

        # ==================================================================
        # Figure 3: Metadata Enrichment Heatmap
        # ==================================================================
        metadata_levels = [
            "None",
            "Descriptions",
            "Sample Values",
            "Statistics",
            "All",
        ]
        categories = [
            "Simple SELECT",
            "Aggregation",
            "Window Functions",
            "Time-Series",
            "Complex JOINs",
            "ClickHouse-Specific",
        ]
        meta_matrix = {}
        for lvl_idx, lvl in enumerate(metadata_levels):
            meta_matrix[lvl] = {}
            for cat_idx, cat in enumerate(categories):
                # Accuracy generally improves with more metadata, harder
                # categories get lower scores
                base = 50 + lvl_idx * 6 - cat_idx * 3
                meta_matrix[lvl][cat] = float(
                    np.clip(base + rng.normal(0, 4), 30, 95)
                )

        fig3 = plot_metadata_heatmap(
            {
                "metadata_levels": metadata_levels,
                "categories": categories,
                "matrix": meta_matrix,
            },
            os.path.join(tmpdir, "fig3_metadata_heatmap"),
        )
        plt.close(fig3)

        # ==================================================================
        # Figure 4: Example Selection
        # ==================================================================
        strategies = ["Zero-shot", "Static", "Dynamic", "Schema-matched"]
        example_data = {}
        base_rates = [0.65, 0.70, 0.78, 0.82]
        for s_idx, strat in enumerate(strategies):
            example_data[strat] = {}
            for cat in categories:
                cat_penalty = categories.index(cat) * 3
                rc = np.clip(
                    base_rates[s_idx] * 100 - cat_penalty + rng.normal(0, 3),
                    30,
                    95,
                )
                example_data[strat][cat] = float(rc)

        fig4 = plot_example_comparison(
            {
                "strategies": strategies,
                "categories": categories,
                "data": example_data,
            },
            os.path.join(tmpdir, "fig4_example_comparison"),
        )
        plt.close(fig4)

        # ==================================================================
        # Figure 5: Interaction Effects Matrix
        # ==================================================================
        formats = ["CREATE TABLE", "Markdown", "JSON", "Natural Language"]
        scopes = ["Full", "Relevant Subset", "Progressive", "User-Guided"]

        observed = {}
        expected = {}
        for fmt in formats:
            observed[fmt] = {}
            expected[fmt] = {}
            for scope in scopes:
                obs = float(rng.uniform(55, 85))
                exp = obs + rng.normal(0, 4)
                observed[fmt][scope] = round(obs, 1)
                expected[fmt][scope] = round(exp, 1)

        fig5 = plot_interaction_matrix(
            {
                "row_labels": formats,
                "col_labels": scopes,
                "observed": observed,
                "expected": expected,
                "row_axis_label": "Schema Format",
                "col_axis_label": "Schema Scope",
            },
            os.path.join(tmpdir, "fig5_interaction_matrix"),
        )
        plt.close(fig5)

        # ==================================================================
        # Figure 6: Ablation Study Waterfall
        # ==================================================================
        ablation_data = {
            "components": [
                {"name": "Baseline", "RC": 58.3},
                {"name": "+ Schema Pruning", "RC": 64.5},
                {"name": "+ Descriptions", "RC": 71.2},
                {"name": "+ Sample Values", "RC": 73.8},
                {"name": "+ Dynamic Examples", "RC": 76.9},
                {"name": "Full Best", "RC": 78.5},
            ]
        }
        fig6 = plot_ablation_waterfall(
            ablation_data, os.path.join(tmpdir, "fig6_ablation_waterfall")
        )
        plt.close(fig6)

        # ==================================================================
        # Summary
        # ==================================================================
        print(f"\nAll 6 sample figures saved to: {tmpdir}")
        for f in sorted(Path(tmpdir).glob("fig*")):
            size_kb = f.stat().st_size / 1024
            print(f"  {f.name:40s} {size_kb:8.1f} KB")

        # Also test the class-based API for backward compatibility
        print("\nTesting PaperVisualizations class wrapper...")
        viz = PaperVisualizations(results_dir=tmpdir, output_dir=tmpdir)
        all_figs = viz.generate_all(
            {
                "format_comparison": fmt_results,
                "scope_comparison": scope_results,
                "metadata_heatmap": {
                    "metadata_levels": metadata_levels,
                    "categories": categories,
                    "matrix": meta_matrix,
                },
                "example_comparison": {
                    "strategies": strategies,
                    "categories": categories,
                    "data": example_data,
                },
                "interaction_matrix": {
                    "row_labels": formats,
                    "col_labels": scopes,
                    "observed": observed,
                    "expected": expected,
                    "row_axis_label": "Schema Format",
                    "col_axis_label": "Schema Scope",
                },
                "ablation": ablation_data,
            }
        )
        print(f"Class wrapper generated {len(all_figs)} figures")
        for name in sorted(all_figs):
            print(f"  {name}")
