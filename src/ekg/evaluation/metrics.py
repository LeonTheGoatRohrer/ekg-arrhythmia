"""Beat-classification metrics following the AAMI EC57 conventions.

Definitions (per class ``c``, one-vs-rest on the confusion matrix ``cm`` with
rows = true class, columns = predicted class):

* ``TP = cm[c, c]``
* ``FN = sum(cm[c, :]) - TP``   (beats of class c predicted as something else)
* ``FP = sum(cm[:, c]) - TP``   (beats of other classes predicted as c)
* ``TN = total - TP - FN - FP``

* sensitivity (Se, recall)   = TP / (TP + FN)
* positive predictive value  = TP / (TP + FP)
* specificity (Sp)           = TN / (TN + FP)
* F1                         = 2 * Se * PPV / (Se + PPV)

Division by zero convention: every ratio whose denominator is 0 is reported as
``0.0`` (never NaN), so results stay JSON-serialisable and comparable. Note that
this means a class with no support *and* no predictions gets Se = PPV = F1 = 0;
such classes are therefore excluded from ``macro_f1`` (see :func:`summary`).

All public functions return plain Python types (``int``, ``float``, ``list``,
``dict``) except :func:`confusion`, which returns a NumPy ``int64`` matrix.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

import numpy as np

__all__ = [
    "confusion",
    "per_class_metrics",
    "summary",
    "gross_statistics",
]


_CORE_CLASSES = ("N", "S", "V", "F")  # AAMI classes without Q (unclassifiable)


def _safe_div(num: float, den: float) -> float:
    """Return ``num / den`` as float, or ``0.0`` if ``den == 0``."""
    return float(num) / float(den) if den else 0.0


def confusion(y_true, y_pred, n_classes: int = 5) -> np.ndarray:
    """Confusion matrix (rows = true class, columns = predicted class).

    Parameters
    ----------
    y_true, y_pred:
        Integer label sequences of equal length with values in ``[0, n_classes)``.
    n_classes:
        Size of the (square) matrix; classes without samples get empty rows/cols.

    Returns
    -------
    np.ndarray of dtype int64 and shape ``(n_classes, n_classes)``.
    """
    yt = np.asarray(y_true).reshape(-1)
    yp = np.asarray(y_pred).reshape(-1)
    if yt.shape != yp.shape:
        raise ValueError(f"y_true and y_pred differ in length: {yt.size} vs {yp.size}")
    if n_classes < 1:
        raise ValueError("n_classes must be >= 1")
    if yt.size == 0:
        return np.zeros((n_classes, n_classes), dtype=np.int64)
    for name, arr in (("y_true", yt), ("y_pred", yp)):
        if not np.issubdtype(arr.dtype, np.integer):
            if not np.all(np.mod(arr, 1) == 0):
                raise ValueError(f"{name} must contain integer class ids")
        if arr.min() < 0 or arr.max() >= n_classes:
            raise ValueError(f"{name} contains labels outside [0, {n_classes})")
    yt = yt.astype(np.int64)
    yp = yp.astype(np.int64)
    flat = np.bincount(yt * n_classes + yp, minlength=n_classes * n_classes)
    return flat.reshape(n_classes, n_classes).astype(np.int64)


def _class_counts(cm: np.ndarray, c: int) -> tuple[int, int, int, int]:
    total = int(cm.sum())
    tp = int(cm[c, c])
    fn = int(cm[c, :].sum()) - tp
    fp = int(cm[:, c].sum()) - tp
    tn = total - tp - fn - fp
    return tp, fn, fp, tn


def _ratios(tp: int, fn: int, fp: int, tn: int) -> dict:
    se = _safe_div(tp, tp + fn)
    ppv = _safe_div(tp, tp + fp)
    sp = _safe_div(tn, tn + fp)
    f1 = _safe_div(2.0 * se * ppv, se + ppv)
    return {"sensitivity": se, "ppv": ppv, "specificity": sp, "f1": f1}


def _check_cm(cm, class_names: Sequence[str]) -> np.ndarray:
    m = np.asarray(cm)
    if m.ndim != 2 or m.shape[0] != m.shape[1]:
        raise ValueError(f"confusion matrix must be square, got shape {m.shape}")
    if m.shape[0] != len(class_names):
        raise ValueError(
            f"class_names has {len(class_names)} entries but matrix is {m.shape[0]}x{m.shape[1]}"
        )
    if (m < 0).any():
        raise ValueError("confusion matrix must not contain negative counts")
    return m.astype(np.int64)


def per_class_metrics(cm, class_names: Sequence[str]) -> dict:
    """One-vs-rest metrics per class.

    Returns ``{cls: {"sensitivity", "ppv", "specificity", "f1", "support",
    "tp", "fp", "fn", "tn"}}``. ``support`` is the number of true beats of the
    class (row sum). Ratios with a zero denominator are ``0.0``.
    """
    m = _check_cm(cm, class_names)
    out: dict[str, dict] = {}
    for c, name in enumerate(class_names):
        tp, fn, fp, tn = _class_counts(m, c)
        entry = _ratios(tp, fn, fp, tn)
        entry.update({"support": tp + fn, "tp": tp, "fp": fp, "fn": fn, "tn": tn})
        out[str(name)] = entry
    return out


def summary(y_true, y_pred, class_names: Sequence[str]) -> dict:
    """Complete, JSON-serialisable evaluation summary.

    Keys: ``accuracy``, ``macro_f1``, ``macro_f1_nsvf``, ``per_class``,
    ``confusion`` (nested list, rows = true), ``class_names``, ``n``.

    ``macro_f1_nsvf`` is the same average restricted to the classes N, S, V, F
    (Q excluded, as is common in de Chazal-style evaluations: DS2 contains only
    ~7 Q beats, which makes the all-class macro-F1 very volatile). It is
    ``None`` when none of these classes is in ``class_names``.

    Decision: ``macro_f1`` is the unweighted mean of F1 over classes with
    ``support > 0`` only. Classes absent from ``y_true`` (e.g. F or Q in a small
    subset) would otherwise contribute a hard 0 and distort the average. If no
    class has support, ``macro_f1`` is ``0.0``. ``accuracy`` of an empty input
    is ``0.0``.
    """
    names = [str(n) for n in class_names]
    cm = confusion(y_true, y_pred, n_classes=len(names))
    per_class = per_class_metrics(cm, names)
    total = int(cm.sum())
    accuracy = _safe_div(int(np.trace(cm)), total)
    f1s = [v["f1"] for v in per_class.values() if v["support"] > 0]
    macro_f1 = float(sum(f1s) / len(f1s)) if f1s else 0.0
    core = [k for k in per_class if k in _CORE_CLASSES]
    f1_core = [per_class[k]["f1"] for k in core if per_class[k]["support"] > 0]
    macro_f1_nsvf = (float(sum(f1_core) / len(f1_core)) if f1_core else 0.0) if core else None
    return {
        "accuracy": float(accuracy),
        "macro_f1": macro_f1,
        "macro_f1_nsvf": macro_f1_nsvf,
        "per_class": per_class,
        "confusion": [[int(v) for v in row] for row in cm.tolist()],
        "class_names": names,
        "n": total,
    }


def gross_statistics(
    per_record: Mapping[str, object],
    class_names: Sequence[str],
    *,
    veb_ignore_fusion: bool = True,
) -> dict:
    """Gross and average statistics across records (AAMI EC57 style, optional).

    EC57 distinguishes *gross* statistics (counts pooled over all records, so
    long/beat-rich records weigh more) from *average* statistics (metric
    computed per record, then averaged over the records where it is defined).

    Parameters
    ----------
    per_record:
        ``{record_name: confusion_matrix}`` (rows = true, cols = predicted).
    class_names:
        Class names matching the matrix order, e.g. ``["N","S","V","F","Q"]``.
    veb_ignore_fusion:
        EC57 convention for ventricular ectopic beat (VEB) detection: true
        fusion beats (``F``) classified as ``V`` are not counted as false
        positives for class ``V``. Applied only if both ``"V"`` and ``"F"`` are
        in ``class_names``. ``F`` beats remain fully counted for class ``F``.

    Returns
    -------
    ``{"gross": {cls: {...}}, "average": {cls: {...}}, "n_records": int,
    "conventions": [...]}``. Gross entries contain the same keys as
    :func:`per_class_metrics`. Average entries contain ``sensitivity``,
    ``ppv``, ``specificity``, ``f1`` (mean over records where the respective
    denominator is non-zero, ``0.0`` if none) and ``n_records_<metric>``
    (how many records entered each mean).
    """
    names = [str(n) for n in class_names]
    k = len(names)
    mats = {str(r): _check_cm(cm, names) for r, cm in per_record.items()}
    pooled = np.zeros((k, k), dtype=np.int64)
    for m in mats.values():
        pooled += m

    v_idx = names.index("V") if "V" in names else None
    f_idx = names.index("F") if "F" in names else None
    apply_fusion_rule = veb_ignore_fusion and v_idx is not None and f_idx is not None

    def counts(m: np.ndarray, c: int) -> tuple[int, int, int, int]:
        tp, fn, fp, tn = _class_counts(m, c)
        if apply_fusion_rule and c == v_idx:
            fv = int(m[f_idx, v_idx])
            # Fusion beats called V: neither FP nor TN for the V detector.
            fp -= fv
        return tp, fn, fp, tn

    gross: dict[str, dict] = {}
    for c, name in enumerate(names):
        tp, fn, fp, tn = counts(pooled, c)
        entry = _ratios(tp, fn, fp, tn)
        entry.update({"support": tp + fn, "tp": tp, "fp": fp, "fn": fn, "tn": tn})
        gross[name] = entry

    average: dict[str, dict] = {}
    for c, name in enumerate(names):
        acc = {"sensitivity": [], "ppv": [], "specificity": [], "f1": []}
        for m in mats.values():
            tp, fn, fp, tn = counts(m, c)
            r = _ratios(tp, fn, fp, tn)
            if tp + fn > 0:
                acc["sensitivity"].append(r["sensitivity"])
            if tp + fp > 0:
                acc["ppv"].append(r["ppv"])
            if tn + fp > 0:
                acc["specificity"].append(r["specificity"])
            if tp + fn > 0 and tp + fp > 0:
                acc["f1"].append(r["f1"])
        entry = {}
        for key, vals in acc.items():
            entry[key] = float(sum(vals) / len(vals)) if vals else 0.0
            entry[f"n_records_{key}"] = len(vals)
        average[name] = entry

    conventions = [
        "gross = counts pooled over all records; average = mean of per-record metrics "
        "over records where the metric's denominator is non-zero",
        "zero denominators yield 0.0",
    ]
    if apply_fusion_rule:
        conventions.append("VEB: true F beats classified as V are not counted as V false positives")
    return {
        "gross": gross,
        "average": average,
        "n_records": len(mats),
        "conventions": conventions,
    }
