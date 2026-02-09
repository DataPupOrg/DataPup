#!/usr/bin/env python3
"""Generate publication-quality figures and LaTeX tables from Phase 1 & Phase 2 results.

Reads JSONL result files, constructs the data structures expected by the
visualization and LaTeX table modules, and produces all outputs for the
VLDB 2026 paper.

Usage:
    python3 evaluation/generate_publication_outputs.py
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from evaluation.analysis.visualizations import (
    setup_vldb_style,
    plot_format_comparison,
    plot_scope_comparison,
    plot_metadata_heatmap,
    plot_example_comparison,
    plot_ablation_waterfall,
    _save_figure,
)
from evaluation.analysis.latex_tables import (
    generate_format_comparison_table,
    generate_scope_comparison_table,
    generate_metadata_table,
    generate_example_table,
    generate_statistical_significance_table,
)
from evaluation.analysis.latex_tables import generate_ci_summary_table

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PHASE1_DIR = PROJECT_ROOT / "evaluation" / "results" / "phase1"
PHASE2_DIR = PROJECT_ROOT / "evaluation" / "results" / "phase2"
FIGURES_DIR = PROJECT_ROOT / "evaluation" / "results" / "figures"
TABLES_DIR = PROJECT_ROOT / "evaluation" / "results" / "tables"
RESULTS_DIR = PROJECT_ROOT / "evaluation" / "results"
STATS_PATH = PROJECT_ROOT / "evaluation" / "results" / "statistical_analysis.json"
REPEATED_TRIALS_DIR = PROJECT_ROOT / "evaluation" / "results" / "repeated_trials"

# Category display labels and order
CATEGORY_ORDER = [
    "Simple SELECT",
    "Aggregation",
    "Time-Series",
    "Complex JOINs",
    "Window Functions",
    "ClickHouse-Specific",
]

CATEGORY_MAP = {
    "simple_select": "Simple SELECT",
    "Simple-SELECT": "Simple SELECT",
    "Simple SELECT": "Simple SELECT",
    "aggregation": "Aggregation",
    "Aggregation": "Aggregation",
    "time_series": "Time-Series",
    "Time_Series": "Time-Series",
    "Time-Series": "Time-Series",
    "complex_joins": "Complex JOINs",
    "Complex_JOINs": "Complex JOINs",
    "Complex JOINs": "Complex JOINs",
    "window_functions": "Window Functions",
    "Window_Functions": "Window Functions",
    "Window Functions": "Window Functions",
    "clickhouse_specific": "ClickHouse-Specific",
    "ClickHouse_Specific": "ClickHouse-Specific",
    "ClickHouse-Specific": "ClickHouse-Specific",
}

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def load_jsonl(path: Path) -> list[dict]:
    """Load JSONL file into list of dicts."""
    records = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def extract_vectors(records: list[dict]) -> dict:
    """Extract EX, RC boolean vectors and continuous metric vectors."""
    ex = [bool(r.get("pred_executed", False)) for r in records]
    rc = [bool(r.get("result_match", False)) for r in records]
    input_tokens = [r.get("input_tokens", 0) for r in records]
    output_tokens = [r.get("output_tokens", 0) for r in records]
    latency_ms = [r.get("latency_ms", 0.0) for r in records]
    return {
        "EX": ex,
        "RC": rc,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "latency_ms": latency_ms,
        "TE": input_tokens,  # Token Efficiency = prompt tokens
    }


def rc_by_category(records: list[dict]) -> dict[str, float]:
    """Compute RC percentage by category."""
    cat_correct: dict[str, int] = {}
    cat_total: dict[str, int] = {}
    for r in records:
        cat_raw = r.get("category", "Unknown")
        cat = CATEGORY_MAP.get(cat_raw, cat_raw)
        cat_total[cat] = cat_total.get(cat, 0) + 1
        if r.get("result_match", False):
            cat_correct[cat] = cat_correct.get(cat, 0) + 1
    result = {}
    for cat in CATEGORY_ORDER:
        total = cat_total.get(cat, 0)
        correct = cat_correct.get(cat, 0)
        if total > 0:
            result[cat] = (correct / total) * 100.0
    return result


def load_repeated_trials_analysis() -> dict | None:
    """Load repeated trials analysis if available."""
    analysis_path = REPEATED_TRIALS_DIR / "repeated_trials_analysis.json"
    if not analysis_path.exists():
        logger.info("No repeated trials analysis found at %s", analysis_path)
        return None
    with open(analysis_path) as f:
        return json.load(f)

# ---------------------------------------------------------------------------
# Figure 1: Schema Format Comparison (Phase 1)
# ---------------------------------------------------------------------------


def generate_figure1():
    """RQ1: Schema format comparison - grouped bar chart."""
    configs = {
        "CREATE TABLE": PHASE1_DIR / "ddl_full_none_zero_shot_results.jsonl",
        "Markdown": PHASE1_DIR / "markdown_full_none_zero_shot_results.jsonl",
        "JSON": PHASE1_DIR / "json_full_none_zero_shot_results.jsonl",
        "Natural Language": PHASE1_DIR / "natural_language_full_none_zero_shot_results.jsonl",
    }

    models_data = {}
    for name, path in configs.items():
        if path.exists():
            records = load_jsonl(path)
            models_data[name] = extract_vectors(records)
        else:
            logger.warning("Missing: %s", path)

    if not models_data:
        logger.warning("No Phase 1 data found, skipping Figure 1")
        return None

    results_dict = {"models": {"Sonnet 3.5": models_data}}
    output = str(FIGURES_DIR / "fig1_format_comparison")
    fig = plot_format_comparison(results_dict, output)
    plt.close(fig)
    logger.info("Generated Figure 1: Schema Format Comparison")
    return fig


# ---------------------------------------------------------------------------
# Figure 2: Schema Scope Comparison (Phase 2 - RQ2)
# ---------------------------------------------------------------------------


def generate_figure2():
    """RQ2: Schema scope comparison - grouped bar with token overlay."""
    configs = {
        "Full": PHASE2_DIR / "markdown_full_none_zero_shot_results.jsonl",
        "Relevant Subset": PHASE2_DIR / "markdown_relevant_subset_none_zero_shot_results.jsonl",
        "Progressive": PHASE2_DIR / "markdown_progressive_none_zero_shot_results.jsonl",
        "User-Guided": PHASE2_DIR / "markdown_user_guided_none_zero_shot_results.jsonl",
    }

    models_data = {}
    for name, path in configs.items():
        if path.exists():
            records = load_jsonl(path)
            vectors = extract_vectors(records)
            models_data[name] = vectors
        else:
            logger.warning("Missing: %s", path)

    if not models_data:
        logger.warning("No Phase 2 RQ2 data found, skipping Figure 2")
        return None

    results_dict = {"models": {"Sonnet 3.5": models_data}}
    output = str(FIGURES_DIR / "fig2_scope_comparison")
    fig = plot_scope_comparison(results_dict, output)
    plt.close(fig)
    logger.info("Generated Figure 2: Schema Scope Comparison")
    return fig


# ---------------------------------------------------------------------------
# Figure 3: Metadata Enrichment Heatmap (Phase 2 - RQ3)
# ---------------------------------------------------------------------------


def generate_figure3():
    """RQ3: Metadata enrichment heatmap - RC by metadata level x category."""
    configs = {
        "None": PHASE2_DIR / "markdown_user_guided_none_zero_shot_results.jsonl",
        "Descriptions": PHASE2_DIR / "markdown_user_guided_descriptions_zero_shot_results.jsonl",
        "Sample Values": PHASE2_DIR / "markdown_user_guided_sample_values_zero_shot_results.jsonl",
        "Statistics": PHASE2_DIR / "markdown_user_guided_statistics_zero_shot_results.jsonl",
        "All Combined": PHASE2_DIR / "markdown_user_guided_all_zero_shot_results.jsonl",
    }

    metadata_levels = list(configs.keys())
    matrix: dict[str, dict[str, float]] = {}

    for level_name, path in configs.items():
        if path.exists():
            records = load_jsonl(path)
            cat_rc = rc_by_category(records)
            matrix[level_name] = cat_rc
        else:
            logger.warning("Missing: %s", path)

    if not matrix:
        logger.warning("No Phase 2 RQ3 data found, skipping Figure 3")
        return None

    results_dict = {
        "metadata_levels": metadata_levels,
        "categories": CATEGORY_ORDER,
        "matrix": matrix,
    }
    output = str(FIGURES_DIR / "fig3_metadata_heatmap")
    fig = plot_metadata_heatmap(results_dict, output)
    plt.close(fig)
    logger.info("Generated Figure 3: Metadata Enrichment Heatmap")
    return fig


# ---------------------------------------------------------------------------
# Figure 4: Example Selection Comparison (Phase 2 - RQ4)
# ---------------------------------------------------------------------------


def generate_figure4():
    """RQ4: Example selection strategies - line chart across categories."""
    configs = {
        "Zero-Shot": PHASE2_DIR / "markdown_user_guided_none_zero_shot_results.jsonl",
        "Static Few-Shot": PHASE2_DIR / "markdown_user_guided_none_static_few_shot_results.jsonl",
        "Dynamic Few-Shot": PHASE2_DIR / "markdown_user_guided_none_dynamic_few_shot_results.jsonl",
        "Schema-Matched": PHASE2_DIR / "markdown_user_guided_none_schema_matched_results.jsonl",
    }

    data: dict[str, dict[str, float]] = {}

    for strat_name, path in configs.items():
        if path.exists():
            records = load_jsonl(path)
            cat_rc = rc_by_category(records)
            data[strat_name] = cat_rc
        else:
            logger.warning("Missing: %s", path)

    if not data:
        logger.warning("No Phase 2 RQ4 data found, skipping Figure 4")
        return None

    results_dict = {
        "strategies": list(data.keys()),
        "categories": CATEGORY_ORDER,
        "data": data,
    }
    output = str(FIGURES_DIR / "fig4_example_comparison")
    fig = plot_example_comparison(results_dict, output)
    plt.close(fig)
    logger.info("Generated Figure 4: Example Selection Comparison")
    return fig


# ---------------------------------------------------------------------------
# Figure 5: Ablation Waterfall (progression from baseline to best)
# ---------------------------------------------------------------------------


def generate_figure5():
    """Ablation waterfall: progression from Phase 1 baseline to V4 best."""
    # Build the ablation progression from actual results
    components = []

    # Phase 1 baseline: markdown_full_none_zero_shot (original)
    p1_path = PHASE1_DIR / "markdown_full_none_zero_shot_results.jsonl"
    if p1_path.exists():
        records = load_jsonl(p1_path)
        rc = sum(1 for r in records if r.get("result_match")) / len(records) * 100
        components.append({"name": "Phase 1 Baseline\n(Markdown, Full, None, Zero-Shot)", "RC": round(rc, 1)})

    # V4 configs showing the progressive improvement
    v4_configs = [
        ("+ Comparator Fixes\n(Column Alignment, Fuzzy Match)", PHASE2_DIR / "markdown_full_none_zero_shot_results.jsonl"),
    ]

    for label, path in v4_configs:
        if path.exists():
            records = load_jsonl(path)
            rc = sum(1 for r in records if r.get("result_match")) / len(records) * 100
            components.append({"name": label, "RC": round(rc, 1)})

    # RQ2 best: user_guided
    ug_path = PHASE2_DIR / "markdown_user_guided_none_zero_shot_results.jsonl"
    if ug_path.exists():
        records = load_jsonl(ug_path)
        rc = sum(1 for r in records if r.get("result_match")) / len(records) * 100
        components.append({"name": "+ User-Guided Scope", "RC": round(rc, 1)})

    # RQ4 best: dynamic_few_shot
    dfs_path = PHASE2_DIR / "markdown_user_guided_none_dynamic_few_shot_results.jsonl"
    if dfs_path.exists():
        records = load_jsonl(dfs_path)
        rc = sum(1 for r in records if r.get("result_match")) / len(records) * 100
        components.append({"name": "+ Dynamic Few-Shot", "RC": round(rc, 1)})

    if len(components) < 2:
        logger.warning("Insufficient data for ablation figure, skipping Figure 5")
        return None

    results_dict = {"components": components}
    output = str(FIGURES_DIR / "fig5_ablation_waterfall")
    fig = plot_ablation_waterfall(results_dict, output)
    plt.close(fig)
    logger.info("Generated Figure 5: Ablation Waterfall")
    return fig


# ---------------------------------------------------------------------------
# Figure: Prompt Ablation Waterfall
# ---------------------------------------------------------------------------


def generate_figure_ablation_prompt():
    """Generate prompt ablation waterfall chart from ablation results."""
    ablation_dir = RESULTS_DIR.parent / "results" / "ablation"
    
    versions = [
        ("Minimal\n(Base Instructions Only)", "ablation_minimal_results.jsonl"),
        ("+ ClickHouse\nDialect Hints", "ablation_dialect_only_results.jsonl"),
        ("+ JOIN\nGuidance", "ablation_joins_results.jsonl"),
        ("+ Window Function\nGuidance", "ablation_window_results.jsonl"),
        ("Full V6\nPrompt", "ablation_full_results.jsonl"),
    ]
    
    components = []
    for label, filename in versions:
        path = ablation_dir / filename
        if path.exists():
            records = load_jsonl(path)
            rc = sum(1 for r in records if r.get("result_match")) / len(records) * 100
            components.append({"name": label, "RC": round(rc, 1)})
        else:
            logger.warning("Missing ablation file: %s", path)
    
    if len(components) < 2:
        logger.warning("Insufficient ablation data, skipping prompt ablation figure")
        return None
    
    from evaluation.analysis.visualizations import plot_ablation_waterfall
    setup_vldb_style()
    results_dict = {"components": components}
    output = str(FIGURES_DIR / "fig_ablation_prompt")
    fig = plot_ablation_waterfall(results_dict, output)
    plt.close(fig)
    logger.info("Generated Prompt Ablation Waterfall")
    return fig


# ---------------------------------------------------------------------------
# Figure: Cross-Model Comparison
# ---------------------------------------------------------------------------


def generate_figure_cross_model():
    """Generate cross-model comparison bar chart."""
    cross_model_dir = RESULTS_DIR.parent / "results" / "cross_model"
    
    configs = {
        "Best Config": {
            "Sonnet 3.5": PHASE2_DIR / "markdown_relevant_subset_descriptions_dynamic_few_shot_v6_results.jsonl",
            "Sonnet 4": cross_model_dir / "sonnet4_best_config_results.jsonl",
        },
        "Baseline": {
            "Sonnet 3.5": PHASE1_DIR / "ddl_full_none_zero_shot_results.jsonl",
            "Sonnet 4": cross_model_dir / "sonnet4_baseline_results.jsonl",
        },
    }
    
    import numpy as np
    setup_vldb_style()
    
    fig, ax = plt.subplots(figsize=(3.5, 2.5))
    
    config_names = list(configs.keys())
    model_names = ["Sonnet 3.5", "Sonnet 4"]
    x = np.arange(len(config_names))
    bar_width = 0.35
    
    for m_idx, model in enumerate(model_names):
        values = []
        for cfg_name in config_names:
            path = configs[cfg_name].get(model)
            if path and path.exists():
                records = load_jsonl(path)
                rc = sum(1 for r in records if r.get("result_match")) / len(records) * 100
                values.append(rc)
            else:
                values.append(0)
        
        offset = (m_idx - 0.5) * bar_width
        ax.bar(x + offset, values, bar_width * 0.9, label=model)
    
    ax.set_xticks(x)
    ax.set_xticklabels(config_names)
    ax.set_ylabel("Result Correctness (%)")
    ax.set_ylim(0, 105)
    ax.legend()
    ax.set_title("Cross-Model Comparison", fontweight='bold', fontsize=10)
    ax.grid(axis='y', alpha=0.3)
    ax.set_axisbelow(True)
    
    fig.tight_layout()
    from evaluation.analysis.visualizations import _save_figure
    _save_figure(fig, str(FIGURES_DIR / "fig_cross_model"))
    plt.close(fig)
    logger.info("Generated Cross-Model Comparison")
    return fig


# ---------------------------------------------------------------------------
# Table: Cross-Dataset Results
# ---------------------------------------------------------------------------


def generate_table_cross_dataset():
    """Generate LaTeX table for cross-dataset results."""
    cross_dataset_dir = RESULTS_DIR.parent / "results" / "cross_dataset"
    TABLES_DIR.mkdir(parents=True, exist_ok=True)
    
    datasets = {
        "Custom Analytics": {"queries": 150, "tables": 4},
        "ClickBench": {"queries": 43, "tables": 1},
        "SSB": {"queries": 13, "tables": 5},
    }
    
    configs = ["best", "baseline", "scope_only"]
    
    lines = [
        "\\begin{table}[t]",
        "\\centering",
        "\\caption{Result Correctness across three benchmarks. Best config: "
        "Markdown, Relevant Subset, Descriptions, Dynamic Few-Shot.}",
        "\\label{tab:cross_dataset}",
        "\\small",
        "\\begin{tabular}{lrrr}",
        "\\toprule",
        "Dataset & Best & Baseline & Scope Only \\\\",
        "\\midrule",
    ]
    
    for ds_name, ds_info in datasets.items():
        ds_key = ds_name.lower().replace(" ", "_")
        values = []
        for cfg in configs:
            path = cross_dataset_dir / f"{ds_key}_{cfg}_results.jsonl"
            if path.exists():
                records = load_jsonl(path)
                rc = sum(1 for r in records if r.get("result_match")) / len(records) * 100
                values.append(f"{rc:.1f}")
            else:
                values.append("[TBD]")
        
        lines.append(
            f"{ds_name} ({ds_info['queries']}q, {ds_info['tables']}t) & "
            f"{' & '.join(values)} \\\\"
        )
    
    lines.extend([
        "\\bottomrule",
        "\\end{tabular}",
        "\\end{table}",
    ])
    
    latex = "\n".join(lines)
    (TABLES_DIR / "table_cross_dataset.tex").write_text(latex)
    logger.info("Generated Cross-Dataset Table")


# ---------------------------------------------------------------------------
# Figure 6: Category-level RC comparison across all RQs (custom bar chart)
# ---------------------------------------------------------------------------


def generate_figure6():
    """Category-level RC comparison for the best config."""
    import numpy as np

    best_path = PHASE2_DIR / "markdown_user_guided_none_zero_shot_results.jsonl"
    if not best_path.exists():
        logger.warning("Missing best config for Figure 6")
        return None

    records = load_jsonl(best_path)
    cat_rc = rc_by_category(records)

    # Also compute per-category counts
    cat_total: dict[str, int] = {}
    cat_correct: dict[str, int] = {}
    for r in records:
        cat_raw = r.get("category", "Unknown")
        cat = CATEGORY_MAP.get(cat_raw, cat_raw)
        cat_total[cat] = cat_total.get(cat, 0) + 1
        if r.get("result_match", False):
            cat_correct[cat] = cat_correct.get(cat, 0) + 1

    setup_vldb_style()

    fig, ax = plt.subplots(figsize=(7.0, 3.5))
    categories = CATEGORY_ORDER
    values = [cat_rc.get(c, 0) for c in categories]
    counts = [f"{cat_correct.get(c, 0)}/{cat_total.get(c, 0)}" for c in categories]

    colors = ['#0173B2', '#029E73', '#D55E00', '#CC78BC', '#ECE133', '#56B4E9']

    bars = ax.bar(range(len(categories)), values, color=colors,
                  edgecolor='white', linewidth=0.5)

    for i, (bar, count_str) in enumerate(zip(bars, counts)):
        h = bar.get_height()
        ax.text(bar.get_x() + bar.get_width() / 2, h + 1,
                f"{h:.0f}%\n({count_str})", ha='center', va='bottom',
                fontsize=8, fontweight='bold')

    ax.set_xticks(range(len(categories)))
    ax.set_xticklabels([c.replace("-", "-\n") if len(c) > 12 else c
                        for c in categories], rotation=0, ha='center', fontsize=8)
    ax.set_ylabel("Result Correctness (%)")
    ax.set_ylim(0, 105)
    ax.set_title("Result Correctness by Query Category\n(Best Config: User-Guided, None, Zero-Shot)",
                 fontweight='bold', pad=10)
    ax.grid(axis='y', alpha=0.3, linewidth=0.5)
    ax.set_axisbelow(True)

    fig.tight_layout()
    from evaluation.analysis.visualizations import _save_figure
    _save_figure(fig, str(FIGURES_DIR / "fig6_category_breakdown"))
    plt.close(fig)
    logger.info("Generated Figure 6: Category Breakdown")
    return fig


# ---------------------------------------------------------------------------
# LaTeX Tables
# ---------------------------------------------------------------------------


def generate_latex_tables():
    """Generate all LaTeX tables from V4 results."""
    TABLES_DIR.mkdir(parents=True, exist_ok=True)

    # ---- Table 1: Format Comparison (Phase 1) ----
    fmt_configs = {
        "CREATE TABLE": PHASE1_DIR / "ddl_full_none_zero_shot_results.jsonl",
        "Markdown": PHASE1_DIR / "markdown_full_none_zero_shot_results.jsonl",
        "JSON": PHASE1_DIR / "json_full_none_zero_shot_results.jsonl",
        "Natural Language": PHASE1_DIR / "natural_language_full_none_zero_shot_results.jsonl",
    }

    fmt_data = {}
    for name, path in fmt_configs.items():
        if path.exists():
            records = load_jsonl(path)
            fmt_data[name] = extract_vectors(records)
            fmt_data[name]["SL"] = [r.get("overall_f1", 0.0) for r in records]
            fmt_data[name]["Latency"] = [r.get("latency_ms", 0.0) for r in records]

    if fmt_data:
        fmt_results = {"models": {"Sonnet 3.5": fmt_data}}
        latex = generate_format_comparison_table(fmt_results)
        (TABLES_DIR / "table1_format_comparison.tex").write_text(latex)
        logger.info("Generated Table 1: Format Comparison")

    # ---- Table 2: Scope Comparison (Phase 2 RQ2) ----
    scope_configs = {
        "Full Schema": PHASE2_DIR / "markdown_full_none_zero_shot_results.jsonl",
        "Relevant Subset": PHASE2_DIR / "markdown_relevant_subset_none_zero_shot_results.jsonl",
        "Progressive": PHASE2_DIR / "markdown_progressive_none_zero_shot_results.jsonl",
        "User-Guided": PHASE2_DIR / "markdown_user_guided_none_zero_shot_results.jsonl",
    }

    scope_data = {}
    for name, path in scope_configs.items():
        if path.exists():
            records = load_jsonl(path)
            scope_data[name] = extract_vectors(records)
            scope_data[name]["Latency"] = [r.get("latency_ms", 0.0) for r in records]

    if scope_data:
        scope_results = {"models": {"Sonnet 3.5": scope_data}}
        latex = generate_scope_comparison_table(scope_results)
        (TABLES_DIR / "table2_scope_comparison.tex").write_text(latex)
        logger.info("Generated Table 2: Scope Comparison")

    # ---- Table 3: Metadata Enrichment (Phase 2 RQ3) ----
    meta_configs = {
        "None": PHASE2_DIR / "markdown_user_guided_none_zero_shot_results.jsonl",
        "Descriptions": PHASE2_DIR / "markdown_user_guided_descriptions_zero_shot_results.jsonl",
        "Sample Values": PHASE2_DIR / "markdown_user_guided_sample_values_zero_shot_results.jsonl",
        "Statistics": PHASE2_DIR / "markdown_user_guided_statistics_zero_shot_results.jsonl",
        "All Combined": PHASE2_DIR / "markdown_user_guided_all_zero_shot_results.jsonl",
    }

    meta_overall: dict[str, dict] = {}
    meta_by_cat: dict[str, dict[str, float]] = {}
    for level_name, path in meta_configs.items():
        if path.exists():
            records = load_jsonl(path)
            meta_overall[level_name] = {"RC": [r.get("result_match", False) for r in records]}
            cat_rc = rc_by_category(records)
            for cat_name, rc_pct in cat_rc.items():
                if cat_name not in meta_by_cat:
                    meta_by_cat[cat_name] = {}
                meta_by_cat[cat_name][level_name] = rc_pct

    if meta_overall:
        meta_results = {"overall": meta_overall, "by_category": meta_by_cat}
        latex = generate_metadata_table(meta_results)
        (TABLES_DIR / "table3_metadata_enrichment.tex").write_text(latex)
        logger.info("Generated Table 3: Metadata Enrichment")

    # ---- Table 4: Example Selection (Phase 2 RQ4) ----
    example_configs = {
        "Zero-Shot": PHASE2_DIR / "markdown_user_guided_none_zero_shot_results.jsonl",
        "Static Few-Shot": PHASE2_DIR / "markdown_user_guided_none_static_few_shot_results.jsonl",
        "Dynamic Few-Shot": PHASE2_DIR / "markdown_user_guided_none_dynamic_few_shot_results.jsonl",
        "Schema-Matched": PHASE2_DIR / "markdown_user_guided_none_schema_matched_results.jsonl",
    }

    example_data = {}
    for name, path in example_configs.items():
        if path.exists():
            records = load_jsonl(path)
            vectors = extract_vectors(records)
            example_data[name] = {
                "RC": vectors["RC"],
                "TE": vectors["TE"],
            }

    if example_data:
        latex = generate_example_table(example_data)
        (TABLES_DIR / "table4_example_comparison.tex").write_text(latex)
        logger.info("Generated Table 4: Example Comparison")

    # ---- Table 5: Statistical Significance ----
    if STATS_PATH.exists():
        with open(STATS_PATH) as f:
            stats = json.load(f)

        # Collect all significant RC comparisons across RQs
        sig_results = []
        for rq_name, rq_data in stats.get("research_questions", {}).items():
            for test in rq_data.get("pairwise_tests", {}).get("RC", []):
                sig_results.append({
                    "config_a": test["config_a"],
                    "config_b": test["config_b"],
                    "metric": "RC",
                    "value_a": test["value_a"],
                    "value_b": test["value_b"],
                    "p_value": test["p_value_corrected"],
                    "effect_size": test["effect_size_cohens_h"],
                    "significant": test["significant"],
                    "rq": rq_name,
                })

        if sig_results:
            latex = generate_statistical_significance_table(sig_results)
            (TABLES_DIR / "table5_statistical_significance.tex").write_text(latex)
            logger.info("Generated Table 5: Statistical Significance")

    # ---- Summary Table: All Configs ----
    _generate_summary_table()


def _generate_summary_table():
    """Generate a comprehensive summary table of all V4 configs."""
    all_configs = [
        ("Full, None, Zero-Shot", "markdown_full_none_zero_shot_results.jsonl"),
        ("Relevant Subset, None, Zero-Shot", "markdown_relevant_subset_none_zero_shot_results.jsonl"),
        ("Progressive, None, Zero-Shot", "markdown_progressive_none_zero_shot_results.jsonl"),
        ("User-Guided, None, Zero-Shot", "markdown_user_guided_none_zero_shot_results.jsonl"),
        ("User-Guided, Descriptions, Zero-Shot", "markdown_user_guided_descriptions_zero_shot_results.jsonl"),
        ("User-Guided, Sample Values, Zero-Shot", "markdown_user_guided_sample_values_zero_shot_results.jsonl"),
        ("User-Guided, Statistics, Zero-Shot", "markdown_user_guided_statistics_zero_shot_results.jsonl"),
        ("User-Guided, All, Zero-Shot", "markdown_user_guided_all_zero_shot_results.jsonl"),
        ("User-Guided, None, Static Few-Shot", "markdown_user_guided_none_static_few_shot_results.jsonl"),
        ("User-Guided, None, Dynamic Few-Shot", "markdown_user_guided_none_dynamic_few_shot_results.jsonl"),
        ("User-Guided, None, Schema-Matched", "markdown_user_guided_none_schema_matched_results.jsonl"),
    ]

    lines = [
        "\\begin{table*}[t]",
        "\\centering",
        "\\caption{Complete Phase 2 experiment results. All configurations use Markdown schema format. "
        "Metrics: EX = Execution Accuracy, RC = Result Correctness, SL = Schema Linking F1, "
        "Tokens = average input tokens, Latency = average response time.}",
        "\\label{tab:complete_results}",
        "\\footnotesize",
        "\\begin{tabular}{lrrrrr}",
        "\\toprule",
        "Configuration (Scope, Metadata, Examples) & EX (\\%) & RC (\\%) & SL F1 & Tokens & Latency (ms) \\\\",
        "\\midrule",
    ]

    ex_vals = []
    rc_vals = []

    for label, filename in all_configs:
        path = PHASE2_DIR / filename
        if not path.exists():
            continue
        records = load_jsonl(path)
        n = len(records)
        ex = sum(1 for r in records if r.get("pred_executed")) / n * 100
        rc = sum(1 for r in records if r.get("result_match")) / n * 100
        sl = sum(r.get("overall_f1", 0) for r in records) / n
        tokens = sum(r.get("input_tokens", 0) for r in records) / n
        latency = sum(r.get("latency_ms", 0) for r in records) / n
        ex_vals.append(ex)
        rc_vals.append(rc)

    best_ex = max(ex_vals) if ex_vals else 0
    best_rc = max(rc_vals) if rc_vals else 0

    for label, filename in all_configs:
        path = PHASE2_DIR / filename
        if not path.exists():
            continue
        records = load_jsonl(path)
        n = len(records)
        ex = sum(1 for r in records if r.get("pred_executed")) / n * 100
        rc = sum(1 for r in records if r.get("result_match")) / n * 100
        sl = sum(r.get("overall_f1", 0) for r in records) / n
        tokens = sum(r.get("input_tokens", 0) for r in records) / n
        latency = sum(r.get("latency_ms", 0) for r in records) / n

        ex_str = f"{ex:.1f}"
        rc_str = f"{rc:.1f}"
        if abs(ex - best_ex) < 0.01:
            ex_str = f"\\textbf{{{ex_str}}}"
        if abs(rc - best_rc) < 0.01:
            rc_str = f"\\textbf{{{rc_str}}}"

        escaped_label = label.replace("_", "\\_")
        lines.append(
            f"{escaped_label} & {ex_str} & {rc_str} & {sl:.3f} & {tokens:,.0f} & {latency:.0f} \\\\"
        )

    lines.extend([
        "\\bottomrule",
        "\\end{tabular}",
        "\\end{table*}",
    ])

    latex = "\n".join(lines)
    (TABLES_DIR / "table_complete_results.tex").write_text(latex)
    logger.info("Generated Summary Table: Complete Results")



def generate_ci_table():
    """Generate CI summary table from repeated trials."""
    analysis = load_repeated_trials_analysis()
    if analysis is None:
        logger.info("Skipping CI summary table (no repeated trials data)")
        return

    latex = generate_ci_summary_table(analysis)
    (TABLES_DIR / "table_ci_summary.tex").write_text(latex)
    logger.info("Generated CI Summary Table")
# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    TABLES_DIR.mkdir(parents=True, exist_ok=True)

    setup_vldb_style()

    print("=" * 70)
    print("  Generating Publication Outputs")
    print("  VLDB 2026: Schema-Aware Prompt Engineering for Text-to-SQL")
    print("=" * 70)

    # Generate all figures
    print("\n--- Generating Figures ---")
    figures = {}
    for i, gen_func in enumerate([
        generate_figure1,
        generate_figure2,
        generate_figure3,
        generate_figure4,
        generate_figure5,
        generate_figure6,
    ], 1):
        try:
            fig = gen_func()
            if fig is not None:
                figures[f"fig{i}"] = fig
        except Exception as e:
            logger.error("Failed to generate Figure %d: %s", i, e)
            import traceback
            traceback.print_exc()

    print(f"\nGenerated {len(figures)}/6 figures in {FIGURES_DIR}")

    # Generate all LaTeX tables
    print("\n--- Generating LaTeX Tables ---")
    try:
        generate_latex_tables()
    except Exception as e:
        logger.error("Failed to generate LaTeX tables: %s", e)
        import traceback
        traceback.print_exc()

    # Generate CI table from repeated trials
    try:
        generate_ci_table()
    except Exception as e:
        logger.error("Failed to generate CI table: %s", e)


    # Generate new figures and tables
    print("\n--- Generating New Figures and Tables ---")
    for gen_func in [
        generate_figure_ablation_prompt,
        generate_figure_cross_model,
        generate_table_cross_dataset,
    ]:
        try:
            gen_func()
        except Exception as e:
            logger.error("Failed to generate %s: %s", gen_func.__name__, e)

    # List outputs
    print(f"\n{'='*70}")
    print("  Generated Outputs")
    print(f"{'='*70}")

    print("\nFigures:")
    for f in sorted(FIGURES_DIR.glob("*")):
        size_kb = f.stat().st_size / 1024
        print(f"  {f.name:45s} {size_kb:8.1f} KB")

    print("\nTables:")
    for f in sorted(TABLES_DIR.glob("*.tex")):
        size_kb = f.stat().st_size / 1024
        print(f"  {f.name:45s} {size_kb:8.1f} KB")

    print(f"\n{'='*70}")


if __name__ == "__main__":
    main()
