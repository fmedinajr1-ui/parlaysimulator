import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { FeedCard } from "@/components/FeedCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatsCard, StatItem, StatsGrid } from "@/components/ui/stats-card";
import { SkeletonList } from "@/components/ui/skeleton-card";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullToRefreshContainer } from "@/components/ui/pull-to-refresh";
import { 
  Battery, BatteryLow, BatteryWarning, BatteryFull, 
  RefreshCw, TrendingUp, TrendingDown, Plane, Clock, Mountain,
  Target, Zap, ChevronRight, Trophy, AlertTriangle, Flame
} from "lucide-react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { FatigueMeter } from "@/components/fatigue/FatigueMeter";
import { FatigueEdgeROI } from "@/components/fatigue/FatigueEdgeROI";
import { toast } from "sonner";
import { getPredictionData, isSweetSpot, isHighRisk, getConfidenceBgColor } from "@/lib/fatigue-predictions";

interface FatigueScore {
  id: string;
  event_id: string;
  team_name: string;
  opponent: string;
  fatigue_score: number;
  fatigue_category: string;
  is_home: boolean;
  is_back_to_back: boolean;
  is_road_back_to_back: boolean;
  travel_miles: number;
  timezone_changes: number;
  is_altitude_game: boolean;
  is_three_in_four: boolean;
  is_four_in_six: boolean;
  is_early_start: boolean;
  ml_adjustment_pct: number;
  spread_adjustment: number;
  points_adjustment_pct: number;
  rebounds_adjustment_pct: number;
  assists_adjustment_pct: number;
  three_pt_adjustment_pct: number;
  blocks_adjustment_pct: number;
  recommended_angle: string | null;
  betting_edge_summary: string | null;
  game_date: string;
  game_time: string;
}

interface GameWithFatigue {
  event_id: string;
  home_team: FatigueScore;
  away_team: FatigueScore;
  fatigueDiff: number;
  edgeTeam: 'home' | 'away' | 'none';
}

const categoryColors: Record<string, string> = {
  'Fresh': 'bg-neon-green/20 text-neon-green border-neon-green/30',
  'Normal': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'Tired': 'bg-neon-yellow/20 text-neon-yellow border-neon-yellow/30',
  'Exhausted': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  'Red Alert': 'bg-neon-red/20 text-neon-red border-neon-red/30',
};

const categoryIcons: Record<string, React.ReactNode> = {
  'Fresh': <BatteryFull className="w-4 h-4" />,
  'Normal': <Battery className="w-4 h-4" />,
  'Tired': <BatteryLow className="w-4 h-4" />,
  'Exhausted': <BatteryWarning className="w-4 h-4" />,
  'Red Alert': <BatteryWarning className="w-4 h-4" />,
};

