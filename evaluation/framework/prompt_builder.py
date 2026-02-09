"""
prompt_builder.py — Schema-Aware Prompt Construction for Text-to-SQL

Builds evaluation prompts by combining schema information, metadata enrichment,
few-shot examples, and user questions according to configurable strategies.

Supports 4 schema formats x 4 scope strategies x 5 metadata levels x 4 example
selection strategies = 320 possible prompt configurations.

Part of the evaluation framework for:
    "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases"
"""

from __future__ import annotations

import json
import os
import re
import math
import logging
from enum import Enum
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Enumerations for prompt configuration axes
# ---------------------------------------------------------------------------

class SchemaFormat(Enum):
    """How the database schema is represented in the prompt."""
    DDL = "ddl"                        # CREATE TABLE ... statements
    MARKDOWN = "markdown"              # Markdown tables
    JSON = "json"                      # JSON schema description
    NATURAL_LANGUAGE = "natural_language"  # Prose description


class SchemaScope(Enum):
    """How much of the schema is included in the prompt."""
    FULL = "full"                      # Entire database schema
    RELEVANT_SUBSET = "relevant_subset"  # Only tables/columns likely needed
    PROGRESSIVE = "progressive"        # Start minimal, expand on failure
    USER_GUIDED = "user_guided"        # User-specified table set


class MetadataLevel(Enum):
    """How much metadata enrichment is applied to the schema."""
    NONE = "none"                      # Raw schema only
    DESCRIPTIONS = "descriptions"      # Column/table descriptions
    SAMPLE_VALUES = "sample_values"    # Representative sample values
    STATISTICS = "statistics"          # Min/max/cardinality/nulls
    ALL = "all"                        # Descriptions + samples + statistics


class ExampleStrategy(Enum):
    """How few-shot examples are selected."""
    ZERO_SHOT = "zero_shot"            # No examples
    STATIC_FEW_SHOT = "static_few_shot"  # Fixed set of 3 examples
    DYNAMIC_FEW_SHOT = "dynamic_few_shot"  # Similarity-based selection
    SCHEMA_MATCHED = "schema_matched"  # Match by overlapping tables
    DAIL_SQL = "dail_sql"              # DAIL-SQL format: DDL + masked Q-SQL pairs


class PromptVersion(Enum):
    """System prompt ablation variants for deconfounding analysis."""
    MINIMAL = "minimal"              # No ClickHouse guidance, no function ref, no JOIN hints
    DIALECT_ONLY = "dialect_only"    # + ClickHouse dialect guidance only
    JOINS = "joins"                  # + Table relationship hints + JOIN guidance
    WINDOW = "window"               # + Window function + aggregation guidance
    FULL = "full"                    # Full V6 prompt (current best, default)


# ---------------------------------------------------------------------------
# Dataclasses for prompt results and internal structures
# ---------------------------------------------------------------------------

@dataclass
class PromptResult:
    """Container for a constructed prompt and associated metadata."""
    system_message: str
    user_message: str
    full_prompt: str               # system + user combined for token counting
    token_estimate: int            # Approximate token count (chars / 3.5)
    schema_format: SchemaFormat
    schema_scope: SchemaScope
    metadata_level: MetadataLevel
    example_strategy: ExampleStrategy
    num_examples: int
    num_tables: int
    num_columns: int
    expand_fn: Optional[Callable] = None  # For PROGRESSIVE scope


@dataclass
class TableSchema:
    """Parsed representation of a single table's schema."""
    database: str
    table_name: str
    columns: list[dict]            # [{name, type, description?, sample_values?, stats?}]
    description: str = ""
    row_count: int = 0
    engine: str = ""


@dataclass
class ExampleQuery:
    """A text-to-SQL example for few-shot prompting."""
    question: str
    sql: str
    tables_used: list[str] = field(default_factory=list)
    difficulty: str = ""
    dataset: str = ""


# ---------------------------------------------------------------------------
# PromptBuilder — main class
# ---------------------------------------------------------------------------

DATABASE_NAME_MAP = {
    "custom_analytics": "analytics",
    "clickbench": "default",
    "ssb": "ssb",
}


