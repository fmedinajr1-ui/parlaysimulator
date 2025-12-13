import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BDL_API_BASE = "https://api.balldontlie.io/v1";
const ESPN_NBA_API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard";

interface PlayerStats {
  player_name: string;
  game_date: string;
  opponent: string;
  points: number;
  rebounds: number;
  assists: number;
  threes_made: number;
  blocks: number;
  steals: number;
  is_home: boolean;
}

// ESPN Player Stats Fetcher (backup source)
async function fetchESPNGameBoxscores(gameDate: string): Promise<PlayerStats[]> {
  const stats: PlayerStats[] = [];
  
  try {
    // Format date for ESPN API (YYYYMMDD)
    const dateStr = gameDate.replace(/-/g, '');
    const url = `${ESPN_NBA_API}?dates=${dateStr}`;
    
    console.log(`[ESPN] Fetching games for ${gameDate}...`);
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`[ESPN] Failed to fetch: ${response.status}`);
      return stats;
    }
    
    const data = await response.json();
    const events = data.events || [];
    
    console.log(`[ESPN] Found ${events.length} games`);
    
    for (const event of events) {
      if (event.status?.type?.completed !== true) continue;
      
      const homeTeam = event.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'home');
      const awayTeam = event.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'away');
      
      if (!homeTeam || !awayTeam) continue;
      
      const gameId = event.id;
      
      // Fetch detailed boxscore for this game
      try {
        const boxscoreUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameId}`;
        const boxResponse = await fetch(boxscoreUrl);
        
        if (!boxResponse.ok) continue;
        
        const boxData = await boxResponse.json();
        const players = boxData.boxscore?.players || [];
        
        for (const teamPlayers of players) {
          const isHome = teamPlayers.team?.id === homeTeam.team?.id;
          const opponent = isHome ? awayTeam.team?.displayName : homeTeam.team?.displayName;
          
          for (const player of teamPlayers.statistics?.[0]?.athletes || []) {
            const statValues = player.stats || [];
            
            // ESPN stat indices: MIN, FG, 3PT, FT, OREB, DREB, REB, AST, STL, BLK, TO, PF, +/-, PTS
            const getStatNum = (idx: number) => parseInt(statValues[idx]?.split('-')?.[0]) || parseInt(statValues[idx]) || 0;
            
            stats.push({
              player_name: player.athlete?.displayName || '',
              game_date: gameDate,
              opponent: opponent || 'Unknown',
              points: getStatNum(13), // PTS
              rebounds: getStatNum(6), // REB
              assists: getStatNum(7), // AST
              threes_made: parseInt(statValues[2]?.split('-')?.[0]) || 0, // 3PT made
              blocks: getStatNum(9), // BLK
              steals: getStatNum(8), // STL
              is_home: isHome,
            });
          }
        }
      } catch (e) {
        console.error(`[ESPN] Error fetching boxscore for game ${gameId}:`, e);
      }
      
      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`[ESPN] Got ${stats.length} player stats for ${gameDate}`);
    return stats;
  } catch (error) {
    console.error('[ESPN] Error:', error);
    return stats;
  }
}

// BallDontLie API fetcher for specific date range
async function fetchBDLStats(apiKey: string, startDate: string, endDate: string): Promise<PlayerStats[]> {
  const stats: PlayerStats[] = [];
  
  try {
    // Fetch games for date range
    const url = `${BDL_API_BASE}/games?start_date=${startDate}&end_date=${endDate}&per_page=100`;
    console.log(`[BDL] Fetching games from ${startDate} to ${endDate}...`);
    
    const response = await fetch(url, {
      headers: { 'Authorization': apiKey }
    });
    
    if (!response.ok) {
      console.error(`[BDL] Games fetch failed: ${response.status}`);
      return stats;
    }
    
    const data = await response.json();
    const games = data.data || [];
    
    console.log(`[BDL] Found ${games.length} games`);
    
    // Fetch stats for each game
    for (const game of games) {
      try {
        const statsUrl = `${BDL_API_BASE}/stats?game_ids[]=${game.id}&per_page=50`;
        const statsResponse = await fetch(statsUrl, {
          headers: { 'Authorization': apiKey }
        });
        
        if (!statsResponse.ok) continue;
        
        const statsData = await statsResponse.json();
        const playerStats = statsData.data || [];
        
        for (const stat of playerStats) {
          if (!stat.player) continue;
          
          const playerName = `${stat.player.first_name} ${stat.player.last_name}`;
          const gameDate = game.date?.split('T')[0];
          const isHome = stat.player.team?.id === game.home_team?.id;
          const opponent = isHome ? game.visitor_team?.full_name : game.home_team?.full_name;
          
          // Parse minutes
          let minutes = 0;
          if (stat.min) {
            const parts = stat.min.split(':');
            minutes = parseInt(parts[0]) || 0;
          }
          
          if (minutes > 0) { // Only add players who actually played
            stats.push({
              player_name: playerName,
              game_date: gameDate,
              opponent: opponent || 'Unknown',
              points: stat.pts || 0,
              rebounds: stat.reb || 0,
              assists: stat.ast || 0,
              threes_made: stat.fg3m || 0,
              blocks: stat.blk || 0,
              steals: stat.stl || 0,
              is_home: isHome,
            });
          }
        }
        
        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (e) {
        console.error(`[BDL] Error fetching stats for game ${game.id}:`, e);
      }
    }
    
    console.log(`[BDL] Got ${stats.length} player stats`);
    return stats;
  } catch (error) {
    console.error('[BDL] Error:', error);
    return stats;
  }
}

// Extract player names from pending parlays
function extractPlayerNames(parlays: any[]): Set<string> {
  const names = new Set<string>();
  
  for (const parlay of parlays) {
    const legs = parlay.legs || [];
    for (const leg of legs) {
      const desc = leg.description || '';
      
      // Match player name patterns
      const patterns = [
        /^(.+?)\s+(Over|Under)\s+\d/i,
        /^([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z]{1,2})?)\s+/i,
      ];
      
      for (const pattern of patterns) {
        const match = desc.match(pattern);
        if (match && match[1]) {
          const name = match[1].trim()
            .replace(/\s+(Over|Under|undefined|player_).*/gi, '')
            .trim();
          if (name && name.split(' ').length >= 2) {
            names.add(name);
          }
        }
      }
    }
  }
  
  return names;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const bdlApiKey = Deno.env.get('BALLDONTLIE_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { startDate, endDate, useESPN = true, useBDL = true } = await req.json().catch(() => ({
      startDate: null,
      endDate: null,
    }));
    
    // Default to last 5 days if no dates provided
    const end = endDate || new Date().toISOString().split('T')[0];
    const start = startDate || new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    console.log(`[Backfill] Starting stats backfill from ${start} to ${end}...`);
    
    const results = {
      playerNamesFound: 0,
      espnStatsFound: 0,
      bdlStatsFound: 0,
      statsInserted: 0,
      errors: [] as string[],
    };
    
    // Get pending parlays to find which players we need stats for
    const { data: pendingParlays } = await supabase
      .from('ai_generated_parlays')
      .select('legs')
      .eq('outcome', 'pending')
      .limit(300);
    
    const playerNames = extractPlayerNames(pendingParlays || []);
    results.playerNamesFound = playerNames.size;
    console.log(`[Backfill] Found ${playerNames.size} unique player names from pending parlays`);
    
    // Collect all stats
    let allStats: PlayerStats[] = [];
    
    // Try ESPN first (free, no API key needed)
    if (useESPN) {
      console.log('[Backfill] Fetching from ESPN...');
      
      // Fetch each day in the date range
      const startMs = new Date(start).getTime();
      const endMs = new Date(end).getTime();
      const dayMs = 24 * 60 * 60 * 1000;
      
      for (let ms = startMs; ms <= endMs; ms += dayMs) {
        const dateStr = new Date(ms).toISOString().split('T')[0];
        const dayStats = await fetchESPNGameBoxscores(dateStr);
        allStats = allStats.concat(dayStats);
        results.espnStatsFound += dayStats.length;
      }
    }
    
    // Try BallDontLie if available
    if (useBDL && bdlApiKey) {
      console.log('[Backfill] Fetching from BallDontLie...');
      const bdlStats = await fetchBDLStats(bdlApiKey, start, end);
      results.bdlStatsFound = bdlStats.length;
      
      // Merge BDL stats (prefer if not already in ESPN)
      const existingKeys = new Set(allStats.map(s => `${s.player_name.toLowerCase()}_${s.game_date}`));
      for (const stat of bdlStats) {
        const key = `${stat.player_name.toLowerCase()}_${stat.game_date}`;
        if (!existingKeys.has(key)) {
          allStats.push(stat);
          existingKeys.add(key);
        }
      }
    }
    
    console.log(`[Backfill] Total stats collected: ${allStats.length}`);
    
    // Insert into database
    if (allStats.length > 0) {
      // Batch insert in chunks of 50
      const chunkSize = 50;
      for (let i = 0; i < allStats.length; i += chunkSize) {
        const chunk = allStats.slice(i, i + chunkSize);
        
        const { error } = await supabase
          .from('nba_player_game_logs')
          .upsert(chunk.map(s => ({
            player_name: s.player_name,
            game_date: s.game_date,
            opponent: s.opponent,
            points: s.points,
            rebounds: s.rebounds,
            assists: s.assists,
            threes_made: s.threes_made,
            blocks: s.blocks,
            steals: s.steals,
            is_home: s.is_home,
          })), { 
            onConflict: 'player_name,game_date',
            ignoreDuplicates: false 
          });
        
        if (error) {
          console.error('[Backfill] Insert error:', error);
          results.errors.push(error.message);
        } else {
          results.statsInserted += chunk.length;
        }
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`[Backfill] Completed in ${duration}ms`, results);
    
    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'backfill-player-stats',
      status: results.errors.length > 0 ? 'partial' : 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: results,
    });

    return new Response(JSON.stringify({
      success: true,
      duration,
      dateRange: { start, end },
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Backfill] Fatal error:', error);
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
