"""Tests for ekg.data.loader against the real MIT-BIH record 100 in data/sample/."""

from __future__ import annotations

import importlib.util
import shutil
from collections import Counter
from pathlib import Path

import numpy as np
import pytest
import wfdb

from ekg.data import loader
from ekg.data.loader import (
    AAMI_MAP,
    CLASSES,
    DS1,
    DS2,
    MITDB_RECORDS,
    PACED_RECORDS,
    DataUnavailableError,
    Record,
    aami_class,
    available_records,
    download_mitdb,
    load_record,
)

ROOT = Path(__file__).resolve().parents[1]
SAMPLE_DIR = ROOT / "data" / "sample"


@pytest.fixture(scope="module")
def rec100() -> Record:
    return load_record("100", SAMPLE_DIR)


# --- constants -------------------------------------------------------------

def test_classes_order():
    assert CLASSES == ["N", "S", "V", "F", "Q"]


def test_mitdb_records():
    assert len(MITDB_RECORDS) == 48
    assert len(set(MITDB_RECORDS)) == 48
    assert MITDB_RECORDS == sorted(MITDB_RECORDS)
    assert set(PACED_RECORDS) <= set(MITDB_RECORDS)


def test_inter_patient_split():
    assert len(DS1) == 22 and len(DS2) == 22
    assert len(set(DS1)) == 22 and len(set(DS2)) == 22
    assert set(DS1).isdisjoint(DS2)
    assert set(DS1).isdisjoint(PACED_RECORDS)
    assert set(DS2).isdisjoint(PACED_RECORDS)
    # DS1 + DS2 + paced records cover the whole database
    assert set(DS1) | set(DS2) | set(PACED_RECORDS) == set(MITDB_RECORDS)
    assert "100" in DS2 and "101" in DS1


@pytest.mark.parametrize(
    "symbols, cls",
    [
        ("NLRej", "N"),
        ("AaJS", "S"),
        ("VE", "V"),
        ("F", "F"),
        ("/fQ", "Q"),
    ],
)
def test_aami_map_beats(symbols, cls):
    for s in symbols:
        assert aami_class(s) == cls
        assert AAMI_MAP[s] == cls


@pytest.mark.parametrize("symbol", ["+", "~", "|", '"', "x", "!", "[", "]", "", "Z"])
def test_aami_non_beats(symbol):
    assert aami_class(symbol) is None


def test_aami_map_values_are_classes():
    assert set(AAMI_MAP.values()) == set(CLASSES)
    assert len(AAMI_MAP) == 15


# --- real record 100 -------------------------------------------------------

def test_load_record_100_signal(rec100):
    assert rec100.name == "100"
    assert rec100.fs == 360
    assert rec100.signal.dtype == np.float32
    assert rec100.signal.ndim == 1
    assert rec100.signal.shape == (650000,)
    assert rec100.lead == "MLII"
    # values are physical units (mV), not raw ADC counts
    assert np.isfinite(rec100.signal).all()
    assert np.abs(rec100.signal).max() < 10.0


def test_load_record_100_selects_mlii_channel(rec100):
    raw = wfdb.rdrecord(str(SAMPLE_DIR / "100"))
    idx = raw.sig_name.index("MLII")
    np.testing.assert_allclose(rec100.signal, raw.p_signal[:, idx].astype(np.float32))
    # MLII is channel 0 in record 100; it must differ from V5
    v5 = raw.p_signal[:, raw.sig_name.index("V5")].astype(np.float32)
    assert not np.allclose(rec100.signal, v5)


def test_load_record_100_annotations(rec100):
    # Counts determined from data/sample/100.atr (2274 annotations in total).
    assert rec100.ann_samples.dtype == np.int64
    assert len(rec100.ann_samples) == len(rec100.ann_symbols) == 2274
    assert np.all(np.diff(rec100.ann_samples) >= 0)
    assert Counter(rec100.ann_symbols) == {"N": 2239, "A": 33, "V": 1, "+": 1}
    aami = Counter(c for c in map(aami_class, rec100.ann_symbols) if c is not None)
    assert aami == {"N": 2239, "S": 33, "V": 1}
    assert sum(aami.values()) == 2273  # '+' (rhythm change) is not a beat


