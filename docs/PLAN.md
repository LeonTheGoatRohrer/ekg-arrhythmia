# Plan: vom jetzigen Stand zum Portfolio-Projekt

Ziel: ein öffentliches, ehrliches, gut erklärbares Projekt für das Portfolio (Bewerbung für
KI-/Automations-Praktika vor dem Robotik-Studium). Die Entwicklung mit KI-Agenten ist ein
gewollter Teil der Geschichte.

Reihenfolge: **erst Phase A (Modell), dann B–E.** Jede Aufgabe hat ein Prüfkriterium
(„Fertig, wenn …“). Nach jeder Aufgabe: `pytest` grün, Commit.

---

## Grundregel für Phase A: DS2 bleibt bis zum Schluss zu

DS2 (Test-Split) wurde schon zweimal ausgewertet. Ab jetzt gilt:

- Alle Entscheidungen (Merkmale, Gewichte, Schwellen, Epochen) fallen **nur über die
  DS1-Kreuzvalidierung** (`make cv`, 5 Folds × 3 Seeds).
- Das Auswahlkriterium wird **vorher** festgelegt und notiert: Mittelwert von
  `macro_f1_nsvf` in der CV; eine Variante gilt nur als besser, wenn sie mindestens
  **1 Standardabweichung** über der aktuellen Basis liegt und die N-Sensitivität nicht sinkt.
- DS2 wird **genau einmal** am Ende ausgewertet (A7). Das Ergebnis wird berichtet, egal wie
  es ausfällt.
- Jedes Experiment kommt mit Datum, Konfiguration und CV-Ergebnis in `docs/EXPERIMENTS.md`.

Ausgangswerte (CV auf DS1, `macro_f1_nsvf`): base 0,460 ± 0,020 · rr 0,463 ± 0,023 ·
patient 0,482 ± 0,024.

---

## Phase A – Modell verbessern

**A0 Experiment-Protokoll anlegen**
`docs/EXPERIMENTS.md` mit der Grundregel oben, den Ausgangswerten und einer Tabelle.
Fertig, wenn: Datei existiert und die drei bisherigen CV-Läufe eingetragen sind.

**A1 Training stabilisieren**
Problem: Bestes Modell nach Epoche 2 von 7, Val-F1 springt zwischen 0,48 und 0,55 (nur 4
Validierungs-Records). Ansätze, einzeln per CV vergleichen:
- feste Epochenzahl aus der CV bestimmen statt Early Stopping auf 4 Records
- Lernraten-Schedule (z. B. Cosine oder ReduceLROnPlateau)
- leichte Augmentierung (Amplitudenskalierung, Rauschen, kleine Zeitverschiebung)

Fertig, wenn: Standardabweichung über Seeds kleiner als jetzt (< 0,020) bei mindestens
gleichem Mittelwert.

**A2 F-Klasse darf N nicht kaputtmachen**
Problem: 2018 normale Schläge werden als F erkannt (N-Sensitivität nur 92 %). F-Gewicht
deckeln (z. B. max. Gewicht 10) oder Gewichte mit Wurzel statt linear invertieren.
Fertig, wenn: N-Sensitivität in der CV steigt, ohne dass `macro_f1_nsvf` sinkt.

**A3 Zweite Ableitung als zweiter Kanal**
Das Modell nutzt nur MLII. Zweiter Kanal (meist V1) als zweite Eingabe; Records mit anderer
zweiter Ableitung dokumentieren.
Fertig, wenn: CV-Vergleich eingetragen, Entscheidung nach Grundregel getroffen.

**A4 Patientenrelative Merkmale erneut prüfen**
`--features patient` lag bei 0,482 (knapp unter der Schwelle). Mit A1–A3 kombiniert neu
messen.
Fertig, wenn: CV-Vergleich eingetragen, Entscheidung getroffen.

**A5 Entscheidungsschwellen kalibrieren**
Statt `argmax` pro Klasse einen Logit-Offset, bestimmt auf den Out-of-fold-Vorhersagen der
DS1-CV (nie auf DS2). Ziel: besseres Verhältnis von S-Sensitivität zu S-PPV.
Fertig, wenn: Offsets sind in der Konfiguration gespeichert und der CV-Gewinn ist eingetragen.

**A6 Seed-Ensemble**
Finales Modell = Mittel der Wahrscheinlichkeiten aus 5 Seeds.
Fertig, wenn: CV zeigt Ensemble ≥ Einzelmodell; `train` kann `--seeds` mehrfach.

**A7 Finale Auswertung auf DS2 (einmalig)**
- Beste Konfiguration aus A1–A6 einfrieren (Commit vor der Auswertung).
- DS2 auswerten mit **Experten-R-Zacken** und **Pan-Tompkins-R-Zacken** (End-to-End,
  `--detected-peaks`), jeweils Mittelwert ± Std über die Seeds.
- R-Zacken-Detektion auf allen DS2-Records berichten (Se/PPV), nicht nur Record 100.
Fertig, wenn: `metrics.json` enthält beide Varianten mit Seeds, Baum ebenfalls neu
exportiert, `docs/EXPERIMENTS.md` hat den Abschluss-Eintrag.

**A8 (optional) Externer Test**
Finales Modell ohne Nachtraining auf einer zweiten Datenbank testen, z. B. MIT-BIH
Supraventricular Arrhythmia Database (128 Hz → auf 360 Hz resamplen). Zeigt, wie gut das
Modell auf fremde Daten übertragbar ist.

