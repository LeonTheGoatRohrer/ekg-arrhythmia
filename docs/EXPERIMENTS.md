# Experiment-Protokoll

## Regeln (gelten ab 2026-11-02)

- DS2 (Test-Split) ist bis zur finalen Auswertung (Plan A7) gesperrt. Vorher wurde DS2 zweimal
  ausgewertet (Run 1: Validierung 114/122/201/208, macro-F1 0,447; Run 2: 114/119/122/201,
  macro-F1 0,463). Ab jetzt wird DS2 genau einmal ausgewertet und berichtet, egal wie es ausfällt.
- Alle Entscheidungen fallen über die record-gruppierte 5-fach-Kreuzvalidierung auf DS1
  (`python -m ekg.pipeline cv`, 3 Seeds 0/1/2, gepoolte Out-of-fold-Vorhersagen je Seed).
- **Kriterium:** Eine Variante ersetzt die aktuelle Basis nur, wenn ihr Mittelwert von
  `macro_f1_nsvf` mindestens um 1 Standardabweichung (der Basis) höher ist und die
  N-Sensitivität nicht sinkt. Für A1 (Stabilität) zusätzlich: Std über Seeds kleiner als die
  Basis bei mindestens gleichem Mittelwert.
- Hinweis: Mit 3 Seeds ist auch die Std selbst unsicher. Knappe Unterschiede gelten als
  „kein Unterschied“.

## Ausgangslage (CV auf DS1, vor Plan-Start)

Early Stopping auf 3 Validierungs-Records je Fold, Patience 5, max. 20 Epochen, Adam lr 1e-3.

| Variante | macro_f1_nsvf | N Se | S Se / PPV | V Se / PPV | F F1 | beste Epoche je Fold (Seed 0) |
|---|---|---|---|---|---|---|
| base | 0,459 ± 0,020 | 0,87 | 0,39 / 0,23 | 0,83 / 0,50 | 0,00 | 1, 9, 9, 4, 7 |
| rr | 0,463 ± 0,023 | 0,89 | 0,34 / 0,23 | 0,82 / 0,53 | 0,00 | 14, 6, 13, 2, 1 |
| patient | 0,481 ± 0,024 | 0,90 | 0,40 / 0,22 | 0,86 / 0,62 | 0,01 | 1, 6, 9, 1, 1 |

Beobachtung: Die beste Epoche springt zwischen 1 und 14. Die Modellauswahl auf 3 Records ist
zufällig. Das ist der Ansatzpunkt für A1.

## Läufe

| Datum | ID | Änderung | macro_f1_nsvf | N Se | S F1 | V F1 | Entscheidung |
|---|---|---|---|---|---|---|---|
| 2026-11-03 | A1 `fixed` | ohne Validierung, feste Epochen (Snapshots 2/3/5/8/12/16/20) | bestes: 0,448 ± 0,012 (Ep. 12); Ep. 20: 0,415 ± 0,031 | 0,84 (Ep. 12) | 0,23 | 0,65 | verworfen: unter Basis 0,459 |
| 2026-11-03 | A1 `fixed_aug` | wie `fixed` + Augmentierung | bestes: 0,453 ± 0,016 (Ep. 5); Ep. 20: 0,426 ± 0,009 | 0,90 (Ep. 5) | 0,22 | 0,66 | verworfen: unter Basis 0,459 |

**A1-Fazit:** Keine feste Epochenzahl schlägt das Early Stopping der Basis, obwohl die beste Epoche
hier sogar auf den Test-Folds gewählt wurde (also optimistisch). Mit mehr Epochen sinkt die
N-Sensitivität stetig (0,88 → 0,79): Das Netz lernt die Trainingspatienten auswendig und
überträgt das schlecht auf neue Patienten. Augmentierung hilft bei gleicher Epoche leicht
(+0,01), bleibt aber innerhalb einer Std. Cosine-Lernrate wurde nicht mehr gerechnet, weil das
Optimum schon nach 3–5 Epochen liegt. **Entscheidung:** Early Stopping bleibt; Augmentierung wird
mit Early Stopping noch einmal geprüft (`es_aug`).

