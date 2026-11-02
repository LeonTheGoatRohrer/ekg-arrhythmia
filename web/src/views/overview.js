// Overview ("Übersicht"): project goal, honest data-status banner, KPI tiles computed
// only from real exported data, pipeline diagram, AAMI class legend and CTA to Process.

import { loadJSON } from '../lib/data.js';
import { esc, fmt, pct, icon } from '../lib/dom.js';
import { diagramCard, mountDiagramCards } from '../lib/ui.js';
import { renderRhythmPlayer } from '../components/rhythm-player.js';

const AAMI = [
  { cls: 'N', name: 'Normal', desc: 'Normalschläge, Links-/Rechtsschenkelblock, atriale und nodale Ersatzschläge', symbols: 'N L R e j' },
  { cls: 'S', name: 'Supraventrikulär', desc: 'Supraventrikuläre Extrasystolen (atrial, aberrant, nodal)', symbols: 'A a J S' },
  { cls: 'V', name: 'Ventrikulär', desc: 'Ventrikuläre Extrasystolen und ventrikuläre Ersatzschläge', symbols: 'V E' },
  { cls: 'F', name: 'Fusion', desc: 'Fusion aus ventrikulärem und normalem Schlag', symbols: 'F' },
  { cls: 'Q', name: 'Unbekannt', desc: 'Schrittmacher-, Fusions-Schrittmacher- und nicht klassifizierbare Schläge', symbols: '/ f Q' },
];

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
  return String(text).split('`').map((part, i) => (i % 2 ? `<code class="rounded border border-line bg-surface px-1 font-mono text-[12px]">${esc(part)}</code>` : esc(part))).join('');
}

/** Pipeline stages shown next to the overview diagram (link targets = STEPS ids). */
const PIPELINE_STAGES = [
  { step: 'rohsignal', title: 'Rohsignal einlesen', text: 'MIT-BIH-Record, Ableitung MLII, 360 Hz, mit Kardiologen-Annotationen.' },
  { step: 'filterung', title: 'Filtern', text: 'Median-Baseline (200 + 600 ms), Butterworth-Bandpass 0,5–40 Hz, nullphasig.' },
  { step: 'r-zacken', title: 'R-Zacken finden', text: 'Pan-Tompkins: Bandpass, Ableitung, Quadrierung, Integration, adaptive Schwellen.' },
  { step: 'segmentierung', title: 'Schläge ausschneiden', text: '250 ms vor bis 450 ms nach R = 252 Samples, plus vier RR-Merkmale.' },
  { step: 'cnn-architektur', title: 'Klassifizieren', text: '1D-CNN mit RR-Fusion; Entscheidungsbaum als interpretierbarer Vergleich.' },
  { step: 'evaluation', title: 'Inter-Patient bewerten', text: 'Training auf DS1, Test auf DS2: Sensitivität, PPV und Macro-F1 je Klasse.' },
];

/** Recording position as min:s with one decimal (e.g. 25:13,9). */
function clock(sec) {
  const t = Math.round(Math.max(0, sec) * 10) / 10;
  const m = Math.floor(t / 60);
  const [i, f] = (t - m * 60).toFixed(1).split('.');
  return `${m}:${i.padStart(2, '0')},${f}`;
}