**A9 (optional) Patientenadaptiv**
Pro DS2-Patient die ersten ~5 Minuten als gelabelt annehmen und kurz nachtrainieren
(Idee nach de Chazal 2006). Getrennt vom Hauptergebnis berichten.

---

## Phase B – Ehrlichkeit und Dokumentation

**B1 README neu schreiben** (Deutsch als `README.md`, Englisch als `README.en.md`, gegenseitig
verlinkt). Inhalt:
- ein Satz, was das Projekt ist, plus Link zur Live-Seite und ein Screenshot/GIF
- Ergebnistabelle (Se/PPV/F1 je Klasse, Mittelwert ± Std) und Vergleich mit de Chazal 2004
  (mit Quelle)
- Abschnitt „Grenzen“: MIT-BIH-Größe, F/Q praktisch nicht lernbar, kein Medizinprodukt
- Abschnitt „Methodik-Transparenz“: DS2 wurde vor A7 zweimal ausgewertet, warum, und was
  danach geändert wurde
- Abschnitt „Gebaut mit KI-Agenten“: Orchestrator, Module, State-Protokoll, was ich selbst
  entschieden und geprüft habe
- Quickstart

Fertig, wenn: kein Satz mehr sagt „physionet gesperrt“ oder „noch keine Kennzahlen“.

**B2 Veraltete Texte in der UI und den Daten korrigieren**
- `overview.js`: Prinzip „Ehrliche Datenlage … bleibt ausstehend“
- `project_state.json`: `data_status.mitdb_full`
- „Records verfügbar 44“ erklären (4 Schrittmacher-Records ausgeschlossen)
- Process-Schritte und Modelle-Seite auf die neuen Ergebnisse aus A7

Fertig, wenn: `grep` nach „ausstehend|pending|gesperrt|blocked“ trifft nur noch Code für
Leerzustände, keine Inhaltstexte.

**B3 Interview-Spickzettel** (`docs/ERKLAERT.md`, nur für mich, nicht öffentlich nötig):
Warum inter-patient? Warum Macro-F1 statt Accuracy? Warum scheitert F? Was macht
Pan-Tompkins? Was ist die VEB-Regel? Warum ist DS2 heilig? Wie liefen die Agenten?
Fertig, wenn: ich jede Frage in 2–3 Sätzen frei beantworten kann.

---

## Phase C – Web-Oberfläche

**C1 Standardsprache Deutsch**: `i18n.js` nimmt aktuell die Browsersprache; neu: immer
Deutsch, außer der Nutzer hat EN gewählt.
Fertig, wenn: frischer Browser mit englischer Sprache öffnet auf Deutsch.

**C2 Agenten-Geschichte bewusst zeigen**: Die Status-Seite bleibt, bekommt aber oben eine
kurze Einleitung (Warum Agenten? Wie ist die Arbeit aufgeteilt? Was hat der Mensch
entschieden?). Button auf der Startseite heißt dann z. B. „Wie es gebaut wurde“.

**C3 Pipeline-Erklärung bleibt**, nur Zahlen aktualisieren (siehe B2).

**C4 Prüfen**: Desktop und Handy, hell und dunkel, DE und EN; keine Konsolenfehler.

---

## Phase D – Repo öffentlich machen

**D1 Private Daten prüfen** (Stand heute: keine Passwörter, Tokens oder lokalen Pfade in den
Dateien gefunden). Noch zu entscheiden/erledigen:
- Commit-E-Mail `lerohrer@tsn.at` steht in der Git-Historie. Wenn das nicht öffentlich sein
  soll: künftig die GitHub-noreply-Adresse verwenden; optional Historie umschreiben.
- `LOCAL_SETUP_PROMPT.md` entfernen (internes Arbeitsdokument).
- `src/ekg.egg-info/` aus Git entfernen und in `.gitignore` aufnehmen.
- Logs/Artefakte bleiben außerhalb von Git (bereits per `.gitignore`).
- Vor dem Umschalten noch einmal die ganze Historie scannen (z. B. `gitleaks`).

**D2 LICENSE**: MIT für den Code; Hinweis, dass Record 100 aus der MIT-BIH-Datenbank
(PhysioNet, ODC-By 1.0) stammt, mit Quellenangabe.

**D3 GitHub-Seite**: Beschreibung, Topics (ecg, pytorch, machine-learning, ai-agents …),
Homepage-Link, HTTPS erzwingen.

**D4 Branches aufräumen**, alles in `master`, dann Repo auf öffentlich stellen (mache ich nur
nach deinem OK).

---

## Phase E – LinkedIn

**E1** Projekt-Eintrag (Abschnitt „Projekte“) auf Deutsch und Englisch: Titel, 3–4 Sätze,
Links zu Live-Seite und Repo, Fähigkeiten.
**E2** Optional ein Post mit kurzem Bildschirmvideo (Rhythmus-Player, Process-Ansicht).
Aussage: ehrliche Inter-Patient-Auswertung, Ergebnis im Bereich der Literatur, gebaut mit
orchestrierten KI-Agenten. Keine 99-%-Zahlen, Accuracy nicht als Hauptzahl.
**E3** Gegenlesen: stimmen alle Zahlen im Text mit `metrics.json` überein?
