// Language handling: 'de' | 'en', persisted in localStorage. Default: browser language, else German.
// Shared shell strings live in DICT and are read with t(key, vars); module-specific prose uses
// tr(de, en) inline. Both read the current language at call time, so views must call them while
// rendering (not at import time). setLang() sets <html lang> and dispatches window 'langchange'.

const STORAGE_KEY = 'ekg-lang';
const LANGS = ['de', 'en'];

function detect() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (LANGS.includes(v)) return v;
  } catch { /* storage unavailable */ }
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'de';
  return /^en\b/i.test(nav) ? 'en' : 'de';
}

let current = detect();
document.documentElement.lang = current;

/** Current language: 'de' | 'en'. */
export function getLang() {
  return current;
}

/** BCP-47 locale for Intl formatting. */
export function locale() {
  return current === 'en' ? 'en-US' : 'de-DE';
}

/** Set and persist the language; re-rendering is up to 'langchange' listeners. */
export function setLang(lang) {
  if (!LANGS.includes(lang) || lang === current) return;
  current = lang;
  try { window.localStorage.setItem(STORAGE_KEY, lang); } catch { /* storage unavailable */ }
  document.documentElement.lang = lang;
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
}

/** Pick the German or English variant (inline translations). */
export function tr(de, en) {
  return current === 'en' ? en : de;
}

const DICT = {
  de: {
    'nav.overview': 'Übersicht',
    'nav.process': 'Process',
    'nav.models': 'Modelle',
    'nav.status': 'Agenten-Status',
    'nav.main': 'Hauptnavigation',
    'nav.mobile': 'Mobile Navigation',
    'nav.home': 'EKG-Arrhythmie – Startseite',
    'menu.open': 'Menü öffnen',
    'menu.close': 'Menü schließen',
    'theme.group': 'Farbschema',
    'theme.light': 'Hell',
    'theme.dark': 'Dunkel',
    'theme.system': 'System',
    'lang.group': 'Sprache',
    'skip': 'Zum Inhalt springen',
    'footer.project': 'EKG-Arrhythmie-Erkennung · Forschungs-/Lehrprojekt, kein Medizinprodukt.',
    'footer.data': 'Daten: MIT-BIH Arrhythmia Database (Moody & Mark, PhysioNet).',
    'error.eyebrow': 'Fehler',
    'error.view': 'Diese Ansicht konnte nicht geladen werden.',
    'diagram.eyebrow': 'Diagramm',
    'diagram.scroll': 'Diagramm seitlich verschiebbar',
    'diagram.failed': 'Diagramm konnte nicht gerendert werden',
    'meta.description': 'EKG-Arrhythmie-Erkennung auf MIT-BIH (AAMI EC57): Datenpipeline, Pan-Tompkins, 1D-CNN und Entscheidungsbaum – Schritt für Schritt dokumentiert.',
  },
  en: {
    'nav.overview': 'Overview',
    'nav.process': 'Process',
    'nav.models': 'Models',
    'nav.status': 'Agent status',
    'nav.main': 'Main navigation',
    'nav.mobile': 'Mobile navigation',
    'nav.home': 'ECG arrhythmia – home',
    'menu.open': 'Open menu',
    'menu.close': 'Close menu',
    'theme.group': 'Color scheme',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'theme.system': 'System',
    'lang.group': 'Language',
    'skip': 'Skip to content',
    'footer.project': 'ECG arrhythmia detection · research/teaching project, not a medical device.',
    'footer.data': 'Data: MIT-BIH Arrhythmia Database (Moody & Mark, PhysioNet).',
    'error.eyebrow': 'Error',
    'error.view': 'This view could not be loaded.',
    'diagram.eyebrow': 'Diagram',
    'diagram.scroll': 'Scroll the diagram sideways',
    'diagram.failed': 'Diagram could not be rendered',
    'meta.description': 'ECG arrhythmia detection on MIT-BIH (AAMI EC57): data pipeline, Pan-Tompkins, 1D CNN and decision tree – documented step by step.',
  },
};

/** Shared shell string by key; {name} placeholders are filled from vars. Falls back to German, then the key. */
export function t(key, vars) {
  const s = DICT[current][key] ?? DICT.de[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
