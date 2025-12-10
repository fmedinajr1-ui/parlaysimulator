import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { TrendingUp, TrendingDown, Flame, Snowflake, Target, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TeamTrend {
  team: string;
  avgPoints: number;
  avgTotal: number;
  overHitRate: number;
  underHitRate: number;
  last5Games: number[];
  trend: 'hot' | 'cold' | 'neutral';
  streakType: 'over' | 'under' | 'mixed';
  streakCount: number;
}

interface HistoricalInsightsProps {
  compact?: boolean;
}

export const HistoricalInsights = ({ compact = false }: HistoricalInsightsProps) => {
  const { data: insights, isLoading } = useQuery({
    queryKey: ['historical-insights'],
    queryFn: async () => {
      // Fetch last 5 games for NBA teams
      const { data: gameLogs, error } = await supabase
        .from('nba_player_game_logs')
        .select('*')
        .order('game_date', { ascending: false })
        .limit(500);

      if (error) throw error;

      // Aggregate by team
      const teamStats: Record<string, number[]> = {};
      
      gameLogs?.forEach(log => {
        const team = log.opponent; // We track vs opponent
        if (!teamStats[team]) teamStats[team] = [];
        if (log.points) teamStats[team].push(log.points);
      });

      // Calculate trends
      const trends: TeamTrend[] = [];
      
      Object.entries(teamStats).forEach(([team, points]) => {
        if (points.length < 5) return;
        
        const last5 = points.slice(0, 5);
        const avgPoints = last5.reduce((a, b) => a + b, 0) / last5.length;
        const avgTotal = avgPoints * 2; // Rough estimate
        
        // Calculate streak
        let streakCount = 1;
        let streakType: 'over' | 'under' | 'mixed' = 'mixed';
        const median = 110; // Average NBA game total
        
        const results = last5.map(p => p * 2 > median ? 'over' : 'under');
        if (results[0]) {
          streakType = results[0];
          for (let i = 1; i < results.length; i++) {
            if (results[i] === streakType) streakCount++;
            else break;
          }
        }
        
        const overHitRate = results.filter(r => r === 'over').length / 5 * 100;
        const underHitRate = 100 - overHitRate;
        
        trends.push({
          team,
          avgPoints,
          avgTotal,
          overHitRate,
          underHitRate,
          last5Games: last5,
          trend: overHitRate >= 80 ? 'hot' : underHitRate >= 80 ? 'cold' : 'neutral',
          streakType: streakCount >= 4 ? streakType : 'mixed',
          streakCount,
        });
      });

      // Sort by streak strength
      return trends
        .filter(t => t.streakCount >= 3)
        .sort((a, b) => b.streakCount - a.streakCount)
        .slice(0, 6);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch line movement accuracy
  const { data: lineAccuracy } = useQuery({
    queryKey: ['line-accuracy'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('line_movements')
        .select('sport, recommendation, outcome_correct')
        .eq('outcome_verified', true)
        .not('recommendation', 'is', null);

      if (error) throw error;

      // Calculate win rates by recommendation type
      const stats: Record<string, { wins: number; total: number }> = {};
      
      data?.forEach(row => {
        const key = row.recommendation || 'unknown';
        if (!stats[key]) stats[key] = { wins: 0, total: 0 };
        stats[key].total++;
        if (row.outcome_correct) stats[key].wins++;
      });

      return Object.entries(stats)
        .filter(([_, v]) => v.total >= 5)
        .map(([key, v]) => ({
          type: key,
          winRate: Math.round((v.wins / v.total) * 100),
          total: v.total,
        }))
        .sort((a, b) => b.winRate - a.winRate);
    },
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!insights || insights.length === 0) return null;

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Today's Historical Trends
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Team Trends */}
        <div className="grid grid-cols-2 gap-2">
          {insights.slice(0, compact ? 4 : 6).map((trend) => (
            <div 
              key={trend.team}
              className={cn(
                "p-2 rounded-lg border",
                trend.trend === 'hot' && "bg-orange-500/10 border-orange-500/30",
                trend.trend === 'cold' && "bg-blue-500/10 border-blue-500/30",
                trend.trend === 'neutral' && "bg-muted/50 border-border/50"
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium truncate">{trend.team}</span>
                {trend.trend === 'hot' ? (
                  <Flame className="h-3 w-3 text-orange-500" />
                ) : trend.trend === 'cold' ? (
                  <Snowflake className="h-3 w-3 text-blue-500" />
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-[10px] px-1",
                    trend.streakType === 'over' && "text-green-500 border-green-500/50",
                    trend.streakType === 'under' && "text-red-500 border-red-500/50"
                  )}
                >
                  {trend.streakCount}x {trend.streakType.toUpperCase()}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {Math.round(trend.avgTotal)} avg
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Line Movement Accuracy */}
        {lineAccuracy && lineAccuracy.length > 0 && !compact && (
          <div className="pt-2 border-t border-border/50">
            <p className="text-xs text-muted-foreground mb-2">Sharp Signal Accuracy</p>
            <div className="flex flex-wrap gap-2">
              {lineAccuracy.slice(0, 3).map((stat) => (
                <Badge 
                  key={stat.type}
                  variant="secondary"
                  className={cn(
                    "text-xs",
                    stat.winRate >= 60 && "bg-green-500/20 text-green-500",
                    stat.winRate < 50 && "bg-red-500/20 text-red-500"
                  )}
                >
                  {stat.type}: {stat.winRate}% ({stat.total})
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
