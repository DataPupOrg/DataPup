#!/usr/bin/env python3
"""
run_phase2.py -- Phase 2 OFAT (One-Factor-At-a-Time) Experiments

Runs the Phase 2 ablation study for the three remaining research questions:
  RQ2: Schema Scope        (Full, Relevant_Subset, Progressive, User_Guided)
  RQ3: Metadata Level      (None, Descriptions, Sample_Values, Statistics, All)
  RQ4: Example Strategy    (Zero_Shot, Static_Few_Shot, Dynamic_Few_Shot, Schema_Matched)

Phase 1 (RQ1: Schema Format) results are loaded from
  evaluation/results/phase1/phase1_summary.json
to determine the best-performing schema format.  That best format becomes the
fixed value for subsequent dimensions.

OFAT design:
  - Each dimension is varied one at a time while all others are held at
    their best / default value determined from the preceding dimension.
  - RQ2 uses best_format from Phase 1, None metadata, Zero-shot examples.
  - RQ3 uses best_format, best_scope from RQ2, Zero-shot examples.
  - RQ4 uses best_format, best_scope, best_metadata from RQ3.

Results are saved to evaluation/results/phase2/ as JSONL (incremental) and
JSON (per-config summary).

Usage:
    python -m evaluation.run_phase2
    # or
    python evaluation/run_phase2.py
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from collections import defaultdict
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
    PromptVersion,
)
from evaluation.framework.llm_caller import LLMCaller
from evaluation.framework.sql_executor import SQLExecutor
from evaluation.framework.result_comparator import (
    compare_results,
    MatchStrategy,
    ComparisonResult,
)
from evaluation.framework.schema_linker import SchemaLinker, SchemaLinkingResult
from evaluation.framework.self_corrector import SelfCorrector, CorrectionResult
from evaluation.framework.self_consistency import SelfConsistencyVoter, VotingResult
from evaluation.framework.result_comparator import ResultComparator
from evaluation.framework.chain_of_thought import generate_with_cot, CoTResult

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_MODEL = "claude-3-5-sonnet-20241022"
DEFAULT_DATASET = "custom_analytics"
MODEL = DEFAULT_MODEL
DATASET = DEFAULT_DATASET
BENCHMARK_DIR = str(project_root / "evaluation" / "benchmark")
PHASE1_SUMMARY = str(
    project_root / "evaluation" / "results" / "phase1" / "phase1_summary.json"
)
RESULTS_DIR = str(project_root / "evaluation" / "results" / "phase2")
CHECKPOINT_FILE = str(
    project_root / "evaluation" / "results" / "phase2" / "checkpoint.json"
)

# OFAT dimension values
SCOPES = [
    SchemaScope.FULL,
    SchemaScope.RELEVANT_SUBSET,
    SchemaScope.PROGRESSIVE,
    SchemaScope.USER_GUIDED,
]

METADATA_LEVELS = [
    MetadataLevel.NONE,
    MetadataLevel.DESCRIPTIONS,
    MetadataLevel.SAMPLE_VALUES,
    MetadataLevel.STATISTICS,
    MetadataLevel.ALL,
]

EXAMPLE_STRATEGIES = [
    ExampleStrategy.ZERO_SHOT,
    ExampleStrategy.STATIC_FEW_SHOT,
    ExampleStrategy.DYNAMIC_FEW_SHOT,
    ExampleStrategy.SCHEMA_MATCHED,
]

# Rate limiting
API_DELAY_SEC = 0.3

# Row limit for result comparison to avoid O(n^2) blowup
MAX_COMPARE_ROWS = 500

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("phase2")


# ---------------------------------------------------------------------------
# Result data structures  (same as Phase 1 for consistency)
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
    # Self-consistency voting metadata (populated when --self-consistency is used)
    voting_confidence: Optional[float] = None
    voting_n_candidates: Optional[int] = None
    voting_n_distinct_results: Optional[int] = None
    voting_vote_count: Optional[int] = None


@dataclass
class RunResult:
    """Results for a single configuration run."""
    config_name: str
    research_question: str
    schema_format: str
    schema_scope: str
    metadata_level: str
    example_strategy: str
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
# Phase 1 result loading
# ---------------------------------------------------------------------------

def load_phase1_best_format(summary_path: str) -> SchemaFormat:
    """
    Load Phase 1 summary and determine the best schema format.

    The best format is the one with the highest result_correctness.
    Ties are broken by execution_accuracy, then by schema_linking_f1.
    """
    path = Path(summary_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Phase 1 summary not found at {summary_path}. "
            "Run Phase 1 first with: python -m evaluation.run_phase1"
        )

    data = json.loads(path.read_text())
    runs = data.get("runs", [])
    if not runs:
        raise ValueError("Phase 1 summary contains no runs.")

    # Sort by (result_correctness DESC, execution_accuracy DESC, schema_linking_f1 DESC)
    runs_sorted = sorted(
        runs,
        key=lambda r: (
            r.get("result_correctness", 0),
            r.get("execution_accuracy", 0),
            r.get("schema_linking_f1", 0),
        ),
        reverse=True,
    )

    best_run = runs_sorted[0]
    best_format_str = best_run["schema_format"]

    # Map string back to enum
    format_map = {f.value: f for f in SchemaFormat}
    if best_format_str not in format_map:
        raise ValueError(
            f"Unknown schema format '{best_format_str}' in Phase 1 results. "
            f"Valid formats: {list(format_map.keys())}"
        )

    best_format = format_map[best_format_str]

    logger.info(
        "Phase 1 best format: %s (RC=%.4f, EX=%.4f, F1=%.4f)",
        best_format.value,
        best_run.get("result_correctness", 0),
        best_run.get("execution_accuracy", 0),
        best_run.get("schema_linking_f1", 0),
    )

    return best_format


# ---------------------------------------------------------------------------
# Query loading  (same as Phase 1)
# ---------------------------------------------------------------------------

def load_all_queries(benchmark_dir: str, dataset: str) -> list[dict]:
    """Load all benchmark queries for a dataset."""
    queries_dir = Path(benchmark_dir) / "queries"
    all_queries = []

    for json_file in sorted(queries_dir.glob("*.json")):
        try:
            data = json.loads(json_file.read_text())
            items = data if isinstance(data, list) else data.get("queries", [])
            matched = [
                q for q in items if q.get("dataset", "").lower() == dataset.lower()
            ]
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
    groups: dict[str, list[QueryEvalResult]] = defaultdict(list)
    for r in results:
        groups[r.category].append(r)
    return {cat: compute_aggregate_metrics(items) for cat, items in sorted(groups.items())}


def compute_difficulty_metrics(results: list[QueryEvalResult]) -> dict:
    """Compute metrics broken down by difficulty."""
    groups: dict[str, list[QueryEvalResult]] = defaultdict(list)
    for r in results:
        groups[r.difficulty].append(r)
    return {diff: compute_aggregate_metrics(items) for diff, items in sorted(groups.items())}


# ---------------------------------------------------------------------------
# Config name helper
# ---------------------------------------------------------------------------

def make_config_name(
    fmt: SchemaFormat,
    scope: SchemaScope,
    metadata: MetadataLevel,
    examples: ExampleStrategy,
) -> str:
    """Build a unique, human-readable configuration name."""
    return f"{fmt.value}_{scope.value}_{metadata.value}_{examples.value}"


# ---------------------------------------------------------------------------
# Single query evaluation
# ---------------------------------------------------------------------------

def evaluate_single_query(
    query: dict,
    prompt_builder: PromptBuilder,
    llm_caller: LLMCaller,
    sql_executor: SQLExecutor,
    schema_linker: SchemaLinker,
    schema_format: SchemaFormat,
    schema_scope: SchemaScope,
    metadata_level: MetadataLevel,
    example_strategy: ExampleStrategy,
    self_corrector: Optional[SelfCorrector] = None,
    self_consistency_voter: Optional[SelfConsistencyVoter] = None,
    use_cot: bool = False,
    prompt_version: Optional[PromptVersion] = None,
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
        query_id=query_id,
        category=category,
        difficulty=difficulty,
        natural_language=question,
        gold_sql=gold_sql,
        predicted_sql="",
        pred_executed=False,
        gold_executed=False,
        pred_error="",
        result_match=False,
        match_strategy="semantic",
        partial_score=0.0,
        pred_row_count=0,
        gold_row_count=0,
        table_f1=0.0,
        column_f1=0.0,
        overall_f1=0.0,
        table_precision=0.0,
        table_recall=0.0,
        column_precision=0.0,
        column_recall=0.0,
        input_tokens=0,
        output_tokens=0,
        latency_ms=0.0,
        token_estimate=0,
    )

    # Step 1: Build prompt
    # Determine scope-specific parameters
    prompt_kwargs: dict[str, Any] = {
        "question": question,
        "dataset": DATASET,
        "format": schema_format,
        "scope": schema_scope,
        "metadata": metadata_level,
        "examples": example_strategy,
    }

    if prompt_version is not None:
        prompt_kwargs["prompt_version"] = prompt_version

    # For RELEVANT_SUBSET scope, pass the ground-truth tables and columns
    # so the prompt builder includes only the relevant subset.
    if schema_scope == SchemaScope.RELEVANT_SUBSET:
        prompt_kwargs["relevant_tables"] = tables_used if tables_used else None
        prompt_kwargs["relevant_columns"] = columns_used if columns_used else None

    # For USER_GUIDED scope, pass the ground-truth tables as user-specified tables.
    elif schema_scope == SchemaScope.USER_GUIDED:
        prompt_kwargs["user_tables"] = tables_used if tables_used else None

    # For PROGRESSIVE scope, the prompt builder handles expand internally.
    # For FULL scope, no additional parameters needed.

    try:
        prompt_result = prompt_builder.build_prompt(**prompt_kwargs)
        result.token_estimate = prompt_result.token_estimate
    except Exception as e:
        result.error = f"Prompt build error: {e}"
        logger.warning("Prompt build failed for %s: %s", query_id, e)
        return result

    # Step 2: Call LLM (or use self-consistency voting if enabled)
    voting_metadata: Optional[dict] = None
    if self_consistency_voter is not None:
        # Self-consistency mode: generate N candidates and vote
        try:
            voting_result = self_consistency_voter.generate_and_vote(
                prompt=prompt_result.user_message,
                system=prompt_result.system_message,
            )
        except Exception as e:
            result.error = f"Self-consistency voting error: {e}"
            logger.warning("Self-consistency voting failed for %s: %s", query_id, e)
            return result

        if not voting_result.best_sql:
            result.error = "Self-consistency voting produced no valid SQL"
            result.input_tokens = voting_result.total_tokens
            result.latency_ms = float(voting_result.total_latency_ms)
            return result

        result.predicted_sql = voting_result.best_sql
        result.input_tokens = voting_result.total_tokens
        result.output_tokens = 0  # total_tokens already includes output
        result.latency_ms = float(voting_result.total_latency_ms)

        # Track voting metadata for downstream analysis
        voting_metadata = {
            "confidence": voting_result.confidence,
            "n_candidates": voting_result.n_candidates,
            "n_executed": voting_result.n_executed,
            "n_distinct_results": voting_result.n_distinct_results,
            "vote_count": voting_result.vote_count,
        }

        # Create a synthetic llm_response-like reference for schema linking later
        class _SyntheticResponse:
            sql = voting_result.best_sql
        llm_response = _SyntheticResponse()

    elif use_cot:
        # Chain-of-thought mode: two-step generation
        try:
            cot_result = generate_with_cot(
                question=question,
                prompt_result=prompt_result,
                llm_caller=llm_caller,
            )
        except Exception as e:
            result.error = f"CoT generation error: {e}"
            logger.warning("CoT generation failed for %s: %s", query_id, e)
            return result

        if not cot_result.success or not cot_result.final_sql:
            result.error = f"CoT generation failed: {cot_result.error}"
            result.input_tokens = cot_result.total_input_tokens
            result.latency_ms = float(cot_result.total_latency_ms)
            return result

        result.predicted_sql = cot_result.final_sql
        result.input_tokens = cot_result.total_input_tokens
        result.output_tokens = cot_result.total_output_tokens
        result.latency_ms = float(cot_result.total_latency_ms)

        # Create synthetic llm_response for schema linking
        class _SyntheticResponse:
            sql = cot_result.final_sql
        llm_response = _SyntheticResponse()

    else:
        # Standard single-call mode
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

    # Step 3b: Self-correction if predicted SQL failed to execute
    if not result.pred_executed and self_corrector is not None and result.predicted_sql:
        try:
            correction = self_corrector.correct(
                predicted_sql=result.predicted_sql,
                error_message=result.pred_error,
                system_message=prompt_result.system_message,
                original_prompt=prompt_result.user_message,
            )
            # Accumulate token counts and latency from correction attempts
            result.input_tokens += correction.total_input_tokens
            result.output_tokens += correction.total_output_tokens
            result.latency_ms += correction.total_latency_ms

            if correction.corrected:
                result.predicted_sql = correction.final_sql
                # Re-execute the corrected SQL
                pred_exec = sql_executor.execute(correction.final_sql)
                result.pred_executed = pred_exec.success
                result.pred_row_count = pred_exec.row_count
                result.pred_error = pred_exec.error if not pred_exec.success else ""
                logger.info(
                    "Self-correction recovered query %s after %d attempt(s).",
                    query_id, correction.attempts,
                )
            else:
                logger.info(
                    "Self-correction failed for query %s after %d attempt(s).",
                    query_id, correction.attempts,
                )
        except Exception as e:
            logger.warning("Self-correction error for %s: %s", query_id, e)

    # Step 4b: Execution-guided refinement (DISABLED -- net negative impact
    # in initial testing: 9 queries fixed vs 42 made worse due to LLM
    # overconfidence in "correcting" already-correct queries).
    # Kept as dead code for future experiments with more conservative
    # refinement prompts.
    ENABLE_REFINEMENT = False
    if ENABLE_REFINEMENT and result.pred_executed and self_corrector is not None and result.predicted_sql:
        try:
            # Build a brief schema summary (just table names) for context
            schema_tables = [
                t for t in tables_used if t
            ] if tables_used else []
            schema_context = (
                "Tables: " + ", ".join(schema_tables)
            ) if schema_tables else ""

            refinement = self_corrector.refine_with_result_check(
                original_sql=result.predicted_sql,
                original_results=pred_exec.results,
                original_columns=pred_exec.columns,
                question=question,
                schema_context=schema_context,
            )

            # Accumulate refinement token/latency costs
            result.input_tokens += refinement.total_input_tokens
            result.output_tokens += refinement.total_output_tokens
            result.latency_ms += refinement.total_latency_ms

            if refinement.corrected:
                result.predicted_sql = refinement.final_sql
                # Re-execute the refined SQL and use those results
                pred_exec = sql_executor.execute(refinement.final_sql)
                result.pred_executed = pred_exec.success
                result.pred_row_count = pred_exec.row_count
                result.pred_error = (
                    pred_exec.error if not pred_exec.success else ""
                )
                logger.info(
                    "Execution-guided refinement corrected query %s "
                    "after %d attempt(s).",
                    query_id, refinement.attempts,
                )
            else:
                logger.debug(
                    "Execution-guided refinement confirmed query %s "
                    "is correct (or no change needed) after %d attempt(s).",
                    query_id, refinement.attempts,
                )
        except Exception as e:
            logger.warning(
                "Execution-guided refinement error for %s: %s", query_id, e,
            )

    # Step 4c: Conservative execution-guided refinement v2
    # Only triggers on suspicious results (empty, single-row for list questions,
    # extremely large for top-N). Much more conservative than v1.
    ENABLE_CONSERVATIVE_REFINEMENT = True
    if ENABLE_CONSERVATIVE_REFINEMENT and result.pred_executed and self_corrector is not None and result.predicted_sql:
        try:
            refinement = self_corrector.refine_conservative(
                original_sql=result.predicted_sql,
                original_results=pred_exec.results,
                original_columns=pred_exec.columns,
                question=question,
                system_message=prompt_result.system_message,
                schema_context="",
            )

            # Accumulate refinement token/latency costs
            result.input_tokens += refinement.total_input_tokens
            result.output_tokens += refinement.total_output_tokens
            result.latency_ms += refinement.total_latency_ms

            if refinement.corrected:
                result.predicted_sql = refinement.final_sql
                # Re-execute the refined SQL and use those results
                pred_exec = sql_executor.execute(refinement.final_sql)
                result.pred_executed = pred_exec.success
                result.pred_row_count = pred_exec.row_count
                result.pred_error = (
                    pred_exec.error if not pred_exec.success else ""
                )
                logger.info(
                    "Conservative refinement corrected query %s.",
                    query_id,
                )
        except Exception as e:
            logger.warning(
                "Conservative refinement error for %s: %s", query_id, e,
            )

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
            pred_rows = pred_exec.results
            gold_rows = gold_exec.results
            pred_cols = pred_exec.columns
            gold_cols = gold_exec.columns

            if len(pred_rows) > MAX_COMPARE_ROWS or len(gold_rows) > MAX_COMPARE_ROWS:
                # For very large result sets, compare first N rows.
                # Always use SEMANTIC strategy for consistent tolerance.
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

    # Step 7: Attach self-consistency voting metadata if available
    if voting_metadata is not None:
        result.voting_confidence = voting_metadata["confidence"]
        result.voting_n_candidates = voting_metadata["n_candidates"]
        result.voting_n_distinct_results = voting_metadata["n_distinct_results"]
        result.voting_vote_count = voting_metadata["vote_count"]

    return result


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------

def query_result_to_dict(qr: QueryEvalResult) -> dict:
    """Convert a QueryEvalResult to a plain dict for JSON serialization."""
    return {
        "query_id": qr.query_id,
        "category": qr.category,
        "difficulty": qr.difficulty,
        "natural_language": qr.natural_language,
        "gold_sql": qr.gold_sql,
        "predicted_sql": qr.predicted_sql,
        "pred_executed": qr.pred_executed,
        "gold_executed": qr.gold_executed,
        "pred_error": qr.pred_error,
        "result_match": qr.result_match,
        "match_strategy": qr.match_strategy,
        "partial_score": qr.partial_score,
        "pred_row_count": qr.pred_row_count,
        "gold_row_count": qr.gold_row_count,
        "table_f1": qr.table_f1,
        "column_f1": qr.column_f1,
        "overall_f1": qr.overall_f1,
        "table_precision": qr.table_precision,
        "table_recall": qr.table_recall,
        "column_precision": qr.column_precision,
        "column_recall": qr.column_recall,
        "input_tokens": qr.input_tokens,
        "output_tokens": qr.output_tokens,
        "latency_ms": qr.latency_ms,
        "token_estimate": qr.token_estimate,
        "error": qr.error,
        "voting_confidence": qr.voting_confidence,
        "voting_n_candidates": qr.voting_n_candidates,
        "voting_n_distinct_results": qr.voting_n_distinct_results,
        "voting_vote_count": qr.voting_vote_count,
    }


# ---------------------------------------------------------------------------
# Single configuration run
# ---------------------------------------------------------------------------

def run_configuration(
    config_name: str,
    research_question: str,
    schema_format: SchemaFormat,
    schema_scope: SchemaScope,
    metadata_level: MetadataLevel,
    example_strategy: ExampleStrategy,
    queries: list[dict],
    prompt_builder: PromptBuilder,
    llm_caller: LLMCaller,
    sql_executor: SQLExecutor,
    schema_linker: SchemaLinker,
    completed_keys: set,
    results_dir: str,
    self_corrector: Optional[SelfCorrector] = None,
    self_consistency_voter: Optional[SelfConsistencyVoter] = None,
) -> RunResult:
    """Run evaluation for a single OFAT configuration."""

    logger.info("=" * 72)
    logger.info(
        "Starting: %s  [%s]  (%d queries)",
        config_name, research_question, len(queries),
    )
    logger.info(
        "  Format=%s  Scope=%s  Metadata=%s  Examples=%s",
        schema_format.value, schema_scope.value,
        metadata_level.value, example_strategy.value,
    )
    logger.info("=" * 72)

    run = RunResult(
        config_name=config_name,
        research_question=research_question,
        schema_format=schema_format.value,
        schema_scope=schema_scope.value,
        metadata_level=metadata_level.value,
        example_strategy=example_strategy.value,
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
        logger.info(
            "Loaded %d previously saved results for %s",
            len(eval_results), config_name,
        )

    for idx, query in enumerate(queries, 1):
        qid = query.get("id", f"q_{idx}")
        checkpoint_key = f"{config_name}::{qid}"

        # Skip already completed
        if checkpoint_key in completed_keys:
            logger.debug("Skip (checkpoint): %s", qid)
            continue

        # Progress
        if idx == 1 or idx == total or idx % 10 == 0:
            logger.info(
                "  [%s] %d/%d (%.1f%%)",
                config_name, idx, total, 100.0 * idx / total,
            )

        # Evaluate
        qr = evaluate_single_query(
            query=query,
            prompt_builder=prompt_builder,
            llm_caller=llm_caller,
            sql_executor=sql_executor,
            schema_linker=schema_linker,
            schema_format=schema_format,
            schema_scope=schema_scope,
            metadata_level=metadata_level,
            example_strategy=example_strategy,
            self_corrector=self_corrector,
            self_consistency_voter=self_consistency_voter,
        )
        eval_results.append(qr)

        # Save result immediately to JSONL
        with open(results_file, "a") as f:
            f.write(json.dumps(query_result_to_dict(qr)) + "\n")

        # Log result
        status = "CORRECT" if qr.result_match else ("EXEC" if qr.pred_executed else "FAIL")
        logger.info(
            "  %s: %s | F1=%.2f | tok=%d+%d | %.0fms",
            qid, status, qr.overall_f1,
            qr.input_tokens, qr.output_tokens, qr.latency_ms,
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
        "Run complete: %s | EX=%.3f RC=%.3f F1=%.3f | "
        "Tokens=%.0f | Latency=%.0fms | %d/%d correct",
        config_name, run.execution_accuracy, run.result_correctness,
        run.schema_linking_f1, run.avg_input_tokens, run.avg_latency_ms,
        run.correct_queries, run.total_queries,
    )

    return run


# ---------------------------------------------------------------------------
# Best-value selection helpers
# ---------------------------------------------------------------------------

def select_best_run(
    runs: list[RunResult],
) -> RunResult:
    """
    Select the best run from a list based on result_correctness,
    breaking ties with execution_accuracy, then schema_linking_f1.
    """
    return max(
        runs,
        key=lambda r: (r.result_correctness, r.execution_accuracy, r.schema_linking_f1),
    )


# ---------------------------------------------------------------------------
# RQ dimension runners
# ---------------------------------------------------------------------------

def run_rq2_scope(
    best_format: SchemaFormat,
    queries: list[dict],
    prompt_builder: PromptBuilder,
    llm_caller: LLMCaller,
    sql_executor: SQLExecutor,
    schema_linker: SchemaLinker,
    completed_keys: set,
    results_dir: str,
    self_corrector: Optional[SelfCorrector] = None,
    self_consistency_voter: Optional[SelfConsistencyVoter] = None,
) -> list[RunResult]:
    """
    RQ2: Schema Scope ablation.
    Vary scope while holding format=best_format, metadata=NONE, examples=ZERO_SHOT.
    """
    logger.info("=" * 72)
    logger.info("RQ2: SCHEMA SCOPE ABLATION")
    logger.info("  Fixed: format=%s, metadata=none, examples=zero_shot", best_format.value)
    logger.info("  Varying: %s", [s.value for s in SCOPES])
    logger.info("=" * 72)

    runs: list[RunResult] = []
    for scope in SCOPES:
        config_name = make_config_name(best_format, scope, MetadataLevel.NONE, ExampleStrategy.ZERO_SHOT)
        run = run_configuration(
            config_name=config_name,
            research_question="RQ2_scope",
            schema_format=best_format,
            schema_scope=scope,
            metadata_level=MetadataLevel.NONE,
            example_strategy=ExampleStrategy.ZERO_SHOT,
            queries=queries,
            prompt_builder=prompt_builder,
            llm_caller=llm_caller,
            sql_executor=sql_executor,
            schema_linker=schema_linker,
            completed_keys=completed_keys,
            results_dir=results_dir,
            self_corrector=self_corrector,
            self_consistency_voter=self_consistency_voter,
        )
        runs.append(run)

    return runs


def run_rq3_metadata(
    best_format: SchemaFormat,
    best_scope: SchemaScope,
    queries: list[dict],
    prompt_builder: PromptBuilder,
    llm_caller: LLMCaller,
    sql_executor: SQLExecutor,
    schema_linker: SchemaLinker,
    completed_keys: set,
    results_dir: str,
    self_corrector: Optional[SelfCorrector] = None,
    self_consistency_voter: Optional[SelfConsistencyVoter] = None,
) -> list[RunResult]:
    """
    RQ3: Metadata Level ablation.
    Vary metadata while holding format=best_format, scope=best_scope, examples=ZERO_SHOT.
    """
    logger.info("=" * 72)
    logger.info("RQ3: METADATA LEVEL ABLATION")
    logger.info(
        "  Fixed: format=%s, scope=%s, examples=zero_shot",
        best_format.value, best_scope.value,
    )
    logger.info("  Varying: %s", [m.value for m in METADATA_LEVELS])
    logger.info("=" * 72)

    runs: list[RunResult] = []
    for meta in METADATA_LEVELS:
        config_name = make_config_name(best_format, best_scope, meta, ExampleStrategy.ZERO_SHOT)
        run = run_configuration(
            config_name=config_name,
            research_question="RQ3_metadata",
            schema_format=best_format,
            schema_scope=best_scope,
            metadata_level=meta,
            example_strategy=ExampleStrategy.ZERO_SHOT,
            queries=queries,
            prompt_builder=prompt_builder,
            llm_caller=llm_caller,
            sql_executor=sql_executor,
            schema_linker=schema_linker,
            completed_keys=completed_keys,
            results_dir=results_dir,
            self_corrector=self_corrector,
            self_consistency_voter=self_consistency_voter,
        )
        runs.append(run)

    return runs


def run_rq4_examples(
    best_format: SchemaFormat,
    best_scope: SchemaScope,
    best_metadata: MetadataLevel,
    queries: list[dict],
    prompt_builder: PromptBuilder,
    llm_caller: LLMCaller,
    sql_executor: SQLExecutor,
    schema_linker: SchemaLinker,
    completed_keys: set,
    results_dir: str,
    self_corrector: Optional[SelfCorrector] = None,
    self_consistency_voter: Optional[SelfConsistencyVoter] = None,
) -> list[RunResult]:
    """
    RQ4: Example Strategy ablation.
    Vary example strategy while holding format=best_format, scope=best_scope,
    metadata=best_metadata.
    """
    logger.info("=" * 72)
    logger.info("RQ4: EXAMPLE STRATEGY ABLATION")
    logger.info(
        "  Fixed: format=%s, scope=%s, metadata=%s",
        best_format.value, best_scope.value, best_metadata.value,
    )
    logger.info("  Varying: %s", [e.value for e in EXAMPLE_STRATEGIES])
    logger.info("=" * 72)

    runs: list[RunResult] = []
    for ex_strat in EXAMPLE_STRATEGIES:
        config_name = make_config_name(best_format, best_scope, best_metadata, ex_strat)
        run = run_configuration(
            config_name=config_name,
            research_question="RQ4_examples",
            schema_format=best_format,
            schema_scope=best_scope,
            metadata_level=best_metadata,
            example_strategy=ex_strat,
            queries=queries,
            prompt_builder=prompt_builder,
            llm_caller=llm_caller,
            sql_executor=sql_executor,
            schema_linker=schema_linker,
            completed_keys=completed_keys,
            results_dir=results_dir,
            self_corrector=self_corrector,
            self_consistency_voter=self_consistency_voter,
        )
        runs.append(run)

    return runs


# ---------------------------------------------------------------------------
# Summary printing
# ---------------------------------------------------------------------------

def print_rq_summary(title: str, runs: list[RunResult], varying_field: str) -> None:
    """Print a formatted summary table for a single research question."""
    print(f"\n{'=' * 90}")
    print(f"  {title}")
    print(f"{'=' * 90}")
    header = f"{'Value':<22} {'EX':>8} {'RC':>8} {'F1':>8} {'Tokens':>8} {'Latency':>8} {'Correct':>10}"
    print(header)
    print("-" * 90)
    for run in runs:
        varying_val = getattr(run, varying_field, "?")
        print(
            f"{varying_val:<22} "
            f"{run.execution_accuracy:>8.3f} "
            f"{run.result_correctness:>8.3f} "
            f"{run.schema_linking_f1:>8.3f} "
            f"{run.avg_input_tokens:>8.0f} "
            f"{run.avg_latency_ms:>8.0f} "
            f"{run.correct_queries:>4}/{run.total_queries:<4}"
        )
    print("=" * 90)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    """Run Phase 2 OFAT experiments."""

    # ---- Parse command-line arguments ----
    parser = argparse.ArgumentParser(
        description="Phase 2 OFAT ablation experiments for text-to-SQL evaluation.",
    )
    parser.add_argument(
        "--self-consistency",
        type=int,
        default=0,
        metavar="N",
        help=(
            "Enable self-consistency voting with N candidates. "
            "When N > 0, generates N SQL candidates at temperature > 0 and "
            "picks the one whose execution result receives the most votes. "
            "Default: 0 (disabled)."
        ),
    )
    parser.add_argument(
        "--model",
        type=str,
        default=DEFAULT_MODEL,
        help="Model to use for evaluation (default: %(default)s)",
    )
    parser.add_argument(
        "--dataset",
        type=str,
        default=DEFAULT_DATASET,
        help="Dataset to evaluate on (default: %(default)s)",
    )
    args = parser.parse_args()

    global MODEL, DATASET
    MODEL = args.model
    DATASET = args.dataset

    logger.info("=" * 72)
    logger.info("PHASE 2: OFAT ABLATION EXPERIMENTS")
    logger.info("Model: %s", MODEL)
    logger.info("Dataset: %s", DATASET)
    if args.self_consistency > 0:
        logger.info("Self-consistency voting: enabled (N=%d)", args.self_consistency)
    logger.info("=" * 72)

    # ---- Step 0: Load Phase 1 best format ----
    best_format = load_phase1_best_format(PHASE1_SUMMARY)
    logger.info("Using Phase 1 best format: %s", best_format.value)

    # Create results directory
    Path(RESULTS_DIR).mkdir(parents=True, exist_ok=True)

    # Add file handler for logging
    log_file = Path(RESULTS_DIR) / "phase2.log"
    file_handler = logging.FileHandler(str(log_file))
    file_handler.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    )
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
    llm_caller = LLMCaller(model=MODEL, max_tokens=2048, temperature=0.0)
    sql_executor = SQLExecutor(host="localhost", port=9000)
    schema_linker = SchemaLinker()
    self_corrector = SelfCorrector(llm_caller=llm_caller, sql_executor=sql_executor, max_retries=2)

    # Initialize self-consistency voter if enabled
    self_consistency_voter: Optional[SelfConsistencyVoter] = None
    if args.self_consistency > 0:
        # Create a separate LLM caller for voting with temperature > 0
        voting_llm_caller = LLMCaller(
            model=MODEL, max_tokens=2048, temperature=0.5,
        )
        result_comparator = ResultComparator()
        self_consistency_voter = SelfConsistencyVoter(
            llm_caller=voting_llm_caller,
            executor=sql_executor,
            comparator=result_comparator,
            n_candidates=args.self_consistency,
            temperature=0.5,
        )
        logger.info(
            "Self-consistency voter initialized with %d candidates.",
            args.self_consistency,
        )

    # Test ClickHouse connection
    if not sql_executor.test_connection():
        logger.error("ClickHouse connection failed. Exiting.")
        return
    logger.info("ClickHouse connection verified.")

    # Track all runs across RQs for the final summary
    all_runs: list[RunResult] = []

    # ---- RQ2: Schema Scope ----
    rq2_runs = run_rq2_scope(
        best_format=best_format,
        queries=queries,
        prompt_builder=prompt_builder,
        llm_caller=llm_caller,
        sql_executor=sql_executor,
        schema_linker=schema_linker,
        completed_keys=completed_keys,
        results_dir=RESULTS_DIR,
        self_corrector=self_corrector,
        self_consistency_voter=self_consistency_voter,
    )
    all_runs.extend(rq2_runs)

    best_scope_run = select_best_run(rq2_runs)
    best_scope = SchemaScope(best_scope_run.schema_scope)
    logger.info(
        "RQ2 best scope: %s (RC=%.4f)",
        best_scope.value, best_scope_run.result_correctness,
    )

    # ---- RQ3: Metadata Level ----
    rq3_runs = run_rq3_metadata(
        best_format=best_format,
        best_scope=best_scope,
        queries=queries,
        prompt_builder=prompt_builder,
        llm_caller=llm_caller,
        sql_executor=sql_executor,
        schema_linker=schema_linker,
        completed_keys=completed_keys,
        results_dir=RESULTS_DIR,
        self_corrector=self_corrector,
        self_consistency_voter=self_consistency_voter,
    )
    all_runs.extend(rq3_runs)

    best_meta_run = select_best_run(rq3_runs)
    best_metadata = MetadataLevel(best_meta_run.metadata_level)
    logger.info(
        "RQ3 best metadata: %s (RC=%.4f)",
        best_metadata.value, best_meta_run.result_correctness,
    )

    # ---- RQ4: Example Strategy ----
    rq4_runs = run_rq4_examples(
        best_format=best_format,
        best_scope=best_scope,
        best_metadata=best_metadata,
        queries=queries,
        prompt_builder=prompt_builder,
        llm_caller=llm_caller,
        sql_executor=sql_executor,
        schema_linker=schema_linker,
        completed_keys=completed_keys,
        results_dir=RESULTS_DIR,
        self_corrector=self_corrector,
        self_consistency_voter=self_consistency_voter,
    )
    all_runs.extend(rq4_runs)

    best_example_run = select_best_run(rq4_runs)
    best_examples = ExampleStrategy(best_example_run.example_strategy)
    logger.info(
        "RQ4 best example strategy: %s (RC=%.4f)",
        best_examples.value, best_example_run.result_correctness,
    )

    # ---- Save consolidated Phase 2 summary ----
    summary = {
        "phase": "phase_2_ofat",
        "model": MODEL,
        "dataset": DATASET,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_api_calls": sum(r.total_queries for r in all_runs),
        "phase1_best_format": best_format.value,
        "best_values": {
            "schema_format": best_format.value,
            "schema_scope": best_scope.value,
            "metadata_level": best_metadata.value,
            "example_strategy": best_examples.value,
        },
        "rq2_scope": {
            "description": "Schema Scope ablation (format={}, metadata=none, examples=zero_shot)".format(
                best_format.value
            ),
            "best_value": best_scope.value,
            "runs": [],
        },
        "rq3_metadata": {
            "description": "Metadata Level ablation (format={}, scope={}, examples=zero_shot)".format(
                best_format.value, best_scope.value
            ),
            "best_value": best_metadata.value,
            "runs": [],
        },
        "rq4_examples": {
            "description": "Example Strategy ablation (format={}, scope={}, metadata={})".format(
                best_format.value, best_scope.value, best_metadata.value
            ),
            "best_value": best_examples.value,
            "runs": [],
        },
    }

    for run in rq2_runs:
        summary["rq2_scope"]["runs"].append({
            "config_name": run.config_name,
            "schema_scope": run.schema_scope,
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

    for run in rq3_runs:
        summary["rq3_metadata"]["runs"].append({
            "config_name": run.config_name,
            "metadata_level": run.metadata_level,
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

    for run in rq4_runs:
        summary["rq4_examples"]["runs"].append({
            "config_name": run.config_name,
            "example_strategy": run.example_strategy,
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

    summary_file = Path(RESULTS_DIR) / "phase2_summary.json"
    summary_file.write_text(json.dumps(summary, indent=2))
    logger.info("Phase 2 summary saved to %s", summary_file)

    # ---- Print final summary tables ----
    print("\n")
    print("#" * 90)
    print("  PHASE 2 OFAT RESULTS SUMMARY")
    print(f"  Model: {MODEL}")
    print(f"  Phase 1 best format: {best_format.value}")
    print("#" * 90)

    print_rq_summary(
        "RQ2: Schema Scope  (fixed: format={}, metadata=none, examples=zero_shot)".format(
            best_format.value
        ),
        rq2_runs,
        "schema_scope",
    )
    print_rq_summary(
        "RQ3: Metadata Level  (fixed: format={}, scope={}, examples=zero_shot)".format(
            best_format.value, best_scope.value
        ),
        rq3_runs,
        "metadata_level",
    )
    print_rq_summary(
        "RQ4: Example Strategy  (fixed: format={}, scope={}, metadata={})".format(
            best_format.value, best_scope.value, best_metadata.value
        ),
        rq4_runs,
        "example_strategy",
    )

    print(f"\n{'=' * 90}")
    print("  BEST CONFIGURATION (OFAT)")
    print(f"{'=' * 90}")
    print(f"  Schema Format:    {best_format.value}")
    print(f"  Schema Scope:     {best_scope.value}")
    print(f"  Metadata Level:   {best_metadata.value}")
    print(f"  Example Strategy: {best_examples.value}")
    print(f"{'=' * 90}")

    total_calls = sum(r.total_queries for r in all_runs)
    print(f"\n  Total API calls: {total_calls}")
    print(f"  Total configs:   {len(all_runs)}")
    print()

    # Cleanup
    sql_executor.close()
    logger.info("Phase 2 complete.")


if __name__ == "__main__":
    main()
