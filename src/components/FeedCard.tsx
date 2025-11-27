import { cn } from "@/lib/utils";
import { ReactNode, HTMLAttributes } from "react";

interface FeedCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'glow' | 'neon' | 'purple';
  delay?: number;
}

export function FeedCard({ children, className, variant = 'default', delay = 0, ...props }: FeedCardProps) {
  const variants = {
    default: "bg-card",
    glow: "bg-card shadow-lg shadow-neon-purple/15",
    neon: "neon-border bg-card",
    purple: "neon-border-purple bg-card",
  };

  return (
    <div 
      className={cn(
        "rounded-2xl p-5 transition-all duration-300 slide-up",
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
