// Models ("Modelle"): how well the 1D-CNN and the decision tree classify DS2 beats,
// compared with chance baselines computed from the DS2 class distribution, plus model
// profiles, confusion matrices, training curve and known weaknesses. Everything comes
// from metrics.json; nothing is shown before the full training has completed. Optional
// blocks (end to end with Pan-Tompkins, external test, DS1 cross-validation, seed
// ensemble) appear only when metrics.json carries them.

import { loadJSON } from '../lib/data.js';
import { esc, fmt, pct, icon } from '../lib/dom.js';
import { emptyState, errorState, skeleton } from '../lib/ui.js';
import { tr, locale } from '../lib/i18n.js';

// [de, en] pairs, resolved at render time via tr().
const CLASS_NAMES = {
  N: ['Normal', 'Normal'], S: ['Supraventrikulär', 'Supraventricular'], V: ['Ventrikulär', 'Ventricular'],
  F: ['Fusion', 'Fusion'], Q: ['Unklassifizierbar', 'Unknown'],
};
const FEATURE_LABELS = {
  qrs_width_ms: ['QRS-Breite', 'QRS width'], r_amplitude: ['R-Amplitude', 'R amplitude'], q_depth: ['Q-Tiefe', 'Q depth'], s_depth: ['S-Tiefe', 'S depth'],
  qrs_area: ['QRS-Fläche', 'QRS area'], t_amplitude: ['T-Amplitude', 'T amplitude'], beat_energy: ['Schlag-Energie', 'Beat energy'],
  pre_rr: ['RR davor', 'RR before'], post_rr: ['RR danach', 'RR after'], local_rr: ['lokales RR-Mittel', 'local RR mean'], rr_ratio: ['RR-Verhältnis', 'RR ratio'],
};
const pick = (map, k) => (map[k] ? tr(...map[k]) : k);
const COLOR = { cnn: 'var(--c-accent)', tree: 'var(--c-accent-2)', chance: 'var(--c-muted)' };

// CNN inputs besides the beat shape, by config.features (see FEATURE_SETS in src/ekg/pipeline.py).
const RR_INPUTS = {
  base: ['vier Rhythmus-Merkmalen (RR-Abstände)', 'four rhythm features (RR intervals)'],
  rr: ['vier Rhythmus-Merkmalen plus drei patientenrelativen RR-Verhältnissen', 'four rhythm features plus three patient-relative RR ratios'],
  patient: ['vier Rhythmus-Merkmalen plus sechs patientenrelativen Merkmalen (RR und Form)', 'four rhythm features plus six patient-relative features (RR and shape)'],
};
const NUM_WORDS = { 2: ['zwei', 'two'], 3: ['drei', 'three'], 4: ['vier', 'four'], 5: ['fünf', 'five'], 6: ['sechs', 'six'] };
const numWord = (n) => (NUM_WORDS[n] ? tr(...NUM_WORDS[n]) : fmt(n));
// Known German texts from the pipeline's external test -> English.
const EXTERNAL_NOTE_EN = {
  'Modelle unverändert aus DS1 übernommen, kein Nachtraining, keine Anpassung.': 'Models taken unchanged from DS1, no retraining, no adjustment.',
};
const LEAD_UNKNOWN = ' (Ableitung in der Datenbank nicht angegeben)';

const f1Of = (s, p) => (s + p > 0 ? (2 * s * p) / (s + p) : 0);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** Small numbers such as learning rates (fmt() would round 3e-4 to 0). */
const sig = (v) => (v == null || Number.isNaN(Number(v)) ? '–' : new Intl.NumberFormat(locale(), { maximumSignificantDigits: 3 }).format(v));
/** "0,460 ± 0,020" for a {mean, std} pair; percent variant for sensitivity/PPV. */
const pm = (s, d = 3) => (s?.mean != null ? `${fmt(s.mean, d)} ± ${fmt(s.std, d)}` : '–');
const pctPm = (s) => (s?.mean != null ? `${fmt(s.mean * 100, 1)} ± ${fmt(s.std * 100, 1)}${tr(' %', '%')}` : '–');
const signed = (v) => `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), 2)}`;

/**
 * Expected per-class scores of three label-free strategies on the test distribution:
 * guessing uniformly, guessing with the class frequencies, always answering the
 * majority class. For a random guesser the expected PPV of class k is its prevalence.
 */
function chanceBaselines(classes, support) {
  const n = classes.reduce((a, c) => a + support[c], 0);
  const p = Object.fromEntries(classes.map((c) => [c, support[c] / n]));
  const k = classes.length;
  const major = classes.reduce((a, c) => (support[c] > support[a] ? c : a), classes[0]);
  const build = (fn) => Object.fromEntries(classes.map((c) => [c, fn(c)]));
  const uniform = build((c) => ({ sensitivity: 1 / k, ppv: p[c], f1: f1Of(1 / k, p[c]) }));
  const prior = build((c) => ({ sensitivity: p[c], ppv: p[c], f1: p[c] }));
  const majority = build((c) => (c === major ? { sensitivity: 1, ppv: p[c], f1: f1Of(1, p[c]) } : { sensitivity: 0, ppv: 0, f1: 0 }));
  const summary = (per, accuracy) => ({ per_class: per, accuracy, macro_f1: mean(classes.map((c) => per[c].f1)) });
  return {
    uniform: summary(uniform, 1 / k),
    prior: summary(prior, classes.reduce((a, c) => a + p[c] ** 2, 0)),
    majority: { ...summary(majority, p[major]), major },
    n, p,
  };
}

/** Horizontal bars 0..1 with a direct value label per row. */
function barRows(rows) {
  return `<div class="grid grid-cols-[minmax(7.5rem,11rem)_minmax(0,1fr)_3.75rem] items-center gap-x-3 gap-y-2">
    ${rows.map((r) => `
      <span class="min-w-0 text-[15px] leading-tight ${r.strong ? 'font-semibold text-fg' : 'text-muted'}">${esc(r.label)}${r.sub ? `<span class="block text-[11.5px] font-normal text-muted">${esc(r.sub)}</span>` : ''}</span>
      <span class="relative h-3.5 rounded-[4px] bg-surface-2" title="${esc(r.label)}: ${fmt(r.value, 3)}">
        <span class="absolute inset-y-0 left-0" style="width:${Math.max(0, Math.min(1, r.value)) * 100}%;background:${r.color};border-radius:0 4px 4px 0;${r.dim ? 'opacity:.55' : ''}"></span>
      </span>
      <span class="num text-right text-[15px] ${r.strong ? 'font-semibold text-fg' : 'text-muted'}">${fmt(r.value, 3)}</span>`).join('')}
  </div>`;
}

