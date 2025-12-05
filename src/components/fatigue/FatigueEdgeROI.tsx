import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Target, DollarSign, BarChart3, Battery, CheckCircle2, XCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface FatigueAccuracyStats {
  differential_bucket: string;
  total_games: number;
  verified_games: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_differential: number;
  roi_percentage: number;
}

interface RecentGame {
  id: string;
  home_team: string;
  away_team: string;
  fatigue_differential: number;
  recommended_side: string;
  recommended_side_won: boolean | null;
  game_date: string;
}

export function FatigueEdgeROI() {
  const { data: accuracyStats, isLoading: statsLoading } = useQuery({
    queryKey: ['fatigue-edge-accuracy'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_fatigue_edge_accuracy');
      if (error) throw error;
      return data as FatigueAccuracyStats[];
    },
  });

  const { data: recentGames, isLoading: gamesLoading } = useQuery({
    queryKey: ['fatigue-edge-recent'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('fatigue_edge_tracking')
        .select('*')
        .gte('fatigue_differential', 15)
        .order('game_date', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as RecentGame[];
    },
  });

  const totalStats = accuracyStats?.reduce(
    (acc, bucket) => ({
      total: acc.total + bucket.total_games,
      verified: acc.verified + bucket.verified_games,
      wins: acc.wins + bucket.wins,
      losses: acc.losses + bucket.losses,
    }),
    { total: 0, verified: 0, wins: 0, losses: 0 }
  );

  const overallWinRate = totalStats && totalStats.verified > 0
    ? ((totalStats.wins / totalStats.verified) * 100).toFixed(1)
    : '0';

  const overallROI = totalStats && totalStats.verified > 0
    ? (((totalStats.wins * 0.91 - totalStats.losses) / totalStats.verified) * 100).toFixed(1)
    : '0';

  if (statsLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Battery className="h-5 w-5 text-primary" />
            Fatigue Edge ROI Tracker
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Battery className="h-5 w-5 text-primary" />
          Fatigue Edge ROI Tracker
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{totalStats?.total || 0}</div>
            <div className="text-xs text-muted-foreground">Total Edges</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{totalStats?.verified || 0}</div>
            <div className="text-xs text-muted-foreground">Verified</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${Number(overallWinRate) >= 52.4 ? 'text-green-500' : 'text-foreground'}`}>
              {overallWinRate}%
            </div>
            <div className="text-xs text-muted-foreground">Win Rate</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${Number(overallROI) > 0 ? 'text-green-500' : Number(overallROI) < 0 ? 'text-red-500' : 'text-foreground'}`}>
              {Number(overallROI) > 0 ? '+' : ''}{overallROI}%
            </div>
            <div className="text-xs text-muted-foreground">ROI</div>
          </div>
        </div>

        {/* Breakdown by Differential */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Performance by Fatigue Differential
          </h4>
          <div className="space-y-2">
            {accuracyStats && accuracyStats.length > 0 ? (
              accuracyStats.map((bucket) => (
                <div
                  key={bucket.differential_bucket}
                  className="flex items-center justify-between p-3 bg-muted/20 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={
                      bucket.differential_bucket === '30+' ? 'destructive' :
                      bucket.differential_bucket === '20-29' ? 'default' : 'secondary'
                    }>
                      {bucket.differential_bucket}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {bucket.verified_games} games
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm font-medium">
                        {bucket.wins}W - {bucket.losses}L
                      </div>
                      <div className={`text-xs ${bucket.win_rate >= 52.4 ? 'text-green-500' : 'text-muted-foreground'}`}>
                        {bucket.win_rate}% win rate
                      </div>
                    </div>
                    <div className={`text-sm font-bold min-w-[60px] text-right ${
                      bucket.roi_percentage > 0 ? 'text-green-500' : 
                      bucket.roi_percentage < 0 ? 'text-red-500' : 'text-muted-foreground'
                    }`}>
                      {bucket.roi_percentage > 0 ? '+' : ''}{bucket.roi_percentage}%
                      <div className="text-xs font-normal text-muted-foreground">ROI</div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No fatigue edge data yet</p>
                <p className="text-xs">Edges will be tracked as games complete</p>
              </div>
            )}
          </div>
        </div>

        {/* Recent Games */}
        {recentGames && recentGames.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Recent Fatigue Edges</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {recentGames.map((game) => (
                <div
                  key={game.id}
                  className="flex items-center justify-between p-2 bg-muted/10 rounded text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      +{game.fatigue_differential}
                    </Badge>
                    <span className="text-muted-foreground">
                      {game.away_team} @ {game.home_team}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {game.recommended_side}
                    </span>
                    {game.recommended_side_won === null ? (
                      <Badge variant="secondary" className="text-xs">Pending</Badge>
                    ) : game.recommended_side_won ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ROI Explanation */}
        <div className="text-xs text-muted-foreground bg-muted/20 rounded-lg p-3">
          <p className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            ROI calculated at standard -110 juice. Win rate above 52.4% = profitable.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
