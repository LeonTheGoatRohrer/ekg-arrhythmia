"""Training loop for :class:`ekg.models.cnn1d.ECGNet1D` on :class:`BeatSet` data.

Design decisions
----------------
* **Optimiser / loss:** Adam + class-weighted cross-entropy. Weights are the inverse
  class frequency of the *training* set, capped at ``MAX_WEIGHT_RATIO`` (50x) the
  weight of the most frequent class and then normalised to mean 1 over the classes
  that are present; classes without training support get weight 0 (see
  :func:`class_weights`). This counteracts the strong N-class dominance (~90 % of
  MIT-BIH beats) without letting absent classes produce undefined weights. The cap
  matters on DS1: pure inverse frequency gives each of the 8 Q beats ~5700x the
  weight of an N beat, so a handful of beats would dominate every mini-batch they
  appear in and make training noisy.
* **Determinism:** :func:`train_cnn` seeds ``random``, ``numpy`` and ``torch``,
  fixes the number of intra-op CPU threads to ``min(4, os.cpu_count())`` and
  shuffles with a dedicated, seeded ``torch.Generator``. Two runs with the same
  seed and data give identical histories and weights on CPU.
* **Validation / model selection:** ``val`` is optional. When given, every epoch
  reports ``val_loss`` and ``val_macro_f1`` (via :func:`ekg.evaluation.metrics.summary`),
  the best epoch (highest ``val_macro_f1``) is checkpointed in memory and restored at
  the end, and optional early stopping (``patience``) stops after that many epochs
  without improvement.

  **Leakage rule:** in the inter-patient protocol (de Chazal et al. 2004) the
  validation set MUST be built from DS1 records only (e.g. a few held-out DS1
  *records*, never random beats of the training records). DS2 is the test set and
  must never be used for model selection, early stopping or tuning; otherwise the
  reported DS2 metrics are optimistically biased.
* **History:** a list of plain dicts (JSON-serialisable) with the contract keys
  ``epoch, train_loss, val_loss, val_macro_f1`` plus ``val_accuracy`` and
  ``lr``. Without ``val`` the validation entries are ``None``.
* **Checkpoints:** :func:`save_model` stores the ``state_dict`` together with the
  constructor configuration so :func:`load_model` can rebuild the exact model.
"""

from __future__ import annotations

import copy
import math
import os
import random
from pathlib import Path
from typing import Any, Callable

import numpy as np
import torch
from torch import nn
from torch.utils.data import Dataset

from ekg.data.loader import CLASSES
from ekg.evaluation.metrics import summary
from ekg.models.cnn1d import ECGNet1D
from ekg.preprocessing.segmentation import BeatSet

__all__ = [
    "BeatTorchDataset",
    "class_weights",
    "MAX_WEIGHT_RATIO",
    "set_determinism",
    "train_cnn",
    "predict",
    "predict_logits",
    "save_model",
    "load_model",
]

CHECKPOINT_FORMAT = "ekg.ECGNet1D"
CHECKPOINT_VERSION = 1


class BeatTorchDataset(Dataset):
    """Wrap a :class:`BeatSet` as a torch Dataset yielding ``(beat, rr, label)``.

    ``beat`` is a float32 tensor (L,), ``rr`` float32 (4,), ``label`` int64 scalar.
    The full arrays are also exposed as tensors (``beats``, ``rr``, ``labels``) so the
    training loop can slice mini-batches without per-sample collation overhead.
    """

    def __init__(self, data: BeatSet) -> None:
        beats = np.asarray(data.beats, dtype=np.float32)
        rr = np.asarray(data.rr, dtype=np.float32)
        labels = np.asarray(data.labels, dtype=np.int64)
        if beats.ndim != 2:
            raise ValueError(f"beats must be 2-D (n, L), got shape {beats.shape}")
        n = beats.shape[0]
        if rr.shape[0] != n or labels.shape[0] != n:
            raise ValueError(
                f"BeatSet arrays are not row-aligned: beats={n}, rr={rr.shape[0]}, labels={labels.shape[0]}"
            )
        self.beats = torch.from_numpy(np.ascontiguousarray(beats))
        self.rr = torch.from_numpy(np.ascontiguousarray(rr))
        self.labels = torch.from_numpy(np.ascontiguousarray(labels))

    def __len__(self) -> int:
        return int(self.labels.shape[0])

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        return self.beats[idx], self.rr[idx], self.labels[idx]


MAX_WEIGHT_RATIO = 50.0


