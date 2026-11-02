// Models ("Modelle"): how well the 1D-CNN and the decision tree classify DS2 beats,
// compared with chance baselines computed from the DS2 class distribution, plus model
// profiles, confusion matrices, training curve and known weaknesses. Everything comes
// from metrics.json; nothing is shown before the full training has completed.

import { loadJSON } from '../lib/data.js';
import { esc, fmt, pct, icon } from '../lib/dom.js';
import { emptyState, errorState, skeleton } from '../lib/ui.js';

const CLASS_NAMES = { N: 'Normal', S: 'Supraventrikulär', V: 'Ventrikulär', F: 'Fusion', Q: 'Unklassifizierbar' };
const FEATURE_LABELS = {
  qrs_width_ms: 'QRS-Breite', r_amplitude: 'R-Amplitude', q_depth: 'Q-Tiefe', s_depth: 'S-Tiefe',
  qrs_area: 'QRS-Fläche', t_amplitude: 'T-Amplitude', beat_energy: 'Schlag-Energie',
  pre_rr: 'RR davor', post_rr: 'RR danach', local_rr: 'lokales RR-Mittel', rr_ratio: 'RR-Verhältnis',
};
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
      <span class="min-w-0 text-[13px] leading-tight ${r.strong ? 'font-semibold text-fg' : 'text-muted'}">${esc(r.label)}${r.sub ? `<span class="block text-[11.5px] font-normal text-muted">${esc(r.sub)}</span>` : ''}</span>
      <span class="relative h-3.5 rounded-[4px] bg-surface-2" title="${esc(r.label)}: ${fmt(r.value, 3)}">
        <span class="absolute inset-y-0 left-0" style="width:${Math.max(0, Math.min(1, r.value)) * 100}%;background:${r.color};border-radius:0 4px 4px 0;${r.dim ? 'opacity:.55' : ''}"></span>
      </span>
      <span class="num text-right text-[13px] ${r.strong ? 'font-semibold text-fg' : 'text-muted'}">${fmt(r.value, 3)}</span>`).join('')}
  </div>`;
}

function legend(items) {
  return `<div class="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted">${items.map(([label, color, dim]) => `
    <span class="inline-flex items-center gap-1.5"><span class="h-2.5 w-4 rounded-[3px]" style="background:${color};${dim ? 'opacity:.55' : ''}"></span>${esc(label)}</span>`).join('')}</div>`;
}

