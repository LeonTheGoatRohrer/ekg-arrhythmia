// Models ("Modelle"): how well the 1D-CNN and the decision tree classify DS2 beats,
// compared with chance baselines computed from the DS2 class distribution, plus model
// profiles, confusion matrices, training curve and known weaknesses. Everything comes
// from metrics.json; nothing is shown before the full training has completed.

import { loadJSON } from '../lib/data.js';
import { esc, fmt, pct, icon } from '../lib/dom.js';
import { emptyState, errorState, skeleton } from '../lib/ui.js';
import { tr } from '../lib/i18n.js';

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

const f1Of = (s, p) => (s + p > 0 ? (2 * s * p) / (s + p) : 0);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

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

function content(metrics) {
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
  const weaknesses = [
    [tr('S: viele Fehlalarme', 'S: many false alarms'), tr(
      `Das CNN findet ${pct(cnn.per_class.S.sensitivity, 0)} der S-Schläge, aber nur ${pct(cnn.per_class.S.ppv, 0)} seiner S-Alarme stimmen: ${fmt(nAsS)} normale Schläge werden als S markiert. Bei ${fmt(support.N)} N-Schlägen reicht schon ein kleiner Fehleranteil, um die wenigen echten S-Schläge zu überdecken.`,
      `The CNN finds ${pct(cnn.per_class.S.sensitivity, 0)} of S beats, but only ${pct(cnn.per_class.S.ppv, 0)} of its S alarms are correct: ${fmt(nAsS)} normal beats are flagged as S. With ${fmt(support.N)} N beats, even a small error rate is enough to swamp the few true S beats.`)],
    [tr('F: praktisch nicht gelernt', 'F: practically not learned'), tr(
      `Nur ${fmt(cnn.per_class.F.tp)} von ${fmt(support.F)} F-Schlägen werden erkannt, dafür ${fmt(nAsF)} N-Schläge fälschlich als F. Fast alle F-Trainingsschläge in DS1 stammen von einem einzigen Patienten (Record 208) – das Muster überträgt sich nicht auf andere Menschen.`,
      `Only ${fmt(cnn.per_class.F.tp)} of ${fmt(support.F)} F beats are detected, while ${fmt(nAsF)} N beats are wrongly predicted as F. Almost all F training beats in DS1 come from a single patient (record 208) – the pattern does not transfer to other people.`)],
    [tr('Q: zu wenige Beispiele', 'Q: too few examples'), tr(
      `Im Testset gibt es nur ${fmt(support.Q)} Q-Schläge (im Training ${fmt(metrics.per_split?.DS1?.Q ?? 0)}). Daraus lässt sich nichts lernen; deshalb wird zusätzlich Macro-F1 ohne Q berichtet (CNN: ${fmt(cnn.macro_f1_nsvf, 3)}).`,
      `The test set contains only ${fmt(support.Q)} Q beats (${fmt(metrics.per_split?.DS1?.Q ?? 0)} in training). Nothing can be learned from that, so macro F1 without Q is reported as well (CNN: ${fmt(cnn.macro_f1_nsvf, 3)}).`)],
    [tr('Accuracy täuscht', 'Accuracy is misleading'), tr(
      `„Immer ${chance.majority.major}“ erreicht ${pct(chance.majority.accuracy, 1)} Accuracy, fast so viel wie das CNN (${pct(cnn.accuracy, 1)}) – findet aber keinen einzigen auffälligen Schlag. Darum ist Macro-F1 die Hauptkennzahl.`,
      `“Always ${chance.majority.major}” reaches ${pct(chance.majority.accuracy, 1)} accuracy, almost as much as the CNN (${pct(cnn.accuracy, 1)}) – yet it finds not a single abnormal beat. That is why macro F1 is the headline metric.`)],
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
        ${statTile(tr('Gegenüber Raten', 'vs. guessing'), `${fmt(cnn.macro_f1 / best, 1)}×`, tr(`bester Zufalls-Baseline (${fmt(best, 3)}) – das CNN liegt ${fmt((cnn.macro_f1 - best) * 100, 1)} Punkte höher`, `of the best chance baseline (${fmt(best, 3)}) – the CNN is ${fmt((cnn.macro_f1 - best) * 100, 1)} points higher`))}
        ${statTile(tr('Macro-F1 · Baum', 'Macro F1 · tree'), fmt(tree.macro_f1, 3), tr(`${fmt(tree.macro_f1 / best, 1)}× bester Zufall · CNN ist ${fmt(cnn.macro_f1 / tree.macro_f1, 1)}× besser`, `${fmt(tree.macro_f1 / best, 1)}× best chance · CNN is ${fmt(cnn.macro_f1 / tree.macro_f1, 1)}× better`))}
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

    <section class="space-y-5" aria-labelledby="m-profiles">
      ${sectionHead(tr('Die Modelle', 'The models'), tr('Was steckt in den beiden Modellen?', 'What is inside the two models?'), '')}
      <h2 id="m-profiles" class="sr-only">${tr('Modell-Steckbriefe', 'Model profiles')}</h2>
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="card p-5 sm:p-6">
          <p class="flex items-center gap-2 text-[15px] font-semibold"><span class="h-2.5 w-2.5 rounded-sm" style="background:${COLOR.cnn}"></span>${tr('1D-CNN mit RR-Fusion', '1D CNN with RR fusion')}</p>
          <p class="mt-2 text-[15px] leading-relaxed text-muted">${tr(
            `Liest die Form jedes Herzschlags (${fmt((cfg.pre_ms ?? 250))} ms vor bis ${fmt(cfg.post_ms ?? 450)} ms nach der R-Zacke) mit drei Faltungsblöcken (16, 32, 64 Filter) und verbindet das Ergebnis mit vier Rhythmus-Merkmalen (RR-Abstände). Erst die Kombination aus Form und Takt macht vorzeitige Schläge erkennbar.`,
            `Reads the shape of each heartbeat (${fmt((cfg.pre_ms ?? 250))} ms before to ${fmt(cfg.post_ms ?? 450)} ms after the R peak) with three convolutional blocks (16, 32, 64 filters) and combines the result with four rhythm features (RR intervals). Only the combination of shape and timing makes premature beats detectable.`)}</p>
          <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[15px]">
            ${[
              [tr('Parameter', 'Parameters'), fmt(metrics.cnn.params)],
              [tr('Epochen', 'Epochs'), tr(`${fmt(metrics.cnn.epochs_run)} von max. ${fmt(cfg.epochs)}`, `${fmt(metrics.cnn.epochs_run)} of max. ${fmt(cfg.epochs)}`)],
              [tr('Beste Epoche', 'Best epoch'), tr(`${fmt(metrics.cnn.best_epoch)} (Early Stopping, Geduld ${fmt(cfg.patience)})`, `${fmt(metrics.cnn.best_epoch)} (early stopping, patience ${fmt(cfg.patience)})`)],
              [tr('Optimierer', 'Optimizer'), tr(`Adam, Lernrate ${fmt(cfg.lr, 3)}`, `Adam, learning rate ${fmt(cfg.lr, 3)}`)],
              ['Batch', tr(`${fmt(cfg.batch_size)} Schläge`, `${fmt(cfg.batch_size)} beats`)],
              [tr('Trainingsdaten', 'Training data'), tr(`${fmt(metrics.beats?.train)} Schläge, ${fmt(metrics.records?.train?.length)} Records`, `${fmt(metrics.beats?.train)} beats, ${fmt(metrics.records?.train?.length)} records`)],
              [tr('Validierung', 'Validation'), tr(`${fmt(metrics.beats?.val)} Schläge, Records ${esc((metrics.records?.val || []).join(', '))}`, `${fmt(metrics.beats?.val)} beats, records ${esc((metrics.records?.val || []).join(', '))}`)],
              [tr('Ungleichgewicht', 'Class imbalance'), tr('gewichtete Kreuzentropie (seltene Klassen zählen mehr)', 'weighted cross-entropy (rare classes count more)')],
            ].map(([k, v]) => `<div><dt class="text-[11.5px] uppercase tracking-wide text-muted">${k}</dt><dd class="mt-0.5 text-fg">${v}</dd></div>`).join('')}
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
        'Loss auf Training und Validierung sowie Macro-F1 auf den vier zurückgehaltenen DS1-Records je Epoche. Gespeichert wird die Epoche mit dem besten Validierungs-Macro-F1.',
        'Training and validation loss plus macro F1 on the four held-out DS1 records per epoch. The epoch with the best validation macro F1 is kept.'))}
      <h2 id="m-train" class="sr-only">${tr('Trainingsverlauf', 'Training history')}</h2>
      <div class="card overflow-hidden p-3 sm:p-4" data-train>${skeleton('16rem')}</div>
    </section>

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
  const metrics = await loadJSON('metrics.json');
  if (!metrics || metrics.status !== 'complete' || !metrics.cnn?.summary || !metrics.tree?.summary) {
    root.innerHTML = `<div class="mx-auto max-w-3xl px-4 py-24">${emptyState(tr('Noch keine Modell-Ergebnisse', 'No model results yet'), tr('Diese Seite zeigt die Ergebnisse des Volltrainings (metrics.json mit status „complete“). Sie erscheinen nach make train.', 'This page shows the results of the full training (metrics.json with status “complete”). They appear after make train.'), 'activity')}</div>`;
    return {};
  }
  root.innerHTML = content(metrics);

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
