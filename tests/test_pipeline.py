"""Tests for ekg.pipeline (demo export schema, smoke run, train refusal / mechanics).

Real data: only MIT-BIH record 100 in data/sample/. The train-mechanics test uses
stand-in copies of record 100 under other names in a tmp dir; it checks plumbing
and file schemas only, never metric values.
"""

from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

import numpy as np
import pytest

from ekg import pipeline
from ekg.data.loader import CLASSES, DS1, DS2

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / "data" / "sample"
RECORD = SAMPLE / "100"
STATE = ROOT / "project_state.json"

pytestmark = pytest.mark.skipif(not (SAMPLE / "100.dat").exists(), reason="record 100 not present")


def _strict_load(path: Path):
    def bad(c):
        raise ValueError(f"non-strict JSON constant {c} in {path.name}")
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=bad)


def _max_decimals(values) -> int:
    worst = 0
    for v in values:
        s = repr(float(v))
        if "e" in s or "E" in s:
            s = f"{float(v):.10f}".rstrip("0")
        if "." in s:
            worst = max(worst, len(s.split(".")[1].rstrip("0")))
    return worst


@pytest.fixture(scope="module")
def demo_out(tmp_path_factory):
    out = tmp_path_factory.mktemp("web_data")
    rc = pipeline.main(["demo", "--record", str(RECORD), "--out", str(out),
                        "--data-dir", str(out / "no_mitdb"), "--state", str(STATE)])
    assert rc == 0
    return out


# --------------------------------------------------------------------------- demo

def test_demo_writes_expected_files(demo_out):
    names = {p.name for p in demo_out.iterdir() if p.is_file()}
    expected = {"signal_demo.json", "rhythm_demo.json", "segmentation_demo.json", "filter_response.json",
                "architecture.json", "dataset_stats.json", "metrics.json", "project_state.json"}
    assert expected <= names
    assert "tree.json" not in names  # never in demo mode
    for n in expected:
        _strict_load(demo_out / n)


def test_signal_demo_schema(demo_out):
    d = _strict_load(demo_out / "signal_demo.json")
    for key in ("record", "fs", "source", "start_s", "raw", "filtered", "r_peaks", "annotations",
                "stages", "detection"):
        assert key in d, key
    assert d["record"] == "100" and d["fs"] == 360
    n = len(d["raw"])
    assert n == len(d["filtered"]) == 3600  # ~10 s window
    assert set(d["stages"]) == {"bandpassed", "derivative", "squared", "integrated"}
    assert all(len(v) == n for v in d["stages"].values())
    assert _max_decimals(d["raw"][:500] + d["filtered"][:500] + d["stages"]["integrated"][:500]) <= 4
    assert all(isinstance(p, int) and 0 <= p < n for p in d["r_peaks"])
    assert d["r_peaks"] == sorted(d["r_peaks"])
    for a in d["annotations"]:
        assert set(a) >= {"sample", "symbol", "aami"} and 0 <= a["sample"] < n
        assert a["aami"] in CLASSES or a["aami"] is None
    # window chosen to contain record 100's single V beat
    assert any(a["aami"] == "V" for a in d["annotations"])
    det = d["detection"]
    assert all(isinstance(det[k], int) for k in ("tp", "fp", "fn"))
    assert all(isinstance(det[k], float) and 0.0 <= det[k] <= 1.0 for k in ("sensitivity", "ppv"))
    # whole-record scope: 2273 beat annotations in record 100 (2274 minus the '+' rhythm label)
    assert det["scope"] == "record" and det["tp"] + det["fn"] == 2273
    assert d["detection_window"]["scope"] == "window"
    assert d["start_s"] == pytest.approx(d["start_sample"] / 360, abs=1e-4)


def test_rhythm_demo_schema(demo_out):
    d = _strict_load(demo_out / "rhythm_demo.json")
    assert d["record"] == "100" and d["fs"] == 180 and d["source_fs"] == 360
    assert len(d["filtered"]) == round(d["duration_s"] * d["fs"]) == 60 * 180
    assert _max_decimals(d["filtered"][:500]) <= 3
    times = [b["t"] for b in d["beats"]]
    assert times == sorted(times) and all(0 <= t < d["duration_s"] for t in times)
    assert all(b["aami"] in CLASSES for b in d["beats"])
    # opens on normal beats, then shows record 100's single V beat and several S beats
    assert d["beats"][0]["aami"] == "N"
    assert sum(b["aami"] == "V" for b in d["beats"]) == 1
    assert sum(b["aami"] == "S" for b in d["beats"]) >= 2


