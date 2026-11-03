"""Tests for ekg.training.train (synthetic beats only; no real-data metrics here)."""

from __future__ import annotations

import json

import numpy as np
import pytest
import torch

from ekg.training.train import (
    BeatTorchDataset,
    class_weights,
    load_model,
    predict,
    predict_logits,
    save_model,
    train_cnn,
)
from ekg.preprocessing.segmentation import BeatSet
from ekg.evaluation.metrics import summary
from ekg.data.loader import CLASSES

L = 252


def _template(cls: int) -> np.ndarray:
    """Clearly different synthetic morphologies per class (unit tests only)."""
    t = np.linspace(-1.0, 1.0, L)
    if cls == 0:  # narrow positive spike
        return np.exp(-(t / 0.03) ** 2)
    if cls == 1:  # narrow negative spike, shifted
        return -np.exp(-((t - 0.3) / 0.03) ** 2)
    if cls == 2:  # wide biphasic wave
        return np.sin(np.pi * t) * np.exp(-(t / 0.4) ** 2)
    raise ValueError(cls)


def _synthetic(n_per_class=(120, 60, 60), seed=0, record="syn") -> BeatSet:
    rng = np.random.default_rng(seed)
    beats, labels = [], []
    for cls, n in enumerate(n_per_class):
        base = _template(cls)
        for _ in range(n):
            b = base + 0.08 * rng.standard_normal(L)
            b = (b - b.mean()) / b.std()
            beats.append(b)
            labels.append(cls)
    beats = np.asarray(beats, dtype=np.float32)
    labels = np.asarray(labels, dtype=np.int64)
    n = labels.size
    rr = np.tile(np.array([0.8, 0.8, 0.8, 1.0], dtype=np.float32), (n, 1))
    rr += 0.02 * rng.standard_normal((n, 4)).astype(np.float32)
    return BeatSet(
        beats=beats,
        rr=rr.astype(np.float32),
        labels=labels,
        record=np.full(n, record),
        r_sample=np.arange(n, dtype=np.int64) * 300,
    )


@pytest.fixture(scope="module")
def data():
    return _synthetic(seed=0, record="trainrec"), _synthetic((40, 20, 20), seed=1, record="valrec")


@pytest.fixture(scope="module")
def trained(data):
    train, val = data
    model, history = train_cnn(train, val, epochs=6, lr=3e-3, batch_size=32, seed=0)
    return model, history


def test_class_weights_inverse_frequency_mean_one():
    labels = np.array([0] * 80 + [1] * 10 + [2] * 10)
    w = class_weights(labels, n_classes=5)
    assert w.dtype == torch.float32 and w.shape == (5,)
    present = w[:3]
    assert torch.isclose(present.mean(), torch.tensor(1.0))
    assert torch.isclose(w[1], w[2])
    assert torch.isclose(w[1] / w[0], torch.tensor(8.0))
    assert w[3] == 0 and w[4] == 0  # missing classes -> 0


def test_class_weights_capped_for_rare_classes():
    # de Chazal DS1 class counts: pure inverse frequency gives Q ~5700x the N weight.
    labels = np.repeat(np.arange(5), [45866, 944, 3788, 414, 8])
    raw = class_weights(labels, max_ratio=None)
    assert raw[4] / raw[0] > 5000
    w = class_weights(labels)
    assert torch.isclose(w.mean(), torch.tensor(1.0))
    ratio = w / w[0]
    assert torch.all(ratio <= 50.0 + 1e-4)
    assert torch.isclose(ratio[4], torch.tensor(50.0)) and torch.isclose(ratio[3], torch.tensor(50.0))
    # classes below the cap keep their inverse-frequency ratio
    assert torch.isclose(ratio[1], torch.tensor(45866 / 944), rtol=1e-4)
    assert torch.isclose(ratio[2], torch.tensor(45866 / 3788), rtol=1e-4)
    with pytest.raises(ValueError):
        class_weights(labels, max_ratio=0.5)


def test_class_weights_missing_class_and_edge_cases():
    w = class_weights(np.array([0, 0, 2, 2, 2, 2]), n_classes=5)
    assert w[1] == 0 and w[3] == 0 and w[4] == 0
    assert torch.isclose(w[[0, 2]].mean(), torch.tensor(1.0))
    assert w[0] > w[2] > 0
    assert torch.all(class_weights(np.array([], dtype=np.int64)) == 0)
    assert torch.allclose(class_weights(np.array([3, 3])), torch.tensor([0, 0, 0, 1.0, 0]))
    with pytest.raises(ValueError):
        class_weights(np.array([0, 5]), n_classes=5)


def test_dataset_items(data):
    train, _ = data
    ds = BeatTorchDataset(train)
    assert len(ds) == len(train)
    beat, rr, y = ds[3]
    assert beat.shape == (L,) and beat.dtype == torch.float32
    assert rr.shape == (4,) and rr.dtype == torch.float32
    assert y.dtype == torch.int64 and int(y) == int(train.labels[3])


def test_training_learns_separable_classes(trained, data):
    model, history = trained
    train, val = data
    assert [h["epoch"] for h in history] == list(range(1, len(history) + 1))
    assert history[-1]["train_loss"] < history[0]["train_loss"]
    best = max(h["val_macro_f1"] for h in history)
    assert best > 0.9
    # restore_best: returned model reproduces the best validation score
    s = summary(val.labels, predict(model, val), CLASSES)
    assert s["macro_f1"] == pytest.approx(best)
    assert s["macro_f1"] > 0.9
    assert not model.training


