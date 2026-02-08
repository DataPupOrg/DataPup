"""
Statistical analysis for Schema-Aware Prompt Engineering experiments.

Implements McNemar's test for paired binary comparisons, Cochran's Q test
for comparing three or more related proportions, bootstrap confidence
intervals, Holm-Bonferroni correction for multiple comparisons, and
Cohen's h effect size for binary outcomes.

This module provides all the statistical machinery needed for the VLDB
paper "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical
Databases," which evaluates ~15,900 experiment runs across 4 prompt
engineering dimensions on 150 ClickHouse queries with 2 Claude models.

Reference:
    - McNemar, Q. (1947). Note on the sampling error of the difference
      between correlated proportions or percentages. Psychometrika.
    - Cochran, W.G. (1950). The comparison of percentages in matched
      samples. Biometrika.
    - Cohen, J. (1988). Statistical Power Analysis for the Behavioral
      Sciences. 2nd ed.
    - Holm, S. (1979). A simple sequentially rejective multiple test
      procedure. Scandinavian Journal of Statistics.
"""

from __future__ import annotations

import itertools
import logging
import warnings
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy import stats

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class PairwiseTestResult:
    """Result of a single pairwise McNemar's test between two configurations.

    Attributes:
        config_a: Name of the first configuration.
        config_b: Name of the second configuration.
        metric: The metric compared (e.g. "EX" or "RC").
        value_a: Observed proportion for config_a.
        value_b: Observed proportion for config_b.
        difference: value_a - value_b.
        p_value: Raw (uncorrected) p-value from McNemar's test.
        p_value_corrected: p-value after Holm-Bonferroni correction.
        significant: Whether the corrected p-value is below alpha.
        effect_size: Cohen's h effect size.
        effect_interpretation: "negligible", "small", "medium", or "large".
        n_discordant: Total discordant pairs (b + c in the 2x2 table).
        n_total: Total number of paired observations.
    """

    config_a: str
    config_b: str
    metric: str
    value_a: float
    value_b: float
    difference: float
    p_value: float
    p_value_corrected: float
    significant: bool
    effect_size: float
    effect_interpretation: str
    n_discordant: int = 0
    n_total: int = 0


@dataclass
class CochranQResult:
    """Result of Cochran's Q test comparing three or more configurations.

    Attributes:
        metric: The metric compared.
        config_names: List of configuration names.
        proportions: Dict mapping config name to observed proportion.
        q_statistic: The Cochran's Q test statistic.
        p_value: p-value from chi-squared distribution.
        df: Degrees of freedom (k - 1).
        significant: Whether p < alpha.
    """

    metric: str
    config_names: list[str]
    proportions: dict[str, float]
    q_statistic: float
    p_value: float
    df: int
    significant: bool


@dataclass
class BootstrapCIResult:
    """Result of a bootstrap confidence interval estimation.

    Attributes:
        config: Configuration name.
        metric: The metric.
        observed: Observed proportion.
        ci_lower: Lower bound of the confidence interval.
        ci_upper: Upper bound of the confidence interval.
        ci_level: Confidence level (e.g. 0.95).
        n_bootstrap: Number of bootstrap resamples.
        se: Bootstrap standard error.
    """

    config: str
    metric: str
    observed: float
    ci_lower: float
    ci_upper: float
    ci_level: float
    n_bootstrap: int
    se: float


@dataclass
class FullAnalysisResult:
    """Aggregated results from a complete statistical analysis run.

    Attributes:
        pairwise_results: Dict mapping (RQ/dimension name) to lists of
            PairwiseTestResult for every pair tested in that dimension.
        cochran_results: Dict mapping dimension name to CochranQResult.
        bootstrap_cis: Dict mapping (config_name, metric) to BootstrapCIResult.
        summary: Human-readable summary dict with key findings.
    """

    pairwise_results: dict[str, list[PairwiseTestResult]] = field(
        default_factory=dict
    )
    cochran_results: dict[str, CochranQResult] = field(default_factory=dict)
    bootstrap_cis: dict[tuple[str, str], BootstrapCIResult] = field(
        default_factory=dict
    )
    summary: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Core statistical analyzer
# ---------------------------------------------------------------------------