def test_segmentation_demo_schema(demo_out):
    d = _strict_load(demo_out / "segmentation_demo.json")
    assert d["fs"] == 360 and d["pre_ms"] == 250 and d["post_ms"] == 450
    assert d["length"] == 252 and d["unit"] == "mV"
    per = {}
    for e in d["examples"]:
        assert set(e) >= {"aami", "symbol", "beat"}
        assert len(e["beat"]) == 252 and all(math.isfinite(v) for v in e["beat"])
        per[e["aami"]] = per.get(e["aami"], 0) + 1
    assert set(per) == {"N", "S", "V"}  # classes present in record 100
    assert per["N"] == 12 and per["S"] == 12 and per["V"] == 1


def test_architecture_and_filter_response(demo_out):
    a = _strict_load(demo_out / "architecture.json")
    assert set(a) >= {"layers", "total_params"}
    assert a["total_params"] == sum(layer["params"] for layer in a["layers"]) > 0
    assert all(set(layer) >= {"name", "type", "output_shape", "params", "detail"} for layer in a["layers"])
    assert a["layers"][-1]["output_shape"][-1] == len(CLASSES)
    f = _strict_load(demo_out / "filter_response.json")
    assert set(f) >= {"freqs", "gain_db", "low", "high", "order"}
    assert len(f["freqs"]) == len(f["gain_db"]) and f["low"] == 0.5 and f["high"] == 40.0
    assert f["freqs"] == sorted(f["freqs"])


def test_pending_metrics_and_stats(demo_out):
    m = _strict_load(demo_out / "metrics.json")
    assert m["status"] == "pending" and "physionet.org" in m["reason"]
    assert "make train" in m["reason"] and m["cnn"] is None and m["tree"] is None
    s = _strict_load(demo_out / "dataset_stats.json")
    assert s["status"] == "pending" and s["records_available"] == 0
    assert "per_split" not in s
    assert len(s["missing"]["DS1"]) == len(DS1) and len(s["missing"]["DS2"]) == len(DS2)
    st = _strict_load(demo_out / "project_state.json")
    assert "modules" in st


def test_demo_keeps_complete_results(tmp_path):
    (tmp_path / "metrics.json").write_text(json.dumps({"status": "complete", "cnn": {}}))
    written = pipeline.run_demo(RECORD, tmp_path, data_dir=tmp_path / "none", state_path=STATE)
    assert "metrics.json" not in written
    assert json.loads((tmp_path / "metrics.json").read_text())["status"] == "complete"


def test_choose_demo_window_prefers_rarest_class():
    rec = pipeline._record_from_path(RECORD)
    start, reason = pipeline.choose_demo_window(rec, 10.0)
    v = [int(s) for s, sym in zip(rec.ann_samples, rec.ann_symbols) if sym == "V"]
    assert len(v) == 1 and start < v[0] < start + 3600
    assert "V" in reason


# --------------------------------------------------------------------------- smoke

def test_split_record_path_strips_extensions():
    for suffix in ("", ".hea", ".dat", ".atr"):
        assert pipeline._split_record_path(f"data/sample/100{suffix}") == ("100", Path("data/sample"))


def test_smoke_runs_and_is_marked(tmp_path):
    out = tmp_path / "smoke"
    # A path ending in .hea must work like in `demo` (regression: smoke looked for 100.hea.hea).
    assert pipeline.main(["smoke", "--record", str(RECORD) + ".hea", "--out", str(out)]) == 0
    m = _strict_load(out / "smoke_metrics.json")
    assert m["status"] == "smoke" and "SMOKE" in m["warning"]
    assert m["checks"]["cache_roundtrip"] and m["checks"]["model_reload_identical_logits"]
    assert len(m["cnn"]["history"]) == 1
    assert (out / "model.pt").exists()
    assert _strict_load(out / "smoke_tree.json")["status"] == "smoke"
    # nothing that the UI/API would pick up as a real result
    assert not (out / "metrics.json").exists() and not (out / "tree.json").exists()


def test_smoke_refuses_web_dir():
    with pytest.raises(ValueError):
        pipeline.run_smoke(RECORD, ROOT / "web" / "public" / "data" / "smoke")


# --------------------------------------------------------------------------- train / prepare

def test_train_refuses_without_data(tmp_path, capsys):
    export = tmp_path / "export"
    rc = pipeline.main(["train", "--data-dir", str(tmp_path / "empty"), "--out", str(tmp_path / "art"),
                        "--export", str(export), "--epochs", "1"])
    assert rc == 2
    err = capsys.readouterr().err
    assert "unvollständig" in err and "physionet.org" in err
    assert not export.exists() and not (tmp_path / "art" / "model.pt").exists()