export default function NBAFatigue() {
  const [games, setGames] = useState<GameWithFatigue[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const fetchFatigueData = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('nba_fatigue_scores')
        .select('*')
        .eq('game_date', today)
        .order('game_time', { ascending: true });

      if (error) throw error;

      // Group by event_id
      const gameMap = new Map<string, FatigueScore[]>();
      (data || []).forEach((score: FatigueScore) => {
        const existing = gameMap.get(score.event_id) || [];
        existing.push(score);
        gameMap.set(score.event_id, existing);
      });

      // Build game pairs
      const gamesList: GameWithFatigue[] = [];
      gameMap.forEach((scores, event_id) => {
        if (scores.length >= 2) {
          const homeTeam = scores.find(s => s.is_home) || scores[0];
          const awayTeam = scores.find(s => !s.is_home) || scores[1];
          const fatigueDiff = Math.abs(homeTeam.fatigue_score - awayTeam.fatigue_score);
          
          let edgeTeam: 'home' | 'away' | 'none' = 'none';
          if (fatigueDiff >= 15) {
            edgeTeam = homeTeam.fatigue_score < awayTeam.fatigue_score ? 'home' : 'away';
          }

          gamesList.push({
            event_id,
            home_team: homeTeam,
            away_team: awayTeam,
            fatigueDiff,
            edgeTeam,
          });
        }
      });

      // Sort by game time
      gamesList.sort((a, b) => 
        new Date(a.home_team.game_time).getTime() - new Date(b.home_team.game_time).getTime()
      );

      setGames(gamesList);
    } catch (error) {
      console.error('Error fetching fatigue data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFatigueData();
  }, [fetchFatigueData]);

  const calculateFatigue = async () => {
    setCalculating(true);
    try {
      const { data, error } = await supabase.functions.invoke('daily-fatigue-calculator', {
        body: {}
      });
      
      if (error) throw error;
      
      const gamesProcessed = data?.gamesProcessed || 0;
      if (gamesProcessed > 0) {
        toast.success(`Calculated fatigue for ${gamesProcessed} games`);
      } else {
        toast.info('No NBA games scheduled for today');
      }
      
      await fetchFatigueData();
    } catch (error) {
      console.error('Error calculating fatigue:', error);
      toast.error('Failed to calculate fatigue scores');
    } finally {
      setCalculating(false);
    }
  };

  const seedHistoricalData = async () => {
    setSeeding(true);
    try {
      toast.info('Seeding historical data... This may take a minute.');
      const { data, error } = await supabase.functions.invoke('seed-historical-fatigue', {
        body: {}
      });
      
      if (error) throw error;
      
      if (data?.success) {
        toast.success(
          `Seeded ${data.gamesProcessed} games! Found ${data.edgesFound} edges (${data.edgeStats?.winRate}% win rate, ${data.edgeStats?.roi}% ROI)`
        );
      } else {
        toast.error('Failed to seed historical data');
      }
    } catch (error) {
      console.error('Error seeding historical data:', error);
      toast.error('Failed to seed historical data');
    } finally {
      setSeeding(false);
    }
  };

  const { isRefreshing, pullProgress, containerRef, handlers } = usePullToRefresh({
    onRefresh: fetchFatigueData,
  });

  const stats = {
    totalGames: games.length,
    gamesWithEdge: games.filter(g => g.fatigueDiff >= 15).length,
    backToBackTeams: games.filter(g => g.home_team.is_back_to_back || g.away_team.is_back_to_back).length,
    redAlertTeams: games.filter(g => 
      g.home_team.fatigue_category === 'Red Alert' || g.away_team.fatigue_category === 'Red Alert'
    ).length,
  };

  const formatGameTime = (timeStr: string) => {
    try {
      return format(new Date(timeStr), 'h:mm a');
    } catch {
      return timeStr;
    }
  };

  return (
    <AppShell noPadding>
      <MobileHeader
        title="NBA Fatigue"
        subtitle="Schedule-based betting edges"
        icon={<Battery className="w-6 h-6 text-neon-cyan" />}
        rightAction={
          <Button
            variant="ghost"
            size="icon"
            onClick={fetchFatigueData}
            disabled={isRefreshing}
            className="h-9 w-9"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
        }
      />

      <PullToRefreshContainer
        containerRef={containerRef}
        handlers={handlers}
        pullProgress={pullProgress}
        isRefreshing={isRefreshing}
        className="flex-1 overflow-y-auto"
      >
        <div className="px-4 py-4 space-y-4">
          {/* Stats Overview */}
          <StatsCard variant="glass">
            <StatsGrid columns={4}>
              <StatItem label="Games" value={stats.totalGames} size="sm" />
              <StatItem label="Edges" value={stats.gamesWithEdge} size="sm" />
              <StatItem label="B2B" value={stats.backToBackTeams} size="sm" />
              <StatItem label="Red Alert" value={stats.redAlertTeams} size="sm" />
            </StatsGrid>
          </StatsCard>

          {/* ROI Tracker */}
          <FatigueEdgeROI />

          {/* Quick Legend */}
          <FeedCard delay={100}>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Fatigue Categories</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(categoryColors).map(([category, colors]) => (
                <Badge key={category} className={`${colors} text-xs`}>
                  {categoryIcons[category]}
                  <span className="ml-1">{category}</span>
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              15+ point differential = significant betting edge
            </p>
          </FeedCard>

          {/* Action Buttons */}
          <div className="flex gap-2">
            {games.length === 0 && !loading && (
              <Button 
                onClick={calculateFatigue} 
                disabled={calculating || seeding}
                className="flex-1"
              >
                {calculating ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Calculating...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Calculate Today's Fatigue
                  </>
                )}
              </Button>
            )}
            <Button 
              onClick={seedHistoricalData} 
              disabled={seeding || calculating}
              variant="outline"
              className={games.length === 0 && !loading ? "flex-1" : "w-full"}
            >
              {seeding ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Seeding Historical Data...
                </>
              ) : (
                <>
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Seed Historical Data
                </>
              )}
            </Button>
          </div>

          {/* Best Bets Section - 20-29 Sweet Spot */}
          {!loading && games.filter(g => isSweetSpot(g.fatigueDiff)).length > 0 && (
            <FeedCard delay={150}>
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-full bg-neon-green/20">
                  <Flame className="w-4 h-4 text-neon-green" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-neon-green">Best Bets Today</p>
                  <p className="text-[10px] text-muted-foreground">20-29 differential sweet spot • 55% win rate • +5.6% ROI</p>
                </div>
              </div>
              <div className="space-y-2">
                {games.filter(g => isSweetSpot(g.fatigueDiff)).map((game) => {
                  const edgeTeamData = game.edgeTeam === 'home' ? game.home_team : game.away_team;
                  const prediction = getPredictionData(game.fatigueDiff);
                  
                  return (
                    <div 
                      key={`best-${game.event_id}`}
                      className="p-3 rounded-lg bg-gradient-to-r from-neon-green/10 to-neon-cyan/10 border border-neon-green/30"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Trophy className="w-4 h-4 text-neon-green" />
                          <span className="text-sm font-medium text-foreground">
                            {game.away_team.team_name} @ {game.home_team.team_name}
                          </span>
                        </div>
                        <Badge className="bg-neon-green/20 text-neon-green border-neon-green/30 text-[10px]">
                          +{game.fatigueDiff} EDGE
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Lean:</span>
                          <span className="text-sm font-semibold text-neon-green">{edgeTeamData.team_name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] border-neon-green/50 text-neon-green">
                            {prediction?.winRate}% conf
                          </Badge>
                          <Badge variant="outline" className="text-[10px] border-neon-cyan/50 text-neon-cyan">
                            +{prediction?.roi}% ROI
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </FeedCard>
          )}

          {/* 30+ Warning Section */}
          {!loading && games.filter(g => isHighRisk(g.fatigueDiff)).length > 0 && (
            <FeedCard delay={175}>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <p className="text-xs text-amber-400">
                  <span className="font-medium">Caution:</span> Games with 30+ differential historically underperform (51.4% win rate, -1.9% ROI). Stick to 20-29 range.
                </p>
              </div>
            </FeedCard>
          )}

          {/* Games List */}
          {loading ? (
            <SkeletonList count={4} variant="bet" />
          ) : games.length === 0 ? (
            <FeedCard delay={200}>
              <div className="text-center py-8 text-muted-foreground">
                <Battery className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No fatigue data for today</p>
                <p className="text-sm mt-1">Check back when NBA games are scheduled</p>
              </div>
            </FeedCard>
          ) : (
            <div className="space-y-4">
              {games.map((game, idx) => (
                <FeedCard key={game.event_id} delay={Math.min(200 + idx * 50, 600)}>
                  <div className="space-y-4">
                    {/* Game Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          <Clock className="w-3 h-3 mr-1" />
                          {formatGameTime(game.home_team.game_time)}
                        </Badge>
                        {game.fatigueDiff >= 15 && (() => {
                          const prediction = getPredictionData(game.fatigueDiff);
                          const isBest = isSweetSpot(game.fatigueDiff);
                          const isRisky = isHighRisk(game.fatigueDiff);
                          
                          return (
                            <div className="flex items-center gap-1">
                              <Badge className={`text-xs ${getConfidenceBgColor(game.fatigueDiff)} ${isBest ? 'text-neon-green' : isRisky ? 'text-amber-400' : 'text-muted-foreground'}`}>
                                {isBest && <Trophy className="w-3 h-3 mr-1" />}
                                {isRisky && <AlertTriangle className="w-3 h-3 mr-1" />}
                                {!isBest && !isRisky && <Target className="w-3 h-3 mr-1" />}
                                {isBest ? 'BEST BET' : isRisky ? 'HIGH RISK' : 'EDGE'} +{game.fatigueDiff}
                              </Badge>
                              <Badge variant="outline" className={`text-[10px] ${isBest ? 'border-neon-green/50 text-neon-green' : isRisky ? 'border-amber-500/50 text-amber-400' : 'border-border text-muted-foreground'}`}>
                                {prediction?.winRate}%
                              </Badge>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Matchup */}
                    <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
                      {/* Away Team */}
                      <div className={`p-3 rounded-lg border ${
                        game.edgeTeam === 'away' 
                          ? 'bg-neon-cyan/10 border-neon-cyan/30' 
                          : 'bg-muted/30 border-border/50'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={`text-[10px] ${categoryColors[game.away_team.fatigue_category] || 'bg-muted'}`}>
                            {categoryIcons[game.away_team.fatigue_category]}
                          </Badge>
                          {game.edgeTeam === 'away' && (
                            <Badge className="text-[10px] bg-neon-green/20 text-neon-green">
                              EDGE
                            </Badge>
                          )}
                        </div>
                        <p className="font-semibold text-sm text-foreground truncate">
                          {game.away_team.team_name}
                        </p>
                        <div className="flex items-center justify-between mt-2">
                          <FatigueMeter score={game.away_team.fatigue_score} category={game.away_team.fatigue_category} size="sm" showLabel={false} />
                          <span className="text-lg font-bold text-foreground">
                            {game.away_team.fatigue_score}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {game.away_team.fatigue_category}
                        </p>
                      </div>

                      {/* VS */}
                      <div className="text-center">
                        <span className="text-xs text-muted-foreground font-medium">@</span>
                      </div>

                      {/* Home Team */}
                      <div className={`p-3 rounded-lg border ${
                        game.edgeTeam === 'home' 
                          ? 'bg-neon-cyan/10 border-neon-cyan/30' 
                          : 'bg-muted/30 border-border/50'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={`text-[10px] ${categoryColors[game.home_team.fatigue_category] || 'bg-muted'}`}>
                            {categoryIcons[game.home_team.fatigue_category]}
                          </Badge>
                          {game.edgeTeam === 'home' && (
                            <Badge className="text-[10px] bg-neon-green/20 text-neon-green">
                              EDGE
                            </Badge>
                          )}
                        </div>
                        <p className="font-semibold text-sm text-foreground truncate">
                          {game.home_team.team_name}
                        </p>
                        <div className="flex items-center justify-between mt-2">
                          <FatigueMeter score={game.home_team.fatigue_score} category={game.home_team.fatigue_category} size="sm" showLabel={false} />
                          <span className="text-lg font-bold text-foreground">
                            {game.home_team.fatigue_score}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {game.home_team.fatigue_category}
                        </p>
                      </div>
                    </div>

                    {/* Fatigue Factors */}
                    <div className="grid grid-cols-2 gap-2">
                      {/* Away Factors */}
                      <div className="space-y-1">
                        {game.away_team.is_back_to_back && (
                          <div className="flex items-center gap-1 text-[10px] text-neon-red">
                            <BatteryWarning className="w-3 h-3" /> B2B
                          </div>
                        )}
                        {game.away_team.travel_miles > 500 && (
                          <div className="flex items-center gap-1 text-[10px] text-orange-400">
                            <Plane className="w-3 h-3" /> {Math.round(game.away_team.travel_miles)} mi
                          </div>
                        )}
                        {game.away_team.is_altitude_game && (
                          <div className="flex items-center gap-1 text-[10px] text-yellow-400">
                            <Mountain className="w-3 h-3" /> Altitude
                          </div>
                        )}
                        {game.away_team.is_three_in_four && (
                          <div className="flex items-center gap-1 text-[10px] text-orange-400">
                            <Clock className="w-3 h-3" /> 3-in-4
                          </div>
                        )}
                      </div>
                      
                      {/* Home Factors */}
                      <div className="space-y-1 text-right">
                        {game.home_team.is_back_to_back && (
                          <div className="flex items-center gap-1 text-[10px] text-neon-red justify-end">
                            B2B <BatteryWarning className="w-3 h-3" />
                          </div>
                        )}
                        {game.home_team.travel_miles > 500 && (
                          <div className="flex items-center gap-1 text-[10px] text-orange-400 justify-end">
                            {Math.round(game.home_team.travel_miles)} mi <Plane className="w-3 h-3" />
                          </div>
                        )}
                        {game.home_team.is_altitude_game && (
                          <div className="flex items-center gap-1 text-[10px] text-yellow-400 justify-end">
                            Altitude <Mountain className="w-3 h-3" />
                          </div>
                        )}
                        {game.home_team.is_three_in_four && (
                          <div className="flex items-center gap-1 text-[10px] text-orange-400 justify-end">
                            3-in-4 <Clock className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Betting Adjustments */}
                    {game.fatigueDiff >= 15 && (
                      <div className="p-3 rounded-lg bg-neon-cyan/10 border border-neon-cyan/30">
                        <p className="text-xs text-neon-cyan font-medium mb-2 flex items-center gap-1">
                          <Target className="w-3 h-3" />
                          Recommended Angles
                        </p>
                        
                        {game.edgeTeam !== 'none' && (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Spread Edge:</span>
                              <span className="font-medium text-foreground">
                                {game.edgeTeam === 'home' ? game.home_team.team_name : game.away_team.team_name}
                                {' '}
                                <span className="text-neon-green">
                                  ({game.edgeTeam === 'home' 
                                    ? game.home_team.spread_adjustment > 0 ? '+' : ''
                                    : game.away_team.spread_adjustment > 0 ? '+' : ''}
                                  {game.edgeTeam === 'home' 
                                    ? game.home_team.spread_adjustment.toFixed(1) 
                                    : game.away_team.spread_adjustment.toFixed(1)} adj)
                                </span>
                              </span>
                            </div>
                            
                            <div className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground">Player Props:</span>
                              <span className="text-foreground">
                                {game.edgeTeam === 'home' ? game.away_team.team_name : game.home_team.team_name} 
                                {' '}
                                <span className="text-neon-red">UNDERs</span>
                              </span>
                            </div>
                            
                            {(game.edgeTeam === 'home' ? game.away_team : game.home_team).points_adjustment_pct < -5 && (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <TrendingDown className="w-3 h-3 text-neon-red" />
                                Points: {(game.edgeTeam === 'home' ? game.away_team : game.home_team).points_adjustment_pct.toFixed(0)}%
                                <TrendingDown className="w-3 h-3 text-neon-red" />
                                Rebounds: {(game.edgeTeam === 'home' ? game.away_team : game.home_team).rebounds_adjustment_pct.toFixed(0)}%
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Quick Link to Sharp Money */}
                    <Link 
                      to="/sharp" 
                      className="flex items-center justify-between p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-xs text-muted-foreground">
                        Check Sharp Money for this game
                      </span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </Link>
                  </div>
                </FeedCard>
              ))}
            </div>
          )}
        </div>
      </PullToRefreshContainer>
    </AppShell>
  );
}