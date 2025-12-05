import { ParlaySimulation, DEGEN_TIERS } from '@/types/parlay';
import { ComparisonResult, getMetricRank } from '@/lib/comparison-utils';
import { FeedCard } from '@/components/FeedCard';
import { Badge } from '@/components/ui/badge';
import { Crown, TrendingUp, TrendingDown, DollarSign, Percent, Trophy, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MonteCarloVisualization } from './MonteCarloVisualization';
import { FatigueImpactCard } from './FatigueImpactCard';

interface ComparisonDashboardProps {
  comparisonResult: ComparisonResult;
}

export function ComparisonDashboard({ comparisonResult }: ComparisonDashboardProps) {
  const { simulations, rankings, bestByMetric, recommendation } = comparisonResult;

  if (simulations.length === 0) {
    return null;
  }

  const overallBestIdx = rankings.overall[0];

  return (
    <div className="space-y-4">
      {/* Recommendation Banner */}
      <FeedCard className="p-4 border-primary/30 bg-primary/5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Trophy className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-display text-sm text-primary mb-1">AI RECOMMENDATION</h3>
            <p className="text-sm text-foreground">{recommendation}</p>
          </div>
        </div>
      </FeedCard>

      {/* Comparison Cards */}
      <div className="grid grid-cols-1 gap-3">
        {simulations.map((sim, idx) => {
          const isOverallBest = idx === overallBestIdx;
          const isBestProb = idx === bestByMetric.probability;
          const isBestEV = idx === bestByMetric.ev;
          const isBestPayout = idx === bestByMetric.payout;
          const tier = DEGEN_TIERS[sim.degenerateLevel];
          const overallRank = getMetricRank(comparisonResult, idx, 'overall');

          return (
            <FeedCard
              key={idx}
              className={cn(
                "p-4 transition-all",
                isOverallBest && "ring-2 ring-primary border-primary/50"
              )}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={isOverallBest ? "default" : "secondary"}
                    className={cn(isOverallBest && "bg-primary")}
                  >
                    {isOverallBest && <Crown className="w-3 h-3 mr-1" />}
                    Parlay {idx + 1}
                  </Badge>
                  {isOverallBest && (
                    <span className="text-xs text-primary font-medium">BEST PICK</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">Rank:</span>
                  <span className={cn(
                    "font-bold",
                    overallRank === 1 ? "text-primary" : "text-muted-foreground"
                  )}>
                    #{overallRank}
                  </span>
                </div>
              </div>

              {/* Degen Level */}
              <div className={cn(
                "rounded-lg p-2 mb-3 text-center",
                `bg-${tier.color}/10 border border-${tier.color}/30`
              )} style={{ 
                backgroundColor: `hsl(var(--${tier.color}) / 0.1)`,
                borderColor: `hsl(var(--${tier.color}) / 0.3)`
              }}>
                <span className="text-lg mr-2">{tier.emoji}</span>
                <span className="font-display text-sm">{tier.label}</span>
              </div>

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-3">
                {/* Win Probability */}
                <div className={cn(
                  "rounded-lg p-3",
                  isBestProb ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/30"
                )}>
                  <div className="flex items-center gap-1 mb-1">
                    <Target className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Win Prob</span>
                    {isBestProb && <Crown className="w-3 h-3 text-primary ml-auto" />}
                  </div>
                  <p className={cn(
                    "text-xl font-bold",
                    isBestProb ? "text-primary" : "text-foreground"
                  )}>
                    {(sim.combinedProbability * 100).toFixed(1)}%
                  </p>
                </div>

                {/* Expected Value */}
                <div className={cn(
                  "rounded-lg p-3",
                  isBestEV ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/30"
                )}>
                  <div className="flex items-center gap-1 mb-1">
                    {sim.expectedValue >= 0 ? (
                      <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <TrendingDown className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                    <span className="text-xs text-muted-foreground">Exp. Value</span>
                    {isBestEV && <Crown className="w-3 h-3 text-primary ml-auto" />}
                  </div>
                  <p className={cn(
                    "text-xl font-bold",
                    isBestEV ? "text-primary" : sim.expectedValue >= 0 ? "text-neon-green" : "text-neon-red"
                  )}>
                    {sim.expectedValue >= 0 ? '+' : ''}${sim.expectedValue.toFixed(2)}
                  </p>
                </div>

                {/* Potential Payout */}
                <div className={cn(
                  "rounded-lg p-3",
                  isBestPayout ? "bg-primary/10 ring-1 ring-primary/30" : "bg-muted/30"
                )}>
                  <div className="flex items-center gap-1 mb-1">
                    <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Payout</span>
                    {isBestPayout && <Crown className="w-3 h-3 text-primary ml-auto" />}
                  </div>
                  <p className={cn(
                    "text-xl font-bold",
                    isBestPayout ? "text-primary" : "text-foreground"
                  )}>
                    ${sim.potentialPayout.toFixed(2)}
                  </p>
                </div>

                {/* Legs & Odds */}
                <div className="rounded-lg p-3 bg-muted/30">
                  <div className="flex items-center gap-1 mb-1">
                    <Percent className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Odds</span>
                  </div>
                  <p className="text-xl font-bold text-foreground">
                    {sim.totalOdds > 0 ? '+' : ''}{sim.totalOdds}
                  </p>
                  <p className="text-xs text-muted-foreground">{sim.legs.length} legs</p>
                </div>
              </div>

              {/* Leg Summary */}
              <div className="mt-3 pt-3 border-t border-border">
                <p className="text-xs text-muted-foreground mb-2">Legs:</p>
                <div className="space-y-1">
                  {sim.legs.slice(0, 3).map((leg, legIdx) => (
                    <p key={legIdx} className="text-xs text-foreground truncate">
                      • {leg.description}
                    </p>
                  ))}
                  {sim.legs.length > 3 && (
                    <p className="text-xs text-muted-foreground">
                      +{sim.legs.length - 3} more legs
                    </p>
                  )}
                </div>
              </div>
            </FeedCard>
          );
        })}
      </div>

      {/* Fatigue Impact Analysis */}
      <FatigueImpactCard simulations={simulations} />

      {/* Monte Carlo Simulation */}
      <MonteCarloVisualization simulations={simulations} />
    </div>
  );
}
