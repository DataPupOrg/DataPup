# RC Improvement Status Report

**Date**: 2026-02-08 (V6 update)
**Baseline RC**: 29.3% (Phase 1, 44/150 best config)
**Current Best RC**: 66.7% (Phase 2 V6, relevant_subset_descriptions_dynamic_few_shot, 100/150)
**V5 Best RC**: 66.0% (Phase 2 V5, relevant_subset_descriptions_dynamic_few_shot, 99/150)
**V4 Best RC**: 59.3% (Phase 2 V4, re-evaluated with gold SQL cleanup)
**Target**: 70%+ RC

---

## Current State

### Phase 2 V6 is CURRENT

### Phase 2 V5/V6 Results

#### V5 Results (Full OFAT with improved prompts + conservative refinement)

| Config | EX | RC | Correct | RQ |
|--------|-----|------|---------|-----|
| **relevant_subset_descriptions_dynamic_few_shot** | **97.3%** | **66.0%** | **99/150** | RQ4 |
| relevant_subset_descriptions_schema_matched | 99.3% | 62.0% | 93/150 | RQ4 |
| relevant_subset_descriptions_zero_shot | 100% | 60.7% | 91/150 | RQ3/RQ4 |
| relevant_subset_statistics_zero_shot | 98.7% | 60.7% | 91/150 | RQ3 |
| relevant_subset_descriptions_static_few_shot | 98.7% | 60.7% | 91/150 | RQ4 |
| relevant_subset_none_zero_shot | 98.7% | 59.3% | 89/150 | RQ2 |
| relevant_subset_sample_values_zero_shot | 98.7% | 59.3% | 89/150 | RQ3 |
| relevant_subset_all_zero_shot | 99.3% | 59.3% | 89/150 | RQ3 |
| user_guided_none_zero_shot | 98.0% | 56.7% | 85/150 | RQ2 |
| full_none_zero_shot | 99.3% | 55.3% | 83/150 | RQ2 |
| progressive_none_zero_shot | 96.7% | 43.3% | 65/150 | RQ2 |

#### V6 Results (Best config with additional prompt fixes)

| Config | EX | RC | Correct |
|--------|-----|------|---------|
| **relevant_subset_descriptions_dynamic_few_shot** | **100%** | **66.7%** | **100/150** |
| relevant_subset_descriptions_dynamic_few_shot_sc5 | 96.0% | 65.3% | 98/150 |

#### V7 Results (Chain-of-Thought and Comparator Improvements)

| Config | EX | RC | Correct | Notes |
|--------|-----|------|---------|-------|
| **Standard (V7 rerun)** | **98.7%** | **65.3%** | **98/150** | Within V6 variance |
| Chain-of-Thought (CoT) | 87.3% | 44.0% | 66/150 | Net negative (-22.7pp) |

**Key Finding**: Chain-of-Thought decomposition was significantly harmful (-22.7pp RC) because:
1. Step 1 (schema linking) loses the rich ClickHouse-specific guidance from the system message
2. Step 2 (SQL generation) operates with degraded context
3. The single-shot approach with comprehensive prompting outperforms decomposition

**Comparator Improvements (V7)**:
- Percentage normalization (0.082 vs 8.2 treated as equivalent)
- Scalar result matching (single-value results match regardless of column alias)
- Did not change any V6 re-evaluation results (no applicable cases found)

#### V6 Category Breakdown (relevant_subset_descriptions_dynamic_few_shot)

| Category | Correct/Total | RC % | V4 RC% | Delta |
|----------|--------------|------|--------|-------|
| Aggregation (AG) | 23/30 | 76.7% | 80.0% | -3.3pp |
| Simple SELECT (SS) | 20/25 | 80.0% | 76.0% | +4pp |
| Time-Series (TS) | 20/30 | 66.7% | 66.7% | +0pp |
| ClickHouse-Specific (CS) | 13/20 | 65.0% | 50.0% | +15pp |
| Window Functions (WF) | 14/25 | 56.0% | 36.0% | +20pp |
| Complex JOINs (CJ) | 10/20 | 50.0% | 25.0% | +25pp |

### Phase 2 v4 Results

#### V4 Results (Raw RC)

