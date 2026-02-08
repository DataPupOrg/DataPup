"""
chain_of_thought.py — Two-Step Chain-of-Thought SQL Generation

Implements a chain-of-thought (CoT) prompting approach that decomposes
text-to-SQL generation into two steps:

  Step 1 (Schema Linking): Analyze the question to identify tables, columns,
      joins, filters, and ClickHouse-specific functions needed.
  Step 2 (SQL Generation): Generate the final SQL query informed by the
      step 1 analysis.

Research shows this decomposition improves accuracy on complex queries
involving JOINs, window functions, and multi-table aggregations by forcing
the model to reason about schema relationships before writing SQL.

Part of the evaluation framework for:
    "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases"
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from evaluation.framework.llm_caller import LLMCaller, LLMResponse
from evaluation.framework.prompt_builder import PromptResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class CoTResult:
    """Result from the two-step chain-of-thought SQL generation pipeline."""

    final_sql: str                 # The generated SQL query
    schema_analysis: str           # Step 1 output (schema linking analysis)
    total_input_tokens: int        # Combined input tokens across both steps
    total_output_tokens: int       # Combined output tokens across both steps
    total_latency_ms: float        # Combined wall-clock latency across both steps
    success: bool                  # Whether the pipeline succeeded
    error: str = ""                # Error message if success is False


# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_STEP1_PROMPT_TEMPLATE = """\
Given the following database schema and question, analyze what is needed to write the SQL query.

### Database Schema
{schema_text}

{relationship_text}

### Question
{question}

### Analysis
Please identify:
1. Which tables are needed
2. Which columns to SELECT (be specific - only columns that directly answer the question)
3. What JOIN conditions are needed (if any)
4. What WHERE/HAVING filters are needed
5. What GROUP BY / ORDER BY / LIMIT clauses are needed
6. Any ClickHouse-specific functions required

Provide your analysis in a structured format."""

_STEP1_SYSTEM_MESSAGE = (
    "You are an expert SQL developer specializing in ClickHouse analytical databases. "
    "Your task is to analyze a natural-language question against a database schema and "
    "identify the tables, columns, joins, filters, and operations needed to answer it.\n\n"
    "Guidelines:\n"
    "- Use only the tables and columns provided in the schema.\n"
    "- Be specific about which columns are needed and why.\n"
    "- Identify join conditions precisely using column names.\n"
    "- Note any ClickHouse-specific functions that may be useful, such as: "
    "toYear(), toMonth(), toStartOfMonth(), toStartOfWeek(), dateDiff(), "
    "countIf(), sumIf(), avgIf(), quantile(), argMax(), argMin(), "
    "groupArray(), arrayJoin(), has(), mapKeys(), mapValues(), "
    "lagInFrame(), leadInFrame(), multiIf().\n"
    "- For Map column access, note that bracket syntax is used: column['key'].\n"
    "- For Nullable columns, note that ifNull() or assume() should be used.\n"
    "- In ClickHouse, integer division truncates (e.g., 10/3 = 3). "
    "Note when toFloat64() or multiplication by 1.0 is needed for decimal results.\n"
    "- Provide a clear, structured analysis. Do NOT write the SQL query itself."
)

_STEP2_PROMPT_TEMPLATE = """\
Based on the following analysis, write the ClickHouse SQL query.

### Database Schema
{schema_text}

### Analysis
{step1_output}

### Question
{question}

{examples_text}

