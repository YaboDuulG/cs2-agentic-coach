"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { Button, toast, type ButtonVariant } from "@/components/ui";

/**
 * Copies `text`. Says "Copied" only when the clipboard write succeeded; when
 * the browser blocks it, selects `selectRef`'s contents so a manual copy works.
 */
export function CopyButton({
  text,
  label = "Copy",
  selectRef,
  size = "sm",
  variant = "secondary",
  className,
}: {
  text: string;
  label?: string;
  selectRef?: RefObject<HTMLElement | null>;
  size?: "sm" | "md";
  variant?: ButtonVariant;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1500);
    } catch {
      const el = selectRef?.current;
      if (el) {
        const sel = window.getSelection();
        sel?.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel?.addRange(range);
        toast("Copy blocked, the text is selected");
      } else {
        toast.error("Copy blocked by the browser. Select the text and copy it yourself.");
      }
    }
  }

  return (
    <Button type="button" size={size} variant={variant} onClick={onCopy} className={className} aria-label={`${label}: ${text}`}>
      {done ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {done ? "Copied" : label}
    </Button>
  );
}
