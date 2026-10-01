"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isThemeId,
  themeDef,
  type ThemeDef,
  type ThemeId,
} from "./config";

// localStorage is external state: read it through a store so the first client
// render agrees with the bootstrap script and nothing cascades on mount.
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
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function getServerSnapshot(): ThemeId {
  return DEFAULT_THEME;
}

function applyTheme(t: ThemeId) {
  const root = document.documentElement;
  if (t === DEFAULT_THEME) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}

export function setTheme(t: ThemeId) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, t);
  } catch {
    // Private mode: the choice lives for this page only.
  }
  applyTheme(t);
  listeners.forEach((notify) => notify());
}

export function useTheme(): { theme: ThemeId; def: ThemeDef; setTheme: (t: ThemeId) => void } {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return { theme, def: themeDef(theme), setTheme };
}
