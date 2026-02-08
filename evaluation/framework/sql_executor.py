"""
sql_executor.py — ClickHouse SQL Execution and Result Capture

Executes SQL queries against a ClickHouse instance and captures structured
results including row data, column names, execution time, and error messages.

Uses the clickhouse-driver library for native protocol connectivity (port 9000).

Part of the evaluation framework for:
    "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases"
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from clickhouse_driver import Client as NativeClient
from clickhouse_driver.errors import Error as ClickHouseError

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class ExecutionResult:
    """Structured result from executing a SQL query against ClickHouse."""
    success: bool                  # Whether the query executed without error
    results: list[tuple]           # Row data as list of tuples
    columns: list[str]             # Column names in result order
    row_count: int                 # Number of rows returned
    execution_time_ms: float       # Wall-clock execution time in milliseconds
    error: str = ""                # Error message if success is False
    column_types: list[str] = field(default_factory=list)  # ClickHouse type names


# ---------------------------------------------------------------------------
# SQLExecutor
# ---------------------------------------------------------------------------

class SQLExecutor:
    """
    Execute SQL queries against a ClickHouse instance and capture results.

    Provides timeout protection (30s default), error handling for
    ClickHouse-specific error messages, and structured result capture.

    Usage:
        executor = SQLExecutor(host="localhost", port=8123)
        result = executor.execute("SELECT 1 AS n")
        assert result.success
        assert result.results == [(1,)]
        executor.close()
    """

    DEFAULT_HOST = "localhost"
    DEFAULT_PORT = 9000
    DEFAULT_DATABASE = "default"
    DEFAULT_TIMEOUT_SEC = 30

    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        database: str = DEFAULT_DATABASE,
        user: str = "default",
        password: str = "",
        timeout: int = DEFAULT_TIMEOUT_SEC,
    ) -> None:
        """
        Args:
            host:     ClickHouse server hostname.
            port:     Native protocol port (default 9000).
            database: Default database to use.
            user:     ClickHouse username (default "default").
            password: ClickHouse password (default empty).
            timeout:  Query timeout in seconds (default 30).
        """
        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password
        self.timeout = timeout
        self._client: Optional[NativeClient] = None

    @property
    def client(self) -> NativeClient:
        """Lazy-initialize the ClickHouse client connection."""
        if self._client is None:
            try:
                self._client = NativeClient(
                    host=self.host,
                    port=self.port,
                    database=self.database,
                    user=self.user,
                    password=self.password,
                    connect_timeout=10,
                    send_receive_timeout=self.timeout,
                    settings={
                        "max_execution_time": self.timeout,
                        "max_memory_usage": 2_000_000_000,
                    },
                )
                logger.info(
                    "Connected to ClickHouse at %s:%d (database=%s)",
                    self.host, self.port, self.database,
                )
            except Exception as e:
                logger.error("Failed to connect to ClickHouse: %s", e)
                raise ConnectionError(
                    f"Cannot connect to ClickHouse at {self.host}:{self.port}: {e}"
                ) from e
        return self._client

    def execute(self, sql: str, database: Optional[str] = None) -> ExecutionResult:
        """
        Execute a SQL query and return structured results.

        Args:
            sql:      The SQL query to execute.
            database: Optional database override for this query.

        Returns:
            ExecutionResult with row data, column metadata, timing, and errors.
        """
        if not sql or not sql.strip():
            return ExecutionResult(
                success=False,
                results=[],
                columns=[],
                row_count=0,
                execution_time_ms=0.0,
                error="Empty SQL query provided.",
            )

        # Clean up the SQL
        cleaned_sql = self._prepare_sql(sql, database)

        start_time = time.perf_counter()
        try:
            result = self.client.execute(cleaned_sql, with_column_types=True)
            elapsed_ms = (time.perf_counter() - start_time) * 1000

            # clickhouse-driver returns (rows, column_types) when with_column_types=True
            rows_data = result[0] if isinstance(result, tuple) else result
            col_types_raw = result[1] if isinstance(result, tuple) and len(result) > 1 else []

            # Extract column names and types
            columns = [ct[0] for ct in col_types_raw] if col_types_raw else []
            column_types = [ct[1] for ct in col_types_raw] if col_types_raw else []

            # Convert rows to list of tuples
            rows: list[tuple] = [tuple(row) for row in rows_data] if rows_data else []

            return ExecutionResult(
                success=True,
                results=rows,
                columns=columns,
                row_count=len(rows),
                execution_time_ms=round(elapsed_ms, 2),
                column_types=[str(ct) for ct in column_types],
            )

        except ClickHouseError as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            error_msg = self._parse_clickhouse_error(str(e))
            logger.warning("ClickHouse query error: %s", error_msg)
            return ExecutionResult(
                success=False,
                results=[],
                columns=[],
                row_count=0,
                execution_time_ms=round(elapsed_ms, 2),
                error=error_msg,
            )

        except Exception as e:
            elapsed_ms = (time.perf_counter() - start_time) * 1000
            error_msg = f"{type(e).__name__}: {e}"

            # Check for timeout indicators
            if any(kw in str(e).lower() for kw in ["timeout", "timed out", "max_execution_time"]):
                error_msg = f"Query timed out after {self.timeout}s: {e}"

            logger.warning("Query execution failed: %s", error_msg)
            return ExecutionResult(
                success=False,
                results=[],
                columns=[],
                row_count=0,
                execution_time_ms=round(elapsed_ms, 2),
                error=error_msg,
            )

    def execute_pair(
        self,
        predicted_sql: str,
        gold_sql: str,
        database: Optional[str] = None,
    ) -> tuple[ExecutionResult, ExecutionResult]:
        """
        Execute both predicted and gold SQL queries.

        This is a convenience method for the common evaluation pattern of
        running both queries and comparing results.

        Args:
            predicted_sql: The model-generated SQL.
            gold_sql:      The ground-truth SQL.
            database:      Optional database override.

        Returns:
            Tuple of (predicted_result, gold_result).
        """
        predicted_result = self.execute(predicted_sql, database)
        gold_result = self.execute(gold_sql, database)
        return predicted_result, gold_result

    def test_connection(self) -> bool:
        """
        Test whether the ClickHouse connection is alive.

        Returns:
            True if SELECT 1 succeeds, False otherwise.
        """
        try:
            result = self.execute("SELECT 1")
            return result.success and result.results == [(1,)]
        except Exception:
            return False

    def get_databases(self) -> list[str]:
        """Return a list of available databases."""
        result = self.execute("SHOW DATABASES")
        if result.success:
            return [row[0] for row in result.results]
        return []

    def get_tables(self, database: Optional[str] = None) -> list[str]:
        """Return a list of tables in the specified (or default) database."""
        db = database or self.database
        result = self.execute(f"SHOW TABLES FROM `{db}`")
        if result.success:
            return [row[0] for row in result.results]
        return []

    def close(self) -> None:
        """Close the ClickHouse client connection."""
        if self._client is not None:
            try:
                self._client.disconnect()
                logger.info("ClickHouse connection closed.")
            except Exception as e:
                logger.warning("Error closing ClickHouse connection: %s", e)
            finally:
                self._client = None

    def __enter__(self) -> SQLExecutor:
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _prepare_sql(sql: str, database: Optional[str] = None) -> str:
        """
        Clean and prepare SQL for execution.

        - Strip leading/trailing whitespace
        - Remove trailing semicolons (clickhouse-connect handles statement termination)
        - Optionally inject database prefix
        """
        cleaned = sql.strip()

        # Remove trailing semicolons
        while cleaned.endswith(";"):
            cleaned = cleaned[:-1].strip()

        return cleaned

    @staticmethod
    def _parse_clickhouse_error(error_str: str) -> str:
        """
        Parse ClickHouse error messages to extract the most useful information.

        ClickHouse errors typically look like:
            Code: 62. DB::Exception: Syntax error: ... (SYNTAX_ERROR)
            Code: 60. DB::Exception: Table default.foo doesn't exist (UNKNOWN_TABLE)
        """
        # Try to extract the structured error code and message
        import re

        # Pattern: Code: NNN. DB::Exception: message (ERROR_NAME)
        match = re.search(
            r"Code:\s*(\d+).*?DB::Exception:\s*(.*?)(?:\s*\((\w+)\))?\.?\s*$",
            error_str,
            re.DOTALL,
        )
        if match:
            code = match.group(1)
            message = match.group(2).strip()
            error_name = match.group(3) or "UNKNOWN"
            # Truncate very long messages
            if len(message) > 500:
                message = message[:500] + "..."
            return f"ClickHouse Error {code} ({error_name}): {message}"

        # Fallback: return the original error, truncated
        if len(error_str) > 600:
            return error_str[:600] + "..."
        return error_str
