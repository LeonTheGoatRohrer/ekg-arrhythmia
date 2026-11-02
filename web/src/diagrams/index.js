// Mermaid rendering for the "Process" view (module: ui-diagrams).
//
// Public API (see INTERFACES.md):
//   DIAGRAMS                                   { [id]: { title, caption, source } }
//   renderDiagram(container, id, opts?)        -> Promise<{ ok, id, destroy() }>
//   renderMermaidSource(container, source, key, opts?)  dynamic sources (e.g. tree_to_mermaid)
//   rerenderAll()                              force a re-render (normally automatic)
//
// Theming: Mermaid runs with theme "base"; its themeVariables and the semantic
// node classes are derived from the CSS design tokens (--c-*) via getComputedStyle.
// Every rendered diagram is tracked and re-rendered on the window "themechange"
// event (dispatched by lib/theme.js) and, as a fallback, when the `dark` class on
// <html> changes. Render ids are unique per render, renders are serialised.

import mermaid from 'mermaid';
import { DIAGRAMS, DIAGRAM_IDS } from './definitions.js';

export { DIAGRAMS, DIAGRAM_IDS };

// Token defaults (INTERFACES.md) used when a CSS variable is missing or unparsable.
const FALLBACK_TOKENS = {
  light: {
    bg: '#f8fafc', surface: '#ffffff', 'surface-2': '#f1f5f9', border: '#e2e8f0',
    text: '#0f172a', muted: '#64748b', accent: '#0d9488', 'accent-2': '#6366f1',
    'cls-N': '#64748b', 'cls-S': '#6366f1', 'cls-V': '#e11d48', 'cls-F': '#d97706', 'cls-Q': '#0d9488',
  },
  dark: {
    bg: '#0b1120', surface: '#111827', 'surface-2': '#1e293b', border: '#273449',
    text: '#e2e8f0', muted: '#94a3b8', accent: '#2dd4bf', 'accent-2': '#818cf8',
    'cls-N': '#94a3b8', 'cls-S': '#818cf8', 'cls-V': '#fb7185', 'cls-F': '#fbbf24', 'cls-Q': '#2dd4bf',
  },
};

const FALLBACK_FONT =
  '"Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const STYLE_ID = 'ekg-diagram-styles';
const MIN_WIDTH = 420; // px, lower bound for SVG width on narrow screens
const MOBILE_MIN_SCALE = 0.85; // phones: render at >= 85 % of the natural width (labels ~12 px), scroll instead
const ERROR_TEXT = 'Diagramm konnte nicht dargestellt werden.';

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

function parseColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/.exec(v);
  if (m) return [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)));
  return null;
}

function toHex(rgb) {
  return '#' + rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
}

