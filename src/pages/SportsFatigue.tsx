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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Battery, BatteryLow, BatteryWarning, BatteryFull, 
  RefreshCw, TrendingUp, Plane, Clock, Mountain,
  Target, Zap, Trophy, AlertTriangle, Flame,
  Disc, CircleDot
} from "lucide-react";
import { format } from "date-fns";
import { FatigueMeter } from "@/components/fatigue/FatigueMeter";
import { FatigueEdgeROI } from "@/components/fatigue/FatigueEdgeROI";
import { toast } from "sonner";
import { getPredictionData, isSweetSpot, isHighRisk, getConfidenceBgColor } from "@/lib/fatigue-predictions";

interface FatigueScore {
  id: string;
  event_id: string;
  sport: string;
  team_name: string;
  opponent_name: string;
  fatigue_score: number;
  fatigue_category: string;
  is_back_to_back: boolean;
  is_three_in_four: boolean;
  travel_miles: number;
  timezone_changes: number;
  altitude_factor: number;
  rest_days: number;
  short_week: boolean;
  road_trip_games: number;
  betting_adjustments: Record<string, number> | null;
  recommended_angle: string | null;
  game_date: string;
  commence_time: string;
}

interface GameWithFatigue {
  event_id: string;
  sport: string;
  home_team: FatigueScore;
  away_team: FatigueScore;
  fatigueDiff: number;
  edgeTeam: 'home' | 'away' | 'none';
}

type SportFilter = 'all' | 'basketball_nba' | 'americanfootball_nfl' | 'baseball_mlb' | 'icehockey_nhl';

const SPORT_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  basketball_nba: { label: 'NBA', icon: <CircleDot className="w-4 h-4" />, color: 'text-orange-400' },
  americanfootball_nfl: { label: 'NFL', icon: <Target className="w-4 h-4" />, color: 'text-green-400' },
  baseball_mlb: { label: 'MLB', icon: <CircleDot className="w-4 h-4" />, color: 'text-blue-400' },
  icehockey_nhl: { label: 'NHL', icon: <Disc className="w-4 h-4" />, color: 'text-cyan-400' },
};

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

