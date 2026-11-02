"""Patient-relative beat features (normalised against the beat's own record).

Absolute RR intervals and beat shapes differ a lot between people, which hurts
inter-patient generalisation. These features relate every beat to its record:

* ``pre_rr_norm``, ``post_rr_norm``, ``local_rr_norm``: RR intervals divided by the
  record's mean RR interval (a premature beat has ``pre_rr_norm`` < 1)
* ``corr_template``, ``corr_template_qrs``: Pearson correlation with the record's
  median beat over the whole window and over the QRS region (R +- 50 ms)
* ``rms_template``: RMS difference to the record's median beat

Record-level statistics use all beats of the record (offline Holter analysis); no
labels are used.
"""

from __future__ import annotations

import numpy as np

from ekg.preprocessing.segmentation import PRE_MS

__all__ = ["FEATURE_NAMES", "QRS_HALF_MS", "patient_relative_features"]

FEATURE_NAMES: list[str] = [
    "pre_rr_norm", "post_rr_norm", "local_rr_norm", "corr_template", "corr_template_qrs", "rms_template",
]
QRS_HALF_MS = 50


def _corr_rows(x: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Pearson correlation of every row of ``x`` with the vector ``t`` (0 for flat inputs)."""
    xc = x - x.mean(axis=1, keepdims=True)
    tc = t - t.mean()
    den = np.linalg.norm(xc, axis=1) * np.linalg.norm(tc)
    return np.where(den > 0, xc @ tc / np.where(den > 0, den, 1.0), 0.0)


def patient_relative_features(beats, rr, records, fs: float = 360, pre_ms: float = PRE_MS) -> np.ndarray:
    """float32 (n, 6) in the order of :data:`FEATURE_NAMES`.

    ``beats`` (n, L) and ``rr`` (n, 4) as in a ``BeatSet``; ``records`` (n,) names the
    record of each beat (statistics are computed per record).
    """
    beats = np.asarray(beats, dtype=np.float64)
    rr = np.asarray(rr, dtype=np.float64)
    records = np.asarray(records)
    out = np.zeros((beats.shape[0], len(FEATURE_NAMES)), dtype=np.float64)
    r = int(round(pre_ms * fs / 1000))
    h = int(round(QRS_HALF_MS * fs / 1000))
    qrs = slice(max(r - h, 0), r + h + 1)
    for name in np.unique(records):
        m = records == name
        mean_rr = rr[m, 0].mean()
        out[m, 0:3] = rr[m, 0:3] / mean_rr if mean_rr > 0 else 1.0
        template = np.median(beats[m], axis=0)
        out[m, 3] = _corr_rows(beats[m], template)
        out[m, 4] = _corr_rows(beats[m][:, qrs], template[qrs])
        out[m, 5] = np.sqrt(np.mean((beats[m] - template) ** 2, axis=1))
    return out.astype(np.float32)
