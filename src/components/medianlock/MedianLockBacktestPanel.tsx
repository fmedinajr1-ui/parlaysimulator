import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  BarChart3, 
  TrendingUp, 
  Target, 
  RefreshCw, 
  Loader2,
  AlertTriangle,
  CheckCircle,
  Clock,
  Zap
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface BacktestResult {
  id: string;
  run_date: string;
  slates_analyzed: number;
  lock_only_hit_rate: number;
  lock_strong_hit_rate: number;
  lock_count: number;
  strong_count: number;
  block_count: number;
  slip_2_hit_rate: number;
  slip_3_hit_rate: number;
  slip_2_count: number;
  slip_3_count: number;
  top_fail_reasons: { reason: string; count: number }[];
  avg_edge: number;
  avg_minutes: number;
  avg_confidence_score: number;
  juice_lag_win_rate: number;
  shock_flag_rate: number;
  shock_pass_rate: number;
  tuned_edge_min: number;
  tuned_hit_rate_min: number;
  tuned_minutes_floor: number;
  defense_bucket_stats: { bucket: string; hitRate: number; count: number }[];
  minutes_bucket_stats: { bucket: string; hitRate: number; count: number }[];
  home_away_stats: { location: string; hitRate: number; count: number }[];
}

export function MedianLockBacktestPanel() {
  const { toast } = useToast();
  const [latestResult, setLatestResult] = useState<BacktestResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    fetchLatestBacktest();
  }, []);

  const fetchLatestBacktest = async () => {
    try {
      const { data, error } = await supabase
        .from('median_lock_backtest_results')
        .select('*')
        .order('run_date', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      
      if (data) {
        // Cast JSON fields properly
        const result = {
          ...data,
          top_fail_reasons: (data.top_fail_reasons || []) as { reason: string; count: number }[],
          defense_bucket_stats: (data.defense_bucket_stats || []) as { bucket: string; hitRate: number; count: number }[],
          minutes_bucket_stats: (data.minutes_bucket_stats || []) as { bucket: string; hitRate: number; count: number }[],
          home_away_stats: (data.home_away_stats || []) as { location: string; hitRate: number; count: number }[],
        };
        setLatestResult(result as BacktestResult);
      }
    } catch (error) {
      console.error('Error fetching backtest:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const runBacktest = async (autoTune: boolean = false) => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('median-lock-backtest', {
        body: { days: 30, autoTune }
      });

      if (error) throw error;

      toast({
        title: "Backtest Complete",
        description: data.message || "30-day backtest finished",
      });

      await fetchLatestBacktest();
    } catch (error) {
      console.error('Backtest error:', error);
      toast({
        title: "Backtest Failed",
        description: "Could not run backtest. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-8 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <BarChart3 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">30-Day Backtest</CardTitle>
                <p className="text-xs text-muted-foreground">
                  MedianLock™ PRO Performance Analysis
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => runBacktest(false)}
                disabled={isRunning}
              >
                {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </Button>
              <Button 
                size="sm"
                onClick={() => runBacktest(true)}
                disabled={isRunning}
              >
                <Zap className="w-4 h-4 mr-1" />
                Auto-Tune
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {!latestResult ? (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-8 text-center">
            <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-foreground mb-2">No Backtest Data</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Run a backtest to analyze the last 30 days of MedianLock performance.
            </p>
            <Button onClick={() => runBacktest(false)} disabled={isRunning}>
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Run Backtest
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">LOCK Hit Rate</p>
                <p className="text-2xl font-bold text-primary">
                  {(latestResult.lock_only_hit_rate * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {latestResult.lock_count} picks
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">LOCK+STRONG</p>
                <p className="text-2xl font-bold text-foreground">
                  {(latestResult.lock_strong_hit_rate * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {latestResult.lock_count + latestResult.strong_count} picks
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">2-Leg Slips</p>
                <p className="text-2xl font-bold text-green-500">
                  {(latestResult.slip_2_hit_rate * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {latestResult.slip_2_count} slips
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">3-Leg Slips</p>
                <p className="text-2xl font-bold text-yellow-500">
                  {(latestResult.slip_3_hit_rate * 100).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {latestResult.slip_3_count} slips
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Diagnostics */}
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="w-4 h-4" />
                Diagnostics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <p className="text-muted-foreground">Avg Edge</p>
                  <p className="font-semibold">{latestResult.avg_edge?.toFixed(1) || 0} pts</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Avg Minutes</p>
                  <p className="font-semibold">{latestResult.avg_minutes?.toFixed(1) || 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Juice Lag Win%</p>
                  <p className="font-semibold text-green-500">
                    {(latestResult.juice_lag_win_rate * 100).toFixed(0)}%
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center text-xs pt-2 border-t border-border/30">
                <div>
                  <p className="text-muted-foreground">Shock Flag Rate</p>
                  <p className="font-semibold text-yellow-500">
                    {(latestResult.shock_flag_rate * 100).toFixed(0)}%
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Shock Pass Rate</p>
                  <p className="font-semibold">
                    {(latestResult.shock_pass_rate * 100).toFixed(0)}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top Fail Reasons */}
          {latestResult.top_fail_reasons && latestResult.top_fail_reasons.length > 0 && (
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-yellow-500" />
                  Top Block Reasons
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {latestResult.top_fail_reasons.slice(0, 5).map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{item.reason}</span>
                      <Badge variant="secondary">{item.count}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tuned Thresholds */}
          <Card className="bg-gradient-to-br from-green-500/10 to-green-500/5 border-green-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Tuned Thresholds
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4 text-center text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Edge Min</p>
                  <p className="font-bold text-green-500">{latestResult.tuned_edge_min}+</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Hit Rate Min</p>
                  <p className="font-bold text-green-500">{(latestResult.tuned_hit_rate_min * 100).toFixed(0)}%+</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Minutes Floor</p>
                  <p className="font-bold text-green-500">{latestResult.tuned_minutes_floor}+</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Last Updated */}
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            <span>
              Last run: {new Date(latestResult.run_date).toLocaleString()}
            </span>
            <span>•</span>
            <span>{latestResult.slates_analyzed} slates analyzed</span>
          </div>
        </>
      )}
    </div>
  );
}
