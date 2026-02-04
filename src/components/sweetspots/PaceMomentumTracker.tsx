import { Activity, TrendingUp, TrendingDown, Minus, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeepSweetSpot } from "@/types/sweetSpot";

interface PaceMomentumTrackerProps {
  spot: DeepSweetSpot;
  className?: string;
}

interface QuarterPaceData {
  quarter: number;
  pace: number;
  trend: 'up' | 'down' | 'stable';
  isComplete: boolean;
  isCurrent: boolean;
}

// Historical pace patterns (NBA averages)
const PACE_PATTERNS = {
  // Q1 is typically fastest (fresh legs, game flow establishing)
  q1Multiplier: 1.03,
  // Q2 settles into rhythm
  q2Multiplier: 1.00,
  // Q3 often has lowest pace (halftime adjustments, cautious play)
  q3Multiplier: 0.97,
  // Q4 varies - close games speed up, blowouts slow down
  q4CloseMultiplier: 1.05,
  q4BlowoutMultiplier: 0.90,
  // Average 2H regression from 1H
  secondHalfRegression: 0.96,
};

/**
 * Estimates per-quarter pace based on current game pace and quarter
 */
function estimateQuarterPace(spot: DeepSweetSpot): QuarterPaceData[] {
  const { liveData } = spot;
  const currentPace = liveData?.paceRating || 100;
  const currentQuarter = liveData?.currentQuarter || 1;
  const gameProgress = liveData?.gameProgress || 0;
  
  // Base pace normalized to 100
  const basePace = currentPace;
  
  // Estimate pace for each quarter based on patterns
  const quarterMultipliers = [
    PACE_PATTERNS.q1Multiplier,
    PACE_PATTERNS.q2Multiplier,
    PACE_PATTERNS.q3Multiplier,
    // Q4 depends on game state - estimate based on current pace trend
    currentPace > 105 ? PACE_PATTERNS.q4CloseMultiplier : PACE_PATTERNS.q4BlowoutMultiplier,
  ];
  
  return [1, 2, 3, 4].map((q, idx) => {
    const isComplete = q < currentQuarter;
    const isCurrent = q === currentQuarter;
    
    // For completed quarters, use actual pattern-adjusted values
    // For future quarters, project based on historical patterns
    let estimatedPace: number;
    
    if (isComplete || isCurrent) {
      // Use current pace as reference, adjust for typical quarter patterns
      estimatedPace = basePace * quarterMultipliers[idx];
    } else {
      // Project future quarters with 2H regression
      const is2H = q >= 3;
      const regression = is2H ? PACE_PATTERNS.secondHalfRegression : 1;
      estimatedPace = basePace * quarterMultipliers[idx] * regression;
    }
    
    // Determine trend vs previous quarter
    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (idx > 0) {
      const prevPace = basePace * quarterMultipliers[idx - 1];
      const diff = estimatedPace - prevPace;
      if (diff > 2) trend = 'up';
      else if (diff < -2) trend = 'down';
    }
    
    return {
      quarter: q,
      pace: Math.round(estimatedPace * 10) / 10,
      trend,
      isComplete,
      isCurrent,
    };
  });
}

/**
 * Calculate predicted 2nd half pace based on 1st half data
 */
