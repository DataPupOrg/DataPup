"""
Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases
Evaluation Framework

This package provides the complete evaluation pipeline for the VLDB paper on
schema-aware prompt engineering strategies for ClickHouse SQL generation
using Claude models.

Modules:
    prompt_builder    - Construct prompts from schema, metadata, and examples
    llm_caller        - Anthropic Claude API wrapper with retry logic
    sql_executor      - ClickHouse SQL execution and result capture
    result_comparator - Compare predicted vs gold SQL results
    schema_linker     - Extract and compare schema references in SQL
    metrics           - Compute and aggregate evaluation metrics
    experiment_runner - Orchestrate experiment phases with checkpointing
"""

__version__ = "1.0.0"
__paper__ = "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases (VLDB 2026)"
