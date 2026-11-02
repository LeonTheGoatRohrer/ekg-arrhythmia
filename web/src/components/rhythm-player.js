// Rhythm player: a 60 s stretch of filtered ECG (rhythm_demo.json) written like a bedside
// monitor. The pen runs in real time; beats carry their expert AAMI label, abnormal beats
// are highlighted and can be jumped to. Labels are annotations, not model output.

import { esc, fmt, clamp, observeWidth, listeners, renderMissingExport, CLASS_LABELS, classColor } from './shared.js';
import { icon, reducedMotion } from '../lib/dom.js';

const VIEW_S = 6; // seconds visible in the strip
const H = 170, PAD_Y = 22, MINI_H = 34;

const DESCRIPTION = {
  N: 'Normaler Schlag: regelmäßiger Abstand, schmaler QRS-Komplex.',
  S: 'Supraventrikulärer Extraschlag: kommt zu früh aus dem Vorhof, der QRS-Komplex bleibt meist schmal – verrät sich vor allem über den kurzen RR-Abstand.',
  V: 'Ventrikulärer Extraschlag: entsteht in der Herzkammer, QRS breit und verformt, danach eine längere Pause.',
  F: 'Fusionsschlag: normaler und ventrikulärer Schlag verschmelzen zu einer Mischform.',
  Q: 'Nicht klassifizierbarer Schlag.',
};

