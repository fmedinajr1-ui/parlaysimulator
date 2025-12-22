import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, TrendingUp, TrendingDown, Calculator, Sparkles, Link2, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useBuilderProbability } from '@/hooks/useEnhancedProbability';
import { ProbabilityConfidenceIndicator } from '@/components/results/ProbabilityConfidenceIndicator';

interface LiveProbabilitySimulatorProps {
  legs: { odds: number; impliedProbability?: number }[];
  className?: string;
}

export function LiveProbabilitySimulator({ legs, className }: LiveProbabilitySimulatorProps) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  
  const {
    breakdown,
    confidenceScore,
    confidenceLevel,
    confidenceFactors,
    correlationImpact,
    correlationWarnings,
    isCalculating,
    hasCorrelationData,
  } = useBuilderProbability(legs);

  if (legs.length === 0) return null;

  const finalProb = breakdown.final;
  const bookProb = breakdown.bookOdds;

  // Determine color based on probability
  const getProbColor = (prob: number) => {
    if (prob < 5) return 'text-red-500';
    if (prob < 15) return 'text-orange-500';
    if (prob < 30) return 'text-yellow-500';
    return 'text-green-500';
  };

  const formatDiff = (diff: number) => {
    if (Math.abs(diff) < 0.1) return '0.0';
    return diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
  };

  const aiDiff = breakdown.aiAdjusted - bookProb;
  const corrDiff = correlationImpact;

  return (
    <div className={cn("rounded-lg bg-muted/30 border border-border/50", className)}>
      {/* Main probability display */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Enhanced Probability
            </span>
            {isCalculating && (
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
            )}
          </div>
          <ProbabilityConfidenceIndicator
            confidenceScore={confidenceScore}
            confidenceLevel={confidenceLevel}
            confidenceFactors={confidenceFactors}
            correlationWarnings={correlationWarnings}
            isCalculating={isCalculating}
            compact
          />
        </div>

        {/* Final probability - animated */}
        <div className="flex items-baseline gap-2">
          <motion.span
            key={finalProb.toFixed(1)}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn("text-3xl font-display font-bold", getProbColor(finalProb))}
          >
            {finalProb.toFixed(1)}%
          </motion.span>
          <span className="text-xs text-muted-foreground">
            win probability
          </span>
        </div>

        {/* Quick comparison to book odds */}
        {Math.abs(finalProb - bookProb) > 0.5 && (
          <div className="flex items-center gap-1 mt-1">
            {finalProb > bookProb ? (
              <TrendingUp className="h-3 w-3 text-green-500" />
            ) : (
              <TrendingDown className="h-3 w-3 text-red-500" />
            )}
            <span className={cn(
              "text-xs",
              finalProb > bookProb ? "text-green-500" : "text-red-500"
            )}>
              {formatDiff(finalProb - bookProb)}% vs book odds
            </span>
          </div>
        )}
      </div>

      {/* Toggle breakdown */}
      <button
        onClick={() => setShowBreakdown(!showBreakdown)}
        className="w-full px-3 py-2 flex items-center justify-between text-xs text-muted-foreground hover:bg-muted/50 transition-colors border-t border-border/50"
      >
        <span>View probability breakdown</span>
        {showBreakdown ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {/* Breakdown section */}
      <AnimatePresence>
        {showBreakdown && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              {/* Book Odds */}
              <div className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-muted flex items-center justify-center">
                    <BarChart3 className="h-3 w-3 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-muted-foreground">Book Implied</span>
                </div>
                <span className="text-sm font-mono">{bookProb.toFixed(1)}%</span>
              </div>

              {/* AI Adjusted */}
              <div className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-primary/20 flex items-center justify-center">
                    <Sparkles className="h-3 w-3 text-primary" />
                  </div>
                  <span className="text-xs text-muted-foreground">AI Adjusted</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-mono">{breakdown.aiAdjusted.toFixed(1)}%</span>
                  {Math.abs(aiDiff) > 0.1 && (
                    <span className={cn(
                      "text-xs",
                      aiDiff > 0 ? "text-green-500" : "text-red-500"
                    )}>
                      ({formatDiff(aiDiff)})
                    </span>
                  )}
                </div>
              </div>

              {/* Correlation Adjusted */}
              {hasCorrelationData && (
                <div className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">
                      <Link2 className="h-3 w-3 text-purple-500" />
                    </div>
                    <span className="text-xs text-muted-foreground">Correlation</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-mono">{breakdown.correlation.toFixed(1)}%</span>
                    {Math.abs(corrDiff) > 0.1 && (
                      <span className={cn(
                        "text-xs",
                        corrDiff > 0 ? "text-green-500" : "text-red-500"
                      )}>
                        ({formatDiff(corrDiff)})
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Divider */}
              <div className="border-t border-border/50 my-1" />

              {/* Final */}
              <div className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-5 h-5 rounded flex items-center justify-center",
                    getProbColor(finalProb).replace('text-', 'bg-').replace('500', '500/20')
                  )}>
                    <Calculator className={cn("h-3 w-3", getProbColor(finalProb))} />
                  </div>
                  <span className="text-xs font-medium">Final Estimate</span>
                </div>
                <span className={cn("text-sm font-bold font-mono", getProbColor(finalProb))}>
                  {finalProb.toFixed(1)}%
                </span>
              </div>

              {/* Correlation warnings */}
              {correlationWarnings.length > 0 && (
                <div className="mt-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/20">
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    ⚠️ {correlationWarnings[0]}
                  </p>
                </div>
              )}

              {/* How we calculate tooltip */}
              <p className="text-[10px] text-muted-foreground pt-1">
                Final = AI (40%) + Correlation (50%) + Book (10%) weighted average
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
