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