def class_weights(labels, n_classes: int = 5, max_ratio: float | None = MAX_WEIGHT_RATIO,
                  power: float = 1.0) -> torch.Tensor:
    """Capped inverse-frequency class weights, normalised to mean 1 over present classes.

    ``v_c = min(count_c ** -power, max_ratio * (max_k count_k) ** -power)`` for classes
    with support, i.e. no class weighs more than ``max_ratio`` times the most frequent
    class; ``w_c = v_c / mean_{k: count_k > 0}(v_k)``. Classes with zero support get ``0``.
    ``power=1`` is inverse frequency, ``power=0.5`` its square root (softer), ``0`` uniform.
    ``max_ratio=None`` disables the cap. Returns a float32 tensor of
    length ``n_classes``. An empty label array yields all zeros.
    """
    y = np.asarray(labels, dtype=np.int64).reshape(-1)
    if y.size and (y.min() < 0 or y.max() >= n_classes):
        raise ValueError(f"labels must lie in [0, {n_classes})")
    if max_ratio is not None and max_ratio < 1.0:
        raise ValueError("max_ratio must be >= 1 (or None)")
    counts = np.bincount(y, minlength=n_classes).astype(np.float64)
    w = np.zeros(n_classes, dtype=np.float64)
    present = counts > 0
    if present.any():
        inv = counts[present] ** -float(power)
        if max_ratio is not None:
            inv = np.minimum(inv, max_ratio * counts.max() ** -float(power))
        w[present] = inv / inv.mean()
    return torch.tensor(w, dtype=torch.float32)


