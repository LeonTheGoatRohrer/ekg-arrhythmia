# Masterplan – EKG-Arrhythmie-Erkennung (MIT-BIH, AAMI EC57)

Ziel: Beat-Klassifikation (N / S / V / F / Q nach AAMI EC57) auf MIT-BIH-Arrhythmia-Daten mit einem
1D-CNN (+ RR-Intervall-Fusion) und einem interpretierbaren Entscheidungsbaum als Vergleichsmodell,
evaluiert **inter-patient** (de Chazal DS1 → DS2, keine Record-Überlappung; nur 201/202 stammen von derselben Person), dokumentiert in einer
Web-Oberfläche mit eigener **Process**-Ansicht.

Zentrale Status-Datei: `project_state.json` (nur über `scripts/state.py` ändern).
Verträge zwischen Modulen: `INTERFACES.md`.

## Blöcke & Abhängigkeiten

```mermaid
flowchart LR
  B0[B0 Infrastruktur] --> B1[B1 Daten-Pipeline]
  B0 --> B2[B2 ML-Modell]
  B0 --> B4[B4 Prozess-UI]
  B1 --> B3[B3 Evaluierung & Integration]
  B2 --> B3
  B3 --> B4i[B4 UI-Integration]
  B4 --> B4i
  B4i --> B5[B5 Review / QA]
  B3 -. physionet.org freigeschaltet .-> FT[Volltraining DS1→DS2]
```

| Block | Module (Agent je Modul) | Ergebnis |
|---|---|---|
| **B0 Infrastruktur** | infra-scaffold (Mother-Agent) | Repo, venv, npm, State-Protokoll, Verträge |
| **B1 Daten-Pipeline** | data-loader · signal-filters · r-peak-detection · beat-segmentation | Record → gefiltertes Signal → R-Zacken → Beat-Fenster + RR-Features + AAMI-Labels |
| **B2 ML-Modell** | cnn-model · tree-baseline · training-loop | ECGNet1D (PyTorch), Entscheidungsbaum, Trainingsschleife mit Klassengewichten |
| **B3 Evaluierung** | evaluation · pipeline-integration · full-training | AAMI-Metriken, End-to-End-CLI, Web-Export, (Volltraining sobald Daten verfügbar) |
| **B4 Prozess-UI** | api-server · ui-shell · ui-diagrams · ui-charts · ui-content · ui-integration | FastAPI + Vite/Tailwind-UI mit Process-Ansicht, Mermaid-Diagrammen, SVG-Charts |
| **B5 Qualität** | review-qa | Adversariales Review (ML-Korrektheit, Leakage, Tests, UI, Ehrlichkeit) + Fixes |

## Wellen (max. 16 parallele Agents)

- **Welle 1 (13 Agents parallel, disjunkte Dateien):** alle B1-, B2-, Evaluierungs-, API- und UI-Grundmodule.
- **Welle 2 (sequenziell, braucht Welle 1):** pipeline-integration → ui-integration (Build + Screenshots).
- **Welle 3:** review-qa (3 unabhängige Reviewer mit verschiedenen Blickwinkeln) → Fix-Agent → Re-Test.
- **Welle 4 (blockiert):** full-training, sobald `physionet.org` in der Netzwerk-Policy freigeschaltet ist.

## Konfliktvermeidung
1. Jedes Modul besitzt exklusiv die Dateien unter `owns` in `project_state.json`.
2. Fremde Dateien werden in Welle 1 nicht editiert; Abweichungen vom Vertrag → `state.py log`.
3. Der Mother-Agent liest vor jeder Welle `project_state.json` und startet nur Module, deren `depends_on` erfüllt sind.
4. Fehler: Agent meldet `state.py fail` mit Log-Auszug → Mother-Agent korrigiert die Anweisung und startet das Modul neu.

## Fachliche Leitplanken
- Abtastrate 360 Hz, Ableitung MLII; Fenster 250 ms vor / 450 ms nach R-Zacke (252 Samples).
- Gepacte Records (102, 104, 107, 217) ausgeschlossen (AAMI-Empfehlung).
- Keine Intra-Patient-Mischung von Train/Test (sonst unrealistisch hohe Accuracy).
- Hauptmetriken: Sensitivität & PPV je Klasse (v. a. S und V), Macro-F1 — nicht Accuracy (N dominiert ~90 %).
