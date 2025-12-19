import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NHL team mappings
const NHL_TEAMS: Record<string, string> = {
  'ANA': 'Anaheim Ducks', 'ARI': 'Arizona Coyotes', 'BOS': 'Boston Bruins',
  'BUF': 'Buffalo Sabres', 'CGY': 'Calgary Flames', 'CAR': 'Carolina Hurricanes',
  'CHI': 'Chicago Blackhawks', 'COL': 'Colorado Avalanche', 'CBJ': 'Columbus Blue Jackets',
  'DAL': 'Dallas Stars', 'DET': 'Detroit Red Wings', 'EDM': 'Edmonton Oilers',
  'FLA': 'Florida Panthers', 'LA': 'Los Angeles Kings', 'MIN': 'Minnesota Wild',
  'MTL': 'Montreal Canadiens', 'NSH': 'Nashville Predators', 'NJ': 'New Jersey Devils',
  'NYI': 'New York Islanders', 'NYR': 'New York Rangers', 'OTT': 'Ottawa Senators',
  'PHI': 'Philadelphia Flyers', 'PIT': 'Pittsburgh Penguins', 'SJ': 'San Jose Sharks',
  'SEA': 'Seattle Kraken', 'STL': 'St. Louis Blues', 'TB': 'Tampa Bay Lightning',
  'TOR': 'Toronto Maple Leafs', 'UTA': 'Utah Hockey Club', 'VAN': 'Vancouver Canucks',
  'VGK': 'Vegas Golden Knights', 'WSH': 'Washington Capitals', 'WPG': 'Winnipeg Jets'
};

// Star players by team
const STAR_PLAYERS: Record<string, string[]> = {
  'Edmonton Oilers': ['Connor McDavid', 'Leon Draisaitl', 'Evan Bouchard'],
  'Colorado Avalanche': ['Nathan MacKinnon', 'Cale Makar', 'Mikko Rantanen'],
  'Toronto Maple Leafs': ['Auston Matthews', 'Mitch Marner', 'William Nylander'],
  'Tampa Bay Lightning': ['Nikita Kucherov', 'Brayden Point', 'Victor Hedman'],
  'Vegas Golden Knights': ['Jack Eichel', 'Mark Stone', 'Shea Theodore'],
  'Florida Panthers': ['Aleksander Barkov', 'Matthew Tkachuk', 'Sam Reinhart'],
  'New Jersey Devils': ['Jack Hughes', 'Jesper Bratt', 'Nico Hischier'],
  'Dallas Stars': ['Jason Robertson', 'Roope Hintz', 'Miro Heiskanen'],
  'New York Rangers': ['Artemi Panarin', 'Adam Fox', 'Igor Shesterkin'],
  'Boston Bruins': ['David Pastrnak', 'Brad Marchand', 'Charlie McAvoy'],
};

// Impact scores by position
const POSITION_IMPACT: Record<string, number> = {
  'G': 90, 'C': 75, 'RW': 65, 'LW': 65, 'D': 60
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[NHL Injuries] Starting injury fetch...');

    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY');
    if (!oddsApiKey) {
      throw new Error('THE_ODDS_API_KEY not configured');
    }

    // Get upcoming NHL games
    const gamesResponse = await fetch(
      `https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds/?apiKey=${oddsApiKey}&regions=us&markets=h2h`
    );

    if (!gamesResponse.ok) {
      console.log('[NHL Injuries] No NHL games available');
      return new Response(JSON.stringify({ success: true, injuries: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const games = await gamesResponse.json();
    console.log(`[NHL Injuries] Found ${games.length} upcoming NHL games`);

    // Get unique teams from upcoming games
    const teamsInGames = new Set<string>();
    for (const game of games) {
      teamsInGames.add(game.home_team);
      teamsInGames.add(game.away_team);
    }

    const injuries: any[] = [];
    const today = new Date().toISOString().split('T')[0];

    for (const [abbr, fullName] of Object.entries(NHL_TEAMS)) {
      if (!teamsInGames.has(fullName)) continue;

      try {
        // ESPN's public injury endpoint for NHL
        const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${abbr.toLowerCase()}/injuries`;
        const response = await fetch(espnUrl);
        
        if (!response.ok) {
          console.log(`[NHL Injuries] Could not fetch for ${abbr}`);
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
            impactScore = impactScore;
          } else if (status === 'Day-To-Day') {
            impactScore = impactScore * 0.6;
          } else if (status === 'Questionable') {
            impactScore = impactScore * 0.4;
          }

          injuries.push({
            sport: 'NHL',
            team_name: fullName,
            player_name: playerName,
            position: position,
            status: status.toUpperCase().replace(/ /g, '_'),
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
        console.log(`[NHL Injuries] Error fetching ${abbr}:`, teamError);
      }
    }

    console.log(`[NHL Injuries] Collected ${injuries.length} injuries`);

    if (injuries.length > 0) {
      await supabase
        .from('injury_reports')
        .delete()
        .eq('sport', 'NHL')
        .eq('game_date', today);

      const { error } = await supabase
        .from('injury_reports')
        .insert(injuries);

      if (error) {
        console.error('[NHL Injuries] Insert error:', error);
        throw error;
      }
    }

    await supabase.from('cron_job_history').insert({
      job_name: 'fetch-nhl-injuries',
      status: 'completed',
      result: { injuries_fetched: injuries.length, teams_checked: teamsInGames.size }
    });

    console.log(`[NHL Injuries] Successfully stored ${injuries.length} injuries`);

    return new Response(JSON.stringify({
      success: true,
      injuries: injuries.length,
      teams: teamsInGames.size
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[NHL Injuries] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