class PromptBuilder:
    """
    Constructs evaluation prompts from schema files, metadata, examples,
    and user questions.  Supports all four experimental axes:
        schema format, schema scope, metadata level, example strategy.

    Usage:
        builder = PromptBuilder("/path/to/benchmark")
        result = builder.build_prompt(
            question="What is the total revenue by country?",
            dataset="tpch",
            format=SchemaFormat.DDL,
            scope=SchemaScope.FULL,
            metadata=MetadataLevel.DESCRIPTIONS,
            examples=ExampleStrategy.STATIC_FEW_SHOT,
        )
        print(result.system_message)
        print(result.user_message)
    """

    # File-name conventions for each schema format (try multiple conventions)
    FORMAT_FILES = {
        SchemaFormat.DDL: ["schema_ddl.sql", "ddl.sql"],
        SchemaFormat.MARKDOWN: ["schema_markdown.md", "markdown.md"],
        SchemaFormat.JSON: ["schema_json.json", "json_schema.json"],
        SchemaFormat.NATURAL_LANGUAGE: ["schema_natural.txt", "natural_language.txt"],
    }

    # Characters-per-token heuristic for Claude models (conservative)
    CHARS_PER_TOKEN = 3.5

    def __init__(self, benchmark_dir: str) -> None:
        """
        Args:
            benchmark_dir: Root of the benchmark directory containing
                           schemas/{dataset}/ and examples/ subdirectories.
        """
        self.benchmark_dir = Path(benchmark_dir).resolve()
        self.schemas_dir = self.benchmark_dir / "schemas"
        self.examples_dir = self.benchmark_dir / "examples"

        # Caches keyed by (dataset, format)
        self._schema_cache: dict[tuple[str, SchemaFormat], str] = {}
        self._parsed_schema_cache: dict[str, list[TableSchema]] = {}
        self._examples_cache: dict[str, list[ExampleQuery]] = {}
        self._metadata_cache: dict[str, dict] = {}
        self._relationships_cache: dict[str, list[dict]] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def build_prompt(
        self,
        question: str,
        dataset: str,
        format: SchemaFormat,
        scope: SchemaScope,
        metadata: MetadataLevel,
        examples: ExampleStrategy,
        relevant_tables: Optional[list[str]] = None,
        relevant_columns: Optional[list[str]] = None,
        user_tables: Optional[list[str]] = None,
        prompt_version: Optional[PromptVersion] = None,
    ) -> PromptResult:
        """
        Construct the full evaluation prompt.

        Args:
            question:          Natural-language question to translate.
            dataset:           Dataset identifier (e.g. "tpch", "ssb", "custom").
            format:            Schema representation format.
            scope:             How much schema to include.
            metadata:          Metadata enrichment level.
            examples:          Few-shot example selection strategy.
            relevant_tables:   Tables to include for RELEVANT_SUBSET scope.
            relevant_columns:  Columns to include for RELEVANT_SUBSET scope.
            user_tables:       Tables specified by user for USER_GUIDED scope.

        Returns:
            PromptResult with system_message, user_message, token estimate, etc.
        """
        # 1. Load and format schema
        schema_text, tables, columns = self._build_schema_section(
            dataset, format, scope, metadata,
            relevant_tables=relevant_tables,
            relevant_columns=relevant_columns,
            user_tables=user_tables,
        )

        # 2. Build examples section
        examples_text, num_examples = self._build_examples_section(
            dataset, examples, question, relevant_tables
        )

        # 3. Build system message
        _pv = prompt_version if prompt_version is not None else PromptVersion.FULL
        system_message = self._build_system_message(dataset, format, prompt_version=_pv)

        # 4. Build user message
        user_message = self._build_user_message(
            question, schema_text, examples_text, metadata, dataset
        )

        # 5. Full prompt for token counting
        full_prompt = system_message + "\n\n" + user_message

        # 6. Token estimate
        token_estimate = self._estimate_tokens(full_prompt)

        # 7. Build expand function for progressive scope
        expand_fn = None
        if scope == SchemaScope.PROGRESSIVE:
            expand_fn = self._make_expand_fn(
                question, dataset, format, metadata, examples,
                tables, columns
            )

        return PromptResult(
            system_message=system_message,
            user_message=user_message,
            full_prompt=full_prompt,
            token_estimate=token_estimate,
            schema_format=format,
            schema_scope=scope,
            metadata_level=metadata,
            example_strategy=examples,
            num_examples=num_examples,
            num_tables=tables,
            num_columns=columns,
            expand_fn=expand_fn,
        )

    # ------------------------------------------------------------------
    # Schema construction
    # ------------------------------------------------------------------

    def _build_schema_section(
        self,
        dataset: str,
        format: SchemaFormat,
        scope: SchemaScope,
        metadata: MetadataLevel,
        relevant_tables: Optional[list[str]] = None,
        relevant_columns: Optional[list[str]] = None,
        user_tables: Optional[list[str]] = None,
    ) -> tuple[str, int, int]:
        """
        Build the schema section of the prompt.

        Returns:
            (schema_text, num_tables, num_columns)
        """
        # Load raw schema
        raw_schema = self._load_schema(dataset, format)

        # Parse schema for filtering operations
        parsed_tables = self._parse_schema_metadata(dataset)

        # Apply scope filtering
        if scope == SchemaScope.FULL:
            filtered_tables = parsed_tables
        elif scope == SchemaScope.RELEVANT_SUBSET:
            filtered_tables = self._filter_relevant(
                parsed_tables, relevant_tables or [], relevant_columns or []
            )
        elif scope == SchemaScope.PROGRESSIVE:
            # Start with minimal schema: only the most likely tables
            # We use a heuristic of including at most 2 tables initially
            filtered_tables = parsed_tables[:2] if len(parsed_tables) > 2 else parsed_tables
        elif scope == SchemaScope.USER_GUIDED:
            if user_tables:
                filtered_tables = [
                    t for t in parsed_tables
                    if t.table_name.lower() in {n.lower() for n in user_tables}
                ]
            else:
                filtered_tables = parsed_tables
        else:
            filtered_tables = parsed_tables

        # Format the filtered schema
        if scope == SchemaScope.FULL and metadata == MetadataLevel.NONE:
            # Use the raw file directly — no filtering needed
            schema_text = raw_schema
        else:
            schema_text = self._format_tables(filtered_tables, format, metadata)

        num_tables = len(filtered_tables)
        num_columns = sum(len(t.columns) for t in filtered_tables)

        return schema_text, num_tables, num_columns

    def _load_schema(self, dataset: str, format: SchemaFormat) -> str:
        """Load raw schema file from disk, with caching."""
        cache_key = (dataset, format)
        if cache_key in self._schema_cache:
            return self._schema_cache[cache_key]

        filenames = self.FORMAT_FILES[format]
        schema_path = None
        for filename in filenames:
            candidate = self.schemas_dir / dataset / filename
            if candidate.exists():
                schema_path = candidate
                break

        if schema_path is not None:
            text = schema_path.read_text(encoding="utf-8")
        else:
            # Generate a synthetic schema representation if file doesn't exist
            logger.warning(
                "Schema file %s not found; generating from parsed metadata.", schema_path
            )
            parsed = self._parse_schema_metadata(dataset)
            text = self._format_tables(parsed, format, MetadataLevel.NONE)

        self._schema_cache[cache_key] = text
        return text

    def _parse_schema_metadata(self, dataset: str) -> list[TableSchema]:
        """
        Parse the JSON schema file (canonical format) to extract structured
        table/column information.  Falls back to DDL parsing if JSON is unavailable.
        """
        if dataset in self._parsed_schema_cache:
            return self._parsed_schema_cache[dataset]

        json_path = self.schemas_dir / dataset / "schema_json.json"
        json_path2 = self.schemas_dir / dataset / "json_schema.json"
        ddl_path = self.schemas_dir / dataset / "schema_ddl.sql"
        ddl_path2 = self.schemas_dir / dataset / "ddl.sql"
        metadata_path = self.schemas_dir / dataset / "metadata.json"

        tables: list[TableSchema] = []

        # Try JSON paths
        actual_json = json_path if json_path.exists() else (json_path2 if json_path2.exists() else None)
        actual_ddl = ddl_path if ddl_path.exists() else (ddl_path2 if ddl_path2.exists() else None)

        if actual_json is not None:
            data = json.loads(actual_json.read_text(encoding="utf-8"))
            tables_data = data if isinstance(data, list) else data.get("tables", [])
            for tbl in tables_data:
                cols = []
                for col in tbl.get("columns", []):
                    cols.append({
                        "name": col.get("name", ""),
                        "type": col.get("type", "String"),
                        "description": col.get("description", ""),
                        "sample_values": col.get("sample_values", []),
                        "stats": col.get("stats", {}),
                    })
                tables.append(TableSchema(
                    database=tbl.get("database", dataset),
                    table_name=tbl.get("table_name", tbl.get("name", "")),
                    columns=cols,
                    description=tbl.get("description", ""),
                    row_count=tbl.get("row_count", 0),
                    engine=tbl.get("engine", "MergeTree"),
                ))
        elif actual_ddl is not None:
            tables = self._parse_ddl(actual_ddl.read_text(encoding="utf-8"), dataset)
        else:
            logger.warning("No schema files found for dataset '%s'.", dataset)

        # Merge additional metadata if available
        if metadata_path.exists():
            meta = json.loads(metadata_path.read_text(encoding="utf-8"))
            tables = self._enrich_with_metadata(tables, meta)

        self._parsed_schema_cache[dataset] = tables
        return tables

    @staticmethod
    def _parse_ddl(ddl_text: str, database: str) -> list[TableSchema]:
        """
        Parse CREATE TABLE statements from DDL text into TableSchema objects.
        Handles ClickHouse-style DDL including ENGINE and ORDER BY clauses.
        """
        tables: list[TableSchema] = []
        # Match CREATE TABLE statements
        create_pattern = re.compile(
            r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"
            r"(?:`?(\w+)`?\.)?`?(\w+)`?"
            r"\s*\((.*?)\)"
            r"(?:\s*ENGINE\s*=\s*(\w+))?",
            re.IGNORECASE | re.DOTALL,
        )

        for match in create_pattern.finditer(ddl_text):
            db = match.group(1) or database
            table_name = match.group(2)
            columns_text = match.group(3)
            engine = match.group(4) or "MergeTree"

            columns = []
            # Parse individual column definitions
            # Split on commas that are not inside parentheses
            col_parts = _split_columns(columns_text)
            for part in col_parts:
                part = part.strip()
                if not part:
                    continue
                # Skip constraints, indices, etc.
                if re.match(r"^\s*(PRIMARY|INDEX|CONSTRAINT|ORDER|PARTITION|SETTINGS)", part, re.I):
                    continue
                # Parse column: name type [DEFAULT ...] [COMMENT '...']
                col_match = re.match(
                    r"`?(\w+)`?\s+(\S+(?:\(.*?\))?)"
                    r"(?:\s+(?:DEFAULT|MATERIALIZED|ALIAS)\s+\S+)?"
                    r"(?:\s+COMMENT\s+'([^']*)')?"
                    r"(?:\s+CODEC\(.*?\))?",
                    part,
                    re.IGNORECASE,
                )
                if col_match:
                    columns.append({
                        "name": col_match.group(1),
                        "type": col_match.group(2),
                        "description": col_match.group(3) or "",
                        "sample_values": [],
                        "stats": {},
                    })

            tables.append(TableSchema(
                database=db,
                table_name=table_name,
                columns=columns,
                engine=engine,
            ))

        return tables

    @staticmethod
    def _enrich_with_metadata(
        tables: list[TableSchema], metadata: dict
    ) -> list[TableSchema]:
        """Merge external metadata (descriptions, samples, stats) into parsed tables."""
        table_meta = metadata.get("tables", {})
        for table in tables:
            tmeta = table_meta.get(table.table_name, {})
            if not table.description and "description" in tmeta:
                table.description = tmeta["description"]
            if "row_count" in tmeta:
                table.row_count = tmeta["row_count"]
            col_meta = tmeta.get("columns", {})
            for col in table.columns:
                cmeta = col_meta.get(col["name"], {})
                if not col.get("description") and "description" in cmeta:
                    col["description"] = cmeta["description"]
                if not col.get("sample_values") and "sample_values" in cmeta:
                    col["sample_values"] = cmeta["sample_values"]
                if not col.get("stats") and "stats" in cmeta:
                    col["stats"] = cmeta["stats"]
        return tables

    # ------------------------------------------------------------------
    # Scope filtering
    # ------------------------------------------------------------------

    @staticmethod
    def _filter_relevant(
        tables: list[TableSchema],
        relevant_tables: list[str],
        relevant_columns: list[str],
    ) -> list[TableSchema]:
        """
        Filter schema to include only specified tables.
        If relevant_columns is provided, also filter columns within those tables.
        """
        rel_table_set = {t.lower() for t in relevant_tables}
        rel_col_set = {c.lower() for c in relevant_columns} if relevant_columns else None

        filtered: list[TableSchema] = []
        for table in tables:
            if table.table_name.lower() not in rel_table_set:
                continue
            if rel_col_set is not None:
                filtered_cols = [
                    c for c in table.columns
                    if c["name"].lower() in rel_col_set
                ]
                filtered.append(TableSchema(
                    database=table.database,
                    table_name=table.table_name,
                    columns=filtered_cols if filtered_cols else table.columns,
                    description=table.description,
                    row_count=table.row_count,
                    engine=table.engine,
                ))
            else:
                filtered.append(table)
        return filtered

    # ------------------------------------------------------------------
    # Schema formatting
    # ------------------------------------------------------------------

    def _format_tables(
        self,
        tables: list[TableSchema],
        format: SchemaFormat,
        metadata: MetadataLevel,
    ) -> str:
        """Render a list of TableSchema objects in the requested format with metadata."""
        formatters = {
            SchemaFormat.DDL: self._format_ddl,
            SchemaFormat.MARKDOWN: self._format_markdown,
            SchemaFormat.JSON: self._format_json,
            SchemaFormat.NATURAL_LANGUAGE: self._format_natural_language,
        }
        return formatters[format](tables, metadata)

    @staticmethod
    def _format_ddl(tables: list[TableSchema], metadata: MetadataLevel) -> str:
        """Render tables as CREATE TABLE DDL statements with optional metadata comments."""
        parts: list[str] = []
        for table in tables:
            lines: list[str] = []
            # Table-level comment
            if metadata in (MetadataLevel.DESCRIPTIONS, MetadataLevel.ALL) and table.description:
                lines.append(f"-- {table.description}")
            if metadata in (MetadataLevel.STATISTICS, MetadataLevel.ALL) and table.row_count:
                lines.append(f"-- Approximate row count: {table.row_count:,}")

            lines.append(f"CREATE TABLE {table.database}.{table.table_name} (")

            col_lines: list[str] = []
            for col in table.columns:
                col_def = f"    `{col['name']}` {col['type']}"

                comments: list[str] = []
                if metadata in (MetadataLevel.DESCRIPTIONS, MetadataLevel.ALL):
                    if col.get("description"):
                        comments.append(col["description"])
                if metadata in (MetadataLevel.SAMPLE_VALUES, MetadataLevel.ALL):
                    if col.get("sample_values"):
                        samples = ", ".join(str(v) for v in col["sample_values"][:5])
                        comments.append(f"e.g. {samples}")
                if metadata in (MetadataLevel.STATISTICS, MetadataLevel.ALL):
                    stats = col.get("stats", {})
                    if stats:
                        stat_parts = []
                        if "min" in stats:
                            stat_parts.append(f"min={stats['min']}")
                        if "max" in stats:
                            stat_parts.append(f"max={stats['max']}")
                        if "distinct" in stats:
                            stat_parts.append(f"distinct={stats['distinct']}")
                        if "null_pct" in stats:
                            stat_parts.append(f"null%={stats['null_pct']}")
                        if stat_parts:
                            comments.append("; ".join(stat_parts))

                if comments:
                    col_def += f"  -- {' | '.join(comments)}"
                col_lines.append(col_def)

            lines.append(",\n".join(col_lines))
            lines.append(f") ENGINE = {table.engine};")
            parts.append("\n".join(lines))

        return "\n\n".join(parts)

    @staticmethod
    def _format_markdown(tables: list[TableSchema], metadata: MetadataLevel) -> str:
        """Render tables as Markdown tables with optional metadata columns."""
        parts: list[str] = []
        for table in tables:
            lines: list[str] = []
            header = f"### Table: `{table.table_name}`"
            if metadata in (MetadataLevel.DESCRIPTIONS, MetadataLevel.ALL) and table.description:
                header += f"\n{table.description}"
            if metadata in (MetadataLevel.STATISTICS, MetadataLevel.ALL) and table.row_count:
                header += f"\n*Rows: ~{table.row_count:,}*"
            lines.append(header)
            lines.append("")

            # Build header row
            headers = ["Column", "Type"]
            if metadata in (MetadataLevel.DESCRIPTIONS, MetadataLevel.ALL):
                headers.append("Description")
            if metadata in (MetadataLevel.SAMPLE_VALUES, MetadataLevel.ALL):
                headers.append("Sample Values")
            if metadata in (MetadataLevel.STATISTICS, MetadataLevel.ALL):
                headers.append("Statistics")

            lines.append("| " + " | ".join(headers) + " |")
            lines.append("| " + " | ".join(["---"] * len(headers)) + " |")

            for col in table.columns:
                row = [f"`{col['name']}`", f"`{col['type']}`"]
                if metadata in (MetadataLevel.DESCRIPTIONS, MetadataLevel.ALL):
                    row.append(col.get("description", ""))
                if metadata in (MetadataLevel.SAMPLE_VALUES, MetadataLevel.ALL):
                    samples = col.get("sample_values", [])
                    row.append(", ".join(str(v) for v in samples[:3]) if samples else "")
                if metadata in (MetadataLevel.STATISTICS, MetadataLevel.ALL):
                    stats = col.get("stats", {})
                    stat_str = "; ".join(f"{k}={v}" for k, v in stats.items()) if stats else ""
                    row.append(stat_str)
                lines.append("| " + " | ".join(row) + " |")

            parts.append("\n".join(lines))

        return "\n\n".join(parts)

    @staticmethod
    def _format_json(tables: list[TableSchema], metadata: MetadataLevel) -> str:
        """Render tables as a JSON array of table objects with optional metadata fields."""
        result: list[dict] = []
        for table in tables:
            tobj: dict = {
                "table_name": table.table_name,
                "database": table.database,
                "columns": [],
            }
            if metadata in (MetadataLevel.DESCRIPTIONS, MetadataLevel.ALL) and table.description:
                tobj["description"] = table.description
            if metadata in (MetadataLevel.STATISTICS, MetadataLevel.ALL) and table.row_count:
                tobj["row_count"] = table.row_count

            for col in table.columns:
                cobj: dict = {"name": col["name"], "type": col["type"]}
                if metadata in (MetadataLevel.DESCRIPTIONS, MetadataLevel.ALL):
                    if col.get("description"):
                        cobj["description"] = col["description"]
                if metadata in (MetadataLevel.SAMPLE_VALUES, MetadataLevel.ALL):
                    if col.get("sample_values"):
                        cobj["sample_values"] = col["sample_values"][:5]
                if metadata in (MetadataLevel.STATISTICS, MetadataLevel.ALL):
                    if col.get("stats"):
                        cobj["statistics"] = col["stats"]
                tobj["columns"].append(cobj)

            result.append(tobj)

        return json.dumps(result, indent=2)

    @staticmethod
    def _format_natural_language(tables: list[TableSchema], metadata: MetadataLevel) -> str:
        """Render tables as prose descriptions."""
        parts: list[str] = []
        for table in tables:
            lines: list[str] = []
            desc = table.description or f"data related to {table.table_name}"
            intro = f'The table "{table.table_name}" contains {desc}.'
            if metadata in (MetadataLevel.STATISTICS, MetadataLevel.ALL) and table.row_count:
                intro += f" It has approximately {table.row_count:,} rows."
            lines.append(intro)

            lines.append("It has the following columns:")
            for col in table.columns:
                col_desc = f'  - "{col["name"]}" ({col["type"]})'
                extras: list[str] = []
                if metadata in (MetadataLevel.DESCRIPTIONS, MetadataLevel.ALL):
                    if col.get("description"):
                        extras.append(col["description"])
                if metadata in (MetadataLevel.SAMPLE_VALUES, MetadataLevel.ALL):
                    if col.get("sample_values"):
                        samples = ", ".join(str(v) for v in col["sample_values"][:3])
                        extras.append(f"example values: {samples}")
                if metadata in (MetadataLevel.STATISTICS, MetadataLevel.ALL):
                    stats = col.get("stats", {})
                    if stats:
                        stat_parts = []
                        if "min" in stats and "max" in stats:
                            stat_parts.append(f"range {stats['min']} to {stats['max']}")
                        if "distinct" in stats:
                            stat_parts.append(f"{stats['distinct']} distinct values")
                        if "null_pct" in stats:
                            stat_parts.append(f"{stats['null_pct']}% null")
                        if stat_parts:
                            extras.append("; ".join(stat_parts))
                if extras:
                    col_desc += ": " + " | ".join(extras)
                lines.append(col_desc)

            parts.append("\n".join(lines))

        return "\n\n".join(parts)

    # ------------------------------------------------------------------
    # Examples section
    # ------------------------------------------------------------------

    def _build_examples_section(
        self,
        dataset: str,
        strategy: ExampleStrategy,
        question: str,
        relevant_tables: Optional[list[str]],
    ) -> tuple[str, int]:
        """
        Build the few-shot examples section.

        Returns:
            (examples_text, num_examples_included)
        """
        if strategy == ExampleStrategy.ZERO_SHOT:
            return "", 0

        all_examples = self._load_examples(dataset)
        if not all_examples:
            return "", 0

        selected: list[ExampleQuery] = []

        if strategy == ExampleStrategy.STATIC_FEW_SHOT:
            selected = all_examples[:3]

        elif strategy == ExampleStrategy.DYNAMIC_FEW_SHOT:
            selected = self._select_dynamic(all_examples, question, k=3)

        elif strategy == ExampleStrategy.SCHEMA_MATCHED:
            selected = self._select_schema_matched(
                all_examples, relevant_tables or [], k=3
            )

        elif strategy == ExampleStrategy.DAIL_SQL:
            selected = self._select_dynamic(all_examples, question, k=3)

        if not selected:
            return "", 0

        if strategy == ExampleStrategy.DAIL_SQL:
            # DAIL-SQL format: mask specific values in SQL with placeholders
            lines: list[str] = ["/* Example question-SQL pairs (values masked) */\n"]
            for i, ex in enumerate(selected, 1):
                masked_sql = _mask_sql_values(ex.sql)
                lines.append(f"-- Q: {ex.question}")
                lines.append(f"{masked_sql}")
                lines.append("")
        else:
            lines: list[str] = ["Here are some example question-to-SQL translations:\n"]
            for i, ex in enumerate(selected, 1):
                lines.append(f"Example {i}:")
                lines.append(f"Question: {ex.question}")
                lines.append(f"SQL: {ex.sql}")
                lines.append("")

        return "\n".join(lines), len(selected)

    def _load_examples(self, dataset: str) -> list[ExampleQuery]:
        """Load example queries from the examples directory."""
        if dataset in self._examples_cache:
            return self._examples_cache[dataset]

        examples: list[ExampleQuery] = []

        # Try dataset-specific examples first, then general
        for candidate in [
            self.examples_dir / dataset / "examples.json",
            self.examples_dir / f"{dataset}_examples.json",
            self.examples_dir / "examples.json",
        ]:
            if candidate.exists():
                data = json.loads(candidate.read_text(encoding="utf-8"))
                items = data if isinstance(data, list) else data.get("examples", [])
                for item in items:
                    examples.append(ExampleQuery(
                        question=item.get("question", ""),
                        sql=item.get("sql", ""),
                        tables_used=item.get("tables_used", []),
                        difficulty=item.get("difficulty", ""),
                        dataset=dataset,
                    ))
                break

        self._examples_cache[dataset] = examples
        return examples

    @staticmethod
    def _select_dynamic(
        examples: list[ExampleQuery], question: str, k: int = 3
    ) -> list[ExampleQuery]:
        """
        Select k most similar examples using a DAIL-SQL-inspired approach:
        combined question similarity + SQL skeleton similarity.

        The score is a weighted combination of:
          - Question token overlap (Jaccard + keyword weighting)
          - SQL skeleton similarity between the example's SQL and the
            structural patterns implied by the question

        This approach is more effective than pure Jaccard word overlap
        because it considers both semantic similarity (question text) and
        structural similarity (SQL patterns like GROUP BY, JOIN, etc.).
        """
        q_tokens = _tokenize(question)
        if not q_tokens:
            return examples[:k]

        # Extract SQL-relevant keywords from the question to infer structure
        q_patterns = _extract_sql_patterns(question)

        scored: list[tuple[float, ExampleQuery]] = []
        for ex in examples:
            # 1. Question similarity (weighted Jaccard)
            ex_tokens = _tokenize(ex.question)
            if not ex_tokens:
                scored.append((0.0, ex))
                continue

            intersection = q_tokens & ex_tokens
            union = q_tokens | ex_tokens
            jaccard = len(intersection) / len(union) if union else 0.0

            # Boost for matching SQL-significant keywords
            sql_keywords = {
                "count", "sum", "average", "avg", "total", "max", "min",
                "each", "per", "group", "rank", "top", "first", "last",
                "trend", "monthly", "daily", "weekly", "growth", "rate",
                "join", "compare", "between", "difference", "ratio",
                "percentage", "percent", "distinct", "unique",
                "consecutive", "running", "cumulative", "window",
                "previous", "next", "lag", "lead",
            }
            keyword_overlap = len(
                (q_tokens & ex_tokens) & sql_keywords
            )
            keyword_boost = min(keyword_overlap * 0.05, 0.15)

            question_score = jaccard + keyword_boost

            # 2. SQL skeleton similarity
            ex_patterns = _extract_sql_skeleton(ex.sql)
            skeleton_score = _pattern_similarity(q_patterns, ex_patterns)

            # 3. Combined score: 60% question, 40% skeleton
            combined = 0.6 * question_score + 0.4 * skeleton_score
            scored.append((combined, ex))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [ex for _, ex in scored[:k]]

    @staticmethod
    def _select_schema_matched(
        examples: list[ExampleQuery],
        relevant_tables: list[str],
        k: int = 3,
    ) -> list[ExampleQuery]:
        """Select examples that reference the most overlapping tables."""
        rel_set = {t.lower() for t in relevant_tables}
        if not rel_set:
            return examples[:k]

        scored: list[tuple[int, ExampleQuery]] = []
        for ex in examples:
            ex_tables = {t.lower() for t in ex.tables_used}
            overlap = len(rel_set & ex_tables)
            scored.append((overlap, ex))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [ex for _, ex in scored[:k]]

    # ------------------------------------------------------------------
    # Output format calibration
    # ------------------------------------------------------------------

    @staticmethod
    def _classify_and_calibrate(question: str) -> str:
        """
        Analyze the natural-language question and return a calibration hint
        about the expected output format based on keyword/pattern matching.

        Classification rules (checked in priority order):
        1. Single aggregate value
        2. Top-N / Ranking
        3. Time series / Trend
        4. Comparison
        5. Breakdown / Group by
        6. List / Enumeration

        Returns:
            A calibration hint string, or "" if no pattern matches.
        """
        q = question.lower()

        # 1. Single aggregate value
        aggregate_patterns = [
            "how many", "what is the total", "what is the average",
            "count of", "sum of", "what percentage",
        ]
        if any(p in q for p in aggregate_patterns):
            return (
                "This question expects a single aggregate value. "
                "Your SQL should return exactly one row."
            )

        # 2. Top-N / Ranking
        # Check for explicit "top N" or "N most/least/highest/lowest" patterns first
        top_n_match = re.search(
            r"\b(?:top|first|last)\s+(\d+)\b", q
        )
        n_ranking_match = re.search(
            r"\b(\d+)\s+(?:most|least|highest|lowest|best|worst|largest|smallest)\b", q
        )
        if top_n_match:
            n = top_n_match.group(1)
            return (
                f"This question asks for the top {n} results. "
                f"Use ORDER BY with LIMIT {n} to return exactly {n} rows."
            )
        if n_ranking_match:
            n = n_ranking_match.group(1)
            return (
                f"This question asks for {n} ranked results. "
                f"Use ORDER BY with LIMIT {n} to return exactly {n} rows."
            )

        ranking_patterns = [
            "top", "bottom", "highest", "lowest",
            "most", "least", "best", "worst",
        ]
        if any(re.search(r"\b" + re.escape(p) + r"\b", q) for p in ranking_patterns):
            return (
                "This question asks for a ranking. Use ORDER BY with LIMIT, "
                "or window functions like ROW_NUMBER() if ranking within groups."
            )

        # 3. Time series / Trend (checked before Breakdown because "by month"
        #    should be classified as time-series, not generic breakdown)
        time_patterns = [
            "over time", "trend", "monthly", "weekly", "daily",
            "year over year", "month over month",
            "by month", "by day", "by year",
        ]
        if any(p in q for p in time_patterns):
            return (
                "This question asks for a time-based analysis. "
                "Group by an appropriate time period using toStartOfMonth(), "
                "toStartOfWeek(), or toDate()."
            )

        # 4. Comparison
        comparison_patterns = [
            "compare", "difference between", "versus", "vs",
        ]
        if any(re.search(r"\b" + re.escape(p) + r"\b", q) for p in comparison_patterns):
            return (
                "This question asks for a comparison. "
                "Ensure both compared groups are represented in the output."
            )

        # 5. Breakdown / Group by
        breakdown_patterns = [
            "by", "per", "for each", "breakdown", "grouped", "distribution",
        ]
        if any(re.search(r"\b" + re.escape(p) + r"\b", q) for p in breakdown_patterns):
            return (
                "This question asks for a breakdown by category. "
                "Use GROUP BY and ensure the grouping column is in your SELECT."
            )

        # 6. List / Enumeration
        # Check for "show N" or "list N" or "find N" patterns with explicit count
        list_n_match = re.search(
            r"\b(?:show|list|find|display|give)\s+(?:me\s+)?(\d+)\b", q
        )
        if list_n_match:
            n = list_n_match.group(1)
            return (
                f"This question asks for a list of {n} records. "
                f"Select only the relevant columns and use LIMIT {n}."
            )

        list_patterns = ["list", "show", "display", "all", "find"]
        if any(re.search(r"\b" + re.escape(p) + r"\b", q) for p in list_patterns):
            return (
                "This question asks for a list of records. "
                "Select only the relevant columns. Return ALL matching rows "
                "(do NOT add a LIMIT clause unless the question specifies a count)."
            )

        return ""

    # ------------------------------------------------------------------
    # System and user message construction
    # ------------------------------------------------------------------

    @staticmethod
    def _build_system_message(dataset: str, format: SchemaFormat, prompt_version: "PromptVersion" = None) -> str:
        """Construct the system message for the LLM.

        Args:
            dataset: Dataset identifier.
            format: Schema format (unused currently, reserved for future use).
            prompt_version: Controls which guidance blocks are included.
                Defaults to PromptVersion.FULL if not specified.
        """
        if prompt_version is None:
            prompt_version = PromptVersion.FULL

        db_name = DATABASE_NAME_MAP.get(dataset, dataset)

        # Block 0 — always included: opening paragraph
        block_0 = (
            "You are an expert SQL developer specializing in ClickHouse analytical databases. "
            "Your task is to translate natural-language questions into correct, efficient "
            "ClickHouse SQL queries.\n\n"
        )

        # Block 1 — DIALECT_ONLY+: ClickHouse dialect differences
        block_1 = (
            "IMPORTANT ClickHouse differences from standard SQL:\n"
            "- No FULL OUTER JOIN support. Use LEFT JOIN + RIGHT JOIN + UNION ALL if needed.\n"
            "- String comparison is case-sensitive by default.\n"
            "- Use lagInFrame()/leadInFrame() instead of standard SQL LAG()/LEAD().\n"
            "- Array indexing is 1-based.\n"
            "- For Map columns, use bracket syntax: map_col['key'].\n"
            "- Boolean columns are UInt8 (0/1), not true/false.\n\n"
        )

        # Block 2 — always included: basic guidelines
        block_2 = (
            "Guidelines:\n"
            "- Use only the tables and columns provided in the schema below.\n"
            "- SELECT only the specific columns needed to answer the question. Do NOT include "
            "extra identifier columns (e.g., user_id, session_id, event_id) unless the "
            "question explicitly asks for them. If the question asks to 'show X and Y', your "
            "SELECT clause should contain exactly those items (plus any grouping columns). "
            "Avoid SELECT * unless the question explicitly asks for all columns.\n"
            "- Use ClickHouse SQL syntax. Key functions include: toYear(), toMonth(), "
            "toStartOfMonth(), toStartOfWeek(), dateDiff(), countIf(), sumIf(), avgIf(), "
            "quantile(), argMax(), argMin(), groupArray(), arrayJoin(), has(), mapKeys(), "
            "mapValues(), lagInFrame(), leadInFrame(), multiIf(), uniqExact(), "
            "uniqExactIf(). For Map column access use "
            "bracket syntax: column['key']. For Nullable columns use ifNull() or assume().\n"
            "- Use uniqExact(col) instead of COUNT(DISTINCT col) for exact distinct counts. "
            "For conditional distinct counts, use uniqExactIf(col, condition) instead of "
            "COUNT(DISTINCT col) with a WHERE clause or CASE expression.\n"
            "- In ClickHouse, integer division truncates (e.g., 10/3 = 3). For decimal "
            "results, cast one operand using toFloat64() or multiply by 1.0.\n"
            "- When computing rates, ratios, or percentages, express them as percentages "
            "(multiply by 100.0), not as fractions. For example, use "
            "countIf(x) * 100.0 / count() to get 8.2 (percent), not countIf(x) / count() "
            "which gives 0.082.\n"
            "- When computing averages or ratios, round to 2 decimal places using round(expr, 2) "
            "unless the question specifies different precision.\n"
            "- Return ONLY the SQL query without any explanation or commentary.\n"
            "- Do not wrap the SQL in markdown code fences.\n"
            "- If the question is ambiguous, make reasonable assumptions and note them "
            "as SQL comments.\n"
            "- Prefer efficient query patterns: avoid unnecessary subqueries, use "
            "appropriate aggregation functions, and leverage ClickHouse-specific "
            "optimizations where applicable.\n"
            f"- The database is: {db_name}\n\n"
        )

        # Block 3 — always included: LIMIT clause guidance
        block_3 = (
            "LIMIT clause guidance:\n"
            "- When the question asks for 'top N', 'first N', 'last N', 'N most/least', "
            "or implies a specific number of results, ALWAYS include ORDER BY with LIMIT N "
            "in your query.\n"
            "- Do NOT add LIMIT unless the question explicitly mentions a number or says "
            "'top', 'first', 'last', etc. If the question asks to 'show', 'list', or 'find' "
            "records matching a condition, return ALL matching rows (no LIMIT).\n"
            "- Pay careful attention to the exact number mentioned in the question for "
            "LIMIT values.\n\n"
        )

        # Block 4 — JOINS+: complex JOIN guidance
        block_4 = (
            "Complex JOIN guidance:\n"
            "- For multi-table JOINs, ALWAYS use table aliases and qualify every column "
            "reference (e.g., e.user_id, u.name, s.session_id).\n"
            "- Choose the correct JOIN type:\n"
            "  * INNER JOIN: when you only want rows that match in both tables.\n"
            "  * LEFT JOIN: when you want all rows from the left table even without matches.\n"
            "  * If a filter like 'WHERE col IS NOT NULL' would eliminate unmatched rows, "
            "consider using INNER JOIN instead of LEFT JOIN + WHERE filter.\n"
            "- Use ClickHouse conditional aggregation (countIf, sumIf, avgIf) instead of "
            "CASE WHEN inside aggregate functions.\n"
            "- Do NOT add extra columns from joined tables unless the question asks for them. "
            "For example, if the question asks 'show revenue by country', include country and "
            "revenue, not also user_id, session_id, etc.\n"
            "- Table relationships: events.session_id -> sessions.session_id, "
            "events.user_id -> users.user_id, sessions.user_id -> users.user_id, "
            "events.properties['product_id'] -> products.product_id (cast with toUInt64OrZero).\n"
            "- Revenue data is in events.properties['revenue'] (Map column), not in the products table. "
            "Use toFloat64OrZero(events.properties['revenue']) to extract revenue amounts.\n\n"
        )

        # Block 5 — WINDOW+: window function guidance
        block_5 = (
            "Window function guidance for ClickHouse:\n"
            "- Use ROW_NUMBER(), RANK(), DENSE_RANK(), NTILE() for ranking and bucketing.\n"
            "- CRITICAL: Use lagInFrame() and leadInFrame() instead of LAG() and LEAD(). "
            "Standard SQL LAG()/LEAD() are NOT supported in ClickHouse.\n"
            "- For running totals: SUM(col) OVER (PARTITION BY x ORDER BY y ROWS BETWEEN "
            "UNBOUNDED PRECEDING AND CURRENT ROW).\n"
            "- For moving averages: AVG(col) OVER (PARTITION BY x ORDER BY y ROWS BETWEEN "
            "N PRECEDING AND CURRENT ROW).\n"
            "- LAST_VALUE() requires an explicit frame: ROWS BETWEEN UNBOUNDED PRECEDING "
            "AND UNBOUNDED FOLLOWING. The default frame excludes rows after the current row.\n"
            "- Window function results cannot be used in WHERE/HAVING directly; wrap in a "
            "subquery: SELECT * FROM (SELECT ..., ROW_NUMBER() OVER (...) AS rn FROM t) WHERE rn <= N.\n"
            "- You can define named windows: SELECT ... OVER w FROM t WINDOW w AS (PARTITION BY x).\n"
            "- Window functions and aggregate functions cannot be nested.\n\n"
        )

        # Block 6 — WINDOW+: common mistakes to avoid
        block_6 = (
            "Common mistakes to avoid:\n"
            "- Do NOT use SELECT * when specific columns are asked for.\n"
            "- Do NOT forget GROUP BY when using aggregate functions with non-aggregated columns.\n"
            "- Do NOT use standard SQL LAG()/LEAD(); use lagInFrame()/leadInFrame() in ClickHouse.\n"
            "- Do NOT divide integers expecting decimal results; cast with toFloat64() first.\n"
            "- Do NOT use FULL OUTER JOIN; ClickHouse does not support it.\n"
            "- Do NOT forget to qualify table names with the database prefix "
            f"(e.g., {db_name}.events, not just events).\n"
            "- Always generate a COMPLETE SQL statement. Never leave trailing commas, "
            "incomplete SELECT lists, or missing FROM/GROUP BY/ORDER BY clauses.\n"
            "- Do NOT nest aggregate functions inside other aggregate functions "
            "(e.g., MAX(COUNT(...)) is invalid). Instead, use a subquery to compute "
            "the inner aggregation first, then apply the outer aggregation.\n"
            "- When using window functions over aggregated data, ALWAYS aggregate in a "
            "subquery or CTE first, then apply window functions to the aggregated result. "
            "For example: SELECT month, total, lagInFrame(total) OVER (...) FROM "
            "(SELECT toStartOfMonth(ts) AS month, count() AS total FROM t GROUP BY month).\n\n"
        )

        # Block 7 — FULL only: ClickHouse-specific function reference
        block_7 = (
            "ClickHouse-specific function reference:\n"
            "- argMax(value_col, sort_col) returns the value of value_col at the row where "
            "sort_col is maximum. Similarly, argMin(value_col, sort_col) returns value_col "
            "at the row where sort_col is minimum. Use these instead of "
            "ROW_NUMBER() + subquery when you just need one value at the max/min.\n"
            "- For multiple quantiles in one query, use quantiles(0.25, 0.5, 0.75)(col) which "
            "returns an Array. Do NOT use separate quantile(0.25)(col), quantile(0.5)(col) calls.\n"
            "- Type conversion: prefer toInt8(), toFloat64(), toString() over CAST(x AS Type).\n"
            "- For safe conversion from strings: toFloat64OrZero(), toUInt64OrZero().\n"
            "- Array functions: arrayJoin() to unnest, arrayFilter(), arrayMap(), length() for array size.\n"
            "- Map functions: use bracket syntax map_col['key'], mapKeys(), mapValues().\n"
            "- String matching: use LIKE or match() for regex. String comparison is case-sensitive.\n"
            "- Use groupArray(col) to aggregate values into an array. Use arraySort() to sort arrays."
        )

        # Assemble blocks based on prompt_version
        # MINIMAL:      Block 0 + Block 2 + Block 3
        # DIALECT_ONLY: MINIMAL + Block 1
        # JOINS:        DIALECT_ONLY + Block 4
        # WINDOW:       JOINS + Block 5 + Block 6
        # FULL:         WINDOW + Block 7

        parts = [block_0]

        if prompt_version.value in ("dialect_only", "joins", "window", "full"):
            parts.append(block_1)

        parts.append(block_2)
        parts.append(block_3)

        if prompt_version.value in ("joins", "window", "full"):
            parts.append(block_4)

        if prompt_version.value in ("window", "full"):
            parts.append(block_5)
            parts.append(block_6)

        if prompt_version.value == "full":
            parts.append(block_7)

        return "".join(parts)

    def _build_user_message(
        self,
        question: str,
        schema_text: str,
        examples_text: str,
        metadata: MetadataLevel,
        dataset: str = "",
    ) -> str:
        """Assemble the user message from schema, examples, and question."""
        parts: list[str] = []

        parts.append("### Database Schema")
        parts.append(schema_text)
        parts.append("")

        # Add relationship hints if available
        if dataset:
            relationship_text = self._build_relationship_hints(dataset)
            if relationship_text:
                parts.append(relationship_text)
                parts.append("")

        # Add output format calibration hint if applicable
        calibration_hint = self._classify_and_calibrate(question)
        if calibration_hint:
            parts.append("### Output Guidance")
            parts.append(calibration_hint)
            parts.append("")

        if examples_text:
            parts.append("### Examples")
            parts.append(examples_text)

        parts.append("### Question")
        parts.append(question)
        parts.append("")
        parts.append("### SQL Query")

        return "\n".join(parts)

    def _build_relationship_hints(self, dataset: str) -> str:
        """
        Build a table relationships section from the JSON schema file.

        Loads relationship data from schemas/{dataset}/json_schema.json,
        caching the result. Returns empty string if no relationships found.

        Produces explicit JOIN templates with fully-qualified table names
        so the LLM can copy them directly into generated SQL.
        """
        if dataset in self._relationships_cache:
            relationships = self._relationships_cache[dataset]
        else:
            relationships = []
            for filename in ["json_schema.json", "schema_json.json"]:
                json_path = self.schemas_dir / dataset / filename
                if json_path.exists():
                    try:
                        data = json.loads(json_path.read_text(encoding="utf-8"))
                        if isinstance(data, dict):
                            relationships = data.get("relationships", [])
                    except Exception as e:
                        logger.warning(
                            "Failed to load relationships from %s: %s", json_path, e
                        )
                    break
            self._relationships_cache[dataset] = relationships

        if not relationships:
            return ""

        lines: list[str] = [
            "### Table Relationships (JOIN conditions)",
            "When joining tables, use these conditions:",
        ]
        for rel in relationships:
            from_ref = rel.get("from", "")   # e.g. "analytics.events.user_id"
            to_ref = rel.get("to", "")       # e.g. "analytics.users.user_id"
            if not from_ref or not to_ref:
                continue

            from_parts = from_ref.split(".")  # ["analytics", "events", "user_id"]
            to_parts = to_ref.split(".")      # ["analytics", "users", "user_id"]

            if len(from_parts) < 3 or len(to_parts) < 3:
                # Fallback: not enough parts to build db.table.column
                lines.append(f"- {from_ref} = {to_ref}")
                continue

            from_db, from_table, from_col = from_parts[-3], from_parts[-2], from_parts[-1]
            to_db, to_table, to_col = to_parts[-3], to_parts[-2], to_parts[-1]

            # Fully-qualified references: db.table and db.table.column
            to_qualified_table = f"{to_db}.{to_table}"
            from_qualified_col = f"{from_db}.{from_table}.{from_col}"
            to_qualified_col = f"{to_db}.{to_table}.{to_col}"

            lines.append(
                f"- {from_table} \u2194 {to_table}: "
                f"JOIN {to_qualified_table} "
                f"ON {from_qualified_col} = {to_qualified_col}"
            )

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Progressive expansion
    # ------------------------------------------------------------------

    def _make_expand_fn(
        self,
        question: str,
        dataset: str,
        format: SchemaFormat,
        metadata: MetadataLevel,
        examples: ExampleStrategy,
        current_table_count: int,
        current_column_count: int,
    ) -> Callable[[], PromptResult]:
        """
        Return a callable that, when invoked, rebuilds the prompt with the full
        schema (expanding from the progressive minimal schema).
        """
        def expand() -> PromptResult:
            return self.build_prompt(
                question=question,
                dataset=dataset,
                format=format,
                scope=SchemaScope.FULL,
                metadata=metadata,
                examples=examples,
            )
        return expand

    # ------------------------------------------------------------------
    # Token estimation
    # ------------------------------------------------------------------

    def _estimate_tokens(self, text: str) -> int:
        """
        Estimate token count using a character-based heuristic.
        Claude's tokenizer averages ~3.5 characters per token for English text
        with SQL and schema content.
        """
        if not text:
            return 0
        return max(1, math.ceil(len(text) / self.CHARS_PER_TOKEN))


