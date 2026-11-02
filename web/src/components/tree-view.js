// Interactive decision tree (tree.json from export_tree): top-down node-link
// layout, click/Enter to expand/collapse, nodes show "feature <= threshold",
// sample count and class distribution as a mini stacked bar, root path
// highlighted on hover/focus.

import {
  svg, h, esc, fmt, fmtPct, fmtSig, makeRoot, createTooltip, ttRow, observeWidth, listeners,
  isPending, renderPendingFull, classColor, CLASS_LABELS, CLASSES, iconButton, note,
} from './shared.js';
import { tr } from '../lib/i18n.js';

const NODE_W = 172;
const NODE_H = 78;
const GAP_X = 18;
const GAP_Y = 46;
const PAD = 16;

// [de, en] pairs, resolved at render time via featureLabel().
const FEATURE_LABELS = {
  qrs_width_ms: ['QRS-Breite (ms)', 'QRS width (ms)'],
  r_amplitude: ['R-Amplitude (z)', 'R amplitude (z)'],
  q_depth: ['Q-Tiefe (z)', 'Q depth (z)'],
  s_depth: ['S-Tiefe (z)', 'S depth (z)'],
  qrs_area: ['QRS-Fläche (z·ms)', 'QRS area (z·ms)'],
  t_amplitude: ['T-Amplitude (z)', 'T amplitude (z)'],
  beat_energy: ['QRS-Energieanteil', 'QRS energy share'],
  pre_rr: ['RR-Intervall davor (s)', 'RR interval before (s)'],
  post_rr: ['RR-Intervall danach (s)', 'RR interval after (s)'],
  local_rr: ['lokales mittleres RR (s)', 'local mean RR (s)'],
  rr_ratio: ['RR davor / lokales RR', 'RR before / local RR'],
};

/** Readable feature name in the current language (falls back to the raw key). */
export function featureLabel(f) {
  return FEATURE_LABELS[f] ? tr(...FEATURE_LABELS[f]) : f;
}

function rootOf(data) {
  if (!data || typeof data !== 'object') return null;
  const cand = data.tree || data.root || data;
  return cand && typeof cand === 'object' && ('samples' in cand || 'value' in cand || 'left' in cand) ? cand : null;
}

const isLeaf = (n) => !n.left && !n.right;

