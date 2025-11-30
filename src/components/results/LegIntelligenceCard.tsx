import { FeedCard } from "@/components/FeedCard";
import { ParlayLeg, LegAnalysis } from "@/types/parlay";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, Brain, Loader2, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { InjuryAlertBadge } from "./InjuryAlertBadge";

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

export function LegIntelligenceCard({ legs, legAnalyses, isLoading, delay = 0 }: LegIntelligenceCardProps) {
  return (
    <FeedCard 
      variant="full-bleed" 
      className="slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-5 h-5 text-neon-purple" />
        <h3 className="font-display text-lg text-foreground">LEG INTELLIGENCE</h3>
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
    </FeedCard>
  );
}
