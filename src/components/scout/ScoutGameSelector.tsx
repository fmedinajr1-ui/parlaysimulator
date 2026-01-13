import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, Clock, Users, ChevronRight } from "lucide-react";
import type { GameContext } from "@/pages/Scout";

interface ScoutGameSelectorProps {
  selectedGame: GameContext | null;
  onGameSelect: (game: GameContext) => void;
}

interface TodaysGame {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  gameDescription: string;
}

export function ScoutGameSelector({ selectedGame, onGameSelect }: ScoutGameSelectorProps) {
  const [games, setGames] = useState<TodaysGame[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState<string | null>(null);

  useEffect(() => {
    fetchTodaysGames();
  }, []);

  const fetchTodaysGames = async () => {
    try {
      // Get unique games from today's props
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const { data, error } = await supabase
        .from('unified_props')
        .select('event_id, game_description, commence_time')
        .eq('sport', 'basketball_nba')
        .gte('commence_time', today.toISOString())
        .lt('commence_time', tomorrow.toISOString())
        .order('commence_time', { ascending: true });

      if (error) throw error;

      // Deduplicate by event_id
      const uniqueGames = new Map<string, TodaysGame>();
      for (const prop of data || []) {
        if (!uniqueGames.has(prop.event_id)) {
          // Parse teams from game_description (format: "Away Team @ Home Team")
          const parts = prop.game_description?.split(' @ ') || [];
          uniqueGames.set(prop.event_id, {
            eventId: prop.event_id,
            homeTeam: parts[1] || 'Unknown',
            awayTeam: parts[0] || 'Unknown',
            commenceTime: prop.commence_time,
            gameDescription: prop.game_description || '',
          });
        }
      }

      setGames(Array.from(uniqueGames.values()));
    } catch (err) {
      console.error('Error fetching games:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadRosters = async (game: TodaysGame) => {
    setLoadingRoster(game.eventId);
    
    try {
      // Fetch players from bdl_player_cache for both teams
      const { data: homeRoster, error: homeError } = await supabase
        .from('bdl_player_cache')
        .select('player_name, jersey_number, position')
        .ilike('team_name', `%${game.homeTeam.replace(/\s+/g, '%')}%`)
        .limit(15);

      const { data: awayRoster, error: awayError } = await supabase
        .from('bdl_player_cache')
        .select('player_name, jersey_number, position')
        .ilike('team_name', `%${game.awayTeam.replace(/\s+/g, '%')}%`)
        .limit(15);

      if (homeError) console.warn('Home roster error:', homeError);
      if (awayError) console.warn('Away roster error:', awayError);

      const gameContext: GameContext = {
        ...game,
        homeRoster: (homeRoster || []).map(p => ({
          name: p.player_name,
          jersey: p.jersey_number || '?',
          position: p.position || '',
        })),
        awayRoster: (awayRoster || []).map(p => ({
          name: p.player_name,
          jersey: p.jersey_number || '?',
          position: p.position || '',
        })),
      };

      onGameSelect(gameContext);
    } catch (err) {
      console.error('Error loading rosters:', err);
      // Still proceed with empty rosters
      onGameSelect({
        ...game,
        homeRoster: [],
        awayRoster: [],
      });
    } finally {
      setLoadingRoster(null);
    }
  };

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getGameStatus = (commenceTime: string) => {
    const now = new Date();
    const gameTime = new Date(commenceTime);
    const diffMs = gameTime.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < -120) return { label: '2H Available', variant: 'default' as const };
    if (diffMins < 0) return { label: 'In Progress', variant: 'secondary' as const };
    if (diffMins < 60) return { label: `${diffMins}m`, variant: 'outline' as const };
    return { label: formatTime(commenceTime), variant: 'outline' as const };
  };

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            Today's Games
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (games.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-8 text-center">
          <Calendar className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
          <p className="text-muted-foreground">No NBA games today</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Check back when games are scheduled
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          Today's Games
          <Badge variant="secondary" className="ml-auto">
            {games.length} games
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {games.map((game) => {
          const status = getGameStatus(game.commenceTime);
          const isSelected = selectedGame?.eventId === game.eventId;
          const isLoadingThis = loadingRoster === game.eventId;

          return (
            <Button
              key={game.eventId}
              variant={isSelected ? "default" : "outline"}
              className={`w-full justify-between h-auto py-3 px-4 ${
                isSelected ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => loadRosters(game)}
              disabled={isLoadingThis}
            >
              <div className="flex flex-col items-start gap-1">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{game.awayTeam}</span>
                  <span className="text-muted-foreground">@</span>
                  <span className="font-medium">{game.homeTeam}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {formatTime(game.commenceTime)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={status.variant}>{status.label}</Badge>
                {isLoadingThis ? (
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}