export function renderTreeView(container, data, opts = {}) {
  const src = rootOf(data);
  if (isPending(data) || !src) {
    return renderPendingFull(container, data, opts, { title: tr('Entscheidungsbaum folgt nach dem Volltraining', 'Decision tree available after the full training'), iconName: 'tree', name: 'tree' });
  }
  const classNames = Array.isArray(data.class_names) ? data.class_names : CLASSES;

  // Copy into internal nodes (input stays untouched) with parent links and depth.
  const nodes = [];
  let uid = 0;
  const build = (n, parent, depth, branch) => {
    const node = {
      feature: n.feature ?? null, threshold: n.threshold ?? null, samples: n.samples, value: Array.isArray(n.value) ? n.value : [],
      class: n.class, impurity: n.impurity, __k: uid++, __parent: parent, __depth: depth, __branch: branch,
    };
    nodes.push(node);
    node.left = n.left && typeof n.left === 'object' ? build(n.left, node, depth + 1, 'left') : null;
    node.right = n.right && typeof n.right === 'object' ? build(n.right, node, depth + 1, 'right') : null;
    return node;
  };
  const tree = build(src, null, 0, null);
  const maxDepth = Math.max(...nodes.map((n) => n.__depth));
  const leaves = nodes.filter(isLeaf).length;
  const initialDepth = Number.isFinite(opts.initialDepth) ? opts.initialDepth : 2;
  const collapsed = new Set(nodes.filter((n) => !isLeaf(n) && n.__depth >= initialDepth).map((n) => n.__k));
  const descCount = (n) => [n.left, n.right].filter(Boolean).reduce((a, c) => a + 1 + descCount(c), 0);
  const features = [...new Set(nodes.filter((n) => n.feature).map((n) => n.feature))];

  const ls = listeners();
  const root = makeRoot(container, { label: tr('Interaktiver Entscheidungsbaum', 'Interactive decision tree'), name: 'tree' });
  const bar = h('div', { class: 'ekc-toolbar' }, root);
  h('span', { class: 'ekc-badge ekc-num', text: `${tr('Tiefe', 'Depth')} ${maxDepth}` }, bar);
  h('span', { class: 'ekc-badge ekc-num', text: `${leaves} ${tr('Blätter', 'leaves')}` }, bar);
  h('span', { class: 'ekc-badge ekc-num', text: `${fmt(tree.samples)} ${tr('Beats', 'beats')}` }, bar);
  h('span', { class: 'ekc-badge ekc-num', text: `${features.length} ${tr('Merkmale genutzt', 'features used')}`, title: features.map(featureLabel).join(', ') }, bar);
  h('span', { class: 'ekc-spacer' }, bar);
  const btns = h('div', { class: 'ekc-btngroup' }, bar);
  iconButton(btns, { iconName: 'expand', label: tr('Alle Knoten aufklappen', 'Expand all nodes'), onClick: () => { collapsed.clear(); draw(true); } });
  iconButton(btns, { iconName: 'collapse', label: tr('Auf die ersten Ebenen einklappen', 'Collapse to the top levels'), onClick: () => { collapsed.clear(); nodes.forEach((n) => { if (!isLeaf(n) && n.__depth >= 1) collapsed.add(n.__k); }); draw(true); } });

  const scroller = h('div', { class: 'ekc-scroll', style: { borderRadius: '12px', border: '1px solid var(--c-border)', background: 'var(--c-surface-2)' } }, root);
  const s = svg('svg', { role: 'tree', 'aria-label': tr(`Entscheidungsbaum mit Tiefe ${maxDepth} und ${leaves} Blättern. Enter oder Leertaste klappt Knoten auf und zu.`, `Decision tree with depth ${maxDepth} and ${leaves} leaves. Enter or Space expands and collapses nodes.`) }, scroller);
  const tip = createTooltip(root);
  const legend = h('div', { class: 'ekc-legend', style: { marginTop: '10px' } }, root);
  classNames.forEach((c) => h('span', { class: 'ekc-legend-item', html: `<i class="ekc-dot" style="--sw:${classColor(c)}"></i><b style="color:${classColor(c)}">${esc(c)}</b> ${esc(CLASS_LABELS[c] || '')}` }, legend));
  note(root, tr(
    'Linker Ast: Bedingung erfüllt (ja, ≤), rechter Ast: nicht erfüllt (nein, >). Der Balken zeigt die Klassenverteilung im Knoten – mit class_weight="balanced" gewichtet, daher nicht identisch mit den Rohanteilen. Klick oder Enter klappt Knoten auf/zu; Hover hebt den Entscheidungspfad hervor.',
    'Left branch: condition met (yes, ≤), right branch: not met (no, >). The bar shows the class distribution in the node – weighted with class_weight="balanced", so it differs from the raw shares. Click or Enter expands/collapses a node; hover highlights the decision path.'));

  let availW = 0;
  let hovered = null;
  let focusKey = null;
  const els = new Map(); // key -> {g, rect, edge}

  function visibleChildren(n) {
    if (isLeaf(n) || collapsed.has(n.__k)) return [];
    return [n.left, n.right].filter(Boolean);
  }

  function layout() {
    let slot = 0;
    const pos = new Map();
    (function place(n) {
      const kids = visibleChildren(n);
      let x;
      if (!kids.length) x = slot++;
      else { kids.forEach(place); x = (pos.get(kids[0].__k).slot + pos.get(kids[kids.length - 1].__k).slot) / 2; }
      pos.set(n.__k, { slot: x, depth: n.__depth });
    }(tree));
    return { pos, slots: slot };
  }

  function nodeHtml(n) {
    const rows = classNames.map((c, i) => (n.value?.[i] ? ttRow(`${c} · ${CLASS_LABELS[c] || ''}`, fmtPct(n.value[i], 1), classColor(c)) : '')).join('');
    const cond = n.feature ? `<div class="ekc-tt-title">${esc(featureLabel(n.feature))} ≤ ${esc(fmtSig(n.threshold, 4))}?</div>` : `<div class="ekc-tt-title">${tr('Blatt → Vorhersage', 'Leaf → predicted')} ${esc(n.class)} (${esc(CLASS_LABELS[n.class] || '')})</div>`;
    const path = pathText(n);
    return `${cond}${ttRow(tr('Beats im Knoten', 'Beats in node'), fmt(n.samples))}${n.impurity != null ? ttRow(tr('Gini-Unreinheit', 'Gini impurity'), fmt(n.impurity, 3)) : ''}<div style="margin:5px 0 2px;color:var(--c-muted);font-size:11px">${tr('Klassenverteilung (gewichtet)', 'Class distribution (weighted)')}</div>${rows}${path ? `<div style="margin-top:6px;color:var(--c-muted);font-size:11px;white-space:normal">${tr('Pfad', 'Path')}: ${esc(path)}</div>` : ''}`;
  }

  function pathText(n) {
    const parts = [];
    let c = n;
    while (c.__parent) {
      const p = c.__parent;
      parts.unshift(`${p.feature} ${c.__branch === 'left' ? '≤' : '>'} ${fmtSig(p.threshold, 3)}`);
      c = p;
    }
    return parts.join(' ∧ ');
  }

  function draw(resetScroll = false) {
    const { pos, slots } = layout();
    const depthVis = Math.max(...[...pos.values()].map((p) => p.depth));
    const naturalW = PAD * 2 + slots * NODE_W + (slots - 1) * GAP_X;
    const W = Math.max(naturalW, availW);
    const H = PAD * 2 + (depthVis + 1) * NODE_H + depthVis * GAP_Y + 10;
    const off = (W - naturalW) / 2;
    const X = (k) => off + PAD + pos.get(k).slot * (NODE_W + GAP_X);
    const Y = (k) => PAD + pos.get(k).depth * (NODE_H + GAP_Y);
    s.replaceChildren();
    els.clear();
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    s.setAttribute('width', W);
    s.setAttribute('height', H);
    const gEdges = svg('g', { 'aria-hidden': 'true' }, s);
    const gNodes = svg('g', {}, s);

    for (const n of nodes) {
      if (!pos.has(n.__k)) continue;
      const x = X(n.__k), y = Y(n.__k);
      // edge to parent
      if (n.__parent) {
        const px = X(n.__parent.__k) + NODE_W / 2, py = Y(n.__parent.__k) + NODE_H;
        const cx = x + NODE_W / 2, cy = y;
        const my = (py + cy) / 2;
        const edge = svg('path', { d: `M${px},${py}C${px},${my} ${cx},${my} ${cx},${cy}`, style: { fill: 'none', stroke: 'var(--c-border)', strokeWidth: 1.6, transition: 'stroke .15s, stroke-width .15s' } }, gEdges);
        const lx = (px + cx) / 2 + (n.__branch === 'left' ? -4 : 4), ly = my - 3;
        const lab = svg('g', {}, gEdges);
        const txt = n.__branch === 'left' ? tr('ja', 'yes') : tr('nein', 'no');
        svg('rect', { x: lx - (txt.length * 3.5 + 6), y: ly - 9, width: txt.length * 7 + 12, height: 16, rx: 8, style: { fill: 'var(--c-surface)', stroke: 'var(--c-border)' } }, lab);
        svg('text', { x: lx, y: ly + 3, 'text-anchor': 'middle', style: { fill: 'var(--c-muted)', fontSize: '10px', fontWeight: 600 }, text: txt }, lab);
        els.set(`e${n.__k}`, edge);
      }
      // node
      const leaf = isLeaf(n);
      const isCollapsed = collapsed.has(n.__k);
      const g = svg('g', {
        transform: `translate(${x},${y})`, role: 'treeitem', tabindex: 0, 'aria-level': n.__depth + 1,
        'aria-expanded': leaf ? null : String(!isCollapsed),
        'aria-label': leaf
          ? tr(`Blatt: Vorhersage ${n.class}, ${n.samples} Beats`, `Leaf: predicted ${n.class}, ${n.samples} beats`)
          : tr(`Wenn ${featureLabel(n.feature)} kleiner gleich ${fmtSig(n.threshold, 4)}, ${n.samples} Beats${isCollapsed ? ', eingeklappt' : ''}`,
            `If ${featureLabel(n.feature)} less than or equal to ${fmtSig(n.threshold, 4)}, ${n.samples} beats${isCollapsed ? ', collapsed' : ''}`),
        style: { cursor: leaf ? 'default' : 'pointer' },
      }, gNodes);
      svg('rect', { x: -3, y: -3, width: NODE_W + 6, height: NODE_H + 6, rx: 13, class: 'ekc-focus' }, g);
      const col = classColor(n.class);
      const rect = svg('rect', { width: NODE_W, height: NODE_H, rx: 11, style: { fill: 'var(--c-surface)', stroke: leaf ? col : 'var(--c-border)', strokeWidth: leaf ? 1.6 : 1, transition: 'stroke .15s' } }, g);
      if (leaf) svg('rect', { width: NODE_W, height: NODE_H, rx: 11, style: { fill: col, fillOpacity: 0.07, pointerEvents: 'none' } }, g);
      if (n.feature) {
        const t = svg('text', { x: 12, y: 21, style: { fontSize: '11.5px', fontWeight: 650, fill: 'var(--c-text)', fontFamily: 'var(--font-mono, ui-monospace, monospace)' } }, g);
        const fname = String(n.feature);
        svg('tspan', { text: fname.length > 14 ? `${fname.slice(0, 13)}…` : fname }, t);
        svg('tspan', { dx: 4, style: { fill: 'var(--c-accent)' }, text: '≤' }, t);
        svg('tspan', { dx: 4, text: fmtSig(n.threshold, 3) }, t);
      } else {
        const t = svg('text', { x: 12, y: 21, style: { fontSize: '12px', fontWeight: 650, fill: 'var(--c-text)' } }, g);
        svg('tspan', { text: tr('Vorhersage ', 'Predicted ') }, t);
        svg('tspan', { style: { fill: col, fontWeight: 800 }, text: n.class }, t);
      }
      svg('text', { x: 12, y: 39, class: 'ekc-num', style: { fontSize: '10.5px', fill: 'var(--c-muted)' }, text: `n = ${fmt(n.samples)}${n.impurity != null ? ` · Gini ${fmt(n.impurity, 2)}` : ''}` }, g);
      // class distribution bar
      const bx = 12, by = 49, bw = NODE_W - 24, bh = 8;
      svg('rect', { x: bx, y: by, width: bw, height: bh, rx: 3, style: { fill: 'var(--c-surface-2)' } }, g);
      let acc = 0;
      (n.value || []).forEach((v, i) => {
        if (!(v > 0)) return;
        svg('rect', { x: bx + acc * bw, y: by, width: Math.max(0.8, v * bw), height: bh, style: { fill: classColor(classNames[i]) } }, g);
        acc += v;
      });
      svg('rect', { x: bx, y: by, width: bw, height: bh, rx: 3, style: { fill: 'none', stroke: 'var(--c-surface)', strokeWidth: 1 } }, g);
      const top = (n.value || []).map((v, i) => [v, classNames[i]]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0]).slice(0, 2);
      svg('text', { x: 12, y: 71, class: 'ekc-num', style: { fontSize: '10px', fill: 'var(--c-muted)' }, text: top.map(([v, c]) => `${c} ${fmtPct(v, 0)}`).join(' · ') }, g);
      if (!leaf) {
        // expand/collapse affordance
        const bgc = svg('g', { transform: `translate(${NODE_W - 20},${NODE_H - 16})` }, g);
        svg('circle', { r: 8, cx: 8, cy: 6, style: { fill: 'var(--c-surface-2)', stroke: 'var(--c-border)' } }, bgc);
        svg('path', { d: isCollapsed ? 'M4.5 6h7M8 2.5v7' : 'M4.5 6h7', style: { stroke: 'var(--c-text)', strokeWidth: 1.5, strokeLinecap: 'round' } }, bgc);
        if (isCollapsed) {
          const more = descCount(n);
          svg('text', { x: NODE_W - 26, y: NODE_H - 6, 'text-anchor': 'end', style: { fontSize: '9.5px', fill: 'var(--c-accent)', fontWeight: 600 }, text: `+${more}` }, g);
        }
      }
      els.set(`n${n.__k}`, { g, rect, leaf, col });

      const toggle = () => {
        if (leaf) return;
        if (collapsed.has(n.__k)) collapsed.delete(n.__k); else collapsed.add(n.__k);
        focusKey = n.__k;
        tip.hide();
        draw();
      };
      ls.on(g, 'click', toggle);
      ls.on(g, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
        else if (e.key === 'ArrowRight' && !leaf && collapsed.has(n.__k)) { e.preventDefault(); toggle(); }
        else if (e.key === 'ArrowLeft' && !leaf && !collapsed.has(n.__k)) { e.preventDefault(); toggle(); }
      });
      ls.on(g, 'pointerenter', () => setHover(n));
      ls.on(g, 'pointermove', (e) => tip.show(nodeHtml(n), e.clientX, e.clientY));
      ls.on(g, 'pointerleave', () => { setHover(null); tip.hide(); });
      ls.on(g, 'focus', () => { setHover(n); tip.showAt(nodeHtml(n), g); });
      ls.on(g, 'blur', () => { setHover(null); tip.hide(); });
    }
    if (hovered && !pos.has(hovered.__k)) hovered = null;
    applyHover();
    if (focusKey != null) {
      const e = els.get(`n${focusKey}`);
      focusKey = null;
      e?.g.focus({ preventScroll: true });
    }
    if (resetScroll) scroller.scrollLeft = Math.max(0, (W - availW) / 2);
  }

  function setHover(n) { hovered = n; applyHover(); }
  function applyHover() {
    const onPath = new Set();
    for (let c = hovered; c; c = c.__parent) onPath.add(c.__k);
    for (const [key, el] of els) {
      if (key[0] === 'e') {
        const k = Number(key.slice(1));
        const on = onPath.has(k);
        el.style.stroke = on ? 'var(--c-accent)' : 'var(--c-border)';
        el.style.strokeWidth = on ? '2.6' : '1.6';
      } else {
        const k = Number(key.slice(1));
        const on = onPath.has(k);
        el.rect.style.stroke = on ? 'var(--c-accent)' : el.leaf ? el.col : 'var(--c-border)';
        el.rect.style.strokeWidth = on ? '2' : el.leaf ? '1.6' : '1';
        el.g.style.opacity = hovered && !on ? '0.72' : '1';
      }
    }
  }

  let first = true;
  const stop = observeWidth(scroller, (w) => { availW = w - 2; draw(first); first = false; });
  return { destroy() { stop(); ls.clear(); container.replaceChildren(); } };
}