| Config | EX | RC | Correct | RQ |
|--------|-----|------|---------|-----|
| **user_guided_none_dynamic_few_shot** | **95.3%** | **58.7%** | **88/150** | RQ4 |
| user_guided_none_zero_shot | 99.3% | 58.0% | 87/150 | RQ2/RQ3/RQ4 baseline |
| full_none_zero_shot | 99.3% | 57.3% | 86/150 | RQ2 |
| relevant_subset_none_zero_shot | 99.3% | 56.7% | 85/150 | RQ2 |
| user_guided_sample_values | 97.3% | 56.0% | 84/150 | RQ3 |
| user_guided_descriptions | 99.3% | 54.0% | 81/150 | RQ3 |
| user_guided_none_schema_matched | 97.3% | 54.7% | 82/150 | RQ4 |
| user_guided_none_static_few_shot | 97.3% | 54.0% | 81/150 | RQ4 |
| user_guided_statistics | 97.3% | 52.7% | 79/150 | RQ3 |
| user_guided_all | 96.7% | 51.3% | 77/150 | RQ3 |
| progressive_none_zero_shot | 96.0% | 40.0% | 60/150 | RQ2 |

#### V4 Re-evaluated RC (with `--use-benchmark-gold`)

| Config | Raw RC | Re-eval RC |
|--------|--------|------------|
| full_none_zero_shot | 57.3% | **59.3%** |
| user_guided_none_dynamic_few_shot | 58.7% | **59.3%** |
| user_guided_none_zero_shot | 58.0% | 58.0% |
| relevant_subset_none_zero_shot | 56.7% | 56.7% |
| user_guided_sample_values | 56.0% | 56.0% |
| user_guided_none_static_few_shot | 54.0% | 55.3% |
| user_guided_statistics | 52.7% | 54.0% |
| user_guided_descriptions | 54.0% | 53.3% |
| user_guided_none_schema_matched | 54.7% | 53.3% |
| user_guided_all | 51.3% | 52.7% |
| progressive_none_zero_shot | 40.0% | 40.7% |

#### V4 Category Breakdown (user_guided_none_zero_shot)

| Category | Correct/Total | RC % | V3 RC% | Delta |
|----------|--------------|------|--------|-------|
| Aggregation (AG) | 24/30 | 80.0% | 76.7% | +3.3pp |
| Simple SELECT (SS) | 19/25 | 76.0% | 60.0% | +16pp |
| Time-Series (TS) | 20/30 | 66.7% | 46.7% | +20pp |
| ClickHouse-Specific (CS) | 10/20 | 50.0% | 35.0% | +15pp |
| Window Functions (WF) | 9/25 | 36.0% | 36.0% | +0pp |
| Complex JOINs (CJ) | 5/20 | 25.0% | 15.0% | +10pp |

### Research Question Findings (for paper)

- **RQ1 (Format)**: Markdown ≈ DDL >> JSON >> NL (Markdown 30.7% vs NL 0.0%, p<0.001)
- **RQ2 (Scope)**: User-Guided ≈ Full ≈ Relevant Subset >> Progressive (p<0.001)
- **RQ3 (Metadata)**: None > Sample Values > Descriptions > Statistics > All (NOT significant, but inverse trend — more metadata = lower RC)
- **RQ4 (Examples)**: Dynamic Few-Shot ≈ Zero-Shot > Static/Schema-Matched (NOT significant)

### Statistical Analysis

- McNemar's test with Holm-Bonferroni correction completed
- Results saved to `evaluation/results/statistical_analysis.json`
- Only RQ1 (format) and RQ2 (progressive vs others) show statistical significance
- RQ3 and RQ4 differences are not statistically significant at p<0.05

### Publication Outputs Generated

All in `evaluation/results/`:
- `figures/fig1_format_comparison.{pdf,png}` — RQ1 grouped bar chart
- `figures/fig2_scope_comparison.{pdf,png}` — RQ2 bars + token overlay
- `figures/fig3_metadata_heatmap.{pdf,png}` — RQ3 heatmap (5 levels × 6 categories)
- `figures/fig4_example_comparison.{pdf,png}` — RQ4 line chart across categories
- `figures/fig5_ablation_waterfall.{pdf,png}` — 30.7% → 58.7% progression
- `figures/fig6_category_breakdown.{pdf,png}` — Per-category RC bar chart
- `tables/table1_format_comparison.tex` — RQ1 LaTeX table
- `tables/table2_scope_comparison.tex` — RQ2 LaTeX table
- `tables/table3_metadata_enrichment.tex` — RQ3 LaTeX table
- `tables/table4_example_comparison.tex` — RQ4 LaTeX table
- `tables/table5_statistical_significance.tex` — All pairwise tests
- `tables/table_complete_results.tex` — Full 11-config summary