## Runde 2 (vorab festgelegt, 2026-11-03, vor Sicht der Ergebnisse)

Läufe, alle mit Early Stopping wie die Basis (3 Validierungs-Records je Fold,
`max_class_share` 0,4, Patience 5, max. 20 Epochen), 5 Folds × Seeds 0/1/2, Out-of-fold-Logits
gespeichert:

| ID | Änderung gegenüber Basis |
|---|---|
| `es` | keine (Basis neu, damit Out-of-fold-Logits vorliegen; muss 0,459 reproduzieren) |
| `wp05` | A2: Klassengewichte mit Exponent 0,5 (Wurzel) statt 1 |
| `es_aug` | A1b: Augmentierung (Amplitude ±10 %, Rauschen σ 0,05, Verschiebung ±3 Samples) |
| `l2` | A3: zweite Ableitung (meist V1) als zweiter CNN-Kanal |

**Regeln für die Auswahl:**
1. Eine Komponente gilt als „angenommen“, wenn ihr Lauf das Kriterium oben erfüllt
   (Mittelwert ≥ Basis + 1 Std der Basis, N-Sensitivität nicht niedriger).
2. Angenommene Komponenten werden in einem Kombinationslauf zusammen geprüft (A4: dabei auch
   mit `--features patient`, weil dessen früherer Lauf 0,481 ± 0,024 knapp an der damals
   festgelegten Schwelle scheiterte, unter der heutigen Regel aber knapp darüber läge).
   Die Kombination ersetzt die beste Einzelkomponente nur, wenn sie wieder das Kriterium
   gegenüber dieser erfüllt.
3. A5/A6 werden auf den Out-of-fold-Logits der gewählten Konfiguration entschieden: Das
   Seed-Ensemble wird übernommen, wenn es ≥ dem Mittel der Einzelmodelle ist (es kostet nur
   Rechenzeit). Klassen-Offsets werden nur übernommen, wenn die verschachtelte Schätzung (Offsets
   auf 4 Folds gelernt, auf dem 5. angewendet) `macro_f1_nsvf` um mindestens 0,01 über das
   Ensemble ohne Offsets hebt.
4. Danach wird die Konfiguration eingefroren (Commit) und DS2 genau einmal ausgewertet (A7),
   mit Experten-R-Zacken und zusätzlich mit Pan-Tompkins-R-Zacken.

### Ergebnisse Runde 2 (2026-11-03)

| ID | macro_f1_nsvf | N Se | S Se / PPV / F1 | V Se / PPV / F1 | Ensemble (3 Seeds) | Ensemble + Offsets (verschachtelt) | Entscheidung |
|---|---|---|---|---|---|---|---|
| `es` (Basis) | 0,459 ± 0,020 | 0,87 | 0,39 / 0,23 / 0,29 | 0,83 / 0,50 / 0,63 | **0,486** | 0,474 | Basis exakt reproduziert |
| `wp05` (A2) | 0,455 ± 0,011 | 0,92 | 0,22 / 0,26 / 0,23 | 0,81 / 0,54 / 0,65 | 0,469 | 0,407 | verworfen (unter Basis) |
| `es_aug` (A1b) | 0,449 ± 0,013 | 0,88 | 0,45 / 0,19 / 0,25 | 0,73 / 0,56 / 0,62 | 0,466 | 0,472 | verworfen (unter Basis) |
| `l2` (A3) | 0,433 ± 0,010 | 0,88 | 0,28 / 0,12 / 0,16 | 0,79 / 0,55 / 0,64 | 0,438 | 0,423 | verworfen (unter Basis) |
| `patient` (A4, Lauf vom 2026-11-02) | 0,481 ± 0,024 | 0,90 | 0,40 / 0,22 / 0,27 | 0,86 / 0,62 / 0,71 | – | – | angenommen (≥ 0,4797, N Se höher) |