function statTile(label, value, hint) {
  return `<div class="card flex min-w-0 flex-col gap-1 p-4 sm:p-5">
    <p class="eyebrow truncate">${esc(label)}</p>
    <p class="num mt-1 text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">${value}</p>
    <p class="text-[12px] leading-snug text-muted">${hint}</p>
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
  return `<span class="grid size-7 flex-none place-items-center rounded-lg font-mono text-[13px] font-semibold" style="color:var(--c-cls-${c});background:color-mix(in srgb,var(--c-cls-${c}) 12%,transparent);border:1px solid color-mix(in srgb,var(--c-cls-${c}) 30%,transparent)">${esc(c)}</span>`;
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

  const models = [
    { key: 'cnn', label: '1D-CNN + RR-Fusion', sub: 'Hauptmodell', s: cnn, color: COLOR.cnn, strong: true },
    { key: 'tree', label: 'Entscheidungsbaum', sub: 'Tiefe ' + fmt(metrics.tree.depth ?? cfg.max_depth), s: tree, color: COLOR.tree, strong: true },
    { key: 'prior', label: 'Zufall nach Häufigkeit', sub: 'rät im Verhältnis der Klassen', s: chance.prior, color: COLOR.chance, dim: true },
    { key: 'uniform', label: 'Zufall gleichverteilt', sub: 'jede Klasse 1 : ' + classes.length, s: chance.uniform, color: COLOR.chance, dim: true },
    { key: 'majority', label: `Immer „${chance.majority.major}“`, sub: 'häufigste Klasse', s: chance.majority, color: COLOR.chance, dim: true },
  ];

  const perClassRows = classes.map((c) => `
    <div class="grid gap-2 border-t border-line py-4 first:border-t-0 first:pt-0 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-5">
      <div class="flex items-start gap-2.5">
        ${classBadge(c)}
        <div class="min-w-0">
          <p class="text-sm font-semibold">${esc(CLASS_NAMES[c] || c)}</p>
          <p class="text-[12px] text-muted">${fmt(support[c])} Test-Schläge · ${pct(chance.p[c], support[c] / chance.n < 0.01 ? 2 : 1)}</p>
        </div>
      </div>
      ${barRows([
        { label: '1D-CNN', value: cnn.per_class[c].f1, color: COLOR.cnn, strong: true },
        { label: 'Entscheidungsbaum', value: tree.per_class[c].f1, color: COLOR.tree },
        { label: 'Zufall gleichverteilt', value: chance.uniform.per_class[c].f1, color: COLOR.chance, dim: true },
      ])}
    </div>`).join('');

  const cell = (v) => `<td class="num px-3 py-2 text-right">${pct(v, 1)}</td>`;
  const detailTable = `<div class="overflow-x-auto">
    <table class="w-full min-w-[46rem] border-collapse text-[13px]">
      <caption class="sr-only">Sensitivität, PPV und F1 je Klasse für beide Modelle und den gleichverteilten Zufall</caption>
      <thead>
        <tr class="text-left text-[11.5px] uppercase tracking-wide text-muted">
          <th scope="col" class="px-3 py-2">Klasse</th>
          ${['1D-CNN', 'Baum', 'Zufall'].map((m) => `<th scope="colgroup" colspan="3" class="border-l border-line px-3 py-2 text-center">${m}</th>`).join('')}
        </tr>
        <tr class="text-right text-[11.5px] text-muted">
          <th></th>${'<th class="border-l border-line px-3 py-1.5" title="TP / (TP + FN)">Sens.</th><th class="px-3 py-1.5" title="TP / (TP + FP)">PPV</th><th class="px-3 py-1.5">F1</th>'.repeat(3)}
        </tr>
      </thead>
      <tbody>${classes.map((c) => `<tr class="border-t border-line">
        <th scope="row" class="px-3 py-2 text-left"><span class="inline-flex items-center gap-2">${classBadge(c)}<span class="font-medium">${esc(CLASS_NAMES[c] || c)}</span></span></th>
        ${[cnn.per_class[c], tree.per_class[c], chance.uniform.per_class[c]].map((m) => `${cell(m.sensitivity).replace('class="', 'class="border-l border-line ')}${cell(m.ppv)}<td class="num px-3 py-2 text-right font-semibold">${fmt(m.f1, 3)}</td>`).join('')}
      </tr>`).join('')}</tbody>
    </table>
  </div>`;

  const nAsS = cm[iN][iS], nAsF = cm[iN][iF];
  const weaknesses = [
    ['S: viele Fehlalarme', `Das CNN findet ${pct(cnn.per_class.S.sensitivity, 0)} der S-Schläge, aber nur ${pct(cnn.per_class.S.ppv, 0)} seiner S-Alarme stimmen: ${fmt(nAsS)} normale Schläge werden als S markiert. Bei ${fmt(support.N)} N-Schlägen reicht schon ein kleiner Fehleranteil, um die wenigen echten S-Schläge zu überdecken.`],
    ['F: praktisch nicht gelernt', `Nur ${fmt(cnn.per_class.F.tp)} von ${fmt(support.F)} F-Schlägen werden erkannt, dafür ${fmt(nAsF)} N-Schläge fälschlich als F. Fast alle F-Trainingsschläge in DS1 stammen von einem einzigen Patienten (Record 208) – das Muster überträgt sich nicht auf andere Menschen.`],
    ['Q: zu wenige Beispiele', `Im Testset gibt es nur ${fmt(support.Q)} Q-Schläge (im Training ${fmt(metrics.per_split?.DS1?.Q ?? 0)}). Daraus lässt sich nichts lernen; deshalb wird zusätzlich Macro-F1 ohne Q berichtet (CNN: ${fmt(cnn.macro_f1_nsvf, 3)}).`],
    ['Accuracy täuscht', `„Immer ${chance.majority.major}“ erreicht ${pct(chance.majority.accuracy, 1)} Accuracy, fast so viel wie das CNN (${pct(cnn.accuracy, 1)}) – findet aber keinen einzigen auffälligen Schlag. Darum ist Macro-F1 die Hauptkennzahl.`],
  ];

  return `
  <section class="border-b border-line">
    <div class="mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16 lg:px-8">
      <p class="flex flex-wrap items-center gap-2">
        <span class="chip">${icon('activity', 'size-3 text-accent')}Testset DS2</span>
        <span class="chip">${fmt(metrics.records?.test?.length)} Patienten-Records</span>
        <span class="chip">${fmt(chance.n)} Herzschläge</span>
        <span class="chip chip-mono">${icon('file', 'size-3')}metrics.json</span>
      </p>
      <h1 class="mt-5 max-w-3xl text-[32px] font-semibold leading-[1.1] tracking-tight sm:text-[40px]">Wie gut erkennen die Modelle Arrhythmien?</h1>
      <p class="mt-4 max-w-3xl text-base leading-relaxed text-muted">
        Beide Modelle wurden nur auf DS1 trainiert und hier auf ${fmt(metrics.records?.test?.length)} völlig fremden Patienten (DS2) getestet.
        Als Maßstab dient, was man <span class="text-fg">ohne jedes Modell</span> durch Raten erreichen würde – berechnet aus der Klassenverteilung von DS2.
      </p>
    </div>
  </section>

  <div class="mx-auto max-w-7xl space-y-16 px-4 pt-10 sm:px-6 lg:px-8">
    <section class="space-y-5" aria-labelledby="m-macro">
      <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        ${statTile('Macro-F1 · 1D-CNN', fmt(cnn.macro_f1, 3), `Mittel der F1-Werte aller ${classes.length} Klassen`)}
        ${statTile('Gegenüber Raten', `${fmt(cnn.macro_f1 / best, 1)}×`, `bester Zufalls-Baseline (${fmt(best, 3)}) – das CNN liegt ${fmt((cnn.macro_f1 - best) * 100, 1)} Punkte höher`)}
        ${statTile('Macro-F1 · Baum', fmt(tree.macro_f1, 3), `${fmt(tree.macro_f1 / best, 1)}× bester Zufall · CNN ist ${fmt(cnn.macro_f1 / tree.macro_f1, 1)}× besser`)}
        ${statTile('Ohne Q-Klasse', fmt(cnn.macro_f1_nsvf, 3), `Macro-F1 des CNN über N, S, V, F (Baum: ${fmt(tree.macro_f1_nsvf, 3)})`)}
      </div>
      <div class="card overflow-hidden">
        <div class="card-head">
          <div class="min-w-0">
            <p class="eyebrow">Gesamtvergleich</p>
            <h2 id="m-macro" class="mt-0.5 text-sm font-semibold">Macro-F1: Modelle gegen Raten</h2>
          </div>
          ${legend([['Modelle', COLOR.cnn], ['Zufalls-Baselines', COLOR.chance, true]])}
        </div>
        <div class="space-y-6 p-4 sm:p-6">
          ${barRows(models.map((m) => ({ label: m.label, sub: m.sub, value: m.s.macro_f1, color: m.color, strong: m.strong, dim: m.dim })))}
          <div class="overflow-x-auto">
            <table class="w-full min-w-[30rem] border-collapse text-[13px]">
              <caption class="sr-only">Accuracy und Macro-F1 der Modelle und Baselines</caption>
              <thead><tr class="text-left text-[11.5px] uppercase tracking-wide text-muted">
                <th scope="col" class="px-3 py-2">Strategie</th><th scope="col" class="px-3 py-2 text-right">Accuracy</th><th scope="col" class="px-3 py-2 text-right">Macro-F1</th><th scope="col" class="px-3 py-2 text-right" title="Macro-F1 geteilt durch die beste Zufalls-Baseline (${fmt(best, 3)})">vs. bester Zufall</th>
              </tr></thead>
              <tbody>${models.map((m) => `<tr class="border-t border-line ${m.strong ? 'text-fg' : 'text-muted'}">
                <th scope="row" class="px-3 py-2 text-left font-medium"><span class="inline-flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-sm" style="background:${m.color};${m.dim ? 'opacity:.55' : ''}"></span>${esc(m.label)}</span></th>
                <td class="num px-3 py-2 text-right">${pct(m.s.accuracy, 1)}</td>
                <td class="num px-3 py-2 text-right font-semibold">${fmt(m.s.macro_f1, 3)}</td>
                <td class="num px-3 py-2 text-right">${fmt(m.s.macro_f1 / best, 1)}×</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
          <p class="text-[12.5px] leading-relaxed text-muted">${icon('info', 'mr-1 inline size-3.5 align-[-2px]')}Zufallswerte sind Erwartungswerte: Wer zufällig rät, trifft eine Klasse im Mittel so oft, wie sie vorkommt (PPV = Anteil der Klasse). „Gleichverteilt“ wählt jede der ${classes.length} Klassen mit gleicher Wahrscheinlichkeit, „nach Häufigkeit“ im Verhältnis ihres Vorkommens.</p>
        </div>
      </div>
    </section>

    <section class="space-y-5" aria-labelledby="m-class">
      ${sectionHead('Je Klasse', 'F1 je AAMI-Klasse', 'F1 verbindet Sensitivität (wie viele echte Schläge einer Klasse gefunden werden) und PPV (wie viele Alarme stimmen). Gerade bei den seltenen Klassen zeigt sich, wo die Modelle über das Raten hinauskommen – und wo nicht.')}
      <div class="card overflow-hidden">
        <div class="card-head">
          <h3 id="m-class" class="text-sm font-semibold">F1-Wert je Klasse</h3>
          ${legend([['1D-CNN', COLOR.cnn], ['Entscheidungsbaum', COLOR.tree], ['Zufall gleichverteilt', COLOR.chance, true]])}
        </div>
        <div class="p-4 sm:p-6">${perClassRows}</div>
      </div>
      <details class="card overflow-hidden">
        <summary class="cursor-pointer px-4 py-3 text-sm font-semibold sm:px-6">Tabelle: Sensitivität, PPV und F1 im Detail</summary>
        <div class="border-t border-line p-2 sm:p-4">${detailTable}</div>
      </details>
    </section>

    <section class="space-y-5" aria-labelledby="m-profiles">
      ${sectionHead('Die Modelle', 'Was steckt in den beiden Modellen?', '')}
      <h2 id="m-profiles" class="sr-only">Modell-Steckbriefe</h2>
      <div class="grid gap-4 lg:grid-cols-2">
        <div class="card p-5 sm:p-6">
          <p class="flex items-center gap-2 text-[15px] font-semibold"><span class="h-2.5 w-2.5 rounded-sm" style="background:${COLOR.cnn}"></span>1D-CNN mit RR-Fusion</p>
          <p class="mt-2 text-[13px] leading-relaxed text-muted">Liest die Form jedes Herzschlags (${fmt((cfg.pre_ms ?? 250))} ms vor bis ${fmt(cfg.post_ms ?? 450)} ms nach der R-Zacke) mit drei Faltungsblöcken (16, 32, 64 Filter) und verbindet das Ergebnis mit vier Rhythmus-Merkmalen (RR-Abstände). Erst die Kombination aus Form und Takt macht vorzeitige Schläge erkennbar.</p>
          <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            ${[
              ['Parameter', fmt(metrics.cnn.params)],
              ['Epochen', `${fmt(metrics.cnn.epochs_run)} von max. ${fmt(cfg.epochs)}`],
              ['Beste Epoche', `${fmt(metrics.cnn.best_epoch)} (Early Stopping, Geduld ${fmt(cfg.patience)})`],
              ['Optimierer', `Adam, Lernrate ${fmt(cfg.lr, 3)}`],
              ['Batch', `${fmt(cfg.batch_size)} Schläge`],
              ['Trainingsdaten', `${fmt(metrics.beats?.train)} Schläge, ${fmt(metrics.records?.train?.length)} Records`],
              ['Validierung', `${fmt(metrics.beats?.val)} Schläge, Records ${esc((metrics.records?.val || []).join(', '))}`],
              ['Ungleichgewicht', 'gewichtete Kreuzentropie (seltene Klassen zählen mehr)'],
            ].map(([k, v]) => `<div><dt class="text-[11.5px] uppercase tracking-wide text-muted">${k}</dt><dd class="mt-0.5 text-fg">${v}</dd></div>`).join('')}
          </dl>
        </div>
        <div class="card p-5 sm:p-6">
          <p class="flex items-center gap-2 text-[15px] font-semibold"><span class="h-2.5 w-2.5 rounded-sm" style="background:${COLOR.tree}"></span>Entscheidungsbaum</p>
          <p class="mt-2 text-[13px] leading-relaxed text-muted">Stellt höchstens ${fmt(metrics.tree.max_depth ?? cfg.max_depth)} Ja/Nein-Fragen zu ${fmt((metrics.tree.features || []).length)} verständlichen Merkmalen. Jede Entscheidung ist nachlesbar – dafür kann er feine Formunterschiede kaum abbilden.</p>
          <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            ${[
              ['Tiefe / Blätter', `${fmt(metrics.tree.depth)} / ${fmt(metrics.tree.n_leaves)}`],
              ['Trainingsdaten', `${fmt(metrics.tree.trained_on_beats)} Schläge (ganz DS1)`],
            ].map(([k, v]) => `<div><dt class="text-[11.5px] uppercase tracking-wide text-muted">${k}</dt><dd class="mt-0.5 text-fg">${v}</dd></div>`).join('')}
          </dl>
          <p class="mt-4 text-[11.5px] uppercase tracking-wide text-muted">Merkmale</p>
          <p class="mt-1.5 flex flex-wrap gap-1.5">${(metrics.tree.features || []).map((f) => `<span class="chip" title="${esc(f)}">${esc(FEATURE_LABELS[f] || f)}</span>`).join('')}</p>
          <a href="#/process/erklaerbarkeit" class="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">Baum interaktiv ansehen ${icon('arrowRight', 'size-3.5')}</a>
        </div>
      </div>
    </section>

    <section class="space-y-5" aria-labelledby="m-cm">
      ${sectionHead('Fehleranalyse', 'Was wird womit verwechselt?', 'Zeilen sind die wahre Klasse (Expertenannotation), Spalten die Vorhersage. Die Diagonale sind Treffer.')}
      <h2 id="m-cm" class="sr-only">Konfusionsmatrizen</h2>
      <div class="grid gap-4 xl:grid-cols-2">
        <div class="card overflow-hidden"><div class="card-head"><p class="text-sm font-semibold">1D-CNN</p></div><div class="p-3 sm:p-4" data-cm="cnn">${skeleton('18rem')}</div></div>
        <div class="card overflow-hidden"><div class="card-head"><p class="text-sm font-semibold">Entscheidungsbaum</p></div><div class="p-3 sm:p-4" data-cm="tree">${skeleton('18rem')}</div></div>
      </div>
    </section>

    <section class="space-y-5" aria-labelledby="m-train">
      ${sectionHead('Training', 'Wie das CNN gelernt hat', 'Loss auf Training und Validierung sowie Macro-F1 auf den vier zurückgehaltenen DS1-Records je Epoche. Gespeichert wird die Epoche mit dem besten Validierungs-Macro-F1.')}
      <h2 id="m-train" class="sr-only">Trainingsverlauf</h2>
      <div class="card overflow-hidden p-3 sm:p-4" data-train>${skeleton('16rem')}</div>
    </section>

    <section class="space-y-5" aria-labelledby="m-weak">
      ${sectionHead('Ehrlich bleiben', 'Wo die Modelle an Grenzen stoßen', '')}
      <h2 id="m-weak" class="sr-only">Schwächen</h2>
      <div class="grid gap-3 md:grid-cols-2">
        ${weaknesses.map(([t, d]) => `<div class="card p-5">
          <p class="flex items-center gap-2 text-[15px] font-semibold">${icon('alert', 'size-4 text-muted')}${esc(t)}</p>
          <p class="mt-1.5 text-[13px] leading-relaxed text-muted">${esc(d)}</p>
        </div>`).join('')}
      </div>
    </section>
  </div>`;
}

export async function render(root) {
  root.innerHTML = `<div class="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">${skeleton('24rem')}</div>`;
  const metrics = await loadJSON('metrics.json');
  if (!metrics || metrics.status !== 'complete' || !metrics.cnn?.summary || !metrics.tree?.summary) {
    root.innerHTML = `<div class="mx-auto max-w-3xl px-4 py-24">${emptyState('Noch keine Modell-Ergebnisse', 'Diese Seite zeigt die Ergebnisse des Volltrainings (metrics.json mit status „complete“). Sie erscheinen nach make train.', 'activity')}</div>`;
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
    root.querySelectorAll('[data-cm], [data-train]').forEach((n) => { n.innerHTML = errorState('Diagramm konnte nicht geladen werden', err); });
  }

  return {
    destroy() {
      alive = false;
      handles.forEach((h) => h?.destroy?.());
    },
  };
}
