Im aktuellen Projektordner liegt die Datei `ekg-arrhythmia.zip`. Sie enthält ein fertiges EKG-Arrhythmie-Projekt (MIT-BIH, PyTorch 1D-CNN + Entscheidungsbaum, Web-UI mit „Process“-Ansicht). Es wurde in einer Cloud-Sitzung gebaut, in der physionet.org gesperrt war – deshalb fehlt noch das Training auf echten Daten. Bitte entpacke es hier, richte es ein und bring es zu Ende. Mit diesem Ordner wird ab jetzt gearbeitet. Arbeite die Schritte der Reihe nach ab und sag mir nach jedem Schritt kurz Bescheid.

## 1. Entpacken
- Das ZIP hat **keinen** Oberordner – die Projektdateien (`README.md`, `Makefile`, `src/`, `web/`, …) liegen direkt auf oberster Ebene. Entpacke es also **direkt in den aktuellen Ordner**:
  macOS/Linux: `unzip ekg-arrhythmia.zip -d .` · Windows: `tar -xf ekg-arrhythmia.zip`
- Prüfe vorher, ob im Ordner schon gleichnamige Dateien liegen; falls ja, frag mich, bevor du etwas überschreibst.
- Danach `README.md`, `Makefile` und `src/ekg/` müssen direkt im Projektordner liegen. Die ZIP-Datei behalten, aber `*.zip` in `.gitignore` eintragen.
- Dann `git init` und einen ersten Commit „Import aus Cloud-Sitzung“ machen (das ZIP enthält kein .git).
- Lies zuerst `README.md`, `MASTERPLAN.md`, `INTERFACES.md` und `project_state.json`, um das Projekt zu verstehen.

## 2. Voraussetzungen prüfen
- Python ≥ 3.11 (`python3 --version`), Node.js ≥ 18 + npm, `make`.
- Windows ohne `make`: die Befehle aus dem `Makefile` direkt ausführen; der venv-Python liegt dann unter `.venv\Scripts\python.exe` statt `.venv/bin/python`.
- Fehlt etwas, sag mir, wie ich es installiere (macOS: Homebrew), statt still auszuweichen.

## 3. Installieren
- `make install` (legt `.venv` an, installiert das Paket `ekg` editable mit Versionen aus `constraints.txt` und die Web-Abhängigkeiten).
- `constraints.txt` stammt aus einem Linux-Container (u. a. `torch==2.15.0` und nvidia-*-Pakete). Scheitert die Installation an einer Version, die es für mein System nicht gibt (z. B. Intel-Mac), installiere ohne die `-c constraints.txt`-Bindung bzw. mit der neuesten verfügbaren torch-Version und notiere das.
- Dann `make test` – alle Tests (zuletzt 199) müssen grün sein. Falls nicht: Ursache analysieren und beheben, nicht Tests abschwächen.

## 4. Echte Daten laden
- `make data` lädt die vollständige MIT-BIH Arrhythmia Database (48 Records, ~100 MB) von physionet.org nach `data/mitdb/`.
- Prüfe danach, dass alle Records aus DS1 und DS2 (siehe `src/ekg/data/loader.py`) vollständig vorhanden sind.

## 5. Trainieren und evaluieren
- Erst `make smoke` (Mechanik-Test), dann `make train` (CNN + Entscheidungsbaum auf DS1, Validierung auf einem Record-Hold-out innerhalb von DS1, Test **nur** auf DS2). Standard-Epochen siehe Makefile; bei sehr langer Laufzeit vorher Bescheid sagen.
- Das schreibt `metrics.json` (status `complete`), `tree.json` und `dataset_stats.json` nach `web/public/data/` sowie `model.pt` nach `artifacts/`.
- Trage den Fortschritt im Status-Protokoll ein:
  `.venv/bin/python scripts/state.py start full-training --agent local-claude` am Anfang, am Ende `done` mit `--summary`, `--decision` und `--test`. `project_state.json` nie von Hand editieren. Danach `make state`.

## 6. Ergebnisse ehrlich berichten
- Zeig mir je Klasse (N, S, V, F, Q) Sensitivität, PPV und F1, dazu Macro-F1 (auch `macro_f1_nsvf`) und die Konfusionsmatrix auf DS2.
- Ordne die Zahlen ein: Inter-Patient-Ergebnisse auf MIT-BIH sind für S und F typischerweise deutlich schlechter als für N und V – erkläre auffällige Schwächen, statt sie schönzureden. Nichts erfinden, nur die tatsächlich gemessenen Werte nennen.
- Hinweis: Records 201 und 202 stammen von derselben Person, liegen aber in verschiedenen Splits (bekannte Eigenheit des de-Chazal-Splits).

## 7. Weboberfläche starten
- `make web && make serve`, dann `http://127.0.0.1:8000/#/process` öffnen.
- Prüfe, dass die vorher leeren Panels (Training, Konfusionsmatrix, Entscheidungsbaum, Datensatz) jetzt echte Daten zeigen und dass Hell- und Dunkelmodus funktionieren. Falls ein Panel mit den echten Daten falsch rendert, beheben.

## 8. Abschluss
- Committe alles mit einer aussagekräftigen Nachricht (ohne `data/mitdb/`, `.venv/`, `node_modules/`, `artifacts/` – steht in `.gitignore`).
- Frag mich, ob ich das Projekt in ein GitHub-Repository pushen möchte.
- Fasse zum Schluss zusammen: was lief, welche Ergebnisse, was du angepasst hast, und was offen ist.
