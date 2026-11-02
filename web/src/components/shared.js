// Shared helpers for the hand-written SVG chart components (no chart library).
// Colours are applied exclusively through CSS custom properties (var(--c-…)) so
// light/dark switching works without re-rendering.

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const CLASSES = ['N', 'S', 'V', 'F', 'Q'];
export const CLASS_LABELS = {
  N: 'Normal',
  S: 'Supraventrikulär ektop',
  V: 'Ventrikulär ektop',
  F: 'Fusion',
  Q: 'Unklassifizierbar',
};

export const PENDING_TEXT =
  'Wird nach dem Volltraining auf der vollständigen MIT-BIH-Datenbank erzeugt (physionet.org aktuell nicht erreichbar).';

/** Colour token for an AAMI class (unknown / non-beat -> muted). */
export function classColor(cls) {
  return CLASSES.includes(cls) ? `var(--c-cls-${cls})` : 'var(--c-muted)';
}

// ---------------------------------------------------------------------------
// DOM / SVG creation

/** Apply a style object; custom properties (--x) need setProperty. */
export function setStyle(node, styles) {
  for (const [k, v] of Object.entries(styles)) {
    if (v == null) continue;
    if (k.startsWith('--')) node.style.setProperty(k, String(v));
    else node.style[k] = v;
  }
}

/** Create an SVG element with attributes (style object supported) and optional parent. */
export function svg(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') setStyle(node, v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'class') node.setAttribute('class', v);
    else node.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(node);
  return node;
}

/** Create an HTML element with attributes, optional innerHTML/text and parent. */
export function h(tag, attrs = {}, parent = null) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') setStyle(node, v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, String(v));
  }
  if (parent) parent.appendChild(node);
  return node;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** <title> child for native SVG tooltips / accessible names. */
export function svgTitle(parent, text) {
  return svg('title', { text }, parent);
}

// ---------------------------------------------------------------------------
// Number formatting (German)

const nfCache = new Map();
function nf(digits) {
  const key = digits == null ? 'auto' : digits;
  if (!nfCache.has(key)) {
    nfCache.set(key, digits == null
      ? new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 })
      : new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  }
  return nfCache.get(key);
}

export function fmt(n, digits) {
  if (n == null || !Number.isFinite(Number(n))) return '–';
  return nf(digits).format(Number(n)).replace('-', '−');
}

/**
 * Recording time as min:s (e.g. 1514.25 s -> "25:14,25"). Long recordings read far better
 * this way than as "1.514" seconds, which German readers parse as a thousands separator.
 */
export function fmtClock(sec, digits = 0) {
  if (sec == null || !Number.isFinite(Number(sec))) return '–';
  const v = Number(sec);
  const sign = v < 0 ? '−' : '';
  const scale = 10 ** digits;
  const total = Math.round(Math.abs(v) * scale) / scale;
  const m = Math.floor(total / 60);
  const rest = total - m * 60;
  const [int, frac] = rest.toFixed(digits).split('.');
  return `${sign}${m}:${int.padStart(2, '0')}${frac ? ',' + frac : ''}`;
}

export function fmtPct(x, digits = 1) {
  if (x == null || !Number.isFinite(Number(x))) return '–';
  return `${fmt(Number(x) * 100, digits)} %`;
}

/** Compact significant-digit formatting (thresholds, a.u. values). */
export function fmtSig(n, sig = 3) {
  if (n == null || !Number.isFinite(Number(n))) return '–';
  const v = Number(n);
  if (v === 0) return '0';
  const mag = Math.floor(Math.log10(Math.abs(v)));
  const digits = Math.max(0, Math.min(6, sig - 1 - mag));
  return fmt(v, digits);
}

/** Pick fraction digits so tick labels at a given step are distinct. */
export function stepDigits(step) {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
}

// ---------------------------------------------------------------------------
// Scales & ticks

export function linear(d0, d1, r0, r1) {
  const span = d1 - d0 || 1;
  const f = (v) => r0 + ((v - d0) / span) * (r1 - r0);
  f.invert = (p) => d0 + ((p - r0) / (r1 - r0 || 1)) * span;
  f.domain = [d0, d1];
  f.range = [r0, r1];
  return f;
}

