import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface StatsCardProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'highlight' | 'glass';
}

export function StatsCard({ children, className, variant = 'default' }: StatsCardProps) {
  const variants = {
    default: "bg-card border-border/50",
    highlight: "bg-gradient-to-br from-primary/10 to-card border-primary/20",
    glass: "bg-card/80 backdrop-blur-xl border-border/30",
  };

  return (
    <div className={cn(
      "rounded-xl border p-4",
      variants[variant],
      className
    )}>
      {children}
    </div>
  );
}

interface StatItemProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function StatItem({ 
  label, 
  value, 
  trend, 
  trendValue,
  icon,
  size = 'md',
  className 
}: StatItemProps) {
  const sizeClasses = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-3xl",
  };

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  return (
    <div className={cn("text-center", className)}>
      {icon && <div className="mb-2 flex justify-center">{icon}</div>}
      <p className={cn("font-bold text-foreground", sizeClasses[size])}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
        {label}
      </p>
      {trend && (
        <div className={cn(
          "flex items-center justify-center gap-1 mt-2 text-xs font-medium",
          trend === 'up' && "text-neon-green",
          trend === 'down' && "text-neon-red",
          trend === 'neutral' && "text-muted-foreground"
        )}>
          <TrendIcon className="w-3 h-3" />
          <span>{trendValue}</span>
        </div>
      )}
    </div>
  );
}

interface StatsGridProps {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export function StatsGrid({ children, columns = 4, className }: StatsGridProps) {
  const colClasses = {
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
  };

  return (
    <div className={cn("grid gap-4", colClasses[columns], className)}>
      {children}
    </div>
  );
}

interface ProgressStatProps {
  label: string;
  value: number;
  max?: number;
  showPercentage?: boolean;
  color?: 'primary' | 'success' | 'danger' | 'warning';
  className?: string;
}

export function ProgressStat({ 
  label, 
  value, 
  max = 100, 
  showPercentage = true,
  color = 'primary',
  className 
}: ProgressStatProps) {
  const percentage = Math.min((value / max) * 100, 100);
  
  const colorClasses = {
    primary: "bg-primary",
    success: "bg-neon-green",
    danger: "bg-neon-red",
    warning: "bg-neon-yellow",
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        {showPercentage && (
          <span className="font-medium text-foreground">{percentage.toFixed(0)}%</span>
        )}
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={cn("h-full rounded-full transition-all duration-500", colorClasses[color])}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
