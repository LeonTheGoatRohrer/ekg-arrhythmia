// Magnitude response of the Butterworth band-pass in dB over a logarithmic
// frequency axis, cut-off frequencies, -3 dB reference line and hover readout.

import {
  svg, h, fmt, linear, logScale, clamp, axisLeft, makeRoot, createTooltip, ttRow,
  observeWidth, listeners, chip, isPending, renderMissingExport, nextId, note,
} from './shared.js';
import { tr } from '../lib/i18n.js';

const M = { top: 30, right: 18, bottom: 44, left: 54 };
const Y_MIN = -60;
const Y_MAX = 6;

export function renderFilterResponse(container, data, opts = {}) {
  const freqs = Array.isArray(data?.freqs) ? data.freqs : [];
  const g1 = Array.isArray(data?.gain_db) ? data.gain_db : [];
  const g2 = Array.isArray(data?.gain_db_zero_phase) ? data.gain_db_zero_phase : [];
  if (isPending(data) || freqs.length < 2 || (!g1.length && !g2.length)) {
    return renderMissingExport(container, opts, { title: tr('Frequenzgang noch nicht verfügbar', 'Frequency response not available yet'), file: 'filter_response.json', iconName: 'wave', name: 'filter-response' });
  }

  const low = Number(data.low);
  const high = Number(data.high);
  const order = data.order;
  // Points with f > 0 only (log axis).
  const pts = [];
  for (let i = 0; i < freqs.length; i++) if (freqs[i] > 0) pts.push(i);
  const fMin = Math.max(freqs[pts[0]], 0.05);
  const fMax = freqs[pts[pts.length - 1]];
  const series = [
    g2.length && { key: 'zp', label: tr('Effektiv (filtfilt, nullphasig)', 'Effective (filtfilt, zero-phase)'), arr: g2, color: 'var(--c-filtered)', width: 2.2, dash: null },
    g1.length && { key: 'ow', label: tr(`Butterworth einfach${order ? ` (Ordnung ${order})` : ''}`, `Butterworth single pass${order ? ` (order ${order})` : ''}`), arr: g1, color: 'var(--c-accent-2)', width: 1.5, dash: '5 4' },
  ].filter(Boolean);
  const visible = Object.fromEntries(series.map((s) => [s.key, true]));

  const ls = listeners();
  const root = makeRoot(container, { label: tr('Frequenzgang des Bandpass-Filters', 'Frequency response of the band-pass filter'), name: 'filter-response' });
  const bar = h('div', { class: 'ekc-toolbar' }, root);
  for (const s of series) chip(bar, { label: s.label, color: s.color, onToggle: (v) => { visible[s.key] = v; draw(); } });
  h('span', { class: 'ekc-spacer' }, bar);
  if (Number.isFinite(low) && Number.isFinite(high)) h('span', { class: 'ekc-badge ekc-num', text: tr(`Durchlass ${fmt(low, 1)}–${fmt(high, 0)} Hz`, `Passband ${fmt(low, 1)}–${fmt(high, 0)} Hz`) }, bar);

  const wrap = h('div', { style: { position: 'relative' } }, root);
  const clipId = nextId('fr-clip');
  const s = svg('svg', {
    role: 'img',
    'aria-label': tr(
      `Betragsgang des Bandpass-Filters in dB über der Frequenz (logarithmisch). Grenzfrequenzen ${fmt(low, 1)} Hz und ${fmt(high, 0)} Hz.`,
      `Magnitude response of the band-pass filter in dB over frequency (logarithmic). Cutoff frequencies ${fmt(low, 1)} Hz and ${fmt(high, 0)} Hz.`,
    ),
  }, wrap);
  const clipRect = svg('rect', {}, svg('clipPath', { id: clipId }, svg('defs', {}, s)));
  const gMain = svg('g', {}, s);
  const gOver = svg('g', { 'pointer-events': 'none' }, s);
  const hit = svg('rect', { class: 'ekc-hit ekc-plot', tabindex: 0, 'aria-label': tr('Frequenzgang. Pfeiltasten bewegen den Cursor.', 'Frequency response. Arrow keys move the cursor.') }, s);
  const tip = createTooltip(root);
  note(root, tr(
    'Butterworth-Filter haben an den Grenzfrequenzen −3 dB. Weil filtfilt vorwärts und rückwärts filtert, quadriert sich der Betrag: effektiv −6 dB an den Grenzen, dafür ohne Phasenverschiebung (R-Zacken bleiben zeitlich an ihrem Ort).',
    'Butterworth filters are at −3 dB at the cutoff frequencies. Because filtfilt filters forward and backward, the magnitude is squared: effectively −6 dB at the cutoffs, but without phase shift (R peaks stay in place in time).',
  ));

  let geo = null;
  let width = 0;
  let cursor = null;

  function layout(W) {
    width = W;
    const H = Math.round(clamp(W * 0.46, 240, 340));
    const plot = { x0: M.left, x1: W - M.right, y0: M.top, y1: H - M.bottom };
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    s.setAttribute('width', '100%');
    s.setAttribute('height', H);
    clipRect.setAttribute('x', plot.x0); clipRect.setAttribute('y', plot.y0);
    clipRect.setAttribute('width', plot.x1 - plot.x0); clipRect.setAttribute('height', plot.y1 - plot.y0);
    hit.setAttribute('x', plot.x0); hit.setAttribute('y', plot.y0);
    hit.setAttribute('width', plot.x1 - plot.x0); hit.setAttribute('height', plot.y1 - plot.y0);
    geo = { plot, x: logScale(fMin, fMax, plot.x0, plot.x1), y: linear(Y_MIN, Y_MAX, plot.y1, plot.y0) };
    draw();
  }

  function draw() {
    if (!geo) return;
    const { plot, x, y } = geo;
    gMain.replaceChildren();
    gOver.replaceChildren();
    const W = plot.x1 - plot.x0;

    // Passband shading
    if (Number.isFinite(low) && Number.isFinite(high)) {
      svg('rect', { x: x(Math.max(low, fMin)), y: plot.y0, width: Math.max(0, x(Math.min(high, fMax)) - x(Math.max(low, fMin))), height: plot.y1 - plot.y0, style: { fill: 'var(--c-accent)', fillOpacity: 0.07 } }, gMain);
    }
    // Log grid: decades (solid labels) + 2/5 labels, minor lines 1..9
    const ax = svg('g', { class: 'ekc-axis', 'aria-hidden': 'true' }, gMain);
    const e0 = Math.floor(Math.log10(fMin)), e1 = Math.ceil(Math.log10(fMax));
    const labelled = [];
    for (let e = e0; e <= e1; e++) {
      for (let m = 1; m <= 9; m++) {
        const f = m * 10 ** e;
        if (f < fMin * 0.999 || f > fMax * 1.001) continue;
        const px = x(f);
        svg('line', { x1: px, x2: px, y1: plot.y0, y2: plot.y1, class: m === 1 ? 'ekc-gridline' : 'ekc-gridline', style: { opacity: m === 1 ? 1 : 0.45 } }, ax);
        if (m === 1 || m === 2 || m === 5) labelled.push(f);
      }
    }
    const minLabelGap = 26;
    let lastPx = -Infinity;
    for (const f of labelled) {
      const px = x(f);
      if (px - lastPx < minLabelGap && !Number.isInteger(Math.log10(f))) continue;
      lastPx = px;
      svg('line', { x1: px, x2: px, y1: plot.y1, y2: plot.y1 + 4, class: 'ekc-axis-line' }, ax);
      svg('text', { x: px, y: plot.y1 + 17, 'text-anchor': 'middle', class: 'ekc-tick', text: fmt(f, f < 0.1 ? 2 : f < 1 ? 1 : 0) }, ax);
    }
    svg('line', { x1: plot.x0, x2: plot.x1, y1: plot.y1, y2: plot.y1, class: 'ekc-axis-line' }, ax);
    svg('text', { x: (plot.x0 + plot.x1) / 2, y: plot.y1 + 36, 'text-anchor': 'middle', class: 'ekc-axis-title', text: tr('Frequenz (Hz, logarithmisch)', 'Frequency (Hz, logarithmic)') }, ax);
    const yt = [];
    for (let v = 0; v >= Y_MIN; v -= 10) yt.push(v);
    axisLeft(gMain, y, yt, plot.x0, { format: (v) => fmt(v), title: tr('Verstärkung (dB)', 'Gain (dB)'), titleX: 14, gridRight: plot.x1, line: false });

    // -3 dB line
    svg('line', { x1: plot.x0, x2: plot.x1, y1: y(-3), y2: y(-3), style: { stroke: 'var(--c-text)', strokeOpacity: 0.45, strokeDasharray: '6 4', strokeWidth: 1 } }, gMain);
    svg('text', { x: plot.x1 - 4, y: y(-3) - 5, 'text-anchor': 'end', class: 'ekc-sublabel', style: { fontWeight: 600 }, text: '−3 dB' }, gMain);

    // Mains-hum marker (MIT-BIH was recorded in the US: 60 Hz)
    if (fMax >= 60 && W > 360) {
      const px = x(60);
      svg('line', { x1: px, x2: px, y1: y(-3) + 8, y2: plot.y1, style: { stroke: 'var(--c-muted)', strokeDasharray: '1 3', strokeWidth: 1.2 } }, gMain);
      // Label sits left of the marker near the bottom: that region (stop band, below -50 dB)
      // is free of both curves, so the text never collides with them.
      svg('text', { x: px - 5, y: plot.y1 - 8, 'text-anchor': 'end', class: 'ekc-sublabel', text: tr('60 Hz Netzbrummen', '60 Hz mains hum') }, gMain);
    }

    // Curves
    const cg = svg('g', { 'clip-path': `url(#${clipId})` }, gMain);
    for (const sr of series) {
      if (!visible[sr.key]) continue;
      let d = '';
      let started = false;
      for (const i of pts) {
        const v = clamp(sr.arr[i], Y_MIN - 20, Y_MAX + 20);
        d += `${started ? 'L' : 'M'}${x(freqs[i]).toFixed(1)},${y(v).toFixed(1)}`;
        started = true;
      }
      svg('path', { d, style: { fill: 'none', stroke: sr.color, strokeWidth: sr.width, strokeDasharray: sr.dash, strokeLinejoin: 'round' } }, cg);
    }

    // Cut-off markers
    for (const [f, lab] of [[low, tr('untere Grenzfrequenz', 'lower cutoff frequency')], [high, tr('obere Grenzfrequenz', 'upper cutoff frequency')]]) {
      if (!Number.isFinite(f) || f < fMin || f > fMax) continue;
      const px = x(f);
      svg('line', { x1: px, x2: px, y1: plot.y0 - 4, y2: plot.y1, style: { stroke: 'var(--c-accent)', strokeWidth: 1.3, strokeDasharray: '4 3' } }, gMain);
      const anchor = px < plot.x0 + 40 ? 'start' : px > plot.x1 - 40 ? 'end' : 'middle';
      const t = svg('text', { x: px, y: plot.y0 - 10, 'text-anchor': anchor, style: { fill: 'var(--c-accent)', fontSize: '11px', fontWeight: 600 }, text: `${fmt(f, f < 1 ? 1 : 0)} Hz` }, gMain);
      svg('title', { text: `${lab}: ${fmt(f, 2)} Hz` }, t);
    }
    if (cursor != null) showCursor(cursor);
  }

  function nearestIndex(f) {
    let best = pts[0];
    for (const i of pts) if (Math.abs(Math.log(freqs[i] / f)) < Math.abs(Math.log(freqs[best] / f))) best = i;
    return best;
  }

  function showCursor(k, clientX, clientY) {
    const { plot, x, y } = geo;
    const i = pts[clamp(k, 0, pts.length - 1)];
    const px = x(freqs[i]);
    gOver.replaceChildren();
    svg('line', { x1: px, x2: px, y1: plot.y0, y2: plot.y1, class: 'ekc-crosshair' }, gOver);
    const rows = [];
    for (const sr of series) {
      if (!visible[sr.key]) continue;
      const v = sr.arr[i];
      if (v >= Y_MIN && v <= Y_MAX) svg('circle', { cx: px, cy: y(v), r: 3.4, style: { fill: sr.color, stroke: 'var(--c-surface)', strokeWidth: 1.5 } }, gOver);
      rows.push(ttRow(sr.key === 'zp' ? tr('Effektiv', 'Effective') : tr('Einfach', 'Single pass'), v <= -199 ? '< −200 dB' : `${fmt(v, 1)} dB`, sr.color));
    }
    const html = `<div class="ekc-tt-title">f = ${fmt(freqs[i], freqs[i] < 10 ? 2 : 1)} Hz</div>${rows.join('')}`;
    if (clientX != null) tip.show(html, clientX, clientY);
    else { const r = s.getBoundingClientRect(); tip.show(html, r.left + px * (r.width / width), r.top + plot.y0 + 20); }
  }

  const toK = (clientX) => {
    const r = s.getBoundingClientRect();
    const px = clamp((clientX - r.left) * (width / (r.width || width)), geo.plot.x0, geo.plot.x1);
    return pts.indexOf(nearestIndex(geo.x.invert(px)));
  };
  ls.on(hit, 'pointermove', (e) => { cursor = null; showCursor(toK(e.clientX), e.clientX, e.clientY); });
  ls.on(hit, 'pointerdown', (e) => showCursor(toK(e.clientX), e.clientX, e.clientY));
  ls.on(hit, 'pointerleave', () => { if (cursor == null) { tip.hide(); gOver.replaceChildren(); } });
  ls.on(hit, 'keydown', (e) => {
    if (cursor == null) cursor = pts.indexOf(nearestIndex(Number.isFinite(high) ? high : fMax / 2));
    if (e.key === 'ArrowLeft') cursor -= e.shiftKey ? 10 : 1;
    else if (e.key === 'ArrowRight') cursor += e.shiftKey ? 10 : 1;
    else return;
    e.preventDefault();
    cursor = clamp(cursor, 0, pts.length - 1);
    showCursor(cursor);
  });
  ls.on(hit, 'focus', () => { cursor = pts.indexOf(nearestIndex(Number.isFinite(high) ? high : fMax / 2)); showCursor(cursor); });
  ls.on(hit, 'blur', () => { cursor = null; tip.hide(); gOver.replaceChildren(); });

  const stop = observeWidth(root, layout);
  return { destroy() { stop(); ls.clear(); container.replaceChildren(); } };
}