function predict2HPace(spot: DeepSweetSpot): {
  predicted2HPace: number;
  confidence: 'high' | 'medium' | 'low';
  insight: string;
} {
  const { liveData } = spot;
  const currentPace = liveData?.paceRating || 100;
  const currentQuarter = liveData?.currentQuarter || 1;
  const gameStatus = liveData?.gameStatus;
  
  // At halftime, we have good 1H data
  if (gameStatus === 'halftime' || currentQuarter >= 3) {
    // Apply historical 2H regression
    const predicted2HPace = currentPace * PACE_PATTERNS.secondHalfRegression;
    
    if (currentPace > 108) {
      return {
        predicted2HPace,
        confidence: 'medium',
        insight: `High-pace 1H (${currentPace.toFixed(0)}). History shows ~4% slowdown in 2H.`,
      };
    } else if (currentPace < 95) {
      return {
        predicted2HPace,
        confidence: 'high',
        insight: `Slow-paced game (${currentPace.toFixed(0)}). 2H likely to stay methodical.`,
      };
    }
    
    return {
      predicted2HPace,
      confidence: 'high',
      insight: `Average pace (${currentPace.toFixed(0)}). Expect slight 2H regression to ${predicted2HPace.toFixed(0)}.`,
    };
  }
  
  // Early game - lower confidence
  return {
    predicted2HPace: currentPace * 0.98,
    confidence: 'low',
    insight: `Early game data. Pace typically stabilizes by Q2.`,
  };
}

/**
 * Get pace classification
 */
function getPaceClass(pace: number): { label: string; color: string; icon: typeof Zap } {
  if (pace >= 105) return { label: 'FAST', color: 'text-primary', icon: Zap };
  if (pace >= 100) return { label: 'AVG+', color: 'text-emerald-500', icon: Activity };
  if (pace >= 95) return { label: 'AVG-', color: 'text-warning', icon: Activity };
  return { label: 'SLOW', color: 'text-muted-foreground', icon: Activity };
}

/**
 * Pace Momentum Tracker - visualizes game pace evolution
 */
