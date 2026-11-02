// Architecture: the network as a horizontal chain of layer cards (grouped into
// blocks), card width ~ log(params), an auxiliary branch lane (e.g. RR features)
// merging into the fusion layer, plus total parameter count.

import {
  svg, h, esc, fmt, clamp, makeRoot, createTooltip, ttRow, observeWidth, listeners,
  isPending, renderMissingExport, note, tile, chip,
} from './shared.js';

const JOINABLE = new Set(['BatchNorm1d', 'BatchNorm2d', 'LayerNorm', 'ReLU', 'LeakyReLU', 'GELU', 'ELU', 'Sigmoid', 'Tanh', 'Dropout', 'Flatten', 'Softmax']);
const KIND = (type) => {
  if (/Conv/i.test(type)) return { color: 'var(--c-accent)', tag: 'Faltung' };
  if (/Linear/i.test(type)) return { color: 'var(--c-accent-2)', tag: 'Dicht' };
  if (/Input/i.test(type)) return { color: 'var(--c-muted)', tag: 'Eingang' };
  if (/Concat|Cat/i.test(type)) return { color: 'var(--c-peak)', tag: 'Fusion' };
  if (/Pool/i.test(type)) return { color: 'var(--c-filtered)', tag: 'Pooling' };
  return { color: 'var(--c-muted)', tag: type };
};

function parseName(name) {
  const str = String(name || '');
  const dot = str.lastIndexOf('.');
  const scope = dot >= 0 ? str.slice(0, dot) : '';
  const leaf = dot >= 0 ? str.slice(dot + 1) : str;
  const m = leaf.match(/(\d+)$/);
  return { scope, leaf, num: m ? Number(m[1]) : null };
}

/** Group consecutive layers into blocks: weight layer + its norm/activation/dropout. */
export function groupLayers(layers) {
  const groups = [];
  for (const layer of layers) {
    const { scope, num } = parseName(layer.name);
    const g = groups[groups.length - 1];
    let join = false;
    if (g && scope && g.scope === scope) {
      if (num != null) join = g.num === num;
      else join = JOINABLE.has(layer.type) || !g.hasWeight;
    }
    const isWeight = !JOINABLE.has(layer.type);
    if (join) {
      g.layers.push(layer);
      g.hasWeight = g.hasWeight || isWeight;
    } else {
      groups.push({ scope, num, layers: [layer], hasWeight: isWeight });
    }
  }
  return groups.map((g) => {
    const params = g.layers.reduce((a, l) => a + (Number(l.params) || 0), 0);
    const last = g.layers[g.layers.length - 1];
    const main = g.layers.find((l) => !JOINABLE.has(l.type)) || g.layers[0];
    const branch = /^rr|(^|\.)rr_/i.test(g.layers[0].name || '');
    return { ...g, params, out: last.output_shape, main, branch };
  });
}

function titleOf(g, idx, all) {
  const types = g.layers.map((l) => l.type);
  const n = g.layers[0].name || '';
  if (types.includes('Input')) return /rr/i.test(n) ? 'RR-Eingang' : 'Beat-Eingang';
  if (types.some((t) => /Conv/.test(t))) {
    const k = all.filter((x, i) => i <= idx && x.layers.some((l) => /Conv/.test(l.type))).length;
    return `Conv-Block ${g.num ?? k}`;
  }
  if (types.some((t) => /Concat/.test(t))) return 'Fusion (Concat)';
  if (types.some((t) => /AdaptiveAvgPool|GlobalAvg/.test(t))) return 'Global Average Pooling';
  if (g.branch) return 'RR-Zweig';
  if (/^head/.test(g.scope) || /^classifier|^fc/.test(g.scope)) {
    const isLast = all.indexOf(g) === all.length - 1;
    return isLast ? 'Ausgabe (Logits)' : 'Dichte Schicht';
  }
  return g.layers[0].name;
}

const shapeStr = (shape) => {
  if (!Array.isArray(shape)) return '–';
  const dims = shape.length > 1 ? shape.slice(1) : shape; // drop batch dim
  return dims.join(' × ');
};
const shapeHint = (shape) => (Array.isArray(shape) && shape.length === 3 ? 'Kanäle × Länge' : Array.isArray(shape) && shape.length === 2 ? 'Merkmale' : '');
const pretty = (s) => String(s ?? '').replace(/->/g, '→').replace(/, padding=same/, '');

