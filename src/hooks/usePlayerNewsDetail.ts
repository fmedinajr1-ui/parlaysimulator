import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface InjuryReport {
  id: string;
  player_name: string;
  team_name: string;
  status: string;
  injury_type: string | null;
  injury_detail: string | null;
  impact_score: number | null;
  is_star_player: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

interface GameLog {
  id: string;
  player_name: string;
  game_date: string;
  opponent: string;
  points: number;
  rebounds: number;
  assists: number;
  threes_made: number;
  blocks: number;
  steals: number;
  minutes_played: number;
  is_home: boolean;
}

interface BettingTrend {
  id: string;
  player_name: string;
  prop_type: string;
  current_line: number;
  hit_rate_over: number;
  hit_rate_under: number;
  hit_streak: string | null;
  last_5_results: any[];
  season_avg: number | null;
  trend_direction: string | null;
  recommended_side: string | null;
  confidence_score: number | null;
}

export interface PlayerNewsDetail {
  playerName: string;
  teamName: string | null;
  sport: string;
  injuries: InjuryReport[];
  gameLogs: GameLog[];
  bettingTrends: BettingTrend[];
  isLoading: boolean;
  error: string | null;
}

export function usePlayerNewsDetail(playerName: string | null, sport: string | null) {
  const [data, setData] = useState<PlayerNewsDetail>({
    playerName: '',
    teamName: null,
    sport: '',
    injuries: [],
    gameLogs: [],
    bettingTrends: [],
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    if (!playerName || !sport) {
      setData(prev => ({ ...prev, isLoading: false, injuries: [], gameLogs: [], bettingTrends: [] }));
      return;
    }

    const fetchPlayerData = async () => {
      setData(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        // Fetch injury reports
        const { data: injuries, error: injuryError } = await supabase
          .from('injury_reports')
          .select('*')
          .ilike('player_name', `%${playerName}%`)
          .order('updated_at', { ascending: false })
          .limit(10);

        if (injuryError) throw injuryError;

        // Fetch game logs based on sport
        let gameLogs: GameLog[] = [];
        const isNBA = sport.toLowerCase().includes('nba') || sport.toLowerCase().includes('basketball');
        
        if (isNBA) {
          const { data: nbaLogs, error: nbaError } = await supabase
            .from('nba_player_game_logs')
            .select('*')
            .ilike('player_name', `%${playerName}%`)
            .order('game_date', { ascending: false })
            .limit(10);

          if (!nbaError && nbaLogs) {
            gameLogs = nbaLogs.map((log: any) => ({
              id: log.id,
              player_name: log.player_name,
              game_date: log.game_date,
              opponent: log.opponent,
              points: Number(log.points) || 0,
              rebounds: Number(log.rebounds) || 0,
              assists: Number(log.assists) || 0,
              threes_made: Number(log.threes_made) || 0,
              blocks: Number(log.blocks) || 0,
              steals: Number(log.steals) || 0,
              minutes_played: Number(log.minutes_played) || 0,
              is_home: log.is_home || false,
            }));
          }
        }

        // Fetch betting trends from player_prop_hitrates
        const { data: trends, error: trendsError } = await supabase
          .from('player_prop_hitrates')
          .select('*')
          .ilike('player_name', `%${playerName}%`)
          .order('analyzed_at', { ascending: false })
          .limit(10);

        if (trendsError) throw trendsError;

        const bettingTrends: BettingTrend[] = (trends || []).map((t: any) => ({
          id: t.id,
          player_name: t.player_name,
          prop_type: t.prop_type,
          current_line: Number(t.current_line),
          hit_rate_over: Number(t.hit_rate_over) || 0,
          hit_rate_under: Number(t.hit_rate_under) || 0,
          hit_streak: t.hit_streak,
          last_5_results: t.last_5_results || [],
          season_avg: t.season_avg ? Number(t.season_avg) : null,
          trend_direction: t.trend_direction,
          recommended_side: t.recommended_side,
          confidence_score: t.confidence_score ? Number(t.confidence_score) : null,
        }));

        // Get team name from first injury or trend
        const teamName = injuries?.[0]?.team_name || null;

        setData({
          playerName,
          teamName,
          sport,
          injuries: injuries || [],
          gameLogs,
          bettingTrends,
          isLoading: false,
          error: null,
        });
      } catch (err: any) {
        console.error('[usePlayerNewsDetail] Error:', err);
        setData(prev => ({
          ...prev,
          isLoading: false,
          error: err.message || 'Failed to fetch player data',
        }));
      }
    };

    fetchPlayerData();
  }, [playerName, sport]);

  return data;
}
