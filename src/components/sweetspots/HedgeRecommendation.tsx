import { AlertTriangle, TrendingDown, Snowflake, Flame, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeepSweetSpot, ShotChartAnalysis } from "@/types/sweetSpot";
import { ShotChartMatchup } from "./ShotChartMatchup";

interface HedgeRecommendationProps {
  spot: DeepSweetSpot;
}

interface HedgeAction {
  message: string;
  action: string;
  urgency: 'high' | 'medium' | 'low';
}

// Format zone name for display
function formatZoneName(zone: string): string {
  const names: Record<string, string> = {
    restricted_area: 'Restricted Area',
    paint: 'Paint',
    mid_range: 'Mid-Range',
    corner_3: 'Corner 3',
    above_break_3: 'Above Break 3',
  };
  return names[zone] || zone;
}

// Get defense label from shot chart
function getDefenseLabel(shotChart: ShotChartAnalysis): string {
  const primaryZone = shotChart.zones.find(z => z.zone === shotChart.primaryZone);
  if (!primaryZone) return 'unknown';
  return `${primaryZone.defenseRating} (#${primaryZone.defenseRank})`;
}

function calculateHedgeAction(spot: DeepSweetSpot): HedgeAction {
  const { liveData, line, side, propType } = spot;
  if (!liveData) return { message: '', action: '', urgency: 'low' };
  
  const oppositeSide = side === 'over' ? 'UNDER' : 'OVER';
  const currentVal = liveData.currentValue;
  const projected = liveData.projectedFinal;
  const gap = side === 'over' ? line - projected : projected - line;
  const shotChart = liveData.shotChartMatchup;
  
  // Already hit the line
  if ((side === 'over' && currentVal >= line) || (side === 'under' && currentVal < line)) {
    return {
      message: `You've already ${side === 'over' ? 'hit' : 'are under'} the line at ${currentVal}!`,
      action: `✅ BET ${oppositeSide} ${line} NOW to guarantee profit (middle opportunity)`,
      urgency: 'high'
    };
  }
  
  // Shot chart mismatch (for points/threes props)
  if (shotChart && (propType === 'points' || propType === 'threes')) {
    if (shotChart.overallMatchupScore < -3 && gap > 1) {
      return {
        message: `Shot chart mismatch: ${shotChart.recommendation}`,
        action: `📊 BET ${oppositeSide} ${line} - ${formatZoneName(shotChart.primaryZone)} faces ${getDefenseLabel(shotChart)} defense`,
        urgency: 'high'
      };
    }
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
  
  // If shot chart shows advantage, reduce urgency
  if (shotChart && shotChart.overallMatchupScore > 3) {
    return {
      message: `Favorable zone matchup (${shotChart.recommendation}). Projection more reliable.`,
      action: `📊 Hold position - ${formatZoneName(shotChart.primaryZone)} advantage`,
      urgency: 'low'
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
  
  const { currentValue, projectedFinal, paceRating, riskFlags, gameProgress, shotChartMatchup } = spot.liveData;
  const isOver = spot.side === 'over';
  const isScoring = spot.propType === 'points' || spot.propType === 'threes';
  
  // Calculate hedge scenarios
  const onPace = isOver ? projectedFinal >= spot.line : projectedFinal <= spot.line;
  const atRisk = !onPace && gameProgress > 25;
  const severeRisk = riskFlags.length > 0 || (isOver && paceRating < 95);
  const hasZoneDisadvantage = shotChartMatchup && shotChartMatchup.overallMatchupScore < -3;
  
  // Don't show if on pace and no risk factors (unless zone disadvantage)
  if (!atRisk && !severeRisk && !hasZoneDisadvantage) return null;
  
  const hedgeAction = calculateHedgeAction(spot);
  
  // Determine severity - zone disadvantage also contributes
  const isSevere = hedgeAction.urgency === 'high' || gameProgress > 50 || hasZoneDisadvantage;
  
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
      
      {/* Shot Chart Section (only for points/threes props) */}
      {shotChartMatchup && isScoring && (
        <div className="mt-3 pt-3 border-t border-border/30">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs font-medium">Shot Chart vs Defense</span>
          </div>
          <div className="flex gap-3 items-start">
            <ShotChartMatchup analysis={shotChartMatchup} />
            <div className="flex-1 text-xs space-y-1">
              <p className="text-muted-foreground">
                Primary Zone: <span className="text-foreground font-medium">
                  {formatZoneName(shotChartMatchup.primaryZone)}
                </span>
                <span className="text-muted-foreground ml-1">
                  ({Math.round(shotChartMatchup.primaryZonePct * 100)}% of shots)
                </span>
              </p>
              <p className={cn(
                "font-medium",
                shotChartMatchup.overallMatchupScore > 0 ? "text-primary" : "text-destructive"
              )}>
                {shotChartMatchup.recommendation}
              </p>
            </div>
          </div>
        </div>
      )}
      
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
