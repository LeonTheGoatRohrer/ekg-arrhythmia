// Content of the "Process" view: one entry per pipeline step, rendered by
// web/src/views/process.js together with diagrams (web/src/diagrams) and
// data panels (web/src/components).
//
// Schema (see INTERFACES.md):
//   { id, phase, title, kicker, summary, body /* HTML */, bullets: [],
//     diagram?: DIAGRAM_ID, panel?: PANEL_ID, dataFile?: string, codeRef?: string }
//
// Conventions:
// - `phase` holds the display label of the phase and equals PHASES[i].id.
// - `title`, `kicker` and `summary` are plain text (escaped by the shell).
// - `body` and `bullets` are trusted HTML; only <p>, <strong>, <em>, <code>,
//   <ul>/<li> and <a> are used, no inline styles.
// - No performance numbers are stated anywhere: model results only come from
//   metrics.json once the full MIT-BIH database has been processed.
// - Data facts about record 100 (lead names, beat counts) were read from the
//   real files in data/sample/ (100.hea, 100.atr).

/** Phases in display order. `id` is the value used in STEPS[].phase. */
export const PHASES = [
  { id: 'Daten', label: 'Daten' },
  { id: 'Signal', label: 'Signalverarbeitung' },
  { id: 'Merkmale', label: 'Merkmale' },
  { id: 'Modell', label: 'Modell & Training' },
  { id: 'Evaluation', label: 'Evaluation & Erklärbarkeit' },
  { id: 'Projekt', label: 'Projekt & Prozess' },
];

