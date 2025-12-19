import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NFL team mappings for matching
const NFL_TEAMS: Record<string, string> = {
  'ARI': 'Arizona Cardinals', 'ATL': 'Atlanta Falcons', 'BAL': 'Baltimore Ravens',
  'BUF': 'Buffalo Bills', 'CAR': 'Carolina Panthers', 'CHI': 'Chicago Bears',
  'CIN': 'Cincinnati Bengals', 'CLE': 'Cleveland Browns', 'DAL': 'Dallas Cowboys',
  'DEN': 'Denver Broncos', 'DET': 'Detroit Lions', 'GB': 'Green Bay Packers',
  'HOU': 'Houston Texans', 'IND': 'Indianapolis Colts', 'JAX': 'Jacksonville Jaguars',
  'KC': 'Kansas City Chiefs', 'LV': 'Las Vegas Raiders', 'LAC': 'Los Angeles Chargers',
  'LAR': 'Los Angeles Rams', 'MIA': 'Miami Dolphins', 'MIN': 'Minnesota Vikings',
  'NE': 'New England Patriots', 'NO': 'New Orleans Saints', 'NYG': 'New York Giants',
  'NYJ': 'New York Jets', 'PHI': 'Philadelphia Eagles', 'PIT': 'Pittsburgh Steelers',
  'SF': 'San Francisco 49ers', 'SEA': 'Seattle Seahawks', 'TB': 'Tampa Bay Buccaneers',
  'TEN': 'Tennessee Titans', 'WAS': 'Washington Commanders'
};

// Star players by team (QB, top RB, top WR/TE)
const STAR_PLAYERS: Record<string, string[]> = {
  'Kansas City Chiefs': ['Patrick Mahomes', 'Travis Kelce', 'Isiah Pacheco'],
  'Philadelphia Eagles': ['Jalen Hurts', 'AJ Brown', 'DeVonta Smith', 'Saquon Barkley'],
  'San Francisco 49ers': ['Brock Purdy', 'Christian McCaffrey', 'Deebo Samuel'],
  'Buffalo Bills': ['Josh Allen', 'Stefon Diggs', 'James Cook'],
  'Dallas Cowboys': ['Dak Prescott', 'CeeDee Lamb', 'Rico Dowdle'],
  'Miami Dolphins': ['Tua Tagovailoa', 'Tyreek Hill', 'Jaylen Waddle', 'De\'Von Achane'],
  'Detroit Lions': ['Jared Goff', 'Amon-Ra St. Brown', 'Jahmyr Gibbs', 'Sam LaPorta'],
  'Baltimore Ravens': ['Lamar Jackson', 'Derrick Henry', 'Zay Flowers', 'Mark Andrews'],
  'Cincinnati Bengals': ['Joe Burrow', 'Ja\'Marr Chase', 'Tee Higgins'],
  'Green Bay Packers': ['Jordan Love', 'Josh Jacobs', 'Jayden Reed'],
};

// Impact scores by position
const POSITION_IMPACT: Record<string, number> = {
  'QB': 95, 'RB': 70, 'WR': 65, 'TE': 55, 'LT': 50, 'RT': 45,
  'LG': 35, 'RG': 35, 'C': 40, 'DE': 45, 'DT': 40, 'LB': 45,
  'CB': 50, 'S': 45, 'K': 30, 'P': 20
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[NFL Injuries] Starting injury fetch...');

    // Get upcoming NFL games from The Odds API
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY');
    if (!oddsApiKey) {
      throw new Error('THE_ODDS_API_KEY not configured');
    }

    const gamesResponse = await fetch(
      `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${oddsApiKey}&regions=us&markets=h2h`
    );

    if (!gamesResponse.ok) {
      console.log('[NFL Injuries] No NFL games available');
      return new Response(JSON.stringify({ success: true, injuries: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const games = await gamesResponse.json();
    console.log(`[NFL Injuries] Found ${games.length} upcoming NFL games`);

    // Get unique teams from upcoming games
    const teamsInGames = new Set<string>();
    for (const game of games) {
      teamsInGames.add(game.home_team);
      teamsInGames.add(game.away_team);
    }

    // Fetch injury data from ESPN API (public endpoint)
    const injuries: any[] = [];
    const today = new Date().toISOString().split('T')[0];

    for (const [abbr, fullName] of Object.entries(NFL_TEAMS)) {
      if (!teamsInGames.has(fullName)) continue;

      try {
        // ESPN's public injury endpoint
        const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${abbr.toLowerCase()}/injuries`;
        const response = await fetch(espnUrl);
        
        if (!response.ok) {
          console.log(`[NFL Injuries] Could not fetch for ${abbr}`);
          continue;
        }

        const data = await response.json();
        const teamInjuries = data.injuries || [];

        for (const injury of teamInjuries) {
          const playerName = injury.athlete?.displayName || injury.athlete?.fullName || 'Unknown';
          const position = injury.athlete?.position?.abbreviation || 'Unknown';
          const status = injury.status || 'Unknown';
          const injuryType = injury.type?.description || injury.details?.type || 'Unknown';
          const injuryDetail = injury.details?.detail || injury.longComment || '';

          // Calculate impact score
          let impactScore = POSITION_IMPACT[position] || 30;
          
          // Star player bonus
          const isStarPlayer = STAR_PLAYERS[fullName]?.some(
            star => playerName.toLowerCase().includes(star.toLowerCase()) || 
                    star.toLowerCase().includes(playerName.toLowerCase())
          ) || false;
          
          if (isStarPlayer) {
            impactScore = Math.min(100, impactScore + 25);
          }

          // Status modifier
          if (status === 'Out' || status === 'Injured Reserve') {
            impactScore = impactScore; // Full impact
          } else if (status === 'Doubtful') {
            impactScore = impactScore * 0.85;
          } else if (status === 'Questionable') {
            impactScore = impactScore * 0.5;
          } else if (status === 'Probable') {
            impactScore = impactScore * 0.2;
          }

          injuries.push({
            sport: 'NFL',
            team_name: fullName,
            player_name: playerName,
            position: position,
            status: status.toUpperCase().replace(' ', '_'),
            injury_type: injuryType,
            injury_detail: injuryDetail,
            impact_score: Math.round(impactScore),
            is_star_player: isStarPlayer,
            game_date: today,
            source: 'espn'
          });
        }

        // Rate limit - be nice to ESPN
        await new Promise(r => setTimeout(r, 100));
        
      } catch (teamError) {
        console.log(`[NFL Injuries] Error fetching ${abbr}:`, teamError);
      }
    }

    console.log(`[NFL Injuries] Collected ${injuries.length} injuries`);

    // Upsert to unified injury_reports table
    if (injuries.length > 0) {
      // Delete old NFL injuries for today first
      await supabase
        .from('injury_reports')
        .delete()
        .eq('sport', 'NFL')
        .eq('game_date', today);

      // Insert new injuries
      const { error } = await supabase
        .from('injury_reports')
        .insert(injuries);

      if (error) {
        console.error('[NFL Injuries] Insert error:', error);
        throw error;
      }
    }

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'fetch-nfl-injuries',
      status: 'completed',
      result: { injuries_fetched: injuries.length, teams_checked: teamsInGames.size }
    });

    console.log(`[NFL Injuries] Successfully stored ${injuries.length} injuries`);

    return new Response(JSON.stringify({
      success: true,
      injuries: injuries.length,
      teams: teamsInGames.size
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[NFL Injuries] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