/** KPI tiles derived exclusively from exported files. Missing data -> no tile. */
function buildTiles({ signal, arch, stats, metrics }) {
  const tiles = [];
  if (signal) {
    const n = Array.isArray(signal.raw) ? signal.raw.length : 0;
    const dur = signal.fs && n ? n / signal.fs : null;
    tiles.push({ label: 'Demo-Record', value: esc(signal.record ?? '–'), unit: '', hint: `MIT-BIH, ${fmt(signal.fs)} Hz`, src: 'signal_demo.json' });
    if (Array.isArray(signal.r_peaks)) {
      tiles.push({ label: 'R-Zacken im Fenster', value: fmt(signal.r_peaks.length), unit: '', hint: dur ? `Pan-Tompkins, ${fmt(dur, 1)} s Ausschnitt` : 'Pan-Tompkins', src: 'signal_demo.json' });
    }
    const det = signal.detection;
    if (det && det.sensitivity != null) {
      tiles.push({ label: 'R-Zacken-Sensitivität', value: pct(det.sensitivity), unit: '', hint: `TP ${fmt(det.tp)} · FN ${fmt(det.fn)} – ${det.scope === 'window' ? 'nur dieses Fenster' : `gesamter Record ${esc(signal.record ?? '100')}${det.n_reference ? ` (${fmt(det.n_reference)} Referenz-Schläge)` : ''}`}`, src: 'signal_demo.json' });
    }
    if (det && det.ppv != null) {
      tiles.push({ label: 'R-Zacken-PPV', value: pct(det.ppv), unit: '', hint: `FP ${fmt(det.fp)} – Referenz: Expertenannotation, ±${fmt(det.tol_ms ?? 150)} ms`, src: 'signal_demo.json' });
    }
  }
  if (arch && arch.total_params != null) {
    tiles.push({ label: 'Modellparameter', value: fmt(arch.total_params), unit: '', hint: `ECGNet1D · ${fmt((arch.layers ?? []).filter((l) => l.type !== 'Input').length)} Schichten`, src: 'architecture.json' });
  }
  if (stats && stats.status && stats.status !== 'pending') {
    const rc = recordsCount(stats.records_available);
    if (rc != null) tiles.push({ label: 'Records verfügbar', value: fmt(rc), unit: '', hint: 'MIT-BIH, lokal geladen', src: 'dataset_stats.json' });
    const ds1 = sumCounts(stats.per_split?.DS1);
    const ds2 = sumCounts(stats.per_split?.DS2);
    if (ds1 != null) tiles.push({ label: 'Beats DS1 (Training)', value: fmt(ds1), unit: '', hint: 'de Chazal Inter-Patient-Split', src: 'dataset_stats.json' });
    if (ds2 != null) tiles.push({ label: 'Beats DS2 (Test)', value: fmt(ds2), unit: '', hint: 'keine Record-Überlappung mit DS1', src: 'dataset_stats.json' });
  }
  if (metrics && metrics.status === 'complete') {
    const cnn = metrics.cnn?.summary;
    const tree = metrics.tree?.summary;
    if (cnn?.macro_f1 != null) tiles.push({ label: 'Macro-F1 · 1D-CNN', value: fmt(cnn.macro_f1, 3), unit: '', hint: `${esc(metrics.split || 'DS1 → DS2')}`, src: 'metrics.json' });
    if (cnn?.per_class?.V?.sensitivity != null) tiles.push({ label: 'Sensitivität V · CNN', value: pct(cnn.per_class.V.sensitivity), unit: '', hint: `PPV ${pct(cnn.per_class.V.ppv)}`, src: 'metrics.json' });
    if (cnn?.per_class?.S?.sensitivity != null) tiles.push({ label: 'Sensitivität S · CNN', value: pct(cnn.per_class.S.sensitivity), unit: '', hint: `PPV ${pct(cnn.per_class.S.ppv)}`, src: 'metrics.json' });
    if (tree?.macro_f1 != null) tiles.push({ label: 'Macro-F1 · Entscheidungsbaum', value: fmt(tree.macro_f1, 3), unit: '', hint: 'interpretierbare Baseline', src: 'metrics.json' });
  }
  return tiles;
}

function tilesMarkup(tiles) {
  if (!tiles.length) {
    return `<div class="card px-5 py-6 text-sm text-muted">Noch keine exportierten Pipeline-Daten gefunden (<code class="font-mono text-xs">web/public/data/*.json</code>). Kennzahlen werden ausschließlich aus echten Exporten berechnet und erscheinen, sobald die Pipeline gelaufen ist.</div>`;
  }
  return `<div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">${tiles.map((t) => `
    <div class="card flex min-w-0 flex-col gap-1 p-4 sm:p-5">
      <p class="eyebrow truncate">${esc(t.label)}</p>
      <p class="num mt-1 truncate text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">${t.value}</p>
      <p class="text-[12px] leading-snug text-muted">${t.hint}</p>
      <p class="mt-auto pt-3"><span class="chip chip-mono">${icon('file', 'size-3')}${esc(t.src)}</span></p>
    </div>`).join('')}</div>`;
}

