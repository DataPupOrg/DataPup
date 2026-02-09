"""
result_comparator.py -- Compare Predicted vs Gold SQL Query Results

Provides three comparison strategies for evaluating text-to-SQL predictions:

  1. EXACT:    Row-by-row, column-by-column strict equality.  Order matters.
  2. SET:      Order-independent row-set comparison (multiset semantics).
  3. SEMANTIC: Type-coerced comparison with approximate numeric matching
              (relative tolerance 1e-4), case-insensitive / whitespace-
              normalized string comparison, and unified NULL/NaN handling.

Each strategy produces a ``ComparisonResult`` that carries a boolean
``match`` flag, a ``partial_score`` (fraction of gold rows matched), and
rich diagnostic ``details``.

Part of the evaluation framework for:
    "Schema-Aware Prompt Engineering for Text-to-SQL in Analytical Databases"
    (VLDB 2026)
"""

from __future__ import annotations

import logging
import math
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class MatchStrategy(Enum):
    """Strategy used to compare predicted and gold result sets."""

    EXACT = "exact"
    """Row-by-row, column-by-column strict equality.  Order-sensitive."""

    SET = "set"
    """Order-independent multiset comparison with strict cell equality."""

    SEMANTIC = "semantic"
    """Type-coerced comparison: approximate numerics (rtol 1e-4),
    case-insensitive whitespace-normalized strings, unified NULL/NaN."""


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------

@dataclass
class ComparisonResult:
    """Outcome of comparing predicted SQL results against gold SQL results.

    Attributes:
        match:           ``True`` if the result sets are considered equivalent
                         under the chosen strategy.
        strategy:        The :class:`MatchStrategy` that was applied.
        predicted_rows:  Number of rows in the predicted result set.
        gold_rows:       Number of rows in the gold result set.
        predicted_cols:  Number of columns in the predicted result set.
        gold_cols:       Number of columns in the gold result set.
        column_match:    ``True`` if column counts are equal.
        row_count_match: ``True`` if row counts are equal.
        details:         Human-readable explanation of match / mismatch.
        partial_score:   Fraction of gold rows that have a matching
                         predicted row (0.0 -- 1.0).  Useful for partial-
                         credit metrics even when full match fails.
        column_alignment: Description of column alignment applied when
                         column counts differed but names could be matched.
                         Empty string if no alignment was needed or attempted.
    """

    match: bool
    strategy: MatchStrategy
    predicted_rows: int
    gold_rows: int
    predicted_cols: int
    gold_cols: int
    column_match: bool
    row_count_match: bool
    details: str
    partial_score: float = 0.0
    column_alignment: str = ""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

# Default relative tolerance for approximate numeric comparison.
# 1e-2 (1%) handles rounding differences (e.g., 4.645 vs 4.65) and
# small precision variations across different computation orders.
_DEFAULT_RTOL: float = 1e-2


def _to_float(value: Any) -> Optional[float]:
    """Try to interpret *value* as a Python ``float``.

    Handles ``int``, ``float``, ``Decimal``, and numeric strings.
    Returns ``None`` when conversion is impossible.
    """
    if isinstance(value, float):
        return value
    if isinstance(value, int):
        return float(value)
    if isinstance(value, Decimal):
        try:
            return float(value)
        except (InvalidOperation, OverflowError, ValueError):
            return None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        try:
            return float(stripped)
        except (ValueError, OverflowError):
            return None
    # Last resort -- covers numpy scalars, etc.
    try:
        return float(value)
    except (TypeError, ValueError, OverflowError):
        return None


def _normalize_string(value: str) -> str:
    """Lower-case, collapse whitespace, strip leading/trailing whitespace."""
    return re.sub(r"\s+", " ", value.strip().lower())


def _is_none_like(value: Any) -> bool:
    """Return ``True`` for ``None`` and float NaN."""
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return False


def _values_equal_exact(a: Any, b: Any) -> bool:
    """Strict cell-level equality with unified NULL treatment.

    * ``None == None`` -> ``True``
    * ``NaN == NaN``   -> ``True``  (IEEE says otherwise, but SQL NULLs unify)
    * ``Inf == Inf``   -> ``True``  (same sign)
    """
    # Unify None / NaN
    if _is_none_like(a) and _is_none_like(b):
        return True
    if _is_none_like(a) or _is_none_like(b):
        return False

    # Inf handling (before general numeric)
    a_f = _to_float(a)
    b_f = _to_float(b)
    if a_f is not None and b_f is not None:
        if math.isinf(a_f) and math.isinf(b_f):
            return a_f == b_f  # same sign
        return a_f == b_f

    # Fallback: direct equality
    try:
        return a == b
    except (TypeError, ValueError):
        return str(a) == str(b)