function legend(items) {
  return `<div class="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-muted">${items.map(([label, color, dim]) => `
    <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-4 rounded-[3px]" style="background:${color};${dim ? 'opacity:.55' : ''}"></span>${esc(label)}</span>`).join('')}</div>`;
}

function statTile(label, value, hint) {
  return `<div class="card flex min-w-0 flex-col gap-1 p-4 sm:p-5">
    <p class="eyebrow leading-snug">${esc(label)}</p>
    <p class="num mt-1 text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">${value}</p>
    <p class="text-[13px] leading-snug text-muted">${hint}</p>
  </div>`;
}

function sectionHead(eyebrow, title, text) {
  return `<div>
    <p class="eyebrow">${esc(eyebrow)}</p>
    <h2 class="mt-1 text-2xl font-semibold tracking-tight">${esc(title)}</h2>
    ${text ? `<p class="mt-2 max-w-3xl text-sm leading-relaxed text-muted">${text}</p>` : ''}
  </div>`;
}

function classBadge(c) {
  return `<span class="grid size-7 flex-none place-items-center rounded-lg font-mono text-[15px] font-semibold" style="color:var(--c-cls-${c});background:color-mix(in srgb,var(--c-cls-${c}) 12%,transparent);border:1px solid color-mix(in srgb,var(--c-cls-${c}) 30%,transparent)">${esc(c)}</span>`;
}

