"""
Analysis package for Schema-Aware Prompt Engineering experiments.
Provides statistical testing, publication-quality visualizations,
and LaTeX table generation for the VLDB paper.
"""

from .statistical_tests import StatisticalAnalyzer, PairwiseTestResult

__all__ = [
    "StatisticalAnalyzer",
    "PairwiseTestResult",
]

try:
    from .visualizations import *
except ImportError:
    pass

try:
    from .latex_tables import *
except ImportError:
    pass
