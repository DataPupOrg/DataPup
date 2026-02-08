"""
experiment_runner.py -- Orchestrate the 5-Phase Text-to-SQL Evaluation Experiment

Main orchestration module for the VLDB research paper evaluation framework
"Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases".

Integrates all framework modules to run the 5-phase experiment plan:

    Phase 1 -- Baselines
        4 schema formats x 1 default per other dimension x 150 queries x 2 models
        = 1200 evaluations.  Establishes baseline performance for each format
        (DDL, Markdown, JSON, NaturalLanguage) with Full scope, None metadata,
        and ZeroShot examples.

    Phase 2 -- OFAT (One-Factor-At-a-Time)
        Using the best format from Phase 1, vary each of the remaining 3
        dimensions independently while holding the others at their Phase 1
        defaults.  Identifies the best value for each dimension in isolation.

    Phase 3 -- Interactions
        Test 2-way interactions between the best values identified in Phase 2.
        Reveals synergy or interference effects between dimensions.

    Phase 4 -- Validation
        Repeat the top configurations from Phase 3 across 3 independent runs
        to quantify reproducibility (variance and 95% confidence intervals).

    Phase 5 -- Ablations
        Starting from the single best configuration, remove each component
        one at a time to measure its marginal contribution.

Features:
    - Dataclass-based experiment configuration (no YAML dependency)
    - Checkpoint / resume for long-running experiments
    - Per-query error handling: exceptions are caught, logged, and the run
      continues to the next query
    - Progress logging with the standard logging module
    - Raw JSON results saved per run; processed summary saved after each phase
    - Deterministic UUID-based run identifiers seeded from config name

Part of the evaluation framework for:
    "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases"
"""

from __future__ import annotations

