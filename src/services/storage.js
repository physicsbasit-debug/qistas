const STORAGE_KEY = 'qistas:v1';
export function clone(value) { return JSON.parse(JSON.stringify(value)); }
export function loadAppData(fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(fallback);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.teachers) || !Array.isArray(parsed.requirements)) return clone(fallback);
    return parsed;
  } catch { return clone(fallback); }
}
export function saveAppData(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
export function clearAppData() { localStorage.removeItem(STORAGE_KEY); }
