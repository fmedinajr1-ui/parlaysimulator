import { cn } from '@/lib/utils';
import type { ZoneAnalysis } from '@/types/matchupScanner';
import { ZONE_SHORT_LABELS } from '@/types/matchupScanner';

interface ZoneAdvantageBarProps {
  zone: ZoneAnalysis;
  compact?: boolean;
}

export function ZoneAdvantageBar({ zone, compact = false }: ZoneAdvantageBarProps) {
  const advantage = zone.advantage;
  const isPositive = advantage > 0;
  const absAdvantage = Math.abs(advantage);
  
  // Calculate bar width (max 100% at 15% advantage)
  const barWidth = Math.min(absAdvantage / 0.15, 1) * 100;
  
  // Get color based on advantage
  const getBarColor = () => {
    if (advantage > 0.05) return 'bg-green-500';
    if (advantage > 0.02) return 'bg-green-400/70';
    if (advantage > 0) return 'bg-green-300/50';
    if (advantage > -0.02) return 'bg-yellow-400/50';
    if (advantage > -0.05) return 'bg-red-400/70';
    return 'bg-red-500';
  };
  
  // Defense rank label
  const getRankLabel = (rank: number) => {
    if (rank <= 5) return 'Elite';
    if (rank <= 10) return 'Good';
    if (rank <= 20) return 'Avg';
    if (rank <= 25) return 'Poor';
    return 'Weak';
  };
  
  if (compact) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium",
          advantage > 0.03 && "bg-green-500/20 text-green-400",
          advantage > 0 && advantage <= 0.03 && "bg-green-500/10 text-green-300",
          advantage <= 0 && advantage > -0.03 && "bg-yellow-500/10 text-yellow-300",
          advantage <= -0.03 && "bg-red-500/20 text-red-400"
        )}
      >
        <span>{ZONE_SHORT_LABELS[zone.zone]}</span>
        <span>{isPositive ? '+' : ''}{(advantage * 100).toFixed(0)}%</span>
      </div>
    );
  }
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{ZONE_SHORT_LABELS[zone.zone]}</span>
        <div className="flex items-center gap-2">
          <span className={cn(
            "font-medium",
            isPositive ? "text-green-400" : "text-red-400"
          )}>
            {isPositive ? '+' : ''}{(advantage * 100).toFixed(1)}%
          </span>
          <span className="text-muted-foreground text-[10px]">
            Rank {zone.defenseRank} ({getRankLabel(zone.defenseRank)})
          </span>
        </div>
      </div>
      
      <div className="h-2 bg-muted rounded-full overflow-hidden relative">
        {/* Center line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border z-10" />
        
        {/* Bar - grows from center */}
        <div 
          className={cn(
            "absolute top-0 bottom-0 transition-all",
            getBarColor(),
            isPositive ? "left-1/2" : "right-1/2"
          )}
          style={{ 
            width: `${barWidth / 2}%`,
          }}
        />
      </div>
      
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Player: {(zone.playerFgPct * 100).toFixed(0)}%</span>
        <span>vs Def: {(zone.defenseAllowedPct * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}
