"""Build the English PDF project report from the pipeline's JSON exports.

Run from the repository root:

    make report
    # Windows without make:
    .venv\\Scripts\\python.exe docs\\report\\build_report.py

One-time setup (optional extra, deliberately not in pyproject.toml):

    python -m pip install -c constraints.txt -r docs/report/requirements.txt
    python -m playwright install chromium   # optional: an installed Chrome or Edge is used as fallback

Add ``--preliminary`` for a build made before the final DS2 evaluation; it marks the cover and
the summary page accordingly.

Output: docs/report/ekg-arrhythmia-report.pdf. The intermediate HTML and the SVG figures are
written to docs/report/build/ (git-ignored). Every model number is read from
web/public/data/*.json at build time; optional fields that are missing are left out. The
number of tests comes from ``pytest --collect-only -q``; the colors come from
web/src/style.css; fonts (Inter, JetBrains Mono, OFL) are in docs/report/fonts/.
"""

from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import logging
import re
import subprocess
import sys
from html import escape
from pathlib import Path

import matplotlib

matplotlib.use("svg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import qrcode  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
from matplotlib.patches import FancyBboxPatch, Rectangle  # noqa: E402

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DATA = ROOT / "web" / "public" / "data"
BUILD = HERE / "build"
PDF = HERE / "ekg-arrhythmia-report.pdf"

AUTHOR = "Leon Rohrer"
LIVE_URL = "https://leonrohrer.at/ekg-arrhythmia/"
REPO_URL = "https://github.com/LeonTheGoatRohrer/ekg-arrhythmia"
CLASSES = ["N", "S", "V", "F", "Q"]
CLASS_NAMES = {"N": "normal", "S": "supraventricular ectopic", "V": "ventricular ectopic",
               "F": "fusion", "Q": "unclassifiable"}
# de Chazal, O'Dwyer & Reilly (2004), abstract: DS2 results of the selected configuration.
DE_CHAZAL = {"S": {"sensitivity": 0.759, "ppv": 0.385, "fpr": 0.047},
             "V": {"sensitivity": 0.777, "ppv": 0.819, "fpr": 0.012}}
TREE_FEATURES = {  # label, unit, description (definitions: src/ekg/models/tree_baseline.py)
    "qrs_width_ms": ("QRS width", "ms", "duration of the QRS complex"),
    "r_amplitude": ("R amplitude", "", "height of the R peak (normalized beat)"),
    "q_depth": ("Q depth", "", "deepest point just before R"),
    "s_depth": ("S depth", "", "deepest point just after R"),
    "qrs_area": ("QRS area", "", "area under the QRS complex"),
    "t_amplitude": ("T amplitude", "", "height of the T wave"),
    "beat_energy": ("QRS energy share", "", "share of the beat's energy inside the QRS"),
    "pre_rr": ("pre-RR", "s", "interval to the previous beat"),
    "post_rr": ("post-RR", "s", "interval to the next beat"),
    "local_rr": ("local RR", "s", "mean of the last up to 10 RR intervals"),
    "rr_ratio": ("RR ratio", "", "pre-RR / local RR (prematurity)"),
}
MM = 1 / 25.4  # inch per mm


# ----------------------------------------------------------------------------- inputs

def css_tokens() -> dict[str, str]:
    """Light-mode color tokens (--c-*) from the web UI stylesheet."""
    css = (ROOT / "web" / "src" / "style.css").read_text(encoding="utf-8")
    start = css.index(":root {")
    return dict(re.findall(r"--c-([\w-]+):\s*(#[0-9a-fA-F]{6})", css[start:css.index("}", start)]))


C = css_tokens()


def load(name: str) -> dict:
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


def count_tests() -> int | None:
    try:
        out = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q"], cwd=ROOT,
                             capture_output=True, text=True, timeout=600).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    m = re.search(r"(\d+) tests? collected", out)
    return int(m.group(1)) if m else None


def earlier_ds2_runs() -> list[tuple[str, str, float]]:
    """(run, validation records, macro-F1) of the DS2 evaluations logged in docs/EXPERIMENTS.md."""
    text = (ROOT / "docs" / "EXPERIMENTS.md").read_text(encoding="utf-8")
    return [(n, recs.replace("/", ", "), float(f.replace(",", ".")))
            for n, recs, f in re.findall(r"Run (\d+): (?:Validierung )?([\d/]+),\s*macro-F1 (\d+,\d+)", text)]


def times(n: int) -> str:
    return {1: "once", 2: "twice"}.get(n, f"{n} times")


def weight_cap() -> str | None:
    src = (ROOT / "src" / "ekg" / "training" / "train.py").read_text(encoding="utf-8")
    m = re.search(r"^MAX_WEIGHT_RATIO\s*(?::\s*\w+\s*)?=\s*([\d.]+)", src, re.M)
    return f"{float(m.group(1)):g}" if m else None


# ----------------------------------------------------------------------------- formatting

def _mv(x) -> tuple[float, float | None]:
    """(mean, std) of a plain number or of a {"mean", "std"} dict (seed-aggregated export)."""
    if isinstance(x, dict):
        return float(x["mean"]), (float(x["std"]) if "std" in x else None)
    return float(x), None


def val(x) -> float:
    return _mv(x)[0]


def pct(x, d: int = 1) -> str:
    m, s = _mv(x)
    return f"{m * 100:.{d}f}%" if s is None else f"{m * 100:.{d}f} ± {s * 100:.{d}f}%"


def dec(x, d: int = 2) -> str:
    m, s = _mv(x)
    return f"{m:.{d}f}" if s is None else f"{m:.{d}f} ± {s:.{d}f}"


def cls(c: str) -> str:
    return f'<span class="cls" style="--cls:{C["cls-" + c]}">{c}</span>'


def figure(svg: str, caption: str) -> str:
    return f'<figure><div class="fig-svg">{svg}</div><figcaption>{caption}</figcaption></figure>'


# ----------------------------------------------------------------------------- matplotlib

def setup_matplotlib() -> None:
    logging.getLogger("matplotlib.font_manager").setLevel(logging.ERROR)  # DejaVu is only a glyph fallback
    for f in sorted((HERE / "fonts").glob("Inter-*.ttf")):
        font_manager.fontManager.addfont(str(f))
    plt.rcParams.update({
        "font.family": ["Inter", "DejaVu Sans"], "font.size": 7.2, "svg.fonttype": "none",
        "text.color": C["text"], "axes.edgecolor": C["raw"], "axes.linewidth": 0.6,
        "axes.labelcolor": C["muted"], "axes.labelsize": 7, "axes.titlesize": 7.6,
        "axes.titleweight": "semibold", "axes.titlelocation": "left", "axes.titlecolor": C["text"],
        "axes.titlepad": 4, "axes.spines.top": False, "axes.spines.right": False,
        "xtick.color": C["muted"], "ytick.color": C["muted"], "xtick.labelsize": 6.5, "ytick.labelsize": 6.5,
        "xtick.major.width": 0.6, "ytick.major.width": 0.6, "xtick.major.size": 2.4, "ytick.major.size": 2.4,
        "legend.frameon": False, "legend.fontsize": 6.5, "lines.linewidth": 0.9,
        "figure.facecolor": "none", "savefig.facecolor": "none",
    })


def to_svg(fig, name: str) -> str:
    plt.rcParams["svg.hashsalt"] = name  # unique ids per figure, the SVGs are inlined into one page
    buf = io.StringIO()
    fig.savefig(buf, format="svg")
    plt.close(fig)
    svg = buf.getvalue()
    svg = svg[svg.index("<svg"):].replace("'DejaVu Sans'", "sans-serif")  # browser picks the glyph fallback
    (BUILD / f"{name}.svg").write_text(svg, encoding="utf-8")
    return svg


def beat_peaks(sig: dict) -> tuple[np.ndarray, np.ndarray, list[str]]:
    fs = sig["fs"]
    y = np.asarray(sig["filtered"], dtype=float)
    ann = sig["annotations"]
    return y, np.array([a["sample"] for a in ann]) / fs, [a["aami"] for a in ann]


def fig_cover_strip(sig: dict) -> str:
    """ECG paper at true scale (25 mm/s, 10 mm/mV) with the real record excerpt."""
    w_mm, h_mm = 210, 50
    y, t_ann, lab = beat_peaks(sig)
    t = np.arange(y.size) / sig["fs"]
    x0 = 0.08
    x1 = x0 + w_mm / 25
    lo = (float(y.min()) + float(y.max()) + 0.9) / 2 - h_mm / 20  # trace centred, label band above
    hi = lo + h_mm / 10
    fig = plt.figure(figsize=(w_mm * MM, h_mm * MM))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(x0, x1)
    ax.set_ylim(lo, hi)
    ax.axis("off")
    grid = C["grid"]
    xs = np.arange(0, x1 + 0.04, 0.04)
    ys = np.arange(np.floor(lo), hi + 0.1, 0.1)
    ax.vlines(xs, lo, hi, color=grid, lw=0.3)
    ax.hlines(ys, x0, x1, color=grid, lw=0.3)
    ax.vlines(xs[::5], lo, hi, color="#f9c4ca", lw=0.55)
    ax.hlines(ys[(np.round(ys * 10) % 5) == 0], x0, x1, color="#f9c4ca", lw=0.55)
    ax.plot(t, y, color=C["filtered"], lw=1.05)
    for tt, c in zip(t_ann, lab):
        if x0 < tt < x1:
            ax.text(tt, float(y.max()) + 0.45, c, ha="center", va="center", fontsize=7.5, weight="semibold",
                    color=C["cls-" + c])
    return to_svg(fig, "cover_strip")


def fig_beat_anatomy(sig: dict) -> str:
    fs = sig["fs"]
    y, _, lab = beat_peaks(sig)
    samples = [a["sample"] for a in sig["annotations"]]
    k = next(i for i in range(1, len(lab) - 1) if lab[i - 1:i + 2] == ["N", "N", "N"])

    def refine(s, a, b, fn):
        i0, i1 = s + int(a * fs), s + int(b * fs)
        return i0 + int(fn(y[i0:i1]))

    r0, r, r1 = (refine(s, -0.03, 0.03, np.argmax) for s in samples[k - 1:k + 2])
    pts = {"P": refine(r, -0.25, -0.08, np.argmax), "Q": refine(r, -0.06, 0.0, np.argmin), "R": r,
           "S": refine(r, 0.0, 0.08, np.argmin), "T": refine(r, 0.12, 0.45, np.argmax)}
    lo, hi = r0 - int(0.32 * fs), r1 + int(0.42 * fs)
    t = np.arange(lo, hi) / fs - lo / fs
    fig, ax = plt.subplots(figsize=(80 * MM, 44 * MM), layout="constrained")
    q0, s0 = (pts["Q"] - lo) / fs, (pts["S"] - lo) / fs
    ax.axvspan(q0 - 0.012, s0 + 0.012, color=C["accent"], alpha=0.10, lw=0)
    ax.plot(t, y[lo:hi], color=C["filtered"], lw=1.0)
    offsets = {"P": (0, 5, "center", "bottom"), "R": (0, 5, "center", "bottom"), "T": (0, 5, "center", "bottom"),
               "Q": (-4, -3, "right", "top"), "S": (4, -3, "left", "top")}
    for name, idx in pts.items():
        tx, ty = (idx - lo) / fs, y[idx]
        dx, dy, ha, va = offsets[name]
        ax.plot(tx, ty, "o", ms=2.6, color=C["text"])
        ax.annotate(name, (tx, ty), xytext=(dx, dy), textcoords="offset points", ha=ha, va=va, fontsize=7,
                    weight="semibold")
    ax.text((q0 + s0) / 2, y[lo:hi].min() - 0.42, "QRS complex", ha="center", va="top", fontsize=6.3,
            color=C["accent"], weight="semibold")
    top = y[lo:hi].max() + 0.35
    ra, rb = (r - lo) / fs, (r1 - lo) / fs
    ax.annotate("", (ra, top), (rb, top), arrowprops=dict(arrowstyle="<->", color=C["muted"], lw=0.7,
                                                          shrinkA=0, shrinkB=0))
    ax.text((ra + rb) / 2, top + 0.05, f"RR interval {(r1 - r) / fs:.2f} s", ha="center", va="bottom",
            fontsize=6.5, color=C["muted"])
    ax.set_ylim(y[lo:hi].min() - 0.7, top + 0.32)
    ax.set_xlim(0, t[-1])
    ax.set_xlabel("time (s)")
    ax.set_ylabel("mV")
    return to_svg(fig, "beat_anatomy")


