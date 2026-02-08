#!/usr/bin/env python3
"""
reevaluate.py -- Re-run Result Comparison on Existing Phase 2 Results

Re-executes predicted_sql and gold_sql from Phase 2 JSONL files against
ClickHouse and re-compares them using the (potentially updated)
compare_results function from result_comparator.py.

This does NOT make any LLM API calls.  It only re-runs SQL execution and
result comparison, making it safe to run repeatedly to measure the impact
of comparator changes.

Usage:
    python evaluation/reevaluate.py [--results-dir DIR] [--timeout SECS] [--config NAME]
    python evaluation/reevaluate.py --results-dir evaluation/results/phase2 --timeout 15
    python evaluation/reevaluate.py --config dynamic_few_shot
"""

from __future__ import annotations

import argparse
import glob as glob_mod
import json
import logging
import signal
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Path setup (same pattern as run_phase2.py)
# ---------------------------------------------------------------------------

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from evaluation.framework.result_comparator import (
    compare_results,
    MatchStrategy,
)
from evaluation.framework.sql_executor import SQLExecutor

# ---------------------------------------------------------------------------
# Configuration (defaults, overridden by CLI args)
# ---------------------------------------------------------------------------

DEFAULT_RESULTS_DIR = project_root / "evaluation" / "results" / "phase2"
DEFAULT_TIMEOUT_SEC = 15  # Per-query execution timeout

# Row limit for comparison to avoid O(n^2) blowup (matches run_phase2.py)
MAX_COMPARE_ROWS = 500

# Benchmark query directories
BENCHMARK_DIR = project_root / "evaluation" / "benchmark" / "queries"


def load_benchmark_gold_sql() -> dict[str, str]:
    """Load gold SQL from benchmark JSON files, keyed by query ID."""
    gold_map: dict[str, str] = {}
    for json_file in sorted(BENCHMARK_DIR.glob("*.json")):
        try:
            with open(json_file) as f:
                queries = json.load(f)
            for q in queries:
                qid = q.get("id", "")
                sql = q.get("sql", "")
                if qid and sql:
                    gold_map[qid] = sql
        except (json.JSONDecodeError, KeyError) as e:
            logger.warning("Failed to load %s: %s", json_file.name, e)
    return gold_map


# ---------------------------------------------------------------------------
# Timeout helper
# ---------------------------------------------------------------------------

class QueryTimeoutError(Exception):
    """Raised when a single query exceeds its execution timeout."""
    pass


def _timeout_handler(signum, frame):
    raise QueryTimeoutError("Query execution timed out")

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger("reevaluate")


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class FlippedQuery:
    """A query whose result_match changed between old and new comparison."""
    query_id: str
    category: str
    difficulty: str
    old_match: bool
    new_match: bool
    old_partial_score: float
    new_partial_score: float
    direction: str  # "incorrect->correct" or "correct->incorrect"

    def to_dict(self) -> dict:
        return {
            "query_id": self.query_id,
            "category": self.category,
            "difficulty": self.difficulty,
            "old_match": self.old_match,
            "new_match": self.new_match,
            "old_partial_score": self.old_partial_score,
            "new_partial_score": self.new_partial_score,
            "direction": self.direction,
        }


@dataclass
class ConfigReeval:
    """Re-evaluation results for a single configuration."""
    config_name: str
    total_queries: int = 0
    queries_reevaluated: int = 0
    queries_skipped: int = 0
    queries_errored: int = 0
    old_correct: int = 0
    new_correct: int = 0
    old_rc: float = 0.0
    new_rc: float = 0.0
    delta_rc: float = 0.0
    flipped_to_correct: int = 0
    flipped_to_incorrect: int = 0
    flipped_queries: list[FlippedQuery] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "config_name": self.config_name,
            "total_queries": self.total_queries,
            "queries_reevaluated": self.queries_reevaluated,
            "queries_skipped": self.queries_skipped,
            "queries_errored": self.queries_errored,
            "old_correct": self.old_correct,
            "new_correct": self.new_correct,
            "old_rc": round(self.old_rc, 4),
            "new_rc": round(self.new_rc, 4),
            "delta_rc": round(self.delta_rc, 4),
            "flipped_to_correct": self.flipped_to_correct,
            "flipped_to_incorrect": self.flipped_to_incorrect,
            "flipped_queries": [fq.to_dict() for fq in self.flipped_queries],
        }


# ---------------------------------------------------------------------------
# Core re-evaluation logic
# ---------------------------------------------------------------------------

