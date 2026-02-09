#!/usr/bin/env python3
"""
run_repeated_trials.py -- Run configs N times and compute bootstrap 95% CIs.

Runs each of 6 benchmark configurations across multiple trials, then
performs bootstrap CI estimation and pairwise McNemar's tests.

Usage:
    python evaluation/run_repeated_trials.py --trials 3
    python evaluation/run_repeated_trials.py --trials 5 --configs 1,2,3
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from evaluation.run_phase2 import (
    evaluate_single_query, load_all_queries, compute_aggregate_metrics,
    compute_category_metrics, query_result_to_dict, QueryEvalResult,
    BENCHMARK_DIR, API_DELAY_SEC,
)
from evaluation.framework.prompt_builder import (
    PromptBuilder, SchemaFormat, SchemaScope, MetadataLevel, ExampleStrategy,
)
from evaluation.framework.llm_caller import LLMCaller
from evaluation.framework.sql_executor import SQLExecutor
from evaluation.framework.schema_linker import SchemaLinker
from evaluation.framework.self_corrector import SelfCorrector
from evaluation.analysis.statistical_tests import StatisticalAnalyzer

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("repeated_trials")

# -- Config definitions --------------------------------------------------------

CONFIGS = [
    {"name": "markdown_relevant_subset_descriptions_dynamic_few_shot",
     "format": SchemaFormat.MARKDOWN, "scope": SchemaScope.RELEVANT_SUBSET,
     "metadata": MetadataLevel.DESCRIPTIONS, "examples": ExampleStrategy.DYNAMIC_FEW_SHOT},
    {"name": "markdown_relevant_subset_descriptions_schema_matched",
     "format": SchemaFormat.MARKDOWN, "scope": SchemaScope.RELEVANT_SUBSET,
     "metadata": MetadataLevel.DESCRIPTIONS, "examples": ExampleStrategy.SCHEMA_MATCHED},
    {"name": "markdown_relevant_subset_descriptions_zero_shot",
     "format": SchemaFormat.MARKDOWN, "scope": SchemaScope.RELEVANT_SUBSET,
     "metadata": MetadataLevel.DESCRIPTIONS, "examples": ExampleStrategy.ZERO_SHOT},
    {"name": "markdown_relevant_subset_descriptions_static_few_shot",
     "format": SchemaFormat.MARKDOWN, "scope": SchemaScope.RELEVANT_SUBSET,
     "metadata": MetadataLevel.DESCRIPTIONS, "examples": ExampleStrategy.STATIC_FEW_SHOT},
    {"name": "markdown_relevant_subset_none_zero_shot",
     "format": SchemaFormat.MARKDOWN, "scope": SchemaScope.RELEVANT_SUBSET,
     "metadata": MetadataLevel.NONE, "examples": ExampleStrategy.ZERO_SHOT},
    {"name": "markdown_full_none_zero_shot",
     "format": SchemaFormat.MARKDOWN, "scope": SchemaScope.FULL,
     "metadata": MetadataLevel.NONE, "examples": ExampleStrategy.ZERO_SHOT},
]


# -- Trial runner --------------------------------------------------------------

def run_trial(
    config: dict, trial_idx: int, queries: list[dict],
    prompt_builder: PromptBuilder, llm_caller: LLMCaller,
    sql_executor: SQLExecutor, schema_linker: SchemaLinker,
    self_corrector: SelfCorrector, output_dir: Path,
) -> list[QueryEvalResult]:
    """Run a single trial for a config and persist results."""
    trial_dir = output_dir / config["name"] / f"trial_{trial_idx}"
    trial_dir.mkdir(parents=True, exist_ok=True)
    results_file = trial_dir / "results.jsonl"
    logger.info("Trial %d for %s -> %s", trial_idx, config["name"], trial_dir)

    results: list[QueryEvalResult] = []
    for idx, query in enumerate(queries, 1):
        qr = evaluate_single_query(
            query=query, prompt_builder=prompt_builder, llm_caller=llm_caller,
            sql_executor=sql_executor, schema_linker=schema_linker,
            schema_format=config["format"], schema_scope=config["scope"],
            metadata_level=config["metadata"], example_strategy=config["examples"],
            self_corrector=self_corrector,
        )
        results.append(qr)
        with open(results_file, "a") as f:
            f.write(json.dumps(query_result_to_dict(qr)) + "\n")

        if idx % 10 == 0 or idx == len(queries):
            correct = sum(1 for r in results if r.result_match)
            logger.info("  [%d/%d] RC: %.1f%% (%d/%d)",
                        idx, len(queries), 100.0 * correct / len(results), correct, len(results))
        if API_DELAY_SEC > 0:
            time.sleep(API_DELAY_SEC)

    # Save summary
    summary = {
        "config": config["name"], "trial": trial_idx,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "aggregate": compute_aggregate_metrics(results),
        "per_category": compute_category_metrics(results),
    }
    (trial_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    return results


# -- Analysis ------------------------------------------------------------------

def run_analysis(
    all_results: dict[str, list[list[QueryEvalResult]]], output_dir: Path,
) -> None:
    """Compute bootstrap CIs and pairwise McNemar's tests across trials."""
    analyzer = StatisticalAnalyzer(alpha=0.05, seed=42)
    analysis: dict = {"bootstrap_cis": {}, "pairwise_mcnemar": [], "summary_table": []}

    # Bootstrap CIs per trial and pooled across trials
    for name, trials in all_results.items():
        for t_idx, t_results in enumerate(trials):
            ci = analyzer.bootstrap_ci(
                [r.result_match for r in t_results], n_bootstrap=10000,
                ci=0.95, config=f"{name}_trial_{t_idx}", metric="RC",
            )
            analysis["bootstrap_cis"][f"{name}_trial_{t_idx}"] = asdict(ci)

        pooled = [r.result_match for trial in trials for r in trial]
        ci_pooled = analyzer.bootstrap_ci(
            pooled, n_bootstrap=10000, ci=0.95, config=f"{name}_pooled", metric="RC",
        )
        analysis["bootstrap_cis"][f"{name}_pooled"] = asdict(ci_pooled)

    # Pairwise McNemar using first trial
    first_trial = {
        name: [r.result_match for r in trials[0]]
        for name, trials in all_results.items() if trials
    }
    if len(first_trial) >= 2:
        pairwise = analyzer.pairwise_all(first_trial, metric_name="RC")
        analysis["pairwise_mcnemar"] = [asdict(p) for p in pairwise]

    # Summary table
    for name, trials in all_results.items():
        trial_rcs = [
            sum(r.result_match for r in t) / len(t) if t else 0.0 for t in trials
        ]
        pooled_ci = analysis["bootstrap_cis"].get(f"{name}_pooled", {})
        analysis["summary_table"].append({
            "config": name, "n_trials": len(trials),
            "trial_rcs": [round(rc, 4) for rc in trial_rcs],
            "mean_rc": round(sum(trial_rcs) / len(trial_rcs), 4) if trial_rcs else 0.0,
            "ci_lower": pooled_ci.get("ci_lower"), "ci_upper": pooled_ci.get("ci_upper"),
        })

    (output_dir / "repeated_trials_analysis.json").write_text(json.dumps(analysis, indent=2))
    logger.info("Analysis saved to %s", output_dir / "repeated_trials_analysis.json")

    # Print summary
    print(f"\n{'='*75}\n  Repeated Trials Analysis\n{'='*75}")
    for row in analysis["summary_table"]:
        rcs = ", ".join(f"{rc:.1%}" for rc in row["trial_rcs"])
        ci_lo, ci_hi = row["ci_lower"], row["ci_upper"]
        ci_str = f"[{ci_lo:.1%}, {ci_hi:.1%}]" if ci_lo is not None else "N/A"
        print(f"  {row['config']}")
        print(f"    Trials: {rcs}  |  Mean: {row['mean_rc']:.1%}  |  95% CI: {ci_str}")
    print(f"{'='*75}\n")


