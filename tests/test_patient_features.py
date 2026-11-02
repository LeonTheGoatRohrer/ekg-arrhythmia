"""Tests for ekg.preprocessing.patient_features (record-relative CNN inputs)."""

from __future__ import annotations

import numpy as np
import pytest

from ekg.preprocessing.patient_features import FEATURE_NAMES, patient_relative_features


def _beats(n: int, length: int = 252, seed: int = 0) -> np.ndarray:
    t = np.arange(length) - 90  # R peak at 250 ms = sample 90 @ 360 Hz
    base = np.exp(-(t / 6.0) ** 2)  # a narrow "QRS" bump around R
    rng = np.random.default_rng(seed)
    return base + 0.01 * rng.standard_normal((n, length))


def test_shape_and_names():
    b = _beats(6)
    rr = np.ones((6, 4))
    f = patient_relative_features(b, rr, np.array(["a"] * 6))
    assert f.shape == (6, len(FEATURE_NAMES)) == (6, 6)
    assert f.dtype == np.float32


def test_rr_is_normalised_per_record():
    b = _beats(4)
    rr = np.array([[1.0, 1.0, 1.0, 1.0], [0.5, 1.5, 0.75, 0.67],   # record a: mean pre_rr 0.75
                   [0.4, 0.4, 0.4, 1.0], [0.4, 0.4, 0.4, 1.0]])    # record b: mean pre_rr 0.4
    f = patient_relative_features(b, rr, np.array(["a", "a", "b", "b"]))
    np.testing.assert_allclose(f[0, :3], np.array([1.0, 1.0, 1.0]) / 0.75, rtol=1e-6)
    np.testing.assert_allclose(f[1, :3], np.array([0.5, 1.5, 0.75]) / 0.75, rtol=1e-6)
    np.testing.assert_allclose(f[2:, :3], 1.0, rtol=1e-6)  # same tempo as its own record -> 1


def test_template_deviation_flags_the_odd_beat():
    b = _beats(9)
    odd = b[0].copy()
    b[8] = -odd  # inverted morphology, e.g. a ventricular beat
    f = patient_relative_features(b, np.ones((9, 4)), np.array(["a"] * 9))
    corr, corr_qrs, rms = f[:, 3], f[:, 4], f[:, 5]
    assert np.all(corr[:8] > 0.95) and corr[8] < -0.9
    assert np.all(corr_qrs[:8] > 0.95) and corr_qrs[8] < -0.9
    assert rms[8] > 10 * rms[:8].max()


def test_flat_beats_give_zero_correlation():
    f = patient_relative_features(np.zeros((3, 252)), np.ones((3, 4)), np.array(["a"] * 3))
    assert np.all(f[:, 3:] == 0)
    assert np.all(np.isfinite(f))


@pytest.mark.parametrize("pre_ms", [250, 100])
def test_qrs_window_stays_inside(pre_ms):
    f = patient_relative_features(_beats(3), np.ones((3, 4)), np.array(["a"] * 3), pre_ms=pre_ms)
    assert np.all(np.isfinite(f))