def fig_class_distribution(stats: dict) -> str:
    fig, ax = plt.subplots(figsize=(80 * MM, 54 * MM), layout="constrained")
    x = np.arange(len(CLASSES))
    w = 0.38
    top = 1
    for j, (split, alpha) in enumerate((("DS1", 1.0), ("DS2", 0.42))):
        counts = [stats["per_split"][split].get(c, 0) for c in CLASSES]
        top = max(top, *counts)
        for xi, c, v in zip(x, CLASSES, counts):
            if v <= 0:
                continue
            xb = xi + (j - 0.5) * w
            ax.bar(xb, v, w * 0.92, color=C["cls-" + c], alpha=alpha, lw=0)
            ax.text(xb, v * 1.25, f"{v:,}", rotation=90, ha="center", va="bottom", fontsize=5.8,
                    color=C["muted"])
    ax.set_yscale("log")
    ax.set_ylim(1, top * 30)
    ax.set_xticks(x, CLASSES)
    for tick, c in zip(ax.get_xticklabels(), CLASSES):
        tick.set_color(C["cls-" + c])
        tick.set_fontweight("semibold")
        tick.set_fontsize(7.5)
    ax.set_ylabel("beats (log scale)")
    ax.bar(0, 0, color=C["muted"], label="DS1 (training)")
    ax.bar(0, 0, color=C["muted"], alpha=0.42, label="DS2 (test)")
    ax.legend(loc="upper right", ncol=2, handlelength=1, columnspacing=1)
    ax.grid(axis="y", color=C["border"], lw=0.5)
    ax.set_axisbelow(True)
    return to_svg(fig, "class_distribution")


def fig_raw_filtered(sig: dict) -> str:
    fs = sig["fs"]
    raw = np.asarray(sig["raw"], dtype=float)
    y, t_ann, lab = beat_peaks(sig)
    t = np.arange(raw.size) / fs
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(174 * MM, 50 * MM), sharex=True, layout="constrained")
    a1.plot(t, raw, color=C["raw"], lw=0.8)
    a1.set_title("Raw signal (lead MLII)", fontsize=7.2)
    a2.plot(t, y, color=C["filtered"], lw=0.85)
    ymax = y.max()
    for tt, c in zip(t_ann, lab):
        a2.text(tt, ymax + 0.4, c, ha="center", va="center", fontsize=6.8, weight="semibold",
                color=C["cls-" + c])
    pk = np.asarray(sig["r_peaks"])
    a2.plot(pk / fs, y[pk], "v", ms=3, color=C["peak"], mec="none")
    a2.set_ylim(y.min() - 0.2, ymax + 0.85)
    a2.set_title("After baseline removal and band-pass 0.5–40 Hz, with detected R peaks and the cardiologists' labels",
                 fontsize=7.2)
    for a in (a1, a2):
        a.set_ylabel("mV")
        a.grid(axis="y", color=C["border"], lw=0.5)
    a2.set_xlabel("time in excerpt (s)")
    a2.set_xlim(0, t[-1])
    return to_svg(fig, "raw_filtered")


def fig_filter_response(fr: dict) -> str:
    f = np.asarray(fr["freqs"])
    fig, ax = plt.subplots(figsize=(80 * MM, 46 * MM), layout="constrained")
    ax.axvspan(fr["low"], fr["high"], color=C["accent"], alpha=0.08, lw=0)
    ax.plot(f, fr["gain_db"], color=C["raw"], lw=0.8, ls="--", label="single pass")
    ax.plot(f, fr["gain_db_zero_phase"], color=C["accent"], lw=1.2, label="forward + backward (used)")
    ax.axvline(60, color=C["filtered"], lw=0.7, ls=":")
    ax.text(60 * 0.92, -40, "60 Hz mains", fontsize=6, color=C["filtered"], ha="right", va="center", rotation=90)
    ax.text(np.sqrt(fr["low"] * fr["high"]), -8, f"passband {fr['low']:g}–{fr['high']:g} Hz", ha="center",
            fontsize=6.3, color=C["accent"], weight="semibold")
    ax.set_xscale("log")
    ax.set_xlim(f[0], f[-1])
    ax.set_ylim(-80, 6)
    ax.set_xlabel("frequency (Hz)")
    ax.set_ylabel("gain (dB)")
    ax.legend(loc="lower center", fontsize=6)
    ax.grid(color=C["border"], lw=0.5)
    ax.set_axisbelow(True)
    return to_svg(fig, "filter_response")


def fig_pan_tompkins(sig: dict) -> str:
    fs = sig["fs"]
    st = sig["stages"]
    rows = [("input (filtered ECG)", sig["filtered"], C["filtered"]),
            ("1  band-pass 5–15 Hz", st["bandpassed"], C["accent-2"]),
            ("2  derivative", st["derivative"], C["accent-2"]),
            ("3  squaring", st["squared"], C["accent-2"]),
            ("4  integration (150 ms)", st["integrated"], C["accent"])]
    fig, axes = plt.subplots(len(rows), 1, figsize=(174 * MM, 53 * MM), sharex=True)
    fig.subplots_adjust(left=0.17, right=0.995, top=0.93, bottom=0.17, hspace=0.18)
    pk = np.asarray(sig["r_peaks"]) / fs
    for ax, (label, data, color) in zip(axes, rows):
        d = np.asarray(data, dtype=float)
        d = d / (np.abs(d).max() or 1)
        t = np.arange(d.size) / fs
        ax.vlines(pk, -1.1, 1.1, color=C["peak"], lw=0.6, ls=(0, (2, 2)))
        ax.plot(t, d, color=color, lw=0.75)
        ax.set_ylim(-1.15 if d.min() < -0.05 else -0.08, 1.12)
        ax.set_yticks([])
        ax.spines["left"].set_visible(False)
        ax.text(-0.012, 0.5, label, transform=ax.transAxes, ha="right", va="center", fontsize=6.8,
                color=C["text"])
    axes[-1].set_xlim(0, len(sig["filtered"]) / fs)
    axes[-1].set_xlabel("time in excerpt (s)")
    axes[0].text(1.0, 1.04, "dashed lines: detected R peaks", transform=axes[0].transAxes, ha="right",
                 va="bottom", fontsize=6, color=C["peak"])
    return to_svg(fig, "pan_tompkins")


def fig_beats(seg: dict) -> str:
    fs, r = seg["fs"], seg["r_index"]
    present = [c for c in CLASSES if any(e["aami"] == c for e in seg["examples"])]
    fig, axes = plt.subplots(1, len(present), figsize=(174 * MM, 38 * MM), sharey=True, layout="constrained")
    axes = np.atleast_1d(axes)
    for ax, c in zip(axes, present):
        ex = [e["beat"] for e in seg["examples"] if e["aami"] == c]
        tms = (np.arange(len(ex[0])) - r) / fs * 1000
        for b in ex:
            ax.plot(tms, b, color=C["cls-" + c], lw=0.8, alpha=0.55 if len(ex) > 1 else 1)
        ax.axvline(0, color=C["muted"], lw=0.5, ls=":")
        ax.set_title(f"{c} · {CLASS_NAMES[c]}", color=C["cls-" + c])
        total = seg["counts"].get(c, len(ex))
        ax.text(0.99, 0.98, f"{len(ex)} of {total:,} beat{'s' if total != 1 else ''}", transform=ax.transAxes,
                ha="right", va="top", fontsize=6, color=C["muted"])
        ax.set_xlabel("ms relative to R")
        ax.set_xlim(tms[0], tms[-1])
        ax.grid(color=C["border"], lw=0.5)
    axes[0].set_ylabel("mV")
    return to_svg(fig, "beats")