def reevaluate_config(
    jsonl_path: Path,
    sql_executor: SQLExecutor,
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
    gold_sql_override: dict[str, str] | None = None,
) -> ConfigReeval:
    """
    Re-evaluate a single configuration's JSONL results file.

    For each query where pred_executed was True, re-execute both predicted_sql
    and gold_sql against ClickHouse and re-compare using the current
    compare_results implementation.

    Args:
        jsonl_path:        Path to the *_results.jsonl file.
        sql_executor:      An initialized SQLExecutor connected to ClickHouse.
        timeout_sec:       Per-query timeout in seconds.
        gold_sql_override: Optional dict mapping query_id -> gold_sql from
                           benchmark files (overrides gold_sql in JSONL).

    Returns:
        A ConfigReeval with before/after metrics and flip details.
    """
    # Derive config name from filename: e.g. "markdown_full_none_zero_shot"
    config_name = jsonl_path.stem.replace("_results", "")

    logger.info("=" * 70)
    logger.info("Re-evaluating: %s", config_name)
    logger.info("  File: %s", jsonl_path)

    # Parse all query results
    queries: list[dict] = []
    with open(jsonl_path, "r") as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                queries.append(json.loads(line))
            except json.JSONDecodeError as e:
                logger.warning(
                    "  Skipping malformed JSON on line %d: %s", line_num, e
                )

    reeval = ConfigReeval(config_name=config_name, total_queries=len(queries))

    if not queries:
        logger.warning("  No queries found in %s", jsonl_path.name)
        return reeval

    logger.info("  Loaded %d queries", len(queries))

    for idx, q in enumerate(queries):
        query_id = q.get("query_id", f"unknown_{idx}")
        category = q.get("category", "")
        difficulty = q.get("difficulty", "")
        predicted_sql = q.get("predicted_sql", "")
        gold_sql = q.get("gold_sql", "")

        # Override gold SQL from benchmark files if requested
        if gold_sql_override and query_id in gold_sql_override:
            gold_sql = gold_sql_override[query_id]

        old_match = q.get("result_match", False)
        old_partial_score = q.get("partial_score", 0.0)
        pred_executed = q.get("pred_executed", False)

        # Count old correct
        if old_match:
            reeval.old_correct += 1

        # Skip queries where pred didn't execute originally
        if not pred_executed:
            reeval.queries_skipped += 1
            continue

        # Skip queries with empty SQL
        if not predicted_sql or not predicted_sql.strip():
            reeval.queries_skipped += 1
            continue

        if not gold_sql or not gold_sql.strip():
            reeval.queries_skipped += 1
            continue

        # Re-execute both queries (with per-query timeout)
        try:
            old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
            signal.alarm(timeout_sec)
            try:
                pred_result = sql_executor.execute(predicted_sql)
                gold_result = sql_executor.execute(gold_sql)
            finally:
                signal.alarm(0)
                signal.signal(signal.SIGALRM, old_handler)
        except QueryTimeoutError:
            logger.warning(
                "  %s: timed out after %ds, keeping old result", query_id, timeout_sec
            )
            reeval.queries_errored += 1
            if old_match:
                reeval.new_correct += 1
            continue
        except Exception as e:
            logger.warning(
                "  %s: execution error, keeping old result: %s", query_id, e
            )
            reeval.queries_errored += 1
            if old_match:
                reeval.new_correct += 1
            continue

        # If either fails to execute now, keep the old result
        if not pred_result.success or not gold_result.success:
            if not pred_result.success:
                logger.debug(
                    "  %s: predicted SQL failed to execute: %s",
                    query_id, pred_result.error,
                )
            if not gold_result.success:
                logger.debug(
                    "  %s: gold SQL failed to execute: %s",
                    query_id, gold_result.error,
                )
            reeval.queries_errored += 1
            if old_match:
                reeval.new_correct += 1
            continue

        # Re-compare using the (potentially updated) comparator
        try:
            pred_rows = pred_result.results
            gold_rows = gold_result.results
            pred_cols = pred_result.columns
            gold_cols = gold_result.columns

            # Match the comparison logic from run_phase2.py
            if (
                len(pred_rows) > MAX_COMPARE_ROWS
                or len(gold_rows) > MAX_COMPARE_ROWS
            ):
                comparison = compare_results(
                    predicted_rows=pred_rows[:MAX_COMPARE_ROWS],
                    gold_rows=gold_rows[:MAX_COMPARE_ROWS],
                    predicted_cols=pred_cols,
                    gold_cols=gold_cols,
                    strategy=MatchStrategy.SEMANTIC,
                )
            else:
                comparison = compare_results(
                    predicted_rows=pred_rows,
                    gold_rows=gold_rows,
                    predicted_cols=pred_cols,
                    gold_cols=gold_cols,
                    strategy=MatchStrategy.SEMANTIC,
                )

            new_match = comparison.match
            new_partial_score = comparison.partial_score
        except Exception as e:
            logger.warning(
                "  %s: comparison error, keeping old result: %s", query_id, e
            )
            reeval.queries_errored += 1
            if old_match:
                reeval.new_correct += 1
            continue

        reeval.queries_reevaluated += 1

        if new_match:
            reeval.new_correct += 1

        # Detect flips
        if old_match != new_match:
            if new_match and not old_match:
                direction = "incorrect->correct"
                reeval.flipped_to_correct += 1
            else:
                direction = "correct->incorrect"
                reeval.flipped_to_incorrect += 1

            flipped = FlippedQuery(
                query_id=query_id,
                category=category,
                difficulty=difficulty,
                old_match=old_match,
                new_match=new_match,
                old_partial_score=old_partial_score,
                new_partial_score=new_partial_score,
                direction=direction,
            )
            reeval.flipped_queries.append(flipped)

        # Progress logging every 25 queries
        if (idx + 1) % 25 == 0 or (idx + 1) == len(queries):
            logger.info(
                "  Progress: %d/%d queries processed", idx + 1, len(queries)
            )

    # Compute RC rates
    if reeval.total_queries > 0:
        reeval.old_rc = reeval.old_correct / reeval.total_queries
        reeval.new_rc = reeval.new_correct / reeval.total_queries
        reeval.delta_rc = reeval.new_rc - reeval.old_rc

    logger.info(
        "  Done: old_RC=%.4f  new_RC=%.4f  delta=%+.4f  "
        "flipped_correct=%d  flipped_incorrect=%d",
        reeval.old_rc, reeval.new_rc, reeval.delta_rc,
        reeval.flipped_to_correct, reeval.flipped_to_incorrect,
    )

    return reeval


