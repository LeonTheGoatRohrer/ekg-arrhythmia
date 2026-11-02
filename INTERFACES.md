# Interface-Verträge (bindend für alle Sub-Agents)

Parallele Agents implementieren gegen diese Signaturen. Wer abweichen MUSS, trägt das per
`python scripts/state.py log <module> --agent <name> --note "..."` ein, statt still zu ändern.

Python-Paket: `src/ekg` (src-Layout, `pip install -e .`), Python 3.13, venv unter `.venv/`.
Abhängigkeiten: numpy, scipy, wfdb, torch (CPU), scikit-learn, fastapi, uvicorn, pytest, httpx.
Code/Kommentare: Englisch. UI-Texte: Deutsch.

## Datenlage (wichtig, ehrlich bleiben)
- `physionet.org` ist in dieser Container-Umgebung **gesperrt**. Die vollständige MIT-BIH-DB (48 Records)
  kann hier nicht geladen werden.
- `data/sample/100.{dat,hea,atr}` ist **echter** MIT-BIH-Record 100 (aus dem offiziellen wfdb-python Repo).
- Erlaubt: Unit-Tests mit kleinen synthetischen Signalen; Smoke-Tests/Demos auf Record 100.
- **Verboten**: Metriken/Ergebnisse aus synthetischen Daten oder aus nur einem Record als Modell-Ergebnis
  ausgeben oder in der UI anzeigen. Ohne vollständige DB bleibt `metrics.json` auf `status: "pending"`.

## ekg.data.loader
```python
CLASSES: list[str] = ["N", "S", "V", "F", "Q"]          # AAMI EC57 classes, index = label id
AAMI_MAP: dict[str, str]                               # beat symbol -> AAMI class
MITDB_RECORDS: list[str]                               # all 48 record names
PACED_RECORDS = ["102", "104", "107", "217"]           # excluded (AAMI)
DS1: list[str]; DS2: list[str]                         # de Chazal et al. 2004 inter-patient split (22 + 22)
class DataUnavailableError(RuntimeError): ...
@dataclass
class Record:
    name: str
    signal: np.ndarray        # float32 (n_samples,), lead MLII in mV
    fs: int                   # 360
    ann_samples: np.ndarray   # int64, ALL annotation sample positions
    ann_symbols: list[str]    # same length as ann_samples
def aami_class(symbol: str) -> str | None             # None for non-beat annotations
def load_record(name: str, data_dir: str | Path) -> Record   # picks MLII channel (fallback channel 0)
def available_records(data_dir) -> list[str]            # records with .hea+.dat+.atr present
def download_mitdb(data_dir, records=None, base_url=None) -> list[str]
    # uses wfdb.dl_database; on network failure raise DataUnavailableError with actionable message
```

## ekg.preprocessing.filters
```python
def remove_baseline(x, fs) -> np.ndarray      # 200 ms + 600 ms median filters (de Chazal)
def bandpass(x, fs, low=0.5, high=40.0, order=4) -> np.ndarray   # zero-phase Butterworth (sosfiltfilt)
def notch(x, fs, freq=60.0, q=30.0) -> np.ndarray                # zero-phase IIR notch
def preprocess(x, fs, use_notch=False) -> np.ndarray             # baseline -> bandpass [-> notch], float32
def frequency_response(fs, low=0.5, high=40.0, order=4, n=512) -> dict   # {"freqs":[...], "gain_db":[...], "low", "high", "order"}
```

## ekg.preprocessing.rpeaks
```python
def detect_r_peaks(x, fs) -> np.ndarray                     # Pan-Tompkins, int64 sample indices, sorted
def pan_tompkins_stages(x, fs) -> dict[str, np.ndarray]     # keys: "bandpassed","derivative","squared","integrated"
def match_peaks(detected, reference, fs, tol_ms=150) -> dict   # {"tp","fp","fn","sensitivity","ppv"}
```

## ekg.preprocessing.segmentation
```python
PRE_MS = 250; POST_MS = 450                                 # window -> L = 90 + 162 = 252 samples @360 Hz
def segment_beats(x, r_peaks, fs, pre_ms=PRE_MS, post_ms=POST_MS) -> tuple[np.ndarray, np.ndarray]
    # (beats float32 (n, L), kept_idx int64 indices into r_peaks; beats too close to edges are dropped)
def rr_features(r_peaks, fs) -> np.ndarray                   # float32 (n, 4): pre_rr, post_rr, local_rr (causal mean of last <=10 pre_rr incl. current), pre_rr/local_rr  [seconds]
@dataclass
class BeatSet:
    beats: np.ndarray    # float32 (n, L), per-beat z-normalised
    rr: np.ndarray       # float32 (n, 4)
    labels: np.ndarray   # int64 (n,), index into CLASSES
    record: np.ndarray   # str (n,), record name per beat
    r_sample: np.ndarray # int64 (n,)
    @staticmethod
    def concat(sets: list["BeatSet"]) -> "BeatSet"
def build_beat_dataset(record: Record, fs=None, use_reference_peaks=True) -> BeatSet
    # preprocess -> peaks (reference annotations of beat symbols, or detect_r_peaks) -> segment -> labels via AAMI
```

