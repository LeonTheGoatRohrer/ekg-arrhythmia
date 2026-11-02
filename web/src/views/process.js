// Process view (core): composes STEPS (ui-content) + renderDiagram (ui-diagrams) +
// data panels (ui-charts) into a documented, step-by-step walkthrough.
//
// Layout: intro + pipeline overview diagram, then a sticky stepper / table of contents
// with scrollspy (desktop sidebar, mobile sticky dropdown) next to the step cards.
// Diagrams and panels are rendered lazily via IntersectionObserver. Panels are NOT rebuilt
// on 'themechange' (they style themselves through CSS variables); diagrams re-render
// themselves (handled inside ui-diagrams).

import { loadJSON } from '../lib/data.js';
import { esc, icon, reducedMotion } from '../lib/dom.js';
import { onVisible } from '../lib/lazy.js';
import { diagramCard, mountDiagramCard, emptyState, errorState, skeleton } from '../lib/ui.js';

/** PANEL_ID -> render function name in components/index.js, data file, selector, label. */
export const PANELS = {
  ecg: { fn: 'renderEcgChart', dataFile: 'signal_demo.json', label: 'EKG-Signal: roh vs. gefiltert' },
  'pan-tompkins': { fn: 'renderPanTompkins', dataFile: 'signal_demo.json', label: 'Pan-Tompkins-Zwischenstufen' },
  'filter-response': { fn: 'renderFilterResponse', dataFile: 'filter_response.json', label: 'Frequenzgang des Bandpass-Filters' },
  beats: { fn: 'renderBeatGallery', dataFile: 'segmentation_demo.json', label: 'Segmentierte Herzschläge' },
  architecture: { fn: 'renderArchitecture', dataFile: 'architecture.json', label: 'Schichten von ECGNet1D' },
  training: { fn: 'renderTrainingCurve', dataFile: 'metrics.json', select: (d) => d?.cnn?.history ?? null, label: 'Trainingsverlauf (1D-CNN)' },
  confusion: { fn: 'renderConfusionMatrix', dataFile: 'metrics.json', select: (d) => d?.cnn?.summary ?? null, label: 'Konfusionsmatrix (1D-CNN, DS2)' },
  // tree.json only exists after the full DS1 training, which also completes metrics.json.
  // Gate on metrics.json so a pending training does not trigger a (console-logged) 404.
  tree: { fn: 'renderTreeView', dataFile: 'tree.json', gate: 'metrics.json', label: 'Entscheidungsbaum (interaktiv)' },
  dataset: { fn: 'renderDatasetStats', dataFile: 'dataset_stats.json', label: 'Datensatz-Statistik' },
};

const PHASE_TONES = ['--c-accent', '--c-accent-2', '--c-cls-F', '--c-cls-V', '--c-cls-N', '--c-cls-Q'];

const pad2 = (n) => String(n).padStart(2, '0');

function phaseBadge(phase, tone) {
  return `<span class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
    style="color:var(${tone});background:color-mix(in srgb,var(${tone}) 10%,transparent);border:1px solid color-mix(in srgb,var(${tone}) 28%,transparent)">
    <span class="size-1.5 rounded-full" style="background:var(${tone})"></span>${esc(phase)}</span>`;
}

function panelCard(step, panelId) {
  const p = PANELS[panelId];
  const file = step.dataFile || p?.dataFile || '';
  return `<section class="card overflow-hidden" data-panel="${esc(panelId)}" data-step-ref="${esc(step.id)}" aria-label="${esc(p?.label || panelId)}">
    <div class="card-head">
      <div class="min-w-0">
        <p class="eyebrow">Daten</p>
        <p class="mt-0.5 text-sm font-semibold leading-snug">${esc(p?.label || panelId)}</p>
      </div>
      ${file ? `<span class="chip chip-mono flex-none">${icon('database', 'size-3')}${esc(file)}</span>` : ''}
    </div>
    <div class="panel-frame" data-panel-frame>${skeleton('14rem')}</div>
  </section>`;
}

