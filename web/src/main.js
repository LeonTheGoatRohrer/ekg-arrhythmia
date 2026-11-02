// App shell: header (logo, navigation, theme + language toggle, mobile menu), hash router, footer.
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './style.css';

import { initTheme, getTheme, setTheme } from './lib/theme.js';
import { t, getLang, setLang } from './lib/i18n.js';
import { icon, logoMark, esc } from './lib/dom.js';
import * as overview from './views/overview.js';
import * as process from './views/process.js';
import * as models from './views/models.js';
import * as status from './views/status.js';

const ROUTES = {
  '': { view: overview, label: 'nav.overview' },
  process: { view: process, label: 'nav.process' },
  modelle: { view: models, label: 'nav.models' },
  status: { view: status, label: 'nav.status' },
};
const NAV = [
  { key: '', href: '#/' },
  { key: 'process', href: '#/process' },
  { key: 'modelle', href: '#/modelle' },
  { key: 'status', href: '#/status' },
];

const THEME_OPTIONS = [
  { value: 'light', label: 'theme.light', icon: 'sun' },
  { value: 'dark', label: 'theme.dark', icon: 'moon' },
  { value: 'system', label: 'theme.system', icon: 'monitor' },
];
const LANG_OPTIONS = [
  { value: 'de', label: 'DE', name: 'Deutsch' },
  { value: 'en', label: 'EN', name: 'English' },
];

// Shell elements carry data-i18n (text), data-i18n-aria (aria-label) and data-i18n-title
// keys, so a language switch only has to re-apply t() instead of rebuilding the shell.
function applyShellText() {
  app.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  app.querySelectorAll('[data-i18n-aria]').forEach((n) => n.setAttribute('aria-label', t(n.dataset.i18nAria)));
  app.querySelectorAll('[data-i18n-title]').forEach((n) => n.setAttribute('title', t(n.dataset.i18nTitle)));
  const skip = document.querySelector('.skip-link');
  if (skip) skip.textContent = t('skip');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
}