function bannerMarkup({ stats, metrics }) {
  if (metrics && metrics.status === 'complete') {
    return `<div class="notice notice-ok" role="status">
      <span class="notice-icon">${icon('checkCircle', 'size-5')}</span>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-fg">Volltraining abgeschlossen</p>
        <p class="mt-1 text-[13px] leading-relaxed text-muted">Ergebnisse auf ${esc(metrics.dataset || 'MIT-BIH')} · Split ${esc(metrics.split || 'DS1 → DS2')} (inter-patient). Alle Kennzahlen unten stammen aus <code class="font-mono text-xs">metrics.json</code>.</p>
      </div>
    </div>`;
  }
  const metricsState = metrics ? (metrics.status || 'unbekannt') : 'nicht vorhanden';
  const statsState = stats ? (stats.status || 'unbekannt') : 'nicht vorhanden';
  return `<div class="notice" role="status">
    <span class="notice-icon">${icon('alert', 'size-5')}</span>
    <div class="min-w-0">
      <p class="text-sm font-semibold text-fg">Vollständige MIT-BIH-Datenbank nicht geladen</p>
      <p class="mt-1 text-[13px] leading-relaxed text-muted">
        <span class="font-medium text-fg">physionet.org</span> ist in dieser Umgebung gesperrt, daher konnten die 48 Records nicht heruntergeladen werden.
        Alle Signal-Demos nutzen den <span class="font-medium text-fg">echten MIT-BIH-Record 100</span>.
        Modellmetriken (Training DS1 → Test DS2) erscheinen erst nach dem Volltraining – es werden bewusst keine Platzhalter- oder Einzel-Record-Ergebnisse gezeigt.
      </p>
      ${metrics?.reason ? `<p class="mt-2 text-[13px] text-muted">Grund laut Pipeline: <span class="text-fg">${withCode(metrics.reason)}</span></p>` : ''}
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
  const svg = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="block h-40 w-full sm:h-48" role="img" aria-label="Gefiltertes EKG, Record ${esc(signal.record)}, ${fmt(n / fs, 1)} Sekunden ab ${fmt(startS, 1)} s">
    ${ticks}
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--c-filtered)" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
  const legend = `<div class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[12px] text-muted">
    <span class="flex items-center gap-3">
      <span class="inline-flex items-center gap-1.5"><span class="h-0.5 w-4 rounded" style="background:var(--c-filtered)"></span>gefiltert (MLII)</span>
      <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-0.5 rounded" style="background:var(--c-peak)"></span>R-Zacke</span>
    </span>
    <span class="num" title="Position im Record (min:s)">${clock(startS)}–${clock(startS + n / fs)} · ${fmt(fs)} Hz</span>
  </div>`;
  return { svg, legend };
}

function heroSignalCard(signal, loading = false) {
  const excerpt = ecgExcerpt(signal);
  return `<div class="card overflow-hidden">
    <div class="card-head">
      <div class="min-w-0">
        <p class="eyebrow">Echtes Signal</p>
        <p class="mt-0.5 truncate text-sm font-semibold">${signal ? `MIT-BIH Record ${esc(signal.record)}` : 'MIT-BIH Record 100'}</p>
      </div>
      <span class="chip">${icon('activity', 'size-3')}${signal ? 'signal_demo.json' : (loading ? 'lädt' : 'ausstehend')}</span>
    </div>
    ${excerpt ? `<div class="ecg-paper">${excerpt.svg}</div>${excerpt.legend}` : `<div class="ecg-paper grid h-48 place-items-center px-6 text-center text-[13px] text-muted">
      <span class="rounded-lg border border-line bg-surface px-3 py-2">${loading ? 'Lade Signal …' : 'Signal-Export noch nicht erzeugt (<code class="font-mono text-xs">signal_demo.json</code>). Die Pipeline schreibt ihn aus Record 100.'}</span>
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
          <span class="chip">Inter-Patient DS1 → DS2</span>
        </p>
        <h1 class="mt-5 text-[34px] font-semibold leading-[1.08] tracking-tight text-fg sm:text-[44px] xl:text-5xl">
          Arrhythmie-Erkennung im EKG – nachvollziehbar vom Rohsignal bis zur Klasse.
        </h1>
        <p class="mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-[17px]">
          Herzschläge aus der MIT-BIH-Datenbank werden gefiltert, an den annotierten R-Zacken segmentiert (Pan-Tompkins als annotationsfreie Alternative) und von einem
          <span class="text-fg">1D-CNN mit RR-Intervall-Fusion</span> in die fünf AAMI-Klassen eingeordnet.
          Ein <span class="text-fg">interpretierbarer Entscheidungsbaum</span> dient als Vergleich – evaluiert inter-patient ohne Record-Überlappung (bis auf 201/202, gleiche Person).
        </p>
        <div class="mt-8 flex flex-wrap gap-3">
          <a href="#/process" class="btn btn-primary">Process ansehen ${icon('arrowRight')}</a>
          <a href="#/status" class="btn btn-ghost">${icon('users')} Agenten-Status</a>
        </div>
      </div>
      <div class="min-w-0 space-y-4">
        <div data-hero-signal>${heroSignalCard(null, true)}</div>
        <div class="card overflow-hidden">
          <div class="card-head">
            <div class="min-w-0">
              <p class="eyebrow">Rhythmus-Player</p>
              <p class="mt-0.5 truncate text-sm font-semibold">Auffällige Schläge live</p>
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
      <h2 id="ov-data" class="sr-only">Datenstatus</h2>
      <div data-banner>${'<div class="skeleton h-28 w-full"></div>'}</div>
      <div data-tiles><div class="grid grid-cols-2 gap-4 lg:grid-cols-4">${'<div class="skeleton h-32"></div>'.repeat(4)}</div></div>
    </section>

    <section aria-labelledby="ov-pipeline" class="space-y-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="eyebrow">Pipeline</p>
          <h2 id="ov-pipeline" class="mt-1 text-2xl font-semibold tracking-tight">Vom Rohsignal zur AAMI-Klasse</h2>
        </div>
        <a href="#/process" class="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Alle Schritte im Detail ${icon('arrowRight', 'size-3.5')}</a>
      </div>
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10">
        <ol class="grid gap-2.5 lg:sticky lg:top-24" aria-label="Pipeline-Stufen">
          ${PIPELINE_STAGES.map((st, i) => `<li>
            <a href="#/process/${st.step}" class="group flex gap-3.5 rounded-xl border border-line bg-surface p-3.5 transition-colors hover:border-accent/50 hover:bg-surface-2">
              <span class="num grid size-8 flex-none place-items-center rounded-lg border border-line bg-surface-2 font-mono text-[12px] font-semibold text-muted group-hover:text-accent">${String(i + 1).padStart(2, '0')}</span>
              <span class="min-w-0">
                <span class="block text-sm font-semibold text-fg">${esc(st.title)}</span>
                <span class="mt-0.5 block text-[13px] leading-relaxed text-muted">${esc(st.text)}</span>
              </span>
              ${icon('arrowRight', 'ml-auto mt-1 size-3.5 flex-none text-muted opacity-0 transition-opacity group-hover:opacity-100')}
            </a>
          </li>`).join('')}
        </ol>
        <div class="min-w-0">${diagramCard('pipeline-overview', { eyebrow: 'Übersicht', minHeight: '14rem' })}</div>
      </div>
    </section>

    <section aria-labelledby="ov-classes" class="space-y-5">
      <div>
        <p class="eyebrow">Zielklassen</p>
        <h2 id="ov-classes" class="mt-1 text-2xl font-semibold tracking-tight">Fünf AAMI-EC57-Klassen</h2>
        <p class="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Die rund 15 MIT-BIH-Schlagsymbole werden nach AAMI EC57 zu fünf Klassen zusammengefasst. Klinisch entscheidend – und am schwersten – sind S und V; N dominiert mit rund 90 % aller Schläge, darum zählen Sensitivität, PPV und Macro-F1 mehr als Accuracy.</p>
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        ${AAMI.map((c) => `<div class="card flex flex-col gap-2 p-4">
          <div class="flex items-center justify-between">
            <span class="grid size-8 place-items-center rounded-lg font-mono text-sm font-semibold" style="color:var(--c-cls-${c.cls});background:color-mix(in srgb,var(--c-cls-${c.cls}) 12%,transparent);border:1px solid color-mix(in srgb,var(--c-cls-${c.cls}) 30%,transparent)">${c.cls}</span>
            <span class="font-mono text-[11px] text-muted">${esc(c.symbols)}</span>
          </div>
          <p class="text-sm font-semibold">${esc(c.name)}</p>
          <p class="text-[13px] leading-relaxed text-muted">${esc(c.desc)}</p>
        </div>`).join('')}
      </div>
    </section>

    <section aria-labelledby="ov-principles" class="grid gap-3 md:grid-cols-3">
      <h2 id="ov-principles" class="sr-only">Prinzipien</h2>
      ${[
        ['layers', 'Inter-Patient statt Intra-Patient', 'Training auf DS1, Test auf DS2 (de Chazal 2004). Kein Record taucht in beiden Mengen auf, und bis auf 201/202 (gleiche Person) auch kein Patient – sonst wären die Zahlen unrealistisch hoch.'],
        ['git', 'Zwei Modelle, ein Vergleich', '1D-CNN mit RR-Intervall-Fusion für Genauigkeit, flacher Entscheidungsbaum auf interpretierbaren Merkmalen für Nachvollziehbarkeit.'],
        ['lock', 'Ehrliche Datenlage', 'Kennzahlen stammen nur aus echten Exporten. Ohne vollständige Datenbank bleibt die Evaluierung sichtbar „ausstehend“.'],
      ].map(([ic, t, d]) => `<div class="card p-5">
        <span class="grid size-9 place-items-center rounded-lg border border-line bg-surface-2 text-accent">${icon(ic)}</span>
        <p class="mt-4 text-[15px] font-semibold">${t}</p>
        <p class="mt-1.5 text-[13px] leading-relaxed text-muted">${d}</p>
      </div>`).join('')}
    </section>

    <section class="card flex flex-col items-start justify-between gap-5 p-6 sm:flex-row sm:items-center sm:p-8">
      <div>
        <p class="eyebrow">Process</p>
        <p class="mt-1 text-xl font-semibold tracking-tight">Jeder Schritt erklärt – mit Diagrammen und echten Daten.</p>
        <p class="mt-1.5 max-w-xl text-sm text-muted">Datenvorverarbeitung, Filterung, R-Zacken-Detektion, Segmentierung, Modellarchitektur, Training und Evaluierung.</p>
      </div>
      <a href="#/process" class="btn btn-primary flex-none">Zum Process ${icon('arrowRight')}</a>
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
