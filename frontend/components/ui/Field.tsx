"use client";

import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-(--radius-md) border bg-(--color-bg-2) px-3 py-2 text-sm placeholder:text-(--color-text-3) " +
  "transition-[border-color] duration-[var(--dur-fast)] focus:border-(--color-focus) focus:outline-none disabled:opacity-50";

export function Label({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold">
        {children}
      </label>
      {hint ? (
        <span className="text-[12px]" style={{ color: "var(--color-text-3)" }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  function Input({ className, mono, ...props }, ref) {
    return <input ref={ref} className={cn(control, "hairline", mono && "num", className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, ...props },
  ref,
) {
  return <select ref={ref} className={cn(control, "hairline", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }>(
  function Textarea({ className, mono, ...props }, ref) {
    return <textarea ref={ref} className={cn(control, "hairline min-h-24 resize-y", mono && "num", className)} {...props} />;
  },
);

export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p className="mt-1.5 text-[12px]" style={{ color: "var(--color-danger)" }} role="alert">
      {children}
    </p>
  );
}

/** Toggle switch with a real checkbox underneath. */
export function Switch({
  id,
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3", disabled && "opacity-50")}>
      <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center">
        <input
          id={id}
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full transition-colors duration-[var(--dur-fast)]"
          style={{ background: checked ? "var(--color-accent)" : "var(--color-line-strong)" }}
        />
        <span
          aria-hidden="true"
          className="absolute left-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-[var(--dur-fast)]"
          style={{ transform: checked ? "translateX(16px)" : "none" }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        {description ? (
          <span className="block text-[12px]" style={{ color: "var(--color-text-2)" }}>
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