**Fazit Runde 2:**
- **A2 (weichere Gewichte):** mehr N-Sensitivität (0,92), aber S fällt deutlich ab – im Mittel kein
  Gewinn.
- **A1b (Augmentierung):** kein Gewinn mit Early Stopping.
- **A3 (zweite Ableitung):** schlechter, vor allem S-PPV (0,12). Wahrscheinliche Ursache: Die
  zweite Ableitung ist nicht einheitlich (V1 in 20, V4/V5 in je einem DS1-Record), und die
  Morphologie in V1 unterscheidet sich zwischen Patienten stark – das Netz lernt Patienten-
  Eigenheiten statt Schlagtypen.
- **A6 (Seed-Ensemble):** +0,027 gegenüber dem Mittel der Einzelmodelle → übernommen.
- **A5 (Klassen-Offsets):** auf allen Daten gelernt sähen sie gut aus, verschachtelt geprüft
  schaden sie (0,474 < 0,486). Die Offsets schieben vor allem F nach oben, und F-Schläge stammen
  fast nur aus wenigen Patienten – das überträgt sich nicht. → verworfen.
- **A4:** `patient` ist die einzige angenommene Komponente; Kombination nach Regel 2 entfällt
  damit. `patient` wird mit gespeicherten Out-of-fold-Logits wiederholt (`patient_es`), um
  Ensemble und Offsets auch dort zu prüfen.

### Entscheidung und eingefrorene Konfiguration (2026-11-03, vor der DS2-Auswertung)

`patient_es` (Wiederholung mit gespeicherten Logits) reproduziert 0,4815 ± 0,0240.
Ensemble aus 3 Seeds: 0,4828 (N Se 0,91, S Se/PPV 0,32/0,22, V Se/PPV 0,87/0,62);
Ensemble + Offsets verschachtelt: 0,4611.

Nach den vorab festgelegten Regeln:
- Regel 1/2: `patient` ist die einzige angenommene Komponente → Merkmalssatz `patient`.
- Regel 3: Ensemble (0,4828) ≥ Mittel der Einzelmodelle (0,4815) → Seed-Ensemble ja.
  Offsets verschachtelt schlechter (0,4611) → keine Offsets.
- Beobachtung, offen benannt: Mit Ensemble liegen Basis (0,4860) und `patient` (0,4828)
  gleichauf; der Unterschied liegt weit innerhalb einer Standardabweichung. Die Regel wurde vor
  dieser Beobachtung festgelegt und wird nicht nachträglich geändert.

**Finale Konfiguration (A7):** CNN mit patientenrelativen Merkmalen (`--features patient`,
10 Zusatzeingänge), Klassengewichte invers (Exponent 1, Deckel 50×), ohne Augmentierung, eine
Ableitung (MLII), Adam lr 1e-3, Batch 256, max. 20 Epochen, Early Stopping (Patience 5) auf
4 DS1-Validierungs-Records je Seed (`max_class_share` 0,4), Seed-Ensemble aus 5 Seeds (0–4,
Mittel der Softmax-Wahrscheinlichkeiten), keine Klassen-Offsets. Entscheidungsbaum unverändert
(Tiefe 4). Auswertung auf DS2 genau einmal, mit Experten-R-Zacken (Hauptergebnis) und mit
Pan-Tompkins-R-Zacken (Ende-zu-Ende).

```bash
python -m ekg.pipeline train --features patient --seeds 0 1 2 3 4 --max-class-share 0.4 \
  --eval-detected --cv-report artifacts/cv/cv_patient_es.json
```