# ---------------------------------------------------------------------------
# Module-level utility functions
# ---------------------------------------------------------------------------

def _tokenize(text: str) -> set[str]:
    """
    Simple whitespace + punctuation tokenizer for similarity computation.
    Returns a set of lowercased word tokens.
    """
    return set(re.findall(r"[a-z0-9_]+", text.lower()))


def _extract_sql_patterns(question: str) -> set[str]:
    """
    Infer SQL structural patterns from a natural-language question.

    Maps question keywords/phrases to SQL constructs so that examples
    using similar SQL structures score higher.

    Returns a set of abstract pattern labels.
    """
    q = question.lower()
    patterns: set[str] = set()

    # Aggregation patterns
    agg_map = {
        "count": "AGG_COUNT", "how many": "AGG_COUNT",
        "total": "AGG_SUM", "sum": "AGG_SUM",
        "average": "AGG_AVG", "avg": "AGG_AVG", "mean": "AGG_AVG",
        "maximum": "AGG_MAX", "max": "AGG_MAX", "highest": "AGG_MAX",
        "minimum": "AGG_MIN", "min": "AGG_MIN", "lowest": "AGG_MIN",
    }
    for keyword, pattern in agg_map.items():
        if keyword in q:
            patterns.add(pattern)
            patterns.add("HAS_AGGREGATION")

    # GROUP BY indicators
    group_keywords = ["for each", "per ", "by ", "grouped", "breakdown", "distribution"]
    if any(k in q for k in group_keywords):
        patterns.add("HAS_GROUP_BY")

    # Window function indicators
    window_keywords = [
        "rank", "running", "cumulative", "row number", "consecutive",
        "previous", "next", "lag", "lead", "partition", "quartile",
        "ntile", "dense rank", "over time within",
    ]
    if any(k in q for k in window_keywords):
        patterns.add("HAS_WINDOW")

    # JOIN indicators
    join_keywords = ["join", "across", "from both", "combined with", "along with"]
    # Multi-table references in question
    table_names = ["users", "events", "sessions", "products"]
    mentioned_tables = [t for t in table_names if t in q]
    if len(mentioned_tables) >= 2 or any(k in q for k in join_keywords):
        patterns.add("HAS_JOIN")

    # Time-series indicators
    time_keywords = [
        "monthly", "daily", "weekly", "yearly", "over time", "trend",
        "month", "day", "week", "year", "date", "time series",
        "growth", "month over month", "year over year",
    ]
    if any(k in q for k in time_keywords):
        patterns.add("HAS_TIME")

    # ORDER BY / LIMIT
    if re.search(r"\b(?:top|first|last|bottom)\s+\d+", q):
        patterns.add("HAS_LIMIT")
        patterns.add("HAS_ORDER")
    if any(k in q for k in ["order", "sort", "rank", "highest", "lowest", "most", "least"]):
        patterns.add("HAS_ORDER")

    # Conditional aggregation
    if any(k in q for k in ["rate", "ratio", "percentage", "percent", "proportion", "share"]):
        patterns.add("HAS_CONDITIONAL_AGG")

    # Subquery / CTE patterns
    if any(k in q for k in ["among", "within the", "of those", "that have", "who have"]):
        patterns.add("HAS_SUBQUERY")

    return patterns


