"use client";

import { Check } from "lucide-react";
import { THEMES, useTheme } from "@/lib/themes";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--color-text-muted)" }}>
        Interface Theme
      </p>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Interface theme">
        {THEMES.map(t => {
          const active = theme === t.id;
          return (
            <button
              key={t.id}
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(t.id)}
              className="ds-btn flex items-center gap-3 p-3 rounded-lg border text-left w-full"
              style={{
                borderColor: active ? t.accent : "var(--color-border-primary)",
                background: active ? `${t.accent}18` : "transparent",
              }}
            >
              <span
                className="w-5 h-5 rounded-full flex-shrink-0"
                style={{
                  background: t.accent,
                  boxShadow: active ? `0 0 0 2px var(--color-bg-primary), 0 0 0 4px ${t.accent}` : "none",
                }}
              />
              <span className="flex-1">
                <span className="block text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                  {t.label}
                </span>
                <span className="block text-xs font-normal" style={{ color: "var(--color-text-muted)" }}>
                  {t.description}
                </span>
              </span>
              {active && <Check size={16} style={{ color: t.accent }} aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