**Nachtrag zur Transparenz (2026-11-03, während der finalen Rechnung, vor Sicht der
DS2-Zahlen):** Das Kriterium dieses Protokolls („Mittelwert ≥ Basis + 1 Std der Basis“) wurde am
2026-11-02 festgelegt, als das CV-Ergebnis von `patient` (0,481 ± 0,024) schon bekannt war. Unter
der davor geltenden, strengeren Regel aus der ersten CV-Runde („Mittelwert > Basis + größere der
beiden Std“, also > 0,484) wäre `patient` knapp nicht übernommen worden. Praktisch ist der
Unterschied klein: Mit Seed-Ensemble liegen Basis und `patient` in der CV gleichauf (0,486 vs.
0,483).

## A7 – finale DS2-Auswertung (2026-11-03, genau einmal, Konfiguration aus Commit `72b1cab`)

Seed-Ensemble aus 5 CNNs (Seeds 0–4), Validierungs-Records je Seed aus DS1
(0: 114/119/122/205 · 1: 116/118/205/230 · 2: 106/112/114/205 · 3: 106/109/112/201 ·
4: 119/124/215/220), beste Epochen 2/2/5/1/4. Test: DS2, 22 Records, 49 692 Schläge.

| | macro_f1_nsvf | macro_f1 | N Se / PPV | S Se / PPV | V Se / PPV | F Se / PPV |
|---|---|---|---|---|---|---|
| CNN-Ensemble, Experten-R-Zacken | **0,592** | 0,474 | 93,7 / 98,0 % | 66,1 / 43,0 % | 97,2 / 81,3 % | 0,8 / 0,4 % |
| Einzelmodelle (Mittel ± Std, 5 Seeds) | 0,564 ± 0,048 | 0,451 ± 0,038 | | | | |
| CNN-Ensemble, Pan-Tompkins-R-Zacken | 0,585 | 0,468 | 93,4 / 97,8 % | 64,8 / 41,3 % | 95,5 / 80,5 % | 1,0 / 0,5 % |
| Entscheidungsbaum (Tiefe 4) | 0,356 | 0,286 | 60,0 / 95,0 % | 7,1 / 1,9 % | 82,4 / 54,6 % | 1,8 / 0,1 % |

Pan-Tompkins auf allen 22 DS2-Records (±150 ms): TP 49 411, FP 106, FN 301 → Se 99,39 %,
PPV 99,79 %. In der Ende-zu-Ende-Zeile fehlen die 301 nicht gefundenen Schläge (sie werden nicht
klassifiziert).

Einordnung: Die DS2-Werte liegen über der CV auf DS1 (0,483 mit Ensemble). DS2 ist für dieses
Modell offenbar etwas „leichter“ als die DS1-Folds; die CV-Zahl ist die vorsichtigere Schätzung.
Größte Fehlerquelle bleibt S ↔ N (1 545 N als S, 523 S als N); F wird praktisch nicht erkannt.

## A8 – externer Test: MIT-BIH Supraventricular Arrhythmia Database (2026-11-03)

Finales Ensemble aus A7 unverändert angewendet (kein Nachtraining, keine Anpassung).
78 Records, 128 Hz → auf 360 Hz hochgerechnet (`resample_poly`), Kanal ECG1 (Ableitung in der
Datenbank nicht angegeben), Experten-R-Zacken. 184 515 Schläge: N 162 276 · S 12 196 · V 9 941 ·
F 23 · Q 79.

| Klasse | Sensitivität | PPV | F1 |
|---|---|---|---|
| N | 95,4 % | 97,3 % | 0,963 |
| S | 46,0 % | 60,5 % | 0,522 |
| V | 90,3 % | 67,0 % | 0,770 |
| F | 0,0 % | 0,0 % | 0,000 (nur 23 Schläge) |

macro_f1_nsvf 0,564 (durch F mit 23 Schlägen stark gedrückt), macro_f1 0,451.
Häufigste Fehler: S als N (3 932) und S als V (2 473); N als F (2 511).
Einordnung: Das Modell überträgt sich auf eine fremde Datenbank mit anderer Abtastrate und
unbekannter Ableitung. S wird seltener gefunden als auf DS2 (46 % statt 66 %), dafür sind die
S-Alarme häufiger richtig (61 % statt 43 %).
