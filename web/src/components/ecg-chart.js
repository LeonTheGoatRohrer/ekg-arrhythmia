// ECG chart: raw vs. filtered signal on ECG paper, R-peak markers, AAMI-coloured
// annotation labels, hover crosshair, horizontal pan/zoom (overview brush, drag,
// ctrl/shift + wheel, keyboard).

import {
  svg, h, esc, fmt, fmtClock, linear, niceTicks, extent, clamp, seriesPath, axisBottom, axisLeft,
  makeRoot, createTooltip, ttRow, observeWidth, listeners, chip, iconButton, createBrush,
  isPending, renderMissingExport, classColor, CLASS_LABELS, CLASSES, nextId, note, exportText,
} from './shared.js';
import { tr } from '../lib/i18n.js';

const M = { top: 30, right: 14, bottom: 36, left: 50 };
const OVERVIEW_H = 46;
const OVERVIEW_GAP = 14;
const MIN_SPAN = 0.5; // seconds

export function renderEcgChart(container, data, opts = {}) {
  const raw = Array.isArray(data?.raw) ? data.raw : [];
  const filt = Array.isArray(data?.filtered) ? data.filtered : [];
  if (isPending(data) || (!raw.length && !filt.length)) {
    return renderMissingExport(container, opts, { title: tr('EKG-Signal noch nicht verfügbar', 'ECG signal not available yet'), file: 'signal_demo.json', iconName: 'pulse', name: 'ecg' });
  }

  const fs = Number(data.fs) || 360;
  const t0 = Number(data.start_s) || 0;
  const n = Math.max(raw.length, filt.length);
  const dur = n / fs;
  const peaks = (Array.isArray(data.r_peaks) ? data.r_peaks : []).filter((p) => p >= 0 && p < n).sort((a, b) => a - b);
  const anns = (Array.isArray(data.annotations) ? data.annotations : []).filter((a) => a && a.sample >= 0 && a.sample < n);
  const beatAnns = anns.filter((a) => a.aami);
  const record = data.record ?? '?';

  const show = { raw: raw.length > 0, filtered: filt.length > 0, peaks: peaks.length > 0, ann: anns.length > 0 };
  let view = null; // [a, b] in seconds relative to window start
  let width = 0;

  const ls = listeners();
  const root = makeRoot(container, { label: tr(`EKG-Signal Record ${record}`, `ECG signal, record ${record}`), name: 'ecg' });

  // --- Toolbar -------------------------------------------------------------
  const bar = h('div', { class: 'ekc-toolbar' }, root);
  const chips = h('div', { class: 'ekc-btngroup', role: 'group', 'aria-label': tr('Ebenen ein-/ausblenden', 'Show/hide layers'), style: { flexWrap: 'wrap', gap: '6px' } }, bar);
  if (raw.length) chip(chips, { label: tr('Rohsignal', 'Raw'), color: 'var(--c-raw)', pressed: show.raw, onToggle: (v) => { show.raw = v; draw(); } });
  if (filt.length) chip(chips, { label: tr('Gefiltert', 'Filtered'), color: 'var(--c-filtered)', pressed: show.filtered, onToggle: (v) => { show.filtered = v; draw(); } });
  if (peaks.length) chip(chips, { label: tr('R-Zacken', 'R peaks'), color: 'var(--c-peak)', dot: true, pressed: show.peaks, onToggle: (v) => { show.peaks = v; draw(); } });
  if (anns.length) chip(chips, { label: tr('Annotationen', 'Annotations'), color: 'var(--c-accent-2)', dot: true, pressed: show.ann, onToggle: (v) => { show.ann = v; draw(); } });
  h('span', { class: 'ekc-spacer' }, bar);
  const zoomGrp = h('div', { class: 'ekc-btngroup', role: 'group', 'aria-label': 'Zoom' }, bar);
  const viewLabel = h('span', { class: 'ekc-meta ekc-num', style: { marginRight: '4px' }, 'aria-live': 'polite' }, zoomGrp);
  iconButton(zoomGrp, { iconName: 'minus', label: tr('Herauszoomen', 'Zoom out'), onClick: () => zoom(1.6) });
  iconButton(zoomGrp, { iconName: 'plus', label: tr('Hineinzoomen', 'Zoom in'), onClick: () => zoom(1 / 1.6) });
  iconButton(zoomGrp, { iconName: 'reset', label: tr('Gesamtes Fenster anzeigen', 'Show entire window'), onClick: () => setView(0, dur) });

  // --- SVG skeleton (persistent nodes keep pointer capture during drags) ----
  const wrap = h('div', { style: { position: 'relative' } }, root);
  const clipId = nextId('ecg-clip');
  const s = svg('svg', { role: 'img', 'aria-label': describe(), style: { touchAction: 'pan-y' } }, wrap);
  const defs = svg('defs', {}, s);
  const clipRect = svg('rect', {}, svg('clipPath', { id: clipId }, defs));
  const gMain = svg('g', {}, s);
  const gOver = svg('g', { 'pointer-events': 'none' }, s);
  const hit = svg('rect', {
    class: 'ekc-hit ekc-plot', tabindex: 0, role: 'application',
    'aria-label': tr('EKG-Plot. Pfeiltasten: verschieben, Plus/Minus: zoomen, 0: alles anzeigen', 'ECG plot. Arrow keys: pan, plus/minus: zoom, 0: show all'),
  }, s);
  const gBrush = svg('g', {}, s);
  const tip = createTooltip(root);

  // Legend + source
  const foot = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center', marginTop: '8px' } }, root);
  const presentCls = CLASSES.filter((c) => beatAnns.some((a) => a.aami === c));
  if (presentCls.length) {
    const lg = h('div', { class: 'ekc-legend', 'aria-label': tr('AAMI-Klassen im Ausschnitt', 'AAMI classes in this window') }, foot);
    h('span', { text: tr('Annotationen:', 'Annotations:') }, lg);
    for (const c of presentCls) {
      const cnt = beatAnns.filter((a) => a.aami === c).length;
      h('span', { class: 'ekc-legend-item', html: `<i class="ekc-dot" style="--sw:${classColor(c)}"></i><b style="color:${classColor(c)}">${c}</b> ${esc(CLASS_LABELS[c])} <span class="ekc-num">(${cnt})</span>` }, lg);
    }
  }
  note(root, tr(
    `${data.source || `MIT-BIH Record ${record}`} · ${fmt(fs)} Hz · Fenster ab ${fmtClock(t0, 1)} min:s (${fmt(t0, 1)} s), ${fmt(dur, 1)} s lang. Ziehen oder Strg/Shift + Mausrad zum Verschieben/Zoomen.`,
    `${exportText(data.source) || `MIT-BIH record ${record}`} · ${fmt(fs)} Hz · window from ${fmtClock(t0, 1)} min:s (${fmt(t0, 1)} s), ${fmt(dur, 1)} s long. Drag or Ctrl/Shift + mouse wheel to pan/zoom.`,
  ));

  let geo = null;
  let brush = null;

  function describe() {
    const cls = CLASSES.map((c) => [c, beatAnns.filter((a) => a.aami === c).length]).filter(([, k]) => k).map(([c, k]) => `${k}× ${c}`).join(', ');
    return tr(
      `EKG, Record ${record}, ${fmt(dur, 1)} Sekunden ab ${fmt(t0, 1)} s, ${peaks.length} detektierte R-Zacken${cls ? `, Annotationen: ${cls}` : ''}.`,
      `ECG, record ${record}, ${fmt(dur, 1)} seconds from ${fmt(t0, 1)} s, ${peaks.length} detected R peaks${cls ? `, annotations: ${cls}` : ''}.`,
    );
  }

  function setView(a, b, fromBrush = false) {
    const span = clamp(b - a, Math.min(MIN_SPAN, dur), dur);
    a = clamp(a, 0, dur - span);
    view = [a, a + span];
    if (brush && !fromBrush) brush.set(view[0], view[1]);
    draw();
  }

  function zoom(factor, center) {
    const [a, b] = view;
    const c = center ?? (a + b) / 2;
    const span = clamp((b - a) * factor, Math.min(MIN_SPAN, dur), dur);
    const ratio = (c - a) / (b - a || 1);
    setView(c - span * ratio, c - span * ratio + span);
  }

  function layout(W) {
    width = W;
    const mainH = Math.round(clamp(W * 0.4, 220, 330));
    const plot = { x0: M.left, x1: W - M.right, y0: M.top, y1: mainH - M.bottom };
    const ovY = mainH + OVERVIEW_GAP;
    const H = ovY + OVERVIEW_H + 4;
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    s.setAttribute('width', '100%');
    s.setAttribute('height', H);
    clipRect.setAttribute('x', plot.x0); clipRect.setAttribute('y', plot.y0 - 22);
    clipRect.setAttribute('width', plot.x1 - plot.x0); clipRect.setAttribute('height', plot.y1 - plot.y0 + 22);
    hit.setAttribute('x', plot.x0); hit.setAttribute('y', plot.y0);
    hit.setAttribute('width', plot.x1 - plot.x0); hit.setAttribute('height', plot.y1 - plot.y0);
    geo = { plot, ovY, H };
    if (!view) {
      const span = Math.min(dur, Math.max(3, (plot.x1 - plot.x0) / 80));
      view = [0, span];
    }
    // Overview + brush
    gBrush.replaceChildren();
    const ovSeries = filt.length ? filt : raw;
    const [lo, hi] = extent([ovSeries]);
    const ox = linear(0, ovSeries.length, plot.x0, plot.x1);
    const oy = linear(lo, hi, ovY + OVERVIEW_H - 5, ovY + 5);
    svg('rect', { x: plot.x0, y: ovY, width: plot.x1 - plot.x0, height: OVERVIEW_H, rx: 6, style: { fill: 'var(--c-surface-2)', stroke: 'var(--c-border)' } }, gBrush);
    svg('path', { d: seriesPath(ovSeries, 0, ovSeries.length, ox, oy, plot.x1 - plot.x0), style: { fill: 'none', stroke: 'var(--c-muted)', strokeWidth: 1, opacity: 0.8 } }, gBrush);
    for (const p of peaks) svg('line', { x1: ox(p), x2: ox(p), y1: ovY + OVERVIEW_H - 4, y2: ovY + OVERVIEW_H - 1, style: { stroke: 'var(--c-peak)' } }, gBrush);
    brush = createBrush(gBrush, {
      x0: plot.x0, x1: plot.x1, y: ovY, height: OVERVIEW_H, domain: [0, dur], view, minSpan: Math.min(MIN_SPAN, dur),
      label: tr('Sichtbarer Zeitausschnitt', 'Visible time window'), onChange: (a, b) => setView(a, b, true),
    });
    draw();
  }

  function draw() {
    if (!geo) return;
    const { plot } = geo;
    gMain.replaceChildren();
    gOver.replaceChildren();
    const [a, b] = view;
    const i0 = Math.floor(a * fs), i1 = Math.ceil(b * fs) + 1;
    const x = linear(a, b, plot.x0, plot.x1);
    const xi = (i) => x(i / fs);

    // y-domain from visible series, aligned to 0.5 mV paper grid
    const vis = [show.raw && raw, show.filtered && filt].filter(Boolean);
    let [lo, hi] = extent(vis.length ? vis : [filt.length ? filt : raw], i0, i1);
    if (!Number.isFinite(lo)) { lo = -1; hi = 1; }
    const pad = Math.max(0.15, (hi - lo) * 0.08);
    lo = Math.floor((lo - pad) / 0.5) * 0.5;
    hi = Math.ceil((hi + pad) / 0.5) * 0.5;
    const y = linear(lo, hi, plot.y1, plot.y0);

    // ECG paper grid: minor 0.04 s / 0.1 mV, major 0.2 s / 0.5 mV (only when legible)
    const pxPerS = (plot.x1 - plot.x0) / (b - a);
    const pxPerMv = (plot.y1 - plot.y0) / (hi - lo);
    const grid = svg('g', { 'clip-path': `url(#${clipId})`, 'aria-hidden': 'true' }, gMain);
    const gridPath = (dt, dv) => {
      let d = '';
      if (dt) for (let t = Math.ceil(a / dt) * dt; t <= b + 1e-9; t += dt) { const px = Math.round(x(t)) + 0.5; d += `M${px},${plot.y0}V${plot.y1}`; }
      if (dv) for (let v = Math.ceil(lo / dv) * dv; v <= hi + 1e-9; v += dv) { const py = Math.round(y(v)) + 0.5; d += `M${plot.x0},${py}H${plot.x1}`; }
      return d;
    };
    const minorT = pxPerS * 0.04 >= 5 ? 0.04 : null;
    const minorV = pxPerMv * 0.1 >= 5 ? 0.1 : null;
    if (minorT || minorV) svg('path', { d: gridPath(minorT, minorV), style: { stroke: 'var(--c-grid)', strokeWidth: 0.7, fill: 'none' } }, grid);
    const majorT = pxPerS * 0.2 >= 7 ? 0.2 : 1;
    svg('path', { d: gridPath(majorT, 0.5), style: { stroke: 'var(--c-grid)', strokeWidth: 1.4, fill: 'none' } }, grid);
    svg('rect', { x: plot.x0, y: plot.y0, width: plot.x1 - plot.x0, height: plot.y1 - plot.y0, style: { fill: 'none', stroke: 'var(--c-border)' } }, grid);

    // Axes
    const xt = niceTicks(t0 + a, t0 + b, Math.max(3, Math.round((plot.x1 - plot.x0) / 90)));
    const xd = Math.max(0, Math.min(3, -Math.floor(Math.log10(xt.step || 1) + 1e-9)));
    const xAbs = linear(t0 + a, t0 + b, plot.x0, plot.x1);
    axisBottom(gMain, xAbs, xt, plot.y1, { format: (v) => fmtClock(v, xd), title: tr('Zeit im Record (min:s)', 'Time in record (min:s)'), titleY: plot.y1 + 31 });
    const yStep = pxPerMv * 0.5 >= 18 ? 0.5 : 1;
    const yt = [];
    for (let v = Math.ceil(lo / yStep) * yStep; v <= hi + 1e-9; v += yStep) yt.push(+v.toFixed(3));
    axisLeft(gMain, y, yt, plot.x0, { format: (v) => fmt(v, yStep < 1 ? 1 : 0), title: 'Amplitude (mV)', titleX: 13, line: false });

    // Signals
    const sig = svg('g', { 'clip-path': `url(#${clipId})` }, gMain);
    const W = plot.x1 - plot.x0;
    if (show.raw && raw.length) svg('path', { d: seriesPath(raw, i0, i1, xi, y, W), style: { fill: 'none', stroke: 'var(--c-raw)', strokeWidth: 1.1, strokeLinejoin: 'round' } }, sig);
    if (show.filtered && filt.length) svg('path', { d: seriesPath(filt, i0, i1, xi, y, W), style: { fill: 'none', stroke: 'var(--c-filtered)', strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round' } }, sig);

    // R-peak markers (on the filtered signal if shown, otherwise raw)
    const ref = show.filtered && filt.length ? filt : raw;
    if (show.peaks) {
      const g = svg('g', { class: 'ekc-peaks' }, sig);
      let d = '';
      for (const p of peaks) {
        if (p < i0 - 2 || p > i1 + 2) continue;
        const px = xi(p), py = y(ref[p] ?? 0) - 7;
        d += `M${px.toFixed(1)},${(py + 5).toFixed(1)}l-4.2,-7h8.4z`;
      }
      svg('path', { d, style: { fill: 'var(--c-peak)', stroke: 'var(--c-surface)', strokeWidth: 0.8 } }, g);
    }

    // Annotation labels in the top band
    if (show.ann) {
      const g = svg('g', {}, sig);
      const minGap = 14;
      let lastX = -Infinity;
      for (const an of anns) {
        if (an.sample < i0 || an.sample > i1) continue;
        const px = xi(an.sample);
        if (px - lastX < minGap) continue;
        lastX = px;
        const col = classColor(an.aami);
        const lg = svg('g', {}, g);
        svg('line', { x1: px, x2: px, y1: plot.y0 - 6, y2: plot.y0 + 2, style: { stroke: col, strokeWidth: 1, opacity: 0.7 } }, lg);
        const sym = String(an.symbol ?? '');
        const bw = Math.max(15, sym.length * 7 + 8);
        svg('rect', { x: px - bw / 2, y: plot.y0 - 22, width: bw, height: 16, rx: 5, style: { fill: col, fillOpacity: an.aami ? 0.16 : 0.08, stroke: col, strokeOpacity: 0.5 } }, lg);
        svg('text', { x: px, y: plot.y0 - 10.5, 'text-anchor': 'middle', style: { fill: col, fontSize: '10.5px', fontWeight: 700 }, text: sym }, lg);
        svg('title', { text: an.aami
          ? tr(`Annotation „${sym}“ → AAMI-Klasse ${an.aami} (${CLASS_LABELS[an.aami]})`, `Annotation "${sym}" → AAMI class ${an.aami} (${CLASS_LABELS[an.aami]})`)
          : tr(`Annotation „${sym}“ (kein Herzschlag)`, `Annotation "${sym}" (not a beat)`) }, lg);
      }
    }

    viewLabel.textContent = `${fmtClock(t0 + a, 1)}–${fmtClock(t0 + b, 1)}`;
    geo.x = x; geo.y = y;
  }

  // --- Interaction ---------------------------------------------------------
  function svgX(clientX) {
    const r = s.getBoundingClientRect();
    return (clientX - r.left) * (width / (r.width || width));
  }
  function crosshair(clientX, clientY) {
    if (!geo?.x) return;
    const { plot, x, y } = geo;
    const px = clamp(svgX(clientX), plot.x0, plot.x1);
    const t = x.invert(px);
    const i = clamp(Math.round(t * fs), 0, n - 1);
    gOver.replaceChildren();
    svg('line', { x1: xiOf(i), x2: xiOf(i), y1: plot.y0, y2: plot.y1, class: 'ekc-crosshair' }, gOver);
    const rows = [];
    if (show.raw && raw.length) { svg('circle', { cx: xiOf(i), cy: y(raw[i]), r: 3.2, style: { fill: 'var(--c-raw)', stroke: 'var(--c-surface)', strokeWidth: 1.5 } }, gOver); rows.push(ttRow(tr('Rohsignal', 'Raw'), `${fmt(raw[i], 3)} mV`, 'var(--c-raw)')); }
    if (show.filtered && filt.length) { svg('circle', { cx: xiOf(i), cy: y(filt[i]), r: 3.2, style: { fill: 'var(--c-filtered)', stroke: 'var(--c-surface)', strokeWidth: 1.5 } }, gOver); rows.push(ttRow(tr('Gefiltert', 'Filtered'), `${fmt(filt[i], 3)} mV`, 'var(--c-filtered)')); }
    // Nearest beat annotation within 200 ms
    let best = null;
    for (const an of beatAnns) { const d = Math.abs(an.sample - i); if (d <= 0.2 * fs && (!best || d < Math.abs(best.sample - i))) best = an; }
    if (best) rows.push(ttRow(tr(`Schlag „${best.symbol}“`, `Beat "${best.symbol}"`), `${best.aami} · ${CLASS_LABELS[best.aami] || ''}`, classColor(best.aami)));
    tip.show(`<div class="ekc-tt-title">t = ${fmtClock(t0 + i / fs, 3)} (min:s)</div>${rows.join('')}`, clientX, clientY);
  }
  const xiOf = (i) => geo.x(i / fs);

  let drag = null;
  ls.on(hit, 'pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, view: [...view], moved: false };
    hit.setPointerCapture?.(e.pointerId);
  });
  ls.on(hit, 'pointermove', (e) => {
    if (drag) {
      const dxPx = e.clientX - drag.x;
      if (Math.abs(dxPx) > 3) drag.moved = true;
      if (drag.moved) {
        hit.classList.add('is-dragging');
        const dt = (dxPx * (width / (s.getBoundingClientRect().width || width))) / (geo.plot.x1 - geo.plot.x0) * (drag.view[1] - drag.view[0]);
        setView(drag.view[0] - dt, drag.view[1] - dt);
        tip.hide(); gOver.replaceChildren();
        return;
      }
    }
    if (e.pointerType !== 'touch' || drag) crosshair(e.clientX, e.clientY);
  });
  const endDrag = () => { drag = null; hit.classList.remove('is-dragging'); };
  ls.on(hit, 'pointerup', endDrag);
  ls.on(hit, 'pointercancel', endDrag);
  ls.on(hit, 'pointerleave', () => { if (!drag) { tip.hide(); gOver.replaceChildren(); } });
  ls.on(hit, 'dblclick', () => setView(0, dur));
  ls.on(hit, 'wheel', (e) => {
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, geo.x.invert(svgX(e.clientX)));
    } else if (e.shiftKey || horizontal) {
      e.preventDefault();
      const delta = (horizontal ? e.deltaX : e.deltaY) / (geo.plot.x1 - geo.plot.x0) * (view[1] - view[0]);
      setView(view[0] + delta, view[1] + delta);
    }
  }, { passive: false });
  ls.on(hit, 'keydown', (e) => {
    const span = view[1] - view[0];
    if (e.key === 'ArrowLeft') setView(view[0] - span * 0.15, view[1] - span * 0.15);
    else if (e.key === 'ArrowRight') setView(view[0] + span * 0.15, view[1] + span * 0.15);
    else if (e.key === '+' || e.key === '=') zoom(1 / 1.4);
    else if (e.key === '-' || e.key === '_') zoom(1.4);
    else if (e.key === '0' || e.key === 'Home') setView(0, dur);
    else return;
    e.preventDefault();
  });
  ls.on(hit, 'focus', () => {
    if (!geo?.x) return;
    const r = hit.getBoundingClientRect();
    crosshair(r.left + r.width / 2, r.top + 20);
  });
  ls.on(hit, 'blur', () => { tip.hide(); gOver.replaceChildren(); });

  const stop = observeWidth(root, layout);

  return {
    destroy() {
      stop();
      ls.clear();
      container.replaceChildren();
    },
  };
}
