"""Tests for ekg.evaluation.metrics using hand-computed confusion matrices."""

import json

import numpy as np
import pytest

from ekg.evaluation.metrics import confusion, gross_statistics, per_class_metrics, summary

CLASSES = ["N", "S", "V", "F", "Q"]


def test_confusion_basic_rows_true_cols_pred():
    y_true = [0, 0, 0, 1, 1, 2]
    y_pred = [0, 0, 1, 1, 0, 2]
    cm = confusion(y_true, y_pred, n_classes=3)
    expected = np.array([[2, 1, 0], [1, 1, 0], [0, 0, 1]])
    assert cm.dtype == np.int64
    np.testing.assert_array_equal(cm, expected)


def test_confusion_empty_and_validation():
    np.testing.assert_array_equal(confusion([], [], n_classes=5), np.zeros((5, 5)))
    with pytest.raises(ValueError):
        confusion([0, 1], [0], n_classes=2)
    with pytest.raises(ValueError):
        confusion([0, 5], [0, 1], n_classes=5)
    with pytest.raises(ValueError):
        confusion([0, -1], [0, 1], n_classes=5)


def test_confusion_accepts_numpy_int_arrays():
    yt = np.array([4, 4, 3], dtype=np.int32)
    yp = np.array([4, 3, 3], dtype=np.int64)
    cm = confusion(yt, yp)
    assert cm.shape == (5, 5)
    assert cm[4, 4] == 1 and cm[4, 3] == 1 and cm[3, 3] == 1 and cm.sum() == 3


def test_per_class_metrics_hand_computed():
    # rows = true, cols = pred; total = 20
    cm = np.array(
        [
            [8, 1, 1],  # A: TP=8, FN=2
            [2, 4, 0],  # B: TP=4, FN=2
            [0, 1, 3],  # C: TP=3, FN=1
        ]
    )
    m = per_class_metrics(cm, ["A", "B", "C"])
    # A: FP = 2+0 = 2, TN = 20-8-2-2 = 8
    a = m["A"]
    assert (a["tp"], a["fn"], a["fp"], a["tn"], a["support"]) == (8, 2, 2, 8, 10)
    assert a["sensitivity"] == pytest.approx(0.8)
    assert a["ppv"] == pytest.approx(0.8)
    assert a["specificity"] == pytest.approx(0.8)
    assert a["f1"] == pytest.approx(0.8)
    # B: FP = 1+1 = 2, TN = 20-4-2-2 = 12
    b = m["B"]
    assert (b["tp"], b["fn"], b["fp"], b["tn"], b["support"]) == (4, 2, 2, 12, 6)
    assert b["sensitivity"] == pytest.approx(4 / 6)
    assert b["ppv"] == pytest.approx(4 / 6)
    assert b["specificity"] == pytest.approx(12 / 14)
    assert b["f1"] == pytest.approx(4 / 6)
    # C: FP = 1+0 = 1, TN = 20-3-1-1 = 15
    c = m["C"]
    assert (c["tp"], c["fn"], c["fp"], c["tn"], c["support"]) == (3, 1, 1, 15, 4)
    assert c["sensitivity"] == pytest.approx(0.75)
    assert c["ppv"] == pytest.approx(0.75)
    assert c["specificity"] == pytest.approx(15 / 16)
    se, ppv = 0.75, 0.75
    assert c["f1"] == pytest.approx(2 * se * ppv / (se + ppv))


def test_per_class_asymmetric_f1():
    # Class X: TP=2, FN=6, FP=2 -> Se=0.25, PPV=0.5, F1=2*0.125/0.75=1/3
    cm = np.array([[2, 6], [2, 10]])
    m = per_class_metrics(cm, ["X", "Y"])
    assert m["X"]["sensitivity"] == pytest.approx(0.25)
    assert m["X"]["ppv"] == pytest.approx(0.5)
    assert m["X"]["f1"] == pytest.approx(1 / 3)
    assert m["X"]["specificity"] == pytest.approx(10 / 12)