/** Mix colour a into b with weight w (0..1) of a. Inputs are valid token colours. */
function mix(a, b, w) {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  return toHex(ca.map((v, i) => v * w + cb[i] * (1 - w)));
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function isDarkMode() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

function readTheme() {
  const dark = isDarkMode();
  const fallback = FALLBACK_TOKENS[dark ? 'dark' : 'light'];
  const rootStyle = getComputedStyle(document.documentElement);
  const tokens = {};
  for (const [name, def] of Object.entries(fallback)) {
    const raw = rootStyle.getPropertyValue(`--c-${name}`).trim();
    // Mermaid (khroma) needs hex/rgb; anything else falls back to the contract value.
    const rgb = parseColor(raw);
    tokens[name] = rgb ? toHex(rgb) : def;
  }
  let font = '';
  try {
    font = getComputedStyle(document.body || document.documentElement).fontFamily || '';
  } catch {
    font = '';
  }
  // Ignore browser default serif stacks (shell stylesheet not loaded yet).
  if (!font || /^("?times|serif)/i.test(font.trim())) font = FALLBACK_FONT;
  const signature = JSON.stringify([dark, font, tokens]);
  return { dark, tokens, font, signature };
}

function themeVariables({ dark, tokens: t, font }) {
  return {
    darkMode: dark,
    fontFamily: font,
    fontSize: '14px',
    background: t.surface,
    mainBkg: t.surface,
    primaryColor: t.surface,
    primaryTextColor: t.text,
    primaryBorderColor: mix(t.muted, t.surface, 0.55),
    secondaryColor: t['surface-2'],
    secondaryTextColor: t.text,
    secondaryBorderColor: t.border,
    tertiaryColor: t['surface-2'],
    tertiaryTextColor: t.text,
    tertiaryBorderColor: t.border,
    nodeBorder: mix(t.muted, t.surface, 0.55),
    nodeTextColor: t.text,
    textColor: t.text,
    titleColor: t.muted,
    lineColor: mix(t.muted, t.surface, 0.85),
    arrowheadColor: t.muted,
    clusterBkg: mix(t['surface-2'], t.surface, 0.55),
    clusterBorder: t.border,
    edgeLabelBackground: t.surface,
    labelBackground: t.surface,
    noteBkgColor: mix(t['accent-2'], t.surface, 0.08),
    noteTextColor: t.text,
    noteBorderColor: t['accent-2'],
    errorBkgColor: t.surface,
    errorTextColor: t['cls-V'],
  };
}

/** classDef lines for the semantic node classes used in the sources. */
function classDefs({ tokens: t }) {
  const tint = (c, w) => mix(c, t.surface, w);
  const def = (name, fill, stroke, color, extra = '') =>
    `  classDef ${name} fill:${fill},stroke:${stroke},color:${color},stroke-width:1.5px${extra}`;
  const lines = [
    def('data', t['surface-2'], mix(t.muted, t.surface, 0.6), t.text),
    def('proc', t.surface, t.accent, t.text),
    def('model', tint(t['accent-2'], 0.12), t['accent-2'], t.text),
    def('result', tint(t.accent, 0.16), t.accent, t.text, ',font-weight:600'),
    def('decision', t.surface, mix(t.text, t.surface, 0.55), t.text),
    def('muted', t['surface-2'], t.muted, t.muted, ',stroke-dasharray:5 4'),
    def('note', tint(t['accent-2'], 0.06), mix(t['accent-2'], t.surface, 0.6), t.text, ',stroke-dasharray:3 3'),
  ];
  for (const c of ['N', 'S', 'V', 'F', 'Q']) {
    lines.push(def(`cls${c}`, tint(t[`cls-${c}`], 0.16), t[`cls-${c}`], t.text, ',font-weight:600'));
  }
  return lines.join('\n');
}

function isFlowchart(source) {
  const firstLine = source
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('%%') && l !== '---');
  return !!firstLine && /^(flowchart|graph)\b/.test(firstLine);
}

function decorate(source, theme) {
  const src = String(source).replace(/\s+$/, '');
  return isFlowchart(src) ? `${src}\n${classDefs(theme)}\n` : `${src}\n`;
}

function configure(theme) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    darkMode: theme.dark,
    fontFamily: theme.font,
    themeVariables: themeVariables(theme),
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis',
      padding: 12,
      nodeSpacing: 36,
      rankSpacing: 44,
      wrappingWidth: 280,
      subGraphTitleMargin: { top: 6, bottom: 10 },
    },
  });
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.ekg-diagram { margin: 0; min-width: 0; }
.ekg-diagram__canvas { width: 100%; min-width: 0; overflow-x: auto; overscroll-behavior-x: contain; }
.ekg-diagram__canvas > svg { display: block; width: 100%; max-width: 100%; height: auto; margin-inline: auto;
  min-width: min(var(--ekg-dg-natural, 0px), ${MIN_WIDTH}px); }
