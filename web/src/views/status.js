// Agent status view: reads the central project_state.json (exported copy, or /api/state)
// and shows modules grouped by block with status pills, agent, summary, decisions,
// files (collapsible), tests and progress. Includes the 'agent-orchestration' diagram.

import { loadJSON, clearCache, fetchApi } from '../lib/data.js';
import { esc, icon, fmtTime } from '../lib/dom.js';
import { diagramCard, mountDiagramCard, emptyState, skeleton } from '../lib/ui.js';
import { tr, getLang } from '../lib/i18n.js';

// Status labels [de, en].
const STATUS = {
  planned: ['geplant', 'planned'],
  in_progress: ['in Arbeit', 'in progress'],
  done: ['fertig', 'done'],
  failed: ['fehlgeschlagen', 'failed'],
  blocked: ['blockiert', 'blocked'],
};
const ORDER = ['done', 'in_progress', 'failed', 'blocked', 'planned'];

// English module titles by module id (project_state.json only carries German titles).
const TITLE_EN = {
  'infra-scaffold': 'Repo layout, state protocol, interface contracts, venv/npm',
  'data-loader': 'wfdb data loader, AAMI mapping, DS1/DS2 split, download',
  'signal-filters': 'Baseline removal, bandpass, notch, frequency response',
  'r-peak-detection': 'Pan-Tompkins R-peak detection + validation',
  'beat-segmentation': 'Beat windows, RR features, BeatSet',
  'cnn-model': 'PyTorch 1D CNN with RR fusion + architecture description',
  'tree-baseline': 'Interpretable decision tree + JSON/Mermaid export',
  'training-loop': 'Training loop, class weights, checkpoints',
  'evaluation': 'Confusion matrix, sens/PPV/spec/F1 per AAMI EC57',
  'pipeline-integration': 'End-to-end pipeline, web export, Makefile, README',
  'api-server': 'FastAPI: state, data export, static UI',
  'ui-shell': 'Layout, routing, dark/light, Process view composition',
  'ui-diagrams': 'Mermaid diagrams: pipeline, layers, Pan-Tompkins, decision logic, split',
  'ui-charts': 'SVG visualizations: ECG, filters, beats, confusion matrix, tree',
  'ui-content': 'Step-by-step content of the Process view',
  'ui-integration': 'Build, wiring, screenshot verification (light/dark/mobile)',
  'review-qa': 'Adversarial review: ML correctness, tests, UI, honesty of claims',
  'full-training': 'Training/evaluation on the full MIT-BIH (DS1->DS2)',
};

// English block names (without the "B<n>" code) and project name.
const BLOCK_EN = {
  'Infrastruktur': 'Infrastructure',
  'Daten-Pipeline': 'Data pipeline',
  'ML-Modell': 'ML model',
  'Evaluierung': 'Evaluation',
  'Prozess-UI': 'Process UI',
  'Qualität': 'Quality',
};
const PROJECT_EN = {
  'EKG-Arrhythmie-Erkennung (MIT-BIH, AAMI EC57)': 'ECG arrhythmia detection (MIT-BIH, AAMI EC57)',
};

/** Escaped text in English if a translation exists; otherwise the German original marked lang="de". */
function enOrDe(de, en) {
  if (getLang() !== 'en') return esc(de);
  return en != null ? esc(en) : `<span lang="de">${esc(de)}</span>`;
}