def test_zero_division_yields_zero_not_nan():
    # Class "F" has no support and is never predicted; class "Q" is predicted
    # but has no support (only FP).
    cm = np.array(
        [
            [5, 0, 1],
            [0, 0, 0],
            [0, 0, 0],
        ]
    )
    m = per_class_metrics(cm, ["N", "F", "Q"])
    for key in ("sensitivity", "ppv", "f1"):
        assert m["F"][key] == 0.0
    assert m["F"]["specificity"] == 1.0  # TN=6, FP=0
    assert m["F"]["support"] == 0
    assert m["Q"]["sensitivity"] == 0.0  # TP+FN = 0
    assert m["Q"]["ppv"] == 0.0  # TP=0, FP=1
    assert m["Q"]["specificity"] == pytest.approx(5 / 6)
    for entry in m.values():
        for v in entry.values():
            assert not (isinstance(v, float) and np.isnan(v))


def test_all_zero_matrix():
    m = per_class_metrics(np.zeros((2, 2), dtype=int), ["A", "B"])
    for entry in m.values():
        assert entry["sensitivity"] == entry["ppv"] == entry["specificity"] == entry["f1"] == 0.0


def test_per_class_metrics_shape_validation():
    with pytest.raises(ValueError):
        per_class_metrics(np.zeros((2, 3)), ["A", "B"])
    with pytest.raises(ValueError):
        per_class_metrics(np.zeros((3, 3)), ["A", "B"])
    with pytest.raises(ValueError):
        per_class_metrics(np.array([[1, -1], [0, 1]]), ["A", "B"])


def test_summary_macro_f1_only_over_supported_classes():
    # True: 4 N, 2 S, 2 V; no F, no Q. One V predicted as F (F has 0 support).
    y_true = np.array([0, 0, 0, 0, 1, 1, 2, 2])
    y_pred = np.array([0, 0, 0, 1, 1, 0, 2, 3])
    s = summary(y_true, y_pred, CLASSES)
    # N: TP=3 FN=1 FP=1 -> Se=0.75 PPV=0.75 F1=0.75
    # S: TP=1 FN=1 FP=1 -> 0.5/0.5 -> F1=0.5
    # V: TP=1 FN=1 FP=0 -> Se=0.5 PPV=1 -> F1=2/3
    # F: support 0 (excluded), Q: support 0 (excluded)
    assert s["accuracy"] == pytest.approx(5 / 8)
    assert s["macro_f1"] == pytest.approx((0.75 + 0.5 + 2 / 3) / 3)
    assert s["per_class"]["F"]["support"] == 0
    assert s["per_class"]["F"]["ppv"] == 0.0  # predicted once, wrong
    assert s["per_class"]["Q"]["f1"] == 0.0
    assert s["class_names"] == CLASSES
    assert s["n"] == 8
    assert s["confusion"][2] == [0, 0, 1, 1, 0]
    assert set(s) >= {"accuracy", "macro_f1", "per_class", "confusion", "class_names"}


