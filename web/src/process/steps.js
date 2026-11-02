// Content of the "Process" view: one entry per pipeline step, rendered by
// web/src/views/process.js together with diagrams (web/src/diagrams) and
// data panels (web/src/components).
//
// Schema (see INTERFACES.md):
//   { id, phase, title, kicker, summary, body /* HTML */, bullets: [],
//     diagram?: DIAGRAM_ID, panel?: PANEL_ID, dataFile?: string, codeRef?: string }
//
// Conventions:
// - Text is bilingual: getPhases()/getSteps() build the lists in the current
//   language (tr(de, en)), so they must be called at render time, not at import.
// - `phase` holds the display label of the phase and equals getPhases()[i].id.
// - `title`, `kicker` and `summary` are plain text (escaped by the shell).
// - `body` and `bullets` are trusted HTML; only <p>, <strong>, <em>, <code>,
//   <ul>/<li> and <a> are used, no inline styles.
// - No performance numbers are stated anywhere: model results only come from
//   metrics.json once the full MIT-BIH database has been processed.
// - Data facts about record 100 (lead names, beat counts) were read from the
//   real files in data/sample/ (100.hea, 100.atr).

import { tr } from '../lib/i18n.js';

/** Phase ids (= display names) in the current language. */
function phaseIds() {
  return {
    data: tr('Daten', 'Data'),
    signal: tr('Signal', 'Signal'),
    features: tr('Merkmale', 'Features'),
    model: tr('Modell', 'Model'),
    evaluation: tr('Evaluation', 'Evaluation'),
    project: tr('Projekt', 'Project'),
  };
}

/** Phases in display order. `id` is the value used in getSteps()[].phase. */
export function getPhases() {
  const P = phaseIds();
  return [
    { id: P.data, label: tr('Daten', 'Data') },
    { id: P.signal, label: tr('Signalverarbeitung', 'Signal processing') },
    { id: P.features, label: tr('Merkmale', 'Features') },
    { id: P.model, label: tr('Modell & Training', 'Model & training') },
    { id: P.evaluation, label: tr('Evaluation & Erklärbarkeit', 'Evaluation & explainability') },
    { id: P.project, label: tr('Projekt & Prozess', 'Project & process') },
  ];
}

