"""
schema_linker.py -- Extract and Compare Schema References in SQL Queries

Parses SQL queries to extract referenced table and column names, handles
ClickHouse-specific syntax (backticks, database.table notation, aliases),
subqueries, and CTEs.  Computes precision, recall, and F1 for schema
linking evaluation (the SL metric).

Part of the evaluation framework for:
    "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases"
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class SchemaReference:
    """Set of table and column references extracted from a SQL query.

    Attributes:
        tables:            Unqualified table names (lowercased).
        columns:           Unqualified column names (lowercased).
        qualified_columns: Fully-qualified column references in
                           ``table.column`` form (lowercased).
    """

    tables: set[str] = field(default_factory=set)
    columns: set[str] = field(default_factory=set)
    qualified_columns: set[str] = field(default_factory=set)


# Backward-compatible alias so existing consumers can still import SchemaLinks.
SchemaLinks = SchemaReference


@dataclass
class SchemaLinkingResult:
    """Precision / recall / F1 comparison of schema links between two SQL queries.

    Contains per-category (table and column) metrics as well as an overall F1
    that is the harmonic mean of table F1 and column F1.  Also exposes the
    underlying predicted and gold sets along with extra / missing items for
    diagnostic purposes.

    Attributes:
        table_precision:  Fraction of predicted tables that appear in gold.
        table_recall:     Fraction of gold tables that appear in predicted.
        table_f1:         Harmonic mean of table precision and recall.
        column_precision: Fraction of predicted columns that appear in gold.
        column_recall:    Fraction of gold columns that appear in predicted.
        column_f1:        Harmonic mean of column precision and recall.
        overall_f1:       Harmonic mean of table_f1 and column_f1.
        predicted_tables: Tables referenced by the predicted SQL.
        gold_tables:      Tables referenced by the gold SQL.
        extra_tables:     Tables in predicted but not in gold.
        missing_tables:   Tables in gold but not in predicted.
        predicted_columns: Columns referenced by the predicted SQL.
        gold_columns:      Columns referenced by the gold SQL.
        extra_columns:     Columns in predicted but not in gold.
        missing_columns:   Columns in gold but not in predicted.
        predicted:         Full SchemaReference for the predicted SQL.
        gold:              Full SchemaReference for the gold SQL.
    """

    # Metrics -----------------------------------------------------------
    table_precision: float = 0.0
    table_recall: float = 0.0
    table_f1: float = 0.0
    column_precision: float = 0.0
    column_recall: float = 0.0
    column_f1: float = 0.0
    overall_f1: float = 0.0

    # Diagnostic sets ---------------------------------------------------
    predicted_tables: set[str] = field(default_factory=set)
    gold_tables: set[str] = field(default_factory=set)
    extra_tables: set[str] = field(default_factory=set)
    missing_tables: set[str] = field(default_factory=set)

    predicted_columns: set[str] = field(default_factory=set)
    gold_columns: set[str] = field(default_factory=set)
    extra_columns: set[str] = field(default_factory=set)
    missing_columns: set[str] = field(default_factory=set)

    # Full references (backward-compatible with experiment_runner) ------
    predicted: SchemaReference = field(default_factory=SchemaReference)
    gold: SchemaReference = field(default_factory=SchemaReference)


# ---------------------------------------------------------------------------
# SchemaLinker
# ---------------------------------------------------------------------------

class SchemaLinker:
    """Extract table and column references from SQL queries and compare them.

    Handles:
      * ClickHouse-specific backtick quoting: ``database``.``table``
      * Database-qualified table names: ``db.table`` -> ``table``
      * Table aliases: ``FROM orders AS o`` -> table="orders", alias="o"
      * Subquery aliases: ``FROM (SELECT ...) AS sub`` -> skipped
      * CTE definitions: ``WITH cte AS (SELECT ...)`` -> cte not a real table
      * JOINs of all types
      * Column references in SELECT, WHERE, GROUP BY, ORDER BY, HAVING, ON
      * ClickHouse built-in function names (not treated as column names)

    Usage::

        linker = SchemaLinker()
        refs = linker.extract_references(
            "SELECT o.id FROM analytics.orders AS o WHERE o.total > 100"
        )
        assert "orders" in refs.tables
        assert "id" in refs.columns
        assert "orders.id" in refs.qualified_columns

        result = linker.compare(predicted_sql, gold_sql)
        print(f"Table F1: {result.table_f1:.3f}")
        print(f"Overall F1: {result.overall_f1:.3f}")
    """

    # SQL keywords that must not be treated as identifiers ---------------
    SQL_KEYWORDS: frozenset[str] = frozenset({
        # DML / DDL
        "select", "from", "where", "join", "left", "right", "inner", "outer",
        "cross", "full", "on", "and", "or", "not", "in", "exists", "between",
        "like", "is", "null", "true", "false", "as", "case", "when", "then",
        "else", "end", "group", "by", "order", "having", "limit", "offset",
        "union", "all", "intersect", "except", "insert", "into", "update",
        "delete", "create", "alter", "drop", "table", "index", "view",
        "with", "recursive", "distinct", "asc", "desc", "nulls", "first",
        "last", "over", "partition", "rows", "range", "unbounded", "preceding",
        "following", "current", "row", "filter", "within", "any", "some",
        "array", "global", "local", "prewhere", "sample", "final", "format",
        "settings", "using", "natural", "lateral", "values", "set",
        # Standard aggregate / scalar keywords
        "count", "sum", "avg", "min", "max", "if", "multiif",
    })

    # ClickHouse built-in function names (common subset) -----------------
    CLICKHOUSE_FUNCTIONS: frozenset[str] = frozenset({
        # Date / time
        "toyear", "tomonth", "today", "todate", "todatetime", "tostring",
        "toint32", "toint64", "touint32", "touint64", "tofloat32", "tofloat64",
        "todecimal32", "todecimal64", "now", "yesterday", "formatdatetime",
        "parsedatetime", "datediff", "dateadd", "datesub",
        "tostartofday", "tostartofweek", "tostartofmonth", "tostartofyear",
        "tostartofquarter", "tostartofhour", "tostartofminute",
        "tosecond", "tominute", "tohour",
        "todayofweek", "todayofmonth", "todayofyear",
        "toweek", "toquarter", "tounixtime", "fromunixtime",
        # Array
        "arrayjoin", "arraymap", "arrayfilter", "arraysort", "arrayreverse",
        "arrayflatten", "arraycompact", "arrayexists", "arrayall", "length",
        "empty", "notempty", "has", "hasall", "hasany", "indexof", "countin",
        # Aggregate
        "grouparray", "groupuniqarray", "grouparrayinsertat",
        "argmin", "argmax", "uniq", "uniqexact", "uniqcombined",
        "uniqhll12", "quantile", "quantiles", "median",
        "sumif", "countif", "avgif", "minif", "maxif", "anyif",
        "topk", "topkweighted", "approxtopk",
        # Null handling
        "coalesce", "ifnull", "nullif", "isnotnull", "isnull",
        # Math
        "greatest", "least", "abs", "round", "ceil", "floor", "sqrt",
        "log", "log2", "log10", "exp", "pow", "power", "mod",
        # String
        "lower", "upper", "trim", "ltrim", "rtrim", "substring", "substr",
        "concat", "replace", "replaceall", "replaceregexpall",
        "match", "extract", "like", "notlike", "ilike",
        "position", "locate", "reverse", "repeat", "format",
        # Type conversion / hash
        "tostring", "cast", "reinterpret",
        "siphash64", "cityhash64", "murmurhash3_64",
        # Tuple / map
        "tuple", "tupleelement", "map", "mapkeys", "mapvalues",
        # Window
        "rownumber", "row_number", "rank", "denserank", "dense_rank",
        "ntile", "lag", "lead", "firstvalue", "lastvalue", "nthvalue",
        "first_value", "last_value", "nth_value",
    })

    # Pre-compiled regex patterns ----------------------------------------

    # FROM / JOIN table reference (skips subqueries starting with '(')
    _TABLE_REF_RE = re.compile(
        r"(?:FROM|JOIN)\s+"
        r"(?!\s*\()"                           # not a subquery
        r"(?:`?(\w+)`?\.)?`?(\w+)`?"           # optional [database.]table
        r"(?:\s+(?:AS\s+)?`?(\w+)`?)?",        # optional [AS] alias
        re.IGNORECASE,
    )

    # CTE name: ``identifier AS (``
    _CTE_NAME_RE = re.compile(
        r"`?(\w+)`?\s+AS\s*\(",
        re.IGNORECASE,
    )

    # WITH clause: everything between WITH and the first top-level SELECT
    _WITH_CLAUSE_RE = re.compile(
        r"\bWITH\b\s+(.*?)(?=\bSELECT\b)",
        re.IGNORECASE | re.DOTALL,
    )

    # Qualified column: ``prefix.column``
    _QUALIFIED_COL_RE = re.compile(
        r"`?(\w+)`?\s*\.\s*`?(\w+)`?",
        re.IGNORECASE,
    )

    # AS alias in SELECT clause
    _SELECT_ALIAS_RE = re.compile(
        r"\bAS\s+`?(\w+)`?",
        re.IGNORECASE,
    )

    # Clause boundaries used for column extraction
    _CLAUSE_PATTERNS: list[tuple[str, int]] = [
        # (regex_string, re_flags)
        (r"\bSELECT\b\s+(.*?)\bFROM\b",
         re.IGNORECASE | re.DOTALL),
        (r"\bWHERE\b\s+(.*?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b"
         r"|\bHAVING\b|\bUNION\b|$)",
         re.IGNORECASE | re.DOTALL),
        (r"\bGROUP\s+BY\b\s+(.*?)(?:\bORDER\s+BY\b|\bLIMIT\b"
         r"|\bHAVING\b|\bUNION\b|$)",
         re.IGNORECASE | re.DOTALL),
        (r"\bORDER\s+BY\b\s+(.*?)(?:\bLIMIT\b|\bUNION\b|$)",
         re.IGNORECASE | re.DOTALL),
        (r"\bHAVING\b\s+(.*?)(?:\bORDER\s+BY\b|\bLIMIT\b|\bUNION\b|$)",
         re.IGNORECASE | re.DOTALL),
        (r"\bON\b\s+(.*?)(?:\bWHERE\b|\bJOIN\b|\bGROUP\s+BY\b"
         r"|\bORDER\s+BY\b|\bLIMIT\b|$)",
         re.IGNORECASE | re.DOTALL),
    ]

    # ------------------------------------------------------------------ #
    #  Public API                                                         #
    # ------------------------------------------------------------------ #

    def extract_references(self, sql: str) -> SchemaReference:
        """Extract table and column references from a SQL query.

        Args:
            sql: A SQL query string (ClickHouse dialect).

        Returns:
            A :class:`SchemaReference` containing the lowercased table names,
            column names, and qualified ``table.column`` references found in
            the query.
        """
        if not sql or not sql.strip():
            return SchemaReference()

        normalized = self._normalize_sql(sql)

        # Identify CTE names so they can be excluded from real tables
        cte_names = self._extract_cte_names(normalized)

        # Tables from FROM / JOIN clauses
        tables = self._extract_tables(normalized)
        tables -= cte_names

        # Alias -> table mapping for resolving prefixed column references
        alias_map = self._build_alias_map(normalized)

        # Columns (unqualified and qualified)
        columns, qualified_columns = self._extract_columns(
            normalized, alias_map, tables, cte_names,
        )

        return SchemaReference(
            tables=tables,
            columns=columns,
            qualified_columns=qualified_columns,
        )

    # Backward-compatible alias
    def extract_links(self, sql: str) -> SchemaReference:
        """Alias for :meth:`extract_references` (backward compatibility)."""
        return self.extract_references(sql)

    def compare(
        self,
        predicted_sql: str,
        gold_sql: str,
    ) -> SchemaLinkingResult:
        """Compare schema references between predicted and gold SQL queries.

        Computes precision, recall, and F1 for both tables and columns, plus
        an overall F1 (harmonic mean of table F1 and column F1).

        Args:
            predicted_sql: Model-generated SQL.
            gold_sql:      Ground-truth SQL.

        Returns:
            A :class:`SchemaLinkingResult` with all metrics and diagnostic sets.
        """
        pred_refs = self.extract_references(predicted_sql)
        gold_refs = self.extract_references(gold_sql)

        table_p, table_r, table_f = _f1(pred_refs.tables, gold_refs.tables)
        col_p, col_r, col_f = _f1(pred_refs.columns, gold_refs.columns)
        overall = _harmonic_mean(table_f, col_f)

        return SchemaLinkingResult(
            # Metrics
            table_precision=table_p,
            table_recall=table_r,
            table_f1=table_f,
            column_precision=col_p,
            column_recall=col_r,
            column_f1=col_f,
            overall_f1=overall,
            # Diagnostic sets -- tables
            predicted_tables=pred_refs.tables,
            gold_tables=gold_refs.tables,
            extra_tables=pred_refs.tables - gold_refs.tables,
            missing_tables=gold_refs.tables - pred_refs.tables,
            # Diagnostic sets -- columns
            predicted_columns=pred_refs.columns,
            gold_columns=gold_refs.columns,
            extra_columns=pred_refs.columns - gold_refs.columns,
            missing_columns=gold_refs.columns - pred_refs.columns,
            # Full references
            predicted=pred_refs,
            gold=gold_refs,
        )

    # ------------------------------------------------------------------ #
    #  SQL normalization                                                   #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _normalize_sql(sql: str) -> str:
        """Normalize SQL for parsing.

        * Removes single-line (``--``) and block (``/* ... */``) comments.
        * Replaces string literals with ``''`` to prevent false column matches.
        * Collapses consecutive whitespace to a single space.
        """
        # Remove single-line comments
        result = re.sub(r"--[^\n]*", " ", sql)
        # Remove block comments
        result = re.sub(r"/\*.*?\*/", " ", result, flags=re.DOTALL)
        # Replace string literals with empty strings
        result = re.sub(r"'[^']*'", "''", result)
        # Collapse whitespace
        result = re.sub(r"\s+", " ", result).strip()
        return result

    # ------------------------------------------------------------------ #
    #  CTE extraction                                                     #
    # ------------------------------------------------------------------ #

    @classmethod
    def _extract_cte_names(cls, sql: str) -> set[str]:
        """Extract CTE names from ``WITH`` clauses.

        Example::

            WITH sales_cte AS (SELECT ...) -> {"sales_cte"}
        """
        cte_names: set[str] = set()
        with_match = cls._WITH_CLAUSE_RE.search(sql)
        if not with_match:
            return cte_names

        with_clause = with_match.group(1)
        for match in cls._CTE_NAME_RE.finditer(with_clause):
            name = match.group(1).lower()
            if name not in cls.SQL_KEYWORDS:
                cte_names.add(name)

        return cte_names

    # ------------------------------------------------------------------ #
    #  Table extraction                                                   #
    # ------------------------------------------------------------------ #

    @classmethod
    def _extract_tables(cls, sql: str) -> set[str]:
        """Extract table names from ``FROM`` and ``JOIN`` clauses.

        Handles:
          * ``FROM table``
          * ``FROM database.table``  (extracts only *table*)
          * ``FROM `database`.`table```
          * ``FROM table AS alias``
          * ``FROM table alias`` (implicit alias without ``AS``)
          * ``JOIN table ON ...``
          * Subqueries ``FROM (...) AS alias`` are skipped.
        """
        tables: set[str] = set()
        for match in cls._TABLE_REF_RE.finditer(sql):
            table_name = match.group(2).lower()
            if table_name not in cls.SQL_KEYWORDS:
                tables.add(table_name)
        return tables

    # ------------------------------------------------------------------ #
    #  Alias map                                                          #
    # ------------------------------------------------------------------ #

    @classmethod
    def _build_alias_map(cls, sql: str) -> dict[str, str]:
        """Build a mapping from alias -> table name.

        Example::

            FROM orders AS o  ->  {"o": "orders"}
        """
        alias_map: dict[str, str] = {}

        for match in cls._TABLE_REF_RE.finditer(sql):
            table_name = match.group(2).lower()
            alias_raw = match.group(3)
            if alias_raw is not None:
                alias = alias_raw.lower()
                if alias not in cls.SQL_KEYWORDS:
                    alias_map[alias] = table_name

        return alias_map

    # ------------------------------------------------------------------ #
    #  Column extraction                                                  #
    # ------------------------------------------------------------------ #

    def _extract_columns(
        self,
        sql: str,
        alias_map: dict[str, str],
        tables: set[str],
        cte_names: set[str],
    ) -> tuple[set[str], set[str]]:
        """Extract column names referenced in the SQL query.

        Returns:
            A tuple ``(columns, qualified_columns)`` where *columns* is a set
            of bare column names and *qualified_columns* is a set of
            ``table.column`` strings (using the resolved table name, not the
            alias).

        Strategy:
          1. Scan for qualified references ``prefix.column`` and resolve the
             prefix through the alias map.
          2. Scan clause bodies (SELECT, WHERE, GROUP BY, ...) for bare
             identifiers.
          3. Filter out SQL keywords, function names, table names, aliases,
             numeric literals, and SELECT-clause aliases.
        """
        columns: set[str] = set()
        qualified_columns: set[str] = set()

        known_non_columns = (
            self.SQL_KEYWORDS
            | {f.lower() for f in self.CLICKHOUSE_FUNCTIONS}
            | tables
            | cte_names
            | set(alias_map.keys())
        )

        # --- 1. Qualified column references: prefix.column ---------------
        for match in self._QUALIFIED_COL_RE.finditer(sql):
            prefix = match.group(1).lower()
            column = match.group(2).lower()

            # Ensure prefix is a known table, alias, or CTE
            if prefix not in tables and prefix not in alias_map and prefix not in cte_names:
                continue
            if column in known_non_columns or column.isdigit():
                continue

            columns.add(column)

            # Resolve the alias to the real table name for the qualified form
            resolved_table = alias_map.get(prefix, prefix)
            qualified_columns.add(f"{resolved_table}.{column}")

        # --- 2. Bare identifiers from SQL clauses ------------------------
        for pattern_str, flags in self._CLAUSE_PATTERNS:
            for match in re.finditer(pattern_str, sql, flags):
                clause_text = match.group(1)
                identifiers = re.findall(r"`?(\w+)`?", clause_text)
                for ident in identifiers:
                    ident_lower = ident.lower()
                    if (
                        ident_lower not in known_non_columns
                        and not ident.isdigit()
                        and not _is_numeric_literal(ident)
                        and len(ident) > 1  # skip single-char non-aliases
                    ):
                        columns.add(ident_lower)

        # --- 3. Remove SELECT-clause aliases -----------------------------
        select_aliases = self._extract_select_aliases(sql)
        columns -= {a.lower() for a in select_aliases}

        return columns, qualified_columns

    @classmethod
    def _extract_select_aliases(cls, sql: str) -> set[str]:
        """Extract column aliases from the SELECT clause.

        Example::

            SELECT total_price AS tp  ->  {"tp"}
        """
        aliases: set[str] = set()
        select_match = re.search(
            r"\bSELECT\b\s+(.*?)\bFROM\b",
            sql,
            re.IGNORECASE | re.DOTALL,
        )
        if not select_match:
            return aliases

        select_clause = select_match.group(1)
        for match in cls._SELECT_ALIAS_RE.finditer(select_clause):
            aliases.add(match.group(1))

        return aliases


# ---------------------------------------------------------------------------
# Module-level utility functions
# ---------------------------------------------------------------------------

def _f1(predicted: set[str], gold: set[str]) -> tuple[float, float, float]:
    """Compute precision, recall, and F1 for two sets.

    Args:
        predicted: Set of predicted items.
        gold:      Set of gold-standard items.

    Returns:
        ``(precision, recall, f1)`` as floats in ``[0, 1]``.
        If both sets are empty the score is ``(1.0, 1.0, 1.0)`` (perfect
        agreement on the absence of references).
    """
    if not predicted and not gold:
        return 1.0, 1.0, 1.0
    if not predicted or not gold:
        return 0.0, 0.0, 0.0

    true_positives = len(predicted & gold)
    precision = true_positives / len(predicted)
    recall = true_positives / len(gold)

    if precision + recall == 0:
        f1_score = 0.0
    else:
        f1_score = 2 * precision * recall / (precision + recall)

    return round(precision, 6), round(recall, 6), round(f1_score, 6)


# Keep old name available for any external callers
_prf1 = _f1


def _harmonic_mean(a: float, b: float) -> float:
    """Compute the harmonic mean of two non-negative values.

    Returns ``0.0`` if either value is zero.
    """
    if a + b == 0:
        return 0.0
    return round(2 * a * b / (a + b), 6)


def _is_numeric_literal(s: str) -> bool:
    """Return ``True`` if *s* is a numeric literal (int or float)."""
    try:
        float(s)
        return True
    except ValueError:
        return False
