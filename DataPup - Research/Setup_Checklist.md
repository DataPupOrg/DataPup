# Setup Checklist & Automation Guide (Revised v2)
# Claude-Only, Zero-Cost Configuration

## ENVIRONMENT STATUS

| Component | Status | Action Required |
|-----------|--------|-----------------|
| Python 3.12 | ✅ Installed | None |
| Node.js v24 | ✅ Installed | None |
| Homebrew | ✅ Installed | None |
| 48 GB RAM | ✅ Sufficient | None |
| 190 GB Free Disk | ✅ Sufficient | None |
| Internet Access | ✅ Available | None |
| Anthropic API | ✅ Already Available | Uses existing `ANTHROPIC_BASE_URL` env vars |
| ClickHouse Server | ❌ Not Installed | `brew install clickhouse` |
| Python venv | ❌ Not Created | Claude Code will create it |
| Python packages | ❌ Minimal install | Claude Code will install them |
| Evaluation Framework | ❌ Does Not Exist | Claude Code will build it |
| Benchmark Dataset | ❌ Does Not Exist | Claude Code will create it |

---

## HUMAN SETUP (One-Time, ~5 minutes)

Just ONE step:

```bash
# Install and start ClickHouse
brew install clickhouse
clickhouse server --daemon
clickhouse client --query "SELECT 1"  # Verify
```

**That's it.** Everything else is automated.

---

## API & COST SUMMARY

| Item | Status | Cost |
|------|--------|------|
| Claude 3.5 Sonnet | ✅ Existing env credentials | $0 |
| Claude 3 Haiku | ✅ Same Anthropic endpoint | $0 |
| ClickHouse | Local install via brew | $0 |
| Python packages | pip install | $0 |
| OpenAI / OpenRouter / Together | ~~Not needed~~ | — |
| **Total** | | **$0** |

**New API keys needed: 0**
**New spending needed: $0**

---

## WHAT CLAUDE CODE DOES AUTONOMOUSLY

### Before ClickHouse (can start immediately):
1. Create Python venv + install all packages
2. Build entire `evaluation/` framework (7 modules + tests)
3. Generate 150 NL-SQL benchmark queries (JSON)
4. Generate 40 few-shot example pool queries
5. Create all 4 schema formats × 5 datasets (20 schema files)
6. Write column descriptions for 400+ columns
7. Write custom analytics schema DDL
8. Write synthetic data generator
9. Write statistical analysis scripts
10. Write visualization scripts
11. Write LaTeX table generators
12. Write expanded Related Work (22+ refs)

### After ClickHouse is running:
13. Load all 5 datasets
14. Generate synthetic data for custom schema
15. Validate all 150 gold SQL queries
16. Extract sample values + compute statistics
17. Compute embeddings for dynamic few-shot
18. Run Phase 1: Baselines (600 calls)
19. Run Phase 2: OFAT (3,900 calls)
20. Run Phase 3: Interactions (7,800 calls)
21. Run Phase 4: Validation (1,800 calls)
22. Run Phase 5: Ablations (1,800 calls)
23. Statistical analysis (McNemar's, bootstrap CI, etc.)
24. Generate all 6 publication figures
25. Generate all LaTeX tables
26. Write Results section
27. Write Discussion section
28. Write Conclusion section
29. Format paper in PVLDB template

### Total API calls: ~15,900 (all via existing Anthropic env)

---

## WHAT HUMANS MUST DO

| Task | Who | When | Effort |
|------|-----|------|--------|
| Install ClickHouse | Either author | Before data loading | 5 min |
| Spot-check 30-50 NL-SQL pairs | Either author | After benchmark generation | 2-3 hrs |
| Cross-validate all 150 pairs | Co-author (Sahith) | After benchmark generation | 4-6 hrs |
| Final proofread of paper | Both authors | After paper draft | 2-3 hrs |
| Submit to VLDB | Either author | At deadline | 15 min |
| **Total human effort** | | | **~9-12 hrs** |

---

## EXECUTION SEQUENCE

```
HUMAN: brew install clickhouse && clickhouse server --daemon    [5 min]
  │
  ▼
CLAUDE CODE: Build framework + benchmark (items 1-12 above)
  │
  ▼
CLAUDE CODE: Load datasets + validate queries (items 13-17)
  │
  ▼
HUMAN: Spot-check + cross-validate queries                     [6 hrs]
  │
  ▼
CLAUDE CODE: Fix any issues found
  │
  ▼
CLAUDE CODE: Run all experiments (items 18-22, ~15,900 calls)
  │
  ▼
CLAUDE CODE: Analysis + paper writing (items 23-29)
  │
  ▼
HUMAN: Final review + proofread + submit                       [3 hrs]
```
