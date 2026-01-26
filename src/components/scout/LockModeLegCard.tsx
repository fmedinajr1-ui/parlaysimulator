import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { LockModeLeg } from '@/types/scout-agent';
import { getSlotDisplayName } from '@/lib/lockModeEngine';

interface LockModeLegCardProps {
  leg: LockModeLeg;
  index: number;
}

export function LockModeLegCard({ leg, index }: LockModeLegCardProps) {
  const propAbbrev = leg.prop === 'Rebounds' ? 'REB' : leg.prop === 'Assists' ? 'AST' : leg.prop === 'Points' ? 'PTS' : leg.prop;
  const leanSymbol = leg.lean === 'OVER' ? 'O' : 'U';

  return (
    <div className={cn(
      "p-4 rounded-lg border",
      "bg-gradient-to-br from-emerald-500/10 to-emerald-600/5",
      "border-emerald-500/30"
    )}>
      {/* Header: Slot Label */}
      <div className="flex items-center justify-between mb-2">
        <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-500/50">
          Leg {index + 1}: {getSlotDisplayName(leg.slot)}
        </Badge>
        <Badge 
          className={cn(
            "text-xs font-mono",
            leg.calibratedConfidence >= 80 
              ? "bg-emerald-500/20 text-emerald-300" 
              : "bg-amber-500/20 text-amber-300"
          )}
        >
          {leg.calibratedConfidence.toFixed(0)}%
        </Badge>
      </div>

      {/* Main: Player + Prop + Line */}
      <div className="text-lg font-semibold text-foreground mb-2">
        {leg.player} {propAbbrev} {leanSymbol}{leg.line}
      </div>

      {/* Projection + Edge */}
      <div className="flex items-center gap-4 text-sm mb-2">
        <span className="text-muted-foreground">
          Proj <span className="font-mono text-foreground">{leg.projected.toFixed(1)}</span>
          <span className="text-muted-foreground/60"> ± {leg.uncertainty.toFixed(1)}</span>
        </span>
        <span className="text-emerald-400 font-medium">
          Edge +{leg.edge.toFixed(1)}
        </span>
      </div>

      {/* Minutes Remaining */}
      <div className="text-sm text-muted-foreground mb-3">
        Minutes: <span className="font-mono text-foreground">{leg.minutesRemaining.toFixed(1)}</span>
        <span className="text-muted-foreground/60"> ± {leg.minutesUncertainty.toFixed(1)}</span>
      </div>

      {/* Drivers (Max 2) */}
      {leg.drivers.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {leg.drivers.join(' · ')}
        </div>
      )}
    </div>
  );
}
