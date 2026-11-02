// Dataset statistics: stacked bars per split (DS1/DS2) by AAMI class with a
// share/absolute-log toggle, count table and class-imbalance hint.

import {
  svg, h, esc, fmt, fmtPct, linear, logScale, clamp, makeRoot, createTooltip, ttRow, observeWidth,
  listeners, isPending, renderPendingFull, classColor, CLASS_LABELS, CLASSES, tile, note,
} from './shared.js';
import { tr } from '../lib/i18n.js';

const SPLIT_LABELS = { DS1: 'DS1 · Training', DS2: 'DS2 · Test' };

export function renderDatasetStats(container, data, opts = {}) {
  const per = data && typeof data === 'object' ? data.per_split : null;
  const splits = per && typeof per === 'object' ? Object.keys(per).filter((k) => per[k] && typeof per[k] === 'object') : [];
  if (isPending(data) || !splits.length) {
    return renderPendingFull(container, data, opts, { title: tr('Datensatz-Statistik folgt mit der vollständigen MIT-BIH-Datenbank', 'Dataset statistics follow with the complete MIT-BIH database'), iconName: 'database', name: 'dataset' });
  }
  const classes = [...CLASSES, ...new Set(splits.flatMap((sp) => Object.keys(per[sp])).filter((c) => !CLASSES.includes(c)))];
  const count = (sp, c) => Number(per[sp][c]) || 0;
  const totals = Object.fromEntries(splits.map((sp) => [sp, classes.reduce((a, c) => a + count(sp, c), 0)]));
  const grand = splits.reduce((a, sp) => a + totals[sp], 0);
  const classTotal = Object.fromEntries(classes.map((c) => [c, splits.reduce((a, sp) => a + count(sp, c), 0)]));

  const ls = listeners();
  const root = makeRoot(container, { label: tr('Datensatz-Statistik je Split und Klasse', 'Dataset statistics per split and class'), name: 'dataset' });
  const tiles = h('div', { class: 'ekc-tiles', style: { marginBottom: '12px' } }, root);
  for (const sp of splits) tile(tiles, { label: SPLIT_LABELS[sp] || sp, value: fmt(totals[sp]), sub: tr('Herzschläge', 'beats') });
  if (data.records_available != null) tile(tiles, { label: 'Records', value: fmt(data.records_available), sub: data.status && data.status !== 'complete' ? `Status: ${data.status}` : tr('verfügbar', 'available') });

  let mode = 'share';
  const bar = h('div', { class: 'ekc-toolbar' }, root);
  const seg = h('div', { class: 'ekc-btngroup', role: 'radiogroup', 'aria-label': tr('Darstellung', 'View') }, bar);
  const modes = [['share', tr('Anteile (100 %)', 'Shares (100%)')], ['log', tr('Anzahl je Klasse (log)', 'Count per class (log)')]];
  const modeBtns = modes.map(([m, label]) => {
    const b = h('button', { type: 'button', class: 'ekc-chip', role: 'radio', 'aria-checked': String(m === mode), 'aria-pressed': String(m === mode), text: label }, seg);
    ls.on(b, 'click', () => { mode = m; modeBtns.forEach((x, i) => { const on = modes[i][0] === m; x.setAttribute('aria-checked', String(on)); x.setAttribute('aria-pressed', String(on)); }); draw(); });
    return b;
  });

  const wrap = h('div', { style: { position: 'relative' } }, root);
  const s = svg('svg', { role: 'img', 'aria-label': splits.map((sp) => `${sp}: ${classes.map((c) => `${c} ${count(sp, c)}`).join(', ')}`).join('; ') }, wrap);
  const tip = createTooltip(root);
  const legend = h('div', { class: 'ekc-legend', style: { margin: '8px 0 12px' } }, root);
  classes.forEach((c) => h('span', { class: 'ekc-legend-item', html: `<i class="ekc-dot" style="--sw:${classColor(c)}"></i><b style="color:${classColor(c)}">${esc(c)}</b> ${esc(CLASS_LABELS[c] || c)}` }, legend));

  // Table
  const tblBox = h('div', { class: 'ekc-scroll' }, root);
  const tbl = h('table', { class: 'ekc-table' }, tblBox);
  tbl.insertAdjacentHTML('beforeend', `<thead><tr><th scope="col">${tr('Klasse', 'Class')}</th>${splits.map((sp) => `<th scope="col">${esc(sp)}</th><th scope="col">${tr('Anteil', 'Share')}</th>`).join('')}</tr></thead>`);
  const tb = h('tbody', {}, tbl);
  for (const c of classes) {
    tb.insertAdjacentHTML('beforeend', `<tr><td><span style="display:inline-flex;align-items:center;gap:7px"><i class="ekc-dot" style="--sw:${classColor(c)}"></i><b>${esc(c)}</b><span style="color:var(--c-muted)">${esc(CLASS_LABELS[c] || '')}</span></span></td>${splits.map((sp) => `<td>${fmt(count(sp, c))}</td><td style="color:var(--c-muted)">${totals[sp] ? fmtPct(count(sp, c) / totals[sp], 2) : '–'}</td>`).join('')}</tr>`);
  }

  // Imbalance hint
  const nonZero = classes.filter((c) => classTotal[c] > 0);
  if (grand > 0 && nonZero.length > 1) {
    const major = nonZero.reduce((a, c) => (classTotal[c] > classTotal[a] ? c : a));
    const minor = nonZero.reduce((a, c) => (classTotal[c] < classTotal[a] ? c : a));
    const ratio = Math.round(classTotal[major] / classTotal[minor]);
    note(root, tr(
      `Starkes Klassenungleichgewicht: ${major} stellt ${fmtPct(classTotal[major] / grand, 1)} aller Beats, ${minor} nur ${fmtPct(classTotal[minor] / grand, 2)} (≈ 1 : ${fmt(ratio)}). Deshalb Klassengewichte im Loss und Macro-F1 bzw. Sensitivität/PPV je Klasse statt Accuracy.`,
      `Strong class imbalance: ${major} accounts for ${fmtPct(classTotal[major] / grand, 1)} of all beats, ${minor} only ${fmtPct(classTotal[minor] / grand, 2)} (≈ 1 : ${fmt(ratio)}). Hence class weights in the loss and macro-F1 or per-class sensitivity/PPV instead of accuracy.`,
    ), 'alert');
  }

  let width = 0;
  function draw(W = width) {
    width = W;
    s.replaceChildren();
    const labW = W < 420 ? 74 : 112;
    const x0 = labW, x1 = W - 12;
    if (mode === 'share') {
      const rowH = 34, gap = 22, top = 8;
      const H = top + splits.length * (rowH + gap) + 18;
      s.setAttribute('viewBox', `0 0 ${W} ${H}`); s.setAttribute('width', '100%'); s.setAttribute('height', H);
      const x = linear(0, 1, x0, x1);
      // 0 / 50 / 100 % guides
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        svg('line', { x1: x(v), x2: x(v), y1: top - 2, y2: H - 18, class: 'ekc-gridline' }, s);
        svg('text', { x: x(v), y: H - 4, 'text-anchor': v === 0 ? 'start' : v === 1 ? 'end' : 'middle', class: 'ekc-tick', text: `${fmt(v * 100)}${tr(' %', '%')}` }, s);
      }
      splits.forEach((sp, r) => {
        const y = top + r * (rowH + gap);
        svg('text', { x: 0, y: y + rowH / 2 - 2, class: 'ekc-label', text: sp }, s);
        svg('text', { x: 0, y: y + rowH / 2 + 12, class: 'ekc-sublabel ekc-num', text: `n = ${fmt(totals[sp])}` }, s);
        let acc = 0;
        const tot = totals[sp] || 1;
        classes.forEach((c) => {
          const v = count(sp, c) / tot;
          if (v <= 0) return;
          const xa = x(acc), w = Math.max(1.5, x(acc + v) - xa);
          const seg = svg('rect', { x: xa, y, width: w, height: rowH, style: { fill: classColor(c), fillOpacity: 0.85, stroke: 'var(--c-surface)', strokeWidth: 1 } }, s);
          if (w > 44) svg('text', { x: xa + w / 2, y: y + rowH / 2 + 4, 'text-anchor': 'middle', class: 'ekc-num', style: { fill: 'var(--c-surface)', fontSize: '11px', fontWeight: 650, pointerEvents: 'none' }, text: `${c} ${fmtPct(v, 1)}` }, s);
          bindTip(seg, sp, c);
          acc += v;
        });
        svg('rect', { x: x0, y, width: x1 - x0, height: rowH, rx: 0, style: { fill: 'none', stroke: 'var(--c-border)' } }, s);
      });
    } else {
      const barH = 9, inner = 3, groupGap = 14, top = 6;
      const groupH = splits.length * (barH + inner) - inner;
      const H = top + classes.length * (groupH + groupGap) + 22;
      s.setAttribute('viewBox', `0 0 ${W} ${H}`); s.setAttribute('width', '100%'); s.setAttribute('height', H);
      const maxV = Math.max(...splits.flatMap((sp) => classes.map((c) => count(sp, c))), 10);
      const decades = Math.ceil(Math.log10(maxV));
      const x = logScale(1, 10 ** decades, x0, x1 - 54);
      for (let e = 0; e <= decades; e++) {
        svg('line', { x1: x(10 ** e), x2: x(10 ** e), y1: top - 2, y2: H - 20, class: 'ekc-gridline' }, s);
        svg('text', { x: x(10 ** e), y: H - 6, 'text-anchor': 'middle', class: 'ekc-tick', text: fmt(10 ** e) }, s);
      }
      classes.forEach((c, r) => {
        const y = top + r * (groupH + groupGap);
        svg('text', { x: 0, y: y + groupH / 2 + 4, style: { fill: classColor(c), fontSize: '12px', fontWeight: 700 }, text: c }, s);
        if (labW > 80) svg('text', { x: 16, y: y + groupH / 2 + 4, class: 'ekc-sublabel', text: (CLASS_LABELS[c] || '').split(' ')[0] }, s);
        splits.forEach((sp, k) => {
          const v = count(sp, c);
          const yy = y + k * (barH + inner);
          const w = v > 0 ? Math.max(1.5, x(Math.max(1, v)) - x0) : 0;
          const rect = svg('rect', { x: x0, y: yy, width: w, height: barH, rx: 2, style: { fill: classColor(c), fillOpacity: k === 0 ? 0.95 : 0.5 } }, s);
          svg('text', { x: x0 + w + 6, y: yy + barH - 1, class: 'ekc-num', style: { fill: 'var(--c-muted)', fontSize: '10px' }, text: `${sp} ${fmt(v)}` }, s);
          bindTip(rect, sp, c);
        });
      });
    }
  }

  function bindTip(el, sp, c) {
    const html = () => `<div class="ekc-tt-title">${esc(sp)} · ${tr('Klasse', 'Class')} ${esc(c)}</div>${ttRow(CLASS_LABELS[c] || c, fmt(count(sp, c)), classColor(c))}${ttRow(tr(`Anteil an ${sp}`, `Share of ${sp}`), totals[sp] ? fmtPct(count(sp, c) / totals[sp], 2) : '–')}`;
    el.addEventListener('pointermove', (e) => tip.show(html(), e.clientX, e.clientY));
    el.addEventListener('pointerleave', () => tip.hide());
  }

  const stop = observeWidth(root, (w) => draw(clamp(w, 240, 4000)));
  return { destroy() { stop(); ls.clear(); container.replaceChildren(); } };
}
