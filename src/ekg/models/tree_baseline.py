"""Interpretable decision-tree baseline for AAMI beat classification.

The tree works on a small set of hand-crafted, clinically interpretable features
computed from the segmented beat windows (see ``ekg.preprocessing.segmentation``:
252 samples @ 360 Hz, R peak at index 90, per-beat z-normalised) plus the four
RR-interval features.

Feature definitions (all amplitudes in z-units of the normalised beat):

==============  ==============================================================
qrs_width_ms    QRS duration. |first derivative| is dilated with a 25 ms moving
                maximum and thresholded inside the search window
                [R-100 ms, R+150 ms] at max(5 % of its peak, 4x the median
                |derivative| of the isoelectric PR segment [R-160 ms, R-100 ms));
                the contiguous supra-threshold run containing R gives
                onset/offset. The dilation length is subtracted again so the
                width is not biased upwards. The low 5 % level keeps the shallow
                Q and S waves inside the QRS (record 100, median N beat:
                ~75 ms; a 15 % level cut them off and gave ~50 ms), the noise
                term stops the run from spreading into noisy baselines.
r_amplitude     Amplitude at the R sample (negative for inverted complexes).
q_depth         Minimum amplitude in [R-50 ms, R) (signed; more negative = deeper Q).
s_depth         Minimum amplitude in (R, R+80 ms] (signed; more negative = deeper S).
qrs_area        Sum of |x| over the detected QRS interval, times the sample
                period in ms (z * ms).
t_amplitude     Maximum amplitude in [R+150 ms, R+400 ms].
beat_energy     Fraction of the beat's total energy (sum x^2) inside the fixed
                QRS window [R-50 ms, R+100 ms]. (The absolute energy is constant
                under z-normalisation and therefore not informative.)
pre_rr          RR interval to the previous beat [s].
post_rr         RR interval to the next beat [s].
local_rr        Mean of the last <= 10 RR intervals, causal, current
                beat included (``mean(pre_rr[i-9:i+1])``) [s].
rr_ratio        pre_rr / local_rr (premature beats -> < 1).
==============  ==============================================================

Export format (``export_tree``): nested dicts, one per node::

    {"id": int, "feature": str | None, "threshold": float | None,
     "samples": int, "value": [float, ...], "class": str,
     "impurity": float, "left": {...} | None, "right": {...} | None}

``samples`` is ``tree_.n_node_samples`` (raw, unweighted beat count).
``value`` is the class distribution at the node, normalised to sum to 1 and
aligned with ``class_names``. Note: scikit-learn >= 1.4 stores (weighted)
class fractions in ``tree_.value``; with ``class_weight="balanced"`` this
distribution is the *class-weighted* one, so it is NOT ``counts / samples``.
Raw per-class counts cannot be recovered from the tree alone and are therefore
not exported. ``class`` is the arg-max class name (the tree's prediction).
The left child is the branch where ``feature <= threshold`` holds.
"""

from __future__ import annotations

import re

import numpy as np
from scipy.ndimage import maximum_filter1d
from sklearn.tree import DecisionTreeClassifier

__all__ = [
    "MORPHOLOGY_FEATURES",
    "RR_FEATURES",
    "FEATURE_NAMES",
    "extract_features",
    "train_tree",
    "export_tree",
    "tree_to_mermaid",
]

MORPHOLOGY_FEATURES: list[str] = [
    "qrs_width_ms",
    "r_amplitude",
    "q_depth",
    "s_depth",
    "qrs_area",
    "t_amplitude",
    "beat_energy",
]
RR_FEATURES: list[str] = ["pre_rr", "post_rr", "local_rr", "rr_ratio"]
FEATURE_NAMES: list[str] = MORPHOLOGY_FEATURES + RR_FEATURES

# Must match ekg.preprocessing.segmentation.PRE_MS (kept local to avoid coupling).
_PRE_MS = 250

_QRS_SEARCH_PRE_MS = 100
_QRS_SEARCH_POST_MS = 150
_QRS_DERIV_FRACTION = 0.05
_QRS_NOISE_FACTOR = 4.0
_QRS_NOISE_PRE_MS = (160, 100)  # isoelectric PR-segment window before R
_QRS_DILATE_MS = 25


def _ms(ms: float, fs: float) -> int:
    return int(round(ms * fs / 1000.0))