function shellMarkup() {
  const navLinks = NAV.map((n) => `<a class="nav-link" href="${n.href}" data-nav="${n.key}" data-i18n="${ROUTES[n.key].label}">${esc(t(ROUTES[n.key].label))}</a>`).join('');
  const mobileLinks = NAV.map((n) => `<a class="mobile-link" href="${n.href}" data-nav="${n.key}"><span data-i18n="${ROUTES[n.key].label}">${esc(t(ROUTES[n.key].label))}</span>${icon('chevronRight', 'size-4 text-muted')}</a>`).join('');
  const seg = THEME_OPTIONS.map((o) => `<button type="button" role="radio" aria-checked="false" data-theme-opt="${o.value}" data-i18n-title="${o.label}" data-i18n-aria="${o.label}" title="${esc(t(o.label))}" aria-label="${esc(t(o.label))}">${icon(o.icon, 'size-4')}</button>`).join('');
  const langSeg = LANG_OPTIONS.map((o) => `<button type="button" role="radio" aria-checked="false" data-lang-opt="${o.value}" lang="${o.value}" title="${o.name}" aria-label="${o.name}">${o.label}</button>`).join('');
  return `
  <header class="sticky top-0 z-40 border-b border-line backdrop-blur-md" style="background:var(--c-header)">
    <div class="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
      <a href="#/" class="flex min-w-0 items-center gap-2.5" data-i18n-aria="nav.home" aria-label="${esc(t('nav.home'))}">
        ${logoMark('size-7 flex-none')}
        <span class="hidden truncate text-base font-semibold tracking-tight text-fg min-[440px]:inline md:hidden lg:inline">EKG<span class="text-muted">·</span>Arrhythmie</span>
        <span class="hidden rounded-md border border-line px-1.5 py-px font-mono text-[11px] font-medium text-muted lg:inline">MIT-BIH · AAMI</span>
      </a>
      <nav class="ml-4 hidden items-center gap-1 md:flex" data-i18n-aria="nav.main" aria-label="${esc(t('nav.main'))}">${navLinks}</nav>
      <div class="ml-auto flex items-center gap-1.5 sm:gap-2">
        <div class="seg seg-lang" role="radiogroup" data-i18n-aria="lang.group" aria-label="${esc(t('lang.group'))}">${langSeg}</div>
        <div class="seg" role="radiogroup" data-i18n-aria="theme.group" aria-label="${esc(t('theme.group'))}">${seg}</div>
        <button type="button" class="grid size-10 place-items-center rounded-lg border border-line bg-surface text-fg transition active:scale-95 md:hidden" data-menu-btn aria-expanded="false" aria-controls="mobile-nav" aria-label="${esc(t('menu.open'))}">
          <span data-menu-icon>${icon('menu', 'size-[18px]')}</span>
        </button>
      </div>
    </div>
    <nav id="mobile-nav" class="hidden border-t border-line bg-surface px-4 py-3 md:hidden" data-i18n-aria="nav.mobile" aria-label="${esc(t('nav.mobile'))}">
      <div class="flex flex-col gap-1">${mobileLinks}</div>
    </nav>
  </header>
  <main id="main" tabindex="-1" class="outline-none"></main>
  <footer class="mt-24 border-t border-line">
    <div class="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-8 text-[15px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
      <p class="flex items-center gap-2">${logoMark('size-4')}<span data-i18n="footer.project">${esc(t('footer.project'))}</span></p>
      <p data-i18n="footer.data">${esc(t('footer.data'))}</p>
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

async function route({ force = false } = {}) {
  const { key, param } = parseHash();
  closeMenu();
  if (key === null) {
    location.replace('#/');
    return;
  }
  // Same view, only the parameter changed (e.g. #/process/<step>): let the view handle it.
  if (!force && key === active.key && active.handle?.onParam) {
    active.handle.onParam(param);
    return;
  }
  const token = ++renderToken;
  try { active.cleanup?.(); } catch (err) { console.warn('[ui-shell] cleanup failed', err); }
  active = { key, cleanup: null, handle: null };

  const r = ROUTES[key];
  setActiveNav(key);
  document.title = `${t(r.label)} · ${getLang() === 'en' ? 'ECG arrhythmia' : 'EKG-Arrhythmie'}`;
  // A language switch re-renders the same view in place; keep the reader's position.
  const keepY = force ? window.scrollY : 0;
  main.innerHTML = '';
  const container = document.createElement('div');
  container.className = force ? '' : 'fade-in';
  main.appendChild(container);
  window.scrollTo(0, 0);

  try {
    const handle = await r.view.render(container, { param });
    if (token !== renderToken) { handle?.destroy?.(); return; }
    active.handle = handle || null;
    active.cleanup = () => handle?.destroy?.();
    if (keepY) window.scrollTo(0, keepY);
  } catch (err) {
    console.error(`[ui-shell] view "${key}" failed`, err);
    if (token === renderToken) {
      container.innerHTML = `<div class="mx-auto max-w-3xl px-4 py-24 text-center">
        <p class="eyebrow">${esc(t('error.eyebrow'))}</p>
        <h1 class="mt-2 text-xl font-semibold">${esc(t('error.view'))}</h1>
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
  menuBtn.setAttribute('aria-label', t('menu.close'));
  menuBtn.querySelector('[data-menu-icon]').innerHTML = icon('x', 'size-[18px]');
}
function closeMenu() {
  mobileNav.classList.add('hidden');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-label', t('menu.open'));
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

// ---------------------------------------------------------------------------
// Language toggle

function syncLangControls() {
  app.querySelectorAll('[data-lang-opt]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.getAttribute('data-lang-opt') === getLang()));
  });
}
app.querySelectorAll('[data-lang-opt]').forEach((b) => {
  b.addEventListener('click', () => setLang(b.getAttribute('data-lang-opt')));
});
window.addEventListener('langchange', () => {
  syncLangControls();
  applyShellText();
  closeMenu();
  route({ force: true });
});

// Skip link must not hijack the hash router.
document.querySelector('.skip-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  main.focus();
});

initTheme();
syncThemeControls();
syncLangControls();
applyShellText();
window.addEventListener('hashchange', route);
route();