def test_prepare_refuses_partial_data(tmp_path, capsys):
    data = tmp_path / "mitdb"
    data.mkdir()
    for ext in ("hea", "dat", "atr"):
        shutil.copyfile(SAMPLE / f"100.{ext}", data / f"100.{ext}")
    rc = pipeline.main(["prepare", "--data-dir", str(data), "--cache", str(tmp_path / "cache")])
    assert rc == 2
    assert "43 von 44" in capsys.readouterr().err


def _stand_in_records(data: Path, names: list[str]) -> None:
    """Copies of record 100 under other names (plumbing tests only)."""
    data.mkdir(parents=True, exist_ok=True)
    hea = (SAMPLE / "100.hea").read_text().splitlines()
    for name in names:
        lines = []
        for line in hea:
            if line.startswith("100 "):
                line = name + line[3:]
            elif line.startswith("100.dat"):
                line = f"{name}.dat" + line[len("100.dat"):]
            lines.append(line)
        (data / f"{name}.hea").write_text("\n".join(lines) + "\n")
        shutil.copyfile(SAMPLE / "100.dat", data / f"{name}.dat")
        shutil.copyfile(SAMPLE / "100.atr", data / f"{name}.atr")


def test_train_mechanics_on_stand_in_records(tmp_path):
    ds1, ds2 = ["901", "902", "903"], ["904"]
    data = tmp_path / "mitdb"
    _stand_in_records(data, ds1 + ds2)
    out, export = tmp_path / "art", tmp_path / "export"
    m = pipeline.run_train(data, out, export, epochs=1, patience=None, n_val=1, ds1=ds1, ds2=ds2)
    assert m["status"] == "complete"
    assert set(m["records"]["val"]) <= set(ds1) and len(m["records"]["val"]) == 1
    assert not set(m["records"]["val"]) & set(m["records"]["train"])
    assert m["records"]["test"] == ds2
    for f in ("metrics.json", "tree.json", "dataset_stats.json"):
        assert (export / f).exists() and (out / "web" / f).exists()
    assert (out / "model.pt").exists()
    mm = _strict_load(export / "metrics.json")
    assert set(mm["config"]["library_versions"]) >= {"python", "numpy", "torch", "scikit-learn", "wfdb"}
    assert mm["config"]["preprocessing_fingerprint"] == pipeline.preprocessing_fingerprint()
    assert set(mm) >= {"status", "dataset", "split", "cnn", "tree"}
    assert set(mm["cnn"]) >= {"summary", "history"} and "summary" in mm["tree"]
    assert set(mm["cnn"]["summary"]) >= {"accuracy", "macro_f1", "per_class", "confusion", "class_names"}
    assert set(mm["cnn"]["history"][0]) >= {"epoch", "train_loss", "val_loss", "val_macro_f1"}
    tree = _strict_load(export / "tree.json")
    assert set(tree) >= {"id", "feature", "threshold", "samples", "value", "class", "left", "right"}
    st = _strict_load(export / "dataset_stats.json")
    assert st["status"] == "complete" and set(st["per_split"]) == {"DS1", "DS2"}
    assert st["records_available"] == 4
    # npz cache is reused on a second prepare
    bs, cached = pipeline.load_or_build_beats("901", data, out / "beats")
    assert cached and len(bs) > 0


def test_select_validation_records():
    rng = np.random.default_rng(1)
    labels = {f"r{i}": rng.choice([0, 0, 0, 1, 2], size=50) for i in range(10)}
    labels["r0"] = np.zeros(50, dtype=np.int64)
    val = pipeline.select_validation_records(labels, n_val=3, seed=0)
    assert val == pipeline.select_validation_records(labels, n_val=3, seed=0)
    assert len(val) == 3 and len(set(val)) == 3
    v = np.concatenate([labels[r] for r in val])
    assert {0, 1, 2} <= set(v.tolist())
    with pytest.raises(ValueError):
        pipeline.select_validation_records(labels, n_val=10)


def test_select_validation_records_respects_max_class_share():
    labels = {f"r{i}": np.array([0] * 40 + [1, 2]) for i in range(8)}
    labels["dom"] = np.array([0] * 40 + [1, 2] + [3] * 30)  # holds 30 of 31 F beats
    labels["r0"] = np.array([0] * 40 + [1, 2, 3])
    for seed in range(20):
        val = pipeline.select_validation_records(labels, n_val=3, seed=seed, max_class_share=0.4)
        assert "dom" not in val
    with pytest.raises(ValueError):
        pipeline.select_validation_records(labels, n_val=3, max_class_share=0.01)