export const STEPS = [
  // ---------------------------------------------------------------- Daten
  {
    id: 'datenquelle',
    phase: 'Daten',
    kicker: 'MIT-BIH Arrhythmia Database',
    title: 'Datenquelle: 48 annotierte Langzeit-EKGs',
    summary:
      'Grundlage ist die MIT-BIH Arrhythmia Database – der Referenzdatensatz der Arrhythmie-Forschung. Jeder einzelne Herzschlag wurde von Kardiologen beschriftet.',
    body: `
<p>Die <strong>MIT-BIH Arrhythmia Database</strong> (Moody &amp; Mark, 2001) enthält <strong>48 halbstündige Ausschnitte</strong> aus ambulanten Zwei-Kanal-Langzeit-EKGs von <strong>47 Probanden</strong> (zwei Aufnahmen, 201 und 202, stammen von derselben Person), aufgezeichnet im Arrhythmie-Labor des Beth Israel Hospital in Boston. 23 Aufnahmen (Serie 100) wurden zufällig aus einem großen Holter-Bestand gezogen, 25 weitere (Serie 200) gezielt wegen seltener, aber klinisch bedeutsamer Rhythmusstörungen ausgewählt.</p>
<p>Technisch liegt jede Aufnahme mit <strong>360 Hz</strong> Abtastrate und <strong>11 bit</strong> Auflösung über einen Messbereich von 10 mV vor, mit <strong>2 Ableitungen</strong>: meist eine modifizierte Extremitätenableitung II (<code>MLII</code>) und eine Brustwandableitung (meist V1, gelegentlich V2, V4 oder V5). Mindestens zwei Kardiologen haben jeden Schlag unabhängig annotiert; Abweichungen wurden im Konsens aufgelöst. Die Annotationen stehen als Symbole (z.&nbsp;B. <code>N</code>, <code>A</code>, <code>V</code>) mit Sample-Position in der <code>.atr</code>-Datei.</p>
<p>Das Projekt verwendet ausschließlich die Ableitung <code>MLII</code> (Fallback: Kanal 0, falls MLII fehlt). Der Loader liest Header (<code>.hea</code>), Signal (<code>.dat</code>) und Annotationen (<code>.atr</code>) mit <code>wfdb</code> und liefert ein <code>Record</code>-Objekt mit Signal in mV, Abtastrate und allen Annotationen.</p>
<p><strong>Ehrlicher Hinweis zur Datenlage:</strong> In der Umgebung, in der dieses Projekt gebaut wurde, ist <code>physionet.org</code> gesperrt. Vorhanden ist nur der <em>echte</em> Record&nbsp;100 (Ableitungen <code>MLII</code> und <code>V5</code>, 2239 Normalschläge, 33 atriale Extrasystolen, 1 ventrikuläre Extrasystole). Alle Signal-Visualisierungen dieser Seite stammen aus diesem Record. Das Volltraining auf allen Aufnahmen steht aus; bis dahin werden <em>keine</em> Modellergebnisse angezeigt.</p>
<p>Quelle: <a href="https://physionet.org/content/mitdb/">PhysioNet – MIT-BIH Arrhythmia Database</a>.</p>`,
    bullets: [
      '48 Aufnahmen à ca. 30 min, 47 Probanden',
      '360 Hz, 11 bit, 2 Ableitungen (genutzt: <code>MLII</code>)',
      'Schlag-für-Schlag-Annotationen durch Kardiologen',
      'Hier verfügbar: nur echter Record 100 – Volltraining ausstehend',
    ],
    codeRef: 'src/ekg/data/loader.py',
  },
  {
    id: 'aami-klassen',
    phase: 'Daten',
    kicker: 'ANSI/AAMI EC57',
    title: 'AAMI-Klassen: von 15 Symbolen zu 5 Klassen',
    summary:
      'Die vielen Schlagtypen der Annotation werden nach einem internationalen Standard zu fünf Klassen zusammengefasst. Normale Schläge sind dabei mit Abstand in der Überzahl.',
    body: `
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
<p>Die Panel-Ansicht zeigt die Klassenverteilung je Split, sobald die vollständige Datenbank verarbeitet wurde.</p>`,
    bullets: [
      'Mapping im Code: <code>AAMI_MAP</code>, Klassen-Index = Reihenfolge in <code>CLASSES</code>',
      'Nicht-Schlag-Annotationen (z.&nbsp;B. <code>+</code>) werden verworfen',
      'Starkes Ungleichgewicht: N dominiert, F und Q sind selten',
      'Klinisch kritisch und schwer: S und V',
    ],
    panel: 'dataset',
    dataFile: 'dataset_stats.json',
    codeRef: 'src/ekg/data/loader.py',
  },
  {
    id: 'inter-patient',
    phase: 'Daten',
    kicker: 'de Chazal, O’Dwyer & Reilly 2004',
    title: 'Inter-Patient-Split: DS1 trainiert, DS2 prüft',
    summary:
      'Trainings- und Testdaten stammen aus verschiedenen Aufnahmen und – bis auf ein Record-Paar derselben Person – von verschiedenen Personen. Nur so zeigt sich, ob das Modell auch bei unbekannten Patienten funktioniert.',
    body: `
<p>Herzschläge einer Person ähneln sich stark. Werden die Schläge aller Aufnahmen zufällig in Training und Test gemischt (<em>Intra-Patient-Split</em>), sieht das Modell beim Test fast identische Schläge derselben Person, die es schon im Training kannte. Es lernt dann eher „wie sieht Patient X aus“ als „wie sieht eine ventrikuläre Extrasystole aus“. Das Ergebnis sind stark überhöhte Accuracy-Werte, die sich bei neuen Patienten nicht wiederholen lassen.</p>
<p>Dieses Projekt folgt deshalb dem <strong>Inter-Patient-Schema</strong> von de Chazal, O’Dwyer &amp; Reilly (2004): Die Aufnahmen werden in zwei disjunkte Mengen mit je <strong>22 Records</strong> geteilt, die ähnliche Anteile der Schlagtypen enthalten.</p>
<ul>
<li><strong>DS1</strong> (Training und Validierung): 101, 106, 108, 109, 112, 114, 115, 116, 118, 119, 122, 124, 201, 203, 205, 207, 208, 209, 215, 220, 223, 230</li>
<li><strong>DS2</strong> (ausschließlich Test): 100, 103, 105, 111, 113, 117, 121, 123, 200, 202, 210, 212, 213, 214, 219, 221, 222, 228, 231, 232, 233, 234</li>
</ul>
<p>Die vier Aufnahmen mit Herzschrittmacher (<code>102</code>, <code>104</code>, <code>107</code>, <code>217</code>) sind gemäß AAMI-Empfehlung ausgeschlossen, da stimulierte Schläge eine eigene Morphologie haben. Die Aufnahmen 201 und 202 stammen von derselben Person, liegen aber in verschiedenen Mengen – eine bekannte, kleine Unschärfe des Standard-Splits, die zugunsten der Vergleichbarkeit mit der Literatur akzeptiert wird.</p>
<p>Der hier vorhandene Record&nbsp;100 gehört zu <strong>DS2</strong>. Er wird nur zur Veranschaulichung der Signalverarbeitung genutzt, nie zum Training.</p>`,
    bullets: [
      '22 + 22 Records, keine Record-Überlappung; nahezu patientendisjunkt (Ausnahme 201/202, gleiche Person)',
      'Gepacte Records 102, 104, 107, 217 ausgeschlossen',
      'Modellauswahl nur auf DS1 – DS2 wird erst am Ende einmal ausgewertet',
      'Intra-Patient-Splits blähen die Accuracy auf',
    ],
    diagram: 'inter-patient-split',
    codeRef: 'src/ekg/data/loader.py',
  },

  // --------------------------------------------------------------- Signal
  {
    id: 'rohsignal',
    phase: 'Signal',
    kicker: 'Störquellen',
    title: 'Das Rohsignal und seine Störungen',
    summary:
      'Ein echtes EKG ist nie sauber: Atmung, Stromnetz und Muskelbewegungen überlagern das Herzsignal und müssen vor der Analyse entfernt werden.',
    body: `
<p>Die Kurve unten zeigt einen etwa 10 Sekunden langen Ausschnitt aus dem echten Record&nbsp;100 (Ableitung <code>MLII</code>) – grau das Rohsignal, farbig das gefilterte Signal, dazu die erkannten R-Zacken und die Kardiologen-Annotationen. Im Rohsignal stecken typische Störquellen:</p>
<ul>
<li><strong>Baseline-Wander</strong> – eine langsame Drift der Nulllinie, vor allem durch die <em>Atmung</em> (Thoraxbewegung, Impedanzänderung) und Elektrodenbewegung. Frequenzbereich deutlich unter 1 Hz.</li>
<li><strong>Netzbrumm</strong> – elektromagnetische Einkopplung aus dem Stromnetz. Bei MIT-BIH (USA) liegt sie bei <strong>60 Hz</strong>, in Europa wären es 50 Hz.</li>
<li><strong>Muskelartefakte (EMG)</strong> – breitbandiges, hochfrequentes Rauschen durch Skelettmuskelaktivität, typisch bei Bewegung im Langzeit-EKG.</li>
<li><strong>Elektroden-Bewegungsartefakte</strong> – sprunghafte Störungen, die sich spektral mit dem EKG überlappen und nur teilweise entfernbar sind.</li>
</ul>
<p>Der relevante Informationsgehalt des EKGs für die Schlagklassifikation liegt grob zwischen 0,5 und 40 Hz: P- und T-Welle im unteren Bereich, der steile QRS-Komplex mit Energie bis in den zweistelligen Hertz-Bereich. Diese Lage bestimmt die Filterwahl im nächsten Schritt.</p>`,
    bullets: [
      'Baseline-Wander: Atmung, &lt; 1 Hz',
      'Netzbrumm: 60 Hz (USA, MIT-BIH)',
      'Muskelartefakte: breitbandig, hochfrequent',
      'Gezeigt: echter Ausschnitt aus Record 100',
    ],
    panel: 'ecg',
    dataFile: 'signal_demo.json',
  },
  {
    id: 'filterung',
    phase: 'Signal',
    kicker: 'Median-Filter + Butterworth-Bandpass',
    title: 'Filterung ohne Zeitverschiebung',
    summary:
      'Zwei Filterstufen entfernen erst die langsame Drift und dann alles außerhalb des EKG-typischen Frequenzbands – ohne die R-Zacke zeitlich zu verschieben.',
    body: `
<p><strong>Stufe 1 – Baseline-Entfernung</strong> (nach de Chazal et al., 2004): Ein <strong>Median-Filter mit 200 ms</strong> Fensterbreite entfernt QRS-Komplexe und P-Wellen, ein anschließender <strong>Median-Filter mit 600 ms</strong> auch die T-Wellen. Übrig bleibt eine Schätzung der Grundlinie, die vom Signal abgezogen wird. Median-Filter sind robust gegen die steilen QRS-Spitzen und verformen deren Kontur nicht wie ein gleitender Mittelwert.</p>
<p><strong>Stufe 2 – Bandpass 0,5–40 Hz:</strong> Ein <strong>Butterworth-Filter 4. Ordnung</strong> (maximal flacher Durchlassbereich) dämpft Rest-Drift unterhalb von 0,5 Hz sowie Muskelrauschen und Netzbrumm oberhalb von 40 Hz. Da 60 Hz bereits klar im Sperrbereich liegen, ist ein zusätzliches Notch-Filter optional (im Code vorhanden, standardmäßig aus).</p>
<p><strong>Warum zero-phase?</strong> Ein normales (kausales) IIR-Filter verzögert Signalanteile frequenzabhängig – die R-Zacke würde sich verschieben und der QRS-Komplex verzerren. Hier wird vorwärts und rückwärts gefiltert (<code>sosfiltfilt</code>, das Prinzip von <code>filtfilt</code> in Second-Order-Sections-Form für numerische Stabilität). Die Phasenverschiebungen heben sich auf, die effektive Ordnung verdoppelt sich. Das ist wichtig, weil die spätere Segmentierung feste Fenster exakt um den R-Zacken-Index schneidet. Der Preis: Das Verfahren ist nicht echtzeitfähig, für die Offline-Analyse aber ideal.</p>
<p>Das Panel zeigt den berechneten Frequenzgang (Verstärkung in dB über der Frequenz) des Bandpasses.</p>`,
    bullets: [
      'Median 200 ms → 600 ms schätzt die Grundlinie',
      'Butterworth-Bandpass 0,5–40 Hz, Ordnung 4',
      'Zero-phase (<code>sosfiltfilt</code>): keine Verschiebung der R-Zacke',
      'Notch 60 Hz optional, standardmäßig deaktiviert',
    ],
    panel: 'filter-response',
    dataFile: 'filter_response.json',
    codeRef: 'src/ekg/preprocessing/filters.py',
  },
  {
    id: 'r-zacken',
    phase: 'Signal',
    kicker: 'Pan & Tompkins 1985',
    title: 'R-Zacken finden mit Pan-Tompkins',
    summary:
      'Bevor einzelne Herzschläge klassifiziert werden können, muss jeder Schlag gefunden werden. Ein klassischer Algorithmus macht die steile QRS-Spitze sichtbar und setzt adaptive Schwellen.',
    body: `
<p>Der Algorithmus von <strong>Pan &amp; Tompkins (1985)</strong> ist bis heute die Referenz für QRS-Detektion. Er verwandelt das EKG Schritt für Schritt in ein Signal, in dem jeder QRS-Komplex als deutlicher Buckel erscheint:</p>
<ul>
<li><strong>1. Bandpass 5–15 Hz:</strong> betont den QRS-Komplex, dämpft P- und T-Welle (zu langsam) und Muskelrauschen (zu schnell).</li>
<li><strong>2. Ableitung (5-Punkt-Differenz):</strong> hebt die steilen Flanken des QRS hervor.</li>
<li><strong>3. Quadrieren:</strong> macht alle Werte positiv und verstärkt große Steigungen überproportional.</li>
<li><strong>4. Gleitende Integration (150 ms):</strong> glättet zu einer Hüllkurve, deren Breite etwa der QRS-Dauer entspricht.</li>
<li><strong>5. Adaptive Doppelschwellen:</strong> laufende Schätzungen von Signal- und Rauschpegel bestimmen, ob ein Maximum ein QRS ist. Dazu kommen eine <strong>Refraktärzeit von 200 ms</strong>, eine <strong>T-Wellen-Unterscheidung</strong> (Kandidaten innerhalb von 360 ms mit deutlich flacherer Steigung gelten als T-Welle) und eine <strong>Rücksuche</strong> mit abgesenkter Schwelle, wenn länger als 166&nbsp;% des mittleren RR-Intervalls kein Schlag gefunden wurde.</li>
</ul>
<p><strong>Abweichungen vom Original:</strong> Pan &amp; Tompkins arbeiteten mit 200 Hz und kausalen Ganzzahl-Filtern (mit Gruppenlaufzeit). Diese Implementierung nutzt bei 360 Hz einen zero-phase Butterworth-Bandpass und eine zentrierte Ableitung, sodass keine Verzögerung kompensiert werden muss. Die gefundene Markierung wird abschließend in einem Fenster von ±75 ms auf den tatsächlichen R-Gipfel im Eingangssignal verfeinert.</p>
<p>Die Güte der Detektion wird gegen die Kardiologen-Annotationen gemessen (Toleranz 150 ms; Sensitivität und positiver Vorhersagewert). Für das Training werden die <em>Referenz</em>-Positionen der Annotationen verwendet, damit Detektionsfehler die Klassifikationsbewertung nicht vermischen. Der Detektor ermöglicht eine annotationsfreie Pipeline; auf Record&nbsp;100 findet er alle Referenzschläge – das ist ein einzelner, eher leichter Record und kein Datenbank-Benchmark, und eine Klassifikation auf detektierten Schlägen wurde bisher nicht ausgewertet. Das Panel zeigt alle Zwischenstufen am echten Record&nbsp;100.</p>`,
    bullets: [
      'Bandpass → Ableitung → Quadrieren → Integration → Schwellen',
      'Refraktärzeit 200 ms, T-Wellen-Check 360 ms',
      'Rücksuche bei RR &gt; 166 % des Mittelwerts',
      'Bewertung gegen Annotationen mit 150 ms Toleranz',
    ],
    diagram: 'pan-tompkins',
    panel: 'pan-tompkins',
    dataFile: 'signal_demo.json',
    codeRef: 'src/ekg/preprocessing/rpeaks.py',
  },

  // ------------------------------------------------------------- Merkmale
  {
    id: 'segmentierung',
    phase: 'Merkmale',
    kicker: 'Beat-Fenster',
    title: 'Segmentierung: jeder Herzschlag ein Fenster',
    summary:
      'Um jede R-Zacke wird ein festes Zeitfenster ausgeschnitten. So wird aus der langen Aufnahme eine Sammlung gleich langer Einzelschläge, die das Modell vergleichen kann.',
    body: `
<p>Für jede R-Zacke wird ein Fenster von <strong>250 ms vor</strong> bis <strong>450 ms nach</strong> der Zacke ausgeschnitten. Bei 360 Hz sind das 90 + 162 = <strong>252 Samples</strong>, die R-Zacke liegt immer an Index 90. Das Fenster ist asymmetrisch gewählt, weil es die <strong>P-Welle</strong> (vor dem QRS) und die längere <strong>T-Welle</strong> (danach) einschließen soll – beide tragen diagnostische Information, etwa eine fehlende oder deformierte P-Welle bei Extrasystolen.</p>
<p>Schläge, deren Fenster über den Anfang oder das Ende der Aufnahme hinausragen würden, werden verworfen. Jeder Schlag erhält über sein Annotationssymbol und das AAMI-Mapping sein Klassenlabel.</p>
<p><strong>z-Normalisierung je Beat:</strong> Jedes Fenster wird auf Mittelwert 0 und Standardabweichung 1 gebracht. Dadurch werden Unterschiede in Elektrodenposition, Verstärkung und Körperbau zwischen Patienten ausgeglichen; das Modell soll die <em>Form</em> lernen, nicht die absolute Amplitude. Absolute Zeitinformation geht im Fenster allerdings verloren – sie wird im nächsten Schritt über RR-Merkmale ergänzt.</p>
<p>Das Panel zeigt echte, segmentierte Schläge aus Record&nbsp;100 je vorhandener Klasse.</p>`,
    bullets: [
      'Fenster −250 ms … +450 ms um die R-Zacke',
      '252 Samples bei 360 Hz, R an Index 90',
      'z-Normalisierung je Beat (Form statt Amplitude)',
      'Randschläge ohne vollständiges Fenster werden verworfen',
    ],
    panel: 'beats',
    dataFile: 'segmentation_demo.json',
    codeRef: 'src/ekg/preprocessing/segmentation.py',
  },
  {
    id: 'rr-features',
    phase: 'Merkmale',
    kicker: 'Rhythmus-Kontext',
    title: 'RR-Merkmale: der Takt verrät die Extrasystole',
    summary:
      'Ein einzelnes Schlagfenster zeigt die Form, aber nicht den Zeitpunkt. Abstände zu den Nachbarschlägen zeigen, ob ein Schlag zu früh kam – das typische Kennzeichen von Extrasystolen.',
    body: `
<p>Das RR-Intervall ist der Abstand zwischen zwei aufeinanderfolgenden R-Zacken. Für jeden Schlag werden vier Merkmale (in Sekunden bzw. als Verhältnis) berechnet:</p>
<ul>
<li><code>pre_rr</code> – Abstand zum vorherigen Schlag</li>
<li><code>post_rr</code> – Abstand zum nächsten Schlag</li>
<li><code>local_rr</code> – mittleres RR der letzten bis zu 10 Schläge inkl. des aktuellen (kausal; lokaler Grundrhythmus)</li>
<li><code>pre_rr / local_rr</code> – relative Vorzeitigkeit; Werte deutlich unter 1 bedeuten „zu früh“</li>
</ul>
<p><strong>Warum das funktioniert:</strong> Extrasystolen (S und V) fallen <em>vorzeitig</em> in den Grundrhythmus ein – <code>pre_rr</code> ist kurz. Nach einer ventrikulären Extrasystole folgt oft eine <em>kompensatorische Pause</em> – <code>post_rr</code> ist lang. Gerade bei supraventrikulären Extrasystolen ist die QRS-Form häufig nahezu normal; dann ist die Vorzeitigkeit oft das entscheidende Unterscheidungsmerkmal gegenüber N.</p>
<p><strong>Warum relativ zum lokalen Rhythmus?</strong> Die Herzfrequenz unterscheidet sich stark zwischen Personen und Situationen. Ein RR von 0,6 s ist bei einem Grundrhythmus von 0,6 s normal, bei 1,0 s aber deutlich vorzeitig. Das Verhältnis <code>pre_rr / local_rr</code> macht das Merkmal zwischen Patienten vergleichbar – entscheidend für den Inter-Patient-Test.</p>`,
    bullets: [
      '4 Merkmale je Schlag: pre, post, local RR, Ratio',
      'Kurzes pre_rr → vorzeitiger Schlag (S oder V)',
      'Langes post_rr → kompensatorische Pause (typisch V)',
      'Ratio normiert auf die individuelle Herzfrequenz',
    ],
    codeRef: 'src/ekg/preprocessing/segmentation.py',
  },

  // --------------------------------------------------------------- Modell
  {
    id: 'cnn-architektur',
    phase: 'Modell',
    kicker: 'ECGNet1D · PyTorch',
    title: '1D-CNN: gelernte Mustererkenner plus Rhythmus',
    summary:
      'Ein kompaktes neuronales Netz lernt selbst, welche Kurvenformen typisch für jede Schlagklasse sind, und kombiniert das mit den RR-Merkmalen.',
    body: `
<p>Ein <strong>eindimensionales Convolutional Neural Network</strong> schiebt kleine, gelernte Filter (Kernel) über das 252-Sample-Fenster. Jeder Kernel ist ein <em>Mustererkenner</em>: Er reagiert stark, wo das Signal seiner Form ähnelt – etwa einer steilen Flanke, einem breiten QRS oder einer invertierten Welle. Anders als beim Entscheidungsbaum werden diese Merkmale nicht von Hand definiert, sondern aus den Daten gelernt.</p>
<p><strong>Morphologie-Zweig:</strong> drei Blöcke aus <code>Conv1d</code> (16, 32, 64 Kanäle; Kernelgrößen 7, 5, 3) → <code>BatchNorm1d</code> → <code>ReLU</code> → <code>MaxPool1d(2)</code>. Jedes Pooling halbiert die zeitliche Auflösung; tiefere Schichten „sehen“ dadurch größere Abschnitte des Schlags und kombinieren einfache Muster zu komplexeren. Ein <code>AdaptiveAvgPool1d</code> verdichtet am Ende jeden der 64 Kanäle zu einer Zahl.</p>
<p><strong>RR-Zweig und Fusion:</strong> Die vier RR-Merkmale werden normalisiert (<code>BatchNorm1d</code>) und über eine kleine lineare Schicht (16 Neuronen) eingebettet. Beide Zweige werden <strong>konkateniert</strong> (64 + 16 = 80 Werte) und von einem Klassifikationskopf (<code>Linear</code> 80 → 64, <code>ReLU</code>, <code>Dropout 0.3</code>, <code>Linear</code> 64 → 5) in fünf Logits übersetzt – je einen pro AAMI-Klasse. So kann das Netz Form <em>und</em> Zeitpunkt eines Schlags gemeinsam bewerten.</p>
<p>Das Netz ist bewusst klein gehalten, um auf der CPU trainierbar zu sein und Überanpassung an die Patienten von DS1 zu begrenzen. Das Panel listet alle Schichten mit Ausgabeform und Parameterzahl, berechnet direkt aus dem Modell.</p>`,
    bullets: [
      '3 Faltungsblöcke: 16 → 32 → 64 Kanäle, Kernel 7 / 5 / 3',
      'Pooling verdichtet und vergrößert das rezeptive Feld',
      'RR-Zweig (4 → 16) wird mit der Morphologie fusioniert',
      'Ausgabe: 5 Logits für N, S, V, F, Q',
    ],
    diagram: 'layer-architecture',
    panel: 'architecture',
    dataFile: 'architecture.json',
    codeRef: 'src/ekg/models/cnn1d.py',
  },
  {
    id: 'training',
    phase: 'Modell',
    kicker: 'Gewichtete Verlustfunktion',
    title: 'Training gegen das Ungleichgewicht',
    summary:
      'Weil normale Schläge so dominieren, werden Fehler bei seltenen Klassen stärker bestraft. Die Testdaten DS2 bleiben während des gesamten Trainings unangetastet.',
    body: `
<p><strong>Gewichtete Cross-Entropy:</strong> Die Verlustfunktion gewichtet jede Klasse invers zu ihrer Häufigkeit im Trainingsdatensatz. Ein falsch erkannter S-Schlag kostet damit deutlich mehr als ein falsch erkannter N-Schlag. Ohne diese Gewichtung würde das Netz die seltenen, aber klinisch wichtigen Klassen weitgehend ignorieren. Klassen, die im Training gar nicht vorkommen, erhalten Gewicht 0.</p>
<p><strong>Optimierung:</strong> Der <strong>Adam</strong>-Optimierer passt die Lernrate je Parameter adaptiv an; trainiert wird in Mini-Batches über mehrere Epochen mit festem Zufalls-Seed für Reproduzierbarkeit.</p>
<p><strong>Validierung nur auf DS1:</strong> Für Modellauswahl und Early Stopping wird ein Hold-out-Teil <em>aus DS1</em> verwendet. DS2 wird weder für die Wahl von Hyperparametern noch für den Stopp-Zeitpunkt herangezogen – sonst würde Testinformation ins Modell „durchsickern“ und das Ergebnis geschönt.</p>
<p><strong>Early Stopping:</strong> Nach jeder Epoche werden Validierungs-Loss und Macro-F1 protokolliert. Verbessert sich die Validierung nicht mehr, wird das Training beendet und der beste Zustand behalten – das begrenzt Überanpassung an die Trainingspatienten.</p>
<p><strong>Aktueller Stand:</strong> Ein Training auf dem vollständigen DS1 war in dieser Umgebung noch nicht möglich (siehe Datenlage). Die Trainingskurve erscheint, sobald <code>metrics.json</code> aus einem echten Lauf vorliegt.</p>`,
    bullets: [
      'Klassengewichte invers zur Häufigkeit',
      'Adam-Optimierer, Mini-Batches, fester Seed',
      'Validierung und Early Stopping nur auf DS1-Hold-out',
      'DS2 bleibt bis zur Endauswertung unberührt',
    ],
    diagram: 'training-loop',
    panel: 'training',
    dataFile: 'metrics.json',
    codeRef: 'src/ekg/training/train.py',
  },

  // ----------------------------------------------------------- Evaluation
  {
    id: 'evaluation',
    phase: 'Evaluation',
    kicker: 'AAMI-Metriken',
    title: 'Evaluation: warum Accuracy in die Irre führt',
    summary:
      'Bewertet wird pro Klasse: Wie viele echte Extrasystolen wurden gefunden, und wie oft lag ein Alarm richtig? Eine einzelne Gesamtquote würde die seltenen Klassen verschleiern.',
    body: `
<p>Grundlage ist die <strong>Konfusionsmatrix</strong> auf DS2: Zeilen sind die wahren Klassen, Spalten die Vorhersagen. Daraus ergeben sich je Klasse (Bezeichnungen nach AAMI EC57):</p>
<ul>
<li><strong>Sensitivität (Se)</strong> = TP / (TP + FN) – Anteil der echten Schläge einer Klasse, die gefunden wurden.</li>
<li><strong>Positiver Vorhersagewert (+P, PPV)</strong> = TP / (TP + FP) – Anteil der Vorhersagen einer Klasse, die stimmen.</li>
<li><strong>Spezifität (Sp)</strong> = TN / (TN + FP) – Anteil der übrigen Schläge, die korrekt <em>nicht</em> dieser Klasse zugeordnet wurden.</li>
<li><strong>F1</strong> – harmonisches Mittel aus Se und PPV; <strong>Macro-F1</strong> mittelt F1 ungewichtet über die Klassen, sodass seltene Klassen gleich zählen.</li>
</ul>
<p><strong>Warum nicht Accuracy?</strong> Wenn rund 90&nbsp;% aller Schläge zur Klasse N gehören, erreicht ein Modell, das nie etwas anderes als N vorhersagt, eine Accuracy von etwa 90&nbsp;% – bei einer Sensitivität von 0 für S und V. Accuracy misst vor allem, wie gut die Mehrheitsklasse erkannt wird. Deshalb stehen hier <strong>Se und PPV für S und V</strong> sowie Macro-F1 im Vordergrund; Accuracy wird nur ergänzend berichtet.</p>
<p>Ergebnisse werden ausschließlich aus einem vollständigen DS1 → DS2-Lauf angezeigt. Solange der fehlt, bleibt das Panel bewusst leer – es gibt hier keine erfundenen oder auf einem einzelnen Record berechneten Kennzahlen.</p>`,
    bullets: [
      'Konfusionsmatrix: Zeilen = wahr, Spalten = vorhergesagt',
      'Se, PPV, Spezifität und F1 je Klasse',
      'Macro-F1 gewichtet alle Klassen gleich',
      'Accuracy allein ist bei ~90 % N irreführend',
    ],
    panel: 'confusion',
    dataFile: 'metrics.json',
    codeRef: 'src/ekg/evaluation/metrics.py',
  },
  {
    id: 'erklaerbarkeit',
    phase: 'Evaluation',
    kicker: 'Interpretierbarer Vergleich',
    title: 'Erklärbarkeit: Entscheidungsbaum und klinische Logik',
    summary:
      'Ein neuronales Netz ist schwer zu durchschauen. Ein kleiner Entscheidungsbaum mit verständlichen Merkmalen zeigt dagegen Regel für Regel, warum ein Schlag einer Klasse zugeordnet wird.',
    body: `
<p><strong>Entscheidungsbaum als Vergleichsmodell:</strong> Statt roher Samples erhält der Baum wenige, klinisch interpretierbare Merkmale: <code>qrs_width_ms</code> (QRS-Breite), <code>r_amplitude</code>, <code>q_depth</code>, <code>s_depth</code>, <code>qrs_area</code>, <code>t_amplitude</code>, <code>beat_energy</code> (Energieanteil im QRS-Fenster) sowie die vier RR-Merkmale. Der Baum ist auf eine Tiefe von 4 begrenzt und nutzt balancierte Klassengewichte. Jeder Pfad von der Wurzel zu einem Blatt ist eine lesbare Wenn-dann-Regel; jeder Knoten zeigt Merkmal, Schwelle und Anzahl der Schläge. Der Baum wird ausschließlich auf DS1 trainiert und erscheint im Panel, sobald dieses Training gelaufen ist.</p>
<p><strong>Klinische Entscheidungslogik (Diagramm):</strong> Das Diagramm darunter ist <em>ausdrücklich erklärend und nicht gelernt</em>. Es skizziert, wie Kardiologen grob vorgehen: Kommt der Schlag vorzeitig (kurzes RR)? Ist der QRS-Komplex breit und deformiert (Hinweis auf ventrikulären Ursprung, V) oder schmal und normal geformt (supraventrikulär, S)? Trägt er Merkmale beider Formen (Fusion, F)? Diese Logik dient als Lesehilfe für die gelernten Modelle – sie ist kein Diagnosewerkzeug.</p>
<p><strong>Was der Vergleich zeigt:</strong> Wenn Baum und CNN ähnliche Merkmale nutzen (Vorzeitigkeit, QRS-Breite), stützt das die Plausibilität des CNN. Der Baum ist leichter zu prüfen, aber in seiner Ausdrucksstärke begrenzt; das CNN kann subtilere Formmerkmale nutzen, ist aber schwerer zu erklären.</p>`,
    bullets: [
      'Baum (Tiefe ≤ 4) auf 11 interpretierbaren Merkmalen',
      'Jeder Pfad = lesbare Wenn-dann-Regel',
      'Diagramm: klinische Logik, erklärend – nicht gelernt',
      'Baum erscheint erst nach echtem DS1-Training',
    ],
    diagram: 'decision-tree-logic',
    panel: 'tree',
    dataFile: 'tree.json',
    codeRef: 'src/ekg/models/tree_baseline.py',
  },

  // -------------------------------------------------------------- Projekt
  {
    id: 'agenten-prozess',
    phase: 'Projekt',
    kicker: 'Multi-Agent-Orchestrierung',
    title: 'Wie dieses Projekt entstanden ist',
    summary:
      'Das Projekt wurde von einem koordinierenden KI-Agenten geplant und in kleine, unabhängige Aufgaben zerlegt, die bis zu 16 Sub-Agenten parallel bearbeitet haben.',
    body: `
<p>Ein <strong>Mother-Agent</strong> (Orchestrator) hat den Masterplan erstellt, ihn in isolierte Module zerlegt (z.&nbsp;B. Daten-Loader, Filter, R-Zacken-Detektion, CNN, Entscheidungsbaum, Metriken, API, UI-Shell, Diagramme, Charts, Inhalte) und diese an Sub-Agenten verteilt – nie mehr als <strong>16 gleichzeitig</strong>.</p>
<p><strong>Zentrale Status-Datei:</strong> Alle Module, ihre Abhängigkeiten, Dateien und ihr Fortschritt stehen in <code>project_state.json</code>. Sub-Agenten ändern sie nie direkt, sondern über ein Status-Protokoll (<code>scripts/state.py</code>):</p>
<ul>
<li><code>start</code> – Modul wird bearbeitet (<em>in_progress</em>)</li>
<li><code>done</code> – Abschluss mit Zusammenfassung, Entscheidungen, Dateien und Testergebnissen</li>
<li><code>fail</code> – Fehler mit Log-Auszug; der Orchestrator korrigiert die Anweisung und startet das Modul neu</li>
<li><code>log</code> – dokumentierte Abweichung vom Schnittstellenvertrag</li>
</ul>
<p><strong>Konfliktvermeidung:</strong> Bindende Funktionssignaturen stehen in <code>INTERFACES.md</code>, sodass Module parallel gegeneinander entwickelt werden konnten. Jedes Modul besitzt exklusiv seine Dateien. Vor jeder neuen Welle liest der Orchestrator den Stand und startet nur Module, deren Abhängigkeiten erfüllt sind.</p>
<p><strong>Wellen:</strong> Welle 1 baut alle Grundmodule parallel; Welle 2 integriert Pipeline und Oberfläche; Welle 3 ist ein unabhängiges Review mit anschließenden Korrekturen; Welle 4 – das Volltraining auf DS1 → DS2 – ist blockiert, bis die Datenquelle erreichbar ist. Den aktuellen Stand zeigt die Status-Ansicht.</p>`,
    bullets: [
      'Max. 16 Sub-Agenten parallel, je ein isoliertes Modul',
      'Zentraler Stand in <code>project_state.json</code>',
      'Status-Protokoll: start, done, fail, log',
      'Bindende Verträge in <code>INTERFACES.md</code>',
    ],
    diagram: 'agent-orchestration',
  },
];
