// Overview ("Übersicht"): project goal, honest data-status banner, KPI tiles computed
// only from real exported data, pipeline diagram, AAMI class legend and CTA to Process.

import { loadJSON } from '../lib/data.js';
import { esc, fmt, pct, icon } from '../lib/dom.js';
import { diagramCard, mountDiagramCards } from '../lib/ui.js';
import { renderRhythmPlayer } from '../components/rhythm-player.js';
import { tr, getLang } from '../lib/i18n.js';

const aami = () => [
  { cls: 'N', name: 'Normal', desc: tr('Normalschläge, Links-/Rechtsschenkelblock, atriale und nodale Ersatzschläge', 'Normal beats, left/right bundle branch block, atrial and nodal escape beats'), symbols: 'N L R e j' },
  { cls: 'S', name: tr('Supraventrikulär', 'Supraventricular'), desc: tr('Supraventrikuläre Extrasystolen (atrial, aberrant, nodal)', 'Supraventricular premature beats (atrial, aberrant, nodal)'), symbols: 'A a J S' },
  { cls: 'V', name: tr('Ventrikulär', 'Ventricular'), desc: tr('Ventrikuläre Extrasystolen und ventrikuläre Ersatzschläge', 'Premature ventricular contractions and ventricular escape beats'), symbols: 'V E' },
  { cls: 'F', name: 'Fusion', desc: tr('Fusion aus ventrikulärem und normalem Schlag', 'Fusion of a ventricular and a normal beat'), symbols: 'F' },
  { cls: 'Q', name: tr('Unbekannt', 'Unknown'), desc: tr('Schrittmacher-, Fusions-Schrittmacher- und nicht klassifizierbare Schläge', 'Paced, fusion-of-paced and unclassifiable beats'), symbols: '/ f Q' },
];

// English versions of the fixed `reason` strings the pipeline writes into metrics.json
// (exact match on the German text, see PENDING_REASON in src/ekg/pipeline.py).
const REASON_EN = {
  ['Die vollständige MIT-BIH Arrhythmia Database (48 Records, davon 44 in DS1/DS2) ist nicht '
    + 'verfügbar: physionet.org ist in dieser Container-Umgebung durch die Netzwerk-Policy gesperrt. '
    + 'Ohne DS1 (Training) und DS2 (Test) werden keine Modell-Kennzahlen berechnet. '
    + 'Nachholen: physionet.org freischalten (oder lokal ausführen), dann `make data` '
    + '(python scripts/download_mitdb.py --data-dir data/mitdb) und `make train` '
    + '(python -m ekg.pipeline train --data-dir data/mitdb --out artifacts --export web/public/data).']:
    'The full MIT-BIH Arrhythmia Database (48 records, 44 of them in DS1/DS2) is not '
    + 'available: physionet.org is blocked by the network policy of this container environment. '
    + 'Without DS1 (training) and DS2 (test), no model metrics are computed. '
    + 'To catch up: unblock physionet.org (or run locally), then `make data` '
    + '(python scripts/download_mitdb.py --data-dir data/mitdb) and `make train` '
    + '(python -m ekg.pipeline train --data-dir data/mitdb --out artifacts --export web/public/data).',
};

/** Pipeline reason in the current language; unknown German text is hidden in English. */
function reasonText(reason) {
  if (!reason) return null;
  return getLang() === 'en' ? (REASON_EN[reason] ?? null) : reason;
}

function sumCounts(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return Object.values(obj).reduce((a, b) => a + (Number(b) || 0), 0);
}

function recordsCount(v) {
  if (Array.isArray(v)) return v.length;
  if (typeof v === 'number') return v;
  return null;
}

/** Escape text and turn `code` spans into <code> elements. */
function withCode(text) {
  return String(text).split('`').map((part, i) => (i % 2 ? `<code class="rounded border border-line bg-surface px-1 font-mono text-[13px]">${esc(part)}</code>` : esc(part))).join('');
}

