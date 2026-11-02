"""QRS / R-peak detection after Pan & Tompkins (1985).

Reference: J. Pan, W. J. Tompkins, "A Real-Time QRS Detection Algorithm",
IEEE Trans. Biomed. Eng. 32(3):230-236, 1985.

Processing stages (all exposed by :func:`pan_tompkins_stages`)::

    x -> band-pass 5-15 Hz -> 5-point derivative -> squaring
      -> moving-window integration (150 ms) -> adaptive dual thresholds

Implementation decisions (offline, not real-time):

* **Zero-phase filtering.** The original paper uses causal integer-coefficient
  filters, which delay the signal by ~24 samples at 200 Hz. Here the band-pass
  is a 2nd-order Butterworth applied forward-backward (``sosfiltfilt``), the
  derivative is the centred 5-point kernel and the integration window is
  centred. All intermediate signals are therefore time-aligned with the input,
  which keeps the fiducial marks close to the QRS and simplifies the final
  peak localisation.
* **Decision logic on the integrated signal** (SPKI / NPKI, threshold
  ``THR1 = NPKI + 0.25 (SPKI - NPKI)``, ``THR2 = 0.5 THR1``), with
  - a 200 ms refractory period,
  - T-wave discrimination: a candidate within 360 ms of the previous QRS is
    rejected if its maximal slope is below half the slope of the previous QRS,
  - search-back: when no QRS was found for 166 % of the mean RR interval, the
    largest skipped candidate above ``THR2`` is accepted
    (``SPKI = 0.25 peak + 0.75 SPKI``).
  The mean RR interval is the mean of the last 8 accepted RR intervals that
  lie within 92-116 % of the running mean (Pan-Tompkins "RR AVERAGE2"),
  falling back to the plain mean of the last 8 RR intervals.
* **Threshold recovery (not in the paper).** SPKI only changes when a beat is
  accepted, so a large artifact in the 2 s learning window or a QRS amplitude
  drop of ~3x would otherwise keep the thresholds above every real QRS for
  the rest of the record. When no QRS has been accepted for
  ``max(2 s, 1.66 RR mean)`` and search-back finds nothing, the learning phase
  is re-run on the next 2 s of the integrated signal (offline look-ahead,
  SPKI = 0.25 max, NPKI = 0.5 mean) and search-back is retried with the new
  thresholds. A window is only used when its maximum exceeds 10x its median
  (QRS bursts; record 100: >= 36x, white noise: 3-6x), so sinus pauses do not
  pull the thresholds down to the noise floor.
* **Final R-peak position.** The integrated signal only marks the QRS region.
  The returned sample index is the extremum of the *input signal* inside a
  window of +/- 75 ms around the fiducial mark: the sample with the largest
  absolute deviation from the window median. Using the original signal (and
  not ``|bandpassed|``) places the index on the R-wave apex, which is how the
  MIT-BIH reference annotations are positioned; the median-relative absolute
  value keeps it working for predominantly negative QRS complexes. Measured on
  record 100 the median offset to the reference annotation is a few samples.
"""

from __future__ import annotations

import numpy as np
from scipy import signal

__all__ = [
    "detect_r_peaks",
    "pan_tompkins_stages",
    "match_peaks",
]

# Algorithm constants (milliseconds / ratios from Pan & Tompkins 1985).
BAND_LOW_HZ = 5.0
BAND_HIGH_HZ = 15.0
BAND_ORDER = 2
INTEGRATION_MS = 150.0
REFRACTORY_MS = 200.0
T_WAVE_MS = 360.0
SEARCHBACK_RATIO = 1.66
LEARNING_S = 2.0
REFINE_MS = 75.0
SLOPE_WINDOW_MS = 75.0
RELEARN_CONTRAST = 10.0  # min. max/median of the integrated signal for a re-learn window


def _as_1d_float(x) -> np.ndarray:
    arr = np.asarray(x, dtype=np.float64)
    if arr.ndim != 1:
        raise ValueError(f"expected a 1-D signal, got shape {arr.shape}")
    return arr


def _ms(fs: float, ms: float) -> int:
    return max(1, int(round(ms * fs / 1000.0)))


def _bandpass_5_15(x: np.ndarray, fs: float) -> np.ndarray:
    nyq = fs / 2.0
    if BAND_HIGH_HZ >= nyq:
        raise ValueError(f"fs={fs} Hz is too low for a 5-15 Hz band-pass")
    sos = signal.butter(BAND_ORDER, [BAND_LOW_HZ, BAND_HIGH_HZ], btype="bandpass", fs=fs, output="sos")
    if x.size == 0:
        return x.copy()
    # sosfiltfilt needs the signal to be longer than its default pad length.
    default_pad = 3 * (2 * len(sos) + 1 - min((sos[:, 2] == 0).sum(), (sos[:, 5] == 0).sum()))
    padlen = min(default_pad, x.size - 1)
    return signal.sosfiltfilt(sos, x, padlen=padlen)