function clockLabel(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function renderRhythmPlayer(container, data) {
  const sig = Array.isArray(data?.filtered) ? data.filtered : null;
  if (!sig || sig.length < 10 || !data.fs) {
    return renderMissingExport(container, {}, { title: 'Rhythmus-Export fehlt', file: 'rhythm_demo.json', iconName: 'pulse', name: 'rhythm' });
  }
  const fs = Number(data.fs);
  const dur = sig.length / fs;
  const beats = (data.beats || []).filter((b) => Number.isFinite(b.t));
  const events = beats.filter((b) => b.aami !== 'N');
  let lo = Infinity, hi = -Infinity;
  for (const v of sig) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;

  container.innerHTML = `
    <div class="ecg-paper relative">
      <svg data-strip class="block w-full" style="height:${H}px" role="img" aria-label="Laufendes EKG, Record ${esc(data.record)}"></svg>
    </div>
    <div class="flex min-h-[4.25rem] items-start gap-3 border-t border-line px-4 py-3" aria-live="polite" data-now></div>
    <div class="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
      <button type="button" class="btn btn-primary btn-sm" data-play></button>
      <button type="button" class="btn btn-ghost btn-sm" data-prev aria-label="Vorherige Auffälligkeit">${icon('chevronRight', 'size-3.5 rotate-180')}Vorherige</button>
      <button type="button" class="btn btn-ghost btn-sm" data-next aria-label="Nächste Auffälligkeit">Nächste ${icon('chevronRight', 'size-3.5')}</button>
      <span class="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden="true"></span>
      <span class="text-[12px] text-muted">Springe zu:</span>
      <button type="button" class="chip hover:border-accent/50" data-jump="0">${dot('N')}Normal · 0:00</button>
      ${events.map((e) => `<button type="button" class="chip hover:border-accent/50" data-jump="${e.t}" title="${esc(CLASS_LABELS[e.aami] || e.aami)} bei ${fmt(e.t, 1)} s">${dot(e.aami)}${esc(e.aami)} · ${clockLabel(e.t)}</button>`).join('')}
    </div>
    <div class="border-t border-line px-4 pb-3 pt-2.5">
      <svg data-mini class="block w-full cursor-pointer touch-none" style="height:${MINI_H}px" role="slider" tabindex="0"
        aria-label="Position im Ausschnitt" aria-valuemin="0" aria-valuemax="${Math.round(dur)}"></svg>
      <p class="mt-1.5 flex flex-wrap justify-between gap-2 text-[11.5px] text-muted">
        <span>Gesamter Ausschnitt: ${fmt(dur, 0)} s ab ${clockLabel(data.start_s)} im Record · Farben = Expertenannotation (AAMI)</span>
        <span class="num" data-pos></span>
      </p>
    </div>`;

  const strip = container.querySelector('[data-strip]');
  const mini = container.querySelector('[data-mini]');
  const nowBox = container.querySelector('[data-now]');
  const posLabel = container.querySelector('[data-pos]');
  const playBtn = container.querySelector('[data-play]');
  const ls = listeners();

  let W = 640;
  let cur = Math.min(0.6, dur); // pen position in seconds
  let playing = !reducedMotion();
  let raf = 0, last = 0, shownBeat = undefined;
  let focus = null; // beat explained after a jump, until playback resumes

  const yOf = (v) => PAD_Y + (1 - (v - lo) / span) * (H - 2 * PAD_Y);

  function drawStrip() {
    const t0 = cur - VIEW_S;
    const xOf = (t) => ((t - t0) / VIEW_S) * (W - 8);
    const i0 = Math.max(0, Math.floor(t0 * fs)), i1 = Math.min(sig.length - 1, Math.floor(cur * fs));
    const pts = [];
    for (let i = i0; i <= i1; i++) pts.push(`${xOf(i / fs).toFixed(1)},${yOf(sig[i]).toFixed(1)}`);
    const marks = beats.filter((b) => b.t >= t0 && b.t <= cur).map((b) => {
      const x = xOf(b.t).toFixed(1), c = classColor(b.aami);
      if (b.aami === 'N') return `<text x="${x}" y="13" text-anchor="middle" font-size="10" font-family="var(--font-mono, monospace)" fill="var(--c-muted)">N</text>`;
      const bw = (0.7 / VIEW_S) * (W - 8);
      return `<rect x="${(xOf(b.t) - bw / 2).toFixed(1)}" y="2" width="${bw.toFixed(1)}" height="${H - 4}" rx="6" fill="color-mix(in srgb, ${c} 14%, transparent)" stroke="${c}" stroke-opacity=".45"/>
        <text x="${x}" y="14" text-anchor="middle" font-size="11" font-weight="700" font-family="var(--font-mono, monospace)" fill="${c}">${esc(b.aami)}</text>`;
    }).join('');
    const penX = xOf(cur).toFixed(1), penY = yOf(sig[i1]).toFixed(1);
    strip.setAttribute('viewBox', `0 0 ${W} ${H}`);
    strip.innerHTML = `${marks}
      <polyline points="${pts.join(' ')}" fill="none" stroke="var(--c-filtered)" stroke-width="1.6" stroke-linejoin="round"/>
      <line x1="${penX}" x2="${penX}" y1="0" y2="${H}" stroke="var(--c-muted)" stroke-opacity=".35" stroke-dasharray="3 3"/>
      <circle cx="${penX}" cy="${penY}" r="4" fill="var(--c-filtered)" stroke="var(--c-surface)" stroke-width="2"/>`;
  }

  let miniStatic = '';
  function buildMiniStatic() {
    const step = Math.max(1, Math.floor(sig.length / W));
    const pts = [];
    for (let i = 0; i < sig.length; i += step) {
      pts.push(`${((i / sig.length) * W).toFixed(1)},${(4 + (1 - (sig[i] - lo) / span) * (MINI_H - 8)).toFixed(1)}`);
    }
    miniStatic = `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--c-muted)" stroke-opacity=".55" stroke-width="1"/>
      ${events.map((e) => `<rect x="${((e.t / dur) * W - 1.5).toFixed(1)}" y="0" width="3" height="${MINI_H}" rx="1.5" fill="${classColor(e.aami)}"><title>${esc(e.aami)} bei ${fmt(e.t, 1)} s</title></rect>`).join('')}`;
  }

  function drawMini() {
    const x0 = (Math.max(0, cur - VIEW_S) / dur) * W, x1 = (cur / dur) * W;
    mini.setAttribute('viewBox', `0 0 ${W} ${MINI_H}`);
    mini.innerHTML = `<rect x="${x0.toFixed(1)}" y="0" width="${Math.max(2, x1 - x0).toFixed(1)}" height="${MINI_H}" rx="4" fill="color-mix(in srgb, var(--c-filtered) 12%, transparent)" stroke="var(--c-filtered)" stroke-opacity=".5"/>${miniStatic}`;
    mini.setAttribute('aria-valuenow', String(Math.round(cur)));
    mini.setAttribute('aria-valuetext', `${fmt(cur, 1)} Sekunden`);
    posLabel.textContent = `${fmt(cur, 1)} s / ${fmt(dur, 0)} s`;
  }

  function updateNow() {
    // the beat just written by the pen (its QRS needs ~0.2 s to appear)
    const b = focus || [...beats].reverse().find((x) => x.t <= cur - 0.2) || null;
    if (b === shownBeat) return;
    shownBeat = b;
    if (!b) { nowBox.innerHTML = `<p class="text-[13px] text-muted">Der Schreiber startet …</p>`; return; }
    const c = classColor(b.aami);
    nowBox.innerHTML = `<span class="grid size-8 flex-none place-items-center rounded-lg font-mono text-sm font-semibold" style="color:${c};background:color-mix(in srgb,${c} 12%,transparent);border:1px solid color-mix(in srgb,${c} 30%,transparent)">${esc(b.aami)}</span>
      <span class="min-w-0">
        <span class="block text-[13px] font-semibold text-fg">${esc(CLASS_LABELS[b.aami] || b.aami)} <span class="font-normal text-muted">· Symbol „${esc(b.symbol)}“ bei ${fmt(b.t, 1)} s</span></span>
        <span class="mt-0.5 block text-[12.5px] leading-snug text-muted">${esc(DESCRIPTION[b.aami] || '')}</span>
      </span>`;
  }

  function draw() { drawStrip(); drawMini(); updateNow(); }

  function setPlaying(p) {
    playing = p;
    playBtn.innerHTML = p
      ? `<svg class="size-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>Pause`
      : `<svg class="size-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l11-7z"/></svg>Abspielen`;
    cancelAnimationFrame(raf);
    if (p) { focus = null; last = 0; raf = requestAnimationFrame(tick); }
  }

  function tick(ts) {
    if (last) cur += (ts - last) / 1000;
    last = ts;
    if (cur >= dur) cur = 0.6; // loop
    draw();
    raf = requestAnimationFrame(tick);
  }

  /** Show the beat with some signal after it, then hold and explain it. */
  function jumpTo(beat) {
    cur = clamp(beat.t + 1.6, Math.min(0.6, dur), dur);
    setPlaying(false);
    focus = beat;
    draw();
  }

  function stepEvent(dir) {
    const ref = cur - 1.6;
    const target = dir > 0 ? events.find((e) => e.t > ref + 0.05) ?? events[0] : [...events].reverse().find((e) => e.t < ref - 0.05) ?? events[events.length - 1];
    if (target) jumpTo(target);
  }

  ls.on(playBtn, 'click', () => setPlaying(!playing));
  ls.on(container.querySelector('[data-prev]'), 'click', () => stepEvent(-1));
  ls.on(container.querySelector('[data-next]'), 'click', () => stepEvent(1));
  container.querySelectorAll('[data-jump]').forEach((b) => {
    ls.on(b, 'click', () => {
      const t = Number(b.getAttribute('data-jump'));
      if (t === 0) { cur = Math.min(0.6, dur); setPlaying(true); } else jumpTo(events.find((e) => e.t === t));
    });
  });
  const seek = (e) => {
    const r = mini.getBoundingClientRect();
    cur = clamp(((e.clientX - r.left) / r.width) * dur, 0.2, dur);
    focus = null;
    draw();
  };
  ls.on(mini, 'pointerdown', (e) => { mini.setPointerCapture(e.pointerId); seek(e); });
  ls.on(mini, 'pointermove', (e) => { if (mini.hasPointerCapture(e.pointerId)) seek(e); });
  ls.on(mini, 'keydown', (e) => {
    const d = { ArrowLeft: -1, ArrowRight: 1, PageDown: -VIEW_S, PageUp: VIEW_S }[e.key];
    if (d == null) return;
    e.preventDefault();
    cur = clamp(cur + d, 0.2, dur);
    focus = null;
    draw();
  });

  const stopObserve = observeWidth(strip, (w) => { W = w; buildMiniStatic(); draw(); });
  setPlaying(playing);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      stopObserve();
      ls.clear();
    },
  };
}

function dot(cls) {
  return `<span class="size-2 rounded-full" style="background:${classColor(cls)}" aria-hidden="true"></span>`;
}