/** Pipeline stages shown next to the overview diagram (link targets = STEPS ids). */
const pipelineStages = () => [
  { step: 'rohsignal', title: tr('Rohsignal einlesen', 'Read raw signal'), text: tr('MIT-BIH-Record, Ableitung MLII, 360 Hz, mit Kardiologen-Annotationen.', 'MIT-BIH record, lead MLII, 360 Hz, with cardiologist annotations.') },
  { step: 'filterung', title: tr('Filtern', 'Filter'), text: tr('Median-Baseline (200 + 600 ms), Butterworth-Bandpass 0,5–40 Hz, nullphasig.', 'Median baseline (200 + 600 ms), Butterworth bandpass 0.5–40 Hz, zero-phase.') },
  { step: 'r-zacken', title: tr('R-Zacken finden', 'Find R peaks'), text: tr('Pan-Tompkins: Bandpass, Ableitung, Quadrierung, Integration, adaptive Schwellen.', 'Pan-Tompkins: bandpass, derivative, squaring, integration, adaptive thresholds.') },
  { step: 'segmentierung', title: tr('Schläge ausschneiden', 'Cut out beats'), text: tr('250 ms vor bis 450 ms nach R = 252 Samples, plus vier RR-Merkmale.', '250 ms before to 450 ms after R = 252 samples, plus four RR features.') },
  { step: 'cnn-architektur', title: tr('Klassifizieren', 'Classify'), text: tr('1D-CNN mit RR-Fusion; Entscheidungsbaum als interpretierbarer Vergleich.', '1D CNN with RR fusion; decision tree as an interpretable comparison.') },
  { step: 'evaluation', title: tr('Inter-Patient bewerten', 'Evaluate inter-patient'), text: tr('Training auf DS1, Test auf DS2: Sensitivität, PPV und Macro-F1 je Klasse.', 'Train on DS1, test on DS2: sensitivity, PPV and macro F1 per class.') },
];

/** Recording position as min:s with one decimal (e.g. 25:13,9 in German, 25:13.9 in English). */
function clock(sec) {
  const t = Math.round(Math.max(0, sec) * 10) / 10;
  const m = Math.floor(t / 60);
  const [i, f] = (t - m * 60).toFixed(1).split('.');
  return `${m}:${i.padStart(2, '0')}${tr(',', '.')}${f}`;
}

