"""Accuracy assessment for the Random Forest land-cover classifier.

Computes standard remote-sensing accuracy metrics from a predicted class map
and a reference (true) label array.

Metrics
-------
- Confusion matrix (N_classes × N_classes, rows = true, cols = predicted)
- Overall accuracy (OA)
- Producer's accuracy (PA) — recall per class
- User's accuracy  (UA) — precision per class
- F1 score per class
- Cohen's kappa (κ)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np


# ── Data types ────────────────────────────────────────────────────────────────

@dataclass
class AccuracyReport:
    overall_accuracy: float
    kappa: float
    confusion_matrix: list[list[int]]
    producer_accuracy: dict[str, float]  # PA per class name
    user_accuracy: dict[str, float]      # UA per class name
    f1_score: dict[str, float]           # F1 per class name
    n_samples: int
    class_names: list[str]
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "overall_accuracy": round(self.overall_accuracy, 4),
            "kappa": round(self.kappa, 4),
            "confusion_matrix": self.confusion_matrix,
            "producer_accuracy": {k: round(v, 4) for k, v in self.producer_accuracy.items()},
            "user_accuracy": {k: round(v, 4) for k, v in self.user_accuracy.items()},
            "f1_score": {k: round(v, 4) for k, v in self.f1_score.items()},
            "n_samples": self.n_samples,
            "class_names": self.class_names,
            "note": self.note,
        }


# ── Core computation ──────────────────────────────────────────────────────────

def compute_accuracy(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    class_names: list[str],
    note: str = "",
) -> AccuracyReport:
    """Compute accuracy metrics from flat label arrays.

    Parameters
    ----------
    y_true : 1-D int8 array of reference class indices (no nodata; filter beforehand)
    y_pred : 1-D int8 array of predicted class indices
    class_names : list of class label strings (index = class value)
    note : explanatory string attached to the report

    Returns
    -------
    AccuracyReport
    """
    n_classes = len(class_names)
    classes = np.arange(n_classes, dtype=np.int8)

    # Build confusion matrix (rows = true, cols = predicted)
    cm = np.zeros((n_classes, n_classes), dtype=np.int64)
    for t, p in zip(y_true.ravel(), y_pred.ravel()):
        if 0 <= t < n_classes and 0 <= p < n_classes:
            cm[t, p] += 1

    n_total = int(cm.sum())
    n_correct = int(np.trace(cm))
    oa = n_correct / n_total if n_total else 0.0

    # Cohen's kappa
    row_sums = cm.sum(axis=1)  # true class totals
    col_sums = cm.sum(axis=0)  # pred class totals
    expected = (row_sums.astype(float) @ col_sums.astype(float)) / (n_total ** 2) if n_total else 0.0
    kappa = (oa - expected) / (1.0 - expected) if (1.0 - expected) > 1e-9 else 0.0

    # Per-class metrics
    pa: dict[str, float] = {}
    ua: dict[str, float] = {}
    f1: dict[str, float] = {}
    for i, name in enumerate(class_names):
        tp = int(cm[i, i])
        fn = int(row_sums[i]) - tp  # missed true positives
        fp = int(col_sums[i]) - tp  # false alarms
        recall    = tp / (tp + fn) if (tp + fn) else 0.0
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        pa[name] = recall
        ua[name] = precision
        denom = precision + recall
        f1[name] = 2 * precision * recall / denom if denom else 0.0

    return AccuracyReport(
        overall_accuracy=oa,
        kappa=kappa,
        confusion_matrix=cm.tolist(),
        producer_accuracy=pa,
        user_accuracy=ua,
        f1_score=f1,
        n_samples=n_total,
        class_names=class_names,
        note=note,
    )


def accuracy_from_rf(
    clf: Any,
    X_val: np.ndarray,
    y_val: np.ndarray,
    class_names: list[str],
    note: str = "",
) -> AccuracyReport:
    """Convenience wrapper: predict with *clf* on a held-out (X_val, y_val) set."""
    y_pred = clf.predict(X_val).astype(np.int8)
    return compute_accuracy(y_val.astype(np.int8), y_pred, class_names, note=note)