def fig_rr(sig: dict) -> tuple[str, dict]:
    fs = sig["fs"]
    y, t_ann, lab = beat_peaks(sig)
    k = next((i for i in range(1, len(lab) - 1) if lab[i] != "N"), len(lab) // 2)
    sel = range(max(0, k - 2), min(len(lab), k + 3))
    lo, hi = t_ann[sel[0]] - 0.35, t_ann[sel[-1]] + 0.35
    t = np.arange(y.size) / fs
    m = (t >= lo) & (t <= hi)
    fig, ax = plt.subplots(figsize=(174 * MM, 34 * MM), layout="constrained")
    ax.plot(t[m], y[m], color=C["filtered"], lw=0.9)
    top = y[m].max() + 0.25
    col_k = C["cls-" + lab[k]]
    for i in list(sel)[:-1]:
        a, b = t_ann[i], t_ann[i + 1]
        hot = i in (k - 1, k)
        color = col_k if hot else C["muted"]
        ax.annotate("", (a, top), (b, top), arrowprops=dict(arrowstyle="<->", color=color, lw=0.8 if hot else 0.6,
                                                            shrinkA=0, shrinkB=0))
        name = {k - 1: "pre-RR · early", k: "post-RR · pause"}.get(i, "")
        ax.text((a + b) / 2, top + 0.06, f"{b - a:.2f} s" + (f"\n{name}" if name else ""), ha="center",
                va="bottom", fontsize=6.4, color=color, weight="semibold" if hot else "normal", linespacing=1.2)
    for i in sel:
        ax.text(t_ann[i], y[m].min() - 0.08, lab[i], ha="center", va="top", fontsize=7, weight="semibold",
                color=C["cls-" + lab[i]])
    ax.set_ylim(y[m].min() - 0.45, top + 0.8)
    ax.set_xlim(lo, hi)
    ax.set_xlabel("time in excerpt (s)")
    ax.set_ylabel("mV")
    rr = np.diff(t_ann)
    pre = rr[k - 1]
    local = float(np.mean(rr[max(0, k - 10):k]))  # last <= 10 intervals incl. the current pre-RR
    return to_svg(fig, "rr"), {"cls": lab[k], "pre": pre, "post": rr[k], "local": local}


def fig_cnn(arch: dict) -> str:
    """Feature-map sketch of ECGNet1D drawn from the shapes in architecture.json."""
    layers = {layer["name"]: layer for layer in arch["layers"]}
    blocks = []
    i = 1
    while f"features.conv{i}" in layers:
        k = re.search(r"kernel=(\d+)", layers[f"features.conv{i}"]["detail"])
        _, ch, length = layers[f"features.pool{i}"]["output_shape"]
        blocks.append((ch, length, k.group(1) if k else "?"))
        i += 1
    beat_len = arch["input"]["beat_len"]
    n_rr = arch["input"]["n_rr"]
    gap = layers["features.flatten"]["output_shape"][-1]
    rr_out = layers["rr_branch.fc"]["output_shape"][-1]
    concat = layers["concat"]["output_shape"][-1]
    dense = layers["head.fc1"]["output_shape"][-1]
    n_out = layers["head.fc2"]["output_shape"][-1]

    W, H, base = 174, 58, 28  # mm; base = vertical centre of the main path
    fig = plt.figure(figsize=(W * MM, H * MM))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, W)
    ax.set_ylim(0, H)
    ax.axis("off")
    n_cols = len(blocks) + 5  # input, conv blocks, pooling, concat, dense, output
    col = W / n_cols
    cx = [col * (i + 0.5) for i in range(n_cols)]
    edges = []  # (left, right) of every element on the main path

    def labels(x, title, sub):
        ax.text(x, base - 15.5, title, ha="center", va="top", fontsize=6.4, weight="semibold")
        ax.text(x, base - 19, sub, ha="center", va="top", fontsize=5.9, color=C["muted"])

    def stack(x, n_sheets, h, color, title, sub):
        width = 3.2 + (n_sheets - 1) * 1.0
        x0 = x - width / 2
        for s in range(n_sheets):
            ax.add_patch(Rectangle((x0 + s * 1.0, base - h / 2 + s * 0.8), 3.2, h, fc=color, ec="white", lw=0.5))
        labels(x, title, sub)
        edges.append((x0, x0 + width))

    def vec(x, n, color, title, sub, letters=None, y0=base, label=True):
        cell = 3.4 if letters else None
        h = cell * n if cell else min(27, 3 + n * 0.3)
        ax.add_patch(Rectangle((x - 1.3, y0 - h / 2), 2.6, h, fc=color, ec="white", lw=0.4))
        for j, c in enumerate(letters or []):
            yy = y0 + h / 2 - (j + 0.5) * cell
            ax.add_patch(Rectangle((x - 1.3, yy - cell / 2), 2.6, cell, fc=C["cls-" + c], ec="white", lw=0.6))
            ax.text(x + 2.4, yy, c, va="center", fontsize=6.3, weight="semibold", color=C["cls-" + c])
        if label:
            labels(x, title, sub)
            edges.append((x - 1.3, x + 1.3))
        return h

    def arrow(p0, p1, **kw):
        ax.annotate("", p1, p0, arrowprops=dict(arrowstyle="-|>", color=C["raw"], lw=0.7, mutation_scale=6,
                                                shrinkA=1.2, shrinkB=1.2, **kw))

    stack(cx[0], 1, 6 + 22, C["filtered"], "Beat window", f"1 × {beat_len}")
    shades = [C["accent"], "#14b8a6", "#0f766e", "#115e59"]
    for j, (ch, length, k) in enumerate(blocks, 1):
        stack(cx[j], max(1, ch // 8), 6 + 22 * length / beat_len, shades[min(j, 3)], f"Conv block {j}",
              f"k{k} · {ch} × {length}")
    j = len(blocks) + 1
    vec(cx[j], gap, C["accent"], "Avg pooling", f"{gap} values")
    h_cat = vec(cx[j + 1], concat, C["text"], "Concatenate", f"{gap} + {rr_out} = {concat}")
    vec(cx[j + 2], dense, C["accent-2"], "Dense + dropout", f"{dense} units")
    vec(cx[j + 3] - 2, n_out, C["muted"], "Output", f"{n_out} class scores", letters=CLASSES[:n_out])
    for (_, r), (l, _) in zip(edges, edges[1:]):
        arrow((r, base), (l, base))
    # RR branch above the main path, joining the concatenation from the top
    yr = H - 6
    vec(cx[j - 1], n_rr, C["peak"], "", "", y0=yr, label=False)
    vec(cx[j], rr_out, C["peak"], "", "", y0=yr, label=False)
    ax.text(cx[j - 1] - 2.5, yr, f"{n_rr} RR features", ha="right", va="center", fontsize=6.4, weight="semibold")
    arrow((cx[j - 1] + 1.3, yr), (cx[j] - 1.3, yr))
    ax.text((cx[j - 1] + cx[j]) / 2, yr + 1.2, "BN + linear", ha="center", va="bottom", fontsize=5.8,
            color=C["muted"])
    ax.text(cx[j] + 2.2, yr - 2.4, f"{rr_out} values", ha="left", va="top", fontsize=5.9, color=C["muted"])
    arrow((cx[j] + 1.3, yr), (cx[j + 1], base + h_cat / 2), connectionstyle="angle,angleA=0,angleB=90")
    return to_svg(fig, "cnn")


def fig_history(history: list[dict]) -> str:
    ep = [h["epoch"] for h in history]
    best = [h["epoch"] for h in history if h.get("best")]
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(80 * MM, 62 * MM), sharex=True, layout="constrained")
    a1.plot(ep, [h["train_loss"] for h in history], "-o", ms=2.2, color=C["accent"], label="training loss")
    a1.plot(ep, [h["val_loss"] for h in history], "-o", ms=2.2, color=C["peak"], label="validation loss")
    a1.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=2, fontsize=6, handlelength=1.4)
    a1.set_ylabel("loss")
    a2.plot(ep, [h["val_macro_f1"] for h in history], "-o", ms=2.2, color=C["accent-2"])
    a2.set_ylabel("val. macro-F1")
    a2.set_xlabel("epoch")
    for a in (a1, a2):
        a.grid(color=C["border"], lw=0.5)
        a.set_axisbelow(True)
        if best:
            a.axvline(best[-1], color=C["text"], lw=0.6, ls=":")
    if best:
        a2.text(best[-1] + 0.1, a2.get_ylim()[0], " kept", va="bottom", fontsize=6, color=C["text"])
    a2.set_xticks(ep)
    return to_svg(fig, "history")


def fig_tree(tree: dict) -> str:
    nodes = []

    def walk(n, depth):
        if n.get("feature") is None:
            x = sum(1 for m in nodes if m["leaf"])
            nodes.append({"n": n, "depth": depth, "x": x, "leaf": True})
            return x
        xl = walk(n["left"], depth + 1)
        xr = walk(n["right"], depth + 1)
        x = (xl + xr) / 2
        nodes.append({"n": n, "depth": depth, "x": x, "leaf": False, "kids": (xl, xr)})
        return x

    walk(tree, 0)
    n_leaves = sum(1 for m in nodes if m["leaf"])
    depth = max(m["depth"] for m in nodes)
    W, H = 174, 26 + 15 * depth
    fig = plt.figure(figsize=(W * MM, H * MM))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, W)
    ax.set_ylim(0, H)
    ax.axis("off")
    pitch = (W - 4) / n_leaves
    X = lambda x: 2 + pitch * (x + 0.5)  # noqa: E731
    Y = lambda d: H - 7 - d * 15  # noqa: E731

    def cond(n):
        label, unit, _ = TREE_FEATURES.get(n["feature"], (n["feature"], "", ""))
        thr = n["threshold"]
        v = f"{thr:.0f} ms" if unit == "ms" else f"{thr:.2f} s" if unit == "s" else f"{thr:.2f}"
        return f"{label} ≤ {v.replace('-', '−')}"

    for m in nodes:
        if not m["leaf"]:
            for side, xk in zip(("yes", "no"), m["kids"]):
                ax.plot([X(m["x"]), X(xk)], [Y(m["depth"]) - 3, Y(m["depth"] + 1) + 3.2], color=C["raw"], lw=0.6)
                if m["depth"] == 0:
                    ax.text((X(m["x"]) + X(xk)) / 2, (Y(0) + Y(1)) / 2 + 1, side, ha="center", fontsize=6,
                            color=C["muted"], style="italic")
    for m in nodes:
        n, x, y = m["n"], X(m["x"]), Y(m["depth"])
        color = C["cls-" + n["class"]]
        if m["leaf"]:
            ax.add_patch(FancyBboxPatch((x - 3.2, y - 2.6), 6.4, 5.2, boxstyle="round,pad=0,rounding_size=0.9",
                                        fc=color, ec="none"))
            ax.text(x, y, n["class"], ha="center", va="center", fontsize=7, color="white", weight="bold")
            ax.text(x, y - 4.2, f"{n['samples']:,}", ha="center", va="top", fontsize=5.2, color=C["muted"])
            continue
        detailed = m["depth"] <= 2
        w = min(pitch * 2 ** (depth - m["depth"]) - (2.5 if detailed else 1.4), 40 if detailed else 21)
        h = 9 if detailed else 7.6
        ax.add_patch(FancyBboxPatch((x - w / 2, y - h / 2), w, h, boxstyle="round,pad=0,rounding_size=1.2",
                                    fc="white", ec=C["border"], lw=0.7))
        ax.add_patch(Rectangle((x - w / 2, y - h / 2 + 0.6), 0.9, h - 1.2, fc=color, ec="none"))
        if detailed:
            ax.text(x + 0.4, y + 1.4, cond(n), ha="center", va="center", fontsize=6.6, weight="semibold")
            ax.text(x + 0.4, y - 2.2, f"{n['samples']:,} beats", ha="center", va="center", fontsize=5.8,
                    color=C["muted"])
        else:
            label, thr = cond(n).split(" ≤ ")
            ax.text(x + 0.4, y + 1.6, label, ha="center", va="center", fontsize=5.4, weight="semibold")
            ax.text(x + 0.4, y - 1.6, f"≤ {thr} · {n['samples']:,}", ha="center", va="center", fontsize=5.0,
                    color=C["muted"])
    return to_svg(fig, "tree")


def fig_confusion(m: dict) -> str:
    cmap = LinearSegmentedColormap.from_list("acc", ["#ffffff", C["accent"]])
    fig, axes = plt.subplots(1, 2, figsize=(174 * MM, 74 * MM), layout="constrained")
    for ax, (key, title) in zip(axes, (("cnn", "1D CNN"), ("tree", "Decision tree"))):
        s = m[key]["summary"]
        names = s.get("class_names", CLASSES)
        cm = np.asarray(s["confusion"], dtype=float)
        rows = cm.sum(axis=1, keepdims=True)
        norm = np.divide(cm, rows, out=np.zeros_like(cm), where=rows > 0)
        ax.imshow(norm, cmap=cmap, vmin=0, vmax=1)
        for i in range(len(names)):
            for j in range(len(names)):
                dark = norm[i, j] > 0.55
                ax.text(j, i - 0.12, f"{int(cm[i, j]):,}", ha="center", va="center", fontsize=6.6,
                        weight="semibold" if i == j else "normal", color="white" if dark else C["text"])
                if rows[i, 0] > 0:
                    ax.text(j, i + 0.24, f"{norm[i, j] * 100:.1f}%", ha="center", va="center", fontsize=5.3,
                            color="white" if dark else C["muted"])
        ax.set_xticks(range(len(names)), names)
        ax.set_yticks(range(len(names)), names)
        for tick, c in list(zip(ax.get_xticklabels(), names)) + list(zip(ax.get_yticklabels(), names)):
            tick.set_color(C["cls-" + c])
            tick.set_fontweight("semibold")
            tick.set_fontsize(7.4)
        ax.tick_params(length=0)
        for sp in ax.spines.values():
            sp.set_visible(False)
        ax.set_xlabel("predicted class")
        ax.set_ylabel("true class (cardiologists)")
        ax.set_title(title)
    return to_svg(fig, "confusion")


