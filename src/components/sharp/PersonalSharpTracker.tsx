import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { User, Trophy, TrendingUp, TrendingDown, Clock, ChevronDown, ChevronUp, Check, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface PerformanceStats {
  total_follows: number;
  total_verified: number;
  total_wins: number;
  total_losses: number;
  win_rate: number;
  pending: number;
  by_recommendation: Array<{ recommendation: string; total: number; wins: number; win_rate: number }> | null;
  by_confidence: Array<{ bucket: string; total: number; wins: number; win_rate: number }> | null;
  recent_results: Array<{ id: string; outcome_correct: boolean; followed_at: string }> | null;
}

export function PersonalSharpTracker() {
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<PerformanceStats | null>(null);

  useEffect(() => {
    if (user) {
      fetchStats();
    } else {
      setIsLoading(false);
    }
  }, [user]);

  const fetchStats = async () => {
    if (!user) return;
    setIsLoading(true);
    
    try {
      // First sync outcomes
      await supabase.rpc('sync_sharp_follow_outcomes');
      
      // Then fetch stats
      const { data, error } = await supabase
        .rpc('get_user_sharp_performance', { p_user_id: user.id });

      if (error) throw error;
      
      if (data && data.length > 0) {
        setStats(data[0] as PerformanceStats);
      } else {
        setStats({
          total_follows: 0,
          total_verified: 0,
          total_wins: 0,
          total_losses: 0,
          win_rate: 0,
          pending: 0,
          by_recommendation: null,
          by_confidence: null,
          recent_results: null,
        });
      }
    } catch (error) {
      console.error('Error fetching sharp performance:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getWinRateColor = (rate: number) => {
    if (rate >= 55) return 'text-neon-green';
    if (rate >= 45) return 'text-neon-yellow';
    return 'text-neon-red';
  };

  if (!user) {
    return (
      <Card className="bg-card/50 border-border/50 backdrop-blur-sm">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Sign in to track your picks</span>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href="/auth">Sign In</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-border/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <Skeleton className="h-12 w-24" />
            <Skeleton className="h-12 w-32" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!stats || stats.total_follows === 0) {
    return (
      <Card className="bg-card/50 border-border/50 backdrop-blur-sm">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" />
              <span className="text-sm">Your Record</span>
            </div>
            <span className="text-xs text-muted-foreground">
              Tap "Follow" on picks to start tracking
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 border-border/50 backdrop-blur-sm overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-primary" />
            Your Record
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 w-8 p-0"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Summary Row */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-bold ${getWinRateColor(stats.win_rate)}`}>
              {stats.total_wins}-{stats.total_losses}
            </span>
            {stats.total_verified > 0 && (
              <span className={`text-sm font-medium ${getWinRateColor(stats.win_rate)}`}>
                ({stats.win_rate.toFixed(1)}%)
              </span>
            )}
          </div>
          
          {stats.pending > 0 && (
            <Badge variant="outline" className="border-neon-yellow/50 text-neon-yellow">
              <Clock className="w-3 h-3 mr-1" />
              {stats.pending} pending
            </Badge>
          )}

          {/* Recent Results Streak */}
          {stats.recent_results && stats.recent_results.length > 0 && (
            <div className="flex items-center gap-1 ml-auto">
              {stats.recent_results.slice(0, 5).map((result, idx) => (
                <div
                  key={result.id}
                  className={`w-5 h-5 rounded-full flex items-center justify-center ${
                    result.outcome_correct 
                      ? 'bg-neon-green/20 text-neon-green' 
                      : 'bg-neon-red/20 text-neon-red'
                  }`}
                >
                  {result.outcome_correct ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Expanded Content */}
        {isExpanded && (
          <div className="space-y-4 pt-4 border-t border-border/50">
            {/* By Recommendation */}
            {stats.by_recommendation && stats.by_recommendation.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">By Recommendation</h4>
                <div className="flex gap-2 flex-wrap">
                  {stats.by_recommendation.map((rec) => (
                    <Badge
                      key={rec.recommendation}
                      variant="outline"
                      className={`${
                        rec.recommendation === 'pick' ? 'border-neon-green/50' :
                        rec.recommendation === 'fade' ? 'border-neon-red/50' :
                        'border-neon-yellow/50'
                      }`}
                    >
                      <span className="mr-1 uppercase">{rec.recommendation}</span>
                      <span className={getWinRateColor(rec.win_rate)}>
                        {rec.wins}/{rec.total}
                      </span>
                      {rec.total > 0 && (
                        <span className="text-muted-foreground ml-1">
                          ({rec.win_rate.toFixed(0)}%)
                        </span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* By Confidence */}
            {stats.by_confidence && stats.by_confidence.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-muted-foreground">By Confidence Level</h4>
                <div className="space-y-1">
                  {stats.by_confidence.map((bucket) => (
                    <div key={bucket.bucket} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{bucket.bucket}</span>
                      <span className={getWinRateColor(bucket.win_rate)}>
                        {bucket.wins}/{bucket.total} ({bucket.win_rate.toFixed(0)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold text-neon-green">{stats.total_wins}</div>
                <div className="text-[10px] text-muted-foreground">WINS</div>
              </div>
              <div className="p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold text-neon-red">{stats.total_losses}</div>
                <div className="text-[10px] text-muted-foreground">LOSSES</div>
              </div>
              <div className="p-2 rounded-lg bg-muted/50">
                <div className="text-lg font-bold text-neon-yellow">{stats.pending}</div>
                <div className="text-[10px] text-muted-foreground">PENDING</div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