### SQL Query
Write ONLY the SQL query, no explanation."""

_STEP2_SYSTEM_MESSAGE = (
    "You are an expert SQL developer specializing in ClickHouse analytical databases. "
    "You are given a schema analysis and must write the corresponding SQL query.\n\n"
    "Guidelines:\n"
    "- Use only the tables and columns identified in the analysis.\n"
    "- SELECT only the specific columns needed to answer the question. Avoid SELECT * "
    "unless the question explicitly asks for all columns or all data from a table.\n"
    "- Use ClickHouse SQL syntax.\n"
    "- Return ONLY the SQL query without any explanation or commentary.\n"
    "- Do not wrap the SQL in markdown code fences.\n"
    "- If the analysis mentions ambiguities, make reasonable assumptions and note them "
    "as SQL comments.\n"
    "- Prefer efficient query patterns: avoid unnecessary subqueries, use "
    "appropriate aggregation functions, and leverage ClickHouse-specific "
    "optimizations where applicable."
)


# ---------------------------------------------------------------------------
# ChainOfThoughtGenerator
# ---------------------------------------------------------------------------

class ChainOfThoughtGenerator:
    """Two-step chain-of-thought SQL generation.

    Step 1 (Schema Linking): Identify tables, columns, joins, and operations
        needed to answer the question. The model produces a structured analysis
        without writing SQL.
    Step 2 (SQL Generation): Generate the final SQL query using the schema
        analysis from step 1 as additional context.

    If step 1 fails, the generator falls back to direct (single-shot) SQL
    generation using the original system message, which enforces SQL-only output.
    """

    def __init__(self, llm_caller: LLMCaller) -> None:
        """
        Args:
            llm_caller: An initialized LLMCaller instance. The same instance
                        is reused for both steps to maintain consistent model
                        configuration (model, temperature, retries).
        """
        self.llm_caller = llm_caller

    def generate(
        self,
        question: str,
        schema_text: str,
        system_message: str,
        examples_text: str = "",
        relationship_text: str = "",
    ) -> CoTResult:
        """Run the two-step chain-of-thought pipeline.

        Args:
            question:          The natural-language question to translate to SQL.
            schema_text:       The formatted database schema.
            system_message:    The original system message (used for fallback
                               direct generation if step 1 fails).
            examples_text:     Optional few-shot examples text.
            relationship_text: Optional table relationship hints.

        Returns:
            CoTResult with the generated SQL, schema analysis, combined token
            counts, combined latency, and success/error status.
        """
        total_input_tokens = 0
        total_output_tokens = 0
        total_latency_ms = 0.0

        # ---- Step 1: Schema Linking Analysis ----
        step1_prompt = _STEP1_PROMPT_TEMPLATE.format(
            schema_text=schema_text,
            relationship_text=relationship_text,
            question=question,
        )

        logger.debug("CoT Step 1: Schema linking analysis for question: %s", question[:80])

        step1_response = self.llm_caller.call(
            prompt=step1_prompt,
            system=_STEP1_SYSTEM_MESSAGE,
        )

        total_input_tokens += step1_response.input_tokens
        total_output_tokens += step1_response.output_tokens
        total_latency_ms += step1_response.latency_ms

        if not step1_response.success:
            # Fallback: attempt direct single-shot generation
            logger.warning(
                "CoT Step 1 failed (%s); falling back to direct generation.",
                step1_response.error,
            )
            return self._fallback_direct(
                question=question,
                schema_text=schema_text,
                system_message=system_message,
                examples_text=examples_text,
                relationship_text=relationship_text,
                prior_input_tokens=total_input_tokens,
                prior_output_tokens=total_output_tokens,
                prior_latency_ms=total_latency_ms,
            )

        schema_analysis = step1_response.raw_response

        # ---- Step 2: SQL Generation ----
        # Build examples section for step 2 prompt
        examples_section = ""
        if examples_text:
            examples_section = f"### Examples\n{examples_text}"

        step2_prompt = _STEP2_PROMPT_TEMPLATE.format(
            schema_text=schema_text,
            step1_output=schema_analysis,
            question=question,
            examples_text=examples_section,
        )

        logger.debug("CoT Step 2: SQL generation from analysis")

        step2_response = self.llm_caller.call(
            prompt=step2_prompt,
            system=_STEP2_SYSTEM_MESSAGE,
        )

        total_input_tokens += step2_response.input_tokens
        total_output_tokens += step2_response.output_tokens
        total_latency_ms += step2_response.latency_ms

        if not step2_response.success:
            return CoTResult(
                final_sql="",
                schema_analysis=schema_analysis,
                total_input_tokens=total_input_tokens,
                total_output_tokens=total_output_tokens,
                total_latency_ms=round(total_latency_ms, 2),
                success=False,
                error=f"Step 2 failed: {step2_response.error}",
            )

        return CoTResult(
            final_sql=step2_response.sql,
            schema_analysis=schema_analysis,
            total_input_tokens=total_input_tokens,
            total_output_tokens=total_output_tokens,
            total_latency_ms=round(total_latency_ms, 2),
            success=True,
        )

    def _fallback_direct(
        self,
        question: str,
        schema_text: str,
        system_message: str,
        examples_text: str,
        relationship_text: str,
        prior_input_tokens: int,
        prior_output_tokens: int,
        prior_latency_ms: float,
    ) -> CoTResult:
        """Fall back to direct single-shot SQL generation.

        Uses the original system message (which enforces SQL-only output)
        and constructs a prompt similar to PromptBuilder's user message
        format, preserving the same prompt structure the model expects.

        Args:
            question:            The natural-language question.
            schema_text:         The formatted database schema.
            system_message:      The original system message for SQL generation.
            examples_text:       Optional few-shot examples.
            relationship_text:   Optional table relationship hints.
            prior_input_tokens:  Tokens already consumed before fallback.
            prior_output_tokens: Tokens already generated before fallback.
            prior_latency_ms:    Latency already elapsed before fallback.

        Returns:
            CoTResult with fallback generation results. The schema_analysis
            field will contain a note indicating fallback was used.
        """
        # Build a user message in the same format as PromptBuilder
        parts: list[str] = []
        parts.append("### Database Schema")
        parts.append(schema_text)
        parts.append("")

        if relationship_text:
            parts.append(relationship_text)
            parts.append("")

        if examples_text:
            parts.append("### Examples")
            parts.append(examples_text)

        parts.append("### Question")
        parts.append(question)
        parts.append("")
        parts.append("### SQL Query")

        fallback_prompt = "\n".join(parts)

        logger.info("CoT fallback: direct single-shot generation")

        response = self.llm_caller.call(
            prompt=fallback_prompt,
            system=system_message,
        )

        total_input = prior_input_tokens + response.input_tokens
        total_output = prior_output_tokens + response.output_tokens
        total_latency = prior_latency_ms + response.latency_ms

        if not response.success:
            return CoTResult(
                final_sql="",
                schema_analysis="[Fallback: step 1 failed, direct generation also failed]",
                total_input_tokens=total_input,
                total_output_tokens=total_output,
                total_latency_ms=round(total_latency, 2),
                success=False,
                error=f"Fallback also failed: {response.error}",
            )

        return CoTResult(
            final_sql=response.sql,
            schema_analysis="[Fallback: step 1 failed, used direct generation]",
            total_input_tokens=total_input,
            total_output_tokens=total_output,
            total_latency_ms=round(total_latency, 2),
            success=True,
        )


# ---------------------------------------------------------------------------
# Pipeline integration helper
# ---------------------------------------------------------------------------

def generate_with_cot(
    question: str,
    prompt_result: PromptResult,
    llm_caller: LLMCaller,
) -> CoTResult:
    """Convenience function for pipeline integration.

    Extracts the schema text, examples text, and relationship text from
    a PromptResult built by PromptBuilder, then runs the two-step
    chain-of-thought generation pipeline.

    This function is designed to be a drop-in addition to the evaluation
    pipeline in run_phase2.py. Instead of calling llm_caller.call()
    directly with the prompt_result's user_message, call this function
    to get CoT-based generation.

    Args:
        question:      The natural-language question being translated.
        prompt_result: A PromptResult from PromptBuilder.build_prompt().
        llm_caller:    An initialized LLMCaller instance.

    Returns:
        CoTResult with the generated SQL, schema analysis, combined
        token/latency metrics, and success status.

    Example usage in the evaluation pipeline::

        prompt_result = prompt_builder.build_prompt(...)

        # Standard (single-shot) generation:
        # llm_response = llm_caller.call(
        #     prompt=prompt_result.user_message,
        #     system=prompt_result.system_message,
        # )

        # Chain-of-thought generation:
        cot_result = generate_with_cot(
            question=question,
            prompt_result=prompt_result,
            llm_caller=llm_caller,
        )
        predicted_sql = cot_result.final_sql
    """
    schema_text, examples_text, relationship_text = _extract_prompt_sections(
        prompt_result.user_message
    )

    generator = ChainOfThoughtGenerator(llm_caller)
    return generator.generate(
        question=question,
        schema_text=schema_text,
        system_message=prompt_result.system_message,
        examples_text=examples_text,
        relationship_text=relationship_text,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_prompt_sections(user_message: str) -> tuple[str, str, str]:
    """Extract schema, examples, and relationship sections from a user message.

    The PromptBuilder constructs user messages with the following structure:

        ### Database Schema
        <schema_text>

        ### Table Relationships       (optional)
        <relationship_text>

        ### Examples                   (optional)
        <examples_text>

        ### Question
        <question>

        ### SQL Query

    This function parses that structure to recover the individual sections.

    Args:
        user_message: The user_message field from a PromptResult.

    Returns:
        A tuple of (schema_text, examples_text, relationship_text).
        Any section not found will be an empty string.
    """
    schema_text = ""
    examples_text = ""
    relationship_text = ""

    # Split on section headers (### <Title>)
    # We identify sections by their known headers
    sections: dict[str, str] = {}
    current_header = ""
    current_lines: list[str] = []

    for line in user_message.split("\n"):
        stripped = line.strip()
        if stripped.startswith("### "):
            # Save previous section
            if current_header:
                sections[current_header] = "\n".join(current_lines).strip()
            current_header = stripped[4:].strip()
            current_lines = []
        else:
            current_lines.append(line)

    # Save the last section
    if current_header:
        sections[current_header] = "\n".join(current_lines).strip()

    # Extract known sections
    schema_text = sections.get("Database Schema", "")
    relationship_text = sections.get("Table Relationships", "")
    examples_text = sections.get("Examples", "")

    # If the relationship text contains the full "### Table Relationships"
    # formatted block, reconstruct it with the header for the CoT prompt
    if relationship_text:
        relationship_text = f"### Table Relationships\n{relationship_text}"

    return schema_text, examples_text, relationship_text
