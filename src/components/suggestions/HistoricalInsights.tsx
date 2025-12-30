import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { 
  Flame, Snowflake, Activity, ChevronDown, ChevronUp,
  TrendingUp, TrendingDown, Clock, Target
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

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
  todayLine?: number;
  todayOpponent?: string;
  edgeAmount?: number;
  gameTime?: string;
}

interface HistoricalInsightsProps {
  compact?: boolean;
}

export const HistoricalInsights = ({ compact = false }: HistoricalInsightsProps) => {
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  const { data: insights, isLoading } = useQuery({
    queryKey: ['historical-insights-enhanced'],
    queryFn: async () => {
      // Fetch last 10 games for NBA teams
      const { data: gameLogs, error } = await supabase
        .from('nba_player_game_logs')
        .select('*')
        .order('game_date', { ascending: false })
        .limit(1000);

      if (error) throw error;

      // Aggregate by team (opponent = who they played against, so we get points allowed)
      const teamStats: Record<string, { points: number; date: string }[]> = {};
      
      gameLogs?.forEach(log => {
        const team = log.opponent;
        if (!teamStats[team]) teamStats[team] = [];
        
        // Find or create game entry
        const existingGame = teamStats[team].find(g => g.date === log.game_date);
        if (existingGame) {
          existingGame.points += log.points || 0;
        } else {
          teamStats[team].push({ points: log.points || 0, date: log.game_date });
        }
      });

      // Fetch today's odds to match trends with games
      const { data: todayOdds } = await supabase
        .from('odds_snapshots')
        .select('*')
        .in('sport', ['basketball_nba', 'NBA'])
        .eq('market_type', 'totals')
        .gte('commence_time', new Date().toISOString())
        .order('commence_time', { ascending: true })
        .limit(20);

      // Calculate trends
      const trends: TeamTrend[] = [];
      
      Object.entries(teamStats).forEach(([team, games]) => {
        if (games.length < 5) return;
        
        // Sort by date descending
        const sortedGames = games.sort((a, b) => 
          new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        
        const last5 = sortedGames.slice(0, 5).map(g => g.points);
        const avgPoints = last5.reduce((a, b) => a + b, 0) / last5.length;
        const avgTotal = avgPoints * 2;
        
        // Calculate streak with smarter threshold (use avg as baseline)
        let streakCount = 1;
        let streakType: 'over' | 'under' | 'mixed' = 'mixed';
        const baseline = 215; // Avg NBA game total
        
        const results = last5.map(p => p * 2 > baseline ? 'over' : 'under');
        if (results[0]) {
          streakType = results[0];
          for (let i = 1; i < results.length; i++) {
            if (results[i] === streakType) streakCount++;
            else break;
          }
        }
        
        const overHitRate = results.filter(r => r === 'over').length / 5 * 100;
        const underHitRate = 100 - overHitRate;

        // Find today's game for this team
        const todayGame = todayOdds?.find(o => 
          o.home_team?.toLowerCase().includes(team.toLowerCase()) ||
          o.away_team?.toLowerCase().includes(team.toLowerCase()) ||
          team.toLowerCase().includes(o.home_team?.toLowerCase() || '') ||
          team.toLowerCase().includes(o.away_team?.toLowerCase() || '')
        );

        const todayLine = todayGame?.point;
        const edgeAmount = todayLine ? Math.abs(avgTotal - todayLine) : undefined;
        
        trends.push({
          team,
          avgPoints,
          avgTotal,
          overHitRate,
          underHitRate,
          last5Games: last5,
          trend: overHitRate >= 80 ? 'hot' : underHitRate >= 80 ? 'cold' : 'neutral',
          streakType: streakCount >= 3 ? streakType : 'mixed',
          streakCount,
          todayLine,
          todayOpponent: todayGame ? 
            (todayGame.home_team?.toLowerCase().includes(team.toLowerCase()) 
              ? todayGame.away_team 
              : todayGame.home_team) : undefined,
          edgeAmount,
          gameTime: todayGame?.commence_time ? 
            new Date(todayGame.commence_time).toLocaleTimeString('en-US', { 
              hour: 'numeric', 
              minute: '2-digit',
              hour12: true 
            }) : undefined,
        });
      });

      // Sort by streak strength and having a game today
      return trends
        .filter(t => t.streakCount >= 3)
        .sort((a, b) => {
          // Prioritize teams with games today
          if (a.todayLine && !b.todayLine) return -1;
          if (!a.todayLine && b.todayLine) return 1;
          // Then by edge amount
          if (a.edgeAmount && b.edgeAmount) return b.edgeAmount - a.edgeAmount;
          // Then by streak count
          return b.streakCount - a.streakCount;
        })
        .slice(0, 8);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Fetch line movement accuracy
  const { data: lineAccuracy } = useQuery({
    queryKey: ['line-accuracy-enhanced'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('line_movements')
        .select('sport, recommendation, outcome_correct')
        .eq('outcome_verified', true)
        .not('recommendation', 'is', null);

      if (error) throw error;

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
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!insights || insights.length === 0) return null;

  const renderTrendStrengthBar = (streakCount: number) => {
    const strength = Math.min(streakCount / 5, 1);
    return (
      <div className="flex gap-0.5 mt-1">
        {[...Array(5)].map((_, i) => (
          <div 
            key={i} 
            className={cn(
              "h-1 flex-1 rounded-full",
              i < streakCount ? "bg-primary" : "bg-muted"
            )}
          />
        ))}
      </div>
    );
  };

  return (
    <Card className="bg-card/50 backdrop-blur border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Today's Historical Trends
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Team Trends - Enhanced */}
        {insights.slice(0, compact ? 4 : 6).map((trend) => (
          <Collapsible
            key={trend.team}
            open={expandedTeam === trend.team}
            onOpenChange={(open) => setExpandedTeam(open ? trend.team : null)}
          >
            <div 
              className={cn(
                "rounded-lg border transition-all",
                trend.streakType === 'over' && "bg-green-500/5 border-green-500/30",
                trend.streakType === 'under' && "bg-blue-500/5 border-blue-500/30",
                trend.streakType === 'mixed' && "bg-muted/50 border-border/50",
                trend.edgeAmount && trend.edgeAmount >= 5 && "ring-1 ring-primary/50"
              )}
            >
              <CollapsibleTrigger className="w-full p-3 text-left">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate">{trend.team}</span>
                      {trend.trend === 'hot' ? (
                        <Flame className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                      ) : trend.trend === 'cold' ? (
                        <Snowflake className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                      ) : null}
                      {trend.todayOpponent && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                          vs {trend.todayOpponent}
                        </Badge>
                      )}
                    </div>
                    
                    {/* Streak Info Row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-[10px] px-1.5",
                          trend.streakType === 'over' && "text-green-500 border-green-500/50 bg-green-500/10",
                          trend.streakType === 'under' && "text-blue-500 border-blue-500/50 bg-blue-500/10"
                        )}
                      >
                        {trend.streakCount}x {trend.streakType.toUpperCase()}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        Avg: {Math.round(trend.avgTotal)} pts
                      </span>
                      {trend.todayLine && (
                        <span className="text-[10px] text-muted-foreground">
                          | Line: {trend.todayLine}
                        </span>
                      )}
                    </div>

                    {/* Last 5 Mini Dots */}
                    <div className="flex items-center gap-1 mt-1.5">
                      <span className="text-[9px] text-muted-foreground">L5:</span>
                      {trend.last5Games.map((score, i) => (
                        <div 
                          key={i}
                          className={cn(
                            "w-5 h-4 rounded text-[8px] font-medium flex items-center justify-center",
                            score * 2 > 215 
                              ? "bg-green-500/20 text-green-600" 
                              : "bg-blue-500/20 text-blue-600"
                          )}
                        >
                          {Math.round(score)}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 ml-2">
                    {trend.edgeAmount && trend.edgeAmount >= 2 && (
                      <Badge 
                        className={cn(
                          "text-[10px]",
                          trend.streakType === 'over' 
                            ? "bg-green-500/20 text-green-500 border-green-500/30" 
                            : "bg-blue-500/20 text-blue-500 border-blue-500/30"
                        )}
                      >
                        {trend.streakType === 'over' ? (
                          <TrendingUp className="h-3 w-3 mr-1" />
                        ) : (
                          <TrendingDown className="h-3 w-3 mr-1" />
                        )}
                        +{trend.edgeAmount.toFixed(1)} edge
                      </Badge>
                    )}
                    {trend.gameTime && (
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {trend.gameTime}
                      </div>
                    )}
                    {expandedTeam === trend.team ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2">
                  {/* Trend Strength Bar */}
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                      <span>Trend Strength</span>
                      <span>{Math.round((trend.streakCount / 5) * 100)}%</span>
                    </div>
                    {renderTrendStrengthBar(trend.streakCount)}
                  </div>

                  {/* Hit Rates */}
                  <div className="flex gap-4 text-[11px]">
                    <div>
                      <span className="text-muted-foreground">Over Rate: </span>
                      <span className={cn(
                        "font-medium",
                        trend.overHitRate >= 60 && "text-green-500"
                      )}>
                        {Math.round(trend.overHitRate)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Under Rate: </span>
                      <span className={cn(
                        "font-medium",
                        trend.underHitRate >= 60 && "text-blue-500"
                      )}>
                        {Math.round(trend.underHitRate)}%
                      </span>
                    </div>
                  </div>

                  {/* Betting Angle */}
                  {trend.todayLine && trend.edgeAmount && trend.edgeAmount >= 2 && (
                    <div className="p-2 rounded bg-primary/10 border border-primary/20">
                      <div className="flex items-center gap-1.5">
                        <Target className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-medium">Betting Angle</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {trend.streakType === 'over' ? (
                          <>LEAN <span className="text-green-500 font-medium">OVER {trend.todayLine}</span> — {trend.streakCount} game over streak, averaging {Math.round(trend.avgTotal)} total pts</>
                        ) : (
                          <>LEAN <span className="text-blue-500 font-medium">UNDER {trend.todayLine}</span> — {trend.streakCount} game under streak, averaging {Math.round(trend.avgTotal)} total pts</>
                        )}
                      </p>
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))}

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
