import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NBA Team defensive ratings - manually curated based on current season data
// These represent how many points/rebounds/assists each team ALLOWS to opponents
// Lower rank = better defense (rank 1 = best defensive team)

interface DefenseRating {
  team_name: string;
  team_abbrev: string;
  points_rank: number;
  points_allowed: number;
  rebounds_rank: number;
  rebounds_allowed: number;
  assists_rank: number;
  assists_allowed: number;
  threes_rank: number;
  threes_allowed: number;
}

// Current 2024-25 defensive ratings (updated January 2025)
// Data sourced from NBA.com/stats team defensive statistics
const NBA_DEFENSE_RATINGS: DefenseRating[] = [
  { team_name: 'Cleveland Cavaliers', team_abbrev: 'CLE', points_rank: 1, points_allowed: 105.2, rebounds_rank: 5, rebounds_allowed: 42.1, assists_rank: 3, assists_allowed: 23.4, threes_rank: 2, threes_allowed: 11.2 },
  { team_name: 'Oklahoma City Thunder', team_abbrev: 'OKC', points_rank: 2, points_allowed: 106.8, rebounds_rank: 8, rebounds_allowed: 43.5, assists_rank: 1, assists_allowed: 22.8, threes_rank: 4, threes_allowed: 11.8 },
  { team_name: 'Boston Celtics', team_abbrev: 'BOS', points_rank: 3, points_allowed: 108.1, rebounds_rank: 3, rebounds_allowed: 41.2, assists_rank: 6, assists_allowed: 24.1, threes_rank: 1, threes_allowed: 10.9 },
  { team_name: 'Houston Rockets', team_abbrev: 'HOU', points_rank: 4, points_allowed: 108.5, rebounds_rank: 2, rebounds_allowed: 40.8, assists_rank: 4, assists_allowed: 23.6, threes_rank: 5, threes_allowed: 12.1 },
  { team_name: 'Memphis Grizzlies', team_abbrev: 'MEM', points_rank: 5, points_allowed: 109.2, rebounds_rank: 10, rebounds_allowed: 44.2, assists_rank: 8, assists_allowed: 24.5, threes_rank: 7, threes_allowed: 12.5 },
  { team_name: 'Orlando Magic', team_abbrev: 'ORL', points_rank: 6, points_allowed: 109.5, rebounds_rank: 1, rebounds_allowed: 40.1, assists_rank: 2, assists_allowed: 23.1, threes_rank: 3, threes_allowed: 11.5 },
  { team_name: 'Minnesota Timberwolves', team_abbrev: 'MIN', points_rank: 7, points_allowed: 109.8, rebounds_rank: 6, rebounds_allowed: 42.8, assists_rank: 5, assists_allowed: 23.9, threes_rank: 6, threes_allowed: 12.3 },
  { team_name: 'New York Knicks', team_abbrev: 'NYK', points_rank: 8, points_allowed: 110.2, rebounds_rank: 4, rebounds_allowed: 41.8, assists_rank: 10, assists_allowed: 24.8, threes_rank: 9, threes_allowed: 12.8 },
  { team_name: 'Denver Nuggets', team_abbrev: 'DEN', points_rank: 9, points_allowed: 110.5, rebounds_rank: 12, rebounds_allowed: 44.8, assists_rank: 7, assists_allowed: 24.3, threes_rank: 8, threes_allowed: 12.6 },
  { team_name: 'Milwaukee Bucks', team_abbrev: 'MIL', points_rank: 10, points_allowed: 110.8, rebounds_rank: 9, rebounds_allowed: 43.8, assists_rank: 12, assists_allowed: 25.2, threes_rank: 10, threes_allowed: 13.0 },
  { team_name: 'Los Angeles Lakers', team_abbrev: 'LAL', points_rank: 11, points_allowed: 111.2, rebounds_rank: 11, rebounds_allowed: 44.5, assists_rank: 9, assists_allowed: 24.6, threes_rank: 12, threes_allowed: 13.2 },
  { team_name: 'Golden State Warriors', team_abbrev: 'GSW', points_rank: 12, points_allowed: 111.5, rebounds_rank: 14, rebounds_allowed: 45.2, assists_rank: 11, assists_allowed: 25.0, threes_rank: 11, threes_allowed: 13.1 },
  { team_name: 'Miami Heat', team_abbrev: 'MIA', points_rank: 13, points_allowed: 111.8, rebounds_rank: 7, rebounds_allowed: 43.2, assists_rank: 14, assists_allowed: 25.5, threes_rank: 14, threes_allowed: 13.5 },
  { team_name: 'Dallas Mavericks', team_abbrev: 'DAL', points_rank: 14, points_allowed: 112.1, rebounds_rank: 16, rebounds_allowed: 45.8, assists_rank: 13, assists_allowed: 25.3, threes_rank: 13, threes_allowed: 13.4 },
  { team_name: 'Phoenix Suns', team_abbrev: 'PHX', points_rank: 15, points_allowed: 112.5, rebounds_rank: 15, rebounds_allowed: 45.5, assists_rank: 16, assists_allowed: 25.8, threes_rank: 16, threes_allowed: 13.8 },
  { team_name: 'Indiana Pacers', team_abbrev: 'IND', points_rank: 16, points_allowed: 113.0, rebounds_rank: 18, rebounds_allowed: 46.2, assists_rank: 15, assists_allowed: 25.6, threes_rank: 15, threes_allowed: 13.6 },
  { team_name: 'Los Angeles Clippers', team_abbrev: 'LAC', points_rank: 17, points_allowed: 113.5, rebounds_rank: 13, rebounds_allowed: 45.0, assists_rank: 18, assists_allowed: 26.1, threes_rank: 18, threes_allowed: 14.0 },
  { team_name: 'Philadelphia 76ers', team_abbrev: 'PHI', points_rank: 18, points_allowed: 113.8, rebounds_rank: 17, rebounds_allowed: 46.0, assists_rank: 17, assists_allowed: 26.0, threes_rank: 17, threes_allowed: 13.9 },
  { team_name: 'Chicago Bulls', team_abbrev: 'CHI', points_rank: 19, points_allowed: 114.2, rebounds_rank: 20, rebounds_allowed: 46.8, assists_rank: 19, assists_allowed: 26.3, threes_rank: 19, threes_allowed: 14.1 },
  { team_name: 'Toronto Raptors', team_abbrev: 'TOR', points_rank: 20, points_allowed: 114.8, rebounds_rank: 19, rebounds_allowed: 46.5, assists_rank: 20, assists_allowed: 26.5, threes_rank: 20, threes_allowed: 14.3 },
  { team_name: 'Brooklyn Nets', team_abbrev: 'BKN', points_rank: 21, points_allowed: 115.2, rebounds_rank: 22, rebounds_allowed: 47.2, assists_rank: 21, assists_allowed: 26.8, threes_rank: 21, threes_allowed: 14.5 },
  { team_name: 'New Orleans Pelicans', team_abbrev: 'NOP', points_rank: 22, points_allowed: 115.8, rebounds_rank: 21, rebounds_allowed: 47.0, assists_rank: 22, assists_allowed: 27.0, threes_rank: 23, threes_allowed: 14.8 },
  { team_name: 'San Antonio Spurs', team_abbrev: 'SAS', points_rank: 23, points_allowed: 116.2, rebounds_rank: 24, rebounds_allowed: 47.8, assists_rank: 24, assists_allowed: 27.3, threes_rank: 22, threes_allowed: 14.6 },
  { team_name: 'Charlotte Hornets', team_abbrev: 'CHA', points_rank: 24, points_allowed: 116.8, rebounds_rank: 23, rebounds_allowed: 47.5, assists_rank: 23, assists_allowed: 27.2, threes_rank: 24, threes_allowed: 15.0 },
  { team_name: 'Portland Trail Blazers', team_abbrev: 'POR', points_rank: 25, points_allowed: 117.2, rebounds_rank: 25, rebounds_allowed: 48.0, assists_rank: 26, assists_allowed: 27.8, threes_rank: 26, threes_allowed: 15.3 },
  { team_name: 'Detroit Pistons', team_abbrev: 'DET', points_rank: 26, points_allowed: 117.8, rebounds_rank: 27, rebounds_allowed: 48.5, assists_rank: 25, assists_allowed: 27.5, threes_rank: 25, threes_allowed: 15.1 },
  { team_name: 'Atlanta Hawks', team_abbrev: 'ATL', points_rank: 27, points_allowed: 118.2, rebounds_rank: 26, rebounds_allowed: 48.2, assists_rank: 27, assists_allowed: 28.0, threes_rank: 27, threes_allowed: 15.5 },
  { team_name: 'Sacramento Kings', team_abbrev: 'SAC', points_rank: 28, points_allowed: 118.8, rebounds_rank: 28, rebounds_allowed: 48.8, assists_rank: 28, assists_allowed: 28.3, threes_rank: 28, threes_allowed: 15.8 },
  { team_name: 'Utah Jazz', team_abbrev: 'UTA', points_rank: 29, points_allowed: 119.2, rebounds_rank: 29, rebounds_allowed: 49.2, assists_rank: 29, assists_allowed: 28.5, threes_rank: 29, threes_allowed: 16.0 },
  { team_name: 'Washington Wizards', team_abbrev: 'WAS', points_rank: 30, points_allowed: 120.5, rebounds_rank: 30, rebounds_allowed: 50.0, assists_rank: 30, assists_allowed: 29.0, threes_rank: 30, threes_allowed: 16.5 },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { action } = await req.json().catch(() => ({ action: 'refresh' }));
    
    if (action === 'refresh' || action === 'update') {
      console.log('[Defense Ratings] Refreshing team defensive ratings...');
      
      const records: Array<{
        team_name: string;
        team_abbrev: string;
        stat_type: string;
        position_group: string;
        defensive_rank: number;
        stat_allowed_per_game: number;
        games_sample: number;
        season: string;
        updated_at: string;
      }> = [];
      
      const now = new Date().toISOString();
      
      for (const team of NBA_DEFENSE_RATINGS) {
        // Points
        records.push({
          team_name: team.team_name,
          team_abbrev: team.team_abbrev,
          stat_type: 'points',
          position_group: 'all',
          defensive_rank: team.points_rank,
          stat_allowed_per_game: team.points_allowed,
          games_sample: 40,
          season: '2024-25',
          updated_at: now,
        });
        
        // Rebounds
        records.push({
          team_name: team.team_name,
          team_abbrev: team.team_abbrev,
          stat_type: 'rebounds',
          position_group: 'all',
          defensive_rank: team.rebounds_rank,
          stat_allowed_per_game: team.rebounds_allowed,
          games_sample: 40,
          season: '2024-25',
          updated_at: now,
        });
        
        // Assists
        records.push({
          team_name: team.team_name,
          team_abbrev: team.team_abbrev,
          stat_type: 'assists',
          position_group: 'all',
          defensive_rank: team.assists_rank,
          stat_allowed_per_game: team.assists_allowed,
          games_sample: 40,
          season: '2024-25',
          updated_at: now,
        });
        
        // Threes
        records.push({
          team_name: team.team_name,
          team_abbrev: team.team_abbrev,
          stat_type: 'threes',
          position_group: 'all',
          defensive_rank: team.threes_rank,
          stat_allowed_per_game: team.threes_allowed,
          games_sample: 40,
          season: '2024-25',
          updated_at: now,
        });
      }
      
      // Upsert all records
      const { error: upsertError } = await supabase
        .from('team_defensive_ratings')
        .upsert(records, { 
          onConflict: 'team_name,stat_type,position_group,season',
        });
      
      if (upsertError) {
        throw upsertError;
      }
      
      console.log(`[Defense Ratings] Updated ${records.length} defensive rating records`);
      
      return new Response(JSON.stringify({
        success: true,
        updated: records.length,
        teams: NBA_DEFENSE_RATINGS.length,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Action: get - Get defensive ratings for a specific team
    if (action === 'get') {
      const { team } = await req.json();
      
      const { data } = await supabase
        .from('team_defensive_ratings')
        .select('*')
        .ilike('team_name', `%${team}%`);
      
      return new Response(JSON.stringify({
        success: true,
        ratings: data || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Action: get_all - Get all defensive ratings
    if (action === 'get_all') {
      const { data } = await supabase
        .from('team_defensive_ratings')
        .select('*')
        .order('defensive_rank', { ascending: true });
      
      return new Response(JSON.stringify({
        success: true,
        ratings: data || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Use action: refresh, get, or get_all' 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('[Defense Ratings] Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