# ---------------------------------------------------------------------------
# Summary printing
# ---------------------------------------------------------------------------

def print_summary_table(results: list[ConfigReeval]) -> None:
    """Print a formatted summary table of all re-evaluation results."""
    print()
    print("=" * 110)
    print("  RE-EVALUATION SUMMARY")
    print("=" * 110)
    header = (
        f"{'Config':<45} {'Old RC':>8} {'New RC':>8} {'Delta':>8} "
        f"{'->Correct':>10} {'->Incorrect':>12} {'Reeval':>7} {'Error':>6}"
    )
    print(header)
    print("-" * 110)

    for r in results:
        print(
            f"{r.config_name:<45} "
            f"{r.old_rc:>8.4f} "
            f"{r.new_rc:>8.4f} "
            f"{r.delta_rc:>+8.4f} "
            f"{r.flipped_to_correct:>10} "
            f"{r.flipped_to_incorrect:>12} "
            f"{r.queries_reevaluated:>7} "
            f"{r.queries_errored:>6}"
        )

    print("=" * 110)

    # Aggregate totals
    total_flipped_correct = sum(r.flipped_to_correct for r in results)
    total_flipped_incorrect = sum(r.flipped_to_incorrect for r in results)
    total_reevaluated = sum(r.queries_reevaluated for r in results)
    total_errored = sum(r.queries_errored for r in results)

    print(
        f"{'TOTAL':<45} "
        f"{'':>8} "
        f"{'':>8} "
        f"{'':>8} "
        f"{total_flipped_correct:>10} "
        f"{total_flipped_incorrect:>12} "
        f"{total_reevaluated:>7} "
        f"{total_errored:>6}"
    )
    print()


