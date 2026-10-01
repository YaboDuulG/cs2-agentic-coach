"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabItem<K extends string = string> {
  key: K;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<K extends string> {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  /** Name for assistive tech, e.g. "Team hub sections". */
  label: string;
  className?: string;
  size?: "sm" | "md";
}

/**
 * Horizontal section tabs. Scrolls inside itself on narrow screens so the
 * page never scrolls sideways. Proper tablist semantics and arrow-key moves.
 */
export function Tabs<K extends string>({ items, value, onChange, label, className, size = "md" }: TabsProps<K>) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.key === value);
    const next = enabled[(idx + (e.key === "ArrowRight" ? 1 : enabled.length - 1)) % enabled.length];
    if (next) {
      onChange(next.key);
      e.preventDefault();
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("tabstrip border-b hairline", className)}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold transition-colors duration-[var(--dur-fast)]",
              size === "sm" ? "px-3 py-2 text-[13px]" : "px-3.5 py-2.5 text-sm",
              "disabled:opacity-40",
            )}
            style={{ color: active ? "var(--color-text)" : "var(--color-text-2)" }}
          >
            {item.icon}
            {item.label}
            {typeof item.count === "number" ? (
              <span className="num rounded-full px-1.5 text-[11px]" style={{ background: "var(--color-surface-2)", color: "var(--color-text-2)" }}>
                {item.count}
              </span>
            ) : null}
            <span
              aria-hidden="true"
              className="absolute inset-x-2 -bottom-px h-0.5 rounded-full transition-opacity duration-[var(--dur-fast)]"
              style={{ background: "var(--color-accent)", opacity: active ? 1 : 0 }}
            />
          </button>
        );
      })}
    </div>
  );
}