def _extract_sql_skeleton(sql: str) -> set[str]:
    """
    Extract structural patterns from an actual SQL query.

    Abstracts away table/column names to produce a set of pattern labels
    describing the query's structure (what SQL constructs it uses).

    Returns a set of abstract pattern labels matching those from
    ``_extract_sql_patterns``.
    """
    s = sql.upper()
    patterns: set[str] = set()

    # Aggregation functions
    if re.search(r"\bCOUNT\s*\(", s):
        patterns.add("AGG_COUNT")
        patterns.add("HAS_AGGREGATION")
    if re.search(r"\bSUM\s*\(", s):
        patterns.add("AGG_SUM")
        patterns.add("HAS_AGGREGATION")
    if re.search(r"\bAVG\s*\(", s):
        patterns.add("AGG_AVG")
        patterns.add("HAS_AGGREGATION")
    if re.search(r"\bMAX\s*\(", s):
        patterns.add("AGG_MAX")
        patterns.add("HAS_AGGREGATION")
    if re.search(r"\bMIN\s*\(", s):
        patterns.add("AGG_MIN")
        patterns.add("HAS_AGGREGATION")

    # Conditional aggregation
    if re.search(r"\b(?:COUNTIF|SUMIF|AVGIF|UNIQEXACTIF)\s*\(", s):
        patterns.add("HAS_CONDITIONAL_AGG")
        patterns.add("HAS_AGGREGATION")

    # GROUP BY
    if re.search(r"\bGROUP\s+BY\b", s):
        patterns.add("HAS_GROUP_BY")

    # Window functions
    if re.search(r"\bOVER\s*\(", s):
        patterns.add("HAS_WINDOW")

    # JOINs
    if re.search(r"\bJOIN\b", s):
        patterns.add("HAS_JOIN")

    # Time functions
    time_funcs = [
        "TOSTARTOFMONTH", "TOSTARTOFWEEK", "TODATE", "TOYEAR",
        "TOMONTH", "DATEDIFF", "TOSTARTOFDAY",
    ]
    if any(f in s for f in time_funcs):
        patterns.add("HAS_TIME")

    # ORDER BY / LIMIT
    if re.search(r"\bORDER\s+BY\b", s):
        patterns.add("HAS_ORDER")
    if re.search(r"\bLIMIT\b", s):
        patterns.add("HAS_LIMIT")

    # Subquery / CTE
    if re.search(r"\bWITH\b", s) or s.count("SELECT") > 1:
        patterns.add("HAS_SUBQUERY")

    return patterns


