import { FeedCard } from "@/components/FeedCard";
import { ParlayLeg, LegAnalysis } from "@/types/parlay";
import { DollarSign, TrendingUp, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface BookEdgeCardProps {
  legs: ParlayLeg[];
  legAnalyses?: Array<LegAnalysis & { legIndex: number }>;
  delay?: number;
}

export function BookEdgeCard({ legs, legAnalyses, delay = 0 }: BookEdgeCardProps) {
  if (!legAnalyses || legAnalyses.length === 0) {
    return null;
  }

  // Calculate overall metrics
  const totalJuice = legAnalyses.reduce((sum, a) => sum + (a.vegasJuice || 4.5), 0);
  const avgJuice = totalJuice / legAnalyses.length;
  const heavilyJuicedLegs = legAnalyses.filter(a => a.vegasJuice > 6);
  
  // Calculate adjusted vs book probability difference
  const bookProb = legs.reduce((acc, leg) => acc * leg.impliedProbability, 1);
  const adjustedProb = legAnalyses.reduce((acc, a) => acc * a.adjustedProbability, 1);
  const probDiff = adjustedProb - bookProb;

  const getJuiceColor = (juice: number) => {
    if (juice <= 4.5) return 'text-neon-green';
    if (juice <= 6) return 'text-neon-yellow';
    return 'text-neon-red';
  };

  const getJuiceLabel = (juice: number) => {
    if (juice <= 4.5) return 'Standard';
    if (juice <= 6) return 'Above Avg';
    if (juice <= 8) return 'Heavy';
    return 'Extreme';
  };

  return (
    <FeedCard 
      variant="full-bleed" 
      className="slide-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="w-5 h-5 text-neon-green" />
        <h3 className="font-display text-lg text-foreground">BOOK EDGE DETECTOR</h3>
      </div>

      {/* Overall Assessment */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-card/50 rounded-lg p-3 text-center border border-border/50">
          <p className="text-xs text-muted-foreground mb-1">AVG JUICE</p>
          <p className={cn("font-display text-xl", getJuiceColor(avgJuice))}>
            {avgJuice.toFixed(1)}%
          </p>
          <p className="text-xs text-muted-foreground">{getJuiceLabel(avgJuice)}</p>
        </div>
        
        <div className="bg-card/50 rounded-lg p-3 text-center border border-border/50">
          <p className="text-xs text-muted-foreground mb-1">PROB SHIFT</p>
          <p className={cn(
            "font-display text-xl",
            probDiff >= 0 ? "text-neon-green" : "text-neon-red"
          )}>
            {probDiff >= 0 ? '+' : ''}{(probDiff * 100).toFixed(2)}%
          </p>
          <p className="text-xs text-muted-foreground">
            {probDiff >= 0 ? 'In your favor' : 'Against you'}
          </p>
        </div>

        <div className="bg-card/50 rounded-lg p-3 text-center border border-border/50">
          <p className="text-xs text-muted-foreground mb-1">JUICED LEGS</p>
          <p className={cn(
            "font-display text-xl",
            heavilyJuicedLegs.length > 0 ? "text-neon-red" : "text-neon-green"
          )}>
            {heavilyJuicedLegs.length}/{legs.length}
          </p>
          <p className="text-xs text-muted-foreground">
            {heavilyJuicedLegs.length > 0 ? 'Watch out!' : 'Clean'}
          </p>
        </div>
      </div>

      {/* Heavily Juiced Legs Warning */}
      {heavilyJuicedLegs.length > 0 && (
        <div className="bg-neon-red/10 border border-neon-red/20 rounded-lg p-3 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-neon-red" />
            <span className="text-sm font-semibold text-neon-red">Heavy Juice Alert</span>
          </div>
          <div className="space-y-1">
            {heavilyJuicedLegs.map((analysis) => {
              const leg = legs[analysis.legIndex];
              return (
                <div key={analysis.legIndex} className="flex items-center justify-between text-xs">
                  <span className="text-foreground/80 truncate flex-1">
                    #{analysis.legIndex + 1} {leg?.description}
                  </span>
                  <span className="text-neon-red font-mono ml-2">
                    {analysis.vegasJuice.toFixed(1)}% vig
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-neon-red/80 mt-2">
            💡 Tip: These lines are taking extra from you. Shop around for better odds.
          </p>
        </div>
      )}

      {/* Juice Breakdown */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">Vig by Leg</p>
        {legAnalyses.map((analysis) => {
          const leg = legs[analysis.legIndex];
          return (
            <div 
              key={analysis.legIndex}
              className="flex items-center gap-2"
            >
              <span className="text-xs text-muted-foreground w-6">#{analysis.legIndex + 1}</span>
              <div className="flex-1 bg-card/50 rounded-full h-2 overflow-hidden">
                <div 
                  className={cn(
                    "h-full transition-all",
                    analysis.vegasJuice <= 4.5 ? "bg-neon-green" :
                    analysis.vegasJuice <= 6 ? "bg-neon-yellow" : "bg-neon-red"
                  )}
                  style={{ width: `${Math.min(analysis.vegasJuice * 10, 100)}%` }}
                />
              </div>
              <span className={cn(
                "text-xs font-mono w-12 text-right",
                getJuiceColor(analysis.vegasJuice)
              )}>
                {analysis.vegasJuice.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center mt-3">
        Standard juice is ~4.5%. Above 6% means the book is taking extra. 🎰
      </p>
    </FeedCard>
  );
}
