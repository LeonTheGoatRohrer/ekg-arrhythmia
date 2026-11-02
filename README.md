# EKG-Arrhythmie-Erkennung (MIT-BIH, AAMI EC57)

Herzschlag-Klassifikation im EKG nach den fünf AAMI-EC57-Klassen **N / S / V / F / Q** auf der
MIT-BIH Arrhythmia Database – mit einem kompakten **1D-CNN** (plus RR-Intervall-Merkmale) und
einem **interpretierbaren Entscheidungsbaum** als Vergleichsmodell. Ausgewertet wird
**inter-patient** nach de Chazal et al. (2004): Training auf DS1, Test auf DS2, ohne
Überlappung der Records (nur 201 in DS1 und 202 in DS2 stammen laut PhysioNet von derselben Person). Eine Web-Oberfläche mit eigener **Process**-Ansicht zeigt jeden
Schritt nachvollziehbar, von den Rohdaten bis zur Klasse.

## Datenlage (bitte zuerst lesen)

- In der Container-Umgebung, in der dieses Projekt entstanden ist, ist **physionet.org durch
  die Netzwerk-Policy gesperrt** (Proxy-Antwort 403). Die vollständige Datenbank (48 Records)
  konnte deshalb **nicht** geladen werden.
- Unter `data/sample/` liegt nur der **echte MIT-BIH-Record 100** (aus dem offiziellen
  wfdb-python-Repository). Alle Demo-Grafiken der UI stammen aus diesem Record.
- Record 100 gehört zu **DS2 (Test-Split)**. Er dient hier nur zur Veranschaulichung, nie zum
  Training.
- Es gibt deshalb **noch keine Modell-Kennzahlen**. `metrics.json` und `dataset_stats.json`
  stehen auf `status: "pending"` mit Begründung, und es gibt kein `tree.json`. Die UI zeigt an
  diesen Stellen einen erklärenden Leerzustand.
- Gemessen wurde nur die **R-Zacken-Detektion auf Record 100** (Pan-Tompkins gegen die
  Experten-Annotationen, Toleranz ±150 ms): 2273 von 2273 Schlägen erkannt, 0 Fehldetektionen
  (Sensitivität 1,0, PPV 1,0). Das ist ein einzelner Record und kein Benchmark für die ganze
  Datenbank.

## Architektur

```
Rohsignal (MLII, 360 Hz)
  → Baseline-Entfernung (Median 200 ms + 600 ms)
  → Bandpass 0,5–40 Hz (Butterworth 4. Ordnung, nullphasig)
  → R-Zacken (Pan-Tompkins: 5–15 Hz, Ableitung, Quadrat, 150-ms-Integration, adaptive Schwellen)
  → Segmentierung (250 ms vor / 450 ms nach R = 252 Samples) + 4 RR-Merkmale
  → ECGNet1D (3 × Conv1d/BN/ReLU/MaxPool, 16/32/64 Kanäle; RR-Zweig; 14 749 Parameter)
    und Entscheidungsbaum (11 interpretierbare Merkmale, Tiefe 4)
  → AAMI-Klasse N/S/V/F/Q → Metriken je Klasse (Sensitivität, PPV, F1), Macro-F1
```

| Paket | Inhalt |
|---|---|
| `ekg.data.loader` | Record laden (wfdb), AAMI-Mapping, DS1/DS2-Split, Download |
| `ekg.preprocessing.filters` | Baseline, Bandpass, Notch, Frequenzgang |
| `ekg.preprocessing.rpeaks` | Pan-Tompkins-Detektor, Zwischenstufen, Peak-Matching |
| `ekg.preprocessing.segmentation` | Beat-Fenster, RR-Merkmale, `BeatSet` |
| `ekg.models.cnn1d` | `ECGNet1D`, Architektur-Beschreibung |
| `ekg.models.tree_baseline` | Merkmale, Entscheidungsbaum, Export (JSON/Mermaid) |
| `ekg.training.train` | Trainingsschleife (Klassengewichte, Early Stopping), Speichern/Laden |
| `ekg.evaluation.metrics` | Konfusionsmatrix, AAMI-Metriken |
| `ekg.pipeline` | CLI: `demo`, `prepare`, `train`, `smoke`, `export-state` |
| `ekg.api.server` | FastAPI: `/api/health`, `/api/state`, `/api/data/{name}`, gebaute UI |

Die Web-Oberfläche (`web/`) ist mit Vite, Tailwind CSS v4 und Mermaid gebaut. Sie hat drei
Ansichten: Übersicht, **Process** (Schritt-für-Schritt-Dokumentation mit Diagrammen und
interaktiven Grafiken) und Status (Stand der Agenten aus `project_state.json`). Hell- und
Dunkelmodus werden unterstützt.

## Quickstart

Voraussetzungen: Python ≥ 3.11 und Node.js ≥ 18.

```bash
make install   # venv, pip install -c constraints.txt -e ., npm ci
make demo      # Web-Exporte aus Record 100 nach web/public/data
make test      # Python-Tests
make web       # UI bauen (web/dist)
make serve     # http://127.0.0.1:8000 (API + UI)
```

