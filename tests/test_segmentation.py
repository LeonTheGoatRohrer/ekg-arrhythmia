"""Tests for ekg.preprocessing.segmentation.

Unit tests use small synthetic arrays; the integration tests run on the real
MIT-BIH record 100 shipped in data/sample/.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

import numpy as np
import pytest

from ekg.data.loader import CLASSES, Record, aami_class, load_record
from ekg.preprocessing.segmentation import (
    POST_MS,
    PRE_MS,
    BeatSet,
    build_beat_dataset,
    rr_features,
    segment_beats,
    window_samples,
)

FS = 360
SAMPLE_DIR = Path(__file__).resolve().parents[1] / "data" / "sample"


# ---------------------------------------------------------------- segment_beats
def test_window_length_is_252_at_360hz():
    assert (PRE_MS, POST_MS) == (250, 450)
    assert window_samples(FS) == (90, 162)


def test_segment_beats_window_content_and_edges():
    x = np.arange(1000, dtype=np.float32)
    r = np.array([50, 90, 300, 838, 839, 999])
    beats, kept = segment_beats(x, r, FS)
    # 50 < 90 dropped; 90 ok (start 0); 838 ok (end 1000 == len); 839, 999 dropped
    assert kept.tolist() == [1, 2, 3]
    assert kept.dtype == np.int64
    assert beats.shape == (3, 252) and beats.dtype == np.float32
    np.testing.assert_array_equal(beats[1], np.arange(300 - 90, 300 + 162))
    assert beats[0, 0] == 0 and beats[2, -1] == 999
    # R peak sits at index `pre` inside the window
    assert beats[1, 90] == 300


def test_segment_beats_no_normalisation_and_empty():
    x = np.full(500, 3.0, dtype=np.float32)
    beats, _ = segment_beats(x, [200], FS)
    assert np.all(beats == 3.0)
    beats, kept = segment_beats(x, [], FS)
    assert beats.shape == (0, 252) and kept.size == 0


def test_segment_beats_custom_window_and_fs():
    beats, _ = segment_beats(np.zeros(1000), [500], 250, pre_ms=200, post_ms=400)
    assert beats.shape == (1, 50 + 100)


# ---------------------------------------------------------------- rr_features
def test_rr_features_definitions():
    r = np.array([0, 360, 540, 1080, 1440])  # RR = 1.0, 0.5, 1.5, 1.0 s
    f = rr_features(r, FS)
    assert f.shape == (5, 4) and f.dtype == np.float32
    np.testing.assert_allclose(f[:, 0], [1.0, 1.0, 0.5, 1.5, 1.0])  # pre_rr (first := post)
    np.testing.assert_allclose(f[:, 1], [1.0, 0.5, 1.5, 1.0, 1.0])  # post_rr (last := pre)
    expected_local = [1.0, 1.0, 2.5 / 3, 4.0 / 4, 5.0 / 5]
    np.testing.assert_allclose(f[:, 2], expected_local, rtol=1e-6)
    np.testing.assert_allclose(f[:, 3], f[:, 0] / f[:, 2], rtol=1e-6)


def test_rr_local_window_is_causal_10_beats():
    rr_samples = np.arange(1, 21) * 10  # increasing RR so means differ
    r = np.concatenate(([0], np.cumsum(rr_samples)))
    f = rr_features(r, FS)
    pre = f[:, 0].astype(np.float64)
    for i in range(len(r)):
        lo = max(0, i - 9)
        assert f[i, 2] == pytest.approx(pre[lo : i + 1].mean(), rel=1e-6)
    # causality: changing future peaks does not change earlier local_rr
    r2 = r.copy()
    r2[15:] += 500
    f2 = rr_features(r2, FS)
    np.testing.assert_array_equal(f[:15, 2], f2[:15, 2])


def test_rr_features_degenerate_inputs():
    assert rr_features([], FS).shape == (0, 4)
    one = rr_features([100], FS)
    assert one.shape == (1, 4) and one[0, 3] == 1.0
    with pytest.raises(ValueError):
        rr_features([10, 10, 20], FS)


# ---------------------------------------------------------------- BeatSet.concat
def _bs(n, name, label):
    return BeatSet(
        beats=np.zeros((n, 252), np.float32),
        rr=np.ones((n, 4), np.float32),
        labels=np.full(n, label, np.int64),
        record=np.full(n, name),
        r_sample=np.arange(n, dtype=np.int64),
    )


def test_beatset_concat():
    c = BeatSet.concat([_bs(3, "100", 0), _bs(2, "1000", 2)])
    assert len(c) == 5
    assert c.beats.shape == (5, 252) and c.rr.shape == (5, 4)
    assert c.record.tolist() == ["100"] * 3 + ["1000"] * 2
    assert c.labels.tolist() == [0, 0, 0, 2, 2] and c.labels.dtype == np.int64
    assert len(BeatSet.concat([])) == 0
    with pytest.raises(ValueError):
        BeatSet.concat([_bs(1, "a", 0), BeatSet.empty(100)])


# ---------------------------------------------------------------- synthetic record
def _synthetic_record():
    """Spike train with a premature 'V' beat and a non-beat '+' annotation."""
    n = FS * 10
    peaks = [60, 400, 760, 1120, 1300, 1840, 2200, 2560, 2920, 3550]
    syms = ["N", "N", "N", "N", "V", "N", "N", "A", "N", "N"]
    x = np.zeros(n, np.float32)
    for p in peaks:
        x[p - 3 : p + 4] += np.array([0.1, 0.4, 0.8, 1.0, 0.8, 0.4, 0.1], np.float32)
    ann_s = np.array(peaks[:3] + [1000] + peaks[3:], np.int64)
    ann_y = syms[:3] + ["+"] + syms[3:]
    return Record("syn", x, FS, ann_s, ann_y)


def test_build_beat_dataset_synthetic_reference():
    rec = _synthetic_record()
    bs = build_beat_dataset(rec)
    # 60 (< 90) and 3550 (+162 > 3600) dropped -> 8 beats; '+' ignored
    assert len(bs) == 8
    assert bs.r_sample.tolist() == [400, 760, 1120, 1300, 1840, 2200, 2560, 2920]
    assert [CLASSES[i] for i in bs.labels] == ["N", "N", "N", "V", "N", "N", "S", "N"]
    # RR uses the dropped edge beats as neighbours (and not the '+' annotation)
    assert bs.rr[0, 0] == pytest.approx(340 / FS)
    assert bs.rr[-1, 1] == pytest.approx(630 / FS)
    assert bs.rr[3, 0] == pytest.approx(180 / FS)  # premature V
    assert np.all(bs.record == "syn")


# ---------------------------------------------------------------- real record 100
@pytest.fixture(scope="module")
def rec100():
    if not (SAMPLE_DIR / "100.dat").exists():
        pytest.skip("data/sample/100 not available")
    return load_record("100", SAMPLE_DIR)


@pytest.fixture(scope="module")
def ds100(rec100):
    return build_beat_dataset(rec100)


def _beat_annotations(rec):
    return [(int(s), sym) for s, sym in zip(rec.ann_samples, rec.ann_symbols) if aami_class(sym)]


def test_record100_beat_count_and_shapes(rec100, ds100):
    beats = _beat_annotations(rec100)
    pre, post = window_samples(rec100.fs)
    n_edge = sum(1 for s, _ in beats if s - pre < 0 or s + post > rec100.signal.size)
    assert 1 <= n_edge <= 4
    assert len(ds100) == len(beats) - n_edge
    assert ds100.beats.shape == (len(ds100), 252) and ds100.beats.dtype == np.float32
    assert ds100.rr.shape == (len(ds100), 4) and ds100.rr.dtype == np.float32
    assert ds100.labels.dtype == np.int64 and ds100.r_sample.dtype == np.int64
    assert np.all(ds100.record == "100")
    assert np.all(np.diff(ds100.r_sample) > 0)


def test_record100_labels_match_annotation_counts(rec100, ds100):
    pre, post = window_samples(rec100.fs)
    expected = Counter(
        aami_class(sym)
        for s, sym in _beat_annotations(rec100)
        if s - pre >= 0 and s + post <= rec100.signal.size
    )
    got = Counter(CLASSES[i] for i in ds100.labels)
    assert got == expected
    assert set(got) <= {"N", "S", "V"}  # record 100: N, A (-> S), V only
    assert got["S"] == Counter(rec100.ann_symbols)["A"]
    assert got["V"] == Counter(rec100.ann_symbols)["V"]


def test_record100_rr_plausible(ds100):
    pre_rr, post_rr, local_rr, ratio = ds100.rr.T
    for col in (pre_rr, post_rr, local_rr):
        assert np.all((col >= 0.3) & (col <= 2.0))
    assert 0.6 < np.median(pre_rr) < 1.2
    assert np.all(np.isfinite(ratio)) and 0.9 < np.median(ratio) < 1.1
    # S beats (premature atrial contractions) should on average be premature
    s = ds100.labels == CLASSES.index("S")
    assert ratio[s].mean() < ratio[ds100.labels == 0].mean()


def test_record100_znormalised_and_r_peak_centred(ds100):
    b = ds100.beats.astype(np.float64)
    np.testing.assert_allclose(b.mean(axis=1), 0.0, atol=1e-4)
    np.testing.assert_allclose(b.std(axis=1), 1.0, atol=1e-3)
    # For normal beats in MLII, the R peak (index 90) is near the window maximum.
    n_beats = b[ds100.labels == 0]
    near_max = np.abs(np.argmax(n_beats, axis=1) - 90) <= 10
    assert near_max.mean() > 0.95


def test_record100_detected_peaks_mode(rec100, ds100):
    try:
        from ekg.preprocessing.rpeaks import detect_r_peaks  # noqa: F401
    except ImportError:
        pytest.skip("rpeaks module not available")
    bd = build_beat_dataset(rec100, use_reference_peaks=False)
    assert bd.beats.shape[1] == 252
    assert set(np.unique(bd.labels)) <= {0, 1, 2}
    assert np.all(bd.labels >= 0)
    # Matched detections are close to the reference positions
    ref = np.array([s for s, _ in _beat_annotations(rec100)])
    nearest = np.abs(bd.r_sample[:, None] - ref[None, :]).min(axis=1)
    assert np.all(nearest <= 0.15 * rec100.fs)
    assert len(bd) >= 0.95 * len(ds100)
    assert len(np.unique(bd.r_sample)) == len(bd)