def test_summary_is_pure_python_and_json_serialisable():
    rng = np.random.default_rng(0)
    y_true = rng.integers(0, 5, size=200)
    y_pred = rng.integers(0, 5, size=200)
    s = summary(y_true, y_pred, CLASSES)

    def check(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                assert type(k) is str
                check(v)
        elif isinstance(obj, list):
            for v in obj:
                check(v)
        else:
            assert type(obj) in (int, float, str, bool), type(obj)

    check(s)
    roundtrip = json.loads(json.dumps(s))
    assert roundtrip == s


def test_summary_perfect_and_empty():
    s = summary([0, 1, 2], [0, 1, 2], CLASSES)
    assert s["accuracy"] == 1.0
    assert s["macro_f1"] == 1.0
    e = summary([], [], CLASSES)
    assert e["accuracy"] == 0.0 and e["macro_f1"] == 0.0 and e["n"] == 0


def test_summary_matches_sklearn_on_supported_classes():
    sk = pytest.importorskip("sklearn.metrics")
    rng = np.random.default_rng(1)
    y_true = rng.integers(0, 4, size=300)  # Q never true
    y_pred = rng.integers(0, 5, size=300)
    s = summary(y_true, y_pred, CLASSES)
    labels = [0, 1, 2, 3]
    f1 = sk.f1_score(y_true, y_pred, labels=labels, average=None, zero_division=0)
    rec = sk.recall_score(y_true, y_pred, labels=labels, average=None, zero_division=0)
    prec = sk.precision_score(y_true, y_pred, labels=labels, average=None, zero_division=0)
    for i in labels:
        pc = s["per_class"][CLASSES[i]]
        assert pc["f1"] == pytest.approx(f1[i])
        assert pc["sensitivity"] == pytest.approx(rec[i])
        assert pc["ppv"] == pytest.approx(prec[i])
    assert s["macro_f1"] == pytest.approx(float(np.mean(f1)))
    assert s["accuracy"] == pytest.approx(sk.accuracy_score(y_true, y_pred))


def test_gross_statistics_pooled_and_average():
    names = ["N", "V"]
    r1 = np.array([[9, 1], [1, 3]])  # V: TP=3 FN=1 FP=1 -> Se=.75 PPV=.75
    r2 = np.array([[18, 0], [3, 1]])  # V: TP=1 FN=3 FP=0 -> Se=.25 PPV=1
    g = gross_statistics({"100": r1, "200": r2}, names)
    assert g["n_records"] == 2
    gv = g["gross"]["V"]
    # pooled V: TP=4 FN=4 FP=1 TN=27
    assert (gv["tp"], gv["fn"], gv["fp"], gv["tn"]) == (4, 4, 1, 27)
    assert gv["sensitivity"] == pytest.approx(0.5)
    assert gv["ppv"] == pytest.approx(0.8)
    assert gv["specificity"] == pytest.approx(27 / 28)
    av = g["average"]["V"]
    assert av["sensitivity"] == pytest.approx((0.75 + 0.25) / 2)
    assert av["ppv"] == pytest.approx((0.75 + 1.0) / 2)
    assert av["n_records_sensitivity"] == 2
    json.dumps(g)


def test_gross_statistics_average_skips_undefined_records():
    names = ["N", "V"]
    r1 = np.array([[10, 0], [0, 2]])  # V: Se=1, PPV=1
    r2 = np.array([[10, 0], [0, 0]])  # V absent and never predicted -> undefined
    g = gross_statistics({"a": r1, "b": r2}, names)
    av = g["average"]["V"]
    assert av["sensitivity"] == 1.0 and av["n_records_sensitivity"] == 1
    assert av["ppv"] == 1.0 and av["n_records_ppv"] == 1
    assert av["specificity"] == 1.0 and av["n_records_specificity"] == 2


def test_gross_statistics_veb_fusion_rule():
    # rows/cols N S V F Q; 2 fusion beats predicted as V, 1 N predicted as V
    cm = np.zeros((5, 5), dtype=int)
    cm[0, 0] = 50
    cm[0, 2] = 1
    cm[2, 2] = 6
    cm[3, 2] = 2
    cm[3, 3] = 1
    with_rule = gross_statistics({"r": cm}, CLASSES)["gross"]["V"]
    without = gross_statistics({"r": cm}, CLASSES, veb_ignore_fusion=False)["gross"]["V"]
    assert without["fp"] == 3 and without["ppv"] == pytest.approx(6 / 9)
    assert with_rule["fp"] == 1 and with_rule["ppv"] == pytest.approx(6 / 7)
    # F class itself is unaffected: TP=1, FN=2
    f = gross_statistics({"r": cm}, CLASSES)["gross"]["F"]
    assert (f["tp"], f["fn"]) == (1, 2)


def test_gross_statistics_empty():
    g = gross_statistics({}, CLASSES)
    assert g["n_records"] == 0
    assert all(v["sensitivity"] == 0.0 for v in g["gross"].values())


def test_summary_macro_f1_without_q():
    names = ["N", "S", "V", "F", "Q"]
    y_true = np.array([0, 0, 1, 1, 2, 2, 4])
    y_pred = np.array([0, 0, 1, 1, 2, 2, 0])   # the single Q beat is wrong
    s = summary(y_true, y_pred, names)
    # Q (support 1, F1 0) drags the all-class average down; N/S/V/F ignores it
    assert s["macro_f1_nsvf"] > s["macro_f1"]
    f1 = {k: v["f1"] for k, v in s["per_class"].items()}
    assert s["macro_f1_nsvf"] == pytest.approx((f1["N"] + f1["S"] + f1["V"]) / 3)
    assert summary([0, 1], [0, 1], ["a", "b"])["macro_f1_nsvf"] is None
