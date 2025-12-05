import { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface BetCardProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'highlight' | 'success' | 'danger' | 'pending';
  onClick?: () => void;
}

export function BetCard({ children, className, variant = 'default', onClick }: BetCardProps) {
  const variants = {
    default: "bg-card border-border/50",
    highlight: "bg-card border-primary/30 shadow-lg shadow-primary/5",
    success: "bg-neon-green/5 border-neon-green/30",
    danger: "bg-neon-red/5 border-neon-red/30",
    pending: "bg-neon-yellow/5 border-neon-yellow/30",
  };

  return (
    <div 
      className={cn(
        "rounded-xl border p-4 transition-all duration-200",
        onClick && "cursor-pointer active:scale-[0.98] hover:border-primary/50",
        variants[variant],
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

interface BetLegProps {
  description: string;
  odds: number | string;
  status?: 'pending' | 'won' | 'lost';
  badge?: string;
  badgeVariant?: 'default' | 'success' | 'danger' | 'warning';
  sport?: string;
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
}

export function BetLeg({ 
  description, 
  odds, 
  status = 'pending',
  badge,
  badgeVariant = 'default',
  sport,
  trend,
  className 
}: BetLegProps) {
  const formatOdds = (o: number | string) => {
    const num = typeof o === 'string' ? parseInt(o) : o;
    return num > 0 ? `+${num}` : `${num}`;
  };

  const statusColors = {
    pending: "text-foreground",
    won: "text-neon-green",
    lost: "text-neon-red line-through opacity-60",
  };

  const badgeColors = {
    default: "bg-muted text-muted-foreground",
    success: "bg-neon-green/20 text-neon-green border-neon-green/30",
    danger: "bg-neon-red/20 text-neon-red border-neon-red/30",
    warning: "bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30",
  };

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;

  return (
    <div className={cn("flex items-center justify-between py-3 border-b border-border/30 last:border-0", className)}>
      <div className="flex-1 min-w-0 pr-3">
        <div className="flex items-center gap-2 mb-1">
          {sport && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {sport}
            </Badge>
          )}
          {badge && (
            <Badge className={cn("text-[10px] px-1.5 py-0 border", badgeColors[badgeVariant])}>
              {badge}
            </Badge>
          )}
        </div>
        <p className={cn("text-sm font-medium truncate", statusColors[status])}>
          {description}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {trend && (
          <TrendIcon className={cn(
            "w-4 h-4",
            trend === 'up' && "text-neon-green",
            trend === 'down' && "text-neon-red",
            trend === 'neutral' && "text-muted-foreground"
          )} />
        )}
        <span className={cn(
          "font-mono font-bold text-base",
          statusColors[status]
        )}>
          {formatOdds(odds)}
        </span>
      </div>
    </div>
  );
}

interface BetOddsDisplayProps {
  totalOdds: number;
  probability?: number;
  payout?: number;
  stake?: number;
  variant?: 'compact' | 'full';
  className?: string;
}

export function BetOddsDisplay({ 
  totalOdds, 
  probability, 
  payout, 
  stake,
  variant = 'full',
  className 
}: BetOddsDisplayProps) {
  const formatOdds = (o: number) => o > 0 ? `+${o}` : `${o}`;

  if (variant === 'compact') {
    return (
      <div className={cn("flex items-center gap-4", className)}>
        <div className="text-center">
          <p className="text-xl font-bold font-mono text-primary">{formatOdds(totalOdds)}</p>
          <p className="text-[10px] text-muted-foreground uppercase">Odds</p>
        </div>
        {probability !== undefined && (
          <div className="text-center">
            <p className="text-xl font-bold text-foreground">{(probability * 100).toFixed(0)}%</p>
            <p className="text-[10px] text-muted-foreground uppercase">Win</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-3 gap-4 p-4 rounded-lg bg-muted/50", className)}>
      <div className="text-center">
        <p className="text-2xl font-bold font-mono text-primary">{formatOdds(totalOdds)}</p>
        <p className="text-xs text-muted-foreground uppercase">Total Odds</p>
      </div>
      {probability !== undefined && (
        <div className="text-center">
          <p className="text-2xl font-bold text-foreground">{(probability * 100).toFixed(1)}%</p>
          <p className="text-xs text-muted-foreground uppercase">Win Prob</p>
        </div>
      )}
      {payout !== undefined && stake !== undefined && (
        <div className="text-center">
          <p className="text-2xl font-bold text-neon-green">${payout.toFixed(0)}</p>
          <p className="text-xs text-muted-foreground uppercase">To Win</p>
        </div>
      )}
    </div>
  );
}