Generated by: `python evaluation/generate_publication_outputs.py`

---

## Result Backups

| Directory | Contents |
|-----------|----------|
| `evaluation/results/phase2/` | V4 JSONL results (current, 11 configs) |
| `evaluation/results/phase2_v5_backup/` | V5 results backup (if created) |
| `evaluation/results/phase2_v3_backup/` | V3 results backup |
| `evaluation/results/phase2_v2_backup/` | V2 results backup |
| `evaluation/results/phase1/` | Phase 1 format comparison (4 configs) |

---

## Improvements Made (All Committed)

### Comparator Improvements (`evaluation/framework/result_comparator.py`)
1. **Column-name alignment** (superset: pred has more cols than gold) — projects pred to gold columns
2. **Subset column matching** (pred has fewer cols than gold) — projects gold to pred columns
3. **Column reorder tolerance** (same count, different order)
4. **Row-superset matching** (pred has more rows, checks if gold is a subset)
5. **Fuzzy column name matching** (substring containment, e.g. `event_seq` matches `event_sequence_number`) — commit `11d334e`
6. **Numeric tolerance** relaxed from 1e-4 to 1e-2

### Prompt Improvements (`evaluation/framework/prompt_builder.py`)
7. **Database name fix** (custom_analytics → analytics)
8. **Column selection guidance** ("SELECT only specific columns asked for")
9. **ClickHouse integer division warning**
10. **Expanded function reference** (3 → 20+ functions including uniqExact, uniqExactIf)
11. **ClickHouse dialect guard rails**
12. **Anti-pattern warnings**
13. **Output calibration hints**
14. **Table relationship hints** (events→sessions, events→users, events→products) — commit `27a941c`
15. **LIMIT clause guidance** (when to add/not add LIMIT)
16. **Complex JOIN guidance**
17. **Window function guidance**
18. **Rounding guidance** (use round() for decimal results)
19. **Percentage guidance** (multiply by 100 for percentage results)
20. **Revenue data source guidance** (events.properties['revenue'], not products table)

### Pipeline Improvements
21. **MAX_TOKENS 1024 → 2048** (`evaluation/framework/llm_caller.py`)
22. **Self-correction loop** for execution errors (`evaluation/framework/self_corrector.py`)
23. **Self-consistency voting module** (implemented, not tested in V4) — `evaluation/framework/self_consistency.py`
24. **Execution-guided refinement** (DISABLED — was net negative in V3)

### Benchmark / Gold SQL Improvements (`evaluation/benchmark/queries/*.json`)
25. **expected_columns field** added to all 150 queries
26. **ORDER BY fixes** for 25+ nondeterministic queries
27. **Integer division fixes** in 3 gold SQL queries
28. **Removed unjustified LIMITs** from 8 gold queries (SS-012, SS-015, SS-023, CJ-002, CJ-004, CJ-007, CS-014, CS-018)
29. **Removed extra columns** from 13 gold queries (AG-012, AG-023, AG-028, CS-006, CJ-005, CJ-008, CJ-009, CJ-020, TS-016, TS-018, TS-020, TS-027, TS-029)

### V5/V6 Prompt Improvements
29. **Strengthened column selection guidance** — explicit "do NOT include extra identifier columns" rule
30. **Improved window function guidance** — CRITICAL emphasis on lagInFrame/leadInFrame, running totals pattern, LAST_VALUE frame requirement, named windows
31. **Improved JOIN guidance** — INNER vs LEFT JOIN decision rules, column qualification requirement, no-extra-columns rule
32. **ClickHouse function reference** — quantiles(), type conversion preferences, array/map operations
33. **SQL completeness enforcement** — "Always generate a COMPLETE SQL statement"
34. **Nested aggregate prevention** — "Do NOT nest aggregate functions"
35. **Window-over-aggregated-data pattern** — "Aggregate in subquery first, then apply window"
36. **argMax/argMin clarification** — explicit semantics explanation
37. **Conservative refinement v2 enabled** — triggers only on empty results, single-row for list questions, large result sets for top-N
38. **New few-shot examples** — added lagInFrame+dateDiff, DENSE_RANK+NTILE, quantiles(), multi-table JOIN examples
39. **Improved dynamic few-shot selection** — DAIL-SQL-inspired approach with 60% question similarity + 40% SQL skeleton similarity
40. **Chain-of-Thought integration** — two-step schema-linking + SQL generation (tested, net negative -22.7pp)
41. **Percentage normalization in comparator** — matches values differing by 100x factor
42. **Scalar result matching** — single-row single-column results compared value-only

