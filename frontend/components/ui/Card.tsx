import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Lighter inner surface for nested panels. */
  inset?: boolean;
  padded?: boolean;
}

export function Card({ inset, padded = true, className, ...props }: CardProps) {
  return <div className={cn(inset ? "surface-2" : "surface", padded && "p-5", className)} {...props} />;
}

export function CardHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h2 className="text-base">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm" style={{ color: "var(--color-text-2)" }}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
