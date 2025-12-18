import { FeedCard } from "../FeedCard";
import { Check, X, AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ParlayLeg, LegAnalysis } from "@/types/parlay";
import { cn } from "@/lib/utils";

interface LegVerdictSummaryProps {
  legs: ParlayLeg[];
  legAnalyses?: Array<LegAnalysis & { legIndex: number }>;
  delay?: number;
}

export function LegVerdictSummary({ legs, legAnalyses, delay = 0 }: LegVerdictSummaryProps) {
  const getLegAnalysis = (legIndex: number) => {
    return legAnalyses?.find(la => la.legIndex === legIndex);
  };

  const getVerdictConfig = (analysis: LegAnalysis | undefined) => {
    if (!analysis) {
      return { icon: Minus, color: 'text-muted-foreground', bg: 'bg-muted/20', label: 'N/A' };
    }
    
    const isTrap = analysis.sharpRecommendation === 'fade' && 
      analysis.sharpSignals?.some(s => ['BOTH_SIDES_MOVED', 'PRICE_ONLY_MOVE_TRAP', 'FAKE_SHARP_TAG'].includes(s));
    
    if (isTrap) {
      return { icon: AlertTriangle, color: 'text-neon-red', bg: 'bg-neon-red/10', label: 'TRAP' };
    }
    
    switch (analysis.sharpRecommendation) {
      case 'pick':
        return { icon: Check, color: 'text-neon-green', bg: 'bg-neon-green/10', label: 'PICK' };
      case 'fade':
        return { icon: X, color: 'text-neon-red', bg: 'bg-neon-red/10', label: 'FADE' };
      case 'caution':
        return { icon: AlertTriangle, color: 'text-neon-yellow', bg: 'bg-neon-yellow/10', label: 'CAUTION' };
      default:
        return { icon: Minus, color: 'text-muted-foreground', bg: 'bg-muted/20', label: 'NEUTRAL' };
    }
  };

  const getEdgeDisplay = (analysis: LegAnalysis | undefined, leg: ParlayLeg) => {
    if (!analysis) return null;
    const edge = ((analysis.adjustedProbability || 0) - leg.impliedProbability) * 100;
    return {
      value: edge,
      display: `${edge >= 0 ? '+' : ''}${edge.toFixed(1)}%`,
      color: edge >= 2 ? 'text-neon-green' : edge >= 0 ? 'text-neon-cyan' : 'text-neon-red'
    };
  };

  return (
    <FeedCard 
      variant="full-bleed" 
      className="slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-5 h-5 text-neon-cyan" />
        <h3 className="font-display text-lg text-foreground">LEG SUMMARY</h3>
      </div>

      <div className="space-y-2">
        {legs.map((leg, idx) => {
          const analysis = getLegAnalysis(idx);
          const verdict = getVerdictConfig(analysis);
          const edge = getEdgeDisplay(analysis, leg);
          const VerdictIcon = verdict.icon;

          return (
            <div 
              key={leg.id}
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border transition-all",
                verdict.bg,
                "border-border/30"
              )}
            >
              {/* Verdict Icon */}
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                verdict.bg
              )}>
                <VerdictIcon className={cn("w-4 h-4", verdict.color)} />
              </div>

              {/* Leg Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {leg.description}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">
                    {leg.odds > 0 ? '+' : ''}{leg.odds}
                  </span>
                  {analysis?.usageProjection?.projectedMinutes?.avg && (
                    <span className="text-xs text-muted-foreground">
                      • {analysis.usageProjection.projectedMinutes.avg.toFixed(0)}min avg
                    </span>
                  )}
                  {analysis?.usageProjection?.hitRate && (
                    <span className="text-xs text-neon-cyan">
                      • {analysis.usageProjection.hitRate.percentage.toFixed(0)}% hit
                    </span>
                  )}
                </div>
              </div>

              {/* Edge & Verdict */}
              <div className="text-right shrink-0">
                <Badge variant="outline" className={cn("text-xs mb-1", verdict.color, verdict.bg)}>
                  {verdict.label}
                </Badge>
                {edge && (
                  <p className={cn("text-xs font-mono", edge.color)}>
                    {edge.display} edge
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center mt-4">
        Tap "Full Leg Breakdown" below for detailed analysis
      </p>
    </FeedCard>
  );
}
