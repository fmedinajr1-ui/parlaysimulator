import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropRow } from "@/components/market/PropRow";
import { HeatLevel } from "@/components/market/HeatBadge";
import { Flame, ArrowLeft, RefreshCw, Loader2, Zap, Trophy } from "lucide-react";
import { Link } from "react-router-dom";
import { useRefreshPropMarketOdds } from "@/hooks/useLiveOdds";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { HeatParlayCard } from "@/components/heat/HeatParlayCard";
import { WatchlistSection } from "@/components/heat/WatchlistSection";
import { DoNotBetSection } from "@/components/heat/DoNotBetSection";
import { SweetSpotPicksCard } from "@/components/market/SweetSpotPicksCard";
import { SweetSpotDreamTeamParlay } from "@/components/market/SweetSpotDreamTeamParlay";
import { LineMismatchDashboard } from "@/components/market/LineMismatchDashboard";
import { useHeatPropEngine, useHeatEngineScan, useHeatWatchlist, useHeatDoNotBet } from "@/hooks/useHeatPropEngine";
import { useHeatPropRealtime } from "@/hooks/useHeatPropRealtime";

type HeatFilter = 'ALL' | HeatLevel;

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

function calculateHeatLevel(engineScore: number): { heat: number; level: HeatLevel } {
  const engineHeat = (engineScore / 10) * 100;
  if (engineHeat >= 85) return { heat: Math.round(engineHeat), level: 'RED' };
  if (engineHeat >= 75) return { heat: Math.round(engineHeat), level: 'ORANGE' };
  if (engineHeat >= 65) return { heat: Math.round(engineHeat), level: 'YELLOW' };
  return { heat: Math.round(engineHeat), level: 'GREEN' };
}

const HEAT_FILTER_STYLES: Record<HeatFilter, string> = {
  'ALL': 'bg-muted hover:bg-muted/80',
  'RED': 'bg-red-500/20 hover:bg-red-500/30 text-red-400',
  'ORANGE': 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-400',
  'YELLOW': 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400',
  'GREEN': 'bg-green-500/20 hover:bg-green-500/30 text-green-400',
};

