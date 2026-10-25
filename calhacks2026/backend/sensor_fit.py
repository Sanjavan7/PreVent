"""Least-squares fit over a small telemetry window.

The harden flow fits the failed SPA06 channel on the surviving one, so the
common path is a straight line. A two-predictor plane remains for a wider
window. No matrix class — centered sums-of-products only.
"""

from typing import List, Sequence, Tuple


def _column(data: Sequence[Sequence[float]], idx: int) -> List[float]:
    return [row[idx] for row in data]


def _mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _cov(a: Sequence[float], am: float, b: Sequence[float], bm: float) -> float:
    return sum((x - am) * (y - bm) for x, y in zip(a, b))


def _line_fit(
    observed: Sequence[float], regressors: Sequence[Sequence[float]]
) -> Tuple[float, List[float], float]:
    x = _column(regressors, 0)
    y = list(observed)
    mx, my = _mean(x), _mean(y)
    sxx = _cov(x, mx, x, mx)
    sxy = _cov(x, mx, y, my)
    if abs(sxx) < 1e-12:
        return my, [0.0], 0.0
    slope = sxy / sxx
    intercept = my - slope * mx
    ss_total = _cov(y, my, y, my)
    if ss_total < 1e-9:
        return intercept, [slope], 0.0
    ss_resid = sum((yi - (intercept + slope * xi)) ** 2 for yi, xi in zip(y, x))
    return intercept, [slope], 1.0 - ss_resid / ss_total


def _plane_fit(
    observed: Sequence[float], regressors: Sequence[Sequence[float]]
) -> Tuple[float, List[float], float]:
    """Closed-form OLS for exactly two predictors.

    Returns ``(intercept, [b1, b2], R²)``. A degenerate predictor set
    (collinear or zero-variance) degrades to the mean-only model.
    """
    x1 = _column(regressors, 0)
    x2 = _column(regressors, 1)
    y = list(observed)
    my = _mean(y)
    mx1, mx2 = _mean(x1), _mean(x2)
    s11 = _cov(x1, mx1, x1, mx1)
    s22 = _cov(x2, mx2, x2, mx2)
    s12 = _cov(x1, mx1, x2, mx2)
    s1y = _cov(x1, mx1, y, my)
    s2y = _cov(x2, mx2, y, my)
    det = s11 * s22 - s12 * s12
    if abs(det) < 1e-12:
        return my, [0.0, 0.0], 0.0
    b1 = (s22 * s1y - s12 * s2y) / det
    b2 = (s11 * s2y - s12 * s1y) / det
    intercept = my - b1 * mx1 - b2 * mx2
    ss_total = _cov(y, my, y, my)
    if ss_total < 1e-9:
        return intercept, [b1, b2], 0.0
    ss_resid = sum(
        (yi - (intercept + b1 * a + b2 * b)) ** 2 for yi, a, b in zip(y, x1, x2)
    )
    return intercept, [b1, b2], 1.0 - ss_resid / ss_total


def fit_ols(
    observed: Sequence[float], regressors: Sequence[Sequence[float]]
) -> Tuple[float, List[float], float]:
    """Fit ``observed ≈ β0 + Σ βj·x_j``.

    `regressors` is a sequence of sample rows matching `observed` in length.
    One column is a line. Two columns are a plane.
    """
    n = len(observed)
    if n == 0 or not regressors or not regressors[0]:
        return 0.0, [], 0.0
    k = len(regressors[0])
    if k == 1:
        return _line_fit(observed, regressors)
    if k == 2:
        return _plane_fit(observed, regressors)
    return _mean(observed), [0.0] * k, 0.0