def fig_compare(rows: list[tuple[str, dict]]) -> str:
    """rows: (label, {"S": per-class stats, "V": ...}); grouped bars for Se and +P of S and V."""
    metrics = [("S", "sensitivity", "S · Se"), ("S", "ppv", "S · +P"), ("V", "sensitivity", "V · Se"),
               ("V", "ppv", "V · +P")]
    colors = [C["accent"], C["raw"], C["text"]]
    fig, ax = plt.subplots(figsize=(80 * MM, 58 * MM), layout="constrained")
    n = len(rows)
    h = 0.8 / n
    for j, ((label, stats), color) in enumerate(zip(rows, colors)):
        ys = np.arange(len(metrics)) + (j - (n - 1) / 2) * h
        vs = [val(stats[c][k]) for c, k, _ in metrics]
        ax.barh(ys, vs, h * 0.9, color=color, label=label, lw=0)
        for yy, v in zip(ys, vs):
            ax.text(v + 0.01, yy, f"{v * 100:.0f}", va="center", fontsize=5.6, color=C["muted"])
    ax.set_yticks(range(len(metrics)), [m[2] for m in metrics])
    for tick, (c, _, _) in zip(ax.get_yticklabels(), metrics):
        tick.set_color(C["cls-" + c])
        tick.set_fontweight("semibold")
    ax.invert_yaxis()
    ax.set_xlim(0, 1.08)
    ax.set_xticks([0, 0.25, 0.5, 0.75, 1], ["0", "25", "50", "75", "100%"])
    ax.grid(axis="x", color=C["border"], lw=0.5)
    ax.set_axisbelow(True)
    ax.legend(loc="lower center", bbox_to_anchor=(0.5, 1.0), ncol=3, fontsize=6, handlelength=1)
    return to_svg(fig, "compare")


def qr_svg(url: str) -> str:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    m = qr.get_matrix()
    path = "".join(f"M{x},{y}h1v1h-1z" for y, row in enumerate(m) for x, v in enumerate(row) if v)
    n = len(m)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" shape-rendering="crispEdges">'
            f'<rect width="{n}" height="{n}" fill="#ffffff"/><path d="{path}" fill="{C["text"]}"/></svg>')


# ----------------------------------------------------------------------------- HTML sections

def section(kicker: str, title: str, body: str) -> str:
    return f'<section class="chapter"><div class="kicker">{kicker}</div><h1>{title}</h1>{body}</section>'


LOGO = ('<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="white" stroke-width="2.2" '
        'stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l2-5 4 10 2-5h8"/></svg>')


def cover(ctx: dict) -> str:
    tags = "".join(f'<span class="tag">{t}</span>' for t in
                   ("MIT-BIH Arrhythmia Database", "ANSI/AAMI EC57", "Inter-patient DS1 / DS2",
                    "Built with orchestrated AI agents"))
    if ctx["preliminary"]:
        tags += '<span class="tag prelim">Preliminary results</span>'
    host = LIVE_URL.split("//", 1)[1].rstrip("/")
    return f"""
<div class="cover">
  <div class="strip">{ctx['fig_cover']}</div>
  <div class="inner">
    <div class="brand"><span class="logo">{LOGO}</span>ECG Arrhythmia · project report</div>
    <div class="tags">{tags}</div>
    <h1>Arrhythmia detection in the ECG&nbsp;— from raw signal to beat class</h1>
    <p class="subtitle">A complete, reproducible pipeline that sorts every heartbeat of a long-term ECG into the
    five AAMI classes, with a compact 1D convolutional network, an interpretable decision tree and an honest
    inter-patient evaluation on patients the models have never seen.</p>
    <div class="meta">
      <div><div class="k">Author</div><div class="v">{AUTHOR}</div></div>
      <div><div class="k">Date</div><div class="v">{ctx['date']}</div></div>
      <div><div class="k">Interactive version</div><div class="v">{host}</div></div>
    </div>
    <div class="shot"><div class="bar"><i></i><i></i><i></i><span>{host}</span></div>
      <img src="../img/live-overview-en.jpg" alt="Start page of the interactive web version"></div>
  </div>
</div>"""


def summary_page(ctx: dict) -> str:
    cnn = ctx["cnn"]
    pc = cnn["per_class"]
    n_share = ctx["n_share_test"]

    def tile(c):
        return f"""<div class="kpi" style="--kc:{C['cls-' + c]}">
  <div class="label">{cls(c)} {CLASS_NAMES[c].replace(' ectopic', '')} beats</div>
  <div class="values"><div><div class="v num">{pct(pc[c]['sensitivity'])}</div><div class="k">sensitivity</div></div>
  <div><div class="v num">{pct(pc[c]['ppv'])}</div><div class="k">PPV</div></div></div>
  <div class="note">{pc[c]['support']:,} {c} beats in the test set</div></div>"""

    macro = f"""<div class="kpi">
  <div class="label">Macro-F1</div>
  <div class="values"><div><div class="v num">{dec(cnn['macro_f1_nsvf'])}</div><div class="k">N, S, V, F</div></div>
  <div><div class="v num">{dec(cnn['macro_f1'])}</div><div class="k">all five classes</div></div></div>
  <div class="note">Accuracy {pct(cnn['accuracy'])} is only a side note: answering “normal” every time
  would already reach {pct(n_share)}.</div></div>"""
    dc = DE_CHAZAL
    prelim = (f"<li><strong>Preliminary version:</strong> the metrics come from a development run "
              f"(<code>metrics.json</code> of {ctx['metrics_date']}) before the final, one-time evaluation on DS2 and "
              "will be replaced by the final results.</li>" if ctx["preliminary"] else "")
    body = f"""
<p class="lead">Every heartbeat of an ECG recording is assigned to one of the five classes of the ANSI/AAMI EC57
standard. The beats that matter clinically — premature beats from the atria (S) or from the ventricles (V) — are
rare: {pct(n_share)} of all test beats are normal. This project builds the complete chain from the raw signal to
the class and evaluates it the strict way, on the records of {ctx['n_test_records']} patients that the models never
saw during development.</p>
<div class="cols-3">
  <div class="card"><h3>Problem</h3><p>Ectopic beats are clinically relevant but hidden among thousands of normal
  beats. Many published results mix beats of the same patient into training and test data, which inflates the
  scores far beyond what a new patient would see.</p></div>
  <div class="card"><h3>Approach</h3><p>MIT-BIH Arrhythmia Database, split inter-patient into DS1 (training) and
  DS2 (test) after de Chazal et al. (2004). Filtering, Pan-Tompkins R-peak detection, one window per beat plus RR
  intervals; a compact 1D CNN ({ctx['params']:,} parameters) and an interpretable decision tree.</p></div>
  <div class="card"><h3>Built with AI agents</h3><p>A coordinating “mother agent” split the work into
  {ctx['n_modules']} modules for up to {ctx['max_agents']} parallel sub-agents, held together by binding interface
  contracts and a lock-safe status protocol. Goals, rules and final checks stayed with the human.</p></div>
</div>
<h2>Key result: 1D CNN on the unseen test patients (DS2)</h2>
<div class="kpis">{tile('S')}{tile('V')}{macro}</div>
<p><strong>Sensitivity</strong> is the share of the true beats of a class that the model found; the
<strong>positive predictive value (PPV)</strong> is the share of the model's alarms for that class that were right.
For orientation: de Chazal et al. (2004) reported Se {pct(dc['S']['sensitivity'])} / PPV {pct(dc['S']['ppv'])} for
S and Se {pct(dc['V']['sensitivity'])} / PPV {pct(dc['V']['ppv'])} for V on the same split (details in chapter 5).
The interpretable decision tree reaches a macro-F1 of {dec(ctx['tree']['macro_f1_nsvf'])} (N, S, V, F).</p>
<div class="callout warn"><div class="callout-title">Read with care</div><ul>{prelim}
<li>{ctx['ds2_history_short']}</li>
<li>{ctx['fq_sentence']}</li>
<li>This is a research and portfolio project, not a medical device; it must not be used for diagnosis.</li>
</ul></div>
<p class="small muted">Interactive version with all steps and live charts: <a href="{LIVE_URL}">{LIVE_URL}</a> ·
Code: <a href="{REPO_URL}">{REPO_URL}</a></p>"""
    return section("Summary", "Finding the rare beats that matter", body)


def background_page(ctx: dict) -> str:
    rows = [("N", "Normal and bundle branch block beats", "N, L, R, e, j", "regular timing, normal shape"),
            ("S", "Supraventricular ectopic (from the atria)", "A, a, J, S", "too early; shape often almost normal"),
            ("V", "Ventricular ectopic (from the ventricles)", "V, E", "wide, deformed QRS; pause afterwards"),
            ("F", "Fusion of a normal and a ventricular beat", "F", "shape in between N and V"),
            ("Q", "Paced and unclassifiable beats", "/, f, Q", "almost absent without paced records")]
    table = "".join(f"<tr><td>{cls(c)}</td><td>{a}</td><td style='white-space:nowrap'><code>{b}</code></td>"
                    f"<td>{d}</td></tr>" for c, a, b, d in rows)
    pal = ["#0d9488", "#6366f1", "#d97706", "#64748b", "#e11d48", "#059669"]

    def dots(idx):
        return "".join(f'<span class="dot" style="background:{pal[i]}"></span>' for i in idx)

    body = f"""
<div class="cols wide-left">
<div>
<h2 style="margin-top:0">The ECG in one minute</h2>
<p>The heart is a muscle that contracts about once per second, each time triggered by an electrical impulse from
the <strong>sinus node</strong>, its built-in pacemaker. Electrodes on the skin pick up this activity; the voltage
over time is the <strong>electrocardiogram (ECG)</strong>.</p>
<p>A normal beat has a typical shape: the small <strong>P wave</strong> (the atria contract), the sharp
<strong>QRS complex</strong> (the large ventricles contract) with its tallest spike, the <strong>R peak</strong>, and
the broader <strong>T wave</strong> (the ventricles recover). The time between two R peaks is the
<strong>RR interval</strong> — at 60 beats per minute exactly one second.</p>
<p>An <strong>arrhythmia</strong> is a disturbance of this rhythm: a beat comes too early, from the wrong place or
with the wrong shape. Many are harmless, some are dangerous.</p>
</div>
{figure(ctx['fig_anatomy'], f"<b>Figure 1.</b> Three normal beats from MIT-BIH record {ctx['record']} (filtered), with "
        "the waves of the middle beat and one RR interval marked.")}
</div>
<h2>Five beat classes (ANSI/AAMI EC57)</h2>
<p>The MIT-BIH annotations distinguish more than a dozen beat types. To make results comparable, the
<strong>ANSI/AAMI EC57</strong> standard groups them into five classes (annotations that do not mark a beat are
ignored). S and V carry most of the clinical value — frequent supraventricular ectopic beats can precede atrial
fibrillation, frequent or coupled ventricular ones point to structural heart disease — and they are also the rare
ones, which makes them hard for algorithms.</p>
<table class="avoid"><thead><tr><th>Class</th><th>Meaning</th><th>MIT-BIH symbols</th><th>Typical cue</th></tr></thead>
<tbody>{table}</tbody></table>
<h2>Why inter-patient instead of intra-patient</h2>
<p>Beats from the same person look very much alike. If all beats are shuffled and split at random
(<em>intra-patient</em>), the test set contains near-copies of beats the model already knows: it learns “what does
patient X look like” instead of “what does a ventricular beat look like”. Many published accuracies around 99%
rest on such splits — but a new patient is, by definition, unseen. This project therefore follows the
<strong>inter-patient</strong> protocol of de Chazal et al. (2004): two disjoint sets of 22 records, DS1 for
everything during development and DS2 only for testing.</p>
<div class="split-demo">
  <div class="card"><b>Intra-patient</b>
    <div class="row"><span class="lab">train</span>{dots([0, 1, 2, 0, 1, 2, 0, 1])}</div>
    <div class="row"><span class="lab">test</span>{dots([2, 0, 1])}</div>
    <div class="verdict"><span class="bad">Same patients (colors) in both</span> — the model recognizes people,
    the score is inflated.</div></div>
  <div class="card"><b>Inter-patient</b>
    <div class="row"><span class="lab">train</span>{dots([0, 1, 2, 0, 1, 2, 0, 1])}</div>
    <div class="row"><span class="lab">test</span>{dots([3, 4, 5])}</div>
    <div class="verdict"><span class="good">Unseen patients</span> — a realistic estimate for a new
    person.</div></div>
</div>"""
    return section("1 · Background", "What the ECG shows — and why evaluation is tricky", body)


