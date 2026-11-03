// Mermaid diagram definitions for the "Process" view.
//
// Sources are theme-agnostic: nodes only reference semantic class names
// (data, proc, model, result, decision, muted, note, clsN … clsQ). The matching
// `classDef` lines are generated at render time from the CSS design tokens
// (see index.js), so every diagram follows light/dark mode automatically.
//
// Labels exist in German (DE) and English (EN) with identical node ids, structure
// and classes; DIAGRAMS[id] returns the current UI language at access time.
// Numbers follow the implementation in src/ekg/** and the contracts in INTERFACES.md.

import { getLang } from '../lib/i18n.js';

/** @typedef {{ title: string, caption: string, source: string }} DiagramDef */

/** @type {Record<string, DiagramDef>} */
const DE = {
  'pipeline-overview': {
    title: 'Pipeline-Überblick',
    caption:
      'Vom Rohsignal zur AAMI-Klasse: Das EKG (Ableitung MLII, 360 Hz) wird von der Grundlinienschwankung befreit, ' +
      'bandpassgefiltert und an den R-Zacken in Schlagfenster von 252 Samples zerlegt. 1D-CNN und Entscheidungsbaum ' +
      'ordnen jeden Schlag einer der fünf AAMI-Klassen zu; bewertet wird ausschließlich auf den Test-Patienten (DS2). ' +
      'Für Training und Evaluation dienen standardmäßig die annotierten R-Positionen als Schlagreferenz, ' +
      'Pan-Tompkins liefert die vollautomatische Detektion.',
    source: `flowchart TD
  rec[("MIT-BIH Record<br/>360 Hz · Ableitung MLII")]:::data
  subgraph pre["Vorverarbeitung"]
    base["Baseline-Entfernung<br/>Median 200 ms → 600 ms"]:::proc
    bp["Bandpass 0,5–40 Hz<br/>Butterworth, nullphasig"]:::proc
    rp["R-Zacken-Detektion<br/>Pan-Tompkins"]:::proc
  end
  subgraph feat["Merkmale je Schlag"]
    seg["Segmentierung<br/>250 ms vor · 450 ms nach R<br/>= 252 Samples"]:::proc
    rr["RR-Features<br/>Prä-RR · Post-RR<br/>lokales RR · Verhältnis"]:::proc
  end
  subgraph clf["Klassifikation"]
    cnn["1D-CNN (ECGNet1D)<br/>Morphologie + RR-Fusion"]:::model
    tree["Entscheidungsbaum<br/>interpretierbare Merkmale"]:::model
  end
  cls{{"AAMI-Klasse<br/>N · S · V · F · Q"}}:::result
  ev[/"Evaluation auf DS2<br/>Sensitivität · PPV · Macro-F1"/]:::data
  rec --> base --> bp --> rp
  rp --> seg
  rp --> rr
  seg --> cnn
  rr --> cnn
  seg --> tree
  rr --> tree
  cnn --> cls
  tree --> cls
  cls --> ev
`,
  },

  'layer-architecture': {
    title: 'Layer-Architektur ECGNet1D',
    caption:
      'Datenfluss durch das 1D-CNN mit den Tensor-Shapes je Schlag (Kanäle × Samples). Die Faltungen nutzen ' +
      'Padding „same“ und erhalten die Länge; MaxPool1d(2) halbiert sie mit Abrundung: 252 → 126 → 63 → 31. ' +
      'Der Morphologie-Zweig wird mit dem RR-Zweig (Rhythmus-Kontext) zu 80 Merkmalen verkettet. ' +
      'Die Standardkonfiguration hat 14 749 trainierbare Parameter. Softmax wird nur zur Ausgabe von ' +
      'Wahrscheinlichkeiten angewandt – das Training arbeitet direkt mit den Logits (CrossEntropy).',
    source: `flowchart TD
  inp[/"Eingabe: Schlagfenster<br/>1 × 252"/]:::data
  rrin[/"RR-Features<br/>4"/]:::data
  subgraph conv["Morphologie-Zweig"]
    c1["Conv1d k=7 · 16 Kanäle<br/>BatchNorm · ReLU<br/>16 × 252"]:::proc
    p1["MaxPool1d(2)<br/>16 × 126"]:::proc
    c2["Conv1d k=5 · 32 Kanäle<br/>BatchNorm · ReLU · MaxPool1d(2)<br/>32 × 63"]:::proc
    c3["Conv1d k=3 · 64 Kanäle<br/>BatchNorm · ReLU · MaxPool1d(2)<br/>64 × 31"]:::proc
    gap["Global Average Pooling<br/>64"]:::proc
  end
  subgraph rrb["RR-Zweig"]
    rbn["BatchNorm<br/>4"]:::proc
    rfc["Linear 4 → 16 · ReLU<br/>16"]:::proc
  end
  cat(("Concat<br/>80")):::model
  fc1["Linear 80 → 64 · ReLU<br/>64"]:::model
  drop["Dropout p = 0,3<br/>64"]:::model
  fc2["Linear 64 → 5<br/>Logits"]:::model
  sm{{"Softmax<br/>P(N, S, V, F, Q)"}}:::result
  inp --> c1 --> p1 --> c2 --> c3 --> gap
  rrin --> rbn --> rfc
  gap --> cat
  rfc --> cat
  cat --> fc1 --> drop --> fc2 --> sm
`,
  },

  'pan-tompkins': {
    title: 'R-Zacken-Detektion nach Pan-Tompkins',
    caption:
      'Pan & Tompkins (1985): Bandpass, Ableitung, Quadrierung und gleitende Integration verwandeln jeden QRS-Komplex ' +
      'in einen deutlichen Energie-Puls. Adaptive Schwellen aus laufenden Signal- (SPKI) und Rauschschätzungen (NPKI) ' +
      'entscheiden, ob ein Puls ein Herzschlag ist (THR1 = NPKI + 0,25 · (SPKI − NPKI)); Refraktärzeit, T-Wellen-Prüfung und Searchback verhindern ' +
      'Doppel- und Fehldetektionen. Die Filter laufen hier nullphasig (offline), die finale R-Position ist das ' +
      'Extremum des Eingangssignals im ±75-ms-Fenster.',
    source: `flowchart TD
  x[/"Vorverarbeitetes EKG<br/>360 Hz"/]:::data
  subgraph stages["Signalstufen"]
    bp["Bandpass 5–15 Hz<br/>betont QRS, dämpft P/T und Drift"]:::proc
    der["Ableitung (5 Punkte)<br/>steile Flanken hervorheben"]:::proc
    sq["Quadrierung<br/>positiv, große Steigungen betont"]:::proc
    mwi["Gleitende Integration<br/>Fenster 150 ms"]:::proc
  end
  subgraph decide["Adaptive Entscheidung"]
    thr{"Peak #gt; THR1?"}:::decision
    ref{"Refraktär 200 ms<br/>+ T-Wellen-Test ok?"}:::decision
    spk["Signal-Peak<br/>SPKI ← 0,125 · Peak + 0,875 · SPKI"]:::model
    npk["Rausch-Peak<br/>NPKI ← 0,125 · Peak + 0,875 · NPKI"]:::muted
    sb["Searchback: 166 % des mittl. RR ohne Schlag<br/>→ bester Kandidat über THR2 = ½ · THR1<br/>SPKI ← 0,25 · Peak + 0,75 · SPKI"]:::note
  end
  r(["R-Zacke<br/>Extremum im ±75-ms-Fenster"]):::result
  x --> bp --> der --> sq --> mwi --> thr
  thr -->|ja| ref
  thr -->|nein| npk
  ref -->|ja| spk
  ref -->|nein| npk
  spk --> r
  npk -.-> sb
  sb -.-> r
`,
  },

  'decision-tree-logic': {
    title: 'Entscheidungslogik (klinisch motiviert)',
    caption:
      'Didaktische Skizze der klinischen Intuition hinter der Schlag-Klassifikation – kein gelerntes Modellergebnis. ' +
      'Die Schwellen (Vorzeitigkeit ≈ 0,9 · lokales RR, QRS-Breite ≈ 120 ms) sind typische Lehrbuchwerte, keine ' +
      'Modellparameter. Der tatsächlich trainierte Entscheidungsbaum wird erst nach dem Training auf DS1 (vollständige ' +
      'MIT-BIH-Daten) angezeigt. Bewusste Vereinfachungen: Aberrant geleitete supraventrikuläre Schläge können breit sein, ' +
      'ventrikuläre Ersatzschläge (AAMI: V) sind nicht vorzeitig.',
    source: `flowchart TD
  start(["Erkannter Herzschlag<br/>RR-Kontext + QRS-Morphologie"]):::data
  q0{"Auswertbar?"}:::decision
  q1{"Vorzeitig?<br/>RR-Quotient #lt; ~0,9"}:::decision
  q2{"QRS #gt; ~120 ms?"}:::decision
  q3{"QRS #gt; ~120 ms?"}:::decision
  q4{"Mischform?"}:::decision
  V(["V · ventrikulär<br/>z. B. VES / PVC"]):::clsV
  S(["S · supraventrikulär<br/>z. B. SVES / APC"]):::clsS
  F(["F · Fusionsschlag<br/>normal + ventrikulär gemischt"]):::clsF
  N(["N · Normalschlag"]):::clsN
  N2(["N · z. B. Schenkelblock<br/>breit, aber nicht vorzeitig"]):::clsN
  Q(["Q · nicht klassifizierbar<br/>Artefakt / unklar"]):::clsQ
  start --> q0
  q0 -->|nein| Q
  q0 -->|ja| q1
  q1 -->|ja| q2
  q2 -->|ja| V
  q2 -->|nein| S
  q1 -->|nein| q3
  q3 -->|nein| N
  q3 -->|ja| q4
  q4 -->|ja| F
  q4 -->|nein| N2
`,
  },

  'inter-patient-split': {
    title: 'Inter-Patient-Split (de Chazal 2004)',
    caption:
      'Trainiert wird nur auf DS1, getestet nur auf DS2 – kein Record taucht in beiden Teilen auf, so dass das Modell ' +
      'an ungesehenen Patienten gemessen wird. Intra-Patient-Splits (zufällige Schläge aller Patienten) führen zu ' +
      'unrealistisch hohen Werten. Hinweis: Laut PhysioNet stammen die Records 201 (DS1) und 202 (DS2) vom selben ' +
      'Probanden – eine bekannte, im Standard-Split akzeptierte Ausnahme.',
    source: `flowchart TD
  db[("MIT-BIH Arrhythmia Database<br/>48 Records à 30 min")]:::data
  paced["Schrittmacher-Records<br/>102 · 104 · 107 · 217<br/>ausgeschlossen (AAMI)"]:::muted
  rest["44 Records"]:::proc
  ds1["DS1 · 22 Records<br/>Training + Validierung<br/>101 106 108 109 112 114 115 116<br/>118 119 122 124 201 203 205 207<br/>208 209 215 220 223 230"]:::model
  ds2["DS2 · 22 Records<br/>nur Test · disjunkt zu DS1<br/>100 103 105 111 113 117 121 123<br/>200 202 210 212 213 214 219 221<br/>222 228 231 232 233 234"]:::result
  hold["Hold-out-Teil von DS1<br/>Validierung · Checkpoint-Auswahl"]:::proc
  model(["Trainiertes Modell<br/>einmalige Auswertung"]):::model
  db --> paced
  db --> rest
  rest --> ds1
  rest --> ds2
  ds1 --> hold
  ds1 --> model
  hold --> model
  model ==> ds2
`,
  },

  'training-loop': {
    title: 'Trainingsschleife',
    caption:
      'Pro Epoche werden alle Mini-Batches aus dem DS1-Trainingsteil durchlaufen. Die CrossEntropy ist mit inversen ' +
      'Klassenhäufigkeiten gewichtet, damit seltene Klassen (S, V, F) nicht von N überdeckt werden. Nach jeder Epoche ' +
      'entscheidet der Macro-F1 auf dem DS1-Hold-out über den besten Checkpoint und das frühe Stoppen; DS2 bleibt bis ' +
      'zur finalen Auswertung unberührt.',
    source: `flowchart TD
  init(["Start · Gewichte initialisieren<br/>fester Seed"]):::data
  subgraph epoch["Epoche e = 1 … E"]
    batch["Mini-Batch aus DS1-Training<br/>Schläge B × 252 · RR B × 4"]:::data
    fwd["Forward-Pass<br/>ECGNet1D → Logits B × 5"]:::proc
    loss["Gewichtete CrossEntropy<br/>Gewicht ∝ 1 / Klassenhäufigkeit"]:::proc
    bwd["Backpropagation<br/>Gradienten ∂L/∂θ"]:::proc
    opt["Adam-Schritt<br/>Gewichte aktualisieren"]:::proc
    more{"Weitere Batches?"}:::decision
  end
  val["Validierung<br/>Macro-F1 auf DS1-Hold-out"]:::model
  better{"F1 besser?"}:::decision
  ckpt[("Best-Checkpoint<br/>speichern")]:::result
  stop{"Stopp?"}:::decision
  done(["Bestes Modell<br/>→ einmalige Auswertung auf DS2"]):::result
  init --> batch --> fwd --> loss --> bwd --> opt --> more
  more -->|ja| batch
  more -->|nein| val --> better
  better -->|ja| ckpt --> stop
  better -->|nein| stop
  stop -->|"nein: nächste Epoche"| batch
  stop -->|"ja: Early Stop / letzte Epoche"| done
`,
  },

  'agent-orchestration': {
    title: 'Agenten-Orchestrierung',
    caption:
      'Der Mother-Agent liest vor jeder Welle project_state.json und startet nur Module, deren Abhängigkeiten erfüllt ' +
      'sind (max. 16 Agents parallel). In Welle 1 arbeiten 13 Agents gleichzeitig an disjunkten Dateien; jeder meldet ' +
      'über das State-Protokoll start, done oder fail. Fehlgeschlagene Module werden mit korrigierter Anweisung neu ' +
      'gestartet, ohne die übrigen zu blockieren. Das Volltraining wartete, bis die vollständige Datenbank vorlag (physionet.org war in der Build-Umgebung nicht erreichbar), und wurde dann lokal nachgeholt.',
    source: `flowchart TD
  state[("project_state.json<br/>zentrale Status-Datei")]:::data
  mother(["Mother-Agent<br/>Orchestrator · max. 16 parallel"]):::result
  subgraph w1["Welle 1 · 13 Agents parallel · disjunkte Dateien"]
    b1["Daten-Pipeline · 4 Agents<br/>Daten-Loader · Filter<br/>R-Zacken · Segmentierung"]:::proc
    b2["ML-Modell · 4 Agents<br/>1D-CNN · Entscheidungsbaum<br/>Training · Evaluation"]:::model
    b3["Web & UI · 5 Agents<br/>API · UI-Shell · UI-Diagramme<br/>UI-Charts · UI-Content"]:::proc
  end
  proto["State-Protokoll je Agent (scripts/state.py)<br/>start → in_progress · done: Summary, Entscheidungen, Dateien, Tests<br/>fail: Log-Auszug → Mother-Agent korrigiert und startet neu"]:::note
  w2["Welle 2 · Integration<br/>Pipeline → UI-Integration"]:::model
  w3["Welle 3 · Review / Fix<br/>Reviewer → Fix-Agent → Re-Test"]:::model
  w4["Welle 4 · Volltraining DS1 → DS2<br/>lokal nachgeholt"]:::model
  state -->|liest vor jeder Welle| mother
  mother --> b1
  mother --> b2
  mother --> b3
  b1 --> w2
  b2 --> w2
  b3 --> w2
  w1 -.-> proto
  w2 --> w3
  w3 -.-> w4
`,
  },
};

