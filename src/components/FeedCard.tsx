import { cn } from "@/lib/utils";
import { ReactNode, HTMLAttributes } from "react";

interface FeedCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'glow' | 'neon' | 'purple' | 'full-bleed';
  delay?: number;
}

export function FeedCard({ children, className, variant = 'default', delay = 0, ...props }: FeedCardProps) {
  const variants = {
    default: "bg-card",
    glow: "bg-card shadow-lg shadow-neon-purple/15",
    neon: "neon-border bg-card",
    purple: "neon-border-purple bg-card",
    'full-bleed': "bg-card",
  };

  return (
    <div 
      className={cn(
        "rounded-2xl p-4 transition-all duration-200 slide-up will-change-transform",
        variants[variant],
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
      {...props}
    >
      {children}
    </div>
  );
}
