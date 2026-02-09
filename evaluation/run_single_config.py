#!/usr/bin/env python3
"""
run_single_config.py -- Run a single configuration evaluation.

Quick evaluation of a specific prompt configuration without running
the full OFAT experiment. Useful for testing prompt improvements.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

# Ensure project root is on the path
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

from evaluation.run_phase2 import (
    evaluate_single_query,
    load_all_queries,
    compute_aggregate_metrics,
    compute_category_metrics,
    query_result_to_dict,
    QueryEvalResult,
    BENCHMARK_DIR,
    API_DELAY_SEC,
)
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
from evaluation.framework.schema_linker import SchemaLinker
from evaluation.framework.self_corrector import SelfCorrector
from evaluation.framework.self_consistency import SelfConsistencyVoter
from evaluation.framework.result_comparator import ResultComparator
from evaluation.framework.chain_of_thought import generate_with_cot

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("single_config")


def main():
    parser = argparse.ArgumentParser(description="Run a single config evaluation")
    parser.add_argument("--self-consistency", type=int, default=0,
                        help="Enable self-consistency voting with N candidates")
    parser.add_argument("--use-cot", action="store_true", default=False,
                        help="Enable chain-of-thought (CoT) two-step generation")
    parser.add_argument("--output", type=str, default=None,
                        help="Output JSONL file path")
    parser.add_argument("--model", type=str, default="claude-3-5-sonnet-20241022",
                        help="Model to use (default: claude-3-5-sonnet-20241022)")
    parser.add_argument("--dataset", type=str, default="custom_analytics",
                        help="Dataset to evaluate on (default: custom_analytics)")
    parser.add_argument("--prompt-version", type=str, default="full",
                        choices=["minimal", "dialect_only", "joins", "window", "full"],
                        help="System prompt ablation version (default: full)")
    args = parser.parse_args()

    model = args.model
    dataset = args.dataset
    prompt_version = PromptVersion(args.prompt_version)

    # Best config from V5
    schema_format = SchemaFormat.MARKDOWN
    schema_scope = SchemaScope.RELEVANT_SUBSET
    metadata_level = MetadataLevel.DESCRIPTIONS
    example_strategy = ExampleStrategy.DYNAMIC_FEW_SHOT

    config_name = f"markdown_relevant_subset_descriptions_dynamic_few_shot"
    if args.self_consistency > 0:
        config_name += f"_sc{args.self_consistency}"
    if args.use_cot:
        config_name += "_cot"

    output_file = args.output or str(
        project_root / "evaluation" / "results" / "phase2" / f"{config_name}_v6_results.jsonl"
    )

    logger.info("Running config: %s", config_name)
    logger.info("Self-consistency: %s", args.self_consistency or "disabled")
    logger.info("Chain-of-thought: %s", "enabled" if args.use_cot else "disabled")

    # Load queries
    queries = load_all_queries(BENCHMARK_DIR, dataset)
    logger.info("Loaded %d queries", len(queries))

    # Initialize components
    prompt_builder = PromptBuilder(BENCHMARK_DIR)
    llm_caller = LLMCaller(model=model, max_tokens=2048, temperature=0.0)
    sql_executor = SQLExecutor(host="localhost", port=9000)
    schema_linker = SchemaLinker()
    self_corrector = SelfCorrector(llm_caller=llm_caller, sql_executor=sql_executor, max_retries=2)

    # Self-consistency voter
    self_consistency_voter = None
    if args.self_consistency > 0:
        voting_llm_caller = LLMCaller(model=model, max_tokens=2048, temperature=0.5)
        comparator = ResultComparator()
        self_consistency_voter = SelfConsistencyVoter(
            llm_caller=voting_llm_caller,
            executor=sql_executor,
            comparator=comparator,
            n_candidates=args.self_consistency,
            temperature=0.5,
        )

    if not sql_executor.test_connection():
        logger.error("ClickHouse connection failed.")
        return

    results: list[QueryEvalResult] = []
    total = len(queries)

    for idx, query in enumerate(queries, 1):
        qid = query.get("id", f"q_{idx}")

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
            use_cot=args.use_cot,
            prompt_version=prompt_version,
        )
        results.append(qr)

        # Save incrementally
        with open(output_file, "a") as f:
            f.write(json.dumps(query_result_to_dict(qr)) + "\n")

        status = "CORRECT" if qr.result_match else ("EXEC" if qr.pred_executed else "FAIL")
        if idx % 10 == 0 or idx == total:
            correct_so_far = sum(1 for r in results if r.result_match)
            logger.info(
                "  [%d/%d] %s: %s | Running RC: %.1f%% (%d/%d)",
                idx, total, qid, status,
                100.0 * correct_so_far / len(results), correct_so_far, len(results),
            )
        else:
            logger.info("  %s: %s | F1=%.2f", qid, status, qr.overall_f1)

        if API_DELAY_SEC > 0:
            time.sleep(API_DELAY_SEC)

    # Final summary
    agg = compute_aggregate_metrics(results)
    cats = compute_category_metrics(results)

    print(f"\n{'='*70}")
    print(f"  Config: {config_name}")
    print(f"  EX: {agg['execution_accuracy']:.3f}  RC: {agg['result_correctness']:.3f}")
    print(f"  Correct: {agg['correct_queries']}/{agg['total_queries']}")
    print(f"{'='*70}")
    print(f"\n  Category Breakdown:")
    for cat, metrics in sorted(cats.items()):
        print(f"    {cat:25s}: {metrics['correct_queries']:3d}/{metrics['total_queries']:3d} = {metrics['result_correctness']:.1%}")
    print(f"{'='*70}")

    sql_executor.close()


if __name__ == "__main__":
    main()
