// Pan-Tompkins: stacked mini plots of the intermediate stages with a shared time
// axis, R-peak markers, synchronised crosshair, overview brush, and detection KPIs.

import {
  svg, h, fmt, fmtClock, fmtPct, fmtSig, linear, niceTicks, extent, clamp, seriesPath, axisBottom,
  makeRoot, createTooltip, ttRow, observeWidth, listeners, createBrush, isPending,
  renderMissingExport, nextId, tile, note,
} from './shared.js';
import { tr } from '../lib/i18n.js';

// title/desc are getters so they follow the current UI language at render time.
const STAGES = [
  { key: 'bandpassed', get title() { return tr('Bandpass 5–15 Hz', 'Band-pass 5–15 Hz'); }, get desc() { return tr('dämpft P-/T-Welle, Baseline und Muskelrauschen', 'attenuates P/T waves, baseline and muscle noise'); }, color: 'var(--c-accent-2)', signed: true },
  { key: 'derivative', get title() { return tr('Ableitung', 'Derivative'); }, get desc() { return tr('betont die steilen QRS-Flanken', 'emphasizes the steep QRS slopes'); }, color: 'var(--c-accent)', signed: true },
  { key: 'squared', get title() { return tr('Quadrierung', 'Squaring'); }, get desc() { return tr('macht alles positiv, verstärkt große Steigungen', 'makes everything positive, amplifies large slopes'); }, color: 'var(--c-filtered)', signed: false },
  { key: 'integrated', get title() { return tr('Gleitende Integration (150 ms)', 'Moving-window integration (150 ms)'); }, get desc() { return tr('Hüllkurve der QRS-Energie → Schwellwert-Detektion', 'envelope of the QRS energy → threshold detection'); }, color: 'var(--c-peak)', signed: false },
];

const M = { left: 14, right: 14, top: 4, bottom: 38 };
const HEAD = 20;
const GAP = 10;
const OVERVIEW_H = 34;