export function logScale(d0, d1, r0, r1) {
  const l0 = Math.log10(d0), l1 = Math.log10(d1);
  const f = (v) => r0 + ((Math.log10(Math.max(v, 1e-12)) - l0) / (l1 - l0 || 1)) * (r1 - r0);
  f.invert = (p) => 10 ** (l0 + ((p - r0) / (r1 - r0 || 1)) * (l1 - l0));
  f.domain = [d0, d1];
  f.range = [r0, r1];
  return f;
}

/** "Nice" step for roughly `count` intervals. */
export function niceStep(span, count = 5) {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, count);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m >= 7.5 ? 10 : m >= 3.5 ? 5 : m >= 1.5 ? 2 : 1) * p;
}

export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const step = niceStep(max - min, count);
  const out = [];
  const start = Math.ceil(min / step - 1e-9) * step;
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toFixed(12));
  out.step = step;
  return out;
}

/** Expand [min,max] to nice bounds with optional padding fraction. */
export function niceDomain(min, max, count = 5, pad = 0) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { min -= 1; max += 1; }
  const p = (max - min) * pad;
  min -= p; max += p;
  const step = niceStep(max - min, count);
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

export function extent(arrays, i0 = 0, i1 = Infinity) {
  let lo = Infinity, hi = -Infinity;
  for (const a of arrays) {
    if (!a) continue;
    const end = Math.min(a.length, i1);
    for (let i = Math.max(0, i0); i < end; i++) {
      const v = a[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return [lo, hi];
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * SVG path for a uniformly sampled series between indices [i0, i1).
 * Uses min/max decimation when there are more samples than pixels.
 */
export function seriesPath(arr, i0, i1, xOf, yOf, pxWidth) {
  i0 = Math.max(0, Math.floor(i0));
  i1 = Math.min(arr.length, Math.ceil(i1));
  const n = i1 - i0;
  if (n < 2) return '';
  const parts = [];
  const bucket = n / Math.max(1, pxWidth);
  if (bucket <= 2) {
    for (let i = i0; i < i1; i++) parts.push(`${i === i0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(arr[i]).toFixed(1)}`);
    return parts.join('');
  }
  const step = Math.ceil(bucket);
  for (let s = i0; s < i1; s += step) {
    let lo = Infinity, hi = -Infinity, ilo = s, ihi = s;
    for (let i = s; i < Math.min(i1, s + step); i++) {
      if (arr[i] < lo) { lo = arr[i]; ilo = i; }
      if (arr[i] > hi) { hi = arr[i]; ihi = i; }
    }
    const [a, b] = ilo < ihi ? [ilo, ihi] : [ihi, ilo];
    parts.push(`${parts.length ? 'L' : 'M'}${xOf(a).toFixed(1)},${yOf(arr[a]).toFixed(1)}`);
    parts.push(`L${xOf(b).toFixed(1)},${yOf(arr[b]).toFixed(1)}`);
  }
  return parts.join('');
}

// ---------------------------------------------------------------------------
// Axes

/**
 * Draw a horizontal (bottom) axis.
 * @param {SVGElement} g parent
 * @param {Function} scale x scale
 * @param {number[]} ticks
 * @param {number} y baseline
 * @param {object} o { format, gridTop, title, titleY, tickSize }
 */
export function axisBottom(g, scale, ticks, y, o = {}) {
  const ax = svg('g', { class: 'ekc-axis', 'aria-hidden': 'true' }, g);
  const format = o.format || ((v) => fmt(v));
  const [r0, r1] = scale.range;
  svg('line', { x1: Math.min(r0, r1), x2: Math.max(r0, r1), y1: y, y2: y, class: 'ekc-axis-line' }, ax);
  for (const t of ticks) {
    const x = scale(t);
    if (o.gridTop != null) svg('line', { x1: x, x2: x, y1: o.gridTop, y2: y, class: 'ekc-gridline' }, ax);
    svg('line', { x1: x, x2: x, y1: y, y2: y + (o.tickSize ?? 4), class: 'ekc-axis-line' }, ax);
    svg('text', { x, y: y + 16, 'text-anchor': 'middle', class: 'ekc-tick', text: format(t) }, ax);
  }
  if (o.title) {
    svg('text', { x: (r0 + r1) / 2, y: o.titleY ?? y + 34, 'text-anchor': 'middle', class: 'ekc-axis-title', text: o.title }, ax);
  }
  return ax;
}

/** Draw a vertical axis (left by default, `right: true` for right side). */
export function axisLeft(g, scale, ticks, x, o = {}) {
  const ax = svg('g', { class: 'ekc-axis', 'aria-hidden': 'true' }, g);
  const format = o.format || ((v) => fmt(v));
  const right = !!o.right;
  const [r0, r1] = scale.range;
  if (o.line !== false) svg('line', { x1: x, x2: x, y1: Math.min(r0, r1), y2: Math.max(r0, r1), class: 'ekc-axis-line' }, ax);
  for (const t of ticks) {
    const y = scale(t);
    if (o.gridRight != null) svg('line', { x1: Math.min(x, o.gridRight), x2: Math.max(x, o.gridRight), y1: y, y2: y, class: 'ekc-gridline' }, ax);
    svg('text', {
      x: right ? x + 7 : x - 7, y: y + 3.5, 'text-anchor': right ? 'start' : 'end', class: 'ekc-tick', text: format(t),
    }, ax);
  }
  if (o.title) {
    const tx = o.titleX ?? (right ? x + 44 : x - 44);
    const ty = (r0 + r1) / 2;
    svg('text', {
      x: tx, y: ty, transform: `rotate(${right ? 90 : -90} ${tx} ${ty})`, 'text-anchor': 'middle', class: 'ekc-axis-title', text: o.title,
    }, ax);
  }
  return ax;
}

// ---------------------------------------------------------------------------
// Root, styles, empty state, tooltip, resize

const STYLE_ID = 'ekc-styles';
const CSS = `
.ekc{position:relative;min-width:0;color:var(--c-text);font-size:13px;line-height:1.4;-webkit-tap-highlight-color:transparent}
.ekc *{box-sizing:border-box}
.ekc svg{display:block;max-width:none;overflow:visible;font-family:inherit}
.ekc-num,.ekc .ekc-tick{font-variant-numeric:tabular-nums}
.ekc-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-bottom:10px}
.ekc-spacer{flex:1 1 auto}
.ekc-chip{display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 11px;border-radius:999px;border:1px solid var(--c-border);background:var(--c-surface);color:var(--c-muted);font:inherit;font-size:12px;font-weight:500;cursor:pointer;user-select:none;transition:color .15s,background-color .15s,border-color .15s}
.ekc-chip:hover{color:var(--c-text);background:var(--c-surface-2)}
.ekc-chip:disabled{opacity:.5;cursor:default}
.ekc-chip[aria-pressed="true"]{color:var(--c-text);background:var(--c-surface-2);border-color:color-mix(in srgb,var(--sw,var(--c-accent)) 45%,var(--c-border))}
.ekc-sw{display:inline-block;width:12px;height:3px;border-radius:2px;background:var(--sw,var(--c-accent));transition:opacity .15s}
.ekc-sw-dot{width:8px;height:8px;border-radius:999px}
.ekc-chip[aria-pressed="false"] .ekc-sw{opacity:.25}
.ekc-iconbtn{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:8px;border:1px solid var(--c-border);background:var(--c-surface);color:var(--c-muted);cursor:pointer;font:inherit;transition:color .15s,background-color .15s}
.ekc-iconbtn:hover{color:var(--c-text);background:var(--c-surface-2)}
.ekc-iconbtn:disabled{opacity:.4;cursor:default}
.ekc-btngroup{display:inline-flex;gap:4px;align-items:center}
.ekc-meta{font-size:11.5px;color:var(--c-muted)}
.ekc-mono{font-family:var(--font-mono,ui-monospace,monospace);font-size:.92em}
.ekc :focus-visible{outline:2px solid var(--c-accent);outline-offset:2px}
.ekc svg :focus{outline:none}
.ekc svg :focus-visible .ekc-focus{opacity:1}
.ekc-focus{opacity:0;fill:none;stroke:var(--c-accent);stroke-width:2;pointer-events:none}
.ekc-axis-line{stroke:var(--c-border);stroke-width:1;shape-rendering:crispEdges}
.ekc-gridline{stroke:var(--c-border);stroke-width:1;stroke-dasharray:2 3;shape-rendering:crispEdges}
.ekc-tick{fill:var(--c-muted);font-size:11px}
.ekc-axis-title{fill:var(--c-muted);font-size:11px;font-weight:500}
.ekc-label{fill:var(--c-text);font-size:11.5px;font-weight:600}
.ekc-sublabel{fill:var(--c-muted);font-size:10.5px}
.ekc-crosshair{stroke:var(--c-text);stroke-opacity:.35;stroke-width:1;stroke-dasharray:3 3;pointer-events:none;shape-rendering:crispEdges}
.ekc-hit{fill:transparent}
.ekc-tooltip{position:absolute;left:0;top:0;z-index:20;pointer-events:none;min-width:140px;max-width:280px;padding:8px 10px;border-radius:9px;background:var(--c-surface);color:var(--c-text);border:1px solid var(--c-border);box-shadow:0 12px 28px -14px color-mix(in srgb,var(--c-muted) 55%,transparent);font-size:12px;line-height:1.45;opacity:0;transform:translateY(3px);transition:opacity .12s ease,transform .12s ease;font-variant-numeric:tabular-nums}
.ekc-tooltip.is-on{opacity:1;transform:none}
.ekc-tt-title{font-weight:600;margin-bottom:3px}
.ekc-tt-row{display:flex;align-items:center;justify-content:space-between;gap:14px;white-space:nowrap}
.ekc-tt-row>span:first-child{display:inline-flex;align-items:center;gap:6px;color:var(--c-muted)}
.ekc-tt-row>span:last-child{font-weight:500}
.ekc-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;min-height:220px;padding:36px 22px;border:1px dashed var(--c-border);border-radius:14px;background:color-mix(in srgb,var(--c-surface-2) 45%,transparent)}
.ekc-empty-icon{display:grid;place-items:center;width:46px;height:46px;border-radius:13px;background:var(--c-surface);border:1px solid var(--c-border);color:var(--c-accent);box-shadow:0 1px 2px color-mix(in srgb,var(--c-muted) 15%,transparent)}
.ekc-empty-title{font-size:14.5px;font-weight:600;color:var(--c-text);letter-spacing:-.005em}
.ekc-empty-text{max-width:52ch;font-size:13px;line-height:1.6;color:var(--c-muted)}
.ekc-empty-detail{max-width:64ch;margin-top:6px;padding:10px 12px;font-size:12px;line-height:1.65;text-align:left;color:var(--c-muted);background:var(--c-surface);border:1px solid var(--c-border);border-radius:10px;overflow-wrap:anywhere}.ekc-empty-detail code{font-family:'JetBrains Mono Variable',ui-monospace,monospace;font-size:11px;color:var(--c-text);background:var(--c-surface-2);border:1px solid var(--c-border);border-radius:5px;padding:0 4px;white-space:nowrap}
.ekc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}
.ekc-tile{padding:10px 12px;border:1px solid var(--c-border);border-radius:11px;background:var(--c-surface);min-width:0}
.ekc-tile-label{font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--c-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ekc-tile-value{margin-top:2px;font-size:20px;font-weight:650;letter-spacing:-.015em;font-variant-numeric:tabular-nums;color:var(--c-text)}
.ekc-tile-sub{font-size:11px;color:var(--c-muted)}
.ekc-note{display:flex;align-items:flex-start;gap:8px;margin-top:10px;font-size:12px;line-height:1.5;color:var(--c-muted)}
.ekc-note svg{flex:none;margin-top:1px;color:var(--c-accent)}
.ekc-legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--c-muted)}
.ekc-legend-item{display:inline-flex;align-items:center;gap:6px}
.ekc-scroll{overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin;-webkit-overflow-scrolling:touch}
.ekc-table{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
.ekc-table th{padding:6px 8px;text-align:right;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--c-muted);border-bottom:1px solid var(--c-border);white-space:nowrap}
.ekc-table td{padding:6px 8px;text-align:right;border-bottom:1px solid color-mix(in srgb,var(--c-border) 60%,transparent);white-space:nowrap}
.ekc-table th:first-child,.ekc-table td:first-child{text-align:left}
.ekc-table tr:last-child td{border-bottom:0}
.ekc-dot{display:inline-block;width:8px;height:8px;border-radius:999px;background:var(--sw,var(--c-muted));flex:none}
.ekc-badge{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:600;border:1px solid var(--c-border);background:var(--c-surface-2);color:var(--c-muted);white-space:nowrap}
.ekc-plot{touch-action:pan-y;cursor:crosshair}
.ekc-plot.is-dragging{cursor:grabbing}
.ekc-brush-win{fill:var(--c-accent);fill-opacity:.1;stroke:var(--c-accent);stroke-width:1.25;cursor:grab}
.ekc-brush-win:hover{fill-opacity:.16}
.ekc-brush-handle{fill:var(--c-surface);stroke:var(--c-accent);stroke-width:1.25;cursor:ew-resize}
.ekc-brush-shade{fill:var(--c-bg);fill-opacity:.55;pointer-events:none}
.ekc-fade-in{animation:ekc-fade .28s ease both}
@keyframes ekc-fade{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:none}}
.ekc-fade-svg{animation:ekc-fade-op .25s ease both}
@keyframes ekc-fade-op{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.ekc *{animation:none!important;transition:none!important}}
`;

export function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/** Create the component root inside `container` (replacing previous content). */
export function makeRoot(container, { label, name } = {}) {
  ensureStyles();
  container.replaceChildren();
  const root = h('div', { class: `ekc ekc-${name || 'chart'}`, role: 'figure', 'aria-label': label || null }, container);
  return root;
}

const ICON_PATHS = {
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  tree: '<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v4M5 17v-3h14v3"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  wave: '<path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  expand: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  collapse: '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>',
};

export function icon(name, size = 16) {
  return `<svg xmlns="${SVG_NS}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ICON_PATHS.info}</svg>`;
}

/** True when the payload should be shown as an empty state. */
export function isPending(data) {
  return data == null || (typeof data === 'object' && !Array.isArray(data) && data.status === 'pending');
}

/** Reason string from data or the raw file (opts.raw), if any. */
export function pendingReason(data, opts) {
  const r = (data && typeof data === 'object' && data.reason) || (opts?.raw && typeof opts.raw === 'object' && opts.raw.reason);
  return typeof r === 'string' && r.trim() ? r.trim() : '';
}

/**
 * Render an empty state into `container`.
 * @returns {{destroy(): void}}
 */
export function renderEmpty(container, { title, text, detail, iconName = 'chart', name = 'empty', label } = {}) {
  const root = makeRoot(container, { label: label || title, name });
  root.setAttribute('role', 'status');
  const box = h('div', { class: 'ekc-empty ekc-fade-in' }, root);
  h('div', { class: 'ekc-empty-icon', html: icon(iconName, 22) }, box);
  h('div', { class: 'ekc-empty-title', text: title || 'Noch keine Daten' }, box);
  if (text) h('p', { class: 'ekc-empty-text', text }, box);
  if (detail && detail !== text) {
    // `code` spans in the pipeline's reason text become <code> elements (built as DOM nodes,
    // so the text itself is never interpreted as HTML).
    const p = h('p', { class: 'ekc-empty-detail' }, box);
    String(detail).split('`').forEach((part, i) => {
      if (!part) return;
      if (i % 2) h('code', { text: part }, p);
      else p.appendChild(document.createTextNode(part));
    });
  }
  return { destroy() { container.replaceChildren(); } };
}

/** Empty state for data that is produced by the full-database training (pending). */
export function renderPendingFull(container, data, opts, { title, iconName, name }) {
  return renderEmpty(container, {
    title,
    text: PENDING_TEXT,
    detail: pendingReason(data, opts) ? `Status: ${pendingReason(data, opts)}` : '',
    iconName,
    name,
  });
}

/** Empty state for a pipeline export that has not been produced yet. */
export function renderMissingExport(container, opts, { title, file, iconName, name, text }) {
  return renderEmpty(container, {
    title,
    text: text || `Die Datei ${opts?.dataFile || file} wurde noch nicht von der Pipeline exportiert. Sie wird aus dem echten MIT-BIH-Record 100 berechnet.`,
    iconName,
    name,
  });
}

/** Floating tooltip positioned relative to `root`. */
export function createTooltip(root) {
  const tip = h('div', { class: 'ekc-tooltip', role: 'presentation', 'aria-hidden': 'true' }, root);
  return {
    el: tip,
    show(html, clientX, clientY) {
      tip.innerHTML = html;
      const rb = root.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = clientX - rb.left + 14;
      let y = clientY - rb.top - th - 12;
      if (x + tw > rb.width) x = clientX - rb.left - tw - 14;
      if (x < 0) x = Math.max(0, Math.min(rb.width - tw, clientX - rb.left - tw / 2));
      if (y < 0) y = clientY - rb.top + 16;
      tip.style.transform = '';
      tip.style.left = `${Math.round(x)}px`;
      tip.style.top = `${Math.round(y)}px`;
      tip.classList.add('is-on');
    },
    /** Position at an element (keyboard focus). */
    showAt(html, element) {
      const r = element.getBoundingClientRect();
      this.show(html, r.left + r.width / 2, r.top);
    },
    hide() { tip.classList.remove('is-on'); },
    destroy() { tip.remove(); },
  };
}

export function ttRow(label, value, color) {
  const sw = color ? `<i class="ekc-dot" style="--sw:${color}"></i>` : '';
  return `<div class="ekc-tt-row"><span>${sw}${esc(label)}</span><span>${esc(value)}</span></div>`;
}

/**
 * Call `cb(width)` now and whenever the element's content width changes
 * (rounded, rAF-throttled). Returns a disconnect function.
 */
export function observeWidth(el, cb, fallback = 640) {
  let last = -1, raf = 0;
  const measure = () => {
    raf = 0;
    const w = Math.round(el.clientWidth || el.getBoundingClientRect().width || fallback);
    if (w > 0 && w !== last) { last = w; cb(w); }
  };
  measure();
  if (last < 0) { last = fallback; cb(fallback); }
  if (typeof ResizeObserver === 'undefined') {
    const onR = () => { if (!raf) raf = requestAnimationFrame(measure); };
    window.addEventListener('resize', onR);
    return () => { window.removeEventListener('resize', onR); cancelAnimationFrame(raf); };
  }
  const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(measure); });
  ro.observe(el);
  return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
}

/** Simple listener registry for clean destroy(). */
export function listeners() {
  const list = [];
  return {
    on(target, type, fn, opt) { target.addEventListener(type, fn, opt); list.push(() => target.removeEventListener(type, fn, opt)); },
    clear() { list.splice(0).forEach((f) => f()); },
  };
}

/** Toggle chip button (aria-pressed). */
export function chip(parent, { label, color, pressed = true, dot = false, onToggle }) {
  const b = h('button', { type: 'button', class: 'ekc-chip', 'aria-pressed': String(pressed), style: color ? { '--sw': color } : null }, parent);
  h('span', { class: `ekc-sw${dot ? ' ekc-sw-dot' : ''}`, 'aria-hidden': 'true' }, b);
  h('span', { text: label }, b);
  b.addEventListener('click', () => {
    const next = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(next));
    onToggle?.(next);
  });
  return b;
}

export function iconButton(parent, { iconName, label, onClick }) {
  const b = h('button', { type: 'button', class: 'ekc-iconbtn', 'aria-label': label, title: label, html: icon(iconName, 15) }, parent);
  b.addEventListener('click', onClick);
  return b;
}

export function tile(parent, { label, value, sub, color }) {
  const t = h('div', { class: 'ekc-tile' }, parent);
  const l = h('div', { class: 'ekc-tile-label' }, t);
  if (color) h('i', { class: 'ekc-dot', style: { '--sw': color, marginRight: '6px', verticalAlign: '1px' } }, l);
  l.appendChild(document.createTextNode(label));
  h('div', { class: 'ekc-tile-value', text: value }, t);
  if (sub) h('div', { class: 'ekc-tile-sub', text: sub }, t);
  return t;
}

export function note(parent, text, iconName = 'info') {
  const n = h('p', { class: 'ekc-note' }, parent);
  n.innerHTML = icon(iconName, 14);
  h('span', { text }, n);
  return n;
}

/** Unique id prefix for clipPaths etc. */
let uid = 0;
export function nextId(prefix = 'ekc') {
  uid += 1;
  return `${prefix}-${uid}`;
}

/**
 * Horizontal brush (overview window) on an SVG group.
 * Domain [d0,d1]; the window [v0,v1] is moved/resized by pointer or keyboard.
 * Returns { set(v0, v1), destroy() }.
 */
export function createBrush(g, { x0, x1, y, height, domain, view, minSpan, onChange, label = 'Ausschnitt' }) {
  const [d0, d1] = domain;
  const sc = linear(d0, d1, x0, x1);
  let [v0, v1] = view;
  const shadeL = svg('rect', { class: 'ekc-brush-shade', y, height }, g);
  const shadeR = svg('rect', { class: 'ekc-brush-shade', y, height }, g);
  const win = svg('rect', {
    class: 'ekc-brush-win', y: y + 0.5, height: height - 1, rx: 4, tabindex: 0, role: 'slider',
    'aria-label': `${label}: mit Pfeiltasten verschieben, Plus/Minus zoomen`, 'aria-valuemin': d0, 'aria-valuemax': d1,
  }, g);
  const hL = svg('rect', { class: 'ekc-brush-handle', width: 7, height: Math.min(22, height - 6), rx: 2.5 }, g);
  const hR = svg('rect', { class: 'ekc-brush-handle', width: 7, height: Math.min(22, height - 6), rx: 2.5 }, g);

  function draw() {
    const a = sc(v0), b = sc(v1);
    shadeL.setAttribute('x', x0); shadeL.setAttribute('width', Math.max(0, a - x0));
    shadeR.setAttribute('x', b); shadeR.setAttribute('width', Math.max(0, x1 - b));
    win.setAttribute('x', a); win.setAttribute('width', Math.max(2, b - a));
    const hy = y + (height - Number(hL.getAttribute('height'))) / 2;
    hL.setAttribute('x', a - 3.5); hL.setAttribute('y', hy);
    hR.setAttribute('x', b - 3.5); hR.setAttribute('y', hy);
    win.setAttribute('aria-valuenow', v0.toFixed(2));
    win.setAttribute('aria-valuetext', `${fmt(v0, 1)} bis ${fmt(v1, 1)} s`);
  }
  function commit(a, b) {
    const span = Math.max(minSpan, Math.min(d1 - d0, b - a));
    a = clamp(a, d0, d1 - span);
    v0 = a; v1 = a + span;
    draw();
    onChange?.(v0, v1);
  }
  let drag = null;
  const ptr = (e) => {
    const rect = g.ownerSVGElement.getBoundingClientRect();
    const vb = g.ownerSVGElement.viewBox.baseVal;
    const scale = vb && vb.width ? vb.width / rect.width : 1;
    return sc.invert((e.clientX - rect.left) * scale);
  };
  const down = (mode) => (e) => {
    e.preventDefault(); e.stopPropagation();
    drag = { mode, start: ptr(e), v0, v1 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drag) return;
    const d = ptr(e) - drag.start;
    if (drag.mode === 'move') commit(drag.v0 + d, drag.v1 + d);
    else if (drag.mode === 'l') { const a = Math.min(drag.v0 + d, drag.v1 - minSpan); commit(Math.max(d0, a), drag.v1); }
    else { const b = Math.max(drag.v1 + d, drag.v0 + minSpan); commit(drag.v0, Math.min(d1, b)); }
  };
  const up = () => { drag = null; };
  const els = [[win, 'move'], [hL, 'l'], [hR, 'r']];
  for (const [el, mode] of els) {
    el.addEventListener('pointerdown', down(mode));
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  const bg = svg('rect', { x: x0, y, width: x1 - x0, height, class: 'ekc-hit' }, g);
  g.insertBefore(bg, shadeL);
  bg.addEventListener('pointerdown', (e) => {
    const c = ptr(e), span = v1 - v0;
    commit(c - span / 2, c + span / 2);
  });
  win.addEventListener('keydown', (e) => {
    const span = v1 - v0, step = span * 0.1;
    if (e.key === 'ArrowLeft') commit(v0 - step, v1 - step);
    else if (e.key === 'ArrowRight') commit(v0 + step, v1 + step);
    else if (e.key === 'Home') commit(d0, d0 + span);
    else if (e.key === 'End') commit(d1 - span, d1);
    else if (e.key === '+' || e.key === '=') { const c = (v0 + v1) / 2; commit(c - span / 2.8, c + span / 2.8); }
    else if (e.key === '-' || e.key === '_') { const c = (v0 + v1) / 2; commit(c - span * 0.7, c + span * 0.7); }
    else return;
    e.preventDefault();
  });
  draw();
  return {
    set(a, b) { v0 = a; v1 = b; draw(); },
  };
}
