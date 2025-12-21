import { FeedCard } from "../FeedCard";
import { ParlayLeg, LegAnalysis, InjuryAlert } from "@/types/parlay";
import { ChevronDown, ChevronUp, AlertTriangle, TrendingUp, TrendingDown, Users, Target, Zap, Crown } from "lucide-react";
import { useState, useEffect } from "react";
import { InjuryAlertBadge } from "./InjuryAlertBadge";
import { OpponentImpactCard } from "./OpponentImpactCard";
import { ResearchSummarySection } from "./ResearchSummarySection";
import { SportPropIcon } from "./SportPropIcon";
import { PlayerNewsContextCard } from "./PlayerNewsContextCard";
import { usePlayerContext } from "@/hooks/usePlayerContext";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface LegBreakdownProps {
  legs: ParlayLeg[];
  legAnalyses?: Array<LegAnalysis & { legIndex: number }>;
  delay?: number;
}

const riskColors = {
  low: "bg-neon-green/20 text-neon-green border-neon-green/30",
  medium: "bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30",
  high: "bg-neon-orange/20 text-neon-orange border-neon-orange/30",
  extreme: "bg-neon-red/20 text-neon-red border-neon-red/30",
};

const riskEmojis = {
  low: "✅",
  medium: "⚠️",
  high: "🔥",
  extreme: "💀",
};

const sharpColors = {
  pick: "bg-neon-green/20 text-neon-green border-neon-green/30",
  fade: "bg-neon-red/20 text-neon-red border-neon-red/30",
  caution: "bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30",
};

const sharpEmojis = {
  pick: "✅ PICK",
  fade: "❌ FADE",
  caution: "⚠️ CAUTION",
};

