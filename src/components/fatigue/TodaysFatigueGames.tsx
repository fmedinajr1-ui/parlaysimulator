import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FatigueMeter } from './FatigueMeter';
import { FatigueBreakdown } from './FatigueBreakdown';
import { PropImpactTable } from './PropImpactTable';
import { 
  Zap, Target, TrendingUp, TrendingDown, 
  ChevronDown, ChevronUp, RefreshCw, Calendar, ExternalLink
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';

interface GameFatigue {
  eventId: string;
  teams: Array<{
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
    recommended_angle: string;
    betting_edge_summary: string;
    game_time: string;
  }>;
  fatigueDifferential: number;
}

export const TodaysFatigueGames = () => {
  const [games, setGames] = useState<GameFatigue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedGame, setExpandedGame] = useState<string | null>(null);

  useEffect(() => {
    fetchTodaysGames();
  }, []);

  const fetchTodaysGames = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('nba-fatigue-engine', {
        body: { action: 'get-today' }
      });
      
      if (error) throw error;
      
      setGames(data?.games || []);
    } catch (error) {
      console.error('Error fetching fatigue games:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getEdgeGames = () => {
    return games.filter(g => g.fatigueDifferential >= 20);
  };

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (games.length === 0) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="w-5 h-5 text-yellow-500" />
            NBA Fatigue Report
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No NBA fatigue data for today</p>
            <p className="text-xs mt-1">Check back when games are scheduled</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const edgeGames = getEdgeGames();

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="w-5 h-5 text-yellow-500" />
            NBA Fatigue Report
            <Badge variant="secondary" className="text-xs">
              {games.length} games
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            <Link to="/nba-fatigue">
              <Button variant="ghost" size="sm" className="h-8 text-xs">
                View All
                <ExternalLink className="w-3 h-3 ml-1" />
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchTodaysGames}
              className="h-8"
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
        </div>
        
        {edgeGames.length > 0 && (
          <div className="flex items-center gap-2 mt-2">
            <Target className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-400 font-medium">
              {edgeGames.length} game{edgeGames.length > 1 ? 's' : ''} with fatigue edge
            </span>
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {games.map((game) => {
          const homeTeam = game.teams.find(t => t.is_home);
          const awayTeam = game.teams.find(t => !t.is_home);
          const isExpanded = expandedGame === game.eventId;
          const hasEdge = game.fatigueDifferential >= 20;
          const favoredTeam = homeTeam && awayTeam 
            ? (awayTeam.fatigue_score > homeTeam.fatigue_score ? homeTeam : awayTeam)
            : null;

          return (
            <div
              key={game.eventId}
              className={`p-3 rounded-lg border transition-colors ${
                hasEdge 
                  ? 'bg-green-500/5 border-green-500/30' 
                  : 'bg-muted/30 border-border/50'
              }`}
            >
              {/* Game Header */}
              <div 
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedGame(isExpanded ? null : game.eventId)}
              >
                <div className="flex items-center gap-3">
                  <div className="text-sm font-medium">
                    <span>{awayTeam?.team_name?.split(' ').pop()}</span>
                    <span className="text-muted-foreground mx-1">@</span>
                    <span>{homeTeam?.team_name?.split(' ').pop()}</span>
                  </div>
                  {homeTeam?.game_time && (
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(homeTeam.game_time), 'h:mm a')}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-2">
                  {hasEdge && (
                    <Badge 
                      variant="outline" 
                      className="text-xs bg-green-500/20 text-green-400 border-green-500/30"
                    >
                      <Target className="w-3 h-3 mr-1" />
                      {favoredTeam?.team_name?.split(' ').pop()}
                    </Badge>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* Fatigue Meters */}
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-12">
                    {awayTeam?.team_name?.split(' ').slice(-1)[0]?.substring(0, 3).toUpperCase()}
                  </span>
                  <FatigueMeter
                    score={awayTeam?.fatigue_score || 0}
                    category={awayTeam?.fatigue_category || 'Fresh'}
                    size="sm"
                    showLabel={false}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-12">
                    {homeTeam?.team_name?.split(' ').slice(-1)[0]?.substring(0, 3).toUpperCase()}
                  </span>
                  <FatigueMeter
                    score={homeTeam?.fatigue_score || 0}
                    category={homeTeam?.fatigue_category || 'Fresh'}
                    size="sm"
                    showLabel={false}
                  />
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
                  {/* Edge Summary */}
                  {hasEdge && favoredTeam && (
                    <div className="p-2 bg-green-500/10 border border-green-500/20 rounded-lg">
                      <div className="flex items-center gap-2 text-green-400 text-sm">
                        {awayTeam && homeTeam && awayTeam.fatigue_score > homeTeam.fatigue_score ? (
                          <TrendingUp className="w-4 h-4" />
                        ) : (
                          <TrendingDown className="w-4 h-4" />
                        )}
                        <span className="font-medium">
                          Lean {favoredTeam.team_name} ({game.fatigueDifferential}pt edge)
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {favoredTeam.recommended_angle}
                      </p>
                    </div>
                  )}

                  {/* Away Team Details */}
                  {awayTeam && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">AWAY</Badge>
                        <span className="font-medium text-sm">{awayTeam.team_name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({awayTeam.fatigue_category})
                        </span>
                      </div>
                      <FatigueBreakdown
                        isBackToBack={awayTeam.is_back_to_back}
                        isRoadBackToBack={awayTeam.is_road_back_to_back}
                        travelMiles={awayTeam.travel_miles}
                        timezoneChanges={awayTeam.timezone_changes}
                        isAltitudeGame={awayTeam.is_altitude_game}
                        isThreeInFour={awayTeam.is_three_in_four}
                        isFourInSix={awayTeam.is_four_in_six}
                        isEarlyStart={awayTeam.is_early_start}
                      />
                      <PropImpactTable
                        pointsAdjustment={awayTeam.points_adjustment_pct}
                        reboundsAdjustment={awayTeam.rebounds_adjustment_pct}
                        assistsAdjustment={awayTeam.assists_adjustment_pct}
                        threePtAdjustment={awayTeam.three_pt_adjustment_pct}
                        blocksAdjustment={awayTeam.blocks_adjustment_pct}
                        teamName={awayTeam.team_name}
                      />
                    </div>
                  )}

                  {/* Home Team Details */}
                  {homeTeam && (
                    <div className="space-y-2 pt-3 border-t border-border/30">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">HOME</Badge>
                        <span className="font-medium text-sm">{homeTeam.team_name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({homeTeam.fatigue_category})
                        </span>
                      </div>
                      <FatigueBreakdown
                        isBackToBack={homeTeam.is_back_to_back}
                        isRoadBackToBack={homeTeam.is_road_back_to_back}
                        travelMiles={homeTeam.travel_miles}
                        timezoneChanges={homeTeam.timezone_changes}
                        isAltitudeGame={homeTeam.is_altitude_game}
                        isThreeInFour={homeTeam.is_three_in_four}
                        isFourInSix={homeTeam.is_four_in_six}
                        isEarlyStart={homeTeam.is_early_start}
                      />
                      <PropImpactTable
                        pointsAdjustment={homeTeam.points_adjustment_pct}
                        reboundsAdjustment={homeTeam.rebounds_adjustment_pct}
                        assistsAdjustment={homeTeam.assists_adjustment_pct}
                        threePtAdjustment={homeTeam.three_pt_adjustment_pct}
                        blocksAdjustment={homeTeam.blocks_adjustment_pct}
                        teamName={homeTeam.team_name}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