/** KPI tiles derived exclusively from exported files. Missing data -> no tile. */
function buildTiles({ signal, arch, stats, metrics }) {
  const tiles = [];
  if (signal) {
    const n = Array.isArray(signal.raw) ? signal.raw.length : 0;
    const dur = signal.fs && n ? n / signal.fs : null;
    tiles.push({ label: tr('Demo-Record', 'Demo record'), value: esc(signal.record ?? '–'), unit: '', hint: `MIT-BIH, ${fmt(signal.fs)} Hz`, src: 'signal_demo.json' });
    if (Array.isArray(signal.r_peaks)) {
      tiles.push({ label: tr('R-Zacken im Fenster', 'R peaks in window'), value: fmt(signal.r_peaks.length), unit: '', hint: dur ? `Pan-Tompkins, ${fmt(dur, 1)} s ${tr('Ausschnitt', 'excerpt')}` : 'Pan-Tompkins', src: 'signal_demo.json' });
    }
    const det = signal.detection;
    if (det && det.sensitivity != null) {
      tiles.push({ label: tr('R-Zacken-Sensitivität', 'R-peak sensitivity'), value: pct(det.sensitivity), unit: '', hint: `TP ${fmt(det.tp)} · FN ${fmt(det.fn)} – ${det.scope === 'window' ? tr('nur dieses Fenster', 'this window only') : `${tr('gesamter Record', 'entire record')} ${esc(signal.record ?? '100')}${det.n_reference ? ` (${fmt(det.n_reference)} ${tr('Referenz-Schläge', 'reference beats')})` : ''}`}`, src: 'signal_demo.json' });
    }
    if (det && det.ppv != null) {
      tiles.push({ label: tr('R-Zacken-PPV', 'R-peak PPV'), value: pct(det.ppv), unit: '', hint: `FP ${fmt(det.fp)} – ${tr('Referenz: Expertenannotation', 'reference: expert annotation')}, ±${fmt(det.tol_ms ?? 150)} ms`, src: 'signal_demo.json' });
    }
  }
  if (arch && arch.total_params != null) {
    tiles.push({ label: tr('Modellparameter', 'Model parameters'), value: fmt(arch.total_params), unit: '', hint: `ECGNet1D · ${fmt((arch.layers ?? []).filter((l) => l.type !== 'Input').length)} ${tr('Schichten', 'layers')}`, src: 'architecture.json' });
  }
  if (stats && stats.status && stats.status !== 'pending') {
    const rc = recordsCount(stats.records_available);
    if (rc != null) tiles.push({ label: tr('Records verfügbar', 'Records available'), value: fmt(rc), unit: '', hint: tr('MIT-BIH, lokal geladen', 'MIT-BIH, loaded locally'), src: 'dataset_stats.json' });
    const ds1 = sumCounts(stats.per_split?.DS1);
    const ds2 = sumCounts(stats.per_split?.DS2);
    if (ds1 != null) tiles.push({ label: tr('Beats DS1 (Training)', 'Beats DS1 (training)'), value: fmt(ds1), unit: '', hint: tr('de Chazal Inter-Patient-Split', 'de Chazal inter-patient split'), src: 'dataset_stats.json' });
    if (ds2 != null) tiles.push({ label: tr('Beats DS2 (Test)', 'Beats DS2 (test)'), value: fmt(ds2), unit: '', hint: tr('keine Record-Überlappung mit DS1', 'no record overlap with DS1'), src: 'dataset_stats.json' });
  }
  if (metrics && metrics.status === 'complete') {
    const cnn = metrics.cnn?.summary;
    const tree = metrics.tree?.summary;
    if (cnn?.macro_f1 != null) tiles.push({ label: tr('Macro-F1 · 1D-CNN', 'Macro F1 · 1D CNN'), value: fmt(cnn.macro_f1, 3), unit: '', hint: `${esc(metrics.split || 'DS1 → DS2')}`, src: 'metrics.json' });
    if (cnn?.per_class?.V?.sensitivity != null) tiles.push({ label: tr('Sensitivität V · CNN', 'Sensitivity V · CNN'), value: pct(cnn.per_class.V.sensitivity), unit: '', hint: `PPV ${pct(cnn.per_class.V.ppv)}`, src: 'metrics.json' });
    if (cnn?.per_class?.S?.sensitivity != null) tiles.push({ label: tr('Sensitivität S · CNN', 'Sensitivity S · CNN'), value: pct(cnn.per_class.S.sensitivity), unit: '', hint: `PPV ${pct(cnn.per_class.S.ppv)}`, src: 'metrics.json' });
    if (tree?.macro_f1 != null) tiles.push({ label: tr('Macro-F1 · Entscheidungsbaum', 'Macro F1 · decision tree'), value: fmt(tree.macro_f1, 3), unit: '', hint: tr('interpretierbare Baseline', 'interpretable baseline'), src: 'metrics.json' });
  }
  return tiles;
}

function tilesMarkup(tiles) {
  if (!tiles.length) {
    return `<div class="card px-5 py-6 text-sm text-muted">${tr(
      'Noch keine exportierten Pipeline-Daten gefunden (<code class="font-mono text-xs">web/public/data/*.json</code>). Kennzahlen werden ausschließlich aus echten Exporten berechnet und erscheinen, sobald die Pipeline gelaufen ist.',
      'No exported pipeline data found yet (<code class="font-mono text-xs">web/public/data/*.json</code>). Metrics are computed exclusively from real exports and appear once the pipeline has run.',
    )}</div>`;
  }
  return `<div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">${tiles.map((t) => `
    <div class="card flex min-w-0 flex-col gap-1 p-4 sm:p-5">
      <p class="eyebrow leading-snug">${esc(t.label)}</p>
      <p class="num mt-1 truncate text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">${t.value}</p>
      <p class="text-[13px] leading-snug text-muted">${t.hint}</p>
      <p class="mt-auto pt-3"><span class="chip chip-mono">${icon('file', 'size-3')}${esc(t.src)}</span></p>
    </div>`).join('')}</div>`;
}