## ekg.models.cnn1d
```python
class ECGNet1D(torch.nn.Module):
    def __init__(self, n_classes=5, in_len=252, n_rr=4, channels=(16, 32, 64), kernel_sizes=(7, 5, 3), dropout=0.3)
    def forward(self, beats, rr=None) -> torch.Tensor   # beats (B, L) or (B, 1, L); rr (B, 4) or None -> logits (B, C)
def count_parameters(model) -> int
def describe_architecture(model, in_len=252) -> list[dict]   # [{"name","type","output_shape":[...],"params":int,"detail":str}]
```

## ekg.models.tree_baseline
```python
def extract_features(beats, rr, fs=360) -> tuple[np.ndarray, list[str]]   # interpretable features (QRS width, R amp, ... + RR)
def train_tree(X, y, max_depth=4, class_weight="balanced", random_state=0) -> DecisionTreeClassifier
def export_tree(tree, feature_names, class_names) -> dict     # nested {"id","feature","threshold","samples","value","class","left","right"}; leaves have feature=None
def tree_to_mermaid(tree_json) -> str                          # "flowchart TD ..." string
```

## ekg.evaluation.metrics
```python
def confusion(y_true, y_pred, n_classes=5) -> np.ndarray      # rows = true, cols = pred
def per_class_metrics(cm, class_names) -> dict                 # {cls: {"sensitivity","ppv","specificity","f1","support"}}
def summary(y_true, y_pred, class_names) -> dict               # {"accuracy","macro_f1","macro_f1_nsvf","per_class":{...},"confusion":[[...]],"class_names":[...]}
```

## ekg.training.train
```python
class BeatTorchDataset(torch.utils.data.Dataset)              # wraps BeatSet -> (beat, rr, label)
def class_weights(labels, n_classes=5, max_ratio=50.0) -> torch.Tensor  # inverse-frequency, capped at max_ratio x the majority-class weight; 0 support -> 0
def train_cnn(train: BeatSet, val: BeatSet | None, epochs=10, lr=1e-3, batch_size=256, seed=0, device="cpu") -> tuple[ECGNet1D, list[dict]]
    # history entries: {"epoch","train_loss","val_loss","val_macro_f1"}
def predict(model, data: BeatSet, batch_size=1024) -> np.ndarray
def save_model(model, path); def load_model(path) -> ECGNet1D
```

## ekg.api.server
FastAPI `app`; `python -m ekg.api.server --port 8000`.
- `GET /api/health` -> `{"status":"ok"}`
- `GET /api/state` -> contents of `project_state.json`
- `GET /api/data/{name}` -> whitelisted JSON from `web/public/data/` (or `artifacts/web/`, written by `pipeline train --out artifacts`), 404 otherwise, no path traversal
- `/` -> serves `web/dist` (built UI) if present

## Web-Export (`web/public/data/*.json`) — Schnittstelle Pipeline -> UI
| Datei | Inhalt | Quelle |
|---|---|---|
| `signal_demo.json` | `{record, fs, source, start_s, raw[], filtered[], r_peaks[], annotations:[{sample,symbol,aami}], stages:{bandpassed,derivative,squared,integrated}, detection:{tp,fp,fn,sensitivity,ppv}}` (Fenster ~10 s, Samples relativ zum Fensterstart) | echter Record 100 |
| `filter_response.json` | Ausgabe `frequency_response()` | berechnet |
| `architecture.json` | `{"layers": describe_architecture(...), "total_params": int}` | berechnet |
| `segmentation_demo.json` | `{fs, pre_ms, post_ms, examples:[{aami, symbol, beat:[...]}]}` echte Beats aus Record 100 | echter Record 100 |
| `dataset_stats.json` | `{status, records_available, per_split:{DS1:{N,S,V,F,Q}, DS2:{...}}}` oder `status:"pending"` | Pipeline |
| `metrics.json` | `{status:"pending"|"complete", reason?, dataset, split, cnn:{summary,history}, tree:{summary}}` | Pipeline (nur vollständige DB) |
| `tree.json` | `export_tree()` – nur aus vollständigem DS1-Training | Pipeline |
| `project_state.json` | Kopie der zentralen Status-Datei | Pipeline/Script |

