import React from 'react';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LockModeLeg, LineStatus } from '@/types/scout-agent';
import { getSlotDisplayName } from '@/lib/lockModeEngine';

interface LockModeLegCardProps {
  leg: LockModeLeg;
  index: number;
  lineStatus?: LineStatus;
}

export function LockModeLegCard({ leg, index, lineStatus }: LockModeLegCardProps) {
  const propAbbrev = leg.prop === 'Rebounds' ? 'REB' : leg.prop === 'Assists' ? 'AST' : leg.prop === 'Points' ? 'PTS' : leg.prop;
  const leanSymbol = leg.lean === 'OVER' ? 'O' : 'U';

  const hasLiveData = lineStatus && lineStatus.status !== 'LOADING';
  const lineMovement = lineStatus?.lineMovement || 0;

  return (
    <div className={cn(
      "p-4 rounded-lg border",
      "bg-gradient-to-br from-emerald-500/10 to-emerald-600/5",
      "border-emerald-500/30",
      lineStatus?.isTrap && "border-red-500/50 from-red-500/10 to-red-600/5"
    )}>
      {/* Header: Slot Label + Confidence */}
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

      {/* Live Line Section */}
      {lineStatus && (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
          {/* Live Book Line */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Book Line:</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-foreground">
                {hasLiveData ? lineStatus.liveBookLine.toFixed(1) : '—'}
              </span>
              {hasLiveData && lineMovement !== 0 && (
                <Badge 
                  variant="outline"
                  className={cn(
                    "text-xs",
                    // For OVER: line going down is good (green), up is bad (red)
                    // For UNDER: line going up is good (green), down is bad (red)
                    leg.lean === 'OVER'
                      ? (lineMovement < 0 ? "border-emerald-500/50 text-emerald-400" : "border-red-500/50 text-red-400")
                      : (lineMovement > 0 ? "border-emerald-500/50 text-emerald-400" : "border-red-500/50 text-red-400")
                  )}
                >
                  {lineMovement > 0 ? (
                    <><TrendingUp className="w-3 h-3 mr-1" />+{lineMovement.toFixed(1)}</>
                  ) : (
                    <><TrendingDown className="w-3 h-3 mr-1" />{lineMovement.toFixed(1)}</>
                  )}
                </Badge>
              )}
            </div>
          </div>

          {/* Timing Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Timing:</span>
            <Badge 
              className={cn(
                "text-xs",
                lineStatus.status === 'BET_NOW' && "bg-emerald-500/20 text-emerald-300 border-emerald-500/50",
                lineStatus.status === 'WAIT' && "bg-amber-500/20 text-amber-300 border-amber-500/50",
                lineStatus.status === 'AVOID' && "bg-red-500/20 text-red-300 border-red-500/50",
                lineStatus.status === 'LOADING' && "bg-muted text-muted-foreground"
              )}
            >
              {lineStatus.status === 'BET_NOW' && <><CheckCircle2 className="w-3 h-3 mr-1" />BET NOW</>}
              {lineStatus.status === 'WAIT' && <><Clock className="w-3 h-3 mr-1" />WAIT</>}
              {lineStatus.status === 'AVOID' && <><AlertTriangle className="w-3 h-3 mr-1" />AVOID</>}
              {lineStatus.status === 'LOADING' && '...'}
            </Badge>
          </div>

          {/* Status Reason */}
          {hasLiveData && lineStatus.statusReason && (
            <p className="text-xs text-muted-foreground italic">
              {lineStatus.statusReason}
            </p>
          )}

          {/* Trap Warning */}
          {lineStatus.isTrap && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 p-2 rounded">
              <AlertTriangle className="w-3 h-3" />
              <span>Possible trap line detected</span>
            </div>
          )}

          {/* Bookmaker */}
          {lineStatus.bookmaker && (
            <p className="text-xs text-muted-foreground">
              via {lineStatus.bookmaker}
            </p>
          )}
        </div>
      )}

      {/* Minutes Remaining */}
      <div className="text-sm text-muted-foreground mt-3">
        Minutes: <span className="font-mono text-foreground">{leg.minutesRemaining.toFixed(1)}</span>
        <span className="text-muted-foreground/60"> ± {leg.minutesUncertainty.toFixed(1)}</span>
      </div>

      {/* Drivers (Max 2) */}
      {leg.drivers.length > 0 && (
        <div className="text-xs text-muted-foreground mt-2">
          {leg.drivers.join(' · ')}
        </div>
      )}
    </div>
  );
}
