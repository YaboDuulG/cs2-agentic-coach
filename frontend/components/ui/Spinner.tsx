import { cn } from "@/lib/utils";

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn("ds-spinner", className)}
      style={{ width: size, height: size }}
    />
  );
}