def test_load_record_fallback_channel0(tmp_path, monkeypatch):
    for ext in ("hea", "dat", "atr"):
        shutil.copy(SAMPLE_DIR / f"100.{ext}", tmp_path / f"100.{ext}")
    real_rdrecord = wfdb.rdrecord

    def fake_rdrecord(path, *a, **kw):
        r = real_rdrecord(path, *a, **kw)
        r.sig_name = ["V5", "V1"]  # no MLII present -> channel 0
        r.p_signal = r.p_signal[:, ::-1].copy()
        return r

    monkeypatch.setattr(loader.wfdb, "rdrecord", fake_rdrecord)
    rec = load_record("100", tmp_path)
    assert rec.lead == "V5"
    raw = real_rdrecord(str(SAMPLE_DIR / "100"))
    np.testing.assert_allclose(rec.signal, raw.p_signal[:, 1].astype(np.float32))


def test_load_record_missing_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_record("101", tmp_path)


# --- available_records ----------------------------------------------------

def test_available_records_sample():
    assert available_records(SAMPLE_DIR) == ["100"]


def test_available_records_requires_all_files(tmp_path):
    assert available_records(tmp_path / "does-not-exist") == []
    for ext in ("hea", "dat", "atr"):
        shutil.copy(SAMPLE_DIR / f"100.{ext}", tmp_path / f"100.{ext}")
    (tmp_path / "101.hea").write_text("101 2 360 650000\n")
    (tmp_path / "101.dat").write_bytes(b"")
    assert available_records(tmp_path) == ["100"]


# --- download_mitdb --------------------------------------------------------

def test_download_mitdb_network_failure(tmp_path, monkeypatch):
    calls = []

    def boom(*args, **kwargs):
        calls.append((args, kwargs))
        raise ConnectionError("403 Forbidden: physionet.org blocked")

    monkeypatch.setattr(loader.wfdb, "dl_database", boom)
    old_url = wfdb.io.download.config.db_index_url
    with pytest.raises(DataUnavailableError) as ei:
        download_mitdb(tmp_path / "mitdb", records=["101", "103"], base_url="https://mirror.invalid/")
    assert "physionet.org" in str(ei.value)
    assert isinstance(ei.value, RuntimeError)
    assert len(calls) == 1
    args, kwargs = calls[0]
    assert args[0] == "mitdb"
    assert kwargs["records"] == ["101", "103"]
    # global wfdb configuration must be restored
    assert wfdb.io.download.config.db_index_url == old_url


def test_download_mitdb_skips_existing(tmp_path, monkeypatch):
    for ext in ("hea", "dat", "atr"):
        shutil.copy(SAMPLE_DIR / f"100.{ext}", tmp_path / f"100.{ext}")

    def must_not_call(*a, **kw):
        raise AssertionError("dl_database should not be called")

    monkeypatch.setattr(loader.wfdb, "dl_database", must_not_call)
    assert download_mitdb(tmp_path, records=["100"]) == ["100"]


def test_download_mitdb_incomplete_after_download(tmp_path, monkeypatch):
    monkeypatch.setattr(loader.wfdb, "dl_database", lambda *a, **kw: None)
    with pytest.raises(DataUnavailableError):
        download_mitdb(tmp_path, records=["101"])


def test_download_mitdb_unknown_record(tmp_path):
    with pytest.raises(ValueError):
        download_mitdb(tmp_path, records=["999"])


# --- CLI -------------------------------------------------------------------

def _load_cli():
    spec = importlib.util.spec_from_file_location("download_mitdb_cli", ROOT / "scripts" / "download_mitdb.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_cli_exit_code_2_on_unavailable(tmp_path, monkeypatch, capsys):
    cli = _load_cli()

    def boom(*a, **kw):
        raise OSError("network unreachable")

    monkeypatch.setattr(loader.wfdb, "dl_database", boom)
    code = cli.main(["--data-dir", str(tmp_path / "mitdb"), "--records", "101,103"])
    assert code == 2
    err = capsys.readouterr().err
    assert "physionet.org" in err
    assert "Netzwerk-Policy" in err


def test_cli_ok_with_existing(tmp_path, capsys):
    for ext in ("hea", "dat", "atr"):
        shutil.copy(SAMPLE_DIR / f"100.{ext}", tmp_path / f"100.{ext}")
    cli = _load_cli()
    assert cli.main(["--data-dir", str(tmp_path), "--records", "100"]) == 0
    assert "100" in capsys.readouterr().out
