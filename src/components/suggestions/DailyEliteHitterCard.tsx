import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Crown, Target, Zap, TrendingUp, RefreshCw, Trophy, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface LegData {
  playerName: string;
  propType: string;
  line: number;
  side: string;
  odds: number;
  sport: string;
  p_leg: number;
  edge: number;
  engines: string[];
  gameDescription?: string;
}

interface EliteParlay {
  id: string;
  parlay_date: string;
  legs: LegData[];
  slip_score: number;
  combined_probability: number;
  total_edge: number;
  total_odds: number;
  sports: string[];
  source_engines: string[];
  outcome: string;
}

const sportEmojis: Record<string, string> = {
  'NBA': '🏀',
  'NFL': '🏈',
  'NHL': '🏒',
  'MLB': '⚾',
  'basketball_nba': '🏀',
  'americanfootball_nfl': '🏈',
  'icehockey_nhl': '🏒',
  'baseball_mlb': '⚾',
};

const engineColors: Record<string, string> = {
  'MedianLock': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'HitRate': 'bg-green-500/20 text-green-400 border-green-500/30',
  'Sharp': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'PVS': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'Fatigue': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
};

export function DailyEliteHitterCard() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: parlay, isLoading, refetch } = useQuery({
    queryKey: ['daily-elite-parlay'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('daily_elite_parlays')
        .select('*')
        .eq('parlay_date', today)
        .maybeSingle();
      
      if (error) throw error;
      return data as EliteParlay | null;
    },
    staleTime: 1000 * 60 * 5,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await supabase.functions.invoke('elite-daily-hitter-engine');
      await refetch();
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!parlay) {
    return (
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Crown className="w-5 h-5 text-primary" />
            Daily Elite 3-Leg Hitter
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-6">
          <p className="text-muted-foreground mb-4">No elite parlay generated yet for today</p>
          <Button onClick={handleRefresh} disabled={isRefreshing} size="sm">
            {isRefreshing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
            Generate Now
          </Button>
        </CardContent>
      </Card>
    );
  }

  const combinedProbPercent = (parlay.combined_probability * 100).toFixed(1);
  const legs = parlay.legs || [];

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 via-background to-primary/10 overflow-hidden">
      {/* Header */}
      <CardHeader className="pb-2 border-b border-border/50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Crown className="w-5 h-5 text-primary" />
            Daily Elite 3-Leg Hitter
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {format(new Date(parlay.parlay_date), 'MMM d')}
          </Badge>
        </div>
        
        {/* Stats Row */}
        <div className="flex items-center gap-4 mt-2 text-sm">
          <div className="flex items-center gap-1">
            <Target className="w-4 h-4 text-green-500" />
            <span className="text-muted-foreground">Prob:</span>
            <span className="font-semibold text-green-500">{combinedProbPercent}%</span>
          </div>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-4 h-4 text-blue-500" />
            <span className="text-muted-foreground">Odds:</span>
            <span className="font-semibold text-blue-500">
              {parlay.total_odds > 0 ? '+' : ''}{Math.round(parlay.total_odds)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Zap className="w-4 h-4 text-yellow-500" />
            <span className="text-muted-foreground">Edge:</span>
            <span className="font-semibold text-yellow-500">+{parlay.total_edge?.toFixed(1)}%</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-3">
        {/* Legs */}
        {legs.map((leg, idx) => (
          <div 
            key={idx} 
            className="p-3 rounded-lg bg-muted/30 border border-border/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{sportEmojis[leg.sport] || '🎯'}</span>
                  <span className="font-medium text-sm truncate">{leg.playerName}</span>
                  <Badge 
                    variant="outline" 
                    className={cn(
                      "text-[10px] px-1.5 py-0",
                      leg.side === 'over' ? 'text-green-500 border-green-500/30' : 'text-red-500 border-red-500/30'
                    )}
                  >
                    {leg.side.toUpperCase()}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {leg.propType} {leg.line} ({leg.odds > 0 ? '+' : ''}{leg.odds})
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold text-primary">
                  {(leg.p_leg * 100).toFixed(0)}%
                </div>
                <div className="text-[10px] text-muted-foreground">
                  +{leg.edge?.toFixed(1)}% edge
                </div>
              </div>
            </div>
            
            {/* Engine badges */}
            <div className="flex flex-wrap gap-1 mt-2">
              {leg.engines?.map((engine, eIdx) => (
                <Badge 
                  key={eIdx} 
                  variant="outline" 
                  className={cn("text-[10px] px-1.5 py-0", engineColors[engine] || '')}
                >
                  {engine}
                </Badge>
              ))}
            </div>
          </div>
        ))}

        {/* Outcome badge if settled */}
        {parlay.outcome !== 'pending' && (
          <div className={cn(
            "flex items-center justify-center gap-2 p-3 rounded-lg",
            parlay.outcome === 'won' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          )}>
            <Trophy className="w-5 h-5" />
            <span className="font-semibold">{parlay.outcome === 'won' ? 'HIT!' : 'MISS'}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}