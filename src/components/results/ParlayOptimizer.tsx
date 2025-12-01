import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FeedCard } from "../FeedCard";
import { LegAnalysis, ParlayLeg } from "@/types/parlay";
import { Zap, TrendingUp, X, RefreshCw, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";

interface ParlayOptimizerProps {
  legs: ParlayLeg[];
  legAnalyses?: Array<LegAnalysis & { legIndex: number }>;
  stake: number;
  combinedProbability: number;
  potentialPayout: number;
  delay?: number;
}

interface OptimizationSuggestion {
  legIndex: number;
  leg: ParlayLeg;
  reason: string;
  impact: string;
  priority: 'high' | 'medium' | 'low';
}

const TRAP_SIGNALS = [
  'BOTH_SIDES_MOVED',
  'PRICE_ONLY_MOVE_TRAP',
  'SINGLE_BOOK_DIVERGENCE',
  'EARLY_MORNING_OVER',
  'FAKE_SHARP_TAG'
];

export function ParlayOptimizer({ legs, legAnalyses, stake, combinedProbability, potentialPayout, delay = 0 }: ParlayOptimizerProps) {
  const navigate = useNavigate();
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);

  if (!legAnalyses || legAnalyses.length === 0) return null;

  const calculateHealthScore = (analysisList: Array<LegAnalysis & { legIndex: number }>) => {
    const pickLegs = analysisList.filter(la => la.sharpRecommendation === 'pick').length;
    const fadeLegs = analysisList.filter(la => la.sharpRecommendation === 'fade').length;
    const cautionLegs = analysisList.filter(la => la.sharpRecommendation === 'caution').length;
    const trapAlerts = analysisList.filter(la => 
      la.sharpRecommendation === 'fade' && 
      la.sharpSignals?.some(s => TRAP_SIGNALS.includes(s))
    ).length;

    const totalLegs = analysisList.length;
    const rawScore = (pickLegs * 20) - (fadeLegs * 15) - (trapAlerts * 10) - (cautionLegs * 5);
    const maxPossibleScore = totalLegs * 20;
    return Math.max(0, Math.min(100, ((rawScore + maxPossibleScore) / (maxPossibleScore * 2)) * 100));
  };

  const currentHealthScore = calculateHealthScore(legAnalyses);

  const analyzeOptimizations = () => {
    const suggestions: OptimizationSuggestion[] = [];

    legAnalyses.forEach((analysis) => {
      const leg = legs[analysis.legIndex];
      if (!leg) return;

      // Check for trap bets (highest priority)
      if (analysis.sharpRecommendation === 'fade' && 
          analysis.sharpSignals?.some(s => TRAP_SIGNALS.includes(s))) {
        suggestions.push({
          legIndex: analysis.legIndex,
          leg,
          reason: `🚨 TRAP BET: ${analysis.sharpReason || 'Fake sharp movement detected'}`,
          impact: 'Removing this leg will significantly improve your parlay health',
          priority: 'high'
        });
        return;
      }

      // Check for fade recommendations
      if (analysis.sharpRecommendation === 'fade') {
        suggestions.push({
          legIndex: analysis.legIndex,
          leg,
          reason: `❌ FADE: ${analysis.sharpReason || 'Sharp money against this bet'}`,
          impact: 'Removing this leg will improve your parlay health',
          priority: 'high'
        });
        return;
      }

      // Check for low confidence caution
      if (analysis.sharpRecommendation === 'caution' && 
          analysis.sharpConfidence && analysis.sharpConfidence < 0.4) {
        suggestions.push({
          legIndex: analysis.legIndex,
          leg,
          reason: `⚠️ LOW CONFIDENCE: Mixed or weak signals detected`,
          impact: 'Consider removing to reduce risk',
          priority: 'medium'
        });
        return;
      }

      // Check for extreme risk level
      if (leg.riskLevel === 'extreme') {
        suggestions.push({
          legIndex: analysis.legIndex,
          leg,
          reason: `💀 EXTREME RISK: This leg has very low probability`,
          impact: 'Removing this leg will significantly improve parlay probability',
          priority: 'medium'
        });
      }
    });

    // Sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    setSuggestions(suggestions);
    setShowOptimizer(true);
  };

  const calculateOptimizedScore = () => {
    if (suggestions.length === 0) return currentHealthScore;
    
    // Calculate score if all high priority suggestions are removed
    const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high');
    const removedIndices = highPrioritySuggestions.map(s => s.legIndex);
    const remainingAnalyses = legAnalyses.filter(la => !removedIndices.includes(la.legIndex));
    
    return calculateHealthScore(remainingAnalyses);
  };

  const calculateOptimizedStats = () => {
    if (suggestions.length === 0) return null;
    
    // Calculate maximum removable legs (must keep at least 2)
    const maxRemovable = Math.max(0, legs.length - 2);
    
    // Sort suggestions by priority
    const sortedSuggestions = [...suggestions].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    // Only remove as many as we can while maintaining a valid parlay
    const suggestionsToRemove = sortedSuggestions.slice(0, maxRemovable);
    const removedIndices = new Set(suggestionsToRemove.map(s => s.legIndex));
    
    // Calculate remaining legs' combined probability
    const remainingLegs = legs.filter((_, idx) => !removedIndices.has(idx));
    const optimizedProbability = remainingLegs.reduce((prob, leg) => prob * leg.impliedProbability, 1);
    
    // Calculate optimized payout
    const totalOdds = remainingLegs.reduce((total, leg) => {
      const decimal = leg.odds > 0 ? (leg.odds / 100) + 1 : (100 / Math.abs(leg.odds)) + 1;
      return total * decimal;
    }, 1);
    const optimizedPayout = stake * totalOdds;
    
    // Calculate expected value
    const originalEV = (combinedProbability * potentialPayout) - stake;
    const optimizedEV = (optimizedProbability * optimizedPayout) - stake;
    
    return {
      remainingLegs: remainingLegs.length,
      removedLegs: removedIndices.size,
      totalProblematicLegs: suggestions.length,
      isPartialOptimization: suggestionsToRemove.length < suggestions.length,
      optimizedProbability,
      optimizedPayout,
      originalEV,
      optimizedEV,
      probabilityImprovement: ((optimizedProbability - combinedProbability) / combinedProbability) * 100,
      payoutChange: optimizedPayout - potentialPayout,
      evImprovement: optimizedEV - originalEV
    };
  };

  const optimizedScore = calculateOptimizedScore();
  const scoreImprovement = optimizedScore - currentHealthScore;
  const optimizedStats = calculateOptimizedStats();

  const handleOptimize = () => {
    console.log('🔄 Rebuild Parlay clicked');
    console.log('📊 Total suggestions:', suggestions.length);
    
    if (suggestions.length === 0) {
      console.log('⚠️ No suggestions to apply');
      return;
    }

    // Calculate maximum removable legs (must keep at least 2)
    const maxRemovable = legs.length - 2;
    
    // Edge case: 2-leg parlay with issues
    if (maxRemovable <= 0) {
      console.log('❌ Cannot optimize 2-leg parlay');
      toast({
        title: "Cannot optimize",
        description: "Your parlay only has 2 legs. Consider replacing problematic legs instead of removing them.",
        variant: "destructive"
      });
      return;
    }

    // Sort suggestions by priority (high → medium → low)
    const sortedSuggestions = [...suggestions].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    // Only remove as many as we can while maintaining a valid parlay
    const suggestionsToRemove = sortedSuggestions.slice(0, maxRemovable);
    
    console.log('🎯 Total problematic legs:', suggestions.length);
    console.log('✂️ Legs we can remove:', suggestionsToRemove.length);
    console.log('⚠️ Legs that must stay:', suggestions.length - suggestionsToRemove.length);
    
    // Show partial optimization warning if not all can be removed
    if (suggestionsToRemove.length < suggestions.length) {
      toast({
        title: "Partial optimization applied",
        description: `Removed ${suggestionsToRemove.length} of ${suggestions.length} problematic legs. Consider replacing the remaining ones.`,
      });
    }
    
    const removedIndices = new Set(suggestionsToRemove.map(s => s.legIndex));
    console.log('📍 Indices to remove:', Array.from(removedIndices));
    
    // Create optimized legs array (keeping only non-removed legs)
    const optimizedLegs = legs
      .map((leg, idx) => ({ leg, originalIndex: idx }))
      .filter(({ originalIndex }) => !removedIndices.has(originalIndex))
      .map(({ leg }) => ({
        id: leg.id,
        description: leg.description,
        odds: leg.odds.toString()
      }));
    
    console.log('✅ Optimized legs count:', optimizedLegs.length);
    
    // Store original legs for undo functionality
    const originalLegs = legs.map(leg => ({
      id: leg.id,
      description: leg.description,
      odds: leg.odds.toString()
    }));
    
    // Close dialog before navigation
    setShowOptimizer(false);
    
    // Navigate to upload page with optimized legs and originals for undo
    navigate('/upload', {
      state: {
        optimizedLegs,
        originalLegs,
        optimizationApplied: true,
        removedCount: removedIndices.size
      }
    });
  };

  // Only show optimizer if there are suggestions to make
  const hasIssues = legAnalyses.some(la => 
    la.sharpRecommendation === 'fade' || 
    la.sharpRecommendation === 'caution' ||
    (la.sharpSignals?.some(s => TRAP_SIGNALS.includes(s)))
  );

  if (!hasIssues) return null;

  return (
    <>
      <FeedCard delay={delay}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-neon-purple" />
            <span className="text-sm font-bold uppercase tracking-wider">Parlay Optimizer</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          AI has detected potential issues with your parlay. Click below to see optimization suggestions.
        </p>

        <Button 
          onClick={analyzeOptimizations}
          className="w-full bg-gradient-to-r from-neon-purple to-neon-pink hover:opacity-90"
        >
          <Zap className="w-4 h-4 mr-2" />
          Optimize My Parlay
        </Button>
      </FeedCard>

      <Dialog open={showOptimizer} onOpenChange={setShowOptimizer}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-neon-purple" />
              Parlay Optimization Suggestions
            </DialogTitle>
            <DialogDescription>
              Remove problematic legs to improve your parlay's health score
            </DialogDescription>
          </DialogHeader>

          {/* Partial Optimization Warning */}
          {optimizedStats && optimizedStats.isPartialOptimization && (
            <div className="mb-4 p-3 bg-neon-yellow/10 border border-neon-yellow/30 rounded-lg">
              <div className="flex items-start gap-2">
                <span className="text-base">⚠️</span>
                <div>
                  <p className="text-sm font-semibold text-neon-yellow mb-1">
                    Partial Optimization
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Only removing the {optimizedStats.removedLegs} most problematic leg{optimizedStats.removedLegs !== 1 ? 's' : ''} to maintain a valid parlay. {optimizedStats.totalProblematicLegs - optimizedStats.removedLegs} problematic leg{(optimizedStats.totalProblematicLegs - optimizedStats.removedLegs) !== 1 ? 's' : ''} will remain—consider replacing them.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Before/After Comparison */}
          {optimizedStats && (
            <div className="mb-4 space-y-3">
              {/* Probability Comparison */}
              <div className="p-4 bg-muted/50 rounded-lg border border-border/50">
                <p className="text-xs text-muted-foreground uppercase mb-3">Win Probability</p>
                <div className="grid grid-cols-3 gap-2 items-center">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">Original</p>
                    <p className="text-2xl font-bold text-neon-red">
                      {(combinedProbability * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{legs.length} legs</p>
                  </div>
                  <div className="flex justify-center">
                    <ArrowRight className="w-6 h-6 text-neon-green" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">Optimized</p>
                    <p className="text-2xl font-bold text-neon-green">
                      {(optimizedStats.optimizedProbability * 100).toFixed(1)}%
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">{optimizedStats.remainingLegs} legs</p>
                  </div>
                </div>
                <div className="mt-3 p-2 bg-neon-green/10 rounded text-center">
                  <p className="text-sm font-bold text-neon-green">
                    +{optimizedStats.probabilityImprovement.toFixed(0)}% improvement
                  </p>
                </div>
              </div>

              {/* Payout Comparison */}
              <div className="p-4 bg-muted/50 rounded-lg border border-border/50">
                <p className="text-xs text-muted-foreground uppercase mb-3">Potential Payout</p>
                <div className="grid grid-cols-3 gap-2 items-center">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">Original</p>
                    <p className="text-xl font-bold text-foreground">
                      ${potentialPayout.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex justify-center">
                    <ArrowRight className="w-6 h-6 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">Optimized</p>
                    <p className="text-xl font-bold text-foreground">
                      ${optimizedStats.optimizedPayout.toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 p-2 bg-muted/30 rounded text-center">
                  <p className="text-sm font-medium text-muted-foreground">
                    {optimizedStats.payoutChange > 0 ? '+' : ''}${optimizedStats.payoutChange.toFixed(2)} change
                  </p>
                </div>
              </div>

              {/* Expected Value Comparison */}
              <div className="p-4 bg-gradient-to-r from-neon-purple/10 to-neon-pink/10 rounded-lg border border-neon-purple/30">
                <p className="text-xs text-muted-foreground uppercase mb-3">Expected Value (EV)</p>
                <div className="grid grid-cols-3 gap-2 items-center">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">Original</p>
                    <p className={`text-xl font-bold ${optimizedStats.originalEV >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                      {optimizedStats.originalEV >= 0 ? '+' : ''}${optimizedStats.originalEV.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex justify-center">
                    <ArrowRight className="w-6 h-6 text-neon-purple" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground mb-1">Optimized</p>
                    <p className={`text-xl font-bold ${optimizedStats.optimizedEV >= 0 ? 'text-neon-green' : 'text-neon-red'}`}>
                      {optimizedStats.optimizedEV >= 0 ? '+' : ''}${optimizedStats.optimizedEV.toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 p-2 bg-neon-purple/20 rounded text-center">
                  <p className="text-sm font-bold text-neon-purple">
                    {optimizedStats.evImprovement >= 0 ? '+' : ''}${optimizedStats.evImprovement.toFixed(2)} EV improvement
                  </p>
                </div>
              </div>

              {/* Summary */}
              <div className="p-3 bg-background/50 rounded-lg border border-border/50">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">📊 Summary:</span> By removing {optimizedStats.removedLegs} problematic leg{optimizedStats.removedLegs !== 1 ? 's' : ''}, your win probability increases by <span className="text-neon-green font-medium">{optimizedStats.probabilityImprovement.toFixed(0)}%</span> with an EV improvement of <span className="text-neon-purple font-medium">${optimizedStats.evImprovement.toFixed(2)}</span>.
                </p>
              </div>
            </div>
          )}

          {/* Suggestions List */}
          <div className="space-y-3 mb-4">
            {(() => {
              const maxRemovable = Math.max(0, legs.length - 2);
              const sortedSuggestions = [...suggestions].sort((a, b) => {
                const priorityOrder = { high: 0, medium: 1, low: 2 };
                return priorityOrder[a.priority] - priorityOrder[b.priority];
              });
              const willBeRemoved = new Set(sortedSuggestions.slice(0, maxRemovable).map(s => s.legIndex));
              
              return suggestions.map((suggestion) => {
                const isRemovable = willBeRemoved.has(suggestion.legIndex);
                
                return (
                  <div 
                    key={suggestion.legIndex}
                    className={`p-3 rounded-lg border ${
                      isRemovable
                        ? suggestion.priority === 'high' 
                          ? 'bg-neon-red/10 border-neon-red/30' 
                          : 'bg-neon-yellow/10 border-neon-yellow/30'
                        : 'bg-muted/30 border-border/50 opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-2 mb-2">
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                        isRemovable
                          ? suggestion.priority === 'high' 
                            ? 'bg-neon-red/20 text-neon-red' 
                            : 'bg-neon-yellow/20 text-neon-yellow'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        LEG #{suggestion.legIndex + 1}
                      </span>
                      <span className={`text-xs font-bold px-1.5 py-0.5 rounded uppercase ${
                        isRemovable
                          ? suggestion.priority === 'high' 
                            ? 'bg-neon-red/20 text-neon-red' 
                            : 'bg-neon-yellow/20 text-neon-yellow'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {suggestion.priority}
                      </span>
                      {!isRemovable && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">
                          KEPT
                        </span>
                      )}
                    </div>
                    
                    <p className="text-sm font-medium text-foreground mb-1">
                      {suggestion.leg.description}
                    </p>
                    
                    <p className="text-xs text-muted-foreground mb-2">
                      {suggestion.reason}
                    </p>
                    
                    {isRemovable ? (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <X className="w-3 h-3" />
                        Will be removed: {suggestion.impact}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <RefreshCw className="w-3 h-3" />
                        Consider replacing this leg manually
                      </div>
                    )}
                  </div>
                );
              });
            })()}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={() => setShowOptimizer(false)}
              className="flex-1"
            >
              <X className="w-4 h-4 mr-2" />
              Keep Current Parlay
            </Button>
            <Button 
              onClick={handleOptimize}
              className="flex-1 bg-gradient-to-r from-neon-purple to-neon-pink hover:opacity-90"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Rebuild Parlay
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center mt-2">
            💡 Will automatically rebuild your parlay with problematic legs removed
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
