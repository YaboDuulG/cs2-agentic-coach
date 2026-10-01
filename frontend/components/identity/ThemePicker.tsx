"use client";

import { Check } from "lucide-react";
import { THEMES } from "@/lib/theme/config";
import { useTheme } from "@/lib/theme/useTheme";
import { cn } from "@/lib/utils";

/** Three cards (Appearance settings) or three compact rows (user menu). */
export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Interface theme" className={cn(compact ? "flex flex-col gap-1" : "grid gap-3 sm:grid-cols-3")}>
      {THEMES.map((t) => {
        const active = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(t.id)}
            className={cn(
              "flex items-center gap-3 text-left transition-[border-color,background-color] duration-[var(--dur-fast)]",
              compact ? "rounded-(--radius-sm) px-2 py-1.5" : "surface-2 p-3",
            )}
            style={{
              borderColor: active ? "var(--color-focus)" : undefined,
              background: active && compact ? "var(--color-surface-2)" : undefined,
            }}
          >
            <span
              aria-hidden="true"
              className="relative h-7 w-7 shrink-0 overflow-hidden rounded-full"
              style={{ background: t.swatch[0], border: "1px solid var(--color-line-strong)" }}
            >
              <span className="absolute inset-y-0 right-0 w-1/2" style={{ background: t.swatch[1] }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{t.label}</span>
              {!compact ? (
                <span className="block text-[12px]" style={{ color: "var(--color-text-2)" }}>
                  {t.description}
                </span>
              ) : null}
            </span>
            {active ? <Check size={14} style={{ color: "var(--color-focus)" }} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}
