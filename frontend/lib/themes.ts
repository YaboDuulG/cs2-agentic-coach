"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEMES,
  type ThemeDef,
  type ThemeId,
} from "./theme-config";

export { THEMES, DEFAULT_THEME, type ThemeDef, type ThemeId };

function isThemeId(value: string | null): value is ThemeId {
  return value !== null && THEMES.some(t => t.id === value);
}

function applyTheme(t: ThemeId) {
  const root = document.documentElement;
  if (t === DEFAULT_THEME) {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", t);
  }
}

// localStorage is external state, so it's read through a store rather than
// mirrored into component state — avoids the cascading render on mount.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): ThemeId {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return isThemeId(saved) ? saved : DEFAULT_THEME;
}

// The server has no localStorage; render the default and let the client reconcile.
function getServerSnapshot(): ThemeId {
  return DEFAULT_THEME;
}

export function setTheme(t: ThemeId) {
  localStorage.setItem(THEME_STORAGE_KEY, t);
  listeners.forEach(notify => notify());
}

/**
 * Reactive theme access. Any component can read the active theme (and its
 * motif flag) and re-renders when it changes — including changes made in
 * another tab.
 */
export function useTheme(): { theme: ThemeId; def: ThemeDef; setTheme: (t: ThemeId) => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Syncing the DOM to the selected theme is exactly what an effect is for.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const def = THEMES.find(t => t.id === theme) ?? THEMES[0];
  return { theme, def, setTheme };
}