# -- Main ----------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Run repeated trials with bootstrap CIs")
    parser.add_argument("--trials", type=int, default=3, help="Number of trials per config")
    parser.add_argument("--model", type=str, default="claude-3-5-sonnet-20241022")
    parser.add_argument("--dataset", type=str, default="custom_analytics")
    parser.add_argument("--configs", type=str, default=None,
                        help="Comma-separated config indices (1-6); default: all")
    parser.add_argument("--output-dir", type=str,
                        default=str(project_root / "evaluation" / "results" / "repeated_trials"))
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    selected = CONFIGS
    if args.configs:
        indices = [int(x.strip()) for x in args.configs.split(",")]
        selected = [CONFIGS[i - 1] for i in indices if 1 <= i <= len(CONFIGS)]

    logger.info("Model: %s | Dataset: %s | Trials: %d", args.model, args.dataset, args.trials)
    logger.info("Configs: %s", [c["name"] for c in selected])

    queries = load_all_queries(BENCHMARK_DIR, args.dataset)
    logger.info("Loaded %d queries", len(queries))

    prompt_builder = PromptBuilder(BENCHMARK_DIR)
    llm_caller = LLMCaller(model=args.model, max_tokens=2048, temperature=0.0)
    sql_executor = SQLExecutor(host="localhost", port=9000)
    schema_linker = SchemaLinker()
    self_corrector = SelfCorrector(llm_caller=llm_caller, sql_executor=sql_executor, max_retries=2)

    if not sql_executor.test_connection():
        logger.error("ClickHouse connection failed. Aborting.")
        sys.exit(1)

    all_results: dict[str, list[list[QueryEvalResult]]] = {}
    for config in selected:
        all_results[config["name"]] = []
        for trial_idx in range(args.trials):
            logger.info("=== %s | Trial %d/%d ===", config["name"], trial_idx + 1, args.trials)
            results = run_trial(
                config, trial_idx, queries, prompt_builder, llm_caller,
                sql_executor, schema_linker, self_corrector, output_dir,
            )
            all_results[config["name"]].append(results)

    run_analysis(all_results, output_dir)
    sql_executor.close()
    logger.info("Done.")


if __name__ == "__main__":
    main()