export function LegBreakdown({ legs, legAnalyses, delay = 0 }: LegBreakdownProps) {
  const [expandedLeg, setExpandedLeg] = useState<string | null>(null);
  const { contexts, isLoading: contextLoading, fetchContexts, getContextForLeg } = usePlayerContext();

  // Fetch player context when legs change
  useEffect(() => {
    if (legs.length > 0) {
      const legInputs = legs.map((leg, idx) => ({
        legId: leg.id,
        description: leg.description,
        propType: legAnalyses?.find(la => la.legIndex === idx)?.betType,
        sport: legAnalyses?.find(la => la.legIndex === idx)?.sport,
      }));
      fetchContexts(legInputs);
    }
  }, [legs, legAnalyses, fetchContexts]);

  const getLegAnalysis = (legIndex: number) => {
    return legAnalyses?.find(la => la.legIndex === legIndex);
  };

  return (
    <FeedCard delay={delay}>
      <p className="text-sm text-muted-foreground uppercase tracking-wider mb-4">
        🎟️ Leg Breakdown
      </p>
      
      <div className="space-y-3">
        {legs.map((leg, idx) => {
          const analysis = getLegAnalysis(idx);
          const hasInjuries = analysis?.injuryAlerts && analysis.injuryAlerts.length > 0;
          const medianLockData = analysis?.medianLockData;
          const coachData = analysis?.coachData;
          const hitRatePercent = analysis?.hitRatePercent;
          const researchSummary = analysis?.researchSummary;
          
          return (
            <div 
              key={leg.id}
              className={cn(
                "rounded-xl bg-muted/50 border overflow-hidden transition-all duration-200",
                hasInjuries ? 'border-neon-orange/50' : 
                medianLockData?.parlay_grade ? 'border-neon-green/50' : 
                'border-border/50'
              )}
            >
              <button
                onClick={() => setExpandedLeg(expandedLeg === leg.id ? null : leg.id)}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-lg font-bold text-muted-foreground">#{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <SportPropIcon 
                        sport={analysis?.sport} 
                        betType={analysis?.betType}
                      />
                      <p className="font-medium text-foreground truncate">{leg.description}</p>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${riskColors[leg.riskLevel]}`}>
                        {riskEmojis[leg.riskLevel]} {leg.riskLevel.toUpperCase()}
                      </span>
                      {hasInjuries && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-neon-orange/20 text-neon-orange border border-neon-orange/30 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          INJURY
                        </span>
                      )}
                      {medianLockData?.parlay_grade && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-neon-green/20 text-neon-green border border-neon-green/30 flex items-center gap-1">
                          <Crown className="w-3 h-3" />
                          PARLAY GRADE
                        </span>
                      )}
                      {researchSummary && (
                        <span className={cn(
                          "text-xs px-2 py-0.5 rounded-full border",
                          researchSummary.strengthScore >= 70 ? "bg-neon-green/20 text-neon-green border-neon-green/30" :
                          researchSummary.strengthScore >= 50 ? "bg-neon-cyan/20 text-neon-cyan border-neon-cyan/30" :
                          researchSummary.strengthScore >= 30 ? "bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30" :
                          "bg-neon-red/20 text-neon-red border-neon-red/30"
                        )}>
                          {researchSummary.strengthScore}/100
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`font-bold ${leg.odds > 0 ? 'text-neon-green' : 'text-foreground'}`}>
                    {leg.odds > 0 ? '+' : ''}{leg.odds}
                  </span>
                  {expandedLeg === leg.id ? (
                    <ChevronUp className="w-5 h-5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              </button>
              
              {expandedLeg === leg.id && (
                <div className="px-4 pb-4 pt-0 border-t border-border/50 fade-in">
                  {/* Player News Context - AI-generated insights */}
                  <div className="mt-3">
                    <PlayerNewsContextCard 
                      context={getContextForLeg(leg.id)}
                      isLoading={contextLoading}
                    />
                  </div>

                  {/* Research Summary Section - NEW PROMINENT PLACEMENT */}
                  {researchSummary && (
                    <div className="mt-3">
                      <ResearchSummarySection summary={researchSummary} />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div className="text-center p-3 rounded-lg bg-background/50">
                      <p className="text-2xl font-bold text-foreground">
                        {(leg.impliedProbability * 100).toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground uppercase">Implied Prob</p>
                    </div>
                    <div className="text-center p-3 rounded-lg bg-background/50">
                      <p className="text-2xl font-bold text-neon-red">
                        {((1 - leg.impliedProbability) * 100).toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground uppercase">Miss Rate</p>
                    </div>
                  </div>

                  {/* Hit Rate Badge - prominent display */}
                  {hitRatePercent && (
                    <div className={cn(
                      "mt-3 p-3 rounded-lg border flex items-center justify-between",
                      hitRatePercent >= 65 ? "bg-neon-green/10 border-neon-green/30" :
                      hitRatePercent >= 50 ? "bg-neon-yellow/10 border-neon-yellow/30" :
                      "bg-neon-red/10 border-neon-red/30"
                    )}>
                      <div className="flex items-center gap-2">
                        <Target className={cn(
                          "w-5 h-5",
                          hitRatePercent >= 65 ? "text-neon-green" :
                          hitRatePercent >= 50 ? "text-neon-yellow" : "text-neon-red"
                        )} />
                        <div>
                          <span className="text-xs text-muted-foreground uppercase">Historical Hit Rate</span>
                          <p className="text-xs text-muted-foreground">Based on similar prop matchups</p>
                        </div>
                      </div>
                      <span className={cn(
                        "text-xl font-bold",
                        hitRatePercent >= 65 ? "text-neon-green" :
                        hitRatePercent >= 50 ? "text-neon-yellow" : "text-neon-red"
                      )}>
                        {hitRatePercent.toFixed(0)}%
                      </span>
                    </div>
                  )}

                  {/* Opponent Impact Card - PROMINENT */}
                  {medianLockData && (medianLockData as any).vs_opponent_games >= 2 && (
                    <OpponentImpactCard
                      playerName={leg.description.split(' ')[0] || 'Player'}
                      opponent={(medianLockData as any).opponent || 'OPP'}
                      propType={(medianLockData as any).prop_type || 'player_points'}
                      overallHitRate={medianLockData.hit_rate || 0}
                      overallMedian={(medianLockData as any).median_points || 0}
                      vsOpponentHitRate={(medianLockData as any).vs_opponent_hit_rate || 0}
                      vsOpponentMedian={(medianLockData as any).vs_opponent_median || 0}
                      vsOpponentGames={(medianLockData as any).vs_opponent_games || 0}
                      blendedHitRate={(medianLockData as any).blended_hit_rate || 0}
                      blendedMedian={(medianLockData as any).blended_median || 0}
                      impact={(medianLockData as any).opponent_impact || 'NEUTRAL'}
                    />
                  )}
                  
                  {medianLockData && (
                    <div className={cn(
                      "mt-3 p-3 rounded-lg border",
                      medianLockData.parlay_grade ? "bg-neon-green/15 border-neon-green/50" :
                      medianLockData.classification === 'LOCK' ? "bg-neon-green/10 border-neon-green/30" :
                      "bg-neon-cyan/10 border-neon-cyan/30"
                    )}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Zap className={cn(
                            "w-5 h-5",
                            medianLockData.parlay_grade ? "text-neon-green" : "text-neon-cyan"
                          )} />
                          <span className="text-sm font-bold">
                            MedianLock™ PRO
                          </span>
                        </div>
                        <Badge variant="outline" className={cn(
                          medianLockData.parlay_grade ? "text-neon-green border-neon-green/50" :
                          medianLockData.classification === 'LOCK' ? "text-neon-green border-neon-green/30" :
                          "text-neon-cyan border-neon-cyan/30"
                        )}>
                          {medianLockData.parlay_grade ? '🏆 PARLAY GRADE' : medianLockData.classification}
                        </Badge>
                      </div>
                      
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="p-2 rounded bg-background/50">
                          <p className="text-sm font-bold text-neon-cyan">
                            {medianLockData.edge_percent?.toFixed(1) || '0'}%
                          </p>
                          <p className="text-[10px] text-muted-foreground">Edge</p>
                        </div>
                        <div className="p-2 rounded bg-background/50">
                          <p className="text-sm font-bold text-foreground">
                            {medianLockData.projected_minutes?.toFixed(0) || '-'}
                          </p>
                          <p className="text-[10px] text-muted-foreground">Proj Min</p>
                        </div>
                        <div className="p-2 rounded bg-background/50">
                          <p className="text-sm font-bold text-neon-purple">
                            {medianLockData.adjusted_edge?.toFixed(1) || '0'}%
                          </p>
                          <p className="text-[10px] text-muted-foreground">Adj Edge</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-muted-foreground">
                          Recommended: <span className="font-medium">{medianLockData.bet_side}</span>
                        </span>
                        <span className="text-xs">
                          {(medianLockData.hit_rate || 0).toFixed(0)}% historical hit rate
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Coach Scorecard */}
                  {coachData && (
                    <div className={cn(
                      "mt-3 p-3 rounded-lg border",
                      coachData.recommendation === 'PICK' 
                        ? "bg-neon-green/10 border-neon-green/30" 
                        : coachData.recommendation === 'FADE'
                          ? "bg-neon-red/10 border-neon-red/30"
                          : "bg-muted/50 border-border/50"
                    )}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Users className={cn(
                            "w-5 h-5",
                            coachData.recommendation === 'PICK' ? "text-neon-green" :
                            coachData.recommendation === 'FADE' ? "text-neon-red" : "text-muted-foreground"
                          )} />
                          <div>
                            <span className="text-sm font-medium">{coachData.coachName}</span>
                            <p className="text-[10px] text-muted-foreground">{coachData.teamName}</p>
                          </div>
                        </div>
                        <Badge variant="outline" className={cn(
                          "text-xs",
                          coachData.recommendation === 'PICK' ? "text-neon-green border-neon-green/30" :
                          coachData.recommendation === 'FADE' ? "text-neon-red border-neon-red/30" :
                          "text-muted-foreground border-border"
                        )}>
                          {coachData.sport}
                        </Badge>
                      </div>
                      
                      {/* Offensive/Defensive Bias */}
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div className="text-center p-2 rounded bg-background/50">
                          <span className={cn("text-sm font-bold", 
                            coachData.offensiveBias > 0 ? "text-neon-green" : 
                            coachData.offensiveBias < 0 ? "text-neon-red" : "text-muted-foreground"
                          )}>
                            {coachData.offensiveBias > 0 ? '+' : ''}{coachData.offensiveBias.toFixed(1)}%
                          </span>
                          <p className="text-[10px] text-muted-foreground">OFF Bias</p>
                        </div>
                        <div className="text-center p-2 rounded bg-background/50">
                          <span className={cn("text-sm font-bold",
                            coachData.defensiveBias > 0 ? "text-neon-green" : 
                            coachData.defensiveBias < 0 ? "text-neon-red" : "text-muted-foreground"
                          )}>
                            {coachData.defensiveBias > 0 ? '+' : ''}{coachData.defensiveBias.toFixed(1)}%
                          </span>
                          <p className="text-[10px] text-muted-foreground">DEF Bias</p>
                        </div>
                      </div>
                      
                      {/* Prop Relevance */}
                      <p className="text-xs text-muted-foreground mb-2">
                        {coachData.propRelevance}
                      </p>
                      
                      {/* Confidence & Adjustment */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Confidence</span>
                        <div className="flex items-center gap-2">
                          {coachData.propAdjustment !== 0 && (
                            <span className={cn(
                              "text-xs font-medium",
                              coachData.propAdjustment > 0 ? "text-neon-green" : "text-neon-red"
                            )}>
                              {coachData.propAdjustment > 0 ? '+' : ''}{coachData.propAdjustment.toFixed(1)} adjustment
                            </span>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {coachData.confidence.toFixed(0)}%
                          </Badge>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Calibrated probability if available */}
                  {analysis?.calibratedProbability && (
                    <div className="mt-3 p-3 rounded-lg bg-neon-purple/10 border border-neon-purple/30">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground uppercase">Calibrated Probability</span>
                        <span className="text-lg font-bold text-neon-purple">
                          {(analysis.calibratedProbability * 100).toFixed(1)}%
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Adjusted based on AI's historical accuracy
                      </p>
                    </div>
                  )}
                  
                  {/* Trap Alert - Show prominently if detected */}
                  {analysis?.sharpRecommendation === 'fade' && analysis?.sharpSignals?.some(s => 
                    ['BOTH_SIDES_MOVED', 'PRICE_ONLY_MOVE_TRAP', 'SINGLE_BOOK_DIVERGENCE', 'FAKE_SHARP_TAG'].includes(s)
                  ) && (
                    <div className="mt-3 p-3 rounded-lg bg-neon-red/20 border border-neon-red/50 animate-pulse">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-neon-red" />
                        <span className="font-bold text-neon-red">⚠️ TRAP ALERT</span>
                      </div>
                      <p className="text-xs text-neon-red/90 mt-1">
                        Sharp money analysis detected this may be a trap bet. Consider fading this leg.
                      </p>
                    </div>
                  )}
                  
                  {/* Sharp recommendation */}
                  {analysis?.sharpRecommendation && (
                    <div className={`mt-3 p-3 rounded-lg border ${sharpColors[analysis.sharpRecommendation]}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold">
                          {sharpEmojis[analysis.sharpRecommendation]}
                        </span>
                        {analysis.sharpConfidence && (
                          <span className="text-xs opacity-80">
                            {(analysis.sharpConfidence * 100).toFixed(0)}% confidence
                          </span>
                        )}
                      </div>
                      {analysis.sharpReason && (
                        <p className="text-xs mt-2 opacity-90">{analysis.sharpReason}</p>
                      )}
                      {analysis.sharpSignals && analysis.sharpSignals.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {analysis.sharpSignals.map((signal, idx) => (
                            <span key={idx} className="text-xs px-1.5 py-0.5 rounded bg-background/50 opacity-80">
                              {signal}
                            </span>
                          ))}
                        </div>
                      )}
                      {analysis.sharpFinalPick && (
                        <p className="text-sm font-medium mt-2">
                          🎯 {analysis.sharpFinalPick}
                        </p>
                      )}
                    </div>
                  )}
                  
                  {/* Usage Projection if available */}
                  {analysis?.usageProjection && (
                    <div className="mt-3 p-3 rounded-lg bg-neon-cyan/10 border border-neon-cyan/30">
                      <p className="text-xs text-muted-foreground uppercase mb-2">Usage Projection</p>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-sm font-bold text-neon-cyan">
                            {analysis.usageProjection.projectedMinutes.avg.toFixed(0)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">Avg Min</p>
                        </div>
                        <div>
                          <p className="text-sm font-bold text-foreground">
                            {analysis.usageProjection.hitRate.percentage.toFixed(0)}%
                          </p>
                          <p className="text-[10px] text-muted-foreground">Hit Rate</p>
                        </div>
                        <div>
                          <Badge variant="outline" className={cn(
                            "text-[10px]",
                            analysis.usageProjection.verdict === 'FAVORABLE' 
                              ? "text-neon-green border-neon-green/30"
                              : analysis.usageProjection.verdict === 'UNFAVORABLE'
                                ? "text-neon-red border-neon-red/30"
                                : "text-neon-yellow border-neon-yellow/30"
                          )}>
                            {analysis.usageProjection.verdict}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Injury alerts */}
                  {hasInjuries && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-muted-foreground uppercase flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3 text-neon-orange" />
                        Injury Impact
                      </p>
                      {analysis?.injuryAlerts?.map((injury, injIdx) => (
                        <InjuryAlertBadge key={injIdx} injury={injury} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </FeedCard>
  );
}
