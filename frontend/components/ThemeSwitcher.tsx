"use client";

import { useEffect, useState } from "react";

type Theme = "khan" | "purple-void" | "tactical";

const THEMES: { id: Theme; label: string; color: string; description: string }[] = [
  { id: "khan", label: "The Great Khan", color: "#2D7DD2", description: "Eternal Blue Sky & Gold" },
  { id: "purple-void", label: "Purple Void", color: "#7C3AED", description: "Deep Space Violet" },
  { id: "tactical", label: "Tactical Command", color: "#22C55E", description: "Gunmetal & Green" },
];

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<Theme>("khan");

  useEffect(() => {
    const saved = localStorage.getItem("demosage-theme") as Theme;
    if (saved && THEMES.find(t => t.id === saved)) {
      applyTheme(saved);
      setTheme(saved);
    }
  }, []);

  const applyTheme = (t: Theme) => {
    const root = document.documentElement;
    if (t === "khan") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", t);
    }
  };

  const handleSelect = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    localStorage.setItem("demosage-theme", t);
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
              className="w-5 h-5 rounded-full flex-shrink-0 ring-2 ring-offset-2"
              style={{
                background: t.color,
                ringColor: theme === t.id ? t.color : "transparent",
                ringOffsetColor: "var(--color-bg-primary)",
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