def print_flipped_details(results: list[ConfigReeval]) -> None:
    """Print detailed information about queries that flipped."""
    any_flips = any(r.flipped_queries for r in results)
    if not any_flips:
        print("No queries changed result_match. The comparator change had no effect.")
        print()
        return

    print("=" * 90)
    print("  FLIPPED QUERY DETAILS")
    print("=" * 90)

    for r in results:
        if not r.flipped_queries:
            continue

        print(f"\n  Config: {r.config_name}")
        print(f"  {'Query ID':<15} {'Category':<20} {'Difficulty':<12} {'Direction':<25} {'Old PS':>7} {'New PS':>7}")
        print(f"  {'-' * 86}")

        for fq in r.flipped_queries:
            print(
                f"  {fq.query_id:<15} "
                f"{fq.category:<20} "
                f"{fq.difficulty:<12} "
                f"{fq.direction:<25} "
                f"{fq.old_partial_score:>7.3f} "
                f"{fq.new_partial_score:>7.3f}"
            )

    print()
    print("=" * 90)

    # Summary of flip directions
    to_correct = sum(r.flipped_to_correct for r in results)
    to_incorrect = sum(r.flipped_to_incorrect for r in results)
    print(f"  Total flipped incorrect -> correct: {to_correct}")
    print(f"  Total flipped correct -> incorrect: {to_incorrect}")
    if to_incorrect > 0:
        print("  WARNING: Some queries that were previously correct are now incorrect!")
    print("=" * 90)
    print()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    """Re-evaluate all Phase 2 result files."""
    parser = argparse.ArgumentParser(
        description="Re-evaluate Phase 2 results with the current comparator"
    )
    parser.add_argument(
        "--results-dir",
        type=Path,
        default=DEFAULT_RESULTS_DIR,
        help="Directory containing *_results.jsonl files",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SEC,
        help=f"Per-query execution timeout in seconds (default {DEFAULT_TIMEOUT_SEC})",
    )
    parser.add_argument(
        "--config",
        type=str,
        default=None,
        help="Only re-evaluate this config (substring match on filename)",
    )
    parser.add_argument(
        "--use-benchmark-gold",
        action="store_true",
        default=False,
        help="Use gold SQL from benchmark JSON files instead of JSONL",
    )
    args = parser.parse_args()

    results_dir = args.results_dir.resolve()
    output_file = results_dir / "reevaluation_results.json"

    logger.info("=" * 70)
    logger.info("PHASE 2 RE-EVALUATION (no LLM calls)")
    logger.info("  Results dir: %s", results_dir)
    logger.info("  Output file: %s", output_file)
    logger.info("  Timeout: %ds per query", args.timeout)
    logger.info("=" * 70)

    # Optionally load gold SQL from benchmark files
    gold_sql_override: dict[str, str] | None = None
    if args.use_benchmark_gold:
        gold_sql_override = load_benchmark_gold_sql()
        logger.info("Loaded %d gold SQL entries from benchmark files", len(gold_sql_override))

    # Find all JSONL result files
    jsonl_files = sorted(results_dir.glob("*_results.jsonl"))
    if args.config:
        jsonl_files = [f for f in jsonl_files if args.config in f.stem]
    if not jsonl_files:
        logger.error("No *_results.jsonl files found in %s", results_dir)
        sys.exit(1)

    logger.info("Found %d result files to re-evaluate:", len(jsonl_files))
    for f in jsonl_files:
        logger.info("  - %s", f.name)

    # Initialize ClickHouse connection
    sql_executor = SQLExecutor(host="localhost", port=9000, timeout=args.timeout)
    if not sql_executor.test_connection():
        logger.error("ClickHouse connection failed at localhost:9000. Exiting.")
        sys.exit(1)
    logger.info("ClickHouse connection verified.")

    # Re-evaluate each config
    all_results: list[ConfigReeval] = []
    start_time = time.time()

    for jsonl_file in jsonl_files:
        try:
            result = reevaluate_config(jsonl_file, sql_executor, timeout_sec=args.timeout, gold_sql_override=gold_sql_override)
            all_results.append(result)
        except Exception as e:
            logger.error("Failed to re-evaluate %s: %s", jsonl_file.name, e)
            continue

    elapsed = time.time() - start_time
    logger.info("Re-evaluation completed in %.1f seconds.", elapsed)

    # Close ClickHouse connection
    sql_executor.close()

    # Print summary table
    print_summary_table(all_results)

    # Print flipped query details
    print_flipped_details(all_results)

    # Save results to JSON
    output = {
        "description": "Re-evaluation of Phase 2 results with updated comparator",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": round(elapsed, 1),
        "total_configs": len(all_results),
        "total_queries_reevaluated": sum(
            r.queries_reevaluated for r in all_results
        ),
        "total_flipped_to_correct": sum(
            r.flipped_to_correct for r in all_results
        ),
        "total_flipped_to_incorrect": sum(
            r.flipped_to_incorrect for r in all_results
        ),
        "configs": [r.to_dict() for r in all_results],
    }

    OUTPUT_FILE = output_file
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(json.dumps(output, indent=2))
    logger.info("Re-evaluation results saved to %s", OUTPUT_FILE)


if __name__ == "__main__":
    main()
