import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  TrendingUp, 
  TrendingDown, 
  ThumbsUp, 
  ThumbsDown, 
  Zap,
  Target,
  Loader2,
  BarChart3
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StrategyStats {
  strategy_type: string;
  total_followed: number;
  total_won: number;
  total_lost: number;
  total_pending: number;
  win_rate: number;
  total_staked: number;
  total_profit: number;
  avg_odds: number;
  roi_percentage: number;
}

const strategyConfig: Record<string, { 
  label: string; 
  icon: React.ComponentType<{ className?: string }>; 
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
}> = {
  verified_sharp: {
    label: "Verified Sharp",
    icon: ThumbsUp,
    color: "text-neon-green",
    bgColor: "bg-neon-green/10",
    borderColor: "border-neon-green/30",
    description: "High-confidence real sharp money"
  },
  fade: {
    label: "Fade Parlays",
    icon: ThumbsDown,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
    borderColor: "border-destructive/30",
    description: "Betting against fake sharp movements"
  },
  sharp_props: {
    label: "Sharp Props",
    icon: Zap,
    color: "text-neon-orange",
    bgColor: "bg-neon-orange/10",
    borderColor: "border-neon-orange/30",
    description: "General sharp money plays"
  },
  other: {
    label: "Other Strategies",
    icon: Target,
    color: "text-primary",
    bgColor: "bg-primary/10",
    borderColor: "border-primary/30",
    description: "Various AI-generated parlays"
  }
};