import json
import logging
import uuid
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from evaluation.framework.prompt_builder import (
    PromptBuilder,
    SchemaFormat,
    SchemaScope,
    MetadataLevel,
    ExampleStrategy,
    PromptResult,
)
from evaluation.framework.llm_caller import LLMCaller, LLMResponse
from evaluation.framework.sql_executor import SQLExecutor, ExecutionResult
from evaluation.framework.result_comparator import (
    ResultComparator,
    MatchStrategy,
    ComparisonResult,
    compare_results,
)
from evaluation.framework.schema_linker import (
    SchemaLinker,
    SchemaLinkingResult,
    SchemaLinks,
)
from evaluation.framework.metrics import (
    MetricsCalculator,
    QueryResult,
    MetricsSummary,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Configuration dataclasses
# ---------------------------------------------------------------------------

@dataclass
class ExperimentConfig:
    """Top-level configuration for a complete experiment session.

    Attributes:
        experiment_name:  Human-readable name for the experiment run.
        benchmark_dir:    Path to ``evaluation/benchmark/`` containing schemas,
                          queries, and examples.
        results_dir:      Path to ``evaluation/results/`` where raw and
                          processed outputs are written.
        models:           List of Claude model identifiers to evaluate.
        datasets:         List of dataset identifiers whose queries will be
                          loaded from ``benchmark/queries/``.
        clickhouse_host:  ClickHouse HTTP interface hostname.
        clickhouse_port:  ClickHouse HTTP interface port.
        phases:           Which phases (1-5) to execute in ``run_all_phases``.
        max_concurrent:   Reserved for future async support; currently unused.
        retry_failed:     If True, retry queries that produced LLM errors on
                          the next checkpoint-resume cycle.
        seed:             Random seed for deterministic UUID generation and
                          any stochastic components.
    """

    experiment_name: str
    benchmark_dir: str
    results_dir: str
    models: list[str] = field(
        default_factory=lambda: [
            "claude-3-5-sonnet-20241022",
            "claude-3-haiku-20240307",
        ]
    )
    datasets: list[str] = field(
        default_factory=lambda: ["custom_analytics", "clickbench"]
    )
    clickhouse_host: str = "localhost"
    clickhouse_port: int = 8123
    phases: list[int] = field(default_factory=lambda: [1, 2, 3, 4, 5])
    max_concurrent: int = 1
    retry_failed: bool = True
    seed: int = 42


@dataclass
class ExperimentRun:
    """Complete record for a single experimental configuration run.

    An *ExperimentRun* captures the configuration axes, the model and dataset
    used, per-query results, aggregate metrics, and timing information.  It is
    the atomic unit of persistence: each run is serialised to its own JSON
    file in ``results/raw/``.

    Attributes:
        run_id:           Auto-generated UUID v4.
        config_name:      Human-readable configuration descriptor, e.g.
                          ``"DDL_Full_None_ZeroShot"``.
        schema_format:    Schema representation format used for this run.
        schema_scope:     Schema scope strategy used for this run.
        metadata_level:   Metadata enrichment level used for this run.
        example_strategy: Few-shot example strategy used for this run.
        model:            Claude model identifier.
        dataset:          Dataset identifier.
        query_results:    Per-query evaluation results.
        metrics:          Aggregate metrics across all queries in this run.
        timestamp:        ISO-8601 timestamp of when the run started.
    """

    run_id: str
    config_name: str
    schema_format: SchemaFormat
    schema_scope: SchemaScope
    metadata_level: MetadataLevel
    example_strategy: ExampleStrategy
    model: str
    dataset: str
    query_results: list[QueryResult] = field(default_factory=list)
    metrics: Optional[MetricsSummary] = None
    timestamp: str = ""


# ---------------------------------------------------------------------------
# Helper: serialise an ExperimentRun to a JSON-safe dictionary
# ---------------------------------------------------------------------------

def _run_to_dict(run: ExperimentRun) -> dict[str, Any]:
    """Convert an ExperimentRun to a JSON-serialisable dictionary.

    Enum values are stored as their ``.value`` strings so that the JSON
    files are human-readable and can be reloaded without importing the
    framework.
    """
    qr_dicts: list[dict[str, Any]] = []
    for qm in run.query_results:
        qr_dicts.append({
            "query_id": qm.query_id,
            "config_id": qm.config_id,
            "dataset": qm.dataset,
            "difficulty": qm.difficulty,
            "execution_accuracy": qm.execution_accuracy,
            "result_correctness": qm.result_correctness,
            "match_type": qm.match_type.value,
            "table_f1": qm.schema_linking.table_f1,
            "column_f1": qm.schema_linking.column_f1,
            "table_precision": qm.schema_linking.table_precision,
            "table_recall": qm.schema_linking.table_recall,
            "column_precision": qm.schema_linking.column_precision,
            "column_recall": qm.schema_linking.column_recall,
            "input_tokens": qm.input_tokens,
            "output_tokens": qm.output_tokens,
            "latency_ms": qm.latency_ms,
            "predicted_sql": qm.predicted_sql,
            "gold_sql": qm.gold_sql,
            "error": qm.error,
        })

    metrics_dict: Optional[dict[str, Any]] = None
    if run.metrics is not None:
        m = run.metrics
        metrics_dict = {
            "execution_accuracy": m.execution_accuracy,
            "result_correctness": m.result_correctness,
            "exact_match_rate": m.exact_match_rate,
            "relaxed_match_rate": m.relaxed_match_rate,
            "schema_linking_f1": m.schema_linking_f1,
            "table_f1": m.table_f1,
            "column_f1": m.column_f1,
            "avg_input_tokens": m.avg_input_tokens,
            "avg_output_tokens": m.avg_output_tokens,
            "avg_latency_ms": m.avg_latency_ms,
            "median_latency_ms": m.median_latency_ms,
            "n_queries": m.n_queries,
            "ci_95_ex": list(m.ci_95_ex),
            "ci_95_rc": list(m.ci_95_rc),
            "match_type_distribution": m.match_type_distribution,
        }

    return {
        "run_id": run.run_id,
        "config_name": run.config_name,
        "schema_format": run.schema_format.value,
        "schema_scope": run.schema_scope.value,
        "metadata_level": run.metadata_level.value,
        "example_strategy": run.example_strategy.value,
        "model": run.model,
        "dataset": run.dataset,
        "timestamp": run.timestamp,
        "query_results": qr_dicts,
        "metrics": metrics_dict,
    }


# ---------------------------------------------------------------------------
# ExperimentRunner
# ---------------------------------------------------------------------------

class ExperimentRunner:
    """Orchestrate the complete 5-phase evaluation experiment.

    The runner wires together every framework component -- prompt builder,
    LLM caller, SQL executor, result comparator, schema linker, and metrics
    calculator -- to evaluate text-to-SQL performance across a systematic
    grid of prompt-engineering strategies.

    Usage::

        config = ExperimentConfig(
            experiment_name="vldb_2026_main",
            benchmark_dir="evaluation/benchmark",
            results_dir="evaluation/results",
        )
        runner = ExperimentRunner(config)
        results = runner.run_all_phases()

    The runner supports checkpoint / resume: after every single-query
    evaluation it persists progress so that an interrupted session can be
    restarted without repeating completed work.
    """

    # Name of the checkpoint file within ``results_dir``.
    CHECKPOINT_FILENAME = "experiment_checkpoint.json"

    # Log progress every N queries within a single configuration run.
    PROGRESS_LOG_INTERVAL = 10

    # Delay (seconds) between consecutive LLM API calls to avoid rate limits.
    API_CALL_DELAY_SEC = 0.5

    def __init__(self, config: ExperimentConfig) -> None:
        """Initialise the runner with the given experiment configuration.

        Creates the directory structure under ``results_dir`` and initialises
        framework components that do not require external connectivity.  The
        LLM caller and SQL executor are created lazily on first use so that
        misconfiguration errors surface close to where they matter.

        Args:
            config: Fully populated ExperimentConfig.
        """
        self.config = config

        self.benchmark_dir = Path(config.benchmark_dir).resolve()
        self.results_dir = Path(config.results_dir).resolve()
        self.raw_dir = self.results_dir / "raw"
        self.processed_dir = self.results_dir / "processed"
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.processed_dir.mkdir(parents=True, exist_ok=True)

        # Lightweight components (no external I/O).
        self.prompt_builder = PromptBuilder(str(self.benchmark_dir))
        self.schema_linker = SchemaLinker()
        self.metrics_calculator = MetricsCalculator()
        self.comparator = ResultComparator(float_tolerance=0.01)

        # Lazily initialised components.
        self._llm_callers: dict[str, LLMCaller] = {}
        self._sql_executor: Optional[SQLExecutor] = None

        # Checkpoint state: set of ``"config_name::model::dataset::query_id"``
        # strings that have already been evaluated.
        self._checkpoint_path = self.results_dir / self.CHECKPOINT_FILENAME
        self._completed_keys: set[str] = set()

        logger.info(
            "ExperimentRunner initialised: experiment=%s, benchmark=%s, "
            "results=%s, models=%s, datasets=%s, phases=%s",
            config.experiment_name,
            self.benchmark_dir,
            self.results_dir,
            config.models,
            config.datasets,
            config.phases,
        )

    # ------------------------------------------------------------------
    # Lazy accessors
    # ------------------------------------------------------------------

    def _get_llm_caller(self, model: str) -> LLMCaller:
        """Return (or create) an LLMCaller for the given model."""
        if model not in self._llm_callers:
            self._llm_callers[model] = LLMCaller(
                model=model, max_tokens=1024, temperature=0.0,
            )
        return self._llm_callers[model]

    @property
    def sql_executor(self) -> SQLExecutor:
        """Lazy-initialise the SQL executor."""
        if self._sql_executor is None:
            self._sql_executor = SQLExecutor(
                host=self.config.clickhouse_host,
                port=self.config.clickhouse_port,
            )
        return self._sql_executor

    # ------------------------------------------------------------------
    # Public orchestration API
    # ------------------------------------------------------------------

    def run_all_phases(self) -> dict[str, Any]:
        """Execute all configured phases and return consolidated results.

        Returns:
            Dictionary keyed by phase name (``"phase_1_baselines"``, etc.)
            with lists of :class:`ExperimentRun` objects as values, plus a
            ``"summary"`` key with the final processed metrics.
        """
        all_results: dict[str, Any] = {}
        self._load_checkpoint()

        try:
            baseline_runs: list[ExperimentRun] = []
            ofat_runs: list[ExperimentRun] = []
            interaction_runs: list[ExperimentRun] = []
            validation_runs: list[ExperimentRun] = []
            ablation_runs: list[ExperimentRun] = []

            # Phase 1
            if 1 in self.config.phases:
                logger.info("=" * 72)
                logger.info("PHASE 1: BASELINES")
                logger.info("=" * 72)
                baseline_runs = self.run_phase_1_baselines()
                all_results["phase_1_baselines"] = baseline_runs
                self._save_phase_summary("phase_1_baselines", baseline_runs)

            # Phase 2
            if 2 in self.config.phases:
                logger.info("=" * 72)
                logger.info("PHASE 2: OFAT (One-Factor-At-a-Time)")
                logger.info("=" * 72)
                ofat_runs = self.run_phase_2_ofat(baseline_runs)
                all_results["phase_2_ofat"] = ofat_runs
                self._save_phase_summary("phase_2_ofat", ofat_runs)

            # Phase 3
            if 3 in self.config.phases:
                logger.info("=" * 72)
                logger.info("PHASE 3: INTERACTIONS")
                logger.info("=" * 72)
                interaction_runs = self.run_phase_3_interactions(ofat_runs)
                all_results["phase_3_interactions"] = interaction_runs
                self._save_phase_summary(
                    "phase_3_interactions", interaction_runs,
                )

            # Phase 4
            if 4 in self.config.phases:
                logger.info("=" * 72)
                logger.info("PHASE 4: VALIDATION (Reproducibility)")
                logger.info("=" * 72)
                # Determine the top configs to validate.
                top_configs = self._select_top_configs(
                    baseline_runs + ofat_runs + interaction_runs, n=3,
                )
                validation_runs = self.run_phase_4_validation(top_configs)
                all_results["phase_4_validation"] = validation_runs
                self._save_phase_summary(
                    "phase_4_validation", validation_runs,
                )

            # Phase 5
            if 5 in self.config.phases:
                logger.info("=" * 72)
                logger.info("PHASE 5: ABLATIONS")
                logger.info("=" * 72)
                best_config = self._select_top_configs(
                    baseline_runs + ofat_runs + interaction_runs, n=1,
                )
                if best_config:
                    ablation_runs = self.run_phase_5_ablations(best_config[0])
                else:
                    logger.warning(
                        "No best config available for ablations; skipping."
                    )
                all_results["phase_5_ablations"] = ablation_runs
                self._save_phase_summary("phase_5_ablations", ablation_runs)

            # Final consolidated summary.
            all_runs = (
                baseline_runs + ofat_runs + interaction_runs
                + validation_runs + ablation_runs
            )
            all_results["summary"] = self._build_consolidated_summary(
                all_runs,
            )

        finally:
            self._cleanup()

        return all_results

    # ------------------------------------------------------------------
    # Phase 1: Baselines
    # ------------------------------------------------------------------

    def run_phase_1_baselines(self) -> list[ExperimentRun]:
        """Run baseline experiments: 4 formats x default other dimensions.

        The Phase 1 defaults are:
            - Scope:    Full
            - Metadata: None
            - Examples: ZeroShot
            - Formats:  DDL, Markdown, JSON, NaturalLanguage

        Each format is tested with every model and dataset combination.

        Returns:
            List of ExperimentRun objects, one per (format, model, dataset).
        """
        runs: list[ExperimentRun] = []
        formats = [
            SchemaFormat.DDL,
            SchemaFormat.MARKDOWN,
            SchemaFormat.JSON,
            SchemaFormat.NATURAL_LANGUAGE,
        ]

        for fmt in formats:
            for model in self.config.models:
                for dataset in self.config.datasets:
                    queries = self._load_queries(dataset)
                    if not queries:
                        logger.warning(
                            "No queries loaded for dataset '%s'; skipping.",
                            dataset,
                        )
                        continue
                    run = self._run_single_config(
                        schema_format=fmt,
                        schema_scope=SchemaScope.FULL,
                        metadata_level=MetadataLevel.NONE,
                        example_strategy=ExampleStrategy.ZERO_SHOT,
                        model=model,
                        dataset=dataset,
                        queries=queries,
                    )
                    runs.append(run)
                    self._save_run(run)

        logger.info(
            "Phase 1 complete: %d runs, %d total query evaluations.",
            len(runs),
            sum(len(r.query_results) for r in runs),
        )
        return runs

    # ------------------------------------------------------------------
    # Phase 2: OFAT
    # ------------------------------------------------------------------

    def run_phase_2_ofat(
        self, baseline_results: list[ExperimentRun],
    ) -> list[ExperimentRun]:
        """Run One-Factor-At-a-Time experiments.

        Starting from the best baseline format (highest result-correctness
        across all Phase 1 runs), vary each dimension independently:

            Scope:    Full, RelevantSubset, Progressive, UserGuided
            Metadata: None, Descriptions, SampleValues, Statistics, All
            Examples: ZeroShot, StaticFewShot, DynamicFewShot, SchemaMatched

        The format axis is *not* re-tested because it was already explored
        in Phase 1.

        Args:
            baseline_results: Completed Phase 1 runs (used to identify the
                best format).

        Returns:
            List of ExperimentRun objects for all OFAT evaluations.
        """
        best_format = self._best_format_from_baselines(baseline_results)
        logger.info("OFAT: best baseline format = %s", best_format.value)

        runs: list[ExperimentRun] = []

        # Dimension: Scope
        scopes = [
            SchemaScope.FULL,
            SchemaScope.RELEVANT_SUBSET,
            SchemaScope.PROGRESSIVE,
            SchemaScope.USER_GUIDED,
        ]
        for scope in scopes:
            for model in self.config.models:
                for dataset in self.config.datasets:
                    queries = self._load_queries(dataset)
                    if not queries:
                        continue
                    run = self._run_single_config(
                        schema_format=best_format,
                        schema_scope=scope,
                        metadata_level=MetadataLevel.NONE,
                        example_strategy=ExampleStrategy.ZERO_SHOT,
                        model=model,
                        dataset=dataset,
                        queries=queries,
                    )
                    runs.append(run)
                    self._save_run(run)

        # Dimension: Metadata
        metadata_levels = [
            MetadataLevel.NONE,
            MetadataLevel.DESCRIPTIONS,
            MetadataLevel.SAMPLE_VALUES,
            MetadataLevel.STATISTICS,
            MetadataLevel.ALL,
        ]
        for meta in metadata_levels:
            for model in self.config.models:
                for dataset in self.config.datasets:
                    queries = self._load_queries(dataset)
                    if not queries:
                        continue
                    run = self._run_single_config(
                        schema_format=best_format,
                        schema_scope=SchemaScope.FULL,
                        metadata_level=meta,
                        example_strategy=ExampleStrategy.ZERO_SHOT,
                        model=model,
                        dataset=dataset,
                        queries=queries,
                    )
                    runs.append(run)
                    self._save_run(run)

        # Dimension: Examples
        example_strategies = [
            ExampleStrategy.ZERO_SHOT,
            ExampleStrategy.STATIC_FEW_SHOT,
            ExampleStrategy.DYNAMIC_FEW_SHOT,
            ExampleStrategy.SCHEMA_MATCHED,
        ]
        for ex in example_strategies:
            for model in self.config.models:
                for dataset in self.config.datasets:
                    queries = self._load_queries(dataset)
                    if not queries:
                        continue
                    run = self._run_single_config(
                        schema_format=best_format,
                        schema_scope=SchemaScope.FULL,
                        metadata_level=MetadataLevel.NONE,
                        example_strategy=ex,
                        model=model,
                        dataset=dataset,
                        queries=queries,
                    )
                    runs.append(run)
                    self._save_run(run)

        logger.info(
            "Phase 2 complete: %d runs, %d total query evaluations.",
            len(runs),
            sum(len(r.query_results) for r in runs),
        )
        return runs

    # ------------------------------------------------------------------
    # Phase 3: Interactions
    # ------------------------------------------------------------------

    def run_phase_3_interactions(
        self, ofat_results: list[ExperimentRun],
    ) -> list[ExperimentRun]:
        """Test 2-way interactions between the best settings from OFAT.

        Selects the best value for each of the four dimensions from OFAT
        results, then tests all pairwise combinations (6 pairs) while holding
        the remaining two dimensions at their OFAT defaults.

        In practice the most informative interactions are:
            format x metadata,  format x examples,  scope x metadata,
            scope x examples,   metadata x examples, format x scope

        Args:
            ofat_results: Completed Phase 2 runs.

        Returns:
            List of ExperimentRun objects for interaction experiments.
        """
        best = self._best_per_dimension(ofat_results)
        best_format = best.get("format", SchemaFormat.DDL)
        best_scope = best.get("scope", SchemaScope.FULL)
        best_metadata = best.get("metadata", MetadataLevel.NONE)
        best_examples = best.get("examples", ExampleStrategy.ZERO_SHOT)

        logger.info(
            "Interactions: best per dimension -- format=%s, scope=%s, "
            "metadata=%s, examples=%s",
            best_format.value, best_scope.value,
            best_metadata.value, best_examples.value,
        )

        # Build the pairwise interaction grid.
        # For each pair of dimensions, test the cross-product of their best
        # two values (best from OFAT + one default/fallback) while holding
        # the other dimensions at their OFAT best.
        interaction_configs: list[
            tuple[SchemaFormat, SchemaScope, MetadataLevel, ExampleStrategy]
        ] = []

        # Values to interact (best + DDL/Full/None/ZeroShot fallback if different).
        formats_to_test = list({best_format, SchemaFormat.DDL})
        scopes_to_test = list({best_scope, SchemaScope.FULL})
        metadata_to_test = list({best_metadata, MetadataLevel.NONE})
        examples_to_test = list({best_examples, ExampleStrategy.ZERO_SHOT})

        # Build cross-product of the "interesting" values for each pair.
        # Pair 1: format x scope
        for fmt in formats_to_test:
            for scope in scopes_to_test:
                interaction_configs.append(
                    (fmt, scope, best_metadata, best_examples)
                )
        # Pair 2: format x metadata
        for fmt in formats_to_test:
            for meta in metadata_to_test:
                interaction_configs.append(
                    (fmt, best_scope, meta, best_examples)
                )
        # Pair 3: format x examples
        for fmt in formats_to_test:
            for ex in examples_to_test:
                interaction_configs.append(
                    (fmt, best_scope, best_metadata, ex)
                )
        # Pair 4: scope x metadata
        for scope in scopes_to_test:
            for meta in metadata_to_test:
                interaction_configs.append(
                    (best_format, scope, meta, best_examples)
                )
        # Pair 5: scope x examples
        for scope in scopes_to_test:
            for ex in examples_to_test:
                interaction_configs.append(
                    (best_format, scope, best_metadata, ex)
                )
        # Pair 6: metadata x examples
        for meta in metadata_to_test:
            for ex in examples_to_test:
                interaction_configs.append(
                    (best_format, best_scope, meta, ex)
                )

        # Deduplicate while preserving order.
        seen: set[tuple[str, str, str, str]] = set()
        unique_configs: list[
            tuple[SchemaFormat, SchemaScope, MetadataLevel, ExampleStrategy]
        ] = []
        for cfg in interaction_configs:
            key = (cfg[0].value, cfg[1].value, cfg[2].value, cfg[3].value)
            if key not in seen:
                seen.add(key)
                unique_configs.append(cfg)

        runs: list[ExperimentRun] = []
        for fmt, scope, meta, ex in unique_configs:
            for model in self.config.models:
                for dataset in self.config.datasets:
                    queries = self._load_queries(dataset)
                    if not queries:
                        continue
                    run = self._run_single_config(
                        schema_format=fmt,
                        schema_scope=scope,
                        metadata_level=meta,
                        example_strategy=ex,
                        model=model,
                        dataset=dataset,
                        queries=queries,
                    )
                    runs.append(run)
                    self._save_run(run)

        logger.info(
            "Phase 3 complete: %d runs, %d total query evaluations.",
            len(runs),
            sum(len(r.query_results) for r in runs),
        )
        return runs

    # ------------------------------------------------------------------
    # Phase 4: Validation (Reproducibility)
    # ------------------------------------------------------------------

    def run_phase_4_validation(
        self,
        best_configs: list[
            tuple[SchemaFormat, SchemaScope, MetadataLevel, ExampleStrategy]
        ],
    ) -> list[ExperimentRun]:
        """Repeat the top configurations 3 times for reproducibility.

        For each configuration in *best_configs*, the run is repeated 3 times
        (independently) so that variance and confidence intervals can be
        computed across repetitions.

        Args:
            best_configs: List of (format, scope, metadata, examples) tuples
                representing the top configurations to validate.

        Returns:
            List of ExperimentRun objects (3x per config per model per dataset).
        """
        num_repetitions = 3
        runs: list[ExperimentRun] = []

        for rep in range(1, num_repetitions + 1):
            for fmt, scope, meta, ex in best_configs:
                for model in self.config.models:
                    for dataset in self.config.datasets:
                        queries = self._load_queries(dataset)
                        if not queries:
                            continue
                        logger.info(
                            "Validation rep %d/%d: %s_%s_%s_%s [%s/%s]",
                            rep, num_repetitions,
                            fmt.value, scope.value, meta.value, ex.value,
                            model, dataset,
                        )
                        run = self._run_single_config(
                            schema_format=fmt,
                            schema_scope=scope,
                            metadata_level=meta,
                            example_strategy=ex,
                            model=model,
                            dataset=dataset,
                            queries=queries,
                            config_suffix=f"_rep{rep}",
                        )
                        runs.append(run)
                        self._save_run(run)

        logger.info(
            "Phase 4 complete: %d runs, %d total query evaluations.",
            len(runs),
            sum(len(r.query_results) for r in runs),
        )
        return runs

    # ------------------------------------------------------------------
    # Phase 5: Ablations
    # ------------------------------------------------------------------

    def run_phase_5_ablations(
        self,
        best_config: tuple[
            SchemaFormat, SchemaScope, MetadataLevel, ExampleStrategy
        ],
    ) -> list[ExperimentRun]:
        """Remove components from the best config one at a time.

        Starting from *best_config*, each ablation zeroes out one dimension
        while keeping the remaining three at their best values:

            - full_best:       Control condition (no ablation).
            - ablate_format:   Replace with DDL (the simplest format).
            - ablate_scope:    Replace with Full (no filtering).
            - ablate_metadata: Replace with None (no enrichment).
            - ablate_examples: Replace with ZeroShot (no demonstrations).

        Args:
            best_config: Tuple of (format, scope, metadata, examples) for the
                single best configuration identified in earlier phases.

        Returns:
            List of ExperimentRun objects for all ablation conditions.
        """
        best_fmt, best_scope, best_meta, best_ex = best_config

        ablations: list[
            tuple[str, SchemaFormat, SchemaScope, MetadataLevel, ExampleStrategy]
        ] = [
            ("full_best", best_fmt, best_scope, best_meta, best_ex),
            ("ablate_format", SchemaFormat.DDL, best_scope, best_meta, best_ex),
            ("ablate_scope", best_fmt, SchemaScope.FULL, best_meta, best_ex),
            ("ablate_metadata", best_fmt, best_scope, MetadataLevel.NONE, best_ex),
            ("ablate_examples", best_fmt, best_scope, best_meta, ExampleStrategy.ZERO_SHOT),
        ]

        runs: list[ExperimentRun] = []
        for label, fmt, scope, meta, ex in ablations:
            for model in self.config.models:
                for dataset in self.config.datasets:
                    queries = self._load_queries(dataset)
                    if not queries:
                        continue
                    logger.info(
                        "Ablation '%s': %s_%s_%s_%s [%s/%s]",
                        label,
                        fmt.value, scope.value, meta.value, ex.value,
                        model, dataset,
                    )
                    run = self._run_single_config(
                        schema_format=fmt,
                        schema_scope=scope,
                        metadata_level=meta,
                        example_strategy=ex,
                        model=model,
                        dataset=dataset,
                        queries=queries,
                        config_suffix=f"_{label}",
                    )
                    runs.append(run)
                    self._save_run(run)

        logger.info(
            "Phase 5 complete: %d runs, %d total query evaluations.",
            len(runs),
            sum(len(r.query_results) for r in runs),
        )
        return runs

    # ------------------------------------------------------------------
    # Core evaluation loop
    # ------------------------------------------------------------------

    def _run_single_config(
        self,
        schema_format: SchemaFormat,
        schema_scope: SchemaScope,
        metadata_level: MetadataLevel,
        example_strategy: ExampleStrategy,
        model: str,
        dataset: str,
        queries: list[dict],
        config_suffix: str = "",
    ) -> ExperimentRun:
        """Evaluate a single configuration against all provided queries.

        For each query this method:
            1. Builds a prompt using the configured axes.
            2. Calls the LLM to generate a SQL prediction.
            3. Executes the predicted SQL against ClickHouse.
            4. Executes the gold SQL against ClickHouse.
            5. Compares predicted and gold results.
            6. Computes schema-linking metrics.
            7. Aggregates per-query metrics into an overall summary.

        Exceptions during any step for a single query are caught, logged,
        and recorded as errors; processing continues to the next query.

        Args:
            schema_format:    Schema representation format.
            schema_scope:     Schema scope strategy.
            metadata_level:   Metadata enrichment level.
            example_strategy: Few-shot example strategy.
            model:            Claude model identifier.
            dataset:          Dataset identifier.
            queries:          List of query dictionaries (loaded from JSON).
            config_suffix:    Optional suffix appended to the config name
                              (e.g. ``"_rep1"`` for validation repetitions).

        Returns:
            A fully populated ExperimentRun with per-query results and
            aggregate metrics.
        """
        config_name = (
            f"{schema_format.value}_{schema_scope.value}_"
            f"{metadata_level.value}_{example_strategy.value}{config_suffix}"
        )

        run = ExperimentRun(
            run_id=str(uuid.uuid4()),
            config_name=config_name,
            schema_format=schema_format,
            schema_scope=schema_scope,
            metadata_level=metadata_level,
            example_strategy=example_strategy,
            model=model,
            dataset=dataset,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

        logger.info(
            "Starting run %s: config=%s, model=%s, dataset=%s, queries=%d",
            run.run_id[:8], config_name, model, dataset, len(queries),
        )

        total_queries = len(queries)
        for idx, query in enumerate(queries, 1):
            query_id = query.get("query_id", query.get("id", f"q_{idx}"))
            checkpoint_key = f"{config_name}::{model}::{dataset}::{query_id}"

            # Resume support: skip already-evaluated queries.
            if checkpoint_key in self._completed_keys:
                logger.debug("Skipping (checkpoint): %s", checkpoint_key)
                continue

            # Progress logging.
            if (
                idx == 1
                or idx == total_queries
                or idx % self.PROGRESS_LOG_INTERVAL == 0
            ):
                logger.info(
                    "  [%s] %d/%d (%.1f%%)",
                    config_name, idx, total_queries,
                    100.0 * idx / total_queries,
                )

            # Evaluate the single query.
            qm = self._evaluate_query(
                query=query,
                schema_format=schema_format,
                schema_scope=schema_scope,
                metadata_level=metadata_level,
                example_strategy=example_strategy,
                model=model,
                dataset=dataset,
                config_name=config_name,
            )
            run.query_results.append(qm)

            # Persist checkpoint.
            self._completed_keys.add(checkpoint_key)
            self._save_checkpoint(
                {"completed_keys": list(self._completed_keys)}
            )

            # Rate-limit between API calls.
            if self.API_CALL_DELAY_SEC > 0:
                time.sleep(self.API_CALL_DELAY_SEC)

        # Aggregate metrics for this run.
        if run.query_results:
            run.metrics = self.metrics_calculator.aggregate(run.query_results)
            logger.info(
                "Run %s metrics: EX=%.3f, RC=%.3f, F1=%.3f, "
                "AvgTokens=%.0f, AvgLatency=%.0fms",
                run.run_id[:8],
                run.metrics.execution_accuracy,
                run.metrics.result_correctness,
                run.metrics.schema_linking_f1,
                run.metrics.avg_input_tokens,
                run.metrics.avg_latency_ms,
            )

        return run

    def _evaluate_query(
        self,
        query: dict,
        schema_format: SchemaFormat,
        schema_scope: SchemaScope,
        metadata_level: MetadataLevel,
        example_strategy: ExampleStrategy,
        model: str,
        dataset: str,
        config_name: str,
    ) -> QueryResult:
        """Evaluate a single query through the full pipeline.

        This method is the innermost evaluation unit.  It is wrapped in a
        top-level try/except so that unexpected errors in any pipeline stage
        are caught, logged, and converted to a ``QueryResult`` with
        ``execution_accuracy=False`` rather than aborting the entire run.

        Args:
            query:            Query dictionary from the benchmark JSON.
            schema_format:    Schema format axis value.
            schema_scope:     Schema scope axis value.
            metadata_level:   Metadata level axis value.
            example_strategy: Example strategy axis value.
            model:            Model identifier.
            dataset:          Dataset identifier.
            config_name:      Config name string for logging and metrics.

        Returns:
            QueryResult for this single evaluation.
        """
        query_id = query.get("query_id", query.get("id", "unknown"))
        question = query.get("question", query.get("natural_language", ""))
        gold_sql = query.get("gold_sql", query.get("sql", ""))
        difficulty = query.get("difficulty", "")
        relevant_tables = query.get(
            "relevant_tables", query.get("tables_used", []),
        )
        relevant_columns = query.get(
            "relevant_columns", query.get("columns_used", []),
        )

        try:
            return self._evaluate_query_inner(
                query_id=query_id,
                question=question,
                gold_sql=gold_sql,
                difficulty=difficulty,
                relevant_tables=relevant_tables,
                relevant_columns=relevant_columns,
                schema_format=schema_format,
                schema_scope=schema_scope,
                metadata_level=metadata_level,
                example_strategy=example_strategy,
                model=model,
                dataset=dataset,
                config_name=config_name,
            )
        except Exception as exc:
            logger.error(
                "Unhandled error evaluating query %s in config %s: %s",
                query_id, config_name, exc,
                exc_info=True,
            )
            return self._make_error_metrics(
                query_id=query_id,
                gold_sql=gold_sql,
                dataset=dataset,
                difficulty=difficulty,
                config_name=config_name,
                error=f"Unhandled error: {type(exc).__name__}: {exc}",
            )

    def _evaluate_query_inner(
        self,
        query_id: str,
        question: str,
        gold_sql: str,
        difficulty: str,
        relevant_tables: list[str],
        relevant_columns: list[str],
        schema_format: SchemaFormat,
        schema_scope: SchemaScope,
        metadata_level: MetadataLevel,
        example_strategy: ExampleStrategy,
        model: str,
        dataset: str,
        config_name: str,
    ) -> QueryResult:
        """Inner implementation of single-query evaluation.

        Separated from :meth:`_evaluate_query` so that the outer method
        can provide a clean error-boundary.

        Steps:
            1. Build prompt (via PromptBuilder).
            2. Call LLM (via LLMCaller).
            2b. Progressive expansion if scope is PROGRESSIVE and the first
                attempt hits an UNKNOWN_TABLE error.
            3. Execute predicted and gold SQL (via SQLExecutor).
            4. Compare results (via ResultComparator / compare_results).
            5. Schema linking analysis (via SchemaLinker).
            6. Assemble and return QueryResult (via MetricsCalculator).
        """
        # Step 1: Build prompt.
        try:
            prompt_result: PromptResult = self.prompt_builder.build_prompt(
                question=question,
                dataset=dataset,
                format=schema_format,
                scope=schema_scope,
                metadata=metadata_level,
                examples=example_strategy,
                relevant_tables=relevant_tables if relevant_tables else None,
                relevant_columns=relevant_columns if relevant_columns else None,
            )
        except Exception as exc:
            logger.warning(
                "Prompt build failed for query %s: %s", query_id, exc,
            )
            return self._make_error_metrics(
                query_id=query_id,
                gold_sql=gold_sql,
                dataset=dataset,
                difficulty=difficulty,
                config_name=config_name,
                error=f"Prompt build error: {exc}",
            )

        # Step 2: Call LLM.
        try:
            llm_caller = self._get_llm_caller(model)
            llm_response: LLMResponse = llm_caller.call(
                prompt=prompt_result.user_message,
                system=prompt_result.system_message,
            )
        except Exception as exc:
            logger.warning(
                "LLM call failed for query %s: %s", query_id, exc,
            )
            return self._make_error_metrics(
                query_id=query_id,
                gold_sql=gold_sql,
                dataset=dataset,
                difficulty=difficulty,
                config_name=config_name,
                error=f"LLM call error: {exc}",
                input_tokens=prompt_result.token_estimate,
            )

        if not llm_response.success:
            return self._make_error_metrics(
                query_id=query_id,
                gold_sql=gold_sql,
                dataset=dataset,
                difficulty=difficulty,
                config_name=config_name,
                error=f"LLM response error: {llm_response.error}",
                input_tokens=llm_response.input_tokens,
                latency_ms=llm_response.latency_ms,
            )

        predicted_sql = llm_response.sql

        # Step 2b: Progressive expansion on table-not-found error.
        if (
            schema_scope == SchemaScope.PROGRESSIVE
            and prompt_result.expand_fn is not None
        ):
            try:
                test_exec = self._safe_execute(predicted_sql, dataset)
                if (
                    not test_exec.success
                    and "UNKNOWN_TABLE" in test_exec.error
                ):
                    logger.info(
                        "Progressive expansion for query %s", query_id,
                    )
                    expanded = prompt_result.expand_fn()
                    retry_response = llm_caller.call(
                        prompt=expanded.user_message,
                        system=expanded.system_message,
                    )
                    if retry_response.success and retry_response.sql:
                        predicted_sql = retry_response.sql
                        # Accumulate token/latency counts.
                        llm_response = LLMResponse(
                            sql=predicted_sql,
                            raw_response=retry_response.raw_response,
                            input_tokens=(
                                llm_response.input_tokens
                                + retry_response.input_tokens
                            ),
                            output_tokens=(
                                llm_response.output_tokens
                                + retry_response.output_tokens
                            ),
                            latency_ms=(
                                llm_response.latency_ms
                                + retry_response.latency_ms
                            ),
                            model=retry_response.model,
                            success=True,
                        )
            except Exception as exc:
                logger.warning(
                    "Progressive expansion error for query %s: %s",
                    query_id, exc,
                )

        # Step 3: Execute predicted and gold SQL.
        pred_result = self._safe_execute(predicted_sql, dataset)
        gold_result = self._safe_execute(gold_sql, dataset)

        # Step 4: Compare results.
        comparison = compare_results(
            predicted=pred_result,
            gold=gold_result,
            gold_sql=gold_sql,
        )

        # Step 5: Schema linking.
        schema_linking = self.schema_linker.compare(predicted_sql, gold_sql)

        # Step 6: Assemble QueryResult.
        return self.metrics_calculator.compute_query_metrics(
            query_id=query_id,
            predicted_success=pred_result.success,
            comparison=comparison,
            schema_linking=schema_linking,
            input_tokens=llm_response.input_tokens,
            output_tokens=llm_response.output_tokens,
            latency_ms=llm_response.latency_ms,
            dataset=dataset,
            difficulty=difficulty,
            config_id=config_name,
            predicted_sql=predicted_sql,
            gold_sql=gold_sql,
            error=pred_result.error if not pred_result.success else "",
        )

    # ------------------------------------------------------------------
    # SQL execution helper
    # ------------------------------------------------------------------

    def _safe_execute(self, sql: str, dataset: str) -> ExecutionResult:
        """Execute SQL against ClickHouse, catching all errors gracefully.

        Args:
            sql:     SQL query string.
            dataset: Dataset name (used as database override).

        Returns:
            ExecutionResult (may have ``success=False``).
        """
        if not sql or not sql.strip():
            return ExecutionResult(
                success=False,
                results=[],
                columns=[],
                row_count=0,
                execution_time_ms=0.0,
                error="Empty SQL query.",
            )
        try:
            return self.sql_executor.execute(sql, database=dataset)
        except ConnectionError as exc:
            return ExecutionResult(
                success=False,
                results=[],
                columns=[],
                row_count=0,
                execution_time_ms=0.0,
                error=f"ClickHouse connection error: {exc}",
            )
        except Exception as exc:
            return ExecutionResult(
                success=False,
                results=[],
                columns=[],
                row_count=0,
                execution_time_ms=0.0,
                error=f"SQL execution error: {type(exc).__name__}: {exc}",
            )

    # ------------------------------------------------------------------
    # Query loading
    # ------------------------------------------------------------------

    def _load_queries(self, dataset: str) -> list[dict]:
        """Load benchmark queries for the given dataset from JSON files.

        Searches the ``benchmark/queries/`` directory for files matching the
        dataset.  Queries can live in:
            - ``queries/{dataset}/queries.json``
            - ``queries/{dataset}_queries.json``
            - Individual category files (``queries/simple_select.json``, etc.)

        All files are scanned; queries whose ``"dataset"`` field matches the
        requested dataset are included.

        Args:
            dataset: Dataset identifier to filter queries by.

        Returns:
            List of query dictionaries with at least ``id``,
            ``natural_language`` (or ``question``), and ``sql`` (or
            ``gold_sql``) fields.
        """
        queries_dir = self.benchmark_dir / "queries"
        if not queries_dir.exists():
            logger.warning("Queries directory not found: %s", queries_dir)
            return []

        all_queries: list[dict] = []

        # Strategy 1: dataset-specific file.
        dataset_specific = queries_dir / dataset / "queries.json"
        dataset_flat = queries_dir / f"{dataset}_queries.json"

        for candidate in [dataset_specific, dataset_flat]:
            if candidate.exists():
                try:
                    data = json.loads(
                        candidate.read_text(encoding="utf-8"),
                    )
                    items = (
                        data if isinstance(data, list)
                        else data.get("queries", [])
                    )
                    all_queries.extend(items)
                    logger.info(
                        "Loaded %d queries from %s", len(items), candidate,
                    )
                except (json.JSONDecodeError, OSError) as exc:
                    logger.error(
                        "Failed to load queries from %s: %s", candidate, exc,
                    )

        # Strategy 2: scan all JSON files for matching dataset field.
        if not all_queries:
            for json_file in sorted(queries_dir.glob("*.json")):
                try:
                    data = json.loads(
                        json_file.read_text(encoding="utf-8"),
                    )
                    items = (
                        data if isinstance(data, list)
                        else data.get("queries", [])
                    )
                    matched = [
                        q for q in items
                        if q.get("dataset", "").lower() == dataset.lower()
                    ]
                    if matched:
                        all_queries.extend(matched)
                        logger.info(
                            "Loaded %d queries for '%s' from %s",
                            len(matched), dataset, json_file,
                        )
                except (json.JSONDecodeError, OSError) as exc:
                    logger.warning(
                        "Skipping malformed query file %s: %s",
                        json_file, exc,
                    )

        if not all_queries:
            logger.warning(
                "No queries found for dataset '%s' in %s",
                dataset, queries_dir,
            )

        return all_queries

    # ------------------------------------------------------------------
    # Persistence: run results
    # ------------------------------------------------------------------

    def _save_run(self, run: ExperimentRun) -> None:
        """Save a completed ExperimentRun as a JSON file in results/raw/.

        The filename includes the config name, model, dataset, and a
        truncated UUID for uniqueness.

        Args:
            run: The ExperimentRun to persist.
        """
        safe_model = run.model.replace("/", "_").replace(":", "_")
        filename = (
            f"{run.config_name}__{safe_model}__{run.dataset}"
            f"__{run.run_id[:8]}.json"
        )
        filepath = self.raw_dir / filename

        try:
            filepath.write_text(
                json.dumps(_run_to_dict(run), indent=2, default=str),
                encoding="utf-8",
            )
            logger.debug("Saved run to %s", filepath)
        except OSError as exc:
            logger.error("Failed to save run to %s: %s", filepath, exc)

    def _save_phase_summary(
        self, phase_name: str, runs: list[ExperimentRun],
    ) -> None:
        """Save aggregate metrics for a completed phase to results/processed/.

        Args:
            phase_name: Identifier string for the phase (e.g.
                ``"phase_1_baselines"``).
            runs:       All ExperimentRun objects from the phase.
        """
        all_qm: list[QueryResult] = []
        for run in runs:
            all_qm.extend(run.query_results)

        if not all_qm:
            logger.warning(
                "No query results for phase '%s'; skipping summary.",
                phase_name,
            )
            return

        overall = self.metrics_calculator.aggregate(all_qm)
        by_config = self.metrics_calculator.aggregate_by_category(
            all_qm, "config_id",
        )

        def _agg_to_dict(agg: MetricsSummary) -> dict[str, Any]:
            return {
                "execution_accuracy": agg.execution_accuracy,
                "result_correctness": agg.result_correctness,
                "exact_match_rate": agg.exact_match_rate,
                "relaxed_match_rate": agg.relaxed_match_rate,
                "schema_linking_f1": agg.schema_linking_f1,
                "table_f1": agg.table_f1,
                "column_f1": agg.column_f1,
                "avg_input_tokens": agg.avg_input_tokens,
                "avg_output_tokens": agg.avg_output_tokens,
                "avg_latency_ms": agg.avg_latency_ms,
                "median_latency_ms": agg.median_latency_ms,
                "n_queries": agg.n_queries,
                "ci_95_ex": list(agg.ci_95_ex),
                "ci_95_rc": list(agg.ci_95_rc),
                "match_type_distribution": agg.match_type_distribution,
            }

        summary = {
            "phase": phase_name,
            "experiment_name": self.config.experiment_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "num_runs": len(runs),
            "num_queries": len(all_qm),
            "overall": _agg_to_dict(overall),
            "by_config": {
                config_id: _agg_to_dict(agg)
                for config_id, agg in by_config.items()
            },
        }

        filepath = self.processed_dir / f"{phase_name}_summary.json"
        try:
            filepath.write_text(
                json.dumps(summary, indent=2), encoding="utf-8",
            )
            logger.info("Phase summary saved to %s", filepath)
        except OSError as exc:
            logger.error(
                "Failed to save phase summary to %s: %s", filepath, exc,
            )

    def _build_consolidated_summary(
        self, all_runs: list[ExperimentRun],
    ) -> dict[str, Any]:
        """Build a final consolidated summary across all phases.

        Args:
            all_runs: Every ExperimentRun from all phases.

        Returns:
            Dictionary with overall and per-config aggregate metrics.
        """
        all_qm: list[QueryResult] = []
        for run in all_runs:
            all_qm.extend(run.query_results)

        if not all_qm:
            return {"error": "No query results to summarise."}

        overall = self.metrics_calculator.aggregate(all_qm)
        by_config = self.metrics_calculator.aggregate_by_category(
            all_qm, "config_id",
        )
        by_dataset = self.metrics_calculator.aggregate_by_category(
            all_qm, "dataset",
        )
        by_difficulty = self.metrics_calculator.aggregate_by_category(
            all_qm, "difficulty",
        )

        def _agg_to_dict(agg: MetricsSummary) -> dict[str, Any]:
            return {
                "execution_accuracy": agg.execution_accuracy,
                "result_correctness": agg.result_correctness,
                "exact_match_rate": agg.exact_match_rate,
                "schema_linking_f1": agg.schema_linking_f1,
                "n_queries": agg.n_queries,
                "ci_95_rc": list(agg.ci_95_rc),
            }

        consolidated: dict[str, Any] = {
            "experiment_name": self.config.experiment_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "total_runs": len(all_runs),
            "total_queries": len(all_qm),
            "overall": _agg_to_dict(overall),
            "by_config": {
                k: _agg_to_dict(v) for k, v in by_config.items()
            },
            "by_dataset": {
                k: _agg_to_dict(v) for k, v in by_dataset.items()
            },
            "by_difficulty": {
                k: _agg_to_dict(v) for k, v in by_difficulty.items()
            },
        }

        filepath = self.processed_dir / "consolidated_summary.json"
        try:
            filepath.write_text(
                json.dumps(consolidated, indent=2), encoding="utf-8",
            )
            logger.info("Consolidated summary saved to %s", filepath)
        except OSError as exc:
            logger.error(
                "Failed to save consolidated summary: %s", exc,
            )

        return consolidated

    # ------------------------------------------------------------------
    # Checkpoint management
    # ------------------------------------------------------------------

    def _load_checkpoint(self) -> dict:
        """Load checkpoint state from disk for resuming interrupted runs.

        Returns:
            The raw checkpoint dictionary (may be empty if no checkpoint
            exists or the file is corrupt).
        """
        if not self._checkpoint_path.exists():
            self._completed_keys = set()
            return {}

        try:
            data = json.loads(
                self._checkpoint_path.read_text(encoding="utf-8"),
            )
            self._completed_keys = set(data.get("completed_keys", []))
            logger.info(
                "Checkpoint loaded: %d completed evaluations.",
                len(self._completed_keys),
            )
            return data
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning(
                "Failed to load checkpoint (%s); starting fresh.", exc,
            )
            self._completed_keys = set()
            return {}

    def _save_checkpoint(self, state: dict) -> None:
        """Persist the current checkpoint state to disk.

        The checkpoint is written to a temporary file first and then renamed
        to avoid corruption from interrupted writes.

        Args:
            state: Dictionary containing at least a ``"completed_keys"``
                list of strings.
        """
        state["timestamp"] = datetime.now(timezone.utc).isoformat()
        state["count"] = len(state.get("completed_keys", []))

        tmp_path = self._checkpoint_path.with_suffix(".tmp")
        try:
            tmp_path.write_text(
                json.dumps(state, indent=2), encoding="utf-8",
            )
            tmp_path.replace(self._checkpoint_path)
        except OSError as exc:
            logger.error("Failed to save checkpoint: %s", exc)

    # ------------------------------------------------------------------
    # Analysis helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _best_format_from_baselines(
        baseline_runs: list[ExperimentRun],
    ) -> SchemaFormat:
        """Determine the best schema format from Phase 1 baseline results.

        The "best" format is the one with the highest average
        ``result_correctness`` across all models and datasets.

        Args:
            baseline_runs: Completed Phase 1 ExperimentRun objects.

        Returns:
            The SchemaFormat with the highest result correctness.
            Defaults to DDL if no runs are available.
        """
        if not baseline_runs:
            logger.warning(
                "No baseline runs available; defaulting to DDL format."
            )
            return SchemaFormat.DDL

        format_scores: dict[SchemaFormat, list[float]] = {}
        for run in baseline_runs:
            if run.metrics is not None:
                scores = format_scores.setdefault(run.schema_format, [])
                scores.append(run.metrics.result_correctness)

        if not format_scores:
            return SchemaFormat.DDL

        best_format = max(
            format_scores,
            key=lambda fmt: (
                sum(format_scores[fmt]) / len(format_scores[fmt])
            ),
        )
        avg_score = (
            sum(format_scores[best_format])
            / len(format_scores[best_format])
        )
        logger.info(
            "Best baseline format: %s (avg RC=%.4f)",
            best_format.value, avg_score,
        )
        return best_format

    @staticmethod
    def _best_per_dimension(
        runs: list[ExperimentRun],
    ) -> dict[str, Any]:
        """Identify the best value for each prompt dimension from OFAT runs.

        Groups runs by each dimension axis and selects the value with the
        highest average ``result_correctness``.

        Args:
            runs: Completed OFAT ExperimentRun objects.

        Returns:
            Dictionary with keys ``"format"``, ``"scope"``, ``"metadata"``,
            ``"examples"`` mapping to the best enum value for each axis.
        """
        dimension_scores: dict[str, dict[Any, list[float]]] = {
            "format": {},
            "scope": {},
            "metadata": {},
            "examples": {},
        }

        for run in runs:
            if run.metrics is None:
                continue
            rc = run.metrics.result_correctness

            fmt_scores = dimension_scores["format"].setdefault(
                run.schema_format, [],
            )
            fmt_scores.append(rc)

            scope_scores = dimension_scores["scope"].setdefault(
                run.schema_scope, [],
            )
            scope_scores.append(rc)

            meta_scores = dimension_scores["metadata"].setdefault(
                run.metadata_level, [],
            )
            meta_scores.append(rc)

            ex_scores = dimension_scores["examples"].setdefault(
                run.example_strategy, [],
            )
            ex_scores.append(rc)

        result: dict[str, Any] = {}
        defaults: dict[str, Any] = {
            "format": SchemaFormat.DDL,
            "scope": SchemaScope.FULL,
            "metadata": MetadataLevel.NONE,
            "examples": ExampleStrategy.ZERO_SHOT,
        }

        for dim_name, scores_by_value in dimension_scores.items():
            if not scores_by_value:
                result[dim_name] = defaults[dim_name]
                continue
            best_value = max(
                scores_by_value,
                key=lambda v: (
                    sum(scores_by_value[v]) / len(scores_by_value[v])
                ),
            )
            result[dim_name] = best_value
            avg = (
                sum(scores_by_value[best_value])
                / len(scores_by_value[best_value])
            )
            logger.info(
                "Best %s: %s (avg RC=%.4f)", dim_name, best_value, avg,
            )

        return result

    @staticmethod
    def _select_top_configs(
        runs: list[ExperimentRun], n: int = 3,
    ) -> list[
        tuple[SchemaFormat, SchemaScope, MetadataLevel, ExampleStrategy]
    ]:
        """Select the top-N configurations by result correctness.

        De-duplicates configurations so that the same (format, scope,
        metadata, examples) tuple does not appear more than once.

        Args:
            runs: All ExperimentRun objects to consider.
            n:    Number of top configurations to return.

        Returns:
            List of (format, scope, metadata, examples) tuples, ordered
            from best to worst.
        """
        config_scores: dict[
            tuple[SchemaFormat, SchemaScope, MetadataLevel, ExampleStrategy],
            list[float],
        ] = {}

        for run in runs:
            if run.metrics is None:
                continue
            key = (
                run.schema_format,
                run.schema_scope,
                run.metadata_level,
                run.example_strategy,
            )
            config_scores.setdefault(key, []).append(
                run.metrics.result_correctness,
            )

        if not config_scores:
            logger.warning("No scored configurations available.")
            return [(
                SchemaFormat.DDL,
                SchemaScope.FULL,
                MetadataLevel.NONE,
                ExampleStrategy.ZERO_SHOT,
            )]

        ranked = sorted(
            config_scores.keys(),
            key=lambda k: sum(config_scores[k]) / len(config_scores[k]),
            reverse=True,
        )
        return ranked[:n]

    # ------------------------------------------------------------------
    # Error metrics factory
    # ------------------------------------------------------------------

    @staticmethod
    def _make_error_metrics(
        query_id: str,
        gold_sql: str,
        dataset: str,
        difficulty: str,
        config_name: str,
        error: str,
        input_tokens: int = 0,
        latency_ms: float = 0.0,
    ) -> QueryResult:
        """Create a QueryResult object representing a failed evaluation.

        All accuracy and F1 metrics are set to zero / False.

        Args:
            query_id:    Identifier of the failed query.
            gold_sql:    Ground-truth SQL (preserved for reference).
            dataset:     Dataset identifier.
            difficulty:  Query difficulty label.
            config_name: Config name for grouping.
            error:       Human-readable error description.
            input_tokens: Tokens consumed before failure (if known).
            latency_ms:  Latency consumed before failure (if known).

        Returns:
            A QueryResult with all metrics zeroed out.
        """
        empty_links = SchemaLinks()
        schema_linking = SchemaLinkingResult(
            predicted=empty_links,
            gold=empty_links,
            table_precision=0.0,
            table_recall=0.0,
            table_f1=0.0,
            column_precision=0.0,
            column_recall=0.0,
            column_f1=0.0,
        )
        return QueryResult(
            query_id=query_id,
            execution_accuracy=False,
            result_correctness=False,
            match_type=MatchStrategy.SET,
            schema_linking=schema_linking,
            input_tokens=input_tokens,
            output_tokens=0,
            latency_ms=latency_ms,
            dataset=dataset,
            difficulty=difficulty,
            config_id=config_name,
            predicted_sql="",
            gold_sql=gold_sql,
            error=error,
        )

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def _cleanup(self) -> None:
        """Release external resources (ClickHouse connections)."""
        if self._sql_executor is not None:
            try:
                self._sql_executor.close()
            except Exception as exc:
                logger.warning("Error closing SQL executor: %s", exc)
            self._sql_executor = None
        logger.info("ExperimentRunner resources released.")

    def close(self) -> None:
        """Public cleanup method for explicit resource management."""
        self._cleanup()

    def __enter__(self) -> ExperimentRunner:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self._cleanup()
