import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate } from "@/lib/dateUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PropRow } from "./PropRow";
import { HeatLevel } from "./HeatBadge";
import { Flame, ArrowRight, RefreshCw, Loader2, Zap, AlertTriangle, CalendarDays } from "lucide-react";
import { Link } from "react-router-dom";
import { useRefreshPropMarketOdds } from "@/hooks/useLiveOdds";
import { useSharpMovementSync } from "@/hooks/useSharpMovementSync";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format, isToday, parseISO, differenceInHours } from "date-fns";
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
  sharp_alert?: boolean;
  sharp_alert_level?: string;
  sharp_movement_pts?: number;
  sharp_direction?: string;
  is_trap_indicator?: boolean;
  outcome?: string;
  actual_value?: number;
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
  const { sharpAlerts, isConnected, alertCount, hasSharpAlert } = useSharpMovementSync({ showToasts: true });

  // Get today's date in YYYY-MM-DD format for filtering
  const todayStr = useMemo(() => getEasternDate(), []);

  const { data: picks, isLoading } = useQuery({
    queryKey: ['risk-engine-picks-widget', todayStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nba_risk_engine_picks')
        .select('id, player_name, prop_type, line, side, confidence_score, player_role, game_script, game_date, current_line, over_price, under_price, bookmaker, odds_updated_at, sharp_alert, sharp_alert_level, sharp_movement_pts, sharp_direction, is_trap_indicator, outcome, actual_value')
        .gte('confidence_score', 7.5)
        .gte('game_date', todayStr) // Only show today's or future picks
        .or('outcome.is.null,outcome.eq.pending') // Only pending/unsettled
        .order('game_date', { ascending: true })
        .order('confidence_score', { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data as RiskEnginePick[];
    },
    refetchInterval: 30000, // Refetch every 30 seconds for outcome updates
  });

  // Check if data is stale (showing yesterday's props)
  const { isStale, propsDate, formattedDate } = useMemo(() => {
    if (!picks?.length) return { isStale: false, propsDate: null, formattedDate: null };
    
    const firstPickDate = picks[0].game_date;
    const parsedDate = parseISO(firstPickDate);
    const stale = !isToday(parsedDate);
    
    return {
      isStale: stale,
      propsDate: parsedDate,
      formattedDate: format(parsedDate, 'EEEE, MMMM d')
    };
  }, [picks]);

  // Real-time subscription for pick updates
  useEffect(() => {
    const channel = supabase
      .channel('prop-heat-map-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'nba_risk_engine_picks'
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['risk-engine-picks-widget'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

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
            {/* Live indicator */}
            {isConnected && (
              <div className="flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span className="text-xs text-muted-foreground">LIVE</span>
              </div>
            )}
            {/* Sharp alert count */}
            {alertCount > 0 && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30">
                <Zap className="w-3 h-3 text-red-400" />
                <span className="text-xs font-medium text-red-400">{alertCount}</span>
              </div>
            )}
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
        {/* Date indicator and last refresh */}
        <div className="flex items-center justify-between mt-2">
          {picks?.length > 0 && formattedDate && (
            <div className="flex items-center gap-2">
              <CalendarDays className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Props for: <span className="font-medium text-foreground">{formattedDate}</span>
              </span>
              {isStale && (
                <Badge variant="destructive" className="text-[10px] h-5 gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Stale
                </Badge>
              )}
            </div>
          )}
          {lastRefresh && (
            <span className="text-[10px] text-muted-foreground">
              Updated: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
        </div>
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
            
            // Check for sharp alert from pick data or hook
            const hookAlert = hasSharpAlert(pick.player_name, pick.prop_type);
            const sharpAlertData = pick.sharp_alert ? {
              level: pick.sharp_alert_level || 'warning',
              movementPts: pick.sharp_movement_pts || 0,
              direction: pick.sharp_direction || 'unknown',
              isTrap: pick.is_trap_indicator || false
            } : hookAlert ? {
              level: hookAlert.alertLevel || 'warning',
              movementPts: hookAlert.movementPts || 0,
              direction: hookAlert.direction || 'unknown',
              isTrap: hookAlert.isTrap || false
            } : undefined;
            
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
                sharpAlert={sharpAlertData}
                outcome={pick.outcome as 'pending' | 'hit' | 'miss' | 'push' | undefined}
                actualValue={pick.actual_value}
              />
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
