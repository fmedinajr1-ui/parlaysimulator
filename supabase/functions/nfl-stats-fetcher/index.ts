import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// NFL team ID to abbreviation mapping for ESPN
const ESPN_NFL_TEAMS: Record<number, string> = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET',
  9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN',
  17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC',
  25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'
};

function getTeamAbbrev(teamId: number): string {
  return ESPN_NFL_TEAMS[teamId] || 'UNK';
}

function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

function getTrendDirection(seasonAvg: number, last5Avg: number): string {
  if (seasonAvg === 0) return 'stable';
  const pctChange = ((last5Avg - seasonAvg) / seasonAvg) * 100;
  if (pctChange > 15) return 'hot';
  if (pctChange < -15) return 'cold';
  return 'stable';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { mode = 'fetch_game_logs', weeksBack = 4 } = await req.json().catch(() => ({}));
    console.log(`[NFL Stats] Mode: ${mode}, WeeksBack: ${weeksBack}`);

    if (mode === 'fetch_game_logs') {
      // Fetch NFL game logs from ESPN API
      let playersInserted = 0;
      let gamesProcessed = 0;
      const errors: string[] = [];
      
      // Get current NFL season and week
      const seasonYear = new Date().getFullYear();
      const currentDate = new Date();
      
      // ESPN NFL Scoreboard endpoint - get recent completed games
      console.log('[NFL Stats] Fetching recent NFL games from ESPN...');
      
      // Fetch games for the past N weeks
      const allGameIds: string[] = [];
      
      for (let weekOffset = 0; weekOffset < weeksBack; weekOffset++) {
        const targetDate = new Date(currentDate);
        targetDate.setDate(targetDate.getDate() - (weekOffset * 7));
        const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
        
        try {
          const scoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${dateStr}`;
          console.log(`[NFL Stats] Fetching scoreboard for ${dateStr}`);
          
          const scoreboardRes = await fetch(scoreboardUrl);
          if (scoreboardRes.ok) {
            const scoreboardData = await scoreboardRes.json();
            const events = scoreboardData.events || [];
            
            for (const event of events) {
              // Only process completed games
              if (event.status?.type?.completed) {
                allGameIds.push(event.id);
              }
            }
          }
        } catch (e) {
          console.log(`[NFL Stats] Error fetching week ${weekOffset}:`, e);
        }
      }
      
      // Also try the current week's scoreboard
      try {
        const currentScoreboardUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`;
        const currentRes = await fetch(currentScoreboardUrl);
        if (currentRes.ok) {
          const currentData = await currentRes.json();
          for (const event of currentData.events || []) {
            if (event.status?.type?.completed && !allGameIds.includes(event.id)) {
              allGameIds.push(event.id);
            }
          }
        }
      } catch (e) {
        console.log('[NFL Stats] Error fetching current scoreboard:', e);
      }
      
      console.log(`[NFL Stats] Found ${allGameIds.length} completed games to process`);
      
      // Process each game's boxscore
      for (const gameId of allGameIds.slice(0, 30)) { // Limit to 30 games per run
        try {
          const boxscoreUrl = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${gameId}`;
          const boxRes = await fetch(boxscoreUrl);
          
          if (!boxRes.ok) {
            console.log(`[NFL Stats] Failed to fetch game ${gameId}: ${boxRes.status}`);
            continue;
          }
          
          const boxData = await boxRes.json();
          const gameDate = boxData.header?.competitions?.[0]?.date?.split('T')[0];
          
          if (!gameDate) {
            console.log(`[NFL Stats] No date for game ${gameId}`);
            continue;
          }
          
          const homeTeam = boxData.header?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'home');
          const awayTeam = boxData.header?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'away');
          
          const homeTeamAbbrev = homeTeam?.team?.abbreviation || 'UNK';
          const awayTeamAbbrev = awayTeam?.team?.abbreviation || 'UNK';
          
          console.log(`[NFL Stats] Processing ${awayTeamAbbrev} @ ${homeTeamAbbrev} (${gameDate})`);
          
          // Get player stats from boxscore
          const boxscore = boxData.boxscore;
          if (!boxscore?.players) {
            console.log(`[NFL Stats] No player stats for game ${gameId}`);
            continue;
          }
          
          // Process each team's players
          for (const teamStats of boxscore.players) {
            const teamId = teamStats.team?.id;
            const teamAbbrev = teamStats.team?.abbreviation || getTeamAbbrev(parseInt(teamId));
            const isHome = teamAbbrev === homeTeamAbbrev;
            const opponent = isHome ? awayTeamAbbrev : homeTeamAbbrev;
            
            // Process statistics categories
            const passingStats: Record<string, any> = {};
            const rushingStats: Record<string, any> = {};
            const receivingStats: Record<string, any> = {};
            
            for (const category of teamStats.statistics || []) {
              const categoryName = category.name?.toLowerCase();
              
              for (const athlete of category.athletes || []) {
                const playerName = athlete.athlete?.displayName;
                if (!playerName) continue;
                
                const stats = athlete.stats || [];
                
                if (categoryName === 'passing' && stats.length >= 8) {
                  // Passing: C/ATT, YDS, AVG, TD, INT, SACKS, QBR, RTG
                  const completionsAttempts = stats[0]?.split('/') || ['0', '0'];
                  passingStats[playerName] = {
                    completions: parseInt(completionsAttempts[0]) || 0,
                    attempts: parseInt(completionsAttempts[1]) || 0,
                    passing_yards: parseInt(stats[1]) || 0,
                    passing_tds: parseInt(stats[3]) || 0,
                    interceptions: parseInt(stats[4]) || 0,
                  };
                }
                
                if (categoryName === 'rushing' && stats.length >= 4) {
                  // Rushing: CAR, YDS, AVG, TD, LONG
                  rushingStats[playerName] = {
                    rush_attempts: parseInt(stats[0]) || 0,
                    rushing_yards: parseInt(stats[1]) || 0,
                    rushing_tds: parseInt(stats[3]) || 0,
                  };
                }
                
                if (categoryName === 'receiving' && stats.length >= 5) {
                  // Receiving: REC, YDS, AVG, TD, LONG, TGTS
                  receivingStats[playerName] = {
                    receptions: parseInt(stats[0]) || 0,
                    receiving_yards: parseInt(stats[1]) || 0,
                    receiving_tds: parseInt(stats[3]) || 0,
                    targets: parseInt(stats[5]) || 0,
                  };
                }
              }
            }
            
            // Combine stats and insert
            const allPlayers = new Set([
              ...Object.keys(passingStats),
              ...Object.keys(rushingStats),
              ...Object.keys(receivingStats)
            ]);
            
            for (const playerName of allPlayers) {
              const passing = passingStats[playerName] || {};
              const rushing = rushingStats[playerName] || {};
              const receiving = receivingStats[playerName] || {};
              
              const playerLog = {
                player_name: playerName,
                game_date: gameDate,
                opponent,
                team: teamAbbrev,
                is_home: isHome,
                completions: passing.completions || 0,
                attempts: passing.attempts || 0,
                passing_yards: passing.passing_yards || 0,
                passing_tds: passing.passing_tds || 0,
                interceptions: passing.interceptions || 0,
                rushing_yards: rushing.rushing_yards || 0,
                rushing_tds: rushing.rushing_tds || 0,
                receptions: receiving.receptions || 0,
                receiving_yards: receiving.receiving_yards || 0,
                receiving_tds: receiving.receiving_tds || 0,
                targets: receiving.targets || 0,
              };
              
              const { error } = await supabase
                .from('nfl_player_game_logs')
                .upsert(playerLog, {
                  onConflict: 'player_name,game_date',
                  ignoreDuplicates: false
                });
              
              if (!error) {
                playersInserted++;
              } else {
                console.log(`[NFL Stats] Error inserting ${playerName}: ${error.message}`);
              }
            }
          }
          
          gamesProcessed++;
          
          // Rate limit delay
          await new Promise(resolve => setTimeout(resolve, 200));
          
        } catch (gameError) {
          console.error(`[NFL Stats] Error processing game ${gameId}:`, gameError);
          errors.push(`Game ${gameId}: ${gameError}`);
        }
      }
      
      console.log(`[NFL Stats] Fetch complete: ${gamesProcessed} games, ${playersInserted} player logs`);
      
      // Now calculate season stats
      if (playersInserted > 0) {
        console.log('[NFL Stats] Calculating season stats...');
        
        const { data: players } = await supabase
          .from('nfl_player_game_logs')
          .select('player_name')
          .order('player_name');
        
        const uniquePlayers = [...new Set(players?.map(p => p.player_name) || [])];
        let statsCalculated = 0;
        
        for (const playerName of uniquePlayers) {
          const { data: gameLogs } = await supabase
            .from('nfl_player_game_logs')
            .select('*')
            .eq('player_name', playerName)
            .order('game_date', { ascending: false });

          if (!gameLogs || gameLogs.length < 2) continue;

          const homeGames = gameLogs.filter(g => g.is_home);
          const awayGames = gameLogs.filter(g => !g.is_home);
          const last5 = gameLogs.slice(0, 5);

          const passingYards = gameLogs.map(g => g.passing_yards || 0);
          const rushingYards = gameLogs.map(g => g.rushing_yards || 0);
          const receptions = gameLogs.map(g => g.receptions || 0);
          const receivingYards = gameLogs.map(g => g.receiving_yards || 0);
          const passingTds = gameLogs.map(g => g.passing_tds || 0);

          const seasonStats = {
            player_name: playerName,
            team: gameLogs[0]?.team || null,
            games_played: gameLogs.length,
            passing_yards_avg: passingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
            passing_yards_std: calculateStdDev(passingYards),
            passing_tds_avg: passingTds.reduce((a, b) => a + b, 0) / gameLogs.length,
            rushing_yards_avg: rushingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
            rushing_yards_std: calculateStdDev(rushingYards),
            receptions_avg: receptions.reduce((a, b) => a + b, 0) / gameLogs.length,
            receptions_std: calculateStdDev(receptions),
            receiving_yards_avg: receivingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
            receiving_yards_std: calculateStdDev(receivingYards),
            home_passing_yards_avg: homeGames.length > 0 ? homeGames.reduce((a, g) => a + (g.passing_yards || 0), 0) / homeGames.length : 0,
            away_passing_yards_avg: awayGames.length > 0 ? awayGames.reduce((a, g) => a + (g.passing_yards || 0), 0) / awayGames.length : 0,
            home_rushing_yards_avg: homeGames.length > 0 ? homeGames.reduce((a, g) => a + (g.rushing_yards || 0), 0) / homeGames.length : 0,
            away_rushing_yards_avg: awayGames.length > 0 ? awayGames.reduce((a, g) => a + (g.rushing_yards || 0), 0) / awayGames.length : 0,
            home_receptions_avg: homeGames.length > 0 ? homeGames.reduce((a, g) => a + (g.receptions || 0), 0) / homeGames.length : 0,
            away_receptions_avg: awayGames.length > 0 ? awayGames.reduce((a, g) => a + (g.receptions || 0), 0) / awayGames.length : 0,
            last10_passing_yards_avg: last5.reduce((a, g) => a + (g.passing_yards || 0), 0) / Math.max(last5.length, 1),
            last10_rushing_yards_avg: last5.reduce((a, g) => a + (g.rushing_yards || 0), 0) / Math.max(last5.length, 1),
            last10_receptions_avg: last5.reduce((a, g) => a + (g.receptions || 0), 0) / Math.max(last5.length, 1),
            consistency_score: 100 - Math.min(100, (calculateStdDev(passingYards) + calculateStdDev(rushingYards) + calculateStdDev(receptions)) / 3),
            trend_direction: getTrendDirection(
              passingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
              last5.reduce((a, g) => a + (g.passing_yards || 0), 0) / Math.max(last5.length, 1)
            ),
            updated_at: new Date().toISOString(),
          };

          await supabase
            .from('nfl_player_season_stats')
            .upsert(seasonStats, { onConflict: 'player_name' });
          
          statsCalculated++;
        }
        
        console.log(`[NFL Stats] Calculated season stats for ${statsCalculated} players`);
      }
      
      // Log job history
      await supabase.from('cron_job_history').insert({
        job_name: 'nfl-stats-fetcher',
        status: 'completed',
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        result: { 
          mode, 
          gamesProcessed, 
          playersInserted,
          errors: errors.slice(0, 5)
        },
      });

      return new Response(JSON.stringify({
        success: true,
        mode,
        gamesProcessed,
        playersInserted,
        errors: errors.slice(0, 5),
        duration: Date.now() - startTime,
        message: `Fetched ${playersInserted} NFL player logs from ${gamesProcessed} games`
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (mode === 'calculate_season_stats') {
      // Calculate season stats from existing game logs
      const { data: players } = await supabase
        .from('nfl_player_game_logs')
        .select('player_name')
        .order('player_name');
      
      const uniquePlayers = [...new Set(players?.map(p => p.player_name) || [])];
      console.log(`[NFL Stats] Calculating season stats for ${uniquePlayers.length} players`);

      let processed = 0;
      for (const playerName of uniquePlayers) {
        const { data: gameLogs } = await supabase
          .from('nfl_player_game_logs')
          .select('*')
          .eq('player_name', playerName)
          .order('game_date', { ascending: false });

        if (!gameLogs || gameLogs.length < 2) continue;

        const homeGames = gameLogs.filter(g => g.is_home);
        const awayGames = gameLogs.filter(g => !g.is_home);
        const last5 = gameLogs.slice(0, 5);

        const passingYards = gameLogs.map(g => g.passing_yards || 0);
        const rushingYards = gameLogs.map(g => g.rushing_yards || 0);
        const receptions = gameLogs.map(g => g.receptions || 0);
        const receivingYards = gameLogs.map(g => g.receiving_yards || 0);
        const passingTds = gameLogs.map(g => g.passing_tds || 0);

        const seasonStats = {
          player_name: playerName,
          team: gameLogs[0]?.team || null,
          games_played: gameLogs.length,
          passing_yards_avg: passingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
          passing_yards_std: calculateStdDev(passingYards),
          passing_tds_avg: passingTds.reduce((a, b) => a + b, 0) / gameLogs.length,
          rushing_yards_avg: rushingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
          rushing_yards_std: calculateStdDev(rushingYards),
          receptions_avg: receptions.reduce((a, b) => a + b, 0) / gameLogs.length,
          receptions_std: calculateStdDev(receptions),
          receiving_yards_avg: receivingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
          receiving_yards_std: calculateStdDev(receivingYards),
          home_passing_yards_avg: homeGames.length > 0 ? homeGames.reduce((a, g) => a + (g.passing_yards || 0), 0) / homeGames.length : 0,
          away_passing_yards_avg: awayGames.length > 0 ? awayGames.reduce((a, g) => a + (g.passing_yards || 0), 0) / awayGames.length : 0,
          home_rushing_yards_avg: homeGames.length > 0 ? homeGames.reduce((a, g) => a + (g.rushing_yards || 0), 0) / homeGames.length : 0,
          away_rushing_yards_avg: awayGames.length > 0 ? awayGames.reduce((a, g) => a + (g.rushing_yards || 0), 0) / awayGames.length : 0,
          home_receptions_avg: homeGames.length > 0 ? homeGames.reduce((a, g) => a + (g.receptions || 0), 0) / homeGames.length : 0,
          away_receptions_avg: awayGames.length > 0 ? awayGames.reduce((a, g) => a + (g.receptions || 0), 0) / awayGames.length : 0,
          last10_passing_yards_avg: last5.reduce((a, g) => a + (g.passing_yards || 0), 0) / Math.max(last5.length, 1),
          last10_rushing_yards_avg: last5.reduce((a, g) => a + (g.rushing_yards || 0), 0) / Math.max(last5.length, 1),
          last10_receptions_avg: last5.reduce((a, g) => a + (g.receptions || 0), 0) / Math.max(last5.length, 1),
          consistency_score: 100 - Math.min(100, (calculateStdDev(passingYards) + calculateStdDev(rushingYards) + calculateStdDev(receptions)) / 3),
          trend_direction: getTrendDirection(
            passingYards.reduce((a, b) => a + b, 0) / gameLogs.length,
            last5.reduce((a, g) => a + (g.passing_yards || 0), 0) / Math.max(last5.length, 1)
          ),
          updated_at: new Date().toISOString(),
        };

        await supabase
          .from('nfl_player_season_stats')
          .upsert(seasonStats, { onConflict: 'player_name' });
        
        processed++;
      }

      console.log(`[NFL Stats] Calculated season stats for ${processed} players`);

      return new Response(JSON.stringify({
        success: true,
        mode,
        playersProcessed: processed,
        duration: Date.now() - startTime,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid mode. Use fetch_game_logs or calculate_season_stats',
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[NFL Stats] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