def data_page(ctx: dict) -> str:
    st = ctx["stats"]
    per = st["per_split"]
    tot = {s: sum(per[s].values()) for s in ("DS1", "DS2")}
    rows = "".join(
        f"<tr><td>{cls(c)} {CLASS_NAMES[c]}</td>"
        + "".join(f'<td class="r">{per[s].get(c, 0):,}</td><td class="r muted">{per[s].get(c, 0) / tot[s] * 100:.1f}%</td>'
                  for s in ("DS1", "DS2")) + "</tr>" for c in CLASSES)
    rows += ("<tr class='total'><td>Total</td>"
             + "".join(f'<td class="r">{tot[s]:,}</td><td></td>' for s in ("DS1", "DS2")) + "</tr>")
    recs = st["records"]
    body = f"""
<div class="cols">
<div>
<p>The <strong>MIT-BIH Arrhythmia Database</strong> (Moody &amp; Mark, 2001; distributed by PhysioNet) is the
reference dataset of arrhythmia research: 48 half-hour excerpts of two-channel ambulatory ECGs from 47 subjects,
recorded at Beth Israel Hospital in Boston, sampled at {ctx['fs']} Hz with 11-bit resolution. At least two
cardiologists annotated every single beat independently; disagreements were resolved by consensus. The project
uses lead <code>MLII</code>, in which the R peaks are particularly clear.</p>
<ul>
<li><strong>Excluded:</strong> the four records with a pacemaker (102, 104, 107, 217), as recommended by AAMI —
paced beats have their own shape. {st.get('records_available', len(recs['DS1']) + len(recs['DS2']))} records
remain.</li>
<li><strong>Same person:</strong> records 201 and 202 come from the same subject but sit in different sets — a known,
small imprecision of the standard split, accepted for comparability with the literature.</li>
</ul>
</div>
{figure(ctx['fig_classes'], "<b>Figure 2.</b> Beats per class and split (dataset_stats.json). The axis is logarithmic: "
        "N outnumbers S, F and Q by two to four orders of magnitude.")}
</div>
<div class="cols">
<div class="card"><h3>DS1 · training and validation · {len(recs['DS1'])} records</h3>
<p class="small mono">{', '.join(recs['DS1'])}</p></div>
<div class="card"><h3>DS2 · test only · {len(recs['DS2'])} records</h3>
<p class="small mono">{', '.join(recs['DS2'])}</p></div>
</div>
<h2>Class distribution</h2>
<table class="avoid"><thead><tr><th>Class</th><th class="r">DS1 beats</th><th class="r">share</th>
<th class="r">DS2 beats</th><th class="r">share</th></tr></thead><tbody>{rows}</tbody></table>
<div class="callout"><div class="callout-title">Why this matters later</div>
<p>N makes up {per['DS1']['N'] / tot['DS1'] * 100:.1f}% of DS1 and {per['DS2']['N'] / tot['DS2'] * 100:.1f}% of DS2.
DS1 contains only {per['DS1'].get('F', 0):,} fusion (F) beats — about 90% of them from a single record, 208 — and
{per['DS1'].get('Q', 0)} Q beats. Classes this small and this concentrated can hardly be learned in a way that
transfers to new patients, and every metric on them is very noisy.</p></div>"""
    n_avail = st.get("records_available", len(recs["DS1"]) + len(recs["DS2"]))
    return section("2 · Data", f"MIT-BIH: {n_avail} usable records, {len(recs['DS1'])} + {len(recs['DS2'])} for a "
                   "fair test", body)


def pipeline_pages(ctx: dict) -> str:
    sig, det = ctx["signal"], ctx["signal"]["detection"]
    rr = ctx["rr_info"]
    flow_nodes = [("Raw ECG", f"lead MLII, {ctx['fs']} Hz"), ("Baseline removal", "median 200 + 600 ms"),
                  ("Band-pass", "0.5–40 Hz, zero-phase"), ("R-peak detection", "Pan-Tompkins"),
                  ("Beat window", f"{ctx['seg']['length']} samples + 4 RR features"),
                  ("Models", "1D CNN · decision tree"), ("Class", "N · S · V · F · Q")]
    flow = '<div class="arrow"></div>'.join(
        f'<div class="node{" hl" if i in (5,) else ""}"><b>{a}</b>{b}</div>' for i, (a, b) in enumerate(flow_nodes))
    seg = ctx["seg"]
    pre_ms, post_ms = seg["pre_ms"], seg["post_ms"]
    body = f"""
<p class="lead">Seven stations turn a half-hour recording into one class label per heartbeat. All signal figures in
this chapter show real data from MIT-BIH record {sig['record']} (part of the test set DS2; used here only for
illustration, never for training).</p>
<div class="flow">{flow}</div>

<h2><span class="step-no">3.1</span>Filtering without shifting the beats</h2>
<p>A real ECG is never clean. <strong>Baseline wander</strong> — a slow drift caused mainly by breathing and
electrode movement — lies well below 1 Hz; <strong>power-line interference</strong> sits at 60 Hz in this US
database; <strong>muscle noise</strong> is broadband and fast. The information that matters for beat
classification lies roughly between 0.5 and 40 Hz.</p>
{figure(ctx['fig_raw'], f"<b>Figure 3.</b> A 10-second excerpt of record {sig['record']} before and after filtering. "
        "Letters above the beats are the cardiologists' classes; triangles mark the R peaks found by the detector.")}
<div class="cols wide-left">
<div>
<p><strong>Stage 1 – baseline removal</strong> (after de Chazal et al., 2004): a 200 ms median filter removes QRS
complexes and P waves, a second one with 600 ms also removes the T waves; the remaining baseline estimate is
subtracted. Median filters are robust against the steep QRS spikes and do not smear them like a moving average.</p>
<p><strong>Stage 2 – band-pass {ctx['filter']['low']:g}–{ctx['filter']['high']:g} Hz:</strong> a Butterworth filter of
order {ctx['filter']['order']} removes the remaining drift, muscle noise and mains hum. Filtering forward and backward
(<code>sosfiltfilt</code>) cancels the phase shift, so the R peak stays exactly in place — important because the next
steps cut fixed windows around it.</p>
</div>
{figure(ctx['fig_filter'], "<b>Figure 4.</b> Frequency response of the band-pass (filter_response.json). "
        "Filtering forward and backward doubles the attenuation outside the passband.")}
</div>

<h2><span class="step-no">3.2</span>Finding every beat: Pan-Tompkins R-peak detection</h2>
<p>Before beats can be classified, each one has to be found. The classic algorithm of <strong>Pan &amp; Tompkins
(1985)</strong> turns the ECG into a signal in which every QRS complex becomes one clear bump: a 5–15 Hz band-pass
emphasizes the QRS and suppresses P and T waves, the derivative highlights steep slopes, squaring makes everything
positive and amplifies large slopes, and a 150 ms moving-window integration smooths this into an envelope about as
wide as a QRS complex. Adaptive thresholds then decide what is a beat, with a 200 ms refractory period, a T-wave
check and a search-back when a beat seems to be missing.</p>
{figure(ctx['fig_pt'], f"<b>Figure 5.</b> The intermediate stages of the detector on the same excerpt "
        "(each row scaled to its maximum).")}
<div class="callout"><p><strong>Check on record {sig['record']}:</strong> {det['tp']:,} of {det['n_reference']:,}
annotated beats found, {det['fp']} false detections (tolerance ±{det['tol_ms']:g} ms) — a single, rather clean record,
not a database benchmark. {ctx['peaks_sentence']}</p></div>

<h2><span class="step-no">3.3</span>One window per beat</h2>
<p>Around every R peak, a window from <strong>{pre_ms} ms before</strong> to <strong>{post_ms} ms after</strong> the peak is
cut out — {seg['length']} samples at {seg['fs']} Hz, R always at the same index. The asymmetric window contains the P wave
before the QRS and the longer T wave after it; both carry diagnostic information. Each window gets its class from the
cardiologists' annotation and is scaled to mean 0 and standard deviation 1, so the model learns the <em>shape</em>
rather than the amplitude, which varies with electrode position and body build.</p>
{figure(ctx['fig_beats'], f"<b>Figure 6.</b> Real beat windows from record {seg['record']} (segmentation_demo.json), "
        "before z-normalization. The V beat is wide and deformed; the S beats look almost normal. "
        + ctx['absent_classes_sentence'])}

<h2><span class="step-no">3.4</span>Rhythm context: the timing gives an early beat away</h2>
<p>A window shows the shape but not the timing. Four RR features add it: <code>pre_rr</code> (to the previous
beat), <code>post_rr</code> (to the next), <code>local_rr</code> (mean of the last up to ten intervals) and the ratio
<code>pre_rr / local_rr</code>. Ectopic beats come <em>early</em>, so the ratio drops well below 1, and a ventricular
beat is often followed by a compensatory pause. For S beats, whose shape is often nearly normal, prematurity is
frequently the decisive cue; the ratio also keeps it comparable between people with different heart rates.</p>
{figure(ctx['fig_rr'], f"<b>Figure 7.</b> RR intervals around the {rr['cls']} beat of the excerpt: pre-RR "
        f"{rr['pre']:.2f} s against a local rhythm of about {rr['local']:.2f} s (ratio ≈ {rr['pre'] / rr['local']:.2f}), "
        f"followed by a {rr['post']:.2f} s pause.")}
"""
    return section("3 · Pipeline", "From raw signal to beat: the pipeline step by step", body)


