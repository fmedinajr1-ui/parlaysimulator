import { AlertTriangle, TrendingDown, Snowflake, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeepSweetSpot } from "@/types/sweetSpot";

interface HedgeRecommendationProps {
  spot: DeepSweetSpot;
}

function calculateHedgeMessage(spot: DeepSweetSpot): string {
  const { liveData, line, side, propType } = spot;
  if (!liveData) return '';
  
  const gap = side === 'over' 
    ? line - liveData.projectedFinal 
    : liveData.projectedFinal - line;
  
  if (liveData.riskFlags.includes('blowout')) {
    return `Blowout detected - player may see reduced 4th quarter minutes. Consider hedging ${side === 'over' ? 'UNDER' : 'OVER'} at current line.`;
  }
  
  if (liveData.riskFlags.includes('foul_trouble')) {
    return `Player in foul trouble - minutes at risk. Monitor closely.`;
  }
  
  if (liveData.paceRating < 95 && side === 'over') {
    return `Slow game pace (${liveData.paceRating.toFixed(0)}) limiting stat opportunities. Prop trending ${gap.toFixed(1)} below projection.`;
  }
  
  if (liveData.riskFlags.includes('garbage_time')) {
    return `Garbage time rotation likely. Starters may sit. Consider locking in current value.`;
  }
  
  return `Prop trending ${Math.abs(gap).toFixed(1)} ${side === 'over' ? 'below' : 'above'} line. Consider live hedge.`;
}

export function HedgeRecommendation({ spot }: HedgeRecommendationProps) {
  if (!spot.liveData?.isLive) return null;
  
  const { currentValue, projectedFinal, paceRating, riskFlags, gameProgress } = spot.liveData;
  const isOver = spot.side === 'over';
  
  // Calculate hedge scenarios
  const onPace = isOver ? projectedFinal >= spot.line : projectedFinal <= spot.line;
  const atRisk = !onPace && gameProgress > 25;
  const severeRisk = riskFlags.length > 0 || (isOver && paceRating < 95);
  
  // Don't show if on pace and no risk factors
  if (!atRisk && !severeRisk) return null;
  
  const hedgeMessage = calculateHedgeMessage(spot);
  
  // Determine severity
  const isSevere = severeRisk || gameProgress > 50;
  
  return (
    <div className={cn(
      "mt-2 p-2 rounded-lg border",
      isSevere 
        ? "bg-red-500/10 border-red-500/30" 
        : "bg-yellow-500/10 border-yellow-500/30"
    )}>
      <div className="flex items-center gap-2">
        <AlertTriangle className={cn(
          "w-4 h-4",
          isSevere ? "text-red-500" : "text-yellow-500"
        )} />
        <span className={cn(
          "text-xs font-medium",
          isSevere ? "text-red-400" : "text-yellow-400"
        )}>
          {isSevere ? 'HEDGE NOW' : 'HEDGE ALERT'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{hedgeMessage}</p>
      
      {/* Pace indicator */}
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Game Pace:</span>
        <div className="flex items-center gap-1">
          {paceRating >= 102 ? (
            <Flame className="w-3 h-3 text-green-400" />
          ) : paceRating < 98 ? (
            <Snowflake className="w-3 h-3 text-blue-400" />
          ) : null}
          <span className={cn(
            "font-medium",
            paceRating >= 102 ? "text-green-400" : 
            paceRating >= 98 ? "text-yellow-400" : "text-blue-400"
          )}>
            {paceRating >= 102 ? 'FAST' : paceRating >= 98 ? 'NORMAL' : 'SLOW'}
            ({paceRating.toFixed(0)})
          </span>
        </div>
      </div>
      
      {/* Progress indicator */}
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Current:</span>
        <span className="font-mono font-bold text-foreground">
          {currentValue}
        </span>
        <TrendingDown className="w-3 h-3 text-muted-foreground" />
        <span className="text-muted-foreground">Projected:</span>
        <span className={cn(
          "font-mono font-bold",
          onPace ? "text-green-400" : "text-red-400"
        )}>
          {projectedFinal.toFixed(1)}
        </span>
        <span className="text-muted-foreground">/ {spot.line}</span>
      </div>
    </div>
  );
}
