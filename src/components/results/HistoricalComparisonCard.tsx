import { FeedCard } from "../FeedCard";
import { useHistoricalComparison } from "@/hooks/useHistoricalComparison";
import { TrendingUp, TrendingDown, Users, Target, Trophy, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface HistoricalComparisonCardProps {
  legCount: number;
  degenerateLevel: string;
  probability: number;
  delay?: number;
}

export function HistoricalComparisonCard({
  legCount,
  degenerateLevel,
  probability,
  delay = 0
}: HistoricalComparisonCardProps) {
  const { comparison, isLoading, error } = useHistoricalComparison({
    legCount,
    degenerateLevel,
    probability
  });

  if (isLoading) {
    return (
      <FeedCard 
        variant="full-bleed" 
        className="slide-up"
        style={{ animationDelay: `${delay}ms` }}
      >
        <div className="flex items-center justify-center py-8 gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-neon-cyan" />
          <span className="text-sm text-muted-foreground">Analyzing similar parlays...</span>
        </div>
      </FeedCard>
    );
  }

  if (error || !comparison) {
    return null;
  }

  const { similarParlays, benchmarks, comparison: comp, topSimilarParlays } = comparison;
  const impliedProb = probability * 100;
  const isOutperforming = similarParlays.winRate > impliedProb;
  const riskColors: Record<string, string> = {
    LOW: 'text-neon-green bg-neon-green/10 border-neon-green/30',
    MODERATE: 'text-neon-yellow bg-neon-yellow/10 border-neon-yellow/30',
    HIGH: 'text-neon-orange bg-neon-orange/10 border-neon-orange/30',
    EXTREME: 'text-neon-red bg-neon-red/10 border-neon-red/30'
  };

  return (
    <FeedCard 
      variant="full-bleed" 
      className="slide-up overflow-hidden"
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">📈</span>
          <h3 className="font-display text-lg text-foreground">HOW YOU STACK UP</h3>
        </div>
        <Badge 
          variant="outline" 
          className={cn("text-xs", riskColors[comp.riskTier] || riskColors.MODERATE)}
        >
          {comp.riskTier} RISK
        </Badge>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-card/50 rounded-xl p-3 text-center border border-border/30">
          <Target className="w-5 h-5 mx-auto mb-1 text-neon-cyan" />
          <p className="text-xl font-bold text-foreground">{similarParlays.winRate}%</p>
          <p className="text-xs text-muted-foreground">Hit Rate</p>
        </div>
        <div className="bg-card/50 rounded-xl p-3 text-center border border-border/30">
          <Trophy className="w-5 h-5 mx-auto mb-1 text-neon-green" />
          <p className="text-xl font-bold text-foreground">${Math.round(similarParlays.avgPayout)}</p>
          <p className="text-xs text-muted-foreground">Avg Payout</p>
        </div>
        <div className="bg-card/50 rounded-xl p-3 text-center border border-border/30">
          <Users className="w-5 h-5 mx-auto mb-1 text-neon-purple" />
          <p className="text-xl font-bold text-foreground">{similarParlays.totalFound}</p>
          <p className="text-xs text-muted-foreground">Similar</p>
        </div>
      </div>

      {/* Probability Comparison */}
      <div className="bg-card/30 rounded-xl p-3 mb-4 border border-border/20">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">Your Implied Odds</span>
          <span className="text-sm font-medium text-foreground">{impliedProb.toFixed(1)}%</span>
        </div>
        <Progress value={impliedProb} className="h-2 mb-3" />
        
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">Historical Hit Rate</span>
          <span className={cn(
            "text-sm font-medium flex items-center gap-1",
            isOutperforming ? "text-neon-green" : "text-neon-red"
          )}>
            {isOutperforming ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {similarParlays.winRate}%
          </span>
        </div>
        <Progress 
          value={Math.min(similarParlays.winRate, 100)} 
          className={cn("h-2", isOutperforming ? "[&>div]:bg-neon-green" : "[&>div]:bg-neon-red")}
        />
        
        <div className="mt-3 text-center">
          <Badge 
            variant="outline" 
            className={cn(
              "text-sm",
              isOutperforming ? "text-neon-green bg-neon-green/10 border-neon-green/30" : "text-neon-orange bg-neon-orange/10 border-neon-orange/30"
            )}
          >
            {comp.probabilityVsActual} vs implied
          </Badge>
        </div>
      </div>

      {/* Insight */}
      <div className="bg-gradient-to-r from-neon-purple/10 to-neon-cyan/10 rounded-xl p-3 mb-4 border border-neon-purple/20">
        <p className="text-sm text-foreground">
          💡 {comp.recommendation}
        </p>
      </div>

      {/* Benchmarks */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {benchmarks.userAvg.totalParlays > 0 && (
          <div className="bg-card/30 rounded-lg p-2 border border-border/20">
            <p className="text-xs text-muted-foreground mb-1">Your Average</p>
            <p className="text-sm font-medium text-foreground">{benchmarks.userAvg.winRate}% win rate</p>
            <p className="text-xs text-muted-foreground">{benchmarks.userAvg.totalParlays} parlays</p>
          </div>
        )}
        <div className="bg-card/30 rounded-lg p-2 border border-border/20">
          <p className="text-xs text-muted-foreground mb-1">Community Avg</p>
          <p className="text-sm font-medium text-foreground">{benchmarks.communityAvg.winRate}% win rate</p>
          <p className="text-xs text-muted-foreground">{benchmarks.communityAvg.totalParlays} parlays</p>
        </div>
      </div>

      {/* Recent Similar */}
      {topSimilarParlays.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Recent Similar Parlays
          </p>
          <div className="space-y-1.5">
            {topSimilarParlays.slice(0, 3).map((parlay, idx) => (
              <div 
                key={parlay.id || idx}
                className="flex items-center justify-between text-xs bg-card/20 rounded-lg px-2 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <span className={parlay.won ? "text-neon-green" : "text-neon-red"}>
                    {parlay.won ? '✅' : '❌'}
                  </span>
                  <span className="text-muted-foreground">
                    {parlay.legCount}-leg • {(parlay.probability * 100).toFixed(0)}% prob
                  </span>
                </div>
                <span className={cn(
                  "font-medium",
                  parlay.won ? "text-neon-green" : "text-muted-foreground"
                )}>
                  {parlay.won ? `+$${Math.round(parlay.payout - parlay.stake)}` : `-$${parlay.stake}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Match Criteria */}
      <div className="mt-3 flex flex-wrap gap-1">
        {similarParlays.matchCriteria.map((criteria, idx) => (
          <Badge key={idx} variant="secondary" className="text-xs">
            {criteria}
          </Badge>
        ))}
      </div>
    </FeedCard>
  );
}
