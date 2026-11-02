// Agent status view: reads the central project_state.json (exported copy, or /api/state)
// and shows modules grouped by block with status pills, agent, summary, decisions,
// files (collapsible), tests and progress. Includes the 'agent-orchestration' diagram.

import { loadJSON, clearCache, fetchApi } from '../lib/data.js';
import { esc, icon, fmtTime } from '../lib/dom.js';
import { diagramCard, mountDiagramCard, emptyState, skeleton } from '../lib/ui.js';

const STATUS = {
  planned: 'geplant',
  in_progress: 'in Arbeit',
  done: 'fertig',
  failed: 'fehlgeschlagen',
  blocked: 'blockiert',
};
const ORDER = ['done', 'in_progress', 'failed', 'blocked', 'planned'];

function pill(status) {
  const s = STATUS[status] ? status : 'planned';
  return `<span class="pill pill-${s}">${esc(STATUS[s])}</span>`;
}

async function loadState(fresh = false) {
  if (fresh) clearCache('project_state.json');
  // Live state from the API first (always current); the exported copy in data/ is only a
  // snapshot for static hosting without the FastAPI server.
  const fromApi = await fetchApi('/api/state');
  if (fromApi && Array.isArray(fromApi.modules)) return { state: fromApi, source: '/api/state (live)' };
  const fromFile = await loadJSON('project_state.json');
  if (fromFile && Array.isArray(fromFile.modules)) return { state: fromFile, source: 'data/project_state.json (Snapshot)' };
  return { state: null, source: null };
}

/** German label for the free-text data-status field written by the agents. */
function mitdbLabel(v) {
  if (v == null || v === '') return '–';
  if (v === true) return 'ja';
  if (v === false) return 'nein';
  const t = String(v);
  if (/^unavailable/i.test(t)) return /physionet/i.test(t) ? 'nicht verfügbar (physionet.org gesperrt)' : 'nicht verfügbar';
  if (/^(available|complete)/i.test(t)) return 'verfügbar';
  return t;
}

function countBy(modules) {
  const c = Object.fromEntries(Object.keys(STATUS).map((k) => [k, 0]));
  for (const m of modules) c[STATUS[m.status] ? m.status : 'planned'] += 1;
  return c;
}

function blockSortKey(name) {
  const m = /^B(\d+)/.exec(name || '');
  return m ? Number(m[1]) : 99;
}

function list(items, cls = '') {
  return `<ul class="space-y-1.5 ${cls}">${items.map((d) => `<li class="flex gap-2 text-[13px] leading-relaxed"><span class="mt-[0.6rem] size-1 flex-none rounded-full bg-muted"></span><span class="min-w-0 break-words">${esc(d)}</span></li>`).join('')}</ul>`;
}