def models_pages(ctx: dict) -> str:
    m, arch = ctx["metrics"], ctx["arch"]
    cfg = m.get("config", {})
    groups: dict[str, dict] = {}
    for layer in arch["layers"]:
        name = layer["name"]
        mm_ = re.match(r"features\.(conv|bn|relu|pool)(\d+)$", name)
        key = (f"Conv block {mm_.group(2)}" if mm_ else
               "Global average pooling" if name in ("features.gap", "features.flatten") else
               "RR branch" if name.startswith("rr_branch") else
               "Dense layer + dropout" if name in ("head.fc1", "head.relu", "head.dropout") else
               {"input": "Beat window (input)", "rr_input": "RR features (input)", "concat": "Concatenate",
                "head.fc2": "Output layer"}.get(name, name))
        g = groups.setdefault(key, {"types": [], "shape": None, "params": 0})
        g["types"].append(layer["type"])
        g["shape"] = layer["output_shape"][1:]
        g["params"] += layer["params"]
    trs = "".join(f"<tr><td>{k}</td><td class='muted'>{' · '.join(dict.fromkeys(g['types']))}</td>"
                  f"<td class='r mono'>{' × '.join(map(str, g['shape']))}</td><td class='r'>{g['params']:,}</td></tr>"
                  for k, g in groups.items())
    trs += f"<tr class='total'><td>Total</td><td></td><td></td><td class='r'>{arch['total_params']:,}</td></tr>"
    cnn = m["cnn"]
    val_recs = ", ".join(m.get("records", {}).get("val", []))
    t = m["tree"]
    feats = "".join(f"<li><code>{f}</code> — {TREE_FEATURES.get(f, (f, '', ''))[2]}</li>" for f in t.get("features", []))
    cap = ctx["weight_cap"]
    hist = cnn.get("history")
    training_fig = figure(ctx["fig_history"], "<b>Figure 9.</b> Training history (metrics.json). The dotted line "
                          "marks the epoch whose weights were kept.") if hist else ""
    train_time = (f", and the whole training run took about {m['train_seconds'] / 60:.1f} minutes on a CPU"
                  if "train_seconds" in m else "")
    epochs_sentence = (f"In the run reported here, training stopped after {cnn['epochs_run']} epochs and the weights of "
                       f"epoch {cnn['best_epoch']} were kept." if "epochs_run" in cnn and "best_epoch" in cnn else "")
    body = f"""
<h2 style="margin-top:0">4.1 A compact 1D convolutional network</h2>
<p>A <strong>1D convolutional neural network</strong> slides small learned filters across the beat window. Each filter
is a pattern detector that responds where the signal resembles its shape — a steep slope, a wide QRS, an inverted
wave. Unlike the features of the decision tree, these patterns are not defined by hand but learned from the data.
Three convolution blocks (convolution, batch normalization, ReLU, max-pooling) halve the time resolution step by
step, so deeper layers see larger parts of the beat. A global average then condenses each channel into one number.
In parallel, the four RR features pass through a small dense layer. Both branches are concatenated and mapped by a
small classification head to one score per AAMI class — the network judges <em>shape and timing together</em>.
With {arch['total_params']:,} trainable parameters it is deliberately small, leaving little room to memorize the
{len(m.get('records', {}).get('train', [])) or ''} training records{train_time}.</p>
{figure(ctx['fig_cnn'], f"<b>Figure 8.</b> ECGNet1D as drawn from architecture.json: the time axis shrinks from "
        f"{arch['input']['beat_len']} samples while the number of learned channels grows (k = kernel size); the RR branch "
        "joins before the classification head.")}
<table class="avoid layers"><thead><tr><th>Stage</th><th>Layers</th><th class="r">Output shape</th>
<th class="r">Parameters</th></tr></thead><tbody>{trs}</tbody></table>

<h2>4.2 Training against the imbalance</h2>
<div class="cols wide-left">
<div>
<p><strong>Weighted loss.</strong> The cross-entropy loss weights every class inversely to its frequency in the
training data{f', capped at {cap}× the weight of the most common class' if cap else ''}. A missed S beat therefore costs
much more than a missed N beat; without this, the network would largely ignore the rare classes.</p>
<p><strong>Optimizer.</strong> Adam with learning rate {cfg.get('lr', '')}, mini-batches of {cfg.get('batch_size', '')} beats,
up to {cfg.get('epochs', '')} epochs, fixed random seed {cfg.get('seed', '')} for reproducibility.</p>
<p><strong>Validation inside DS1 only.</strong> Records {val_recs} of DS1 are held out for early stopping (patience
{cfg.get('patience', '')} epochs). DS2 is used neither for choosing settings nor for the stopping point — otherwise
test information would leak into the model. Records that hold a large share of a rare class stay in training: record
208 alone holds about 90% of all DS1 fusion beats. {epochs_sentence}</p>
</div>
{training_fig}
</div>

<h2>4.3 An interpretable decision tree for comparison</h2>
<p>The second model is a decision tree of depth {t.get('depth', cfg.get('max_depth', ''))} with {t.get('n_leaves', '')} leaves,
trained on {t.get('trained_on_beats', 0):,} DS1 beats with balanced class weights. Instead of raw samples it receives
{len(t.get('features', []))} hand-crafted features that a cardiologist would recognize. Every path from the root to a leaf
is a readable if-then rule — the price is far less expressive power than the CNN.</p>
{figure(ctx['fig_tree'], "<b>Figure 10.</b> The learned tree (tree.json). Each box tests one feature; the left branch is "
        "taken when the condition holds. Colored bars and leaves show the class the tree would predict (with balanced "
        "class weights); numbers are training beats reaching the node. Amplitudes are in units of the normalized beat.")}
<ul class="small" style="columns: 2; column-gap: 8mm">{feats}</ul>
"""
    return section("4 · Models", "Two models: a compact CNN and an interpretable tree", body)


def results_pages(ctx: dict) -> str:
    m = ctx["metrics"]
    cnn, tree = m["cnn"]["summary"], m["tree"]["summary"]
    rows = ""
    for c in CLASSES:
        a, b = cnn["per_class"][c], tree["per_class"][c]
        cells = ""
        for k in ("sensitivity", "ppv", "f1"):
            va, vb = val(a[k]), val(b[k])
            fa = pct(a[k]) if k != "f1" else dec(a[k])
            fb = pct(b[k]) if k != "f1" else dec(b[k])
            cells_a = f'<td class="r{" best" if va > vb else ""}">{fa}</td>'
            cells_b = f'<td class="r{" best" if vb > va else ""}">{fb}</td>'
            cells += cells_a + cells_b
        rows += f"<tr><td>{cls(c)}</td><td class='r muted'>{a['support']:,}</td>{cells}</tr>"
    rows += (f"<tr class='total'><td colspan='2'>Macro-F1 (N, S, V, F)</td><td colspan='4'></td>"
             f"<td class='r'>{dec(cnn['macro_f1_nsvf'])}</td><td class='r'>{dec(tree['macro_f1_nsvf'])}</td></tr>"
             f"<tr class='sub'><td colspan='2'>Macro-F1 (all five)</td><td colspan='4'></td>"
             f"<td class='r'>{dec(cnn['macro_f1'])}</td><td class='r'>{dec(tree['macro_f1'])}</td></tr>"
             f"<tr class='sub'><td colspan='2'>Accuracy (supplementary)</td><td colspan='4'></td>"
             f"<td class='r'>{pct(cnn['accuracy'])}</td><td class='r'>{pct(tree['accuracy'])}</td></tr>")

    # Largest confusions of the CNN, straight from the matrix.
    cm = np.asarray(cnn["confusion"])
    names = cnn.get("class_names", CLASSES)
    off = sorted(((cm[i, j], i, j) for i in range(len(names)) for j in range(len(names)) if i != j), reverse=True)[:3]
    conf_items = "".join(f"<li>{int(n):,} true {cls(names[i])} beats predicted as {cls(names[j])} "
                         f"({n / cm[i].sum() * 100:.1f}% of all {names[i]} beats)</li>" for n, i, j in off if n > 0)

    gross_cnn = m["cnn"].get("gross_statistics", {}).get("gross")
    gross_tree = m["tree"].get("gross_statistics", {}).get("gross")
    src_cnn = gross_cnn or cnn["per_class"]
    src_tree = gross_tree or tree["per_class"]

    def fpr(st):
        return st["fp"] / (st["fp"] + st["tn"]) if {"fp", "tn"} <= st.keys() and st["fp"] + st["tn"] else None

    cmp_rows = ""
    for c in ("S", "V"):
        for label, st in (("1D CNN (this project)", src_cnn[c]), ("Decision tree (this project)", src_tree[c]),
                          ("de Chazal et al. 2004", DE_CHAZAL[c])):
            f = st.get("fpr", fpr(st))
            cmp_rows += (f"<tr><td>{cls(c)}</td><td>{label}</td><td class='r'>{pct(st['sensitivity'])}</td>"
                         f"<td class='r'>{pct(st['ppv'])}</td><td class='r'>{pct(f) if f is not None else '–'}</td></tr>")
    conventions = m["cnn"].get("gross_statistics", {}).get("conventions", [])
    veb_rule = next((x for x in conventions if x.startswith("VEB")), "")
    stats_note = ("Values for this project are gross statistics (all test beats pooled), as in the paper"
                  + (f"; {escape(veb_rule)}" if veb_rule else "") + "." if gross_cnn else
                  "Values for this project are pooled over all test beats.")
    cv_html = cv_section(m.get("cv"))
    body = f"""
<p class="lead">All numbers in this chapter come from <code>metrics.json</code> (generated {ctx['metrics_date']}):
both models evaluated on the {ctx['n_test_records']} test records of DS2 — {cnn['n']:,} beats from patients the models
never saw.</p>
<div class="cols-3 small">
<div class="card"><b>Sensitivity (Se)</b> = TP / (TP + FN): how many of the true beats of a class were found.</div>
<div class="card"><b>Positive predictive value (PPV, +P)</b> = TP / (TP + FP): how many of the model's alarms for a class
were right. <b>FPR</b> = FP / (FP + TN): false alarms among all other beats.</div>
<div class="card"><b>F1</b>: harmonic mean of Se and PPV, high only if both are high. <b>Macro-F1</b> averages F1 over
classes, so rare classes count as much as N.</div>
</div>
<h2>Per-class results on DS2</h2>
<table class="avoid"><thead>
<tr><th rowspan="2">Class</th><th rowspan="2" class="r">Test beats</th><th colspan="2" class="grp">Sensitivity</th>
<th colspan="2" class="grp">PPV</th><th colspan="2" class="grp">F1</th></tr>
<tr><th class="r">CNN</th><th class="r">Tree</th><th class="r">CNN</th><th class="r">Tree</th><th class="r">CNN</th>
<th class="r">Tree</th></tr></thead><tbody>{rows}</tbody></table>
<p class="small muted" style="margin-top:1.5mm">The better of the two models is set in bold. Accuracy is listed
only for completeness: with {pct(ctx['n_share_test'])} normal beats it mostly measures the majority class.</p>
{figure(ctx['fig_confusion'], "<b>Figure 11.</b> Confusion matrices on DS2: rows are the cardiologists' classes, columns "
        "the predictions; each row is colored by the share of its beats (percentages below the counts).")}
<div class="cols avoid">
<div><h3>Reading the CNN's matrix</h3><p>The three largest confusions are:</p><ul>{conf_items}</ul>
<p>{ctx['tree_vs_cnn_sentence']}</p></div>
<div><h3>Where the errors come from</h3><p>{ctx['error_story']}</p></div>
</div>

<h2>Comparison with the literature baseline</h2>
<div class="cols wide-left">
<div>
<p>De Chazal, O'Dwyer &amp; Reilly (2004) introduced the DS1/DS2 protocol and reported, for their selected
configuration on DS2, the values below (from the paper's abstract). It is the natural reference because it uses the
same split{' and the same reference beat positions' if ctx['reference_peaks'] else ''}. A difference to keep in mind:
their linear-discriminant classifier used hand-crafted morphology and interval features from <em>both</em> ECG
leads, whereas this project uses one lead.</p>
<table class="avoid"><thead><tr><th>Class</th><th>Model</th><th class="r">Se</th><th class="r">+P</th>
<th class="r">FPR</th></tr></thead><tbody>{cmp_rows}</tbody></table>
<p class="small muted" style="margin-top:1.5mm">{stats_note}</p>
</div>
{figure(ctx['fig_compare'], "<b>Figure 12.</b> Sensitivity (Se) and positive predictivity (+P) for S and V beats, in percent.")}
</div>
{cv_html}
"""
    return section("5 · Evaluation", "Results on unseen patients (DS2)", body)


