import { FeedCard } from "../FeedCard";
import { 
  Brain, 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Minus,
  Zap
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  runEnsemble, 
  extractSignalsFromAnalysis,
  aggregateParlayEnsemble,
  type EnsembleResult,
  DEFAULT_ENGINE_WEIGHTS
} from "@/lib/ensemble-engine";
import { useMemo } from "react";
import { ParlayLeg, LegAnalysis, ParlayAnalysis } from "@/types/parlay";

interface EnsembleConsensusCardProps {
  legs: ParlayLeg[];
  legAnalyses?: ParlayAnalysis['legAnalyses'];
  delay?: number;
}

const consensusColors = {
  strong_pick: { bg: 'bg-neon-green/10', border: 'border-neon-green/30', text: 'text-neon-green' },
  lean_pick: { bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/30', text: 'text-neon-cyan' },
  neutral: { bg: 'bg-muted', border: 'border-border', text: 'text-muted-foreground' },
  lean_fade: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-500' },
  strong_fade: { bg: 'bg-neon-red/10', border: 'border-neon-red/30', text: 'text-neon-red' },
};

const consensusLabels = {
  strong_pick: '🟢 STRONG PICK',
  lean_pick: '🔵 LEAN PICK',
  neutral: '⚪ NEUTRAL',
  lean_fade: '🟡 LEAN FADE',
  strong_fade: '🔴 STRONG FADE',
};

const riskColors = {
  low: 'text-neon-green bg-neon-green/10',
  medium: 'text-amber-500 bg-amber-500/10',
  high: 'text-neon-red bg-neon-red/10',
  extreme: 'text-neon-red bg-neon-red/20 animate-pulse',
};

export function EnsembleConsensusCard({ 
  legs, 
  legAnalyses,
  delay = 0 
}: EnsembleConsensusCardProps) {
  // Process each leg through the ensemble engine
  const legResults = useMemo<EnsembleResult[]>(() => {
    return legs.map((leg, idx) => {
      const analysis = legAnalyses?.find(la => la.legIndex === idx);
      if (!analysis) {
        return runEnsemble([]);
      }
      
      // Extract signals from various data sources in the analysis
      const signals = extractSignalsFromAnalysis({
        recommendation: analysis.sharpRecommendation || undefined,
        confidenceLevel: analysis.confidenceLevel,
        adjustedProbability: analysis.adjustedProbability,
        signals: analysis.engineConsensus?.engineSignals?.map(s => ({
          type: s.engine,
          value: s.score || undefined,
          description: s.reason
        })),
        trapScore: analysis.unifiedPropData?.trapScore,
        sharpIndicator: analysis.sharpReason,
        fatigueScore: analysis.fatigueData?.fatigueScore,
      });
      return runEnsemble(signals);
    });
  }, [legs, legAnalyses]);

  // Aggregate results
  const parlayResult = useMemo(() => {
    return aggregateParlayEnsemble(legResults);
  }, [legResults]);

  const colors = consensusColors[parlayResult.overallConsensus];

  return (
    <FeedCard delay={delay}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <Brain className="w-4 h-4" />
          Ensemble Consensus
        </p>
        <Badge variant="outline" className={riskColors[parlayResult.parlayRisk]}>
          {parlayResult.parlayRisk.toUpperCase()} RISK
        </Badge>
      </div>

      {/* Overall Consensus Score */}
      <div className={`p-4 rounded-xl ${colors.bg} border ${colors.border} mb-4`}>
        <div className="flex items-center justify-between mb-2">
          <span className={`text-lg font-bold ${colors.text}`}>
            {consensusLabels[parlayResult.overallConsensus]}
          </span>
          <span className={`text-2xl font-bold ${colors.text}`}>
            {parlayResult.overallScore >= 0 ? '+' : ''}{parlayResult.overallScore.toFixed(0)}
          </span>
        </div>
        <Progress 
          value={((parlayResult.overallScore + 100) / 200) * 100} 
          className="h-2"
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>Strong Fade</span>
          <span>Neutral</span>
          <span>Strong Pick</span>
        </div>
      </div>

      {/* Recommendation */}
      <div className="p-3 rounded-lg bg-muted/50 mb-4">
        <p className="text-sm">{parlayResult.recommendation}</p>
      </div>

      {/* Leg-by-Leg Breakdown */}
      <div className="space-y-2 mb-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase">Leg Consensus</p>
        {legs.map((leg, idx) => {
          const result = legResults[idx];
          const isWeakest = idx === parlayResult.weakestLeg;
          const isStrongest = idx === parlayResult.strongestLeg;
          const legColors = consensusColors[result.consensus];
          
          return (
            <div 
              key={idx}
              className={`flex items-center justify-between p-3 rounded-lg ${legColors.bg} border ${legColors.border} ${
                isWeakest ? 'ring-2 ring-neon-red/50' : ''
              } ${isStrongest ? 'ring-2 ring-neon-green/50' : ''}`}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {result.consensus.includes('pick') ? (
                  <CheckCircle2 className={`w-4 h-4 shrink-0 ${legColors.text}`} />
                ) : result.consensus.includes('fade') ? (
                  <XCircle className={`w-4 h-4 shrink-0 ${legColors.text}`} />
                ) : (
                  <Minus className="w-4 h-4 shrink-0 text-muted-foreground" />
                )}
                <span className="text-sm truncate">{leg.description}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isWeakest && (
                  <Badge variant="outline" className="text-neon-red text-xs">
                    Weakest
                  </Badge>
                )}
                {isStrongest && (
                  <Badge variant="outline" className="text-neon-green text-xs">
                    Strongest
                  </Badge>
                )}
                <span className={`text-sm font-medium ${legColors.text}`}>
                  {result.consensusScore >= 0 ? '+' : ''}{result.consensusScore.toFixed(0)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Engine Signals Summary */}
      <div className="p-3 rounded-lg bg-muted/30">
        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Active Engines</p>
        <div className="flex flex-wrap gap-1">
          {DEFAULT_ENGINE_WEIGHTS.slice(0, 6).map((engine) => {
            // Check if any leg has a signal from this engine
            const hasSignal = legResults.some(r => 
              r.signals.some(s => s.engineName === engine.name)
            );
            
            return (
              <Badge 
                key={engine.name}
                variant="outline"
                className={hasSignal ? 'text-neon-cyan bg-neon-cyan/10' : 'text-muted-foreground'}
              >
                {hasSignal && <Zap className="w-3 h-3 mr-1" />}
                {engine.displayName}
              </Badge>
            );
          })}
        </div>
      </div>
    </FeedCard>
  );
}
