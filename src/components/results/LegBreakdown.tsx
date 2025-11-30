import { FeedCard } from "../FeedCard";
import { ParlayLeg, LegAnalysis, InjuryAlert } from "@/types/parlay";
import { ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { InjuryAlertBadge } from "./InjuryAlertBadge";

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
