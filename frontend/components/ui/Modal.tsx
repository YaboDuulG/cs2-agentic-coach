"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name; rendered as the heading unless `hideTitle`. */
  title: ReactNode;
  description?: ReactNode;
  hideTitle?: boolean;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" } as const;

export function Modal({ open, onClose, title, description, hideTitle, children, size = "md", className }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-[enter_var(--dur-fast)_var(--ease-out)]"
        />
        <Dialog.Content
          className={cn(
            "surface fixed left-1/2 top-1/2 z-50 w-[calc(100%-2*var(--gutter))] -translate-x-1/2 -translate-y-1/2 p-6 outline-none",
            "max-h-[calc(100dvh-32px)] overflow-y-auto",
            widths[size],
            className,
          )}
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          <div className={cn("mb-4 flex items-start justify-between gap-4", hideTitle && "sr-only")}>
            <div>
              <Dialog.Title asChild>
                <h2 className="text-lg">{title}</h2>
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm" style={{ color: "var(--color-text-2)" }}>
                  {description}
                </Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</Dialog.Description>
              )}
            </div>
          </div>
          <Dialog.Close
            className="absolute right-3 top-3 rounded-(--radius-sm) p-1.5 transition-colors duration-[var(--dur-fast)] hover:bg-(--color-surface-2)"
            aria-label="Close"
            style={{ color: "var(--color-text-2)" }}
          >
            <X size={16} />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
