"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Accessible name for the dialog. */
  label: string;
  panelClassName?: string;
  showClose?: boolean;
}

type State = "closed" | "open" | "closing";

/**
 * Centered dialog. Enters at scale(0.96)+fade over 240ms with a strong
 * ease-out, exits faster (160ms). CSS transitions, not keyframes, so a rapid
 * open/close retargets instead of restarting; transform-origin stays centered
 * because modals aren't anchored to a trigger. Reduced motion drops the scale
 * and keeps the fade (see globals.css).
 */
export function Modal({ open, onClose, children, label, panelClassName, showClose = true }: ModalProps) {
  const [state, setState] = useState<State>(open ? "open" : "closed");
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // State changes happen in a rAF callback: the panel gets one paint in its
    // hidden base styles before "open" lands, so the entrance transitions.
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      const raf = requestAnimationFrame(() => setState("open"));
      return () => cancelAnimationFrame(raf);
    }
    const raf = requestAnimationFrame(() =>
      setState(prev => (prev === "closed" ? prev : "closing")),
    );
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const finishClose = useCallback(() => {
    setState(prev => (prev === "closing" ? "closed" : prev));
    restoreFocusRef.current?.focus?.();
  }, []);

  // Escape closes; body scroll locks while open.
  useEffect(() => {
    if (state !== "open") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [state, onClose]);

  if (state === "closed" && !open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      data-state={state}
    >
      <div className="ds-modal-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onTransitionEnd={e => {
          if (!open && e.target === e.currentTarget && e.propertyName === "opacity") finishClose();
        }}
        className={cn(
          "ds-modal-panel card-elevated w-full max-w-[580px] p-6 md:p-8 overflow-hidden focus:outline-none",
          panelClassName,
        )}
      >
        {showClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 rounded-xl"
          >
            <X size={18} />
          </Button>
        )}
        {children}
      </div>
    </div>
  );
}
