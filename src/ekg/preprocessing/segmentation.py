"""Beat segmentation, RR-interval features and the per-record beat dataset.

Every beat is represented by a fixed window around its R peak
(``PRE_MS`` before, ``POST_MS`` after; 90 + 162 = 252 samples at 360 Hz) plus four
RR-interval features (de Chazal et al., 2004 style)::

    pre_rr    time since the previous beat                [s]
    post_rr   time until the next beat                    [s]
    local_rr  causal mean of the last <= 10 pre_rr values [s] (current beat included)
    rr_ratio  pre_rr / local_rr                           [-]  (prematurity indicator)

Leakage note: RR features are computed strictly *per record*. No window ever spans
two records, so beats of one patient never influence the features of another one.
Beats whose window would leave the signal are dropped, but their R peaks are still
used as neighbours for the RR features of the remaining beats.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ekg.data.loader import CLASSES, Record, aami_class
from ekg.preprocessing.filters import preprocess

__all__ = [
    "PRE_MS",
    "POST_MS",
    "LOCAL_RR_BEATS",
    "MATCH_TOL_MS",
    "window_samples",
    "segment_beats",
    "rr_features",
    "znormalize",
    "BeatSet",
    "build_beat_dataset",
]

PRE_MS = 250
POST_MS = 450
LOCAL_RR_BEATS = 10  # length of the causal local-RR averaging window (beats)
MATCH_TOL_MS = 150  # detected peak <-> reference annotation matching tolerance
_ZNORM_EPS = 1e-6


def window_samples(fs, pre_ms=PRE_MS, post_ms=POST_MS) -> tuple[int, int]:
    """Return (pre, post) window lengths in samples; (90, 162) at 360 Hz."""
    fs = float(fs)
    pre = int(round(pre_ms * fs / 1000.0))
    post = int(round(post_ms * fs / 1000.0))
    if pre < 0 or post <= 0:
        raise ValueError(f"invalid window: pre={pre}, post={post} samples")
    return pre, post


def segment_beats(x, r_peaks, fs, pre_ms=PRE_MS, post_ms=POST_MS) -> tuple[np.ndarray, np.ndarray]:
    """Cut the window ``[r - pre, r + post)`` around every R peak.

    Beats whose window does not fit completely inside ``x`` are dropped.
    No normalisation is applied here (see :func:`build_beat_dataset`).

    Returns ``(beats, kept_idx)``: float32 array of shape (n, pre + post) and the int64
    indices of the kept beats into ``r_peaks``.
    """
    x = np.asarray(x, dtype=np.float32)
    if x.ndim != 1:
        raise ValueError(f"expected a 1-D signal, got shape {x.shape}")
    r = np.asarray(r_peaks, dtype=np.int64).ravel()
    pre, post = window_samples(fs, pre_ms, post_ms)
    length = pre + post

    keep = (r - pre >= 0) & (r + post <= x.size)
    kept_idx = np.flatnonzero(keep).astype(np.int64)
    if kept_idx.size == 0:
        return np.empty((0, length), dtype=np.float32), kept_idx

    # Vectorised gather: row i holds x[r_i - pre : r_i + post].
    starts = r[kept_idx] - pre
    beats = x[starts[:, None] + np.arange(length)[None, :]]
    return beats.astype(np.float32, copy=False), kept_idx


def rr_features(r_peaks, fs) -> np.ndarray:
    """RR-interval features for each R peak of ONE record (seconds).

    Columns: ``pre_rr, post_rr, local_rr, rr_ratio``.

    * first beat: ``pre_rr`` := its ``post_rr``; last beat: ``post_rr`` := its ``pre_rr``
    * ``local_rr[i]`` = mean of ``pre_rr[max(0, i-9) : i+1]`` (causal, current beat included)
    * ``rr_ratio`` = ``pre_rr / local_rr``
    * a single beat carries no RR information: all intervals 0, ratio 1.

    ``r_peaks`` must be sorted and strictly increasing.
    """
    r = np.asarray(r_peaks, dtype=np.int64).ravel()
    n = r.size
    out = np.zeros((n, 4), dtype=np.float32)
    if n == 0:
        return out
    if n == 1:
        out[0, 3] = 1.0
        return out
    d = np.diff(r)
    if np.any(d <= 0):
        raise ValueError("r_peaks must be strictly increasing")

    rr = d.astype(np.float64) / float(fs)
    pre_rr = np.empty(n)
    post_rr = np.empty(n)
    pre_rr[1:] = rr
    pre_rr[0] = rr[0]  # first beat: no predecessor -> use its post_rr
    post_rr[:-1] = rr
    post_rr[-1] = rr[-1]  # last beat: no successor -> use its pre_rr

    # Causal moving average over the last LOCAL_RR_BEATS pre_rr values (incl. current).
    csum = np.concatenate(([0.0], np.cumsum(pre_rr)))
    idx = np.arange(n)
    lo = np.maximum(0, idx - (LOCAL_RR_BEATS - 1))
    local_rr = (csum[idx + 1] - csum[lo]) / (idx + 1 - lo)

    out[:, 0] = pre_rr
    out[:, 1] = post_rr
    out[:, 2] = local_rr
    out[:, 3] = pre_rr / local_rr
    return out


def znormalize(beats: np.ndarray) -> np.ndarray:
    """Per-beat z-normalisation (zero mean, unit std per row); flat rows become 0."""
    b = np.asarray(beats, dtype=np.float64)
    if b.size == 0:
        return b.astype(np.float32)
    mu = b.mean(axis=1, keepdims=True)
    sd = b.std(axis=1, keepdims=True)
    z = np.where(sd > _ZNORM_EPS, (b - mu) / np.maximum(sd, _ZNORM_EPS), 0.0)
    return z.astype(np.float32)


@dataclass
class BeatSet:
    """Segmented beats of one or more records (row-aligned arrays)."""

    beats: np.ndarray  # float32 (n, L), per-beat z-normalised
    rr: np.ndarray  # float32 (n, 4)
    labels: np.ndarray  # int64 (n,), index into CLASSES
    record: np.ndarray  # str (n,), record name per beat
    r_sample: np.ndarray  # int64 (n,)

    def __len__(self) -> int:
        return int(self.labels.shape[0])

    @staticmethod
    def empty(length: int | None = None) -> "BeatSet":
        if length is None:
            pre, post = window_samples(360)
            length = pre + post
        return BeatSet(
            beats=np.empty((0, length), dtype=np.float32),
            rr=np.empty((0, 4), dtype=np.float32),
            labels=np.empty(0, dtype=np.int64),
            record=np.empty(0, dtype=str),
            r_sample=np.empty(0, dtype=np.int64),
        )

    @staticmethod
    def concat(sets: list["BeatSet"]) -> "BeatSet":
        """Stack several BeatSets (e.g. one per record). Empty list -> empty BeatSet."""
        sets = list(sets)
        if not sets:
            return BeatSet.empty()
        lengths = {s.beats.shape[1] for s in sets}
        if len(lengths) != 1:
            raise ValueError(f"cannot concat BeatSets with different window lengths {sorted(lengths)}")
        return BeatSet(
            beats=np.concatenate([s.beats for s in sets]).astype(np.float32, copy=False),
            rr=np.concatenate([s.rr for s in sets]).astype(np.float32, copy=False),
            labels=np.concatenate([s.labels for s in sets]).astype(np.int64, copy=False),
            record=np.concatenate([np.asarray(s.record, dtype=str) for s in sets]),
            r_sample=np.concatenate([s.r_sample for s in sets]).astype(np.int64, copy=False),
        )


def _reference_beats(record: Record) -> tuple[np.ndarray, np.ndarray]:
    """Beat annotations of a record: (sample positions, AAMI label ids), sorted by sample."""
    samples, labels = [], []
    for s, sym in zip(record.ann_samples, record.ann_symbols):
        cls = aami_class(sym)
        if cls is not None:
            samples.append(int(s))
            labels.append(CLASSES.index(cls))
    samples = np.asarray(samples, dtype=np.int64)
    labels = np.asarray(labels, dtype=np.int64)
    order = np.argsort(samples, kind="stable")
    samples, labels = samples[order], labels[order]
    # Guard against duplicated annotation positions (would break RR features).
    if samples.size > 1:
        uniq = np.concatenate(([True], np.diff(samples) > 0))
        samples, labels = samples[uniq], labels[uniq]
    return samples, labels


def _match_to_reference(detected: np.ndarray, ref: np.ndarray, fs: float,
                        tol_ms: float = MATCH_TOL_MS) -> np.ndarray:
    """For each detected peak, the index of its reference beat (or -1).

    Each detection is assigned to the nearest reference beat within ``tol_ms``; if several
    detections claim the same reference beat only the closest one keeps it (one-to-one).
    """
    det = np.asarray(detected, dtype=np.int64)
    match = np.full(det.size, -1, dtype=np.int64)
    if det.size == 0 or ref.size == 0:
        return match
    tol = tol_ms * fs / 1000.0
    pos = np.searchsorted(ref, det)
    left = np.clip(pos - 1, 0, ref.size - 1)
    right = np.clip(pos, 0, ref.size - 1)
    dl = np.abs(det - ref[left])
    dr = np.abs(det - ref[right])
    nearest = np.where(dr < dl, right, left)
    dist = np.minimum(dl, dr)
    ok = dist <= tol

    best: dict[int, int] = {}
    for i in np.flatnonzero(ok):
        j = int(nearest[i])
        if j not in best or dist[i] < dist[best[j]]:
            best[j] = int(i)
    for j, i in best.items():
        match[i] = j
    return match


def build_beat_dataset(record: Record, fs=None, use_reference_peaks=True) -> BeatSet:
    """Turn one record into a BeatSet.

    preprocess -> R peaks -> RR features (on all peaks of this record) -> segment
    -> per-beat z-normalisation -> AAMI labels.

    * ``use_reference_peaks=True``: R peaks = positions of the beat annotations
      (symbols with an AAMI class); non-beat annotations are ignored.
    * ``use_reference_peaks=False``: R peaks from Pan-Tompkins (:func:`detect_r_peaks`).
      Each detection gets the label of the nearest beat annotation within 150 ms;
      unmatched detections are dropped *after* the RR features were computed on the
      full detected sequence (that is what a deployed detector would see).
    """
    fs = float(record.fs if fs is None else fs)
    x = preprocess(record.signal, fs)
    ref_samples, ref_labels = _reference_beats(record)

    if use_reference_peaks:
        peaks, labels = ref_samples, ref_labels
        rr = rr_features(peaks, fs)
        valid = np.ones(peaks.size, dtype=bool)
    else:
        from ekg.preprocessing.rpeaks import detect_r_peaks

        peaks = np.unique(np.asarray(detect_r_peaks(x, fs), dtype=np.int64))
        rr = rr_features(peaks, fs)
        match = _match_to_reference(peaks, ref_samples, fs)
        valid = match >= 0
        labels = np.where(valid, ref_labels[np.maximum(match, 0)] if ref_labels.size else -1, -1)

    beats, kept = segment_beats(x, peaks, fs)
    sel = valid[kept]
    beats, kept = beats[sel], kept[sel]
    if kept.size == 0:
        return BeatSet.empty(beats.shape[1])

    return BeatSet(
        beats=znormalize(beats),
        rr=rr[kept].astype(np.float32, copy=False),
        labels=np.asarray(labels, dtype=np.int64)[kept],
        record=np.full(kept.size, record.name, dtype=f"<U{max(len(record.name), 1)}"),
        r_sample=peaks[kept].astype(np.int64, copy=False),
    )
