"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "ds-btn-primary",
  secondary: "ds-btn-secondary",
  ghost: "ds-btn-ghost",
  danger: "ds-btn-danger",
};

const SIZE_CLASS: Record<Size, string> = {
  sm: "ds-btn-sm",
  md: "ds-btn-md",
  icon: "ds-btn-icon",
};

// Press feedback (scale 0.97), hover gating, and focus ring live in the
// .ds-btn CSS layer so every button in the app feels identical.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn("ds-btn", VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
      {...props}
    />
  );
});
