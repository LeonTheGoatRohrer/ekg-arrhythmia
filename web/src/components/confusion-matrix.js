// Confusion matrix heatmap (row-normalised; absolute counts + row %), axes
// True/Pred, plus per-class table (sensitivity, PPV, F1, specificity, support).

import {
  svg, h, esc, fmt, fmtPct, clamp, makeRoot, createTooltip, ttRow, observeWidth, listeners,
  isPending, renderPendingFull, classColor, CLASS_LABELS, CLASSES, tile, note,
} from './shared.js';
import { tr } from '../lib/i18n.js';

function toSummary(data) {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data.confusion)) return data;
  if (Array.isArray(data.summary?.confusion)) return data.summary;
  if (Array.isArray(data.cnn?.summary?.confusion)) return data.cnn.summary;
  return null;
}

export function renderConfusionMatrix(container, data, opts = {}) {
  const sm = toSummary(data);
  const cm = sm?.confusion;
  if (isPending(data) || !sm || !Array.isArray(cm) || !cm.length || !cm.every((r) => Array.isArray(r) && r.length === cm.length)) {
    return renderPendingFull(container, data, opts, { title: tr('Konfusionsmatrix folgt nach dem Volltraining', 'Confusion matrix available after the full training'), iconName: 'grid', name: 'confusion' });
  }
  const k = cm.length;
  const names = Array.isArray(sm.class_names) && sm.class_names.length === k ? sm.class_names : CLASSES.slice(0, k);
  const rowSum = cm.map((r) => r.reduce((a, b) => a + (Number(b) || 0), 0));
  const colSum = names.map((_, j) => cm.reduce((a, r) => a + (Number(r[j]) || 0), 0));
  const total = rowSum.reduce((a, b) => a + b, 0);
  const norm = cm.map((r, i) => r.map((v) => (rowSum[i] ? v / rowSum[i] : null)));
  const per = sm.per_class && typeof sm.per_class === 'object' ? sm.per_class : {};

  const ls = listeners();
  const root = makeRoot(container, { label: tr('Konfusionsmatrix und Klassenmetriken', 'Confusion matrix and per-class metrics'), name: 'confusion' });
  const tiles = h('div', { class: 'ekc-tiles', style: { marginBottom: '14px' } }, root);
  tile(tiles, { label: tr('Macro-F1', 'Macro F1'), value: fmt(sm.macro_f1, 3), sub: tr('Hauptmetrik', 'headline metric'), color: 'var(--c-accent)' });
  tile(tiles, { label: 'Accuracy', value: fmtPct(sm.accuracy, 1), sub: tr('dominiert von N', 'dominated by N') });
  tile(tiles, { label: tr('Test-Beats', 'Test beats'), value: fmt(total), sub: opts?.raw?.split ? String(opts.raw.split) : 'DS2' });

  const layoutBox = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '18px', alignItems: 'start' } }, root);
  const hmBox = h('div', { style: { position: 'relative', minWidth: 0 } }, layoutBox);
  const s = svg('svg', { role: 'grid', 'aria-label': tr(`Konfusionsmatrix ${k}×${k}, Zeilen: wahre Klasse, Spalten: vorhergesagte Klasse, zeilennormiert.`, `Confusion matrix ${k}×${k}, rows: true class, columns: predicted class, row-normalized.`) }, hmBox);
  const tableBox = h('div', { class: 'ekc-scroll', style: { minWidth: 0 } }, layoutBox);
  const tip = createTooltip(root);

  // Per-class table
  const metricOf = (c, key) => per?.[c]?.[key];
  const tbl = h('table', { class: 'ekc-table' }, tableBox);
  h('caption', { text: tr('Metriken je Klasse (AAMI EC57)', 'Per-class metrics (AAMI EC57)'), style: { captionSide: 'top', textAlign: 'left', fontSize: '12px', fontWeight: 600, color: 'var(--c-text)', padding: '0 8px 6px' } }, tbl);
  tbl.insertAdjacentHTML('beforeend', `<thead><tr><th scope="col">${tr('Klasse', 'Class')}</th><th scope="col" title="${tr('Sensitivität', 'Sensitivity')} = TP / (TP + FN)">Sens.</th><th scope="col" title="${tr('Positiver Vorhersagewert', 'Positive predictive value')} = TP / (TP + FP)">PPV</th><th scope="col">F1</th><th scope="col" title="${tr('Spezifität', 'Specificity')} = TN / (TN + FP)">${tr('Spez.', 'Spec.')}</th><th scope="col">Support</th></tr></thead>`);
  const tb = h('tbody', {}, tbl);
  names.forEach((c, i) => {
    const cell = (v) => `<td>${v == null ? '–' : fmtPct(v, 1)}</td>`;
    const f1 = metricOf(c, 'f1');
    tb.insertAdjacentHTML('beforeend', `<tr><th scope="row" style="text-align:left;text-transform:none;letter-spacing:0;font-size:12.5px;color:var(--c-text);border-bottom:inherit"><span style="display:inline-flex;align-items:center;gap:7px" title="${esc(CLASS_LABELS[c] || c)}"><i class="ekc-dot" style="--sw:${classColor(c)}"></i><b>${esc(c)}</b></span></th>${cell(metricOf(c, 'sensitivity'))}${cell(metricOf(c, 'ppv'))}<td><b>${f1 == null ? '–' : fmt(f1, 3)}</b></td>${cell(metricOf(c, 'specificity'))}<td>${fmt(metricOf(c, 'support') ?? rowSum[i])}</td></tr>`);
  });
  note(tableBox, tr(
    'Zeilen sind auf die wahre Klasse normiert (Prozent = Anteil der Beats dieser Klasse). Wegen des starken N-Übergewichts sind Sensitivität und PPV für S und V aussagekräftiger als die Accuracy.',
    'Rows are normalized to the true class (percent = share of the beats of that class). Because N beats dominate, sensitivity and PPV for S and V say more than accuracy.'));

  let cells = [];
  let focusIdx = 0;
  let width = 0;

  function draw(W) {
    width = W;
    s.replaceChildren();
    const size = Math.min(W, 460);
    const labL = 58, labT = 50;
    const cs = Math.floor((size - labL - 6) / k);
    const gridW = cs * k;
    const H = labT + gridW + 8;
    s.setAttribute('viewBox', `0 0 ${labL + gridW + 6} ${H}`);
    s.setAttribute('width', labL + gridW + 6);
    s.setAttribute('height', H);
    const g = svg('g', {}, s);
    // axis titles
    svg('text', { x: labL + gridW / 2, y: 13, 'text-anchor': 'middle', class: 'ekc-axis-title', text: tr('Vorhergesagte Klasse (Pred)', 'Predicted class') }, g);
    const ty = labT + gridW / 2;
    svg('text', { x: 12, y: ty, transform: `rotate(-90 12 ${ty})`, 'text-anchor': 'middle', class: 'ekc-axis-title', text: tr('Wahre Klasse (True)', 'True class') }, g);
    names.forEach((c, j) => {
      svg('text', { x: labL + j * cs + cs / 2, y: labT - 10, 'text-anchor': 'middle', style: { fill: classColor(c), fontWeight: 700, fontSize: '12.5px' }, text: c }, g);
      svg('text', { x: labL - 12, y: labT + j * cs + cs / 2 + 4.5, 'text-anchor': 'end', style: { fill: classColor(c), fontWeight: 700, fontSize: '12.5px' }, text: c }, g);
    });
    const gCells = svg('g', { role: 'rowgroup' }, g);
    cells = [];
    const showPct = cs >= 46;
    for (let i = 0; i < k; i++) {
      const row = svg('g', { role: 'row' }, gCells);
      for (let j = 0; j < k; j++) {
        const v = norm[i][j];
        const count = Number(cm[i][j]) || 0;
        const diag = i === j;
        const cx = labL + j * cs, cy = labT + i * cs;
        const cg = svg('g', {
          role: 'gridcell', tabindex: i * k + j === focusIdx ? 0 : -1,
          'aria-label': tr(`Wahr ${names[i]}, vorhergesagt ${names[j]}: ${fmt(count)} Beats${v != null ? `, ${fmtPct(v, 1)} der Zeile` : ''}`,
            `True ${names[i]}, predicted ${names[j]}: ${fmt(count)} beats${v != null ? `, ${fmtPct(v, 1)} of the row` : ''}`),
        }, row);
        const strength = v == null ? 0 : v;
        const fill = diag ? 'var(--c-accent)' : 'var(--c-filtered)';
        svg('rect', { x: cx + 1, y: cy + 1, width: cs - 2, height: cs - 2, rx: 6, style: { fill: 'var(--c-surface-2)' } }, cg);
        const rect = svg('rect', { x: cx + 1, y: cy + 1, width: cs - 2, height: cs - 2, rx: 6, style: { fill, fillOpacity: !v ? 0 : (diag ? 0.08 + 0.92 * strength : 0.08 + 0.92 * strength ** 0.7), transition: 'opacity .15s' } }, cg);
        const dark = !!v && (diag ? strength : strength ** 0.7) > 0.55;
        const txtCol = dark ? 'var(--c-surface)' : 'var(--c-text)';
        svg('text', { x: cx + cs / 2, y: cy + cs / 2 + (showPct ? -2 : 4), 'text-anchor': 'middle', class: 'ekc-num', style: { fill: txtCol, fontSize: cs < 40 ? '10px' : '12.5px', fontWeight: 650 }, text: v == null ? '–' : fmt(count) }, cg);
        if (showPct && v != null) svg('text', { x: cx + cs / 2, y: cy + cs / 2 + 13, 'text-anchor': 'middle', class: 'ekc-num', style: { fill: txtCol, fontSize: '10.5px', opacity: 0.85 }, text: fmtPct(v, v < 0.01 && v > 0 ? 2 : 1) }, cg);
        svg('rect', { x: cx + 1, y: cy + 1, width: cs - 2, height: cs - 2, rx: 6, class: 'ekc-focus' }, cg);
        cells.push({ i, j, g: cg, rect });
      }
    }
    // hover / focus behaviour
    for (const c of cells) {
      const html = () => {
        const v = norm[c.i][c.j];
        return `<div class="ekc-tt-title">${tr('Wahr', 'True')} ${esc(names[c.i])} → ${tr('Pred', 'predicted')} ${esc(names[c.j])}</div>${ttRow('Beats', fmt(cm[c.i][c.j]))}${ttRow(tr(`Anteil von ${names[c.i]}`, `Share of ${names[c.i]}`), v == null ? '–' : fmtPct(v, 2), classColor(names[c.i]))}${ttRow(tr(`Anteil an Pred ${names[c.j]}`, `Share of predicted ${names[c.j]}`), colSum[c.j] ? fmtPct(cm[c.i][c.j] / colSum[c.j], 2) : '–', classColor(names[c.j]))}${c.i === c.j ? '' : `<div style="margin-top:4px;color:var(--c-muted)">${tr('Fehlklassifikation', 'Misclassification')}</div>`}`;
      };
      ls.on(c.g, 'pointerenter', () => highlight(c));
      ls.on(c.g, 'pointermove', (e) => tip.show(html(), e.clientX, e.clientY));
      ls.on(c.g, 'pointerleave', () => { highlight(null); tip.hide(); });
      ls.on(c.g, 'focus', () => { highlight(c); tip.showAt(html(), c.g); focusIdx = c.i * k + c.j; });
      ls.on(c.g, 'blur', () => { highlight(null); tip.hide(); });
      ls.on(c.g, 'keydown', (e) => {
        let { i, j } = c;
        if (e.key === 'ArrowLeft') j -= 1; else if (e.key === 'ArrowRight') j += 1;
        else if (e.key === 'ArrowUp') i -= 1; else if (e.key === 'ArrowDown') i += 1; else return;
        e.preventDefault();
        i = clamp(i, 0, k - 1); j = clamp(j, 0, k - 1);
        const next = cells[i * k + j];
        c.g.setAttribute('tabindex', -1); next.g.setAttribute('tabindex', 0); next.g.focus();
      });
    }
  }

  function highlight(c) {
    for (const x of cells) x.g.style.opacity = !c || x.i === c.i || x.j === c.j ? '1' : '0.35';
  }

  const stop = observeWidth(hmBox, draw);
  return { destroy() { stop(); ls.clear(); container.replaceChildren(); } };
}