export function getSteps() {
  const P = phaseIds();
  return [
  // ---------------------------------------------------------------- Daten
  {
    id: 'datenquelle',
    phase: P.data,
    kicker: 'MIT-BIH Arrhythmia Database',
    title: tr('Datenquelle: 48 annotierte Langzeit-EKGs', 'Data source: 48 annotated long-term ECGs'),
    summary: tr(
      'Grundlage ist die MIT-BIH Arrhythmia Database – der Referenzdatensatz der Arrhythmie-Forschung. Jeder einzelne Herzschlag wurde von Kardiologen beschriftet.',
      'The basis is the MIT-BIH Arrhythmia Database – the reference dataset of arrhythmia research. Every single beat was labeled by cardiologists.'),
    body: tr(`
<p>Die <strong>MIT-BIH Arrhythmia Database</strong> (Moody &amp; Mark, 2001) enthält <strong>48 halbstündige Ausschnitte</strong> aus ambulanten Zwei-Kanal-Langzeit-EKGs von <strong>47 Probanden</strong> (zwei Aufnahmen, 201 und 202, stammen von derselben Person), aufgezeichnet im Arrhythmie-Labor des Beth Israel Hospital in Boston. 23 Aufnahmen (Serie 100) wurden zufällig aus einem großen Holter-Bestand gezogen, 25 weitere (Serie 200) gezielt wegen seltener, aber klinisch bedeutsamer Rhythmusstörungen ausgewählt.</p>
<p>Technisch liegt jede Aufnahme mit <strong>360 Hz</strong> Abtastrate und <strong>11 bit</strong> Auflösung über einen Messbereich von 10 mV vor, mit <strong>2 Ableitungen</strong>: meist eine modifizierte Extremitätenableitung II (<code>MLII</code>) und eine Brustwandableitung (meist V1, gelegentlich V2, V4 oder V5). Mindestens zwei Kardiologen haben jeden Schlag unabhängig annotiert; Abweichungen wurden im Konsens aufgelöst. Die Annotationen stehen als Symbole (z.&nbsp;B. <code>N</code>, <code>A</code>, <code>V</code>) mit Sample-Position in der <code>.atr</code>-Datei.</p>
<p>Das Projekt verwendet ausschließlich die Ableitung <code>MLII</code> (Fallback: Kanal 0, falls MLII fehlt). Der Loader liest Header (<code>.hea</code>), Signal (<code>.dat</code>) und Annotationen (<code>.atr</code>) mit <code>wfdb</code> und liefert ein <code>Record</code>-Objekt mit Signal in mV, Abtastrate und allen Annotationen.</p>
<p><strong>Ehrlicher Hinweis zur Datenlage:</strong> In der Umgebung, in der dieses Projekt gebaut wurde, war <code>physionet.org</code> nicht erreichbar; dort lag nur der <em>echte</em> Record&nbsp;100 vor (Ableitungen <code>MLII</code> und <code>V5</code>, 2239 Normalschläge, 33 atriale Extrasystolen, 1 ventrikuläre Extrasystole). Alle Signal-Visualisierungen dieser Seite stammen aus diesem Record (DS2, nie im Training). Die vollständige Datenbank mit allen 48 Aufnahmen wurde anschließend lokal geladen; Training und Test laufen auf den 44 Aufnahmen von DS1 und DS2, und sämtliche Modellergebnisse stammen aus diesem lokalen Lauf.</p>
<p>Quelle: <a href="https://physionet.org/content/mitdb/">PhysioNet – MIT-BIH Arrhythmia Database</a>.</p>`, `
<p>The <strong>MIT-BIH Arrhythmia Database</strong> (Moody &amp; Mark, 2001) contains <strong>48 half-hour excerpts</strong> of ambulatory two-channel long-term ECGs from <strong>47 subjects</strong> (two records, 201 and 202, come from the same person), recorded at the arrhythmia laboratory of Beth Israel Hospital in Boston. 23 records (100 series) were drawn at random from a large Holter collection; 25 more (200 series) were selected specifically for rare but clinically significant arrhythmias.</p>
<p>Technically, each record is sampled at <strong>360 Hz</strong> with <strong>11-bit</strong> resolution over a 10 mV range and has <strong>2 leads</strong>: usually a modified limb lead II (<code>MLII</code>) and a chest lead (usually V1, occasionally V2, V4 or V5). At least two cardiologists annotated every beat independently; disagreements were resolved by consensus. The annotations are stored as symbols (e.g. <code>N</code>, <code>A</code>, <code>V</code>) with their sample position in the <code>.atr</code> file.</p>
<p>The project uses lead <code>MLII</code> only (fallback: channel 0 if MLII is missing). The loader reads the header (<code>.hea</code>), signal (<code>.dat</code>) and annotations (<code>.atr</code>) with <code>wfdb</code> and returns a <code>Record</code> object with the signal in mV, the sampling rate and all annotations.</p>
<p><strong>Honest note on the data:</strong> In the environment where this project was built, <code>physionet.org</code> was not reachable; only the <em>real</em> record&nbsp;100 was available there (leads <code>MLII</code> and <code>V5</code>, 2239 normal beats, 33 atrial premature beats, 1 premature ventricular contraction). All signal visualizations on this page come from this record (DS2, never used in training). The complete database with all 48 records was later loaded locally; training and testing run on the 44 records of DS1 and DS2, and all model results come from that local run.</p>
<p>Source: <a href="https://physionet.org/content/mitdb/">PhysioNet – MIT-BIH Arrhythmia Database</a>.</p>`),
    bullets: [
      tr('48 Aufnahmen à ca. 30 min, 47 Probanden', '48 records of about 30 min each, 47 subjects'),
      tr('360 Hz, 11 bit, 2 Ableitungen (genutzt: <code>MLII</code>)', '360 Hz, 11 bit, 2 leads (used: <code>MLII</code>)'),
      tr('Schlag-für-Schlag-Annotationen durch Kardiologen', 'Beat-by-beat annotations by cardiologists'),
      tr('Signal-Demos aus echtem Record 100 – Training und Test auf DS1/DS2 (44 Records)', 'Signal demos from the real record 100 – training and testing on DS1/DS2 (44 records)'),
    ],
    codeRef: 'src/ekg/data/loader.py',
  },
  {
    id: 'aami-klassen',
    phase: P.data,
    kicker: 'ANSI/AAMI EC57',
    title: tr('AAMI-Klassen: von 15 Symbolen zu 5 Klassen', 'AAMI classes: from 15 symbols to 5 classes'),
    summary: tr(
      'Die vielen Schlagtypen der Annotation werden nach einem internationalen Standard zu fünf Klassen zusammengefasst. Normale Schläge sind dabei mit Abstand in der Überzahl.',
      'The many beat types in the annotations are grouped into five classes according to an international standard. Normal beats are by far the majority.'),
    body: tr(`
<p>Die MIT-BIH-Annotationen unterscheiden über ein Dutzend Schlagtypen. Für vergleichbare Ergebnisse fasst die Norm <strong>ANSI/AAMI EC57</strong> sie zu fünf Klassen zusammen. Annotationen, die keinen Herzschlag bezeichnen (z.&nbsp;B. <code>+</code> für Rhythmuswechsel oder <code>~</code> für Signalqualität), werden ignoriert:</p>
<ul>
<li><strong>N</strong> – Normal und schenkelblockartige Schläge: <code>N</code>, <code>L</code>, <code>R</code>, <code>e</code>, <code>j</code></li>
<li><strong>S</strong> – supraventrikuläre Extrasystolen: <code>A</code>, <code>a</code>, <code>J</code>, <code>S</code></li>
<li><strong>V</strong> – ventrikuläre Extrasystolen: <code>V</code>, <code>E</code></li>
<li><strong>F</strong> – Fusionsschläge (ventrikulär + normal): <code>F</code></li>
<li><strong>Q</strong> – Schrittmacher-, Schrittmacher-Fusions- und nicht klassifizierbare Schläge: <code>/</code>, <code>f</code>, <code>Q</code></li>
</ul>
<p><strong>Klassenungleichgewicht:</strong> In den nicht schrittmacherstimulierten Aufnahmen gehören rund 90&nbsp;% aller Schläge zur Klasse N; F und Q sind sehr selten. Ein Modell, das stur „N“ vorhersagt, erreicht deshalb eine hohe Accuracy – und ist klinisch wertlos. Das muss beim Training (Klassengewichte) und bei der Bewertung (Metriken je Klasse) berücksichtigt werden.</p>
<p><strong>Warum S und V im Fokus stehen:</strong> Gehäufte supraventrikuläre Extrasystolen können Vorhofflimmern vorausgehen; ventrikuläre Extrasystolen – vor allem häufig, gekoppelt oder in Salven – sind ein Hinweis auf strukturelle Herzerkrankungen und ein Risikomarker für gefährliche Kammerrhythmusstörungen. Gerade diese Klassen sind selten und daher für Algorithmen schwer.</p>
<p>Die Panel-Ansicht zeigt die Klassenverteilung je Split (DS1 und DS2) aus der vollständigen Datenbank.</p>`, `
<p>The MIT-BIH annotations distinguish more than a dozen beat types. To make results comparable, the <strong>ANSI/AAMI EC57</strong> standard groups them into five classes. Annotations that do not mark a beat (e.g. <code>+</code> for a rhythm change or <code>~</code> for signal quality) are ignored:</p>
<ul>
<li><strong>N</strong> – Normal and bundle branch block beats: <code>N</code>, <code>L</code>, <code>R</code>, <code>e</code>, <code>j</code></li>
<li><strong>S</strong> – Supraventricular ectopic beats: <code>A</code>, <code>a</code>, <code>J</code>, <code>S</code></li>
<li><strong>V</strong> – Ventricular ectopic beats: <code>V</code>, <code>E</code></li>
<li><strong>F</strong> – Fusion beats (ventricular + normal): <code>F</code></li>
<li><strong>Q</strong> – Paced, paced-fusion and unclassifiable beats: <code>/</code>, <code>f</code>, <code>Q</code></li>
</ul>
<p><strong>Class imbalance:</strong> In the non-paced records, about 90&nbsp;% of all beats belong to class N; F and Q are very rare. A model that blindly predicts "N" therefore reaches a high accuracy – and is clinically worthless. This has to be accounted for in training (class weights) and in evaluation (per-class metrics).</p>
<p><strong>Why the focus is on S and V:</strong> Frequent supraventricular ectopic beats can precede atrial fibrillation; ventricular ectopic beats – especially when frequent, coupled or in runs – point to structural heart disease and are a risk marker for dangerous ventricular arrhythmias. These very classes are rare and therefore hard for algorithms.</p>
<p>The panel shows the class distribution per split (DS1 and DS2) from the full database.</p>`),
    bullets: [
      tr('Mapping im Code: <code>AAMI_MAP</code>, Klassen-Index = Reihenfolge in <code>CLASSES</code>', 'Mapping in code: <code>AAMI_MAP</code>, class index = order in <code>CLASSES</code>'),
      tr('Nicht-Schlag-Annotationen (z.&nbsp;B. <code>+</code>) werden verworfen', 'Non-beat annotations (e.g. <code>+</code>) are discarded'),
      tr('Starkes Ungleichgewicht: N dominiert, F und Q sind selten', 'Strong imbalance: N dominates, F and Q are rare'),
      tr('Klinisch kritisch und schwer: S und V', 'Clinically critical and hard: S and V'),
    ],
    panel: 'dataset',
    dataFile: 'dataset_stats.json',
    codeRef: 'src/ekg/data/loader.py',
  },
  {
    id: 'inter-patient',
    phase: P.data,
    kicker: 'de Chazal, O’Dwyer & Reilly 2004',
    title: tr('Inter-Patient-Split: DS1 trainiert, DS2 prüft', 'Inter-patient split: DS1 trains, DS2 tests'),
    summary: tr(
      'Trainings- und Testdaten stammen aus verschiedenen Aufnahmen und – bis auf ein Record-Paar derselben Person – von verschiedenen Personen. Nur so zeigt sich, ob das Modell auch bei unbekannten Patienten funktioniert.',
      'Training and test data come from different records and – except for one record pair from the same person – from different people. Only this shows whether the model also works on unseen patients.'),
    body: tr(`
<p>Herzschläge einer Person ähneln sich stark. Werden die Schläge aller Aufnahmen zufällig in Training und Test gemischt (<em>Intra-Patient-Split</em>), sieht das Modell beim Test fast identische Schläge derselben Person, die es schon im Training kannte. Es lernt dann eher „wie sieht Patient X aus“ als „wie sieht eine ventrikuläre Extrasystole aus“. Das Ergebnis sind stark überhöhte Accuracy-Werte, die sich bei neuen Patienten nicht wiederholen lassen.</p>
<p>Dieses Projekt folgt deshalb dem <strong>Inter-Patient-Schema</strong> von de Chazal, O’Dwyer &amp; Reilly (2004): Die Aufnahmen werden in zwei disjunkte Mengen mit je <strong>22 Records</strong> geteilt, die ähnliche Anteile der Schlagtypen enthalten.</p>
<ul>
<li><strong>DS1</strong> (Training und Validierung): 101, 106, 108, 109, 112, 114, 115, 116, 118, 119, 122, 124, 201, 203, 205, 207, 208, 209, 215, 220, 223, 230</li>
<li><strong>DS2</strong> (ausschließlich Test): 100, 103, 105, 111, 113, 117, 121, 123, 200, 202, 210, 212, 213, 214, 219, 221, 222, 228, 231, 232, 233, 234</li>
</ul>
<p>Die vier Aufnahmen mit Herzschrittmacher (<code>102</code>, <code>104</code>, <code>107</code>, <code>217</code>) sind gemäß AAMI-Empfehlung ausgeschlossen, da stimulierte Schläge eine eigene Morphologie haben. Die Aufnahmen 201 und 202 stammen von derselben Person, liegen aber in verschiedenen Mengen – eine bekannte, kleine Unschärfe des Standard-Splits, die zugunsten der Vergleichbarkeit mit der Literatur akzeptiert wird.</p>
<p>Der hier vorhandene Record&nbsp;100 gehört zu <strong>DS2</strong>. Er wird nur zur Veranschaulichung der Signalverarbeitung genutzt, nie zum Training.</p>`, `
<p>Beats from one person are very similar to each other. If the beats of all records are randomly mixed into training and test (<em>intra-patient split</em>), the model sees nearly identical beats of the same person at test time that it already knew from training. It then learns "what does patient X look like" rather than "what does a premature ventricular contraction look like". The result is heavily inflated accuracy values that cannot be reproduced on new patients.</p>
<p>This project therefore follows the <strong>inter-patient scheme</strong> of de Chazal, O’Dwyer &amp; Reilly (2004): the records are split into two disjoint sets of <strong>22 records</strong> each, with similar proportions of beat types.</p>
<ul>
<li><strong>DS1</strong> (training and validation): 101, 106, 108, 109, 112, 114, 115, 116, 118, 119, 122, 124, 201, 203, 205, 207, 208, 209, 215, 220, 223, 230</li>
<li><strong>DS2</strong> (test only): 100, 103, 105, 111, 113, 117, 121, 123, 200, 202, 210, 212, 213, 214, 219, 221, 222, 228, 231, 232, 233, 234</li>
</ul>
<p>The four records with a pacemaker (<code>102</code>, <code>104</code>, <code>107</code>, <code>217</code>) are excluded as recommended by AAMI, since paced beats have their own morphology. Records 201 and 202 come from the same person but sit in different sets – a known, small imprecision of the standard split that is accepted for comparability with the literature.</p>
<p>The record&nbsp;100 available here belongs to <strong>DS2</strong>. It is used only to illustrate the signal processing, never for training.</p>`),
    bullets: [
      tr('22 + 22 Records, keine Record-Überlappung; nahezu patientendisjunkt (Ausnahme 201/202, gleiche Person)', '22 + 22 records, no record overlap; nearly patient-disjoint (exception 201/202, same person)'),
      tr('Gepacte Records 102, 104, 107, 217 ausgeschlossen', 'Paced records 102, 104, 107, 217 excluded'),
      tr('Modellauswahl nur auf DS1 – DS2 wird erst am Ende einmal ausgewertet', 'Model selection on DS1 only – DS2 is evaluated once, at the very end'),
      tr('Intra-Patient-Splits blähen die Accuracy auf', 'Intra-patient splits inflate accuracy'),
    ],
    diagram: 'inter-patient-split',
    codeRef: 'src/ekg/data/loader.py',
  },

  // --------------------------------------------------------------- Signal
  {
    id: 'rohsignal',
    phase: P.signal,
    kicker: tr('Störquellen', 'Noise sources'),
    title: tr('Das Rohsignal und seine Störungen', 'The raw signal and its noise'),
    summary: tr(
      'Ein echtes EKG ist nie sauber: Atmung, Stromnetz und Muskelbewegungen überlagern das Herzsignal und müssen vor der Analyse entfernt werden.',
      'A real ECG is never clean: breathing, the power line and muscle activity overlay the cardiac signal and must be removed before analysis.'),
    body: tr(`
<p>Die Kurve unten zeigt einen etwa 10 Sekunden langen Ausschnitt aus dem echten Record&nbsp;100 (Ableitung <code>MLII</code>) – grau das Rohsignal, farbig das gefilterte Signal, dazu die erkannten R-Zacken und die Kardiologen-Annotationen. Im Rohsignal stecken typische Störquellen:</p>
<ul>
<li><strong>Baseline-Wander</strong> – eine langsame Drift der Nulllinie, vor allem durch die <em>Atmung</em> (Thoraxbewegung, Impedanzänderung) und Elektrodenbewegung. Frequenzbereich deutlich unter 1 Hz.</li>
<li><strong>Netzbrumm</strong> – elektromagnetische Einkopplung aus dem Stromnetz. Bei MIT-BIH (USA) liegt sie bei <strong>60 Hz</strong>, in Europa wären es 50 Hz.</li>
<li><strong>Muskelartefakte (EMG)</strong> – breitbandiges, hochfrequentes Rauschen durch Skelettmuskelaktivität, typisch bei Bewegung im Langzeit-EKG.</li>
<li><strong>Elektroden-Bewegungsartefakte</strong> – sprunghafte Störungen, die sich spektral mit dem EKG überlappen und nur teilweise entfernbar sind.</li>
</ul>
<p>Der relevante Informationsgehalt des EKGs für die Schlagklassifikation liegt grob zwischen 0,5 und 40 Hz: P- und T-Welle im unteren Bereich, der steile QRS-Komplex mit Energie bis in den zweistelligen Hertz-Bereich. Diese Lage bestimmt die Filterwahl im nächsten Schritt.</p>`, `
<p>The plot below shows an excerpt of about 10 seconds from the real record&nbsp;100 (lead <code>MLII</code>) – the raw signal in gray, the filtered signal in color, plus the detected R peaks and the cardiologist annotations. The raw signal contains typical noise sources:</p>
<ul>
<li><strong>Baseline wander</strong> – a slow drift of the baseline, mainly caused by <em>breathing</em> (chest movement, impedance changes) and electrode movement. Frequency range well below 1 Hz.</li>
<li><strong>Power-line interference</strong> – electromagnetic coupling from the mains. For MIT-BIH (USA) it is at <strong>60 Hz</strong>; in Europe it would be 50 Hz.</li>
<li><strong>Muscle artifacts (EMG)</strong> – broadband, high-frequency noise from skeletal muscle activity, typical of movement in long-term ECGs.</li>
<li><strong>Electrode motion artifacts</strong> – abrupt disturbances that overlap spectrally with the ECG and can only be partly removed.</li>
</ul>
<p>The information in the ECG that matters for beat classification lies roughly between 0.5 and 40 Hz: P and T waves at the low end, the steep QRS complex with energy up into the double-digit hertz range. This range determines the choice of filters in the next step.</p>`),
    bullets: [
      tr('Baseline-Wander: Atmung, &lt; 1 Hz', 'Baseline wander: breathing, &lt; 1 Hz'),
      tr('Netzbrumm: 60 Hz (USA, MIT-BIH)', 'Power-line interference: 60 Hz (USA, MIT-BIH)'),
      tr('Muskelartefakte: breitbandig, hochfrequent', 'Muscle artifacts: broadband, high-frequency'),
      tr('Gezeigt: echter Ausschnitt aus Record 100', 'Shown: real excerpt from record 100'),
    ],
    panel: 'ecg',
    dataFile: 'signal_demo.json',
  },
  {
    id: 'filterung',
    phase: P.signal,
    kicker: tr('Median-Filter + Butterworth-Bandpass', 'Median filter + Butterworth band-pass'),
    title: tr('Filterung ohne Zeitverschiebung', 'Filtering without time shift'),
    summary: tr(
      'Zwei Filterstufen entfernen erst die langsame Drift und dann alles außerhalb des EKG-typischen Frequenzbands – ohne die R-Zacke zeitlich zu verschieben.',
      'Two filter stages first remove the slow drift and then everything outside the typical ECG frequency band – without shifting the R peak in time.'),
    body: tr(`
<p><strong>Stufe 1 – Baseline-Entfernung</strong> (nach de Chazal et al., 2004): Ein <strong>Median-Filter mit 200 ms</strong> Fensterbreite entfernt QRS-Komplexe und P-Wellen, ein anschließender <strong>Median-Filter mit 600 ms</strong> auch die T-Wellen. Übrig bleibt eine Schätzung der Grundlinie, die vom Signal abgezogen wird. Median-Filter sind robust gegen die steilen QRS-Spitzen und verformen deren Kontur nicht wie ein gleitender Mittelwert.</p>
<p><strong>Stufe 2 – Bandpass 0,5–40 Hz:</strong> Ein <strong>Butterworth-Filter 4. Ordnung</strong> (maximal flacher Durchlassbereich) dämpft Rest-Drift unterhalb von 0,5 Hz sowie Muskelrauschen und Netzbrumm oberhalb von 40 Hz. Da 60 Hz bereits klar im Sperrbereich liegen, ist ein zusätzliches Notch-Filter optional (im Code vorhanden, standardmäßig aus).</p>
<p><strong>Warum zero-phase?</strong> Ein normales (kausales) IIR-Filter verzögert Signalanteile frequenzabhängig – die R-Zacke würde sich verschieben und der QRS-Komplex verzerren. Hier wird vorwärts und rückwärts gefiltert (<code>sosfiltfilt</code>, das Prinzip von <code>filtfilt</code> in Second-Order-Sections-Form für numerische Stabilität). Die Phasenverschiebungen heben sich auf, die effektive Ordnung verdoppelt sich. Das ist wichtig, weil die spätere Segmentierung feste Fenster exakt um den R-Zacken-Index schneidet. Der Preis: Das Verfahren ist nicht echtzeitfähig, für die Offline-Analyse aber ideal.</p>
<p>Das Panel zeigt den berechneten Frequenzgang (Verstärkung in dB über der Frequenz) des Bandpasses.</p>`, `
<p><strong>Stage 1 – baseline removal</strong> (after de Chazal et al., 2004): a <strong>median filter with a 200 ms</strong> window removes QRS complexes and P waves, and a subsequent <strong>600 ms median filter</strong> removes the T waves as well. What remains is an estimate of the baseline, which is subtracted from the signal. Median filters are robust against the steep QRS spikes and do not distort their contour the way a moving average does.</p>
<p><strong>Stage 2 – band-pass 0.5–40 Hz:</strong> a <strong>4th-order Butterworth filter</strong> (maximally flat passband) attenuates residual drift below 0.5 Hz as well as muscle noise and power-line interference above 40 Hz. Since 60 Hz already lies well inside the stopband, an additional notch filter is optional (present in the code, off by default).</p>
<p><strong>Why zero-phase?</strong> A normal (causal) IIR filter delays signal components depending on frequency – the R peak would shift and the QRS complex would be distorted. Here the signal is filtered forward and backward (<code>sosfiltfilt</code>, the <code>filtfilt</code> principle in second-order-sections form for numerical stability). The phase shifts cancel out and the effective order doubles. This matters because the later segmentation cuts fixed windows exactly around the R-peak index. The price: the method is not real-time capable, but ideal for offline analysis.</p>
<p>The panel shows the computed frequency response (gain in dB versus frequency) of the band-pass.</p>`),
    bullets: [
      tr('Median 200 ms → 600 ms schätzt die Grundlinie', 'Median 200 ms → 600 ms estimates the baseline'),
      tr('Butterworth-Bandpass 0,5–40 Hz, Ordnung 4', 'Butterworth band-pass 0.5–40 Hz, order 4'),
      tr('Zero-phase (<code>sosfiltfilt</code>): keine Verschiebung der R-Zacke', 'Zero-phase (<code>sosfiltfilt</code>): no shift of the R peak'),
      tr('Notch 60 Hz optional, standardmäßig deaktiviert', '60 Hz notch optional, disabled by default'),
    ],
    panel: 'filter-response',
    dataFile: 'filter_response.json',
    codeRef: 'src/ekg/preprocessing/filters.py',
  },
  {
    id: 'r-zacken',
    phase: P.signal,
    kicker: 'Pan & Tompkins 1985',
    title: tr('R-Zacken finden mit Pan-Tompkins', 'Finding R peaks with Pan-Tompkins'),
    summary: tr(
      'Bevor einzelne Herzschläge klassifiziert werden können, muss jeder Schlag gefunden werden. Ein klassischer Algorithmus macht die steile QRS-Spitze sichtbar und setzt adaptive Schwellen.',
      'Before individual beats can be classified, every beat has to be found. A classic algorithm makes the steep QRS spike stand out and applies adaptive thresholds.'),
    body: tr(`
<p>Der Algorithmus von <strong>Pan &amp; Tompkins (1985)</strong> ist bis heute die Referenz für QRS-Detektion. Er verwandelt das EKG Schritt für Schritt in ein Signal, in dem jeder QRS-Komplex als deutlicher Buckel erscheint:</p>
<ul>
<li><strong>1. Bandpass 5–15 Hz:</strong> betont den QRS-Komplex, dämpft P- und T-Welle (zu langsam) und Muskelrauschen (zu schnell).</li>
<li><strong>2. Ableitung (5-Punkt-Differenz):</strong> hebt die steilen Flanken des QRS hervor.</li>
<li><strong>3. Quadrieren:</strong> macht alle Werte positiv und verstärkt große Steigungen überproportional.</li>
<li><strong>4. Gleitende Integration (150 ms):</strong> glättet zu einer Hüllkurve, deren Breite etwa der QRS-Dauer entspricht.</li>
<li><strong>5. Adaptive Doppelschwellen:</strong> laufende Schätzungen von Signal- und Rauschpegel bestimmen, ob ein Maximum ein QRS ist. Dazu kommen eine <strong>Refraktärzeit von 200 ms</strong>, eine <strong>T-Wellen-Unterscheidung</strong> (Kandidaten innerhalb von 360 ms mit deutlich flacherer Steigung gelten als T-Welle) und eine <strong>Rücksuche</strong> mit abgesenkter Schwelle, wenn länger als 166&nbsp;% des mittleren RR-Intervalls kein Schlag gefunden wurde.</li>
</ul>
<p><strong>Abweichungen vom Original:</strong> Pan &amp; Tompkins arbeiteten mit 200 Hz und kausalen Ganzzahl-Filtern (mit Gruppenlaufzeit). Diese Implementierung nutzt bei 360 Hz einen zero-phase Butterworth-Bandpass und eine zentrierte Ableitung, sodass keine Verzögerung kompensiert werden muss. Die gefundene Markierung wird abschließend in einem Fenster von ±75 ms auf den tatsächlichen R-Gipfel im Eingangssignal verfeinert.</p>
<p>Die Güte der Detektion wird gegen die Kardiologen-Annotationen gemessen (Toleranz 150 ms; Sensitivität und positiver Vorhersagewert). Für das Training werden die <em>Referenz</em>-Positionen der Annotationen verwendet, damit Detektionsfehler die Klassifikationsbewertung nicht vermischen. Der Detektor ermöglicht eine annotationsfreie Pipeline; auf Record&nbsp;100 findet er alle Referenzschläge – das ist ein einzelner, eher leichter Record und kein Datenbank-Benchmark, und eine Klassifikation auf detektierten Schlägen wurde bisher nicht ausgewertet. Das Panel zeigt alle Zwischenstufen am echten Record&nbsp;100.</p>`, `
<p>The algorithm by <strong>Pan &amp; Tompkins (1985)</strong> is still the reference for QRS detection. Step by step, it turns the ECG into a signal in which every QRS complex shows up as a clear bump:</p>
<ul>
<li><strong>1. Band-pass 5–15 Hz:</strong> emphasizes the QRS complex and attenuates P and T waves (too slow) and muscle noise (too fast).</li>
<li><strong>2. Derivative (5-point difference):</strong> highlights the steep slopes of the QRS.</li>
<li><strong>3. Squaring:</strong> makes all values positive and amplifies large slopes disproportionately.</li>
<li><strong>4. Moving-window integration (150 ms):</strong> smooths into an envelope whose width roughly matches the QRS duration.</li>
<li><strong>5. Adaptive dual thresholds:</strong> running estimates of the signal and noise levels decide whether a maximum is a QRS. On top of that come a <strong>refractory period of 200 ms</strong>, <strong>T-wave discrimination</strong> (candidates within 360 ms with a clearly flatter slope count as T waves) and a <strong>search-back</strong> with a lowered threshold when no beat has been found for longer than 166&nbsp;% of the mean RR interval.</li>
</ul>
<p><strong>Deviations from the original:</strong> Pan &amp; Tompkins worked at 200 Hz with causal integer filters (with group delay). This implementation uses a zero-phase Butterworth band-pass and a centered derivative at 360 Hz, so no delay has to be compensated. Finally, the detected marker is refined to the actual R peak of the input signal within a ±75 ms window.</p>
<p>Detection quality is measured against the cardiologist annotations (150 ms tolerance; sensitivity and positive predictive value). Training uses the <em>reference</em> positions from the annotations so that detection errors do not contaminate the classification evaluation. The detector enables an annotation-free pipeline; on record&nbsp;100 it finds all reference beats – this is a single, rather easy record and not a database benchmark, and classification on detected beats has not been evaluated yet. The panel shows all intermediate stages on the real record&nbsp;100.</p>`),
    bullets: [
      tr('Bandpass → Ableitung → Quadrieren → Integration → Schwellen', 'Band-pass → derivative → squaring → integration → thresholds'),
      tr('Refraktärzeit 200 ms, T-Wellen-Check 360 ms', 'Refractory period 200 ms, T-wave check 360 ms'),
      tr('Rücksuche bei RR &gt; 166 % des Mittelwerts', 'Search-back when RR &gt; 166 % of the mean'),
      tr('Bewertung gegen Annotationen mit 150 ms Toleranz', 'Evaluated against annotations with 150 ms tolerance'),
    ],
    diagram: 'pan-tompkins',
    panel: 'pan-tompkins',
    dataFile: 'signal_demo.json',
    codeRef: 'src/ekg/preprocessing/rpeaks.py',
  },

  // ------------------------------------------------------------- Merkmale
  {
    id: 'segmentierung',
    phase: P.features,
    kicker: tr('Beat-Fenster', 'Beat windows'),
    title: tr('Segmentierung: jeder Herzschlag ein Fenster', 'Segmentation: one window per beat'),
    summary: tr(
      'Um jede R-Zacke wird ein festes Zeitfenster ausgeschnitten. So wird aus der langen Aufnahme eine Sammlung gleich langer Einzelschläge, die das Modell vergleichen kann.',
      'A fixed time window is cut out around every R peak. This turns the long record into a collection of equally long single beats that the model can compare.'),
    body: tr(`
<p>Für jede R-Zacke wird ein Fenster von <strong>250 ms vor</strong> bis <strong>450 ms nach</strong> der Zacke ausgeschnitten. Bei 360 Hz sind das 90 + 162 = <strong>252 Samples</strong>, die R-Zacke liegt immer an Index 90. Das Fenster ist asymmetrisch gewählt, weil es die <strong>P-Welle</strong> (vor dem QRS) und die längere <strong>T-Welle</strong> (danach) einschließen soll – beide tragen diagnostische Information, etwa eine fehlende oder deformierte P-Welle bei Extrasystolen.</p>
<p>Schläge, deren Fenster über den Anfang oder das Ende der Aufnahme hinausragen würden, werden verworfen. Jeder Schlag erhält über sein Annotationssymbol und das AAMI-Mapping sein Klassenlabel.</p>
<p><strong>z-Normalisierung je Beat:</strong> Jedes Fenster wird auf Mittelwert 0 und Standardabweichung 1 gebracht. Dadurch werden Unterschiede in Elektrodenposition, Verstärkung und Körperbau zwischen Patienten ausgeglichen; das Modell soll die <em>Form</em> lernen, nicht die absolute Amplitude. Absolute Zeitinformation geht im Fenster allerdings verloren – sie wird im nächsten Schritt über RR-Merkmale ergänzt.</p>
<p>Das Panel zeigt echte, segmentierte Schläge aus Record&nbsp;100 je vorhandener Klasse.</p>`, `
<p>For every R peak, a window from <strong>250 ms before</strong> to <strong>450 ms after</strong> the peak is cut out. At 360 Hz that is 90 + 162 = <strong>252 samples</strong>, with the R peak always at index 90. The window is asymmetric because it should include the <strong>P wave</strong> (before the QRS) and the longer <strong>T wave</strong> (after it) – both carry diagnostic information, such as a missing or deformed P wave in ectopic beats.</p>
<p>Beats whose window would extend past the start or end of the record are discarded. Each beat gets its class label from its annotation symbol via the AAMI mapping.</p>
<p><strong>Per-beat z-normalization:</strong> every window is scaled to mean 0 and standard deviation 1. This compensates for differences in electrode position, gain and body build between patients; the model should learn the <em>shape</em>, not the absolute amplitude. Absolute timing information is lost within the window, though – it is added back in the next step through RR features.</p>
<p>The panel shows real segmented beats from record&nbsp;100 for each class present.</p>`),
    bullets: [
      tr('Fenster −250 ms … +450 ms um die R-Zacke', 'Window −250 ms … +450 ms around the R peak'),
      tr('252 Samples bei 360 Hz, R an Index 90', '252 samples at 360 Hz, R at index 90'),
      tr('z-Normalisierung je Beat (Form statt Amplitude)', 'Per-beat z-normalization (shape instead of amplitude)'),
      tr('Randschläge ohne vollständiges Fenster werden verworfen', 'Edge beats without a complete window are discarded'),
    ],
    panel: 'beats',
    dataFile: 'segmentation_demo.json',
    codeRef: 'src/ekg/preprocessing/segmentation.py',
  },
  {
    id: 'rr-features',
    phase: P.features,
    kicker: tr('Rhythmus-Kontext', 'Rhythm context'),
    title: tr('RR-Merkmale: der Takt verrät die Extrasystole', 'RR features: the timing gives the ectopic beat away'),
    summary: tr(
      'Ein einzelnes Schlagfenster zeigt die Form, aber nicht den Zeitpunkt. Abstände zu den Nachbarschlägen zeigen, ob ein Schlag zu früh kam – das typische Kennzeichen von Extrasystolen.',
      'A single beat window shows the shape but not the timing. The intervals to neighboring beats show whether a beat came too early – the typical sign of ectopic beats.'),
    body: tr(`
<p>Das RR-Intervall ist der Abstand zwischen zwei aufeinanderfolgenden R-Zacken. Für jeden Schlag werden vier Merkmale (in Sekunden bzw. als Verhältnis) berechnet:</p>
<ul>
<li><code>pre_rr</code> – Abstand zum vorherigen Schlag</li>
<li><code>post_rr</code> – Abstand zum nächsten Schlag</li>
<li><code>local_rr</code> – mittleres RR der letzten bis zu 10 Schläge inkl. des aktuellen (kausal; lokaler Grundrhythmus)</li>
<li><code>pre_rr / local_rr</code> – relative Vorzeitigkeit; Werte deutlich unter 1 bedeuten „zu früh“</li>
</ul>
<p><strong>Warum das funktioniert:</strong> Extrasystolen (S und V) fallen <em>vorzeitig</em> in den Grundrhythmus ein – <code>pre_rr</code> ist kurz. Nach einer ventrikulären Extrasystole folgt oft eine <em>kompensatorische Pause</em> – <code>post_rr</code> ist lang. Gerade bei supraventrikulären Extrasystolen ist die QRS-Form häufig nahezu normal; dann ist die Vorzeitigkeit oft das entscheidende Unterscheidungsmerkmal gegenüber N.</p>
<p><strong>Warum relativ zum lokalen Rhythmus?</strong> Die Herzfrequenz unterscheidet sich stark zwischen Personen und Situationen. Ein RR von 0,6 s ist bei einem Grundrhythmus von 0,6 s normal, bei 1,0 s aber deutlich vorzeitig. Das Verhältnis <code>pre_rr / local_rr</code> macht das Merkmal zwischen Patienten vergleichbar – entscheidend für den Inter-Patient-Test.</p>`, `
<p>The RR interval is the time between two consecutive R peaks. Four features (in seconds or as a ratio) are computed for every beat:</p>
<ul>
<li><code>pre_rr</code> – interval to the previous beat</li>
<li><code>post_rr</code> – interval to the next beat</li>
<li><code>local_rr</code> – mean RR of the last up to 10 beats including the current one (causal; local baseline rhythm)</li>
<li><code>pre_rr / local_rr</code> – relative prematurity; values well below 1 mean "too early"</li>
</ul>
<p><strong>Why this works:</strong> ectopic beats (S and V) occur <em>prematurely</em> within the baseline rhythm – <code>pre_rr</code> is short. A premature ventricular contraction is often followed by a <em>compensatory pause</em> – <code>post_rr</code> is long. Especially for supraventricular ectopic beats the QRS shape is often nearly normal; prematurity is then frequently the decisive feature that sets them apart from N.</p>
<p><strong>Why relative to the local rhythm?</strong> Heart rate varies a lot between people and situations. An RR of 0.6 s is normal at a baseline rhythm of 0.6 s, but clearly premature at 1.0 s. The ratio <code>pre_rr / local_rr</code> makes the feature comparable across patients – crucial for the inter-patient test.</p>`),
    bullets: [
      tr('4 Merkmale je Schlag: pre, post, local RR, Ratio', '4 features per beat: pre, post, local RR, ratio'),
      tr('Kurzes pre_rr → vorzeitiger Schlag (S oder V)', 'Short pre_rr → premature beat (S or V)'),
      tr('Langes post_rr → kompensatorische Pause (typisch V)', 'Long post_rr → compensatory pause (typical of V)'),
      tr('Ratio normiert auf die individuelle Herzfrequenz', 'Ratio normalizes to the individual heart rate'),
    ],
    codeRef: 'src/ekg/preprocessing/segmentation.py',
  },

  // --------------------------------------------------------------- Modell
  {
    id: 'cnn-architektur',
    phase: P.model,
    kicker: 'ECGNet1D · PyTorch',
    title: tr('1D-CNN: gelernte Mustererkenner plus Rhythmus', '1D CNN: learned pattern detectors plus rhythm'),
    summary: tr(
      'Ein kompaktes neuronales Netz lernt selbst, welche Kurvenformen typisch für jede Schlagklasse sind, und kombiniert das mit den RR-Merkmalen.',
      'A compact neural network learns by itself which waveform shapes are typical of each beat class and combines this with the RR features.'),
    body: tr(`
<p>Ein <strong>eindimensionales Convolutional Neural Network</strong> schiebt kleine, gelernte Filter (Kernel) über das 252-Sample-Fenster. Jeder Kernel ist ein <em>Mustererkenner</em>: Er reagiert stark, wo das Signal seiner Form ähnelt – etwa einer steilen Flanke, einem breiten QRS oder einer invertierten Welle. Anders als beim Entscheidungsbaum werden diese Merkmale nicht von Hand definiert, sondern aus den Daten gelernt.</p>
<p><strong>Morphologie-Zweig:</strong> drei Blöcke aus <code>Conv1d</code> (16, 32, 64 Kanäle; Kernelgrößen 7, 5, 3) → <code>BatchNorm1d</code> → <code>ReLU</code> → <code>MaxPool1d(2)</code>. Jedes Pooling halbiert die zeitliche Auflösung; tiefere Schichten „sehen“ dadurch größere Abschnitte des Schlags und kombinieren einfache Muster zu komplexeren. Ein <code>AdaptiveAvgPool1d</code> verdichtet am Ende jeden der 64 Kanäle zu einer Zahl.</p>
<p><strong>RR-Zweig und Fusion:</strong> Die vier RR-Merkmale werden normalisiert (<code>BatchNorm1d</code>) und über eine kleine lineare Schicht (16 Neuronen) eingebettet. Beide Zweige werden <strong>konkateniert</strong> (64 + 16 = 80 Werte) und von einem Klassifikationskopf (<code>Linear</code> 80 → 64, <code>ReLU</code>, <code>Dropout 0.3</code>, <code>Linear</code> 64 → 5) in fünf Logits übersetzt – je einen pro AAMI-Klasse. So kann das Netz Form <em>und</em> Zeitpunkt eines Schlags gemeinsam bewerten.</p>
<p>Das Netz ist bewusst klein gehalten, um auf der CPU trainierbar zu sein und Überanpassung an die Patienten von DS1 zu begrenzen. Das Panel listet alle Schichten mit Ausgabeform und Parameterzahl, berechnet direkt aus dem Modell.</p>`, `
<p>A <strong>one-dimensional convolutional neural network</strong> slides small learned filters (kernels) across the 252-sample window. Each kernel is a <em>pattern detector</em>: it responds strongly where the signal resembles its shape – such as a steep slope, a wide QRS or an inverted wave. Unlike in the decision tree, these features are not defined by hand but learned from the data.</p>
<p><strong>Morphology branch:</strong> three blocks of <code>Conv1d</code> (16, 32, 64 channels; kernel sizes 7, 5, 3) → <code>BatchNorm1d</code> → <code>ReLU</code> → <code>MaxPool1d(2)</code>. Each pooling step halves the temporal resolution, so deeper layers "see" larger sections of the beat and combine simple patterns into more complex ones. At the end, an <code>AdaptiveAvgPool1d</code> condenses each of the 64 channels into a single number.</p>
<p><strong>RR branch and fusion:</strong> the four RR features are normalized (<code>BatchNorm1d</code>) and embedded through a small linear layer (16 neurons). Both branches are <strong>concatenated</strong> (64 + 16 = 80 values) and mapped by a classification head (<code>Linear</code> 80 → 64, <code>ReLU</code>, <code>Dropout 0.3</code>, <code>Linear</code> 64 → 5) to five logits – one per AAMI class. This lets the network assess the shape <em>and</em> timing of a beat together.</p>
<p>The network is deliberately kept small so that it can be trained on a CPU and to limit overfitting to the DS1 patients. The panel lists all layers with output shape and parameter count, computed directly from the model.</p>`),
    bullets: [
      tr('3 Faltungsblöcke: 16 → 32 → 64 Kanäle, Kernel 7 / 5 / 3', '3 convolution blocks: 16 → 32 → 64 channels, kernels 7 / 5 / 3'),
      tr('Pooling verdichtet und vergrößert das rezeptive Feld', 'Pooling condenses and enlarges the receptive field'),
      tr('RR-Zweig (4 → 16) wird mit der Morphologie fusioniert', 'RR branch (4 → 16) is fused with the morphology'),
      tr('Ausgabe: 5 Logits für N, S, V, F, Q', 'Output: 5 logits for N, S, V, F, Q'),
    ],
    diagram: 'layer-architecture',
    panel: 'architecture',
    dataFile: 'architecture.json',
    codeRef: 'src/ekg/models/cnn1d.py',
  },
  {
    id: 'training',
    phase: P.model,
    kicker: tr('Gewichtete Verlustfunktion', 'Weighted loss function'),
    title: tr('Training gegen das Ungleichgewicht', 'Training against the imbalance'),
    summary: tr(
      'Weil normale Schläge so dominieren, werden Fehler bei seltenen Klassen stärker bestraft. Die Testdaten DS2 bleiben während des gesamten Trainings unangetastet.',
      'Because normal beats dominate so strongly, errors on rare classes are penalized more. The DS2 test data remain untouched throughout training.'),
    body: tr(`
<p><strong>Gewichtete Cross-Entropy:</strong> Die Verlustfunktion gewichtet jede Klasse invers zu ihrer Häufigkeit im Trainingsdatensatz. Ein falsch erkannter S-Schlag kostet damit deutlich mehr als ein falsch erkannter N-Schlag. Ohne diese Gewichtung würde das Netz die seltenen, aber klinisch wichtigen Klassen weitgehend ignorieren. Klassen, die im Training gar nicht vorkommen, erhalten Gewicht 0.</p>
<p><strong>Optimierung:</strong> Der <strong>Adam</strong>-Optimierer passt die Lernrate je Parameter adaptiv an; trainiert wird in Mini-Batches über mehrere Epochen mit festem Zufalls-Seed für Reproduzierbarkeit.</p>
<p><strong>Validierung nur auf DS1:</strong> Für Modellauswahl und Early Stopping wird ein Hold-out-Teil <em>aus DS1</em> verwendet. DS2 wird weder für die Wahl von Hyperparametern noch für den Stopp-Zeitpunkt herangezogen – sonst würde Testinformation ins Modell „durchsickern“ und das Ergebnis geschönt.</p>
<p><strong>Early Stopping:</strong> Nach jeder Epoche werden Validierungs-Loss und Macro-F1 protokolliert. Verbessert sich die Validierung nicht mehr, wird das Training beendet und der beste Zustand behalten – das begrenzt Überanpassung an die Trainingspatienten.</p>
<p><strong>Aktueller Stand:</strong> Das Training auf dem vollständigen DS1 wurde lokal ausgeführt; die Kurve zeigt den echten Verlauf aus <code>metrics.json</code>. Validiert wird auf den DS1-Records 114, 119, 122 und 201: Record 208 enthält rund 90&nbsp;% aller F-Schläge von DS1 und bleibt deshalb im Training. Trotzdem lernt das CNN F kaum übertragbar – fast alle F-Beispiele stammen von diesem einen Patienten.</p>`, `
<p><strong>Weighted cross-entropy:</strong> the loss function weights each class inversely to its frequency in the training set. A misclassified S beat therefore costs much more than a misclassified N beat. Without this weighting, the network would largely ignore the rare but clinically important classes. Classes that do not occur in training at all get weight 0.</p>
<p><strong>Optimization:</strong> the <strong>Adam</strong> optimizer adapts the learning rate per parameter; training runs in mini-batches over several epochs with a fixed random seed for reproducibility.</p>
<p><strong>Validation on DS1 only:</strong> a hold-out part <em>of DS1</em> is used for model selection and early stopping. DS2 is used neither for choosing hyperparameters nor for the stopping point – otherwise test information would "leak" into the model and make the result look better than it is.</p>
<p><strong>Early stopping:</strong> after every epoch, validation loss and macro F1 are logged. When validation stops improving, training ends and the best state is kept – this limits overfitting to the training patients.</p>
<p><strong>Current status:</strong> training on the full DS1 was run locally; the curve shows the real history from <code>metrics.json</code>. Validation uses DS1 records 114, 119, 122 and 201: record 208 contains about 90&nbsp;% of all F beats in DS1 and therefore stays in training. Even so, the CNN learns hardly any transferable F pattern – almost all F examples come from this one patient.</p>`),
    bullets: [
      tr('Klassengewichte invers zur Häufigkeit', 'Class weights inverse to frequency'),
      tr('Adam-Optimierer, Mini-Batches, fester Seed', 'Adam optimizer, mini-batches, fixed seed'),
      tr('Validierung und Early Stopping nur auf DS1-Hold-out', 'Validation and early stopping on a DS1 hold-out only'),
      tr('DS2 bleibt bis zur Endauswertung unberührt', 'DS2 stays untouched until the final evaluation'),
    ],
    diagram: 'training-loop',
    panel: 'training',
    dataFile: 'metrics.json',
    codeRef: 'src/ekg/training/train.py',
  },

  // ----------------------------------------------------------- Evaluation
  {
    id: 'evaluation',
    phase: P.evaluation,
    kicker: tr('AAMI-Metriken', 'AAMI metrics'),
    title: tr('Evaluation: warum Accuracy in die Irre führt', 'Evaluation: why accuracy is misleading'),
    summary: tr(
      'Bewertet wird pro Klasse: Wie viele echte Extrasystolen wurden gefunden, und wie oft lag ein Alarm richtig? Eine einzelne Gesamtquote würde die seltenen Klassen verschleiern.',
      'Evaluation is per class: how many real ectopic beats were found, and how often was an alarm correct? A single overall rate would hide the rare classes.'),
    body: tr(`
<p>Grundlage ist die <strong>Konfusionsmatrix</strong> auf DS2: Zeilen sind die wahren Klassen, Spalten die Vorhersagen. Daraus ergeben sich je Klasse (Bezeichnungen nach AAMI EC57):</p>
<ul>
<li><strong>Sensitivität (Se)</strong> = TP / (TP + FN) – Anteil der echten Schläge einer Klasse, die gefunden wurden.</li>
<li><strong>Positiver Vorhersagewert (+P, PPV)</strong> = TP / (TP + FP) – Anteil der Vorhersagen einer Klasse, die stimmen.</li>
<li><strong>Spezifität (Sp)</strong> = TN / (TN + FP) – Anteil der übrigen Schläge, die korrekt <em>nicht</em> dieser Klasse zugeordnet wurden.</li>
<li><strong>F1</strong> – harmonisches Mittel aus Se und PPV; <strong>Macro-F1</strong> mittelt F1 ungewichtet über die Klassen, sodass seltene Klassen gleich zählen.</li>
</ul>
<p><strong>Warum nicht Accuracy?</strong> Wenn rund 90&nbsp;% aller Schläge zur Klasse N gehören, erreicht ein Modell, das nie etwas anderes als N vorhersagt, eine Accuracy von etwa 90&nbsp;% – bei einer Sensitivität von 0 für S und V. Accuracy misst vor allem, wie gut die Mehrheitsklasse erkannt wird. Deshalb stehen hier <strong>Se und PPV für S und V</strong> sowie Macro-F1 im Vordergrund; Accuracy wird nur ergänzend berichtet.</p>
<p>Ergebnisse werden ausschließlich aus einem vollständigen DS1 → DS2-Lauf angezeigt. Solange der fehlt, bleibt das Panel bewusst leer – es gibt hier keine erfundenen oder auf einem einzelnen Record berechneten Kennzahlen.</p>`, `
<p>The basis is the <strong>confusion matrix</strong> on DS2: rows are the true classes, columns the predictions. From it, the following are derived per class (terms as in AAMI EC57):</p>
<ul>
<li><strong>Sensitivity (Se)</strong> = TP / (TP + FN) – share of the true beats of a class that were found.</li>
<li><strong>Positive predictive value (+P, PPV)</strong> = TP / (TP + FP) – share of a class's predictions that are correct.</li>
<li><strong>Specificity (Sp)</strong> = TN / (TN + FP) – share of the remaining beats that were correctly <em>not</em> assigned to this class.</li>
<li><strong>F1</strong> – harmonic mean of Se and PPV; <strong>macro F1</strong> averages F1 over the classes without weighting, so rare classes count equally.</li>
</ul>
<p><strong>Why not accuracy?</strong> If about 90&nbsp;% of all beats belong to class N, a model that never predicts anything but N reaches an accuracy of about 90&nbsp;% – with a sensitivity of 0 for S and V. Accuracy mainly measures how well the majority class is recognized. That is why <strong>Se and PPV for S and V</strong> and macro F1 are in the foreground here; accuracy is only reported as a supplement.</p>
<p>Results are shown only from a complete DS1 → DS2 run. As long as it is missing, the panel deliberately stays empty – there are no made-up metrics here, and none computed on a single record.</p>`),
    bullets: [
      tr('Konfusionsmatrix: Zeilen = wahr, Spalten = vorhergesagt', 'Confusion matrix: rows = true, columns = predicted'),
      tr('Se, PPV, Spezifität und F1 je Klasse', 'Se, PPV, specificity and F1 per class'),
      tr('Macro-F1 gewichtet alle Klassen gleich', 'Macro F1 weights all classes equally'),
      tr('Accuracy allein ist bei ~90 % N irreführend', 'Accuracy alone is misleading at ~90 % N'),
    ],
    panel: 'confusion',
    dataFile: 'metrics.json',
    codeRef: 'src/ekg/evaluation/metrics.py',
  },
  {
    id: 'erklaerbarkeit',
    phase: P.evaluation,
    kicker: tr('Interpretierbarer Vergleich', 'Interpretable comparison'),
    title: tr('Erklärbarkeit: Entscheidungsbaum und klinische Logik', 'Explainability: decision tree and clinical logic'),
    summary: tr(
      'Ein neuronales Netz ist schwer zu durchschauen. Ein kleiner Entscheidungsbaum mit verständlichen Merkmalen zeigt dagegen Regel für Regel, warum ein Schlag einer Klasse zugeordnet wird.',
      'A neural network is hard to see through. A small decision tree with understandable features, by contrast, shows rule by rule why a beat is assigned to a class.'),
    body: tr(`
<p><strong>Entscheidungsbaum als Vergleichsmodell:</strong> Statt roher Samples erhält der Baum wenige, klinisch interpretierbare Merkmale: <code>qrs_width_ms</code> (QRS-Breite), <code>r_amplitude</code>, <code>q_depth</code>, <code>s_depth</code>, <code>qrs_area</code>, <code>t_amplitude</code>, <code>beat_energy</code> (Energieanteil im QRS-Fenster) sowie die vier RR-Merkmale. Der Baum ist auf eine Tiefe von 4 begrenzt und nutzt balancierte Klassengewichte. Jeder Pfad von der Wurzel zu einem Blatt ist eine lesbare Wenn-dann-Regel; jeder Knoten zeigt Merkmal, Schwelle und Anzahl der Schläge. Der Baum wird ausschließlich auf DS1 trainiert und erscheint im Panel, sobald dieses Training gelaufen ist.</p>
<p><strong>Klinische Entscheidungslogik (Diagramm):</strong> Das Diagramm darunter ist <em>ausdrücklich erklärend und nicht gelernt</em>. Es skizziert, wie Kardiologen grob vorgehen: Kommt der Schlag vorzeitig (kurzes RR)? Ist der QRS-Komplex breit und deformiert (Hinweis auf ventrikulären Ursprung, V) oder schmal und normal geformt (supraventrikulär, S)? Trägt er Merkmale beider Formen (Fusion, F)? Diese Logik dient als Lesehilfe für die gelernten Modelle – sie ist kein Diagnosewerkzeug.</p>
<p><strong>Was der Vergleich zeigt:</strong> Wenn Baum und CNN ähnliche Merkmale nutzen (Vorzeitigkeit, QRS-Breite), stützt das die Plausibilität des CNN. Der Baum ist leichter zu prüfen, aber in seiner Ausdrucksstärke begrenzt; das CNN kann subtilere Formmerkmale nutzen, ist aber schwerer zu erklären.</p>`, `
<p><strong>Decision tree as a comparison model:</strong> instead of raw samples, the tree receives a few clinically interpretable features: <code>qrs_width_ms</code> (QRS width), <code>r_amplitude</code>, <code>q_depth</code>, <code>s_depth</code>, <code>qrs_area</code>, <code>t_amplitude</code>, <code>beat_energy</code> (share of energy in the QRS window) plus the four RR features. The tree is limited to a depth of 4 and uses balanced class weights. Every path from the root to a leaf is a readable if-then rule; every node shows the feature, threshold and number of beats. The tree is trained on DS1 only and appears in the panel as soon as that training has run.</p>
<p><strong>Clinical decision logic (diagram):</strong> the diagram below is <em>explicitly explanatory, not learned</em>. It sketches roughly how cardiologists proceed: is the beat premature (short RR)? Is the QRS complex wide and deformed (pointing to a ventricular origin, V) or narrow and normally shaped (supraventricular, S)? Does it show features of both (fusion, F)? This logic serves as a reading aid for the learned models – it is not a diagnostic tool.</p>
<p><strong>What the comparison shows:</strong> if the tree and the CNN rely on similar features (prematurity, QRS width), that supports the plausibility of the CNN. The tree is easier to check but limited in expressiveness; the CNN can use subtler shape features but is harder to explain.</p>`),
    bullets: [
      tr('Baum (Tiefe ≤ 4) auf 11 interpretierbaren Merkmalen', 'Tree (depth ≤ 4) on 11 interpretable features'),
      tr('Jeder Pfad = lesbare Wenn-dann-Regel', 'Every path = a readable if-then rule'),
      tr('Diagramm: klinische Logik, erklärend – nicht gelernt', 'Diagram: clinical logic, explanatory – not learned'),
      tr('Baum erscheint erst nach echtem DS1-Training', 'Tree appears only after real DS1 training'),
    ],
    diagram: 'decision-tree-logic',
    panel: 'tree',
    dataFile: 'tree.json',
    codeRef: 'src/ekg/models/tree_baseline.py',
  },

  // -------------------------------------------------------------- Projekt
  {
    id: 'agenten-prozess',
    phase: P.project,
    kicker: tr('Multi-Agent-Orchestrierung', 'Multi-agent orchestration'),
    title: tr('Wie dieses Projekt entstanden ist', 'How this project was built'),
    summary: tr(
      'Das Projekt wurde von einem koordinierenden KI-Agenten geplant und in kleine, unabhängige Aufgaben zerlegt, die bis zu 16 Sub-Agenten parallel bearbeitet haben.',
      'The project was planned by a coordinating AI agent and broken down into small, independent tasks that up to 16 sub-agents worked on in parallel.'),
    body: tr(`
<p>Ein <strong>Mother-Agent</strong> (Orchestrator) hat den Masterplan erstellt, ihn in isolierte Module zerlegt (z.&nbsp;B. Daten-Loader, Filter, R-Zacken-Detektion, CNN, Entscheidungsbaum, Metriken, API, UI-Shell, Diagramme, Charts, Inhalte) und diese an Sub-Agenten verteilt – nie mehr als <strong>16 gleichzeitig</strong>.</p>
<p><strong>Zentrale Status-Datei:</strong> Alle Module, ihre Abhängigkeiten, Dateien und ihr Fortschritt stehen in <code>project_state.json</code>. Sub-Agenten ändern sie nie direkt, sondern über ein Status-Protokoll (<code>scripts/state.py</code>):</p>
<ul>
<li><code>start</code> – Modul wird bearbeitet (<em>in_progress</em>)</li>
<li><code>done</code> – Abschluss mit Zusammenfassung, Entscheidungen, Dateien und Testergebnissen</li>
<li><code>fail</code> – Fehler mit Log-Auszug; der Orchestrator korrigiert die Anweisung und startet das Modul neu</li>
<li><code>log</code> – dokumentierte Abweichung vom Schnittstellenvertrag</li>
</ul>
<p><strong>Konfliktvermeidung:</strong> Bindende Funktionssignaturen stehen in <code>INTERFACES.md</code>, sodass Module parallel gegeneinander entwickelt werden konnten. Jedes Modul besitzt exklusiv seine Dateien. Vor jeder neuen Welle liest der Orchestrator den Stand und startet nur Module, deren Abhängigkeiten erfüllt sind.</p>
<p><strong>Wellen:</strong> Welle 1 baut alle Grundmodule parallel; Welle 2 integriert Pipeline und Oberfläche; Welle 3 ist ein unabhängiges Review mit anschließenden Korrekturen; Welle 4 – das Volltraining auf DS1 → DS2 – wurde lokal ausgeführt, sobald die vollständige Datenbank vorlag. Den Stand aller Module zeigt die Seite „Wie es gebaut wurde“.</p>`, `
<p>A <strong>mother agent</strong> (orchestrator) created the master plan, broke it down into isolated modules (e.g. data loader, filters, R-peak detection, CNN, decision tree, metrics, API, UI shell, diagrams, charts, content) and distributed them to sub-agents – never more than <strong>16 at a time</strong>.</p>
<p><strong>Central state file:</strong> all modules, their dependencies, files and progress are kept in <code>project_state.json</code>. Sub-agents never edit it directly, only through a status protocol (<code>scripts/state.py</code>):</p>
<ul>
<li><code>start</code> – module is being worked on (<em>in_progress</em>)</li>
<li><code>done</code> – completion with summary, decisions, files and test results</li>
<li><code>fail</code> – error with a log excerpt; the orchestrator corrects the instructions and restarts the module</li>
<li><code>log</code> – documented deviation from the interface contract</li>
</ul>
<p><strong>Avoiding conflicts:</strong> binding function signatures are defined in <code>INTERFACES.md</code>, so modules could be developed against each other in parallel. Each module owns its files exclusively. Before every new wave, the orchestrator reads the current state and starts only modules whose dependencies are met.</p>
<p><strong>Waves:</strong> wave 1 builds all base modules in parallel; wave 2 integrates the pipeline and the UI; wave 3 is an independent review followed by fixes; wave 4 – the full training on DS1 → DS2 – was run locally as soon as the complete database was available. The “How it was built” page shows the state of every module.</p>`),
    bullets: [
      tr('Max. 16 Sub-Agenten parallel, je ein isoliertes Modul', 'Max. 16 sub-agents in parallel, one isolated module each'),
      tr('Zentraler Stand in <code>project_state.json</code>', 'Central state in <code>project_state.json</code>'),
      tr('Status-Protokoll: start, done, fail, log', 'Status protocol: start, done, fail, log'),
      tr('Bindende Verträge in <code>INTERFACES.md</code>', 'Binding contracts in <code>INTERFACES.md</code>'),
    ],
    diagram: 'agent-orchestration',
  },
  ];
}
