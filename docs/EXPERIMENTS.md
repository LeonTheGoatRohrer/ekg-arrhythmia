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
