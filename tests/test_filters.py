"""Tests for ekg.preprocessing.filters.

Synthetic sinusoids are used for the frequency-selectivity checks; the real
MIT-BIH record 100 in data/sample/ is only used for a sanity check.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pytest

from ekg.preprocessing.filters import (
    bandpass,
    frequency_response,
    notch,
    preprocess,
    remove_baseline,
)

FS = 360
SAMPLE_DIR = Path(__file__).resolve().parents[1] / "data" / "sample"


def _sine(freq, seconds=20.0, fs=FS, amp=1.0, phase=0.0):
    t = np.arange(int(seconds * fs)) / fs
    return amp * np.sin(2 * np.pi * freq * t + phase)


def _rms(x):
    return float(np.sqrt(np.mean(np.square(x))))


def _core(x, fs=FS, margin_s=3.0):
    """Drop edges to ignore filtfilt transients."""
    m = int(margin_s * fs)
    return x[m:-m]


# --- bandpass -----------------------------------------------------------------

def test_bandpass_attenuates_very_low_frequency():
    x = _sine(0.1, seconds=60.0)
    y = bandpass(x, FS)
    assert _rms(_core(y, margin_s=10.0)) < 0.05 * _rms(x)


def test_bandpass_passes_10hz_unchanged():
    x = _sine(10.0)
    y = bandpass(x, FS)
    assert _rms(_core(y)) == pytest.approx(_rms(_core(x)), rel=0.02)
    assert np.max(np.abs(_core(y) - _core(x))) < 0.03


def test_bandpass_attenuates_high_frequency():
    x = _sine(100.0)
    y = bandpass(x, FS)
    assert _rms(_core(y)) < 0.01 * _rms(x)


def test_bandpass_is_zero_phase():
    # Gaussian "QRS-like" pulse: peak position must not move.
    n = 10 * FS
    t = np.arange(n)
    center = 5 * FS
    x = np.exp(-0.5 * ((t - center) / 8.0) ** 2)
    y = bandpass(x, FS)
    assert int(np.argmax(y)) == center
    # Sine phase preserved: cross-correlation lag 0
    s = _sine(10.0, phase=0.7)
    ys = bandpass(s, FS)
    c_s, c_y = _core(s), _core(ys)
    lags = np.arange(-10, 11)
    xc = [np.dot(c_s[20:-20], np.roll(c_y, k)[20:-20]) for k in lags]
    assert lags[int(np.argmax(xc))] == 0


def test_bandpass_rejects_invalid_band():
    with pytest.raises(ValueError):
        bandpass(np.zeros(1000), FS, low=40.0, high=0.5)
    with pytest.raises(ValueError):
        bandpass(np.zeros(1000), FS, low=0.5, high=200.0)


# --- notch --------------------------------------------------------------------

def test_notch_attenuates_60hz_and_keeps_10hz():
    hum = _sine(60.0, amp=0.5)
    sig = _sine(10.0)
    y = notch(sig + hum, FS)
    residual = _core(y) - _core(sig)
    assert _rms(residual) < 0.05 * _rms(_core(hum))
    assert _rms(_core(notch(sig, FS))) == pytest.approx(_rms(_core(sig)), rel=0.01)


def test_notch_custom_frequency():
    hum = _sine(50.0)
    assert _rms(_core(notch(hum, FS, freq=50.0))) < 0.05 * _rms(hum)


# --- remove_baseline ----------------------------------------------------------

def test_remove_baseline_removes_wander_and_keeps_pulses():
    n = 20 * FS
    t = np.arange(n) / FS
    wander = 0.8 * np.sin(2 * np.pi * 0.2 * t) + 0.3
    pulses = np.zeros(n)
    peaks = np.arange(FS // 2, n - FS // 2, FS)  # 60 bpm
    k = np.arange(-10, 11)
    for p in peaks:
        pulses[p + k] += np.exp(-0.5 * (k / 3.0) ** 2)
    y = remove_baseline(pulses + wander, FS)
    assert y.shape == (n,)
    # Baseline between beats close to zero
    between = (peaks[:-1] + FS // 2)
    assert np.max(np.abs(y[between])) < 0.1
    # Peaks preserved in place and in amplitude
    for p in peaks[2:-2]:
        seg = y[p - 20 : p + 21]
        assert int(np.argmax(seg)) == 20
        assert seg[20] == pytest.approx(1.0, abs=0.1)


def test_remove_baseline_constant_offset():
    y = remove_baseline(np.full(5000, 3.5), FS)
    assert np.allclose(y, 0.0)


def test_remove_baseline_fast_on_full_record_length():
    rng = np.random.default_rng(0)
    x = rng.standard_normal(650_000)
    t0 = time.perf_counter()
    remove_baseline(x, FS)
    assert time.perf_counter() - t0 < 3.0


# --- preprocess ---------------------------------------------------------------

@pytest.mark.parametrize("use_notch", [False, True])
def test_preprocess_length_and_dtype(use_notch):
    x = (_sine(10.0) + _sine(0.1) + 0.2 * _sine(60.0)).astype(np.float32)
    y = preprocess(x, FS, use_notch=use_notch)
    assert y.dtype == np.float32
    assert y.shape == x.shape
    assert np.all(np.isfinite(y))


def test_preprocess_accepts_lists_and_rejects_2d():
    y = preprocess(list(_sine(10.0, seconds=5.0)), FS)
    assert y.dtype == np.float32 and y.shape == (5 * FS,)
    with pytest.raises(ValueError):
        preprocess(np.zeros((2, 1000)), FS)


# --- frequency_response ---------------------------------------------------------

def test_frequency_response_structure_and_values():
    fr = frequency_response(FS, n=256)
    assert set(fr) >= {"freqs", "gain_db", "gain_db_zero_phase", "low", "high", "order"}
    assert len(fr["freqs"]) == len(fr["gain_db"]) == len(fr["gain_db_zero_phase"]) == 256
    assert fr["freqs"][0] == 0.0 and fr["freqs"][-1] == pytest.approx(FS / 2)
    assert all(type(v) is float for v in fr["freqs"] + fr["gain_db"] + fr["gain_db_zero_phase"])
    assert fr["low"] == 0.5 and fr["high"] == 40.0 and fr["order"] == 4
    json.dumps(fr, allow_nan=False)  # must be strictly JSON-serialisable

    f = np.array(fr["freqs"])
    g = np.array(fr["gain_db"])
    gz = np.array(fr["gain_db_zero_phase"])
    assert np.allclose(gz, 2 * g)
    # Passband ~0 dB, cutoffs ~-3 dB (one-way), strong stopband attenuation
    assert np.max(np.abs(g[(f > 3) & (f < 30)])) < 0.5
    assert np.interp(40.0, f, g) == pytest.approx(-3.0, abs=0.3)
    assert np.max(g[f > 100]) < -30


def test_frequency_response_matches_filter_on_signal():
    # Effective gain of bandpass() at 45 Hz must match the zero-phase response.
    fr = frequency_response(FS, n=2049)
    f = np.array(fr["freqs"])
    expected_db = np.interp(45.0, f, fr["gain_db_zero_phase"])
    x = _sine(45.0)
    measured_db = 20 * np.log10(_rms(_core(bandpass(x, FS))) / _rms(_core(x)))
    assert measured_db == pytest.approx(expected_db, abs=0.2)


# --- sanity on real MIT-BIH record 100 ---------------------------------------------

@pytest.mark.skipif(not (SAMPLE_DIR / "100.dat").exists(), reason="record 100 not present")
def test_preprocess_on_record_100():
    wfdb = pytest.importorskip("wfdb")
    rec = wfdb.rdrecord(str(SAMPLE_DIR / "100"))
    ch = rec.sig_name.index("MLII") if "MLII" in rec.sig_name else 0
    x = rec.p_signal[:, ch].astype(np.float32)
    assert rec.fs == FS

    t0 = time.perf_counter()
    y = preprocess(x, rec.fs)
    elapsed = time.perf_counter() - t0

    assert y.dtype == np.float32 and y.shape == x.shape
    assert np.all(np.isfinite(y))
    assert abs(float(np.mean(x))) > 0.1        # raw signal has a DC offset
    assert abs(float(np.mean(y))) < 0.01       # removed after preprocessing
    # QRS amplitude survives filtering (record 100 R waves are ~1 mV)
    assert 0.5 < float(np.percentile(y, 99.9)) < 3.0
    assert elapsed < 5.0


def test_frequency_response_log_spaced():
    resp = frequency_response(FS, n=256, log_spaced=True, f_min=0.05)
    f = np.asarray(resp["freqs"])
    assert resp["spacing"] == "log" and f.size == 256
    assert f[0] == pytest.approx(0.05) and f[-1] == pytest.approx(FS / 2)
    ratios = f[1:] / f[:-1]
    assert np.allclose(ratios, ratios[0])          # geometric spacing
    assert np.all(np.isfinite(resp["gain_db"]))
    # Corner frequencies: about -3 dB one-way near 0.5 Hz and 40 Hz
    g = np.asarray(resp["gain_db"])
    assert np.interp(0.5, f, g) == pytest.approx(-3.0, abs=0.5)
    assert np.interp(40.0, f, g) == pytest.approx(-3.0, abs=0.5)
    assert frequency_response(FS)["spacing"] == "linear"
    with pytest.raises(ValueError):
        frequency_response(FS, log_spaced=True, f_min=0.0)