class StatisticalAnalyzer:
    """Statistical analysis engine for the VLDB Text-to-SQL experiments.

    All tests operate on paired binary outcome vectors, where each element
    corresponds to a single benchmark query and the value indicates success
    (True/1) or failure (False/0) under a given prompt configuration.

    Typical usage::

        analyzer = StatisticalAnalyzer(alpha=0.05, seed=42)

        # Paired comparison
        result = analyzer.mcnemar_test(
            results_a=[True, False, True, ...],
            results_b=[True, True, False, ...],
            config_a="CREATE_TABLE", config_b="Markdown", metric="RC"
        )

        # Full analysis across all RQs
        full = analyzer.run_full_analysis(experiment_results)
    """

    def __init__(self, alpha: float = 0.05, seed: int = 42) -> None:
        """Initialize the analyzer.

        Args:
            alpha: Family-wise significance level for hypothesis tests.
            seed: Random seed for reproducibility of bootstrap resampling.
        """
        self.alpha = alpha
        self.seed = seed
        self._rng = np.random.RandomState(seed)

    # ------------------------------------------------------------------
    # Effect size
    # ------------------------------------------------------------------

    @staticmethod
    def cohens_h(p1: float, p2: float) -> float:
        """Compute Cohen's h effect size for two proportions.

        Cohen's h = 2 * arcsin(sqrt(p1)) - 2 * arcsin(sqrt(p2))

        Interpretation thresholds (Cohen, 1988):
            |h| < 0.20  -> negligible
            0.20 <= |h| < 0.50  -> small
            0.50 <= |h| < 0.80  -> medium
            |h| >= 0.80  -> large

        Args:
            p1: First proportion (0 to 1).
            p2: Second proportion (0 to 1).

        Returns:
            Cohen's h (signed; positive when p1 > p2).
        """
        p1 = np.clip(p1, 0.0, 1.0)
        p2 = np.clip(p2, 0.0, 1.0)
        return float(2.0 * np.arcsin(np.sqrt(p1)) - 2.0 * np.arcsin(np.sqrt(p2)))

    @staticmethod
    def interpret_cohens_h(h: float) -> str:
        """Return a qualitative interpretation of Cohen's h magnitude.

        Args:
            h: Cohen's h value (sign is ignored).

        Returns:
            One of "negligible", "small", "medium", "large".
        """
        abs_h = abs(h)
        if abs_h < 0.20:
            return "negligible"
        elif abs_h < 0.50:
            return "small"
        elif abs_h < 0.80:
            return "medium"
        else:
            return "large"

    # ------------------------------------------------------------------
    # McNemar's test
    # ------------------------------------------------------------------

    def mcnemar_test(
        self,
        results_a: list[bool] | np.ndarray,
        results_b: list[bool] | np.ndarray,
        config_a: str = "A",
        config_b: str = "B",
        metric: str = "RC",
    ) -> PairwiseTestResult:
        """Run McNemar's exact test for paired binary outcomes.

        Constructs the 2x2 contingency table::

                        Config B correct    Config B incorrect
            A correct       a (both right)     b (only A right)
            A incorrect     c (only B right)   d (both wrong)

        The test statistic uses only the discordant cells b and c.
        When the total discordant count (b + c) < 25, an exact binomial
        test is used instead of the chi-squared approximation.

        Args:
            results_a: Boolean outcomes for each query under config A.
            results_b: Boolean outcomes for each query under config B.
            config_a: Human-readable name for configuration A.
            config_b: Human-readable name for configuration B.
            metric: Metric name (e.g. "EX", "RC").

        Returns:
            PairwiseTestResult with raw (uncorrected) p-value.

        Raises:
            ValueError: If input vectors have different lengths or are empty.
        """
        a = np.asarray(results_a, dtype=bool)
        b = np.asarray(results_b, dtype=bool)

        if len(a) != len(b):
            raise ValueError(
                f"Result vectors must have equal length, got {len(a)} and {len(b)}"
            )
        if len(a) == 0:
            raise ValueError("Result vectors must not be empty")

        n = len(a)

        # Build the 2x2 contingency table
        # cell_b: A correct, B incorrect (only A right)
        # cell_c: A incorrect, B correct (only B right)
        cell_b = int(np.sum(a & ~b))
        cell_c = int(np.sum(~a & b))
        n_discordant = cell_b + cell_c

        # Proportions
        prop_a = float(np.mean(a))
        prop_b = float(np.mean(b))

        # McNemar's test
        if n_discordant == 0:
            # No discordant pairs: cannot reject H0
            p_value = 1.0
        elif n_discordant < 25:
            # Use exact binomial test (mid-p variant for conservatism)
            # Under H0, b ~ Binomial(b + c, 0.5)
            p_value = float(stats.binomtest(cell_b, n_discordant, 0.5).pvalue)
        else:
            # Chi-squared approximation with continuity correction
            chi2 = (abs(cell_b - cell_c) - 1) ** 2 / (cell_b + cell_c)
            p_value = float(1.0 - stats.chi2.cdf(chi2, df=1))

        # Effect size
        h = self.cohens_h(prop_a, prop_b)
        interpretation = self.interpret_cohens_h(h)

        return PairwiseTestResult(
            config_a=config_a,
            config_b=config_b,
            metric=metric,
            value_a=prop_a,
            value_b=prop_b,
            difference=prop_a - prop_b,
            p_value=p_value,
            p_value_corrected=p_value,  # Will be updated by holm_bonferroni
            significant=p_value < self.alpha,
            effect_size=h,
            effect_interpretation=interpretation,
            n_discordant=n_discordant,
            n_total=n,
        )

    # ------------------------------------------------------------------
    # Cochran's Q test
    # ------------------------------------------------------------------

    def cochrans_q_test(
        self,
        results: dict[str, list[bool] | np.ndarray],
        metric: str = "RC",
    ) -> CochranQResult:
        """Run Cochran's Q test comparing three or more related proportions.

        Cochran's Q is an extension of McNemar's test to k > 2 treatments.
        It tests the null hypothesis that all k treatments have identical
        success probabilities.

        The test statistic Q follows a chi-squared distribution with
        k - 1 degrees of freedom under H0.

        Args:
            results: Dict mapping config name to a boolean outcome vector.
                All vectors must have equal length (one entry per query).
            metric: Metric name for labeling.

        Returns:
            CochranQResult with the Q statistic and p-value.

        Raises:
            ValueError: If fewer than 3 configurations or mismatched lengths.
        """
        config_names = list(results.keys())
        k = len(config_names)
        if k < 3:
            raise ValueError(
                f"Cochran's Q requires >= 3 groups, got {k}. "
                "Use McNemar's test for 2 groups."
            )

        # Build matrix: rows = queries, columns = configs
        arrays = [np.asarray(results[name], dtype=float) for name in config_names]
        n = len(arrays[0])
        for i, arr in enumerate(arrays):
            if len(arr) != n:
                raise ValueError(
                    f"All result vectors must have length {n}, but "
                    f"'{config_names[i]}' has length {len(arr)}"
                )

        X = np.column_stack(arrays)  # shape (n, k)

        # Row and column sums
        T_j = X.sum(axis=0)  # sum per config (column sums), shape (k,)
        T_i = X.sum(axis=1)  # sum per query (row sums), shape (n,)

        grand_T = T_j.sum()

        # Cochran's Q statistic
        numerator = (k - 1) * (k * np.sum(T_j**2) - grand_T**2)
        denominator = k * grand_T - np.sum(T_i**2)

        if denominator == 0:
            # All subjects responded identically across all treatments
            q_stat = 0.0
            p_value = 1.0
        else:
            q_stat = float(numerator / denominator)
            p_value = float(1.0 - stats.chi2.cdf(q_stat, df=k - 1))

        proportions = {name: float(np.mean(arrays[i])) for i, name in enumerate(config_names)}

        return CochranQResult(
            metric=metric,
            config_names=config_names,
            proportions=proportions,
            q_statistic=q_stat,
            p_value=p_value,
            df=k - 1,
            significant=p_value < self.alpha,
        )

    # ------------------------------------------------------------------
    # Multiple comparisons correction
    # ------------------------------------------------------------------

    @staticmethod
    def holm_bonferroni(
        p_values: list[float], alpha: float = 0.05
    ) -> list[float]:
        """Apply Holm-Bonferroni step-down correction for multiple comparisons.

        The Holm-Bonferroni method is uniformly more powerful than the
        standard Bonferroni correction and controls the family-wise error
        rate (FWER) at level alpha.

        Algorithm:
            1. Sort p-values in ascending order.
            2. For rank i (1-indexed), compare p_(i) to alpha / (m - i + 1).
            3. Adjusted p-value = max(p_(j) * (m - j + 1)) for j <= i,
               capped at 1.0.

        Args:
            p_values: List of raw p-values from individual tests.
            alpha: Target FWER level (not used in adjustment itself,
                provided for interface consistency).

        Returns:
            List of adjusted p-values in the ORIGINAL order.
        """
        m = len(p_values)
        if m == 0:
            return []
        if m == 1:
            return list(p_values)

        # Create index-value pairs and sort by p-value
        indexed = sorted(enumerate(p_values), key=lambda x: x[1])

        adjusted = [0.0] * m
        cumulative_max = 0.0

        for rank_0, (orig_idx, pval) in enumerate(indexed):
            # rank is 1-indexed: multiplier = m - rank + 1 = m - rank_0
            multiplier = m - rank_0
            adjusted_p = pval * multiplier
            # Enforce monotonicity: adjusted p must be >= previous
            cumulative_max = max(cumulative_max, adjusted_p)
            adjusted[orig_idx] = min(cumulative_max, 1.0)

        return adjusted

    # ------------------------------------------------------------------
    # Bootstrap confidence intervals
    # ------------------------------------------------------------------

    def bootstrap_ci(
        self,
        results: list[bool] | np.ndarray,
        n_bootstrap: int = 10000,
        ci: float = 0.95,
        config: str = "",
        metric: str = "RC",
    ) -> BootstrapCIResult:
        """Compute a bootstrap percentile confidence interval for a proportion.

        Uses the percentile method: resample with replacement, compute the
        proportion for each resample, and take the appropriate quantiles.

        For proportions close to 0 or 1, the BCa (bias-corrected and
        accelerated) method can be more accurate, but the percentile
        method is standard for VLDB papers and easier to explain.

        Args:
            results: Boolean outcome vector (True = success).
            n_bootstrap: Number of bootstrap resamples. Default 10,000
                for stable CI estimation; minimum recommended is 1,000.
            ci: Confidence level (e.g. 0.95 for a 95% CI).
            config: Configuration name for labeling.
            metric: Metric name for labeling.

        Returns:
            BootstrapCIResult with the observed proportion and CI bounds.
        """
        data = np.asarray(results, dtype=float)
        n = len(data)
        observed = float(np.mean(data))

        # Generate all bootstrap samples at once for efficiency
        boot_indices = self._rng.randint(0, n, size=(n_bootstrap, n))
        boot_proportions = data[boot_indices].mean(axis=1)

        alpha_half = (1.0 - ci) / 2.0
        ci_lower = float(np.percentile(boot_proportions, 100 * alpha_half))
        ci_upper = float(np.percentile(boot_proportions, 100 * (1.0 - alpha_half)))
        se = float(np.std(boot_proportions, ddof=1))

        return BootstrapCIResult(
            config=config,
            metric=metric,
            observed=observed,
            ci_lower=ci_lower,
            ci_upper=ci_upper,
            ci_level=ci,
            n_bootstrap=n_bootstrap,
            se=se,
        )

    # ------------------------------------------------------------------
    # Pairwise comparison driver
    # ------------------------------------------------------------------

    def pairwise_all(
        self,
        configs: dict[str, list[bool] | np.ndarray],
        metric_name: str = "RC",
    ) -> list[PairwiseTestResult]:
        """Run pairwise McNemar's tests between all configuration pairs.

        Applies Holm-Bonferroni correction across all pairwise comparisons
        to control the family-wise error rate.

        Args:
            configs: Dict mapping config name to boolean outcome vector.
            metric_name: Metric name for labeling.

        Returns:
            List of PairwiseTestResult, one per pair, with corrected p-values.
            Results are sorted by raw p-value (ascending).
        """
        config_names = list(configs.keys())
        pairs = list(itertools.combinations(config_names, 2))

        if len(pairs) == 0:
            return []

        # Run all pairwise tests
        raw_results: list[PairwiseTestResult] = []
        for name_a, name_b in pairs:
            result = self.mcnemar_test(
                results_a=configs[name_a],
                results_b=configs[name_b],
                config_a=name_a,
                config_b=name_b,
                metric=metric_name,
            )
            raw_results.append(result)

        # Apply Holm-Bonferroni correction
        raw_p = [r.p_value for r in raw_results]
        corrected_p = self.holm_bonferroni(raw_p, alpha=self.alpha)

        for result, adj_p in zip(raw_results, corrected_p):
            result.p_value_corrected = adj_p
            result.significant = adj_p < self.alpha

        # Sort by raw p-value for readability
        raw_results.sort(key=lambda r: r.p_value)

        return raw_results

    # ------------------------------------------------------------------
    # Full analysis driver
    # ------------------------------------------------------------------

    def run_full_analysis(
        self,
        experiment_results: dict[str, Any],
    ) -> FullAnalysisResult:
        """Run the complete statistical analysis for all research questions.

        This is the top-level entry point that orchestrates all tests needed
        for the VLDB paper. It expects experiment results organized by the
        four prompt engineering dimensions defined in the experiment plan.

        Args:
            experiment_results: Nested dict with the following structure::

                {
                    "schema_format": {  # RQ1: A1-A4
                        "models": {
                            "sonnet": {
                                "CREATE_TABLE": {"EX": [bool...], "RC": [bool...]},
                                "Markdown":     {"EX": [bool...], "RC": [bool...]},
                                "JSON":         {"EX": [bool...], "RC": [bool...]},
                                "NaturalLang":  {"EX": [bool...], "RC": [bool...]},
                            },
                            "haiku": { ... same structure ... }
                        }
                    },
                    "schema_scope": {  # RQ2: B1-B4
                        "models": {
                            "sonnet": {
                                "Full":          {"EX": [...], "RC": [...], "TE": [float...]},
                                "Relevant":      {"EX": [...], "RC": [...], "TE": [float...]},
                                "Progressive":   {"EX": [...], "RC": [...], "TE": [float...]},
                                "UserGuided":    {"EX": [...], "RC": [...], "TE": [float...]},
                            },
                            "haiku": { ... }
                        }
                    },
                    "metadata": {  # RQ3: C0-C4
                        "models": {
                            "sonnet": {
                                "None":        {"RC": [...]},
                                "Descriptions":{"RC": [...]},
                                "SampleValues":{"RC": [...]},
                                "Statistics":  {"RC": [...]},
                                "All":         {"RC": [...]},
                            },
                            "haiku": { ... }
                        },
                        "by_category": {  # Optional per-category breakdown
                            "sonnet": {
                                "Simple_SELECT": { config_name: {"RC": [...]}, ... },
                                "Aggregation": { ... },
                                ...
                            }
                        }
                    },
                    "examples": {  # RQ4: D1-D4
                        "models": {
                            "sonnet": {
                                "ZeroShot":     {"RC": [...], "TE": [float...]},
                                "StaticFewShot":{"RC": [...], "TE": [float...]},
                                "DynamicFewShot":{"RC": [...], "TE": [float...]},
                                "SchemaMatched":{"RC": [...], "TE": [float...]},
                            },
                            "haiku": { ... }
                        }
                    },
                    "interactions": {  # Phase 3: 2-way interactions
                        "format_x_scope": {
                            "sonnet": {
                                "CREATE_TABLE+Full":     {"RC": [...]},
                                "CREATE_TABLE+Relevant": {"RC": [...]},
                                ...  # 4x4 = 16 configs
                            }
                        },
                        "metadata_x_examples": {
                            "sonnet": {
                                "None+ZeroShot":        {"RC": [...]},
                                "Descriptions+ZeroShot":{"RC": [...]},
                                ...  # 5x4 = 20 configs
                            }
                        }
                    },
                    "ablation": {  # Phase 5
                        "sonnet": {
                            "Full_Best":          {"RC": [...]},
                            "No_Descriptions":    {"RC": [...]},
                            "No_SampleValues":    {"RC": [...]},
                            "No_Examples":        {"RC": [...]},
                            "No_SchemaPruning":   {"RC": [...]},
                            "Baseline":           {"RC": [...]},
                        },
                        "haiku": { ... }
                    }
                }

        Returns:
            FullAnalysisResult with all pairwise tests, Cochran's Q tests,
            bootstrap CIs, and a summary of key findings.
        """
        output = FullAnalysisResult()

        # ---------------------------------------------------------------
        # RQ1: Schema Format (Section 5.1)
        # ---------------------------------------------------------------
        if "schema_format" in experiment_results:
            fmt_data = experiment_results["schema_format"]
            for model_name, model_configs in fmt_data.get("models", {}).items():
                for metric in ["EX", "RC"]:
                    # Collect configs that have this metric
                    metric_configs = {}
                    for cfg_name, cfg_data in model_configs.items():
                        if metric in cfg_data:
                            metric_configs[cfg_name] = cfg_data[metric]

                    if len(metric_configs) < 2:
                        continue

                    label = f"RQ1_format_{model_name}_{metric}"

                    # Cochran's Q (omnibus test)
                    if len(metric_configs) >= 3:
                        q_result = self.cochrans_q_test(metric_configs, metric=metric)
                        output.cochran_results[label] = q_result

                    # Pairwise McNemar's with correction
                    pairwise = self.pairwise_all(metric_configs, metric_name=metric)
                    output.pairwise_results[label] = pairwise

                    # Bootstrap CIs for each config
                    for cfg_name, outcomes in metric_configs.items():
                        ci = self.bootstrap_ci(
                            outcomes,
                            config=f"{cfg_name}_{model_name}",
                            metric=metric,
                        )
                        output.bootstrap_cis[(f"{cfg_name}_{model_name}", metric)] = ci

        # ---------------------------------------------------------------
        # RQ2: Schema Scope (Section 5.2)
        # ---------------------------------------------------------------
        if "schema_scope" in experiment_results:
            scope_data = experiment_results["schema_scope"]
            for model_name, model_configs in scope_data.get("models", {}).items():
                for metric in ["EX", "RC"]:
                    metric_configs = {}
                    for cfg_name, cfg_data in model_configs.items():
                        if metric in cfg_data:
                            metric_configs[cfg_name] = cfg_data[metric]

                    if len(metric_configs) < 2:
                        continue

                    label = f"RQ2_scope_{model_name}_{metric}"

                    if len(metric_configs) >= 3:
                        q_result = self.cochrans_q_test(metric_configs, metric=metric)
                        output.cochran_results[label] = q_result

                    pairwise = self.pairwise_all(metric_configs, metric_name=metric)
                    output.pairwise_results[label] = pairwise

                    for cfg_name, outcomes in metric_configs.items():
                        ci = self.bootstrap_ci(
                            outcomes,
                            config=f"{cfg_name}_{model_name}",
                            metric=metric,
                        )
                        output.bootstrap_cis[(f"{cfg_name}_{model_name}", metric)] = ci

        # ---------------------------------------------------------------
        # RQ3: Metadata Enrichment (Section 5.3)
        # ---------------------------------------------------------------
        if "metadata" in experiment_results:
            meta_data = experiment_results["metadata"]
            for model_name, model_configs in meta_data.get("models", {}).items():
                metric = "RC"
                metric_configs = {}
                for cfg_name, cfg_data in model_configs.items():
                    if metric in cfg_data:
                        metric_configs[cfg_name] = cfg_data[metric]

                if len(metric_configs) < 2:
                    continue

                label = f"RQ3_metadata_{model_name}_{metric}"

                if len(metric_configs) >= 3:
                    q_result = self.cochrans_q_test(metric_configs, metric=metric)
                    output.cochran_results[label] = q_result

                pairwise = self.pairwise_all(metric_configs, metric_name=metric)
                output.pairwise_results[label] = pairwise

                for cfg_name, outcomes in metric_configs.items():
                    ci = self.bootstrap_ci(
                        outcomes,
                        config=f"{cfg_name}_{model_name}",
                        metric=metric,
                    )
                    output.bootstrap_cis[(f"{cfg_name}_{model_name}", metric)] = ci

            # Per-category analysis for metadata
            by_cat = meta_data.get("by_category", {})
            for model_name, cat_data in by_cat.items():
                for cat_name, cat_configs in cat_data.items():
                    metric_configs = {}
                    for cfg_name, cfg_data in cat_configs.items():
                        if "RC" in cfg_data:
                            metric_configs[cfg_name] = cfg_data["RC"]
                    if len(metric_configs) >= 2:
                        label = f"RQ3_metadata_{model_name}_RC_{cat_name}"
                        pairwise = self.pairwise_all(metric_configs, metric_name="RC")
                        output.pairwise_results[label] = pairwise

        # ---------------------------------------------------------------
        # RQ4: Example Selection (Section 5.4)
        # ---------------------------------------------------------------
        if "examples" in experiment_results:
            ex_data = experiment_results["examples"]
            for model_name, model_configs in ex_data.get("models", {}).items():
                metric = "RC"
                metric_configs = {}
                for cfg_name, cfg_data in model_configs.items():
                    if metric in cfg_data:
                        metric_configs[cfg_name] = cfg_data[metric]

                if len(metric_configs) < 2:
                    continue

                label = f"RQ4_examples_{model_name}_{metric}"

                if len(metric_configs) >= 3:
                    q_result = self.cochrans_q_test(metric_configs, metric=metric)
                    output.cochran_results[label] = q_result

                pairwise = self.pairwise_all(metric_configs, metric_name=metric)
                output.pairwise_results[label] = pairwise

                for cfg_name, outcomes in metric_configs.items():
                    ci = self.bootstrap_ci(
                        outcomes,
                        config=f"{cfg_name}_{model_name}",
                        metric=metric,
                    )
                    output.bootstrap_cis[(f"{cfg_name}_{model_name}", metric)] = ci

        # ---------------------------------------------------------------
        # Phase 3: Interaction Effects
        # ---------------------------------------------------------------
        if "interactions" in experiment_results:
            interactions = experiment_results["interactions"]

            for interaction_name, int_data in interactions.items():
                for model_name, model_configs in int_data.items():
                    metric = "RC"
                    metric_configs = {}
                    for cfg_name, cfg_data in model_configs.items():
                        if metric in cfg_data:
                            metric_configs[cfg_name] = cfg_data[metric]

                    if len(metric_configs) < 2:
                        continue

                    label = f"interaction_{interaction_name}_{model_name}_{metric}"

                    if len(metric_configs) >= 3:
                        q_result = self.cochrans_q_test(metric_configs, metric=metric)
                        output.cochran_results[label] = q_result

                    # For interactions we typically care about specific
                    # comparisons, but run all pairwise for completeness
                    pairwise = self.pairwise_all(metric_configs, metric_name=metric)
                    output.pairwise_results[label] = pairwise

        # ---------------------------------------------------------------
        # Phase 5: Ablation Study
        # ---------------------------------------------------------------
        if "ablation" in experiment_results:
            abl_data = experiment_results["ablation"]
            for model_name, model_configs in abl_data.items():
                metric = "RC"
                metric_configs = {}
                for cfg_name, cfg_data in model_configs.items():
                    if metric in cfg_data:
                        metric_configs[cfg_name] = cfg_data[metric]

                if len(metric_configs) < 2:
                    continue

                label = f"ablation_{model_name}_{metric}"

                pairwise = self.pairwise_all(metric_configs, metric_name=metric)
                output.pairwise_results[label] = pairwise

                for cfg_name, outcomes in metric_configs.items():
                    ci = self.bootstrap_ci(
                        outcomes,
                        config=f"{cfg_name}_{model_name}",
                        metric=metric,
                    )
                    output.bootstrap_cis[(f"{cfg_name}_{model_name}", metric)] = ci

        # ---------------------------------------------------------------
        # Summary
        # ---------------------------------------------------------------
        output.summary = self._build_summary(output)

        return output

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_summary(self, analysis: FullAnalysisResult) -> dict[str, Any]:
        """Build a human-readable summary of the key statistical findings.

        Extracts the most significant comparisons, largest effect sizes,
        and overall Cochran's Q results for each research question.
        """
        summary: dict[str, Any] = {}

        # Significant pairwise comparisons by RQ
        for label, pairwise_list in analysis.pairwise_results.items():
            sig_results = [r for r in pairwise_list if r.significant]
            largest_effect = max(pairwise_list, key=lambda r: abs(r.effect_size)) if pairwise_list else None

            summary[label] = {
                "total_comparisons": len(pairwise_list),
                "significant_comparisons": len(sig_results),
                "significant_pairs": [
                    {
                        "pair": f"{r.config_a} vs {r.config_b}",
                        "difference": round(r.difference, 4),
                        "p_corrected": round(r.p_value_corrected, 6),
                        "effect_size": round(r.effect_size, 4),
                        "effect_interp": r.effect_interpretation,
                    }
                    for r in sig_results
                ],
                "largest_effect": (
                    {
                        "pair": f"{largest_effect.config_a} vs {largest_effect.config_b}",
                        "h": round(largest_effect.effect_size, 4),
                        "interp": largest_effect.effect_interpretation,
                    }
                    if largest_effect
                    else None
                ),
            }

        # Cochran's Q summaries
        for label, q_result in analysis.cochran_results.items():
            key = f"{label}_cochran_q"
            summary[key] = {
                "Q": round(q_result.q_statistic, 4),
                "p": round(q_result.p_value, 6),
                "df": q_result.df,
                "significant": q_result.significant,
                "proportions": {k: round(v, 4) for k, v in q_result.proportions.items()},
            }

        return summary

    # ------------------------------------------------------------------
    # Utility: format results for display
    # ------------------------------------------------------------------

    @staticmethod
    def format_pairwise_table(results: list[PairwiseTestResult]) -> str:
        """Format pairwise test results as a human-readable ASCII table.

        Useful for debugging and logging. For the paper, use the LaTeX
        table generator instead.

        Args:
            results: List of PairwiseTestResult (typically from pairwise_all).

        Returns:
            Multi-line string with the formatted table.
        """
        if not results:
            return "(no results)"

        header = (
            f"{'Config A':<20} {'Config B':<20} {'Metric':<6} "
            f"{'A':>6} {'B':>6} {'Diff':>7} {'p-raw':>9} "
            f"{'p-adj':>9} {'Sig':>4} {'|h|':>6} {'Effect':<12}"
        )
        sep = "-" * len(header)
        lines = [header, sep]

        for r in results:
            sig_marker = " *" if r.significant else "  "
            line = (
                f"{r.config_a:<20} {r.config_b:<20} {r.metric:<6} "
                f"{r.value_a:>6.3f} {r.value_b:>6.3f} {r.difference:>+7.3f} "
                f"{r.p_value:>9.6f} {r.p_value_corrected:>9.6f} "
                f"{sig_marker:>4} {abs(r.effect_size):>6.3f} "
                f"{r.effect_interpretation:<12}"
            )
            lines.append(line)

        return "\n".join(lines)

    @staticmethod
    def format_bootstrap_table(
        cis: dict[tuple[str, str], BootstrapCIResult],
    ) -> str:
        """Format bootstrap CI results as a human-readable ASCII table.

        Args:
            cis: Dict mapping (config, metric) to BootstrapCIResult.

        Returns:
            Multi-line string with the formatted table.
        """
        if not cis:
            return "(no results)"

        header = (
            f"{'Config':<30} {'Metric':<6} {'Observed':>9} "
            f"{'CI Lower':>9} {'CI Upper':>9} {'SE':>8}"
        )
        sep = "-" * len(header)
        lines = [header, sep]

        for (config, metric), ci in sorted(cis.items()):
            line = (
                f"{config:<30} {metric:<6} {ci.observed:>9.4f} "
                f"{ci.ci_lower:>9.4f} {ci.ci_upper:>9.4f} {ci.se:>8.4f}"
            )
            lines.append(line)

        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Convenience entry point for standalone usage
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Demonstration with synthetic data
    rng = np.random.RandomState(42)
    n_queries = 150

    # Simulate RQ1: schema format results (different success rates)
    create_table = rng.binomial(1, 0.72, n_queries).astype(bool).tolist()
    markdown = rng.binomial(1, 0.78, n_queries).astype(bool).tolist()
    json_fmt = rng.binomial(1, 0.70, n_queries).astype(bool).tolist()
    natural_lang = rng.binomial(1, 0.65, n_queries).astype(bool).tolist()

    analyzer = StatisticalAnalyzer(alpha=0.05, seed=42)

    # Pairwise analysis
    configs = {
        "CREATE_TABLE": create_table,
        "Markdown": markdown,
        "JSON": json_fmt,
        "NaturalLang": natural_lang,
    }

    print("=" * 80)
    print("Cochran's Q Test (omnibus)")
    print("=" * 80)
    q = analyzer.cochrans_q_test(configs, metric="RC")
    print(f"Q = {q.q_statistic:.4f}, p = {q.p_value:.6f}, df = {q.df}")
    print(f"Significant: {q.significant}")
    print(f"Proportions: {q.proportions}")
    print()

    print("=" * 80)
    print("Pairwise McNemar's Tests (Holm-Bonferroni corrected)")
    print("=" * 80)
    pairwise = analyzer.pairwise_all(configs, metric_name="RC")
    print(StatisticalAnalyzer.format_pairwise_table(pairwise))
    print()

    print("=" * 80)
    print("Bootstrap 95% Confidence Intervals")
    print("=" * 80)
    cis = {}
    for name, outcomes in configs.items():
        ci = analyzer.bootstrap_ci(outcomes, config=name, metric="RC")
        cis[(name, "RC")] = ci
    print(StatisticalAnalyzer.format_bootstrap_table(cis))
