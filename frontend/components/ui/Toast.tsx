"use client";

import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";

type Kind = "info" | "success" | "error";
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
}

const listeners = new Set<() => void>();
let items: ToastItem[] = [];
let nextId = 1;

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSnapshot = () => items;
const EMPTY: ToastItem[] = [];
const getServerSnapshot = () => EMPTY;

function push(message: string, kind: Kind = "info") {
  const id = nextId++;
  items = [...items, { id, kind, message }];
  emit();
  setTimeout(() => dismiss(id), kind === "error" ? 7000 : 4500);
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** toast("Saved") · toast.success(...) · toast.error(...) */
export const toast = Object.assign((message: string, kind: Kind = "info") => push(message, kind), {
  success: (m: string) => push(m, "success"),
  error: (m: string) => push(m, "error"),
  info: (m: string) => push(m, "info"),
});

const icons: Record<Kind, React.ReactNode> = {
  info: <Info size={16} />,
  success: <CheckCircle2 size={16} />,
  error: <AlertCircle size={16} />,
};
const colors: Record<Kind, string> = {
  info: "var(--color-focus)",
  success: "var(--color-good)",
  error: "var(--color-danger)",
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (list.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-(--gutter) bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4"
      role="region"
      aria-label="Notifications"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          className="surface enter pointer-events-auto flex w-full max-w-sm items-start gap-3 px-4 py-3 text-sm"
        >
          <span style={{ color: colors[t.kind] }} className="mt-0.5 shrink-0">
            {icons[t.kind]}
          </span>
          <span className="min-w-0 flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5"
            style={{ color: "var(--color-text-3)" }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