function bannerMarkup({ stats, metrics }) {
  if (metrics && metrics.status === 'complete') {
    return `<div class="notice notice-ok" role="status">
      <span class="notice-icon">${icon('checkCircle', 'size-5')}</span>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-fg">${tr('Volltraining abgeschlossen', 'Full training complete')}</p>
        <p class="mt-1 text-[15px] leading-relaxed text-muted">${tr('Ergebnisse auf', 'Results on')} ${esc(metrics.dataset || 'MIT-BIH')} · ${tr('Split', 'split')} ${esc(metrics.split || 'DS1 → DS2')}${/inter-patient/i.test(metrics.split || '') ? '' : ' (inter-patient)'}. ${tr('Alle Kennzahlen unten stammen aus', 'All metrics below come from')} <code class="font-mono text-xs">metrics.json</code>.</p>
      </div>
    </div>`;
  }
  const metricsState = metrics ? (metrics.status || tr('unbekannt', 'unknown')) : tr('nicht vorhanden', 'missing');
  const statsState = stats ? (stats.status || tr('unbekannt', 'unknown')) : tr('nicht vorhanden', 'missing');
  const reason = reasonText(metrics?.reason);
  return `<div class="notice" role="status">
    <span class="notice-icon">${icon('alert', 'size-5')}</span>
    <div class="min-w-0">
      <p class="text-sm font-semibold text-fg">${tr('Vollständige MIT-BIH-Datenbank nicht geladen', 'Full MIT-BIH database not loaded')}</p>
      <p class="mt-1 text-[15px] leading-relaxed text-muted">${tr(`
        <span class="font-medium text-fg">physionet.org</span> ist in dieser Umgebung gesperrt, daher konnten die 48 Records nicht heruntergeladen werden.
        Alle Signal-Demos nutzen den <span class="font-medium text-fg">echten MIT-BIH-Record 100</span>.
        Modellmetriken (Training DS1 → Test DS2) erscheinen erst nach dem Volltraining – es werden bewusst keine Platzhalter- oder Einzel-Record-Ergebnisse gezeigt.
      `, `
        <span class="font-medium text-fg">physionet.org</span> is blocked in this environment, so the 48 records could not be downloaded.
        All signal demos use the <span class="font-medium text-fg">real MIT-BIH record 100</span>.
        Model metrics (training DS1 → test DS2) only appear after full training – placeholder or single-record results are deliberately not shown.
      `)}</p>
      ${reason ? `<p class="mt-2 text-[15px] text-muted">${tr('Grund laut Pipeline:', 'Reason reported by the pipeline:')} <span class="text-fg">${withCode(reason)}</span></p>` : ''}
      <div class="mt-3 flex flex-wrap gap-2">
        <span class="chip chip-mono">metrics.json: ${esc(metricsState)}</span>
        <span class="chip chip-mono">dataset_stats.json: ${esc(statsState)}</span>
      </div>
    </div>
  </div>`;
}

/** Real ECG excerpt (filtered lead MLII) drawn from signal_demo.json. */
function ecgExcerpt(signal) {
  const series = Array.isArray(signal?.filtered) && signal.filtered.length ? signal.filtered : signal?.raw;
  if (!Array.isArray(series) || series.length < 10 || !signal.fs) return null;
  const fs = Number(signal.fs);
  const n = Math.min(series.length, Math.round(fs * 4));
  const W = 800, H = 200, pad = 14;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const v = Number(series[i]); if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo) || hi - lo < 1e-9) return null;
  const step = Math.max(1, Math.floor(n / W));
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => pad + (1 - (v - lo) / (hi - lo)) * (H - 2 * pad);
  const pts = [];
  for (let i = 0; i < n; i += step) pts.push(`${x(i).toFixed(1)},${y(Number(series[i])).toFixed(1)}`);
  const peaks = (signal.r_peaks || []).filter((p) => p >= 0 && p < n);
  const ticks = peaks.map((p) => `<line x1="${x(p).toFixed(1)}" x2="${x(p).toFixed(1)}" y1="2" y2="10" stroke="var(--c-peak)" stroke-width="2" vector-effect="non-scaling-stroke"/>`).join('');
  const startS = Number(signal.start_s) || 0;
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="block h-40 w-full sm:h-48" role="img" aria-label="${tr(`Gefiltertes EKG, Record ${esc(signal.record)}, ${fmt(n / fs, 1)} Sekunden ab ${fmt(startS, 1)} s`, `Filtered ECG, record ${esc(signal.record)}, ${fmt(n / fs, 1)} seconds from ${fmt(startS, 1)} s`)}">
    ${ticks}
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--c-filtered)" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
  const legend = `<div class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[13px] text-muted">
    <span class="flex items-center gap-3">
      <span class="inline-flex items-center gap-1.5"><span class="h-0.5 w-4 rounded" style="background:var(--c-filtered)"></span>${tr('gefiltert (MLII)', 'filtered (MLII)')}</span>
      <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-0.5 rounded" style="background:var(--c-peak)"></span>${tr('R-Zacke', 'R peak')}</span>
    </span>
    <span class="num" title="${tr('Position im Record (min:s)', 'Position in record (min:s)')}">${clock(startS)}–${clock(startS + n / fs)} · ${fmt(fs)} Hz</span>
  </div>`;
  return { svg, legend };
}

