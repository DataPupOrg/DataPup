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
from dataclasses import dataclass, field
from typing import Optional

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