def cv_section(cv) -> str:
    """Optional: record-grouped cross-validation on DS1, if metrics.json carries it (one report or {name: report})."""
    if not isinstance(cv, dict):
        return ""
    reports = {cv.get("features", "CNN"): cv} if "aggregate" in cv else {k: v for k, v in cv.items()
                                                                          if isinstance(v, dict) and "aggregate" in v}
    if not reports:
        return ""
    rows = ""
    for name, r in reports.items():
        a = r["aggregate"]
        pcs = a.get("per_class", {})
        rows += (f"<tr><td>{escape(str(name))}</td><td class='r'>{dec(a['macro_f1_nsvf'], 3)}</td>"
                 + "".join(f"<td class='r'>{dec(pcs[c]['f1']) if c in pcs else '–'}</td>" for c in ("N", "S", "V"))
                 + "</tr>")
    first = next(iter(reports.values()))
    cfg = first.get("config", {})
    return f"""
<h2>Cross-validation on DS1</h2>
<p>Design decisions were made without touching DS2: record-grouped {cfg.get('k', '')}-fold cross-validation inside DS1,
repeated with {len(cfg.get('seeds', [])) or 'several'} random seeds (mean ± standard deviation over seeds).</p>
<table class="avoid"><thead><tr><th>Variant</th><th class="r">Macro-F1 (N, S, V, F)</th><th class="r">F1 N</th>
<th class="r">F1 S</th><th class="r">F1 V</th></tr></thead><tbody>{rows}</tbody></table>"""


def limitations_page(ctx: dict) -> str:
    st = ctx["stats"]["per_split"]
    body = f"""
<p class="lead">A result is only as useful as its honest limits. These are the ones that matter most here.</p>
<div class="card" style="margin-bottom:3.5mm"><h3>The test set was looked at more than once</h3>
<p>{ctx['ds2_history_long']}</p></div>
<div class="cols-3 lim">
<div class="card"><h3>F and Q are practically not learnable here</h3>
<p>DS1 contains {st['DS1'].get('F', 0):,} fusion beats, about 90% of them from one patient (record 208), and only
{st['DS1'].get('Q', 0)} Q beats; DS2 has {st['DS2'].get('Q', 0)} Q beats. {ctx['fq_detail']}</p></div>
<div class="card"><h3>Supraventricular beats (S)</h3>
<p>{ctx['s_sentence']} S beats often look like normal beats and are mainly recognized by their timing, which also
varies naturally in some patients.</p></div>
<div class="card"><h3>Reference beat positions</h3>
<p>{ctx['peaks_limit']}</p></div>
<div class="card"><h3>Small, old, single-source data</h3>
<p>44 usable records from one hospital, recorded in the late 1970s with Holter devices, one lead used. All results
in this report come from MIT-BIH; it contains no external validation on other databases or modern wearables.</p></div>
<div class="card"><h3>Run-to-run variation</h3>
<p>The reported model is a single training run (seed {ctx['metrics'].get('config', {}).get('seed', '–')}). Cross-validation
inside DS1 showed that results move noticeably with the random seed and the fold split, so differences of a few
points between variants should not be over-interpreted.</p></div>
<div class="card"><h3>Not a medical device</h3>
<p>This is a research and portfolio project. It has no clinical validation and no regulatory approval, and it must
not be used to diagnose or treat anyone.</p></div>
</div>
<h2>What was done to keep the evaluation honest</h2>
<ul>
<li>Strict inter-patient split; no record in both DS1 and DS2 (the only shared person, 201/202, is disclosed).</li>
<li>Per-class sensitivity, PPV and F1 as the main metrics; accuracy only as a side note.</li>
<li>Model selection, early stopping and every design decision on DS1 only; a selection rule (improvement of at least
one standard deviation in cross-validation, without losing N sensitivity) was fixed <em>before</em> the experiments
and is applied even when a promising variant narrowly fails it.</li>
<li>All experiments logged with date, configuration and result in <code>docs/EXPERIMENTS.md</code>; the web interface
shows empty states instead of placeholder numbers whenever a result does not exist.</li>
</ul>"""
    return section("6 · Limitations", "Limitations and honest methodology", body)


def build_page(ctx: dict) -> str:
    lib = ctx["metrics"].get("config", {}).get("library_versions", {})
    libs = ", ".join(f"{k} {v}" for k, v in lib.items())
    n_tests = ctx["n_tests"]
    tests = (f"<strong>{n_tests} automated tests</strong> (counted with <code>pytest --collect-only</code> when "
             "this report was built)") if n_tests else "an automated pytest suite"
    findings = ctx["review_findings"]
    body = f"""
<p class="lead">The project was planned and implemented with orchestrated AI agents. The point was not to let a
model “write some code”, but to run software development like a small team: clear ownership, binding contracts,
a shared status file and independent review.</p>
<div class="orch">
<div class="lane">
  <div class="box human"><b>Human (Leon Rohrer)</b> — sets the goal and the ground rules (inter-patient evaluation,
  per-class metrics, no invented numbers), approves plans and anything that touches the test set or goes public,
  reviews results and texts.</div>
  <div class="down">↓</div>
  <div class="box mother"><b>Mother agent (orchestrator)</b> — writes the master plan, cuts the work into
  {ctx['n_modules']} modules, reads <span class="mono">project_state.json</span> before every wave and starts only
  modules whose dependencies are done (at most {ctx['max_agents']} sub-agents at once).</div>
  <div class="down">↓</div>
  <div class="box"><b>Wave 1 · 13 agents in parallel on disjoint files</b>
    <div class="agents">
      <div class="box">Data pipeline · 4<br><span class="muted">loader, filters, R peaks, segmentation</span></div>
      <div class="box">ML model · 4<br><span class="muted">1D CNN, decision tree, training, evaluation</span></div>
      <div class="box">Web &amp; UI · 5<br><span class="muted">API, shell, diagrams, charts, content</span></div>
    </div></div>
  <div class="down">↓</div>
  <div class="box"><b>Wave 2 · integration</b> — end-to-end pipeline CLI, then the web UI on real data.</div>
  <div class="down">↓</div>
  <div class="box"><b>Wave 3 · independent review</b> — three reviewer agents with different angles (ML correctness and
  leakage, tests, UI, honesty of claims){f'; {findings} findings, all reproduced and fixed by a fix agent' if findings else ''}.</div>
  <div class="down">↓</div>
  <div class="box"><b>Wave 4 · full training DS1 → DS2</b> — blocked in the cloud sandbox (no access to PhysioNet),
  completed locally on Windows.</div>
</div>
<div class="side">
  <div class="box state"><b>Status protocol</b><br>Agents never edit the status file directly. They report through
  <span class="mono">scripts/state.py</span>, which locks the file:<br>
  <span class="mono">start</span> · <span class="mono">done</span> (summary, decisions, files, tests) ·
  <span class="mono">fail</span> (log excerpt → corrected restart) · <span class="mono">log</span> (deviation
  from a contract)</div>
  <div class="box"><b>Interface contracts</b><br><span class="mono">INTERFACES.md</span> fixes every function
  signature and data format up front, so modules can be built in parallel against each other.</div>
  <div class="box"><b>Ownership</b><br>Each module owns its files exclusively; nobody edits another agent's files.</div>
  <div class="box"><b>Tests</b><br>Every module ships with its own tests{f'; the suite now has {n_tests} tests' if n_tests else ''}.
  Agents report test commands and results with <span class="mono">done</span>.</div>
</div>
</div>
<h2>Why this is more than a gimmick</h2>
<p>Parallel agents only work if the problem is decomposed well. The contracts in <code>INTERFACES.md</code> made 13
agents productive at the same time without stepping on each other; the lock-safe status file made progress,
decisions and failures traceable; and a separate review wave caught real bugs (for example a too-narrow QRS width
measurement and uncapped class weights) before any result was published. The human role shifted from typing code to
<strong>specifying, deciding and verifying</strong> — the skills that matter when automating real work.</p>
<h2>Tech stack</h2>
<table class="avoid"><tbody>
<tr><td style="width:34mm"><b>Signal &amp; ML</b></td><td>Python · NumPy, SciPy, wfdb, PyTorch, scikit-learn{f' <span class="muted">({escape(libs)})</span>' if libs else ''}</td></tr>
<tr><td><b>Pipeline &amp; API</b></td><td>command-line pipeline (<code>python -m ekg.pipeline</code>), FastAPI server, Makefile</td></tr>
<tr><td><b>Web interface</b></td><td>Vite, Tailwind CSS v4, Mermaid diagrams, hand-written SVG charts; German and English; hosted at leonrohrer.at</td></tr>
<tr><td><b>Quality</b></td><td>{tests}; browser checks of the UI with Playwright; reproducible versions in <code>constraints.txt</code></td></tr>
<tr><td><b>This report</b></td><td>generated by <code>docs/report/build_report.py</code> from the same JSON exports (matplotlib, HTML/CSS, Chromium)</td></tr>
</tbody></table>"""
    return section("7 · Process", "How it was built: orchestrated AI agents", body)


