// JSON loader for the pipeline -> UI exports in web/public/data/ (served at ./data/).
// Falls back to the FastAPI endpoint /api/data/<name>. Every file is optional:
// on any failure the promise resolves to null (never rejects).

const cache = new Map();
let apiUnavailable = false;

async function tryFetch(url) {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-cache' });
    if (!res.ok) return { ok: false, status: res.status };
    const text = await res.text();
    // Static dev/preview servers may answer with index.html (SPA fallback) – not JSON.
    if (/^\s*</.test(text)) return { ok: false, status: 415 };
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function load(name) {
  const local = await tryFetch('./data/' + name);
  if (local.ok) return local.data;
  if (apiUnavailable) return null;
  const api = await tryFetch('/api/data/' + encodeURIComponent(name));
  if (api.ok) return api.data;
  // Network error / 5xx from the dev proxy: the API server is not running; stop asking.
  if (api.status === 0 || api.status >= 500) apiUnavailable = true;
  return null;
}

/**
 * Load a JSON export by file name (e.g. 'signal_demo.json').
 * Cached per name; resolves to the parsed object or null.
 */
export function loadJSON(name) {
  if (!cache.has(name)) cache.set(name, load(name));
  return cache.get(name);
}

/** Drop cached entries (all, or one name) so the next loadJSON refetches. */
export function clearCache(name) {
  if (name) cache.delete(name);
  else cache.clear();
  apiUnavailable = false;
}

/** Fetch a JSON API endpoint directly (no cache); null on failure. */
export async function fetchApi(path) {
  const r = await tryFetch(path);
  return r.ok ? r.data : null;
}
