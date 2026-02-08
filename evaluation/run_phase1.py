#!/usr/bin/env python3
"""
run_phase1.py -- Phase 1 Baseline Experiments

Runs the Phase 1 baseline evaluation: 4 schema formats × 1 model × 150 queries
= 600 API calls. Tests DDL, Markdown, JSON, and Natural Language schema formats
with Full scope, No metadata, and Zero-shot examples.

Uses Claude 3.5 Sonnet (primary) for all baseline runs.

Results are saved to evaluation/results/phase1/ as JSON files.

Usage:
    python -m evaluation.run_phase1
    # or
    python evaluation/run_phase1.py
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# Ensure project root is on the path
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from evaluation.framework.prompt_builder import (
    PromptBuilder,
    SchemaFormat,
    SchemaScope,
    MetadataLevel,
    ExampleStrategy,
)
from evaluation.framework.llm_caller import LLMCaller
from evaluation.framework.sql_executor import SQLExecutor
from evaluation.framework.result_comparator import (
    compare_results,
    MatchStrategy,
    ComparisonResult,
)
from evaluation.framework.schema_linker import SchemaLinker, SchemaLinkingResult

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MODEL = "claude-3-5-sonnet-20241022"
DATASET = "custom_analytics"
BENCHMARK_DIR = str(project_root / "evaluation" / "benchmark")
RESULTS_DIR = str(project_root / "evaluation" / "results" / "phase1")
CHECKPOINT_FILE = str(project_root / "evaluation" / "results" / "phase1" / "checkpoint.json")

# Formats to test
FORMATS = [
    SchemaFormat.DDL,
    SchemaFormat.MARKDOWN,
    SchemaFormat.JSON,
    SchemaFormat.NATURAL_LANGUAGE,
]

# Fixed dimensions for Phase 1
SCOPE = SchemaScope.FULL
METADATA = MetadataLevel.NONE
EXAMPLES = ExampleStrategy.ZERO_SHOT

# Rate limiting
API_DELAY_SEC = 0.3  # Delay between API calls

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("phase1")


# ---------------------------------------------------------------------------
# Result data structures
# ---------------------------------------------------------------------------

@dataclass
class QueryEvalResult:
    """Single query evaluation result."""
    query_id: str
    category: str
    difficulty: str
    natural_language: str
    gold_sql: str
    predicted_sql: str
    # Execution
    pred_executed: bool
    gold_executed: bool
    pred_error: str
    # Comparison
    result_match: bool
    match_strategy: str
    partial_score: float
    pred_row_count: int
    gold_row_count: int
    # Schema linking
    table_f1: float
    column_f1: float
    overall_f1: float
    table_precision: float
    table_recall: float
    column_precision: float
    column_recall: float
    # Efficiency
    input_tokens: int
    output_tokens: int
    latency_ms: float
    token_estimate: int
    # Errors
    error: str = ""


@dataclass
class RunResult:
    """Results for a single configuration run."""
    config_name: str
    schema_format: str
    model: str
    dataset: str
    timestamp: str
    query_results: list[dict] = field(default_factory=list)
    # Aggregate metrics
    execution_accuracy: float = 0.0
    result_correctness: float = 0.0
    schema_linking_f1: float = 0.0
    avg_input_tokens: float = 0.0
    avg_output_tokens: float = 0.0
    avg_latency_ms: float = 0.0
    total_queries: int = 0
    successful_queries: int = 0
    correct_queries: int = 0
    # Per-category breakdown
    per_category: dict = field(default_factory=dict)
    # Per-difficulty breakdown
    per_difficulty: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Query loading
# ---------------------------------------------------------------------------

def load_all_queries(benchmark_dir: str, dataset: str) -> list[dict]:
    """Load all benchmark queries for a dataset."""
    queries_dir = Path(benchmark_dir) / "queries"
    all_queries = []

    for json_file in sorted(queries_dir.glob("*.json")):
        try:
            data = json.loads(json_file.read_text())
            items = data if isinstance(data, list) else data.get("queries", [])
            matched = [q for q in items if q.get("dataset", "").lower() == dataset.lower()]
            if matched:
                all_queries.extend(matched)
                logger.info("Loaded %d queries from %s", len(matched), json_file.name)
        except Exception as e:
            logger.warning("Failed to load %s: %s", json_file, e)

    logger.info("Total queries loaded: %d", len(all_queries))
    return all_queries


# ---------------------------------------------------------------------------
# Checkpoint management
# ---------------------------------------------------------------------------

def load_checkpoint(checkpoint_file: str) -> set:
    """Load completed query keys from checkpoint."""
    path = Path(checkpoint_file)
    if path.exists():
        try:
            data = json.loads(path.read_text())
            return set(data.get("completed", []))
        except Exception:
            pass
    return set()


def save_checkpoint(checkpoint_file: str, completed: set) -> None:
    """Save completed query keys to checkpoint."""
    path = Path(checkpoint_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"completed": sorted(completed)}, indent=2))


# ---------------------------------------------------------------------------
# Metrics computation
# ---------------------------------------------------------------------------

def compute_aggregate_metrics(results: list[QueryEvalResult]) -> dict:
    """Compute aggregate metrics from a list of query results."""
    if not results:
        return {}

    total = len(results)
    successful = sum(1 for r in results if r.pred_executed)
    correct = sum(1 for r in results if r.result_match)

    avg_f1 = sum(r.overall_f1 for r in results) / total
    avg_input = sum(r.input_tokens for r in results) / total
    avg_output = sum(r.output_tokens for r in results) / total
    avg_latency = sum(r.latency_ms for r in results) / total

    return {
        "execution_accuracy": round(successful / total, 4),
        "result_correctness": round(correct / total, 4),
        "schema_linking_f1": round(avg_f1, 4),
        "avg_input_tokens": round(avg_input, 1),
        "avg_output_tokens": round(avg_output, 1),
        "avg_latency_ms": round(avg_latency, 1),
        "total_queries": total,
        "successful_queries": successful,
        "correct_queries": correct,
    }


def compute_category_metrics(results: list[QueryEvalResult]) -> dict:
    """Compute metrics broken down by category."""
    from collections import defaultdict
    groups = defaultdict(list)
    for r in results:
        groups[r.category].append(r)

    return {cat: compute_aggregate_metrics(items) for cat, items in sorted(groups.items())}


def compute_difficulty_metrics(results: list[QueryEvalResult]) -> dict:
    """Compute metrics broken down by difficulty."""
    from collections import defaultdict
    groups = defaultdict(list)
    for r in results:
        groups[r.difficulty].append(r)

    return {diff: compute_aggregate_metrics(items) for diff, items in sorted(groups.items())}


# ---------------------------------------------------------------------------
# Main evaluation loop
# ---------------------------------------------------------------------------

def evaluate_single_query(
    query: dict,
    prompt_builder: PromptBuilder,
    llm_caller: LLMCaller,
    sql_executor: SQLExecutor,
    schema_linker: SchemaLinker,
    schema_format: SchemaFormat,
) -> QueryEvalResult:
    """Evaluate a single query through the full pipeline."""

    query_id = query.get("id", "unknown")
    category = query.get("category", "")
    difficulty = query.get("difficulty", "")
    question = query.get("natural_language", "")
    gold_sql = query.get("sql", "")
    tables_used = query.get("tables_used", [])
    columns_used = query.get("columns_used", [])

    # Defaults for error case
    result = QueryEvalResult(
        query_id=query_id, category=category, difficulty=difficulty,
        natural_language=question, gold_sql=gold_sql, predicted_sql="",
        pred_executed=False, gold_executed=False, pred_error="",
        result_match=False, match_strategy="semantic", partial_score=0.0,
        pred_row_count=0, gold_row_count=0,
        table_f1=0.0, column_f1=0.0, overall_f1=0.0,
        table_precision=0.0, table_recall=0.0,
        column_precision=0.0, column_recall=0.0,
        input_tokens=0, output_tokens=0, latency_ms=0.0, token_estimate=0,
    )

    # Step 1: Build prompt
    try:
        prompt_result = prompt_builder.build_prompt(
            question=question,
            dataset=DATASET,
            format=schema_format,
            scope=SCOPE,
            metadata=METADATA,
            examples=EXAMPLES,
            relevant_tables=tables_used if tables_used else None,
            relevant_columns=columns_used if columns_used else None,
        )
        result.token_estimate = prompt_result.token_estimate
    except Exception as e:
        result.error = f"Prompt build error: {e}"
        logger.warning("Prompt build failed for %s: %s", query_id, e)
        return result

    # Step 2: Call LLM
    try:
        llm_response = llm_caller.call(
            prompt=prompt_result.user_message,
            system=prompt_result.system_message,
        )
    except Exception as e:
        result.error = f"LLM call error: {e}"
        logger.warning("LLM call failed for %s: %s", query_id, e)
        return result

    if not llm_response.success:
        result.error = f"LLM error: {llm_response.error}"
        result.input_tokens = llm_response.input_tokens
        result.latency_ms = llm_response.latency_ms
        return result

    result.predicted_sql = llm_response.sql
    result.input_tokens = llm_response.input_tokens
    result.output_tokens = llm_response.output_tokens
    result.latency_ms = llm_response.latency_ms

    # Step 3: Execute predicted SQL
    try:
        pred_exec = sql_executor.execute(llm_response.sql)
        result.pred_executed = pred_exec.success
        result.pred_row_count = pred_exec.row_count
        if not pred_exec.success:
            result.pred_error = pred_exec.error
    except Exception as e:
        result.pred_error = str(e)

    # Step 4: Execute gold SQL
    try:
        gold_exec = sql_executor.execute(gold_sql)
        result.gold_executed = gold_exec.success
        result.gold_row_count = gold_exec.row_count
    except Exception as e:
        result.error = f"Gold SQL execution error: {e}"
        return result

    # Step 5: Compare results
    if result.pred_executed and result.gold_executed:
        try:
            # Limit rows for comparison to avoid O(n²) blowup on large results
            MAX_COMPARE_ROWS = 500
            pred_rows = pred_exec.results
            gold_rows = gold_exec.results
            pred_cols = pred_exec.columns
            gold_cols = gold_exec.columns

            if len(pred_rows) > MAX_COMPARE_ROWS or len(gold_rows) > MAX_COMPARE_ROWS:
                # For very large result sets: check row count match first,
                # then compare first N rows with EXACT strategy (fast)
                row_count_match = (len(pred_rows) == len(gold_rows))
                if row_count_match and len(pred_rows) > 0:
                    comparison = compare_results(
                        predicted_rows=pred_rows[:MAX_COMPARE_ROWS],
                        gold_rows=gold_rows[:MAX_COMPARE_ROWS],
                        predicted_cols=pred_cols,
                        gold_cols=gold_cols,
                        strategy=MatchStrategy.SET,
                    )
                else:
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
            result.result_match = comparison.match
            result.match_strategy = comparison.strategy.value
            result.partial_score = comparison.partial_score
        except Exception as e:
            result.error = f"Comparison error: {e}"

    # Step 6: Schema linking
    if result.predicted_sql:
        try:
            linking = schema_linker.compare(llm_response.sql, gold_sql)
            result.table_f1 = linking.table_f1
            result.column_f1 = linking.column_f1
            result.overall_f1 = linking.overall_f1
            result.table_precision = linking.table_precision
            result.table_recall = linking.table_recall
            result.column_precision = linking.column_precision
            result.column_recall = linking.column_recall
        except Exception as e:
            logger.warning("Schema linking failed for %s: %s", query_id, e)

    return result


def run_format_baseline(
    schema_format: SchemaFormat,
    queries: list[dict],
    prompt_builder: PromptBuilder,
    llm_caller: LLMCaller,
    sql_executor: SQLExecutor,
    schema_linker: SchemaLinker,
    completed_keys: set,
    results_dir: str,
) -> RunResult:
    """Run baseline evaluation for a single schema format."""

    config_name = f"{schema_format.value}_full_none_zero_shot"
    logger.info("=" * 72)
    logger.info("Starting: %s (%d queries)", config_name, len(queries))
    logger.info("=" * 72)

    run = RunResult(
        config_name=config_name,
        schema_format=schema_format.value,
        model=MODEL,
        dataset=DATASET,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    eval_results: list[QueryEvalResult] = []
    total = len(queries)

    # Incremental results file (JSONL)
    results_file = Path(results_dir) / f"{config_name}_results.jsonl"

    # Load any previously saved incremental results
    if results_file.exists():
        for line in results_file.read_text().strip().split("\n"):
            if line.strip():
                try:
                    d = json.loads(line)
                    eval_results.append(QueryEvalResult(**d))
                except Exception:
                    pass
        logger.info("Loaded %d previously saved results for %s", len(eval_results), config_name)

    for idx, query in enumerate(queries, 1):
        qid = query.get("id", f"q_{idx}")
        checkpoint_key = f"{config_name}::{qid}"

        # Skip already completed
        if checkpoint_key in completed_keys:
            logger.debug("Skip (checkpoint): %s", qid)
            continue

        # Progress
        if idx == 1 or idx == total or idx % 10 == 0:
            logger.info("  [%s] %d/%d (%.1f%%)", config_name, idx, total, 100.0 * idx / total)

        # Evaluate
        qr = evaluate_single_query(
            query=query,
            prompt_builder=prompt_builder,
            llm_caller=llm_caller,
            sql_executor=sql_executor,
            schema_linker=schema_linker,
            schema_format=schema_format,
        )
        eval_results.append(qr)

        # Save result immediately to JSONL
        with open(results_file, "a") as f:
            f.write(json.dumps({
                "query_id": qr.query_id, "category": qr.category,
                "difficulty": qr.difficulty, "natural_language": qr.natural_language,
                "gold_sql": qr.gold_sql, "predicted_sql": qr.predicted_sql,
                "pred_executed": qr.pred_executed, "gold_executed": qr.gold_executed,
                "pred_error": qr.pred_error, "result_match": qr.result_match,
                "match_strategy": qr.match_strategy, "partial_score": qr.partial_score,
                "pred_row_count": qr.pred_row_count, "gold_row_count": qr.gold_row_count,
                "table_f1": qr.table_f1, "column_f1": qr.column_f1,
                "overall_f1": qr.overall_f1, "table_precision": qr.table_precision,
                "table_recall": qr.table_recall, "column_precision": qr.column_precision,
                "column_recall": qr.column_recall, "input_tokens": qr.input_tokens,
                "output_tokens": qr.output_tokens, "latency_ms": qr.latency_ms,
                "token_estimate": qr.token_estimate, "error": qr.error,
            }) + "\n")

        # Log result
        status = "CORRECT" if qr.result_match else ("EXEC" if qr.pred_executed else "FAIL")
        logger.info(
            "  %s: %s | F1=%.2f | tok=%d+%d | %.0fms",
            qid, status, qr.overall_f1, qr.input_tokens, qr.output_tokens, qr.latency_ms,
        )

        # Checkpoint
        completed_keys.add(checkpoint_key)
        save_checkpoint(CHECKPOINT_FILE, completed_keys)

        # Rate limit
        if API_DELAY_SEC > 0:
            time.sleep(API_DELAY_SEC)

    # Compute aggregate metrics
    if eval_results:
        agg = compute_aggregate_metrics(eval_results)
        run.execution_accuracy = agg["execution_accuracy"]
        run.result_correctness = agg["result_correctness"]
        run.schema_linking_f1 = agg["schema_linking_f1"]
        run.avg_input_tokens = agg["avg_input_tokens"]
        run.avg_output_tokens = agg["avg_output_tokens"]
        run.avg_latency_ms = agg["avg_latency_ms"]
        run.total_queries = agg["total_queries"]
        run.successful_queries = agg["successful_queries"]
        run.correct_queries = agg["correct_queries"]
        run.per_category = compute_category_metrics(eval_results)
        run.per_difficulty = compute_difficulty_metrics(eval_results)

        # Convert query results to dicts for JSON serialization
        for qr in eval_results:
            run.query_results.append({
                "query_id": qr.query_id,
                "category": qr.category,
                "difficulty": qr.difficulty,
                "natural_language": qr.natural_language,
                "gold_sql": qr.gold_sql,
                "predicted_sql": qr.predicted_sql,
                "pred_executed": qr.pred_executed,
                "result_match": qr.result_match,
                "partial_score": qr.partial_score,
                "pred_row_count": qr.pred_row_count,
                "gold_row_count": qr.gold_row_count,
                "table_f1": qr.table_f1,
                "column_f1": qr.column_f1,
                "overall_f1": qr.overall_f1,
                "input_tokens": qr.input_tokens,
                "output_tokens": qr.output_tokens,
                "latency_ms": qr.latency_ms,
                "token_estimate": qr.token_estimate,
                "pred_error": qr.pred_error,
                "error": qr.error,
            })

    # Save run results
    out_dir = Path(results_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{config_name}__{MODEL.replace('/', '_')}.json"
    out_file.write_text(json.dumps(asdict(run), indent=2, default=str))
    logger.info("Results saved to %s", out_file)

    # Log summary
    logger.info(
        "Run complete: %s | EX=%.3f RC=%.3f F1=%.3f | Tokens=%.0f | Latency=%.0fms | %d/%d correct",
        config_name, run.execution_accuracy, run.result_correctness,
        run.schema_linking_f1, run.avg_input_tokens, run.avg_latency_ms,
        run.correct_queries, run.total_queries,
    )

    return run


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    """Run Phase 1 baseline experiments."""
    logger.info("=" * 72)
    logger.info("PHASE 1: BASELINE EXPERIMENTS")
    logger.info("Model: %s", MODEL)
    logger.info("Dataset: %s", DATASET)
    logger.info("Formats: %s", [f.value for f in FORMATS])
    logger.info("=" * 72)

    # Create results directory
    Path(RESULTS_DIR).mkdir(parents=True, exist_ok=True)

    # Add file handler for logging
    log_file = Path(RESULTS_DIR) / "phase1.log"
    file_handler = logging.FileHandler(str(log_file))
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    logging.getLogger().addHandler(file_handler)

    # Load queries
    queries = load_all_queries(BENCHMARK_DIR, DATASET)
    if not queries:
        logger.error("No queries found. Exiting.")
        return

    # Load checkpoint
    completed_keys = load_checkpoint(CHECKPOINT_FILE)
    logger.info("Loaded %d completed checkpoints", len(completed_keys))

    # Initialize components
    prompt_builder = PromptBuilder(BENCHMARK_DIR)
    llm_caller = LLMCaller(model=MODEL, max_tokens=1024, temperature=0.0)
    sql_executor = SQLExecutor(host="localhost", port=9000)
    schema_linker = SchemaLinker()

    # Test ClickHouse connection
    if not sql_executor.test_connection():
        logger.error("ClickHouse connection failed. Exiting.")
        return
    logger.info("ClickHouse connection verified.")

    # Run each format
    all_runs: list[RunResult] = []
    for fmt in FORMATS:
        run = run_format_baseline(
            schema_format=fmt,
            queries=queries,
            prompt_builder=prompt_builder,
            llm_caller=llm_caller,
            sql_executor=sql_executor,
            schema_linker=schema_linker,
            completed_keys=completed_keys,
            results_dir=RESULTS_DIR,
        )
        all_runs.append(run)

    # Save consolidated summary
    summary = {
        "phase": "phase_1_baselines",
        "model": MODEL,
        "dataset": DATASET,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_api_calls": sum(r.total_queries for r in all_runs),
        "runs": [],
    }
    for run in all_runs:
        summary["runs"].append({
            "config_name": run.config_name,
            "schema_format": run.schema_format,
            "execution_accuracy": run.execution_accuracy,
            "result_correctness": run.result_correctness,
            "schema_linking_f1": run.schema_linking_f1,
            "avg_input_tokens": run.avg_input_tokens,
            "avg_output_tokens": run.avg_output_tokens,
            "avg_latency_ms": run.avg_latency_ms,
            "total_queries": run.total_queries,
            "correct_queries": run.correct_queries,
            "per_category": run.per_category,
            "per_difficulty": run.per_difficulty,
        })

    summary_file = Path(RESULTS_DIR) / "phase1_summary.json"
    summary_file.write_text(json.dumps(summary, indent=2))
    logger.info("Phase 1 summary saved to %s", summary_file)

    # Print final summary table
    print("\n" + "=" * 80)
    print("PHASE 1 RESULTS SUMMARY")
    print("=" * 80)
    print(f"{'Format':<20} {'EX':>8} {'RC':>8} {'F1':>8} {'Tokens':>8} {'Latency':>8} {'Correct':>10}")
    print("-" * 80)
    for run in all_runs:
        print(
            f"{run.schema_format:<20} "
            f"{run.execution_accuracy:>8.3f} "
            f"{run.result_correctness:>8.3f} "
            f"{run.schema_linking_f1:>8.3f} "
            f"{run.avg_input_tokens:>8.0f} "
            f"{run.avg_latency_ms:>8.0f} "
            f"{run.correct_queries:>4}/{run.total_queries:<4}"
        )
    print("=" * 80)

    # Cleanup
    sql_executor.close()
    logger.info("Phase 1 complete.")


if __name__ == "__main__":
    main()
