import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRightLeft, ChevronDown, ChevronUp, Loader2, AlertTriangle, TrendingUp, Target, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
import { useSwapAlternatives, SwapAlternative } from '@/hooks/useSwapAlternatives';
import { ParlayLeg, LegAnalysis } from '@/types/parlay';
import { UniversalLeg } from '@/types/universal-parlay';
import { cn } from '@/lib/utils';

interface SmartLegSwapCardProps {
  legs: ParlayLeg[];
  legAnalyses?: LegAnalysis[];
  delay?: number;
}

export const SmartLegSwapCard = ({ legs, legAnalyses, delay = 0 }: SmartLegSwapCardProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { swapLeg, removeLeg, addLeg } = useParlayBuilder();
  const { alternatives, loading, findAlternatives, clearAlternatives } = useSwapAlternatives();

  // Find the weakest leg based on analysis
  const weakestLegData = React.useMemo(() => {
    if (!legAnalyses || legAnalyses.length === 0) return null;

    let weakestIndex = -1;
    let lowestScore = Infinity;
    let reason = '';

    legAnalyses.forEach((analysis, index) => {
      let score = 50; // Base score

      // Factor in sharp recommendation
      if (analysis.sharpRecommendation === 'fade') {
        score -= 30;
        reason = 'AI recommends fading';
      } else if (analysis.sharpRecommendation === 'caution') {
        score -= 15;
        reason = 'Caution signals detected';
      }

      // Factor in confidence level
      if (analysis.confidenceLevel === 'low') {
        score -= 20;
        reason = reason || 'Low confidence';
      }

      // Factor in trap detection from unified data
      if (analysis.unifiedPropData?.trapScore && analysis.unifiedPropData.trapScore > 60) {
        score -= 25;
        reason = 'Trap bet detected';
      }

      // Factor in adjusted probability
      if (analysis.adjustedProbability && analysis.adjustedProbability < 0.4) {
        score -= 15;
        reason = reason || `Only ${Math.round(analysis.adjustedProbability * 100)}% probability`;
      }

      if (score < lowestScore) {
        lowestScore = score;
        weakestIndex = index;
      }
    });

    if (weakestIndex === -1) return null;

    const leg = legs[weakestIndex];
    const analysis = legAnalyses[weakestIndex];

    return {
      index: weakestIndex,
      leg,
      analysis,
      reason,
      impactScore: Math.max(0, 100 - lowestScore),
    };
  }, [legs, legAnalyses]);

  // Don't render if no weak leg detected or less than 2 legs
  if (!weakestLegData || legs.length < 2) {
    return null;
  }

  const handleFindSwaps = async () => {
    setIsExpanded(true);
    const universalLeg: UniversalLeg = {
      id: weakestLegData.leg.id || `weak-${weakestLegData.index}`,
      description: weakestLegData.leg.description,
      odds: weakestLegData.leg.odds,
      source: 'manual',
      playerName: weakestLegData.analysis?.player,
      propType: weakestLegData.analysis?.betType,
      sport: weakestLegData.analysis?.sport,
      addedAt: new Date().toISOString(),
    };
    await findAlternatives(universalLeg);
  };

  const handleSwap = (alternative: SwapAlternative) => {
    const newLeg: Omit<UniversalLeg, 'id' | 'addedAt'> = {
      description: alternative.description,
      odds: alternative.estimatedOdds,
      source: alternative.source === 'median_lock' ? 'hitrate' : 
              alternative.source === 'juiced' ? 'juiced' : 'suggestions',
      playerName: alternative.playerName,
      propType: alternative.propType,
      line: alternative.line,
      side: alternative.side,
      confidenceScore: alternative.confidence,
    };

    // Remove old leg and add new one
    if (weakestLegData.leg.id) {
      removeLeg(weakestLegData.leg.id);
    }
    addLeg(newLeg);
    clearAlternatives();
    setIsExpanded(false);
  };

  const getRecommendationStyle = (rec: string) => {
    switch (rec) {
      case 'strong_upgrade':
        return 'border-green-500/50 bg-green-500/10';
      case 'upgrade':
        return 'border-neon-cyan/50 bg-neon-cyan/10';
      case 'slight_upgrade':
        return 'border-yellow-500/50 bg-yellow-500/10';
      default:
        return 'border-muted/50 bg-muted/10';
    }
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'median_lock':
        return '🔒';
      case 'juiced':
        return '🍊';
      case 'hitrate':
        return '🎯';
      default:
        return '📊';
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: delay / 1000, duration: 0.4 }}
    >
      <Card className="border-yellow-500/30 bg-gradient-to-br from-yellow-500/5 to-orange-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ArrowRightLeft className="w-4 h-4 text-yellow-500" />
            <span className="text-gradient-gold">Smart Leg Swap</span>
            <Badge variant="outline" className="ml-auto text-xs border-yellow-500/30 text-yellow-500">
              1 Weak Leg
            </Badge>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Weakest Leg Display */}
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="w-3.5 h-3.5 text-destructive" />
                  <span className="text-xs font-medium text-destructive">WEAKEST LEG</span>
                </div>
                <p className="text-sm font-medium truncate">{weakestLegData.leg.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {weakestLegData.reason}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-muted-foreground">Impact</div>
                <div className="text-sm font-bold text-destructive">
                  -{weakestLegData.impactScore}%
                </div>
              </div>
            </div>
          </div>

          {/* Find Swaps Button */}
          {!isExpanded && (
            <Button
              variant="outline"
              className="w-full border-yellow-500/30 hover:bg-yellow-500/10"
              onClick={handleFindSwaps}
            >
              <Sparkles className="w-4 h-4 mr-2 text-yellow-500" />
              Find Better Alternatives
            </Button>
          )}

          {/* Expanded Alternatives */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {loading ? 'Finding alternatives...' : `${alternatives.length} alternatives found`}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setIsExpanded(false);
                      clearAlternatives();
                    }}
                  >
                    <ChevronUp className="w-4 h-4" />
                  </Button>
                </div>

                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-yellow-500" />
                  </div>
                ) : alternatives.length > 0 ? (
                  <ScrollArea className="max-h-[280px]">
                    <div className="space-y-2 pr-2">
                      {alternatives.map((alt, idx) => (
                        <motion.div
                          key={alt.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className={cn(
                            "p-3 rounded-lg border transition-all hover:scale-[1.01]",
                            getRecommendationStyle(alt.comparisonToOriginal.recommendation)
                          )}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="text-sm">{getSourceIcon(alt.source)}</span>
                                {alt.samePlayer && (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                    Same Player
                                  </Badge>
                                )}
                                {alt.sameGame && (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                    Same Game
                                  </Badge>
                                )}
                                {alt.comparisonToOriginal.recommendation === 'strong_upgrade' && (
                                  <Badge className="text-[10px] px-1.5 py-0 bg-green-500 text-green-50">
                                    ⭐ BEST
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm font-medium">{alt.description}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {alt.reason}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="flex items-center gap-1 text-green-500">
                                <TrendingUp className="w-3 h-3" />
                                <span className="text-sm font-bold">
                                  +{Math.round(alt.comparisonToOriginal.confidenceGain)}%
                                </span>
                              </div>
                              {alt.hitRate && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                  <Target className="w-3 h-3" />
                                  {Math.round(alt.hitRate)}% hit
                                </div>
                              )}
                            </div>
                          </div>

                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full text-xs border-green-500/30 hover:bg-green-500/10 hover:text-green-500"
                            onClick={() => handleSwap(alt)}
                          >
                            <ArrowRightLeft className="w-3 h-3 mr-1" />
                            Swap This Leg
                          </Button>
                        </motion.div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    No better alternatives found for this leg
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
};
