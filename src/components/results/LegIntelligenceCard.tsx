import { useState } from "react";
import { FeedCard } from "@/components/FeedCard";
import { ParlayLeg, LegAnalysis } from "@/types/parlay";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, Brain, Loader2, UserX, Activity, Zap, Target, Flame, AlertOctagon, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { InjuryAlertBadge } from "./InjuryAlertBadge";
import { UsageProjectionCard } from "./UsageProjectionCard";
import { EngineConsensusCard } from "./EngineConsensusCard";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileDetailDrawer } from "@/components/ui/mobile-detail-drawer";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

interface LegIntelligenceCardProps {
  legs: ParlayLeg[];
  legAnalyses?: Array<LegAnalysis & { legIndex: number }>;
  isLoading?: boolean;
  delay?: number;
}

const getTrendIcon = (trend: string) => {
  switch (trend) {
    case 'favorable':
      return <TrendingUp className="w-4 h-4 text-neon-green" />;
    case 'unfavorable':
      return <TrendingDown className="w-4 h-4 text-neon-red" />;
    default:
      return <Minus className="w-4 h-4 text-muted-foreground" />;
  }
};

const getConfidenceBadge = (level: string) => {
  const styles = {
    high: 'bg-neon-green/20 text-neon-green border-neon-green/30',
    medium: 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30',
    low: 'bg-neon-red/20 text-neon-red border-neon-red/30',
  };
  return styles[level as keyof typeof styles] || styles.medium;
};

const getPVSTierStyle = (tier: string) => {
  const styles: Record<string, string> = {
    'S': 'bg-gradient-to-r from-neon-green/30 to-neon-green/10 text-neon-green border-neon-green/50',
    'A': 'bg-neon-green/20 text-neon-green border-neon-green/30',
    'B': 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30',
    'C': 'bg-neon-orange/20 text-neon-orange border-neon-orange/30',
    'D': 'bg-neon-red/20 text-neon-red border-neon-red/30',
    'F': 'bg-neon-red/30 text-neon-red border-neon-red/50',
  };
  return styles[tier?.toUpperCase()] || 'bg-muted text-muted-foreground';
};

const getRecommendationStyle = (rec: string) => {
  if (!rec) return 'text-muted-foreground';
  const recLower = rec.toLowerCase();
  if (recLower.includes('strong_over') || recLower.includes('strong_pick')) return 'text-neon-green font-bold';
  if (recLower.includes('lean_over') || recLower.includes('lean_pick')) return 'text-neon-green';
  if (recLower.includes('strong_under') || recLower.includes('strong_fade')) return 'text-neon-red font-bold';
  if (recLower.includes('lean_under') || recLower.includes('lean_fade')) return 'text-neon-red';
  return 'text-neon-yellow';
};

