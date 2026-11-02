// Training curve: train/val loss and validation macro-F1 over epochs, two
// vertically stacked panels sharing the epoch axis, best epoch highlighted.

import {
  svg, h, fmt, linear, niceTicks, niceDomain, clamp, axisBottom, axisLeft, makeRoot,
  createTooltip, ttRow, observeWidth, listeners, isPending, renderPendingFull, chip, tile, stepDigits,
} from './shared.js';

const M = { top: 22, right: 18, bottom: 40, left: 54 };

function toHistory(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.history)) return data.history;
  if (data && Array.isArray(data.cnn?.history)) return data.cnn.history;
  return null;
}

export function renderTrainingCurve(container, data, opts = {}) {
  const hist = toHistory(data);
  const rows = (hist || []).filter((r) => r && Number.isFinite(Number(r.epoch))).sort((a, b) => a.epoch - b.epoch);
  if (isPending(data) || rows.length < 1) {
    return renderPendingFull(container, data, opts, { title: 'Trainingsverlauf folgt nach dem Volltraining', iconName: 'clock', name: 'training' });
  }

  const has = (k) => rows.some((r) => Number.isFinite(r[k]));
  const lossSeries = [
    has('train_loss') && { key: 'train_loss', label: 'Trainings-Loss', color: 'var(--c-accent-2)', dash: null },
    has('val_loss') && { key: 'val_loss', label: 'Validierungs-Loss', color: 'var(--c-filtered)', dash: '5 4' },
  ].filter(Boolean);
  const hasF1 = has('val_macro_f1');
  const visible = { train_loss: true, val_loss: true, val_macro_f1: true };
  const e0 = rows[0].epoch, e1 = rows[rows.length - 1].epoch;
  const best = hasF1 ? rows.reduce((b, r) => (Number.isFinite(r.val_macro_f1) && r.val_macro_f1 > (b?.val_macro_f1 ?? -Infinity) ? r : b), null) : null;

  const ls = listeners();
  const root = makeRoot(container, { label: 'Trainingsverlauf des 1D-CNN', name: 'training' });
  const tiles = h('div', { class: 'ekc-tiles', style: { marginBottom: '12px' } }, root);
  tile(tiles, { label: 'Epochen', value: fmt(rows.length) });
  if (best) tile(tiles, { label: 'Bestes Val-Macro-F1', value: fmt(best.val_macro_f1, 3), sub: `Epoche ${fmt(best.epoch)}`, color: 'var(--c-accent)' });
  const last = rows[rows.length - 1];
  if (Number.isFinite(last.train_loss)) tile(tiles, { label: 'Letzter Train-Loss', value: fmt(last.train_loss, 3), color: 'var(--c-accent-2)' });
  if (Number.isFinite(last.val_loss)) tile(tiles, { label: 'Letzter Val-Loss', value: fmt(last.val_loss, 3), color: 'var(--c-filtered)' });

  const bar = h('div', { class: 'ekc-toolbar' }, root);
  for (const sr of lossSeries) chip(bar, { label: sr.label, color: sr.color, onToggle: (v) => { visible[sr.key] = v; draw(); } });
  if (hasF1) chip(bar, { label: 'Val-Macro-F1', color: 'var(--c-accent)', onToggle: (v) => { visible.val_macro_f1 = v; draw(); } });

  const wrap = h('div', { style: { position: 'relative' } }, root);
  const s = svg('svg', {
    role: 'img', style: { touchAction: 'pan-y' },
    'aria-label': `Trainingsverlauf über ${rows.length} Epochen${best ? `, bestes Validierungs-Macro-F1 ${fmt(best.val_macro_f1, 3)} in Epoche ${best.epoch}` : ''}.`,
  }, wrap);
  const gMain = svg('g', {}, s);
  const gOver = svg('g', { 'pointer-events': 'none' }, s);
  const hit = svg('rect', { class: 'ekc-hit ekc-plot', tabindex: 0, 'aria-label': 'Trainingskurven. Pfeiltasten wählen die Epoche.' }, s);
  const tip = createTooltip(root);

  let geo = null, width = 0, cursor = null;

  function layout(W) { width = W; draw(); }

  function draw() {
    const W = width;
    if (!W) return;
    const panelH = Math.round(clamp(W * 0.26, 140, 210));
    const gap = 44;
    const showF1 = hasF1 && visible.val_macro_f1;
    const H = M.top + panelH + (showF1 ? gap + panelH * 0.8 : 0) + M.bottom;
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    s.setAttribute('width', '100%');
    s.setAttribute('height', H);
    gMain.replaceChildren(); gOver.replaceChildren();
    const x0 = M.left, x1 = W - M.right;
    const x = e0 === e1 ? () => (x0 + x1) / 2 : linear(e0, e1, x0, x1);
    const p1 = { y0: M.top, y1: M.top + panelH };
    const p2 = showF1 ? { y0: p1.y1 + gap, y1: p1.y1 + gap + panelH * 0.8 } : null;

    // Loss panel
    const lossVals = rows.flatMap((r) => lossSeries.filter((sr) => visible[sr.key]).map((sr) => r[sr.key])).filter(Number.isFinite);
    const [l0, l1] = lossVals.length ? niceDomain(Math.min(0, ...lossVals), Math.max(...lossVals), 4) : [0, 1];
    const yL = linear(l0, l1, p1.y1, p1.y0);
    svg('text', { x: x0, y: p1.y0 - 9, class: 'ekc-label', text: 'Loss (gewichtete Kreuzentropie)' }, gMain);
    const lt = niceTicks(l0, l1, 4);
    axisLeft(gMain, yL, lt, x0, { format: (v) => fmt(v, stepDigits(lt.step)), gridRight: x1, line: false });
    const xt = niceTicks(e0, e1, Math.min(rows.length, Math.max(2, Math.round((x1 - x0) / 70)))).filter((t) => Number.isInteger(t));
    const pathOf = (key, y) => rows.filter((r) => Number.isFinite(r[key])).map((r, i) => `${i ? 'L' : 'M'}${x(r.epoch).toFixed(1)},${y(r[key]).toFixed(1)}`).join('');
    for (const sr of lossSeries) {
      if (!visible[sr.key]) continue;
      svg('path', { d: pathOf(sr.key, yL), style: { fill: 'none', stroke: sr.color, strokeWidth: 2, strokeDasharray: sr.dash, strokeLinejoin: 'round', strokeLinecap: 'round' } }, gMain);
      if (rows.length <= 40) for (const r of rows) if (Number.isFinite(r[sr.key])) svg('circle', { cx: x(r.epoch), cy: yL(r[sr.key]), r: 2.2, style: { fill: sr.color } }, gMain);
    }
    if (best) svg('line', { x1: x(best.epoch), x2: x(best.epoch), y1: p1.y0, y2: (p2 || p1).y1, style: { stroke: 'var(--c-accent)', strokeOpacity: 0.5, strokeDasharray: '2 3' } }, gMain);

    let yF = null;
    if (p2) {
      const f1v = rows.map((r) => r.val_macro_f1).filter(Number.isFinite);
      const top = Math.min(1, Math.ceil((Math.max(...f1v) + 0.05) * 10) / 10);
      yF = linear(0, top, p2.y1, p2.y0);
      svg('text', { x: x0, y: p2.y0 - 9, class: 'ekc-label', text: 'Validierungs-Macro-F1' }, gMain);
      axisLeft(gMain, yF, niceTicks(0, top, 3), x0, { format: (v) => fmt(v, 1), gridRight: x1, line: false });
      const d = pathOf('val_macro_f1', yF);
      const pts = rows.filter((r) => Number.isFinite(r.val_macro_f1));
      if (pts.length > 1) svg('path', { d: `${d}L${x(pts[pts.length - 1].epoch)},${yF(0)}L${x(pts[0].epoch)},${yF(0)}Z`, style: { fill: 'var(--c-accent)', fillOpacity: 0.09 } }, gMain);
      svg('path', { d, style: { fill: 'none', stroke: 'var(--c-accent)', strokeWidth: 2.2, strokeLinejoin: 'round' } }, gMain);
      if (best) {
        const bx = x(best.epoch), by = yF(best.val_macro_f1);
        svg('circle', { cx: bx, cy: by, r: 5, style: { fill: 'var(--c-accent)', stroke: 'var(--c-surface)', strokeWidth: 2 } }, gMain);
        const anchor = bx > x1 - 90 ? 'end' : 'start';
        svg('text', { x: bx + (anchor === 'end' ? -8 : 8), y: by - 8, 'text-anchor': anchor, style: { fill: 'var(--c-accent)', fontSize: '11px', fontWeight: 600 }, class: 'ekc-num', text: `Bestwert ${fmt(best.val_macro_f1, 3)} (Ep. ${best.epoch})` }, gMain);
      }
    }
    const bottom = (p2 || p1).y1;
    axisBottom(gMain, typeof x.invert === 'function' ? x : linear(e0 - 1, e1 + 1, x0, x1), xt, bottom, { format: (v) => fmt(v), title: 'Epoche', titleY: bottom + 32 });
    hit.setAttribute('x', x0); hit.setAttribute('y', p1.y0);
    hit.setAttribute('width', x1 - x0); hit.setAttribute('height', bottom - p1.y0);
    geo = { x, yL, yF, p1, p2, x0, x1, bottom };
    if (cursor != null) showCursor(cursor);
  }

  function showCursor(k, clientX, clientY) {
    const r = rows[clamp(k, 0, rows.length - 1)];
    const { x, yL, yF, p1, bottom } = geo;
    const px = x(r.epoch);
    gOver.replaceChildren();
    svg('line', { x1: px, x2: px, y1: p1.y0, y2: bottom, class: 'ekc-crosshair' }, gOver);
    const parts = [];
    for (const sr of lossSeries) {
      if (!visible[sr.key] || !Number.isFinite(r[sr.key])) continue;
      svg('circle', { cx: px, cy: yL(r[sr.key]), r: 3.8, style: { fill: sr.color, stroke: 'var(--c-surface)', strokeWidth: 1.5 } }, gOver);
      parts.push(ttRow(sr.label, fmt(r[sr.key], 4), sr.color));
    }
    if (yF && Number.isFinite(r.val_macro_f1)) {
      svg('circle', { cx: px, cy: yF(r.val_macro_f1), r: 3.8, style: { fill: 'var(--c-accent)', stroke: 'var(--c-surface)', strokeWidth: 1.5 } }, gOver);
      parts.push(ttRow('Val-Macro-F1', fmt(r.val_macro_f1, 4), 'var(--c-accent)'));
    }
    const html = `<div class="ekc-tt-title">Epoche ${fmt(r.epoch)}${best && best.epoch === r.epoch ? ' · Bestwert' : ''}</div>${parts.join('')}`;
    if (clientX != null) tip.show(html, clientX, clientY);
    else { const b = s.getBoundingClientRect(); tip.show(html, b.left + px * (b.width / width), b.top + p1.y0 + 10); }
  }
  const nearest = (clientX) => {
    const b = s.getBoundingClientRect();
    const px = (clientX - b.left) * (width / (b.width || width));
    let k = 0;
    rows.forEach((r, i) => { if (Math.abs(geo.x(r.epoch) - px) < Math.abs(geo.x(rows[k].epoch) - px)) k = i; });
    return k;
  };
  ls.on(hit, 'pointermove', (e) => { cursor = null; showCursor(nearest(e.clientX), e.clientX, e.clientY); });
  ls.on(hit, 'pointerdown', (e) => showCursor(nearest(e.clientX), e.clientX, e.clientY));
  ls.on(hit, 'pointerleave', () => { if (cursor == null) { tip.hide(); gOver.replaceChildren(); } });
  ls.on(hit, 'keydown', (e) => {
    if (cursor == null) cursor = best ? rows.indexOf(best) : rows.length - 1;
    else if (e.key === 'ArrowLeft') cursor -= 1;
    else if (e.key === 'ArrowRight') cursor += 1;
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    cursor = clamp(cursor, 0, rows.length - 1);
    showCursor(cursor);
  });
  ls.on(hit, 'blur', () => { cursor = null; tip.hide(); gOver.replaceChildren(); });

  const stop = observeWidth(root, layout);
  return { destroy() { stop(); ls.clear(); container.replaceChildren(); } };
}
