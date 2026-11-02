"""1D-CNN for single-beat ECG classification with RR-interval fusion.

Architecture (default configuration, L = 252 samples @ 360 Hz):

    beat (B, 1, L)
      -> 3 x [Conv1d(k, padding="same") -> BatchNorm1d -> ReLU -> MaxPool1d(2)]
         channels (16, 32, 64), kernel sizes (7, 5, 3)
      -> AdaptiveAvgPool1d(1) -> Flatten                       (B, 64)
    rr (B, 4)
      -> BatchNorm1d(4) -> Linear(4, 16) -> ReLU               (B, 16)
    concat (B, 80) -> Linear(80, 64) -> ReLU -> Dropout -> Linear(64, n_classes)

``describe_architecture`` runs a real dummy forward pass with forward hooks so that
the reported output shapes are measured, not hard-coded.
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Any

import torch
from torch import nn
import torch.nn.functional as F

__all__ = ["ECGNet1D", "count_parameters", "describe_architecture"]


class _SafeBatchNorm1d(nn.BatchNorm1d):
    """BatchNorm1d that tolerates a training batch of size 1 on (B, C) input.

    Plain BatchNorm1d raises in training mode when it cannot compute batch statistics
    (B == 1 and no length dimension). In that case we fall back to the running
    statistics (no update), which keeps training loops robust against a final
    mini-batch of size 1.
    """

    def forward(self, x: torch.Tensor) -> torch.Tensor:  # noqa: D401
        if self.training and x.dim() == 2 and x.shape[0] == 1:
            return F.batch_norm(
                x,
                self.running_mean,
                self.running_var,
                self.weight,
                self.bias,
                training=False,
                momentum=0.0,
                eps=self.eps,
            )
        return super().forward(x)


class _Concat(nn.Module):
    """Parameter-free concatenation along the feature dimension (hookable)."""

    def forward(self, a: torch.Tensor, b: torch.Tensor) -> torch.Tensor:
        return torch.cat([a, b], dim=1)


class ECGNet1D(nn.Module):
    """Beat classifier: convolutional morphology branch + RR-interval branch."""

    def __init__(
        self,
        n_classes: int = 5,
        in_len: int = 252,
        n_rr: int = 4,
        channels: tuple[int, ...] = (16, 32, 64),
        kernel_sizes: tuple[int, ...] = (7, 5, 3),
        dropout: float = 0.3,
    ) -> None:
        super().__init__()
        if len(channels) != len(kernel_sizes):
            raise ValueError("channels and kernel_sizes must have the same length")
        if len(channels) == 0:
            raise ValueError("at least one convolutional block is required")
        min_len = 2 ** len(channels)
        if in_len < min_len:
            raise ValueError(f"in_len={in_len} too short for {len(channels)} pooling stages (need >= {min_len})")

        self.n_classes = int(n_classes)
        self.in_len = int(in_len)
        self.n_rr = int(n_rr)
        self.channels = tuple(int(c) for c in channels)
        self.kernel_sizes = tuple(int(k) for k in kernel_sizes)
        self.dropout_p = float(dropout)

        blocks: list[tuple[str, nn.Module]] = []
        in_ch = 1
        for i, (out_ch, k) in enumerate(zip(self.channels, self.kernel_sizes), start=1):
            blocks += [
                (f"conv{i}", nn.Conv1d(in_ch, out_ch, kernel_size=k, padding="same")),
                (f"bn{i}", nn.BatchNorm1d(out_ch)),
                (f"relu{i}", nn.ReLU()),
                (f"pool{i}", nn.MaxPool1d(2)),
            ]
            in_ch = out_ch
        blocks += [("gap", nn.AdaptiveAvgPool1d(1)), ("flatten", nn.Flatten())]
        self.features = nn.Sequential(OrderedDict(blocks))
        feat_dim = self.channels[-1]

        rr_hidden = 16
        if self.n_rr > 0:
            self.rr_branch = nn.Sequential(
                OrderedDict(
                    [
                        ("bn", _SafeBatchNorm1d(self.n_rr)),
                        ("fc", nn.Linear(self.n_rr, rr_hidden)),
                        ("relu", nn.ReLU()),
                    ]
                )
            )
            fused_dim = feat_dim + rr_hidden
        else:
            self.rr_branch = None
            fused_dim = feat_dim

        self.concat = _Concat()
        self.head = nn.Sequential(
            OrderedDict(
                [
                    ("fc1", nn.Linear(fused_dim, 64)),
                    ("relu", nn.ReLU()),
                    ("dropout", nn.Dropout(self.dropout_p)),
                    ("fc2", nn.Linear(64, self.n_classes)),
                ]
            )
        )

    def forward(self, beats: torch.Tensor, rr: torch.Tensor | None = None) -> torch.Tensor:
        """Return logits (B, n_classes) for beats (B, L) or (B, 1, L) and rr (B, n_rr) or None."""
        if beats.dim() == 2:
            beats = beats.unsqueeze(1)
        elif beats.dim() != 3 or beats.shape[1] != 1:
            raise ValueError(f"beats must have shape (B, L) or (B, 1, L), got {tuple(beats.shape)}")
        beats = beats.float()
        z = self.features(beats)

        if self.rr_branch is None:
            return self.head(z)

        batch = beats.shape[0]
        if rr is None:
            rr = beats.new_zeros((batch, self.n_rr))
        else:
            rr = rr.to(device=beats.device, dtype=beats.dtype)
            if rr.dim() != 2 or rr.shape != (batch, self.n_rr):
                raise ValueError(f"rr must have shape ({batch}, {self.n_rr}), got {tuple(rr.shape)}")
        r = self.rr_branch(rr)
        return self.head(self.concat(z, r))


def count_parameters(model: nn.Module) -> int:
    """Number of trainable parameters."""
    return int(sum(p.numel() for p in model.parameters() if p.requires_grad))


def _type_name(module: nn.Module) -> str:
    if isinstance(module, nn.BatchNorm1d):
        return "BatchNorm1d"
    return type(module).__name__.lstrip("_")


def _detail(name: str, module: nn.Module) -> str:
    if isinstance(module, nn.Conv1d):
        k = module.kernel_size[0]
        pad = module.padding if isinstance(module.padding, str) else module.padding[0]
        return f"kernel={k}, {module.in_channels}->{module.out_channels}, padding={pad}"
    if isinstance(module, nn.BatchNorm1d):
        return f"features={module.num_features}"
    if isinstance(module, nn.MaxPool1d):
        k = module.kernel_size if isinstance(module.kernel_size, int) else module.kernel_size[0]
        return f"pool={k}"
    if isinstance(module, nn.AdaptiveAvgPool1d):
        return f"global average, output_size={module.output_size}"
    if isinstance(module, nn.Linear):
        return f"{module.in_features}->{module.out_features}"
    if isinstance(module, nn.Dropout):
        return f"p={module.p}"
    if isinstance(module, nn.ReLU):
        return "max(0, x)"
    if isinstance(module, nn.Flatten):
        return "flatten to feature vector"
    if isinstance(module, _Concat):
        return "concat(CNN features, RR features)"
    return ""


def describe_architecture(model: ECGNet1D, in_len: int | None = 252) -> list[dict[str, Any]]:
    """Describe every named leaf layer with measured output shapes.

    A dummy input (batch size 1) is pushed through the model in eval mode; forward hooks
    record each leaf module's output shape in execution order. Pseudo-layers ``input``
    (beat) and ``rr_input`` (if the model has an RR branch) are prepended. The result is
    plain JSON-serialisable data: ``[{"name", "type", "output_shape", "params", "detail"}]``.
    Output shapes include the batch dimension (1). The sum of ``params`` equals
    ``count_parameters(model)``.
    """
    if in_len is None:
        in_len = getattr(model, "in_len", 252)
    in_len = int(in_len)
    n_rr = int(getattr(model, "n_rr", 4))

    try:
        param = next(model.parameters())
        device, dtype = param.device, param.dtype
    except StopIteration:  # pragma: no cover - model always has parameters
        device, dtype = torch.device("cpu"), torch.float32

    records: list[dict[str, Any]] = []
    handles = []

    def make_hook(name: str, module: nn.Module):
        def hook(_mod, _inputs, output):
            records.append(
                {
                    "name": name,
                    "type": _type_name(module),
                    "output_shape": [int(s) for s in output.shape],
                    "params": int(sum(p.numel() for p in module.parameters(recurse=False) if p.requires_grad)),
                    "detail": _detail(name, module),
                }
            )

        return hook

    for name, module in model.named_modules():
        if name and len(list(module.children())) == 0:
            handles.append(module.register_forward_hook(make_hook(name, module)))

    layers: list[dict[str, Any]] = [
        {
            "name": "input",
            "type": "Input",
            "output_shape": [1, 1, in_len],
            "params": 0,
            "detail": f"beat window, {in_len} samples",
        }
    ]
    has_rr = getattr(model, "rr_branch", None) is not None
    if has_rr:
        layers.append(
            {
                "name": "rr_input",
                "type": "Input",
                "output_shape": [1, n_rr],
                "params": 0,
                "detail": f"{n_rr} RR features (pre_rr, post_rr, local_rr, pre/local ratio)",
            }
        )

    was_training = model.training
    model.eval()
    try:
        with torch.no_grad():
            x = torch.zeros(1, 1, in_len, device=device, dtype=dtype)
            rr = torch.zeros(1, n_rr, device=device, dtype=dtype) if has_rr else None
            model(x, rr)
    finally:
        for h in handles:
            h.remove()
        model.train(was_training)

    layers.extend(records)

    # Parameters of non-leaf modules owning direct parameters (none in ECGNet1D) are
    # attributed here so the sum always matches count_parameters.
    covered = sum(layer["params"] for layer in layers)
    missing = count_parameters(model) - covered
    if missing:
        layers.append(
            {"name": "other", "type": "Parameters", "output_shape": [], "params": int(missing), "detail": "unhooked parameters"}
        )
    return layers
