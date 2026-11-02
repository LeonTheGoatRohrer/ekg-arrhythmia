// App shell: header (logo, navigation, theme toggle, mobile menu), hash router, footer.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './style.css';

import { initTheme, getTheme, setTheme } from './lib/theme.js';
import { icon, logoMark, esc } from './lib/dom.js';
import * as overview from './views/overview.js';
import * as process from './views/process.js';
import * as status from './views/status.js';

const ROUTES = {
  '': { view: overview, label: 'Übersicht', title: 'Übersicht' },
  process: { view: process, label: 'Process', title: 'Process' },
  status: { view: status, label: 'Agenten-Status', title: 'Agenten-Status' },
};
const NAV = [
  { key: '', href: '#/' },
  { key: 'process', href: '#/process' },
  { key: 'status', href: '#/status' },
];

const THEME_OPTIONS = [
  { value: 'light', label: 'Hell', icon: 'sun' },
  { value: 'dark', label: 'Dunkel', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
];

function shellMarkup() {
  const navLinks = NAV.map((n) => `<a class="nav-link" href="${n.href}" data-nav="${n.key}">${esc(ROUTES[n.key].label)}</a>`).join('');
  const mobileLinks = NAV.map((n) => `<a class="flex items-center justify-between rounded-lg px-3 py-2.5 text-[15px] font-medium text-fg hover:bg-surface-2 aria-[current=page]:bg-surface-2" href="${n.href}" data-nav="${n.key}">${esc(ROUTES[n.key].label)}${icon('chevronRight', 'size-4 text-muted')}</a>`).join('');
  const seg = THEME_OPTIONS.map((o) => `<button type="button" role="radio" aria-checked="false" data-theme-opt="${o.value}" title="${o.label}" aria-label="Farbschema: ${o.label}">${icon(o.icon, 'size-[15px]')}</button>`).join('');
  return `
  <header class="sticky top-0 z-40 border-b border-line backdrop-blur-md" style="background:var(--c-header)">
    <div class="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
      <a href="#/" class="flex min-w-0 items-center gap-2.5" aria-label="EKG-Arrhythmie – Startseite">
        ${logoMark('size-7 flex-none')}
        <span class="truncate text-[15px] font-semibold tracking-tight text-fg">EKG<span class="text-muted">·</span>Arrhythmie</span>
        <span class="hidden rounded-md border border-line px-1.5 py-px font-mono text-[10px] font-medium text-muted lg:inline">MIT-BIH · AAMI</span>
      </a>
      <nav class="ml-4 hidden items-center gap-1 md:flex" aria-label="Hauptnavigation">${navLinks}</nav>
      <div class="ml-auto flex items-center gap-2">
        <div class="seg" role="radiogroup" aria-label="Farbschema">${seg}</div>
        <button type="button" class="grid size-9 place-items-center rounded-lg border border-line bg-surface text-fg md:hidden" data-menu-btn aria-expanded="false" aria-controls="mobile-nav" aria-label="Menü öffnen">
          <span data-menu-icon>${icon('menu', 'size-[18px]')}</span>
        </button>
      </div>
    </div>
    <nav id="mobile-nav" class="hidden border-t border-line bg-surface px-4 py-3 md:hidden" aria-label="Mobile Navigation">
      <div class="flex flex-col gap-1">${mobileLinks}</div>
    </nav>
  </header>
  <main id="main" tabindex="-1" class="outline-none"></main>
  <footer class="mt-24 border-t border-line">
    <div class="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
      <p class="flex items-center gap-2">${logoMark('size-4')}<span>EKG-Arrhythmie-Erkennung · Forschungs-/Lehrprojekt, kein Medizinprodukt.</span></p>
      <p>Daten: MIT-BIH Arrhythmia Database (Moody &amp; Mark, PhysioNet).</p>
    </div>
  </footer>`;
}

// ---------------------------------------------------------------------------
// Router

const app = document.getElementById('app');
app.innerHTML = shellMarkup();
const main = document.getElementById('main');
const mobileNav = document.getElementById('mobile-nav');
const menuBtn = app.querySelector('[data-menu-btn]');

let active = { key: null, cleanup: null, handle: null };
let renderToken = 0;

function parseHash() {
  const raw = (location.hash || '#/').replace(/^#\/?/, '');
  const [path, ...rest] = raw.split('/');
  const key = Object.prototype.hasOwnProperty.call(ROUTES, path) ? path : null;
  return { key, param: rest.join('/') ? decodeURIComponent(rest.join('/')) : null };
}

function setActiveNav(key) {
  app.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.getAttribute('data-nav') === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function route() {
  const { key, param } = parseHash();
  closeMenu();
  if (key === null) {
    location.replace('#/');
    return;
  }
  // Same view, only the parameter changed (e.g. #/process/<step>): let the view handle it.
  if (key === active.key && active.handle?.onParam) {
    active.handle.onParam(param);
    return;
  }
  const token = ++renderToken;
  try { active.cleanup?.(); } catch (err) { console.warn('[ui-shell] cleanup failed', err); }
  active = { key, cleanup: null, handle: null };

  const r = ROUTES[key];
  setActiveNav(key);
  document.title = `${r.title} · EKG-Arrhythmie`;
  main.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'fade-in';
  main.appendChild(container);
  window.scrollTo(0, 0);

  try {
    const handle = await r.view.render(container, { param });
    if (token !== renderToken) { handle?.destroy?.(); return; }
    active.handle = handle || null;
    active.cleanup = () => handle?.destroy?.();
  } catch (err) {
    console.error(`[ui-shell] view "${key}" failed`, err);
    if (token === renderToken) {
      container.innerHTML = `<div class="mx-auto max-w-3xl px-4 py-24 text-center">
        <p class="eyebrow">Fehler</p>
        <h1 class="mt-2 text-xl font-semibold">Diese Ansicht konnte nicht geladen werden.</h1>
        <p class="mt-2 font-mono text-xs text-muted">${esc(err?.message || err)}</p>
      </div>`;
    }
  }
}

// ---------------------------------------------------------------------------
// Mobile menu

function openMenu() {
  mobileNav.classList.remove('hidden');
  menuBtn.setAttribute('aria-expanded', 'true');
  menuBtn.setAttribute('aria-label', 'Menü schließen');
  menuBtn.querySelector('[data-menu-icon]').innerHTML = icon('x', 'size-[18px]');
}
function closeMenu() {
  mobileNav.classList.add('hidden');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-label', 'Menü öffnen');
  menuBtn.querySelector('[data-menu-icon]').innerHTML = icon('menu', 'size-[18px]');
}
menuBtn.addEventListener('click', () => {
  if (mobileNav.classList.contains('hidden')) openMenu();
  else closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !mobileNav.classList.contains('hidden')) { closeMenu(); menuBtn.focus(); }
});
window.matchMedia('(min-width: 768px)').addEventListener?.('change', (e) => { if (e.matches) closeMenu(); });

// ---------------------------------------------------------------------------
// Theme toggle

function syncThemeControls() {
  const pref = getTheme();
  app.querySelectorAll('[data-theme-opt]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.getAttribute('data-theme-opt') === pref));
  });
}
app.querySelectorAll('[data-theme-opt]').forEach((b) => {
  b.addEventListener('click', () => setTheme(b.getAttribute('data-theme-opt')));
});
window.addEventListener('themechange', syncThemeControls);
window.addEventListener('themepreference', syncThemeControls);

// Skip link must not hijack the hash router.
document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  main.focus();
});

initTheme();
syncThemeControls();
window.addEventListener('hashchange', route);
route();