def _qrs_bounds(beats: np.ndarray, r: int, fs: float) -> tuple[np.ndarray, np.ndarray]:
    """Return per-beat QRS onset/offset sample indices (inclusive, in beat coordinates)."""
    n, length = beats.shape
    lo = max(r - _ms(_QRS_SEARCH_PRE_MS, fs), 1)
    hi = min(r + _ms(_QRS_SEARCH_POST_MS, fs), length - 1)
    # Central-ish derivative aligned with the sample index (d[i] = x[i] - x[i-1]).
    deriv = np.abs(np.diff(beats, axis=1, prepend=beats[:, :1]))
    seg = deriv[:, lo : hi + 1]
    k = max(_ms(_QRS_DILATE_MS, fs), 1) | 1  # odd size -> symmetric dilation
    activity = maximum_filter1d(seg, size=k, axis=1, mode="nearest")
    peak = activity.max(axis=1, keepdims=True)
    peak[peak <= 0] = 1.0
    n_lo = max(r - _ms(_QRS_NOISE_PRE_MS[0], fs), 1)
    n_hi = max(r - _ms(_QRS_NOISE_PRE_MS[1], fs), n_lo + 1)
    noise = np.median(deriv[:, n_lo:n_hi], axis=1, keepdims=True)
    mask = activity >= np.maximum(_QRS_DERIV_FRACTION * peak, _QRS_NOISE_FACTOR * noise)

    rr = r - lo  # R index inside the search window
    left = mask[:, : rr + 1][:, ::-1]  # from R going backwards
    right = mask[:, rr:]  # from R going forwards
    # Length of the leading True run (0 if mask[R] is False).
    left_run = np.where(left.all(axis=1), left.shape[1], np.argmin(left, axis=1))
    right_run = np.where(right.all(axis=1), right.shape[1], np.argmin(right, axis=1))
    half = k // 2
    onset = r - np.maximum(left_run - 1 - half, 0)
    offset = r + np.maximum(right_run - 1 - half, 0)
    # Beats whose R sample is not inside an active run collapse to a zero-width QRS.
    inactive = ~mask[:, rr]
    onset[inactive] = r
    offset[inactive] = r
    return onset.astype(np.int64), offset.astype(np.int64)


def extract_features(
    beats: np.ndarray,
    rr: np.ndarray | None,
    fs: int = 360,
    *,
    r_index: int | None = None,
) -> tuple[np.ndarray, list[str]]:
    """Compute interpretable per-beat features.

    Args:
        beats: (n, L) beat windows, R peak at ``r_index`` (default ``round(0.25 * fs)``).
        rr: (n, 4) RR features ``[pre_rr, post_rr, local_rr, rr_ratio]`` in seconds,
            or ``None`` to return morphology features only.
        fs: sampling rate in Hz.
        r_index: optional override of the R-peak position inside the window.

    Returns:
        ``(X, feature_names)`` with ``X`` float32 of shape (n, n_features).
    """
    beats = np.asarray(beats, dtype=np.float64)
    if beats.ndim != 2:
        raise ValueError(f"beats must be 2-D (n, L), got shape {beats.shape}")
    n, length = beats.shape
    r = _ms(_PRE_MS, fs) if r_index is None else int(r_index)
    if not 0 < r < length - 1:
        raise ValueError(f"R index {r} outside beat window of length {length}")

    names = list(MORPHOLOGY_FEATURES)
    if n == 0:
        if rr is not None:
            names += RR_FEATURES
        return np.zeros((0, len(names)), dtype=np.float32), names

    period_ms = 1000.0 / fs

    onset, offset = _qrs_bounds(beats, r, fs)
    qrs_width_ms = (offset - onset).astype(np.float64) * period_ms

    r_amplitude = beats[:, r]

    q_lo = max(r - _ms(50, fs), 0)
    q_depth = beats[:, q_lo:r].min(axis=1) if q_lo < r else beats[:, r]

    s_hi = min(r + _ms(80, fs), length - 1)
    s_depth = beats[:, r + 1 : s_hi + 1].min(axis=1) if s_hi > r else beats[:, r]

    idx = np.arange(length)[None, :]
    in_qrs = (idx >= onset[:, None]) & (idx <= offset[:, None])
    qrs_area = np.where(in_qrs, np.abs(beats), 0.0).sum(axis=1) * period_ms

    t_lo = min(r + _ms(150, fs), length - 1)
    t_hi = min(r + _ms(400, fs), length - 1)
    t_amplitude = beats[:, t_lo : t_hi + 1].max(axis=1)

    e_lo = max(r - _ms(50, fs), 0)
    e_hi = min(r + _ms(100, fs), length - 1)
    energy = np.square(beats)
    total = energy.sum(axis=1)
    total[total <= 0] = 1.0
    beat_energy = energy[:, e_lo : e_hi + 1].sum(axis=1) / total

    cols = [qrs_width_ms, r_amplitude, q_depth, s_depth, qrs_area, t_amplitude, beat_energy]

    if rr is not None:
        rr = np.asarray(rr, dtype=np.float64)
        if rr.shape != (n, 4):
            raise ValueError(f"rr must have shape ({n}, 4), got {rr.shape}")
        cols += [rr[:, 0], rr[:, 1], rr[:, 2], rr[:, 3]]
        names += RR_FEATURES

    X = np.stack(cols, axis=1).astype(np.float32)
    return X, names


