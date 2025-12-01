import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FeedCard } from "../FeedCard";
import { LegAnalysis, ParlayLeg } from "@/types/parlay";
import { Zap, TrendingUp, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ParlayOptimizerProps {
  legs: ParlayLeg[];
  legAnalyses?: Array<LegAnalysis & { legIndex: number }>;
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

export function ParlayOptimizer({ legs, legAnalyses, delay = 0 }: ParlayOptimizerProps) {
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

    legAnalyses.forEach((analysis, idx) => {
      const leg = legs[idx];
      if (!leg) return;

      // Check for trap bets (highest priority)
      if (analysis.sharpRecommendation === 'fade' && 
          analysis.sharpSignals?.some(s => TRAP_SIGNALS.includes(s))) {
        suggestions.push({
          legIndex: idx,
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
          legIndex: idx,
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
          legIndex: idx,
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
          legIndex: idx,
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

  const handleOptimize = () => {
    if (suggestions.length > 0) {
      // Get high priority legs to remove
      const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high');
      const removedIndices = new Set(highPrioritySuggestions.map(s => s.legIndex));
      
      // Create optimized legs array (keeping only non-removed legs)
      const optimizedLegs = legs
        .map((leg, idx) => ({ leg, originalIndex: idx }))
        .filter(({ originalIndex }) => !removedIndices.has(originalIndex))
        .map(({ leg }) => ({
          id: leg.id,
          description: leg.description,
          odds: leg.odds.toString()
        }));
      
      // Navigate to upload page with optimized legs
      navigate('/upload', {
        state: {
          optimizedLegs,
          optimizationApplied: true,
          removedCount: removedIndices.size
        }
      });
    }
  };

  // Only show optimizer if there are suggestions to make
  const hasIssues = legAnalyses.some(la => 
    la.sharpRecommendation === 'fade' || 
    la.sharpRecommendation === 'caution' ||
    (la.sharpSignals?.some(s => TRAP_SIGNALS.includes(s)))
  );

  if (!hasIssues) return null;

  const optimizedScore = calculateOptimizedScore();
  const scoreImprovement = optimizedScore - currentHealthScore;

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

          {/* Score Improvement Preview */}
          {suggestions.filter(s => s.priority === 'high').length > 0 && (
            <div className="p-4 bg-neon-purple/10 rounded-lg border border-neon-purple/30 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground uppercase">Health Score Impact</span>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-neon-red">{currentHealthScore.toFixed(0)}%</span>
                  <TrendingUp className="w-4 h-4 text-neon-green" />
                  <span className="text-lg font-bold text-neon-green">{optimizedScore.toFixed(0)}%</span>
                </div>
              </div>
              <p className="text-xs text-neon-purple">
                +{scoreImprovement.toFixed(0)} point improvement by removing high-priority legs
              </p>
            </div>
          )}

          {/* Suggestions List */}
          <div className="space-y-3 mb-4">
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
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    suggestion.priority === 'high' 
                      ? 'bg-neon-red/20 text-neon-red' 
                      : 'bg-neon-yellow/20 text-neon-yellow'
                  }`}>
                    LEG #{suggestion.legIndex + 1}
                  </span>
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded uppercase ${
                    suggestion.priority === 'high' 
                      ? 'bg-neon-red/20 text-neon-red' 
                      : 'bg-neon-yellow/20 text-neon-yellow'
                  }`}>
                    {suggestion.priority}
                  </span>
                </div>
                
                <p className="text-sm font-medium text-foreground mb-1">
                  {suggestion.leg.description}
                </p>
                
                <p className="text-xs text-muted-foreground mb-2">
                  {suggestion.reason}
                </p>
                
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <TrendingUp className="w-3 h-3" />
                  {suggestion.impact}
                </div>
              </div>
            ))}
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
