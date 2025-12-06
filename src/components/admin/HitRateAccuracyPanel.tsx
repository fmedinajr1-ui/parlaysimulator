import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, TrendingUp, TrendingDown, AlertTriangle, RefreshCw, Loader2, CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface AccuracyStat {
  strategy_type: string;
  sport: string;
  total_parlays: number;
  total_won: number;
  total_lost: number;
  win_rate: number;
  predicted_vs_actual: number;
  calibration_needed: string;
}

interface PropAccuracy {
  prop_type: string;
  total_legs: number;
  won_legs: number;
  lost_legs: number;
  leg_win_rate: number;
  avg_hit_rate: number;
}

export function HitRateAccuracyPanel() {
  const [isVerifying, setIsVerifying] = useState(false);
  const { toast } = useToast();

  const { data: strategyStats, isLoading: loadingStrategy, refetch: refetchStrategy } = useQuery({
    queryKey: ['hitrate-accuracy-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_hitrate_accuracy_stats');
      if (error) throw error;
      return data as AccuracyStat[];
    }
  });

  const { data: propStats, isLoading: loadingProps, refetch: refetchProps } = useQuery({
    queryKey: ['hitrate-prop-accuracy'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_hitrate_prop_accuracy');
      if (error) throw error;
      return data as PropAccuracy[];
    }
  });

  const { data: pendingCount } = useQuery({
    queryKey: ['hitrate-pending-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('hitrate_parlays')
        .select('*', { count: 'exact', head: true })
        .eq('outcome', 'pending');
      if (error) throw error;
      return count || 0;
    }
  });

  const handleVerifyOutcomes = async () => {
    setIsVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-hitrate-outcomes');
      
      if (error) throw error;
      
      toast({
        title: "Verification complete",
        description: `Verified ${data.verified} parlays (${data.won} won, ${data.lost} lost)`,
      });
      
      refetchStrategy();
      refetchProps();
    } catch (err) {
      toast({
        title: "Verification failed",
        description: err instanceof Error ? err.message : "Failed to verify outcomes",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const getCalibrationBadge = (calibration: string) => {
    switch (calibration) {
      case 'calibrated':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Calibrated</Badge>;
      case 'overconfident':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Overconfident</Badge>;
      case 'underconfident':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Underconfident</Badge>;
      default:
        return <Badge variant="outline">Insufficient Data</Badge>;
    }
  };

  const getWinRateColor = (rate: number) => {
    if (rate >= 55) return 'text-green-400';
    if (rate >= 45) return 'text-yellow-400';
    return 'text-red-400';
  };

  if (loadingStrategy || loadingProps) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Hit Rate Accuracy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Hit Rate Accuracy
          <Badge variant="outline" className="ml-auto">
            {pendingCount} pending
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={handleVerifyOutcomes}
            disabled={isVerifying}
          >
            {isVerifying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1">Verify</span>
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Strategy Performance */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">By Strategy</h4>
          {!strategyStats || strategyStats.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-sm">
              No verified parlays yet. Run verification after games complete.
            </div>
          ) : (
            <div className="space-y-2">
              {strategyStats.map((stat, idx) => (
                <div 
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/30"
                >
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="font-medium text-sm">
                        {stat.strategy_type.replace('_', ' ').toUpperCase()}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {stat.sport || 'All Sports'} • {stat.total_parlays} parlays
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className={`font-bold ${getWinRateColor(stat.win_rate)}`}>
                        {stat.win_rate}%
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {stat.total_won}W - {stat.total_lost}L
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {stat.predicted_vs_actual > 5 ? (
                        <TrendingDown className="h-4 w-4 text-red-400" />
                      ) : stat.predicted_vs_actual < -5 ? (
                        <TrendingUp className="h-4 w-4 text-green-400" />
                      ) : (
                        <Target className="h-4 w-4 text-yellow-400" />
                      )}
                      {getCalibrationBadge(stat.calibration_needed)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Prop Type Performance */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">By Prop Type</h4>
          {!propStats || propStats.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground text-sm">
              No prop type data available yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {propStats.slice(0, 8).map((prop, idx) => (
                <div 
                  key={idx}
                  className="p-2 rounded-lg bg-background/50 border border-border/30"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium truncate">
                      {prop.prop_type?.replace(/_/g, ' ') || 'Unknown'}
                    </span>
                    <span className={`text-xs font-bold ${getWinRateColor(prop.leg_win_rate)}`}>
                      {prop.leg_win_rate}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle className="h-3 w-3 text-green-400" />
                      {prop.won_legs}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <XCircle className="h-3 w-3 text-red-400" />
                      {prop.lost_legs}
                    </div>
                    <span className="text-xs text-muted-foreground ml-auto">
                      Avg: {prop.avg_hit_rate}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Calibration Insights */}
        {strategyStats && strategyStats.some(s => s.calibration_needed !== 'insufficient_data') && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <div className="flex items-center gap-2 text-amber-400 text-sm font-medium mb-1">
              <AlertTriangle className="h-4 w-4" />
              Calibration Insights
            </div>
            <p className="text-xs text-muted-foreground">
              {strategyStats.find(s => s.calibration_needed === 'overconfident') 
                ? "Some strategies are overconfident - predicted win rates exceed actual performance."
                : strategyStats.find(s => s.calibration_needed === 'underconfident')
                ? "Some strategies are underconfident - actual performance exceeds predictions."
                : "Strategies are well calibrated within ±10% of predicted probabilities."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}