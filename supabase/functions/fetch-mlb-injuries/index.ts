import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// EST-aware date helper
function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// MLB team mappings
const MLB_TEAMS: Record<string, string> = {
  'ARI': 'Arizona Diamondbacks', 'ATL': 'Atlanta Braves', 'BAL': 'Baltimore Orioles',
  'BOS': 'Boston Red Sox', 'CHC': 'Chicago Cubs', 'CWS': 'Chicago White Sox',
  'CIN': 'Cincinnati Reds', 'CLE': 'Cleveland Guardians', 'COL': 'Colorado Rockies',
  'DET': 'Detroit Tigers', 'HOU': 'Houston Astros', 'KC': 'Kansas City Royals',
  'LAA': 'Los Angeles Angels', 'LAD': 'Los Angeles Dodgers', 'MIA': 'Miami Marlins',
  'MIL': 'Milwaukee Brewers', 'MIN': 'Minnesota Twins', 'NYM': 'New York Mets',
  'NYY': 'New York Yankees', 'OAK': 'Oakland Athletics', 'PHI': 'Philadelphia Phillies',
  'PIT': 'Pittsburgh Pirates', 'SD': 'San Diego Padres', 'SF': 'San Francisco Giants',
  'SEA': 'Seattle Mariners', 'STL': 'St. Louis Cardinals', 'TB': 'Tampa Bay Rays',
  'TEX': 'Texas Rangers', 'TOR': 'Toronto Blue Jays', 'WSH': 'Washington Nationals'
};

// Star players by team
const STAR_PLAYERS: Record<string, string[]> = {
  'Los Angeles Dodgers': ['Shohei Ohtani', 'Mookie Betts', 'Freddie Freeman'],
  'Atlanta Braves': ['Ronald Acuña Jr.', 'Austin Riley', 'Ozzie Albies'],
  'New York Yankees': ['Aaron Judge', 'Juan Soto', 'Giancarlo Stanton'],
  'Philadelphia Phillies': ['Bryce Harper', 'Trea Turner', 'Kyle Schwarber'],
  'Houston Astros': ['Jose Altuve', 'Yordan Alvarez', 'Kyle Tucker'],
  'Texas Rangers': ['Corey Seager', 'Marcus Semien', 'Adolis García'],
  'Baltimore Orioles': ['Gunnar Henderson', 'Adley Rutschman', 'Corbin Burnes'],
  'San Diego Padres': ['Fernando Tatis Jr.', 'Manny Machado', 'Xander Bogaerts'],
  'Seattle Mariners': ['Julio Rodríguez', 'Cal Raleigh', 'Logan Gilbert'],
  'Cleveland Guardians': ['José Ramírez', 'Steven Kwan', 'Josh Naylor'],
};

// Impact scores by position
const POSITION_IMPACT: Record<string, number> = {
  'SP': 85, 'RP': 50, 'C': 55, '1B': 50, '2B': 55, '3B': 55, 
  'SS': 60, 'LF': 55, 'CF': 60, 'RF': 55, 'DH': 50
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[MLB Injuries] Starting injury fetch...');

    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY');
    if (!oddsApiKey) {
      throw new Error('THE_ODDS_API_KEY not configured');
    }

    // Get upcoming MLB games
    const gamesResponse = await fetch(
      `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${oddsApiKey}&regions=us&markets=h2h`
    );

    if (!gamesResponse.ok) {
      console.log('[MLB Injuries] No MLB games available');
      return new Response(JSON.stringify({ success: true, injuries: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const games = await gamesResponse.json();
    console.log(`[MLB Injuries] Found ${games.length} upcoming MLB games`);

    // Get unique teams from upcoming games
    const teamsInGames = new Set<string>();
    for (const game of games) {
      teamsInGames.add(game.home_team);
      teamsInGames.add(game.away_team);
    }

    const injuries: any[] = [];
    const today = getEasternDate();

    for (const [abbr, fullName] of Object.entries(MLB_TEAMS)) {
      if (!teamsInGames.has(fullName)) continue;

      try {
        // ESPN's public injury endpoint for MLB
        const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${abbr.toLowerCase()}/injuries`;
        const response = await fetch(espnUrl);
        
        if (!response.ok) {
          console.log(`[MLB Injuries] Could not fetch for ${abbr}`);
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

          // Status modifier - MLB uses IL designations
          if (status === '60-Day IL' || status === 'Out') {
            impactScore = impactScore;
          } else if (status === '15-Day IL' || status === '10-Day IL') {
            impactScore = impactScore * 0.9;
          } else if (status === 'Day-To-Day') {
            impactScore = impactScore * 0.5;
          } else if (status === 'Paternity') {
            impactScore = impactScore * 0.2;
          }

          injuries.push({
            sport: 'MLB',
            team_name: fullName,
            player_name: playerName,
            position: position,
            status: status.toUpperCase().replace(/ /g, '_').replace(/-/g, '_'),
            injury_type: injuryType,
            injury_detail: injuryDetail,
            impact_score: Math.round(impactScore),
            is_star_player: isStarPlayer,
            game_date: today,
            source: 'espn'
          });
        }

        await new Promise(r => setTimeout(r, 100));
        
      } catch (teamError) {
        console.log(`[MLB Injuries] Error fetching ${abbr}:`, teamError);
      }
    }

    console.log(`[MLB Injuries] Collected ${injuries.length} injuries`);

    if (injuries.length > 0) {
      await supabase
        .from('injury_reports')
        .delete()
        .eq('sport', 'MLB')
        .eq('game_date', today);

      const { error } = await supabase
        .from('injury_reports')
        .insert(injuries);

      if (error) {
        console.error('[MLB Injuries] Insert error:', error);
        throw error;
      }
    }

    await supabase.from('cron_job_history').insert({
      job_name: 'fetch-mlb-injuries',
      status: 'completed',
      result: { injuries_fetched: injuries.length, teams_checked: teamsInGames.size }
    });

    console.log(`[MLB Injuries] Successfully stored ${injuries.length} injuries`);

    return new Response(JSON.stringify({
      success: true,
      injuries: injuries.length,
      teams: teamsInGames.size
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[MLB Injuries] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
