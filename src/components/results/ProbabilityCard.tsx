import { FeedCard } from "../FeedCard";
import { DEGEN_TIERS, DegenerateLevel, ParlaySimulation, ParlayAnalysis } from "@/types/parlay";
import { useEffect, useState } from "react";
import { useEnhancedProbability } from "@/hooks/useEnhancedProbability";
import { ProbabilityConfidenceIndicator } from "./ProbabilityConfidenceIndicator";
import { ChevronDown, ChevronUp, BarChart3, Sparkles, Link2, Calculator, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface ProbabilityCardProps {
  probability: number;
  degenerateLevel: DegenerateLevel;
  delay?: number;
  simulation?: ParlaySimulation;
  aiAnalysis?: ParlayAnalysis | null;
}

export function ProbabilityCard({ 
  probability, 
  degenerateLevel, 
  delay = 0,
  simulation,
  aiAnalysis,
}: ProbabilityCardProps) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [displayPct, setDisplayPct] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const tier = DEGEN_TIERS[degenerateLevel];

  // Use enhanced probability if simulation data is available
  const legs = simulation?.legs || [];
  const enhanced = useEnhancedProbability(legs, aiAnalysis);
  
  // Use enhanced final probability if available, otherwise fall back to naive
  const actualPct = legs.length > 0 && !enhanced.isCalculating 
    ? enhanced.breakdown.final 
    : probability * 100;
  
  const naivePct = probability * 100;

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsAnimating(true);
      const duration = 1500;
      const steps = 60;
      const increment = actualPct / steps;
      let current = 0;
      
      const interval = setInterval(() => {
        current += increment;
        if (current >= actualPct) {
          setDisplayPct(actualPct);
          clearInterval(interval);
          setShowEmoji(true);
        } else {
          setDisplayPct(current);
        }
      }, duration / steps);

      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(timer);
  }, [actualPct, delay]);

  const getColorClass = () => {
    if (actualPct < 2) return "text-neon-red";
    if (actualPct < 5) return "text-neon-orange";
    if (actualPct < 15) return "text-neon-yellow";
    if (actualPct < 30) return "text-neon-purple";
    return "text-neon-green";
  };

  const getGlowClass = () => {
    if (actualPct < 2) return "drop-shadow-[0_0_30px_hsl(var(--neon-red)/0.5)]";
    if (actualPct < 5) return "drop-shadow-[0_0_30px_hsl(var(--neon-orange)/0.5)]";
    if (actualPct < 15) return "drop-shadow-[0_0_30px_hsl(var(--neon-yellow)/0.5)]";
    if (actualPct < 30) return "drop-shadow-[0_0_30px_hsl(var(--neon-purple)/0.5)]";
    return "drop-shadow-[0_0_30px_hsl(var(--neon-green)/0.5)]";
  };

  const formatDiff = (diff: number) => {
    if (Math.abs(diff) < 0.1) return null;
    return diff > 0 ? `+${diff.toFixed(1)}%` : `${diff.toFixed(1)}%`;
  };

  const hasEnhancedData = legs.length > 0 && (enhanced.hasAiData || enhanced.hasCorrelationData);

  return (
    <FeedCard variant="glow" delay={delay} className="text-center">
      <div className="flex items-center justify-center gap-2 mb-4">
        <p className="text-sm text-muted-foreground uppercase tracking-wider">
          🎯 Win Probability
        </p>
        {enhanced.isCalculating && (
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
        )}
      </div>
      
      <div className="relative mb-4 inline-block">
        <motion.span 
          key={displayPct.toFixed(1)}
          className={`font-display text-7xl md:text-8xl ${getColorClass()} ${isAnimating ? getGlowClass() : ''} transition-all duration-500`}
        >
          {displayPct.toFixed(1)}%
        </motion.span>
        {showEmoji && (
          <span className="absolute -right-8 -top-2 text-5xl emoji-bounce">
            {tier.emoji}
          </span>
        )}
      </div>

      {/* Confidence indicator */}
      {hasEnhancedData && (
        <div className="mb-4">
          <ProbabilityConfidenceIndicator
            confidenceScore={enhanced.confidenceScore}
            confidenceLevel={enhanced.confidenceLevel}
            confidenceFactors={enhanced.confidenceFactors}
            correlationWarnings={enhanced.correlationWarnings}
            isCalculating={enhanced.isCalculating}
          />
        </div>
      )}

      <p className="text-lg text-muted-foreground max-w-xs mx-auto">
        {tier.subtext}
      </p>

      {/* Probability Breakdown Toggle */}
      {hasEnhancedData && (
        <div className="mt-4 pt-4 border-t border-border/50">
          <button
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="flex items-center justify-center gap-2 w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>Probability Breakdown</span>
            {showBreakdown ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>

          <AnimatePresence>
            {showBreakdown && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 space-y-2 text-left">
                  {/* Book Odds */}
                  <div className="flex items-center justify-between py-1.5 px-2 rounded bg-muted/50">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Book Implied</span>
                    </div>
                    <span className="text-sm font-mono">{naivePct.toFixed(1)}%</span>
                  </div>

                  {/* AI Adjusted */}
                  {enhanced.hasAiData && (
                    <div className="flex items-center justify-between py-1.5 px-2 rounded bg-primary/10">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span className="text-sm text-muted-foreground">AI Adjusted</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-mono">{enhanced.breakdown.aiAdjusted.toFixed(1)}%</span>
                        {formatDiff(enhanced.breakdown.aiAdjusted - naivePct) && (
                          <span className={cn(
                            "text-xs",
                            enhanced.breakdown.aiAdjusted > naivePct ? "text-green-500" : "text-red-500"
                          )}>
                            ({formatDiff(enhanced.breakdown.aiAdjusted - naivePct)})
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Correlation Adjusted */}
                  {enhanced.hasCorrelationData && (
                    <div className="flex items-center justify-between py-1.5 px-2 rounded bg-purple-500/10">
                      <div className="flex items-center gap-2">
                        <Link2 className="h-4 w-4 text-purple-500" />
                        <span className="text-sm text-muted-foreground">Correlation</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-mono">{enhanced.breakdown.correlation.toFixed(1)}%</span>
                        {formatDiff(enhanced.correlationImpact) && (
                          <span className={cn(
                            "text-xs",
                            enhanced.correlationImpact > 0 ? "text-green-500" : "text-red-500"
                          )}>
                            ({formatDiff(enhanced.correlationImpact)})
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Final */}
                  <div className={cn(
                    "flex items-center justify-between py-2 px-2 rounded border",
                    getColorClass().replace('text-', 'border-').replace('neon-', '')
                  )}>
                    <div className="flex items-center gap-2">
                      <Calculator className={cn("h-4 w-4", getColorClass())} />
                      <span className="text-sm font-medium">Final Estimate</span>
                    </div>
                    <span className={cn("text-sm font-bold font-mono", getColorClass())}>
                      {actualPct.toFixed(1)}%
                    </span>
                  </div>

                  {/* Correlation warnings */}
                  {enhanced.correlationWarnings.length > 0 && (
                    <div className="p-2 rounded bg-yellow-500/10 border border-yellow-500/20 mt-2">
                      <p className="text-xs text-yellow-600 dark:text-yellow-400">
                        ⚠️ {enhanced.correlationWarnings[0]}
                      </p>
                    </div>
                  )}

                  <p className="text-[10px] text-muted-foreground text-center pt-2">
                    Weighted: AI (40%) + Correlation (50%) + Book (10%)
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      
      {/* Fun stat - only show if no breakdown */}
      {!hasEnhancedData && (
        <div className="mt-4 pt-4 border-t border-border/50">
          <p className="text-sm text-muted-foreground">
            {actualPct < 5 
              ? "🎰 You'd have better luck at the slot machines"
              : actualPct < 15 
              ? "😰 Prepare for a sweaty Sunday"
              : actualPct < 30 
              ? "🤔 Not impossible, but not great"
              : "✅ This might actually have a chance"}
          </p>
        </div>
      )}
    </FeedCard>
  );
}