def train_tree(
    X: np.ndarray,
    y: np.ndarray,
    max_depth: int = 4,
    class_weight: str | dict | None = "balanced",
    random_state: int = 0,
) -> DecisionTreeClassifier:
    """Fit a shallow, interpretable CART decision tree."""
    tree = DecisionTreeClassifier(
        max_depth=max_depth,
        class_weight=class_weight,
        random_state=random_state,
    )
    tree.fit(np.asarray(X), np.asarray(y))
    return tree


def _class_columns(tree: DecisionTreeClassifier, class_names: list[str]) -> list[int]:
    """Map each column of ``tree_.value`` to an index in ``class_names``."""
    cols: list[int] = []
    for label in tree.classes_:
        if isinstance(label, (int, np.integer)) and 0 <= int(label) < len(class_names):
            cols.append(int(label))
        elif str(label) in class_names:
            cols.append(class_names.index(str(label)))
        else:
            raise ValueError(f"tree class {label!r} cannot be mapped onto class_names {class_names}")
    return cols


def export_tree(
    tree: DecisionTreeClassifier,
    feature_names: list[str],
    class_names: list[str],
) -> dict:
    """Export a fitted tree as a nested, JSON-serialisable dict (see module docstring)."""
    t = tree.tree_
    class_names = list(class_names)
    cols = _class_columns(tree, class_names)
    if t.n_features != len(feature_names):
        raise ValueError(f"tree has {t.n_features} features but {len(feature_names)} names were given")

    def node(i: int) -> dict:
        raw = np.asarray(t.value[i]).reshape(-1)  # single-output classifier
        dist = np.zeros(len(class_names), dtype=np.float64)
        dist[cols] = raw
        s = dist.sum()
        if s > 0:
            dist /= s
        left, right = int(t.children_left[i]), int(t.children_right[i])
        is_leaf = left == right  # both TREE_LEAF (-1)
        return {
            "id": int(i),
            "feature": None if is_leaf else str(feature_names[int(t.feature[i])]),
            "threshold": None if is_leaf else float(t.threshold[i]),
            "samples": int(t.n_node_samples[i]),
            "value": [float(v) for v in dist],
            "class": class_names[int(np.argmax(dist))],
            "impurity": float(t.impurity[i]),
            "left": None if is_leaf else node(left),
            "right": None if is_leaf else node(right),
        }

    return node(0)


_ID_SAFE = re.compile(r"[^A-Za-z0-9_]")


def _mermaid_id(raw) -> str:
    return "n" + _ID_SAFE.sub("_", str(raw))


def _mermaid_text(text: str) -> str:
    return str(text).replace('"', "#quot;")


def tree_to_mermaid(tree_json: dict) -> str:
    """Render an ``export_tree`` dict as a Mermaid ``flowchart TD``.

    One line per node (decision: ``feature <= threshold``; leaf: ``Klasse X (n=..)``),
    followed by the edges labelled ``ja`` (condition true -> left) and ``nein``.
    """
    node_lines: list[str] = []
    edge_lines: list[str] = []

    stack = [tree_json]
    while stack:
        nd = stack.pop()
        nid = _mermaid_id(nd["id"])
        if nd.get("feature") is None:
            label = _mermaid_text(f"Klasse {nd['class']} (n={nd['samples']})")
            node_lines.append(f'    {nid}(["{label}"])')
            continue
        label = _mermaid_text(f"{nd['feature']} <= {float(nd['threshold']):.2f}")
        node_lines.append(f'    {nid}["{label}"]')
        left, right = nd["left"], nd["right"]
        edge_lines.append(f"    {nid} -->|ja| {_mermaid_id(left['id'])}")
        edge_lines.append(f"    {nid} -->|nein| {_mermaid_id(right['id'])}")
        stack.append(right)
        stack.append(left)

    return "\n".join(["flowchart TD", *node_lines, *edge_lines]) + "\n"
