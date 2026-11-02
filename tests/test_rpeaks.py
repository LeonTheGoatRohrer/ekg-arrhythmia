"""Tests for ekg.preprocessing.rpeaks (Pan-Tompkins R-peak detection).

Synthetic signals are used for the unit tests only. The validation test reads
the real MIT-BIH record 100 in data/sample/ directly with wfdb (not through
ekg.data.loader) and compares against the reference beat annotations.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from ekg.preprocessing.rpeaks import detect_r_peaks, match_peaks, pan_tompkins_stages

FS = 360
SAMPLE_DIR = Path(__file__).resolve().parents[1] / "data" / "sample"
BEAT_SYMBOLS = set("NLRejAaJSVEF/fQ")


def _gauss(t, mu, sigma):
    return np.exp(-0.5 * ((t - mu) / sigma) ** 2)


def _synthetic_ecg(r_times_s, seconds, fs=FS, qrs_amp=None, t_amp=0.35, noise=0.0, seed=0):
    """Sum of narrow Gaussian 'QRS' spikes plus broad 'T waves' and optional noise."""
    t = np.arange(int(seconds * fs)) / fs
    x = np.zeros_like(t)
    if qrs_amp is None:
        qrs_amp = np.ones(len(r_times_s))
    for rt, a in zip(r_times_s, qrs_amp):
        x += a * _gauss(t, rt, 0.012)                 # QRS ~ 60-70 ms wide
        x -= 0.15 * a * _gauss(t, rt + 0.03, 0.008)   # small S wave
        x += t_amp * _gauss(t, rt + 0.28, 0.045)      # T wave
    if noise:
        x += noise * np.random.default_rng(seed).standard_normal(x.size)
    x += 0.2 * np.sin(2 * np.pi * 0.25 * t)            # baseline wander
    return x


def _true_samples(r_times_s, fs=FS):
    return np.round(np.asarray(r_times_s) * fs).astype(np.int64)


# ---------------------------------------------------------------- stages ----

def test_stages_keys_and_lengths():
    x = _synthetic_ecg(np.arange(0.5, 9.5, 0.8), 10.0)
    st = pan_tompkins_stages(x, FS)
    assert set(st) == {"bandpassed", "derivative", "squared", "integrated"}
    for v in st.values():
        assert v.shape == x.shape
        assert np.all(np.isfinite(v))
    assert np.all(st["squared"] >= 0)
    assert np.all(st["integrated"] >= -1e-12)
    np.testing.assert_allclose(st["squared"], st["derivative"] ** 2)


def test_bandpass_stage_removes_baseline_and_hf():
    t = np.arange(20 * FS) / FS
    st_low = pan_tompkins_stages(np.sin(2 * np.pi * 0.5 * t), FS)["bandpassed"]
    st_mid = pan_tompkins_stages(np.sin(2 * np.pi * 10.0 * t), FS)["bandpassed"]
    st_high = pan_tompkins_stages(np.sin(2 * np.pi * 60.0 * t), FS)["bandpassed"]
    core = slice(2 * FS, -2 * FS)
    assert np.std(st_mid[core]) > 0.6          # pass band (~0.71 for unit sine)
    assert np.std(st_low[core]) < 0.02         # baseline wander suppressed
    assert np.std(st_high[core]) < 0.05        # powerline suppressed


def test_integrated_peaks_align_with_qrs():
    rt = np.arange(0.6, 9.6, 0.9)
    x = _synthetic_ecg(rt, 10.0, t_amp=0.0)
    integ = pan_tompkins_stages(x, FS)["integrated"]
    for s in _true_samples(rt):
        lo, hi = s - 90, s + 90
        assert abs(lo + int(np.argmax(integ[lo:hi])) - s) <= 20  # zero-phase: no group delay


# ------------------------------------------------------------- detection ----

@pytest.mark.parametrize("rr_s", [0.5, 0.8, 1.2])
def test_regular_spikes_correct_count(rr_s):
    rt = np.arange(0.5, 29.5, rr_s)
    x = _synthetic_ecg(rt, 30.0)
    peaks = detect_r_peaks(x, FS)
    assert peaks.dtype == np.int64
    assert np.all(np.diff(peaks) > 0)
    assert len(peaks) == len(rt)
    res = match_peaks(peaks, _true_samples(rt), FS, tol_ms=20)
    assert res["tp"] == len(rt) and res["fp"] == 0 and res["fn"] == 0


def test_pure_spike_train_count():
    x = np.zeros(20 * FS)
    idx = np.arange(FS // 2, x.size - FS // 2, FS)  # 60 bpm unit impulses
    x[idx] = 1.0
    peaks = detect_r_peaks(x, FS)
    assert len(peaks) == len(idx)
    np.testing.assert_array_equal(peaks, idx)


def test_noise_robustness():
    rt = np.arange(0.5, 29.5, 0.75)
    x = _synthetic_ecg(rt, 30.0, noise=0.05, seed=3)
    res = match_peaks(detect_r_peaks(x, FS), _true_samples(rt), FS, tol_ms=50)
    assert res["fn"] == 0 and res["fp"] == 0


def test_inverted_polarity_and_other_fs():
    rt = np.arange(0.5, 19.5, 0.7)
    for fs in (250, 360, 500):
        x = -_synthetic_ecg(rt, 20.0, fs=fs)
        res = match_peaks(detect_r_peaks(x, fs), _true_samples(rt, fs), fs, tol_ms=30)
        assert res["fn"] == 0 and res["fp"] == 0, (fs, res)


def test_large_t_waves_not_detected(monkeypatch):
    # Broad T waves taller than the QRS: their integrated peaks exceed THR1,
    # so only the 360 ms slope criterion keeps them from being counted.
    import ekg.preprocessing.rpeaks as rp

    rt = np.arange(0.5, 29.5, 0.9)
    x = _synthetic_ecg(rt, 30.0, t_amp=1.5)
    truth = _true_samples(rt)
    res = match_peaks(detect_r_peaks(x, FS), truth, FS, tol_ms=20)
    assert res["tp"] == len(rt) and res["fp"] == 0

    # Control: without T-wave discrimination every T wave becomes a false positive.
    monkeypatch.setattr(rp, "T_WAVE_MS", 0.0)
    assert len(rp.detect_r_peaks(x, FS)) == 2 * len(rt)


def test_searchback_recovers_small_beat(monkeypatch):
    # One beat with 40 % amplitude: its integrated peak (~16 % of a normal beat,
    # amplitude enters squared) lies between THR2 and THR1, so it is skipped by
    # the primary threshold and must be recovered by the search-back.
    import ekg.preprocessing.rpeaks as rp

    rt = np.arange(0.5, 29.5, 0.8)
    amp = np.ones(len(rt))
    small = 20
    amp[small] = 0.4
    x = _synthetic_ecg(rt, 30.0, qrs_amp=amp, t_amp=0.1)
    truth = _true_samples(rt)

    peaks = detect_r_peaks(x, FS)
    res = match_peaks(peaks, truth, FS, tol_ms=30)
    assert res["fn"] == 0 and res["fp"] == 0
    assert np.min(np.abs(peaks - truth[small])) <= 10

    # Control: with search-back disabled the small beat is missed.
    monkeypatch.setattr(rp, "SEARCHBACK_RATIO", 1e9)
    res_off = match_peaks(rp.detect_r_peaks(x, FS), truth, FS, tol_ms=30)
    assert res_off["fn"] == 1 and res_off["fp"] == 0


def test_recovers_after_artifact_in_learning_phase():
    # Regression: a large spike inside the 2 s learning window used to set SPKI
    # so high that no QRS was ever accepted for the rest of the record.
    rt = np.arange(0.5, 59.5, 0.8)
    x = _synthetic_ecg(rt, 60.0, noise=0.02, seed=1)
    x[int(0.3 * FS) : int(0.3 * FS) + 4] += 10.0
    res = match_peaks(detect_r_peaks(x, FS), _true_samples(rt), FS, tol_ms=50)
    assert res["tp"] >= len(rt) - 5          # at most the first few seconds are lost
    assert res["fp"] <= 1                    # the spike itself


def test_recovers_after_amplitude_drop():
    # Regression: a ~3x QRS amplitude drop (integrated height / 9) puts every
    # beat below THR2; the re-learning step must restore detection.
    rt = np.arange(0.5, 59.5, 0.8)
    amp = np.where(rt > 30.0, 1.0 / 3.0, 1.0)
    x = _synthetic_ecg(rt, 60.0, qrs_amp=amp, t_amp=0.1, noise=0.01, seed=2)
    res = match_peaks(detect_r_peaks(x, FS), _true_samples(rt), FS, tol_ms=50)
    assert res["fn"] == 0 and res["fp"] == 0


def test_long_pause_does_not_relearn_on_noise():
    # A 4.8 s pause: the re-learning step must not lower the thresholds to the
    # noise floor (noise-only windows lack the QRS max/median contrast).
    rt = np.concatenate([np.arange(0.5, 20.0, 0.8), np.arange(24.5, 59.5, 0.8)])
    x = _synthetic_ecg(rt, 60.0, noise=0.03, seed=3)
    res = match_peaks(detect_r_peaks(x, FS), _true_samples(rt), FS, tol_ms=50)
    assert res["fn"] == 0 and res["fp"] == 0


def test_refractory_period_respected():
    rng = np.random.default_rng(1)
    x = rng.standard_normal(10 * FS)
    peaks = detect_r_peaks(x, FS)
    if len(peaks) > 1:
        assert np.min(np.diff(peaks)) >= int(0.2 * FS)


@pytest.mark.parametrize("x", [np.zeros(5 * FS), np.ones(100), np.array([]), np.zeros(3)])
def test_degenerate_inputs_return_empty(x):
    peaks = detect_r_peaks(x, FS)
    assert peaks.dtype == np.int64 and peaks.size == 0


def test_rejects_2d_input():
    with pytest.raises(ValueError):
        detect_r_peaks(np.zeros((10, 2)), FS)


# ------------------------------------------------------------ match_peaks ---

def test_match_peaks_counts():
    ref = np.array([100, 500, 900, 1300])
    det = np.array([105, 480, 1000, 1310, 2000])
    res = match_peaks(det, ref, fs=360, tol_ms=50)  # tol = 18 samples
    assert res == {"tp": 2, "fp": 3, "fn": 2, "sensitivity": 0.5, "ppv": 0.4}


def test_match_peaks_greedy_one_to_one():
    # Two detections near one reference: only the nearest one matches.
    res = match_peaks([98, 103], [100], fs=360, tol_ms=150)
    assert (res["tp"], res["fp"], res["fn"]) == (1, 1, 0)
    # Greedy nearest-first: det 110 is nearest to ref 112, det 95 then takes ref 100.
    res = match_peaks([95, 110], [100, 112], fs=360, tol_ms=150)
    assert (res["tp"], res["fp"], res["fn"]) == (2, 0, 0)


def test_match_peaks_tolerance_boundary_and_empty():
    assert match_peaks([136], [100], fs=360, tol_ms=100)["tp"] == 1   # 36 samples == 100 ms
    assert match_peaks([137], [100], fs=360, tol_ms=100)["tp"] == 0
    res = match_peaks([], [], fs=360)
    assert res == {"tp": 0, "fp": 0, "fn": 0, "sensitivity": 0.0, "ppv": 0.0}
    res = match_peaks([], [1, 2], fs=360)
    assert res["fn"] == 2 and res["sensitivity"] == 0.0


# ------------------------------------------------- real data: record 100 ----

def test_record_100_against_reference_annotations():
    wfdb = pytest.importorskip("wfdb")
    if not (SAMPLE_DIR / "100.dat").exists():
        pytest.skip("record 100 not present in data/sample")
    rec = wfdb.rdrecord(str(SAMPLE_DIR / "100"))
    ann = wfdb.rdann(str(SAMPLE_DIR / "100"), "atr")
    lead = rec.sig_name.index("MLII") if "MLII" in rec.sig_name else 0
    x = rec.p_signal[:, lead]
    ref = np.array([s for s, sym in zip(ann.sample, ann.symbol) if sym in BEAT_SYMBOLS], dtype=np.int64)
    assert len(ref) > 2000

    peaks = detect_r_peaks(x, rec.fs)
    res = match_peaks(peaks, ref, rec.fs, tol_ms=150)
    print(f"record 100: {res}")
    assert res["sensitivity"] >= 0.99
    assert res["ppv"] >= 0.99

    # The final position should sit on the annotated R apex, not just near the QRS.
    tight = match_peaks(peaks, ref, rec.fs, tol_ms=20)
    assert tight["sensitivity"] >= 0.99


def _record_100_preprocessed():
    if not (SAMPLE_DIR / "100.dat").exists():
        pytest.skip("record 100 not present in data/sample")
    from ekg.data.loader import aami_class, load_record
    from ekg.preprocessing.filters import preprocess

    rec = load_record("100", SAMPLE_DIR)
    ref = np.array([s for s, sym in zip(rec.ann_samples, rec.ann_symbols) if aami_class(sym)])
    return preprocess(rec.signal, rec.fs), ref, rec.fs


@pytest.mark.parametrize("amp", [5.0, 8.0])
def test_record_100_spike_in_learning_phase(amp):
    x, ref, fs = _record_100_preprocessed()
    v = x.copy()
    v[100:110] += amp           # before the fix: amp=8 -> 0 beats in 30 min
    res = match_peaks(detect_r_peaks(v, fs), ref, fs, tol_ms=50)
    assert res["fn"] <= 10 and res["fp"] <= 2, res


@pytest.mark.parametrize("gain", [0.33, 0.25])
def test_record_100_amplitude_drop(gain):
    x, ref, fs = _record_100_preprocessed()
    n = np.arange(x.size)
    v = np.where(n > x.size // 2, gain * x, x)   # before the fix: sensitivity ~0.50
    res = match_peaks(detect_r_peaks(v, fs), ref, fs, tol_ms=50)
    assert res["fn"] <= 10 and res["fp"] <= 2, res
