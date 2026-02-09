# Comprehensive Experiment Plan: Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases

## VLDB 2026 Submission — Structured Research & Experiment Plan (Revised)

**Authors:** Sahith Vibudhi, Krishna Chaitanya Balusu
**Target Venues:** VLDB 2026 Industrial/Workshop Track, CIDR 2027, SIGMOD 2027
**Date:** February 2026
**Status:** Experiment Design Phase
**Revision:** v2 — Claude-only model strategy, zero-cost API budget

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Paper Status — What's Done vs. Pending](#2-paper-status)
3. [Literature Landscape & Positioning](#3-literature-landscape)
4. [VLDB Submission Strategy](#4-vldb-submission-strategy)
5. [Dataset Selection & Preparation](#5-dataset-selection)
6. [Experiment Design](#6-experiment-design)
7. [Methodology & Evaluation Framework](#7-methodology)
8. [Statistical Analysis Plan](#8-statistical-analysis)
9. [Implementation Roadmap](#9-implementation-roadmap)
10. [Risk Mitigation](#10-risk-mitigation)
11. [References](#11-references)

---

## 1. Executive Summary

This document provides a comprehensive plan for completing the experiments section of the paper "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases." The paper investigates four dimensions of prompt engineering for ClickHouse Text-to-SQL:

1. **Schema Representation Format** — CREATE TABLE vs Markdown vs JSON vs Natural Language
2. **Schema Scope Strategy** — Full vs Relevant Subset vs Progressive Expansion vs User-Guided
3. **Metadata Enrichment** — Column descriptions, sample values, statistics, constraints
4. **Example Selection** — Zero-shot, static few-shot, dynamic few-shot, schema-matched

### Model Strategy

We use **Claude 3.5 Sonnet** as the primary evaluation model and **Claude 3 Haiku** as a secondary model to test whether findings hold across capability levels. This is a deliberate choice:

- **The paper's contribution is the schema strategy comparison, not a model comparison.** The 4 research questions (RQ1-RQ4) are about schema format, scope, metadata, and examples — not about which LLM is best.
- **Single-family evaluation is common in VLDB Industrial Track papers.** DAIL-SQL performed most analysis on GPT-4 alone. Industrial papers focus on systems, not model benchmarking.
- **Two capability levels** (Sonnet = frontier, Haiku = efficient) test whether findings hold at different model sizes, which is the practically relevant question for tool developers choosing cost/quality tradeoffs.
- **Extension to other model families** is explicitly noted as future work.

### Cost & Infrastructure

- **API cost: $0** — uses existing Anthropic environment credentials
- **New API keys: 0** — everything runs through current `ANTHROPIC_BASE_URL`
- **Only setup needed: ClickHouse installation** (`brew install clickhouse`)

---

## 2. Paper Status — What's Done vs. Pending

### Completed Sections
| Section | Status | Notes |
|---------|--------|-------|
| Abstract | ✅ Done | Well-written, covers all 4 dimensions |
| 1. Introduction | ✅ Done | Motivates the OLAP gap |
| 2. Background & Motivation | ✅ Done | ClickHouse characteristics, research gap |
| 3. Methodology | ✅ Done | All 4 experimental dimensions defined |
| 4. Experimental Setup | ⚠️ Needs Update | Change model list from 5 to 2 Claude models |
| 7. Related Work | ⚠️ Partial | Only 5 references — needs 20+ |

### Pending Sections (TO BE COMPLETED AFTER EXPERIMENTS)
| Section | Status | What's Needed |
|---------|--------|---------------|
| **5. Results** | ❌ Not Started | ALL experiment results — the core of the paper |
| **6. Discussion** | ❌ Not Started | Analysis, practical recommendations, trade-offs |
| **8. Conclusion** | ❌ Not Started | Key findings summary, future work |
| **Benchmark Dataset** | ❌ Not Started | 150 NL-SQL pairs need to be created |
| **Evaluation Framework** | ❌ Not Started | No code exists for running experiments |
| **Related Work (expanded)** | ❌ Not Started | Need comprehensive related work section |

### Critical Path
```
Benchmark Creation → Evaluation Framework → Run Experiments → Statistical Analysis → Write Results → Write Discussion → Write Conclusion
```

---

## 3. Literature Landscape & Positioning

### 3.1 Key Papers and How We Relate

#### Core Text-to-SQL Papers (Must-Cite)

| Paper | Venue | Key Contribution | Our Differentiation |
|-------|-------|-------------------|---------------------|
| **DAIL-SQL** (Gao et al.) | VLDB 2024 | Systematic prompt engineering benchmark for Spider | We extend to OLAP/ClickHouse; they only use CREATE TABLE format |
| **DIN-SQL** (Pourreza & Rafiei) | NeurIPS 2023 | Decomposed prompting with self-correction | We evaluate decomposition as one dimension; they don't study schema format |
| **C3** (Dong et al.) | arXiv 2023 | Zero-shot with minimal schema + calibration hints | Their "minimal schema" finding informs our schema scope experiments |
| **CHESS** (Talaei et al.) | arXiv 2024 | Entity retrieval + schema selection + SQL revision | Their entity retrieval maps to our sample values enrichment |
| **MAC-SQL** (Wang et al.) | arXiv 2024 | Multi-agent collaborative Text-to-SQL | Schema selector agent validates our "relevant subset" strategy |
| **CodeS** (Li et al.) | SIGMOD 2024 | Fine-tuned open-source models for Text-to-SQL | Sample rows in schema improve accuracy (supports our metadata enrichment) |
| **RESDSQL** (Li et al.) | AAAI 2023 | Decoupled schema linking + skeleton decoding | Schema ranking as alternative to keyword-based filtering |

#### Benchmarks (Must-Cite)

| Benchmark | Size | Dialect | Why We're Different |
|-----------|------|---------|---------------------|
| **Spider** (Yu et al., EMNLP 2018) | 10,181 queries | SQLite | Small schemas (avg 5 tables), OLTP focus |
| **BIRD** (Li et al., NeurIPS 2023) | 12,751 queries | SQLite/PG | Larger schemas, but no OLAP dialect |
| **Spider 2.0** (Lei et al., 2024) | 632 tasks | BQ/Snowflake/DuckDB/PG | Enterprise level but no ClickHouse |
| **SEDE** (Hazoom et al., NAACL 2021) | 12,023 queries | T-SQL | Real user queries with complex analytics |

#### Schema Linking Papers (Should-Cite)

| Paper | Key Finding | Relevance |
|-------|------------|-----------|
| **RAT-SQL** (Wang et al., ACL 2020) | Schema linking is primary bottleneck | Validates our schema scope experiments |
| **BRIDGE** (Lin et al., EMNLP 2020) | Sample values improve accuracy by ~4% | Directly supports our metadata enrichment |
| **CoT for SQL** (Tai et al., EMNLP 2023) | Schema-first reasoning is best CoT style | Informs our prompt construction |

### 3.2 Our Unique Position

**No existing paper does ALL of the following:**
1. Systematically compares schema representation formats (all use CREATE TABLE only)
2. Evaluates prompt strategies specifically for OLAP databases
3. Provides a ClickHouse-specific benchmark
4. Studies the interaction between schema scope and metadata enrichment

### 3.3 Expanded Reference List (22+ papers)

```
[1]  Gao et al. (2024). DAIL-SQL. PVLDB 17(5).
[2]  Pourreza & Rafiei (2023). DIN-SQL. NeurIPS 2023.
[3]  Dong et al. (2023). C3: Zero-shot Text-to-SQL with ChatGPT. arXiv:2307.07306.
[4]  Talaei et al. (2024). CHESS. arXiv:2405.16755.
[5]  Wang et al. (2024). MAC-SQL. arXiv:2312.11242.
[6]  Li et al. (2024). CodeS. SIGMOD 2024.
[7]  Li et al. (2023). RESDSQL. AAAI 2023.
[8]  Yu et al. (2018). Spider. EMNLP 2018.
[9]  Li et al. (2023). BIRD. NeurIPS 2023.
[10] Lei et al. (2024). Spider 2.0. arXiv:2411.07763.
[11] Wang et al. (2020). RAT-SQL. ACL 2020.
[12] Lin et al. (2020). BRIDGE. EMNLP 2020.
[13] Tai et al. (2023). CoT for SQL. EMNLP 2023.
[14] Chen et al. (2023). Self-Debug. arXiv:2304.05128.
[15] Wang et al. (2023). Self-Consistency. ICLR 2023.
[16] Zhong et al. (2017). Seq2SQL/WikiSQL. arXiv:1709.00103.
[17] Yu et al. (2019). SParC. ACL 2019.
[18] Yu et al. (2019). CoSQL. EMNLP 2019.
[19] Chang et al. (2023). Dr.Spider. ICLR 2023.
[20] Lee et al. (2021). KaggleDBQA. ACL 2021.
[21] Hazoom et al. (2021). SEDE. NAACL 2021.
[22] Defog.ai (2023-2024). SQLCoder.
[23] Vanna.ai — Open-source RAG for Text-to-SQL.
```

---

## 4. VLDB Submission Strategy

### 4.1 Venue Fit Analysis

| Venue | Fit | Deadline (Estimated) | Reasoning |
|-------|-----|---------------------|-----------|
| VLDB 2026 Industrial Track | Medium | Feb-Mar 2026 (**check immediately**) | Needs production deployment story |
| VLDB 2026 Research Track | Strong | Rolling (monthly 1st) | Evaluation study fits well |
| VLDB 2026 Workshop (NL4DB/QDB) | Very Strong | May-Jun 2026 | Ideal for benchmark papers |
| CIDR 2027 | Strong | Jun-Aug 2026 | Values vision + practical guidelines |
| SIGMOD 2027 | Medium-Strong | ~Oct 2026 | Strong competition but feasible |

### 4.2 Strengthening for Industrial Track

1. **Frame DataPup as a production system** — deployed, open-source AI-assisted database client
2. **Add System Architecture section** — LangChain agent, tool-based schema discovery
3. **Include deployment metrics** — GitHub stars, downloads, real usage data
4. **Emphasize practical guidelines** — "We built a tool, here's what works in practice"
5. **Scale demonstration** — experiments on schemas with 100+ columns

### 4.3 Paper Format

- **Page limit:** 12 pages (PVLDB formatting, two-column ACM-like style)
- **Template:** Download from vldb.org/pvldb/formatting.html

---

## 5. Dataset Selection & Preparation

### 5.1 Recommended Dataset Portfolio (Hybrid Approach)

Use **4 official ClickHouse datasets** + **1 custom schema**:

#### Dataset 1: ClickBench `hits` Table
- **Source:** clickhouse.com/docs/en/getting-started/example-datasets/clickbench
- **Schema:** 1 table, **105 columns** (web analytics clickstream data)
- **Size:** ~14 GB, ~100M rows
- **Strengths:** Massive column count (perfect for schema scope testing)
- **ClickHouse Features:** LowCardinality, FixedString, UInt types
- **Queries:** 40 — Simple SELECT (10), Aggregation (15), Time-Series (10), CH-Specific (5)

#### Dataset 2: OnTime Airline Data
- **Source:** clickhouse.com/docs/en/getting-started/example-datasets/ontime
- **Schema:** 1 table, **109 columns** (US DOT airline on-time performance)
- **Size:** ~20 GB, ~200M rows
- **Strengths:** Largest column count, rich temporal data
- **ClickHouse Features:** argMax, extensive date/time fields
- **Queries:** 35 — Time-Series (15), Window Functions (10), Aggregation (5), CH-Specific (5)

#### Dataset 3: Star Schema Benchmark (SSB)
- **Source:** clickhouse.com/docs/en/getting-started/example-datasets/star-schema
- **Schema:** **5 tables** (lineorder + 4 dimension tables), 58 columns total
- **Size:** Scalable (SF1 = ~6M rows)
- **Strengths:** Multi-table star schema (perfect for JOIN testing)
- **Queries:** 25 — Complex JOINs (15), Aggregation (5), Simple SELECT (5)

#### Dataset 4: GitHub Events
- **Source:** clickhouse.com/docs/en/getting-started/example-datasets/github-events
- **Schema:** Multiple tables, **50+ columns**, Array columns
- **Size:** 3B+ events (subset to manageable size)
- **Strengths:** Array types, real-world data, temporal patterns
- **Queries:** 20 — CH-Specific (10), Complex JOINs (5), Time-Series (5)

#### Dataset 5: Custom Analytics Platform Schema
- **Purpose:** Fill gaps for Map, Nested, Enum8, materialized columns
- **Schema:** 3-4 tables, ~60 columns
- **Size:** Synthetic, 100K-1M rows per table
- **Queries:** 30 — CH-Specific (10), Window Functions (10), Simple SELECT (5), Aggregation (5)

### 5.2 Total Query Distribution

| Category | ClickBench | OnTime | SSB | GitHub | Custom | Total |
|----------|-----------|--------|-----|--------|--------|-------|
| Simple SELECT | 10 | — | 5 | — | 5 | **25** |
| Aggregation | 15 | 5 | 5 | — | 5 | **30** |
| Window Functions | — | 10 | — | — | 10 | **25** |
| Time-Series | 10 | 15 | — | 5 | — | **30** |
| Complex JOINs | — | — | 15 | 5 | — | **20** |
| ClickHouse-Specific | 5 | 5 | — | 10 | 10 | **30** |
| **Total** | **40** | **35** | **25** | **20** | **30** | **150** |

### 5.3 Dataset Preparation Steps

```
Step 1: Install ClickHouse locally (brew install clickhouse)
Step 2: Load ClickBench hits data
Step 3: Load OnTime data
Step 4: Load SSB data
Step 5: Load GitHub Events subset
Step 6: Create custom analytics schema (Claude Code generates this)
Step 7: Generate synthetic data (Claude Code generates this)
Step 8: Validate all datasets are queryable
Step 9: Write 150 NL-SQL pairs (Claude Code generates this)
Step 10: Validate all gold SQL queries execute correctly
Step 11: Second author cross-validates NL-SQL pairs
```

---

## 6. Experiment Design

### 6.1 Variables and Factor Levels

#### Independent Variables (4 Factors)

| Factor | Levels | Details |
|--------|--------|---------|
| **A: Schema Format** | 4 | A1: CREATE TABLE (DDL), A2: Markdown, A3: JSON, A4: Natural Language |
| **B: Schema Scope** | 4 | B1: Full Schema, B2: Relevant Subset, B3: Progressive Expansion, B4: User-Guided |
| **C: Metadata** | 5 | C0: None, C1: Descriptions, C2: Sample Values, C3: Statistics, C4: All Combined |
| **D: Examples** | 4 | D1: Zero-shot, D2: Static Few-shot (3), D3: Dynamic Few-shot, D4: Schema-matched |

#### Models (2 Claude Models)

| Model | Role | Rationale |
|-------|------|-----------|
| **Claude 3.5 Sonnet** | Primary (frontier) | State-of-the-art, representative of best-available LLMs |
| **Claude 3 Haiku** | Secondary (efficient) | Tests if findings hold at smaller/cheaper model tier |

**Full Factorial:** 4 × 4 × 5 × 4 = 320 configurations × 150 queries × 2 models = **96,000 API calls** — still not feasible, hence multi-phase design below.

#### Dependent Variables (Metrics)

| Metric | Symbol | Description | How to Compute |
|--------|--------|-------------|----------------|
| Execution Accuracy | EX | % executing without errors | Execute on ClickHouse |
| Result Correctness | RC | % producing correct output | Compare result sets |
| Schema Linking Accuracy | SL | Correct table/column ID | Compare vs gold SQL |
| Token Efficiency | TE | Prompt tokens per query | API response metadata |
| Latency | L | End-to-end time | Wall-clock time |

### 6.2 Multi-Phase Experiment Design

#### Phase 1: Baseline Establishment
- **Configuration:** A1 (CREATE TABLE) + B1 (Full Schema) + C0 (No metadata) + D1 (Zero-shot)
- **Queries:** All 150
- **Models:** Both (Sonnet + Haiku)
- **Total calls:** 150 × 2 = **300 calls**
- **Also run:** DAIL-SQL-style baseline (A1 + B2 + C0 + D3) = 300 more calls

#### Phase 2: One-Factor-at-a-Time (OFAT)

**Phase 2A — Schema Format Comparison:**
- Fix: B1, C0, D1
- Vary: A1, A2, A3, A4
- Calls: 4 × 150 × 2 = **1,200** (net 900 new after baseline)

**Phase 2B — Schema Scope Comparison:**
- Fix: A_best, C0, D1
- Vary: B1, B2, B3, B4
- Calls: 4 × 150 × 2 = **1,200** (net 900 new)

**Phase 2C — Metadata Enrichment Comparison:**
- Fix: A_best, B_best, D1
- Vary: C0, C1, C2, C3, C4
- Calls: 5 × 150 × 2 = **1,500** (net 1,200 new)

**Phase 2D — Example Selection Comparison:**
- Fix: A_best, B_best, C_best
- Vary: D1, D2, D3, D4
- Calls: 4 × 150 × 2 = **1,200** (net 900 new)

**Phase 2 Total:** ~3,900 net new calls

#### Phase 3: Interaction Effects

**Key 2-way interactions:**
1. **Format × Scope:** 4 × 4 = 16 configs × 150 × 2 models = **4,800 calls**
2. **Metadata × Examples:** 5 × 4 = 20 configs × 150 × 1 model (Sonnet) = **3,000 calls**
3. **Format × Query Complexity:** Analyze Phase 2A results by category (no new calls)

**Phase 3 Total:** ~7,800 calls

#### Phase 4: Best Configuration Validation
- Top-3 configurations × 150 queries × 2 models × 3 runs = **2,700 calls**
- Net new (after reuse): ~1,800 calls

#### Phase 5: Ablation Studies
- ~6 ablation configs × 150 queries × 2 models = **1,800 calls**

### 6.3 Total Experiment Budget

| Phase | Purpose | API Calls | Cost |
|-------|---------|-----------|------|
| Phase 1 | Baselines | 600 | $0 (existing env) |
| Phase 2 | OFAT Analysis | 3,900 | $0 |
| Phase 3 | Interactions | 7,800 | $0 |
| Phase 4 | Validation | 1,800 | $0 |
| Phase 5 | Ablations | 1,800 | $0 |
| **Total** | | **~15,900** | **$0** |

**Reduction from original plan:** 25,800 → 15,900 calls (38% fewer) due to 2 models instead of 5.

---

## 7. Methodology & Evaluation Framework

### 7.1 Evaluation Approach

#### Primary Metric: Execution Accuracy (EX)
- Execute generated SQL against ClickHouse
- Binary: 1 if executes without error, 0 otherwise

#### Secondary Metric: Result Correctness (RC)
- Compare result sets from predicted SQL vs gold SQL
- Set-based comparison (order-independent unless ORDER BY in gold SQL)
- Handle: float tolerance (±0.01), NULL equality, column-position matching

#### Tertiary Metrics:
- **Schema Linking (SL):** Parse SQL for table/column references vs gold
- **Token Efficiency (TE):** `input_tokens` from API response
- **Latency (L):** Wall-clock time

### 7.2 Evaluation Framework Architecture

```
evaluation/
├── benchmark/
│   ├── queries/
│   │   ├── simple_select.json       # 25 NL-SQL pairs
│   │   ├── aggregation.json         # 30 NL-SQL pairs
│   │   ├── window_functions.json    # 25 NL-SQL pairs
│   │   ├── time_series.json         # 30 NL-SQL pairs
│   │   ├── complex_joins.json       # 20 NL-SQL pairs
│   │   └── clickhouse_specific.json # 20 NL-SQL pairs
│   ├── schemas/
│   │   ├── clickbench/              # 4 formats: ddl.sql, markdown.md, json_schema.json, natural_language.txt
│   │   ├── ontime/
│   │   ├── ssb/
│   │   ├── github_events/
│   │   └── custom_analytics/
│   └── examples/
│       ├── static_examples.json
│       ├── dynamic_pool.json
│       └── schema_matched.json
├── framework/
│   ├── prompt_builder.py            # Construct prompts from schema + config
│   ├── llm_caller.py                # Anthropic API wrapper (Sonnet + Haiku)
│   ├── sql_executor.py              # Execute SQL against ClickHouse
│   ├── result_comparator.py         # Compare predicted vs gold results
│   ├── schema_linker.py             # Extract table/column refs from SQL
│   ├── metrics.py                   # Compute EX, RC, SL, TE, L
│   └── experiment_runner.py         # Orchestrate all phases
├── analysis/
│   ├── statistical_tests.py         # McNemar's, bootstrap CI, effect sizes
│   ├── visualizations.py            # Generate figures
│   └── latex_tables.py              # LaTeX-formatted results
├── results/
│   ├── raw/                         # Raw API responses
│   └── processed/                   # Aggregated metrics
├── config/
│   ├── experiment_config.yaml
│   └── model_config.yaml
└── tests/
    ├── test_prompt_builder.py
    ├── test_result_comparator.py
    ├── test_schema_linker.py
    └── test_metrics.py
```

### 7.3 Prompt Construction Templates

#### Format A: CREATE TABLE (DDL)
```
You are a ClickHouse SQL expert. Given the following database schema, write a SQL query to answer the user's question. Return ONLY the SQL query, nothing else.

Database Schema:
CREATE TABLE hits (
    WatchID UInt64,
    JavaEnable UInt8,
    Title String,
    EventTime DateTime,
    ...
) ENGINE = MergeTree()
ORDER BY (CounterID, EventDate, intHash32(UserID));

Question: {natural_language_question}
SQL:
```

#### Format B: Markdown
```
You are a ClickHouse SQL expert. Given the following database schema, write a SQL query to answer the user's question. Return ONLY the SQL query, nothing else.

Database Schema:

### Table: hits

| Column | Type | Description |
|--------|------|-------------|
| WatchID | UInt64 | Unique identifier for each page view |
| JavaEnable | UInt8 | Whether Java is enabled (0/1) |
| Title | String | Page title |
| EventTime | DateTime | Timestamp of the event |

Engine: MergeTree(), ordered by (CounterID, EventDate)

Question: {natural_language_question}
SQL:
```

#### Format C: JSON Schema
```
You are a ClickHouse SQL expert. Given the following database schema, write a SQL query to answer the user's question. Return ONLY the SQL query, nothing else.

Database Schema:
{
  "database": "default",
  "tables": [{
    "name": "hits",
    "engine": "MergeTree",
    "order_by": ["CounterID", "EventDate"],
    "columns": [
      {"name": "WatchID", "type": "UInt64", "description": "Unique page view ID"},
      {"name": "JavaEnable", "type": "UInt8", "description": "Java enabled flag"}
    ]
  }]
}

Question: {natural_language_question}
SQL:
```

#### Format D: Natural Language
```
You are a ClickHouse SQL expert. Given the following database description, write a SQL query to answer the user's question. Return ONLY the SQL query, nothing else.

Database Description:
The database contains a table called "hits" which stores web analytics clickstream data. Each row represents a single page view event. The table has 105 columns including:
- WatchID: a unique identifier for each page view (unsigned 64-bit integer)
- JavaEnable: indicates whether Java is enabled in the user's browser (0 or 1)
- Title: the title of the page that was viewed
- EventTime: the exact date and time when the page view occurred
The table uses MergeTree engine and is ordered by counter ID and event date.

Question: {natural_language_question}
SQL:
```

### 7.4 Handling Non-Determinism in SQL

1. **Execution-based evaluation (primary):** Compare result sets, not SQL text
2. **Semantic equivalence:** `COUNT(*)` ≡ `count()`, join order doesn't matter, aliases ignored
3. **Multiple gold SQLs:** Provide 2-3 alternative gold queries where applicable
4. **Float tolerance:** Allow ±0.01 for aggregation results

### 7.5 LLM Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Temperature | 0.0 | Deterministic for reproducibility |
| Max tokens | 1024 | Sufficient for complex SQL |
| Top-p | 1.0 | No nucleus sampling at temp 0 |
| Stop sequences | ["\n\n"] | Stop after SQL statement |
| Retries | 3 (with backoff) | Handle API rate limits |
| Timeout | 60s per call | Prevent hangs |

### 7.6 Models to Evaluate

| Model | Model ID | Role | Rationale |
|-------|----------|------|-----------|
| **Claude 3.5 Sonnet** | `claude-3-5-sonnet-20241022` | Primary (frontier) | SOTA-level, strong SQL generation, 200K context |
| **Claude 3 Haiku** | `claude-3-haiku-20240307` | Secondary (efficient) | Fast, cheap — tests if findings generalize to smaller models |

**API Configuration:**
- Uses existing `ANTHROPIC_BASE_URL` and credentials from environment
- No additional API keys required
- Both models accessible through same Anthropic endpoint

**Paper Framing:**
> "We evaluate using Claude 3.5 Sonnet (frontier-class) and Claude 3 Haiku (efficiency-class) to test whether prompt engineering insights hold across model capability tiers. Our focus is on the prompt strategy dimensions (schema format, scope, metadata, examples) rather than cross-provider model comparison. Extension to other model families (GPT-4, Llama, fine-tuned SQL models) is straightforward and left as future work."

---

## 8. Statistical Analysis Plan

### 8.1 Per-Research-Question Analysis

**RQ1 (Schema Format):**
- Compare EX and RC across A1-A4
- Pairwise McNemar's test between all format pairs (6 pairs)
- Per-category breakdown (do formats differ for simple vs. complex queries?)
- Sonnet vs Haiku comparison: do the best formats differ by capability level?

**RQ2 (Schema Scope):**
- Compare across B1-B4
- Focus: Full Schema vs. Relevant Subset on large schemas (105-109 cols)
- Token efficiency alongside accuracy (trade-off analysis)

**RQ3 (Metadata Enrichment):**
- Compare C0-C4
- Ablation: C4 (all) vs. removing one component at a time
- Which metadata helps most for which query categories?

**RQ4 (Example Selection):**
- Compare D1-D4
- Interaction with query complexity
- Marginal benefit vs. token cost

### 8.2 Statistical Tests

| Test | When to Use |
|------|-------------|
| **McNemar's Test** | Pairwise comparison of two configs on same queries |
| **Cochran's Q Test** | Comparing 3+ configs simultaneously |
| **Holm-Bonferroni Correction** | Multiple pairwise comparisons |
| **Bootstrap Confidence Intervals** | 1000 bootstrap samples, 95% CI |
| **Cohen's h** | Effect size for binary outcomes |

### 8.3 Results Presentation

#### Table Format:
```
Table X: Execution Accuracy (%) by Schema Format

                Claude 3.5 Sonnet        Claude 3 Haiku
Format          EX     RC     SL         EX     RC     SL
──────────────────────────────────────────────────────────
CREATE TABLE    XX.X   XX.X   XX.X       XX.X   XX.X   XX.X
Markdown        XX.X   XX.X   XX.X       XX.X   XX.X   XX.X
JSON            XX.X   XX.X   XX.X       XX.X   XX.X   XX.X
Natural Lang    XX.X   XX.X   XX.X       XX.X   XX.X   XX.X
```

#### Figures (6 total):
1. **Bar chart:** Accuracy by schema format (Sonnet vs Haiku)
2. **Heatmap:** Format × Scope interaction effects
3. **Line plot:** Accuracy vs. Token Efficiency trade-off
4. **Radar chart:** Best configuration per query category
5. **Box plot:** Per-category accuracy distributions
6. **Bar chart:** Ablation — marginal contribution of each component

---

## 9. Implementation Roadmap

### Prerequisites (Human, ~15 minutes)

```bash
# Step 1: Install ClickHouse
brew install clickhouse
clickhouse server --daemon

# Step 2: Verify
clickhouse client --query "SELECT 1"
```

That's it. Everything else is automated by Claude Code.

### Phase A: Infrastructure (Automated by Claude Code)

**A1. ClickHouse Data Loading**
- Load ClickBench, OnTime, SSB, GitHub Events datasets
- Create custom analytics schema + generate synthetic data
- Validate all datasets

**A2. Evaluation Framework**
- Build all 7 Python modules (prompt_builder, llm_caller, sql_executor, result_comparator, schema_linker, metrics, experiment_runner)
- Write unit tests
- Create experiment configs

**A3. Schema Preparation**
- Generate all 4 schema representation formats × 5 datasets = 20 schema files
- Generate metadata variants (descriptions, sample values, statistics)
- Create per-query relevant schema subsets

### Phase B: Benchmark (Automated by Claude Code)

**B1.** Generate 150 NL-SQL pairs in JSON format
**B2.** Validate all gold SQL against ClickHouse
**B3.** Generate 40 few-shot example pool queries
**B4.** Compute embeddings for dynamic few-shot selection

**B5. Human Review (Required)**
- Spot-check 30-50 queries for correctness
- Co-author cross-validates all 150 pairs

### Phase C: Experiments (Automated by Claude Code)

| Phase | What | Calls | Can Run Overnight |
|-------|------|-------|-------------------|
| C1 | Baselines | 600 | ✅ |
| C2 | OFAT (all 4 dimensions) | 3,900 | ✅ |
| C3 | Interactions (Format×Scope, Metadata×Examples) | 7,800 | ✅ |
| C4 | Validation (top-3 configs × 3 runs) | 1,800 | ✅ |
| C5 | Ablations | 1,800 | ✅ |
| **Total** | | **15,900** | |

### Phase D: Analysis & Writing (Automated by Claude Code)

- Statistical analysis (McNemar's, bootstrap CI, Holm-Bonferroni)
- Generate all 6 figures + LaTeX tables
- Write Results (Section 5), Discussion (Section 6), Conclusion (Section 8)
- Expand Related Work (22+ references)
- Format in PVLDB LaTeX template

**Human Review:** Final proofread + submit

---

## 10. Risk Mitigation

### Technical Risks

| Risk | Mitigation |
|------|-----------|
| API rate limits | Exponential backoff, spread across overnight runs |
| ClickHouse setup issues | ClickHouse Cloud free tier as fallback |
| Gold SQL bugs | Automated execution check + human spot-check |
| Non-SQL model output | Robust SQL extraction, retry logic |
| Result comparison edge cases | Float tolerance, NULL handling, order-independent sets |

### Research Risks

| Risk | Mitigation |
|------|-----------|
| All formats perform similarly | Valid finding — report with CIs, emphasize token efficiency differences |
| Only 2 models tested | Frame as "capability-tier" analysis, note future work for cross-provider |
| 150 queries may be small | Emphasize ClickHouse specificity; per-category CIs will be honestly wide |
| Reviewer wants more models | Address in limitations; note that DAIL-SQL focused primarily on GPT-4 |

### Venue Risks

| Risk | Mitigation |
|------|-----------|
| Industrial Track deadline passed | Research Track (rolling) or CIDR 2027 |
| Reviewer wants production deployment | Add DataPup deployment story |
| Reviewer wants more models | Add as future work; focus on schema strategy contribution |

---

## 11. References

### Core Text-to-SQL
1. Gao et al. (2024). Text-to-SQL Empowered by LLMs: A Benchmark Evaluation. PVLDB 17(5).
2. Pourreza & Rafiei (2023). DIN-SQL. NeurIPS 2023.
3. Dong et al. (2023). C3. arXiv:2307.07306.
4. Talaei et al. (2024). CHESS. arXiv:2405.16755.
5. Wang et al. (2024). MAC-SQL. arXiv:2312.11242.
6. Li et al. (2024). CodeS. SIGMOD 2024.
7. Li et al. (2023). RESDSQL. AAAI 2023.

### Benchmarks
8. Yu et al. (2018). Spider. EMNLP 2018.
9. Li et al. (2023). BIRD. NeurIPS 2023.
10. Lei et al. (2024). Spider 2.0. arXiv:2411.07763.
11. Zhong et al. (2017). WikiSQL. arXiv:1709.00103.
12. Yu et al. (2019). SParC. ACL 2019.
13. Yu et al. (2019). CoSQL. EMNLP 2019.
14. Chang et al. (2023). Dr.Spider. ICLR 2023.
15. Lee et al. (2021). KaggleDBQA. ACL 2021.
16. Hazoom et al. (2021). SEDE. NAACL 2021.

### Schema Linking & Prompt Engineering
17. Wang et al. (2020). RAT-SQL. ACL 2020.
18. Lin et al. (2020). BRIDGE. EMNLP 2020.
19. Tai et al. (2023). CoT for SQL. EMNLP 2023.
20. Chen et al. (2023). Self-Debug. arXiv:2304.05128.
21. Wang et al. (2023). Self-Consistency. ICLR 2023.

### Tools & Systems
22. Defog.ai (2023-2024). SQLCoder.
23. Vanna.ai — Open-source RAG for Text-to-SQL.

---

## Appendix A: ClickHouse Functions to Test

| Function | Use Case | Example |
|----------|----------|---------|
| `argMax(col, val)` | Value at max of another column | `SELECT argMax(name, revenue) FROM sales` |
| `argMin(col, val)` | Value at min of another column | `SELECT argMin(product, price) FROM catalog` |
| `groupArray(col)` | Aggregate into array | `SELECT groupArray(name) FROM users GROUP BY dept` |
| `toStartOfMonth(dt)` | Truncate to month | `SELECT toStartOfMonth(created_at) as month` |
| `toStartOfWeek(dt)` | Truncate to week | `WHERE toStartOfWeek(event_time) = ...` |
| `dateDiff('day', d1, d2)` | Date difference | `SELECT dateDiff('day', created, shipped)` |
| `quantile(0.95)(col)` | Percentiles | `SELECT quantile(0.95)(response_time)` |
| `arrayJoin(arr)` | Expand array to rows | `SELECT arrayJoin(tags) as tag FROM products` |
| `countIf(cond)` | Conditional count | `SELECT countIf(status = 'completed')` |
| `sumIf(col, cond)` | Conditional sum | `SELECT sumIf(amount, status = 'paid')` |
| `uniqExact(col)` | Exact unique count | `SELECT uniqExact(user_id) FROM events` |
| `multiIf(...)` | Multi-branch conditional | `SELECT multiIf(x>10,'high',x>5,'med','low')` |
| `arrayFilter(...)` | Filter array elements | `SELECT arrayFilter(x -> x > 0, arr)` |
| `toYYYYMM(dt)` | Date to YYYYMM | `GROUP BY toYYYYMM(event_time)` |

## Appendix B: Query Example Format

```json
{
  "id": "TS-001",
  "dataset": "ontime",
  "category": "Time-Series",
  "difficulty": "medium",
  "natural_language": "What was the average departure delay by month for the year 2020?",
  "sql": "SELECT toStartOfMonth(FlightDate) AS month, avg(DepDelay) AS avg_delay FROM ontime WHERE toYear(FlightDate) = 2020 GROUP BY month ORDER BY month",
  "alternative_sql": [
    "SELECT toYYYYMM(FlightDate) AS month, avg(DepDelay) AS avg_delay FROM ontime WHERE FlightDate >= '2020-01-01' AND FlightDate < '2021-01-01' GROUP BY month ORDER BY month"
  ],
  "challenge": "Date truncation, year filtering, aggregation over time",
  "tables_used": ["ontime"],
  "columns_used": ["FlightDate", "DepDelay"],
  "clickhouse_features": ["toStartOfMonth", "toYear", "avg"],
  "expected_result_rows": 12,
  "schema_linking_difficulty": "easy"
}
```

## Appendix C: Cost Summary

| Component | Cost |
|-----------|------|
| Claude 3.5 Sonnet (~8,000 calls) | $0 (existing env) |
| Claude 3 Haiku (~8,000 calls) | $0 (existing env) |
| ClickHouse (local brew install) | $0 |
| Python packages | $0 |
| **Total** | **$0** |

---

*Document generated: February 2026 (v2)*
*Revised: Claude-only model strategy*
*For: Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases*
*VLDB 2026 Submission*