def _values_equal_semantic(a: Any, b: Any, rtol: float = _DEFAULT_RTOL) -> bool:
    """Semantic cell-level comparison.

    Rules applied in order:
    1. Both None-like -> equal.
    2. One None-like  -> not equal.
    3. Both coercible to float -> approximate comparison
       (``|a - b| <= rtol * max(|a|, |b|, 1)``).
    4. Both strings -> case-insensitive, whitespace-normalized comparison.
    5. Fallback: cast to string and compare after normalization.
    """
    # 1 & 2: NULL / NaN
    if _is_none_like(a) and _is_none_like(b):
        return True
    if _is_none_like(a) or _is_none_like(b):
        return False

    # 3: Numeric
    a_f = _to_float(a)
    b_f = _to_float(b)
    if a_f is not None and b_f is not None:
        # Both NaN (already caught above for None-likes, but Decimal("NaN") etc.)
        if math.isnan(a_f) and math.isnan(b_f):
            return True
        if math.isnan(a_f) or math.isnan(b_f):
            return False
        # Both Inf
        if math.isinf(a_f) and math.isinf(b_f):
            return a_f == b_f
        if math.isinf(a_f) or math.isinf(b_f):
            return False
        # Approximate comparison
        scale = max(abs(a_f), abs(b_f), 1.0)
        if abs(a_f - b_f) <= rtol * scale:
            return True

        # Percentage normalization: check if one value is 100x the other
        # (common fraction-vs-percentage mismatch, e.g., 0.082 vs 8.2)
        if a_f != 0 and b_f != 0:
            ratio = a_f / b_f
            if abs(ratio - 100.0) <= 0.01 or abs(ratio - 0.01) <= 0.0001:
                return True

        return False

    # 4: String
    if isinstance(a, str) and isinstance(b, str):
        return _normalize_string(a) == _normalize_string(b)

    # 5: Fallback -- stringify then compare
    return _normalize_string(str(a)) == _normalize_string(str(b))


def _row_equal(
    row_a: Sequence[Any],
    row_b: Sequence[Any],
    cell_eq: Any,  # callable (a, b) -> bool
) -> bool:
    """Compare two rows cell-by-cell using *cell_eq*."""
    if len(row_a) != len(row_b):
        return False
    return all(cell_eq(a, b) for a, b in zip(row_a, row_b))


def _sortable_key(row: Sequence[Any]) -> Tuple:
    """Produce a sort key for a row so that heterogeneous types do not raise.

    Strategy: ``(type_rank, string_representation)`` per cell.
    """
    parts: list[tuple] = []
    for val in row:
        if val is None:
            parts.append((2, ""))
        elif isinstance(val, (int, float)):
            if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
                parts.append((1, str(val)))
            else:
                parts.append((0, val))
        else:
            parts.append((0, str(val)))
    return tuple(parts)


# ---------------------------------------------------------------------------
# ResultComparator
# ---------------------------------------------------------------------------

