"use client";

import { useEffect, useSyncExternalStore } from "react";

type Theme = "khan" | "purple-void" | "tactical";

const THEMES: { id: Theme; label: string; color: string; description: string }[] = [
  { id: "khan", label: "The Great Khan", color: "#2D7DD2", description: "Eternal Blue Sky & Gold" },
  { id: "purple-void", label: "Purple Void", color: "#7C3AED", description: "Deep Space Violet" },
  { id: "tactical", label: "Tactical Command", color: "#22C55E", description: "Gunmetal & Green" },
];

const STORAGE_KEY = "demosage-theme";
const DEFAULT_THEME: Theme = "khan";

function isTheme(value: string | null): value is Theme {
  return value !== null && THEMES.some(t => t.id === value);
}

function applyTheme(t: Theme) {
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

function getSnapshot(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isTheme(saved) ? saved : DEFAULT_THEME;
}

// The server has no localStorage; render the default and let the client reconcile.
function getServerSnapshot(): Theme {
  return DEFAULT_THEME;
}

function storeTheme(t: Theme) {
  localStorage.setItem(STORAGE_KEY, t);
  listeners.forEach(notify => notify());
}

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Syncing the DOM to the selected theme is exactly what an effect is for.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const handleSelect = (t: Theme) => {
    storeTheme(t);
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-text-muted)" }}>
        Interface Theme
      </p>
      <div className="flex flex-col gap-2">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => handleSelect(t.id)}
            className="flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 text-left cursor-pointer"
            style={{
              borderColor: theme === t.id ? t.color : "var(--color-border-primary)",
              background: theme === t.id ? `${t.color}18` : "transparent",
            }}
          >
            <div
              className="w-5 h-5 rounded-full flex-shrink-0"
              style={{
                background: t.color,
                boxShadow: theme === t.id ? `0 0 0 2px var(--color-bg-primary), 0 0 0 4px ${t.color}` : 'none',
              }}
            />
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                {t.label}
              </p>
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                {t.description}
              </p>
            </div>
            {theme === t.id && (
              <span
                className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full"
                style={{ background: `${t.color}25`, color: t.color }}
              >
                Active
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
