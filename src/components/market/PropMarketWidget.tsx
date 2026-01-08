import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PropRow } from "./PropRow";
import { HeatLevel } from "./HeatBadge";
import { Flame, ArrowRight, RefreshCw, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useRefreshPropMarketOdds } from "@/hooks/useLiveOdds";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface RiskEnginePick {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  confidence_score: number;
  player_role: string;
  game_script: string;
  game_date: string;
  current_line?: number;
  over_price?: number;
  under_price?: number;
  bookmaker?: string;
  odds_updated_at?: string;
}

function calculateHeatLevel(engineScore: number, marketScore: number | null): { heat: number; level: HeatLevel } {
  // If no market score, use engine-only mode with adjusted thresholds
  if (marketScore === null || marketScore === undefined) {
    const engineHeat = (engineScore / 10) * 100;
    if (engineHeat >= 85) return { heat: Math.round(engineHeat), level: 'RED' };
    if (engineHeat >= 75) return { heat: Math.round(engineHeat), level: 'ORANGE' };
    if (engineHeat >= 65) return { heat: Math.round(engineHeat), level: 'YELLOW' };
    return { heat: Math.round(engineHeat), level: 'GREEN' };
  }
  
  // Combined engine + market score
  const engineWeight = 0.6;
  const marketWeight = 0.4;
  const heat = (engineScore / 10) * 100 * engineWeight + marketScore * marketWeight;
  
  if (heat >= 80) return { heat: Math.round(heat), level: 'RED' };
  if (heat >= 65) return { heat: Math.round(heat), level: 'ORANGE' };
  if (heat >= 50) return { heat: Math.round(heat), level: 'YELLOW' };
  return { heat: Math.round(heat), level: 'GREEN' };
}

export function PropMarketWidget() {
  const queryClient = useQueryClient();
  const { refreshAll, isRefreshing, lastRefresh } = useRefreshPropMarketOdds();

  const { data: picks, isLoading } = useQuery({
    queryKey: ['risk-engine-picks-widget'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nba_risk_engine_picks')
        .select('id, player_name, prop_type, line, side, confidence_score, player_role, game_script, game_date, current_line, over_price, under_price, bookmaker, odds_updated_at')
        .gte('confidence_score', 7.5)
        .order('game_date', { ascending: false })
        .order('confidence_score', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data as RiskEnginePick[];
    },
    refetchInterval: 60000, // Refetch every minute
  });

  const handleRefreshOdds = async () => {
    const result = await refreshAll();
    if (result.success) {
      toast.success('Odds refreshed from FanDuel & DraftKings');
      queryClient.invalidateQueries({ queryKey: ['risk-engine-picks-widget'] });
    } else {
      toast.error(result.error || 'Failed to refresh odds');
    }
  };

  const topPicks = picks?.slice(0, 5) || [];

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-orange-500" />
            <CardTitle className="text-lg">Prop Heat Map</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleRefreshOdds}
              disabled={isRefreshing}
              className="h-8 px-2"
            >
              {isRefreshing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span className="ml-1 text-xs">Live Odds</span>
            </Button>
            <Link to="/prop-market">
              <Button variant="ghost" size="sm" className="h-8">
                View All <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
        {lastRefresh && (
          <p className="text-xs text-muted-foreground mt-1">
            Last refresh: {lastRefresh.toLocaleTimeString()}
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : topPicks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No hot props right now</p>
            <Button 
              variant="outline" 
              size="sm" 
              className="mt-2"
              onClick={handleRefreshOdds}
              disabled={isRefreshing}
            >
              Scan Today's Games
            </Button>
          </div>
        ) : (
          topPicks.map((pick) => {
            const { heat, level } = calculateHeatLevel(pick.confidence_score, null);
            const hoursToTip = 2; // Placeholder - would come from game time
            
            return (
              <PropRow
                key={pick.id}
                playerName={pick.player_name}
                propType={pick.prop_type}
                line={pick.current_line || pick.line}
                side={pick.side as 'over' | 'under'}
                engineScore={pick.confidence_score}
                marketScore={50}
                heatScore={heat}
                heatLevel={level}
                playerRole={pick.player_role}
                gameScript={pick.game_script}
                hoursToTip={hoursToTip}
                overPrice={pick.over_price}
                underPrice={pick.under_price}
                bookmaker={pick.bookmaker}
              />
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