export function renderPanTompkins(container, data, opts = {}) {
  const stagesIn = data && typeof data === 'object' ? data.stages : null;
  const stages = STAGES.filter((st) => Array.isArray(stagesIn?.[st.key]) && stagesIn[st.key].length > 1);
  if (isPending(data) || !stages.length) {
    return renderMissingExport(container, opts, {
      title: tr('Pan-Tompkins-Stufen noch nicht verfügbar', 'Pan-Tompkins stages not available yet'), file: 'signal_demo.json', iconName: 'wave', name: 'pan-tompkins',
      text: isPending(data) ? undefined : tr('Die Datei enthält keine Zwischenstufen (stages). Sie werden beim Export aus Record 100 berechnet.', 'The file contains no intermediate stages (stages). They are computed from record 100 during export.'),
    });
  }

  const fs = Number(data.fs) || 360;
  const t0 = Number(data.start_s) || 0;
  const n = Math.max(...stages.map((st) => stagesIn[st.key].length));
  const dur = n / fs;
  const peaks = (Array.isArray(data.r_peaks) ? data.r_peaks : []).filter((p) => p >= 0 && p < n);
  const record = data.record ?? '?';

  const ls = listeners();
  const root = makeRoot(container, { label: tr(`Pan-Tompkins-Zwischenstufen, Record ${record}`, `Pan-Tompkins intermediate stages, record ${record}`), name: 'pan-tompkins' });
  const wrap = h('div', { style: { position: 'relative' } }, root);
  const clipBase = nextId('pt-clip');
  const s = svg('svg', {
    role: 'img', style: { touchAction: 'pan-y' },
    'aria-label': tr(
      `Pan-Tompkins-Verarbeitungsstufen (${stages.map((st) => st.title).join(', ')}) für Record ${record}, ${fmt(dur, 1)} s, ${peaks.length} detektierte R-Zacken.`,
      `Pan-Tompkins processing stages (${stages.map((st) => st.title).join(', ')}) for record ${record}, ${fmt(dur, 1)} s, ${peaks.length} detected R peaks.`,
    ),
  }, wrap);
  const defs = svg('defs', {}, s);
  const gMain = svg('g', {}, s);
  const gOver = svg('g', { 'pointer-events': 'none' }, s);
  const hit = svg('rect', { class: 'ekc-hit ekc-plot', tabindex: 0, 'aria-label': tr('Stufen-Plots. Pfeiltasten bewegen den Cursor.', 'Stage plots. Arrow keys move the cursor.') }, s);
  const gBrush = svg('g', {}, s);
  const tip = createTooltip(root);

  // Detection KPIs
  const det = data.detection && typeof data.detection === 'object' ? data.detection : null;
  if (det) {
    const box = h('div', { style: { marginTop: '14px' } }, root);
    const tiles = h('div', { class: 'ekc-tiles', role: 'list', 'aria-label': tr('R-Zacken-Detektion', 'R-peak detection') }, box);
    const items = [
      { label: tr('Treffer (TP)', 'Hits (TP)'), value: fmt(det.tp), color: 'var(--c-accent)' },
      { label: tr('Falsch-pos. (FP)', 'False pos. (FP)'), value: fmt(det.fp), color: 'var(--c-filtered)' },
      { label: tr('Verpasst (FN)', 'Missed (FN)'), value: fmt(det.fn), color: 'var(--c-peak)' },
      { label: tr('Sensitivität', 'Sensitivity'), value: fmtPct(det.sensitivity, 2), sub: 'TP / (TP + FN)' },
      { label: 'PPV', value: fmtPct(det.ppv, 2), sub: 'TP / (TP + FP)' },
    ];
    for (const it of items) tile(tiles, it).setAttribute('role', 'listitem');
    note(box, tr(
      `Gemessen auf Record ${record} gegen die Referenz-Annotationen der MIT-BIH-Datenbank (Toleranz ±${fmt(det.tol_ms ?? 150)} ms). Ein einzelner Record ist kein Benchmark für die gesamte Datenbank.`,
      `Measured on record ${record} against the MIT-BIH reference annotations (tolerance ±${fmt(det.tol_ms ?? 150)} ms). A single record is not a benchmark for the entire database.`,
    ));
  }

  let geo = null;
  let view = null;
  let width = 0;
  let brush = null;
  let cursor = null; // sample index for keyboard cursor

  function setView(a, b, fromBrush = false) {
    const span = clamp(b - a, Math.min(0.5, dur), dur);
    a = clamp(a, 0, dur - span);
    view = [a, a + span];
    if (brush && !fromBrush) brush.set(view[0], view[1]);
    draw();
  }

  function layout(W) {
    width = W;
    const rowH = Math.round(clamp(W * 0.1, 54, 82));
    const rows = stages.map((st, k) => {
      const top = M.top + k * (HEAD + rowH + GAP);
      return { ...st, y0: top + HEAD, y1: top + HEAD + rowH, top };
    });
    const plotBottom = rows[rows.length - 1].y1;
    const ovY = plotBottom + M.bottom + 6;
    const H = ovY + OVERVIEW_H + 2;
    const plot = { x0: M.left, x1: W - M.right, y0: rows[0].y0, y1: plotBottom };
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    s.setAttribute('width', '100%');
    s.setAttribute('height', H);
    hit.setAttribute('x', plot.x0); hit.setAttribute('y', rows[0].top);
    hit.setAttribute('width', plot.x1 - plot.x0); hit.setAttribute('height', plotBottom - rows[0].top);
    defs.replaceChildren();
    rows.forEach((r, k) => {
      r.clip = `${clipBase}-${k}`;
      svg('rect', { x: plot.x0, y: r.y0 - 1, width: plot.x1 - plot.x0, height: r.y1 - r.y0 + 2 }, svg('clipPath', { id: r.clip }, defs));
    });
    geo = { rows, plot, ovY };
    if (!view) view = [0, Math.min(dur, Math.max(3, (plot.x1 - plot.x0) / 80))];

    gBrush.replaceChildren();
    const last = stagesIn[stages[stages.length - 1].key];
    const [lo, hi] = extent([last]);
    const ox = linear(0, last.length, plot.x0, plot.x1);
    const oy = linear(lo, hi, ovY + OVERVIEW_H - 4, ovY + 4);
    svg('rect', { x: plot.x0, y: ovY, width: plot.x1 - plot.x0, height: OVERVIEW_H, rx: 6, style: { fill: 'var(--c-surface-2)', stroke: 'var(--c-border)' } }, gBrush);
    svg('path', { d: seriesPath(last, 0, last.length, ox, oy, plot.x1 - plot.x0), style: { fill: 'none', stroke: 'var(--c-muted)', strokeWidth: 1 } }, gBrush);
    brush = createBrush(gBrush, {
      x0: plot.x0, x1: plot.x1, y: ovY, height: OVERVIEW_H, domain: [0, dur], view, minSpan: Math.min(0.5, dur),
      label: tr('Sichtbarer Zeitausschnitt', 'Visible time window'), onChange: (a, b) => setView(a, b, true),
    });
    draw();
  }

  function draw() {
    if (!geo) return;
    const { rows, plot } = geo;
    gMain.replaceChildren();
    gOver.replaceChildren();
    const [a, b] = view;
    const i0 = Math.floor(a * fs), i1 = Math.ceil(b * fs) + 1;
    const x = linear(a, b, plot.x0, plot.x1);
    const xi = (i) => x(i / fs);
    const W = plot.x1 - plot.x0;

    rows.forEach((r, k) => {
      const arr = stagesIn[r.key];
      let [lo, hi] = extent([arr], i0, i1);
      if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
      if (r.signed) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; } else { lo = Math.min(0, lo); hi = hi || 1; }
      const pad = (hi - lo) * 0.08;
      const y = linear(lo - (r.signed ? pad : 0), hi + pad, r.y1, r.y0);
      r.y = y;
      const g = svg('g', {}, gMain);
      svg('rect', { x: plot.x0, y: r.y0, width: W, height: r.y1 - r.y0, rx: 6, style: { fill: 'var(--c-surface-2)', fillOpacity: 0.55, stroke: 'var(--c-border)' } }, g);
      if (r.signed) svg('line', { x1: plot.x0, x2: plot.x1, y1: y(0), y2: y(0), class: 'ekc-gridline' }, g);
      // header
      const head = svg('g', {}, g);
      svg('circle', { cx: plot.x0 + 8, cy: r.top + 9, r: 8, style: { fill: r.color, fillOpacity: 0.16 } }, head);
      svg('text', { x: plot.x0 + 8, y: r.top + 12.5, 'text-anchor': 'middle', style: { fill: r.color, fontSize: '10px', fontWeight: 700 }, text: String(STAGES.indexOf(STAGES.find((st) => st.key === r.key)) + 1) }, head);
      svg('text', { x: plot.x0 + 22, y: r.top + 13, class: 'ekc-label', text: r.title }, head);
      if (W > 420) svg('text', { x: plot.x1, y: r.top + 13, 'text-anchor': 'end', class: 'ekc-sublabel', text: r.desc }, head);
      // R markers
      const cg = svg('g', { 'clip-path': `url(#${r.clip})` }, g);
      let d = '';
      for (const p of peaks) if (p >= i0 && p <= i1) d += `M${xi(p).toFixed(1)},${r.y0}V${r.y1}`;
      if (d) svg('path', { d, style: { stroke: 'var(--c-peak)', strokeWidth: 1, strokeDasharray: '3 3', opacity: 0.6 } }, cg);
      // series
      svg('path', { d: seriesPath(arr, i0, i1, xi, y, W), style: { fill: r.signed ? 'none' : 'none', stroke: r.color, strokeWidth: 1.4, strokeLinejoin: 'round' } }, cg);
      if (!r.signed) {
        // soft area under unsigned stages
        const area = seriesPath(arr, i0, i1, xi, y, W);
        if (area) svg('path', { d: `${area}L${xi(Math.min(arr.length, i1) - 1).toFixed(1)},${y(0)}L${xi(Math.max(0, i0)).toFixed(1)},${y(0)}Z`, style: { fill: r.color, fillOpacity: 0.1, stroke: 'none' } }, cg);
      }
      if (k === rows.length - 1) {
        for (const p of peaks) if (p >= i0 && p <= i1) svg('circle', { cx: xi(p), cy: y(arr[p] ?? 0), r: 3, style: { fill: 'var(--c-peak)', stroke: 'var(--c-surface)', strokeWidth: 1.2 } }, cg);
      }
    });

    const xt = niceTicks(t0 + a, t0 + b, Math.max(3, Math.round(W / 90)));
    const xd = Math.max(0, Math.min(3, -Math.floor(Math.log10(xt.step || 1) + 1e-9)));
    axisBottom(gMain, linear(t0 + a, t0 + b, plot.x0, plot.x1), xt, plot.y1 + 2, { format: (v) => fmtClock(v, xd), title: tr('Zeit im Record (min:s) · gestrichelt: detektierte R-Zacken', 'Time in record (min:s) · dashed: detected R peaks'), titleY: plot.y1 + 33 });
    geo.x = x;
    if (cursor != null) showCursor(cursor);
  }

  function showCursor(i, clientX, clientY) {
    const { rows, plot, x } = geo;
    i = clamp(i, 0, n - 1);
    const px = x(i / fs);
    gOver.replaceChildren();
    if (px < plot.x0 || px > plot.x1) { tip.hide(); return; }
    const rowsHtml = [];
    for (const r of rows) {
      svg('line', { x1: px, x2: px, y1: r.y0, y2: r.y1, class: 'ekc-crosshair' }, gOver);
      const v = stagesIn[r.key][i];
      svg('circle', { cx: px, cy: r.y(v), r: 3, style: { fill: r.color, stroke: 'var(--c-surface)', strokeWidth: 1.2 } }, gOver);
      rowsHtml.push(ttRow(r.title, fmtSig(v, 3), r.color));
    }
    const near = peaks.find((p) => Math.abs(p - i) <= 0.05 * fs);
    if (near != null) rowsHtml.push(ttRow(tr('R-Zacke', 'R peak'), tr(`bei ${fmtClock(t0 + near / fs, 3)}`, `at ${fmtClock(t0 + near / fs, 3)}`), 'var(--c-peak)'));
    const html = `<div class="ekc-tt-title">t = ${fmtClock(t0 + i / fs, 3)} (min:s)</div>${rowsHtml.join('')}`;
    if (clientX != null) tip.show(html, clientX, clientY);
    else {
      const r = s.getBoundingClientRect();
      tip.show(html, r.left + px * (r.width / width), r.top + rows[0].y0);
    }
  }

  const toIndex = (clientX) => {
    const r = s.getBoundingClientRect();
    const px = (clientX - r.left) * (width / (r.width || width));
    return Math.round(geo.x.invert(clamp(px, geo.plot.x0, geo.plot.x1)) * fs);
  };
  ls.on(hit, 'pointermove', (e) => { cursor = null; showCursor(toIndex(e.clientX), e.clientX, e.clientY); });
  ls.on(hit, 'pointerdown', (e) => { if (e.pointerType === 'touch') showCursor(toIndex(e.clientX), e.clientX, e.clientY); });
  ls.on(hit, 'pointerleave', () => { if (cursor == null) { tip.hide(); gOver.replaceChildren(); } });
  ls.on(hit, 'wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
    e.preventDefault();
    const [a, b] = view;
    if (e.shiftKey) { const d = (e.deltaY / (geo.plot.x1 - geo.plot.x0)) * (b - a); setView(a + d, b + d); return; }
    const c = toIndex(e.clientX) / fs, f = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const span = clamp((b - a) * f, 0.5, dur), ratio = (c - a) / (b - a);
    setView(c - span * ratio, c - span * ratio + span);
  }, { passive: false });
  ls.on(hit, 'keydown', (e) => {
    if (cursor == null) cursor = Math.round(((view[0] + view[1]) / 2) * fs);
    const step = Math.max(1, Math.round(fs * 0.02));
    if (e.key === 'ArrowLeft') cursor -= e.shiftKey ? step * 10 : step;
    else if (e.key === 'ArrowRight') cursor += e.shiftKey ? step * 10 : step;
    else return;
    e.preventDefault();
    cursor = clamp(cursor, 0, n - 1);
    const t = cursor / fs;
    if (t < view[0] || t > view[1]) { const span = view[1] - view[0]; setView(t - span / 2, t + span / 2); } else showCursor(cursor);
  });
  ls.on(hit, 'blur', () => { cursor = null; tip.hide(); gOver.replaceChildren(); });

  const stop = observeWidth(root, layout);
  return {
    destroy() { stop(); ls.clear(); container.replaceChildren(); },
  };
}
