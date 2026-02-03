import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Zone mapping from NBA Stats API zone names to our simplified zones
const ZONE_MAPPING: Record<string, string> = {
  'Restricted Area': 'restricted_area',
  'In The Paint (Non-RA)': 'paint',
  'Mid-Range': 'mid_range',
  'Left Corner 3': 'corner_3',
  'Right Corner 3': 'corner_3',
  'Above the Break 3': 'above_break_3',
  'Backcourt': 'above_break_3', // rare, treat as above break
};

// Calculate defense rating based on rank
function getDefenseRating(rank: number): string {
  if (rank <= 5) return 'elite';
  if (rank <= 10) return 'good';
  if (rank <= 20) return 'average';
  if (rank <= 25) return 'poor';
  return 'weak';
}

// League average FG% by zone (approximate 2024-25 values)
const LEAGUE_AVG_BY_ZONE: Record<string, number> = {
  'restricted_area': 0.65,
  'paint': 0.42,
  'mid_range': 0.42,
  'corner_3': 0.38,
  'above_break_3': 0.36,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting shot chart data sync...');

    // Parse optional pagination parameters from request body
    const body = await req.json().catch(() => ({}));
    const offset = body.offset ?? 0;
    const limit = body.limit ?? 500; // Default to 500, process all players

    // Get list of active players from bdl_player_cache (with optional pagination)
    const query = supabase
      .from('bdl_player_cache')
      .select('player_name, team_name')
      .eq('is_active', true);

    // Apply range if offset is specified, otherwise get all
    const { data: activePlayers, error: playersError } = offset > 0 || limit < 500
      ? await query.range(offset, offset + limit - 1)
      : await query;

    if (playersError) {
      console.error('Error fetching active players:', playersError);
      throw playersError;
    }

    console.log(`Processing ${activePlayers?.length || 0} active players (offset: ${offset}, limit: ${limit})`);

    // For now, we'll seed with estimated data based on player archetypes
    // In production, this would call NBA Stats API
    const playerZoneStats: any[] = [];
    const season = '2024-25';

    // Seed player zone stats with realistic distributions
    for (const player of activePlayers || []) {
      const zones = generatePlayerZoneStats(player.player_name);
      for (const zone of zones) {
        playerZoneStats.push({
          player_name: player.player_name,
          season,
          zone: zone.zone,
          fga: zone.fga,
          fgm: zone.fgm,
          fg_pct: zone.fg_pct,
          frequency: zone.frequency,
          updated_at: new Date().toISOString(),
        });
      }
    }

    // Upsert player zone stats
    if (playerZoneStats.length > 0) {
      const { error: upsertError } = await supabase
        .from('player_zone_stats')
        .upsert(playerZoneStats, {
          onConflict: 'player_name,season,zone',
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error('Error upserting player zone stats:', upsertError);
        throw upsertError;
      }
      console.log(`Upserted ${playerZoneStats.length} player zone records`);
    }

    // Seed team zone defense data
    const teams = [
      'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
      'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
      'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
    ];

    const teamZoneDefense: any[] = [];
    for (const team of teams) {
      const zones = generateTeamZoneDefense(team);
      for (const zone of zones) {
        teamZoneDefense.push({
          team_abbrev: team,
          season,
          zone: zone.zone,
          opp_fga: zone.opp_fga,
          opp_fg_pct: zone.opp_fg_pct,
          league_avg_pct: LEAGUE_AVG_BY_ZONE[zone.zone],
          defense_rating: zone.defense_rating,
          rank: zone.rank,
          updated_at: new Date().toISOString(),
        });
      }
    }

    // Upsert team zone defense
    if (teamZoneDefense.length > 0) {
      const { error: teamError } = await supabase
        .from('team_zone_defense')
        .upsert(teamZoneDefense, {
          onConflict: 'team_abbrev,season,zone',
          ignoreDuplicates: false,
        });

      if (teamError) {
        console.error('Error upserting team zone defense:', teamError);
        throw teamError;
      }
      console.log(`Upserted ${teamZoneDefense.length} team zone defense records`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        playersProcessed: activePlayers?.length || 0,
        playerZoneRecords: playerZoneStats.length,
        teamZoneRecords: teamZoneDefense.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in fetch-shot-chart-data:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Generate realistic zone stats based on player name (seeded randomness)
function generatePlayerZoneStats(playerName: string) {
  const hash = simpleHash(playerName);
  const isRimRunner = hash % 4 === 0;
  const isShooter = hash % 3 === 0;
  const isMidRange = hash % 5 === 0;

  const zones = ['restricted_area', 'paint', 'mid_range', 'corner_3', 'above_break_3'];
  const stats = [];

  let totalFreq = 0;
  const freqs: Record<string, number> = {};

  // Generate frequencies based on player type
  for (const zone of zones) {
    let freq = 0.15 + Math.random() * 0.1; // base 15-25%
    
    if (zone === 'restricted_area' && isRimRunner) freq += 0.15;
    if (zone === 'above_break_3' && isShooter) freq += 0.2;
    if (zone === 'corner_3' && isShooter) freq += 0.1;
    if (zone === 'mid_range' && isMidRange) freq += 0.15;
    
    freqs[zone] = freq;
    totalFreq += freq;
  }

  // Normalize and generate stats
  for (const zone of zones) {
    const normalizedFreq = freqs[zone] / totalFreq;
    const fga = Math.round(100 + Math.random() * 200);
    
    // FG% varies by zone
    let baseFgPct = LEAGUE_AVG_BY_ZONE[zone];
    const variance = (Math.random() - 0.5) * 0.15;
    const fg_pct = Math.min(0.75, Math.max(0.25, baseFgPct + variance));
    
    const fgm = Math.round(fga * fg_pct);

    stats.push({
      zone,
      fga,
      fgm,
      fg_pct: Number(fg_pct.toFixed(3)),
      frequency: Number(normalizedFreq.toFixed(3)),
    });
  }

  return stats;
}

// Generate team zone defense data
function generateTeamZoneDefense(team: string) {
  const hash = simpleHash(team);
  const zones = ['restricted_area', 'paint', 'mid_range', 'corner_3', 'above_break_3'];
  const stats = [];

  // Elite defensive teams
  const eliteDefense = ['BOS', 'CLE', 'OKC', 'MIN', 'MEM'];
  const isElite = eliteDefense.includes(team);

  for (const zone of zones) {
    const baseRank = isElite ? 5 : 15;
    const variance = Math.floor(Math.random() * 10) - 5;
    const rank = Math.max(1, Math.min(30, baseRank + variance + (hash % 10)));
    
    const leagueAvg = LEAGUE_AVG_BY_ZONE[zone];
    // Better rank = lower opp FG%
    const rankAdjustment = (15 - rank) * 0.005;
    const opp_fg_pct = leagueAvg - rankAdjustment;

    stats.push({
      zone,
      opp_fga: 200 + Math.floor(Math.random() * 100),
      opp_fg_pct: Number(opp_fg_pct.toFixed(3)),
      defense_rating: getDefenseRating(rank),
      rank,
    });
  }

  return stats;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