export function LegIntelligenceCard({ legs, legAnalyses, isLoading, delay = 0 }: LegIntelligenceCardProps) {
  const isMobile = useIsMobile();
  const { lightTap } = useHapticFeedback();
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [detailDrawer, setDetailDrawer] = useState<{ open: boolean; title: string; content: React.ReactNode } | null>(null);

  const toggleSection = (key: string) => {
    lightTap();
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const openDetailDrawer = (title: string, content: React.ReactNode) => {
    lightTap();
    setDetailDrawer({ open: true, title, content });
  };

  return (
    <FeedCard 
      variant="full-bleed" 
      className="slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 mb-3 sm:mb-4">
        <Brain className="w-4 h-4 sm:w-5 sm:h-5 text-neon-purple" />
        <h3 className="font-display text-base sm:text-lg text-foreground">LEG INTELLIGENCE</h3>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {legs.map((_, idx) => (
            <div key={idx} className="bg-card/50 rounded-lg p-3 animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {legs.map((leg, idx) => {
            const analysis = legAnalyses?.find(a => a.legIndex === idx);
            
            return (
              <div 
                key={leg.id} 
                className="bg-card/50 rounded-lg p-3 border border-border/50"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-muted-foreground">#{idx + 1}</span>
                      <span className="font-medium text-foreground text-sm truncate">{leg.description}</span>
                    </div>
                    {analysis && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {analysis.sport}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {analysis.betType.replace('_', ' ')}
                        </Badge>
                        {analysis.team && (
                          <Badge variant="secondary" className="text-xs">
                            {analysis.team}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                  {analysis && (
                    <div className="flex items-center gap-1">
                      {getTrendIcon(analysis.trendDirection)}
                      <Badge className={cn("text-xs", getConfidenceBadge(analysis.confidenceLevel))}>
                        {analysis.confidenceLevel}
                      </Badge>
                    </div>
                  )}
                </div>

                {analysis && (
                  <>
                    {/* Engine Consensus Card */}
                    {analysis.engineConsensus && analysis.engineConsensus.engineSignals && analysis.engineConsensus.engineSignals.length > 0 && (
                      <div className="mb-3">
                        <EngineConsensusCard 
                          consensus={analysis.engineConsensus}
                          legDescription={leg.description}
                        />
                      </div>
                    )}
                    
                    {/* Fallback for old consensus format */}
                    {analysis.engineConsensus && (!analysis.engineConsensus.engineSignals || analysis.engineConsensus.engineSignals.length === 0) && analysis.engineConsensus.totalEngines > 0 && (
                      <div className="mb-2 p-2 rounded-lg bg-gradient-to-r from-neon-purple/10 to-transparent border border-neon-purple/20">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-neon-purple">ENGINE CONSENSUS</span>
                          <Badge className={cn(
                            "text-xs",
                            (analysis.engineConsensus.consensusScore / analysis.engineConsensus.totalEngines) >= 0.7 ? "bg-neon-green/20 text-neon-green" :
                            (analysis.engineConsensus.consensusScore / analysis.engineConsensus.totalEngines) >= 0.4 ? "bg-neon-yellow/20 text-neon-yellow" :
                            "bg-neon-red/20 text-neon-red"
                          )}>
                            {analysis.engineConsensus.consensusScore}/{analysis.engineConsensus.totalEngines} agree
                          </Badge>
                        </div>
                      </div>
                    )}

                    {/* Unified Props Data - Mobile Optimized */}
                    {analysis.unifiedPropData && (
                      <div className="mb-2 p-2 rounded-lg bg-gradient-to-r from-neon-blue/10 to-transparent border border-neon-blue/20">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Target className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-neon-blue" />
                            <span className="text-[10px] sm:text-xs font-semibold text-neon-blue">UNIFIED PROPS</span>
                          </div>
                          <Badge className={cn("text-[10px] sm:text-xs", getPVSTierStyle(analysis.unifiedPropData.pvsTier))}>
                            Tier {analysis.unifiedPropData.pvsTier}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <button 
                            onClick={() => isMobile && openDetailDrawer('Player Value Score', 
                              <div className="space-y-2">
                                <div className="text-2xl font-bold">{analysis.unifiedPropData.pvsScore.toFixed(0)}</div>
                                <p className="text-sm text-muted-foreground">Player Value Score analyzes matchups, recent performance, and statistical projections.</p>
                              </div>
                            )}
                            className="text-center p-1.5 rounded-md bg-card/50 active:bg-card/80 transition-colors"
                          >
                            <div className="text-[10px] sm:text-xs text-muted-foreground">PVS</div>
                            <div className="font-mono font-bold text-sm sm:text-base">{analysis.unifiedPropData.pvsScore.toFixed(0)}</div>
                          </button>
                          <button 
                            onClick={() => isMobile && openDetailDrawer('Hit Rate Score',
                              <div className="space-y-2">
                                <div className="text-2xl font-bold">{analysis.unifiedPropData.hitRateScore.toFixed(0)}</div>
                                <p className="text-sm text-muted-foreground">Historical success rate of similar props based on player patterns and game context.</p>
                              </div>
                            )}
                            className="text-center p-1.5 rounded-md bg-card/50 active:bg-card/80 transition-colors"
                          >
                            <div className="text-[10px] sm:text-xs text-muted-foreground">Hit%</div>
                            <div className="font-mono font-bold text-sm sm:text-base">{analysis.unifiedPropData.hitRateScore.toFixed(0)}</div>
                          </button>
                          <button 
                            onClick={() => isMobile && openDetailDrawer('Sharp Money Score',
                              <div className="space-y-2">
                                <div className="text-2xl font-bold">{analysis.unifiedPropData.sharpMoneyScore.toFixed(0)}</div>
                                <p className="text-sm text-muted-foreground">Tracks where professional bettors are placing their money based on line movements.</p>
                              </div>
                            )}
                            className="text-center p-1.5 rounded-md bg-card/50 active:bg-card/80 transition-colors"
                          >
                            <div className="text-[10px] sm:text-xs text-muted-foreground">Sharp</div>
                            <div className="font-mono font-bold text-sm sm:text-base">{analysis.unifiedPropData.sharpMoneyScore.toFixed(0)}</div>
                          </button>
                          <button 
                            onClick={() => isMobile && openDetailDrawer('Trap Risk Score',
                              <div className="space-y-2">
                                <div className={cn("text-2xl font-bold", analysis.unifiedPropData.trapScore > 50 ? "text-neon-red" : "text-foreground")}>
                                  {analysis.unifiedPropData.trapScore.toFixed(0)}
                                </div>
                                <p className="text-sm text-muted-foreground">Trap Risk Score - lower is better. High scores indicate potential trap plays.</p>
                              </div>
                            )}
                            className="text-center p-1.5 rounded-md bg-card/50 active:bg-card/80 transition-colors"
                          >
                            <div className="text-[10px] sm:text-xs text-muted-foreground">Trap</div>
                            <div className={cn("font-mono font-bold text-sm sm:text-base", analysis.unifiedPropData.trapScore > 50 ? "text-neon-red" : "text-foreground")}>
                              {analysis.unifiedPropData.trapScore.toFixed(0)}
                            </div>
                          </button>
                        </div>
                        <div className="mt-2 text-xs">
                          <span className="text-muted-foreground">Rec: </span>
                          <span className={getRecommendationStyle(analysis.unifiedPropData.recommendation)}>
                            {analysis.unifiedPropData.recommendation.replace(/_/g, ' ').toUpperCase()}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Upset Data */}
                    {analysis.upsetData && (
                      <div className={cn(
                        "mb-2 p-2 rounded-lg border",
                        analysis.upsetData.isTrapFavorite 
                          ? "bg-gradient-to-r from-neon-red/20 to-transparent border-neon-red/40" 
                          : "bg-gradient-to-r from-neon-orange/10 to-transparent border-neon-orange/20"
                      )}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Zap className={cn("w-4 h-4", analysis.upsetData.isTrapFavorite ? "text-neon-red" : "text-neon-orange")} />
                            <span className={cn("text-xs font-semibold", analysis.upsetData.isTrapFavorite ? "text-neon-red" : "text-neon-orange")}>
                              {analysis.upsetData.isTrapFavorite ? "⚠️ TRAP FAVORITE" : "GOD MODE"}
                            </span>
                          </div>
                          <Badge className={cn(
                            "text-xs",
                            analysis.upsetData.confidence === 'high' ? "bg-neon-green/20 text-neon-green" :
                            analysis.upsetData.confidence === 'medium' ? "bg-neon-yellow/20 text-neon-yellow" :
                            "bg-neon-red/20 text-neon-red"
                          )}>
                            {analysis.upsetData.confidence}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between mt-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Upset Score: </span>
                            <span className="font-mono font-bold">{analysis.upsetData.upsetScore.toFixed(0)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Suggestion: </span>
                            <span className={cn(
                              "font-bold",
                              analysis.upsetData.suggestion === 'bet' ? "text-neon-green" : "text-neon-red"
                            )}>
                              {analysis.upsetData.suggestion.toUpperCase()}
                            </span>
                          </div>
                          {analysis.upsetData.chaosModeActive && (
                            <Badge variant="outline" className="text-xs bg-neon-purple/20 text-neon-purple">
                              CHAOS MODE
                            </Badge>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Juice Data */}
                    {analysis.juiceData && (
                      <div className="mb-2 p-2 rounded-lg bg-gradient-to-r from-neon-yellow/10 to-transparent border border-neon-yellow/20">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Flame className="w-4 h-4 text-neon-yellow" />
                            <span className="text-xs font-semibold text-neon-yellow">JUICED PROP</span>
                          </div>
                          <Badge className={cn(
                            "text-xs",
                            analysis.juiceData.juiceLevel === 'heavy' ? "bg-neon-green/20 text-neon-green" :
                            analysis.juiceData.juiceLevel === 'moderate' ? "bg-neon-yellow/20 text-neon-yellow" :
                            "bg-muted text-muted-foreground"
                          )}>
                            {analysis.juiceData.juiceLevel} juice
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between mt-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">Direction: </span>
                            <span className="font-bold">{analysis.juiceData.juiceDirection.toUpperCase()}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Amount: </span>
                            <span className="font-mono">{analysis.juiceData.juiceAmount.toFixed(0)}¢</span>
                          </div>
                          {analysis.juiceData.finalPick && (
                            <div>
                              <span className="text-muted-foreground">Pick: </span>
                              <span className="text-neon-green font-bold">{analysis.juiceData.finalPick.toUpperCase()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Fatigue Data */}
                    {analysis.fatigueData && (
                      <div className={cn(
                        "mb-2 p-2 rounded-lg border",
                        analysis.fatigueData.fatigueScore >= 40 
                          ? "bg-gradient-to-r from-neon-red/10 to-transparent border-neon-red/20" 
                          : "bg-gradient-to-r from-neon-cyan/10 to-transparent border-neon-cyan/20"
                      )}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Activity className={cn("w-4 h-4", analysis.fatigueData.fatigueScore >= 40 ? "text-neon-red" : "text-neon-cyan")} />
                            <span className={cn("text-xs font-semibold", analysis.fatigueData.fatigueScore >= 40 ? "text-neon-red" : "text-neon-cyan")}>
                              FATIGUE: {analysis.fatigueData.fatigueCategory}
                            </span>
                          </div>
                          <Badge className={cn(
                            "text-xs",
                            analysis.fatigueData.fatigueScore < 20 ? "bg-neon-green/20 text-neon-green" :
                            analysis.fatigueData.fatigueScore < 40 ? "bg-neon-yellow/20 text-neon-yellow" :
                            "bg-neon-red/20 text-neon-red"
                          )}>
                            Score: {analysis.fatigueData.fatigueScore}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 mt-2 text-xs">
                          {analysis.fatigueData.isBackToBack && (
                            <Badge variant="outline" className="text-xs bg-neon-red/10 text-neon-red border-neon-red/30">
                              B2B
                            </Badge>
                          )}
                          {analysis.fatigueData.travelMiles > 1000 && (
                            <span className="text-muted-foreground">
                              Travel: {Math.round(analysis.fatigueData.travelMiles)} mi
                            </span>
                          )}
                          {analysis.fatigueData.recommendedAngle && analysis.fatigueData.recommendedAngle !== 'none' && (
                            <span className="text-neon-cyan">
                              Angle: {analysis.fatigueData.recommendedAngle}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Avoid Patterns Warning */}
                    {analysis.avoidPatterns && analysis.avoidPatterns.length > 0 && (
                      <div className="mb-2 p-2 rounded-lg bg-gradient-to-r from-neon-red/20 to-transparent border border-neon-red/40">
                        <div className="flex items-center gap-2 mb-1">
                          <AlertOctagon className="w-4 h-4 text-neon-red" />
                          <span className="text-xs font-semibold text-neon-red">⚠️ AVOID PATTERN DETECTED</span>
                        </div>
                        <ul className="space-y-0.5">
                          {analysis.avoidPatterns.map((pattern, i) => (
                            <li key={i} className="text-xs text-neon-red/80 pl-4">
                              • {pattern}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Insights */}
                    {analysis.insights.length > 0 && (
                      <div className="mb-2">
                        <div className="flex items-center gap-1 mb-1">
                          <CheckCircle className="w-3 h-3 text-neon-green" />
                          <span className="text-xs font-semibold text-muted-foreground">INSIGHTS</span>
                        </div>
                        <ul className="space-y-0.5">
                          {analysis.insights.map((insight, i) => (
                            <li key={i} className="text-xs text-foreground/80 pl-4">
                              • {insight}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Risk Factors */}
                    {analysis.riskFactors.length > 0 && (
                      <div className="mb-2">
                        <div className="flex items-center gap-1 mb-1">
                          <AlertTriangle className="w-3 h-3 text-neon-red" />
                          <span className="text-xs font-semibold text-muted-foreground">RISK FACTORS</span>
                        </div>
                        <ul className="space-y-0.5">
                          {analysis.riskFactors.map((risk, i) => (
                            <li key={i} className="text-xs text-neon-red/80 pl-4">
                              • {risk}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Probability Comparison */}
                    <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-border/30">
                      <div>
                        <span className="text-muted-foreground">Book: </span>
                        <span className="font-mono">{(leg.impliedProbability * 100).toFixed(1)}%</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Adjusted: </span>
                        <span className={cn(
                          "font-mono font-bold",
                          analysis.adjustedProbability > leg.impliedProbability ? "text-neon-green" : "text-neon-red"
                        )}>
                          {(analysis.adjustedProbability * 100).toFixed(1)}%
                        </span>
                      </div>
                      {analysis.calibratedProbability && (
                        <div>
                          <span className="text-muted-foreground">Calibrated: </span>
                          <span className="font-mono font-bold text-neon-purple">
                            {(analysis.calibratedProbability * 100).toFixed(1)}%
                          </span>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Juice: </span>
                        <span className={cn(
                          "font-mono",
                          analysis.vegasJuice > 6 ? "text-neon-red" : "text-muted-foreground"
                        )}>
                          {analysis.vegasJuice.toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    {/* Injury Alerts */}
                    {analysis.injuryAlerts && analysis.injuryAlerts.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <div className="flex items-center gap-1 mb-2">
                          <UserX className="w-3 h-3 text-neon-orange" />
                          <span className="text-xs font-semibold text-muted-foreground">INJURY IMPACT</span>
                        </div>
                        <div className="space-y-2">
                          {analysis.injuryAlerts.map((injury, i) => (
                            <InjuryAlertBadge key={i} injury={injury} compact />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Usage Projection for Player Props */}
                    {analysis.usageProjection && (
                      <div className="mt-3">
                        <UsageProjectionCard 
                          projection={analysis.usageProjection} 
                          legDescription={leg.description}
                        />
                      </div>
                    )}
                  </>
                )}

                {!analysis && (
                  <p className="text-xs text-muted-foreground italic">
                    Analysis unavailable for this leg
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Mobile Detail Drawer */}
      {detailDrawer && (
        <MobileDetailDrawer
          open={detailDrawer.open}
          onOpenChange={(open) => !open && setDetailDrawer(null)}
          title={detailDrawer.title}
          icon={<Target className="h-5 w-5 text-neon-blue" />}
        >
          {detailDrawer.content}
        </MobileDetailDrawer>
      )}
    </FeedCard>
  );
}