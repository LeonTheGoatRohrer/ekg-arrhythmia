"""MIT-BIH Arrhythmia Database loading utilities.

Reads WFDB records (signal + 'atr' reference annotations), maps beat symbols to the
AAMI EC57 classes and defines the de Chazal et al. (2004) inter-patient split.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import wfdb

__all__ = [
    "CLASSES",
    "AAMI_MAP",
    "MITDB_RECORDS",
    "PACED_RECORDS",
    "DS1",
    "DS2",
    "DataUnavailableError",
    "Record",
    "aami_class",
    "load_record",
    "available_records",
    "download_mitdb",
]

# AAMI EC57 classes; the list index is the integer label id.
CLASSES: list[str] = ["N", "S", "V", "F", "Q"]

# MIT-BIH beat annotation symbol -> AAMI class. Symbols not listed here
# (rhythm changes '+', noise '~', '|', comments '"', 'x', '!', '[', ']', ...) are not beats.
AAMI_MAP: dict[str, str] = {
    # N: normal, bundle branch blocks, escape beats
    "N": "N", "L": "N", "R": "N", "e": "N", "j": "N",
    # S: supraventricular ectopic beats
    "A": "S", "a": "S", "J": "S", "S": "S",
    # V: ventricular ectopic beats
    "V": "V", "E": "V",
    # F: fusion of ventricular and normal
    "F": "F",
    # Q: paced, fusion of paced and normal, unclassifiable
    "/": "Q", "f": "Q", "Q": "Q",
}

# All 48 records of the MIT-BIH Arrhythmia Database.
MITDB_RECORDS: list[str] = [
    "100", "101", "102", "103", "104", "105", "106", "107", "108", "109",
    "111", "112", "113", "114", "115", "116", "117", "118", "119", "121",
    "122", "123", "124", "200", "201", "202", "203", "205", "207", "208",
    "209", "210", "212", "213", "214", "215", "217", "219", "220", "221",
    "222", "223", "228", "230", "231", "232", "233", "234",
]

# Records with paced beats, excluded per AAMI recommendation.
PACED_RECORDS: list[str] = ["102", "104", "107", "217"]

# de Chazal, O'Dwyer & Reilly (2004) inter-patient split: DS1 = training, DS2 = test.
DS1: list[str] = [
    "101", "106", "108", "109", "112", "114", "115", "116", "118", "119", "122",
    "124", "201", "203", "205", "207", "208", "209", "215", "220", "223", "230",
]
DS2: list[str] = [
    "100", "103", "105", "111", "113", "117", "121", "123", "200", "202", "210",
    "212", "213", "214", "219", "221", "222", "228", "231", "232", "233", "234",
]

PHYSIONET_DB = "mitdb"
PREFERRED_LEAD = "MLII"


class DataUnavailableError(RuntimeError):
    """Raised when MIT-BIH data cannot be obtained (e.g. network access blocked)."""


@dataclass
class Record:
    """One MIT-BIH record: a single lead plus all reference annotations."""

    name: str
    signal: np.ndarray  # float32 (n_samples,), lead MLII in mV
    fs: int  # sampling rate in Hz (360 for MIT-BIH)
    ann_samples: np.ndarray  # int64, ALL annotation sample positions
    ann_symbols: list[str] = field(default_factory=list)  # same length as ann_samples
    lead: str = PREFERRED_LEAD  # name of the channel actually used (extra, informational)


def aami_class(symbol: str) -> str | None:
    """Return the AAMI class for a beat symbol, or None for non-beat annotations."""
    return AAMI_MAP.get(symbol)


def load_record(name: str, data_dir: str | Path) -> Record:
    """Load record `name` from `data_dir` using lead MLII (fallback: channel 0).

    Raises FileNotFoundError if the header, signal or 'atr' file is missing.
    """
    data_dir = Path(data_dir)
    base = data_dir / str(name)
    missing = [ext for ext in ("hea", "dat", "atr") if not base.with_suffix(f".{ext}").exists()]
    if missing:
        raise FileNotFoundError(
            f"Record {name!r} incomplete in {data_dir}: missing .{', .'.join(missing)}"
        )

    rec = wfdb.rdrecord(str(base))
    sig_names = list(rec.sig_name or [])
    channel = sig_names.index(PREFERRED_LEAD) if PREFERRED_LEAD in sig_names else 0
    lead = sig_names[channel] if sig_names else f"ch{channel}"
    signal = np.asarray(rec.p_signal[:, channel], dtype=np.float32)

    ann = wfdb.rdann(str(base), "atr")
    ann_samples = np.asarray(ann.sample, dtype=np.int64)
    ann_symbols = [str(s) for s in ann.symbol]

    return Record(
        name=str(name),
        signal=signal,
        fs=int(round(rec.fs)),
        ann_samples=ann_samples,
        ann_symbols=ann_symbols,
        lead=lead,
    )


def available_records(data_dir: str | Path) -> list[str]:
    """Return sorted names of records in `data_dir` that have .hea, .dat and .atr files."""
    data_dir = Path(data_dir)
    if not data_dir.is_dir():
        return []
    names = []
    for hea in data_dir.glob("*.hea"):
        stem = hea.stem
        if (data_dir / f"{stem}.dat").exists() and (data_dir / f"{stem}.atr").exists():
            names.append(stem)
    return sorted(names)


def download_mitdb(
    data_dir: str | Path,
    records: list[str] | None = None,
    base_url: str | None = None,
) -> list[str]:
    """Download MIT-BIH records (header, signal, 'atr') via `wfdb.dl_database`.

    `base_url` optionally overrides the PhysioNet index URL (e.g. a mirror).
    Returns the sorted list of requested records that are now available locally.
    Raises DataUnavailableError with an actionable message on any download failure.
    """
    data_dir = Path(data_dir)
    wanted = [str(r) for r in (records if records is not None else MITDB_RECORDS)]
    unknown = sorted(set(wanted) - set(MITDB_RECORDS))
    if unknown:
        raise ValueError(f"Unknown MIT-BIH record(s): {', '.join(unknown)}")

    todo = [r for r in wanted if r not in set(available_records(data_dir))]
    if todo:
        data_dir.mkdir(parents=True, exist_ok=True)
        old_url = wfdb.io.download.config.db_index_url
        try:
            if base_url:
                wfdb.io.download.set_db_index_url(base_url)
            wfdb.dl_database(
                PHYSIONET_DB, str(data_dir), records=todo, annotators=["atr"]
            )
        except Exception as exc:  # network errors surface as many exception types
            source = base_url or old_url
            raise DataUnavailableError(
                f"Could not download MIT-BIH records from {source} ({type(exc).__name__}: {exc}). "
                "Check network access to physionet.org (allow it in the environment's network "
                "policy) or place the .hea/.dat/.atr files manually in "
                f"{data_dir}."
            ) from exc
        finally:
            wfdb.io.download.set_db_index_url(old_url)

    have = set(available_records(data_dir))
    still_missing = [r for r in wanted if r not in have]
    if still_missing:
        raise DataUnavailableError(
            f"Download finished but {len(still_missing)} record(s) are incomplete in {data_dir}: "
            f"{', '.join(still_missing)}. Check network access to physionet.org."
        )
    return sorted(wanted)