def final_page(ctx: dict) -> str:
    host = LIVE_URL.split("//", 1)[1]
    repo = REPO_URL.split("//", 1)[1]
    return f"""
<section class="final">
<div class="kicker">Explore it yourself</div>
<h1>Every step, interactive</h1>
<p class="muted" style="max-width:130mm;margin:0 auto">The web version shows the pipeline with live charts on real
data, the rhythm player, both models and the agent status — in English and German.</p>
<div class="qr">{ctx['qr']}</div>
<div class="url"><a href="{LIVE_URL}">{host}</a></div>
<div class="links">
<span class="k">Live page</span><a href="{LIVE_URL}">{LIVE_URL}</a>
<span class="k">Source code</span><a href="{REPO_URL}">{repo}</a>
<span class="k">Author</span><span>{AUTHOR}</span>
</div>
<div class="refs"><b>References</b><ol>
<li>de Chazal P, O'Dwyer M, Reilly RB. Automatic classification of heartbeats using ECG morphology and heartbeat interval
features. <i>IEEE Transactions on Biomedical Engineering</i> 51(7):1196–1206, 2004.</li>
<li>Moody GB, Mark RG. The impact of the MIT-BIH Arrhythmia Database. <i>IEEE Engineering in Medicine and Biology</i>
20(3):45–50, 2001.</li>
<li>Goldberger AL et al. PhysioBank, PhysioToolkit, and PhysioNet: components of a new research resource for complex
physiologic signals. <i>Circulation</i> 101(23):e215–e220, 2000.</li>
<li>Pan J, Tompkins WJ. A real-time QRS detection algorithm. <i>IEEE Transactions on Biomedical Engineering</i>
32(3):230–236, 1985.</li>
<li>ANSI/AAMI EC57: Testing and reporting performance results of cardiac rhythm and ST segment measurement
algorithms.</li>
</ol></div>
</section>"""


# ----------------------------------------------------------------------------- texts that depend on the numbers

def derived_texts(ctx: dict) -> None:
    m = ctx["metrics"]
    cnn, tree = ctx["cnn"], ctx["tree"]
    pc = cnn["per_class"]
    runs = earlier_ds2_runs()
    if runs:
        listing = "; ".join(f"run {n}: validation records {recs}, macro-F1 over five classes {f:.3f}" for n, recs, f in runs)
        ctx["ds2_history_short"] = (f"The test split DS2 was evaluated {times(len(runs))} during development "
                                    "(documented). Since then it is locked: further decisions use cross-validation on "
                                    "DS1 only, and DS2 is evaluated once for the final result.")
        ctx["ds2_history_long"] = (
            f"DS2 should ideally be evaluated exactly once. In this project it was evaluated {times(len(runs))} before "
            f"the final run ({listing}; see <code>docs/EXPERIMENTS.md</code>). Between the runs, the choice of "
            "validation records was changed: record 208 holds about 90% of all DS1 fusion beats and was moved from "
            "validation back into training. The reason was a property of DS1, but the change was made after a DS2 "
            "result was known, so a small optimistic bias cannot be ruled out. Since then the rule is strict: DS2 is "
            "locked, every decision is made by record-grouped cross-validation on DS1 with a selection criterion fixed "
            "in advance, and DS2 is evaluated once at the very end — and reported whatever the outcome.")
    else:
        ctx["ds2_history_short"] = ("DS2 is locked during development; decisions use cross-validation on DS1 only "
                                    "(see docs/EXPERIMENTS.md).")
        ctx["ds2_history_long"] = ("DS2 is locked during development; every decision is made by cross-validation on "
                                   "DS1, see <code>docs/EXPERIMENTS.md</code>.")
    f1f, f1q = val(pc["F"]["f1"]), val(pc["Q"]["f1"])
    weak = f1f < 0.1 and f1q < 0.1
    ctx["fq_sentence"] = (f"F and Q are {'practically not recognized' if weak else 'only weakly recognized'} "
                          f"(F1 {dec(pc['F']['f1'])} and {dec(pc['Q']['f1'])}): DS1 has too few and too one-sided "
                          "examples of them.")
    ctx["fq_detail"] = (f"The CNN finds {pct(pc['F']['sensitivity'])} of the {pc['F']['support']:,} F beats in DS2 "
                        f"and {pct(pc['Q']['sensitivity'])} of the Q beats; its F alarms are right in "
                        f"{pct(pc['F']['ppv'])} of cases. With so few, one-sided examples, a model cannot learn a "
                        "pattern that transfers to new patients — larger and more diverse datasets would be needed.")
    ctx["s_sentence"] = (f"The CNN finds {pct(pc['S']['sensitivity'])} of all S beats, but only {pct(pc['S']['ppv'])} "
                         "of its S alarms are correct.")
    better = "below" if val(tree["macro_f1_nsvf"]) < val(cnn["macro_f1_nsvf"]) else "above"
    ctx["tree_vs_cnn_sentence"] = (
        f"The decision tree stays clearly {better} the CNN (macro-F1 {dec(tree['macro_f1_nsvf'])} vs. "
        f"{dec(cnn['macro_f1_nsvf'])} on N, S, V, F): a handful of threshold rules on hand-made features is easy to "
        "read, but cannot capture the subtle shape differences the network learns.")
    cm = np.asarray(cnn["confusion"])
    names = cnn.get("class_names", CLASSES)
    story = []
    for c in ("S", "V", "F"):
        i = names.index(c)
        miss = max((j for j in range(len(names)) if j != i), key=lambda j: cm[i, j])
        fa = max((j for j in range(len(names)) if j != i), key=lambda j: cm[j, i])
        story.append(f"Missed {cls(c)} beats are mostly called {cls(names[miss])} ({int(cm[i, miss]):,} of "
                     f"{int(cm[i].sum() - cm[i, i]):,} misses); false {c} alarms come mostly from true "
                     f"{cls(names[fa])} beats ({int(cm[fa, i]):,} of {int(cm[:, i].sum() - cm[i, i]):,}).")
    ctx["error_story"] = " ".join(story)
    ref = m.get("config", {}).get("use_reference_peaks", True)
    ctx["peaks_sentence"] = ("For training and evaluation, the models use the cardiologists' reference beat positions, as "
                             "in de Chazal et al. (2004), so that detection errors do not mix into the classification "
                             "result." if ref else
                             "Training and evaluation in this report use the detector's beat positions (end-to-end).")
    ctx["peaks_limit"] = ("Classification is evaluated on the cardiologists' beat positions, the usual protocol for "
                          "comparability. A fully automatic system would also inherit the detector's errors, so its "
                          "results would be somewhat lower; the detector itself was only checked in detail on single "
                          "records." if ref else
                          "Classification is evaluated end-to-end on detected beat positions.")
    seg = ctx["seg"]
    absent = [c for c in CLASSES if seg["counts"].get(c, 0) == 0]
    ctx["absent_classes_sentence"] = (f"Classes {' and '.join(absent)} do not occur in record {seg['record']}."
                                      if absent else "")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build docs/report/ekg-arrhythmia-report.pdf")
    parser.add_argument("--preliminary", action="store_true",
                        help="mark the PDF as preliminary (metrics from a development run, not the final DS2 evaluation)")
    args = parser.parse_args()
    BUILD.mkdir(exist_ok=True)
    setup_matplotlib()
    metrics, stats = load("metrics"), load("dataset_stats")
    signal, seg, fr = load("signal_demo"), load("segmentation_demo"), load("filter_response")
    arch, tree = load("architecture"), load("tree")
    state = json.loads((ROOT / "project_state.json").read_text(encoding="utf-8"))
    if metrics.get("status") != "complete":
        print(f"metrics.json has status {metrics.get('status')!r} – a report needs a complete run.", file=sys.stderr)
        return 2

    review = next((mo for mo in state["modules"] if mo["id"] == "review-qa"), {})
    fm = re.search(r"all (\d+) review findings", review.get("summary", ""))
    per_test = stats["per_split"]["DS2"]
    ctx = {
        "metrics": metrics, "stats": stats, "signal": signal, "seg": seg, "filter": fr, "arch": arch,
        "cnn": metrics["cnn"]["summary"], "tree": metrics["tree"]["summary"],
        "params": metrics["cnn"].get("params", arch["total_params"]),
        "n_test_records": len(stats["records"]["DS2"]), "fs": signal["fs"], "record": signal["record"],
        "reference_peaks": metrics.get("config", {}).get("use_reference_peaks", True),
        "preliminary": args.preliminary,
        "n_share_test": per_test["N"] / sum(per_test.values()),
        "metrics_date": metrics.get("generated_at", "")[:10],
        "date": f"{dt.date.today():%d %B %Y}".lstrip("0"),
        "n_modules": len(state["modules"]), "max_agents": state["orchestrator"]["max_parallel_agents"],
        "review_findings": fm.group(1) if fm else None,
        "weight_cap": weight_cap(),
        "n_tests": count_tests(),
    }
    derived_texts(ctx)
    ctx.update({
        "fig_cover": fig_cover_strip(signal), "fig_anatomy": fig_beat_anatomy(signal),
        "fig_classes": fig_class_distribution(stats), "fig_raw": fig_raw_filtered(signal),
        "fig_filter": fig_filter_response(fr), "fig_pt": fig_pan_tompkins(signal), "fig_beats": fig_beats(seg),
        "fig_cnn": fig_cnn(arch), "fig_tree": fig_tree(tree), "fig_confusion": fig_confusion(metrics),
        "qr": qr_svg(LIVE_URL),
    })
    ctx["fig_rr"], ctx["rr_info"] = fig_rr(signal)
    if metrics["cnn"].get("history"):
        ctx["fig_history"] = fig_history(metrics["cnn"]["history"])
    gross = {k: metrics[k].get("gross_statistics", {}).get("gross") or metrics[k]["summary"]["per_class"]
             for k in ("cnn", "tree")}
    ctx["fig_compare"] = fig_compare([("1D CNN", gross["cnn"]), ("Decision tree", gross["tree"]),
                                      ("de Chazal 2004", DE_CHAZAL)])

    tokens = "".join(f"--c-{k}:{v};" for k, v in C.items())
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Arrhythmia detection in the ECG – project report ({AUTHOR})</title>
<link rel="stylesheet" href="../report.css">
<style>:root{{{tokens}}}</style>
</head><body>
{cover(ctx)}
{summary_page(ctx)}
{background_page(ctx)}
{data_page(ctx)}
{pipeline_pages(ctx)}
{models_pages(ctx)}
{results_pages(ctx)}
{limitations_page(ctx)}
{build_page(ctx)}
{final_page(ctx)}
</body></html>"""
    page = BUILD / "report.html"
    page.write_text(html, encoding="utf-8")
    render_pdf(page, PDF)
    print(f"wrote {PDF.relative_to(ROOT)} ({PDF.stat().st_size / 1e6:.1f} MB)")
    return 0


def render_pdf(page: Path, out: Path) -> None:
    from playwright.sync_api import Error, sync_playwright

    with sync_playwright() as p:
        browser, last = None, None
        for channel in (None, "chrome", "msedge"):  # bundled Chromium first, then installed browsers
            try:
                browser = p.chromium.launch(channel=channel) if channel else p.chromium.launch()
                break
            except Error as exc:
                last = exc
        if browser is None:
            raise SystemExit(f"No Chromium found – run 'python -m playwright install chromium'.\n{last}")
        tab = browser.new_page()
        tab.goto(page.as_uri(), wait_until="load")
        # Print only after fonts are loaded and every image is decoded (otherwise it can come out blank).
        tab.evaluate("Promise.all([document.fonts.ready, ...[...document.images].map(i => i.decode())]).then(() => true)")
        tab.pdf(path=str(out), prefer_css_page_size=True, print_background=True, tagged=True, outline=True)
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