def pan_tompkins_stages(x, fs) -> dict[str, np.ndarray]:
    """Return the intermediate Pan-Tompkins signals, each the same length as ``x``.

    Keys: ``"bandpassed"`` (5-15 Hz, zero-phase), ``"derivative"`` (centred
    5-point derivative, units per second), ``"squared"``, ``"integrated"``
    (centred 150 ms moving average of the squared signal).
    """
    x = _as_1d_float(x)
    fs = float(fs)
    bp = _bandpass_5_15(x, fs)

    # y[n] = (1/8T) (-x[n-2] - 2 x[n-1] + 2 x[n+1] + x[n+2]), centred (no delay).
    deriv = np.zeros_like(bp)
    if bp.size >= 5:
        deriv[2:-2] = (-bp[:-4] - 2.0 * bp[1:-3] + 2.0 * bp[3:-1] + bp[4:]) * (fs / 8.0)

    squared = deriv * deriv

    win = _ms(fs, INTEGRATION_MS)
    kernel = np.full(win, 1.0 / win)
    integrated = np.convolve(squared, kernel, mode="same") if squared.size else squared.copy()
    if integrated.size != squared.size:  # np.convolve 'same' returns max(M, N) samples
        integrated = integrated[: squared.size]

    return {
        "bandpassed": bp,
        "derivative": deriv,
        "squared": squared,
        "integrated": integrated,
    }


def _rr_mean(rr_hist: list[int], rr_ok: list[int]) -> float | None:
    if len(rr_ok) >= 2:
        return float(np.mean(rr_ok[-8:]))
    if rr_hist:
        return float(np.mean(rr_hist[-8:]))
    return None


