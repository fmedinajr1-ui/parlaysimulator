import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NHL Team abbreviations mapping
const NHL_TEAMS: Record<string, string> = {
  'Anaheim Ducks': 'ANA', 'Arizona Coyotes': 'ARI', 'Boston Bruins': 'BOS',
  'Buffalo Sabres': 'BUF', 'Calgary Flames': 'CGY', 'Carolina Hurricanes': 'CAR',
  'Chicago Blackhawks': 'CHI', 'Colorado Avalanche': 'COL', 'Columbus Blue Jackets': 'CBJ',
  'Dallas Stars': 'DAL', 'Detroit Red Wings': 'DET', 'Edmonton Oilers': 'EDM',
  'Florida Panthers': 'FLA', 'Los Angeles Kings': 'LAK', 'Minnesota Wild': 'MIN',
  'Montreal Canadiens': 'MTL', 'Nashville Predators': 'NSH', 'New Jersey Devils': 'NJD',
  'New York Islanders': 'NYI', 'New York Rangers': 'NYR', 'Ottawa Senators': 'OTT',
  'Philadelphia Flyers': 'PHI', 'Pittsburgh Penguins': 'PIT', 'San Jose Sharks': 'SJS',
  'Seattle Kraken': 'SEA', 'St. Louis Blues': 'STL', 'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR', 'Utah Hockey Club': 'UTA', 'Vancouver Canucks': 'VAN',
  'Vegas Golden Knights': 'VGK', 'Washington Capitals': 'WSH', 'Winnipeg Jets': 'WPG'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { daysBack = 30, teamAbbrev } = await req.json().catch(() => ({}));
    
    console.log(`Fetching NHL stats for last ${daysBack} days`);
    
    let playersInserted = 0;
    let gamesProcessed = 0;
    let totalPlayersFound = 0;
    const errors: string[] = [];

    // Get recent games from NHL schedule
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - daysBack);
    
    const scheduleUrl = `https://api-web.nhle.com/v1/schedule/${startDate.toISOString().split('T')[0]}`;
    console.log('Fetching schedule from:', scheduleUrl);
    
    const scheduleRes = await fetch(scheduleUrl);
    if (!scheduleRes.ok) {
      throw new Error(`Failed to fetch schedule: ${scheduleRes.status}`);
    }
    
    const scheduleData = await scheduleRes.json();
    const gameWeeks = scheduleData.gameWeek || [];
    
    // Collect all game IDs from the schedule
    const gameIds: number[] = [];
    for (const week of gameWeeks) {
      for (const game of week.games || []) {
        if (game.gameState === 'OFF' || game.gameState === 'FINAL') {
          gameIds.push(game.id);
        }
      }
    }
    
    console.log(`Found ${gameIds.length} completed games to process`);
    
    // Process up to 50 games for comprehensive data
    const gamesToProcess = gameIds.slice(0, 50);
    
    for (const gameId of gamesToProcess) {
      try {
        const boxscoreUrl = `https://api-web.nhle.com/v1/gamecenter/${gameId}/boxscore`;
        const boxRes = await fetch(boxscoreUrl);
        
        if (!boxRes.ok) {
          console.log(`Failed to fetch boxscore for game ${gameId}: ${boxRes.status}`);
          continue;
        }
        
        const boxData = await boxRes.json();
        const gameDate = boxData.gameDate;
        
        const homeTeam = boxData.homeTeam?.abbrev || '';
        const awayTeam = boxData.awayTeam?.abbrev || '';
        
        // Process home team players (forwards, defense, and goalies)
        const homeForwards = boxData.playerByGameStats?.homeTeam?.forwards || [];
        const homeDefense = boxData.playerByGameStats?.homeTeam?.defense || [];
        const homeGoalies = boxData.playerByGameStats?.homeTeam?.goalies || [];
        
        // Process away team players
        const awayForwards = boxData.playerByGameStats?.awayTeam?.forwards || [];
        const awayDefense = boxData.playerByGameStats?.awayTeam?.defense || [];
        const awayGoalies = boxData.playerByGameStats?.awayTeam?.goalies || [];
        
        const homePlayersAll = [...homeForwards, ...homeDefense];
        const awayPlayersAll = [...awayForwards, ...awayDefense];
        
        console.log(`Game ${gameId} (${awayTeam}@${homeTeam} on ${gameDate}): Home=${homePlayersAll.length} skaters, Away=${awayPlayersAll.length} skaters`);
        totalPlayersFound += homePlayersAll.length + awayPlayersAll.length;
        
        // Process home team skaters
        for (const player of homePlayersAll) {
          if (!player.name?.default) continue;
          
          const playerLog = {
            player_name: player.name.default,
            game_date: gameDate,
            opponent: awayTeam,
            is_home: true,
            minutes_played: parseTOI(player.toi),
            goals: player.goals || 0,
            assists: player.assists || 0,
            points: (player.goals || 0) + (player.assists || 0),
            shots_on_goal: player.sog || 0,
            blocked_shots: player.blockedShots || 0,
            power_play_points: player.powerPlayGoals || 0,
            plus_minus: player.plusMinus || 0,
            penalty_minutes: player.pim || 0,
          };
          
          const { error } = await supabase
            .from('nhl_player_game_logs')
            .upsert(playerLog, {
              onConflict: 'player_name,game_date',
              ignoreDuplicates: false
            });
          
          if (!error) playersInserted++;
          else console.log(`Error inserting ${player.name.default}: ${error.message}`);
        }
        
        // Process away team skaters
        for (const player of awayPlayersAll) {
          if (!player.name?.default) continue;
          
          const playerLog = {
            player_name: player.name.default,
            game_date: gameDate,
            opponent: homeTeam,
            is_home: false,
            minutes_played: parseTOI(player.toi),
            goals: player.goals || 0,
            assists: player.assists || 0,
            points: (player.goals || 0) + (player.assists || 0),
            shots_on_goal: player.sog || 0,
            blocked_shots: player.blockedShots || 0,
            power_play_points: player.powerPlayGoals || 0,
            plus_minus: player.plusMinus || 0,
            penalty_minutes: player.pim || 0,
          };
          
          const { error } = await supabase
            .from('nhl_player_game_logs')
            .upsert(playerLog, {
              onConflict: 'player_name,game_date',
              ignoreDuplicates: false
            });
          
          if (!error) playersInserted++;
          else console.log(`Error inserting ${player.name.default}: ${error.message}`);
        }
        
        gamesProcessed++;
        
        // Minimal delay for rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (gameError) {
        console.error(`Error processing game ${gameId}:`, gameError);
        errors.push(`Game ${gameId}: ${gameError}`);
      }
    }

    console.log(`NHL Stats Fetch Complete: ${gamesProcessed} games, ${totalPlayersFound} players found, ${playersInserted} logs inserted`);

    return new Response(
      JSON.stringify({
        success: true,
        gamesProcessed,
        playersInserted,
        totalPlayersFound,
        daysBack,
        errors: errors.slice(0, 5),
        message: `Fetched ${playersInserted} player game logs from ${gamesProcessed} NHL games (${daysBack} day lookback)`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('NHL Stats Fetcher Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        message: 'Failed to fetch NHL stats'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Parse time on ice string "MM:SS" to minutes
function parseTOI(toi: string | undefined): number {
  if (!toi) return 0;
  const parts = toi.split(':');
  if (parts.length !== 2) return 0;
  return parseInt(parts[0]) + parseInt(parts[1]) / 60;
}
