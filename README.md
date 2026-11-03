# EKG-Arrhythmie-Erkennung auf MIT-BIH (AAMI EC57, inter-patient)

**Deutsch** · [English](README.en.md)

Ein kompaktes 1D-CNN und ein interpretierbarer Entscheidungsbaum ordnen einzelne Herzschläge aus
der MIT-BIH Arrhythmia Database den fünf AAMI-EC57-Klassen **N, S, V, F, Q** zu – streng
**inter-patient** ausgewertet (Training und Test an verschiedenen Personen) und gebaut mit
**orchestrierten KI-Agenten**.

**Live-Demo:** <https://leonrohrer.at/ekg-arrhythmia/> – zeigt jeden Schritt vom Rohsignal bis
zur Klasse, mit Diagrammen und echten Daten.

![Startseite der Web-Oberfläche: Signal von Record 100, Rhythmus-Player, Kennzahlen und Pipeline](docs/screenshots/overview-light.png)

> Lern- und Portfolio-Projekt. **Kein Medizinprodukt**, nicht für Diagnosen geeignet.

## Auf einen Blick

| | |
|---|---|
| **Daten** | MIT-BIH Arrhythmia Database (PhysioNet), Ableitung MLII, 360 Hz. 44 von 48 Records; die 4 Schrittmacher-Records (102, 104, 107, 217) sind nach AAMI-Empfehlung ausgeschlossen. |
| **Split** | de Chazal et al. (2004): DS1 (22 Records) nur Training, DS2 (22 Records) nur Test. Kein Record liegt in beiden Mengen; nur 201 (DS1) und 202 (DS2) stammen von derselben Person, eine bekannte Eigenheit dieses Splits. |
| **Klassen** | N (normal, Schenkelblock, Ersatzschläge), S (supraventrikulär ektop), V (ventrikulär ektop), F (Fusion), Q (unklassifizierbar). |
| **Modelle** | `ECGNet1D`: 3 Faltungsblöcke für die Schlagform plus ein Zweig für 10 Zusatzmerkmale (RR-Intervalle und patientenrelative Merkmale), 14 857 Parameter; das finale Modell mittelt 5 solcher Netze (Seed-Ensemble). Dazu ein Entscheidungsbaum (Tiefe 4, 11 lesbare Merkmale). |
| **Hauptmetriken** | Sensitivität und PPV je Klasse, Macro-F1 über N/S/V/F. Accuracy ist keine Hauptzahl: Rund 89 % der Testschläge sind normal, ein Modell, das immer „N“ sagt, wirkt damit schon gut. |
| **Oberfläche** | Vite, Tailwind CSS v4, Mermaid; Deutsch/Englisch, hell/dunkel; statisch auf GitHub Pages. |

## Ergebnisse

Hauptergebnis ist die einmalige Auswertung auf DS2 mit den R-Zacken-Positionen der
Experten-Annotationen (wie bei de Chazal). Die Konfiguration wurde vorher allein per
Kreuzvalidierung auf DS1 gewählt und eingefroren. Die Tabellen zeigen Werte aus der über alle
Test-Records gepoolten Konfusionsmatrix (EC57 „gross“) **ohne** Sonderregel. Die EC57-VEB-Regel
(echte Fusionsschläge, die als V erkannt werden, zählen für V nicht als Fehlalarm) ändert nur die
V-PPV; dieser Wert steht jeweils als Fußnote dabei.

<!-- METRICS:START -->
<!-- final: Werte aus web/public/data/metrics.json (generated_at 2026-11-03T12:05:00+00:00): cnn.summary, cnn.gross_statistics, cnn.per_seed_aggregate, cnn.ensemble, detected_peaks, tree, cv, external. Einmalige DS2-Auswertung mit der in Commit 72b1cab eingefrorenen Konfiguration (Plan A7), externer Test A8. -->

**Finales Modell: CNN-Ensemble** (5 Seeds, patientenrelative Merkmale, Experten-R-Zacken, DS2):