export function renderArchitecture(container, data, opts = {}) {
  const layers = Array.isArray(data?.layers) ? data.layers : Array.isArray(data) ? data : [];
  if (isPending(data) || !layers.length) {
    return renderMissingExport(container, opts, { title: 'Architektur noch nicht exportiert', file: 'architecture.json', iconName: 'layers', name: 'architecture' });
  }
  const groups = groupLayers(layers);
  groups.forEach((g, i) => { g.title = titleOf(g, i, groups); g.kind = KIND(g.main.type); });
  const total = Number.isFinite(Number(data.total_params)) ? Number(data.total_params) : groups.reduce((a, g) => a + g.params, 0);
  const main = groups.filter((g) => !g.branch);
  const branch = groups.filter((g) => g.branch);
  const fusionIdx = main.findIndex((g) => g.layers.some((l) => /Concat/.test(l.type)));

  const ls = listeners();
  const root = makeRoot(container, { label: 'Schichten-Architektur des Netzes', name: 'architecture' });
  const tiles = h('div', { class: 'ekc-tiles', style: { marginBottom: '12px' } }, root);
  tile(tiles, { label: 'Parameter gesamt', value: fmt(total), sub: 'trainierbar' });
  tile(tiles, { label: 'Schichten', value: fmt(layers.filter((l) => l.type !== 'Input').length), sub: `${groups.length} Blöcke` });
  const conv = layers.filter((l) => /Conv/.test(l.type)).length;
  tile(tiles, { label: 'Faltungen', value: fmt(conv), sub: 'Conv1d' });
  const inShape = layers.find((l) => l.type === 'Input');
  const outShape = layers[layers.length - 1]?.output_shape;
  tile(tiles, { label: 'Ein → Aus', value: `${shapeStr(inShape?.output_shape).split(' × ').pop()} → ${shapeStr(outShape)}`, sub: 'Samples → Klassen' });

  // null = automatic: fit to width when the chain only needs mild down-scaling (>= 62 %),
  // so wide screens show the whole network incl. RR branch; narrow screens scroll instead.
  let fitUser = null;
  let lastAvail = 0;
  const bar = h('div', { class: 'ekc-toolbar' }, root);
  h('span', { class: 'ekc-meta', text: 'Datenfluss von links nach rechts · Hover/Fokus für Details' }, bar);
  h('span', { class: 'ekc-spacer' }, bar);
  const fitBtn = chip(bar, { label: 'An Breite anpassen', pressed: false, onToggle: (v) => { fitUser = v; draw(lastAvail); updateFades(); } });
  const frame = h('div', { style: { position: 'relative' } }, root);
  const scroller = h('div', { class: 'ekc-scroll', tabindex: 0, role: 'region', 'aria-label': 'Schichtenkette (horizontal scrollbar)', style: { borderRadius: '12px', border: '1px solid var(--c-border)', background: 'var(--c-surface-2)' } }, frame);
  const fadeStyle = (side) => ({ position: 'absolute', top: '1px', bottom: '1px', [side]: '1px', width: '36px', pointerEvents: 'none', borderRadius: side === 'left' ? '12px 0 0 12px' : '0 12px 12px 0', background: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, var(--c-surface-2), transparent)`, opacity: '0', transition: 'opacity .2s' });
  const fadeL = h('div', { 'aria-hidden': 'true', style: fadeStyle('left') }, frame);
  const fadeR = h('div', { 'aria-hidden': 'true', style: fadeStyle('right') }, frame);
  const updateFades = () => {
    const max = scroller.scrollWidth - scroller.clientWidth;
    fadeL.style.opacity = scroller.scrollLeft > 4 ? '1' : '0';
    fadeR.style.opacity = max - scroller.scrollLeft > 4 ? '1' : '0';
  };
  scroller.addEventListener('scroll', updateFades, { passive: true });
  const s = svg('svg', { role: 'list', 'aria-label': `Netzwerk mit ${groups.length} Blöcken und ${fmt(total)} Parametern` }, scroller);
  const tip = createTooltip(root);
  const legend = h('div', { class: 'ekc-legend', style: { marginTop: '10px' } }, root);
  const kinds = new Map();
  for (const g of groups) kinds.set(g.kind.tag, g.kind.color);
  for (const [tag, color] of kinds) h('span', { class: 'ekc-legend-item', html: `<i class="ekc-dot" style="--sw:${color}"></i>${esc(tag)}` }, legend);
  note(root, 'Kartenbreite und Balken wachsen mit log(Parameter). Die Ausgabeform ist ohne Batch-Dimension angegeben. Der RR-Zweig verarbeitet die 4 RR-Intervall-Merkmale und wird vor dem Klassifikationskopf mit den CNN-Merkmalen fusioniert.');

  const maxLog = Math.log10(1 + Math.max(...groups.map((g) => g.params), 1));
  const CH = 7.2; // approx px per char at 11.5px
  function cardWidth(g) {
    const lines = [g.title, ...g.layers.map((l) => `${l.type} ${pretty(l.detail)}`)];
    const text = Math.max(...lines.map((t) => t.length)) * CH * 0.86 + 28;
    const byParams = 128 + 70 * (Math.log10(1 + g.params) / maxLog);
    return Math.round(clamp(Math.max(text, byParams), 128, 250));
  }

  function draw(availW) {
    s.replaceChildren();
    const GAP = 34, PAD = 18, LINE = 15;
    const cardH = (g) => 44 + g.layers.length * LINE + 30;
    const mainH = Math.max(...main.map(cardH));
    const brH = branch.length ? Math.max(...branch.map(cardH)) : 0;
    let x = PAD;
    const pos = new Map();
    const yMain = PAD;
    for (const g of main) { const w = cardWidth(g); pos.set(g, { x, y: yMain, w, h: mainH }); x += w + GAP; }
    let W = x - GAP + PAD;
    const yBr = yMain + mainH + 44;
    if (branch.length) {
      const fusion = main[fusionIdx] || main[main.length - 1];
      const fp = pos.get(fusion);
      const widths = branch.map(cardWidth);
      const span = widths.reduce((a, b) => a + b, 0) + GAP * (branch.length - 1);
      let bx = fp.x - GAP - span;
      if (bx < PAD) {
        // shift the whole layout so the branch fits on the left
        const shift = PAD - bx;
        for (const p of pos.values()) p.x += shift;
        W += shift; bx = PAD;
      }
      branch.forEach((g, i) => { pos.set(g, { x: bx, y: yBr, w: widths[i], h: brH }); bx += widths[i] + GAP; });
    }
    const H = (branch.length ? yBr + brH : yMain + mainH) + PAD;
    lastAvail = availW;
    const outW = Math.max(W, availW);
    s.setAttribute('viewBox', `0 0 ${outW} ${H}`);
    const fit = fitUser ?? (W > availW && availW / W >= 0.62);
    fitBtn.setAttribute('aria-pressed', String(fit && W > availW));
    if (fit && W > availW) {
      s.setAttribute('width', availW);
      s.setAttribute('height', Math.round((H * availW) / W));
    } else {
      s.setAttribute('width', outW);
      s.setAttribute('height', H);
    }
    fitBtn.disabled = W <= availW;
    const offX = W < availW ? (outW - W) / 2 : 0;
    const gAll = svg('g', { transform: `translate(${offX},0)` }, s);

    // connectors
    const cg = svg('g', { 'aria-hidden': 'true' }, gAll);
    const arrow = (x1, y1, x2, y2, bend) => {
      let d;
      if (bend) d = `M${x1},${y1}H${x2 - 10}Q${x2},${y1} ${x2},${y1 - 10}V${y2}`;
      else d = `M${x1},${y1}H${x2}`;
      svg('path', { d, style: { fill: 'none', stroke: 'var(--c-muted)', strokeWidth: 1.4, opacity: 0.7 } }, cg);
      const [ax, ay] = [x2, y2];
      const head = bend ? `M${ax - 4.5},${ay + 7}L${ax},${ay}L${ax + 4.5},${ay + 7}` : `M${ax - 7},${ay - 4.5}L${ax},${ay}L${ax - 7},${ay + 4.5}`;
      svg('path', { d: head, style: { fill: 'none', stroke: 'var(--c-muted)', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } }, cg);
    };
    for (let i = 0; i < main.length - 1; i++) {
      const a = pos.get(main[i]), b = pos.get(main[i + 1]);
      arrow(a.x + a.w + 3, a.y + 30, b.x - 3, b.y + 30, false);
    }
    for (let i = 0; i < branch.length - 1; i++) {
      const a = pos.get(branch[i]), b = pos.get(branch[i + 1]);
      arrow(a.x + a.w + 3, a.y + 30, b.x - 3, b.y + 30, false);
    }
    if (branch.length) {
      const last = pos.get(branch[branch.length - 1]);
      const fusion = pos.get(main[fusionIdx] || main[main.length - 1]);
      arrow(last.x + last.w + 3, last.y + 30, fusion.x + fusion.w / 2, fusion.y + fusion.h + 3, true);
      svg('text', { x: last.x, y: last.y - 10, class: 'ekc-sublabel', text: 'Hilfszweig: RR-Intervalle' }, cg);
    }

    // cards
    groups.forEach((g, gi) => {
      const p = pos.get(g);
      if (!p) return;
      const card = svg('g', {
        transform: `translate(${p.x},${p.y})`, tabindex: 0, role: 'listitem', class: 'ekc-arch-card',
        'aria-label': `${g.title}: ${g.layers.map((l) => l.type).join(', ')}; Ausgabe ${shapeStr(g.out)}; ${fmt(g.params)} Parameter`,
        style: { cursor: 'default' },
      }, gAll);
      svg('rect', { x: -3, y: -3, width: p.w + 6, height: p.h + 6, rx: 13, class: 'ekc-focus' }, card);
      const bgRect = svg('rect', { width: p.w, height: p.h, rx: 11, style: { fill: 'var(--c-surface)', stroke: 'var(--c-border)', strokeWidth: 1 } }, card);
      svg('rect', { x: 0, y: 10, width: 3.5, height: 22, rx: 1.75, style: { fill: g.kind.color } }, card);
      svg('text', { x: 14, y: 20, class: 'ekc-sublabel', style: { fontSize: '9.5px', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }, text: `${g.branch ? `R${branch.indexOf(g) + 1}` : String(main.indexOf(g) + 1).padStart(2, '0')} · ${g.kind.tag}` }, card);
      svg('text', { x: 14, y: 36, class: 'ekc-label', style: { fontSize: '12.5px' }, text: g.title }, card);
      g.layers.forEach((l, k) => {
        const ty = 56 + k * LINE;
        const t = svg('text', { x: 14, y: ty, style: { fontSize: '10.5px', fill: 'var(--c-text)' } }, card);
        svg('tspan', { style: { fontWeight: 600 }, text: l.type }, t);
        const det = pretty(l.detail);
        if (det && !/^max\(0, x\)$/.test(det)) {
          const ts = svg('tspan', { dx: 5, style: { fill: 'var(--c-muted)' }, text: det }, t);
          // Trim to the card width (measured; no-op while not rendered).
          let cut = det.length;
          while (cut > 4 && t.getComputedTextLength?.() > p.w - 24) { cut -= 2; ts.textContent = `${det.slice(0, cut)}…`; }
          if (cut < det.length) svg('title', { text: `${l.type}: ${det}` }, t);
        }
      });
      // footer: output shape + params + bar
      const fy = p.h - 24;
      svg('line', { x1: 10, x2: p.w - 10, y1: fy - 6, y2: fy - 6, style: { stroke: 'var(--c-border)' } }, card);
      svg('text', { x: 14, y: fy + 7, class: 'ekc-num', style: { fontSize: '11px', fontWeight: 600, fill: 'var(--c-text)', fontFamily: 'var(--font-mono, ui-monospace, monospace)' }, text: `→ ${shapeStr(g.out)}` }, card);
      svg('text', { x: p.w - 12, y: fy + 7, 'text-anchor': 'end', class: 'ekc-num', style: { fontSize: '10.5px', fill: 'var(--c-muted)' }, text: g.params ? `${fmt(g.params)} P.` : '0 P.' }, card);
      const bw = (p.w - 24) * (Math.log10(1 + g.params) / maxLog);
      svg('rect', { x: 12, y: fy + 13, width: p.w - 24, height: 3, rx: 1.5, style: { fill: 'var(--c-surface-2)' } }, card);
      if (bw > 0) svg('rect', { x: 12, y: fy + 13, width: bw, height: 3, rx: 1.5, style: { fill: g.kind.color, opacity: 0.85 } }, card);

      const tt = () => `<div class="ekc-tt-title">${esc(g.title)}</div>${g.layers.map((l) => ttRow(`${l.type}${l.detail && !/^max/.test(l.detail) ? ` · ${pretty(l.detail).slice(0, 40)}` : ''}`, `${fmt(l.params)} P.`)).join('')}${ttRow('Ausgabe', `${shapeStr(g.out)}${shapeHint(g.out) ? ` (${shapeHint(g.out)})` : ''}`)}${ttRow('Anteil', `${fmt((g.params / (total || 1)) * 100, 1)} %`)}`;
      const enter = () => { bgRect.style.stroke = g.kind.color; };
      const leave = () => { bgRect.style.stroke = 'var(--c-border)'; tip.hide(); };
      ls.on(card, 'pointerenter', enter);
      ls.on(card, 'pointermove', (e) => tip.show(tt(), e.clientX, e.clientY));
      ls.on(card, 'pointerleave', leave);
      ls.on(card, 'focus', () => { enter(); tip.showAt(tt(), card); });
      ls.on(card, 'blur', leave);
    });
  }

  const stop = observeWidth(scroller, (w) => { draw(w - 2); updateFades(); });
  return { destroy() { stop(); ls.clear(); container.replaceChildren(); } };
}
