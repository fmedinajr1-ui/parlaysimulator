import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface QuarterStats {
  q1: number;
  q2: number;
  q3: number;
  q4: number;
}

export interface MatchupRecord {
  opponent: string;
  stat: string;
  avg_vs: number;
  games: number;
}

export interface PlayerBehaviorProfile {
  id: string;
  player_name: string;
  team: string | null;
  three_pt_peak_quarters: QuarterStats | null;
  scoring_zone_preferences: Record<string, number> | null;
  clutch_performance_vs_average: number | null;
  avg_first_rest_time: string | null;
  avg_second_stint_start: string | null;
  avg_minutes_per_quarter: QuarterStats | null;
  blowout_minutes_reduction: number | null;
  best_matchups: MatchupRecord[];
  worst_matchups: MatchupRecord[];
  fatigue_tendency: string | null;
  body_language_notes: string | null;
  film_sample_count: number;
  quarter_production: Record<string, Record<string, number>> | null;
  games_analyzed: number;
  last_updated: string;
  profile_confidence: number;
}

export function usePlayerProfile(playerName: string | undefined) {
  return useQuery({
    queryKey: ['player-profile', playerName],
    queryFn: async (): Promise<PlayerBehaviorProfile | null> => {
      if (!playerName) return null;

      const { data, error } = await supabase
        .from('player_behavior_profiles')
        .select('*')
        .eq('player_name', playerName)
        .maybeSingle();

      if (error) {
        console.error('[usePlayerProfile] Error:', error);
        throw error;
      }

      if (!data) return null;

      // Parse JSONB fields with proper typing
      return {
        ...data,
        three_pt_peak_quarters: data.three_pt_peak_quarters as unknown as QuarterStats | null,
        scoring_zone_preferences: data.scoring_zone_preferences as unknown as Record<string, number> | null,
        avg_minutes_per_quarter: data.avg_minutes_per_quarter as unknown as QuarterStats | null,
        best_matchups: (data.best_matchups as unknown as MatchupRecord[]) || [],
        worst_matchups: (data.worst_matchups as unknown as MatchupRecord[]) || [],
        quarter_production: data.quarter_production as unknown as Record<string, Record<string, number>> | null,
        film_sample_count: data.film_sample_count || 0,
        profile_confidence: data.profile_confidence || 0,
      };
    },
    enabled: !!playerName,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function usePlayerProfiles(playerNames: string[]) {
  return useQuery({
    queryKey: ['player-profiles', playerNames],
    queryFn: async (): Promise<Record<string, PlayerBehaviorProfile>> => {
      if (playerNames.length === 0) return {};

      const { data, error } = await supabase
        .from('player_behavior_profiles')
        .select('*')
        .in('player_name', playerNames);

      if (error) {
        console.error('[usePlayerProfiles] Error:', error);
        throw error;
      }

      const profileMap: Record<string, PlayerBehaviorProfile> = {};
      
      for (const profile of data || []) {
        profileMap[profile.player_name] = {
          ...profile,
          three_pt_peak_quarters: profile.three_pt_peak_quarters as unknown as QuarterStats | null,
          scoring_zone_preferences: profile.scoring_zone_preferences as unknown as Record<string, number> | null,
          avg_minutes_per_quarter: profile.avg_minutes_per_quarter as unknown as QuarterStats | null,
          best_matchups: (profile.best_matchups as unknown as MatchupRecord[]) || [],
          worst_matchups: (profile.worst_matchups as unknown as MatchupRecord[]) || [],
          quarter_production: profile.quarter_production as unknown as Record<string, Record<string, number>> | null,
          film_sample_count: profile.film_sample_count || 0,
          profile_confidence: profile.profile_confidence || 0,
        };
      }

      return profileMap;
    },
    enabled: playerNames.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

export async function buildPlayerProfile(playerName: string, team?: string): Promise<PlayerBehaviorProfile | null> {
  const { data, error } = await supabase.functions.invoke('build-player-profile', {
    body: { playerName, team },
  });

  if (error) {
    console.error('[buildPlayerProfile] Error:', error);
    throw error;
  }

  return data?.profile || null;
}

export async function buildAllPlayerProfiles(): Promise<{ profiles_built: number; errors: number }> {
  const { data, error } = await supabase.functions.invoke('build-player-profile', {
    body: { buildAll: true },
  });

  if (error) {
    console.error('[buildAllPlayerProfiles] Error:', error);
    throw error;
  }

  return {
    profiles_built: data?.profiles_built || 0,
    errors: data?.errors || 0,
  };
}