| Klasse | Sensitivität | PPV | F1 | Schläge in DS2 |
|---|---:|---:|---:|---:|
| N | 93,7 % | 98,0 % | 95,8 % | 44 240 |
| S | 66,1 % | 43,0 % | 52,1 % | 1 837 |
| V | 97,2 % | 81,3 %² | 88,5 % | 3 220 |
| F | 0,8 % | 0,4 % | 0,5 % | 388 |
| Q | 0,0 % | 0,0 % | 0,0 % | 7 |

² Mit der EC57-VEB-Regel: V-PPV 83,4 % (F1 89,8 %).

- **Macro-F1 (N/S/V/F): 0,592** · Macro-F1 über alle 5 Klassen: 0,474
- Die 5 Einzelmodelle erreichen 0,564 ± 0,048 (Mittelwert ± Standardabweichung); das Ensemble
  glättet diese Streuung.
- Accuracy 92,1 % – zum Vergleich: „immer N“ erreicht 89,0 %.
- Größte Fehlerquelle ist S ↔ N: 1 545 normale Schläge werden als S erkannt, 523 S-Schläge als
  N. F wird praktisch nicht erkannt (3 von 388).
- Validierung je Seed auf 4 DS1-Records, beste Epochen 2, 2, 5, 1 und 4.

Konfusionsmatrix des CNN-Ensembles (Zeilen = wahre Klasse, Spalten = Vorhersage):

| | N | S | V | F | Q |
|---|---:|---:|---:|---:|---:|
| **N** | 41 440 | 1 545 | 551 | 704 | 0 |
| **S** | 523 | 1 215 | 69 | 30 | 0 |
| **V** | 17 | 66 | 3 129 | 8 | 0 |
| **F** | 288 | 1 | 96 | 3 | 0 |
| **Q** | 3 | 1 | 3 | 0 | 0 |

**Ende-zu-Ende mit Pan-Tompkins** statt Experten-R-Zacken: Der Detektor findet auf allen 22
DS2-Records 99,39 % der Schläge bei einer PPV von 99,79 % (TP 49 411, FP 106, FN 301, Toleranz
±150 ms). Auf den gefundenen Schlägen erreicht das CNN-Ensemble Macro-F1 (N/S/V/F) 0,585;
S 64,8 % / 41,3 %, V 95,5 % / 80,5 % (Sensitivität / PPV). Die 301 nicht gefundenen Schläge
fehlen in dieser Auswertung.

**Entscheidungsbaum** (Tiefe 4, auf ganz DS1 trainiert): Macro-F1 (N/S/V/F) 0,356.
Sensitivität / PPV: N 60,0 % / 95,0 % · S 7,1 % / 1,9 % · V 82,4 % / 54,6 % · F 1,8 % / 0,1 %.
Der Baum ist bewusst klein und lesbar; er zeigt, wie weit einfache Merkmale tragen, vor allem
bei V.

**Kreuzvalidierung nur auf DS1** (Grundlage aller Entscheidungen; 5 record-gruppierte Folds × 3
Seeds, Macro-F1 N/S/V/F): finale Konfiguration 0,481 ± 0,024, als 3-Seed-Ensemble 0,483. Die
DS2-Werte liegen darüber; die CV-Zahl ist die vorsichtigere Schätzung. Alle Varianten stehen in
[docs/EXPERIMENTS.md](docs/EXPERIMENTS.md).

**Externer Test: MIT-BIH Supraventricular Arrhythmia Database** (78 Records, 184 515 Schläge,
128 Hz auf 360 Hz hochgerechnet, Kanal ECG1). Das finale Ensemble wurde unverändert angewendet,
ohne Nachtraining und ohne Anpassung:

| Klasse | Sensitivität | PPV | F1 | Schläge |
|---|---:|---:|---:|---:|
| N | 95,4 % | 97,3 % | 96,3 % | 162 276 |
| S | 46,0 % | 60,5 % | 52,2 % | 12 196 |
| V | 90,3 % | 67,0 % | 77,0 % | 9 941 |
| F | 0,0 % | 0,0 % | 0,0 % | 23 |

Macro-F1 (N/S/V/F) 0,564, stark gedrückt durch F mit nur 23 Schlägen. S wird hier seltener
gefunden als auf DS2, die S-Alarme sind dafür häufiger richtig.

### Vergleich mit de Chazal et al. (2004)

