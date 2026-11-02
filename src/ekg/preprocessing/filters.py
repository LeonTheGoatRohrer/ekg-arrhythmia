"""ECG signal conditioning: baseline removal, band-pass and notch filtering.

All filters are zero-phase (forward-backward) so that the position of the
R peak and the morphology of the QRS complex are not shifted in time. This
matters because beat segmentation downstream cuts fixed windows around the
R-peak sample index.

Pipeline used by :func:`preprocess` (follows de Chazal et al., 2004 for the
baseline step)::

    raw -> remove_baseline (median 200 ms -> median 600 ms) -> bandpass 0.5-40 Hz [-> notch]
"""

from __future__ import annotations

import numpy as np
from scipy import signal
from scipy.ndimage import median_filter

__all__ = [
    "remove_baseline",
    "bandpass",
    "notch",
    "preprocess",
    "frequency_response",
]

# Floor for dB conversion so the JSON export never contains -inf
# (the band-pass has exact zeros at 0 Hz and at fs/2).
_DB_FLOOR = -200.0


def _as_1d_float(x) -> np.ndarray:
    arr = np.asarray(x, dtype=np.float64)
    if arr.ndim != 1:
        raise ValueError(f"expected a 1-D signal, got shape {arr.shape}")
    return arr


def _odd_kernel(fs: float, ms: float) -> int:
    """Kernel length in samples for a window of `ms` milliseconds, forced odd (>= 1)."""
    k = int(round(fs * ms / 1000.0))
    if k % 2 == 0:
        k += 1
    return max(k, 1)


def _baseline(x: np.ndarray, fs: float) -> np.ndarray:
    # Two cascaded median filters: the 200 ms one removes QRS complexes and
    # P waves, the 600 ms one removes T waves; what is left is baseline wander.
    # mode="reflect" avoids the zero-padding edge artefacts of scipy.signal.medfilt.
    k1 = _odd_kernel(fs, 200.0)  # 73 samples @ 360 Hz
    k2 = _odd_kernel(fs, 600.0)  # 217 samples @ 360 Hz
    b = median_filter(x, size=k1, mode="reflect")
    return median_filter(b, size=k2, mode="reflect")


def remove_baseline(x, fs) -> np.ndarray:
    """Remove baseline wander via two cascaded median filters (200 ms, 600 ms).

    Returns ``x - baseline`` as float64 with the same length as ``x``.
    """
    arr = _as_1d_float(x)
    if arr.size == 0:
        return arr.copy()
    return arr - _baseline(arr, float(fs))


def _bandpass_sos(fs: float, low: float, high: float, order: int) -> np.ndarray:
    if not 0 < low < high < fs / 2:
        raise ValueError(f"need 0 < low < high < fs/2, got low={low}, high={high}, fs={fs}")
    return signal.butter(order, [low, high], btype="band", fs=fs, output="sos")


def bandpass(x, fs, low=0.5, high=40.0, order=4) -> np.ndarray:
    """Zero-phase Butterworth band-pass (second-order sections + sosfiltfilt).

    Because the filter runs forward and backward, the effective magnitude
    response is the square of the one-way response and the phase is zero.
    """
    arr = _as_1d_float(x)
    sos = _bandpass_sos(float(fs), float(low), float(high), int(order))
    return signal.sosfiltfilt(sos, arr)


def notch(x, fs, freq=60.0, q=30.0) -> np.ndarray:
    """Zero-phase IIR notch at `freq` Hz (power-line interference; 60 Hz in the US/MIT-BIH)."""
    arr = _as_1d_float(x)
    fs = float(fs)
    if not 0 < freq < fs / 2:
        raise ValueError(f"notch frequency must be in (0, fs/2), got {freq} (fs={fs})")
    b, a = signal.iirnotch(float(freq), float(q), fs=fs)
    return signal.filtfilt(b, a, arr)


def preprocess(x, fs, use_notch=False) -> np.ndarray:
    """Full conditioning chain: baseline removal -> band-pass [-> notch].

    Returns a float32 array of the same length as ``x``.
    """
    y = remove_baseline(x, fs)
    y = bandpass(y, fs)
    if use_notch:
        y = notch(y, fs)
    return y.astype(np.float32, copy=False)


def frequency_response(fs, low=0.5, high=40.0, order=4, n=512, *, log_spaced=False, f_min=0.05) -> dict:
    """Magnitude response of the band-pass used in :func:`bandpass`.

    Returns a JSON-serialisable dict with ``n`` frequencies evenly spaced from
    0 Hz to fs/2 (inclusive):

    - ``gain_db``: one-way magnitude response of the Butterworth SOS filter
      (20*log10|H(f)|), as returned by ``sosfreqz``.
    - ``gain_db_zero_phase``: effective response of the zero-phase
      ``sosfiltfilt`` application, which squares the magnitude, i.e.
      ``2 * gain_db``. This is what is actually applied to the signal.

    Exact zeros of H (0 Hz and fs/2) would give -inf dB; values are clipped
    to a floor of -200 dB (one-way) so the output is valid JSON.

    With ``log_spaced=True`` (keyword-only extension used by the web export)
    the ``n`` frequencies are geometrically spaced from ``f_min`` to fs/2, which
    resolves the 0.5 Hz high-pass corner on a logarithmic axis; the result
    then carries ``"spacing": "log"`` (otherwise ``"linear"``).
    """
    fs = float(fs)
    n = int(n)
    if n < 2:
        raise ValueError("n must be >= 2")
    sos = _bandpass_sos(fs, float(low), float(high), int(order))
    if log_spaced:
        f_min = float(f_min)
        if not 0.0 < f_min < fs / 2.0:
            raise ValueError("f_min must be in (0, fs/2)")
        freqs = np.geomspace(f_min, fs / 2.0, n)
    else:
        freqs = np.linspace(0.0, fs / 2.0, n)
    _, h = signal.sosfreqz(sos, worN=freqs, fs=fs)
    mag = np.abs(h)
    with np.errstate(divide="ignore"):
        gain_db = 20.0 * np.log10(mag)
    gain_db = np.maximum(gain_db, _DB_FLOOR)
    return {
        "freqs": [float(f) for f in freqs],
        "gain_db": [float(g) for g in gain_db],
        "gain_db_zero_phase": [float(2.0 * g) for g in gain_db],
        "low": float(low),
        "high": float(high),
        "order": int(order),
        "fs": fs,
        "spacing": "log" if log_spaced else "linear",
    }
