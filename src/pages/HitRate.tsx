import { AppShell } from "@/components/layout/AppShell";
import { HitRatePicks } from "@/components/suggestions/HitRatePicks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Target, TrendingUp, Flame, Percent, Trophy } from "lucide-react";
import { Helmet } from "react-helmet";

export default function HitRate() {
  // Fetch accuracy metrics
  const { data: accuracyMetrics } = useQuery({
    queryKey: ['hitrate-accuracy-metrics'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('hitrate_accuracy_metrics')
        .select('*')
        .order('win_rate', { ascending: false });
      
      if (error) throw error;
      return data || [];
    }
  });

  // Calculate overall stats
  const overallStats = accuracyMetrics?.reduce((acc, m) => {
    acc.totalParlays += m.total_parlays || 0;
    acc.totalWon += m.total_won || 0;
    acc.totalLost += m.total_lost || 0;
    return acc;
  }, { totalParlays: 0, totalWon: 0, totalLost: 0 }) || { totalParlays: 0, totalWon: 0, totalLost: 0 };

  const overallWinRate = overallStats.totalParlays > 0 
    ? ((overallStats.totalWon / overallStats.totalParlays) * 100).toFixed(1) 
    : '0';

  return (
    <AppShell>
      <Helmet>
        <title>Hit Rate Analysis | Sharp vs Vegas</title>
        <meta name="description" content="Track player prop hit rates with X/5 streak patterns. Find 5/5 perfect streaks and high-confidence betting opportunities." />
      </Helmet>
      
      <div className="container mx-auto px-4 py-6 pb-32 space-y-6">
        {/* Hero Header */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-neon-green/20 via-background to-neon-purple/10 border border-neon-green/20 p-6">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-neon-green/10 via-transparent to-transparent" />
          
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 rounded-xl bg-neon-green/20 border border-neon-green/30">
                <Target className="h-6 w-6 text-neon-green" />
              </div>
              <div>
                <h1 className="text-2xl font-bold font-display">Hit Rate Analysis</h1>
                <p className="text-sm text-muted-foreground">Track X/5 streak patterns & find consistent performers</p>
              </div>
            </div>
            
            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-3 mt-4">
              <div className="bg-background/60 backdrop-blur-sm rounded-xl p-3 border border-border/50">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Flame className="h-4 w-4 text-neon-green" />
                  <span className="text-xs">Win Rate</span>
                </div>
                <p className="text-xl font-bold text-neon-green">{overallWinRate}%</p>
              </div>
              
              <div className="bg-background/60 backdrop-blur-sm rounded-xl p-3 border border-border/50">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <Trophy className="h-4 w-4 text-neon-yellow" />
                  <span className="text-xs">Won</span>
                </div>
                <p className="text-xl font-bold">{overallStats.totalWon}</p>
              </div>
              
              <div className="bg-background/60 backdrop-blur-sm rounded-xl p-3 border border-border/50">
                <div className="flex items-center gap-2 text-muted-foreground mb-1">
                  <TrendingUp className="h-4 w-4 text-neon-purple" />
                  <span className="text-xs">Total</span>
                </div>
                <p className="text-xl font-bold">{overallStats.totalParlays}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Accuracy by Strategy */}
        {accuracyMetrics && accuracyMetrics.length > 0 && (
          <Card className="bg-card/60 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Percent className="h-4 w-4 text-primary" />
                Accuracy by Strategy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {accuracyMetrics.slice(0, 5).map((metric, idx) => (
                  <div 
                    key={metric.id || idx}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className="text-xs">
                        {metric.strategy_type}
                      </Badge>
                      {metric.sport && (
                        <span className="text-xs text-muted-foreground">{metric.sport}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm font-medium">
                          {metric.total_won}/{metric.total_parlays}
                        </p>
                        <p className="text-xs text-muted-foreground">W/L</p>
                      </div>
                      <Badge 
                        className={
                          metric.win_rate >= 60 
                            ? 'bg-neon-green/20 text-neon-green border-neon-green/30' 
                            : metric.win_rate >= 50 
                              ? 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30'
                              : 'bg-red-500/20 text-red-400 border-red-500/30'
                        }
                      >
                        {metric.win_rate?.toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Hit Rate Picks Component */}
        <HitRatePicks />
      </div>
    </AppShell>
  );
}
