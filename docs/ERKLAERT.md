# Erklärt: Spickzettel fürs Gespräch

Kurze Antworten zum Frei-Erzählen, je 2–4 Sätze, mit Verweis auf die Stelle im Code. Die
Antworten selbst enthalten keine Modellzahlen; die stehen gesammelt im Block
[Zahlen zum Merken](#zahlen-zum-merken) am Ende.

## Daten und Auswertung

### Warum inter-patient?

Ein EKG-Modell soll später bei Menschen funktionieren, die es nie gesehen hat. Mischt man Schläge
derselben Person in Training und Test (intra-patient), lernt das Modell die Eigenheiten dieser
Person und kommt auf fast perfekte, aber unrealistische Werte. Deshalb trainiere ich nur auf DS1
und teste nur auf DS2 (de Chazal 2004); auch die Validierung und die Kreuzvalidierung teilen nach
Records, nie nach einzelnen Schlägen. Einzige Eigenheit: Records 201 und 202 stammen von derselben
Person und liegen in verschiedenen Mengen.

Beleg: [loader.py:61](../src/ekg/data/loader.py#L61) (DS1/DS2),
[pipeline.py:689](../src/ekg/pipeline.py#L689) (Validierungs-Records innerhalb von DS1),
[pipeline.py:743](../src/ekg/pipeline.py#L743) (record-gruppierte Folds).

### Warum Macro-F1 statt Accuracy?

Rund 89 % der Testschläge sind normal. Ein Modell, das immer „N“ sagt, kommt damit schon auf
eine hohe Accuracy, erkennt aber keinen einzigen auffälligen Schlag. F1 ist
das harmonische Mittel aus Sensitivität (wie viele echte Schläge einer Klasse gefunden werden) und
PPV (wie viele Treffer stimmen); Macro-F1 mittelt das ungewichtet über die Klassen, sodass S, V und
F genauso zählen wie N. Q lasse ich in der Hauptzahl weg (`macro_f1_nsvf`), weil es fast keine
Q-Schläge gibt.

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
[rpeaks.py:267](../src/ekg/preprocessing/rpeaks.py#L267) (R-Position). Die Hauptauswertung nutzt
die Experten-R-Zacken; Pan-Tompkins ist die vollautomatische Alternative (`--detected-peaks`).

## Modelle

### Was lernt das CNN, was der Baum?

Das CNN bekommt pro Schlag ein Fenster von 250 ms vor bis 450 ms nach der R-Zacke (252 Samples,
z-normiert) und lernt mit drei Faltungsblöcken selbst Formmerkmale wie QRS-Breite, Flanken,
P- und T-Welle. Ein zweiter Zweig verarbeitet vier RR-Merkmale (Abstand zum vorigen und nächsten
Schlag, lokaler Mittelwert, Verhältnis), denn vorzeitige Schläge erkennt man vor allem am Timing;
beide Zweige werden am Ende zusammengeführt. Der Entscheidungsbaum arbeitet dagegen auf 11 von Hand
definierten, ärztlich lesbaren Merkmalen (QRS-Breite, R-Amplitude, Q-/S-Tiefe, T-Amplitude, RR) mit
Tiefe 4. Er ist schwächer, aber jede Entscheidung lässt sich als Regel vorlesen.

Beleg: [cnn1d.py:60](../src/ekg/models/cnn1d.py#L60),
[segmentation.py:84](../src/ekg/preprocessing/segmentation.py#L84) (RR-Merkmale),
[tree_baseline.py:131](../src/ekg/models/tree_baseline.py#L131) (Baum-Merkmale).

### Warum scheitert F, warum Q?

F (Fusion) entsteht, wenn ein normaler und ein ventrikulärer Schlag gleichzeitig die Kammer
erregen; die Form liegt irgendwo dazwischen und ist von Person zu Person verschieden. In DS1
stammen rund 90 % der F-Schläge aus einem einzigen Record (208), das Modell lernt also im Kern die
Fusionsschläge einer Person. Das hohe Klassengewicht für F führt im vorläufigen Lauf außerdem
dazu, dass normale Schläge fälschlich als F markiert werden. Q bleibt nach dem Ausschluss der
Schrittmacher-Records mit einer Handvoll Schläge übrig: zu wenig zum Lernen und zum fairen Messen.

Beleg: [train.py:104](../src/ekg/training/train.py#L104) (gedeckelte Klassengewichte),
[pipeline.py:689](../src/ekg/pipeline.py#L689) (`max_class_share` hält 208 aus der Validierung).

### Was ist die VEB-/Fusions-Regel in EC57?

Die Norm AAMI EC57 bewertet die Erkennung ventrikulärer Extrasystolen (VEB) mit einer Sonderregel:
Ein echter Fusionsschlag, den das Modell als V erkennt, zählt für V nicht als Fehlalarm, weil er
einen ventrikulären Anteil hat. Für die Klasse F selbst bleibt er ein Fehler. Außerdem
unterscheidet EC57 „gross“ (alle Records gepoolt) und „average“ (Mittel über Records); ich berichte
gross.

Beleg: [metrics.py:166](../src/ekg/evaluation/metrics.py#L166),
[metrics.py:215](../src/ekg/evaluation/metrics.py#L215) (die Regel im Code).

## Methodik

### Warum ist DS2 „heilig“, und was ist bei uns passiert?

Jedes Mal, wenn man auf die Testdaten schaut und danach etwas ändert, passt man das Modell ein
Stück an genau diese Daten an; das Ergebnis wird zu optimistisch. Bei mir wurde DS2 zweimal
ausgewertet: Nach dem ersten Lauf fiel auf, dass Record 208 (fast alle F-Schläge) in der
Validierung saß, ich habe eine Regel nur aus DS1 abgeleitet und neu trainiert, aber eben in
Kenntnis des ersten Testergebnisses. Seitdem gilt: Entscheidungen nur per Kreuzvalidierung auf DS1,
Kriterium vorher festgelegt, alles protokolliert, DS2 genau einmal am Ende.

Beleg: [EXPERIMENTS.md](EXPERIMENTS.md), [PLAN.md](PLAN.md).

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

Zuerst das Training stabilisieren: feste Epochenzahl aus der Kreuzvalidierung statt Early Stopping
auf wenigen Records, Cosine-Lernrate und leichte Augmentierung (die Optionen dafür gibt es schon in
`cv`). Dann das F-Gewicht so begrenzen, dass normale Schläge nicht mehr als F erkannt werden, die
zweite Ableitung (V1) als zweiten Kanal ausprobieren und die Entscheidungsschwellen auf den
Out-of-fold-Vorhersagen kalibrieren. Am Ende ein Seed-Ensemble, die einmalige DS2-Auswertung mit
Experten- und Pan-Tompkins-R-Zacken und, wenn möglich, ein Test auf einer fremden Datenbank.

Beleg: [PLAN.md](PLAN.md) (Phase A), [pipeline.py:910](../src/ekg/pipeline.py#L910) (`run_cv`).

## Typische Rückfragen

**1. „Warum klappt V gut, S aber schlecht?“**
V-Schläge sehen anders aus (breiter, verformter QRS-Komplex), das sieht das CNN direkt in der Form.
S-Schläge haben meist einen normalen QRS-Komplex und unterscheiden sich vor allem durch das frühe
Timing und eine veränderte P-Welle. Das Timing hängt aber stark von der Person ab (Ruhepuls), daher
die Idee der patientenrelativen Merkmale, die RR-Abstände am Mittel des eigenen Records messen.

**2. „Wie stellst du sicher, dass kein Data Leakage passiert?“**
Alle Trennungen laufen über Records, nie über Schläge: Training/Test, Validierung und die Folds der
Kreuzvalidierung. `cv` lädt DS2 gar nicht erst. Der Beat-Cache enthält einen Hash des
Vorverarbeitungs-Codes, damit nach Codeänderungen keine alten Daten weiterverwendet werden. Und
die Stelle, an der es trotzdem passiert ist (zweite DS2-Auswertung), steht offen im README.

**3. „Was ist dein eigener Anteil, wenn Agenten den Code geschrieben haben?“**
Ich habe Ziel und Leitplanken festgelegt, die Arbeitsweise mit Verträgen, Ownership und
State-Protokoll genutzt und die Entscheidungen zur Methodik getroffen, etwa DS2 zu sperren und erst
das Modell zu verbessern. Kontrolle lief über Tests, eine eigene Review-Welle und den Abgleich mit
der Realität, z. B. Pan-Tompkins gegen die Experten-Annotationen von Record 100. Wichtig ist mir,
jede Entscheidung im Code erklären zu können; dafür ist dieser Zettel da.

**4. „Warum so ein kleines Netz?“**
Es gibt nur 22 Trainings-Records, und die seltenen Klassen hängen an wenigen Personen. Ein großes
Netz würde vor allem diese Personen auswendig lernen. Das kleine CNN trainiert auf der CPU in
wenigen Minuten, was viele Kreuzvalidierungs-Läufe überhaupt erst möglich macht.

**5. „Was bräuchte es für einen echten klinischen Einsatz?“**
Viel mehr und vielfältigere Daten (andere Geräte, Ableitungen, Patientengruppen), einen externen
Test, kalibrierte Wahrscheinlichkeiten statt nur Klassen und eine klinische Validierung. Dazu käme
die Regulierung als Medizinprodukt (in der EU die MDR) mit dokumentiertem Software-Lebenszyklus.
Dieses Projekt ist bewusst ein Lern- und Portfolio-Projekt und kein Medizinprodukt.

## Zahlen zum Merken

<!-- METRICS:START -->
<!-- vorläufig: Werte aus web/public/data/metrics.json (2026-11-02, zweite DS2-Auswertung) und docs/EXPERIMENTS.md. Nach der finalen DS2-Auswertung (Plan A7) ersetzen. -->

Vorläufig, CNN auf DS2 (EC57-Gross-Statistik mit VEB-Regel):

- Macro-F1 (N/S/V/F): **0,579**; über alle 5 Klassen 0,463
- N: Sensitivität 92,0 %, PPV 97,5 %
- S: Sensitivität 69,0 %, PPV 40,2 %
- V: Sensitivität 79,2 %, PPV 93,6 %
- F: praktisch null (4 von 388 erkannt); 2 018 normale Schläge als F markiert
- Accuracy 89,6 % gegen 89,0 % für „immer N“
- Entscheidungsbaum: Macro-F1 (N/S/V/F) 0,356
- Kreuzvalidierung nur auf DS1 (Macro-F1 N/S/V/F): base 0,459 ± 0,020 · rr 0,463 ± 0,023 ·
  patient 0,481 ± 0,024
- Pan-Tompkins auf Record 100: 2 273 von 2 273 Schlägen, 0 Fehldetektionen
<!-- METRICS:END -->