def _pattern_similarity(patterns_a: set[str], patterns_b: set[str]) -> float:
    """
    Compute similarity between two sets of SQL patterns using Jaccard.

    Returns 0.0 if both sets are empty (no patterns detected).
    """
    if not patterns_a and not patterns_b:
        return 0.0
    union = patterns_a | patterns_b
    if not union:
        return 0.0
    intersection = patterns_a & patterns_b
    return len(intersection) / len(union)


def _split_columns(columns_text: str) -> list[str]:
    """
    Split a DDL column list on commas, respecting parenthesized type arguments
    like Nullable(UInt32) or Array(Tuple(String, Int64)).
    """
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for char in columns_text:
        if char == "(":
            depth += 1
            current.append(char)
        elif char == ")":
            depth -= 1
            current.append(char)
        elif char == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    if current:
        parts.append("".join(current))
    return parts


def _mask_sql_values(sql: str) -> str:
    """Mask literal values in SQL with placeholders, following DAIL-SQL approach.

    Replaces string literals, numeric literals in WHERE/HAVING conditions,
    and LIMIT values with generic placeholders to help the model focus on
    SQL structure rather than specific values.
    """
    # Mask string literals: 'value' -> 'VALUE'
    masked = re.sub(r"'[^']*'", "'VALUE'", sql)
    # Mask numeric literals after comparison operators: = 42 -> = NUMBER
    masked = re.sub(r"(=|<|>|<=|>=|<>|!=)\s*(\d+(?:\.\d+)?)", r"\1 NUMBER", masked)
    # Mask LIMIT values: LIMIT 10 -> LIMIT N
    masked = re.sub(r"\bLIMIT\s+\d+", "LIMIT N", masked, flags=re.IGNORECASE)
    return masked