/** Per-class table with one Sens./PPV/F1 column group per entry of `groups` ({ label, val(cls, metric) }). */
function classTable(classes, groups, caption) {
  return `<div class="overflow-x-auto">
    <table class="w-full ${groups.length > 1 ? 'min-w-[40rem]' : 'min-w-[26rem]'} border-collapse text-[15px]">
      <caption class="sr-only">${esc(caption)}</caption>
      <thead>
        <tr class="text-left text-[11.5px] uppercase tracking-wide text-muted">
          <th scope="col" class="px-3 py-2">${tr('Klasse', 'Class')}</th>
          ${groups.map((g) => `<th scope="colgroup" colspan="3" class="border-l border-line px-3 py-2 text-center">${esc(g.label)}</th>`).join('')}
        </tr>
        <tr class="text-right text-[11.5px] text-muted">
          <th></th>${groups.map(() => '<th class="border-l border-line px-3 py-1.5" title="TP / (TP + FN)">Sens.</th><th class="px-3 py-1.5" title="TP / (TP + FP)">PPV</th><th class="px-3 py-1.5">F1</th>').join('')}
        </tr>
      </thead>
      <tbody>${classes.map((c) => `<tr class="border-t border-line">
        <th scope="row" class="px-3 py-2 text-left"><span class="inline-flex items-center gap-2">${classBadge(c)}<span class="font-medium">${esc(pick(CLASS_NAMES, c))}</span></span></th>
        ${groups.map((g) => `<td class="num border-l border-line px-3 py-2 text-right">${g.val(c, 'sensitivity')}</td><td class="num px-3 py-2 text-right">${g.val(c, 'ppv')}</td><td class="num px-3 py-2 text-right font-semibold">${g.val(c, 'f1')}</td>`).join('')}
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

/** Formatter for classTable from a summary's per_class block. */
const summaryVal = (perClass) => (c, m) => (m === 'f1' ? fmt(perClass?.[c]?.[m], 3) : pct(perClass?.[c]?.[m], 1));

/** Optional: CNN on the beats found by Pan-Tompkins (metrics.detected_peaks). */
function endToEndSection(metrics) {
  const dp = metrics.detected_peaks;
  const e2e = dp?.cnn?.summary;
  if (!e2e) return '';
  const ref = metrics.cnn.summary;
  const det = dp.detector || {};
  const tol = fmt(det.tol_ms ?? 150);
  return `<section class="space-y-5" aria-labelledby="m-e2e">
    ${sectionHead(tr('Ende-zu-Ende', 'End to end'), tr('Ende-zu-Ende mit Pan-Tompkins', 'End to end with Pan-Tompkins'), tr(
      `Oben werden die Schläge an den R-Zacken der Experten ausgeschnitten. Hier findet der Pan-Tompkins-Detektor die Schläge selbst – so, wie es ohne Annotation im Einsatz wäre. Jede Detektion erhält die Klasse der nächsten Experten-Annotation innerhalb von ±${tol} ms; Fehldetektionen und verpasste Schläge zeigen die Detektor-Werte.`,
      `Above, beats are cut out at the experts' R peaks. Here the Pan-Tompkins detector finds the beats itself – as it would in use without annotations. Each detection gets the class of the nearest expert annotation within ±${tol} ms; false and missed detections show up in the detector values.`))}
    <h2 id="m-e2e" class="sr-only">${tr('Ende-zu-Ende mit Pan-Tompkins', 'End to end with Pan-Tompkins')}</h2>
    <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      ${det.sensitivity != null ? statTile(tr('R-Zacken-Sensitivität', 'R-peak sensitivity'), pct(det.sensitivity, 2), tr(`${fmt(det.records)} DS2-Records · ${fmt(det.fn)} verpasst`, `${fmt(det.records)} DS2 records · ${fmt(det.fn)} missed`)) : ''}
      ${det.ppv != null ? statTile(tr('R-Zacken-PPV', 'R-peak PPV'), pct(det.ppv, 2), tr(`${fmt(det.fp)} Fehldetektionen`, `${fmt(det.fp)} false detections`)) : ''}
      ${statTile(tr('Macro-F1 · Ende-zu-Ende', 'Macro F1 · end to end'), fmt(e2e.macro_f1, 3), tr(`mit Experten-R-Zacken: ${fmt(ref.macro_f1, 3)}`, `with expert R peaks: ${fmt(ref.macro_f1, 3)}`))}
      ${statTile(tr('Ohne Q-Klasse', 'Without class Q'), fmt(e2e.macro_f1_nsvf, 3), tr(`mit Experten-R-Zacken: ${fmt(ref.macro_f1_nsvf, 3)} · ${fmt(dp.beats)} Schläge`, `with expert R peaks: ${fmt(ref.macro_f1_nsvf, 3)} · ${fmt(dp.beats)} beats`))}
    </div>
    <div class="card overflow-hidden p-2 sm:p-4">${classTable(ref.class_names, [
      { label: tr('Experten-R-Zacken', 'Expert R peaks'), val: summaryVal(ref.per_class) },
      { label: 'Pan-Tompkins', val: summaryVal(e2e.per_class) },
    ], tr('CNN je Klasse mit Experten- und mit Pan-Tompkins-R-Zacken', 'CNN per class with expert and with Pan-Tompkins R peaks'))}</div>
  </section>`;
}

/** Optional: the unchanged model on another database (metrics.external). */
function externalSection(ext) {
  const s = ext?.cnn?.summary;
  if (!s) return '';
  const beats = ext.beats && typeof ext.beats === 'object' ? Object.values(ext.beats).reduce((a, b) => a + (Number(b) || 0), 0) : s.n;
  const lead = String(ext.lead ?? '');
  // "ECG1 (Ableitung … nicht angegeben)": the chip shows the channel name, the notice explains the rest.
  const leadUnknown = lead.endsWith(LEAD_UNKNOWN);
  const leadText = leadUnknown ? lead.slice(0, -LEAD_UNKNOWN.length) : lead;
  const resampled = ext.fs_original && ext.resampled_to && ext.fs_original !== ext.resampled_to;
  const note = tr(ext.note, EXTERNAL_NOTE_EN[ext.note]);
  return `<section class="space-y-5" aria-labelledby="m-ext">
    ${sectionHead(tr('Externer Test', 'External test'), tr('Externer Test (ohne Nachtraining)', 'External test (no retraining)'), tr(
      'Das fertige Modell wird unverändert auf eine andere Datenbank angewendet – fremde Patienten, die weder im Training noch in der Auswahl der Einstellungen vorkamen.',
      'The finished model is applied unchanged to a different database – unseen patients that played no part in training or in choosing the settings.'))}
    <h2 id="m-ext" class="sr-only">${tr('Externer Test', 'External test')}</h2>
    <p class="flex flex-wrap gap-2">
      <span class="chip">${icon('database', 'size-3')}${esc(ext.database ?? '–')}</span>
      <span class="chip">${fmt(ext.records)} Records</span>
      <span class="chip">${fmt(beats)} ${tr('Herzschläge', 'heartbeats')}</span>
      ${ext.fs_original ? `<span class="chip">${fmt(ext.fs_original)} Hz${resampled ? ` → ${fmt(ext.resampled_to)} Hz` : ''}</span>` : ''}
      ${lead ? `<span class="chip">${tr('Ableitung', 'Lead')} ${esc(leadText)}</span>` : ''}
    </p>
    <div class="notice" role="note">
      <span class="notice-icon">${icon('alert', 'size-5')}</span>
      <p class="min-w-0 text-[15px] leading-relaxed text-muted">${tr(
        `Einschränkung: andere Patienten und eine andere Klassenverteilung${resampled ? `, andere Abtastrate (${fmt(ext.fs_original)} Hz, für das Modell auf ${fmt(ext.resampled_to)} Hz umgerechnet)` : ''}${leadUnknown ? ', und welche Ableitung aufgezeichnet wurde, ist nicht dokumentiert' : ''}. Die Zahlen zeigen, wie gut sich das Modell überträgt – sie sind nicht direkt mit DS2 vergleichbar.`,
        `Limitation: different patients and a different class distribution${resampled ? `, a different sampling rate (${fmt(ext.fs_original)} Hz, resampled to ${fmt(ext.resampled_to)} Hz for the model)` : ''}${leadUnknown ? ', and the recorded lead is not documented' : ''}. The numbers show how well the model transfers – they are not directly comparable with DS2.`)}${note ? ` ${esc(note)}` : ''}</p>
    </div>
    <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      ${statTile(tr('Ohne Q-Klasse', 'Without class Q'), fmt(s.macro_f1_nsvf, 3), tr('Macro-F1 des CNN über N, S, V, F', 'CNN macro F1 over N, S, V, F'))}
      ${statTile(tr('Macro-F1 · alle Klassen', 'Macro F1 · all classes'), fmt(s.macro_f1, 3), tr(`Accuracy ${pct(s.accuracy, 1)}`, `accuracy ${pct(s.accuracy, 1)}`))}
      ${statTile(tr('Sensitivität S', 'Sensitivity S'), pct(s.per_class?.S?.sensitivity, 1), `PPV ${pct(s.per_class?.S?.ppv, 1)}`)}
      ${statTile(tr('Sensitivität V', 'Sensitivity V'), pct(s.per_class?.V?.sensitivity, 1), `PPV ${pct(s.per_class?.V?.ppv, 1)}`)}
    </div>
    <div class="card overflow-hidden p-2 sm:p-4">${classTable(s.class_names, [{ label: tr('1D-CNN, extern', '1D CNN, external'), val: summaryVal(s.per_class) }],
      tr('CNN je Klasse auf der externen Datenbank', 'CNN per class on the external database'))}</div>
  </section>`;
}

/** Optional: cross-validation inside DS1 that chose the configuration (metrics.cv). */
function cvSection(cv) {
  if (cv?.macro_f1_nsvf?.mean == null) return '';
  const classes = Object.keys(cv.per_class || {});
  const nSeeds = Array.isArray(cv.seeds) ? cv.seeds.length : null;
  return `<section class="space-y-5" aria-labelledby="m-cv">
    ${sectionHead(tr('Modellauswahl', 'Model selection'), tr('Modellauswahl nur auf DS1 (Kreuzvalidierung)', 'Model selection on DS1 only (cross-validation)'), tr(
      `Die finale Konfiguration wurde auf einer ${numWord(cv.k)}-fachen, nach Records gruppierten Kreuzvalidierung innerhalb von DS1 ausgewählt; DS2 war an der Auswahl nicht beteiligt. Angegeben ist Mittelwert ± Standardabweichung über ${nSeeds ? `${numWord(nSeeds)} Seeds` : 'die Seeds'}, jeweils über alle Folds zusammengefasst.`,
      `The final configuration was chosen with a ${numWord(cv.k)}-fold, record-grouped cross-validation inside DS1; DS2 played no part in the choice. Shown is mean ± standard deviation over ${nSeeds ? `${numWord(nSeeds)} seeds` : 'the seeds'}, each pooled over all folds.`))}
    <h2 id="m-cv" class="sr-only">${tr('Kreuzvalidierung auf DS1', 'Cross-validation on DS1')}</h2>
    <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      ${statTile(tr('Ohne Q-Klasse · CV', 'Without class Q · CV'), fmt(cv.macro_f1_nsvf.mean, 3), tr(`± ${fmt(cv.macro_f1_nsvf.std, 3)} · Macro-F1 über N, S, V, F`, `± ${fmt(cv.macro_f1_nsvf.std, 3)} · macro F1 over N, S, V, F`))}
      ${cv.macro_f1?.mean != null ? statTile(tr('Macro-F1 · CV', 'Macro F1 · CV'), fmt(cv.macro_f1.mean, 3), tr(`± ${fmt(cv.macro_f1.std, 3)} · alle fünf Klassen`, `± ${fmt(cv.macro_f1.std, 3)} · all five classes`)) : ''}
      ${cv.ensemble?.macro_f1_nsvf != null ? statTile(tr('Ensemble · CV', 'Ensemble · CV'), fmt(cv.ensemble.macro_f1_nsvf, 3), tr('Macro-F1 ohne Q, Wahrscheinlichkeiten der Seeds gemittelt', 'macro F1 without Q, seed probabilities averaged')) : ''}
      ${cv.ensemble_offsets_nested?.macro_f1_nsvf != null ? statTile(tr('Ensemble + Offsets · CV', 'Ensemble + offsets · CV'), fmt(cv.ensemble_offsets_nested.macro_f1_nsvf, 3), tr('Offsets je Fold nur aus den übrigen Folds bestimmt', 'offsets per fold fitted on the other folds only')) : ''}
    </div>
    ${classes.length ? `<div class="card overflow-hidden p-2 sm:p-4">${classTable(classes, [{ label: tr('1D-CNN, Kreuzvalidierung', '1D CNN, cross-validation'), val: (c, m) => (m === 'f1' ? pm(cv.per_class[c]?.[m]) : pctPm(cv.per_class[c]?.[m])) }],
      tr('CNN je Klasse in der Kreuzvalidierung auf DS1, Mittelwert ± Standardabweichung', 'CNN per class in the cross-validation on DS1, mean ± standard deviation'))}</div>` : ''}
    ${cv.source ? `<p class="text-[12.5px] text-muted"><span class="chip chip-mono">${icon('file', 'size-3')}${esc(cv.source)}</span></p>` : ''}
  </section>`;
}

function content(metrics, arch) {
  const cnn = metrics.cnn.summary;
  const tree = metrics.tree.summary;
  const classes = cnn.class_names;
  const support = Object.fromEntries(classes.map((c) => [c, cnn.per_class[c].support]));
  const chance = chanceBaselines(classes, support);
  const best = Math.max(chance.uniform.macro_f1, chance.prior.macro_f1, chance.majority.macro_f1);
  const cfg = metrics.config || {};
  const cm = cnn.confusion;
  const iN = classes.indexOf('N'), iS = classes.indexOf('S'), iF = classes.indexOf('F'), iQ = classes.indexOf('Q');
  const CNN = tr('1D-CNN', '1D CNN');
  const TREE = tr('Entscheidungsbaum', 'Decision tree');
  const UNIFORM = tr('Zufall gleichverteilt', 'Random (uniform)');

  // CNN profile: everything from metrics.json / architecture.json, the old fixed texts only as fallback.
  const ens = metrics.cnn.ensemble;
  const psa = metrics.cnn.per_seed_aggregate;
  const fromArch = (arch?.layers || []).filter((l) => l.type === 'Conv1d').map((l) => l.output_shape?.[1]).filter(Number.isFinite);
  const convs = fromArch.length ? fromArch : [16, 32, 64];
  const twoLeads = cfg.leads === 2;
  const rrInputs = RR_INPUTS[cfg.features] || RR_INPUTS.base;
  const lead2 = [...new Set(Object.values(cfg.lead2_names || {}))].sort();
  const offsets = Object.entries(ens?.offsets || cfg.offsets || {}).filter(([, v]) => Number(v) !== 0);
  const wp = cfg.weight_power ?? 1;
  const stopText = !('patience' in cfg) ? ''
    : cfg.patience == null ? tr(' (ohne Early Stopping)', ' (no early stopping)')
      : tr(` (Early Stopping, Geduld ${fmt(cfg.patience)})`, ` (early stopping, patience ${fmt(cfg.patience)})`);
  const cnnFacts = [
    [tr('Parameter', 'Parameters'), fmt(metrics.cnn.params)],
    ...(ens ? [[tr('Ensemble', 'Ensemble'), tr(`${fmt(ens.seeds.length)} Seeds (${esc(ens.seeds.join(', '))}), Wahrscheinlichkeiten gemittelt`, `${fmt(ens.seeds.length)} seeds (${esc(ens.seeds.join(', '))}), probabilities averaged`)]] : []),
    ...(psa?.macro_f1_nsvf ? [[tr('Einzelmodelle', 'Single models'), tr(`Macro-F1 ohne Q ${pm(psa.macro_f1_nsvf)}`, `macro F1 without Q ${pm(psa.macro_f1_nsvf)}`)]] : []),
    [ens ? tr('Epochen je Seed', 'Epochs per seed') : tr('Epochen', 'Epochs'), tr(`${ens ? ens.epochs_run.map((e) => fmt(e)).join(' / ') : fmt(metrics.cnn.epochs_run)} von max. ${fmt(cfg.epochs)}`, `${ens ? ens.epochs_run.map((e) => fmt(e)).join(' / ') : fmt(metrics.cnn.epochs_run)} of max. ${fmt(cfg.epochs)}`)],
    [ens ? tr('Beste Epoche je Seed', 'Best epoch per seed') : tr('Beste Epoche', 'Best epoch'), `${ens ? ens.best_epochs.map((e) => fmt(e)).join(' / ') : fmt(metrics.cnn.best_epoch)}${stopText}`],
    [tr('Optimierer', 'Optimizer'), tr(`Adam, Lernrate ${sig(cfg.lr)}`, `Adam, learning rate ${sig(cfg.lr)}`)],
    ['Batch', tr(`${fmt(cfg.batch_size)} Schläge`, `${fmt(cfg.batch_size)} beats`)],
    [tr('Ableitungen', 'Leads'), twoLeads ? `MLII + ${esc(lead2.join(' / ') || tr('zweite Ableitung', 'second lead'))}` : 'MLII'],
    [tr('Trainingsdaten', 'Training data'), ens
      ? tr('DS1 ohne die Validierungs-Records des jeweiligen Seeds', 'DS1 minus the validation records of each seed')
      : tr(`${fmt(metrics.beats?.train)} Schläge, ${fmt(metrics.records?.train?.length)} Records`, `${fmt(metrics.beats?.train)} beats, ${fmt(metrics.records?.train?.length)} records`)],
    [tr('Validierung', 'Validation'), ens?.val_records
      ? Object.entries(ens.val_records).map(([s_, r]) => `Seed ${esc(s_)}: ${esc(r.join(', '))}`).join(' · ')
      : tr(`${fmt(metrics.beats?.val)} Schläge, Records ${esc((metrics.records?.val || []).join(', '))}`, `${fmt(metrics.beats?.val)} beats, records ${esc((metrics.records?.val || []).join(', '))}`)],
    [tr('Ungleichgewicht', 'Class imbalance'), wp === 1
      ? tr('gewichtete Kreuzentropie (seltene Klassen zählen mehr)', 'weighted cross-entropy (rare classes count more)')
      : tr(`gewichtete Kreuzentropie, Gewicht ∝ Häufigkeit^−${fmt(wp, 2)}`, `weighted cross-entropy, weight ∝ frequency^−${fmt(wp, 2)}`)],
    ...(cfg.augment != null ? [[tr('Augmentierung', 'Augmentation'), cfg.augment ? tr('Amplitude, Rauschen, kleine Zeitverschiebung', 'amplitude, noise, small time shift') : tr('keine', 'none')]] : []),
    ...(offsets.length ? [[tr('Klassen-Offsets', 'Class offsets'), `${offsets.map(([c, v]) => `${esc(c)} ${signed(Number(v))}`).join(' · ')} ${tr('(aus DS1, Out-of-fold)', '(from DS1, out-of-fold)')}`]] : []),
  ];
  const nVal = metrics.records?.val?.length;

  const models = [
    { key: 'cnn', label: tr('1D-CNN + RR-Fusion', '1D CNN + RR fusion'), sub: tr('Hauptmodell', 'main model'), s: cnn, color: COLOR.cnn, strong: true },
    { key: 'tree', label: TREE, sub: tr('Tiefe ', 'depth ') + fmt(metrics.tree.depth ?? cfg.max_depth), s: tree, color: COLOR.tree, strong: true },
    { key: 'prior', label: tr('Zufall nach Häufigkeit', 'Random (by frequency)'), sub: tr('rät im Verhältnis der Klassen', 'guesses in proportion to class frequencies'), s: chance.prior, color: COLOR.chance, dim: true },
    { key: 'uniform', label: UNIFORM, sub: tr('jede Klasse 1 : ', 'each class 1 : ') + classes.length, s: chance.uniform, color: COLOR.chance, dim: true },
    { key: 'majority', label: tr(`Immer „${chance.majority.major}“`, `Always “${chance.majority.major}”`), sub: tr('häufigste Klasse', 'most frequent class'), s: chance.majority, color: COLOR.chance, dim: true },
  ];

  const perClassRows = classes.map((c) => `
    <div class="grid gap-2 border-t border-line py-4 first:border-t-0 first:pt-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-5">
      <div class="flex items-start gap-2.5">
        ${classBadge(c)}
        <div class="min-w-0">
          <p class="text-sm font-semibold">${esc(pick(CLASS_NAMES, c))}</p>
          <p class="text-[13px] text-muted">${fmt(support[c])} ${tr('Test-Schläge', 'test beats')} · ${pct(chance.p[c], support[c] / chance.n < 0.01 ? 2 : 1)}</p>
        </div>
      </div>
      ${barRows([
        { label: CNN, value: cnn.per_class[c].f1, color: COLOR.cnn, strong: true },
        { label: TREE, value: tree.per_class[c].f1, color: COLOR.tree },
        { label: UNIFORM, value: chance.uniform.per_class[c].f1, color: COLOR.chance, dim: true },
      ])}
    </div>`).join('');

  const cell = (v) => `<td class="num px-3 py-2 text-right">${pct(v, 1)}</td>`;
  const detailTable = `<div class="overflow-x-auto">
    <table class="w-full min-w-[46rem] border-collapse text-[15px]">
      <caption class="sr-only">${tr('Sensitivität, PPV und F1 je Klasse für beide Modelle und den gleichverteilten Zufall', 'Sensitivity, PPV and F1 per class for both models and uniform random guessing')}</caption>
      <thead>
        <tr class="text-left text-[11.5px] uppercase tracking-wide text-muted">
          <th scope="col" class="px-3 py-2">${tr('Klasse', 'Class')}</th>
          ${[CNN, tr('Baum', 'Tree'), tr('Zufall', 'Chance')].map((m) => `<th scope="colgroup" colspan="3" class="border-l border-line px-3 py-2 text-center">${m}</th>`).join('')}
        </tr>
        <tr class="text-right text-[11.5px] text-muted">
          <th></th>${'<th class="border-l border-line px-3 py-1.5" title="TP / (TP + FN)">Sens.</th><th class="px-3 py-1.5" title="TP / (TP + FP)">PPV</th><th class="px-3 py-1.5">F1</th>'.repeat(3)}
        </tr>
      </thead>
      <tbody>${classes.map((c) => `<tr class="border-t border-line">
        <th scope="row" class="px-3 py-2 text-left"><span class="inline-flex items-center gap-2">${classBadge(c)}<span class="font-medium">${esc(pick(CLASS_NAMES, c))}</span></span></th>
        ${[cnn.per_class[c], tree.per_class[c], chance.uniform.per_class[c]].map((m) => `${cell(m.sensitivity).replace('class="', 'class="border-l border-line ')}${cell(m.ppv)}<td class="num px-3 py-2 text-right font-semibold">${fmt(m.f1, 3)}</td>`).join('')}
      </tr>`).join('')}</tbody>
    </table>
  </div>`;

  const nAsS = cm[iN][iS], nAsF = cm[iN][iF];
  const S = cnn.per_class.S, F = cnn.per_class.F;
  // Judgements only where the numbers support them, so the texts stay true after retraining.
  const weaknesses = [
    [tr('S: Treffer und Fehlalarme', 'S: hits and false alarms'), tr(
      `Das CNN findet ${pct(S.sensitivity, 0)} der S-Schläge; ${pct(S.ppv, 0)} seiner S-Alarme stimmen, ${fmt(nAsS)} normale Schläge werden als S markiert.${S.ppv < 0.5 ? ` Bei ${fmt(support.N)} N-Schlägen reicht schon ein kleiner Fehleranteil, um die wenigen echten S-Schläge zu überdecken.` : ''}`,
      `The CNN finds ${pct(S.sensitivity, 0)} of S beats; ${pct(S.ppv, 0)} of its S alarms are correct, ${fmt(nAsS)} normal beats are flagged as S.${S.ppv < 0.5 ? ` With ${fmt(support.N)} N beats, even a small error rate is enough to swamp the few true S beats.` : ''}`)],
    [tr('F: Fusionsschläge', 'F: fusion beats'), tr(
      `${fmt(F.tp)} von ${fmt(support.F)} F-Schlägen werden erkannt, ${fmt(nAsF)} N-Schläge fälschlich als F. Fast alle F-Schläge in DS1 stammen von einem einzigen Patienten (Record 208)${F.sensitivity < 0.5 ? ' – das Muster überträgt sich kaum auf andere Menschen' : ''}.`,
      `${fmt(F.tp)} of ${fmt(support.F)} F beats are detected, ${fmt(nAsF)} N beats are wrongly predicted as F. Almost all F beats in DS1 come from a single patient (record 208)${F.sensitivity < 0.5 ? ' – the pattern hardly transfers to other people' : ''}.`)],
    [tr('Q: zu wenige Beispiele', 'Q: too few examples'), tr(
      `Im Testset gibt es nur ${fmt(support.Q)} Q-Schläge (im Training ${fmt(metrics.per_split?.DS1?.Q ?? 0)}). Daraus lässt sich nichts lernen; deshalb wird zusätzlich Macro-F1 ohne Q berichtet (CNN: ${fmt(cnn.macro_f1_nsvf, 3)}).`,
      `The test set contains only ${fmt(support.Q)} Q beats (${fmt(metrics.per_split?.DS1?.Q ?? 0)} in training). Nothing can be learned from that, so macro F1 without Q is reported as well (CNN: ${fmt(cnn.macro_f1_nsvf, 3)}).`)],
    [tr('Accuracy täuscht', 'Accuracy is misleading'), tr(
      `„Immer ${chance.majority.major}“ erreicht ${pct(chance.majority.accuracy, 1)} Accuracy (CNN: ${pct(cnn.accuracy, 1)}) – findet aber keinen einzigen auffälligen Schlag. Darum ist Macro-F1 die Hauptkennzahl.`,
      `“Always ${chance.majority.major}” reaches ${pct(chance.majority.accuracy, 1)} accuracy (CNN: ${pct(cnn.accuracy, 1)}) – yet it finds not a single abnormal beat. That is why macro F1 is the headline metric.`)],
  ];

  return `
  <section class="border-b border-line">
    <div class="mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16 lg:px-8">
      <p class="flex flex-wrap items-center gap-2">
        <span class="chip">${icon('activity', 'size-3 text-accent')}${tr('Testset DS2', 'Test set DS2')}</span>
        <span class="chip">${fmt(metrics.records?.test?.length)} ${tr('Patienten-Records', 'patient records')}</span>
        <span class="chip">${fmt(chance.n)} ${tr('Herzschläge', 'heartbeats')}</span>
        <span class="chip chip-mono">${icon('file', 'size-3')}metrics.json</span>
      </p>
      <h1 class="mt-5 max-w-3xl text-[32px] font-semibold leading-[1.1] tracking-tight sm:text-[40px]">${tr('Wie gut erkennen die Modelle Arrhythmien?', 'How well do the models detect arrhythmias?')}</h1>
      <p class="mt-4 max-w-3xl text-base leading-relaxed text-muted">
        ${tr(`Beide Modelle wurden nur auf DS1 trainiert und hier auf ${fmt(metrics.records?.test?.length)} völlig fremden Patienten (DS2) getestet.
        Als Maßstab dient, was man <span class="text-fg">ohne jedes Modell</span> durch Raten erreichen würde – berechnet aus der Klassenverteilung von DS2.`,
        `Both models were trained on DS1 only and tested here on ${fmt(metrics.records?.test?.length)} completely unseen patients (DS2).
        The yardstick is what you would achieve <span class="text-fg">without any model</span> by guessing – computed from the class distribution of DS2.`)}
      </p>
    </div>
  </section>

  <div class="mx-auto max-w-7xl space-y-16 px-4 pt-10 sm:px-6 lg:px-8">
    <section class="space-y-5" aria-labelledby="m-macro">
      <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        ${statTile(tr('Macro-F1 · 1D-CNN', 'Macro F1 · 1D CNN'), fmt(cnn.macro_f1, 3), tr(`Mittel der F1-Werte aller ${classes.length} Klassen`, `Mean of the F1 scores of all ${classes.length} classes`))}
        ${statTile(tr('Gegenüber Raten', 'vs. guessing'), `${fmt(cnn.macro_f1 / best, 1)}×`, tr(`bester Zufalls-Baseline (${fmt(best, 3)}) – das CNN liegt ${fmt(Math.abs(cnn.macro_f1 - best) * 100, 1)} Punkte ${cnn.macro_f1 >= best ? 'höher' : 'niedriger'}`, `of the best chance baseline (${fmt(best, 3)}) – the CNN is ${fmt(Math.abs(cnn.macro_f1 - best) * 100, 1)} points ${cnn.macro_f1 >= best ? 'higher' : 'lower'}`))}
        ${statTile(tr('Macro-F1 · Baum', 'Macro F1 · tree'), fmt(tree.macro_f1, 3), tr(`${fmt(tree.macro_f1 / best, 1)}× bester Zufall · CNN: ${fmt(cnn.macro_f1, 3)}`, `${fmt(tree.macro_f1 / best, 1)}× best chance · CNN: ${fmt(cnn.macro_f1, 3)}`))}
        ${statTile(tr('Ohne Q-Klasse', 'Without class Q'), fmt(cnn.macro_f1_nsvf, 3), tr(`Macro-F1 des CNN über N, S, V, F (Baum: ${fmt(tree.macro_f1_nsvf, 3)})`, `CNN macro F1 over N, S, V, F (tree: ${fmt(tree.macro_f1_nsvf, 3)})`))}
      </div>
      <div class="card overflow-hidden">
        <div class="card-head">
          <div class="min-w-0">
            <p class="eyebrow">${tr('Gesamtvergleich', 'Overall comparison')}</p>
            <h2 id="m-macro" class="mt-0.5 text-sm font-semibold">${tr('Macro-F1: Modelle gegen Raten', 'Macro F1: models vs. guessing')}</h2>
          </div>
          ${legend([[tr('Modelle', 'Models'), COLOR.cnn], [tr('Zufalls-Baselines', 'Chance baselines'), COLOR.chance, true]])}
        </div>
        <div class="space-y-6 p-4 sm:p-6">
          ${barRows(models.map((m) => ({ label: m.label, sub: m.sub, value: m.s.macro_f1, color: m.color, strong: m.strong, dim: m.dim })))}
          <div class="overflow-x-auto">
            <table class="w-full min-w-[30rem] border-collapse text-[15px]">
              <caption class="sr-only">${tr('Accuracy und Macro-F1 der Modelle und Baselines', 'Accuracy and macro F1 of the models and baselines')}</caption>
              <thead><tr class="text-left text-[11.5px] uppercase tracking-wide text-muted">
                <th scope="col" class="px-3 py-2">${tr('Strategie', 'Strategy')}</th><th scope="col" class="px-3 py-2 text-right">Accuracy</th><th scope="col" class="px-3 py-2 text-right">${tr('Macro-F1', 'Macro F1')}</th><th scope="col" class="px-3 py-2 text-right" title="${tr('Macro-F1 geteilt durch die beste Zufalls-Baseline', 'Macro F1 divided by the best chance baseline')} (${fmt(best, 3)})">${tr('vs. bester Zufall', 'vs. best chance')}</th>
              </tr></thead>
              <tbody>${models.map((m) => `<tr class="border-t border-line ${m.strong ? 'text-fg' : 'text-muted'}">
                <th scope="row" class="px-3 py-2 text-left font-medium"><span class="inline-flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-sm" style="background:${m.color};${m.dim ? 'opacity:.55' : ''}"></span>${esc(m.label)}</span></th>
                <td class="num px-3 py-2 text-right">${pct(m.s.accuracy, 1)}</td>
                <td class="num px-3 py-2 text-right font-semibold">${fmt(m.s.macro_f1, 3)}</td>
                <td class="num px-3 py-2 text-right">${fmt(m.s.macro_f1 / best, 1)}×</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
          <p class="text-[12.5px] leading-relaxed text-muted">${icon('info', 'mr-1 inline size-3.5 align-[-2px]')}${tr(
            `Zufallswerte sind Erwartungswerte: Wer zufällig rät, trifft eine Klasse im Mittel so oft, wie sie vorkommt (PPV = Anteil der Klasse). „Gleichverteilt“ wählt jede der ${classes.length} Klassen mit gleicher Wahrscheinlichkeit, „nach Häufigkeit“ im Verhältnis ihres Vorkommens.`,
            `Chance values are expected values: a random guesser hits a class on average as often as it occurs (PPV = share of the class). “Uniform” picks each of the ${classes.length} classes with equal probability, “by frequency” in proportion to how often it occurs.`)}</p>
        </div>
      </div>
    </section>

    <section class="space-y-5" aria-labelledby="m-class">
      ${sectionHead(tr('Je Klasse', 'Per class'), tr('F1 je AAMI-Klasse', 'F1 per AAMI class'), tr(
        'F1 verbindet Sensitivität (wie viele echte Schläge einer Klasse gefunden werden) und PPV (wie viele Alarme stimmen). Gerade bei den seltenen Klassen zeigt sich, wo die Modelle über das Raten hinauskommen – und wo nicht.',
        'F1 combines sensitivity (how many true beats of a class are found) and PPV (how many alarms are correct). The rare classes in particular show where the models get beyond guessing – and where they do not.'))}
      <div class="card overflow-hidden">
        <div class="card-head">
          <h3 id="m-class" class="text-sm font-semibold">${tr('F1-Wert je Klasse', 'F1 score per class')}</h3>
          ${legend([[CNN, COLOR.cnn], [TREE, COLOR.tree], [UNIFORM, COLOR.chance, true]])}
        </div>
        <div class="p-4 sm:p-6">${perClassRows}</div>
      </div>
      <details class="card overflow-hidden">
        <summary class="cursor-pointer px-4 py-3 text-sm font-semibold sm:px-6">${tr('Tabelle: Sensitivität, PPV und F1 im Detail', 'Table: sensitivity, PPV and F1 in detail')}</summary>
        <div class="border-t border-line p-2 sm:p-4">${detailTable}</div>
      </details>
    </section>

    ${endToEndSection(metrics)}
    ${externalSection(metrics.external)}

    <section class="space-y-5" aria-labelledby="m-profiles">
      ${sectionHead(tr('Die Modelle', 'The models'), tr('Was steckt in den beiden Modellen?', 'What is inside the two models?'), '')}
      <h2 id="m-profiles" class="sr-only">${tr('Modell-Steckbriefe', 'Model profiles')}</h2>
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="card p-5 sm:p-6">
          <p class="flex items-center gap-2 text-[15px] font-semibold"><span class="h-2.5 w-2.5 rounded-sm" style="background:${COLOR.cnn}"></span>${tr('1D-CNN mit RR-Fusion', '1D CNN with RR fusion')}</p>
          <p class="mt-2 text-[15px] leading-relaxed text-muted">${tr(
            `Liest die Form jedes Herzschlags (${fmt((cfg.pre_ms ?? 250))} ms vor bis ${fmt(cfg.post_ms ?? 450)} ms nach der R-Zacke${twoLeads ? ', in zwei Ableitungen' : ''}) mit ${numWord(convs.length)} Faltungsblöcken (${convs.join(', ')} Filter) und verbindet das Ergebnis mit ${tr(...rrInputs)}. Erst die Kombination aus Form und Takt macht vorzeitige Schläge erkennbar.`,
            `Reads the shape of each heartbeat (${fmt((cfg.pre_ms ?? 250))} ms before to ${fmt(cfg.post_ms ?? 450)} ms after the R peak${twoLeads ? ', in two leads' : ''}) with ${numWord(convs.length)} convolutional blocks (${convs.join(', ')} filters) and combines the result with ${tr(...rrInputs)}. Only the combination of shape and timing makes premature beats detectable.`)}</p>
          <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
            ${cnnFacts.map(([k, v]) => `<div class="min-w-0"><dt class="text-[11.5px] uppercase tracking-wide text-muted">${k}</dt><dd class="mt-0.5 break-words text-fg">${v}</dd></div>`).join('')}
          </dl>
        </div>
        <div class="card p-5 sm:p-6">
          <p class="flex items-center gap-2 text-[15px] font-semibold"><span class="h-2.5 w-2.5 rounded-sm" style="background:${COLOR.tree}"></span>${TREE}</p>
          <p class="mt-2 text-[15px] leading-relaxed text-muted">${tr(
            `Stellt höchstens ${fmt(metrics.tree.max_depth ?? cfg.max_depth)} Ja/Nein-Fragen zu ${fmt((metrics.tree.features || []).length)} verständlichen Merkmalen. Jede Entscheidung ist nachlesbar – dafür kann er feine Formunterschiede kaum abbilden.`,
            `Asks at most ${fmt(metrics.tree.max_depth ?? cfg.max_depth)} yes/no questions about ${fmt((metrics.tree.features || []).length)} interpretable features. Every decision can be traced – but it can hardly capture subtle differences in beat shape.`)}</p>
          <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
            ${[
              [tr('Tiefe / Blätter', 'Depth / leaves'), `${fmt(metrics.tree.depth)} / ${fmt(metrics.tree.n_leaves)}`],
              [tr('Trainingsdaten', 'Training data'), tr(`${fmt(metrics.tree.trained_on_beats)} Schläge (ganz DS1)`, `${fmt(metrics.tree.trained_on_beats)} beats (all of DS1)`)],
            ].map(([k, v]) => `<div><dt class="text-[11.5px] uppercase tracking-wide text-muted">${k}</dt><dd class="mt-0.5 text-fg">${v}</dd></div>`).join('')}
          </dl>
          <p class="mt-4 text-[11.5px] uppercase tracking-wide text-muted">${tr('Merkmale', 'Features')}</p>
          <p class="mt-1.5 flex flex-wrap gap-1.5">${(metrics.tree.features || []).map((f) => `<span class="chip" title="${esc(f)}">${esc(pick(FEATURE_LABELS, f))}</span>`).join('')}</p>
          <a href="#/process/erklaerbarkeit" class="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">${tr('Baum interaktiv ansehen', 'Explore the tree interactively')} ${icon('arrowRight', 'size-3.5')}</a>
        </div>
      </div>
    </section>

    <section class="space-y-5" aria-labelledby="m-cm">
      ${sectionHead(tr('Fehleranalyse', 'Error analysis'), tr('Was wird womit verwechselt?', 'What gets confused with what?'), tr(
        'Zeilen sind die wahre Klasse (Expertenannotation), Spalten die Vorhersage. Die Diagonale sind Treffer.',
        'Rows are the true class (expert annotation), columns the predicted class. The diagonal holds the correct predictions.'))}
      <h2 id="m-cm" class="sr-only">${tr('Konfusionsmatrizen', 'Confusion matrices')}</h2>
      <div class="grid gap-4 xl:grid-cols-2">
        <div class="card overflow-hidden"><div class="card-head"><p class="text-sm font-semibold">${CNN}</p></div><div class="p-3 sm:p-4" data-cm="cnn">${skeleton('18rem')}</div></div>
        <div class="card overflow-hidden"><div class="card-head"><p class="text-sm font-semibold">${TREE}</p></div><div class="p-3 sm:p-4" data-cm="tree">${skeleton('18rem')}</div></div>
      </div>
    </section>

    <section class="space-y-5" aria-labelledby="m-train">
      ${sectionHead('Training', tr('Wie das CNN gelernt hat', 'How the CNN learned'), tr(
        `Loss auf Training und Validierung sowie Macro-F1 auf den ${nVal ? `${numWord(nVal)} ` : ''}zurückgehaltenen DS1-Records je Epoche${ens ? ` – gezeigt für Seed ${esc(ens.seeds[0])}; jedes Ensemble-Mitglied hat eigene Validierungs-Records` : ''}. Gespeichert wird die Epoche mit dem besten Validierungs-Macro-F1${cfg.patience != null ? `; nach ${numWord(cfg.patience)} Epochen ohne Verbesserung endet das Training` : ''}.`,
        `Training and validation loss plus macro F1 on the ${nVal ? `${numWord(nVal)} ` : ''}held-out DS1 records per epoch${ens ? ` – shown for seed ${esc(ens.seeds[0])}; every ensemble member has its own validation records` : ''}. The epoch with the best validation macro F1 is kept${cfg.patience != null ? `; training ends after ${numWord(cfg.patience)} epochs without improvement` : ''}.`))}
      <h2 id="m-train" class="sr-only">${tr('Trainingsverlauf', 'Training history')}</h2>
      <div class="card overflow-hidden p-3 sm:p-4" data-train>${skeleton('16rem')}</div>
    </section>

    ${cvSection(metrics.cv)}

    <section class="space-y-5" aria-labelledby="m-weak">
      ${sectionHead(tr('Ehrlich bleiben', 'Staying honest'), tr('Wo die Modelle an Grenzen stoßen', 'Where the models hit their limits'), '')}
      <h2 id="m-weak" class="sr-only">${tr('Schwächen', 'Weaknesses')}</h2>
      <div class="grid gap-3 md:grid-cols-2">
        ${weaknesses.map(([t, d]) => `<div class="card p-5">
          <p class="flex items-center gap-2 text-[15px] font-semibold">${icon('alert', 'size-4 text-muted')}${esc(t)}</p>
          <p class="mt-1.5 text-[15px] leading-relaxed text-muted">${esc(d)}</p>
        </div>`).join('')}
      </div>
    </section>
  </div>`;
}

export async function render(root) {
  root.innerHTML = `<div class="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">${skeleton('24rem')}</div>`;
  const [metrics, arch] = await Promise.all([loadJSON('metrics.json'), loadJSON('architecture.json')]);
  if (!metrics || metrics.status !== 'complete' || !metrics.cnn?.summary || !metrics.tree?.summary) {
    root.innerHTML = `<div class="mx-auto max-w-3xl px-4 py-24">${emptyState(tr('Noch keine Modell-Ergebnisse', 'No model results yet'), tr('Diese Seite zeigt die Ergebnisse des Volltrainings (metrics.json mit status „complete“). Sie erscheinen nach make train.', 'This page shows the results of the full training (metrics.json with status “complete”). They appear after make train.'), 'activity')}</div>`;
    return {};
  }
  root.innerHTML = content(metrics, arch);

  const handles = [];
  let alive = true;
  try {
    const { renderConfusionMatrix, renderTrainingCurve } = await import('../components/index.js');
    if (alive) {
      handles.push(renderConfusionMatrix(root.querySelector('[data-cm="cnn"]'), metrics.cnn, { raw: metrics }));
      handles.push(renderConfusionMatrix(root.querySelector('[data-cm="tree"]'), metrics.tree, { raw: metrics }));
      handles.push(renderTrainingCurve(root.querySelector('[data-train]'), metrics.cnn));
    }
  } catch (err) {
    console.error('[models] charts failed', err);
    root.querySelectorAll('[data-cm], [data-train]').forEach((n) => { n.innerHTML = errorState(tr('Diagramm konnte nicht geladen werden', 'Chart could not be loaded'), err); });
  }

  return {
    destroy() {
      alive = false;
      handles.forEach((h) => h?.destroy?.());
    },
  };
}
