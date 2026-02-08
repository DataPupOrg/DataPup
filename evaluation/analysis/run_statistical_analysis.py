#!/usr/bin/env python3
"""Standalone statistical analysis for Phase 1 & Phase 2 experiment results.

Loads JSONL result files, groups them by research question, and runs:
  - McNemar's test (with Holm-Bonferroni correction) for pairwise EX significance
  - 95% Bootstrap confidence intervals for EX and RC
  - Summary of which differences are statistically significant at p < 0.05

Outputs results to evaluation/results/statistical_analysis.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Add project root so we can import the existing StatisticalAnalyzer
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from evaluation.analysis.statistical_tests import StatisticalAnalyzer

# ---------------------------------------------------------------------------
# Configuration: map filenames to research questions and config labels
# ---------------------------------------------------------------------------

PHASE1_DIR = PROJECT_ROOT / "evaluation" / "results" / "phase1"
PHASE2_DIR = PROJECT_ROOT / "evaluation" / "results" / "phase2"
OUTPUT_PATH = PROJECT_ROOT / "evaluation" / "results" / "statistical_analysis.json"

# RQ1: Schema Format (Phase 1) -- vary format, hold scope=full, metadata=none, examples=zero_shot
RQ1_CONFIGS = {
    "DDL (CREATE TABLE)": PHASE1_DIR / "ddl_full_none_zero_shot_results.jsonl",
    "Markdown": PHASE1_DIR / "markdown_full_none_zero_shot_results.jsonl",
    "JSON": PHASE1_DIR / "json_full_none_zero_shot_results.jsonl",
    "Natural Language": PHASE1_DIR / "natural_language_full_none_zero_shot_results.jsonl",
}

# RQ2: Schema Scope (Phase 2) -- vary scope, hold format=markdown, metadata=none, examples=zero_shot
RQ2_CONFIGS = {
    "Full Schema": PHASE2_DIR / "markdown_full_none_zero_shot_results.jsonl",
    "Relevant Subset": PHASE2_DIR / "markdown_relevant_subset_none_zero_shot_results.jsonl",
    "Progressive": PHASE2_DIR / "markdown_progressive_none_zero_shot_results.jsonl",
    "User-Guided": PHASE2_DIR / "markdown_user_guided_none_zero_shot_results.jsonl",
}

# RQ3: Metadata Enrichment (Phase 2) -- vary metadata, hold format=markdown, scope=user_guided, examples=zero_shot
RQ3_CONFIGS = {
    "No Metadata": PHASE2_DIR / "markdown_user_guided_none_zero_shot_results.jsonl",
    "Descriptions": PHASE2_DIR / "markdown_user_guided_descriptions_zero_shot_results.jsonl",
    "Sample Values": PHASE2_DIR / "markdown_user_guided_sample_values_zero_shot_results.jsonl",
    "Statistics": PHASE2_DIR / "markdown_user_guided_statistics_zero_shot_results.jsonl",
    "All Metadata": PHASE2_DIR / "markdown_user_guided_all_zero_shot_results.jsonl",
}

# RQ4: Example Selection (Phase 2) -- vary examples, hold format=markdown, scope=user_guided, metadata=none
RQ4_CONFIGS = {
    "Zero-Shot": PHASE2_DIR / "markdown_user_guided_none_zero_shot_results.jsonl",
    "Static Few-Shot": PHASE2_DIR / "markdown_user_guided_none_static_few_shot_results.jsonl",
    "Dynamic Few-Shot": PHASE2_DIR / "markdown_user_guided_none_dynamic_few_shot_results.jsonl",
    "Schema-Matched": PHASE2_DIR / "markdown_user_guided_none_schema_matched_results.jsonl",
}

RESEARCH_QUESTIONS = {
    "RQ1_Schema_Format": RQ1_CONFIGS,
    "RQ2_Schema_Scope": RQ2_CONFIGS,
    "RQ3_Metadata_Enrichment": RQ3_CONFIGS,
    "RQ4_Example_Selection": RQ4_CONFIGS,
}


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def load_jsonl(path: Path) -> list[dict]:
    """Load a JSONL file and return a list of dicts."""
    records = []
    with open(path, "r") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def extract_metrics(records: list[dict]) -> dict[str, list[bool]]:
    """Extract EX (execution success) and RC (result correctness) vectors.

    EX is based on `pred_executed` field.
    RC is based on `result_match` field.
    """
    ex = [bool(r.get("pred_executed", False)) for r in records]
    rc = [bool(r.get("result_match", False)) for r in records]
    return {"EX": ex, "RC": rc}


def extract_continuous_metrics(records: list[dict]) -> dict[str, list[float]]:
    """Extract continuous metrics: schema_linking_f1, input_tokens, output_tokens, latency_ms."""
    result = {}
    for key in ["overall_f1", "input_tokens", "output_tokens", "latency_ms"]:
        vals = [float(r.get(key, 0.0)) for r in records if key in r]
        if vals:
            result[key] = vals
    return result


# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------


def run_analysis() -> dict:
    """Run the full statistical analysis and return a JSON-serializable dict."""
    analyzer = StatisticalAnalyzer(alpha=0.05, seed=42)
    output = {
        "metadata": {
            "alpha": 0.05,
            "bootstrap_n": 10000,
            "bootstrap_ci_level": 0.95,
            "n_queries": 150,
            "correction_method": "Holm-Bonferroni",
            "test_method": "McNemar's exact test (binomial when discordant < 25, chi-squared otherwise)",
        },
        "research_questions": {},
    }

    for rq_name, config_map in RESEARCH_QUESTIONS.items():
        print(f"\n{'='*70}")
        print(f"  {rq_name}")
        print(f"{'='*70}")

        # Load all data for this RQ
        all_data = {}
        for config_label, filepath in config_map.items():
            if not filepath.exists():
                print(f"  WARNING: {filepath} not found, skipping {config_label}")
                continue
            records = load_jsonl(filepath)
            all_data[config_label] = {
                "records": records,
                "metrics": extract_metrics(records),
                "continuous": extract_continuous_metrics(records),
            }
            ex_rate = sum(all_data[config_label]["metrics"]["EX"]) / len(records)
            rc_rate = sum(all_data[config_label]["metrics"]["RC"]) / len(records)
            print(f"  {config_label}: EX={ex_rate:.1%}, RC={rc_rate:.1%} (n={len(records)})")

        if len(all_data) < 2:
            print(f"  Skipping {rq_name}: fewer than 2 configurations loaded.")
            continue

        rq_output = {
            "configs": {},
            "pairwise_tests": {"EX": [], "RC": []},
            "bootstrap_cis": {"EX": [], "RC": []},
        }

        # ---- Aggregate metrics per config ----
        for config_label, data in all_data.items():
            n = len(data["records"])
            ex_vec = data["metrics"]["EX"]
            rc_vec = data["metrics"]["RC"]
            cont = data["continuous"]

            rq_output["configs"][config_label] = {
                "n_queries": n,
                "EX_rate": round(sum(ex_vec) / n, 4),
                "RC_rate": round(sum(rc_vec) / n, 4),
                "EX_count": sum(ex_vec),
                "RC_count": sum(rc_vec),
                "avg_input_tokens": round(sum(cont.get("input_tokens", [])) / max(len(cont.get("input_tokens", [])), 1), 1),
                "avg_output_tokens": round(sum(cont.get("output_tokens", [])) / max(len(cont.get("output_tokens", [])), 1), 1),
                "avg_latency_ms": round(sum(cont.get("latency_ms", [])) / max(len(cont.get("latency_ms", [])), 1), 1),
                "avg_schema_f1": round(sum(cont.get("overall_f1", [])) / max(len(cont.get("overall_f1", [])), 1), 4),
            }

        # ---- Pairwise McNemar's tests for EX and RC ----
        for metric in ["EX", "RC"]:
            configs_for_metric = {
                label: data["metrics"][metric]
                for label, data in all_data.items()
            }

            pairwise_results = analyzer.pairwise_all(configs_for_metric, metric_name=metric)

            print(f"\n  --- Pairwise McNemar's Tests ({metric}) ---")
            print(f"  {'Config A':<20} {'Config B':<20} {'A':>6} {'B':>6} {'Diff':>7} {'p-raw':>9} {'p-adj':>9} {'Sig':>4} {'|h|':>6} {'Effect':<10}")
            print(f"  {'-'*110}")

            for r in pairwise_results:
                sig_str = " *" if r.significant else "  "
                print(
                    f"  {r.config_a:<20} {r.config_b:<20} "
                    f"{r.value_a:>6.3f} {r.value_b:>6.3f} {r.difference:>+7.3f} "
                    f"{r.p_value:>9.6f} {r.p_value_corrected:>9.6f} {sig_str:>4} "
                    f"{abs(r.effect_size):>6.3f} {r.effect_interpretation:<10}"
                )

                rq_output["pairwise_tests"][metric].append({
                    "config_a": r.config_a,
                    "config_b": r.config_b,
                    "value_a": round(r.value_a, 4),
                    "value_b": round(r.value_b, 4),
                    "difference": round(r.difference, 4),
                    "p_value_raw": round(r.p_value, 6),
                    "p_value_corrected": round(r.p_value_corrected, 6),
                    "significant": r.significant,
                    "effect_size_cohens_h": round(r.effect_size, 4),
                    "effect_interpretation": r.effect_interpretation,
                    "n_discordant": r.n_discordant,
                    "n_total": r.n_total,
                })

        # ---- Bootstrap 95% CIs for EX and RC ----
        print(f"\n  --- Bootstrap 95% Confidence Intervals ---")
        print(f"  {'Config':<25} {'Metric':<6} {'Observed':>9} {'CI Lower':>9} {'CI Upper':>9} {'SE':>8}")
        print(f"  {'-'*75}")

        for metric in ["EX", "RC"]:
            for config_label, data in all_data.items():
                ci = analyzer.bootstrap_ci(
                    data["metrics"][metric],
                    config=config_label,
                    metric=metric,
                )
                print(
                    f"  {config_label:<25} {metric:<6} "
                    f"{ci.observed:>9.4f} {ci.ci_lower:>9.4f} {ci.ci_upper:>9.4f} {ci.se:>8.4f}"
                )
                rq_output["bootstrap_cis"][metric].append({
                    "config": ci.config,
                    "observed": round(ci.observed, 4),
                    "ci_lower": round(ci.ci_lower, 4),
                    "ci_upper": round(ci.ci_upper, 4),
                    "ci_level": ci.ci_level,
                    "se": round(ci.se, 4),
                    "n_bootstrap": ci.n_bootstrap,
                })

        # ---- Summary of significant findings ----
        sig_findings = []
        for metric in ["EX", "RC"]:
            for test in rq_output["pairwise_tests"][metric]:
                if test["significant"]:
                    sig_findings.append(
                        f"{metric}: {test['config_a']} vs {test['config_b']} "
                        f"(diff={test['difference']:+.4f}, "
                        f"p_adj={test['p_value_corrected']:.6f}, "
                        f"|h|={abs(test['effect_size_cohens_h']):.4f} [{test['effect_interpretation']}])"
                    )

        rq_output["significant_findings"] = sig_findings
        rq_output["n_significant"] = len(sig_findings)

        if sig_findings:
            print(f"\n  SIGNIFICANT DIFFERENCES (p < 0.05, Holm-Bonferroni corrected):")
            for f in sig_findings:
                print(f"    - {f}")
        else:
            print(f"\n  No statistically significant differences found.")

        output["research_questions"][rq_name] = rq_output

    # ---- Global summary ----
    total_sig = sum(
        rq["n_significant"]
        for rq in output["research_questions"].values()
    )
    total_tests = sum(
        len(rq["pairwise_tests"]["EX"]) + len(rq["pairwise_tests"]["RC"])
        for rq in output["research_questions"].values()
    )
    output["global_summary"] = {
        "total_pairwise_tests": total_tests,
        "total_significant": total_sig,
        "research_questions_with_significant_results": [
            rq_name
            for rq_name, rq in output["research_questions"].items()
            if rq["n_significant"] > 0
        ],
    }

    return output


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    print("=" * 70)
    print("  Statistical Analysis: Schema-Aware Prompt Engineering")
    print("  Phase 1 (Schema Format) & Phase 2 (Scope, Metadata, Examples)")
    print("=" * 70)

    output = run_analysis()

    # Write output
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n{'='*70}")
    print(f"  Results saved to: {OUTPUT_PATH}")
    print(f"  Total tests: {output['global_summary']['total_pairwise_tests']}")
    print(f"  Significant: {output['global_summary']['total_significant']}")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