function heroSignalCard(signal, loading = false) {
  const excerpt = ecgExcerpt(signal);
  return `<div class="card overflow-hidden">
    <div class="card-head">
      <div class="min-w-0">
        <p class="eyebrow">${tr('Echtes Signal', 'Real signal')}</p>
        <p class="mt-0.5 truncate text-sm font-semibold">${tr('MIT-BIH Record', 'MIT-BIH record')} ${signal ? esc(signal.record) : '100'}</p>
      </div>
      <span class="chip">${icon('activity', 'size-3')}${signal ? 'signal_demo.json' : (loading ? tr('lädt', 'loading') : tr('ausstehend', 'pending'))}</span>
    </div>
    ${excerpt ? `<div class="ecg-paper">${excerpt.svg}</div>${excerpt.legend}` : `<div class="ecg-paper grid h-48 place-items-center px-6 text-center text-[15px] text-muted">
      <span class="rounded-lg border border-line bg-surface px-3 py-2">${loading ? tr('Lade Signal …', 'Loading signal …') : tr('Signal-Export noch nicht erzeugt (<code class="font-mono text-xs">signal_demo.json</code>). Die Pipeline schreibt ihn aus Record 100.', 'Signal export not generated yet (<code class="font-mono text-xs">signal_demo.json</code>). The pipeline writes it from record 100.')}</span>
    </div>`}
  </div>`;
}

