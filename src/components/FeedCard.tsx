import { cn } from "@/lib/utils";
import { ReactNode, HTMLAttributes } from "react";

interface FeedCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'glow' | 'neon' | 'purple' | 'full-bleed' | 'floating' | 'highlight' | 'glass';
  delay?: number;
  interactive?: boolean;
}

export function FeedCard({ 
  children, 
  className, 
  variant = 'default', 
  delay = 0, 
  interactive = false,
  ...props 
}: FeedCardProps) {
  const variants = {
    default: "bg-card border border-border/50",
    glow: "bg-card shadow-lg shadow-neon-purple/15 border border-border/50",
    neon: "neon-border bg-card",
    purple: "neon-border-purple bg-card",
    'full-bleed': "bg-card -mx-4 rounded-none border-y border-border/30",
    floating: "bg-card shadow-xl shadow-background/50 border border-border/30",
    highlight: "bg-gradient-to-br from-primary/5 to-card border border-primary/20",
    glass: "bg-card/80 backdrop-blur-xl border border-border/30",
  };

  return (
    <div 
      className={cn(
        "rounded-2xl p-4 transition-all duration-200 slide-up will-change-transform",
        variants[variant],
        interactive && "cursor-pointer active:scale-[0.98] hover:border-primary/30",
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
      {...props}
    >
      {children}
    </div>
  );
}

interface FeedCardHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function FeedCardHeader({ title, subtitle, icon, action, className }: FeedCardHeaderProps) {
  return (
    <div className={cn("flex items-center justify-between mb-4", className)}>
      <div className="flex items-center gap-3 min-w-0">
        {icon && (
          <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="font-semibold text-foreground truncate">{title}</h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0 ml-3">{action}</div>}
    </div>
  );
}
