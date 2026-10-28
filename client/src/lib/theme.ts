import { useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'rn-theme';
const THEME_COLOR = { light: '#f9f9fb', dark: '#161618' };
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let pref = readPref();
const listeners = new Set<() => void>();

function applyTheme() {
  const theme = pref === 'system' ? (darkQuery.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

export function setThemePref(next: ThemePref) {
  pref = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // 存不下时只在本次会话生效
  }
  applyTheme();
  listeners.forEach((fn) => fn());
}

darkQuery.addEventListener('change', () => {
  if (pref === 'system') applyTheme();
});
applyTheme();

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const useThemePref = () => useSyncExternalStore(subscribe, () => pref);
