"""End-to-end pipeline CLI for the ECG arrhythmia project.

Usage (run from the repository root)::

    python -m ekg.pipeline demo    --record data/sample/100 --out web/public/data
    python -m ekg.pipeline prepare --data-dir data/mitdb --cache artifacts/beats
    python -m ekg.pipeline train   --data-dir data/mitdb --out artifacts --export web/public/data [--epochs N]
    python -m ekg.pipeline cv      --data-dir data/mitdb --features patient
    python -m ekg.pipeline smoke
    python -m ekg.pipeline export-state --out web/public/data

Commands
--------
``demo``
    Web exports computed from the REAL MIT-BIH record 100 (signal window,
    Pan-Tompkins stages, R-peak detection quality on the whole record, real
    segmented beats), plus things that are pure computation (filter response,
    model architecture of a freshly initialised network). ``metrics.json`` and
    ``dataset_stats.json`` are written with ``status: "pending"`` because the
    full database is not available; no ``tree.json`` is written.
``prepare``
    Builds per-record :class:`BeatSet` caches (``.npz``) for the de Chazal DS1/DS2
    split. Aborts (exit code 2) if any DS1/DS2 record is missing.
``train``
    Trains the 1D-CNN on DS1 (validation = record-wise hold-out *inside* DS1),
    the decision tree on all DS1 beats, evaluates both on DS2 and exports
    ``metrics.json`` (``status: "complete"``), ``tree.json``,
    ``dataset_stats.json`` (to ``<out>/web/``, which the API serves as fallback
    for ``artifacts/web``, and to ``--export``) and ``<out>/model.pt``.
    Requires the complete DS1 + DS2.
``cv``
    Record-grouped k-fold cross-validation of the CNN on DS1 ONLY (DS2 is never
    loaded), repeated over several seeds. Used to compare feature sets without
    touching the test split. Writes ``<out>/cv_<features>.json``.
``smoke``
    Mechanics check of prepare/train/evaluate/export on record 100 only, with
    one epoch. Writes ONLY to ``artifacts/smoke/`` (never to ``web/``) and every
    file is marked as a smoke test: the numbers are not model results.
``export-state``
    Copies the central ``project_state.json`` into the web data directory.

Exit codes: 0 = ok, 1 = usage / unexpected error, 2 = data unavailable.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from ekg.data.loader import (
    CLASSES,
    DS1,
    DS2,
    DataUnavailableError,
    Record,
    aami_class,
    available_records,
    load_record,
)
from ekg.preprocessing.filters import frequency_response, preprocess
from ekg.preprocessing.patient_features import patient_relative_features
from ekg.preprocessing.rpeaks import detect_r_peaks, match_peaks, pan_tompkins_stages
from ekg.preprocessing.segmentation import (
    POST_MS,
    PRE_MS,
    BeatSet,
    build_beat_dataset,
    segment_beats,
    window_samples,
    znormalize,
)

__all__ = [
    "DataIncompleteError",
    "PENDING_REASON",
    "build_signal_demo",
    "build_rhythm_demo",
    "build_segmentation_demo",
    "build_architecture",
    "build_filter_response",
    "pending_metrics",
    "pending_dataset_stats",
    "choose_demo_window",
    "check_splits",
    "load_or_build_beats",
    "prepare_splits",
    "select_validation_records",
    "FEATURE_SETS",
    "with_features",
    "cv_folds",
    "fit_and_evaluate",
    "run_demo",
    "run_prepare",
    "run_train",
    "run_cv",
    "run_smoke",
    "export_state",
    "main",
]

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_VERSION = 1
CACHE_VERSION = 1
DECIMALS = 4
DETECTION_TOL_MS = 150
DEMO_WINDOW_S = 10.0
RHYTHM_WINDOW_S = 60.0
EXAMPLES_PER_CLASS = 12
DEFAULT_VAL_RECORDS = 4

DATASET_NAME = "MIT-BIH Arrhythmia Database"
SPLIT_NAME = "DS1 → DS2 (de Chazal et al. 2004, inter-patient)"

PENDING_REASON = (
    "Die vollständige MIT-BIH Arrhythmia Database (48 Records, davon 44 in DS1/DS2) ist nicht "
    "verfügbar: physionet.org ist in dieser Container-Umgebung durch die Netzwerk-Policy gesperrt. "
    "Ohne DS1 (Training) und DS2 (Test) werden keine Modell-Kennzahlen berechnet. "
    "Nachholen: physionet.org freischalten (oder lokal ausführen), dann `make data` "
    "(python scripts/download_mitdb.py --data-dir data/mitdb) und `make train` "
    "(python -m ekg.pipeline train --data-dir data/mitdb --out artifacts --export web/public/data)."
)
HOW_TO = [
    "make data   # python scripts/download_mitdb.py --data-dir data/mitdb",
    "make train  # python -m ekg.pipeline train --data-dir data/mitdb --out artifacts --export web/public/data",
]
SMOKE_WARNING = (
    "SMOKE-TEST: nur Record 100, zeitliche Aufteilung innerhalb EINES Records, 1 Epoche. "
    "Prüft ausschließlich die Mechanik von prepare/train/evaluate/export. Die Zahlen sind "
    "KEINE Modell-Ergebnisse und dürfen weder berichtet noch in der UI angezeigt werden."
)


class DataIncompleteError(DataUnavailableError):
    """DS1/DS2 records are missing from the data directory."""


# --------------------------------------------------------------------------- helpers

def _log(msg: str) -> None:
    print(f"[ekg.pipeline] {msg}", file=sys.stderr, flush=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _round(a, decimals: int = DECIMALS) -> list[float]:
    arr = np.round(np.asarray(a, dtype=np.float64), decimals)
    if not np.all(np.isfinite(arr)):
        raise ValueError("non-finite values cannot be exported to JSON")
    return [float(v) for v in arr]


def library_versions() -> dict[str, str]:
    """Installed versions of the numerical libraries (results are only reproducible on these)."""
    from importlib import metadata

    out = {"python": sys.version.split()[0]}
    for dist in ("numpy", "scipy", "torch", "scikit-learn", "wfdb"):
        try:
            out[dist] = metadata.version(dist)
        except metadata.PackageNotFoundError:
            out[dist] = "n/a"
    return out


def _write_json(path: Path, obj: Any, *, compact: bool = False) -> Path:
    """Atomic, strict (no NaN) JSON write."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(
        obj,
        ensure_ascii=False,
        allow_nan=False,
        indent=None if compact else 2,
        separators=(",", ":") if compact else None,
    )
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
        f.write("\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)
    return path


def _read_json(path: Path) -> Any | None:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _is_inside(path: Path, parent: Path) -> bool:
    try:
        Path(path).resolve().relative_to(Path(parent).resolve())
        return True
    except ValueError:
        return False


def _reference_beats(record: Record) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """Beat annotations (AAMI class != None): samples, label ids, symbols (sorted, unique)."""
    rows = [(int(s), CLASSES.index(c), sym)
            for s, sym in zip(record.ann_samples, record.ann_symbols)
            if (c := aami_class(sym)) is not None]
    rows.sort(key=lambda r: r[0])
    out: list[tuple[int, int, str]] = []
    for r in rows:
        if out and out[-1][0] == r[0]:
            continue
        out.append(r)
    samples = np.asarray([r[0] for r in out], dtype=np.int64)
    labels = np.asarray([r[1] for r in out], dtype=np.int64)
    return samples, labels, [r[2] for r in out]


def _class_counts(labels: np.ndarray) -> dict[str, int]:
    labels = np.asarray(labels, dtype=np.int64)
    return {c: int(np.sum(labels == i)) for i, c in enumerate(CLASSES)}


def _split_record_path(path: str | Path) -> tuple[str, Path]:
    """``data/sample/100`` or ``data/sample/100.hea`` -> ``('100', Path('data/sample'))``."""
    p = Path(path)
    name = p.name
    for ext in (".hea", ".dat", ".atr"):
        if name.endswith(ext):
            name = name[: -len(ext)]
    return name, p.parent


def _record_from_path(path: str | Path) -> Record:
    """``data/sample/100`` -> load_record('100', 'data/sample')."""
    name, data_dir = _split_record_path(path)
    return load_record(name, data_dir)


# --------------------------------------------------------------------------- demo exports

def choose_demo_window(record: Record, window_s: float = DEMO_WINDOW_S, edge_s: float = 0.4) -> tuple[int, str]:
    """Pick the start sample of a ``window_s`` window showing the rarest beat classes.

    Every non-N beat contributes ``1 / count(class in record)`` to a window's
    score, so a window with the record's single V beat beats a window with two
    of 33 S beats. Candidate windows are centred on each non-N beat; beats within
    ``edge_s`` of the window border do not count. Ties -> earliest window.
    Returns ``(start_sample, reason)``.
    """
    fs = record.fs
    n = int(record.signal.size)
    win = int(round(window_s * fs))
    if n <= win:
        return 0, "Record kürzer als das Fenster – Anfang des Records."
    samples, labels, _ = _reference_beats(record)
    counts = np.bincount(labels, minlength=len(CLASSES))
    special = np.flatnonzero(labels != CLASSES.index("N"))
    if special.size == 0:
        return 0, "Keine Nicht-N-Schläge im Record – Anfang des Records."
    weights = np.zeros(samples.size)
    weights[special] = 1.0 / counts[labels[special]]
    edge = int(round(edge_s * fs))
    best_start, best_score = 0, -1.0
    for i in special:
        start = int(np.clip(samples[i] - win // 2, 0, n - win))
        inside = (samples >= start + edge) & (samples < start + win - edge)
        score = float(weights[inside].sum())
        if score > best_score + 1e-12:
            best_start, best_score = start, score
    inside = (samples >= best_start) & (samples < best_start + win)
    present = [f"{int(np.sum(labels[inside] == k))}× {c}" for k, c in enumerate(CLASSES)
               if c != "N" and np.any(labels[inside] == k)]
    reason = ("Automatisch gewählt: das Fenster mit den seltensten Schlagklassen des Records "
              f"({', '.join(present)} neben Normalschlägen).")
    return best_start, reason


def build_signal_demo(record: Record, window_s: float = DEMO_WINDOW_S, start_s: float | None = None,
                      tol_ms: float = DETECTION_TOL_MS) -> dict:
    """signal_demo.json: raw/filtered window, Pan-Tompkins stages, R peaks, annotations.

    R peaks are detected on the WHOLE preprocessed record (same input as
    ``build_beat_dataset``); ``detection`` compares them with all beat
    annotations of the record (``scope: "record"``), ``detection_window`` only
    within the exported window.
    """
    fs = int(record.fs)
    n = int(record.signal.size)
    win = min(int(round(window_s * fs)), n)
    if start_s is None:
        start, reason = choose_demo_window(record, window_s)
    else:
        start = int(np.clip(round(float(start_s) * fs), 0, n - win))
        reason = "Manuell gewähltes Fenster (--start-s)."
    end = start + win

    x = preprocess(record.signal, fs)
    peaks = detect_r_peaks(x, fs)
    ref, _, _ = _reference_beats(record)
    det = match_peaks(peaks, ref, fs, tol_ms=tol_ms)
    stages = pan_tompkins_stages(x, fs)  # whole record -> no filter edge effects in the window

    w_peaks = peaks[(peaks >= start) & (peaks < end)]
    w_ref = ref[(ref >= start) & (ref < end)]
    det_w = match_peaks(w_peaks, w_ref, fs, tol_ms=tol_ms)

    annotations = []
    for s, sym in zip(record.ann_samples, record.ann_symbols):
        if start <= int(s) < end:
            annotations.append({"sample": int(s) - start, "symbol": str(sym), "aami": aami_class(sym)})

    def _det(d: dict, scope: str, n_ref: int, n_det: int) -> dict:
        return {
            "tp": int(d["tp"]), "fp": int(d["fp"]), "fn": int(d["fn"]),
            "sensitivity": float(d["sensitivity"]), "ppv": float(d["ppv"]),
            "tol_ms": float(tol_ms), "scope": scope,
            "n_reference": int(n_ref), "n_detected": int(n_det),
        }

    return {
        "schema_version": SCHEMA_VERSION,
        "record": record.name,
        "lead": getattr(record, "lead", "MLII"),
        "fs": fs,
        "unit": "mV",
        "source": f"{DATASET_NAME}, Record {record.name} (echte Daten, PhysioNet; Ableitung "
                  f"{getattr(record, 'lead', 'MLII')})",
        "start_s": round(start / fs, 4),
        "start_sample": int(start),
        "duration_s": round(win / fs, 4),
        "window_reason": reason,
        "preprocessing": "Baseline (Median 200 ms + 600 ms) → Butterworth-Bandpass 0,5–40 Hz, "
                         "Ordnung 4, nullphasig (sosfiltfilt)",
        "raw": _round(record.signal[start:end]),
        "filtered": _round(x[start:end]),
        "r_peaks": [int(p - start) for p in w_peaks],
        "annotations": annotations,
        "stages": {k: _round(v[start:end]) for k, v in stages.items()},
        "detection": _det(det, "record", ref.size, peaks.size),
        "detection_window": _det(det_w, "window", w_ref.size, w_peaks.size),
        "detection_note": "Pan-Tompkins auf dem gesamten vorverarbeiteten Record gegen die "
                          "Experten-Annotationen (nur Herzschlag-Symbole), Toleranz ±"
                          f"{int(tol_ms)} ms. Ein einzelner Record ist kein Datenbank-Benchmark.",
    }


def build_rhythm_demo(record: Record, window_s: float = RHYTHM_WINDOW_S, lead_s: float = 3.0,
                      decimate: int = 2) -> dict:
    """rhythm_demo.json: a longer filtered stretch plus expert beat labels for the animated player.

    Candidate windows start ``lead_s`` before each non-N beat; the one collecting the
    rarest classes wins (same ``1 / count`` weights as :func:`choose_demo_window`), so
    it opens with normal beats and then shows the abnormal ones. The signal is already
    band-limited to 40 Hz, so keeping every ``decimate``-th sample (180 Hz) is alias-free
    and only shrinks the file.
    """
    fs = int(record.fs)
    n = int(record.signal.size)
    win = min(int(round(window_s * fs)), n)
    samples, labels, symbols = _reference_beats(record)
    counts = np.bincount(labels, minlength=len(CLASSES))
    special = np.flatnonzero(labels != CLASSES.index("N"))
    weights = np.zeros(samples.size)
    weights[special] = 1.0 / counts[labels[special]]
    edge = int(round(0.4 * fs))
    start, best = 0, -1.0
    for i in special:
        s = int(np.clip(samples[i] - round(lead_s * fs), 0, n - win))
        score = float(weights[(samples >= s) & (samples < s + win - edge)].sum())
        if score > best + 1e-12:
            start, best = s, score
    end = start + win

    x = preprocess(record.signal, fs)
    inside = (samples >= start) & (samples < end)
    beats = [{"t": round((int(s) - start) / fs, 3), "symbol": sym, "aami": CLASSES[int(lab)]}
             for s, lab, sym, keep in zip(samples, labels, symbols, inside) if keep]
    return {
        "schema_version": SCHEMA_VERSION,
        "record": record.name,
        "lead": getattr(record, "lead", "MLII"),
        "fs": fs // decimate,
        "source_fs": fs,
        "unit": "mV",
        "start_s": round(start / fs, 3),
        "duration_s": round(win / fs, 3),
        "filtered": _round(x[start:end:decimate], 3),
        "beats": beats,
        "note": "Gefiltertes Signal (MLII) mit den Schlag-Annotationen der Kardiologen "
                "(AAMI-Klasse), kein Modell-Output. Für die Anzeige auf "
                f"{fs // decimate} Hz ausgedünnt.",
    }


def build_segmentation_demo(record: Record, per_class: int = EXAMPLES_PER_CLASS) -> dict:
    """segmentation_demo.json: up to ``per_class`` real beats per AAMI class present.

    Beats are cut from the preprocessed signal (mV, not z-normalised) at the
    reference annotations; examples are spread evenly over the record.
    """
    fs = int(record.fs)
    x = preprocess(record.signal, fs)
    samples, labels, symbols = _reference_beats(record)
    beats, kept = segment_beats(x, samples, fs, PRE_MS, POST_MS)
    labels_k, samples_k = labels[kept], samples[kept]
    symbols_k = [symbols[i] for i in kept]
    pre, post = window_samples(fs, PRE_MS, POST_MS)
    examples = []
    for k, cls in enumerate(CLASSES):
        idx = np.flatnonzero(labels_k == k)
        if idx.size == 0:
            continue
        take = np.unique(np.round(np.linspace(0, idx.size - 1, min(per_class, idx.size))).astype(int))
        for j in idx[take]:
            examples.append({
                "aami": cls,
                "symbol": symbols_k[j],
                "sample": int(samples_k[j]),
                "time_s": round(float(samples_k[j]) / fs, 3),
                "beat": _round(beats[j]),
            })
    return {
        "schema_version": SCHEMA_VERSION,
        "record": record.name,
        "fs": fs,
        "pre_ms": PRE_MS,
        "post_ms": POST_MS,
        "length": int(pre + post),
        "r_index": int(pre),
        "unit": "mV",
        "counts": _class_counts(labels_k),
        "examples": examples,
        "note": f"Echte Herzschläge aus Record {record.name} (vorverarbeitet, in mV). Das Modell "
                "erhält dieselben Fenster zusätzlich pro Schlag z-normalisiert.",
    }


def build_architecture(seed: int = 0) -> dict:
    """architecture.json from a freshly initialised ECGNet1D (architecture, not a result)."""
    import torch

    from ekg.models.cnn1d import ECGNet1D, count_parameters, describe_architecture

    torch.manual_seed(seed)
    model = ECGNet1D()
    return {
        "schema_version": SCHEMA_VERSION,
        "model": "ECGNet1D",
        "layers": describe_architecture(model),
        "total_params": int(count_parameters(model)),
        "input": {"beat_len": int(model.in_len), "n_rr": int(model.n_rr)},
        "note": "Architektur eines frisch initialisierten Modells – kein Trainingsergebnis.",
    }


def build_filter_response(fs: int = 360) -> dict:
    resp = frequency_response(fs, n=512, log_spaced=True, f_min=0.05)
    for key in ("freqs", "gain_db", "gain_db_zero_phase"):
        resp[key] = _round(resp[key])
    resp["schema_version"] = SCHEMA_VERSION
    return resp


def check_splits(data_dir: str | Path, ds1: Sequence[str] = DS1, ds2: Sequence[str] = DS2) -> tuple[list[str], dict[str, list[str]]]:
    """(available DS1/DS2 records, {"DS1": missing, "DS2": missing})."""
    avail = set(available_records(data_dir))
    required = list(ds1) + list(ds2)
    present = [r for r in required if r in avail]
    missing = {"DS1": [r for r in ds1 if r not in avail], "DS2": [r for r in ds2 if r not in avail]}
    return present, missing


def pending_metrics() -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "status": "pending",
        "reason": PENDING_REASON,
        "how_to": HOW_TO,
        "dataset": DATASET_NAME,
        "split": SPLIT_NAME,
        "cnn": None,
        "tree": None,
        "generated_at": _now(),
    }


def pending_dataset_stats(data_dir: str | Path, sample: Record | None = None) -> dict:
    present, missing = check_splits(data_dir)
    out = {
        "schema_version": SCHEMA_VERSION,
        "status": "pending",
        "reason": PENDING_REASON,
        "data_dir": str(data_dir),
        "records_available": len(present),
        "records_required": len(DS1) + len(DS2),
        "missing": missing,
        "generated_at": _now(),
    }
    if sample is not None:
        _, labels, _ = _reference_beats(sample)
        out["sample_record"] = {
            "record": sample.name,
            "split": "DS2" if sample.name in DS2 else ("DS1" if sample.name in DS1 else None),
            "annotation_counts": _class_counts(labels),
            "note": "Nur der Demo-Record (Annotationszählung) – keine Datensatz-Statistik.",
        }
    return out


def run_demo(record_path: str | Path, out_dir: str | Path, *, data_dir: str | Path = "data/mitdb",
             state_path: str | Path | None = None, window_s: float = DEMO_WINDOW_S,
             start_s: float | None = None, force: bool = False) -> dict[str, Path]:
    """Write all demo exports to ``out_dir``. Returns {file name: path}."""
    out_dir = Path(out_dir)
    record = _record_from_path(record_path)
    written: dict[str, Path] = {}

    t0 = time.perf_counter()
    sig = build_signal_demo(record, window_s=window_s, start_s=start_s)
    written["signal_demo.json"] = _write_json(out_dir / "signal_demo.json", sig, compact=True)
    d = sig["detection"]
    _log(f"signal_demo.json: Fenster {sig['start_s']:.1f}–{sig['start_s'] + sig['duration_s']:.1f} s; "
         f"R-Zacken Record {record.name}: TP={d['tp']} FP={d['fp']} FN={d['fn']} "
         f"Sens={d['sensitivity']:.4f} PPV={d['ppv']:.4f}")

    rhythm = build_rhythm_demo(record)
    written["rhythm_demo.json"] = _write_json(out_dir / "rhythm_demo.json", rhythm, compact=True)
    _log(f"rhythm_demo.json: {rhythm['start_s']:.1f}–{rhythm['start_s'] + rhythm['duration_s']:.1f} s, "
         f"{len(rhythm['beats'])} Schläge")

    seg = build_segmentation_demo(record)
    written["segmentation_demo.json"] = _write_json(out_dir / "segmentation_demo.json", seg, compact=True)
    written["filter_response.json"] = _write_json(out_dir / "filter_response.json",
                                                  build_filter_response(record.fs), compact=True)
    written["architecture.json"] = _write_json(out_dir / "architecture.json", build_architecture())

    # Never overwrite results of a real full training with placeholders.
    existing_metrics = _read_json(out_dir / "metrics.json")
    if not force and isinstance(existing_metrics, dict) and existing_metrics.get("status") == "complete":
        _log("metrics.json mit status 'complete' existiert bereits – wird nicht überschrieben.")
    else:
        written["metrics.json"] = _write_json(out_dir / "metrics.json", pending_metrics())
    existing_stats = _read_json(out_dir / "dataset_stats.json")
    if not force and isinstance(existing_stats, dict) and existing_stats.get("status") == "complete":
        _log("dataset_stats.json mit status 'complete' existiert bereits – wird nicht überschrieben.")
    else:
        written["dataset_stats.json"] = _write_json(out_dir / "dataset_stats.json",
                                                    pending_dataset_stats(data_dir, record))
    if (out_dir / "tree.json").exists() and not (isinstance(existing_metrics, dict)
                                                  and existing_metrics.get("status") == "complete"):
        _log("WARNUNG: tree.json existiert ohne vollständiges Training (metrics.json nicht 'complete').")

    state = Path(state_path) if state_path else ROOT / "project_state.json"
    if state.exists():
        written["project_state.json"] = export_state(state, out_dir)
    _log(f"Demo-Export nach {out_dir} in {time.perf_counter() - t0:.1f} s: {', '.join(sorted(written))}")
    return written


def export_state(state_path: str | Path, out_dir: str | Path) -> Path:
    data = json.loads(Path(state_path).read_text(encoding="utf-8"))
    return _write_json(Path(out_dir) / "project_state.json", data)


# --------------------------------------------------------------------------- prepare

# Modules whose code determines the cached BeatSet arrays (filtering, R-peak
# detection, segmentation / RR features / z-normalisation, AAMI label mapping).
_CACHE_CODE_MODULES = ("ekg.data.loader", "ekg.preprocessing.filters", "ekg.preprocessing.rpeaks",
                       "ekg.preprocessing.segmentation")
_code_fingerprint_cache: str | None = None


def preprocessing_fingerprint() -> str:
    """SHA-256 (first 16 hex chars) over the source of the modules that build a BeatSet.

    Part of the beat-cache key, so any change to filter, detector or segmentation
    parameters/code invalidates stale ``.npz`` caches automatically.
    """
    global _code_fingerprint_cache
    if _code_fingerprint_cache is None:
        import importlib

        h = hashlib.sha256()
        for mod in _CACHE_CODE_MODULES:
            h.update(mod.encode())
            h.update(Path(importlib.import_module(mod).__file__).read_bytes())
        _code_fingerprint_cache = h.hexdigest()[:16]
    return _code_fingerprint_cache


def _cache_meta(record_dir: Path, name: str, use_reference_peaks: bool) -> dict:
    stamp = {}
    for ext in ("hea", "dat", "atr"):
        st = (record_dir / f"{name}.{ext}").stat()
        stamp[ext] = [int(st.st_size), int(st.st_mtime)]
    return {"version": CACHE_VERSION, "record": name, "use_reference_peaks": bool(use_reference_peaks),
            "pre_ms": PRE_MS, "post_ms": POST_MS, "code": preprocessing_fingerprint(), "files": stamp}


def load_or_build_beats(name: str, data_dir: str | Path, cache_dir: str | Path | None,
                        use_reference_peaks: bool = True) -> tuple[BeatSet, bool]:
    """BeatSet of one record from the npz cache (if valid) or freshly built.

    Returns ``(beatset, from_cache)``.
    """
    data_dir = Path(data_dir)
    meta = _cache_meta(data_dir, name, use_reference_peaks)
    path = None
    if cache_dir is not None:
        tag = "ref" if use_reference_peaks else "det"
        path = Path(cache_dir) / f"{name}_{tag}.npz"
        if path.exists():
            try:
                with np.load(path, allow_pickle=False) as z:
                    if json.loads(str(z["meta"])) == meta:
                        return BeatSet(
                            beats=z["beats"].astype(np.float32, copy=False),
                            rr=z["rr"].astype(np.float32, copy=False),
                            labels=z["labels"].astype(np.int64, copy=False),
                            record=z["record"].astype(str),
                            r_sample=z["r_sample"].astype(np.int64, copy=False),
                        ), True
            except (OSError, ValueError, KeyError):
                pass  # corrupt / outdated cache -> rebuild
    bs = build_beat_dataset(load_record(name, data_dir), use_reference_peaks=use_reference_peaks)
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp.npz")
        np.savez(tmp, beats=bs.beats, rr=bs.rr, labels=bs.labels, record=np.asarray(bs.record, dtype=str),
                 r_sample=bs.r_sample, meta=np.asarray(json.dumps(meta)))
        os.replace(tmp, path)
    return bs, False


def load_or_build_lead2(bs: BeatSet, name: str, data_dir: str | Path, cache_dir: str | Path | None,
                        use_reference_peaks: bool = True) -> tuple[np.ndarray, str]:
    """Second-lead beat windows at the R peaks of ``bs`` (one record), z-normalised.

    The second lead is the first channel that :func:`load_record` does not use (MLII),
    i.e. mostly V1 in MIT-BIH (V2/V4/V5 in a few records). It gets the same
    preprocessing and window as lead 1. Returns ``(beats2, lead_name)``; cached as
    ``<name>_<ref|det>_lead2.npz`` next to the lead-1 cache.
    """
    import wfdb

    data_dir = Path(data_dir)
    meta = {**_cache_meta(data_dir, name, use_reference_peaks), "lead2": 1, "n": len(bs)}
    path = None
    if cache_dir is not None:
        path = Path(cache_dir) / f"{name}_{'ref' if use_reference_peaks else 'det'}_lead2.npz"
        if path.exists():
            try:
                with np.load(path, allow_pickle=False) as z:
                    if json.loads(str(z["meta"])) == meta:
                        return z["beats2"].astype(np.float32, copy=False), str(z["lead"])
            except (OSError, ValueError, KeyError):
                pass
    rec = wfdb.rdrecord(str(data_dir / name))
    used = load_record(name, data_dir).lead
    names = list(rec.sig_name or [])
    ch = next(i for i, n in enumerate(names) if n != used)
    x = preprocess(np.asarray(rec.p_signal[:, ch], dtype=np.float32), float(rec.fs))
    pre, post = window_samples(rec.fs)
    beats2 = znormalize(np.stack([x[r - pre:r + post] for r in bs.r_sample]) if len(bs)
                        else np.empty((0, pre + post), dtype=np.float32)).astype(np.float32)
    if path is not None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp.npz")
        np.savez(tmp, beats2=beats2, lead=np.asarray(names[ch]), meta=np.asarray(json.dumps(meta)))
        os.replace(tmp, path)
    return beats2, names[ch]


def with_lead2(sets: dict[str, BeatSet], data_dir: str | Path, cache_dir: str | Path | None,
               use_reference_peaks: bool = True) -> tuple[dict[str, BeatSet], dict[str, str]]:
    """Attach the second lead (``beats2``) to every per-record BeatSet; also returns the lead names."""
    out, leads = {}, {}
    for name, bs in sets.items():
        b2, leads[name] = load_or_build_lead2(bs, name, data_dir, cache_dir, use_reference_peaks)
        out[name] = dataclasses.replace(bs, beats2=b2)
    return out, leads


def prepare_splits(data_dir: str | Path, cache_dir: str | Path | None = None, *,
                   use_reference_peaks: bool = True, ds1: Sequence[str] = DS1,
                   ds2: Sequence[str] = DS2) -> dict[str, dict[str, BeatSet]]:
    """{"DS1": {record: BeatSet}, "DS2": {...}}. Raises DataIncompleteError if records are missing."""
    _, missing = check_splits(data_dir, ds1, ds2)
    n_missing = len(missing["DS1"]) + len(missing["DS2"])
    if n_missing:
        raise DataIncompleteError(
            f"DS1/DS2 unvollständig in '{data_dir}': {n_missing} von {len(ds1) + len(ds2)} Records fehlen "
            f"(DS1 fehlt: {', '.join(missing['DS1']) or '–'}; DS2 fehlt: {', '.join(missing['DS2']) or '–'}). "
            "Die vollständige MIT-BIH-Datenbank wird benötigt; physionet.org muss erreichbar sein "
            "(Netzwerk-Policy) – dann: make data  bzw.  python scripts/download_mitdb.py --data-dir "
            f"{data_dir}"
        )
    out: dict[str, dict[str, BeatSet]] = {"DS1": {}, "DS2": {}}
    for split, names in (("DS1", ds1), ("DS2", ds2)):
        for name in names:
            bs, cached = load_or_build_beats(name, data_dir, cache_dir, use_reference_peaks)
            out[split][name] = bs
            _log(f"{split} {name}: {len(bs)} Beats{' (Cache)' if cached else ''}")
    return out


def _split_counts(sets: dict[str, BeatSet]) -> dict[str, int]:
    total = np.zeros(len(CLASSES), dtype=np.int64)
    for bs in sets.values():
        total += np.bincount(bs.labels, minlength=len(CLASSES))[: len(CLASSES)]
    return {c: int(total[i]) for i, c in enumerate(CLASSES)}


def run_prepare(data_dir: str | Path, cache_dir: str | Path, *, use_reference_peaks: bool = True) -> dict:
    splits = prepare_splits(data_dir, cache_dir, use_reference_peaks=use_reference_peaks)
    stats = {s: _split_counts(splits[s]) for s in ("DS1", "DS2")}
    summary = {"generated_at": _now(), "data_dir": str(data_dir), "use_reference_peaks": use_reference_peaks,
               "per_split": stats, "records": {s: sorted(splits[s]) for s in splits}}
    _write_json(Path(cache_dir) / "prepare_summary.json", summary)
    for s, c in stats.items():
        _log(f"{s}: {sum(c.values())} Beats {c}")
    return summary


# --------------------------------------------------------------------------- training

def select_validation_records(labels_by_record: dict[str, np.ndarray], n_val: int = DEFAULT_VAL_RECORDS,
                              seed: int = 0, required: Sequence[str] = ("N", "S", "V"),
                              max_tries: int = 5000, max_class_share: float | None = None) -> list[str]:
    """Record-wise validation hold-out inside the training split.

    Draws (seeded) record subsets of size ``n_val`` until the validation part
    contains every ``required`` class present in the split and the remaining
    training part still contains every class present in the split.
    With ``max_class_share``, records holding at least that share of any class of
    the split (e.g. 208 with ~90 % of all DS1 F beats) are never drawn.
    """
    names = sorted(labels_by_record)
    if not 0 < n_val < len(names):
        raise ValueError(f"n_val must be in [1, {len(names) - 1}], got {n_val}")
    counts = {r: np.bincount(np.asarray(labels_by_record[r], dtype=np.int64), minlength=len(CLASSES))
              for r in names}
    total = sum(counts.values())
    present = {i for i in range(len(CLASSES)) if total[i] > 0}
    need_val = {CLASSES.index(c) for c in required} & present
    pool = names
    if max_class_share is not None:
        pool = [r for r in names if all(counts[r][i] < max_class_share * total[i] for i in present)]
        if len(pool) < n_val:
            raise ValueError(f"only {len(pool)} records below max_class_share={max_class_share}, need {n_val}")
    rng = np.random.default_rng(seed)
    first: list[str] | None = None
    for _ in range(max_tries):
        val = sorted(rng.choice(pool, size=n_val, replace=False).tolist())
        first = first or val
        v = sum(counts[r] for r in val)
        t = total - v
        if all(v[i] > 0 for i in need_val) and all(t[i] > 0 for i in present):
            return val
    _log("WARNUNG: keine Validierungsauswahl erfüllt die Klassen-Bedingungen – nehme erste Ziehung.")
    return first or names[:n_val]


# CNN input variants: "base" = 4 RR features; "rr" adds the 3 RR intervals normalised by the
# record mean; "patient" additionally adds 3 morphology deviations from the record's median beat.
FEATURE_SETS = ("base", "rr", "patient")


def with_features(bs: BeatSet, features: str = "base", fs: int = 360) -> BeatSet:
    """BeatSet whose ``rr`` carries the extra CNN inputs of ``features`` (see FEATURE_SETS)."""
    if features not in FEATURE_SETS:
        raise ValueError(f"unknown feature set {features!r}, expected one of {FEATURE_SETS}")
    if features == "base" or len(bs) == 0:
        return bs
    extra = patient_relative_features(bs.beats, bs.rr, bs.record, fs)
    if features == "rr":
        extra = extra[:, :3]
    return dataclasses.replace(bs, rr=np.concatenate([bs.rr, extra], axis=1))


def cv_folds(labels_by_record: dict[str, np.ndarray], k: int = 5) -> list[list[str]]:
    """Deterministic record-grouped folds that spread the rare classes.

    Records are ranked by their summed share of the S, V and F beats of the split
    and dealt to the folds in snake order (0..k-1, k-1..0, ...).
    """
    names = sorted(labels_by_record)
    if not 1 < k <= len(names):
        raise ValueError(f"k must be in [2, {len(names)}], got {k}")
    counts = {r: np.bincount(np.asarray(labels_by_record[r], dtype=np.int64), minlength=len(CLASSES))
              for r in names}
    total = np.maximum(sum(counts.values()), 1)
    rare = [CLASSES.index(c) for c in ("S", "V", "F")]
    ranked = sorted(names, key=lambda r: (-sum(counts[r][i] / total[i] for i in rare), r))
    folds: list[list[str]] = [[] for _ in range(k)]
    for i, r in enumerate(ranked):
        lap, pos = divmod(i, k)
        folds[pos if lap % 2 == 0 else k - 1 - pos].append(r)
    return [sorted(f) for f in folds]


def _per_record_cms(y_true: np.ndarray, y_pred: np.ndarray, records: np.ndarray) -> dict[str, np.ndarray]:
    from ekg.evaluation.metrics import confusion

    out = {}
    for r in sorted(set(records.tolist())):
        m = records == r
        out[str(r)] = confusion(y_true[m], y_pred[m], n_classes=len(CLASSES))
    return out


def _compact_summary(s: dict) -> dict:
    return {"macro_f1_nsvf": s["macro_f1_nsvf"], "macro_f1": s["macro_f1"],
            "per_class": {c: {m: s["per_class"][c][m] for m in ("sensitivity", "ppv", "f1")} for c in CLASSES}}


def fit_and_evaluate(train: BeatSet, val: BeatSet | None, test: BeatSet, *, tree_train: BeatSet,
                     epochs: int = 20, patience: int | None = 5, lr: float = 1e-3, batch_size: int = 256,
                     seed: int = 0, max_depth: int = 4, fs: int = 360, features: str = "base",
                     members: Sequence[tuple[int, BeatSet, BeatSet | None]] | None = None,
                     weight_power: float = 1.0, augment: bool = False, offsets: dict | None = None,
                     extra_tests: dict[str, BeatSet] | None = None) -> dict:
    """Shared core of ``train`` and ``smoke``: CNN + tree fit, evaluation on ``test``.

    ``features`` selects the CNN inputs (FEATURE_SETS); the tree always uses its own
    interpretable features. ``members`` = ``[(seed, train, val), ...]`` trains a seed
    ensemble (mean softmax); default is the single member ``(seed, train, val)``.
    ``offsets`` (per class, added to the ensemble log-probabilities) must come from DS1
    out-of-fold data. ``extra_tests`` ({name: BeatSet}) are evaluated with the same models.
    """
    from ekg.evaluation.metrics import gross_statistics, summary
    from ekg.models.cnn1d import count_parameters
    from ekg.models.tree_baseline import export_tree, extract_features, train_tree
    from ekg.training.train import predict_logits, train_cnn

    t0 = time.perf_counter()

    def on_epoch(e: dict) -> None:
        vf = e.get("val_macro_f1")
        _log(f"Epoche {e['epoch']}: train_loss={e['train_loss']:.4f}"
             + (f" val_macro_f1={vf:.4f}" if vf is not None else ""))

    members = list(members) if members else [(seed, train, val)]
    b = np.array([float((offsets or {}).get(c, 0.0)) for c in CLASSES])
    models, histories = [], []
    for m_seed, m_train, m_val in members:
        if len(members) > 1:
            _log(f"CNN Seed {m_seed}")
        model, history = train_cnn(with_features(m_train, features, fs),
                                   with_features(m_val, features, fs) if m_val is not None else None,
                                   epochs=epochs, lr=lr, batch_size=batch_size, seed=m_seed,
                                   patience=patience if m_val is not None else None, on_epoch=on_epoch,
                                   weight_power=weight_power, augment=augment)
        models.append(model)
        histories.append(history)

    X_tr, feat_names = extract_features(tree_train.beats, tree_train.rr, fs)
    tree = train_tree(X_tr, tree_train.labels, max_depth=max_depth, random_state=seed)

    def gross(bs: BeatSet, y: np.ndarray) -> dict:
        return gross_statistics(_per_record_cms(bs.labels, y, np.asarray(bs.record)), CLASSES)

    def evaluate(bs: BeatSet) -> tuple[dict, dict]:
        logits = [predict_logits(m, with_features(bs, features, fs)) for m in models]
        if len(models) > 1 or b.any():
            y_cnn = (ensemble_log_probs(logits) + b).argmax(axis=1)
        else:
            y_cnn = logits[0].argmax(axis=1)
        cnn = {"summary": summary(bs.labels, y_cnn, CLASSES), "gross_statistics": gross(bs, y_cnn)}
        if len(models) > 1:
            per_seed = [summary(bs.labels, lg.argmax(axis=1), CLASSES) for lg in logits]
            cnn["per_seed"] = [_compact_summary(ps) for ps in per_seed]
            cnn["per_seed_aggregate"] = {k: {"mean": float(np.mean([ps[k] for ps in per_seed])),
                                             "std": float(np.std([ps[k] for ps in per_seed], ddof=1))}
                                         for k in ("macro_f1_nsvf", "macro_f1")}
        y_tree = tree.predict(extract_features(bs.beats, bs.rr, fs)[0]).astype(np.int64)
        return cnn, {"summary": summary(bs.labels, y_tree, CLASSES), "gross_statistics": gross(bs, y_tree)}

    cnn_res, tree_res = evaluate(test)
    best = [[h["epoch"] for h in hist if h.get("best")] for hist in histories]
    cnn_res.update({
        "history": histories[0],
        "params": int(count_parameters(models[0])),
        "epochs_run": len(histories[0]),
        "best_epoch": best[0][-1] if best[0] else None,
    })
    if len(members) > 1 or b.any():
        cnn_res["ensemble"] = {"seeds": [int(m[0]) for m in members],
                               "best_epochs": [bb[-1] if bb else None for bb in best],
                               "epochs_run": [len(h) for h in histories],
                               "offsets": {c: float(b[i]) for i, c in enumerate(CLASSES)}}
    tree_res.update({
        "max_depth": int(max_depth),
        "depth": int(tree.get_depth()),
        "n_leaves": int(tree.get_n_leaves()),
        "features": feat_names,
        "trained_on_beats": int(len(tree_train)),
    })
    extra = {}
    for name, bs in (extra_tests or {}).items():
        c, t = evaluate(bs)
        extra[name] = {"cnn": c, "tree": t}
    return {
        "model": models[0],
        "models": models,
        "tree": tree,
        "tree_json": export_tree(tree, feat_names, CLASSES),
        "cnn": cnn_res,
        "tree_result": tree_res,
        "extra": extra,
        "seconds": round(time.perf_counter() - t0, 2),
    }


def detection_stats(data_dir: str | Path, names: Sequence[str], tol_ms: float = DETECTION_TOL_MS) -> dict:
    """Pan-Tompkins against the reference beat annotations, pooled over ``names``."""
    tp = fp = fn = 0
    for name in names:
        rec = load_record(name, data_dir)
        ref, _, _ = _reference_beats(rec)
        m = match_peaks(detect_r_peaks(preprocess(rec.signal, rec.fs), rec.fs), ref, rec.fs, tol_ms=tol_ms)
        tp, fp, fn = tp + m["tp"], fp + m["fp"], fn + m["fn"]
    return {"records": len(names), "tol_ms": tol_ms, "tp": tp, "fp": fp, "fn": fn,
            "sensitivity": tp / (tp + fn) if tp + fn else 0.0, "ppv": tp / (tp + fp) if tp + fp else 0.0}


def run_train(data_dir: str | Path, out_dir: str | Path, export_dir: str | Path | None, *,
              cache_dir: str | Path | None = None, epochs: int = 20, patience: int | None = 5,
              lr: float = 1e-3, batch_size: int = 256, seed: int = 0, n_val: int = DEFAULT_VAL_RECORDS,
              val_records: Sequence[str] | None = None, max_depth: int = 4,
              use_reference_peaks: bool = True, ds1: Sequence[str] = DS1,
              ds2: Sequence[str] = DS2, features: str = "base", seeds: Sequence[int] | None = None,
              max_class_share: float | None = None, weight_power: float = 1.0, augment: bool = False,
              leads: int = 1, offsets: dict | None = None, eval_detected: bool = False,
              cv_summary: dict | None = None) -> dict:
    """Full inter-patient training DS1 -> DS2. Raises DataIncompleteError without the data.

    ``seeds`` trains a seed ensemble; each seed draws its own validation records from DS1
    (unless ``val_records`` fixes them). ``eval_detected`` additionally evaluates on the
    beats found by Pan-Tompkins in DS2 (realistic end-to-end) and reports the detector.
    """
    from ekg.training.train import save_model

    out_dir = Path(out_dir)
    cache_dir = Path(cache_dir) if cache_dir else out_dir / "beats"
    splits = prepare_splits(data_dir, cache_dir, use_reference_peaks=use_reference_peaks, ds1=ds1, ds2=ds2)
    ds1_sets, ds2_sets = splits["DS1"], splits["DS2"]
    lead_names: dict[str, str] = {}
    if leads == 2:
        ds1_sets, ln1 = with_lead2(ds1_sets, data_dir, cache_dir, use_reference_peaks)
        ds2_sets, ln2 = with_lead2(ds2_sets, data_dir, cache_dir, use_reference_peaks)
        lead_names = {**ln1, **ln2}

    seeds = [int(x) for x in seeds] if seeds else [int(seed)]
    labels = {r: bs.labels for r, bs in ds1_sets.items()}
    if val_records:
        fixed = sorted(str(v) for v in val_records)
        bad = [v for v in fixed if v not in ds1_sets]
        if bad:
            raise ValueError(f"Validierungs-Records müssen aus DS1 stammen: {bad}")
        val_by_seed = {s_: fixed for s_ in seeds}
    else:
        val_by_seed = {s_: select_validation_records(labels, n_val, s_, max_class_share=max_class_share)
                       for s_ in seeds}
    for v in val_by_seed.values():
        assert not set(v) & set(ds2_sets), "validation must never use DS2"

    def split_for(s_: int) -> tuple[int, BeatSet, BeatSet]:
        v = val_by_seed[s_]
        return (s_, BeatSet.concat([ds1_sets[r] for r in sorted(ds1_sets) if r not in v]),
                BeatSet.concat([ds1_sets[r] for r in v]))

    members = [split_for(s_) for s_ in seeds]
    val_names = val_by_seed[seeds[0]]
    train_names = [r for r in sorted(ds1_sets) if r not in val_names]
    train, val = members[0][1], members[0][2]
    test = BeatSet.concat([ds2_sets[r] for r in sorted(ds2_sets)])
    full_ds1 = BeatSet.concat([ds1_sets[r] for r in sorted(ds1_sets)])
    _log(f"Training: {len(train)} Beats ({len(train_names)} Records), Validierung: {len(val)} Beats "
         f"({', '.join(val_names)}), Test DS2: {len(test)} Beats, Seeds: {seeds}")

    extra_tests = {}
    detector = None
    if eval_detected:
        det_sets = prepare_splits(data_dir, cache_dir, use_reference_peaks=False, ds1=(), ds2=ds2)["DS2"]
        if leads == 2:
            det_sets, _ = with_lead2(det_sets, data_dir, cache_dir, use_reference_peaks=False)
        extra_tests["detected_peaks"] = BeatSet.concat([det_sets[r] for r in sorted(det_sets)])
        detector = detection_stats(data_dir, sorted(ds2_sets))
        _log(f"Pan-Tompkins auf DS2: Se={detector['sensitivity']:.4f} PPV={detector['ppv']:.4f}")

    res = fit_and_evaluate(train, val, test, tree_train=full_ds1, epochs=epochs, patience=patience, lr=lr,
                           batch_size=batch_size, seed=seeds[0], max_depth=max_depth, features=features,
                           members=members if len(members) > 1 else None, weight_power=weight_power,
                           augment=augment, offsets=offsets, extra_tests=extra_tests)
    if "ensemble" in res["cnn"]:
        res["cnn"]["ensemble"]["val_records"] = {str(s_): val_by_seed[s_] for s_ in seeds}

    per_split = {"DS1": _split_counts(ds1_sets), "DS2": _split_counts(ds2_sets)}
    metrics = {
        "schema_version": SCHEMA_VERSION,
        "status": "complete",
        "generated_at": _now(),
        "dataset": DATASET_NAME,
        "split": SPLIT_NAME,
        "records": {"train": train_names, "val": val_names, "test": sorted(ds2_sets)},
        "beats": {"train": len(train), "val": len(val), "test": len(test), "tree_train": len(full_ds1)},
        "per_split": per_split,
        "config": {"epochs": epochs, "patience": patience, "lr": lr, "batch_size": batch_size, "seed": seeds[0],
                   "seeds": seeds, "max_depth": max_depth, "use_reference_peaks": use_reference_peaks,
                   "features": features, "weight_power": weight_power, "augment": augment, "leads": leads,
                   "lead2_names": lead_names, "max_class_share": max_class_share,
                   "offsets": {c: float((offsets or {}).get(c, 0.0)) for c in CLASSES},
                   "pre_ms": PRE_MS, "post_ms": POST_MS, "validation": "record-wise hold-out inside DS1",
                   "preprocessing_fingerprint": preprocessing_fingerprint(),
                   "library_versions": library_versions()},
        "cnn": res["cnn"],
        "tree": res["tree_result"],
        "train_seconds": res["seconds"],
    }
    if eval_detected:
        d = res["extra"]["detected_peaks"]
        metrics["detected_peaks"] = {"detector": detector, "beats": len(extra_tests["detected_peaks"]),
                                     "cnn": d["cnn"], "tree": d["tree"]}
    if cv_summary:
        metrics["cv"] = cv_summary
    stats = {
        "schema_version": SCHEMA_VERSION,
        "status": "complete",
        "generated_at": _now(),
        "records_available": len(ds1_sets) + len(ds2_sets),
        "records": {"DS1": sorted(ds1_sets), "DS2": sorted(ds2_sets)},
        "per_split": per_split,
        "beat_source": "Referenz-Annotationen" if use_reference_peaks else "Pan-Tompkins-Detektionen",
    }

    out_dir.mkdir(parents=True, exist_ok=True)
    save_model(res["model"], out_dir / "model.pt")
    if len(res["models"]) > 1:
        for s_, m in zip(seeds, res["models"]):
            save_model(m, out_dir / f"model_seed{s_}.pt")
    _write_json(out_dir / "ensemble.json", {"seeds": seeds, "features": features, "leads": leads,
                                            "offsets": metrics["config"]["offsets"]})
    for target in [out_dir / "web"] + ([Path(export_dir)] if export_dir else []):
        _write_json(target / "metrics.json", metrics)
        _write_json(target / "tree.json", res["tree_json"])
        _write_json(target / "dataset_stats.json", stats)
    s = metrics["cnn"]["summary"]
    _log(f"Fertig: CNN macro-F1 (DS2) = {s['macro_f1']:.4f} (N/S/V/F {s['macro_f1_nsvf']:.4f}), Baum macro-F1 "
         f"(DS2) = {metrics['tree']['summary']['macro_f1']:.4f}; Modell: {out_dir / 'model.pt'}")
    return metrics


def run_cv(data_dir: str | Path, out_dir: str | Path, *, cache_dir: str | Path | None = None,
           features: str = "base", k: int = 5, seeds: Sequence[int] = (0, 1, 2), epochs: int = 20,
           patience: int | None = 5, lr: float = 1e-3, batch_size: int = 256, n_val: int = 3,
           max_class_share: float | None = 0.4, use_reference_peaks: bool = True,
           ds1: Sequence[str] = DS1, lr_schedule: str | None = None, augment: bool = False,
           eval_epochs: Sequence[int] = (), tag: str = "", weight_power: float = 1.0, leads: int = 1) -> dict:
    """Record-grouped k-fold CV of the CNN on DS1 only (DS2 is never loaded).

    Per seed, the out-of-fold predictions of all folds are pooled into one summary;
    the report gives mean and standard deviation of these summaries over the seeds.
    Early stopping inside a fold uses ``n_val`` training records (``max_class_share``
    keeps records that dominate a class in training). ``n_val=0`` trains on all
    remaining records for exactly ``epochs`` epochs (no validation, no early stopping).
    ``eval_epochs`` additionally pools the out-of-fold predictions after each listed
    epoch (``by_epoch`` in the report), to pick a fixed epoch count from one run.
    The out-of-fold logits of every seed are saved next to the report
    (``<name>_oof.npz``) for threshold and ensemble analyses without retraining.
    """
    from ekg.evaluation.metrics import summary
    from ekg.training.train import predict, predict_logits, train_cnn

    with_features(BeatSet.empty(), features)  # validate the name before the expensive part
    sets = prepare_splits(data_dir, cache_dir, use_reference_peaks=use_reference_peaks, ds1=ds1, ds2=())["DS1"]
    lead_names: dict[str, str] = {}
    if leads == 2:
        sets, lead_names = with_lead2(sets, data_dir, cache_dir, use_reference_peaks)
    labels = {r: bs.labels for r, bs in sets.items()}
    folds = cv_folds(labels, k)
    eval_epochs = sorted({int(e) for e in eval_epochs if 1 <= int(e) <= epochs})
    runs = []
    oof: dict[str, np.ndarray] = {}
    for seed in seeds:
        y_true, y_pred, fold_info, logits, rec = [], [], [], [], []
        snap_pred: dict[int, list[np.ndarray]] = {e: [] for e in eval_epochs}
        for i, test_names in enumerate(folds):
            rest = {r: labels[r] for r in sorted(sets) if r not in test_names}
            val_names = select_validation_records(rest, n_val, seed, max_class_share=max_class_share) if n_val else []
            train = BeatSet.concat([sets[r] for r in rest if r not in val_names])
            val = with_features(BeatSet.concat([sets[r] for r in val_names]), features) if val_names else None
            test = with_features(BeatSet.concat([sets[r] for r in test_names]), features)

            def snapshot(epoch: int, model) -> None:
                if epoch in snap_pred:
                    snap_pred[epoch].append(predict(model, test))

            model, history = train_cnn(with_features(train, features), val, epochs=epochs,
                                       lr=lr, batch_size=batch_size, seed=seed, patience=patience,
                                       lr_schedule=lr_schedule, augment=augment, on_epoch_model=snapshot,
                                       weight_power=weight_power)
            lg = predict_logits(model, test)
            pred = lg.argmax(axis=1).astype(np.int64)
            y_true.append(test.labels)
            y_pred.append(pred)
            logits.append(lg)
            rec.append(np.asarray(test.record, dtype=str))
            best = [h["epoch"] for h in history if h.get("best")]
            fold_s = summary(test.labels, pred, CLASSES)
            fold_info.append({"fold": i, "test": test_names, "val": val_names, "best_epoch": best[-1] if best else None,
                              "macro_f1_nsvf": fold_s["macro_f1_nsvf"]})
            _log(f"CV {features} seed={seed} fold={i}: test={','.join(test_names)} val={','.join(val_names)} "
                 f"macro_f1_nsvf={fold_s['macro_f1_nsvf']:.4f}")
        s = summary(np.concatenate(y_true), np.concatenate(y_pred), CLASSES)
        by_epoch = {str(e): summary(np.concatenate(y_true), np.concatenate(p), CLASSES)
                    for e, p in snap_pred.items() if len(p) == len(folds)}
        runs.append({"seed": int(seed), "summary": s, "folds": fold_info, "by_epoch": by_epoch})
        oof[f"logits_seed{int(seed)}"] = np.concatenate(logits)
        oof["y_true"] = np.concatenate(y_true)  # same fold order for every seed
        oof["record"] = np.concatenate(rec)
        _log(f"CV {features} seed={seed}: gepoolt macro_f1_nsvf={s['macro_f1_nsvf']:.4f} macro_f1={s['macro_f1']:.4f}")

    def stat(values: list[float]) -> dict:
        a = np.asarray(values, dtype=np.float64)
        return {"mean": float(a.mean()), "std": float(a.std(ddof=1)) if a.size > 1 else 0.0}

    aggregate = {"macro_f1": stat([r["summary"]["macro_f1"] for r in runs]),
                 "macro_f1_nsvf": stat([r["summary"]["macro_f1_nsvf"] for r in runs]),
                 "per_class": {c: {m: stat([r["summary"]["per_class"][c][m] for r in runs])
                                   for m in ("sensitivity", "ppv", "f1")} for c in CLASSES}}
    by_epoch = {e: {"macro_f1_nsvf": stat([r["by_epoch"][e]["macro_f1_nsvf"] for r in runs]),
                    "n_sensitivity": stat([r["by_epoch"][e]["per_class"]["N"]["sensitivity"] for r in runs])}
                for e in runs[0]["by_epoch"]} if runs else {}
    report = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": _now(),
        "split": "DS1 only (record-grouped k-fold), DS2 untouched",
        "features": features,
        "folds": folds,
        "config": {"k": k, "seeds": [int(s) for s in seeds], "epochs": epochs, "patience": patience, "lr": lr,
                   "batch_size": batch_size, "n_val": n_val, "max_class_share": max_class_share,
                   "use_reference_peaks": use_reference_peaks, "lr_schedule": lr_schedule, "augment": augment,
                   "eval_epochs": eval_epochs, "weight_power": weight_power, "leads": leads,
                   "lead2_names": lead_names,
                   "preprocessing_fingerprint": preprocessing_fingerprint(),
                   "library_versions": library_versions()},
        "aggregate": aggregate,
        "by_epoch": by_epoch,
        "runs": runs,
    }
    name = f"cv_{features}_{tag}" if tag else f"cv_{features}"
    _write_json(Path(out_dir) / f"{name}.json", report)
    np.savez_compressed(Path(out_dir) / f"{name}_oof.npz", **oof)
    m = aggregate["macro_f1_nsvf"]
    _log(f"CV {name} fertig: macro_f1_nsvf = {m['mean']:.4f} ± {m['std']:.4f} über {len(runs)} Seeds")
    for e, v in by_epoch.items():
        _log(f"  Epoche {e}: macro_f1_nsvf = {v['macro_f1_nsvf']['mean']:.4f} ± {v['macro_f1_nsvf']['std']:.4f}, "
             f"N-Se = {v['n_sensitivity']['mean']:.4f}")
    return report


OFFSET_GRID = np.round(np.arange(-3.0, 3.01, 0.25), 2)
TUNED_CLASSES = ("S", "V", "F")  # N is the reference (offset 0); Q is too rare to tune


def log_softmax(logits: np.ndarray) -> np.ndarray:
    z = np.asarray(logits, dtype=np.float64)
    z = z - z.max(axis=1, keepdims=True)
    return z - np.log(np.exp(z).sum(axis=1, keepdims=True))


def ensemble_log_probs(logits_per_model: Sequence[np.ndarray]) -> np.ndarray:
    """log of the mean softmax probability over models (seed ensemble)."""
    p = np.mean([np.exp(log_softmax(lg)) for lg in logits_per_model], axis=0)
    return np.log(np.maximum(p, 1e-12))


def fit_class_offsets(logp: np.ndarray, y: np.ndarray, rounds: int = 2) -> np.ndarray:
    """Additive per-class log-probability offsets that maximise macro-F1 over N/S/V/F.

    Coordinate ascent over ``OFFSET_GRID`` for the classes in ``TUNED_CLASSES``; the
    prediction becomes ``argmax(logp + offsets)``. Fit only on DS1 out-of-fold data.
    """
    from ekg.evaluation.metrics import summary

    def score(b: np.ndarray) -> float:
        return summary(y, (logp + b).argmax(axis=1), CLASSES)["macro_f1_nsvf"]

    b = np.zeros(logp.shape[1])
    best = score(b)
    for _ in range(rounds):
        for c in TUNED_CLASSES:
            i = CLASSES.index(c)
            for v in OFFSET_GRID:
                trial = b.copy()
                trial[i] = v
                s = score(trial)
                if s > best + 1e-12:
                    best, b = s, trial
    return b


def analyze_oof(report_path: str | Path) -> dict:
    """A5/A6 on saved CV out-of-fold logits: seed ensemble and class offsets.

    * ``single``: mean ± std over seeds of the plain argmax predictions (as in the CV report)
    * ``ensemble``: mean softmax over seeds, argmax
    * ``ensemble_offsets_nested``: offsets fitted on the other folds, applied to each fold
      (honest estimate of what calibration adds)
    * ``offsets``: offsets fitted on all out-of-fold data (to use for the final model)
    """
    from ekg.evaluation.metrics import summary

    report_path = Path(report_path)
    rep = _read_json(report_path)
    with np.load(report_path.with_name(report_path.stem + "_oof.npz")) as z:
        y, rec = z["y_true"], z["record"].astype(str)
        logits = [z[k] for k in sorted(z.files) if k.startswith("logits_seed")]
    fold_of = {r: i for i, f in enumerate(rep["folds"]) for r in f}
    fold = np.array([fold_of[r] for r in rec])

    singles = [summary(y, lg.argmax(axis=1), CLASSES)["macro_f1_nsvf"] for lg in logits]
    logp = ensemble_log_probs(logits)
    nested = np.empty_like(y)
    for f in np.unique(fold):
        m = fold == f
        b = fit_class_offsets(logp[~m], y[~m])
        nested[m] = (logp[m] + b).argmax(axis=1)
    offsets = fit_class_offsets(logp, y)
    out = {
        "source": report_path.name,
        "n_seeds": len(logits),
        "single": {"mean": float(np.mean(singles)), "std": float(np.std(singles, ddof=1)) if len(singles) > 1 else 0.0},
        "ensemble": _compact_summary(summary(y, logp.argmax(axis=1), CLASSES)),
        "ensemble_offsets_nested": _compact_summary(summary(y, nested, CLASSES)),
        "offsets": {c: float(offsets[i]) for i, c in enumerate(CLASSES)},
    }
    _write_json(report_path.with_name(report_path.stem + "_analysis.json"), out)
    _log(f"OOF {report_path.stem}: einzeln {out['single']['mean']:.4f} ± {out['single']['std']:.4f}, "
         f"Ensemble {out['ensemble']['macro_f1_nsvf']:.4f}, "
         f"Ensemble + Offsets (verschachtelt) {out['ensemble_offsets_nested']['macro_f1_nsvf']:.4f}, "
         f"Offsets {out['offsets']}")
    return out


def _cv_block(report_path: str | Path) -> dict:
    """Compact CV result of the chosen configuration for metrics.json (plus OOF analysis if present)."""
    p = Path(report_path)
    rep = _read_json(p)
    out = {"source": p.name, "k": rep["config"]["k"], "seeds": rep["config"]["seeds"],
           "macro_f1_nsvf": rep["aggregate"]["macro_f1_nsvf"], "macro_f1": rep["aggregate"]["macro_f1"],
           "per_class": rep["aggregate"]["per_class"]}
    ana = _read_json(p.with_name(p.stem + "_analysis.json"))
    if ana:
        out["ensemble"] = ana["ensemble"]
        out["ensemble_offsets_nested"] = ana["ensemble_offsets_nested"]
    return out


def run_smoke(record_path: str | Path = "data/sample/100", out_dir: str | Path = "artifacts/smoke", *,
              epochs: int = 1, seed: int = 0) -> dict:
    """End-to-end mechanics check on a single record. Writes only to ``out_dir`` (never web/)."""
    import torch

    from ekg.training.train import load_model, predict_logits, save_model

    out_dir = Path(out_dir)
    if _is_inside(out_dir, ROOT / "web"):
        raise ValueError("Smoke-Ausgaben dürfen nie nach web/ geschrieben werden.")
    name, data_dir = _split_record_path(record_path)

    # prepare mechanics: build -> npz cache -> reload from cache must give identical arrays
    cache = out_dir / "beats"
    bs, _ = load_or_build_beats(name, data_dir, cache)
    bs2, from_cache = load_or_build_beats(name, data_dir, cache)
    cache_ok = from_cache and all(np.array_equal(getattr(bs, f), getattr(bs2, f))
                                  for f in ("beats", "rr", "labels", "r_sample", "record"))

    # Temporal split inside ONE record: mechanics only, not a valid evaluation protocol.
    n = len(bs)
    a, b = int(0.6 * n), int(0.8 * n)
    idx = np.arange(n)

    def sub(sel: np.ndarray) -> BeatSet:
        return BeatSet(bs.beats[sel], bs.rr[sel], bs.labels[sel], np.asarray(bs.record)[sel], bs.r_sample[sel])

    train, val, test = sub(idx[:a]), sub(idx[a:b]), sub(idx[b:])
    res = fit_and_evaluate(train, val, test, tree_train=train, epochs=epochs, patience=None, seed=seed)

    model_path = save_model(res["model"], out_dir / "model.pt")
    reloaded = load_model(model_path)
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    same = bool(np.allclose(predict_logits(res["model"], test), predict_logits(reloaded, test), atol=1e-6))

    checks = {
        "cache_roundtrip": bool(cache_ok),
        "model_reload_identical_logits": same,
        "history_epochs": len(res["cnn"]["history"]),
        "tree_nodes_exported": bool(res["tree_json"].get("id") is not None),
    }
    report = {
        "schema_version": SCHEMA_VERSION,
        "status": "smoke",
        "warning": SMOKE_WARNING,
        "generated_at": _now(),
        "record": name,
        "beats": {"train": len(train), "val": len(val), "test": len(test)},
        "checks": checks,
        "cnn": res["cnn"],
        "tree": res["tree_result"],
        "seconds": res["seconds"],
    }
    _write_json(out_dir / "smoke_metrics.json", report)
    _write_json(out_dir / "smoke_tree.json", {"status": "smoke", "warning": SMOKE_WARNING,
                                             "tree": res["tree_json"]})
    _write_json(out_dir / "smoke_dataset_stats.json", {
        "status": "smoke", "warning": SMOKE_WARNING,
        "per_part": {"train": _class_counts(train.labels), "val": _class_counts(val.labels),
                     "test": _class_counts(test.labels)},
    })
    ok = all(v for k, v in checks.items() if k != "history_epochs") and checks["history_epochs"] == epochs
    _log(f"Smoke-Test {'OK' if ok else 'FEHLGESCHLAGEN'}: {checks} -> {out_dir} (Zahlen sind keine Ergebnisse)")
    report["ok"] = ok
    return report


# --------------------------------------------------------------------------- CLI

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m ekg.pipeline", description="EKG-Arrhythmie-Pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("demo", help="Web-Exporte aus echtem Record 100 (ohne Modell-Ergebnisse)")
    d.add_argument("--record", default="data/sample/100")
    d.add_argument("--out", default="web/public/data")
    d.add_argument("--data-dir", default="data/mitdb", help="nur für den Datenstatus in dataset_stats.json")
    d.add_argument("--state", default=None, help="Pfad zu project_state.json (Standard: Repo-Root)")
    d.add_argument("--window-s", type=float, default=DEMO_WINDOW_S)
    d.add_argument("--start-s", type=float, default=None, help="Fensterstart in s (Standard: automatisch)")
    d.add_argument("--force", action="store_true", help="auch vollständige metrics/dataset_stats überschreiben")

    pr = sub.add_parser("prepare", help="BeatSets für DS1/DS2 bauen (npz-Cache)")
    pr.add_argument("--data-dir", default="data/mitdb")
    pr.add_argument("--cache", default="artifacts/beats")
    pr.add_argument("--detected-peaks", action="store_true", help="Pan-Tompkins statt Referenz-Annotationen")

    t = sub.add_parser("train", help="CNN + Baum auf DS1 trainieren, auf DS2 evaluieren")
    t.add_argument("--data-dir", default="data/mitdb")
    t.add_argument("--out", default="artifacts")
    t.add_argument("--export", default="web/public/data", help="Web-Export-Verzeichnis ('' = keiner)")
    t.add_argument("--cache", default=None, help="Standard: <out>/beats")
    t.add_argument("--epochs", type=int, default=20)
    t.add_argument("--patience", type=int, default=5, help="Early Stopping (0 = aus)")
    t.add_argument("--lr", type=float, default=1e-3)
    t.add_argument("--batch-size", type=int, default=256)
    t.add_argument("--seed", type=int, default=0)
    t.add_argument("--val-records", nargs="*", default=None, help="DS1-Records für die Validierung")
    t.add_argument("--n-val", type=int, default=DEFAULT_VAL_RECORDS)
    t.add_argument("--max-depth", type=int, default=4)
    t.add_argument("--detected-peaks", action="store_true")
    t.add_argument("--features", choices=FEATURE_SETS, default="base", help="Zusatz-Eingaben des CNN")
    t.add_argument("--seeds", type=int, nargs="+", default=None, help="Seed-Ensemble (eigene Validierung je Seed)")
    t.add_argument("--max-class-share", type=float, default=0.4)
    t.add_argument("--weight-power", type=float, default=1.0)
    t.add_argument("--augment", action="store_true")
    t.add_argument("--leads", type=int, choices=[1, 2], default=1)
    t.add_argument("--offsets", default=None, help="*_analysis.json aus 'oof' (Klassen-Offsets)")
    t.add_argument("--eval-detected", action="store_true", help="zusätzlich auf Pan-Tompkins-Schlägen in DS2")
    t.add_argument("--cv-report", default=None, help="cv_*.json der gewählten Konfiguration (für metrics.cv)")

    c = sub.add_parser("cv", help="Record-gruppierte Kreuzvalidierung des CNN nur auf DS1")
    c.add_argument("--data-dir", default="data/mitdb")
    c.add_argument("--out", default="artifacts/cv")
    c.add_argument("--cache", default="artifacts/beats")
    c.add_argument("--features", choices=FEATURE_SETS, default="base")
    c.add_argument("--folds", type=int, default=5)
    c.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2])
    c.add_argument("--epochs", type=int, default=20)
    c.add_argument("--patience", type=int, default=5, help="Early Stopping (0 = aus)")
    c.add_argument("--n-val", type=int, default=3, help="0 = keine Validierung, feste Epochenzahl")
    c.add_argument("--max-class-share", type=float, default=0.4)
    c.add_argument("--detected-peaks", action="store_true")
    c.add_argument("--lr-schedule", choices=["cosine"], default=None)
    c.add_argument("--augment", action="store_true", help="Amplitude, Rauschen, Zeitverschiebung")
    c.add_argument("--eval-epochs", type=int, nargs="*", default=[],
                   help="Out-of-fold-Auswertung zusätzlich nach diesen Epochen")
    c.add_argument("--tag", default="", help="Namenszusatz der Ausgabedatei")
    c.add_argument("--weight-power", type=float, default=1.0,
                   help="Exponent der Klassengewichte (1 = invers, 0.5 = Wurzel)")
    c.add_argument("--leads", type=int, choices=[1, 2], default=1, help="2 = zweite Ableitung als CNN-Kanal")

    o = sub.add_parser("oof", help="Ensemble und Klassen-Offsets aus gespeicherten CV-Vorhersagen (A5/A6)")
    o.add_argument("reports", nargs="+", help="cv_*.json (daneben muss *_oof.npz liegen)")

    s = sub.add_parser("smoke", help="Mechanik-Test auf Record 100, 1 Epoche, nur artifacts/smoke/")
    s.add_argument("--record", default="data/sample/100")
    s.add_argument("--out", default="artifacts/smoke")
    s.add_argument("--epochs", type=int, default=1)

    e = sub.add_parser("export-state", help="project_state.json in das Web-Datenverzeichnis kopieren")
    e.add_argument("--state", default=None)
    e.add_argument("--out", default="web/public/data")
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.cmd == "demo":
            run_demo(args.record, args.out, data_dir=args.data_dir, state_path=args.state,
                     window_s=args.window_s, start_s=args.start_s, force=args.force)
        elif args.cmd == "prepare":
            run_prepare(args.data_dir, args.cache, use_reference_peaks=not args.detected_peaks)
        elif args.cmd == "train":
            run_train(args.data_dir, args.out, args.export or None, cache_dir=args.cache, epochs=args.epochs,
                      patience=args.patience or None, lr=args.lr, batch_size=args.batch_size, seed=args.seed,
                      n_val=args.n_val, val_records=args.val_records, max_depth=args.max_depth,
                      use_reference_peaks=not args.detected_peaks, features=args.features, seeds=args.seeds,
                      max_class_share=args.max_class_share, weight_power=args.weight_power, augment=args.augment,
                      leads=args.leads, eval_detected=args.eval_detected,
                      offsets=_read_json(Path(args.offsets))["offsets"] if args.offsets else None,
                      cv_summary=_cv_block(args.cv_report) if args.cv_report else None)
        elif args.cmd == "cv":
            run_cv(args.data_dir, args.out, cache_dir=args.cache, features=args.features, k=args.folds,
                   seeds=args.seeds, epochs=args.epochs, patience=args.patience or None, n_val=args.n_val,
                   max_class_share=args.max_class_share, use_reference_peaks=not args.detected_peaks,
                   lr_schedule=args.lr_schedule, augment=args.augment, eval_epochs=args.eval_epochs, tag=args.tag,
                   weight_power=args.weight_power, leads=args.leads)
        elif args.cmd == "oof":
            for r in args.reports:
                analyze_oof(r)
        elif args.cmd == "smoke":
            rep = run_smoke(args.record, args.out, epochs=args.epochs)
            return 0 if rep["ok"] else 1
        elif args.cmd == "export-state":
            p = export_state(args.state or ROOT / "project_state.json", args.out)
            _log(f"project_state.json -> {p}")
    except DataUnavailableError as exc:
        print(f"FEHLER: {exc}", file=sys.stderr)
        return 2
    except (FileNotFoundError, ValueError) as exc:
        print(f"FEHLER: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