function stepMarkup(step, idx, total, tone, next) {
  const bullets = Array.isArray(step.bullets) && step.bullets.length
    ? `<ul class="grid gap-2 sm:grid-cols-2">${step.bullets.map((b) => `
        <li class="flex gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed">
          <span class="mt-0.5 flex-none text-accent">${icon('check', 'size-3.5')}</span><span class="min-w-0">${b}</span>
        </li>`).join('')}</ul>`
    : '';
  return `<article id="step-${esc(step.id)}" data-step="${esc(step.id)}" class="scroll-mt-10 lg:scroll-mt-2" aria-labelledby="step-title-${esc(step.id)}">
    <header class="flex gap-4">
      <span class="num hidden size-10 flex-none place-items-center rounded-xl border border-line bg-surface font-mono text-[13px] font-semibold text-muted sm:grid">${pad2(idx + 1)}</span>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          ${step.phase ? phaseBadge(step.phase, tone) : ''}
          ${step.kicker ? `<span class="eyebrow">${esc(step.kicker)}</span>` : ''}
          <span class="num ml-auto font-mono text-[11px] text-muted sm:hidden">${pad2(idx + 1)} / ${pad2(total)}</span>
        </div>
        <h2 id="step-title-${esc(step.id)}" class="mt-2 text-[22px] font-semibold leading-tight tracking-tight sm:text-2xl">${esc(step.title)}</h2>
        ${step.summary ? `<p class="mt-2 text-[15px] leading-relaxed text-muted">${esc(step.summary)}</p>` : ''}
      </div>
    </header>
    <div class="mt-6 space-y-6 sm:pl-14">
      ${step.body ? `<div class="prose-step">${step.body}</div>` : ''}
      ${bullets}
      ${step.diagram ? diagramCard(step.diagram, { eyebrow: 'Diagramm' }) : ''}
      ${step.panel ? panelCard(step, step.panel) : ''}
      <div class="flex flex-wrap items-center justify-between gap-3">
        ${step.codeRef ? `<span class="chip chip-mono" title="Quellcode">${icon('code', 'size-3')}${esc(step.codeRef)}</span>` : '<span></span>'}
        ${next ? `<button type="button" class="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg" data-goto="${esc(next.id)}">Weiter: <span class="text-fg">${esc(next.title)}</span>${icon('arrowRight', 'size-3.5')}</button>` : ''}
      </div>
    </div>
  </article>`;
}

function tocMarkup(groups, steps) {
  return groups.map((g) => `
    <div class="mb-4">
      <p class="mb-1.5 flex items-center gap-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span class="size-1.5 rounded-full" style="background:var(${g.tone})"></span>${esc(g.phase || 'Schritte')}
      </p>
      ${g.items.map((s) => `<button type="button" class="toc-link" data-toc="${esc(s.id)}">
        <span class="toc-num">${pad2(steps.indexOf(s) + 1)}</span><span class="min-w-0 pt-px">${esc(s.title)}</span>
      </button>`).join('')}
    </div>`).join('');
}

function groupByPhase(steps) {
  const groups = [];
  const toneOf = new Map();
  for (const s of steps) {
    const key = s.phase || '';
    if (!toneOf.has(key)) toneOf.set(key, PHASE_TONES[toneOf.size % PHASE_TONES.length]);
    let g = groups[groups.length - 1];
    if (!g || g.phase !== key) { g = { phase: key, tone: toneOf.get(key), items: [] }; groups.push(g); }
    g.items.push(s);
  }
  return { groups, toneOf };
}

