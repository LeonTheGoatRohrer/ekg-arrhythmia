"""Tests for ekg.models.tree_baseline.

Synthetic beats/features are used for unit tests only. The real MIT-BIH record
100 (data/sample/) is used for a feature-plausibility smoke test; no model
metrics are derived from it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pytest

from ekg.models.tree_baseline import (
    FEATURE_NAMES,
    MORPHOLOGY_FEATURES,
    export_tree,
    extract_features,
    train_tree,
    tree_to_mermaid,
)

FS = 360
L = 252
R = 90
CLASSES = ["N", "S", "V", "F", "Q"]
SAMPLE_DIR = Path(__file__).resolve().parents[1] / "data" / "sample"


def _znorm(x: np.ndarray) -> np.ndarray:
    x = x - x.mean(axis=-1, keepdims=True)
    return x / x.std(axis=-1, keepdims=True)


def _synthetic_beat(qrs_sigma_ms: float, r_amp: float = 1.0, t_amp: float = 0.3, s_amp: float = 0.0):
    t = np.arange(L)
    sig = qrs_sigma_ms * FS / 1000.0
    x = r_amp * np.exp(-0.5 * ((t - R) / sig) ** 2)
    x += t_amp * np.exp(-0.5 * ((t - (R + 90)) / 12.0) ** 2)  # T wave ~250 ms after R
    x -= s_amp * np.exp(-0.5 * ((t - (R + 3 * sig)) / sig) ** 2)
    return x


def _iter_nodes(node):
    yield node
    if node["left"] is not None:
        yield from _iter_nodes(node["left"])
        yield from _iter_nodes(node["right"])


@pytest.fixture(scope="module")
def separable():
    """Three classes separable by QRS width and rr_ratio (synthetic feature space)."""
    rng = np.random.default_rng(0)
    n = 300
    X = rng.normal(size=(3 * n, len(FEATURE_NAMES))).astype(np.float32)
    y = np.repeat([0, 1, 2], n)  # N, S, V
    w = FEATURE_NAMES.index("qrs_width_ms")
    r = FEATURE_NAMES.index("rr_ratio")
    X[:, w] = np.where(y == 2, rng.normal(150, 10, 3 * n), rng.normal(80, 8, 3 * n))
    X[:, r] = np.where(y == 1, rng.normal(0.6, 0.05, 3 * n), rng.normal(1.0, 0.05, 3 * n))
    return X, y


# ---------------------------------------------------------------- features


def test_feature_names_and_shape():
    beats = _znorm(np.stack([_synthetic_beat(s) for s in (8, 12, 20, 30)]))
    rr = np.tile([0.8, 0.8, 0.8, 1.0], (4, 1)).astype(np.float32)
    X, names = extract_features(beats, rr, fs=FS)
    assert X.shape == (4, 11)
    assert X.dtype == np.float32
    assert names == FEATURE_NAMES
    assert all(re.fullmatch(r"[a-z][a-z0-9_]*", n) for n in names)
    assert np.isfinite(X).all()
    # RR columns are passed through unchanged
    np.testing.assert_allclose(X[:, -4:], rr)


def test_without_rr_returns_morphology_only():
    beats = _znorm(np.stack([_synthetic_beat(10)] * 3))
    X, names = extract_features(beats, None)
    assert names == MORPHOLOGY_FEATURES
    assert X.shape == (3, len(MORPHOLOGY_FEATURES))


def test_qrs_width_monotonic_and_plausible():
    sigmas = [6, 10, 16, 24, 32]
    beats = _znorm(np.stack([_synthetic_beat(s) for s in sigmas]))
    X, names = extract_features(beats, None)
    width = X[:, names.index("qrs_width_ms")]
    assert np.all(np.diff(width) > 0), width
    # A Gaussian QRS with sigma 10 ms is roughly 40-80 ms wide
    assert 30 < width[1] < 90


def test_morphology_features_semantics():
    beats = _znorm(np.stack([_synthetic_beat(10, t_amp=0.0, s_amp=0.0), _synthetic_beat(10, t_amp=0.6, s_amp=0.5)]))
    X, names = extract_features(beats, None)
    f = {n: X[:, i] for i, n in enumerate(names)}
    assert f["t_amplitude"][1] > f["t_amplitude"][0]
    assert f["s_depth"][1] < f["s_depth"][0]
    assert np.all(f["r_amplitude"] > 0)
    assert np.all((f["beat_energy"] > 0) & (f["beat_energy"] <= 1))
    assert np.all(f["qrs_area"] > 0)
    # inverted complex -> negative R amplitude
    Xi, _ = extract_features(-beats[:1], None)
    assert Xi[0, names.index("r_amplitude")] < 0


def test_input_validation():
    with pytest.raises(ValueError):
        extract_features(np.zeros(L), None)
    with pytest.raises(ValueError):
        extract_features(np.zeros((2, L)), np.zeros((3, 4)))
    X, names = extract_features(np.zeros((0, L)), np.zeros((0, 4)))
    assert X.shape == (0, 11) and names == FEATURE_NAMES
    # flat beat must not produce NaNs
    X, _ = extract_features(np.zeros((1, L)), None)
    assert np.isfinite(X).all()


@pytest.mark.skipif(not (SAMPLE_DIR / "100.dat").exists(), reason="record 100 not present")
def test_real_record_feature_plausibility():
    """Smoke test on real MIT-BIH record 100: features are finite and QRS widths physiological."""
    from ekg.data.loader import load_record
    from ekg.preprocessing.filters import preprocess

    rec = load_record("100", SAMPLE_DIR)
    x = preprocess(rec.signal, rec.fs)
    peaks = np.array([s for s, sym in zip(rec.ann_samples, rec.ann_symbols) if sym == "N"])
    peaks = peaks[(peaks >= R) & (peaks + (L - R) <= len(x))][:300]
    beats = _znorm(np.stack([x[p - R : p - R + L] for p in peaks]))
    X, names = extract_features(beats, None, fs=rec.fs)
    assert np.isfinite(X).all()
    med = float(np.median(X[:, names.index("qrs_width_ms")]))
    assert 40 <= med <= 140, med
    # Regression: the Q wave (starts ~45 ms before R) must be inside the QRS;
    # a 15 % derivative threshold gave ~50 ms here, the visual QRS is ~75-80 ms.
    assert 65 <= med <= 100, med


# ---------------------------------------------------------------- tree


def test_train_tree_separates_synthetic_features(separable):
    X, y = separable
    tree = train_tree(X, y, max_depth=3)
    assert tree.get_depth() <= 3
    assert (tree.predict(X) == y).mean() > 0.95
    used = {FEATURE_NAMES[i] for i in tree.tree_.feature if i >= 0}
    assert {"qrs_width_ms", "rr_ratio"} <= used


def test_export_consistency(separable):
    X, y = separable
    tree = train_tree(X, y, max_depth=4)
    exp = export_tree(tree, FEATURE_NAMES, CLASSES)
    nodes = list(_iter_nodes(exp))
    assert len(nodes) == tree.tree_.node_count
    assert len({n["id"] for n in nodes}) == len(nodes)
    assert exp["samples"] == len(y)
    for n in nodes:
        assert set(n) >= {"id", "feature", "threshold", "samples", "value", "class", "left", "right"}
        assert len(n["value"]) == len(CLASSES)
        assert abs(sum(n["value"]) - 1.0) < 1e-6
        assert n["class"] == CLASSES[int(np.argmax(n["value"]))]
        if n["feature"] is None:
            assert n["threshold"] is None and n["left"] is None and n["right"] is None
        else:
            assert n["feature"] in FEATURE_NAMES
            assert n["left"]["samples"] + n["right"]["samples"] == n["samples"]
    # classes absent from training (F, Q) get zero probability everywhere
    assert all(n["value"][3] == 0 and n["value"][4] == 0 for n in nodes)


def test_export_leaf_class_matches_prediction(separable):
    X, y = separable
    tree = train_tree(X, y, max_depth=4)
    exp = export_tree(tree, FEATURE_NAMES, CLASSES)
    by_id = {n["id"]: n for n in _iter_nodes(exp)}
    leaves = tree.apply(X[:50])
    preds = tree.predict(X[:50])
    for leaf, p in zip(leaves, preds):
        assert by_id[int(leaf)]["feature"] is None
        assert by_id[int(leaf)]["class"] == CLASSES[int(p)]


def test_export_maps_non_contiguous_labels():
    rng = np.random.default_rng(1)
    X = rng.normal(size=(200, 2))
    y = np.where(X[:, 0] > 0, 4, 2)  # only classes V (2) and Q (4)
    tree = train_tree(X, y, max_depth=2)
    exp = export_tree(tree, ["a_feat", "b_feat"], CLASSES)
    classes = {n["class"] for n in _iter_nodes(exp) if n["feature"] is None}
    assert classes <= {"V", "Q"} and classes == {"V", "Q"}


def test_export_json_roundtrip(separable):
    X, y = separable
    exp = export_tree(train_tree(X, y), FEATURE_NAMES, CLASSES)
    s = json.dumps(exp)
    assert json.loads(s) == exp


# ---------------------------------------------------------------- mermaid


def test_tree_to_mermaid(separable):
    X, y = separable
    exp = export_tree(train_tree(X, y, max_depth=3), FEATURE_NAMES, CLASSES)
    nodes = list(_iter_nodes(exp))
    internal = [n for n in nodes if n["feature"] is not None]
    leaves = [n for n in nodes if n["feature"] is None]

    mm = tree_to_mermaid(exp)
    lines = mm.strip().splitlines()
    assert lines[0] == "flowchart TD"

    node_lines = [ln for ln in lines[1:] if "-->" not in ln]
    edge_lines = [ln for ln in lines[1:] if "-->" in ln]
    assert len(node_lines) == len(nodes)  # exactly one line per node
    assert len(edge_lines) == 2 * len(internal)
    assert sum("|ja|" in ln for ln in edge_lines) == len(internal)
    assert sum("|nein|" in ln for ln in edge_lines) == len(internal)

    for n in internal:
        assert f'{n["feature"]} <= {n["threshold"]:.2f}' in mm
    for n in leaves:
        assert f'Klasse {n["class"]} (n={n["samples"]})' in mm

    # mermaid-safe identifiers
    ids = {ln.split("[")[0].split("(")[0].strip() for ln in node_lines}
    assert len(ids) == len(nodes)
    assert all(re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", i) for i in ids)


def test_mermaid_sanitises_foreign_ids():
    tj = {
        "id": "root node",
        "feature": "x",
        "threshold": 0.5,
        "samples": 3,
        "value": [1.0],
        "class": "N",
        "left": {"id": "a-1", "feature": None, "threshold": None, "samples": 2, "value": [1.0], "class": "N", "left": None, "right": None},
        "right": {"id": 7, "feature": None, "threshold": None, "samples": 1, "value": [1.0], "class": 'V"', "left": None, "right": None},
    }
    mm = tree_to_mermaid(tj)
    assert "nroot_node" in mm and "na_1" in mm and "n7" in mm
    assert 'V#quot;' in mm
    assert "x <= 0.50" in mm