def test_cv_folds_disjoint_cover_and_spread_rare():
    labels = {f"r{i:02d}": np.zeros(30, dtype=np.int64) for i in range(12)}
    labels["f_heavy"] = np.array([0] * 30 + [3] * 50)
    labels["s_heavy"] = np.array([0] * 30 + [1] * 50)
    folds = pipeline.cv_folds(labels, k=5)
    flat = [r for f in folds for r in f]
    assert sorted(flat) == sorted(labels) and len(flat) == len(set(flat))
    assert all(len(f) in (2, 3) for f in folds)
    fold_of = {r: i for i, f in enumerate(folds) for r in f}
    assert fold_of["f_heavy"] != fold_of["s_heavy"]
    assert folds == pipeline.cv_folds(labels, k=5)
    with pytest.raises(ValueError):
        pipeline.cv_folds(labels, k=1)


def test_with_features_adds_columns():
    bs, _ = pipeline.load_or_build_beats("100", SAMPLE, None)
    assert pipeline.with_features(bs, "base") is bs
    assert pipeline.with_features(bs, "rr").rr.shape == (len(bs), 7)
    p = pipeline.with_features(bs, "patient")
    assert p.rr.shape == (len(bs), 10)
    np.testing.assert_array_equal(p.rr[:, :4], bs.rr)
    np.testing.assert_array_equal(p.beats, bs.beats)
    with pytest.raises(ValueError):
        pipeline.with_features(bs, "nope")


def test_cv_mechanics_never_loads_ds2(tmp_path, monkeypatch):
    names = ["901", "902", "903", "904"]
    data = tmp_path / "mitdb"
    _stand_in_records(data, names)
    loaded = []
    real = pipeline.load_or_build_beats
    monkeypatch.setattr(pipeline, "load_or_build_beats",
                        lambda name, *a, **k: (loaded.append(name), real(name, *a, **k))[1])
    rep = pipeline.run_cv(data, tmp_path / "cv", cache_dir=tmp_path / "beats", features="patient", k=2,
                          seeds=[0], epochs=1, patience=None, n_val=1, max_class_share=None, ds1=names)
    assert sorted(loaded) == names
    assert (tmp_path / "cv" / "cv_patient.json").exists()
    assert sorted(r for f in rep["folds"] for r in f) == names
    run = rep["runs"][0]
    assert run["summary"]["n"] == sum(len(real(n, data, tmp_path / "beats")[0]) for n in names)
    for f in run["folds"]:
        assert not set(f["val"]) & set(f["test"])
    assert set(rep["aggregate"]["macro_f1_nsvf"]) == {"mean", "std"}


def test_train_records_feature_set(tmp_path):
    ds1, ds2 = ["901", "902", "903"], ["904"]
    data = tmp_path / "mitdb"
    _stand_in_records(data, ds1 + ds2)
    m = pipeline.run_train(data, tmp_path / "art", None, epochs=1, patience=None, n_val=1, ds1=ds1, ds2=ds2,
                           features="patient")
    assert m["config"]["features"] == "patient"
    from ekg.training.train import load_model
    assert load_model(tmp_path / "art" / "model.pt").n_rr == 10


def test_beat_cache_invalidated_by_preprocessing_code_change(tmp_path, monkeypatch):
    cache = tmp_path / "beats"
    bs, hit = pipeline.load_or_build_beats("100", SAMPLE, cache)
    assert not hit
    _, hit = pipeline.load_or_build_beats("100", SAMPLE, cache)
    assert hit
    # Simulate a change of filter / detector / segmentation code -> stale cache must not be reused.
    monkeypatch.setattr(pipeline, "_code_fingerprint_cache", "0" * 16)
    bs2, hit = pipeline.load_or_build_beats("100", SAMPLE, cache)
    assert not hit
    np.testing.assert_array_equal(bs.beats, bs2.beats)


def test_cv_without_validation_reports_epoch_snapshots(tmp_path):
    names = ["901", "902", "903", "904"]
    data = tmp_path / "mitdb"
    _stand_in_records(data, names)
    rep = pipeline.run_cv(data, tmp_path / "cv", cache_dir=tmp_path / "beats", k=2, seeds=[0, 1], epochs=2,
                          patience=None, n_val=0, max_class_share=None, ds1=names, eval_epochs=[1, 2, 7],
                          tag="fixed")
    assert (tmp_path / "cv" / "cv_base_fixed.json").exists()
    assert all(f["val"] == [] for r in rep["runs"] for f in r["folds"])
    assert set(rep["by_epoch"]) == {"1", "2"}
    # the snapshot after the last epoch is the final model
    for r in rep["runs"]:
        assert r["by_epoch"]["2"]["macro_f1_nsvf"] == r["summary"]["macro_f1_nsvf"]
