import { Clock, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductionMetrics, PropType } from "@/types/sweetSpot";
import { PROP_TYPE_CONFIG } from "@/types/sweetSpot";

interface ProductionRateDisplayProps {
  production: ProductionMetrics;
  propType: PropType;
  compact?: boolean;
}

export function ProductionRateDisplay({ 
  production, 
  propType,
  compact = false 
}: ProductionRateDisplayProps) {
  const config = PROP_TYPE_CONFIG[propType];
  const rateLabel = `${config.shortLabel}/min`;
  
  const getVerdictColor = () => {
    if (production.verdict === 'CAN_MEET') return 'text-green-400';
    if (production.verdict === 'RISKY') return 'text-yellow-400';
    return 'text-red-400';
  };
  
  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">
          {production.statPerMinute.toFixed(2)} {rateLabel}
        </span>
        <span className={cn("font-medium", getVerdictColor())}>
          {Math.round(production.minutesNeeded)}min needed
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
          <span className={cn("text-sm font-bold", getVerdictColor())}>
            {Math.round(production.minutesNeeded)} min
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
