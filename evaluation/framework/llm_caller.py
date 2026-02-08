"""
llm_caller.py — Anthropic Claude API Wrapper for Text-to-SQL Evaluation

Provides a robust wrapper around the Anthropic Python SDK for calling
Claude 3.5 Sonnet and Claude 3 Haiku with:
  - Exponential backoff retry logic (max 3 retries)
  - Structured response capture (tokens, latency, extracted SQL)
  - SQL extraction from various response formats
  - Temperature 0.0 for deterministic output

Part of the evaluation framework for:
    "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases"
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Optional

import anthropic

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Response dataclass
# ---------------------------------------------------------------------------

@dataclass
class LLMResponse:
    """Structured response from a Claude API call."""
    sql: str                   # Extracted SQL query (parsed from response)
    raw_response: str          # Full text returned by the model
    input_tokens: int          # Prompt tokens consumed
    output_tokens: int         # Completion tokens generated
    latency_ms: float          # Wall-clock latency in milliseconds
    model: str                 # Model identifier used
    success: bool              # Whether the call succeeded
    error: str = ""            # Error message if success is False


# ---------------------------------------------------------------------------
# Supported models
# ---------------------------------------------------------------------------

SUPPORTED_MODELS = {
    "claude-3-5-sonnet-20241022",
    "claude-sonnet-4-20250514",
    "claude-3-haiku-20240307",
    "claude-3-5-haiku-20241022",
}


# ---------------------------------------------------------------------------
# LLMCaller
# ---------------------------------------------------------------------------

class LLMCaller:
    """
    Wrapper around the Anthropic Python SDK for calling Claude models.

    Reads configuration from environment variables:
        ANTHROPIC_API_KEY        — Required API key
        ANTHROPIC_BASE_URL       — Optional custom base URL
        ANTHROPIC_CUSTOM_HEADERS — Optional JSON-encoded extra headers

    Usage:
        caller = LLMCaller(model="claude-3-5-sonnet-20241022")
        response = caller.call(prompt="SELECT 1", system="You are a SQL expert.")
        print(response.sql)
    """

    DEFAULT_MODEL = "claude-3-5-sonnet-20241022"
    MAX_RETRIES = 3
    MAX_TOKENS = 2048
    TEMPERATURE = 0.0
    # Base delay in seconds for exponential backoff
    BASE_RETRY_DELAY = 1.0

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        max_retries: int = MAX_RETRIES,
        max_tokens: int = MAX_TOKENS,
        temperature: float = TEMPERATURE,
    ) -> None:
        """
        Args:
            model:        Claude model identifier.
            max_retries:  Maximum retry attempts on rate-limit / transient errors.
            max_tokens:   Maximum tokens in the completion.
            temperature:  Sampling temperature (0.0 for deterministic).
        """
        self.model = model
        self.max_retries = max_retries
        self.max_tokens = max_tokens
        self.temperature = temperature

        # Read API configuration from environment
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            # When using a proxy with custom headers for auth (e.g. internal
            # deployments), a dummy key satisfies the SDK requirement.
            if os.environ.get("ANTHROPIC_BASE_URL") and os.environ.get("ANTHROPIC_CUSTOM_HEADERS"):
                api_key = "dummy-key-auth-via-headers"
                logger.info("No ANTHROPIC_API_KEY; using custom headers auth via ANTHROPIC_BASE_URL.")
            else:
                raise EnvironmentError(
                    "ANTHROPIC_API_KEY environment variable is not set. "
                    "Please set it to your Anthropic API key."
                )

        base_url = os.environ.get("ANTHROPIC_BASE_URL")
        custom_headers_raw = os.environ.get("ANTHROPIC_CUSTOM_HEADERS")

        # Parse custom headers if provided
        default_headers: dict[str, str] = {}
        if custom_headers_raw:
            try:
                default_headers = json.loads(custom_headers_raw)
                if not isinstance(default_headers, dict):
                    logger.warning(
                        "ANTHROPIC_CUSTOM_HEADERS is not a JSON object; ignoring."
                    )
                    default_headers = {}
            except json.JSONDecodeError:
                # Try newline-separated key:value format first, then comma-separated
                raw = custom_headers_raw.strip()
                if "\n" in raw:
                    lines = raw.split("\n")
                else:
                    lines = raw.split(",")
                for pair in lines:
                    pair = pair.strip()
                    if ":" in pair:
                        k, v = pair.split(":", 1)
                        default_headers[k.strip()] = v.strip()

        # Build client kwargs
        client_kwargs: dict = {"api_key": api_key}
        if base_url:
            client_kwargs["base_url"] = base_url
        if default_headers:
            client_kwargs["default_headers"] = default_headers

        self.client = anthropic.Anthropic(**client_kwargs)
        logger.info(
            "LLMCaller initialized: model=%s, base_url=%s, max_retries=%d",
            self.model,
            base_url or "(default)",
            self.max_retries,
        )

    def call(
        self,
        prompt: str,
        system: Optional[str] = None,
    ) -> LLMResponse:
        """
        Send a prompt to the Claude model and return a structured response.

        The prompt is sent as a single user message.  An optional system
        message is prepended.  Retries with exponential backoff on
        rate-limit (429) and overloaded (529) errors.

        Args:
            prompt: User message content.
            system: Optional system message.

        Returns:
            LLMResponse with extracted SQL, token counts, and latency.
        """
        messages = [{"role": "user", "content": prompt}]

        request_kwargs: dict = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "temperature": self.temperature,
            "messages": messages,
        }
        if system:
            request_kwargs["system"] = system

        last_error = ""
        for attempt in range(1, self.max_retries + 1):
            start_time = time.perf_counter()
            try:
                response = self.client.messages.create(**request_kwargs)
                elapsed_ms = (time.perf_counter() - start_time) * 1000

                # Extract text from content blocks
                raw_text = ""
                for block in response.content:
                    if hasattr(block, "text"):
                        raw_text += block.text

                # Extract SQL from the response
                sql = self.extract_sql(raw_text)

                return LLMResponse(
                    sql=sql,
                    raw_response=raw_text,
                    input_tokens=response.usage.input_tokens,
                    output_tokens=response.usage.output_tokens,
                    latency_ms=round(elapsed_ms, 2),
                    model=self.model,
                    success=True,
                )

            except anthropic.RateLimitError as e:
                last_error = f"Rate limited (attempt {attempt}/{self.max_retries}): {e}"
                logger.warning(last_error)
                if attempt < self.max_retries:
                    delay = self.BASE_RETRY_DELAY * (2 ** (attempt - 1))
                    logger.info("Retrying in %.1f seconds...", delay)
                    time.sleep(delay)

            except anthropic.InternalServerError as e:
                last_error = f"Server error (attempt {attempt}/{self.max_retries}): {e}"
                logger.warning(last_error)
                if attempt < self.max_retries:
                    delay = self.BASE_RETRY_DELAY * (2 ** (attempt - 1))
                    logger.info("Retrying in %.1f seconds...", delay)
                    time.sleep(delay)

            except anthropic.APIStatusError as e:
                # 529 Overloaded or other status errors
                if e.status_code == 529:
                    last_error = f"API overloaded (attempt {attempt}/{self.max_retries}): {e}"
                    logger.warning(last_error)
                    if attempt < self.max_retries:
                        delay = self.BASE_RETRY_DELAY * (2 ** (attempt - 1))
                        logger.info("Retrying in %.1f seconds...", delay)
                        time.sleep(delay)
                else:
                    last_error = f"API error: {e}"
                    logger.error(last_error)
                    elapsed_ms = (time.perf_counter() - start_time) * 1000
                    return LLMResponse(
                        sql="",
                        raw_response="",
                        input_tokens=0,
                        output_tokens=0,
                        latency_ms=round(elapsed_ms, 2),
                        model=self.model,
                        success=False,
                        error=last_error,
                    )

            except anthropic.APIConnectionError as e:
                last_error = f"Connection error (attempt {attempt}/{self.max_retries}): {e}"
                logger.warning(last_error)
                if attempt < self.max_retries:
                    delay = self.BASE_RETRY_DELAY * (2 ** (attempt - 1))
                    logger.info("Retrying in %.1f seconds...", delay)
                    time.sleep(delay)

            except Exception as e:
                last_error = f"Unexpected error: {type(e).__name__}: {e}"
                logger.error(last_error)
                elapsed_ms = (time.perf_counter() - start_time) * 1000
                return LLMResponse(
                    sql="",
                    raw_response="",
                    input_tokens=0,
                    output_tokens=0,
                    latency_ms=round(elapsed_ms, 2),
                    model=self.model,
                    success=False,
                    error=last_error,
                )

        # All retries exhausted
        logger.error("All %d retry attempts exhausted. Last error: %s", self.max_retries, last_error)
        return LLMResponse(
            sql="",
            raw_response="",
            input_tokens=0,
            output_tokens=0,
            latency_ms=0.0,
            model=self.model,
            success=False,
            error=f"All {self.max_retries} retry attempts exhausted. {last_error}",
        )

    @staticmethod
    def extract_sql(response: str) -> str:
        """
        Extract a SQL query from the model's response text.

        Handles multiple common formats:
        1. Markdown code fences: ```sql ... ``` or ``` ... ```
        2. Raw SQL (starts with SELECT, WITH, INSERT, CREATE, etc.)
        3. SQL embedded in explanatory text
        4. Multiple SQL statements (returns the first/primary one)

        Args:
            response: Raw text response from the model.

        Returns:
            Extracted SQL string, stripped of formatting artifacts.
        """
        if not response or not response.strip():
            return ""

        text = response.strip()

        # Strategy 1: Extract from markdown code fences
        # Match ```sql ... ``` or ``` ... ```
        fence_pattern = re.compile(
            r"```(?:sql|clickhouse|SQL)?\s*\n?(.*?)```",
            re.DOTALL | re.IGNORECASE,
        )
        fence_matches = fence_pattern.findall(text)
        if fence_matches:
            # Return the longest fenced block (most likely the main query)
            sql = max(fence_matches, key=len).strip()
            if sql:
                return _clean_sql(sql)

        # Strategy 2: The entire response is SQL
        sql_keywords = re.compile(
            r"^\s*(SELECT|WITH|INSERT|CREATE|ALTER|DROP|EXPLAIN|SHOW|DESCRIBE|SET)\b",
            re.IGNORECASE | re.MULTILINE,
        )
        if sql_keywords.match(text):
            # The response is likely raw SQL, possibly with trailing explanation
            # Find where the SQL ends (semicolon or explanation paragraph)
            sql = _extract_leading_sql(text)
            return _clean_sql(sql)

        # Strategy 3: SQL embedded in explanatory text
        # Look for SQL-like statements anywhere in the response
        sql_block_pattern = re.compile(
            r"((?:SELECT|WITH)\b.*?;)",
            re.DOTALL | re.IGNORECASE,
        )
        sql_blocks = sql_block_pattern.findall(text)
        if sql_blocks:
            sql = max(sql_blocks, key=len).strip()
            return _clean_sql(sql)

        # Strategy 4: Look for SQL without semicolon
        sql_nosemi_pattern = re.compile(
            r"((?:SELECT|WITH)\b.+)",
            re.DOTALL | re.IGNORECASE,
        )
        sql_nosemi = sql_nosemi_pattern.findall(text)
        if sql_nosemi:
            sql = sql_nosemi[0].strip()
            # Trim trailing natural language if present
            lines = sql.split("\n")
            sql_lines: list[str] = []
            for line in lines:
                stripped = line.strip()
                # Stop if we hit a line that looks like explanation (not SQL)
                if stripped and not _looks_like_sql_line(stripped):
                    # Check if we already have meaningful SQL
                    if sql_lines and any("SELECT" in l.upper() for l in sql_lines):
                        break
                sql_lines.append(line)
            sql = "\n".join(sql_lines).strip()
            return _clean_sql(sql)

        # Fallback: return the entire response stripped
        return _clean_sql(text)


# ---------------------------------------------------------------------------
# Module-level utility functions
# ---------------------------------------------------------------------------

def _clean_sql(sql: str) -> str:
    """Clean up extracted SQL: normalize whitespace, remove trailing semicolons."""
    if not sql:
        return ""
    # Remove leading/trailing whitespace
    sql = sql.strip()
    # Remove trailing semicolons (ClickHouse doesn't require them in API)
    sql = sql.rstrip(";").strip()
    # Collapse multiple blank lines into single blank line
    sql = re.sub(r"\n{3,}", "\n\n", sql)
    return sql


def _extract_leading_sql(text: str) -> str:
    """
    Extract the SQL portion from text that starts with SQL but may have
    trailing explanation paragraphs.
    """
    lines = text.split("\n")
    sql_lines: list[str] = []
    blank_count = 0

    for line in lines:
        stripped = line.strip()
        if not stripped:
            blank_count += 1
            # Two consecutive blank lines likely separate SQL from explanation
            if blank_count >= 2 and sql_lines:
                break
            sql_lines.append(line)
            continue
        blank_count = 0

        if _looks_like_sql_line(stripped):
            sql_lines.append(line)
        elif sql_lines:
            # We hit non-SQL text after some SQL
            break
        else:
            sql_lines.append(line)

    return "\n".join(sql_lines).strip()


def _looks_like_sql_line(line: str) -> bool:
    """
    Heuristic: does this line look like it belongs to a SQL statement?
    """
    # SQL keywords, operators, and common patterns
    sql_indicators = re.compile(
        r"^\s*("
        r"SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|"
        r"ON|AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|IS|NULL|"
        r"GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|UNION|"
        r"WITH|AS|CASE|WHEN|THEN|ELSE|END|"
        r"INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|"
        r"COUNT|SUM|AVG|MIN|MAX|"
        r"to\w+\(|array\w+\(|if\(|multiIf\(|"
        r"--.*|"  # SQL comments
        r"[(),;`'\"\d*]|"  # SQL punctuation
        r"\w+\.\w+"  # table.column notation
        r")",
        re.IGNORECASE,
    )
    if sql_indicators.match(line):
        return True

    # Also recognize SQL continuation lines: column names, aliases, expressions
    # e.g. "event_id," or "user_name AS name," or "e.timestamp,"
    continuation = re.compile(
        r"^\s*\w[\w.]*(?:\s+AS\s+\w+)?\s*,?\s*$",
        re.IGNORECASE,
    )
    if continuation.match(line):
        return True

    return False