function pill(status) {
  const s = STATUS[status] ? status : 'planned';
  return `<span class="pill pill-${s}">${esc(tr(...STATUS[s]))}</span>`;
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

/** Localized label for the free-text data-status field written by the agents. */
function mitdbLabel(v) {
  if (v == null || v === '') return '–';
  if (v === true) return tr('ja', 'yes');
  if (v === false) return tr('nein', 'no');
  const t = String(v);
  if (/^unavailable/i.test(t)) return /physionet/i.test(t) ? tr('nicht verfügbar (physionet.org gesperrt)', 'unavailable (physionet.org blocked)') : tr('nicht verfügbar', 'unavailable');
  if (/^(available|complete)/i.test(t)) return tr('verfügbar', 'available');
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
  return `<ul class="space-y-1.5 ${cls}">${items.map((d) => `<li class="flex gap-2 text-[15px] leading-relaxed"><span class="mt-[0.6rem] size-1 flex-none rounded-full bg-muted"></span><span class="min-w-0 break-words">${esc(d)}</span></li>`).join('')}</ul>`;
}

/** English count label with naive plural ("1 file", "3 files"). */
function nEn(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function moduleRow(m) {
  const en = getLang() === 'en';
  const decisions = Array.isArray(m.decisions) ? m.decisions : [];
  const files = Array.isArray(m.files) && m.files.length ? m.files : (Array.isArray(m.owns) ? m.owns : []);
  const tests = Array.isArray(m.tests) ? m.tests : [];
  const deps = Array.isArray(m.depends_on) ? m.depends_on : [];
  const notes = (Array.isArray(m.history) ? m.history : []).filter((h) => h.event === 'note' && h.note);
  const hasDetails = decisions.length || files.length || tests.length || notes.length || m.last_error;
  const when = m.finished_at || m.started_at;
  const summaryHtml = m.summary ? `<p class="mt-3 text-[15px] leading-relaxed text-fg/90 break-words">${esc(m.summary)}</p>` : '';
  const errorHtml = m.status === 'failed' && m.last_error ? `<pre class="mt-3 max-h-40 overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs leading-relaxed text-danger whitespace-pre-wrap break-words">${esc(m.last_error)}</pre>` : '';
  const filesHtml = files.length ? `<div class="min-w-0"><p class="eyebrow mb-2">${tr('Dateien', 'Files')}</p><ul class="flex flex-wrap gap-1.5">${files.map((f) => `<li class="max-w-full"><span class="chip chip-mono">${esc(f)}</span></li>`).join('')}</ul></div>` : '';
  const decisionsHtml = decisions.length ? `<div class="min-w-0"><p class="eyebrow mb-2">${tr('Entscheidungen', 'Decisions')}</p><div lang="de">${list(decisions)}</div></div>` : '';
  const testsHtml = tests.length ? `<div class="min-w-0 md:col-span-2"><p class="eyebrow mb-2">Tests</p>${tests.map((t) => `<p lang="de" class="break-words font-mono text-xs leading-relaxed text-muted">${esc(t)}</p>`).join('')}</div>` : '';
  const notesHtml = notes.length ? `<div class="min-w-0 md:col-span-2"><p class="eyebrow mb-2">${tr('Vertrags-Notizen', 'Contract notes')}</p><div lang="de">${list(notes.map((n) => n.note))}</div></div>` : '';

  // German: everything inline as before. English: German free text (summary, error, decisions,
  // tests, notes) goes into a collapsed "Original log entries (as recorded, mostly German)" block.
  const body = en
    ? `${deps.length ? depsHtml(deps) : ''}
    ${files.length ? `<details class="group mt-3">
      <summary class="details-summary inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
        <span class="chev">${icon('chevronRight', 'size-3.5')}</span>Details
        <span class="num text-muted">· ${nEn(files.length, 'file')}</span>
      </summary>
      <div class="mt-3 grid gap-4 rounded-lg border border-line bg-surface-2/60 p-4 md:grid-cols-2">${filesHtml}</div>
    </details>` : ''}
    ${m.summary || errorHtml || decisions.length || tests.length || notes.length ? `<details class="group mt-3">
      <summary class="details-summary inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
        <span class="chev">${icon('chevronRight', 'size-3.5')}</span>Original log entries (as recorded, mostly German)
        <span class="num text-muted">· ${nEn(decisions.length, 'decision')}${tests.length ? ` · ${nEn(tests.length, 'test')}` : ''}</span>
      </summary>
      <div class="mt-3 grid gap-4 rounded-lg border border-line bg-surface-2/60 p-4 md:grid-cols-2">
        ${m.summary || errorHtml ? `<div class="min-w-0 md:col-span-2"><p class="eyebrow mb-2">Summary</p><div lang="de">${m.summary ? `<p class="text-[15px] leading-relaxed text-fg/90 break-words">${esc(m.summary)}</p>` : ''}${errorHtml}</div></div>` : ''}
        ${decisionsHtml}${testsHtml}${notesHtml}
      </div>
    </details>` : ''}`
    : `${summaryHtml}
    ${errorHtml}
    ${deps.length ? depsHtml(deps) : ''}
    ${hasDetails ? `<details class="group mt-3">
      <summary class="details-summary inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
        <span class="chev">${icon('chevronRight', 'size-3.5')}</span>Details
        <span class="num text-muted">· ${decisions.length} Entscheidungen · ${files.length} Dateien${tests.length ? ` · ${tests.length} Tests` : ''}</span>
      </summary>
      <div class="mt-3 grid gap-4 rounded-lg border border-line bg-surface-2/60 p-4 md:grid-cols-2">
        ${decisionsHtml}${filesHtml}${testsHtml}${notesHtml}
      </div>
    </details>` : ''}`;

  return `<li class="px-4 py-4 sm:px-5" data-module="${esc(m.id)}">
    <div class="flex flex-wrap items-start gap-x-3 gap-y-2">
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-[15px] font-semibold text-fg">${esc(m.id)}</span>
          ${pill(m.status)}
        </div>
        <p class="mt-1 text-[15px] text-muted">${enOrDe(m.title || '', TITLE_EN[m.id])}</p>
      </div>
      <div class="flex flex-none flex-col items-end gap-1 text-right">
        ${m.agent ? `<span class="chip">${icon('users', 'size-3')}${esc(m.agent)}</span>` : ''}
        ${when ? `<span class="num text-xs text-muted">${m.finished_at ? tr('fertig', 'finished') : tr('gestartet', 'started')} ${fmtTime(when)}</span>` : ''}
      </div>
    </div>
    ${body}
  </li>`;
}

function depsHtml(deps) {
  return `<div class="mt-3 flex flex-wrap items-center gap-1.5"><span class="text-xs text-muted">${tr('abhängig von', 'depends on')}</span>${deps.map((d) => `<span class="chip chip-mono">${esc(d)}</span>`).join('')}</div>`;
}

function blocksMarkup(modules) {
  const blocks = new Map();
  for (const m of modules) {
    const b = m.block || tr('Ohne Block', 'No block');
    if (!blocks.has(b)) blocks.set(b, []);
    blocks.get(b).push(m);
  }
  return [...blocks.entries()]
    .sort((a, b) => blockSortKey(a[0]) - blockSortKey(b[0]))
    .map(([name, mods]) => {
      const done = mods.filter((m) => m.status === 'done').length;
      const pct = mods.length ? Math.round((done / mods.length) * 100) : 0;
      const code = /^B\d+/.exec(name)?.[0];
      const label = name.replace(/^B\d+\s*/, '');
      const labelEn = BLOCK_EN[label];
      return `<section class="card overflow-hidden" aria-label="${esc(code && labelEn && getLang() === 'en' ? `${code} ${labelEn}` : name)}">
        <div class="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          ${code ? `<span class="grid h-7 min-w-7 place-items-center rounded-md border border-line bg-surface-2 px-1.5 font-mono text-xs font-semibold">${esc(code)}</span>` : ''}
          <h3 class="min-w-0 flex-1 truncate text-[15px] font-semibold">${enOrDe(label, labelEn)}</h3>
          <span class="num text-[13px] text-muted">${done}/${mods.length} ${tr('fertig', 'done')}</span>
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
          <p class="eyebrow">${tr('Gesamtfortschritt', 'Overall progress')}</p>
          <p class="num mt-1 text-4xl font-semibold tracking-tight">${pct}<span class="text-xl text-muted">${tr(' %', '%')}</span></p>
        </div>
        <p class="num text-[15px] text-muted">${tr(`${c.done} von ${modules.length} Modulen fertig`, `${c.done} of ${modules.length} modules done`)}</p>
      </div>
      <div class="bar mt-4 h-2"><span style="width:${pct}%"></span></div>
      <div class="mt-5 flex flex-wrap gap-2">
        ${ORDER.map((s) => `<span class="inline-flex items-center gap-2">${pill(s)}<span class="num text-[15px] font-medium">${c[s]}</span></span>`).join('')}
      </div>
    </div>
    <div class="card p-5 sm:p-6">
      <p class="eyebrow">${tr('Daten & Orchestrierung', 'Data & orchestration')}</p>
      <dl class="mt-3 space-y-2.5 text-[15px]">
        <div class="flex justify-between gap-4"><dt class="text-muted">${tr('MIT-BIH vollständig', 'Full MIT-BIH')}</dt><dd class="text-right font-medium break-words">${esc(mitdbLabel(ds.mitdb_full))}</dd></div>
        <div class="flex justify-between gap-4"><dt class="text-muted">${tr('Lokale Records', 'Local records')}</dt><dd class="text-right font-mono">${esc((ds.sample_records || []).join(', ') || '–')}</dd></div>
        <div class="flex justify-between gap-4"><dt class="text-muted">Orchestrator</dt><dd class="text-right font-mono">${esc(state.orchestrator?.name || '–')}</dd></div>
        <div class="flex justify-between gap-4"><dt class="text-muted">${tr('Max. parallele Agents', 'Max. parallel agents')}</dt><dd class="num text-right">${esc(maxPar ?? '–')}</dd></div>
        <div class="flex justify-between gap-4"><dt class="text-muted">${tr('Aktualisiert', 'Updated')}</dt><dd class="num text-right">${fmtTime(state.updated_at)}</dd></div>
        <div class="flex justify-between gap-4"><dt class="text-muted">${tr('Quelle', 'Source')}</dt><dd class="text-right font-mono text-[13px]">${esc(source)}</dd></div>
      </dl>
    </div>
  </div>`;
}

export async function render(root) {
  root.innerHTML = `
  <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
    <section class="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-10 pt-12 sm:pt-16">
      <div class="min-w-0">
        <p class="eyebrow">${tr('Agenten-Status', 'Agent status')}</p>
        <h1 class="mt-2 text-[32px] font-semibold leading-[1.1] tracking-tight sm:text-[40px]">${tr('Multi-Agenten-Orchestrierung', 'Multi-agent orchestration')}</h1>
        <p class="mt-3 max-w-2xl text-base leading-relaxed text-muted" data-project>${tr(
          'Live-Stand aus der zentralen Status-Datei <code class="font-mono text-sm">project_state.json</code> – jedes Modul wird von genau einem Sub-Agent bearbeitet.',
          'Live state from the central status file <code class="font-mono text-sm">project_state.json</code> – each module is handled by exactly one sub-agent.',
        )}</p>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-refresh>${icon('refresh', 'size-3.5')} ${tr('Aktualisieren', 'Refresh')}</button>
    </section>
    <div class="space-y-10 pt-10">
      <div data-summary>${skeleton('11rem')}</div>
      ${diagramCard('agent-orchestration', { eyebrow: tr('Orchestrierung', 'Orchestration'), minHeight: '14rem' })}
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
      summary.innerHTML = `<div class="card">${emptyState(
        tr('Status-Datei nicht gefunden', 'Status file not found'),
        tr(
          'Weder data/project_state.json noch /api/state ist erreichbar. Die Pipeline kopiert die Datei beim Export nach web/public/data/; alternativ den API-Server starten (python -m ekg.api.server).',
          'Neither data/project_state.json nor /api/state is reachable. The pipeline copies the file to web/public/data/ on export; alternatively, start the API server (python -m ekg.api.server).',
        ),
        'database',
      )}</div>`;
      blocks.innerHTML = '';
      return;
    }
    if (state.project) {
      root.querySelector('[data-project]').innerHTML = tr(
        `<span class="text-fg">${esc(state.project)}</span> – Live-Stand aus der zentralen Status-Datei <code class="font-mono text-sm">project_state.json</code>; jedes Modul wird von genau einem Sub-Agent bearbeitet.`,
        `<span class="text-fg">${enOrDe(state.project, PROJECT_EN[state.project])}</span> – live state from the central status file <code class="font-mono text-sm">project_state.json</code>; each module is handled by exactly one sub-agent.`,
      );
    }
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
