import React from 'react';
import { cn } from '@/lib/utils';
import { Gauge, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface PaceMeterProps {
  pace: number;
  avgPace?: number; // League average ~100
  className?: string;
}

export function PaceMeter({ pace, avgPace = 100, className }: PaceMeterProps) {
  // Pace ranges: <95 slow (green/unders), 95-105 normal (gray), >105 fast (red/overs)
  const getPaceZone = () => {
    if (pace < 95) return { label: 'Slow', color: 'text-chart-2', bgColor: 'bg-chart-2', icon: TrendingDown };
    if (pace > 105) return { label: 'Fast', color: 'text-destructive', bgColor: 'bg-destructive', icon: TrendingUp };
    return { label: 'Normal', color: 'text-muted-foreground', bgColor: 'bg-muted-foreground', icon: Minus };
  };

  const zone = getPaceZone();
  const ZoneIcon = zone.icon;

  // Calculate position on the gauge (75-125 range mapped to 0-100%)
  const minPace = 75;
  const maxPace = 125;
  const clampedPace = Math.max(minPace, Math.min(maxPace, pace));
  const position = ((clampedPace - minPace) / (maxPace - minPace)) * 100;

  // Calculate average marker position
  const avgPosition = ((avgPace - minPace) / (maxPace - minPace)) * 100;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground flex items-center gap-1">
          <Gauge className="w-3 h-3" />
          Pace
        </span>
        <div className={cn("flex items-center gap-1 font-medium", zone.color)}>
          <ZoneIcon className="w-3 h-3" />
          {zone.label}
        </div>
      </div>

      {/* Gauge Bar */}
      <div className="relative h-3 bg-muted rounded-full overflow-hidden">
        {/* Colored zones */}
        <div className="absolute inset-0 flex">
          <div className="w-[40%] bg-chart-2/30" /> {/* 75-95: Slow zone */}
          <div className="w-[20%] bg-muted" /> {/* 95-105: Normal zone */}
          <div className="w-[40%] bg-destructive/30" /> {/* 105-125: Fast zone */}
        </div>

        {/* Average marker */}
        <div 
          className="absolute top-0 bottom-0 w-0.5 bg-foreground/50"
          style={{ left: `${avgPosition}%` }}
        />

        {/* Current pace indicator */}
        <div 
          className={cn(
            "absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-background shadow-lg transition-all duration-300",
            zone.bgColor
          )}
          style={{ left: `calc(${position}% - 8px)` }}
        />
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Slow (75)</span>
        <span className="font-mono text-sm font-bold">{pace}</span>
        <span>Fast (125)</span>
      </div>

      {/* Betting Insight */}
      <div className={cn(
        "text-[10px] p-1.5 rounded text-center",
        pace < 95 ? "bg-chart-2/10 text-chart-2" :
        pace > 105 ? "bg-destructive/10 text-destructive" :
        "bg-muted text-muted-foreground"
      )}>
        {pace < 95 && "Slow pace favors UNDERS"}
        {pace > 105 && "Fast pace favors OVERS"}
        {pace >= 95 && pace <= 105 && "Neutral pace"}
      </div>
    </div>
  );
}