function moduleRow(m) {
  const decisions = Array.isArray(m.decisions) ? m.decisions : [];
  const files = Array.isArray(m.files) && m.files.length ? m.files : (Array.isArray(m.owns) ? m.owns : []);
  const tests = Array.isArray(m.tests) ? m.tests : [];
  const deps = Array.isArray(m.depends_on) ? m.depends_on : [];
  const notes = (Array.isArray(m.history) ? m.history : []).filter((h) => h.event === 'note' && h.note);
  const hasDetails = decisions.length || files.length || tests.length || notes.length || m.last_error;
  const when = m.finished_at || m.started_at;
  return `<li class="px-4 py-4 sm:px-5" data-module="${esc(m.id)}">
    <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-[13px] font-semibold text-fg">${esc(m.id)}</span>
          ${pill(m.status)}
        </div>
        <p class="mt-1 text-[13px] text-muted">${esc(m.title || '')}</p>
      </div>
      <div class="flex flex-none flex-col items-end gap-1 text-right">
        ${m.agent ? `<span class="chip">${icon('users', 'size-3')}${esc(m.agent)}</span>` : ''}
        ${when ? `<span class="num text-[11px] text-muted">${m.finished_at ? 'fertig' : 'gestartet'} ${fmtTime(when)}</span>` : ''}
      </div>
    </div>
    ${m.summary ? `<p class="mt-3 text-[13px] leading-relaxed text-fg/90 break-words">${esc(m.summary)}</p>` : ''}
    ${m.status === 'failed' && m.last_error ? `<pre class="mt-3 max-h-40 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-[11px] leading-relaxed text-danger whitespace-pre-wrap break-words">${esc(m.last_error)}</pre>` : ''}
    ${deps.length ? `<div class="mt-3 flex flex-wrap items-center gap-1.5"><span class="text-[11px] text-muted">abhängig von</span>${deps.map((d) => `<span class="chip chip-mono">${esc(d)}</span>`).join('')}</div>` : ''}
    ${hasDetails ? `<details class="group mt-3">
      <summary class="details-summary inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-fg">
        <span class="chev">${icon('chevronRight', 'size-3.5')}</span>Details
        <span class="num text-muted">· ${decisions.length} Entscheidungen · ${files.length} Dateien${tests.length ? ` · ${tests.length} Tests` : ''}</span>
      </summary>
      <div class="mt-3 grid gap-4 rounded-lg border border-line bg-surface-2/60 p-4 md:grid-cols-2">
        ${decisions.length ? `<div class="min-w-0"><p class="eyebrow mb-2">Entscheidungen</p>${list(decisions)}</div>` : ''}
        ${files.length ? `<div class="min-w-0"><p class="eyebrow mb-2">Dateien</p><ul class="flex flex-wrap gap-1.5">${files.map((f) => `<li class="max-w-full"><span class="chip chip-mono">${esc(f)}</span></li>`).join('')}</ul></div>` : ''}
        ${tests.length ? `<div class="min-w-0 md:col-span-2"><p class="eyebrow mb-2">Tests</p>${tests.map((t) => `<p class="break-words font-mono text-[11px] leading-relaxed text-muted">${esc(t)}</p>`).join('')}</div>` : ''}
        ${notes.length ? `<div class="min-w-0 md:col-span-2"><p class="eyebrow mb-2">Vertrags-Notizen</p>${list(notes.map((n) => n.note))}</div>` : ''}
      </div>
    </details>` : ''}
  </li>`;
}

function blocksMarkup(modules) {
  const blocks = new Map();
  for (const m of modules) {
    const b = m.block || 'Ohne Block';
    if (!blocks.has(b)) blocks.set(b, []);
    blocks.get(b).push(m);
  }
  return [...blocks.entries()]
    .sort((a, b) => blockSortKey(a[0]) - blockSortKey(b[0]))
    .map(([name, mods]) => {
      const done = mods.filter((m) => m.status === 'done').length;
      const pct = mods.length ? Math.round((done / mods.length) * 100) : 0;
      const code = /^B\d+/.exec(name)?.[0];
      return `<section class="card overflow-hidden" aria-label="${esc(name)}">
        <div class="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          ${code ? `<span class="grid h-7 min-w-7 place-items-center rounded-md border border-line bg-surface-2 px-1.5 font-mono text-[11px] font-semibold">${esc(code)}</span>` : ''}
          <h3 class="min-w-0 flex-1 truncate text-[15px] font-semibold">${esc(name.replace(/^B\d+\s*/, ''))}</h3>
          <span class="num text-[12px] text-muted">${done}/${mods.length} fertig</span>
          <div class="bar w-full sm:w-32"><span style="width:${pct}%"></span></div>
        </div>
        <ul class="divide-y divide-line">${mods.map(moduleRow).join('')}</ul>
      </section>`;
    }).join('');
}