export default function SportsFatigue() {
  const [games, setGames] = useState<GameWithFatigue[]>([]);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [sportFilter, setSportFilter] = useState<SportFilter>('all');

  const fetchFatigueData = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('sports_fatigue_scores')
        .select('*')
        .eq('game_date', today)
        .order('commence_time', { ascending: true });

      if (error) throw error;

      // Group by event_id
      const gameMap = new Map<string, FatigueScore[]>();
      (data || []).forEach((row) => {
        const score: FatigueScore = {
          ...row,
          betting_adjustments: row.betting_adjustments as Record<string, number> | null,
        };
        const existing = gameMap.get(score.event_id) || [];
        existing.push(score);
        gameMap.set(score.event_id, existing);
      });

      // Build game pairs
      const gamesList: GameWithFatigue[] = [];
      gameMap.forEach((scores, event_id) => {
        if (scores.length >= 2) {
          // Determine home/away by checking opponent_name relationships
          let homeTeam = scores[0];
          let awayTeam = scores[1];
          
          // The team whose opponent_name matches the other team's team_name is the away team
          if (scores[0].opponent_name === scores[1].team_name) {
            homeTeam = scores[1];
            awayTeam = scores[0];
          } else if (scores[1].opponent_name === scores[0].team_name) {
            homeTeam = scores[0];
            awayTeam = scores[1];
          }

          const fatigueDiff = Math.abs(homeTeam.fatigue_score - awayTeam.fatigue_score);
          
          let edgeTeam: 'home' | 'away' | 'none' = 'none';
          if (fatigueDiff >= 10) {
            edgeTeam = homeTeam.fatigue_score < awayTeam.fatigue_score ? 'home' : 'away';
          }

          gamesList.push({
            event_id,
            sport: homeTeam.sport,
            home_team: homeTeam,
            away_team: awayTeam,
            fatigueDiff,
            edgeTeam,
          });
        }
      });

      // Sort by game time
      gamesList.sort((a, b) => 
        new Date(a.home_team.commence_time).getTime() - new Date(b.home_team.commence_time).getTime()
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
      const { data, error } = await supabase.functions.invoke('sports-fatigue-calculator', {
        body: {}
      });
      
      if (error) throw error;
      
      const gamesProcessed = data?.gamesProcessed || 0;
      if (gamesProcessed > 0) {
        toast.success(`Calculated fatigue for ${gamesProcessed} games across all sports`);
      } else {
        toast.info('No games scheduled for today');
      }
      
      await fetchFatigueData();
    } catch (error) {
      console.error('Error calculating fatigue:', error);
      toast.error('Failed to calculate fatigue scores');
    } finally {
      setCalculating(false);
    }
  };

  const { isRefreshing, pullProgress, containerRef, handlers } = usePullToRefresh({
    onRefresh: fetchFatigueData,
  });

  // Filter games by sport
  const filteredGames = sportFilter === 'all' 
    ? games 
    : games.filter(g => g.sport === sportFilter);

  const stats = {
    totalGames: filteredGames.length,
    gamesWithEdge: filteredGames.filter(g => g.fatigueDiff >= 15).length,
    backToBackTeams: filteredGames.filter(g => g.home_team.is_back_to_back || g.away_team.is_back_to_back).length,
    redAlertTeams: filteredGames.filter(g => 
      g.home_team.fatigue_category === 'Red Alert' || g.away_team.fatigue_category === 'Red Alert'
    ).length,
  };

  // Sport breakdown
  const sportCounts = Object.keys(SPORT_CONFIG).reduce((acc, sport) => {
    acc[sport] = games.filter(g => g.sport === sport).length;
    return acc;
  }, {} as Record<string, number>);

  const formatGameTime = (timeStr: string) => {
    try {
      return format(new Date(timeStr), 'h:mm a');
    } catch {
      return timeStr;
    }
  };

  const getSportIcon = (sport: string) => {
    return SPORT_CONFIG[sport]?.icon || <CircleDot className="w-4 h-4" />;
  };

  const getSportColor = (sport: string) => {
    return SPORT_CONFIG[sport]?.color || 'text-muted-foreground';
  };

  return (
    <AppShell noPadding>
      <MobileHeader
        title="Sports Fatigue"
        subtitle="Multi-sport schedule edges"
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
          {/* Sport Filter Tabs */}
          <Tabs value={sportFilter} onValueChange={(v) => setSportFilter(v as SportFilter)}>
            <TabsList className="w-full grid grid-cols-5 h-10">
              <TabsTrigger value="all" className="text-xs">
                All ({games.length})
              </TabsTrigger>
              <TabsTrigger value="basketball_nba" className="text-xs">
                <span className={getSportColor('basketball_nba')}>🏀</span>
                <span className="ml-1 hidden sm:inline">{sportCounts.basketball_nba || 0}</span>
              </TabsTrigger>
              <TabsTrigger value="americanfootball_nfl" className="text-xs">
                <span className={getSportColor('americanfootball_nfl')}>🏈</span>
                <span className="ml-1 hidden sm:inline">{sportCounts.americanfootball_nfl || 0}</span>
              </TabsTrigger>
              <TabsTrigger value="baseball_mlb" className="text-xs">
                <span className={getSportColor('baseball_mlb')}>⚾</span>
                <span className="ml-1 hidden sm:inline">{sportCounts.baseball_mlb || 0}</span>
              </TabsTrigger>
              <TabsTrigger value="icehockey_nhl" className="text-xs">
                <span className={getSportColor('icehockey_nhl')}>🏒</span>
                <span className="ml-1 hidden sm:inline">{sportCounts.icehockey_nhl || 0}</span>
              </TabsTrigger>
            </TabsList>
          </Tabs>

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

          {/* Action Button */}
          {filteredGames.length === 0 && !loading && (
            <Button 
              onClick={calculateFatigue} 
              disabled={calculating}
              className="w-full"
            >
              {calculating ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Calculating All Sports...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Calculate Today's Fatigue
                </>
              )}
            </Button>
          )}

          {/* Best Bets Section - 20-29 Sweet Spot */}
          {!loading && filteredGames.filter(g => isSweetSpot(g.fatigueDiff)).length > 0 && (
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
                {filteredGames.filter(g => isSweetSpot(g.fatigueDiff)).map((game) => {
                  const edgeTeamData = game.edgeTeam === 'home' ? game.home_team : game.away_team;
                  const prediction = getPredictionData(game.fatigueDiff);
                  
                  return (
                    <div 
                      key={`best-${game.event_id}`}
                      className="p-3 rounded-lg bg-gradient-to-r from-neon-green/10 to-neon-cyan/10 border border-neon-green/30"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={getSportColor(game.sport)}>
                            {getSportIcon(game.sport)}
                          </span>
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
                      {game.home_team.recommended_angle && (
                        <p className="text-xs text-muted-foreground mt-2 italic">
                          {game.home_team.recommended_angle}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </FeedCard>
          )}

          {/* 30+ Warning Section */}
          {!loading && filteredGames.filter(g => isHighRisk(g.fatigueDiff)).length > 0 && (
            <FeedCard delay={175}>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <p className="text-xs text-amber-400">
                  <span className="font-medium">Caution:</span> Games with 30+ differential historically underperform. Stick to 20-29 range.
                </p>
              </div>
            </FeedCard>
          )}

          {/* Games List */}
          {loading ? (
            <SkeletonList count={4} variant="bet" />
          ) : filteredGames.length === 0 ? (
            <FeedCard delay={200}>
              <div className="text-center py-8 text-muted-foreground">
                <Battery className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="font-medium">No fatigue data for today</p>
                <p className="text-sm mt-1">Click the button above to calculate</p>
              </div>
            </FeedCard>
          ) : (
            <div className="space-y-4">
              {filteredGames.map((game, idx) => (
                <FeedCard key={game.event_id} delay={Math.min(200 + idx * 50, 600)}>
                  <div className="space-y-4">
                    {/* Game Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={getSportColor(game.sport)}>
                          {getSportIcon(game.sport)}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          <Clock className="w-3 h-3 mr-1" />
                          {formatGameTime(game.home_team.commence_time)}
                        </Badge>
                        {game.fatigueDiff >= 10 && (() => {
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
                              {prediction && (
                                <Badge variant="outline" className={`text-[10px] ${isBest ? 'border-neon-green/50 text-neon-green' : isRisky ? 'border-amber-500/50 text-amber-400' : 'border-border text-muted-foreground'}`}>
                                  {prediction.winRate}%
                                </Badge>
                              )}
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
                        <FatigueMeter score={game.away_team.fatigue_score} category={game.away_team.fatigue_category} size="sm" showLabel={false} />
                        
                        {/* Fatigue factors */}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {game.away_team.is_back_to_back && (
                            <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400">
                              B2B
                            </Badge>
                          )}
                          {game.away_team.travel_miles > 500 && (
                            <Badge variant="outline" className="text-[9px]">
                              <Plane className="w-2 h-2 mr-0.5" />
                              {Math.round(game.away_team.travel_miles)}mi
                            </Badge>
                          )}
                          {game.away_team.altitude_factor > 0 && (
                            <Badge variant="outline" className="text-[9px]">
                              <Mountain className="w-2 h-2 mr-0.5" />
                              ALT
                            </Badge>
                          )}
                          {game.away_team.short_week && (
                            <Badge variant="outline" className="text-[9px] border-orange-500/50 text-orange-400">
                              Short Week
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* VS */}
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">@</p>
                        {game.fatigueDiff >= 10 && (
                          <p className="text-lg font-bold text-neon-cyan">
                            +{game.fatigueDiff}
                          </p>
                        )}
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
                        <FatigueMeter score={game.home_team.fatigue_score} category={game.home_team.fatigue_category} size="sm" showLabel={false} />
                        
                        {/* Fatigue factors */}
                        <div className="mt-2 flex flex-wrap gap-1">
                          {game.home_team.is_back_to_back && (
                            <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-400">
                              B2B
                            </Badge>
                          )}
                          {game.home_team.is_three_in_four && (
                            <Badge variant="outline" className="text-[9px]">
                              3-in-4
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Recommended Angle */}
                    {game.home_team.recommended_angle && (
                      <div className="p-2 rounded-lg bg-muted/30 border border-border/50">
                        <p className="text-xs text-muted-foreground">
                          {game.home_team.recommended_angle}
                        </p>
                      </div>
                    )}
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
