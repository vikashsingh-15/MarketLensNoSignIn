export type Theme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'marketlens-theme';

export function getStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch { return null; }
}

export function getInitialTheme(): Theme {
  const stored = getStoredTheme();
  if (stored) return stored;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function toggleTheme(): Theme {
  const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* storage unavailable */ }
  return next;
}
