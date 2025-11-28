import { FeedCard } from '@/components/FeedCard';
import { TrendingUp, TrendingDown, Brain, Target, History } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface LegContext {
  legIndex: number;
  userRecord: {
    totalBets: number;
    wins: number;
    hitRate: number;
  } | null;
  aiAccuracy: {
    totalPredictions: number;
    correctPredictions: number;
    accuracyRate: number;
  } | null;
}

interface HistoricalInsightsCardProps {
  legContexts: LegContext[];
  userOverall: {
    totalBets: number;
    totalWins: number;
    hitRate: string | number;
  };
  aiOverall: {
    totalPredictions: number;
    correctPredictions: number;
    accuracy: string | number;
  };
  isLoading?: boolean;
  delay?: number;
}

export function HistoricalInsightsCard({
  legContexts,
  userOverall,
  aiOverall,
  isLoading = false,
  delay = 0
}: HistoricalInsightsCardProps) {
  if (isLoading) {
    return (
      <FeedCard delay={delay}>
        <div className="flex items-center gap-2 mb-4">
          <History className="w-5 h-5 text-primary" />
          <h3 className="font-display text-foreground">HISTORICAL CONTEXT</h3>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      </FeedCard>
    );
  }

  const hasUserData = userOverall.totalBets > 0;
  const hasAIData = aiOverall.totalPredictions > 0;

  if (!hasUserData && !hasAIData) {
    return (
      <FeedCard delay={delay}>
        <div className="flex items-center gap-2 mb-4">
          <History className="w-5 h-5 text-primary" />
          <h3 className="font-display text-foreground">HISTORICAL CONTEXT</h3>
        </div>
        <p className="text-sm text-muted-foreground text-center py-4">
          No historical data yet. Save and settle parlays to build your track record!
        </p>
      </FeedCard>
    );
  }

  return (
    <FeedCard delay={delay}>
      <div className="flex items-center gap-2 mb-4">
        <History className="w-5 h-5 text-primary" />
        <h3 className="font-display text-foreground">HISTORICAL CONTEXT</h3>
      </div>

      {/* Overall Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* User Stats */}
        {hasUserData && (
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-1 mb-2">
              <Target className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">YOUR RECORD</span>
            </div>
            <div className="text-2xl font-display text-foreground">
              {userOverall.totalWins}-{userOverall.totalBets - userOverall.totalWins}
            </div>
            <div className={`text-sm font-semibold ${Number(userOverall.hitRate) >= 50 ? 'text-neon-green' : 'text-neon-red'}`}>
              {userOverall.hitRate}% hit rate
            </div>
          </div>
        )}

        {/* AI Accuracy */}
        {hasAIData && (
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-1 mb-2">
              <Brain className="w-4 h-4 text-neon-purple" />
              <span className="text-xs text-muted-foreground">AI ACCURACY</span>
            </div>
            <div className="text-2xl font-display text-foreground">
              {aiOverall.correctPredictions}/{aiOverall.totalPredictions}
            </div>
            <div className={`text-sm font-semibold ${Number(aiOverall.accuracy) >= 50 ? 'text-neon-green' : 'text-neon-red'}`}>
              {aiOverall.accuracy}% accurate
            </div>
          </div>
        )}
      </div>

      {/* Per-Leg Context */}
      {legContexts.some(lc => lc.userRecord || lc.aiAccuracy) && (
        <div className="border-t border-border pt-3">
          <p className="text-xs text-muted-foreground mb-2">LEG-SPECIFIC INSIGHTS</p>
          <div className="space-y-2">
            {legContexts.map((lc, idx) => {
              if (!lc.userRecord && !lc.aiAccuracy) return null;
              
              return (
                <div key={idx} className="flex items-center justify-between text-sm bg-muted/30 rounded px-2 py-1.5">
                  <span className="text-muted-foreground">Leg {idx + 1}</span>
                  <div className="flex items-center gap-3">
                    {lc.userRecord && (
                      <span className={`flex items-center gap-1 ${lc.userRecord.hitRate >= 50 ? 'text-neon-green' : 'text-neon-red'}`}>
                        {lc.userRecord.hitRate >= 50 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        You: {lc.userRecord.hitRate.toFixed(0)}%
                      </span>
                    )}
                    {lc.aiAccuracy && (
                      <span className={`flex items-center gap-1 ${lc.aiAccuracy.accuracyRate >= 50 ? 'text-neon-purple' : 'text-muted-foreground'}`}>
                        <Brain className="w-3 h-3" />
                        AI: {lc.aiAccuracy.accuracyRate.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Smart Insight */}
      {hasUserData && Number(userOverall.hitRate) > 0 && (
        <div className="mt-3 p-2 bg-primary/10 rounded-lg border border-primary/20">
          <p className="text-xs text-foreground">
            {Number(userOverall.hitRate) >= 55 ? (
              <>🔥 <strong>Sharp Alert:</strong> Your {userOverall.hitRate}% hit rate beats typical recreational bettors!</>
            ) : Number(userOverall.hitRate) >= 45 ? (
              <>📊 <strong>Solid:</strong> Your betting is around breakeven. Focus on +EV spots.</>
            ) : (
              <>⚠️ <strong>Review:</strong> Your {userOverall.hitRate}% hit rate suggests tightening bet selection.</>
            )}
          </p>
        </div>
      )}
    </FeedCard>
  );
}