export async function render(root, { param } = {}) {
  root.innerHTML = `
  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <section class="grid items-start gap-10 border-b border-line pb-12 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
      <div class="lg:sticky lg:top-24">
        <p class="eyebrow">Process</p>
        <h1 class="mt-2 max-w-3xl text-[32px] font-semibold leading-[1.1] tracking-tight sm:text-[42px]">Wie die Klassifikation entsteht – Schritt für Schritt.</h1>
        <p class="mt-4 max-w-2xl text-base leading-relaxed text-muted">Von der Rohdatei über Filterung, R-Zacken-Detektion und Segmentierung bis zum 1D-CNN, Training und zur Inter-Patient-Evaluation. Jede Stufe mit Diagramm, echten Daten aus MIT-BIH-Record 100 und Verweis auf den Quellcode.</p>
        <div class="mt-5 flex flex-wrap gap-2" data-meta></div>
        <ol class="mt-8 grid gap-2 sm:grid-cols-2" data-phases aria-label="Phasen"></ol>
      </div>
      <div class="min-w-0" aria-label="Pipeline-Übersicht">
        ${diagramCard('pipeline-overview', { eyebrow: 'Pipeline-Übersicht', minHeight: '14rem' })}
      </div>
    </section>
    <div class="pt-10" data-steps-root>${skeleton('24rem')}</div>
  </div>`;

  const cleanups = [];
  const panelHandles = new Set();
  let disposed = false;
  const overviewCard = root.querySelector('[data-diagram-card]');
  cleanups.push(mountDiagramCard(overviewCard));

  const stepsRoot = root.querySelector('[data-steps-root]');
  const [stepsRes, compRes] = await Promise.allSettled([
    import('../process/steps.js'),
    import('../components/index.js'),
  ]);

  const destroy = () => {
    disposed = true;
    cleanups.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    panelHandles.forEach((h) => { try { h?.destroy?.(); } catch { /* ignore */ } });
    panelHandles.clear();
  };

  if (stepsRes.status !== 'fulfilled' || !Array.isArray(stepsRes.value?.STEPS)) {
    if (stepsRes.status !== 'fulfilled') console.error('[ui-shell] steps.js failed', stepsRes.reason);
    stepsRoot.innerHTML = `<div class="card">${errorState('Prozessschritte konnten nicht geladen werden', stepsRes.reason || 'STEPS fehlt in src/process/steps.js')}</div>`;
    return { destroy };
  }
  if (compRes.status !== 'fulfilled') console.error('[ui-shell] components/index.js failed', compRes.reason);
  const components = compRes.status === 'fulfilled' ? compRes.value : null;

  const STEPS = stepsRes.value.STEPS.filter((s) => s && s.id && s.title);
  const { groups, toneOf } = groupByPhase(STEPS);
  const total = STEPS.length;

  root.querySelector('[data-meta]').innerHTML = [
    `${total} Schritte`,
    `${groups.filter((g) => g.phase).length || 1} Phasen`,
    `${STEPS.filter((s) => s.diagram).length + 1} Diagramme`,
    `${STEPS.filter((s) => s.panel).length} Daten-Panels`,
  ].map((t) => `<span class="chip num">${esc(t)}</span>`).join('');

  const phaseLabels = new Map((stepsRes.value.PHASES || []).map((p) => [p.id, p.label || p.id]));
  root.querySelector('[data-phases]').innerHTML = groups.map((g, gi) => {
    const first = g.items[0];
    const from = STEPS.indexOf(first) + 1;
    const to = from + g.items.length - 1;
    return `<li><button type="button" class="phase-link" data-goto="${esc(first.id)}">
      <span class="phase-dot" style="--tone:var(${g.tone})">${gi + 1}</span>
      <span class="min-w-0">
        <span class="block truncate text-[13px] font-semibold text-fg">${esc(phaseLabels.get(g.phase) || g.phase || 'Schritte')}</span>
        <span class="num block font-mono text-[11px] text-muted">Schritt ${pad2(from)}${to > from ? `–${pad2(to)}` : ''}</span>
      </span>
      ${icon('arrowRight', 'ml-auto size-3.5 flex-none text-muted')}
    </button></li>`;
  }).join('');

  stepsRoot.innerHTML = `
    <div class="sticky top-14 z-30 -mx-4 mb-8 border-b border-line px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:hidden" style="background:var(--c-header)">
      <details data-mobile-toc class="group">
        <summary class="details-summary flex items-center gap-3 rounded-lg py-1.5 text-sm">
          <span class="toc-num num grid size-6 flex-none place-items-center rounded-full bg-accent font-mono text-[10px] font-semibold text-surface" data-mobile-num>01</span>
          <span class="min-w-0 flex-1 truncate font-medium" data-mobile-title>${esc(STEPS[0]?.title || '')}</span>
          <span class="num font-mono text-[11px] text-muted" data-mobile-count>1 / ${total}</span>
          <span class="chev text-muted">${icon('chevronRight', 'size-4')}</span>
        </summary>
        <nav class="max-h-[60dvh] overflow-y-auto pb-2 pt-3" aria-label="Schritte">${tocMarkup(groups, STEPS)}</nav>
      </details>
    </div>
    <div class="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-14">
      <aside class="hidden lg:block">
        <nav class="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pb-8 pr-1" aria-label="Inhaltsverzeichnis">
          <p class="mb-3 px-2.5 text-[13px] font-semibold">Inhalt</p>
          ${tocMarkup(groups, STEPS)}
          <div class="mx-2.5 mt-2 border-t border-line pt-4">
            <div class="bar"><span data-progress style="width:0%"></span></div>
            <p class="num mt-2 font-mono text-[11px] text-muted" data-progress-label>Schritt 1 von ${total}</p>
          </div>
        </nav>
      </aside>
      <div class="min-w-0 space-y-20" data-steps>
        ${STEPS.map((s, i) => stepMarkup(s, i, total, toneOf.get(s.phase || ''), STEPS[i + 1])).join('')}
      </div>
    </div>`;

  // --- Lazy diagrams in steps ---
  stepsRoot.querySelectorAll('[data-diagram-card]').forEach((card) => cleanups.push(mountDiagramCard(card)));

  // --- Lazy panels ---
  stepsRoot.querySelectorAll('[data-panel]').forEach((card) => {
    const panelId = card.getAttribute('data-panel');
    const step = STEPS.find((s) => s.id === card.getAttribute('data-step-ref'));
    const frame = card.querySelector('[data-panel-frame]');
    const spec = PANELS[panelId];
    cleanups.push(onVisible(card, async () => {
      if (!spec) {
        frame.innerHTML = emptyState('Unbekanntes Panel', `PANEL_ID „${panelId}“ ist nicht definiert.`);
        return;
      }
      const renderFn = components?.[spec.fn];
      if (typeof renderFn !== 'function') {
        frame.innerHTML = errorState('Visualisierung nicht verfügbar', `${spec.fn} fehlt in src/components/index.js`);
        return;
      }
      try {
        let raw;
        if (spec.gate) {
          const gate = await loadJSON(spec.gate);
          // Pending (or missing) prerequisite: hand its status/reason to the empty state.
          raw = gate?.status === 'complete' ? await loadJSON(step?.dataFile || spec.dataFile) : (gate || null);
          if (gate?.status !== 'complete') raw = raw ? { status: 'pending', reason: raw.reason } : null;
        } else {
          raw = await loadJSON(step?.dataFile || spec.dataFile);
        }
        if (disposed) return;
        const data = spec.select ? spec.select(raw) : raw;
        frame.innerHTML = '';
        const handle = renderFn(frame, data ?? null, { panel: panelId, step: step?.id, dataFile: step?.dataFile || spec.dataFile, raw });
        const h = handle && typeof handle.then === 'function' ? await handle : handle;
        if (disposed) { h?.destroy?.(); return; }
        if (h) panelHandles.add(h);
      } catch (err) {
        console.error(`[ui-shell] panel "${panelId}" failed`, err);
        if (!disposed) frame.innerHTML = errorState('Visualisierung konnte nicht gerendert werden', err);
      }
    }, '400px 0px'));
  });

  // --- Navigation / scrollspy ---
  const articles = [...stepsRoot.querySelectorAll('[data-step]')];
  const tocButtons = [...stepsRoot.querySelectorAll('[data-toc]')];
  const mobileToc = stepsRoot.querySelector('[data-mobile-toc]');
  const progress = stepsRoot.querySelector('[data-progress]');
  const progressLabel = stepsRoot.querySelector('[data-progress-label]');
  let currentId = null;

  function setCurrent(id) {
    if (!id || id === currentId) return;
    currentId = id;
    const idx = STEPS.findIndex((s) => s.id === id);
    tocButtons.forEach((b) => {
      if (b.getAttribute('data-toc') === id) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
    });
    // Keep the active entry visible inside the scrollable sidebar.
    const activeDesktop = stepsRoot.querySelector(`aside [data-toc="${CSS.escape(id)}"]`);
    const nav = activeDesktop?.closest('nav');
    if (activeDesktop && nav) {
      const r = activeDesktop.getBoundingClientRect(), nr = nav.getBoundingClientRect();
      if (r.top < nr.top + 40 || r.bottom > nr.bottom - 40) nav.scrollTop += r.top - nr.top - nr.height / 3;
    }
    if (progress) progress.style.width = `${((idx + 1) / total) * 100}%`;
    if (progressLabel) progressLabel.textContent = `Schritt ${idx + 1} von ${total}`;
    const mNum = stepsRoot.querySelector('[data-mobile-num]');
    const mTitle = stepsRoot.querySelector('[data-mobile-title]');
    const mCount = stepsRoot.querySelector('[data-mobile-count]');
    if (mNum) mNum.textContent = pad2(idx + 1);
    if (mTitle) mTitle.textContent = STEPS[idx]?.title || '';
    if (mCount) mCount.textContent = `${idx + 1} / ${total}`;
  }

  if ('IntersectionObserver' in window) {
    const visible = new Set();
    const spy = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = e.target.getAttribute('data-step');
        if (e.isIntersecting) visible.add(id); else visible.delete(id);
      }
      const first = articles.find((a) => visible.has(a.getAttribute('data-step')));
      if (first) setCurrent(first.getAttribute('data-step'));
    }, { rootMargin: '-18% 0px -62% 0px', threshold: 0 });
    articles.forEach((a) => spy.observe(a));
    cleanups.push(() => spy.disconnect());
  }
  setCurrent(STEPS[0]?.id);

  // Lazily rendered diagrams/panels change height while we scroll past them, which would
  // make the target drift. Keep the target "pinned" for a short while and re-align on
  // layout changes, until the user scrolls on their own.
  let pin = null;
  const releasePin = () => { pin = null; };
  const userScrollEvents = ['wheel', 'touchstart', 'keydown', 'mousedown'];
  userScrollEvents.forEach((ev) => window.addEventListener(ev, releasePin, { passive: true }));
  cleanups.push(() => userScrollEvents.forEach((ev) => window.removeEventListener(ev, releasePin)));
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => {
      if (!pin) return;
      if (performance.now() > pin.until) { pin = null; return; }
      pin.target.scrollIntoView({ behavior: 'auto', block: 'start' });
      setCurrent(pin.id);
    });
    ro.observe(stepsRoot.querySelector('[data-steps]'));
    if (overviewCard) ro.observe(overviewCard);
    cleanups.push(() => ro.disconnect());
  }

  function scrollToStep(id, smooth = true) {
    const target = stepsRoot.querySelector(`#step-${CSS.escape(id)}`);
    if (!target) return false;
    target.scrollIntoView({ behavior: smooth && !reducedMotion() ? 'smooth' : 'auto', block: 'start' });
    setCurrent(id);
    pin = { id, target, until: performance.now() + 2500 };
    return true;
  }

  const onNavClick = (e) => {
    const btn = e.target.closest('[data-toc],[data-goto]');
    if (!btn || !root.contains(btn)) return;
    const id = btn.getAttribute('data-toc') || btn.getAttribute('data-goto');
    if (mobileToc) mobileToc.open = false;
    if (scrollToStep(id)) {
      try { history.replaceState(null, '', `#/process/${encodeURIComponent(id)}`); } catch { /* ignore */ }
    }
  };
  root.addEventListener('click', onNavClick);
  cleanups.push(() => root.removeEventListener('click', onNavClick));

  if (param) requestAnimationFrame(() => scrollToStep(param, false));

  return {
    destroy,
    onParam(p) {
      if (p) scrollToStep(p);
      else window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    },
  };
}
