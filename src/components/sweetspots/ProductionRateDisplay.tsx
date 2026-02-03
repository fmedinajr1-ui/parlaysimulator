import { Clock, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductionMetrics, PropType, PickSide, MinutesVerdict } from "@/types/sweetSpot";
import { PROP_TYPE_CONFIG } from "@/types/sweetSpot";

interface ProductionRateDisplayProps {
  production: ProductionMetrics;
  propType: PropType;
  side: PickSide;
  compact?: boolean;
}

// Side-aware verdict display: UNDER picks invert the meaning
function getVerdictDisplay(verdict: MinutesVerdict, side: PickSide): { label: string; color: string } {
  if (side === 'under') {
    // For UNDER: unlikely to hit line = GOOD, can meet = BAD
    if (verdict === 'UNLIKELY') return { label: 'Safe Floor', color: 'text-green-400' };
    if (verdict === 'RISKY') return { label: 'Marginal', color: 'text-yellow-400' };
    return { label: 'Likely Hits', color: 'text-red-400' };
  }
  // For OVER: standard logic
  if (verdict === 'CAN_MEET') return { label: 'Can Hit', color: 'text-green-400' };
  if (verdict === 'RISKY') return { label: 'Risky', color: 'text-yellow-400' };
  return { label: 'Unlikely', color: 'text-red-400' };
}

export function ProductionRateDisplay({ 
  production, 
  propType,
  side,
  compact = false 
}: ProductionRateDisplayProps) {
  const config = PROP_TYPE_CONFIG[propType];
  const rateLabel = `${config.shortLabel}/min`;
  const verdictDisplay = getVerdictDisplay(production.verdict, side);
  
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">
          {production.statPerMinute.toFixed(2)} {rateLabel}
        </span>
        <span className={cn("font-medium", verdictDisplay.color)}>
          {verdictDisplay.label}
        </span>
      </div>
    );
  }
  
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Activity size={14} className="text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Production Rate:</span>
          <span className="text-sm font-mono font-bold text-foreground">
            {production.statPerMinute.toFixed(2)} {rateLabel}
          </span>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Clock size={14} className="text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Minutes Needed:</span>
          <span className={cn("text-sm font-bold", verdictDisplay.color)}>
            {Math.round(production.minutesNeeded)} min ({verdictDisplay.label})
          </span>
        </div>
        <span className="text-muted-foreground">|</span>
        <div className="text-sm">
          <span className="text-muted-foreground">Avg Played: </span>
          <span className="font-medium text-foreground">
            {Math.round(production.avgMinutes)} min
          </span>
        </div>
      </div>
    </div>
  );
}
