import { FeedCard } from "../FeedCard";
import { ParlayLeg, LegAnalysis, InjuryAlert } from "@/types/parlay";
import { ChevronDown, ChevronUp, AlertTriangle, TrendingUp, TrendingDown, Users } from "lucide-react";
import { useState } from "react";
import { InjuryAlertBadge } from "./InjuryAlertBadge";
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

// Sport-specific coach impact calculations
const calculateCoachImpact = (analysis: LegAnalysis | undefined): { edge: number; reason: string } | null => {
  if (!analysis) return null;
  
  // Check for fatigue data which often indicates coaching impact
  const fatigueData = analysis.fatigueData;
  if (fatigueData) {
    const impact = fatigueData.isBackToBack ? -1.5 : 0;
    if (impact !== 0) {
      return {
        edge: impact,
        reason: fatigueData.isBackToBack 
          ? "Back-to-back game reduces expected output" 
          : "Normal rest schedule"
      };
    }
  }
  
  // Check for unified prop data with sharp money signal
  const unifiedData = analysis.unifiedPropData;
  if (unifiedData && unifiedData.confidence > 0.7) {
    const impactMultiplier = unifiedData.recommendation === 'OVER' ? 0.8 : -0.8;
    return {
      edge: impactMultiplier,
      reason: `High confidence ${unifiedData.recommendation.toLowerCase()} based on usage patterns`
    };
  }
  
  return null;
};

export function LegBreakdown({ legs, legAnalyses, delay = 0 }: LegBreakdownProps) {
  const [expandedLeg, setExpandedLeg] = useState<string | null>(null);

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
          const coachImpact = calculateCoachImpact(analysis);
          
          return (
            <div 
              key={leg.id}
              className={`rounded-xl bg-muted/50 border overflow-hidden transition-all duration-200 ${
                hasInjuries ? 'border-neon-orange/50' : 'border-border/50'
              }`}
            >
              <button
                onClick={() => setExpandedLeg(expandedLeg === leg.id ? null : leg.id)}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-lg font-bold text-muted-foreground">#{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{leg.description}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${riskColors[leg.riskLevel]}`}>
                        {riskEmojis[leg.riskLevel]} {leg.riskLevel.toUpperCase()}
                      </span>
                      {hasInjuries && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-neon-orange/20 text-neon-orange border border-neon-orange/30 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          INJURY ALERT
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
                  
                  {/* NEW: Coach Impact Row */}
                  {coachImpact && (
                    <div className={cn(
                      "mt-3 p-3 rounded-lg border flex items-center gap-3",
                      coachImpact.edge > 0 
                        ? "bg-neon-green/10 border-neon-green/30" 
                        : "bg-neon-red/10 border-neon-red/30"
                    )}>
                      <Users className={cn(
                        "w-5 h-5",
                        coachImpact.edge > 0 ? "text-neon-green" : "text-neon-red"
                      )} />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground uppercase">Coach Impact</span>
                          <Badge variant="outline" className={cn(
                            "text-xs",
                            coachImpact.edge > 0 
                              ? "text-neon-green border-neon-green/30" 
                              : "text-neon-red border-neon-red/30"
                          )}>
                            {coachImpact.edge > 0 ? '+' : ''}{coachImpact.edge.toFixed(1)}% edge
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{coachImpact.reason}</p>
                      </div>
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
