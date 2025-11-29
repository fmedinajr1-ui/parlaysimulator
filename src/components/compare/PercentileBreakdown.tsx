import { MonteCarloResult } from '@/lib/monte-carlo';
import { FeedCard } from '@/components/FeedCard';
import { Badge } from '@/components/ui/badge';
import { TrendingDown, TrendingUp, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';

interface PercentileBreakdownProps {
  results: MonteCarloResult[];
  stakes: number[];
}

export function PercentileBreakdown({ results, stakes }: PercentileBreakdownProps) {
  const isMobile = useIsMobile();
  
  // Find the range for scaling the visualization
  const allValues = results.flatMap(r => [
    r.percentiles.p5,
    r.percentiles.p95,
  ]);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const range = maxValue - minValue || 1;

  const getPosition = (value: number) => {
    return ((value - minValue) / range) * 100;
  };

  const formatValue = (value: number) => {
    if (value >= 0) return `+$${value.toFixed(0)}`;
    return `-$${Math.abs(value).toFixed(0)}`;
  };

  return (
    <FeedCard className="p-3 sm:p-4 mt-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3 sm:mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-primary" />
          <h3 className="font-display text-sm text-primary">RISK ASSESSMENT</h3>
        </div>
        <Badge variant="outline" className="text-[10px] w-fit sm:ml-auto">
          Percentile Distribution
        </Badge>
      </div>

      <p className="text-[10px] sm:text-xs text-muted-foreground mb-3 sm:mb-4">
        P5 = worst 5% | P95 = best 5%
      </p>

      {/* Legend - Simplified on mobile */}
      <div className="flex items-center gap-2 sm:gap-4 text-[9px] sm:text-xs text-muted-foreground mb-3 sm:mb-4 flex-wrap">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-destructive/60" />
          <span>P5</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-primary" />
          <span>P50</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-neon-green" />
          <span>P95</span>
        </div>
      </div>

      {/* Box Plot Style Visualizations */}
      <div className="space-y-4 sm:space-y-6">
        {results.map((result, idx) => {
          const { percentiles } = result;
          const stake = stakes[idx];
          
          return (
            <div key={idx} className="space-y-1.5 sm:space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm font-medium">Parlay {idx + 1}</span>
                <span className="text-[10px] sm:text-xs text-muted-foreground">
                  ${stake.toFixed(0)}
                </span>
              </div>

              {/* Box Plot - Simplified on mobile */}
              <div className="relative h-8 sm:h-10 bg-muted/30 rounded-lg overflow-hidden">
                {/* Zero line indicator */}
                {minValue < 0 && maxValue > 0 && (
                  <div 
                    className="absolute top-0 bottom-0 w-px bg-border z-10"
                    style={{ left: `${getPosition(0)}%` }}
                  >
                    {!isMobile && (
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground">
                        $0
                      </span>
                    )}
                  </div>
                )}

                {/* Whisker line (P5 to P95) */}
                <div 
                  className="absolute top-1/2 -translate-y-1/2 h-1 bg-muted-foreground/30"
                  style={{
                    left: `${getPosition(percentiles.p5)}%`,
                    width: `${getPosition(percentiles.p95) - getPosition(percentiles.p5)}%`,
                  }}
                />

                {/* Box (P25 to P75) */}
                <div 
                  className="absolute top-1/2 -translate-y-1/2 h-5 sm:h-6 rounded bg-primary/20 border border-primary/40"
                  style={{
                    left: `${getPosition(percentiles.p25)}%`,
                    width: `${getPosition(percentiles.p75) - getPosition(percentiles.p25)}%`,
                  }}
                />

                {/* P5 marker */}
                <div 
                  className="absolute top-1/2 -translate-y-1/2 w-1.5 sm:w-2 h-5 sm:h-6 rounded-sm bg-destructive/60"
                  style={{ left: `${getPosition(percentiles.p5)}%`, transform: 'translate(-50%, -50%)' }}
                />

                {/* P50 (Median) marker */}
                <div 
                  className="absolute top-1/2 -translate-y-1/2 w-1 sm:w-1.5 h-6 sm:h-8 bg-primary rounded-full"
                  style={{ left: `${getPosition(percentiles.p50)}%`, transform: 'translate(-50%, -50%)' }}
                />

                {/* P95 marker */}
                <div 
                  className="absolute top-1/2 -translate-y-1/2 w-1.5 sm:w-2 h-5 sm:h-6 rounded-sm bg-neon-green"
                  style={{ left: `${getPosition(percentiles.p95)}%`, transform: 'translate(-50%, -50%)' }}
                />
              </div>

              {/* Values Grid - 3 key values on mobile, 5 on desktop */}
              {isMobile ? (
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div className="rounded bg-destructive/10 p-1">
                    <p className="text-[9px] text-muted-foreground">P5</p>
                    <p className={cn(
                      "text-[10px] font-bold",
                      percentiles.p5 >= 0 ? "text-neon-green" : "text-destructive"
                    )}>
                      {formatValue(percentiles.p5)}
                    </p>
                  </div>
                  <div className="rounded bg-primary/10 p-1">
                    <p className="text-[9px] text-muted-foreground">P50</p>
                    <p className={cn(
                      "text-[10px] font-bold",
                      percentiles.p50 >= 0 ? "text-neon-green" : "text-destructive"
                    )}>
                      {formatValue(percentiles.p50)}
                    </p>
                  </div>
                  <div className="rounded bg-neon-green/20 p-1">
                    <p className="text-[9px] text-muted-foreground">P95</p>
                    <p className={cn(
                      "text-[10px] font-bold",
                      percentiles.p95 >= 0 ? "text-neon-green" : "text-destructive"
                    )}>
                      {formatValue(percentiles.p95)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-1 text-center">
                  <div className="rounded bg-destructive/10 p-1.5">
                    <p className="text-[10px] text-muted-foreground">P5</p>
                    <p className={cn(
                      "text-xs font-bold",
                      percentiles.p5 >= 0 ? "text-neon-green" : "text-destructive"
                    )}>
                      {formatValue(percentiles.p5)}
                    </p>
                  </div>
                  <div className="rounded bg-neon-orange/10 p-1.5">
                    <p className="text-[10px] text-muted-foreground">P25</p>
                    <p className={cn(
                      "text-xs font-bold",
                      percentiles.p25 >= 0 ? "text-neon-green" : "text-destructive"
                    )}>
                      {formatValue(percentiles.p25)}
                    </p>
                  </div>
                  <div className="rounded bg-primary/10 p-1.5">
                    <p className="text-[10px] text-muted-foreground">P50</p>
                    <p className={cn(
                      "text-xs font-bold",
                      percentiles.p50 >= 0 ? "text-neon-green" : "text-destructive"
                    )}>
                      {formatValue(percentiles.p50)}
                    </p>
                  </div>
                  <div className="rounded bg-neon-green/10 p-1.5">
                    <p className="text-[10px] text-muted-foreground">P75</p>
                    <p className={cn(
                      "text-xs font-bold",
                      percentiles.p75 >= 0 ? "text-neon-green" : "text-destructive"
                    )}>
                      {formatValue(percentiles.p75)}
                    </p>
                  </div>
                  <div className="rounded bg-neon-green/20 p-1.5">
                    <p className="text-[10px] text-muted-foreground">P95</p>
                    <p className={cn(
                      "text-xs font-bold",
                      percentiles.p95 >= 0 ? "text-neon-green" : "text-destructive"
                    )}>
                      {formatValue(percentiles.p95)}
                    </p>
                  </div>
                </div>
              )}

              {/* Risk Summary - Simplified text on mobile */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 sm:gap-2 text-[9px] sm:text-xs">
                  <TrendingDown className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-destructive" />
                  <span className="text-muted-foreground">
                    {isMobile ? `95% lose ≤ ${formatValue(-percentiles.p5)}` : `95% of the time you'll lose at least ${formatValue(-percentiles.p5 > 0 ? percentiles.p5 : percentiles.p5)}`}
                  </span>
                </div>
                <div className="flex items-center gap-1 sm:gap-2 text-[9px] sm:text-xs">
                  <TrendingUp className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-neon-green" />
                  <span className="text-muted-foreground">
                    {isMobile ? `5% win ${formatValue(percentiles.p95)}` : `5% chance to win ${formatValue(percentiles.p95)}`}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Comparison Summary */}
      {results.length > 1 && (
        <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-border">
          <h4 className="text-xs sm:text-sm font-medium mb-2">Risk Comparison</h4>
          <div className="grid grid-cols-2 gap-2 text-[10px] sm:text-xs">
            <div>
              <span className="text-muted-foreground">Lowest Risk:</span>
              <p className="font-bold text-neon-green">
                P{results.reduce((best, curr, idx) => 
                  curr.percentiles.p5 > results[best].percentiles.p5 ? idx : best, 0
                ) + 1}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Highest Upside:</span>
              <p className="font-bold text-neon-green">
                P{results.reduce((best, curr, idx) => 
                  curr.percentiles.p95 > results[best].percentiles.p95 ? idx : best, 0
                ) + 1}
              </p>
            </div>
          </div>
        </div>
      )}
    </FeedCard>
  );
}
