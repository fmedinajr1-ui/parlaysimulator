import { FeedCard } from "../FeedCard";
import { Brain, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ParlayLeg, LegAnalysis, ParlayAnalysis } from "@/types/parlay";
import { cn } from "@/lib/utils";

interface ConsolidatedVerdictCardProps {
  legs: ParlayLeg[];
  aiAnalysis: ParlayAnalysis | null;
  combinedProbability: number;
  delay?: number;
}

export function ConsolidatedVerdictCard({
  legs,
  aiAnalysis,
  combinedProbability,
  delay = 0
}: ConsolidatedVerdictCardProps) {
  const legAnalyses = aiAnalysis?.legAnalyses || [];
  
  // Calculate overall recommendation
  const pickLegs = legAnalyses.filter(la => la.sharpRecommendation === 'pick').length;
  const fadeLegs = legAnalyses.filter(la => la.sharpRecommendation === 'fade').length;
  const cautionLegs = legAnalyses.filter(la => la.sharpRecommendation === 'caution').length;
  
  // Calculate average edge (compare adjusted vs implied from legs)
  const avgEdge = legAnalyses.length > 0
    ? legAnalyses.reduce((sum, la, idx) => {
        const legImplied = legs[la.legIndex]?.impliedProbability || 0;
        return sum + ((la.adjustedProbability || legImplied) - legImplied);
      }, 0) / legAnalyses.length * 100
    : 0;
  
  // Calculate trap count
  const trapLegs = legAnalyses.filter(la => 
    la.sharpRecommendation === 'fade' && 
    la.sharpSignals?.some(s => ['BOTH_SIDES_MOVED', 'PRICE_ONLY_MOVE_TRAP', 'FAKE_SHARP_TAG'].includes(s))
  ).length;
  
  // Determine overall verdict
  const getOverallVerdict = () => {
    if (trapLegs >= 2) return { verdict: 'AVOID', color: 'text-neon-red', bg: 'bg-neon-red/10', icon: XCircle };
    if (fadeLegs > pickLegs) return { verdict: 'FADE', color: 'text-neon-red', bg: 'bg-neon-red/10', icon: TrendingDown };
    if (pickLegs >= legs.length * 0.7 && avgEdge > 2) return { verdict: 'STRONG PICK', color: 'text-neon-green', bg: 'bg-neon-green/10', icon: CheckCircle };
    if (pickLegs > fadeLegs && avgEdge > 0) return { verdict: 'LEAN PICK', color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', icon: TrendingUp };
    if (cautionLegs > pickLegs + fadeLegs) return { verdict: 'CAUTION', color: 'text-neon-yellow', bg: 'bg-neon-yellow/10', icon: AlertTriangle };
    return { verdict: 'NEUTRAL', color: 'text-muted-foreground', bg: 'bg-muted/20', icon: Brain };
  };
  
  const overall = getOverallVerdict();
  const VerdictIcon = overall.icon;

  return (
    <FeedCard 
      variant="full-bleed" 
      className="slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-neon-purple" />
          <h3 className="font-display text-lg text-foreground">AI VERDICT</h3>
        </div>
        <Badge className={cn("text-sm font-display", overall.color, overall.bg)}>
          <VerdictIcon className="w-4 h-4 mr-1" />
          {overall.verdict}
        </Badge>
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="text-center p-2 rounded-lg bg-neon-green/10 border border-neon-green/20">
          <p className="text-lg font-bold text-neon-green">{pickLegs}</p>
          <p className="text-xs text-muted-foreground">Picks</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-neon-red/10 border border-neon-red/20">
          <p className="text-lg font-bold text-neon-red">{fadeLegs}</p>
          <p className="text-xs text-muted-foreground">Fades</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-neon-yellow/10 border border-neon-yellow/20">
          <p className="text-lg font-bold text-neon-yellow">{cautionLegs}</p>
          <p className="text-xs text-muted-foreground">Caution</p>
        </div>
        <div className={cn(
          "text-center p-2 rounded-lg border",
          avgEdge >= 2 ? "bg-neon-green/10 border-neon-green/20" : 
          avgEdge >= 0 ? "bg-neon-cyan/10 border-neon-cyan/20" : 
          "bg-neon-red/10 border-neon-red/20"
        )}>
          <p className={cn(
            "text-lg font-bold",
            avgEdge >= 2 ? "text-neon-green" : avgEdge >= 0 ? "text-neon-cyan" : "text-neon-red"
          )}>
            {avgEdge >= 0 ? '+' : ''}{avgEdge.toFixed(1)}%
          </p>
          <p className="text-xs text-muted-foreground">Avg Edge</p>
        </div>
      </div>

      {/* Trap Warning */}
      {trapLegs > 0 && (
        <div className="p-3 rounded-lg bg-neon-red/10 border border-neon-red/30 mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-neon-red" />
            <span className="text-sm font-semibold text-neon-red">
              ⚠️ {trapLegs} Trap{trapLegs > 1 ? 's' : ''} Detected
            </span>
          </div>
          <p className="text-xs text-neon-red/80 mt-1">
            Sharp money analysis identified suspicious line movements. Consider fading these legs.
          </p>
        </div>
      )}

      {/* AI Assessment */}
      {aiAnalysis?.overallAssessment && (
        <div className="p-3 rounded-lg bg-neon-purple/10 border border-neon-purple/30">
          <p className="text-sm text-foreground italic">"{aiAnalysis.overallAssessment}"</p>
        </div>
      )}

      {/* Quick Action Hint */}
      <div className="mt-4 text-center">
        <p className="text-xs text-muted-foreground">
          {overall.verdict === 'STRONG PICK' && '✅ All signals align. Good risk/reward ratio.'}
          {overall.verdict === 'LEAN PICK' && '👍 Slight edge detected. Consider smaller stake.'}
          {overall.verdict === 'CAUTION' && '⚠️ Mixed signals. Review leg breakdown below.'}
          {overall.verdict === 'FADE' && '❌ Sharp money disagrees. Consider fading.'}
          {overall.verdict === 'AVOID' && '🚫 Multiple traps detected. High risk of loss.'}
          {overall.verdict === 'NEUTRAL' && '🤷 No clear edge. Bet at your own discretion.'}
        </p>
      </div>
    </FeedCard>
  );
}
