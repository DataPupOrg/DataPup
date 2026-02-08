"""
self_consistency.py -- Self-Consistency Voting for Text-to-SQL

Implements the self-consistency prompting strategy: generate N SQL candidates
at temperature > 0, execute each against ClickHouse, group by result-set
equivalence, and return the SQL whose result received the most votes
(plurality / majority voting).

This technique improves reliability by marginalising over multiple reasoning
paths -- even if some candidates produce incorrect SQL, the correct result
tends to dominate when enough samples are drawn.

Reference:
    Wang et al., "Self-Consistency Improves Chain of Thought Reasoning in
    Language Models", ICLR 2023.

Part of the evaluation framework for:
    "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases"
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from evaluation.framework.llm_caller import LLMCaller, LLMResponse
from evaluation.framework.sql_executor import SQLExecutor, ExecutionResult
from evaluation.framework.result_comparator import ResultComparator

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class VotingResult:
    """Structured result from self-consistency voting over N SQL candidates."""

    best_sql: str
    """The SQL query from the majority-vote winning group."""

    best_results: List[Tuple]
    """The result rows produced by the best SQL."""

    n_candidates: int
    """Total number of SQL candidates that were generated."""

    n_executed: int
    """Number of candidates that executed successfully against ClickHouse."""

    n_distinct_results: int
    """Number of distinct result sets observed among executed candidates."""

    vote_count: int
    """Number of candidates that agreed on the winning result set."""

    total_tokens: int
    """Total tokens (input + output) consumed across all LLM calls."""

    total_latency_ms: int
    """Total wall-clock latency in milliseconds across all LLM calls."""

    all_sqls: List[str]
    """All generated SQL queries (including those that failed execution)."""

    confidence: float
    """Fraction of successfully-executed candidates that agreed on the winner
    (vote_count / n_executed).  Ranges from 0.0 to 1.0."""


# ---------------------------------------------------------------------------
# Self-Consistency Voter
# ---------------------------------------------------------------------------

class SelfConsistencyVoter:
    """Generate multiple SQL candidates and pick the one whose execution
    result receives the most votes.

    The voter wraps an :class:`LLMCaller` (used with temperature > 0 to
    produce diverse candidates), an :class:`SQLExecutor` (to run each
    candidate), and a :class:`ResultComparator` (available for downstream
    comparison with gold results if needed).

    Usage::

        from evaluation.framework.llm_caller import LLMCaller
        from evaluation.framework.sql_executor import SQLExecutor
        from evaluation.framework.result_comparator import ResultComparator

        caller = LLMCaller(model="claude-3-5-sonnet-20241022", temperature=0.5)
        executor = SQLExecutor()
        comparator = ResultComparator()

        voter = SelfConsistencyVoter(caller, executor, comparator, n_candidates=5)
        result = voter.generate_and_vote(prompt="Write a SQL query to ...")
        print(result.best_sql)
        print(f"Confidence: {result.confidence:.0%}")
    """

    def __init__(
        self,
        llm_caller: LLMCaller,
        executor: SQLExecutor,
        comparator: ResultComparator,
        n_candidates: int = 5,
        temperature: float = 0.5,
    ) -> None:
        """
        Args:
            llm_caller:   An :class:`LLMCaller` instance.  Its temperature
                          will be overridden by *temperature* to ensure
                          diverse candidate generation.
            executor:     An :class:`SQLExecutor` connected to ClickHouse.
            comparator:   A :class:`ResultComparator` (kept for convenience;
                          not used internally by the voter itself).
            n_candidates: Number of SQL candidates to generate (default 5).
            temperature:  Sampling temperature for candidate generation.
                          Must be > 0 to produce diverse outputs.
        """
        if n_candidates < 1:
            raise ValueError(f"n_candidates must be >= 1, got {n_candidates}")
        if temperature <= 0:
            raise ValueError(
                f"temperature must be > 0 for self-consistency voting, "
                f"got {temperature}"
            )

        self.llm_caller = llm_caller
        self.executor = executor
        self.comparator = comparator
        self.n_candidates = n_candidates
        self.temperature = temperature

        # Override the caller's temperature so candidates are diverse.
        self.llm_caller.temperature = self.temperature

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate_and_vote(
        self,
        prompt: str,
        system: Optional[str] = None,
        gold_sql: Optional[str] = None,
    ) -> VotingResult:
        """Generate N SQL candidates, execute them, and vote on results.

        Args:
            prompt:   The user prompt to send to the LLM (should ask for a
                      SQL query).
            system:   Optional system message to include with every LLM call.
            gold_sql: Optional gold-standard SQL (not used in voting, but
                      stored for downstream analysis).

        Returns:
            A :class:`VotingResult` summarising the voting outcome.
        """
        # ----- Step (a): Generate N SQL candidates -------------------------
        all_sqls: List[str] = []
        llm_responses: List[LLMResponse] = []

        total_tokens = 0
        total_latency_ms = 0

        for i in range(self.n_candidates):
            logger.info(
                "Generating candidate %d/%d ...", i + 1, self.n_candidates,
            )
            response = self.llm_caller.call(prompt=prompt, system=system)
            llm_responses.append(response)

            total_tokens += response.input_tokens + response.output_tokens
            total_latency_ms += int(response.latency_ms)

            if response.success and response.sql:
                all_sqls.append(response.sql)
            else:
                # Record empty string for failed generations so indexing
                # stays aligned with the candidate number.
                all_sqls.append("")
                logger.warning(
                    "Candidate %d failed or produced no SQL: %s",
                    i + 1, response.error or "(empty SQL)",
                )

        # ----- Step (b) & (c): Execute each SQL ---------------------------
        # Map: candidate index -> ExecutionResult (only for non-empty SQL)
        exec_results: Dict[int, ExecutionResult] = {}
        for idx, sql in enumerate(all_sqls):
            if not sql:
                continue
            logger.info("Executing candidate %d SQL ...", idx + 1)
            exec_result = self.executor.execute(sql)
            if exec_result.success:
                exec_results[idx] = exec_result
            else:
                logger.warning(
                    "Candidate %d execution failed: %s",
                    idx + 1, exec_result.error,
                )

        n_executed = len(exec_results)

        # Handle edge case: no candidates executed successfully.
        if n_executed == 0:
            logger.warning(
                "No candidates executed successfully out of %d generated.",
                len(all_sqls),
            )
            return VotingResult(
                best_sql="",
                best_results=[],
                n_candidates=self.n_candidates,
                n_executed=0,
                n_distinct_results=0,
                vote_count=0,
                total_tokens=total_tokens,
                total_latency_ms=total_latency_ms,
                all_sqls=all_sqls,
                confidence=0.0,
            )

        # ----- Step (d): Group by result-set hash --------------------------
        # hash -> list of candidate indices that produced that result
        hash_to_indices: Dict[str, List[int]] = {}
        hash_to_results: Dict[str, List[Tuple]] = {}

        for idx, exec_result in exec_results.items():
            result_hash = self._hash_result_set(exec_result.results)
            if result_hash not in hash_to_indices:
                hash_to_indices[result_hash] = []
                hash_to_results[result_hash] = exec_result.results
            hash_to_indices[result_hash].append(idx)

        n_distinct_results = len(hash_to_indices)

        # ----- Step (e): Pick the result set with the most votes -----------
        # On ties, prefer the group whose earliest candidate has the lowest
        # index (i.e. generated first).
        best_hash = max(
            hash_to_indices,
            key=lambda h: (len(hash_to_indices[h]), -min(hash_to_indices[h])),
        )

        winning_indices = hash_to_indices[best_hash]
        vote_count = len(winning_indices)

        # ----- Step (f): Return the SQL from the winning group -------------
        # Use the first candidate (lowest index) in the winning group.
        best_idx = min(winning_indices)
        best_sql = all_sqls[best_idx]
        best_results = hash_to_results[best_hash]

        confidence = vote_count / n_executed if n_executed > 0 else 0.0

        logger.info(
            "Voting complete: %d/%d candidates agree (confidence=%.2f), "
            "%d distinct result sets from %d executed.",
            vote_count, n_executed, confidence,
            n_distinct_results, n_executed,
        )

        return VotingResult(
            best_sql=best_sql,
            best_results=best_results,
            n_candidates=self.n_candidates,
            n_executed=n_executed,
            n_distinct_results=n_distinct_results,
            vote_count=vote_count,
            total_tokens=total_tokens,
            total_latency_ms=total_latency_ms,
            all_sqls=all_sqls,
            confidence=confidence,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _hash_result_set(results: List[Tuple]) -> str:
        """Produce a deterministic hash for a result set.

        Approach:
            1. Convert each cell to ``str(value)``.
            2. Represent each row as a tuple of stringified cells.
            3. Sort the rows lexicographically (so row order does not matter).
            4. SHA-256 hash the sorted representation.

        This is intentionally simple and works well for the moderate result
        sizes typical of text-to-SQL benchmarks.

        Args:
            results: List of row tuples from ClickHouse execution.

        Returns:
            Hex-encoded SHA-256 digest string.
        """
        if not results:
            return hashlib.sha256(b"__empty__").hexdigest()

        # Convert each row to a tuple of stringified cell values.
        stringified_rows = [
            tuple(str(cell) for cell in row)
            for row in results
        ]

        # Sort for order-independence.
        stringified_rows.sort()

        # Build a canonical byte representation and hash it.
        canonical = repr(stringified_rows).encode("utf-8")
        return hashlib.sha256(canonical).hexdigest()
