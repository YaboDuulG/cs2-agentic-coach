import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Right-aligned on desktop, stacked under the title on phones. */
  actions?: ReactNode;
  /** Small breadcrumb-style link rendered above the eyebrow. */
  back?: ReactNode;
  /** Something that sits beside the title: a logo, a mode badge. */
  leading?: ReactNode;
  className?: string;
}

/**
 * Every route starts with this: it answers "where am I" and holds the one
 * primary action. Sits below the fixed navbar (the shell adds the offset).
 */
export function PageHeader({ title, eyebrow, description, actions, back, leading, className }: PageHeaderProps) {
  return (
    <header className={cn("enter mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 items-start gap-4">
        {leading ? <div className="shrink-0">{leading}</div> : null}
        <div className="min-w-0">
          {back ? <div className="mb-2 text-sm">{back}</div> : null}
          {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
          <h1 className="text-2xl sm:text-3xl">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-prose text-sm sm:text-[15px]" style={{ color: "var(--color-text-2)" }}>
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