function summaryMarkup(state, source) {
  const modules = state.modules;
  const c = countBy(modules);
  const pct = modules.length ? Math.round((c.done / modules.length) * 100) : 0;
  const ds = state.data_status || {};
  const maxPar = state.orchestrator?.max_parallel_agents;
  return `<div class="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
    <div class="card p-5 sm:p-6">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p class="eyebrow">Gesamtfortschritt</p>
          <p class="num mt-1 text-4xl font-semibold tracking-tight">${pct}<span class="text-xl text-muted"> %</span></p>
        </div>
        <p class="num text-[13px] text-muted">${c.done} von ${modules.length} Modulen fertig</p>
      </div>
      <div class="bar mt-4 h-2"><span style="width:${pct}%"></span></div>
      <div class="mt-5 flex flex-wrap gap-2">
        ${ORDER.map((s) => `<span class="inline-flex items-center gap-2">${pill(s)}<span class="num text-[13px] font-medium">${c[s]}</span></span>`).join('')}
      </div>
    </div>
    <div class="card p-5 sm:p-6">
      <p class="eyebrow">Daten & Orchestrierung</p>
      <dl class="mt-3 space-y-2.5 text-[13px]">
        <div class="flex justify-between gap-4"><dt class="text-muted">MIT-BIH vollständig</dt><dd class="text-right font-medium break-words">${esc(mitdbLabel(ds.mitdb_full))}</dd></div>
        <div class="flex justify-between gap-4"><dt class="text-muted">Lokale Records</dt><dd class="text-right font-mono">${esc((ds.sample_records || []).join(', ') || '–')}</dd></div>
        <div class="flex justify-between gap-4"><dt class="text-muted">Orchestrator</dt><dd class="text-right font-mono">${esc(state.orchestrator?.name || '–')}</dd></div>
        <div class="flex justify-between gap-4"><dt class="text-muted">Max. parallele Agents</dt><dd class="num text-right">${esc(maxPar ?? '–')}</dd></div>
        <div class="flex justify-between gap-4"><dt class="text-muted">Aktualisiert</dt><dd class="num text-right">${fmtTime(state.updated_at)}</dd></div>
        <div class="flex justify-between gap-4"><dt class="text-muted">Quelle</dt><dd class="text-right font-mono text-[12px]">${esc(source)}</dd></div>
      </dl>
    </div>
  </div>`;
}

export async function render(root) {
  root.innerHTML = `
  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <section class="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-10 pt-12 sm:pt-16">
      <div class="min-w-0">
        <p class="eyebrow">Agenten-Status</p>
        <h1 class="mt-2 text-[32px] font-semibold leading-[1.1] tracking-tight sm:text-[40px]">Multi-Agenten-Orchestrierung</h1>
        <p class="mt-3 max-w-2xl text-base leading-relaxed text-muted" data-project>Live-Stand aus der zentralen Status-Datei <code class="font-mono text-sm">project_state.json</code> – jedes Modul wird von genau einem Sub-Agent bearbeitet.</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-refresh>${icon('refresh', 'size-3.5')} Aktualisieren</button>
    </section>
    <div class="space-y-10 pt-10">
      <div data-summary>${skeleton('11rem')}</div>
      ${diagramCard('agent-orchestration', { eyebrow: 'Orchestrierung', minHeight: '14rem' })}
      <div class="space-y-5" data-blocks>${skeleton('20rem')}</div>
    </div>
  </div>`;

  const cleanupDiagram = mountDiagramCard(root.querySelector('[data-diagram-card]'));
  let alive = true;

  async function refresh(fresh) {
    const btn = root.querySelector('[data-refresh]');
    btn.disabled = true;
    const { state, source } = await loadState(fresh);
    if (!alive) return;
    btn.disabled = false;
    const summary = root.querySelector('[data-summary]');
    const blocks = root.querySelector('[data-blocks]');
    if (!state) {
      summary.innerHTML = `<div class="card">${emptyState('Status-Datei nicht gefunden', 'Weder data/project_state.json noch /api/state ist erreichbar. Die Pipeline kopiert die Datei beim Export nach web/public/data/; alternativ den API-Server starten (python -m ekg.api.server).', 'database')}</div>`;
      blocks.innerHTML = '';
      return;
    }
    if (state.project) root.querySelector('[data-project]').innerHTML = `<span class="text-fg">${esc(state.project)}</span> – Live-Stand aus der zentralen Status-Datei <code class="font-mono text-sm">project_state.json</code>; jedes Modul wird von genau einem Sub-Agent bearbeitet.`;
    summary.innerHTML = summaryMarkup(state, source);
    blocks.innerHTML = blocksMarkup(state.modules);
  }

  const onRefresh = () => refresh(true);
  root.querySelector('[data-refresh]').addEventListener('click', onRefresh);
  await refresh(false);

  return {
    destroy() {
      alive = false;
      cleanupDiagram();
    },
  };
}