@media (max-width: 767px) {
  /* Phones: keep labels legible; the canvas scrolls horizontally instead of squeezing the SVG. */
  .ekg-diagram__canvas > svg { min-width: min(var(--ekg-dg-natural, 0px), max(${MIN_WIDTH}px, calc(var(--ekg-dg-natural, 0px) * ${MOBILE_MIN_SCALE}))); }
}
.ekg-diagram__caption { margin-top: .75rem; font-size: .875rem; line-height: 1.55; color: var(--c-muted, #64748b); }
.ekg-diagram__loading { display: flex; align-items: center; justify-content: center; min-height: 8rem;
  border-radius: .75rem; background: var(--c-surface-2, #f1f5f9); color: var(--c-muted, #64748b); font-size: .875rem; }
@media (prefers-reduced-motion: no-preference) {
  .ekg-diagram__loading { animation: ekg-diagram-pulse 1.6s ease-in-out infinite; }
}
@keyframes ekg-diagram-pulse { 50% { opacity: .55; } }
.ekg-diagram__error { border: 1px dashed var(--c-border, #e2e8f0); border-radius: .75rem; padding: .875rem 1rem;
  background: var(--c-surface-2, #f1f5f9); color: var(--c-muted, #64748b); font-size: .875rem; line-height: 1.5; }
.ekg-diagram__error strong { color: var(--c-text, #0f172a); font-weight: 600; }
.ekg-diagram__error details { margin-top: .375rem; }
.ekg-diagram__error summary { cursor: pointer; }
.ekg-diagram__error code { display: block; margin-top: .375rem; white-space: pre-wrap; word-break: break-word;
  font-family: "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .75rem; }
`;
  document.head.appendChild(style);
}

function slug(text) {
  return String(text ?? 'diagram').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'diagram';
}

function buildFrame(entry) {
  const { container, caption, title } = entry;
  container.replaceChildren();
  const figure = document.createElement('figure');
  figure.className = 'ekg-diagram';
  figure.dataset.diagram = entry.key;
  const canvas = document.createElement('div');
  canvas.className = 'ekg-diagram__canvas';
  const loading = document.createElement('div');
  loading.className = 'ekg-diagram__loading';
  loading.setAttribute('role', 'status');
  loading.textContent = 'Diagramm wird geladen …';
  canvas.appendChild(loading);
  figure.appendChild(canvas);
  if (caption) {
    const figcaption = document.createElement('figcaption');
    figcaption.className = 'ekg-diagram__caption';
    figcaption.textContent = caption;
    figure.appendChild(figcaption);
  }
  if (title) figure.setAttribute('aria-label', title);
  container.appendChild(figure);
  entry.canvas = canvas;
}

function showError(entry, err) {
  const card = document.createElement('div');
  card.className = 'ekg-diagram__error';
  card.setAttribute('role', 'note');
  card.dataset.diagramError = '';
  const strong = document.createElement('strong');
  strong.textContent = ERROR_TEXT;
  card.appendChild(strong);
  const hint = document.createElement('span');
  hint.textContent = ' Der restliche Inhalt bleibt verfügbar.';
  card.appendChild(hint);
  const message = err && (err.message || err.str || String(err));
  if (message) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Technische Details';
    const code = document.createElement('code');
    code.textContent = message.slice(0, 800);
    details.append(summary, code);
    card.appendChild(details);
  }
  entry.canvas.replaceChildren(card);
}

function removeStray(renderId) {
  // Mermaid leaves a temporary container in <body> when rendering fails.
  for (const elId of [`d${renderId}`, renderId, `i${renderId}`]) {
    const el = document.getElementById(elId);
    if (el && !el.closest('.ekg-diagram__canvas')) el.remove();
  }
}

// ---------------------------------------------------------------------------
// Render registry + queue
// ---------------------------------------------------------------------------

/** @type {Map<Element, object>} */
const registry = new Map();
let renderSeq = 0;
let queue = Promise.resolve();
let listenersInstalled = false;
let fontsReady = null;

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

function waitForFonts() {
  if (!fontsReady) {
    const ready = typeof document !== 'undefined' && document.fonts ? document.fonts.ready : Promise.resolve();
    fontsReady = Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  }
  return fontsReady;
}

async function renderEntry(entry) {
  const version = ++entry.version;
  await waitForFonts();
  return enqueue(async () => {
    if (version !== entry.version || registry.get(entry.container) !== entry) return entry.ok;
    const theme = readTheme();
    const renderId = `ekg-mmd-${slug(entry.key)}-${++renderSeq}`;
    const canvas = entry.canvas;
    const prevHeight = canvas.offsetHeight;
    if (prevHeight) canvas.style.minHeight = `${prevHeight}px`;
    try {
      if (!entry.source || !String(entry.source).trim()) throw new Error('Leere Diagramm-Quelle.');
      configure(theme);
      const text = decorate(entry.source, theme);
      await mermaid.parse(text);
      const { svg, bindFunctions } = await mermaid.render(renderId, text);
      if (version !== entry.version || registry.get(entry.container) !== entry) return entry.ok;
      canvas.innerHTML = svg;
      const svgEl = canvas.querySelector('svg');
      if (svgEl) {
        svgEl.removeAttribute('height');
        svgEl.style.height = 'auto';
        // Keep wide diagrams legible: the stylesheet derives min-width from the natural
        // width (>= MIN_WIDTH px everywhere, >= MOBILE_MIN_SCALE x natural on phones);
        // the canvas scrolls horizontally instead of the page.
        const natural = parseFloat(svgEl.style.maxWidth) || parseFloat(svgEl.getAttribute('viewBox')?.split(/[\s,]+/)[2]) || 0;
        if (natural) svgEl.style.setProperty('--ekg-dg-natural', `${natural}px`);
        svgEl.setAttribute('role', 'img');
        if (entry.title) svgEl.setAttribute('aria-label', entry.title);
      }
      bindFunctions?.(canvas);
      entry.ok = true;
      entry.signature = theme.signature;
    } catch (err) {
      removeStray(renderId);
      if (version !== entry.version) return entry.ok;
      console.warn(`[diagrams] render failed for "${entry.key}":`, err);
      showError(entry, err);
      entry.ok = false;
      entry.signature = theme.signature;
    } finally {
      canvas.style.minHeight = '';
    }
    return entry.ok;
  });
}

function rerenderIfThemeChanged() {
  if (!registry.size) return;
  const { signature } = readTheme();
  for (const [container, entry] of registry) {
    if (!container.isConnected) {
      registry.delete(container);
      continue;
    }
    if (entry.dead || entry.signature === signature || entry.target === signature) continue;
    entry.target = signature;
    renderEntry(entry);
  }
}

function installListeners() {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;
  // The shell toggles the class before dispatching; wait one frame so tokens are applied.
  window.addEventListener('themechange', () => requestAnimationFrame(rerenderIfThemeChanged));
  // Fallback: react to `dark` class changes even without an event.
  let lastDark = isDarkMode();
  new MutationObserver(() => {
    const dark = isDarkMode();
    if (dark !== lastDark) {
      lastDark = dark;
      requestAnimationFrame(rerenderIfThemeChanged);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

function mount(container, { key, source, title, caption }) {
  if (!container || typeof container.appendChild !== 'function') {
    throw new TypeError('renderDiagram: container must be a DOM element');
  }
  ensureStyles();
  installListeners();
  const entry = {
    container, key, source, title, caption,
    version: 0, ok: false, dead: false, signature: null, target: null, canvas: null,
  };
  const previous = registry.get(container);
  if (previous) previous.version += 1; // invalidate in-flight render
  registry.set(container, entry);
  buildFrame(entry);
  return entry;
}

function handle(entry, id) {
  return {
    id,
    get ok() {
      return entry.ok;
    },
    destroy() {
      entry.version += 1;
      if (registry.get(entry.container) === entry) registry.delete(entry.container);
      entry.container.replaceChildren();
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a predefined diagram into `container`.
 * The figure contains the SVG and, unless `opts.caption === false`, the caption.
 * The title is not rendered visibly (the surrounding card normally shows it);
 * it is used as accessible name. Never throws for render errors: an error card is shown.
 * @param {Element} container
 * @param {string} id one of DIAGRAM_IDS
 * @param {{ caption?: boolean }} [opts]
 */
export async function renderDiagram(container, id, opts = {}) {
  const def = DIAGRAMS[id];
  const entry = mount(container, {
    key: id,
    source: def ? def.source : '',
    title: def ? def.title : '',
    caption: def && opts.caption !== false ? def.caption : '',
  });
  if (!def) {
    entry.dead = true; // nothing to re-render on theme changes
    showError(entry, new Error(`Unbekanntes Diagramm: "${id}"`));
    return handle(entry, id);
  }
  await renderEntry(entry);
  return handle(entry, id);
}

/**
 * Render an arbitrary Mermaid source (e.g. the output of tree_to_mermaid).
 * Flowcharts may use the semantic classes (data, proc, model, result, decision, muted, note, clsN…clsQ).
 * @param {Element} container
 * @param {string} source Mermaid definition
 * @param {string} [key] stable identifier used for render ids
 * @param {{ title?: string, caption?: string }} [opts]
 */
export async function renderMermaidSource(container, source, key = 'custom', opts = {}) {
  const entry = mount(container, {
    key: key || 'custom',
    source: source == null ? '' : String(source),
    title: opts.title || '',
    caption: opts.caption || '',
  });
  await renderEntry(entry);
  return handle(entry, key);
}

/** Re-render every mounted diagram (e.g. after token changes without a themechange event). */
export async function rerenderAll() {
  const jobs = [];
  for (const [container, entry] of registry) {
    if (!container.isConnected) registry.delete(container);
    else if (!entry.dead) jobs.push(renderEntry(entry));
  }
  await Promise.all(jobs);
}
