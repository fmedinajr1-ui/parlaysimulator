import { cn } from "@/lib/utils";
import type { DeepSweetSpot } from "@/types/sweetSpot";

interface QuarterProgressSparklineProps {
  spot: DeepSweetSpot;
  className?: string;
}

interface QuarterData {
  quarter: number;
  expected: number;
  actual: number | null; // null if quarter hasn't happened
  isComplete: boolean;
  isCurrent: boolean;
}

/**
 * Estimates per-quarter production based on current value and game progress
 * Uses simple linear distribution when historical data unavailable
 */
function estimateQuarterData(spot: DeepSweetSpot): QuarterData[] {
  const { line, liveData } = spot;
  const expectedPerQuarter = line / 4;
  const currentQuarter = liveData?.currentQuarter || 0;
  const currentValue = liveData?.currentValue || 0;
  
  // For now, estimate even distribution across completed quarters
  // In future, this could use actual quarter snapshots
  const completedQuarters = Math.max(0, currentQuarter - 1);
  const avgPerCompletedQuarter = completedQuarters > 0 
    ? currentValue / currentQuarter // Current quarter partial included
    : 0;
  
  return [1, 2, 3, 4].map(q => {
    if (q < currentQuarter) {
      // Completed quarter - estimate based on average
      return {
        quarter: q,
        expected: expectedPerQuarter,
        actual: avgPerCompletedQuarter,
        isComplete: true,
        isCurrent: false,
      };
    } else if (q === currentQuarter) {
      // Current quarter - show partial progress
      const partialValue = currentValue - (completedQuarters * avgPerCompletedQuarter);
      return {
        quarter: q,
        expected: expectedPerQuarter,
        actual: Math.max(0, partialValue),
        isComplete: false,
        isCurrent: true,
      };
    } else {
      // Future quarter
      return {
        quarter: q,
        expected: expectedPerQuarter,
        actual: null,
        isComplete: false,
        isCurrent: false,
      };
    }
  });
}

/**
 * Get bar color based on performance vs expectation
 */
function getBarColor(actual: number | null, expected: number, isComplete: boolean, isCurrent: boolean): string {
  if (actual === null) return 'bg-muted/30'; // Future
  
  const ratio = expected > 0 ? actual / expected : 0;
  
  if (ratio >= 1.2) return 'bg-primary'; // 20%+ ahead
  if (ratio >= 0.9) return 'bg-emerald-500'; // On track
  if (ratio >= 0.7) return 'bg-warning'; // Slightly behind
  return 'bg-destructive'; // Significantly behind
}

/**
 * Compact sparkline showing quarter-by-quarter production vs projection
 */
export function QuarterProgressSparkline({ spot, className }: QuarterProgressSparklineProps) {
  const { liveData, line, side } = spot;
  
  // Only show for live games
  if (!liveData?.isLive && liveData?.gameStatus !== 'halftime') {
    return null;
  }
  
  const quarterData = estimateQuarterData(spot);
  const expectedPerQuarter = line / 4;
  const maxValue = Math.max(expectedPerQuarter * 1.5, ...quarterData.map(q => q.actual || 0));
  
  // Calculate cumulative progress
  const totalActual = quarterData.reduce((sum, q) => sum + (q.actual || 0), 0);
  const currentQuarter = liveData.currentQuarter || 1;
  const expectedAtThisPoint = expectedPerQuarter * currentQuarter;
  const pacePercent = expectedAtThisPoint > 0 
    ? Math.round((totalActual / expectedAtThisPoint) * 100) 
    : 100;
  
  return (
    <div className={cn("space-y-1", className)}>
      {/* Header with pace indicator */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Quarter Progress</span>
        <span className={cn(
          "font-mono font-semibold",
          pacePercent >= 100 ? "text-primary" : 
          pacePercent >= 85 ? "text-warning" : 
          "text-destructive"
        )}>
          {pacePercent}% pace
        </span>
      </div>
      
      {/* Sparkline bars */}
      <div className="flex items-end gap-1 h-8">
        {quarterData.map((q) => {
          const actualHeight = q.actual !== null 
            ? Math.max(4, (q.actual / maxValue) * 100) 
            : 0;
          const expectedHeight = (q.expected / maxValue) * 100;
          const barColor = getBarColor(q.actual, q.expected, q.isComplete, q.isCurrent);
          
          return (
            <div 
              key={q.quarter} 
              className="flex-1 flex flex-col items-center gap-0.5"
            >
              {/* Bar container */}
              <div className="relative w-full h-6 flex items-end">
                {/* Expected line marker */}
                <div 
                  className="absolute w-full border-t border-dashed border-muted-foreground/40"
                  style={{ bottom: `${expectedHeight}%` }}
                />
                
                {/* Actual bar */}
                <div 
                  className={cn(
                    "w-full rounded-t transition-all duration-300",
                    barColor,
                    q.isCurrent && "animate-pulse"
                  )}
                  style={{ 
                    height: `${actualHeight}%`,
                    minHeight: q.actual !== null ? '4px' : '0'
                  }}
                />
              </div>
              
              {/* Quarter label */}
              <span className={cn(
                "text-[10px]",
                q.isCurrent ? "text-foreground font-semibold" : "text-muted-foreground"
              )}>
                Q{q.quarter}
              </span>
            </div>
          );
        })}
      </div>
      
      {/* Legend */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Expected: {expectedPerQuarter.toFixed(1)}/Q</span>
        <div className="flex items-center gap-1">
          <span className="w-3 border-t border-dashed border-muted-foreground/60" />
          <span>target</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Mini inline version for tight spaces
 */
export function QuarterProgressMini({ spot }: { spot: DeepSweetSpot }) {
  const { liveData, line } = spot;
  
  if (!liveData?.isLive && liveData?.gameStatus !== 'halftime') {
    return null;
  }
  
  const quarterData = estimateQuarterData(spot);
  const expectedPerQuarter = line / 4;
  
  return (
    <div className="flex items-center gap-0.5">
      {quarterData.map((q) => {
        const ratio = q.actual !== null && q.expected > 0 
          ? q.actual / q.expected 
          : 0;
        
        let dotColor = 'bg-muted/30';
        if (q.actual !== null) {
          if (ratio >= 1.1) dotColor = 'bg-primary';
          else if (ratio >= 0.9) dotColor = 'bg-emerald-500';
          else if (ratio >= 0.7) dotColor = 'bg-warning';
          else dotColor = 'bg-destructive';
        }
        
        return (
          <div 
            key={q.quarter}
            className={cn(
              "w-2 h-2 rounded-full",
              dotColor,
              q.isCurrent && "ring-1 ring-foreground ring-offset-1 ring-offset-background"
            )}
            title={`Q${q.quarter}: ${q.actual?.toFixed(1) || '-'} / ${q.expected.toFixed(1)} expected`}
          />
        );
      })}
    </div>
  );
}
