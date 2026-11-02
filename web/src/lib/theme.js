// Theme handling: 'light' | 'dark' | 'system' (preference), persisted in localStorage.
// The effective theme is applied as the `dark` class on <html>; every change dispatches
// `window` event 'themechange' with detail.theme = effective theme ('light' | 'dark')
// and detail.preference = stored preference.

const STORAGE_KEY = 'ekg-theme';
const PREFS = ['light', 'dark', 'system'];
const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

let current = readStored();
let lastEffective = null;

function readStored() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return PREFS.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function writeStored(pref) {
  try {
    if (pref === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* storage unavailable (private mode, blocked): theme still works for this page view */
  }
}

/** Stored preference: 'light' | 'dark' | 'system'. */
export function getTheme() {
  return current;
}

/** Effective theme currently applied: 'light' | 'dark'. */
export function getEffectiveTheme() {
  if (current === 'system') return media && media.matches ? 'dark' : 'light';
  return current;
}

function apply(force = false) {
  const effective = getEffectiveTheme();
  const root = document.documentElement;
  root.classList.toggle('dark', effective === 'dark');
  root.style.colorScheme = effective;
  root.dataset.themePref = current;
  if (force || effective !== lastEffective) {
    lastEffective = effective;
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: effective, preference: current } }));
  } else {
    // Preference changed but effective theme did not: still notify controls.
    window.dispatchEvent(new CustomEvent('themepreference', { detail: { theme: effective, preference: current } }));
  }
}

/** Set the preference and apply it. */
export function setTheme(pref) {
  if (!PREFS.includes(pref)) throw new Error(`unknown theme: ${pref}`);
  current = pref;
  writeStored(pref);
  apply();
}

/** Apply the stored preference and follow OS changes while in 'system' mode. Idempotent. */
let initialised = false;
export function initTheme() {
  if (initialised) return;
  initialised = true;
  lastEffective = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  apply();
  if (media) {
    const onChange = () => { if (current === 'system') apply(); };
    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }
  // Keep tabs in sync.
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) { current = readStored(); apply(); }
  });
}

/** Read a design token from :root, e.g. cssVar('--c-accent'). */
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