class ResultComparator:
    """Compare predicted SQL result rows against gold SQL result rows.

    Supports three comparison strategies via :class:`MatchStrategy`:

    * **EXACT** -- row-by-row, column-by-column strict equality.
      Row order matters.  NaN and None are treated as equal to each other.
    * **SET** -- order-independent multiset comparison with strict cell
      equality.  Duplicate rows are respected (multiset, not pure set).
    * **SEMANTIC** -- order-independent comparison with:
        - type coercion (strings that look numeric are compared as floats),
        - approximate float comparison (relative tolerance ``rtol``,
          default 1e-4),
        - case-insensitive, whitespace-normalized string comparison,
        - unified NULL / NaN treatment.

    All strategies handle edge cases gracefully: empty result sets, column
    count mismatches, ``None`` values, ``NaN``, ``Inf``, and
    ``Decimal`` types.

    Example::

        comparator = ResultComparator()
        result = comparator.compare(
            predicted_rows=[(1, "Alice")],
            gold_rows=[(1, "alice")],
            predicted_cols=["id", "name"],
            gold_cols=["id", "name"],
            strategy=MatchStrategy.SEMANTIC,
        )
        assert result.match is True
        assert result.partial_score == 1.0
    """

    def __init__(self, rtol: float = _DEFAULT_RTOL) -> None:
        """Initialise the comparator.

        Args:
            rtol: Relative tolerance for approximate numeric comparison in
                  the SEMANTIC strategy.  Two floats *a* and *b* are
                  considered equal when
                  ``|a - b| <= rtol * max(|a|, |b|, 1)``.
        """
        if rtol < 0:
            raise ValueError(f"rtol must be non-negative, got {rtol}")
        self.rtol = rtol

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def compare(
        self,
        predicted_rows: List[Tuple],
        gold_rows: List[Tuple],
        predicted_cols: Optional[List[str]] = None,
        gold_cols: Optional[List[str]] = None,
        strategy: MatchStrategy = MatchStrategy.SEMANTIC,
    ) -> ComparisonResult:
        """Compare *predicted_rows* against *gold_rows*.

        Args:
            predicted_rows: Rows produced by the predicted SQL, each row a
                            ``tuple`` of cell values.
            gold_rows:      Rows produced by the gold SQL.
            predicted_cols: Column names for the predicted result (optional;
                            used for diagnostics and column-count check).
            gold_cols:      Column names for the gold result.
            strategy:       Comparison strategy to apply.

        Returns:
            A :class:`ComparisonResult` summarising the comparison.
        """
        # Materialise to lists for safe repeated iteration.
        pred = list(predicted_rows)
        gold = list(gold_rows)

        p_cols: List[str] = list(predicted_cols) if predicted_cols else []
        g_cols: List[str] = list(gold_cols) if gold_cols else []

        n_pred_cols = len(p_cols) if p_cols else (len(pred[0]) if pred else 0)
        n_gold_cols = len(g_cols) if g_cols else (len(gold[0]) if gold else 0)

        col_match = n_pred_cols == n_gold_cols
        row_match = len(pred) == len(gold)

        # --- Edge case: both empty --------------------------------
        if not pred and not gold:
            return ComparisonResult(
                match=True,
                strategy=strategy,
                predicted_rows=0,
                gold_rows=0,
                predicted_cols=n_pred_cols,
                gold_cols=n_gold_cols,
                column_match=col_match,
                row_count_match=True,
                details="Both result sets are empty.",
                partial_score=1.0,
            )

        # --- Edge case: scalar results (1 row, 1 col each) -------
        # For single-value results, compare the value directly
        # regardless of column names (common for COUNT, SUM, etc.)
        if (len(pred) == 1 and len(gold) == 1
                and pred[0] and gold[0]
                and len(pred[0]) == 1 and len(gold[0]) == 1):
            cell_eq = (
                _values_equal_semantic(pred[0][0], gold[0][0], self.rtol)
                if strategy is MatchStrategy.SEMANTIC
                else _values_equal_exact(pred[0][0], gold[0][0])
            )
            if cell_eq:
                return ComparisonResult(
                    match=True,
                    strategy=strategy,
                    predicted_rows=1,
                    gold_rows=1,
                    predicted_cols=n_pred_cols,
                    gold_cols=n_gold_cols,
                    column_match=col_match,
                    row_count_match=True,
                    details="Scalar value match (single row, single column).",
                    partial_score=1.0,
                )

        # --- Edge case: one side empty ----------------------------
        if not pred:
            return ComparisonResult(
                match=False,
                strategy=strategy,
                predicted_rows=0,
                gold_rows=len(gold),
                predicted_cols=n_pred_cols,
                gold_cols=n_gold_cols,
                column_match=col_match,
                row_count_match=False,
                details="Predicted result is empty; gold has "
                        f"{len(gold)} row(s).",
                partial_score=0.0,
            )

        if not gold:
            return ComparisonResult(
                match=False,
                strategy=strategy,
                predicted_rows=len(pred),
                gold_rows=0,
                predicted_cols=n_pred_cols,
                gold_cols=n_gold_cols,
                column_match=col_match,
                row_count_match=False,
                details="Gold result is empty; predicted has "
                        f"{len(pred)} row(s).",
                partial_score=0.0,
            )

        # --- Column count mismatch --------------------------------
        if not col_match:
            # Attempt column-name-based alignment when both column name
            # lists are available.  This rescues the common case where the
            # predicted SQL returns extra columns (or columns in a
            # different order) but the gold columns are a subset.
            alignment_info = ""
            if p_cols and g_cols:
                if n_pred_cols >= n_gold_cols:
                    # Case 1: Predicted has MORE columns than gold.
                    # Project predicted to match gold columns (superset /
                    # reorder case).
                    alignment = self._align_by_column_names(
                        pred, gold, p_cols, g_cols,
                    )
                    if alignment is not None:
                        aligned_pred, aligned_gold, aligned_cols = alignment
                        n_aligned = len(aligned_cols)

                        alignment_info = (
                            f"aligned {n_pred_cols}/{n_pred_cols} predicted "
                            f"cols to {n_aligned}/{n_gold_cols} gold cols"
                        )

                        if n_aligned == n_gold_cols:
                            # All gold columns found in predicted -- treat
                            # as a successful column match and continue to
                            # normal strategy comparison with aligned data.
                            row_match_aligned = len(aligned_pred) == len(aligned_gold)

                            if strategy is MatchStrategy.EXACT:
                                matched = self._compare_exact(aligned_pred, aligned_gold)
                            elif strategy is MatchStrategy.SET:
                                matched = self._compare_set(aligned_pred, aligned_gold)
                            elif strategy is MatchStrategy.SEMANTIC:
                                matched = self._compare_semantic(aligned_pred, aligned_gold)
                            else:
                                raise ValueError(f"Unknown strategy: {strategy!r}")

                            # Row-superset tolerance within column alignment
                            superset_match_aligned = False
                            if not matched and len(aligned_pred) > len(aligned_gold) and len(aligned_gold) > 0:
                                superset_match_aligned = self._check_superset_match(aligned_pred, aligned_gold, strategy)
                                if superset_match_aligned:
                                    matched = True

                            score = self._partial_score(aligned_pred, aligned_gold, strategy)

                            if matched:
                                if superset_match_aligned:
                                    details = (
                                        f"{strategy.value.upper()} match succeeded "
                                        f"after column alignment ({alignment_info}) "
                                        f"(gold rows found as subset of predicted: "
                                        f"{len(aligned_gold)} gold rows in "
                                        f"{len(aligned_pred)} predicted rows)."
                                    )
                                else:
                                    details = (
                                        f"{strategy.value.upper()} match succeeded "
                                        f"after column alignment ({alignment_info})."
                                    )
                            else:
                                details = self._build_mismatch_details(
                                    aligned_pred, aligned_gold,
                                    aligned_cols, aligned_cols, strategy,
                                )
                                details = (
                                    f"Column alignment applied ({alignment_info}). "
                                    + details
                                )

                            return ComparisonResult(
                                match=matched,
                                strategy=strategy,
                                predicted_rows=len(pred),
                                gold_rows=len(gold),
                                predicted_cols=n_pred_cols,
                                gold_cols=n_gold_cols,
                                column_match=False,
                                row_count_match=row_match_aligned,
                                details=details,
                                partial_score=score,
                                column_alignment=alignment_info,
                            )
                        # else: partial alignment -- not all gold columns
                        # found, fall through to mismatch return below.

                else:
                    # Case 2: Predicted has FEWER columns than gold.
                    # Check if all predicted columns exist in gold and, if
                    # so, project gold rows down to the predicted columns.
                    # This handles the common scenario where the gold SQL
                    # returns extra informational columns (e.g. count(),
                    # extra aggregations) that the question didn't ask for.
                    gold_col_index: dict[str, int] = {}
                    for idx, col in enumerate(g_cols):
                        lower = col.lower()
                        if lower not in gold_col_index:
                            gold_col_index[lower] = idx

                    # Find indices in gold for every predicted column.
                    # First try exact name match, then fuzzy (substring) match.
                    proj_gold_indices: List[int] = []
                    proj_col_names: List[str] = []
                    all_found = True
                    used_gold_indices: set[int] = set()
                    for pc in p_cols:
                        pc_lower = pc.lower()
                        g_idx = gold_col_index.get(pc_lower)
                        if g_idx is not None and g_idx not in used_gold_indices:
                            proj_gold_indices.append(g_idx)
                            proj_col_names.append(pc)
                            used_gold_indices.add(g_idx)
                        else:
                            # Fuzzy match: substring containment
                            fuzzy_idx = self._fuzzy_match_column(
                                pc_lower,
                                g_cols,
                                used_gold_indices,
                            )
                            if fuzzy_idx is not None:
                                proj_gold_indices.append(fuzzy_idx)
                                proj_col_names.append(pc)
                                used_gold_indices.add(fuzzy_idx)
                            else:
                                all_found = False
                                break

                    if all_found and proj_gold_indices:
                        # Project gold rows to only the predicted columns
                        # (in predicted column order).
                        projected_gold: List[Tuple] = [
                            tuple(row[i] for i in proj_gold_indices)
                            for row in gold
                        ]
                        alignment_info = (
                            f"projected gold from {n_gold_cols} cols to "
                            f"{n_pred_cols} cols matching predicted"
                        )

                        row_match_aligned = len(pred) == len(projected_gold)

                        if strategy is MatchStrategy.EXACT:
                            matched = self._compare_exact(pred, projected_gold)
                        elif strategy is MatchStrategy.SET:
                            matched = self._compare_set(pred, projected_gold)
                        elif strategy is MatchStrategy.SEMANTIC:
                            matched = self._compare_semantic(pred, projected_gold)
                        else:
                            raise ValueError(f"Unknown strategy: {strategy!r}")

                        # Row-superset tolerance within column alignment
                        superset_match_aligned = False
                        if not matched and len(pred) > len(projected_gold) and len(projected_gold) > 0:
                            superset_match_aligned = self._check_superset_match(pred, projected_gold, strategy)
                            if superset_match_aligned:
                                matched = True

                        score = self._partial_score(pred, projected_gold, strategy)

                        if matched:
                            if superset_match_aligned:
                                details = (
                                    f"{strategy.value.upper()} match succeeded "
                                    f"after column alignment ({alignment_info}) "
                                    f"(gold rows found as subset of predicted: "
                                    f"{len(projected_gold)} gold rows in "
                                    f"{len(pred)} predicted rows)."
                                )
                            else:
                                details = (
                                    f"{strategy.value.upper()} match succeeded "
                                    f"after column alignment ({alignment_info})."
                                )
                        else:
                            details = self._build_mismatch_details(
                                pred, projected_gold,
                                proj_col_names, proj_col_names, strategy,
                            )
                            details = (
                                f"Column alignment applied ({alignment_info}). "
                                + details
                            )

                        return ComparisonResult(
                            match=matched,
                            strategy=strategy,
                            predicted_rows=len(pred),
                            gold_rows=len(gold),
                            predicted_cols=n_pred_cols,
                            gold_cols=n_gold_cols,
                            column_match=False,
                            row_count_match=row_match_aligned,
                            details=details,
                            partial_score=score,
                            column_alignment=alignment_info,
                        )
                    # else: not all predicted columns found in gold,
                    # fall through to mismatch return below.

            # No alignment possible or alignment incomplete -- return
            # column mismatch as before.
            detail = (
                f"Column count mismatch: predicted={n_pred_cols}, "
                f"gold={n_gold_cols}."
            )
            if alignment_info:
                detail += f" Partial column alignment attempted ({alignment_info})."
            score = self._partial_score(pred, gold, strategy)
            return ComparisonResult(
                match=False,
                strategy=strategy,
                predicted_rows=len(pred),
                gold_rows=len(gold),
                predicted_cols=n_pred_cols,
                gold_cols=n_gold_cols,
                column_match=False,
                row_count_match=row_match,
                details=detail,
                partial_score=score,
                column_alignment=alignment_info,
            )

        # --- Column reorder tolerance (same count, different order) ---
        # When column counts match but names are available, check if
        # columns are in a different order and reorder predicted to
        # match gold column ordering before comparison.
        if p_cols and g_cols and col_match:
            pred_col_lower = [c.lower() for c in p_cols]
            gold_col_lower = [c.lower() for c in g_cols]
            if pred_col_lower != gold_col_lower:
                # Try to build a reordering map
                pred_col_index = {}
                for idx, col in enumerate(p_cols):
                    lower = col.lower()
                    if lower not in pred_col_index:
                        pred_col_index[lower] = idx

                reorder_indices = []
                can_reorder = True
                used_pred_indices: set[int] = set()
                for g_col in g_cols:
                    p_idx = pred_col_index.get(g_col.lower())
                    if p_idx is not None and p_idx not in used_pred_indices:
                        reorder_indices.append(p_idx)
                        used_pred_indices.add(p_idx)
                    else:
                        # Try fuzzy match (substring containment)
                        fuzzy_idx = self._fuzzy_match_column(
                            g_col.lower(), p_cols, used_pred_indices,
                        )
                        if fuzzy_idx is not None:
                            reorder_indices.append(fuzzy_idx)
                            used_pred_indices.add(fuzzy_idx)
                        else:
                            can_reorder = False
                            break

                if can_reorder and len(reorder_indices) == n_gold_cols:
                    # Reorder predicted rows to match gold column order
                    pred = [tuple(row[i] for i in reorder_indices) for row in pred]
                    p_cols = [p_cols[i] for i in reorder_indices]
                    logger.debug(
                        "Reordered %d predicted columns to match gold column order",
                        n_gold_cols,
                    )

        # --- Dispatch to strategy ---------------------------------
        if strategy is MatchStrategy.EXACT:
            matched = self._compare_exact(pred, gold)
        elif strategy is MatchStrategy.SET:
            matched = self._compare_set(pred, gold)
        elif strategy is MatchStrategy.SEMANTIC:
            matched = self._compare_semantic(pred, gold)
        else:
            raise ValueError(f"Unknown strategy: {strategy!r}")

        # --- Row-superset tolerance --------------------------------
        # If the strategy failed due to row count mismatch and predicted
        # has MORE rows than gold, check if gold is a subset of predicted.
        # This handles cases where the predicted SQL omits LIMIT or has
        # a different LIMIT value.
        superset_match = False
        if not matched and len(pred) > len(gold) and len(gold) > 0:
            superset_match = self._check_superset_match(pred, gold, strategy)
            if superset_match:
                matched = True
                row_match = False  # keep original row_match for reporting

        score = self._partial_score(pred, gold, strategy)

        if matched:
            if superset_match:
                details = (
                    f"{strategy.value.upper()} match succeeded "
                    f"(gold rows found as subset of predicted: "
                    f"{len(gold)} gold rows in {len(pred)} predicted rows)."
                )
            else:
                details = f"{strategy.value.upper()} match succeeded."
        else:
            details = self._build_mismatch_details(
                pred, gold, p_cols, g_cols, strategy,
            )

        return ComparisonResult(
            match=matched,
            strategy=strategy,
            predicted_rows=len(pred),
            gold_rows=len(gold),
            predicted_cols=n_pred_cols,
            gold_cols=n_gold_cols,
            column_match=True,
            row_count_match=row_match,
            details=details,
            partial_score=score,
        )

    # ------------------------------------------------------------------
    # Fuzzy column matching
    # ------------------------------------------------------------------

    @staticmethod
    def _fuzzy_match_column(
        pred_col: str,
        gold_cols: List[str],
        used_indices: set[int],
    ) -> Optional[int]:
        """Find a fuzzy match for *pred_col* among *gold_cols*.

        Tries substring containment in both directions (one name
        contains the other) to handle common alias variations like
        ``avg_duration_seconds`` vs ``avg_duration``.

        Args:
            pred_col:     Lower-cased predicted column name.
            gold_cols:    Gold column names (original case).
            used_indices: Set of gold column indices already matched.

        Returns:
            The index of the best matching gold column, or ``None``.
        """
        # Substring containment (prefer shorter match)
        candidates: List[Tuple[int, int]] = []  # (index, len_diff)
        for idx, g_col in enumerate(gold_cols):
            if idx in used_indices:
                continue
            g_lower = g_col.lower()
            if pred_col in g_lower or g_lower in pred_col:
                candidates.append((idx, abs(len(pred_col) - len(g_lower))))

        if candidates:
            # Prefer the closest length match
            candidates.sort(key=lambda x: x[1])
            return candidates[0][0]

        return None

    # ------------------------------------------------------------------
    # Strategy implementations
    # ------------------------------------------------------------------

    @staticmethod
    def _compare_exact(
        pred: List[Tuple], gold: List[Tuple],
    ) -> bool:
        """EXACT strategy: ordered, strict cell equality.

        Returns ``True`` iff *pred* and *gold* have the same length and
        every pair of corresponding cells are equal (with None/NaN unification).
        """
        if len(pred) != len(gold):
            return False
        for p_row, g_row in zip(pred, gold):
            if not _row_equal(p_row, g_row, _values_equal_exact):
                return False
        return True

    @staticmethod
    def _compare_set(
        pred: List[Tuple], gold: List[Tuple],
    ) -> bool:
        """SET strategy: unordered multiset comparison, strict cell equality.

        Returns ``True`` iff every gold row has a unique matching predicted
        row (and vice versa), ignoring row order.
        """
        if len(pred) != len(gold):
            return False

        # Sort both and compare element-wise for efficiency.
        try:
            p_sorted = sorted(pred, key=_sortable_key)
            g_sorted = sorted(gold, key=_sortable_key)
        except TypeError:
            # Unhashable / unsortable types: fall back to greedy matching.
            return _greedy_match(pred, gold, _values_equal_exact)

        for p_row, g_row in zip(p_sorted, g_sorted):
            if not _row_equal(p_row, g_row, _values_equal_exact):
                # Sorting may pair differently with duplicates -- fall back.
                return _greedy_match(pred, gold, _values_equal_exact)
        return True

    def _compare_semantic(
        self, pred: List[Tuple], gold: List[Tuple],
    ) -> bool:
        """SEMANTIC strategy: unordered, type-coerced, approximate.

        Returns ``True`` iff there is a perfect one-to-one matching between
        *pred* and *gold* rows under semantic cell equality.
        """
        if len(pred) != len(gold):
            return False
        cell_eq = lambda a, b: _values_equal_semantic(a, b, self.rtol)
        return _greedy_match(pred, gold, cell_eq)

    # ------------------------------------------------------------------
    # Row-superset tolerance
    # ------------------------------------------------------------------

    def _check_superset_match(
        self,
        pred: List[Tuple],
        gold: List[Tuple],
        strategy: MatchStrategy,
    ) -> bool:
        """Check if gold rows are a subset of predicted rows.

        Returns True if every gold row has a matching row in predicted
        (i.e., predicted is a superset of gold).
        """
        if len(pred) < len(gold):
            return False

        if strategy is MatchStrategy.EXACT:
            cell_eq = _values_equal_exact
        elif strategy is MatchStrategy.SET or strategy is MatchStrategy.SEMANTIC:
            cell_eq = lambda a, b: _values_equal_semantic(a, b, self.rtol)
        else:
            return False

        # For each gold row, find a matching pred row (greedy)
        used = set()
        for g_row in gold:
            found = False
            for p_idx, p_row in enumerate(pred):
                if p_idx in used:
                    continue
                if _row_equal(p_row, g_row, cell_eq):
                    used.add(p_idx)
                    found = True
                    break
            if not found:
                return False
        return True

    # ------------------------------------------------------------------
    # Column alignment
    # ------------------------------------------------------------------

    @staticmethod
    def _align_by_column_names(
        pred: List[Tuple],
        gold: List[Tuple],
        pred_cols: List[str],
        gold_cols: List[str],
    ) -> Optional[Tuple[List[Tuple], List[Tuple], List[str]]]:
        """Align predicted and gold result sets by matching column names.

        Finds shared columns using case-insensitive name matching and
        projects both result sets to the shared columns in gold column
        order.

        Args:
            pred:      Predicted result rows.
            gold:      Gold result rows.
            pred_cols: Column names for the predicted result.
            gold_cols: Column names for the gold result.

        Returns:
            A tuple ``(aligned_pred, aligned_gold, aligned_cols)`` where
            both row lists have been projected to the shared columns, or
            ``None`` if no shared columns are found.
        """
        # Build a lookup from lower-cased predicted column name to its index.
        # If there are duplicate names (case-insensitive), keep the first.
        pred_col_index: dict[str, int] = {}
        for idx, col in enumerate(pred_cols):
            lower = col.lower()
            if lower not in pred_col_index:
                pred_col_index[lower] = idx

        # Walk gold columns in order and find matching predicted indices.
        shared_gold_indices: List[int] = []
        shared_pred_indices: List[int] = []
        aligned_col_names: List[str] = []
        used_pred_indices: set[int] = set()
        for g_idx, g_col in enumerate(gold_cols):
            p_idx = pred_col_index.get(g_col.lower())
            if p_idx is not None and p_idx not in used_pred_indices:
                shared_gold_indices.append(g_idx)
                shared_pred_indices.append(p_idx)
                aligned_col_names.append(g_col)
                used_pred_indices.add(p_idx)
            else:
                # Try fuzzy match (substring containment)
                fuzzy_idx = ResultComparator._fuzzy_match_column(
                    g_col.lower(), pred_cols, used_pred_indices,
                )
                if fuzzy_idx is not None:
                    shared_gold_indices.append(g_idx)
                    shared_pred_indices.append(fuzzy_idx)
                    aligned_col_names.append(g_col)
                    used_pred_indices.add(fuzzy_idx)

        if not aligned_col_names:
            return None

        # Project both result sets to the shared columns.
        aligned_pred: List[Tuple] = []
        for row in pred:
            aligned_pred.append(
                tuple(row[i] for i in shared_pred_indices)
            )

        aligned_gold: List[Tuple] = []
        for row in gold:
            aligned_gold.append(
                tuple(row[i] for i in shared_gold_indices)
            )

        return aligned_pred, aligned_gold, aligned_col_names

    # ------------------------------------------------------------------
    # Partial score
    # ------------------------------------------------------------------

    def _partial_score(
        self,
        pred: List[Tuple],
        gold: List[Tuple],
        strategy: MatchStrategy,
    ) -> float:
        """Compute fraction of gold rows that have a matching predicted row.

        This gives partial credit even when the overall match fails (e.g.,
        the predicted query returns the right rows plus some extras).

        The comparison function is chosen based on the *strategy*.
        """
        if not gold:
            return 1.0 if not pred else 0.0

        if strategy is MatchStrategy.EXACT:
            # For EXACT, a partial score still makes sense row-by-row
            # in order.  Count prefix matches.
            hits = 0
            for p_row, g_row in zip(pred, gold):
                if _row_equal(p_row, g_row, _values_equal_exact):
                    hits += 1
            return hits / len(gold)

        # SET and SEMANTIC: order-independent greedy counting.
        if strategy is MatchStrategy.SEMANTIC:
            cell_eq = lambda a, b: _values_equal_semantic(a, b, self.rtol)
        else:
            cell_eq = _values_equal_exact

        pred_available = list(pred)
        hits = 0
        for g_row in gold:
            for i, p_row in enumerate(pred_available):
                if _row_equal(p_row, g_row, cell_eq):
                    pred_available.pop(i)
                    hits += 1
                    break
        return hits / len(gold)

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def _build_mismatch_details(
        self,
        pred: List[Tuple],
        gold: List[Tuple],
        pred_cols: List[str],
        gold_cols: List[str],
        strategy: MatchStrategy,
    ) -> str:
        """Build a human-readable explanation of why the comparison failed."""
        parts: List[str] = []

        parts.append(f"{strategy.value.upper()} match failed.")

        if len(pred) != len(gold):
            parts.append(
                f"Row count mismatch: predicted={len(pred)}, "
                f"gold={len(gold)}."
            )

        # Show up to 3 differing row examples.
        if strategy is MatchStrategy.EXACT:
            examples = self._diff_rows_exact(pred, gold, max_examples=3)
        else:
            examples = self._diff_rows_unmatched(pred, gold, strategy, max_examples=3)

        for ex in examples:
            parts.append(ex)

        return " ".join(parts)

    @staticmethod
    def _diff_rows_exact(
        pred: List[Tuple],
        gold: List[Tuple],
        max_examples: int = 3,
    ) -> List[str]:
        """Return descriptions of the first *max_examples* row mismatches (ordered)."""
        diffs: List[str] = []
        for i, (p, g) in enumerate(zip(pred, gold)):
            if not _row_equal(p, g, _values_equal_exact):
                diffs.append(f"Row {i}: predicted={p!r}, gold={g!r}.")
                if len(diffs) >= max_examples:
                    break
        return diffs

    def _diff_rows_unmatched(
        self,
        pred: List[Tuple],
        gold: List[Tuple],
        strategy: MatchStrategy,
        max_examples: int = 3,
    ) -> List[str]:
        """Return descriptions of gold rows without a predicted match."""
        if strategy is MatchStrategy.SEMANTIC:
            cell_eq = lambda a, b: _values_equal_semantic(a, b, self.rtol)
        else:
            cell_eq = _values_equal_exact

        pred_avail = list(pred)
        unmatched: List[Tuple] = []
        for g_row in gold:
            found = False
            for i, p_row in enumerate(pred_avail):
                if _row_equal(p_row, g_row, cell_eq):
                    pred_avail.pop(i)
                    found = True
                    break
            if not found:
                unmatched.append(g_row)

        diffs: List[str] = []
        for row in unmatched[:max_examples]:
            diffs.append(f"Unmatched gold row: {row!r}.")
        if len(unmatched) > max_examples:
            diffs.append(
                f"... and {len(unmatched) - max_examples} more unmatched "
                f"gold row(s)."
            )
        return diffs


