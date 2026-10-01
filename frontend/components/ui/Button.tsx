"use client";

import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "rank";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element (e.g. a Link) with button styling. */
  asChild?: boolean;
  loading?: boolean;
}

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold select-none " +
  "transition-[background-color,border-color,color,transform] duration-[var(--dur-press)] ease-[var(--ease-out)] " +
  "active:translate-y-px disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-(--color-accent) text-(--color-accent-ink) hover:bg-(--color-accent-hover)",
  secondary:
    "bg-(--color-surface-2) text-(--color-text) border border-(--color-line-strong) hover:border-(--color-focus)",
  ghost: "bg-transparent text-(--color-text-2) hover:text-(--color-text) hover:bg-(--color-surface-2)",
  danger: "bg-transparent text-(--color-danger) border border-(--color-danger)/40 hover:bg-(--color-danger)/10",
  rank: "bg-(--color-rank) text-(--color-accent-ink) hover:brightness-110",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] rounded-(--radius-sm)",
  md: "h-10 px-4 text-sm rounded-(--radius-md)",
  lg: "h-12 px-6 text-[15px] rounded-(--radius-md)",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", asChild, loading, className, children, disabled, ...props },
  ref,
) {
  const cls = cn(base, variants[variant], sizes[size], className);
  // Slot needs exactly one element child, so the spinner is only a `button` feature.
  if (asChild) {
    return (
      <Slot ref={ref} className={cls} aria-busy={loading || undefined} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button ref={ref} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <Spinner size={14} /> : null}
      {children}
    </button>
  );
});

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-block animate-spin rounded-full border-2 border-current border-t-transparent", className)}
      style={{ width: size, height: size }}
    />
  );
}