UI muss jede Datei als optional behandeln (fetch 404 / `status:"pending"` -> sauberer Empty-State mit Erklärung).

## Web-UI-Module (Vite + Tailwind v4 + Mermaid, Vanilla-JS ES-Module, `web/`)
- `web/src/lib/data.js` *(ui-shell)*: `export async function loadJSON(name)` -> Objekt oder `null`.
- `web/src/lib/theme.js` *(ui-shell)*: `getTheme()`, `setTheme('light'|'dark'|'system')`, dispatcht `window` Event `themechange` mit `detail.theme` (effektiv 'light'|'dark').
- `web/src/diagrams/index.js` *(ui-diagrams)*: `export const DIAGRAMS = { [id]: { title, caption, source } }`; `export async function renderDiagram(container, id)`; reagiert selbst auf `themechange`. Pflicht-IDs:
  `pipeline-overview`, `layer-architecture`, `pan-tompkins`, `decision-tree-logic`, `inter-patient-split`, `training-loop`, `agent-orchestration`.
- `web/src/components/*.js` *(ui-charts)*: jede Funktion `render…(container, data, opts?) -> { destroy() }`, behandelt `data == null` mit Empty-State:
  `renderEcgChart` (signal_demo.json; Rohsignal vs. gefiltert, R-Zacken-Marker, Annotationen), `renderPanTompkins` (stages), `renderFilterResponse`, `renderBeatGallery` (segmentation_demo.json), `renderArchitecture` (architecture.json), `renderTrainingCurve` (metrics.cnn.history), `renderConfusionMatrix` (summary), `renderTreeView` (tree.json, interaktiv), `renderDatasetStats`. Export-Sammelpunkt: `web/src/components/index.js`.
- `web/src/process/steps.js` *(ui-content)*: `export const STEPS = [{ id, phase, title, kicker, summary, body /* HTML */, bullets: [], diagram?: DIAGRAM_ID, panel?: PANEL_ID, dataFile?: string, codeRef?: string }]`.
  PANEL_IDs: `ecg`, `pan-tompkins`, `filter-response`, `beats`, `architecture`, `training`, `confusion`, `tree`, `dataset`.
- Shell *(ui-shell)*: `web/index.html`, `web/src/main.js`, `web/src/style.css`, `web/src/views/*.js` (Ansichten: Übersicht, **Process**, Status), Hash-Routing, Light/Dark/System-Toggle, responsive (Mobile-Nav). Die Process-View komponiert STEPS + `renderDiagram` + Panels aus `components/index.js` (Mapping PANEL_ID -> render-Funktion + dataFile).

## Design-Tokens (definiert von ui-shell in `web/src/style.css`, genutzt von Charts & Diagrammen)
Dark-Mode via Klasse `dark` auf `<html>` (Tailwind v4: `@custom-variant dark (&:where(.dark, .dark *));`).
Charts verwenden ausschließlich `var(--c-…)`; Mermaid liest die Werte per
`getComputedStyle(document.documentElement).getPropertyValue('--c-…').trim()` und rendert bei `themechange` neu.

| Token | Light | Dark | Verwendung |
|---|---|---|---|
| `--c-bg` | `#f8fafc` | `#0b1120` | Seitenhintergrund |
| `--c-surface` | `#ffffff` | `#111827` | Karten |
| `--c-surface-2` | `#f1f5f9` | `#1e293b` | Sekundärflächen, Grid |
| `--c-border` | `#e2e8f0` | `#273449` | Linien, Rahmen |
| `--c-text` | `#0f172a` | `#e2e8f0` | Text |
| `--c-muted` | `#64748b` | `#94a3b8` | Sekundärtext, Achsen |
| `--c-accent` | `#0d9488` | `#2dd4bf` | Primär-Akzent (Teal) |
| `--c-accent-2` | `#6366f1` | `#818cf8` | Sekundär-Akzent (Indigo) |
| `--c-raw` | `#94a3b8` | `#64748b` | Rohsignal |
| `--c-filtered` | `#e11d48` | `#fb7185` | Gefiltertes EKG |
| `--c-peak` | `#d97706` | `#fbbf24` | R-Zacken-Marker |
| `--c-cls-N` | `#64748b` | `#94a3b8` | Klasse N |
| `--c-cls-S` | `#6366f1` | `#818cf8` | Klasse S |
| `--c-cls-V` | `#e11d48` | `#fb7185` | Klasse V |
| `--c-cls-F` | `#d97706` | `#fbbf24` | Klasse F |
| `--c-cls-Q` | `#0d9488` | `#2dd4bf` | Klasse Q |
| `--c-grid` | `#fde2e4` | `#3b1d27` | EKG-Papier-Raster (dezent) |