export function PaceMomentumTracker({ spot, className }: PaceMomentumTrackerProps) {
  const { liveData } = spot;
  
  // Only show for live games
  if (!liveData?.isLive && liveData?.gameStatus !== 'halftime') {
    return null;
  }
  
  const quarterPaceData = estimateQuarterPace(spot);
  const prediction = predict2HPace(spot);
  const currentPaceClass = getPaceClass(liveData.paceRating || 100);
  const predictedPaceClass = getPaceClass(prediction.predicted2HPace);
  
  // Calculate pace range for visualization
  const allPaces = quarterPaceData.map(q => q.pace);
  const minPace = Math.min(...allPaces, prediction.predicted2HPace) - 5;
  const maxPace = Math.max(...allPaces, prediction.predicted2HPace) + 5;
  const paceRange = maxPace - minPace;
  
  return (
    <div className={cn("space-y-2 p-3 rounded-lg bg-background/50 border border-border/50", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-semibold">Pace Momentum</span>
        </div>
        <div className={cn("flex items-center gap-1 text-xs font-mono font-bold", currentPaceClass.color)}>
          <currentPaceClass.icon className="w-3 h-3" />
          <span>{liveData.paceRating?.toFixed(0) || 100}</span>
          <span className="text-muted-foreground font-normal">({currentPaceClass.label})</span>
        </div>
      </div>
      
      {/* Quarter Pace Visualization */}
      <div className="relative h-12 flex items-end gap-1">
        {/* Baseline at 100 */}
        <div 
          className="absolute w-full border-t border-dashed border-muted-foreground/40 left-0"
          style={{ bottom: `${((100 - minPace) / paceRange) * 100}%` }}
        >
          <span className="absolute -top-2.5 right-0 text-[9px] text-muted-foreground">100</span>
        </div>
        
        {quarterPaceData.map((q) => {
          const height = ((q.pace - minPace) / paceRange) * 100;
          const paceClass = getPaceClass(q.pace);
          
          return (
            <div 
              key={q.quarter}
              className="flex-1 flex flex-col items-center"
            >
              {/* Bar */}
              <div className="relative w-full h-10 flex items-end justify-center">
                <div 
                  className={cn(
                    "w-full max-w-6 rounded-t transition-all duration-300",
                    q.isComplete ? "bg-foreground/80" : 
                    q.isCurrent ? "bg-primary animate-pulse" : 
                    "bg-muted/50 border border-dashed border-muted-foreground/30",
                  )}
                  style={{ height: `${height}%` }}
                />
                
                {/* Trend indicator */}
                {(q.isComplete || q.isCurrent) && q.trend !== 'stable' && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    {q.trend === 'up' ? (
                      <TrendingUp className="w-3 h-3 text-primary" />
                    ) : (
                      <TrendingDown className="w-3 h-3 text-destructive" />
                    )}
                  </div>
                )}
              </div>
              
              {/* Label */}
              <div className="mt-0.5 text-center">
                <span className={cn(
                  "text-[10px]",
                  q.isCurrent ? "text-foreground font-bold" : "text-muted-foreground"
                )}>
                  Q{q.quarter}
                </span>
                <div className={cn(
                  "text-[9px] font-mono",
                  q.isComplete || q.isCurrent ? paceClass.color : "text-muted-foreground/60"
                )}>
                  {q.pace.toFixed(0)}
                </div>
              </div>
            </div>
          );
        })}
        
        {/* 2H Prediction marker */}
        <div className="flex-1 flex flex-col items-center border-l border-dashed border-muted-foreground/30 pl-1">
          <div className="relative w-full h-10 flex items-end justify-center">
            <div 
              className={cn(
                "w-full max-w-6 rounded-t border-2 border-dashed",
                predictedPaceClass.color.replace('text-', 'border-'),
                "bg-transparent"
              )}
              style={{ height: `${((prediction.predicted2HPace - minPace) / paceRange) * 100}%` }}
            />
          </div>
          <div className="mt-0.5 text-center">
            <span className="text-[10px] text-muted-foreground">2H</span>
            <div className={cn("text-[9px] font-mono font-bold", predictedPaceClass.color)}>
              {prediction.predicted2HPace.toFixed(0)}
            </div>
          </div>
        </div>
      </div>
      
      {/* Prediction insight */}
      <div className="flex items-start gap-1.5 text-[10px]">
        <div className={cn(
          "shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
          prediction.confidence === 'high' ? "bg-primary/20 text-primary" :
          prediction.confidence === 'medium' ? "bg-warning/20 text-warning" :
          "bg-muted text-muted-foreground"
        )}>
          {prediction.confidence}
        </div>
        <span className="text-muted-foreground leading-tight">
          {prediction.insight}
        </span>
      </div>
      
      {/* Impact on projection */}
      {spot.side && (
        <div className={cn(
          "text-[10px] p-1.5 rounded",
          prediction.predicted2HPace > 100 
            ? spot.side === 'over' 
              ? "bg-primary/10 text-primary" 
              : "bg-destructive/10 text-destructive"
            : spot.side === 'under'
              ? "bg-primary/10 text-primary"
              : "bg-warning/10 text-warning"
        )}>
          {prediction.predicted2HPace > 100 ? (
            spot.side === 'over' ? (
              <span>⚡ Fast pace favors OVER - more possessions = more opportunities</span>
            ) : (
              <span>⚠️ Fast pace challenges UNDER - expect higher volume</span>
            )
          ) : (
            spot.side === 'under' ? (
              <span>✓ Slow pace supports UNDER - fewer possessions limit production</span>
            ) : (
              <span>⚠️ Slow pace challenges OVER - fewer opportunities expected</span>
            )
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Compact inline pace indicator
 */
export function PaceMomentumMini({ spot }: { spot: DeepSweetSpot }) {
  const { liveData } = spot;
  
  if (!liveData?.isLive && liveData?.gameStatus !== 'halftime') {
    return null;
  }
  
  const pace = liveData.paceRating || 100;
  const paceClass = getPaceClass(pace);
  const Icon = paceClass.icon;
  
  return (
    <div className={cn("flex items-center gap-0.5", paceClass.color)}>
      <Icon className="w-3 h-3" />
      <span className="text-xs font-mono font-semibold">{pace.toFixed(0)}</span>
    </div>
  );
}
