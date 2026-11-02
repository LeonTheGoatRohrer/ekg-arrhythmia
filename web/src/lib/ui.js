// Shared UI building blocks for the shell views: diagram cards, empty/error states.
// Diagrams come from ../diagrams/index.js (module ui-diagrams) and are loaded on demand,
// so Mermaid stays out of the initial bundle and a broken diagram never breaks a view.

import { esc, icon } from './dom.js';
import { onVisible } from './lazy.js';

let diagramsModule = null;
/** Lazily import the diagrams module (cached). Rejects if the module fails to load. */
export function loadDiagrams() {
  if (!diagramsModule) {
    diagramsModule = import('../diagrams/index.js').catch((err) => {
      diagramsModule = null;
      throw err;
    });
  }
  return diagramsModule;
}

/** Skeleton placeholder markup. */
export function skeleton(height = '10rem') {
  return `<div class="skeleton w-full" style="height:${height}" aria-hidden="true"></div>`;
}

/** Neutral empty state (used when an optional data file or module is missing). */
export function emptyState(title, text, iconName = 'info') {
  return `<div class="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
    <span class="grid size-9 place-items-center rounded-full border border-line bg-surface-2 text-muted">${icon(iconName)}</span>
    <p class="text-sm font-medium text-fg">${esc(title)}</p>
    ${text ? `<p class="max-w-md text-[13px] leading-relaxed text-muted">${esc(text)}</p>` : ''}
  </div>`;
}

/** Error state with a short technical detail line. */
export function errorState(title, err) {
  const detail = err ? String(err.message || err) : '';
  return `<div class="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center" role="alert">
    <span class="grid size-9 place-items-center rounded-full border border-line bg-surface-2 text-danger">${icon('alert')}</span>
    <p class="text-sm font-medium text-fg">${esc(title)}</p>
    ${detail ? `<p class="max-w-md break-words font-mono text-[11px] text-muted">${esc(detail.slice(0, 240))}</p>` : ''}
  </div>`;
}

/**
 * Markup for a diagram card. Title/caption are filled from DIAGRAMS[id] once mounted.
 * Use together with mountDiagramCard().
 */
export function diagramCard(id, { eyebrow = 'Diagramm', title = '', caption = '', minHeight = '12rem' } = {}) {
  return `<figure class="card overflow-hidden" data-diagram-card="${esc(id)}">
    <div class="card-head">
      <div class="min-w-0">
        <p class="eyebrow">${esc(eyebrow)}</p>
        <p class="mt-0.5 text-sm font-semibold leading-snug text-fg" data-diagram-title>${esc(title)}</p>
      </div>
      <span class="chip chip-mono hidden sm:inline-flex">${icon('git', 'size-3')}${esc(id)}</span>
    </div>
    <div class="diagram-frame" data-diagram-frame style="min-height:${minHeight}">${skeleton(minHeight)}</div>
    <p class="diagram-hint hidden" data-diagram-hint aria-hidden="true">${icon('arrowRight', 'size-3')}Diagramm seitlich verschiebbar</p>
    <figcaption class="border-t border-line px-4 py-3 text-[13px] leading-relaxed text-muted ${caption ? '' : 'hidden'}" data-diagram-caption>${esc(caption)}</figcaption>
  </figure>`;
}

/**
 * Lazily render the diagram inside a card produced by diagramCard().
 * @returns {() => void} cleanup
 */
export function mountDiagramCard(card) {
  const id = card.getAttribute('data-diagram-card');
  const frame = card.querySelector('[data-diagram-frame]');
  let handle = null;
  let disposed = false;
  let ro = null;
  // Show a "scroll sideways" hint when the diagram is wider than its card (narrow screens).
  const hint = card.querySelector('[data-diagram-hint]');
  const updateHint = () => {
    const scroller = [frame, ...frame.querySelectorAll('.ekg-diagram__canvas')].find((el) => el.scrollWidth > el.clientWidth + 4);
    hint?.classList.toggle('hidden', !scroller);
  };
  const watchOverflow = () => {
    updateHint();
    if (!ro && 'ResizeObserver' in window) {
      ro = new ResizeObserver(updateHint);
      ro.observe(frame);
    }
  };
  const cancel = onVisible(card, async () => {
    try {
      const mod = await loadDiagrams();
      if (disposed) return;
      const meta = mod.DIAGRAMS?.[id];
      const titleEl = card.querySelector('[data-diagram-title]');
      const capEl = card.querySelector('[data-diagram-caption]');
      if (meta?.title && titleEl && !titleEl.textContent.trim()) titleEl.textContent = meta.title;
      if (meta?.caption && capEl && !capEl.textContent.trim()) {
        capEl.textContent = meta.caption;
        capEl.classList.remove('hidden');
      }
      frame.innerHTML = '';
      // The card renders title/caption itself, so suppress the module's own caption.
      handle = await mod.renderDiagram(frame, id, { caption: false });
      frame.style.minHeight = '';
      watchOverflow();
    } catch (err) {
      if (disposed) return;
      console.warn(`[ui-shell] diagram "${id}" failed`, err);
      frame.innerHTML = errorState('Diagramm konnte nicht gerendert werden', err);
    }
  });
  return () => {
    disposed = true;
    cancel();
    ro?.disconnect();
    try { handle?.destroy?.(); } catch { /* ignore */ }
  };
}

/** Mount every diagram card inside root; returns a combined cleanup. */
export function mountDiagramCards(root) {
  const cleanups = [...root.querySelectorAll('[data-diagram-card]')].map(mountDiagramCard);
  return () => cleanups.forEach((fn) => fn());
}
