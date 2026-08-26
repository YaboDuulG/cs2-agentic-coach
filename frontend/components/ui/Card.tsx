import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export function Card({ elevated = false, className, ...props }: CardProps) {
  return <div className={cn(elevated ? "card-elevated" : "card", className)} {...props} />;
}
