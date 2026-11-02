// Beat gallery: small multiples per AAMI class. All example beats overlaid
// semi-transparently, the class mean highlighted, R time marked, shared y-scale.

import {
  svg, h, esc, fmt, linear, niceTicks, niceDomain, extent, clamp, makeRoot, createTooltip,
  ttRow, observeWidth, listeners, isPending, renderMissingExport, classColor, CLASS_LABELS,
  CLASSES, note,
} from './shared.js';
import { tr } from '../lib/i18n.js';

const PANEL_H = 168;
const M = { top: 10, right: 10, bottom: 30, left: 36 };

export function renderBeatGallery(container, data, opts = {}) {
  const examples = Array.isArray(data?.examples) ? data.examples.filter((e) => e && Array.isArray(e.beat) && e.beat.length > 1) : [];
  if (isPending(data) || !examples.length) {
    return renderMissingExport(container, opts, { title: tr('Segmentierte Herzschläge noch nicht verfügbar', 'Segmented beats not available yet'), file: 'segmentation_demo.json', iconName: 'pulse', name: 'beats' });
  }

  const fs = Number(data.fs) || 360;
  const preMs = Number(data.pre_ms ?? 250);
  const postMs = Number(data.post_ms ?? 450);
  const unit = typeof data.unit === 'string' ? data.unit : 'mV';
  const record = data.record ?? '100';
  // Total beats per class in the record (if exported); the gallery only shows a sample of them.
  const counts = data.counts && typeof data.counts === 'object' ? data.counts : {};
  const totalOf = (c) => (Number.isFinite(Number(counts[c])) ? Number(counts[c]) : null);
  const groups = new Map(CLASSES.map((c) => [c, []]));
  for (const e of examples) {
    const c = CLASSES.includes(e.aami) ? e.aami : null;
    if (c) groups.get(c).push(e);
  }
  const L = Math.max(...examples.map((e) => e.beat.length));
  // time (ms) of sample j relative to R
  const tOf = (j) => (j / fs) * 1000 - preMs;
  const means = new Map();
  for (const [c, list] of groups) {
    if (!list.length) continue;
    const m = new Array(L).fill(0);
    const cnt = new Array(L).fill(0);
    for (const e of list) e.beat.forEach((v, j) => { m[j] += v; cnt[j] += 1; });
    means.set(c, m.map((v, j) => (cnt[j] ? v / cnt[j] : 0)));
  }
  const [lo0, hi0] = extent(examples.map((e) => e.beat));
  const [ylo, yhi] = niceDomain(lo0, hi0, 4, 0.04);

  const ls = listeners();
  const root = makeRoot(container, { label: tr('Segmentierte Herzschläge je AAMI-Klasse', 'Segmented beats per AAMI class'), name: 'beats' });
  const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))', gap: '10px' } }, root);
  const tip = createTooltip(root);
  const panels = [];

  for (const c of CLASSES) {
    const list = groups.get(c);
    const card = h('div', {
      class: 'ekc-fade-in',
      style: { border: '1px solid var(--c-border)', borderRadius: '12px', background: 'var(--c-surface)', padding: '10px 10px 4px', minWidth: 0, position: 'relative', opacity: list.length ? 1 : 0.75 },
    }, grid);
    const head = h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px' } }, card);
    h('span', { html: `<i class="ekc-dot" style="--sw:${classColor(c)};width:9px;height:9px"></i>`, style: { alignSelf: 'center', display: 'inline-flex' } }, head);
    h('span', { text: c, style: { fontWeight: 700, color: classColor(c), fontSize: '14px' } }, head);
    h('span', { text: CLASS_LABELS[c], style: { color: 'var(--c-muted)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: '1 1 auto' } }, head);
    const total = totalOf(c);
    const countText = total != null ? tr(`${fmt(list.length)} von ${fmt(total)}`, `${fmt(list.length)} of ${fmt(total)}`) : `n = ${fmt(list.length)}`;
    h('span', {
      class: 'ekc-num ekc-meta', text: countText, style: { whiteSpace: 'nowrap', flex: 'none' },
      title: total != null
        ? tr(`${fmt(list.length)} gezeigte Beispiele von ${fmt(total)} Schlägen der Klasse ${c} in Record ${record}`, `${fmt(list.length)} examples shown out of ${fmt(total)} class ${c} beats in record ${record}`)
        : tr(`${fmt(list.length)} gezeigte Beispiele`, `${fmt(list.length)} examples shown`),
    }, head);
    if (!list.length) {
      h('div', {
        style: { height: `${PANEL_H - 12}px`, display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--c-muted)', fontSize: '12px', padding: '0 12px', border: '1px dashed var(--c-border)', borderRadius: '9px', margin: '6px 0 8px', background: 'var(--c-surface-2)' },
        text: tr(`In Record ${record} nicht vorhanden – erst mit der vollständigen MIT-BIH-Datenbank sichtbar.`, `Not present in record ${record} – visible only with the complete MIT-BIH database.`),
      }, card);
      continue;
    }
    const s = svg('svg', {
      role: 'img', style: { touchAction: 'pan-y' },
      'aria-label': tr(
        `${list.length} Beispiel-Herzschläge der Klasse ${c} (${CLASS_LABELS[c]})${totalOf(c) != null ? ` von ${totalOf(c)} im Record` : ''} überlagert mit ihrem Mittelwert, ${fmt(-preMs)} bis ${fmt(postMs)} ms um die R-Zacke.`,
        `${list.length} example beats of class ${c} (${CLASS_LABELS[c]})${totalOf(c) != null ? ` out of ${totalOf(c)} in the record` : ''} overlaid with their mean, ${fmt(-preMs)} to ${fmt(postMs)} ms around the R peak.`,
      ),
    }, card);
    panels.push({ c, s, list, card });
  }

  const legend = h('div', { class: 'ekc-legend', style: { marginTop: '10px' } }, root);
  legend.innerHTML = `
    <span class="ekc-legend-item"><svg width="22" height="8" aria-hidden="true"><path d="M1 4h20" style="stroke:var(--c-muted);stroke-width:1.2;opacity:.45"/></svg>${tr('einzelne Schläge', 'individual beats')}</span>
    <span class="ekc-legend-item"><svg width="22" height="8" aria-hidden="true"><path d="M1 4h20" style="stroke:var(--c-text);stroke-width:2.4"/></svg>${tr('Mittel der gezeigten Beispiele', 'mean of the examples shown')}</span>
    <span class="ekc-legend-item"><svg width="22" height="10" aria-hidden="true"><path d="M11 0v10" style="stroke:var(--c-peak);stroke-width:1.4;stroke-dasharray:2 2"/></svg>${tr('R-Zacke (0 ms)', 'R peak (0 ms)')}</span>`;
  note(root, tr(
    `Fenster ${fmt(-preMs)} … +${fmt(postMs)} ms um die R-Zacke (${fmt(L)} Samples bei ${fmt(fs)} Hz), echte Schläge aus Record ${record}. Gezeigt wird je Klasse eine Auswahl von Beispielen („12 von 2.237“ = 12 gezeigte von 2.237 Schlägen im Record) – die Klassen sind in Wirklichkeit sehr ungleich häufig. Gemeinsame y-Achse für alle Klassen; Amplitude in ${unit}.`,
    `Window ${fmt(-preMs)} … +${fmt(postMs)} ms around the R peak (${fmt(L)} samples at ${fmt(fs)} Hz), real beats from record ${record}. Each class shows a selection of examples ("12 of 2,237" = 12 shown out of 2,237 beats in the record) – in reality the classes are highly imbalanced. Shared y-axis for all classes; amplitude in ${unit}.`,
  ));

  function drawPanel(p, W) {
    const { s, list, c } = p;
    s.replaceChildren();
    const H = PANEL_H;
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    s.setAttribute('width', '100%');
    s.setAttribute('height', H);
    const plot = { x0: M.left, x1: W - M.right, y0: M.top, y1: H - M.bottom };
    const x = linear(-preMs, postMs, plot.x0, plot.x1);
    const y = linear(ylo, yhi, plot.y1, plot.y0);
    const col = classColor(c);
    const ax = svg('g', { 'aria-hidden': 'true' }, s);
    for (const v of niceTicks(ylo, yhi, 3)) {
      svg('line', { x1: plot.x0, x2: plot.x1, y1: y(v), y2: y(v), class: 'ekc-gridline' }, ax);
      svg('text', { x: plot.x0 - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'ekc-tick', text: fmt(v, Math.abs(v) < 1 && v !== 0 ? 1 : 0) }, ax);
    }
    for (const t of niceTicks(-preMs, postMs, Math.max(2, Math.round((plot.x1 - plot.x0) / 60)))) {
      svg('line', { x1: x(t), x2: x(t), y1: plot.y1, y2: plot.y1 + 4, class: 'ekc-axis-line' }, ax);
      svg('text', { x: x(t), y: plot.y1 + 16, 'text-anchor': 'middle', class: 'ekc-tick', text: fmt(t) }, ax);
    }
    svg('line', { x1: plot.x0, x2: plot.x1, y1: plot.y1, y2: plot.y1, class: 'ekc-axis-line' }, ax);
    svg('text', { x: plot.x1, y: plot.y1 + 28, 'text-anchor': 'end', class: 'ekc-sublabel', text: tr('ms relativ zu R', 'ms relative to R') }, ax);
    svg('text', { x: 2, y: plot.y0 + 2, class: 'ekc-sublabel', text: unit, 'dominant-baseline': 'hanging' }, ax);
    // R marker
    svg('line', { x1: x(0), x2: x(0), y1: plot.y0, y2: plot.y1, style: { stroke: 'var(--c-peak)', strokeWidth: 1.3, strokeDasharray: '3 3' } }, s);
    svg('text', { x: x(0) + 4, y: plot.y0 + 9, style: { fill: 'var(--c-peak)', fontSize: '10px', fontWeight: 700 }, text: 'R' }, s);
    // beats
    const op = clamp(2.2 / Math.sqrt(list.length), 0.12, 0.55);
    const path = (arr) => arr.map((v, j) => `${j ? 'L' : 'M'}${x(tOf(j)).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const bg = svg('g', { style: { opacity: op } }, s);
    for (const e of list) svg('path', { d: path(e.beat), style: { fill: 'none', stroke: col, strokeWidth: 1 } }, bg);
    const mean = means.get(c);
    svg('path', { d: path(mean), style: { fill: 'none', stroke: 'var(--c-surface)', strokeWidth: 4.5, strokeLinejoin: 'round', opacity: 0.9 } }, s);
    svg('path', { d: path(mean), style: { fill: 'none', stroke: col, strokeWidth: 2.4, strokeLinejoin: 'round' } }, s);
    const over = svg('g', { 'pointer-events': 'none' }, s);
    const hit = svg('rect', { x: plot.x0, y: plot.y0, width: plot.x1 - plot.x0, height: plot.y1 - plot.y0, class: 'ekc-hit ekc-plot' }, s);
    p.geo = { x, y, plot, W, over, hit };
  }

  for (const p of panels) {
    const handler = (e) => {
      const { x, y, plot, W, over } = p.geo;
      const r = p.s.getBoundingClientRect();
      const px = clamp((e.clientX - r.left) * (W / (r.width || W)), plot.x0, plot.x1);
      const j = clamp(Math.round(((x.invert(px) + preMs) / 1000) * fs), 0, L - 1);
      const mean = means.get(p.c);
      over.replaceChildren();
      svg('line', { x1: x(tOf(j)), x2: x(tOf(j)), y1: plot.y0, y2: plot.y1, class: 'ekc-crosshair' }, over);
      svg('circle', { cx: x(tOf(j)), cy: y(mean[j]), r: 3.4, style: { fill: classColor(p.c), stroke: 'var(--c-surface)', strokeWidth: 1.5 } }, over);
      const syms = [...new Set(p.list.map((e2) => e2.symbol).filter(Boolean))].join(', ');
      tip.show(`<div class="ekc-tt-title">${tr('Klasse', 'Class')} ${esc(p.c)} · ${fmt(tOf(j), 0)} ms</div>${ttRow(tr('Mittel (Beispiele)', 'Mean (examples)'), `${fmt(mean[j], 3)} ${unit}`, classColor(p.c))}${ttRow(tr('Gezeigte Beats', 'Beats shown'), totalOf(p.c) != null ? tr(`${fmt(p.list.length)} von ${fmt(totalOf(p.c))}`, `${fmt(p.list.length)} of ${fmt(totalOf(p.c))}`) : fmt(p.list.length))}${syms ? ttRow(tr('MIT-BIH-Symbole', 'MIT-BIH symbols'), syms) : ''}`, e.clientX, e.clientY);
    };
    ls.on(p.s, 'pointermove', handler);
    ls.on(p.s, 'pointerdown', handler);
    ls.on(p.s, 'pointerleave', () => { tip.hide(); p.geo?.over.replaceChildren(); });
  }

  const stops = panels.map((p) => observeWidth(p.s.parentNode, (w) => drawPanel(p, Math.max(160, w - 20)), 220));
  return { destroy() { stops.forEach((f) => f()); ls.clear(); container.replaceChildren(); } };
}