export async function render(root) {
  root.innerHTML = `
  <section class="relative border-b border-line">
    <div class="mx-auto grid max-w-7xl gap-10 px-4 pb-14 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14 lg:px-8 lg:pb-20 lg:pt-20">
      <div class="min-w-0">
        <p class="flex flex-wrap items-center gap-2">
          <span class="chip">${icon('activity', 'size-3 text-accent')}MIT-BIH Arrhythmia</span>
          <span class="chip">AAMI EC57</span>
          <span class="chip">${tr('Inter-Patient', 'Inter-patient')} DS1 → DS2</span>
        </p>
        <h1 class="mt-5 text-[34px] font-semibold leading-[1.08] tracking-tight text-fg sm:text-[44px] xl:text-5xl">
          ${tr('Arrhythmie-Erkennung im EKG – nachvollziehbar vom Rohsignal bis zur Klasse.', 'Arrhythmia detection in the ECG – traceable from raw signal to class.')}
        </h1>
        <p class="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-[17px]">${tr(`
          Herzschläge aus der MIT-BIH-Datenbank werden gefiltert, an den annotierten R-Zacken segmentiert (Pan-Tompkins als annotationsfreie Alternative) und von einem
          <span class="text-fg">1D-CNN mit RR-Intervall-Fusion</span> in die fünf AAMI-Klassen eingeordnet.
          Ein <span class="text-fg">interpretierbarer Entscheidungsbaum</span> dient als Vergleich – evaluiert inter-patient ohne Record-Überlappung (bis auf 201/202, gleiche Person).
        `, `
          Heartbeats from the MIT-BIH database are filtered, segmented at the annotated R peaks (Pan-Tompkins as an annotation-free alternative) and assigned to the five AAMI classes by a
          <span class="text-fg">1D CNN with RR-interval fusion</span>.
          An <span class="text-fg">interpretable decision tree</span> serves as a comparison – evaluated inter-patient without record overlap (except 201/202, same person).
        `)}</p>
        <div class="mt-8 flex flex-wrap gap-3">
          <a href="#/process" class="btn btn-primary">${tr('Process ansehen', 'View process')} ${icon('arrowRight')}</a>
          <a href="#/status" class="btn btn-ghost">${icon('users')} ${tr('Agenten-Status', 'Agent status')}</a>
        </div>
      </div>
      <div class="min-w-0 space-y-4">
        <div data-hero-signal>${heroSignalCard(null, true)}</div>
        <div class="card overflow-hidden">
          <div class="card-head">
            <div class="min-w-0">
              <p class="eyebrow">${tr('Rhythmus-Player', 'Rhythm player')}</p>
              <p class="mt-0.5 truncate text-sm font-semibold">${tr('Auffällige Schläge live', 'Abnormal beats live')}</p>
            </div>
            <span class="chip">${icon('activity', 'size-3')}rhythm_demo.json</span>
          </div>
          <div data-rhythm>${'<div class="skeleton h-72 w-full"></div>'}</div>
        </div>
      </div>
    </div>
  </section>

  <div class="mx-auto max-w-7xl space-y-16 px-4 pt-10 sm:px-6 lg:px-8">
    <section aria-labelledby="ov-data" class="space-y-5">
      <h2 id="ov-data" class="sr-only">${tr('Datenstatus', 'Data status')}</h2>
      <div data-banner>${'<div class="skeleton h-28 w-full"></div>'}</div>
      <div data-tiles><div class="grid grid-cols-2 gap-4 lg:grid-cols-4">${'<div class="skeleton h-32"></div>'.repeat(4)}</div></div>
    </section>

    <section aria-labelledby="ov-pipeline" class="space-y-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="eyebrow">Pipeline</p>
          <h2 id="ov-pipeline" class="mt-1 text-2xl font-semibold tracking-tight">${tr('Vom Rohsignal zur AAMI-Klasse', 'From raw signal to AAMI class')}</h2>
        </div>
        <a href="#/process" class="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">${tr('Alle Schritte im Detail', 'All steps in detail')} ${icon('arrowRight', 'size-3.5')}</a>
      </div>
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10">
        <ol class="grid gap-2.5 lg:sticky lg:top-24" aria-label="${tr('Pipeline-Stufen', 'Pipeline stages')}">
          ${pipelineStages().map((st, i) => `<li>
            <a href="#/process/${st.step}" class="group flex gap-3.5 rounded-xl border border-line bg-surface p-3.5 transition-colors hover:border-accent/50 hover:bg-surface-2">
              <span class="num grid size-8 flex-none place-items-center rounded-lg border border-line bg-surface-2 font-mono text-[13px] font-semibold text-muted group-hover:text-accent">${String(i + 1).padStart(2, '0')}</span>
              <span class="min-w-0">
                <span class="block text-sm font-semibold text-fg">${esc(st.title)}</span>
                <span class="mt-0.5 block text-[15px] leading-relaxed text-muted">${esc(st.text)}</span>
              </span>
              ${icon('arrowRight', 'ml-auto mt-1 size-3.5 flex-none text-muted opacity-0 transition-opacity group-hover:opacity-100')}
            </a>
          </li>`).join('')}
        </ol>
        <div class="min-w-0">${diagramCard('pipeline-overview', { eyebrow: tr('Übersicht', 'Overview'), minHeight: '14rem' })}</div>
      </div>
    </section>

    <section aria-labelledby="ov-classes" class="space-y-5">
      <div>
        <p class="eyebrow">${tr('Zielklassen', 'Target classes')}</p>
        <h2 id="ov-classes" class="mt-1 text-2xl font-semibold tracking-tight">${tr('Fünf AAMI-EC57-Klassen', 'Five AAMI EC57 classes')}</h2>
        <p class="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted">${tr('Die rund 15 MIT-BIH-Schlagsymbole werden nach AAMI EC57 zu fünf Klassen zusammengefasst. Klinisch entscheidend – und am schwersten – sind S und V; N dominiert mit rund 90 % aller Schläge, darum zählen Sensitivität, PPV und Macro-F1 mehr als Accuracy.', 'The roughly 15 MIT-BIH beat symbols are grouped into five classes according to AAMI EC57. Clinically decisive – and hardest – are S and V; N dominates with about 90% of all beats, so sensitivity, PPV and macro F1 matter more than accuracy.')}</p>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        ${aami().map((c) => `<div class="card flex flex-col gap-2 p-4">
          <div class="flex items-center justify-between">
            <span class="grid size-8 place-items-center rounded-lg font-mono text-sm font-semibold" style="color:var(--c-cls-${c.cls});background:color-mix(in srgb,var(--c-cls-${c.cls}) 12%,transparent);border:1px solid color-mix(in srgb,var(--c-cls-${c.cls}) 30%,transparent)">${c.cls}</span>
            <span class="font-mono text-xs text-muted">${esc(c.symbols)}</span>
          </div>
          <p class="text-sm font-semibold">${esc(c.name)}</p>
          <p class="text-[15px] leading-relaxed text-muted">${esc(c.desc)}</p>
        </div>`).join('')}
      </div>
    </section>

    <section aria-labelledby="ov-principles" class="grid gap-3 md:grid-cols-3">
      <h2 id="ov-principles" class="sr-only">${tr('Prinzipien', 'Principles')}</h2>
      ${[
        ['layers', tr('Inter-Patient statt Intra-Patient', 'Inter-patient instead of intra-patient'), tr('Training auf DS1, Test auf DS2 (de Chazal 2004). Kein Record taucht in beiden Mengen auf, und bis auf 201/202 (gleiche Person) auch kein Patient – sonst wären die Zahlen unrealistisch hoch.', 'Train on DS1, test on DS2 (de Chazal 2004). No record appears in both sets, and apart from 201/202 (same person) no patient either – otherwise the numbers would be unrealistically high.')],
        ['git', tr('Zwei Modelle, ein Vergleich', 'Two models, one comparison'), tr('1D-CNN mit RR-Intervall-Fusion für Genauigkeit, flacher Entscheidungsbaum auf interpretierbaren Merkmalen für Nachvollziehbarkeit.', '1D CNN with RR-interval fusion for accuracy, shallow decision tree on interpretable features for traceability.')],
        ['lock', tr('Ehrliche Datenlage', 'Honest about the data'), tr('Kennzahlen stammen nur aus echten Exporten. Ohne vollständige Datenbank bleibt die Evaluierung sichtbar „ausstehend“.', 'Metrics come only from real exports. Without the full database, the evaluation visibly stays “pending”.')],
      ].map(([ic, t, d]) => `<div class="card p-5">
        <span class="grid size-9 place-items-center rounded-lg border border-line bg-surface-2 text-accent">${icon(ic)}</span>
        <p class="mt-4 text-[15px] font-semibold">${t}</p>
        <p class="mt-1.5 text-[15px] leading-relaxed text-muted">${d}</p>
      </div>`).join('')}
    </section>

    <section class="card flex flex-col items-start justify-between gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
      <div>
        <p class="eyebrow">Process</p>
        <p class="mt-1 text-xl font-semibold tracking-tight">${tr('Jeder Schritt erklärt – mit Diagrammen und echten Daten.', 'Every step explained – with diagrams and real data.')}</p>
        <p class="mt-1.5 max-w-xl text-[15px] text-muted">${tr('Datenvorverarbeitung, Filterung, R-Zacken-Detektion, Segmentierung, Modellarchitektur, Training und Evaluierung.', 'Data preprocessing, filtering, R-peak detection, segmentation, model architecture, training and evaluation.')}</p>
      </div>
      <a href="#/process" class="btn btn-primary flex-none">${tr('Zum Process', 'Go to Process')} ${icon('arrowRight')}</a>
    </section>
  </div>`;

  const cleanupDiagrams = mountDiagramCards(root);
  let alive = true;

  let player = null;

  const [signal, arch, stats, metrics, rhythm] = await Promise.all([
    loadJSON('signal_demo.json'),
    loadJSON('architecture.json'),
    loadJSON('dataset_stats.json'),
    loadJSON('metrics.json'),
    loadJSON('rhythm_demo.json'),
  ]);
  if (alive) {
    root.querySelector('[data-hero-signal]').innerHTML = heroSignalCard(signal);
    player = renderRhythmPlayer(root.querySelector('[data-rhythm]'), rhythm);
    root.querySelector('[data-banner]').innerHTML = bannerMarkup({ stats, metrics });
    root.querySelector('[data-tiles]').innerHTML = tilesMarkup(buildTiles({ signal, arch, stats, metrics }));
  }

  return {
    destroy() {
      alive = false;
      player?.destroy();
      cleanupDiagrams();
    },
  };
}
