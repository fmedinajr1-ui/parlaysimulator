import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Trophy, Clock, Target, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface PerformanceStats {
  total_suggestions_followed: number;
  total_won: number;
  total_lost: number;
  total_pending: number;
  win_rate: number;
  total_staked: number;
  total_profit: number;
  avg_confidence: number;
  performance_by_sport: Array<{
    sport: string;
    total: number;
    won: number;
    lost: number;
    win_rate: number;
  }> | null;
}

export const SuggestionPerformanceCard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<PerformanceStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchStats();
    }
  }, [user]);

  const fetchStats = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .rpc('get_suggestion_performance_stats', { p_user_id: user.id });

      if (error) throw error;

      if (data && data.length > 0) {
        setStats(data[0] as PerformanceStats);
      }
    } catch (error) {
      console.error('Error fetching suggestion performance:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-border/50 animate-pulse">
        <CardContent className="p-6">
          <div className="h-24 bg-muted/30 rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (!stats || stats.total_suggestions_followed === 0) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            AI SUGGESTION PERFORMANCE
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <p className="text-muted-foreground text-sm">
              No suggestions tracked yet. Analyze and save an AI suggestion to start tracking performance.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isProfit = stats.total_profit >= 0;

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-display flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          AI SUGGESTION PERFORMANCE
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Main Stats */}
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Followed</p>
            <p className="text-lg font-bold text-foreground">{stats.total_suggestions_followed}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
              <Trophy className="w-3 h-3 text-neon-green" />
              Won
            </p>
            <p className="text-lg font-bold text-neon-green">{stats.total_won}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1">Lost</p>
            <p className="text-lg font-bold text-neon-red">{stats.total_lost}</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-3 text-center">
            <p className="text-xs text-muted-foreground mb-1 flex items-center justify-center gap-1">
              <Clock className="w-3 h-3 text-neon-yellow" />
              Pending
            </p>
            <p className="text-lg font-bold text-neon-yellow">{stats.total_pending}</p>
          </div>
        </div>

        {/* Win Rate & Profit */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-lg p-3 border border-primary/20">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground">Win Rate</p>
              {stats.win_rate >= 50 ? (
                <TrendingUp className="w-4 h-4 text-neon-green" />
              ) : (
                <TrendingDown className="w-4 h-4 text-neon-orange" />
              )}
            </div>
            <p className={cn(
              "text-2xl font-bold",
              stats.win_rate >= 50 ? "text-neon-green" : "text-neon-orange"
            )}>
              {stats.win_rate}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.total_won + stats.total_lost} settled bets
            </p>
          </div>
          <div className={cn(
            "rounded-lg p-3 border",
            isProfit 
              ? "bg-neon-green/10 border-neon-green/20" 
              : "bg-neon-red/10 border-neon-red/20"
          )}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted-foreground">Total P/L</p>
              <DollarSign className={cn("w-4 h-4", isProfit ? "text-neon-green" : "text-neon-red")} />
            </div>
            <p className={cn(
              "text-2xl font-bold",
              isProfit ? "text-neon-green" : "text-neon-red"
            )}>
              {isProfit ? '+' : ''}{stats.total_profit.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              ${stats.total_staked.toFixed(0)} staked
            </p>
          </div>
        </div>

        {/* Performance by Sport */}
        {stats.performance_by_sport && stats.performance_by_sport.length > 0 && (
          <div className="bg-muted/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground mb-2">Performance by Sport</p>
            <div className="space-y-2">
              {stats.performance_by_sport.map((sport) => (
                <div key={sport.sport} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      {sport.sport}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {sport.won}W - {sport.lost}L
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all",
                          sport.win_rate >= 50 ? "bg-neon-green" : "bg-neon-orange"
                        )}
                        style={{ width: `${Math.min(100, sport.win_rate)}%` }}
                      />
                    </div>
                    <span className={cn(
                      "text-xs font-medium w-10 text-right",
                      sport.win_rate >= 50 ? "text-neon-green" : "text-neon-orange"
                    )}>
                      {sport.win_rate}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Average Confidence */}
        <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Avg Suggestion Confidence</span>
            </div>
            <span className="text-sm font-medium text-primary">{stats.avg_confidence}%</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
