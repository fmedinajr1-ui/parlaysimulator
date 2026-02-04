import { Clock, TrendingUp, TrendingDown, Zap, Target, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import type { DeepSweetSpot, HalftimeRecalibration } from "@/types/sweetSpot";

interface HalftimeRecalibrationCardProps {
  recalibration: HalftimeRecalibration;
  spot: DeepSweetSpot;
}

// Get variance color based on threshold
function getVarianceColor(variance: number): string {
  if (variance >= 15) return 'text-primary';
  if (variance >= 0) return 'text-emerald-500';
  if (variance >= -15) return 'text-warning';
  return 'text-destructive';
}

// Get recommendation urgency color
function getRecommendationStyle(confidenceBoost: number): { bg: string; text: string } {
  if (confidenceBoost > 0) return { bg: 'bg-primary/20', text: 'text-primary' };
  if (confidenceBoost < 0) return { bg: 'bg-destructive/20', text: 'text-destructive' };
  return { bg: 'bg-muted/20', text: 'text-muted-foreground' };
}

export function HalftimeRecalibrationCard({ recalibration, spot }: HalftimeRecalibrationCardProps) {
  const {
    actual1H,
    expected1H,
    variance1H,
    historical1HRate,
    historical2HRate,
    regressionFactor,
    linearProjection,
    recalibratedProjection,
    projectionDelta,
    paceAdjustment,
    insight,
    recommendation,
    confidenceBoost,
  } = recalibration;

  const recommendationStyle = getRecommendationStyle(confidenceBoost);
  const progressPercent = Math.min(100, (actual1H / spot.line) * 100);
  const isAhead = variance1H >= 0;

  return (
    <div className="mb-3 p-3 rounded-lg border border-warning/30 bg-warning/5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-warning" />
          <span className="font-bold text-sm text-warning">HALFTIME RECALIBRATION</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {spot.playerName} • {spot.side.toUpperCase()} {spot.line}
        </span>
      </div>

      {/* 1st Half Analysis Section */}
      <div className="mb-3 p-2 rounded bg-background/50 border border-border/30">
        <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
          <Activity className="w-3 h-3" />
          1ST HALF ANALYSIS
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          {/* Actual vs Expected */}
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs text-muted-foreground">Actual:</span>
              <span className="font-mono font-bold text-lg">{actual1H}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted-foreground">Expected:</span>
              <span className="font-mono text-sm text-muted-foreground">{expected1H}</span>
            </div>
          </div>
          
          {/* Variance */}
          <div className="flex flex-col items-end justify-center">
            <span className="text-xs text-muted-foreground mb-1">Variance:</span>
            <div className="flex items-center gap-1">
              {isAhead ? (
                <TrendingUp className={cn("w-4 h-4", getVarianceColor(variance1H))} />
              ) : (
                <TrendingDown className={cn("w-4 h-4", getVarianceColor(variance1H))} />
              )}
              <span className={cn("font-mono font-bold text-lg", getVarianceColor(variance1H))}>
                {variance1H >= 0 ? '+' : ''}{variance1H.toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        {/* Progress toward line */}
        <div className="mt-2">
          <Progress value={progressPercent} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{actual1H} / {spot.line}</span>
            <span>{progressPercent.toFixed(0)}% complete</span>
          </div>
        </div>
      </div>

      {/* 2nd Half Projection Section */}
      <div className="mb-3 p-2 rounded bg-background/50 border border-border/30">
        <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
          <Target className="w-3 h-3" />
          2ND HALF PROJECTION
        </div>
        
        <div className="space-y-2">
          {/* Linear vs Recalibrated side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-2 rounded bg-muted/20 border border-muted/30">
              <div className="text-xs text-muted-foreground mb-1">Linear Model</div>
              <div className="font-mono font-bold text-foreground">{linearProjection}</div>
              <div className="text-xs text-muted-foreground">(current pace)</div>
            </div>
            <div className={cn(
              "p-2 rounded border",
              recalibratedProjection >= spot.line 
                ? "bg-primary/10 border-primary/30" 
                : "bg-destructive/10 border-destructive/30"
            )}>
              <div className="text-xs text-muted-foreground mb-1">Recalibrated</div>
              <div className={cn(
                "font-mono font-bold",
                recalibratedProjection >= spot.line ? "text-primary" : "text-destructive"
              )}>
                {recalibratedProjection}
              </div>
              <div className="text-xs text-muted-foreground">(history-weighted)</div>
            </div>
          </div>

          {/* Adjustment indicator */}
          {Math.abs(projectionDelta) >= 0.5 && (
            <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
              <span>Adjustment:</span>
              <span className={cn(
                "font-mono font-semibold",
                projectionDelta > 0 ? "text-destructive" : "text-primary"
              )}>
                {projectionDelta > 0 ? '-' : '+'}{Math.abs(projectionDelta).toFixed(1)}
              </span>
              <span>(fatigue decay)</span>
            </div>
          )}
        </div>
      </div>

      {/* Recalibration Factors */}
      <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
        <div className="p-1.5 rounded bg-muted/20 text-center">
          <div className="text-muted-foreground">1H Rate</div>
          <div className="font-mono font-semibold">{historical1HRate}/min</div>
        </div>
        <div className="p-1.5 rounded bg-muted/20 text-center">
          <div className="text-muted-foreground">2H Rate</div>
          <div className="font-mono font-semibold">{historical2HRate}/min</div>
        </div>
        <div className="p-1.5 rounded bg-muted/20 text-center">
          <div className="text-muted-foreground">Regression</div>
          <div className="font-mono font-semibold">{((1 - regressionFactor) * 100).toFixed(0)}%</div>
        </div>
      </div>

      {/* Pace Factor (if significant) */}
      {Math.abs(paceAdjustment) >= 0.02 && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <Zap className="w-3 h-3 text-muted-foreground" />
          <span className="text-muted-foreground">Pace Factor:</span>
          <span className={cn(
            "font-mono font-semibold",
            paceAdjustment > 0 ? "text-primary" : "text-destructive"
          )}>
            {paceAdjustment > 0 ? '+' : ''}{(paceAdjustment * 100).toFixed(0)}%
          </span>
          <span className="text-muted-foreground">
            ({paceAdjustment > 0 ? 'fast pace boost' : 'slow pace penalty'})
          </span>
        </div>
      )}

      {/* Insight */}
      <div className="mb-2 text-xs text-muted-foreground">
        <span className="mr-1">⚡</span>
        {insight}
      </div>

      {/* Recommendation */}
      <div className={cn("p-2 rounded text-xs font-semibold", recommendationStyle.bg, recommendationStyle.text)}>
        {recommendation}
      </div>
    </div>
  );
}
