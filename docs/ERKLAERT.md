# Erklärt: Fragen und Antworten zum Projekt

Kurze Antworten auf die Fragen, die man zu diesem Projekt am häufigsten stellt – je 2–4 Sätze,
mit Verweis auf die Stelle im Code. Die Antworten selbst enthalten keine Modellzahlen; die stehen
gesammelt in [Die wichtigsten Zahlen](#die-wichtigsten-zahlen) am Ende.

## Daten und Auswertung

### Warum inter-patient?

Ein EKG-Modell soll später bei Menschen funktionieren, die es nie gesehen hat. Mischt man Schläge
derselben Person in Training und Test (intra-patient), lernt das Modell die Eigenheiten dieser
Person und kommt auf fast perfekte, aber unrealistische Werte. Deshalb trainiere ich nur auf DS1
und teste nur auf DS2 (de Chazal 2004); auch die Validierung und die Kreuzvalidierung teilen nach
Records, nie nach einzelnen Schlägen. Einzige Eigenheit: Records 201 und 202 stammen von derselben
Person und liegen in verschiedenen Mengen.

Beleg: [loader.py:61](../src/ekg/data/loader.py#L61) (DS1/DS2),
[pipeline.py:747](../src/ekg/pipeline.py#L747) (Validierungs-Records innerhalb von DS1),
[pipeline.py:801](../src/ekg/pipeline.py#L801) (record-gruppierte Folds).

### Warum Macro-F1 statt Accuracy?

Rund 89 % der Testschläge sind normal. Ein Modell, das immer „N“ sagt, kommt damit schon auf
eine hohe Accuracy, erkennt aber keinen einzigen auffälligen Schlag. F1 ist das harmonische
Mittel aus Sensitivität (wie viele echte Schläge einer Klasse gefunden werden) und PPV (wie viele
Treffer stimmen); Macro-F1 mittelt das ungewichtet über die Klassen, sodass S, V und F genauso
zählen wie N. Q lasse ich in der Hauptzahl weg (`macro_f1_nsvf`), weil es fast keine Q-Schläge
gibt.

Beleg: [metrics.py:154](../src/ekg/evaluation/metrics.py#L154).

### Was machen Baseline-Filter und Bandpass?

Die Grundlinie eines EKGs wandert durch Atmung und Bewegung. Zwei hintereinander geschaltete
Medianfilter (200 ms entfernt QRS und P-Welle, 600 ms die T-Welle) schätzen diese Grundlinie, die
ich dann abziehe. Der Bandpass 0,5–40 Hz entfernt restliche langsame Drift sowie Muskelrauschen
und Netzbrummen. Beide Filter laufen vorwärts und rückwärts (nullphasig), damit die R-Zacke zeitlich
nicht verschoben wird, denn die Schlagfenster werden genau um sie herum geschnitten.

Beleg: [filters.py:48](../src/ekg/preprocessing/filters.py#L48) (Baseline),
[filters.py:75](../src/ekg/preprocessing/filters.py#L75) (Bandpass),
[filters.py:96](../src/ekg/preprocessing/filters.py#L96) (Reihenfolge).

### Wie funktioniert Pan-Tompkins?

Der Algorithmus macht den QRS-Komplex in mehreren Stufen sichtbar: Bandpass 5–15 Hz (dort liegt
die QRS-Energie), Ableitung (steile Flanken), Quadrieren (alles positiv, große Werte stärker) und
ein gleitendes 150-ms-Fenster, das pro Schlag einen „Hügel“ erzeugt. Adaptive Schwellen für Signal-
und Rauschpegel entscheiden, was ein Schlag ist; dazu kommen 200 ms Refraktärzeit, eine Prüfung
gegen T-Wellen und eine Nachsuche, wenn zu lange kein Schlag kam. Meine Version weicht bewusst ab:
nullphasige Filter, die genaue R-Position wird im Originalsignal gesucht, und die Schwellen erholen
sich nach Artefakten.

Beleg: [rpeaks.py:100](../src/ekg/preprocessing/rpeaks.py#L100) (Stufen),
[rpeaks.py:140](../src/ekg/preprocessing/rpeaks.py#L140) (Entscheidungslogik),
[rpeaks.py:267](../src/ekg/preprocessing/rpeaks.py#L267) (R-Position). Das Hauptergebnis nutzt
die Experten-R-Zacken; die vollautomatische Kette mit Pan-Tompkins ist zusätzlich auf DS2
ausgewertet und liegt nur knapp darunter.

## Modelle

### Was lernt das CNN, was der Baum?

Das CNN bekommt pro Schlag ein Fenster von 250 ms vor bis 450 ms nach der R-Zacke (252 Samples,
z-normiert) und lernt mit drei Faltungsblöcken selbst Formmerkmale wie QRS-Breite, Flanken,
P- und T-Welle. Ein zweiter Zweig verarbeitet 10 Zusatzmerkmale: vier RR-Merkmale (vorzeitige
Schläge erkennt man vor allem am Timing) und sechs patientenrelative Merkmale, die RR-Abstände und
Schlagform am Mittel bzw. am Median-Schlag des eigenen Records messen. Das finale Modell mittelt
die Wahrscheinlichkeiten von fünf so trainierten Netzen (Seed-Ensemble). Der Entscheidungsbaum
arbeitet dagegen auf 11 von Hand definierten, ärztlich lesbaren Merkmalen mit Tiefe 4; er ist
schwächer, aber jede Entscheidung lässt sich als Regel vorlesen.

Beleg: [cnn1d.py:60](../src/ekg/models/cnn1d.py#L60),
[segmentation.py:84](../src/ekg/preprocessing/segmentation.py#L84) (RR-Merkmale),
[patient_features.py:38](../src/ekg/preprocessing/patient_features.py#L38) (patientenrelativ),
[pipeline.py:1196](../src/ekg/pipeline.py#L1196) (Ensemble),
[tree_baseline.py:131](../src/ekg/models/tree_baseline.py#L131) (Baum-Merkmale).

### Warum scheitert F, warum Q?

F (Fusion) entsteht, wenn ein normaler und ein ventrikulärer Schlag gleichzeitig die Kammer
erregen; die Form liegt irgendwo dazwischen und ist von Person zu Person verschieden. In DS1
stammen rund 90 % der F-Schläge aus einem einzigen Record (208), das Modell lernt also im Kern die
Fusionsschläge einer Person. Das hohe Klassengewicht für F führt außerdem dazu, dass normale
Schläge fälschlich als F markiert werden. Weichere Gewichte (A2) brachten in der
Kreuzvalidierung zwar mehr N-Sensitivität, kosteten aber deutlich bei S; Klassen-Offsets (A5)
verschlechterten das Ergebnis, sobald man sie sauber verschachtelt prüft. Q bleibt nach dem
Ausschluss der Schrittmacher-Records mit einer Handvoll Schläge übrig: zu wenig zum Lernen und zum
fairen Messen.

Beleg: [train.py:107](../src/ekg/training/train.py#L107) (gedeckelte Klassengewichte),
[pipeline.py:747](../src/ekg/pipeline.py#L747) (`max_class_share` hält 208 aus der Validierung),
[EXPERIMENTS.md](EXPERIMENTS.md) (A2, A5).

### Was ist die VEB-/Fusions-Regel in EC57?

Die Norm AAMI EC57 bewertet die Erkennung ventrikulärer Extrasystolen (VEB) mit einer Sonderregel:
Ein echter Fusionsschlag, den das Modell als V erkennt, zählt für V nicht als Fehlalarm, weil er
einen ventrikulären Anteil hat. Für die Klasse F selbst bleibt er ein Fehler. In den Tabellen
berichte ich die Werte ohne diese Regel und nenne die V-PPV mit Regel zusätzlich. Außerdem
unterscheidet EC57 „gross“ (alle Records gepoolt) und „average“ (Mittel über Records); ich
berichte gross.

Beleg: [metrics.py:166](../src/ekg/evaluation/metrics.py#L166),
[metrics.py:215](../src/ekg/evaluation/metrics.py#L215) (die Regel im Code).

## Methodik

### Warum ist DS2 „heilig“, und was ist bei uns passiert?

Jedes Mal, wenn man auf die Testdaten schaut und danach etwas ändert, passt man das Modell ein
Stück an genau diese Daten an; das Ergebnis wird zu optimistisch. Bei mir wurde DS2 insgesamt
dreimal ausgewertet: Nach dem ersten Lauf fiel auf, dass Record 208 (fast alle F-Schläge) in der
Validierung saß, ich habe eine Regel nur aus DS1 abgeleitet und neu trainiert, aber eben in
Kenntnis des ersten Testergebnisses. Danach fiel jede Entscheidung nur noch per Kreuzvalidierung
auf DS1; die finale Konfiguration wurde committet (`72b1cab`) und DS2 damit genau einmal
ausgewertet. Offen benannt: Das Auswahlkriterium wurde festgelegt, als das CV-Ergebnis der
patientenrelativen Merkmale schon bekannt war; als Ensemble liegen Basis und diese Variante in der
CV gleichauf. Weil DS2 besser ausfällt als die CV, ist die CV die vorsichtigere Schätzung.

Beleg: [EXPERIMENTS.md](EXPERIMENTS.md) (Regeln, Nachtrag, A7), [PLAN.md](PLAN.md).

### Wie liefen die Agenten?

Ein Orchestrator hat das Projekt in 18 Module zerlegt und in Wellen abgearbeitet: erst
Infrastruktur und Verträge, dann 13 Agenten parallel, dann Integration, dann drei unabhängige
Reviewer plus ein Fix-Agent, zuletzt das Volltraining lokal. Jeder Agent besitzt exklusiv seine
Dateien (Ownership), programmiert gegen feste Signaturen in `INTERFACES.md` (Verträge) und meldet
Abweichungen per `state.py log`, statt still zu ändern. Den Status schreiben alle nur über
`scripts/state.py` mit Datei-Lock und atomarem Schreiben, damit sich parallele Agenten nicht
überschreiben; neue Module starten erst, wenn ihre Abhängigkeiten erledigt sind.

Beleg: [MASTERPLAN.md](../MASTERPLAN.md), [INTERFACES.md](../INTERFACES.md),
[state.py:61](../scripts/state.py#L61) (Lock), [project_state.json](../project_state.json).

### Was würde ich als Nächstes verbessern?

Aus den Experimenten habe ich gelernt, was **nicht** hilft: Mehr Epochen machen das Netz auf neuen
Patienten schlechter (es lernt die Trainingspatienten auswendig), die zweite Ableitung schadet
(sie ist nicht in allen Records dieselbe, und ihre Form ist stark personenabhängig), und
kalibrierte Klassen-Offsets heben vor allem F an, was sich nicht auf neue Patienten überträgt. Der
Engpass sind also die Daten, nicht das Netz: Als Nächstes würde ich mit weiteren Datenbanken
trainieren, damit F und S von mehr Personen stammen, und die Idee von de Chazal (2006) testen, pro
Patient die ersten Minuten zu annotieren und kurz nachzutrainieren. Für S würde ich gezielt die
P-Welle und den Rhythmus über mehrere Schläge einbeziehen, und die patientenrelativen Merkmale
würde ich laufend statt über den ganzen Record berechnen, damit das Modell echtzeitfähig wird.

Beleg: [EXPERIMENTS.md](EXPERIMENTS.md) (A1, A3, A5), [PLAN.md](PLAN.md) (A9).

## Häufige Fragen

**1. „Warum klappt V gut, S aber schlecht?“**
V-Schläge sehen anders aus (breiter, verformter QRS-Komplex), das sieht das CNN direkt in der Form.
S-Schläge haben meist einen normalen QRS-Komplex und unterscheiden sich vor allem durch das frühe
Timing und eine veränderte P-Welle. Das Timing hängt aber stark von der Person ab (Ruhepuls);
deshalb messen die patientenrelativen Merkmale die RR-Abstände am Mittel des eigenen Records.

**2. „Wie stellst du sicher, dass kein Data Leakage passiert?“**
Alle Trennungen laufen über Records, nie über Schläge: Training/Test, Validierung und die Folds der
Kreuzvalidierung. `cv` lädt DS2 gar nicht erst. Der Beat-Cache enthält einen Hash des
Vorverarbeitungs-Codes, damit nach Codeänderungen keine alten Daten weiterverwendet werden. Und
die Stelle, an der der Test-Split trotzdem mehr als einmal angeschaut wurde (drei DS2-Auswertungen
statt einer), steht offen im README.

**3. „Was ist dein eigener Anteil, wenn Agenten den Code geschrieben haben?“**
Ich habe Ziel und Leitplanken festgelegt, die Arbeitsweise mit Verträgen, Ownership und
State-Protokoll genutzt und die Entscheidungen zur Methodik getroffen, etwa DS2 zu sperren und erst
das Modell zu verbessern. Kontrolle lief über Tests, eine eigene Review-Welle und den Abgleich mit
der Realität, z. B. Pan-Tompkins gegen die Experten-Annotationen. Wichtig ist mir, jede
Entscheidung im Code erklären zu können; dafür ist dieser Zettel da.

**4. „Warum so ein kleines Netz?“**
Es gibt nur 22 Trainings-Records, und die seltenen Klassen hängen an wenigen Personen. Schon das
kleine Netz wird auf neuen Patienten schlechter, wenn es länger trainiert (A1); ein großes Netz
würde diese Personen noch stärker auswendig lernen. Außerdem trainiert es auf der CPU in wenigen
Minuten, was die vielen Kreuzvalidierungs-Läufe erst möglich macht.

**5. „Was bräuchte es für einen echten klinischen Einsatz?“**
Viel mehr und vielfältigere Daten (andere Geräte, Ableitungen, Patientengruppen), weitere externe
Tests, kalibrierte Wahrscheinlichkeiten statt nur Klassen und eine klinische Validierung. Dazu käme
die Regulierung als Medizinprodukt (in der EU die MDR) mit dokumentiertem Software-Lebenszyklus.
Dieses Projekt ist bewusst ein Lern- und Portfolio-Projekt und kein Medizinprodukt.

## Die wichtigsten Zahlen

<!-- METRICS:START -->
<!-- final: Werte aus web/public/data/metrics.json (generated_at 2026-11-03T12:05:00+00:00) und docs/EXPERIMENTS.md. Einmalige DS2-Auswertung mit Konfiguration aus Commit 72b1cab. -->

Finales CNN-Ensemble auf DS2 (Experten-R-Zacken, gepoolte Konfusionsmatrix ohne Sonderregel):

- Macro-F1 (N/S/V/F): **0,592**; über alle 5 Klassen 0,474
- N: Sensitivität 93,7 %, PPV 98,0 %
- S: Sensitivität 66,1 %, PPV 43,0 %
- V: Sensitivität 97,2 %, PPV 81,3 % (83,4 % mit EC57-VEB-Regel)
- F: praktisch null (3 von 388 erkannt)
- Größte Fehlerquelle S ↔ N: 1 545 N als S, 523 S als N
- Accuracy 92,1 % gegen 89,0 % für „immer N“
- 5 Einzelmodelle: 0,564 ± 0,048 → das Ensemble glättet die Streuung
- Ende-zu-Ende mit Pan-Tompkins: Macro-F1 0,585; Detektor auf 22 DS2-Records Se 99,39 %,
  PPV 99,79 %
- Entscheidungsbaum: Macro-F1 0,356
- Kreuzvalidierung nur auf DS1 (finale Konfiguration): 0,481 ± 0,024, als Ensemble 0,483;
  Basis als Ensemble 0,486
- Externer Test MIT-BIH Supraventricular (78 Records, ohne Nachtraining): Macro-F1 0,564;
  N 95,4 / 97,3 %, S 46,0 / 60,5 %, V 90,3 / 67,0 % (Sensitivität / PPV); nur 23 F-Schläge
- de Chazal 2004 zum Vergleich: S 75,9 / 38,5 %, V 77,7 / 81,9 % (Sensitivität / PPV)
<!-- METRICS:END -->