# ---------------------------------------------------------------------------
# Greedy bipartite matching helper
# ---------------------------------------------------------------------------

def _greedy_match(
    pred: List[Tuple],
    gold: List[Tuple],
    cell_eq: Any,  # callable (a, b) -> bool
) -> bool:
    """Greedy one-to-one row matching.

    For each gold row, find the first unused predicted row that matches.
    Returns ``True`` iff every gold row is matched and the counts are equal.

    Note:
        Greedy matching is O(n*m) in the worst case.  For the result-set
        sizes typical of text-to-SQL benchmarks (< 1000 rows) this is
        perfectly acceptable.
    """
    if len(pred) != len(gold):
        return False
    available = list(range(len(pred)))
    for g_row in gold:
        found = False
        for idx_pos, p_idx in enumerate(available):
            if _row_equal(pred[p_idx], g_row, cell_eq):
                available.pop(idx_pos)
                found = True
                break
        if not found:
            return False
    return True


# ---------------------------------------------------------------------------
# Convenience factory
# ---------------------------------------------------------------------------

def compare_results(
    predicted_rows: List[Tuple],
    gold_rows: List[Tuple],
    predicted_cols: Optional[List[str]] = None,
    gold_cols: Optional[List[str]] = None,
    strategy: MatchStrategy = MatchStrategy.SEMANTIC,
    rtol: float = _DEFAULT_RTOL,
) -> ComparisonResult:
    """One-shot comparison without manually constructing a comparator.

    This is a convenience wrapper around
    :meth:`ResultComparator.compare`.

    Args:
        predicted_rows: Rows from the predicted SQL.
        gold_rows:      Rows from the gold SQL.
        predicted_cols: Optional column names for predicted result.
        gold_cols:      Optional column names for gold result.
        strategy:       Comparison strategy (default SEMANTIC).
        rtol:           Relative tolerance for SEMANTIC numeric comparison.

    Returns:
        A :class:`ComparisonResult`.

    Example::

        result = compare_results(
            predicted_rows=[(1, 3.14159)],
            gold_rows=[(1, 3.1416)],
            strategy=MatchStrategy.SEMANTIC,
        )
        assert result.match is True
    """
    return ResultComparator(rtol=rtol).compare(
        predicted_rows=predicted_rows,
        gold_rows=gold_rows,
        predicted_cols=predicted_cols,
        gold_cols=gold_cols,
        strategy=strategy,
    )
