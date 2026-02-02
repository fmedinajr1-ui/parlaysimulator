import { AlertTriangle, TrendingDown, Snowflake, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeepSweetSpot } from "@/types/sweetSpot";

interface HedgeRecommendationProps {
  spot: DeepSweetSpot;
}

interface HedgeAction {
  message: string;
  action: string;
  urgency: 'high' | 'medium' | 'low';
}

function calculateHedgeAction(spot: DeepSweetSpot): HedgeAction {
  const { liveData, line, side } = spot;
  if (!liveData) return { message: '', action: '', urgency: 'low' };
  
  const oppositeSide = side === 'over' ? 'UNDER' : 'OVER';
  const currentVal = liveData.currentValue;
  const projected = liveData.projectedFinal;
  const gap = side === 'over' ? line - projected : projected - line;
  
  // Already hit the line
  if ((side === 'over' && currentVal >= line) || (side === 'under' && currentVal < line)) {
    return {
      message: `You've already ${side === 'over' ? 'hit' : 'are under'} the line at ${currentVal}!`,
      action: `✅ BET ${oppositeSide} ${line} NOW to guarantee profit (middle opportunity)`,
      urgency: 'high'
    };
  }
  
  if (liveData.riskFlags.includes('blowout')) {
    return {
      message: `Blowout detected - player likely loses 4th quarter minutes.`,
      action: `🚨 BET ${oppositeSide} ${line} immediately to cut losses`,
      urgency: 'high'
    };
  }
  
  if (liveData.riskFlags.includes('foul_trouble')) {
    return {
      message: `Player in foul trouble (${liveData.currentValue} so far) - minutes at risk.`,
      action: `⚠️ Prepare to bet ${oppositeSide} if another foul occurs`,
      urgency: 'medium'
    };
  }
  
  if (liveData.paceRating < 95 && side === 'over') {
    const needed = Math.max(0, line - currentVal + 0.5);
    return {
      message: `Slow pace (${liveData.paceRating.toFixed(0)}) = fewer possessions. Projected ${projected.toFixed(1)}, need ${line}.`,
      action: `🐢 BET ${oppositeSide} ${line} - pace unlikely to increase`,
      urgency: gap > 2 ? 'high' : 'medium'
    };
  }
  
  if (liveData.riskFlags.includes('garbage_time')) {
    return {
      message: `Garbage time likely - starters will sit.`,
      action: `🚨 BET ${oppositeSide} ${line} before rotation change`,
      urgency: 'high'
    };
  }
  
  // Generic trailing scenario
  const neededMore = side === 'over' ? line - currentVal : currentVal - line;
  return {
    message: `Trending ${gap.toFixed(1)} ${side === 'over' ? 'below' : 'above'} target. Need ${neededMore.toFixed(1)} more.`,
    action: `📊 BET ${oppositeSide} ${line} to reduce exposure`,
    urgency: gap > 3 ? 'high' : 'medium'
  };
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
  
  const hedgeAction = calculateHedgeAction(spot);
  
  // Determine severity
  const isSevere = hedgeAction.urgency === 'high' || gameProgress > 50;
  
  return (
    <div className={cn(
      "mt-2 p-2 rounded-lg border",
      isSevere 
        ? "bg-destructive/10 border-destructive/30" 
        : "bg-warning/10 border-warning/30"
    )}>
      <div className="flex items-center gap-2">
        <AlertTriangle className={cn(
          "w-4 h-4",
          isSevere ? "text-destructive" : "text-warning"
        )} />
        <span className={cn(
          "text-xs font-medium",
          isSevere ? "text-destructive" : "text-warning"
        )}>
          {isSevere ? 'HEDGE NOW' : 'HEDGE ALERT'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{hedgeAction.message}</p>
      
      {/* Clear action to take */}
      <div className={cn(
        "mt-2 p-1.5 rounded text-xs font-semibold",
        isSevere ? "bg-destructive/20 text-destructive" : "bg-warning/20 text-warning"
      )}>
        {hedgeAction.action}
      </div>
      
      {/* Pace indicator */}
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Game Pace:</span>
        <div className="flex items-center gap-1">
          {paceRating >= 102 ? (
            <Flame className="w-3 h-3 text-primary" />
          ) : paceRating < 98 ? (
            <Snowflake className="w-3 h-3 text-accent" />
          ) : null}
          <span className={cn(
            "font-medium",
            paceRating >= 102 ? "text-primary" : 
            paceRating >= 98 ? "text-warning" : "text-accent"
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
          onPace ? "text-primary" : "text-destructive"
        )}>
          {projectedFinal.toFixed(1)}
        </span>
        <span className="text-muted-foreground">/ {spot.line}</span>
      </div>
    </div>
  );
}
