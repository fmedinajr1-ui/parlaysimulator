import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NHL_API = "https://api-web.nhle.com/v1";
const ESPN_NHL_API = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl";

function parseTOI(toi: string | undefined): number {
  if (!toi) return 0;
  const parts = toi.split(':');
  if (parts.length !== 2) return 0;
  return parseInt(parts[0]) + parseInt(parts[1]) / 60;
}

async function fetchESPNGameLogs(daysBack: number = 7): Promise<{ skaterLogs: any[], goalieLogs: any[] }> {
  const skaterLogs: any[] = [];
  const goalieLogs: any[] = [];

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
        const homeScore = parseInt(homeTeam?.score) || 0;
        const awayScore = parseInt(awayTeam?.score) || 0;

        const boxscore = boxData.boxscore;
        if (!boxscore?.players) continue;

        for (const teamStats of boxscore.players) {
          const teamAbbrev = teamStats.team?.abbreviation || 'UNK';
          const isHome = teamAbbrev === homeTeamAbbrev;
          const opponent = isHome ? awayTeamAbbrev : homeTeamAbbrev;
          const teamWon = isHome ? homeScore > awayScore : awayScore > homeScore;
          const opponentScore = isHome ? awayScore : homeScore;

          for (const category of teamStats.statistics || []) {
            const categoryName = category.name?.toLowerCase();

            // Skaters (forwards + defensemen)
            if (categoryName === 'forwards' || categoryName === 'defensemen') {
              for (const athlete of category.athletes || []) {
                const playerName = athlete.athlete?.displayName;
                if (!playerName) continue;
                const stats = athlete.stats || [];
                let toi = 0;
                if (stats[7]) {
                  const toiParts = stats[7].split(':');
                  toi = parseInt(toiParts[0]) || 0;
                  if (toiParts[1]) toi += parseInt(toiParts[1]) / 60;
                }
                skaterLogs.push({
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

            // Goalies
            if (categoryName === 'goaltenders' || categoryName === 'goalies') {
              for (const athlete of category.athletes || []) {
                const playerName = athlete.athlete?.displayName;
                if (!playerName) continue;
                const stats = athlete.stats || [];
                // ESPN goalie stats order: SA, GA, SV, SV%, TOI (may vary)
                // Log first goalie to confirm mapping
                if (goalieLogs.length === 0) {
                  console.log(`[ESPN NHL] First goalie stats sample for ${playerName}:`, JSON.stringify(stats));
                }

                // ESPN goalie stat sample: ["GA","SA","0","0","SV","SV%","W","L","0","TOI","0","0"]
                // Index: 0=GA, 1=SA, 4=SV, 5=SV%, 9=TOI
                const goalsAgainst = parseInt(stats[0]) || 0;
                const shotsAgainst = parseInt(stats[1]) || 0;
                const saves = parseInt(stats[4]) || 0;
                const savePctStr = stats[5] || '0';
                const savePct = parseFloat(savePctStr) || (shotsAgainst > 0 ? saves / shotsAgainst : 0);

                let toiMinutes = 0;
                const toiStr = stats[9] || stats[4] || '';
                if (toiStr && toiStr.includes(':')) {
                  const toiParts = toiStr.split(':');
                  toiMinutes = parseInt(toiParts[0]) || 0;
                  if (toiParts[1]) toiMinutes += parseInt(toiParts[1]) / 60;
                }

                goalieLogs.push({
                  player_name: playerName,
                  game_date: gameDate,
                  opponent,
                  is_home: isHome,
                  saves,
                  shots_against: shotsAgainst,
                  goals_against: goalsAgainst,
                  save_pct: Math.round(savePct * 1000) / 1000,
                  minutes_played: Math.round(toiMinutes),
                  win: teamWon,
                  shutout: goalsAgainst === 0 && toiMinutes >= 55,
                });
              }
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (gameError) {
        console.error(`[ESPN NHL] Error processing game ${gameId}:`, gameError);
      }
    }

    console.log(`[ESPN NHL] Extracted ${skaterLogs.length} skater logs, ${goalieLogs.length} goalie logs`);
  } catch (error) {
    console.error('[ESPN NHL] Fatal error:', error);
  }

  return { skaterLogs, goalieLogs };
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
    let goaliesInserted = 0;
    let gamesProcessed = 0;
    let totalPlayersFound = 0;
    let espnRecords = 0;
    const errors: string[] = [];

    // ESPN (primary)
    if (useESPN) {
      console.log('[NHL Stats Fetcher] Fetching from ESPN API (primary)...');
      const { skaterLogs, goalieLogs } = await fetchESPNGameLogs(daysBack);

      if (skaterLogs.length > 0) {
        const { error: skaterError } = await supabase
          .from('nhl_player_game_logs')
          .upsert(skaterLogs, { onConflict: 'player_name,game_date', ignoreDuplicates: false });
        if (skaterError) {
          console.error('[NHL Stats Fetcher] ESPN skater insert error:', skaterError);
          errors.push(skaterError.message);
        } else {
          espnRecords += skaterLogs.length;
          playersInserted += skaterLogs.length;
        }
      }

      if (goalieLogs.length > 0) {
        const { error: goalieError } = await supabase
          .from('nhl_goalie_game_logs')
          .upsert(goalieLogs, { onConflict: 'player_name,game_date', ignoreDuplicates: false });
        if (goalieError) {
          console.error('[NHL Stats Fetcher] ESPN goalie insert error:', goalieError);
          errors.push(goalieError.message);
        } else {
          goaliesInserted += goalieLogs.length;
        }
      }
    }

    // NHL API (secondary) — skaters + goalies
    console.log('[NHL Stats Fetcher] Fetching from NHL API (secondary)...');
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - daysBack);

    const scheduleUrl = `${NHL_API}/schedule/${startDate.toISOString().split('T')[0]}`;
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
          const homeScore = boxData.homeTeam?.score || 0;
          const awayScore = boxData.awayTeam?.score || 0;

          // Process skaters
          const processSkaters = async (players: any[], opponent: string, isHome: boolean) => {
            for (const player of players) {
              if (!player.name?.default) continue;
              const { error } = await supabase
                .from('nhl_player_game_logs')
                .upsert({
                  player_name: player.name.default,
                  game_date: gameDate,
                  opponent,
                  is_home: isHome,
                  minutes_played: parseTOI(player.toi),
                  goals: player.goals || 0,
                  assists: player.assists || 0,
                  points: (player.goals || 0) + (player.assists || 0),
                  shots_on_goal: player.sog || 0,
                  blocked_shots: player.blockedShots || 0,
                  power_play_points: player.powerPlayGoals || 0,
                  plus_minus: player.plusMinus || 0,
                  penalty_minutes: player.pim || 0,
                }, { onConflict: 'player_name,game_date', ignoreDuplicates: false });
              if (!error) playersInserted++;
            }
          };

          // Process goalies
          const processGoalies = async (goalies: any[], opponent: string, isHome: boolean, teamWon: boolean) => {
            for (const goalie of goalies) {
              if (!goalie.name?.default) continue;
              const savesCount = goalie.saveShotsAgainst ? parseInt(goalie.saveShotsAgainst.split('/')[0]) || 0 : (goalie.saves || 0);
              const shotsAgainst = goalie.shotsAgainst || goalie.saveShotsAgainst ? parseInt((goalie.saveShotsAgainst || '0/0').split('/')[1]) || 0 : 0;
              const goalsAgainst = goalie.goalsAgainst || (shotsAgainst - savesCount);
              const toiMinutes = parseTOI(goalie.toi);
              const savePct = shotsAgainst > 0 ? savesCount / shotsAgainst : 0;

              const { error } = await supabase
                .from('nhl_goalie_game_logs')
                .upsert({
                  player_name: goalie.name.default,
                  game_date: gameDate,
                  opponent,
                  is_home: isHome,
                  saves: savesCount,
                  shots_against: shotsAgainst,
                  goals_against: goalsAgainst,
                  save_pct: Math.round(savePct * 1000) / 1000,
                  minutes_played: Math.round(toiMinutes),
                  win: teamWon,
                  shutout: goalsAgainst === 0 && toiMinutes >= 55,
                }, { onConflict: 'player_name,game_date', ignoreDuplicates: false });
              if (!error) goaliesInserted++;
            }
          };

          const homeForwards = boxData.playerByGameStats?.homeTeam?.forwards || [];
          const homeDefense = boxData.playerByGameStats?.homeTeam?.defense || [];
          const homeGoalies = boxData.playerByGameStats?.homeTeam?.goalies || [];
          const awayForwards = boxData.playerByGameStats?.awayTeam?.forwards || [];
          const awayDefense = boxData.playerByGameStats?.awayTeam?.defense || [];
          const awayGoalies = boxData.playerByGameStats?.awayTeam?.goalies || [];

          totalPlayersFound += homeForwards.length + homeDefense.length + awayForwards.length + awayDefense.length + homeGoalies.length + awayGoalies.length;

          await processSkaters([...homeForwards, ...homeDefense], awayTeam, true);
          await processSkaters([...awayForwards, ...awayDefense], homeTeam, false);
          await processGoalies(homeGoalies, awayTeam, true, homeScore > awayScore);
          await processGoalies(awayGoalies, homeTeam, false, awayScore > homeScore);

          gamesProcessed++;
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (gameError) {
          console.error(`[NHL Stats Fetcher] Error processing game ${gameId}:`, gameError);
          errors.push(`Game ${gameId}: ${gameError}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[NHL Stats Fetcher] Complete: ${gamesProcessed} games, ${playersInserted} skater logs, ${goaliesInserted} goalie logs, ${espnRecords} ESPN records`);

    await supabase.from('cron_job_history').insert({
      job_name: 'nhl-stats-fetcher',
      status: errors.length > 0 ? 'partial' : 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { gamesProcessed, playersInserted, goaliesInserted, espnRecords, totalPlayersFound, errors: errors.slice(0, 5) },
    });

    return new Response(
      JSON.stringify({
        success: true,
        gamesProcessed,
        playersInserted,
        goaliesInserted,
        espnRecords,
        totalPlayersFound,
        daysBack,
        duration,
        errors: errors.slice(0, 5),
        message: `Fetched ${playersInserted} skater + ${goaliesInserted} goalie logs from ${gamesProcessed} NHL games`
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