| Kennzahl | dieses Projekt (CNN-Ensemble, DS2) | de Chazal et al. 2004 |
|---|---:|---:|
| N Sensitivität | 93,7 % | 86,9 %¹ |
| N PPV | 98,0 % | 99,2 %¹ |
| S Sensitivität | 66,1 % | 75,9 % |
| S PPV | 43,0 % | 38,5 % |
| V Sensitivität | 97,2 % | 77,7 % |
| V PPV | 81,3 % (83,4 % mit VEB-Regel) | 81,9 % |

Das CNN-Ensemble liegt bei N-Sensitivität, S-PPV und V-Sensitivität über de Chazal, bei
S-Sensitivität und N-PPV darunter; die V-PPV ist ähnlich. Die Zahlen sind nur eingeschränkt
vergleichbar (Bedingungen siehe unten).

¹ N-Werte aus einer Sekundärquelle, siehe unten.
<!-- METRICS:END -->

**Quelle und Bedingungen des Vergleichs.** P. de Chazal, M. O'Dwyer, R. B. Reilly: *Automatic
Classification of Heartbeats Using ECG Morphology and Heartbeat Interval Features.* IEEE
Transactions on Biomedical Engineering 51(7), 1196–1206, 2004.
[doi:10.1109/TBME.2004.827359](https://doi.org/10.1109/TBME.2004.827359). Die Werte für S und V
stehen im Abstract der Arbeit. Die N-Werte stammen aus der Vergleichstabelle von Tan et al. 2019
([arXiv:1906.07361](https://arxiv.org/abs/1906.07361), Tabelle VI); die Originaltabelle habe ich
nicht eingesehen. Gleich sind Split (DS1 → DS2), Klassen und die Verwendung der
Experten-R-Zacken. Anders: de Chazal nutzt **zwei** Ableitungen und lineare Diskriminanten auf
handgebauten Merkmalen, dieses Projekt nur MLII, ein CNN-Ensemble und Merkmale relativ zum
eigenen Record. Außerdem wurde DS2 hier vor der finalen Auswertung bereits zweimal ausgewertet
(siehe [Methodik-Transparenz](#methodik-transparenz)).

## Grenzen

- **Kleine Datenbasis.** Die MIT-BIH-Datenbank umfasst 48 Records von 47 Personen, aufgenommen
  1975–1979; genutzt werden 44, getestet wird auf 22. Der externe Test stammt ebenfalls aus der
  MIT-BIH-Sammlung; andere Geräte, Kliniken und Patientengruppen sind damit nicht abgedeckt.
- **F ist praktisch nicht lernbar.** 373 der 415 F-Schläge in DS1 stammen aus einem einzigen
  Record (208). Das Modell sieht damit im Kern die Fusionsschläge einer Person.
- **Q ist nicht sinnvoll auswertbar.** Nach dem Ausschluss der Schrittmacher-Records bleiben 8
  Q-Schläge in DS1 und 7 in DS2. Deshalb ist Macro-F1 über N/S/V/F die Hauptzahl.
- **Referenz-R-Zacken im Hauptergebnis.** Die Hauptauswertung nutzt die Schlagpositionen der
  Experten. Die vollautomatische Kette mit Pan-Tompkins ist ebenfalls ausgewertet; dort fehlen
  die Schläge, die der Detektor nicht findet.
- **Eine Ableitung, offline.** Nur MLII; eine zweite Ableitung als zusätzlicher Kanal hat in der
  Kreuzvalidierung geschadet. Die patientenrelativen Merkmale des finalen Modells nutzen
  Statistiken über den ganzen Record, also Holter-Auswertung im Nachhinein, nicht Echtzeit.
- **Streuung zwischen Trainingsläufen.** Einzelmodelle mit verschiedenen Seeds unterscheiden sich
  deutlich; das Ensemble mildert das, beseitigt es aber nicht (Details in
  [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md)).
- **Kein Medizinprodukt.** Nicht klinisch validiert, nicht für Diagnose oder Therapie.

## Methodik-Transparenz

Der Test-Split DS2 soll genau einmal ausgewertet werden, ganz am Ende. Insgesamt wurde DS2
**dreimal** ausgewertet; nur die dritte Auswertung ist das Hauptergebnis. Der Ablauf:

1. **Erster Lauf:** CNN mit Validierung auf den DS1-Records 114, 122, 201 und 208, Auswertung auf
   DS2.
2. **Zweiter Lauf:** Danach fiel auf, dass Record 208 rund 90 % aller F-Schläge von DS1 enthält
   und in der Validierung dem Training fehlte. Die neue Regel („kein Record mit ≥ 40 % einer
   Klasse in der Validierung“) wurde nur aus DS1-Zählungen abgeleitet. Neu trainiert wurde aber
   in Kenntnis des ersten DS2-Ergebnisses, und DS2 wurde ein zweites Mal ausgewertet.
3. **Modellphase nur auf DS1:** Ab hier fiel jede Entscheidung über die record-gruppierte
   5-fach-Kreuzvalidierung auf DS1 (3 Seeds), nach einem vorher festgelegten Kriterium: Eine
   Variante wird nur übernommen, wenn ihr mittlerer Macro-F1 (N/S/V/F) mindestens eine
   Standardabweichung über der Basis liegt und die N-Sensitivität nicht sinkt. Jedes Experiment
   steht mit Datum, Konfiguration und Ergebnis in [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md).
   - Verworfen: feste Epochenzahl statt Early Stopping und Augmentierung (A1), weichere
     Klassengewichte (A2), zweite Ableitung als zweiter Kanal (A3), kalibrierte Klassen-Offsets
     (A5; verschachtelt geprüft schadeten sie).
   - Übernommen: patientenrelative Merkmale (A4) und das Seed-Ensemble (A6).
4. **Finale Auswertung:** Die Konfiguration wurde vor der Auswertung committet (`72b1cab`) und DS2
   damit genau einmal ausgewertet, mit Experten- und mit Pan-Tompkins-R-Zacken (A7). Danach lief
   der externe Test ohne Nachtraining (A8).

**Nachtrag zum Kriterium, offen benannt:** Das Kriterium „mindestens eine Standardabweichung
über der Basis“ wurde festgelegt, als das CV-Ergebnis der patientenrelativen Merkmale schon
bekannt war. Unter der davor geltenden, etwas strengeren Regel wäre diese Variante knapp nicht
übernommen worden. Praktisch ist der Unterschied klein: Als Seed-Ensemble liegen Basis und
patientenrelative Variante in der Kreuzvalidierung gleichauf. Die Wahl ist also kein klarer
Gewinn, sondern eine Entscheidung nach vorab notierter Regel.

**Was das für die Zahlen bedeutet:** Die finale DS2-Auswertung lief mit eingefrorener
Konfiguration. Weil DS2 aber schon vorher zweimal ausgewertet wurde und die DS2-Werte über der
Kreuzvalidierung liegen, ist die CV auf DS1 die vorsichtigere Schätzung dafür, wie das Modell auf
neue Patienten wirkt.

## Gebaut mit KI-Agenten

Das Projekt ist auch ein Versuch, ein Software-Projekt mit vielen KI-Agenten gleichzeitig zu
bauen, ohne dass Ergebnisse und Code auseinanderlaufen. Ein Orchestrator („Mother-Agent“, Claude)
zerlegt die Arbeit in Module und startet dafür Sub-Agenten, bis zu 16 parallel. Plan, Verträge und
Status liegen als Dateien im Repo: [MASTERPLAN.md](MASTERPLAN.md),
[INTERFACES.md](INTERFACES.md) und [project_state.json](project_state.json).

### Ablauf

```mermaid
flowchart LR
  B0["B0 Infrastruktur<br/>Repo, State-Protokoll, Verträge"] --> W1
  W1["Welle 1<br/>13 Agenten parallel:<br/>Daten, Filter, R-Zacken, Segmentierung,<br/>CNN, Baum, Training, Metriken, API, UI"] --> W2
  W2["Welle 2<br/>Integration:<br/>Pipeline, dann UI"] --> W3
  W3["Welle 3<br/>3 unabhängige Reviewer,<br/>dann Fix-Agent"] --> W4
  W4["Welle 4<br/>Volltraining lokal"]
```

- **B0:** Der Orchestrator legt Repo, State-Protokoll und Verträge an.
- **Welle 1:** 13 Agenten bauen gleichzeitig Datenlader, Filter, R-Zacken-Detektion,
  Segmentierung, CNN, Baum, Trainingsschleife, Metriken, API-Server und die UI-Bausteine. Jeder
  Agent hat eigene, sich nicht überschneidende Dateien.
- **Welle 2:** Integration der Pipeline (CLI, Web-Export, Tests), danach der Oberfläche (Build,
  Browser-Tests in hell/dunkel, Desktop/Handy).
- **Welle 3:** Drei Reviewer prüfen unabhängig ML-Korrektheit und Leakage, Tests, UI und die
  Ehrlichkeit der Aussagen. Ein Fix-Agent hat alle 17 Befunde reproduziert und behoben, z. B.
  die Schwellen-Erholung im Pan-Tompkins-Detektor, die QRS-Breite, gedeckelte Klassengewichte und
  einen Cache-Schlüssel mit Code-Hash.
- **Welle 4:** Aus der Cloud-Umgebung war physionet.org nicht erreichbar, deshalb entstanden dort
  noch keine Modellergebnisse. Das Volltraining lief danach lokal unter Windows, inklusive
  Portierung des Datei-Locks. Auch die Modellphase (Experimente A1–A8) lief lokal, geführt über
  [docs/PLAN.md](docs/PLAN.md) und [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md).

### Regeln für die Zusammenarbeit

- **Ownership:** Jedes Modul besitzt exklusiv die Dateien unter `owns` in `project_state.json`.
  Fremde Dateien werden nicht editiert.
- **Verträge:** `INTERFACES.md` legt Funktionssignaturen, Datenformate und Design-Tokens fest.
  Wer abweichen muss, protokolliert das mit `state.py log` statt still zu ändern; die
  Erweiterungen stehen nachlesbar im Verlauf jedes Moduls.
- **State-Lock:** `project_state.json` wird nur über `scripts/state.py` geändert: Datei-Lock
  (`fcntl` bzw. `msvcrt` unter Windows) und atomares Schreiben, damit parallele Agenten sich
  nicht gegenseitig überschreiben.
- **Abhängigkeiten:** Der Orchestrator startet ein Modul erst, wenn alle `depends_on` erledigt
  sind. Scheitert ein Modul (`state.py fail` mit Log-Auszug), wird die Anweisung korrigiert und
  das Modul neu gestartet.
- **Nachweis:** Jeder Abschluss enthält Zusammenfassung, Entscheidungen, geänderte Dateien und
  die ausgeführten Tests mit Ergebnis. Die Status-Seite der Web-Oberfläche zeigt diesen Stand.

### Was ich selbst entschieden und geprüft habe

- **Ziel und Leitplanken:** Aufgabe und Rahmen (EC57-Klassen, inter-patient nach de Chazal, CNN
  plus interpretierbares Vergleichsmodell, nachvollziehbare Oberfläche) sowie die Regel, keine
  erfundenen oder geschönten Zahlen zu zeigen und Schwächen zu benennen.
- **Lokale Phase:** Daten und Volltraining auf meinem Rechner, nachdem die Cloud-Umgebung die
  Datenbank nicht laden konnte.
- **Kurs nach den ersten Ergebnissen:** erst das Modell verbessern, dann veröffentlichen; DS2
  blieb bis zur finalen Auswertung gesperrt ([docs/PLAN.md](docs/PLAN.md)).
- **Kontrolle:** Kennzahlen in Texten gegen die exportierten Ergebnisse prüfen; das Repo wird erst
  nach einer Prüfung auf private Daten öffentlich.

### Agenten-Protokoll (Kurzfassung)

```bash
python scripts/state.py start <modul> --agent <name>
python scripts/state.py done  <modul> --agent <name> --summary "…" --decision "…" --file <pfad> --test "<befehl>: <ergebnis>"
python scripts/state.py fail  <modul> --agent <name> --error "<log-auszug>"
python scripts/state.py log   <modul> --agent <name> --note "Abweichung vom Vertrag …"
python scripts/state.py show  [<modul>]
```

## Architektur

```
Rohsignal (MLII, 360 Hz)
  → Baseline-Entfernung (Median 200 ms, dann 600 ms)
  → Bandpass 0,5–40 Hz (Butterworth 4. Ordnung, nullphasig)
  → R-Zacken (Experten-Annotationen; alternativ Pan-Tompkins)
  → Segmentierung (250 ms vor / 450 ms nach R = 252 Samples, z-normiert)
    + 4 RR-Merkmale + 6 patientenrelative Merkmale (relativ zum eigenen Record)
  → ECGNet1D (3 × Conv1d/BN/ReLU/MaxPool, 16/32/64 Kanäle, Merkmalszweig), 5 Seeds gemittelt
    und Entscheidungsbaum (11 interpretierbare Merkmale, Tiefe 4)
  → AAMI-Klasse N/S/V/F/Q → Sensitivität, PPV, F1 je Klasse, Macro-F1
```

| Paket | Inhalt |
|---|---|
| `ekg.data.loader` | Records laden (wfdb), AAMI-Mapping, DS1/DS2-Split, Download |
| `ekg.preprocessing.filters` | Baseline-Entfernung, Bandpass, Notch, Frequenzgang |
| `ekg.preprocessing.rpeaks` | Pan-Tompkins-Detektor, Zwischenstufen, Abgleich mit Referenz |
| `ekg.preprocessing.segmentation` | Schlagfenster, RR-Merkmale, `BeatSet` |
| `ekg.preprocessing.patient_features` | RR und Schlagform relativ zum eigenen Record |
| `ekg.models.cnn1d` | `ECGNet1D`, Architektur-Beschreibung |
| `ekg.models.tree_baseline` | Merkmale, Entscheidungsbaum, Export (JSON/Mermaid) |
| `ekg.training.train` | Trainingsschleife (gedeckelte Klassengewichte, Early Stopping, Cosine-Schedule, Augmentierung) |
| `ekg.evaluation.metrics` | Konfusionsmatrix, AAMI-Metriken, Gross-/Average-Statistik mit VEB-Regel |
| `ekg.pipeline` | CLI: `demo`, `prepare`, `train`, `cv`, `oof`, `external`, `smoke`, `export-state` |
| `ekg.api.server` | FastAPI: `/api/health`, `/api/state`, `/api/data/{name}`, gebaute UI |

Die Web-Oberfläche (`web/`) hat vier Ansichten: **Übersicht** (mit Rhythmus-Player auf
Record 100), **Process** (jeder Schritt mit Diagramm, echten Daten und Verweis auf den Code),
**Modelle** (CNN und Baum gegen Zufalls-Baselines) und **Wie es gebaut wurde** (Agenten-Status
aus `project_state.json`). Die Live-Seite wird per [GitHub Actions](.github/workflows/pages.yml)
statisch gebaut (`VITE_STATIC_SITE=1`, ohne API).

## Quickstart

Voraussetzungen: Python ≥ 3.11 und Node.js ≥ 18. Getestet unter Linux (Cloud-Container) und
Windows 11 mit Python 3.13.

**Linux/macOS** (mit `make`):

```bash
make install   # .venv, pip install -c constraints.txt -e . pytest, npm ci
make test      # Python-Tests
make demo      # Web-Exporte aus Record 100 nach web/public/data
make web       # UI bauen (web/dist)
make serve     # http://127.0.0.1:8000 (API + UI)
```

**Windows** (PowerShell, ohne `make`): Die Makefile-Befehle direkt ausführen; der Python der
venv liegt unter `.venv\Scripts\python.exe` statt `.venv/bin/python`.

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -c constraints.txt -e . pytest
cd web; npm ci; cd ..
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe -m ekg.pipeline demo --record data/sample/100 --out web/public/data --data-dir data/mitdb
cd web; npm run build; cd ..
.venv\Scripts\python.exe -m ekg.api.server --port 8000
```

`constraints.txt` hält die getesteten Paketversionen aus dem Linux-Container fest. Gibt es eine
Version für das eigene System nicht, ohne `-c constraints.txt` installieren. `train` und `cv`
schreiben die tatsächlich verwendeten Versionen in ihre Ausgabe (`config.library_versions`).
Für die Entwicklung startet `cd web; npm run dev` die UI mit Hot Reload; `/api` wird an Port 8000
weitergeleitet.

## Befehle

Alle Befehle aus dem Repo-Root. Unter Windows `python` durch `.venv\Scripts\python.exe` ersetzen.

| Zweck | `make` | direkt |
|---|---|---|
| MIT-BIH laden (~100 MB, nach `data/mitdb`) | `make data` | `python scripts/download_mitdb.py --data-dir data/mitdb` |
| Web-Exporte aus Record 100 | `make demo` | `python -m ekg.pipeline demo --record data/sample/100 --out web/public/data --data-dir data/mitdb` |
| Mechanik-Test (1 Epoche, nur `artifacts/smoke/`) | `make smoke` | `python -m ekg.pipeline smoke --record data/sample/100 --out artifacts/smoke` |
| Beat-Cache für DS1/DS2 | `make prepare` | `python -m ekg.pipeline prepare --data-dir data/mitdb --cache artifacts/beats` |
| Kreuzvalidierung nur auf DS1 | `make cv FEATURES=patient` | `python -m ekg.pipeline cv --data-dir data/mitdb --features patient` |
| Training DS1, **Auswertung DS2** | `make train EPOCHS=20` | siehe unten (finale Konfiguration) |
| Externer Test (Daten nach `data/svdb`) | – | `python -m ekg.pipeline external --models artifacts --data-dir data/svdb` |
| Status für die UI kopieren | `make state` | `python -m ekg.pipeline export-state --out web/public/data` |

Finale Konfiguration (A7), wie in [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md) eingefroren:

```bash
python -m ekg.pipeline train --features patient --seeds 0 1 2 3 4 --max-class-share 0.4 \
  --eval-detected --cv-report artifacts/cv/cv_patient_es.json
```

> `train` wertet auf DS2 aus. Die finale Auswertung ist gelaufen; jede weitere Auswertung auf DS2
> wäre wieder ein Blick auf den Test-Split (siehe [Methodik-Transparenz](#methodik-transparenz)).
> Für Experimente ist `cv` da.

`make train` nutzt die Standardwerte (ohne Ensemble und patientenrelative Merkmale). `prepare` und
`train` brechen mit Exit-Code 2 und einer Liste der fehlenden Records ab, solange DS1/DS2 nicht
vollständig vorliegen. `demo` überschreibt ein vorhandenes `metrics.json` oder
`dataset_stats.json` mit `status: "complete"` nicht (außer mit `--force`). Für den externen Test
die Dateien der MIT-BIH Supraventricular Arrhythmia Database (`*.hea`, `*.dat`, `*.atr`) von
PhysioNet nach `data/svdb` legen, z. B. mit `wfdb.dl_database("svdb", "data/svdb")`. `external`
schreibt das Ergebnis zusätzlich als `external` in `metrics.json`.

### Optionen von `cv`

`cv` trainiert das CNN record-gruppiert in k Folds nur auf DS1 (DS2 wird nie geladen), poolt die
Out-of-fold-Vorhersagen je Seed und berichtet Mittelwert ± Standardabweichung über die Seeds.
Ausgabe: `artifacts/cv/cv_<features>[_<tag>].json`.

| Option | Standard | Wirkung |
|---|---|---|
| `--features base\|rr\|patient` | `base` | Zusatzeingaben des CNN: 4 RR-Merkmale; `rr` plus RR relativ zum Record-Mittel; `patient` zusätzlich Abweichung vom Median-Schlag des Records |
| `--folds K` / `--seeds S …` | `5` / `0 1 2` | Anzahl Folds und Seeds |
| `--epochs N` / `--patience P` | `20` / `5` | Maximale Epochen; Early Stopping (`0` = aus) |
| `--n-val N` | `3` | Validierungs-Records je Fold für Early Stopping. **`--n-val 0`**: keine Validierung, genau `--epochs` Epochen |
| `--eval-epochs E …` | – | Out-of-fold-Auswertung zusätzlich nach diesen Epochen (`by_epoch` im Bericht), um aus einem Lauf eine feste Epochenzahl zu wählen |
| `--lr-schedule cosine` | aus | Cosine-Lernratenplan |
| `--augment` | aus | Amplitude ±10 %, Gaußrauschen (σ = 0,05 in z-Einheiten), Zeitverschiebung ±3 Samples |
| `--weight-power P` | `1.0` | Exponent der inversen Klassengewichte (`0.5` = Wurzel, weicher) |
| `--leads 1\|2` | `1` | `2` = zweite Ableitung als zusätzlicher CNN-Kanal |
| `--tag NAME` | – | Namenszusatz der Ausgabedatei, damit Varianten sich nicht überschreiben |
| `--max-class-share X` | `0.4` | Records mit mindestens diesem Anteil einer Klasse kommen nie in die Validierung |
| `--detected-peaks` | aus | Pan-Tompkins-R-Zacken statt Experten-Annotationen |

Beispiele:

```bash
# feste Epochenzahl ohne Validierung, Auswertung nach 5/10/15/20 Epochen
python -m ekg.pipeline cv --features base --n-val 0 --epochs 20 --eval-epochs 5 10 15 20 --tag fixed
# Cosine-Schedule mit Augmentierung
python -m ekg.pipeline cv --features base --n-val 0 --epochs 15 --lr-schedule cosine --augment --tag cos_aug
```

## Projektstruktur

```
├── MASTERPLAN.md          Blöcke, Wellen, Abhängigkeiten der Agenten
├── INTERFACES.md          bindende Schnittstellen zwischen den Modulen
├── project_state.json     zentrale Status-Datei (nur über scripts/state.py ändern)
├── Makefile
├── constraints.txt        getestete Python-Paketversionen
├── data/sample/           echter MIT-BIH-Record 100
├── data/mitdb/            vollständige Datenbank (nach `make data`, nicht im Repo)
├── docs/
│   ├── PLAN.md            Fahrplan bis zur Veröffentlichung
│   ├── EXPERIMENTS.md     Experiment-Protokoll (Regeln, CV-Läufe, finale Auswertung)
│   └── screenshots/
├── scripts/
│   ├── state.py           lock-sicheres Status-Protokoll für Agenten
│   └── download_mitdb.py  Download der MIT-BIH-Datenbank
├── src/ekg/               Python-Paket (siehe Tabelle oben)
├── tests/                 pytest (synthetische Signale und Record 100)
├── artifacts/             Modelle, Caches, CV-Berichte (nicht im Repo)
└── web/
    ├── public/data/       JSON-Exporte der Pipeline für die UI
    └── src/               Ansichten, Diagramme, Charts, Process-Inhalte
```

## Lizenz und Daten

- **Code:** MIT-Lizenz, siehe [LICENSE](LICENSE).
- **Daten:** MIT-BIH Arrhythmia Database von PhysioNet, Lizenz Open Data Commons Attribution
  (ODC-By) 1.0; sie fallen nicht unter die MIT-Lizenz. Der Record 100 unter `data/sample/` sowie
  die daraus abgeleiteten Web-Exporte und Screenshots stammen aus dieser Datenbank. Die
  vollständige Datenbank ist nicht im Repo, sondern wird mit `make data` von PhysioNet geladen.
  Details und Quellenangabe: [DATA_LICENSE.md](DATA_LICENSE.md).

## Quellen

- G. Moody, R. Mark: MIT-BIH Arrhythmia Database (Version 1.0.0). PhysioNet, 2005.
  [doi:10.13026/C2F305](https://doi.org/10.13026/C2F305)
- G. B. Moody, R. G. Mark: The impact of the MIT-BIH Arrhythmia Database. *IEEE Engineering in
  Medicine and Biology* 20(3), 45–50, 2001.
- A. L. Goldberger et al.: PhysioBank, PhysioToolkit, and PhysioNet. *Circulation* 101(23),
  e215–e220, 2000.
- P. de Chazal, M. O'Dwyer, R. B. Reilly: Automatic Classification of Heartbeats Using ECG
  Morphology and Heartbeat Interval Features. *IEEE Trans. Biomed. Eng.* 51(7), 1196–1206, 2004.
- J. Pan, W. J. Tompkins: A Real-Time QRS Detection Algorithm. *IEEE Trans. Biomed. Eng.* 32(3),
  230–236, 1985.
- ANSI/AAMI EC57: Testing and reporting performance results of cardiac rhythm and ST segment
  measurement algorithms.