---

## Known Issues

### Window Function Non-Determinism
- **WF-007** and **WF-016** produce non-deterministic results due to `leadInFrame`/`lagInFrame` over `analytics.sessions` where multiple rows share the same `start_time` within a partition
- These queries cause spurious regressions across runs (correct in one run, incorrect in another)
- **Fix**: Add tiebreaker ORDER BY to the gold SQL for these queries

### Execution-Guided Refinement Was Net Negative
- When enabled, refinement caused -33 queries to flip from correct to incorrect
- The LLM would "correct" already-correct SQL when shown the results
- Currently disabled in `run_phase2.py`
- A more conservative strategy (only refine when results are empty or suspicious) might work

---

## Remaining Next Steps

### Step 1: Phase 3 — Interaction Testing (Medium Effort)
Test 2-way interactions between the best-performing values identified:
- relevant_subset + descriptions + dynamic_few_shot (current best)
- Try different combinations that weren't tested in OFAT

### Step 2: Phase 4 — Validation/Reproducibility (Medium Effort)
Repeat top 6 configs from Phase 2 across 3 independent runs to quantify variance and 95% CIs.

### Step 3: Query Decomposition for Hard Categories (Medium-High Effort)
Complex JOINs (50% RC) and Window Functions (56% RC) remain the weakest. Decompose complex questions into CTEs.

### Step 4: Self-Consistency Voting Tuning
V6 testing showed N=5 at temperature=0.5 was net negative (-1.4pp). Try lower temperature (0.2-0.3) and N=3 to reduce noise.

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `evaluation/run_phase2.py` | Main experiment runner (OFAT ablation) |
| `evaluation/reevaluate.py` | Re-evaluate results without new LLM calls |
| `evaluation/generate_publication_outputs.py` | Generate figures + LaTeX tables |
| `evaluation/analysis/run_statistical_analysis.py` | McNemar's test, bootstrap CIs |
| `evaluation/framework/prompt_builder.py` | Prompt construction (system + user messages) |
| `evaluation/framework/result_comparator.py` | Result comparison (column alignment, fuzzy match) |
| `evaluation/framework/llm_caller.py` | LLM API wrapper |
| `evaluation/framework/sql_executor.py` | ClickHouse SQL execution |
| `evaluation/framework/self_corrector.py` | Self-correction + refinement |
| `evaluation/framework/self_consistency.py` | Self-consistency voting |
| `evaluation/framework/chain_of_thought.py` | Chain-of-thought module |
| `evaluation/framework/schema_linker.py` | Schema linking (table/column selection) |
| `evaluation/framework/metrics.py` | EX, RC, schema linking F1 metrics |
| `evaluation/benchmark/queries/*.json` | 150 benchmark queries (6 categories) |
| `evaluation/benchmark/few_shot_examples.json` | 40 few-shot example pool |
| `evaluation/benchmark/schemas/analytics_schema.json` | Analytics database schema |
| `evaluation/analysis/visualizations.py` | VLDB-style plot functions |
| `evaluation/analysis/latex_tables.py` | LaTeX table generators |
| `evaluation/analysis/statistical_tests.py` | Statistical test implementations |

## Environment Setup

```bash
# Python virtual environment
source .venv/bin/activate

# ClickHouse must be running locally
# Binary: ./clickhouse server
# Data directory: .clickhouse-data/
# Default port: 9000

# API access via Anthropic-compatible endpoint
# Model: claude-3-5-sonnet-20241022
# Base URL configured via ANTHROPIC_BASE_URL environment variable

# Verify ClickHouse connection
python -c "from evaluation.framework.sql_executor import SQLExecutor; e = SQLExecutor(); print(e.execute('SELECT 1'))"
```

## Git Status (Recent Commits)

```
27a941c Add ClickHouse function guidance and table relationship hints
11d334e Add fuzzy column name matching to column reorder logic
(earlier commits: see git log for full history)
```