def test_history_json_serialisable(trained):
    _, history = trained
    text = json.dumps(history, allow_nan=False)
    back = json.loads(text)
    for key in ("epoch", "train_loss", "val_loss", "val_macro_f1"):
        assert key in back[0]
    assert sum(h["best"] for h in history) >= 1


def test_training_without_val_and_determinism():
    train = _synthetic((30, 15, 15), seed=2)
    m1, h1 = train_cnn(train, None, epochs=2, batch_size=16, seed=7)
    m2, h2 = train_cnn(train, None, epochs=2, batch_size=16, seed=7)
    assert all(h["val_loss"] is None and h["val_macro_f1"] is None for h in h1)
    assert h1 == h2
    for (k1, v1), (k2, v2) in zip(m1.state_dict().items(), m2.state_dict().items()):
        assert k1 == k2 and torch.equal(v1, v2)
    json.dumps(h1, allow_nan=False)


def test_early_stopping_respects_patience():
    train = _synthetic((30, 15, 15), seed=3)
    val = _synthetic((10, 5, 5), seed=4)
    _, hist = train_cnn(train, val, epochs=30, lr=3e-3, batch_size=16, seed=0, patience=2)
    last_best = max(i for i, h in enumerate(hist) if h["best"])
    since = len(hist) - 1 - last_best
    # never runs more than `patience` epochs past the last improvement ...
    assert since <= 2
    # ... and an early stop happens exactly after `patience` non-improving epochs
    if len(hist) < 30:
        assert since == 2


def test_train_with_missing_class_in_train():
    """Classes 3 and 4 absent: weights 0, training still runs and stays finite."""
    train = _synthetic((30, 15, 15), seed=5)
    model, hist = train_cnn(train, None, epochs=1, batch_size=16, seed=0)
    assert np.isfinite(hist[0]["train_loss"])
    assert predict(model, train).shape == (len(train),)


def test_invalid_inputs():
    train = _synthetic((5, 5, 5), seed=6)
    with pytest.raises(ValueError):
        train_cnn(BeatSet.empty(), None, epochs=1)
    bad = BeatSet(train.beats, train.rr, train.labels + 10, train.record, train.r_sample)
    with pytest.raises(ValueError):
        train_cnn(bad, None, epochs=1)


def test_save_load_roundtrip_identical_logits(trained, data, tmp_path):
    model, _ = trained
    _, val = data
    path = save_model(model, tmp_path / "sub" / "cnn.pt")
    loaded = load_model(path)
    assert not loaded.training
    assert loaded.channels == model.channels and loaded.kernel_sizes == model.kernel_sizes
    a = predict_logits(model, val)
    b = predict_logits(loaded, val)
    assert a.shape == (len(val), 5)
    np.testing.assert_array_equal(a, b)


def test_load_model_rejects_foreign_file(tmp_path):
    p = tmp_path / "x.pt"
    torch.save({"foo": 1}, p)
    with pytest.raises(ValueError):
        load_model(p)


def test_augment_keeps_shape_and_is_seeded():
    from ekg.training.train import _augment
    x = torch.from_numpy(_synthetic((5, 5, 5)).beats)
    a = _augment(x, torch.Generator().manual_seed(3))
    b = _augment(x, torch.Generator().manual_seed(3))
    assert a.shape == x.shape
    assert torch.equal(a, b)
    assert not torch.equal(a, x)


def test_cosine_schedule_and_epoch_model_callback():
    data = _synthetic((40, 20, 20))
    seen = []
    _, hist = train_cnn(data, None, epochs=4, seed=0, lr_schedule="cosine", augment=True,
                        on_epoch_model=lambda e, m: seen.append((e, m.training)))
    lrs = [h["lr"] for h in hist]
    assert lrs[0] == pytest.approx(1e-3)
    assert all(a > b for a, b in zip(lrs, lrs[1:]))
    assert [e for e, _ in seen] == [1, 2, 3, 4]
    with pytest.raises(ValueError):
        train_cnn(data, None, epochs=1, lr_schedule="step")


def test_class_weights_power():
    y = np.array([0] * 400 + [1] * 100 + [2] * 25)
    full = class_weights(y, 3, max_ratio=None).numpy()
    soft = class_weights(y, 3, max_ratio=None, power=0.5).numpy()
    np.testing.assert_allclose(soft[2] / soft[0], np.sqrt(full[2] / full[0]), rtol=1e-6)
    np.testing.assert_allclose(class_weights(y, 3, power=0.0).numpy(), [1.0, 1.0, 1.0])
    np.testing.assert_allclose(class_weights(y, 3, power=1.0).numpy(), class_weights(y, 3).numpy())


def test_second_lead_training_and_roundtrip(tmp_path):
    import dataclasses
    data = _synthetic((30, 15, 15))
    two = dataclasses.replace(data, beats2=data.beats[:, ::-1].copy())
    assert BeatTorchDataset(two).beats.shape == (len(two), 2, L)
    model, _ = train_cnn(two, None, epochs=1, seed=0, augment=True)
    assert model.in_channels == 2
    path = save_model(model, tmp_path / "m2.pt")
    np.testing.assert_allclose(predict_logits(load_model(path), two), predict_logits(model, two), rtol=1e-6)
    both = BeatSet.concat([two, two])
    assert both.beats2.shape == (2 * len(two), L)
    with pytest.raises(ValueError):
        BeatSet.concat([two, data])
    with pytest.raises(ValueError):
        train_cnn(two, data, epochs=1)
