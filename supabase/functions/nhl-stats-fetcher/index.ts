import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NHL_API = "https://api-web.nhle.com/v1";
const ESPN_NHL_API = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl";

// Parse time on ice string "MM:SS" to minutes
function parseTOI(toi: string | undefined): number {
  if (!toi) return 0;
  const parts = toi.split(':');
  if (parts.length !== 2) return 0;
  return parseInt(parts[0]) + parseInt(parts[1]) / 60;
}

// ESPN backup fetcher for NHL stats
async function fetchESPNGameLogs(daysBack: number = 7): Promise<any[]> {
  const gameLogRecords: any[] = [];
  
  try {
    console.log(`[ESPN NHL] Fetching game logs for last ${daysBack} days...`);
    
    const allGameIds: string[] = [];
    
    for (let dayOffset = 0; dayOffset < daysBack; dayOffset++) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - dayOffset);
      const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
      
      try {
        const scoreboardUrl = `${ESPN_NHL_API}/scoreboard?dates=${dateStr}`;
        const scoreboardRes = await fetch(scoreboardUrl);
        
        if (scoreboardRes.ok) {
          const scoreboardData = await scoreboardRes.json();
          const events = scoreboardData.events || [];
          
          for (const event of events) {
            if (event.status?.type?.completed) {
              allGameIds.push(event.id);
            }
          }
        }
      } catch (e) {
        console.log(`[ESPN NHL] Error fetching day ${dayOffset}:`, e);
      }
    }
    
    console.log(`[ESPN NHL] Found ${allGameIds.length} completed games`);
    
    for (const gameId of allGameIds.slice(0, 25)) {
      try {
        const boxscoreUrl = `${ESPN_NHL_API}/summary?event=${gameId}`;
        const boxRes = await fetch(boxscoreUrl);
        
        if (!boxRes.ok) continue;
        
        const boxData = await boxRes.json();
        const gameDate = boxData.header?.competitions?.[0]?.date?.split('T')[0];
        
        if (!gameDate) continue;
        
        const homeTeam = boxData.header?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'home');
        const awayTeam = boxData.header?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'away');
        
        const homeTeamAbbrev = homeTeam?.team?.abbreviation || 'UNK';
        const awayTeamAbbrev = awayTeam?.team?.abbreviation || 'UNK';
        
        const boxscore = boxData.boxscore;
        if (!boxscore?.players) continue;
        
        for (const teamStats of boxscore.players) {
          const teamAbbrev = teamStats.team?.abbreviation || 'UNK';
          const isHome = teamAbbrev === homeTeamAbbrev;
          const opponent = isHome ? awayTeamAbbrev : homeTeamAbbrev;
          
          for (const category of teamStats.statistics || []) {
            const categoryName = category.name?.toLowerCase();
            if (categoryName !== 'forwards' && categoryName !== 'defensemen') continue;
            
            for (const athlete of category.athletes || []) {
              const playerName = athlete.athlete?.displayName;
              if (!playerName) continue;
              
              const stats = athlete.stats || [];
              // ESPN NHL stats: G, A, +/-, SOG, PPG, SHG, GWG, TOI, FO%
              
              let toi = 0;
              if (stats[7]) {
                const toiParts = stats[7].split(':');
                toi = parseInt(toiParts[0]) || 0;
                if (toiParts[1]) toi += parseInt(toiParts[1]) / 60;
              }
              
              gameLogRecords.push({
                player_name: playerName,
                game_date: gameDate,
                opponent,
                is_home: isHome,
                goals: parseInt(stats[0]) || 0,
                assists: parseInt(stats[1]) || 0,
                points: (parseInt(stats[0]) || 0) + (parseInt(stats[1]) || 0),
                plus_minus: parseInt(stats[2]) || 0,
                shots_on_goal: parseInt(stats[3]) || 0,
                power_play_points: parseInt(stats[4]) || 0,
                minutes_played: Math.round(toi),
                blocked_shots: 0,
                penalty_minutes: 0,
              });
            }
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (gameError) {
        console.error(`[ESPN NHL] Error processing game ${gameId}:`, gameError);
      }
    }
    
    console.log(`[ESPN NHL] Extracted ${gameLogRecords.length} player game logs`);
  } catch (error) {
    console.error('[ESPN NHL] Fatal error:', error);
  }
  
  return gameLogRecords;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { daysBack = 14, useESPN = true, teamAbbrev } = await req.json().catch(() => ({}));
    
    console.log(`[NHL Stats Fetcher] Fetching stats for last ${daysBack} days, useESPN: ${useESPN}`);
    
    let playersInserted = 0;
    let gamesProcessed = 0;
    let totalPlayersFound = 0;
    let espnRecords = 0;
    const errors: string[] = [];

    // First try ESPN (more reliable)
    if (useESPN) {
      console.log('[NHL Stats Fetcher] Fetching from ESPN API (primary)...');
      const espnLogs = await fetchESPNGameLogs(daysBack);
      
      if (espnLogs.length > 0) {
        const { error: espnError } = await supabase
          .from('nhl_player_game_logs')
          .upsert(espnLogs, { 
            onConflict: 'player_name,game_date',
            ignoreDuplicates: false 
          });
        
        if (espnError) {
          console.error('[NHL Stats Fetcher] ESPN insert error:', espnError);
          errors.push(espnError.message);
        } else {
          espnRecords = espnLogs.length;
          playersInserted += espnLogs.length;
        }
      }
    }

    // NHL API as secondary source for more detailed data
    console.log('[NHL Stats Fetcher] Fetching from NHL API (secondary)...');
    
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - daysBack);
    
    const scheduleUrl = `${NHL_API}/schedule/${startDate.toISOString().split('T')[0]}`;
    console.log('[NHL Stats Fetcher] Fetching schedule from:', scheduleUrl);
    
    const scheduleRes = await fetch(scheduleUrl);
    if (!scheduleRes.ok) {
      console.log(`[NHL Stats Fetcher] Schedule fetch failed: ${scheduleRes.status}`);
    } else {
      const scheduleData = await scheduleRes.json();
      const gameWeeks = scheduleData.gameWeek || [];
      
      const gameIds: number[] = [];
      for (const week of gameWeeks) {
        for (const game of week.games || []) {
          if (game.gameState === 'OFF' || game.gameState === 'FINAL') {
            gameIds.push(game.id);
          }
        }
      }
      
      console.log(`[NHL Stats Fetcher] Found ${gameIds.length} completed games from NHL API`);
      
      for (const gameId of gameIds.slice(0, 50)) {
        try {
          const boxscoreUrl = `${NHL_API}/gamecenter/${gameId}/boxscore`;
          const boxRes = await fetch(boxscoreUrl);
          
          if (!boxRes.ok) continue;
          
          const boxData = await boxRes.json();
          const gameDate = boxData.gameDate;
          
          const homeTeam = boxData.homeTeam?.abbrev || '';
          const awayTeam = boxData.awayTeam?.abbrev || '';
          
          const homeForwards = boxData.playerByGameStats?.homeTeam?.forwards || [];
          const homeDefense = boxData.playerByGameStats?.homeTeam?.defense || [];
          const awayForwards = boxData.playerByGameStats?.awayTeam?.forwards || [];
          const awayDefense = boxData.playerByGameStats?.awayTeam?.defense || [];
          
          const homePlayersAll = [...homeForwards, ...homeDefense];
          const awayPlayersAll = [...awayForwards, ...awayDefense];
          
          totalPlayersFound += homePlayersAll.length + awayPlayersAll.length;
          
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
          }
          
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
          }
          
          gamesProcessed++;
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (gameError) {
          console.error(`[NHL Stats Fetcher] Error processing game ${gameId}:`, gameError);
          errors.push(`Game ${gameId}: ${gameError}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[NHL Stats Fetcher] Complete: ${gamesProcessed} games, ${playersInserted} logs, ${espnRecords} ESPN records`);

    await supabase.from('cron_job_history').insert({
      job_name: 'nhl-stats-fetcher',
      status: errors.length > 0 ? 'partial' : 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { gamesProcessed, playersInserted, espnRecords, totalPlayersFound, errors: errors.slice(0, 5) },
    });

    return new Response(
      JSON.stringify({
        success: true,
        gamesProcessed,
        playersInserted,
        espnRecords,
        totalPlayersFound,
        daysBack,
        duration,
        errors: errors.slice(0, 5),
        message: `Fetched ${playersInserted} player game logs from ${gamesProcessed} NHL games`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[NHL Stats Fetcher] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from('cron_job_history').insert({
        job_name: 'nhl-stats-fetcher',
        status: 'failed',
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        error_message: errorMessage,
      });
    }
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