/** @type {Record<string, DiagramDef>} */
const EN = {
  'pipeline-overview': {
    title: 'Pipeline overview',
    caption:
      'From raw signal to AAMI class: baseline wander is removed from the ECG (lead MLII, 360 Hz), the signal is ' +
      'band-pass filtered and split at the R peaks into beat windows of 252 samples. The 1D CNN and the decision tree ' +
      'assign each beat to one of the five AAMI classes; evaluation uses only the test patients (DS2). ' +
      'By default, training and evaluation use the annotated R positions as the beat reference; ' +
      'Pan-Tompkins provides fully automatic detection.',
    source: `flowchart TD
  rec[("MIT-BIH record<br/>360 Hz · lead MLII")]:::data
  subgraph pre["Preprocessing"]
    base["Baseline removal<br/>median 200 ms → 600 ms"]:::proc
    bp["Band-pass 0.5–40 Hz<br/>Butterworth, zero-phase"]:::proc
    rp["R-peak detection<br/>Pan-Tompkins"]:::proc
  end
  subgraph feat["Features per beat"]
    seg["Segmentation<br/>250 ms before · 450 ms after R<br/>= 252 samples"]:::proc
    rr["RR features<br/>pre-RR · post-RR<br/>local RR · ratio"]:::proc
  end
  subgraph clf["Classification"]
    cnn["1D CNN (ECGNet1D)<br/>morphology + RR fusion"]:::model
    tree["Decision tree<br/>interpretable features"]:::model
  end
  cls{{"AAMI class<br/>N · S · V · F · Q"}}:::result
  ev[/"Evaluation on DS2<br/>sensitivity · PPV · macro-F1"/]:::data
  rec --> base --> bp --> rp
  rp --> seg
  rp --> rr
  seg --> cnn
  rr --> cnn
  seg --> tree
  rr --> tree
  cnn --> cls
  tree --> cls
  cls --> ev
`,
  },

  'layer-architecture': {
    title: 'ECGNet1D layer architecture',
    caption:
      'Data flow through the 1D CNN with the tensor shapes per beat (channels × samples). The convolutions use ' +
      '"same" padding and preserve the length; MaxPool1d(2) halves it, rounding down: 252 → 126 → 63 → 31. ' +
      'The morphology branch is concatenated with the RR branch (rhythm context) into 80 features. ' +
      'The default configuration has 14,749 trainable parameters. Softmax is applied only to output ' +
      'probabilities – training works directly on the logits (CrossEntropy).',
    source: `flowchart TD
  inp[/"Input: beat window<br/>1 × 252"/]:::data
  rrin[/"RR features<br/>4"/]:::data
  subgraph conv["Morphology branch"]
    c1["Conv1d k=7 · 16 channels<br/>BatchNorm · ReLU<br/>16 × 252"]:::proc
    p1["MaxPool1d(2)<br/>16 × 126"]:::proc
    c2["Conv1d k=5 · 32 channels<br/>BatchNorm · ReLU · MaxPool1d(2)<br/>32 × 63"]:::proc
    c3["Conv1d k=3 · 64 channels<br/>BatchNorm · ReLU · MaxPool1d(2)<br/>64 × 31"]:::proc
    gap["Global average pooling<br/>64"]:::proc
  end
  subgraph rrb["RR branch"]
    rbn["BatchNorm<br/>4"]:::proc
    rfc["Linear 4 → 16 · ReLU<br/>16"]:::proc
  end
  cat(("Concat<br/>80")):::model
  fc1["Linear 80 → 64 · ReLU<br/>64"]:::model
  drop["Dropout p = 0.3<br/>64"]:::model
  fc2["Linear 64 → 5<br/>logits"]:::model
  sm{{"Softmax<br/>P(N, S, V, F, Q)"}}:::result
  inp --> c1 --> p1 --> c2 --> c3 --> gap
  rrin --> rbn --> rfc
  gap --> cat
  rfc --> cat
  cat --> fc1 --> drop --> fc2 --> sm
`,
  },

  'pan-tompkins': {
    title: 'R-peak detection with Pan-Tompkins',
    caption:
      'Pan & Tompkins (1985): band-pass filtering, differentiation, squaring and moving-window integration turn every ' +
      'QRS complex into a distinct energy pulse. Adaptive thresholds from running signal (SPKI) and noise (NPKI) estimates ' +
      'decide whether a pulse is a heartbeat (THR1 = NPKI + 0.25 · (SPKI − NPKI)); a refractory period, a T-wave check and ' +
      'searchback prevent double and false detections. Here the filters run zero-phase (offline); the final R position is ' +
      'the extremum of the input signal within a ±75 ms window.',
    source: `flowchart TD
  x[/"Preprocessed ECG<br/>360 Hz"/]:::data
  subgraph stages["Signal stages"]
    bp["Band-pass 5–15 Hz<br/>emphasizes QRS, attenuates P/T and drift"]:::proc
    der["Derivative (5-point)<br/>highlights steep slopes"]:::proc
    sq["Squaring<br/>positive, emphasizes large slopes"]:::proc
    mwi["Moving-window integration<br/>window 150 ms"]:::proc
  end
  subgraph decide["Adaptive decision"]
    thr{"Peak #gt; THR1?"}:::decision
    ref{"Refractory 200 ms<br/>+ T-wave test ok?"}:::decision
    spk["Signal peak<br/>SPKI ← 0.125 · peak + 0.875 · SPKI"]:::model
    npk["Noise peak<br/>NPKI ← 0.125 · peak + 0.875 · NPKI"]:::muted
    sb["Searchback: 166% of mean RR without a beat<br/>→ best candidate above THR2 = ½ · THR1<br/>SPKI ← 0.25 · peak + 0.75 · SPKI"]:::note
  end
  r(["R peak<br/>extremum in ±75 ms window"]):::result
  x --> bp --> der --> sq --> mwi --> thr
  thr -->|yes| ref
  thr -->|no| npk
  ref -->|yes| spk
  ref -->|no| npk
  spk --> r
  npk -.-> sb
  sb -.-> r
`,
  },

  'decision-tree-logic': {
    title: 'Decision logic (clinically motivated)',
    caption:
      'Didactic sketch of the clinical intuition behind beat classification – not a learned model result. ' +
      'The thresholds (prematurity ≈ 0.9 · local RR, QRS width ≈ 120 ms) are typical textbook values, not ' +
      'model parameters. The actually trained decision tree is shown only after training on DS1 (complete ' +
      'MIT-BIH data). Deliberate simplifications: aberrantly conducted supraventricular beats can be wide, ' +
      'and ventricular escape beats (AAMI: V) are not premature.',
    source: `flowchart TD
  start(["Detected beat<br/>RR context + QRS morphology"]):::data
  q0{"Analyzable?"}:::decision
  q1{"Premature?<br/>RR ratio #lt; ~0.9"}:::decision
  q2{"QRS #gt; ~120 ms?"}:::decision
  q3{"QRS #gt; ~120 ms?"}:::decision
  q4{"Mixed form?"}:::decision
  V(["V · ventricular<br/>e.g. PVC"]):::clsV
  S(["S · supraventricular<br/>e.g. APC / PAC"]):::clsS
  F(["F · fusion beat<br/>normal + ventricular mixed"]):::clsF
  N(["N · normal beat"]):::clsN
  N2(["N · e.g. bundle branch block<br/>wide, but not premature"]):::clsN
  Q(["Q · unknown<br/>artifact / unclassifiable"]):::clsQ
  start --> q0
  q0 -->|no| Q
  q0 -->|yes| q1
  q1 -->|yes| q2
  q2 -->|yes| V
  q2 -->|no| S
  q1 -->|no| q3
  q3 -->|no| N
  q3 -->|yes| q4
  q4 -->|yes| F
  q4 -->|no| N2
`,
  },

  'inter-patient-split': {
    title: 'Inter-patient split (de Chazal 2004)',
    caption:
      'Training uses only DS1 and testing only DS2 – no record appears in both parts, so the model is measured ' +
      'on unseen patients. Intra-patient splits (random beats from all patients) lead to unrealistically high ' +
      'scores. Note: according to PhysioNet, records 201 (DS1) and 202 (DS2) come from the same subject – a ' +
      'known exception accepted in the standard split.',
    source: `flowchart TD
  db[("MIT-BIH Arrhythmia Database<br/>48 records of 30 min")]:::data
  paced["Paced records<br/>102 · 104 · 107 · 217<br/>excluded (AAMI)"]:::muted
  rest["44 records"]:::proc
  ds1["DS1 · 22 records<br/>training + validation<br/>101 106 108 109 112 114 115 116<br/>118 119 122 124 201 203 205 207<br/>208 209 215 220 223 230"]:::model
  ds2["DS2 · 22 records<br/>test only · disjoint from DS1<br/>100 103 105 111 113 117 121 123<br/>200 202 210 212 213 214 219 221<br/>222 228 231 232 233 234"]:::result
  hold["DS1 hold-out part<br/>validation · checkpoint selection"]:::proc
  model(["Trained model<br/>single evaluation"]):::model
  db --> paced
  db --> rest
  rest --> ds1
  rest --> ds2
  ds1 --> hold
  ds1 --> model
  hold --> model
  model ==> ds2
`,
  },

  'training-loop': {
    title: 'Training loop',
    caption:
      'Each epoch iterates over all mini-batches from the DS1 training part. The CrossEntropy is weighted by inverse ' +
      'class frequencies so that rare classes (S, V, F) are not overwhelmed by N. After every epoch, the macro-F1 on ' +
      'the DS1 hold-out decides on the best checkpoint and early stopping; DS2 stays untouched until the final ' +
      'evaluation.',
    source: `flowchart TD
  init(["Start · initialize weights<br/>fixed seed"]):::data
  subgraph epoch["Epoch e = 1 … E"]
    batch["Mini-batch from DS1 training<br/>beats B × 252 · RR B × 4"]:::data
    fwd["Forward pass<br/>ECGNet1D → logits B × 5"]:::proc
    loss["Weighted CrossEntropy<br/>weight ∝ 1 / class frequency"]:::proc
    bwd["Backpropagation<br/>gradients ∂L/∂θ"]:::proc
    opt["Adam step<br/>update weights"]:::proc
    more{"More batches?"}:::decision
  end
  val["Validation<br/>macro-F1 on DS1 hold-out"]:::model
  better{"F1 improved?"}:::decision
  ckpt[("Save<br/>best checkpoint")]:::result
  stop{"Stop?"}:::decision
  done(["Best model<br/>→ single evaluation on DS2"]):::result
  init --> batch --> fwd --> loss --> bwd --> opt --> more
  more -->|yes| batch
  more -->|no| val --> better
  better -->|yes| ckpt --> stop
  better -->|no| stop
  stop -->|"no: next epoch"| batch
  stop -->|"yes: early stop / last epoch"| done
`,
  },

  'agent-orchestration': {
    title: 'Agent orchestration',
    caption:
      'Before each wave, the mother agent reads project_state.json and starts only modules whose dependencies are met ' +
      '(max. 16 agents in parallel). In wave 1, 13 agents work simultaneously on disjoint files; each reports start, ' +
      'done or fail via the state protocol. Failed modules are restarted with corrected instructions without blocking ' +
      'the others. The full training waited until the complete database was available (physionet.org was not reachable in the build environment) and was then completed locally.',
    source: `flowchart TD
  state[("project_state.json<br/>central status file")]:::data
  mother(["Mother agent<br/>orchestrator · max. 16 in parallel"]):::result
  subgraph w1["Wave 1 · 13 agents in parallel · disjoint files"]
    b1["Data pipeline · 4 agents<br/>data loader · filter<br/>R peaks · segmentation"]:::proc
    b2["ML model · 4 agents<br/>1D CNN · decision tree<br/>training · evaluation"]:::model
    b3["Web & UI · 5 agents<br/>API · UI shell · UI diagrams<br/>UI charts · UI content"]:::proc
  end
  proto["State protocol per agent (scripts/state.py)<br/>start → in_progress · done: summary, decisions, files, tests<br/>fail: log excerpt → mother agent corrects and restarts"]:::note
  w2["Wave 2 · integration<br/>pipeline → UI integration"]:::model
  w3["Wave 3 · review / fix<br/>reviewer → fix agent → re-test"]:::model
  w4["Wave 4 · full training DS1 → DS2<br/>completed locally"]:::model
  state -->|reads before each wave| mother
  mother --> b1
  mother --> b2
  mother --> b3
  b1 --> w2
  b2 --> w2
  b3 --> w2
  w1 -.-> proto
  w2 --> w3
  w3 -.-> w4
`,
  },
};

/**
 * Language-aware view: DIAGRAMS[id] returns the definition ({ title, caption, source })
 * in the current UI language at access time.
 * @type {Record<string, DiagramDef>}
 */
export const DIAGRAMS = {};
for (const id of Object.keys(DE)) {
  Object.defineProperty(DIAGRAMS, id, { enumerable: true, get: () => (getLang() === 'en' ? EN[id] : DE[id]) });
}

/** Ordered list of all diagram ids. */
export const DIAGRAM_IDS = Object.keys(DE);
