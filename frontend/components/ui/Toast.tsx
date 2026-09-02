"use client";

// House toast — replaces browser alert() everywhere. Event-based so any
// code can call toast("...") without context plumbing. Emil rules: CSS
// transitions (interruptible), enter/exit under 300ms on the ease token,
// reduced motion keeps the fade. Errors are direct about what happened.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type Variant = "success" | "danger" | "info";

export interface ToastItem {
  id: number;
  message: string;
  variant: Variant;
}

type Listener = (t: ToastItem) => void;
let listener: Listener | null = null;
let nextId = 1;

export function toast(message: string, variant: Variant = "info") {
  listener?.({ id: nextId++, message, variant });
}
toast.success = (m: string) => toast(m, "success");
toast.error = (m: string) => toast(m, "danger");

const VARIANT_META: Record<Variant, { icon: typeof Info; color: string }> = {
  success: { icon: CheckCircle2, color: "var(--color-success)" },
  danger: { icon: AlertCircle, color: "var(--color-danger)" },
  info: { icon: Info, color: "var(--color-accent-primary)" },
};

const DISMISS_MS = 4500;

export function Toaster() {
  const [items, setItems] = useState<(ToastItem & { leaving?: boolean })[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // Stable: touches only refs and functional setState.
  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    // Two-phase: mark leaving (exit transition), then remove.
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, leaving: true } : i)));
    setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 180);
  }, []);

  useEffect(() => {
    listener = (t) => {
      setItems((prev) => [...prev.slice(-3), t]); // cap the stack at 4
      timers.current.set(
        t.id,
        setTimeout(() => dismiss(t.id), DISMISS_MS),
      );
    };
    const map = timers.current;
    return () => {
      listener = null;
      map.forEach(clearTimeout);
    };
  }, [dismiss]);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 w-[min(92vw,380px)]">
      {items.map((item) => {
        const meta = VARIANT_META[item.variant];
        const Icon = meta.icon;
        return (
          <div
            key={item.id}
            role={item.variant === "danger" ? "alert" : "status"}
            className="card ds-toast flex items-start gap-3 p-3.5 shadow-lg"
            data-leaving={item.leaving ? "true" : undefined}
            style={{ borderColor: `color-mix(in srgb, ${meta.color} 35%, transparent)` }}
          >
            <Icon size={16} style={{ color: meta.color, marginTop: 1 }} className="flex-shrink-0" />
            <p className="flex-1 text-sm leading-snug" style={{ color: "var(--color-text-primary)" }}>
              {item.message}
            </p>
            <button
              onClick={() => dismiss(item.id)}
              aria-label="Dismiss"
              className="ds-btn ds-btn-ghost p-1 rounded"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