def _decide(integrated: np.ndarray, deriv: np.ndarray, fs: float) -> np.ndarray:
    """Adaptive-threshold decision stage on the integrated signal.

    Returns the accepted fiducial marks (indices of integrated-signal peaks).
    """
    n = integrated.size
    refractory = _ms(fs, REFRACTORY_MS)
    t_wave = _ms(fs, T_WAVE_MS)
    slope_win = _ms(fs, SLOPE_WINDOW_MS)

    # Candidate fiducial marks: local maxima of the integrated waveform. A
    # minimum distance well below the refractory period merges the ripples of
    # a single QRS without hiding a following T wave from the T-wave logic.
    cand, _ = signal.find_peaks(integrated, distance=max(1, refractory // 2))
    if cand.size == 0:
        return np.empty(0, dtype=np.int64)
    heights = integrated[cand]

    abs_deriv = np.abs(deriv)

    def max_slope(i: int) -> float:
        lo = max(0, i - slope_win)
        hi = min(n, i + slope_win + 1)
        return float(abs_deriv[lo:hi].max())

    # Learning phase 1: initialise thresholds from the first seconds.
    learn = min(n, max(_ms(fs, LEARNING_S * 1000.0), 1))

    def learn_from(seg: np.ndarray) -> tuple[float, float]:
        return float(seg.max()) * 0.25, float(seg.mean()) * 0.5

    spki, npki = learn_from(integrated[:learn])
    if spki <= 0.0:  # flat start: fall back to the whole signal
        spki, npki = learn_from(integrated)

    def thresholds() -> tuple[float, float]:
        thr1 = npki + 0.25 * (spki - npki)
        return thr1, 0.5 * thr1

    qrs: list[int] = []
    qrs_slope: list[float] = []
    rr_hist: list[int] = []
    rr_ok: list[int] = []
    skipped: list[int] = []  # candidate indices (into cand) classified as noise since last QRS
    anchor = 0  # last accepted QRS or last threshold re-initialisation (sample index)

    def is_t_wave(i: int) -> bool:
        if not qrs or i - qrs[-1] >= t_wave:
            return False
        return max_slope(i) < 0.5 * qrs_slope[-1]

    def accept(i: int) -> None:
        nonlocal anchor
        if qrs:
            rr = i - qrs[-1]
            rr_hist.append(rr)
            mean_ok = _rr_mean(rr_hist[:-1], rr_ok)
            if mean_ok is None or 0.92 * mean_ok <= rr <= 1.16 * mean_ok:
                rr_ok.append(rr)
        qrs.append(i)
        qrs_slope.append(max_slope(i))
        skipped.clear()
        anchor = max(anchor, i)

    def search_back(i: int) -> None:
        nonlocal spki
        while qrs and skipped:
            rr_mean = _rr_mean(rr_hist, rr_ok)
            if rr_mean is None or i - qrs[-1] <= SEARCHBACK_RATIO * rr_mean:
                return
            _, thr2 = thresholds()
            limit = qrs[-1] + SEARCHBACK_RATIO * rr_mean
            best = None
            for j in skipped:
                cj = int(cand[j])
                if cj - qrs[-1] < refractory or cj > limit + refractory:
                    continue
                if heights[j] > thr2 and not is_t_wave(cj):
                    if best is None or heights[j] > heights[best]:
                        best = j
            if best is None:
                return
            later = [j for j in skipped if j > best]
            accept(int(cand[best]))
            spki = 0.25 * float(heights[best]) + 0.75 * spki
            skipped.extend(later)  # candidates after the recovered beat remain eligible

    for k in range(cand.size):
        i = int(cand[k])
        peak = float(heights[k])

        # Search-back for missed beats before handling the current candidate.
        search_back(i)

        # Recovery (extension of the original algorithm): the thresholds only
        # adapt when beats are accepted, so an artifact during the learning
        # phase or a sudden QRS amplitude drop of ~3x can silence the detector
        # for the rest of the record. If neither a QRS nor search-back has
        # produced anything for max(2 s, 1.66 RR mean), re-run the learning
        # phase on the next 2 s of the integrated signal and retry search-back.
        rr_mean = _rr_mean(rr_hist, rr_ok)
        gap_limit = max(learn, SEARCHBACK_RATIO * rr_mean if rr_mean else 0.0)
        if i - anchor > gap_limit:
            anchor = i
            seg = integrated[i : i + learn]
            # Only re-learn from a window that contains QRS-like energy bursts
            # (max far above the median). Noise-only stretches, e.g. a sinus
            # pause, have max/median of ~3-6, so the thresholds are kept there.
            if seg.max() > RELEARN_CONTRAST * np.median(seg):
                spki, npki = learn_from(seg)
                search_back(i)

        if qrs and i - qrs[-1] < refractory:
            npki = 0.125 * peak + 0.875 * npki
            continue

        thr1, _ = thresholds()
        if peak > thr1 and not is_t_wave(i):
            accept(i)
            spki = 0.125 * peak + 0.875 * spki
        else:
            npki = 0.125 * peak + 0.875 * npki
            skipped.append(k)

    return np.asarray(qrs, dtype=np.int64)


def _refine(x: np.ndarray, marks: np.ndarray, fs: float) -> np.ndarray:
    """Move each fiducial mark to the R apex of the input signal (see module doc)."""
    n = x.size
    half = _ms(fs, REFINE_MS)
    out = np.empty(marks.size, dtype=np.int64)
    for m, i in enumerate(marks):
        lo = max(0, int(i) - half)
        hi = min(n, int(i) + half + 1)
        w = x[lo:hi]
        out[m] = lo + int(np.argmax(np.abs(w - np.median(w))))
    return out


def detect_r_peaks(x, fs) -> np.ndarray:
    """Detect R peaks with the Pan-Tompkins algorithm.

    Parameters
    ----------
    x : array-like, 1-D ECG signal (any units; baseline wander is removed by the
        internal 5-15 Hz band-pass).
    fs : sampling rate in Hz (must exceed 30 Hz).

    Returns
    -------
    np.ndarray of int64 sample indices, sorted ascending and unique, with at
    least the refractory period (200 ms) between neighbours.
    """
    x = _as_1d_float(x)
    fs = float(fs)
    if x.size < 5 or not np.all(np.isfinite(x)) or np.ptp(x) == 0.0:
        return np.empty(0, dtype=np.int64)

    stages = pan_tompkins_stages(x, fs)
    marks = _decide(stages["integrated"], stages["derivative"], fs)
    if marks.size == 0:
        return marks

    peaks = np.unique(_refine(x, marks, fs))
    # Refinement can move two marks close together; enforce the refractory
    # period again, keeping the larger-amplitude peak of each close pair.
    refractory = _ms(fs, REFRACTORY_MS)
    keep: list[int] = []
    for p in peaks:
        if keep and p - keep[-1] < refractory:
            if abs(x[p]) > abs(x[keep[-1]]):
                keep[-1] = int(p)
            continue
        keep.append(int(p))
    return np.asarray(keep, dtype=np.int64)


def match_peaks(detected, reference, fs, tol_ms=150) -> dict:
    """Greedy 1:1 matching of detected vs. reference peaks within ``tol_ms``.

    All (detected, reference) pairs closer than the tolerance are sorted by
    distance and assigned greedily, nearest first; each peak is used at most
    once. Returns ``{"tp","fp","fn","sensitivity","ppv"}`` where
    ``sensitivity = tp / (tp + fn)`` and ``ppv = tp / (tp + fp)``. An undefined
    ratio (empty reference resp. no detections) is reported as ``0.0`` so the
    result stays JSON-serialisable.
    """
    det = np.sort(np.asarray(detected, dtype=np.int64).ravel())
    ref = np.sort(np.asarray(reference, dtype=np.int64).ravel())
    tol = float(tol_ms) * float(fs) / 1000.0

    lo = np.searchsorted(ref, det - tol, side="left")
    hi = np.searchsorted(ref, det + tol, side="right")
    pairs: list[tuple[float, int, int]] = []
    for di in range(det.size):
        for rj in range(lo[di], hi[di]):
            d = abs(float(det[di] - ref[rj]))
            if d <= tol:
                pairs.append((d, di, rj))
    pairs.sort()

    used_d = np.zeros(det.size, dtype=bool)
    used_r = np.zeros(ref.size, dtype=bool)
    tp = 0
    for _, di, rj in pairs:
        if not used_d[di] and not used_r[rj]:
            used_d[di] = True
            used_r[rj] = True
            tp += 1

    fp = int(det.size - tp)
    fn = int(ref.size - tp)
    sens = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    ppv = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    return {"tp": int(tp), "fp": fp, "fn": fn, "sensitivity": float(sens), "ppv": float(ppv)}
