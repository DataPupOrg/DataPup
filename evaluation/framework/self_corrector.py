"""
self_corrector.py -- Self-Correction Loop for Text-to-SQL Evaluation

When the LLM generates SQL that fails to execute, this module feeds the
error message back to the LLM and asks it to fix the SQL.  This can recover
from syntax errors, wrong table names, wrong function usage, etc.

The loop runs up to `max_retries` correction attempts.  Each attempt:
  1. Builds a correction prompt containing the failing SQL and the error.
  2. Calls the LLM with the correction prompt (same system message).
  3. Extracts SQL from the response.
  4. Executes the corrected SQL to check if it works.
  5. If it still fails, repeats with the new error.

Part of the evaluation framework for:
    "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases"
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from evaluation.framework.llm_caller import LLMCaller
from evaluation.framework.sql_executor import SQLExecutor

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class CorrectionResult:
    """Structured result from a self-correction attempt."""

    final_sql: str               # The final SQL (original or corrected)
    corrected: bool              # Whether correction was applied
    attempts: int                # Number of correction attempts made
    total_input_tokens: int      # Cumulative input tokens across retries
    total_output_tokens: int     # Cumulative output tokens across retries
    total_latency_ms: float      # Cumulative latency across retries
    errors: list[str] = field(default_factory=list)  # Error messages from each attempt


# ---------------------------------------------------------------------------
# SelfCorrector
# ---------------------------------------------------------------------------

class SelfCorrector:
    """
    Self-correction loop for text-to-SQL generation.

    When predicted SQL fails to execute against ClickHouse, this class
    feeds the error message back to the LLM and asks it to produce a
    corrected query.  The loop retries up to ``max_retries`` times.

    Usage::

        corrector = SelfCorrector(llm_caller, sql_executor, max_retries=2)
        result = corrector.correct(
            predicted_sql=bad_sql,
            error_message="Unknown table 'foo'",
            system_message=system_msg,
            original_prompt=user_prompt,
        )
        if result.corrected:
            print("Fixed SQL:", result.final_sql)
    """

    def __init__(
        self,
        llm_caller: LLMCaller,
        sql_executor: SQLExecutor,
        max_retries: int = 2,
    ) -> None:
        """
        Args:
            llm_caller:   The LLM caller instance used for generating corrections.
            sql_executor: The SQL executor instance used for validating corrections.
            max_retries:  Maximum number of correction attempts (default 2).
        """
        self.llm_caller = llm_caller
        self.sql_executor = sql_executor
        self.max_retries = max_retries

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def correct(
        self,
        predicted_sql: str,
        error_message: str,
        system_message: Optional[str],
        original_prompt: str,
    ) -> CorrectionResult:
        """
        Attempt to fix SQL that failed to execute.

        Builds a correction prompt containing the failing SQL and error,
        calls the LLM, extracts the corrected SQL, and executes it.
        Repeats up to ``max_retries`` times if the corrected SQL also fails.

        Args:
            predicted_sql:  The SQL query that produced an error.
            error_message:  The error message from the SQL executor.
            system_message: The system message used in the original LLM call.
            original_prompt: The original user prompt (for context).

        Returns:
            CorrectionResult with the final SQL and cumulative cost metrics.
        """
        current_sql = predicted_sql
        current_error = error_message
        total_input_tokens = 0
        total_output_tokens = 0
        total_latency_ms = 0.0
        errors: list[str] = [error_message]

        for attempt in range(1, self.max_retries + 1):
            logger.info(
                "Self-correction attempt %d/%d for SQL error: %s",
                attempt,
                self.max_retries,
                current_error[:120],
            )

            # Build correction prompt
            correction_prompt = self._build_correction_prompt(
                current_sql, current_error,
            )

            # Call LLM
            llm_response = self.llm_caller.call(
                prompt=correction_prompt,
                system=system_message,
            )

            total_input_tokens += llm_response.input_tokens
            total_output_tokens += llm_response.output_tokens
            total_latency_ms += llm_response.latency_ms

            if not llm_response.success:
                logger.warning(
                    "Self-correction LLM call failed on attempt %d: %s",
                    attempt,
                    llm_response.error,
                )
                errors.append(f"LLM call failed: {llm_response.error}")
                # Cannot proceed -- return what we have
                return CorrectionResult(
                    final_sql=current_sql,
                    corrected=False,
                    attempts=attempt,
                    total_input_tokens=total_input_tokens,
                    total_output_tokens=total_output_tokens,
                    total_latency_ms=total_latency_ms,
                    errors=errors,
                )

            corrected_sql = llm_response.sql
            if not corrected_sql or not corrected_sql.strip():
                logger.warning(
                    "Self-correction returned empty SQL on attempt %d.",
                    attempt,
                )
                errors.append("Correction returned empty SQL")
                continue

            # Execute corrected SQL
            exec_result = self.sql_executor.execute(corrected_sql)

            if exec_result.success:
                logger.info(
                    "Self-correction succeeded on attempt %d (rows=%d).",
                    attempt,
                    exec_result.row_count,
                )
                return CorrectionResult(
                    final_sql=corrected_sql,
                    corrected=True,
                    attempts=attempt,
                    total_input_tokens=total_input_tokens,
                    total_output_tokens=total_output_tokens,
                    total_latency_ms=total_latency_ms,
                    errors=errors,
                )

            # Still failing -- prepare for next attempt
            current_sql = corrected_sql
            current_error = exec_result.error
            errors.append(current_error)
            logger.info(
                "Self-correction attempt %d still failing: %s",
                attempt,
                current_error[:120],
            )

        # All retries exhausted
        logger.warning(
            "Self-correction exhausted %d attempts. Returning last SQL.",
            self.max_retries,
        )
        return CorrectionResult(
            final_sql=current_sql,
            corrected=False,
            attempts=self.max_retries,
            total_input_tokens=total_input_tokens,
            total_output_tokens=total_output_tokens,
            total_latency_ms=total_latency_ms,
            errors=errors,
        )

    def correct_with_result_check(
        self,
        predicted_sql: str,
        pred_result,
        gold_result,
        system_message: Optional[str],
        original_prompt: str,
    ) -> CorrectionResult:
        """
        Attempt to fix SQL that executed but returned mismatched results.

        This is intended for cases where the SQL runs successfully but the
        results are obviously wrong -- for example, empty results when the
        gold query returns rows, or a very different row count.

        Only triggers correction when there is an obvious discrepancy:
          - Predicted result is empty but gold is not.
          - Row counts differ by more than a factor of 5.

        Args:
            predicted_sql: The SQL that executed but returned wrong results.
            pred_result:   ExecutionResult from the predicted SQL.
            gold_result:   ExecutionResult from the gold SQL.
            system_message: The system message used in the original LLM call.
            original_prompt: The original user prompt (for context).

        Returns:
            CorrectionResult with the final SQL and cumulative cost metrics.
        """
        pred_rows = pred_result.row_count
        gold_rows = gold_result.row_count

        # Determine whether correction should be attempted
        should_correct = False
        reason = ""

        if pred_rows == 0 and gold_rows > 0:
            should_correct = True
            reason = (
                f"The SQL query executed successfully but returned 0 rows "
                f"when approximately {gold_rows} rows were expected."
            )
        elif gold_rows > 0 and pred_rows > 0:
            ratio = max(pred_rows, gold_rows) / min(pred_rows, gold_rows)
            if ratio > 5:
                should_correct = True
                reason = (
                    f"The SQL query executed but returned {pred_rows} rows "
                    f"when approximately {gold_rows} were expected. "
                    f"Please review and fix."
                )

        if not should_correct:
            # No obvious problem -- return without correction
            return CorrectionResult(
                final_sql=predicted_sql,
                corrected=False,
                attempts=0,
                total_input_tokens=0,
                total_output_tokens=0,
                total_latency_ms=0.0,
                errors=[],
            )

        logger.info(
            "Result-check correction triggered: %s",
            reason[:120],
        )

        # Build a result-check correction prompt and use the standard
        # correction loop with a synthetic error message.
        return self.correct(
            predicted_sql=predicted_sql,
            error_message=reason,
            system_message=system_message,
            original_prompt=original_prompt,
        )

    def refine_with_result_check(
        self,
        original_sql: str,
        original_results: List[Tuple],
        original_columns: List[str],
        question: str,
        schema_context: str = "",
        max_attempts: int = 1,
    ) -> CorrectionResult:
        """
        Aggressive execution-guided refinement that reviews query results.

        Unlike ``correct`` (which fixes execution errors) and
        ``correct_with_result_check`` (which compares against gold results),
        this method asks the LLM to review the SQL **and its actual output**
        against the original natural-language question to decide whether the
        query is semantically correct.

        The LLM is shown the question, the generated SQL, column names, the
        first rows of the result set, and the total row count.  It then
        evaluates whether the output correctly answers the question by
        checking column selection, aggregation, filtering, JOINs, ordering,
        and limits.

        If the LLM determines the query is correct it responds with
        ``CORRECT`` and the original SQL is returned unchanged.  Otherwise
        the corrected SQL is extracted, executed, and the correction result
        is returned.

        Args:
            original_sql:     The SQL query that executed successfully.
            original_results: The result rows returned by the query.
            original_columns: The column names from the result set.
            question:         The original natural-language question.
            schema_context:   Optional schema information for the LLM.
            max_attempts:     Maximum refinement attempts (default 1).

        Returns:
            CorrectionResult with the final SQL and cumulative cost metrics.
        """
        total_input_tokens = 0
        total_output_tokens = 0
        total_latency_ms = 0.0
        errors: list[str] = []

        current_sql = original_sql

        for attempt in range(1, max_attempts + 1):
            logger.info(
                "Result-refinement attempt %d/%d for question: %s",
                attempt,
                max_attempts,
                question[:120],
            )

            # Format the results as a readable table
            results_table = self._format_results_table(
                original_columns, original_results, max_rows=10,
            )
            row_count = len(original_results)

            # Build the refinement prompt
            refinement_prompt = self._build_refinement_prompt(
                sql=current_sql,
                question=question,
                columns=original_columns,
                results_table=results_table,
                row_count=row_count,
                schema_context=schema_context,
            )

            # Call the LLM
            llm_response = self.llm_caller.call(
                prompt=refinement_prompt,
                system=None,
            )

            total_input_tokens += llm_response.input_tokens
            total_output_tokens += llm_response.output_tokens
            total_latency_ms += llm_response.latency_ms

            if not llm_response.success:
                logger.warning(
                    "Result-refinement LLM call failed on attempt %d: %s",
                    attempt,
                    llm_response.error,
                )
                errors.append(f"LLM call failed: {llm_response.error}")
                return CorrectionResult(
                    final_sql=current_sql,
                    corrected=False,
                    attempts=attempt,
                    total_input_tokens=total_input_tokens,
                    total_output_tokens=total_output_tokens,
                    total_latency_ms=total_latency_ms,
                    errors=errors,
                )

            raw_response = llm_response.raw_response.strip()

            # Check if the LLM says the query is correct
            if self._response_indicates_correct(raw_response):
                logger.info(
                    "Result-refinement: LLM confirmed query is correct "
                    "on attempt %d.",
                    attempt,
                )
                return CorrectionResult(
                    final_sql=current_sql,
                    corrected=False,
                    attempts=attempt,
                    total_input_tokens=total_input_tokens,
                    total_output_tokens=total_output_tokens,
                    total_latency_ms=total_latency_ms,
                    errors=errors,
                )

            # LLM provided a corrected query -- extract it
            corrected_sql = llm_response.sql
            if not corrected_sql or not corrected_sql.strip():
                logger.warning(
                    "Result-refinement returned empty SQL on attempt %d.",
                    attempt,
                )
                errors.append("Refinement returned empty SQL")
                continue

            # Execute corrected SQL to validate it
            exec_result = self.sql_executor.execute(corrected_sql)

            if exec_result.success:
                logger.info(
                    "Result-refinement succeeded on attempt %d "
                    "(rows=%d).",
                    attempt,
                    exec_result.row_count,
                )
                return CorrectionResult(
                    final_sql=corrected_sql,
                    corrected=True,
                    attempts=attempt,
                    total_input_tokens=total_input_tokens,
                    total_output_tokens=total_output_tokens,
                    total_latency_ms=total_latency_ms,
                    errors=errors,
                )

            # Corrected SQL failed to execute -- log and try again
            current_sql = corrected_sql
            errors.append(
                f"Refined SQL failed to execute: {exec_result.error}"
            )
            logger.info(
                "Result-refinement attempt %d produced SQL that "
                "failed to execute: %s",
                attempt,
                exec_result.error[:120],
            )

        # All attempts exhausted
        logger.warning(
            "Result-refinement exhausted %d attempts. "
            "Returning last SQL.",
            max_attempts,
        )
        return CorrectionResult(
            final_sql=current_sql,
            corrected=False,
            attempts=max_attempts,
            total_input_tokens=total_input_tokens,
            total_output_tokens=total_output_tokens,
            total_latency_ms=total_latency_ms,
            errors=errors,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_correction_prompt(sql: str, error_message: str) -> str:
        """
        Build the correction prompt sent to the LLM.

        Args:
            sql:           The SQL query that produced the error.
            error_message: The error message from execution.

        Returns:
            A formatted correction prompt string.
        """
        return (
            "The following SQL query produced an error when executed "
            "against ClickHouse:\n"
            "\n"
            "SQL:\n"
            f"{sql}\n"
            "\n"
            "Error:\n"
            f"{error_message}\n"
            "\n"
            "Please fix the SQL query to resolve this error. "
            "Return ONLY the corrected SQL query without any explanation."
        )

    @staticmethod
    def _format_results_table(
        columns: List[str],
        rows: List[Tuple],
        max_rows: int = 10,
    ) -> str:
        """
        Format query results as a human-readable text table.

        Produces a pipe-delimited table with a header row, a separator
        row, and up to ``max_rows`` data rows.  Each column is padded
        to fit its widest value.

        Args:
            columns:  Column names from the result set.
            rows:     Data rows (list of tuples).
            max_rows: Maximum number of data rows to include (default 10).

        Returns:
            A formatted string representing the results as a table.
        """
        if not columns:
            return "(no columns)"
        if not rows:
            return "(no rows)"

        display_rows = rows[:max_rows]

        # Convert all values to strings
        str_rows = [
            [str(v) if v is not None else "NULL" for v in row]
            for row in display_rows
        ]

        # Calculate column widths
        col_widths = [len(c) for c in columns]
        for row in str_rows:
            for i, val in enumerate(row):
                if i < len(col_widths):
                    col_widths[i] = max(col_widths[i], len(val))

        # Build header
        header = " | ".join(
            col.ljust(col_widths[i]) for i, col in enumerate(columns)
        )
        separator = "-+-".join("-" * w for w in col_widths)

        # Build data rows
        data_lines = []
        for row in str_rows:
            line = " | ".join(
                val.ljust(col_widths[i]) if i < len(col_widths) else val
                for i, val in enumerate(row)
            )
            data_lines.append(line)

        parts = [header, separator] + data_lines

        if len(rows) > max_rows:
            parts.append(f"... ({len(rows) - max_rows} more rows)")

        return "\n".join(parts)

    @staticmethod
    def _build_refinement_prompt(
        sql: str,
        question: str,
        columns: List[str],
        results_table: str,
        row_count: int,
        schema_context: str = "",
    ) -> str:
        """
        Build the refinement prompt that asks the LLM to review SQL
        results against the original question.

        Args:
            sql:            The SQL query to review.
            question:       The original natural-language question.
            columns:        Column names from the result set.
            results_table:  Pre-formatted text table of results.
            row_count:      Total number of rows returned.
            schema_context: Optional schema information.

        Returns:
            A formatted refinement prompt string.
        """
        schema_section = ""
        if schema_context:
            schema_section = (
                f"\nDatabase Schema:\n{schema_context}\n"
            )

        return (
            "Review this SQL query and its results. Does the output "
            "correctly answer the question? Check for:\n"
            "  - Correct column selection (are all asked-for columns "
            "present?)\n"
            "  - Correct aggregation (GROUP BY, SUM, COUNT, AVG, etc.)\n"
            "  - Correct filtering (WHERE conditions)\n"
            "  - Correct JOINs\n"
            "  - Correct ORDER BY and LIMIT\n"
            "\n"
            "If the query needs correction, provide the corrected SQL. "
            "If it is correct, respond with CORRECT.\n"
            "\n"
            f"Question: {question}\n"
            f"{schema_section}\n"
            f"Generated SQL:\n{sql}\n"
            "\n"
            f"Columns: {', '.join(columns)}\n"
            f"Total rows returned: {row_count}\n"
            "\n"
            f"Results (first rows):\n{results_table}\n"
        )

    @staticmethod
    def _response_indicates_correct(raw_response: str) -> bool:
        """
        Determine whether the LLM response indicates the query is correct.

        Checks for the word ``CORRECT`` appearing as a standalone token
        in the response, while ensuring the response does not also
        contain a SQL query (which would indicate a correction).

        Args:
            raw_response: The raw text response from the LLM.

        Returns:
            True if the LLM indicates the query is already correct.
        """
        upper = raw_response.upper().strip()

        # If the entire response is just "CORRECT" (possibly with
        # punctuation), it is clearly affirmative.
        if re.match(r"^CORRECT[.!]?$", upper):
            return True

        # If "CORRECT" appears but there is also a SQL block, the LLM
        # is providing a correction, not confirming correctness.
        has_correct = bool(re.search(r"\bCORRECT\b", upper))
        has_sql = bool(
            re.search(r"```", raw_response)
            or re.search(r"\bSELECT\b", upper)
        )

        if has_correct and not has_sql:
            return True

        return False

    # ------------------------------------------------------------------
    # Conservative refinement v2
    # ------------------------------------------------------------------

    def refine_conservative(
        self,
        original_sql: str,
        original_results: List[Tuple],
        original_columns: List[str],
        question: str,
        system_message: Optional[str] = None,
        schema_context: str = "",
    ) -> CorrectionResult:
        """
        Conservative execution-guided refinement (v2).

        Unlike the aggressive ``refine_with_result_check`` which reviews
        every executed query, this method only triggers refinement when
        the results look *suspicious* based on heuristic checks:

        1. Empty result set (0 rows) — likely a wrong filter or table.
        2. Single row when the question implies a list/breakdown
           (contains 'for each', 'by', 'per', 'show all', 'list').
        3. Extremely large result set (>10,000 rows) when the question
           implies a limited output (contains 'top', a number, etc.).

        If none of these heuristics fire, the original SQL is returned
        unchanged (no LLM call made).

        This v2 also uses the original system message (schema-aware)
        instead of passing ``None``, which prevents the LLM from
        making uninformed corrections.

        Args:
            original_sql:     The SQL query that executed successfully.
            original_results: The result rows returned by the query.
            original_columns: The column names from the result set.
            question:         The original natural-language question.
            system_message:   The schema-aware system message (preserved).
            schema_context:   Optional additional schema information.

        Returns:
            CorrectionResult with the final SQL and cumulative cost metrics.
        """
        row_count = len(original_results)
        q_lower = question.lower()

        # Heuristic 1: Empty result set — always suspicious
        suspicious = False
        reason = ""

        if row_count == 0:
            suspicious = True
            reason = (
                "The query returned 0 rows, which likely indicates an "
                "incorrect filter, wrong table, or wrong JOIN condition."
            )

        # Heuristic 2: Single row when question implies a list
        list_patterns = [
            "for each", "by ", "per ", "show all", "list all",
            "list the", "show the", "find all", "display all",
            "breakdown", "distribution", "grouped",
        ]
        if not suspicious and row_count == 1:
            if any(p in q_lower for p in list_patterns):
                suspicious = True
                reason = (
                    f"The query returned only 1 row, but the question "
                    f"seems to ask for a list/breakdown (contains pattern "
                    f"suggesting multiple rows expected)."
                )

        # Heuristic 3: Extremely large result set for top-N question
        top_n_match = re.search(
            r"\b(?:top|first|last)\s+(\d+)\b", q_lower
        )
        n_ranking_match = re.search(
            r"\b(\d+)\s+(?:most|least|highest|lowest|best|worst)\b", q_lower
        )
        if not suspicious and row_count > 10000:
            if top_n_match or n_ranking_match:
                expected_n = int(
                    (top_n_match or n_ranking_match).group(1)
                )
                suspicious = True
                reason = (
                    f"The query returned {row_count:,} rows, but the "
                    f"question asks for only {expected_n} results. "
                    f"A LIMIT clause may be missing."
                )

        if not suspicious:
            return CorrectionResult(
                final_sql=original_sql,
                corrected=False,
                attempts=0,
                total_input_tokens=0,
                total_output_tokens=0,
                total_latency_ms=0.0,
                errors=[],
            )

        logger.info(
            "Conservative refinement triggered: %s", reason[:120],
        )

        # Build refinement prompt and call LLM with schema-aware system msg
        results_table = self._format_results_table(
            original_columns, original_results, max_rows=10,
        )

        refinement_prompt = self._build_refinement_prompt(
            sql=original_sql,
            question=question,
            columns=original_columns,
            results_table=results_table,
            row_count=row_count,
            schema_context=schema_context,
        )

        # Use the schema-aware system message (key improvement over v1)
        llm_response = self.llm_caller.call(
            prompt=refinement_prompt,
            system=system_message,
        )

        total_input_tokens = llm_response.input_tokens
        total_output_tokens = llm_response.output_tokens
        total_latency_ms = llm_response.latency_ms

        if not llm_response.success:
            logger.warning(
                "Conservative refinement LLM call failed: %s",
                llm_response.error,
            )
            return CorrectionResult(
                final_sql=original_sql,
                corrected=False,
                attempts=1,
                total_input_tokens=total_input_tokens,
                total_output_tokens=total_output_tokens,
                total_latency_ms=total_latency_ms,
                errors=[f"LLM call failed: {llm_response.error}"],
            )

        raw_response = llm_response.raw_response.strip()

        if self._response_indicates_correct(raw_response):
            logger.info("Conservative refinement: LLM confirmed correct.")
            return CorrectionResult(
                final_sql=original_sql,
                corrected=False,
                attempts=1,
                total_input_tokens=total_input_tokens,
                total_output_tokens=total_output_tokens,
                total_latency_ms=total_latency_ms,
                errors=[],
            )

        corrected_sql = llm_response.sql
        if not corrected_sql or not corrected_sql.strip():
            logger.warning("Conservative refinement returned empty SQL.")
            return CorrectionResult(
                final_sql=original_sql,
                corrected=False,
                attempts=1,
                total_input_tokens=total_input_tokens,
                total_output_tokens=total_output_tokens,
                total_latency_ms=total_latency_ms,
                errors=["Refinement returned empty SQL"],
            )

        exec_result = self.sql_executor.execute(corrected_sql)

        if exec_result.success:
            logger.info(
                "Conservative refinement succeeded (rows=%d).",
                exec_result.row_count,
            )
            return CorrectionResult(
                final_sql=corrected_sql,
                corrected=True,
                attempts=1,
                total_input_tokens=total_input_tokens,
                total_output_tokens=total_output_tokens,
                total_latency_ms=total_latency_ms,
                errors=[],
            )

        logger.info(
            "Conservative refinement produced SQL that failed: %s",
            exec_result.error[:120],
        )
        return CorrectionResult(
            final_sql=original_sql,
            corrected=False,
            attempts=1,
            total_input_tokens=total_input_tokens,
            total_output_tokens=total_output_tokens,
            total_latency_ms=total_latency_ms,
            errors=[f"Refined SQL failed: {exec_result.error}"],
        )
