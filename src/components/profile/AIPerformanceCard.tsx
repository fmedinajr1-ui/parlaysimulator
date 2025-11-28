import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FeedCard } from '@/components/FeedCard';
import { Brain, TrendingUp, Trophy, Target, ChevronDown, ChevronUp } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

interface AIMetric {
  sport: string;
  bet_type: string;
  confidence_level: string;
  total_predictions: number;
  correct_predictions: number;
  accuracy_rate: number;
}

interface ConfidenceData {
  total: number;
  wins: number;
}

interface UserStat {
  sport: string;
  bet_type: string;
  total_bets: number;
  wins: number;
  hit_rate: number;
  avg_odds: number;
  by_confidence: {
    high: ConfidenceData;
    medium: ConfidenceData;
    low: ConfidenceData;
  } | null;
}

interface AIPerformanceCardProps {
  userId: string;
}

export function AIPerformanceCard({ userId }: AIPerformanceCardProps) {
  const [aiMetrics, setAiMetrics] = useState<AIMetric[]>([]);
  const [userStats, setUserStats] = useState<UserStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    fetchData();
  }, [userId]);

  const fetchData = async () => {
    try {
      const [aiResponse, userResponse] = await Promise.all([
        supabase.rpc('get_ai_accuracy_stats'),
        supabase.rpc('get_user_betting_stats', { p_user_id: userId })
      ]);

      if (aiResponse.data) {
        setAiMetrics(aiResponse.data);
      }
      if (userResponse.data) {
        // Parse by_confidence from JSON
        const parsedStats = userResponse.data.map((stat: any) => ({
          ...stat,
          by_confidence: stat.by_confidence as UserStat['by_confidence']
        }));
        setUserStats(parsedStats);
      }
    } catch (error) {
      console.error('Error fetching AI performance:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <FeedCard>
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-neon-purple" />
          <h3 className="font-display text-foreground">AI PERFORMANCE</h3>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </FeedCard>
    );
  }

  // Calculate overall AI accuracy
  const totalPredictions = aiMetrics.reduce((sum, m) => sum + m.total_predictions, 0);
  const correctPredictions = aiMetrics.reduce((sum, m) => sum + m.correct_predictions, 0);
  const overallAccuracy = totalPredictions > 0 ? (correctPredictions / totalPredictions * 100) : 0;

  // Calculate user's overall stats
  const userTotalBets = userStats.reduce((sum, s) => sum + Number(s.total_bets), 0);
  const userTotalWins = userStats.reduce((sum, s) => sum + Number(s.wins), 0);
  const userHitRate = userTotalBets > 0 ? (userTotalWins / userTotalBets * 100) : 0;

  // Find best performing categories
  const bestAISport = aiMetrics.length > 0 
    ? aiMetrics.reduce((best, curr) => 
        curr.accuracy_rate > best.accuracy_rate ? curr : best
      )
    : null;

  const bestUserSport = userStats.length > 0
    ? userStats.reduce((best, curr) => 
        Number(curr.hit_rate) > Number(best.hit_rate) ? curr : best
      )
    : null;

  if (totalPredictions === 0 && userTotalBets === 0) {
    return (
      <FeedCard>
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-neon-purple" />
          <h3 className="font-display text-foreground">AI PERFORMANCE</h3>
        </div>
        <p className="text-sm text-muted-foreground text-center py-4">
          No performance data yet. Save and settle parlays to track AI accuracy!
        </p>
      </FeedCard>
    );
  }

  return (
    <FeedCard>
      <div className="flex items-center gap-2 mb-4">
        <Brain className="w-5 h-5 text-neon-purple" />
        <h3 className="font-display text-foreground">AI PERFORMANCE</h3>
      </div>

      {/* Main Stats */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* AI Accuracy */}
        <div className="bg-neon-purple/10 rounded-lg p-3 border border-neon-purple/30">
          <div className="flex items-center gap-1 mb-1">
            <Brain className="w-4 h-4 text-neon-purple" />
            <span className="text-xs text-muted-foreground">AI ACCURACY</span>
          </div>
          <div className="text-2xl font-display text-neon-purple">
            {overallAccuracy.toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground">
            {correctPredictions}/{totalPredictions} correct
          </div>
        </div>

        {/* Your Record */}
        <div className="bg-primary/10 rounded-lg p-3 border border-primary/30">
          <div className="flex items-center gap-1 mb-1">
            <Target className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">YOUR RECORD</span>
          </div>
          <div className={`text-2xl font-display ${userHitRate >= 50 ? 'text-neon-green' : 'text-neon-red'}`}>
            {userHitRate.toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground">
            {userTotalWins}-{userTotalBets - userTotalWins}
          </div>
        </div>
      </div>

      {/* Best Performers */}
      {(bestAISport || bestUserSport) && (
        <div className="space-y-2 mb-3">
          {bestAISport && bestAISport.total_predictions >= 5 && (
            <div className="flex items-center justify-between text-sm bg-muted/50 rounded px-2 py-1.5">
              <span className="flex items-center gap-1 text-muted-foreground">
                <Trophy className="w-3 h-3 text-neon-yellow" />
                Best AI Category
              </span>
              <Badge variant="outline" className="text-neon-purple border-neon-purple/50">
                {bestAISport.sport} {bestAISport.bet_type} - {bestAISport.accuracy_rate.toFixed(0)}%
              </Badge>
            </div>
          )}
          {bestUserSport && Number(bestUserSport.total_bets) >= 3 && (
            <div className="flex items-center justify-between text-sm bg-muted/50 rounded px-2 py-1.5">
              <span className="flex items-center gap-1 text-muted-foreground">
                <TrendingUp className="w-3 h-3 text-neon-green" />
                Your Best Category
              </span>
              <Badge variant="outline" className="text-neon-green border-neon-green/50">
                {bestUserSport.sport} {bestUserSport.bet_type} - {Number(bestUserSport.hit_rate).toFixed(0)}%
              </Badge>
            </div>
          )}
        </div>
      )}

      {/* Expand for details */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground w-full justify-center"
      >
        {isExpanded ? (
          <>
            <ChevronUp className="w-4 h-4" />
            Hide breakdown
          </>
        ) : (
          <>
            <ChevronDown className="w-4 h-4" />
            View breakdown
          </>
        )}
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border space-y-4">
          {/* AI Metrics by Category */}
          {aiMetrics.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">AI ACCURACY BY CATEGORY</p>
              <div className="space-y-1">
                {aiMetrics.slice(0, 6).map((metric, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">
                      {metric.sport} • {metric.bet_type}
                    </span>
                    <span className={metric.accuracy_rate >= 50 ? 'text-neon-green' : 'text-neon-red'}>
                      {metric.accuracy_rate.toFixed(0)}% ({metric.correct_predictions}/{metric.total_predictions})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* User Stats by Category */}
          {userStats.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">YOUR RECORD BY CATEGORY</p>
              <div className="space-y-1">
                {userStats.slice(0, 6).map((stat, idx) => (
                  <div key={idx} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">
                      {stat.sport} • {stat.bet_type}
                    </span>
                    <span className={Number(stat.hit_rate) >= 50 ? 'text-neon-green' : 'text-neon-red'}>
                      {Number(stat.hit_rate).toFixed(0)}% ({stat.wins}/{stat.total_bets})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Confidence Level Analysis */}
          {userStats.some(s => s.by_confidence) && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">PERFORMANCE BY AI CONFIDENCE</p>
              <div className="grid grid-cols-3 gap-2">
                {['high', 'medium', 'low'].map((level) => {
                  const totals = userStats.reduce((acc, s) => {
                    const conf = s.by_confidence?.[level as keyof typeof s.by_confidence];
                    return {
                      total: acc.total + (conf?.total || 0),
                      wins: acc.wins + (conf?.wins || 0)
                    };
                  }, { total: 0, wins: 0 });
                  
                  const rate = totals.total > 0 ? (totals.wins / totals.total * 100) : 0;
                  
                  return (
                    <div key={level} className="bg-muted/30 rounded p-2 text-center">
                      <p className="text-xs text-muted-foreground capitalize">{level}</p>
                      <p className={`text-lg font-display ${rate >= 50 ? 'text-neon-green' : rate > 0 ? 'text-neon-red' : 'text-muted-foreground'}`}>
                        {totals.total > 0 ? `${rate.toFixed(0)}%` : '-'}
                      </p>
                      <p className="text-xs text-muted-foreground">{totals.wins}/{totals.total}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </FeedCard>
  );
}