`constraints.txt` hält die getesteten Python-Paketversionen fest (pip freeze der Projekt-venv);
`train` schreibt die verwendeten Versionen zusätzlich nach `metrics.json` (`config.library_versions`).
Gleicher Seed liefert nur mit diesen Versionen identische Ergebnisse. Für das reine CPU-Wheel von
torch: `make install PIP_EXTRA='--extra-index-url https://download.pytorch.org/whl/cpu'`.

Für die Entwicklung kann die UI auch mit `cd web && npm run dev` gestartet werden. Anfragen an
`/api` werden dabei an Port 8000 weitergeleitet.

Weitere Kommandos:

| Befehl | Wirkung |
|---|---|
| `make smoke` | Prüft die Mechanik von prepare/train/evaluate/export auf Record 100 mit 1 Epoche. Schreibt **nur** nach `artifacts/smoke/` (Dateien mit Präfix `smoke_`, `status: "smoke"`). Die Zahlen sind keine Ergebnisse. |
| `make data` | Lädt die vollständige MIT-BIH-DB nach `data/mitdb` (braucht physionet.org). |
| `make prepare` | Baut die Beat-Datensätze für DS1/DS2 als npz-Cache (`artifacts/beats`). |
| `make train EPOCHS=20` | Trainiert das CNN auf DS1, validiert auf 4 DS1-Records (record-weiser Hold-out), trainiert den Baum auf ganz DS1 und evaluiert beides auf DS2. Schreibt `metrics.json` (`status: "complete"`), `tree.json`, `dataset_stats.json` nach `web/public/data` und `artifacts/web` (Fallback der API) sowie `artifacts/model.pt`. |
| `make state` | Kopiert `project_state.json` nach `web/public/data`. |

`prepare` und `train` brechen mit Exit-Code 2 und einer Liste der fehlenden Records ab, solange
DS1/DS2 nicht vollständig vorliegen. `demo` überschreibt ein vorhandenes `metrics.json` oder
`dataset_stats.json` mit `status: "complete"` nicht.

## Volltraining nachholen

1. **physionet.org freischalten:** In der Netzwerk-Policy der Umgebung den Host `physionet.org`
   (HTTPS) erlauben. Alternativ das Projekt **lokal** ausführen, wo physionet.org erreichbar ist.
2. `make data`. Bei einem Fehler meldet das Skript den Grund und endet mit Exit-Code 2.
   Ein Mirror kann mit `--base-url` angegeben werden. Wer die Dateien schon hat (`*.hea`,
   `*.dat`, `*.atr`), legt sie einfach nach `data/mitdb/`.
3. `make train` (optional `EPOCHS=…`), danach `make web`, um die UI mit den echten Ergebnissen
   neu zu bauen.

## Projektstruktur

```
├── INTERFACES.md          bindende Schnittstellen zwischen den Modulen
├── MASTERPLAN.md          Blöcke, Wellen, Abhängigkeiten
├── project_state.json     zentrale Status-Datei (nur über scripts/state.py ändern)
├── Makefile
├── constraints.txt        getestete Python-Paketversionen (für make install)
├── data/sample/           echter MIT-BIH-Record 100
├── data/mitdb/            vollständige DB (nach `make data`, nicht im Repo)
├── scripts/
│   ├── state.py           lock-sicheres Status-Protokoll für Agenten
│   └── download_mitdb.py  Download der MIT-BIH-DB
├── src/ekg/               Python-Paket (siehe Tabelle oben)
├── tests/                 pytest (synthetische Signale + Record 100)
├── artifacts/             Modelle, Caches, Smoke-Ausgaben (nicht im Repo)
└── web/
    ├── public/data/       JSON-Exporte der Pipeline für die UI
    └── src/               Shell, Ansichten, Diagramme, Charts, Process-Inhalte
```

## Agenten-Protokoll

Das Projekt wird von einem Orchestrator („Mother-Agent“) mit bis zu 16 parallelen
Sub-Agenten entwickelt. Jedes Modul gehört genau einem Agenten (`owns` in
`project_state.json`). Der Status wird ausschließlich über das lock-sichere Skript geändert:

```bash
python scripts/state.py start <modul> --agent <name>
python scripts/state.py done  <modul> --agent <name> --summary "…" --decision "…" --file <pfad> --test "<befehl>: <ergebnis>"
python scripts/state.py fail  <modul> --agent <name> --error "<log-auszug>"
python scripts/state.py log   <modul> --agent <name> --note "Abweichung vom Vertrag …"
python scripts/state.py show  [<modul>]
```

Vor jeder neuen Welle liest der Orchestrator `project_state.json`, startet nur Module, deren
Abhängigkeiten erfüllt sind, und startet fehlgeschlagene Module mit korrigierter Anweisung neu.
Abweichungen von `INTERFACES.md` werden mit `state.py log` dokumentiert. Die Status-Ansicht der
UI zeigt diesen Stand live (`/api/state`) oder als Kopie (`web/public/data/project_state.json`).