export const StrategyPerformanceCard = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState<StrategyStats[]>([]);
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
        .rpc('get_strategy_performance_stats', { p_user_id: user.id });

      if (error) throw error;
      setStats(data || []);
    } catch (error) {
      console.error('Error fetching strategy performance:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-border/50 animate-pulse">
        <CardContent className="p-6">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (stats.length === 0) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            STRATEGY PERFORMANCE
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <p className="text-muted-foreground text-sm">
              No strategy data yet. Follow AI suggestions to start tracking performance by strategy type.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Find specific strategies
  const fadeStats = stats.find(s => s.strategy_type === 'fade');
  const verifiedSharpStats = stats.find(s => s.strategy_type === 'verified_sharp');

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-display flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          STRATEGY PERFORMANCE COMPARISON
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Head-to-Head Comparison */}
        {(fadeStats || verifiedSharpStats) && (
          <div className="grid grid-cols-2 gap-3">
            {/* Verified Sharp */}
            <div className={cn(
              "rounded-lg p-3 border",
              verifiedSharpStats ? "bg-neon-green/5 border-neon-green/20" : "bg-muted/30 border-border/50"
            )}>
              <div className="flex items-center gap-2 mb-2">
                <ThumbsUp className="w-4 h-4 text-neon-green" />
                <span className="text-xs font-medium">Verified Sharp</span>
              </div>
              {verifiedSharpStats ? (
                <>
                  <p className={cn(
                    "text-2xl font-bold",
                    verifiedSharpStats.win_rate >= 50 ? "text-neon-green" : "text-destructive"
                  )}>
                    {verifiedSharpStats.win_rate}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {verifiedSharpStats.total_won}W - {verifiedSharpStats.total_lost}L
                  </p>
                  <div className={cn(
                    "text-xs mt-1 flex items-center gap-1",
                    verifiedSharpStats.total_profit >= 0 ? "text-neon-green" : "text-destructive"
                  )}>
                    {verifiedSharpStats.total_profit >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    ${Math.abs(verifiedSharpStats.total_profit).toFixed(2)}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No data yet</p>
              )}
            </div>

            {/* Fade Parlays */}
            <div className={cn(
              "rounded-lg p-3 border",
              fadeStats ? "bg-destructive/5 border-destructive/20" : "bg-muted/30 border-border/50"
            )}>
              <div className="flex items-center gap-2 mb-2">
                <ThumbsDown className="w-4 h-4 text-destructive" />
                <span className="text-xs font-medium">Fade Parlays</span>
              </div>
              {fadeStats ? (
                <>
                  <p className={cn(
                    "text-2xl font-bold",
                    fadeStats.win_rate >= 50 ? "text-neon-green" : "text-destructive"
                  )}>
                    {fadeStats.win_rate}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fadeStats.total_won}W - {fadeStats.total_lost}L
                  </p>
                  <div className={cn(
                    "text-xs mt-1 flex items-center gap-1",
                    fadeStats.total_profit >= 0 ? "text-neon-green" : "text-destructive"
                  )}>
                    {fadeStats.total_profit >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    ${Math.abs(fadeStats.total_profit).toFixed(2)}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No data yet</p>
              )}
            </div>
          </div>
        )}

        {/* All Strategies Breakdown */}
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground font-medium">ALL STRATEGIES</p>
          {stats.map((strategy) => {
            const config = strategyConfig[strategy.strategy_type] || strategyConfig.other;
            const Icon = config.icon;
            const isProfit = strategy.total_profit >= 0;

            return (
              <div 
                key={strategy.strategy_type}
                className={cn(
                  "rounded-lg p-3 border",
                  config.bgColor,
                  config.borderColor
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("w-4 h-4", config.color)} />
                    <span className="text-sm font-medium">{config.label}</span>
                    <Badge variant="secondary" className="text-xs">
                      {strategy.total_followed} followed
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge 
                      variant={strategy.win_rate >= 50 ? "default" : "destructive"}
                      className="text-xs"
                    >
                      {strategy.win_rate}% Win
                    </Badge>
                    <Badge 
                      variant="outline" 
                      className={cn(
                        "text-xs",
                        isProfit ? "text-neon-green border-neon-green/30" : "text-destructive border-destructive/30"
                      )}
                    >
                      {isProfit ? '+' : ''}{strategy.roi_percentage}% ROI
                    </Badge>
                  </div>
                </div>

                {/* Win Rate Progress */}
                <div className="mb-2">
                  <Progress 
                    value={strategy.win_rate} 
                    className="h-2"
                  />
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="text-center">
                    <p className="text-neon-green font-bold">{strategy.total_won}</p>
                    <p className="text-muted-foreground">Won</p>
                  </div>
                  <div className="text-center">
                    <p className="text-destructive font-bold">{strategy.total_lost}</p>
                    <p className="text-muted-foreground">Lost</p>
                  </div>
                  <div className="text-center">
                    <p className="text-neon-yellow font-bold">{strategy.total_pending}</p>
                    <p className="text-muted-foreground">Pending</p>
                  </div>
                  <div className="text-center">
                    <p className={cn(
                      "font-bold flex items-center justify-center gap-0.5",
                      isProfit ? "text-neon-green" : "text-destructive"
                    )}>
                      {isProfit ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      ${Math.abs(strategy.total_profit).toFixed(0)}
                    </p>
                    <p className="text-muted-foreground">P/L</p>
                  </div>
                </div>

                {/* Average Odds */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
                  <span className="text-xs text-muted-foreground">Avg Odds</span>
                  <span className="text-xs font-medium">
                    {strategy.avg_odds > 0 ? '+' : ''}{strategy.avg_odds}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary Insight */}
        {fadeStats && verifiedSharpStats && (
          <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
            <p className="text-xs text-muted-foreground mb-1">Strategy Insight</p>
            <p className="text-sm">
              {verifiedSharpStats.win_rate > fadeStats.win_rate ? (
                <>
                  <span className="text-neon-green font-medium">Verified Sharp</span> is outperforming Fade by{" "}
                  <span className="font-bold">{(verifiedSharpStats.win_rate - fadeStats.win_rate).toFixed(1)}%</span>
                </>
              ) : fadeStats.win_rate > verifiedSharpStats.win_rate ? (
                <>
                  <span className="text-destructive font-medium">Fade Parlays</span> are outperforming Verified Sharp by{" "}
                  <span className="font-bold">{(fadeStats.win_rate - verifiedSharpStats.win_rate).toFixed(1)}%</span>
                </>
              ) : (
                <>Both strategies are performing equally at <span className="font-bold">{fadeStats.win_rate}%</span></>
              )}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};