import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, TrendingUp, X, RefreshCw, ArrowRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface SuggestedLeg {
  description: string;
  odds: number;
  impliedProbability: number;
  sport: string;
  betType: string;
  eventTime: string;
  hybridScore?: number;
  hybridBreakdown?: { sharp: number; user: number; ai: number };
  recommendation?: string;
}

interface SuggestedParlayOptimizerProps {
  legs: SuggestedLeg[];
  totalOdds: number;
  combinedProbability: number;
  stake?: number;
  isOpen: boolean;
  onClose: () => void;
}

interface OptimizationSuggestion {
  legIndex: number;
  leg: SuggestedLeg;
  reasons: string[];
  priority: 'high' | 'medium';
}

export function SuggestedParlayOptimizer({ 
  legs, 
  totalOdds, 
  combinedProbability, 
  stake = 10,
  isOpen,
  onClose 
}: SuggestedParlayOptimizerProps) {
  const navigate = useNavigate();
  const [suggestions] = useState<OptimizationSuggestion[]>(() => {
    const sug: OptimizationSuggestion[] = [];

    legs.forEach((leg, idx) => {
      const reasons: string[] = [];
      let priority: 'high' | 'medium' = 'medium';

      // Check hybrid score (if available)
      if (leg.hybridScore !== undefined) {
        if (leg.hybridScore < 40) {
          reasons.push(`🔴 Very low hybrid score (${leg.hybridScore}/100)`);
          priority = 'high';
        } else if (leg.hybridScore < 50) {
          reasons.push(`🟡 Low hybrid score (${leg.hybridScore}/100)`);
        }
      }

      // Check recommendation
      if (leg.recommendation === 'STRONG_FADE' || leg.recommendation === 'FADE') {
        reasons.push(`❌ ${leg.recommendation.replace('_', ' ')} recommendation`);
        priority = 'high';
      } else if (leg.recommendation === 'NEUTRAL' && leg.hybridScore && leg.hybridScore < 45) {
        reasons.push(`⚠️ NEUTRAL with weak signals`);
      }

      // Check breakdown scores
      if (leg.hybridBreakdown) {
        if (leg.hybridBreakdown.sharp < 10) {
          reasons.push(`📉 Weak sharp score (${leg.hybridBreakdown.sharp}/40)`);
        }
        if (leg.hybridBreakdown.user < 8) {
          reasons.push(`📊 Poor user pattern match (${leg.hybridBreakdown.user}/35)`);
        }
        if (leg.hybridBreakdown.ai < 5) {
          reasons.push(`🤖 Low AI confidence (${leg.hybridBreakdown.ai}/25)`);
        }
      }

      // Check implied probability
      if (leg.impliedProbability < 0.35) {
        reasons.push(`💀 Very low win probability (${(leg.impliedProbability * 100).toFixed(1)}%)`);
        priority = 'high';
      } else if (leg.impliedProbability < 0.45) {
        reasons.push(`⚠️ Low win probability (${(leg.impliedProbability * 100).toFixed(1)}%)`);
      }

      if (reasons.length > 0) {
        sug.push({ legIndex: idx, leg, reasons, priority });
      }
    });

    // Sort by priority
    return sug.sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (a.priority !== 'high' && b.priority === 'high') return 1;
      return 0;
    });
  });

  const calculateOptimizedStats = () => {
    if (suggestions.length === 0) return null;
    
    const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high');
    const removedIndices = new Set(highPrioritySuggestions.map(s => s.legIndex));
    
    const remainingLegs = legs.filter((_, idx) => !removedIndices.has(idx));
    const optimizedProbability = remainingLegs.reduce((prob, leg) => prob * leg.impliedProbability, 1);
    
    // Calculate optimized payout
    const totalOddsDecimal = totalOdds > 0 ? (totalOdds / 100) + 1 : (100 / Math.abs(totalOdds)) + 1;
    const currentPayout = stake * totalOddsDecimal;
    
    const remainingOddsDecimal = remainingLegs.reduce((total, leg) => {
      const decimal = leg.odds > 0 ? (leg.odds / 100) + 1 : (100 / Math.abs(leg.odds)) + 1;
      return total * decimal;
    }, 1);
    const optimizedPayout = stake * remainingOddsDecimal;
    
    const originalEV = (combinedProbability * currentPayout) - stake;
    const optimizedEV = (optimizedProbability * optimizedPayout) - stake;
    
    return {
      remainingLegs: remainingLegs.length,
      removedLegs: removedIndices.size,
      optimizedProbability,
      optimizedPayout,
      originalEV,
      optimizedEV,
      probabilityImprovement: ((optimizedProbability - combinedProbability) / combinedProbability) * 100,
      payoutChange: optimizedPayout - currentPayout,
      evImprovement: optimizedEV - originalEV
    };
  };

  const handleOptimize = () => {
    const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high');
    const removedIndices = new Set(highPrioritySuggestions.map(s => s.legIndex));
    
    const optimizedLegs = legs
      .map((leg, idx) => ({ leg, originalIndex: idx }))
      .filter(({ originalIndex }) => !removedIndices.has(originalIndex))
      .map(({ leg }) => ({
        id: crypto.randomUUID(),
        description: leg.description,
        odds: leg.odds.toString()
      }));
    
    navigate('/upload', {
      state: {
        optimizedLegs,
        optimizationApplied: true,
        removedCount: removedIndices.size
      }
    });
  };

  const optimizedStats = calculateOptimizedStats();

  if (suggestions.length === 0) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-neon-purple" />
            Optimize Suggested Parlay
          </DialogTitle>
          <DialogDescription>
            Remove weak legs to improve your parlay's win probability
          </DialogDescription>
        </DialogHeader>

        {/* Before/After Comparison */}
        {optimizedStats && (
          <div className="mb-4 space-y-3">
            {/* Probability Comparison */}
            <div className="p-4 bg-muted/50 rounded-lg border border-border/50">
              <p className="text-xs text-muted-foreground uppercase mb-3">Win Probability</p>
              <div className="grid grid-cols-3 gap-2 items-center">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Current</p>
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

            {/* Expected Value Comparison */}
            <div className="p-4 bg-gradient-to-r from-neon-purple/10 to-neon-pink/10 rounded-lg border border-neon-purple/30">
              <p className="text-xs text-muted-foreground uppercase mb-3">Expected Value (EV)</p>
              <div className="grid grid-cols-3 gap-2 items-center">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">Current</p>
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
                <span className="font-medium">📊 Summary:</span> Removing {optimizedStats.removedLegs} weak leg{optimizedStats.removedLegs !== 1 ? 's' : ''} increases win probability by <span className="text-neon-green font-medium">{optimizedStats.probabilityImprovement.toFixed(0)}%</span> with an EV improvement of <span className="text-neon-purple font-medium">${optimizedStats.evImprovement.toFixed(2)}</span>.
              </p>
            </div>
          </div>
        )}

        {/* Suggestions List */}
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-neon-orange" />
            <span className="text-sm font-medium">Legs to Remove</span>
          </div>
          
          {suggestions.map((suggestion) => (
            <div 
              key={suggestion.legIndex}
              className={`p-3 rounded-lg border ${
                suggestion.priority === 'high' 
                  ? 'bg-neon-red/10 border-neon-red/30' 
                  : 'bg-neon-yellow/10 border-neon-yellow/30'
              }`}
            >
              <div className="flex items-start gap-2 mb-2">
                <Badge variant="outline" className={`${
                  suggestion.priority === 'high' 
                    ? 'border-neon-red/50 text-neon-red' 
                    : 'border-neon-yellow/50 text-neon-yellow'
                }`}>
                  LEG #{suggestion.legIndex + 1}
                </Badge>
                <Badge variant="outline" className={`uppercase ${
                  suggestion.priority === 'high' 
                    ? 'border-neon-red/50 text-neon-red' 
                    : 'border-neon-yellow/50 text-neon-yellow'
                }`}>
                  {suggestion.priority} PRIORITY
                </Badge>
              </div>
              
              <p className="text-sm font-medium text-foreground mb-2">
                {suggestion.leg.description}
              </p>
              
              <div className="space-y-1">
                {suggestion.reasons.map((reason, idx) => (
                  <p key={idx} className="text-xs text-muted-foreground flex items-start gap-1">
                    <span className="mt-0.5">•</span>
                    <span>{reason}</span>
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={onClose}
            className="flex-1"
          >
            <X className="w-4 h-4 mr-2" />
            Keep Original
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
          💡 Weak legs will be removed and you'll be taken to the upload page to analyze
        </p>
      </DialogContent>
    </Dialog>
  );
}