export default function PropMarket() {
  const [heatFilter, setHeatFilter] = useState<HeatFilter>('ALL');
  const queryClient = useQueryClient();
  const { refreshAll, isRefreshing, lastRefresh } = useRefreshPropMarketOdds();
  
  // Heat Prop Engine data - parlays from edge function
  const { data: heatData, isLoading: heatLoading } = useHeatPropEngine();
  const { mutate: runHeatScan, isPending: isHeatScanning } = useHeatEngineScan();
  
  // Direct database queries for real-time updates
  const { data: watchlistItems } = useHeatWatchlist();
  const { data: doNotBetItems } = useHeatDoNotBet();
  
  // Enable real-time subscriptions
  useHeatPropRealtime();

  const { data: picks, isLoading, error } = useQuery({
    queryKey: ['prop-market-all-picks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('nba_risk_engine_picks')
        .select('id, player_name, prop_type, line, side, confidence_score, player_role, game_script, game_date, current_line, over_price, under_price, bookmaker, odds_updated_at')
        .gte('confidence_score', 6.0)
        .order('game_date', { ascending: false })
        .order('confidence_score', { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data as RiskEnginePick[];
    },
    refetchInterval: 60000,
  });

  const handleRefreshOdds = async () => {
    const result = await refreshAll();
    if (result.success) {
      toast.success('Scanning live odds from FanDuel & DraftKings...');
      queryClient.invalidateQueries({ queryKey: ['prop-market-all-picks'] });
    } else {
      toast.error(result.error || 'Failed to refresh odds');
    }
  };

  const handleRunHeatEngine = () => {
    runHeatScan(undefined);
  };

  // Process and filter picks
  const processedPicks = picks?.map(pick => {
    const { heat, level } = calculateHeatLevel(pick.confidence_score);
    return { ...pick, heat, level };
  }) || [];

  const filteredPicks = heatFilter === 'ALL' 
    ? processedPicks 
    : processedPicks.filter(p => p.level === heatFilter);

  // Count by heat level
  const heatCounts = processedPicks.reduce((acc, pick) => {
    acc[pick.level] = (acc[pick.level] || 0) + 1;
    return acc;
  }, {} as Record<HeatLevel, number>);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Flame className="w-6 h-6 text-orange-500" />
              <h1 className="text-2xl font-bold">Prop Market Engine</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Button 
              onClick={handleRunHeatEngine}
              disabled={isHeatScanning}
              variant="outline"
              className="gap-2"
            >
              {isHeatScanning ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Flame className="w-4 h-4 text-orange-500" />
              )}
              Build Parlays
            </Button>
            <Button 
              onClick={handleRefreshOdds}
              disabled={isRefreshing}
              className="gap-2"
            >
              {isRefreshing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              Scan Live Odds
            </Button>
            <Link to="/prop-results">
              <Button variant="ghost" className="gap-2">
                <Trophy className="w-4 h-4 text-primary" />
                Results
              </Button>
            </Link>
          </div>
        </div>

        {/* Refresh Status */}
        {lastRefresh && (
          <p className="text-sm text-muted-foreground mb-4">
            Last scan: {lastRefresh.toLocaleTimeString()} • Pulling from FanDuel & DraftKings
          </p>
        )}

        {/* Heat Engine Parlays - CORE & UPSIDE */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <HeatParlayCard 
            parlay={heatData?.core_parlay || null} 
            type="CORE" 
          />
          <HeatParlayCard 
            parlay={heatData?.upside_parlay || null} 
            type="UPSIDE" 
          />
        </div>

        {/* Sweet Spot Dream Team Parlay - Auto-built optimal 6-leg */}
        <div className="mb-6">
          <SweetSpotDreamTeamParlay />
        </div>

        {/* Sweet Spot Picks - Optimal confidence ranges */}
        <div className="mb-6">
          <SweetSpotPicksCard />
        </div>

        {/* Line Mismatch Audit Dashboard */}
        <div className="mb-6">
          <LineMismatchDashboard />
        </div>

        {/* Watchlist & Do Not Bet - Real-time from database */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <WatchlistSection items={watchlistItems || []} />
          <DoNotBetSection items={doNotBetItems || []} />
        </div>

        {/* Heat Filters */}
        <div className="flex flex-wrap gap-2 mb-6">
          {(['ALL', 'RED', 'ORANGE', 'YELLOW', 'GREEN'] as HeatFilter[]).map((filter) => (
            <Button
              key={filter}
              variant="ghost"
              size="sm"
              onClick={() => setHeatFilter(filter)}
              className={cn(
                "transition-all",
                HEAT_FILTER_STYLES[filter],
                heatFilter === filter && "ring-2 ring-primary ring-offset-2 ring-offset-background"
              )}
            >
              {filter === 'ALL' ? 'All Props' : filter}
              {filter !== 'ALL' && heatCounts[filter] ? ` (${heatCounts[filter]})` : ''}
              {filter === 'ALL' && ` (${processedPicks.length})`}
            </Button>
          ))}
        </div>

        {/* Props List */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
              {heatFilter === 'ALL' ? 'All Props' : `${heatFilter} Heat Props`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-center py-12 text-destructive">
                <p>Error loading props</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => queryClient.invalidateQueries({ queryKey: ['prop-market-all-picks'] })}>
                  Retry
                </Button>
              </div>
            ) : filteredPicks.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <p>No props found for this filter</p>
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
              filteredPicks.map((pick) => (
                <PropRow
                  key={pick.id}
                  playerName={pick.player_name}
                  propType={pick.prop_type}
                  line={pick.current_line || pick.line}
                  side={pick.side as 'over' | 'under'}
                  engineScore={pick.confidence_score}
                  marketScore={50}
                  heatScore={pick.heat}
                  heatLevel={pick.level}
                  playerRole={pick.player_role}
                  gameScript={pick.game_script}
                  hoursToTip={2}
                  overPrice={pick.over_price}
                  underPrice={pick.under_price}
                  bookmaker={pick.bookmaker}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