def set_determinism(seed: int) -> int:
    """Seed python/numpy/torch and fix the CPU thread count. Returns the thread count."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    n_threads = max(1, min(4, os.cpu_count() or 1))
    torch.set_num_threads(n_threads)
    return n_threads


def _check_labels(data: BeatSet, n_classes: int, name: str) -> None:
    y = np.asarray(data.labels)
    if y.size and (y.min() < 0 or y.max() >= n_classes):
        raise ValueError(f"{name} labels must lie in [0, {n_classes}), got range [{y.min()}, {y.max()}]")


def _weighted_loss_sum(logits: torch.Tensor, y: torch.Tensor, weight: torch.Tensor) -> tuple[float, float]:
    """Return (sum_i w[y_i] * nll_i, sum_i w[y_i]) for a batch."""
    nll = nn.functional.cross_entropy(logits, y, reduction="none")
    w = weight[y]
    return float((w * nll).sum().item()), float(w.sum().item())


AUG_SCALE = 0.1      # amplitude factor drawn from [1 - s, 1 + s]
AUG_NOISE = 0.05     # Gaussian noise std (beats are z-normalised)
AUG_SHIFT = 3        # circular time shift in samples, drawn from [-k, k]


def _augment(xb: torch.Tensor, gen: torch.Generator) -> torch.Tensor:
    """Random amplitude scaling, additive noise and a small time shift per beat (B, L)."""
    n, length = xb.shape
    scale = 1.0 + AUG_SCALE * (2.0 * torch.rand(n, 1, generator=gen) - 1.0)
    noise = AUG_NOISE * torch.randn(n, length, generator=gen)
    shift = torch.randint(-AUG_SHIFT, AUG_SHIFT + 1, (n, 1), generator=gen)
    idx = (torch.arange(length).unsqueeze(0) - shift) % length
    return torch.gather(xb * scale + noise, 1, idx)


@torch.no_grad()
def _evaluate(model: ECGNet1D, ds: BeatTorchDataset, weight: torch.Tensor, device: torch.device,
              batch_size: int) -> tuple[float | None, np.ndarray]:
    """Weighted validation loss (training class weights) and predicted labels."""
    model.eval()
    loss_sum, w_sum = 0.0, 0.0
    preds: list[np.ndarray] = []
    for start in range(0, len(ds), batch_size):
        xb = ds.beats[start:start + batch_size].to(device)
        rb = ds.rr[start:start + batch_size].to(device)
        yb = ds.labels[start:start + batch_size].to(device)
        logits = model(xb, rb)
        ls, ws = _weighted_loss_sum(logits, yb, weight)
        loss_sum += ls
        w_sum += ws
        preds.append(logits.argmax(dim=1).cpu().numpy())
    # If val only contains classes absent from training (weight 0) the weighted loss
    # is undefined -> None (keeps the history JSON-serialisable, no NaN).
    val_loss = loss_sum / w_sum if w_sum > 0 else None
    y_pred = np.concatenate(preds) if preds else np.empty(0, dtype=np.int64)
    return val_loss, y_pred.astype(np.int64)


def train_cnn(
    train: BeatSet,
    val: BeatSet | None,
    epochs: int = 10,
    lr: float = 1e-3,
    batch_size: int = 256,
    seed: int = 0,
    device: str = "cpu",
    *,
    patience: int | None = None,
    restore_best: bool = True,
    weight_decay: float = 0.0,
    model_kwargs: dict[str, Any] | None = None,
    on_epoch: Callable[[dict], None] | None = None,
    lr_schedule: str | None = None,
    augment: bool = False,
    on_epoch_model: Callable[[int, ECGNet1D], None] | None = None,
    weight_power: float = 1.0,
) -> tuple[ECGNet1D, list[dict]]:
    """Train an :class:`ECGNet1D` with Adam and class-weighted cross-entropy.

    Parameters
    ----------
    train:
        Training beats (DS1 records in the inter-patient protocol).
    val:
        Optional validation beats. MUST come from DS1 records disjoint from the
        training records, NEVER from DS2 (test set). Used for ``val_*`` history
        entries, best-epoch checkpointing and early stopping.
    epochs, lr, batch_size, seed, device:
        Usual training hyper-parameters; ``seed`` makes runs reproducible on CPU.
    patience:
        Early stopping: stop after ``patience`` epochs without a strictly better
        ``val_macro_f1``. ``None`` (default) disables early stopping. Ignored
        without ``val``.
    restore_best:
        With ``val``: load the weights of the best epoch (highest ``val_macro_f1``,
        earliest on ties) before returning. Without ``val`` the last epoch is kept.
    weight_decay:
        L2 penalty passed to Adam (default 0).
    model_kwargs:
        Extra constructor arguments for :class:`ECGNet1D` (``n_classes``,
        ``in_len`` and ``n_rr`` are derived from the data / ``CLASSES`` unless given).
    on_epoch:
        Optional callback receiving each history entry (e.g. for logging).
    lr_schedule:
        ``None`` (constant ``lr``) or ``"cosine"`` (cosine annealing to 0 over ``epochs``).
    augment:
        Augment training beats each batch (amplitude scaling, noise, time shift; see
        :func:`_augment`), drawn from a separate generator seeded with ``seed + 1``.
    on_epoch_model:
        Optional callback ``(epoch, model)`` after each epoch, e.g. to evaluate snapshots.
    weight_power:
        Exponent of the inverse-frequency class weights (see :func:`class_weights`).

    Returns
    -------
    ``(model, history)`` with the model in eval mode on ``device``. ``history`` is a
    list of dicts ``{"epoch", "train_loss", "val_loss", "val_macro_f1",
    "val_accuracy", "lr", "best"}``; it is JSON-serialisable (no NaN, no tensors).
    """
    if len(train) == 0:
        raise ValueError("training set is empty")
    if epochs < 1:
        raise ValueError("epochs must be >= 1")
    if batch_size < 1:
        raise ValueError("batch_size must be >= 1")
    if patience is not None and patience < 1:
        raise ValueError("patience must be >= 1 or None")
    if lr_schedule not in (None, "cosine"):
        raise ValueError(f"unknown lr_schedule {lr_schedule!r}, expected None or 'cosine'")

    set_determinism(seed)
    dev = torch.device(device)

    kwargs: dict[str, Any] = {"n_classes": len(CLASSES), "in_len": int(train.beats.shape[1]),
                              "n_rr": int(train.rr.shape[1])}
    kwargs.update(model_kwargs or {})
    n_classes = int(kwargs["n_classes"])
    _check_labels(train, n_classes, "train")
    has_val = val is not None and len(val) > 0
    if has_val:
        _check_labels(val, n_classes, "val")
        if val.beats.shape[1] != train.beats.shape[1]:
            raise ValueError("train and val beats have different window lengths")

    model = ECGNet1D(**kwargs).to(dev)
    weight = class_weights(train.labels, n_classes, power=weight_power).to(dev)
    criterion = nn.CrossEntropyLoss(weight=weight)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = (torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
                 if lr_schedule == "cosine" else None)

    train_ds = BeatTorchDataset(train)
    val_ds = BeatTorchDataset(val) if has_val else None
    val_true = np.asarray(val.labels, dtype=np.int64) if has_val else None
    gen = torch.Generator().manual_seed(int(seed))
    aug_gen = torch.Generator().manual_seed(int(seed) + 1)
    n = len(train_ds)

    history: list[dict] = []
    best_f1 = -math.inf
    best_state: dict[str, torch.Tensor] | None = None
    epochs_since_best = 0

    for epoch in range(1, epochs + 1):
        model.train()
        perm = torch.randperm(n, generator=gen)
        loss_sum, w_sum = 0.0, 0.0
        for start in range(0, n, batch_size):
            idx = perm[start:start + batch_size]
            xb = train_ds.beats[idx]
            if augment:
                xb = _augment(xb, aug_gen)
            xb = xb.to(dev)
            rb = train_ds.rr[idx].to(dev)
            yb = train_ds.labels[idx].to(dev)
            optimizer.zero_grad(set_to_none=True)
            logits = model(xb, rb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()
            # Accumulate as weighted sum so the epoch value equals the weighted mean
            # over all training beats (independent of batch boundaries).
            bw = float(weight[yb].sum().item())
            loss_sum += float(loss.item()) * bw
            w_sum += bw
        train_loss = loss_sum / w_sum if w_sum > 0 else 0.0

        entry: dict[str, Any] = {
            "epoch": epoch,
            "train_loss": float(train_loss),
            "val_loss": None,
            "val_macro_f1": None,
            "val_accuracy": None,
            "lr": float(optimizer.param_groups[0]["lr"]),
            "best": False,
        }
        stop = False
        if has_val:
            val_loss, y_pred = _evaluate(model, val_ds, weight, dev, max(batch_size, 1024))
            s = summary(val_true, y_pred, CLASSES[:n_classes] if n_classes <= len(CLASSES)
                        else [str(i) for i in range(n_classes)])
            entry["val_loss"] = None if val_loss is None else float(val_loss)
            entry["val_macro_f1"] = float(s["macro_f1"])
            entry["val_accuracy"] = float(s["accuracy"])
            if s["macro_f1"] > best_f1:
                best_f1 = s["macro_f1"]
                best_state = copy.deepcopy(model.state_dict())
                entry["best"] = True
                epochs_since_best = 0
            else:
                epochs_since_best += 1
                if patience is not None and epochs_since_best >= patience:
                    stop = True
        history.append(entry)
        if on_epoch is not None:
            on_epoch(dict(entry))
        if on_epoch_model is not None:
            on_epoch_model(epoch, model)
        if scheduler is not None:
            scheduler.step()
        if stop:
            break

    if has_val and restore_best and best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    return model, history


@torch.no_grad()
def predict_logits(model: ECGNet1D, data: BeatSet, batch_size: int = 1024) -> np.ndarray:
    """Raw logits (n, n_classes) as float32 numpy array (model evaluated in eval mode)."""
    ds = BeatTorchDataset(data)
    try:
        dev = next(model.parameters()).device
    except StopIteration:  # pragma: no cover
        dev = torch.device("cpu")
    was_training = model.training
    model.eval()
    out: list[np.ndarray] = []
    try:
        for start in range(0, len(ds), batch_size):
            xb = ds.beats[start:start + batch_size].to(dev)
            rb = ds.rr[start:start + batch_size].to(dev)
            out.append(model(xb, rb).float().cpu().numpy())
    finally:
        model.train(was_training)
    if not out:
        return np.empty((0, int(getattr(model, "n_classes", len(CLASSES)))), dtype=np.float32)
    return np.concatenate(out).astype(np.float32, copy=False)


def predict(model: ECGNet1D, data: BeatSet, batch_size: int = 1024) -> np.ndarray:
    """Predicted class ids (int64, shape (n,)) for every beat of ``data``."""
    return predict_logits(model, data, batch_size).argmax(axis=1).astype(np.int64)


def _model_config(model: ECGNet1D) -> dict[str, Any]:
    return {
        "n_classes": int(model.n_classes),
        "in_len": int(model.in_len),
        "n_rr": int(model.n_rr),
        "channels": [int(c) for c in model.channels],
        "kernel_sizes": [int(k) for k in model.kernel_sizes],
        "dropout": float(model.dropout_p),
    }


def save_model(model: ECGNet1D, path) -> Path:
    """Save ``state_dict`` + constructor config (+ class names) to ``path`` (torch format)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "format": CHECKPOINT_FORMAT,
        "version": CHECKPOINT_VERSION,
        "config": _model_config(model),
        "class_names": list(CLASSES),
        "state_dict": {k: v.detach().cpu() for k, v in model.state_dict().items()},
    }
    torch.save(payload, path)
    return path


def load_model(path, map_location: str = "cpu") -> ECGNet1D:
    """Rebuild an :class:`ECGNet1D` saved with :func:`save_model` (returned in eval mode)."""
    payload = torch.load(Path(path), map_location=map_location, weights_only=True)
    if not isinstance(payload, dict) or payload.get("format") != CHECKPOINT_FORMAT:
        raise ValueError(f"{path} is not an {CHECKPOINT_FORMAT} checkpoint")
    cfg = dict(payload["config"])
    cfg["channels"] = tuple(cfg["channels"])
    cfg["kernel_sizes"] = tuple(cfg["kernel_sizes"])
    model = ECGNet1D(**cfg)
    model.load_state_dict(payload["state_dict"])
    model.to(map_location)
    model.eval()
    return model
