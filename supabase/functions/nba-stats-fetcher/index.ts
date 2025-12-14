import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BDL_API_BASE = "https://api.balldontlie.io/v1";
const ESPN_NBA_API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

interface BDLPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  height: string;
  weight: string;
  jersey_number: string;
  college: string;
  country: string;
  draft_year: number | null;
  draft_round: number | null;
  draft_number: number | null;
  team: {
    id: number;
    name: string;
    full_name: string;
    abbreviation: string;
  };
}

interface BDLStats {
  id: number;
  player: BDLPlayer;
  game: {
    id: number;
    date: string;
    home_team: { name: string };
    visitor_team: { name: string };
    home_team_score: number;
    visitor_team_score: number;
  };
  pts: number;
  reb: number;
  ast: number;
  blk: number;
  stl: number;
  fg3m: number;
  turnover: number;
  min: string;
}

interface BDLInjury {
  player: BDLPlayer;
  status: string;
  comment: string;
  date: string;
  return_date: string | null;
}

async function fetchWithRateLimit(url: string, apiKey: string): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
  });
  
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const limit = response.headers.get('X-RateLimit-Limit');
  console.log(`[BDL API] Rate limit: ${remaining}/${limit} remaining`);
  
  return response;
}

async function searchPlayer(playerName: string, apiKey: string): Promise<BDLPlayer | null> {
  try {
    const parts = playerName.trim().split(' ');
    const lastName = parts.slice(1).join(' ');
    
    const url = `${BDL_API_BASE}/players?search=${encodeURIComponent(playerName)}`;
    const response = await fetchWithRateLimit(url, apiKey);
    
    if (!response.ok) {
      console.error(`[BDL API] Search failed for ${playerName}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      const exactMatch = data.data.find((p: BDLPlayer) => 
        `${p.first_name} ${p.last_name}`.toLowerCase() === playerName.toLowerCase()
      );
      
      if (exactMatch) return exactMatch;
      
      const lastNameMatch = data.data.find((p: BDLPlayer) => 
        p.last_name.toLowerCase() === lastName.toLowerCase()
      );
      
      if (lastNameMatch) return lastNameMatch;
      
      return data.data[0];
    }
    
    return null;
  } catch (error) {
    console.error(`[BDL API] Error searching for ${playerName}:`, error);
    return null;
  }
}

async function fetchPlayerStats(playerId: number, apiKey: string, perPage: number = 10): Promise<BDLStats[]> {
  try {
    const currentYear = new Date().getFullYear();
    const season = new Date().getMonth() >= 9 ? currentYear : currentYear - 1;
    
    const url = `${BDL_API_BASE}/stats?player_ids[]=${playerId}&seasons[]=${season}&per_page=${perPage}`;
    const response = await fetchWithRateLimit(url, apiKey);
    
    if (!response.ok) {
      console.error(`[BDL API] Stats fetch failed for player ${playerId}: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error(`[BDL API] Error fetching stats for player ${playerId}:`, error);
    return [];
  }
}

async function fetchInjuries(apiKey: string): Promise<BDLInjury[]> {
  try {
    const url = `${BDL_API_BASE}/player_injuries`;
    const response = await fetchWithRateLimit(url, apiKey);
    
    if (!response.ok) {
      console.error(`[BDL API] Injuries fetch failed: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error(`[BDL API] Error fetching injuries:`, error);
    return [];
  }
}

// ESPN Backup fetcher - more reliable for recent games
async function fetchESPNGameLogs(daysBack: number = 7): Promise<any[]> {
  const gameLogRecords: any[] = [];
  
  try {
    console.log(`[ESPN NBA] Fetching game logs for last ${daysBack} days...`);
    
    // Get recent games from ESPN scoreboard
    const allGameIds: string[] = [];
    
    for (let dayOffset = 0; dayOffset < daysBack; dayOffset++) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - dayOffset);
      const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
      
      try {
        const scoreboardUrl = `${ESPN_NBA_API}/scoreboard?dates=${dateStr}`;
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
        console.log(`[ESPN NBA] Error fetching day ${dayOffset}:`, e);
      }
    }
    
    console.log(`[ESPN NBA] Found ${allGameIds.length} completed games`);
    
    // Process each game's boxscore (limit to 20 per run)
    for (const gameId of allGameIds.slice(0, 20)) {
      try {
        const boxscoreUrl = `${ESPN_NBA_API}/summary?event=${gameId}`;
        const boxRes = await fetch(boxscoreUrl);
        
        if (!boxRes.ok) continue;
        
        const boxData = await boxRes.json();
        const gameDate = boxData.header?.competitions?.[0]?.date?.split('T')[0];
        
        if (!gameDate) continue;
        
        const homeTeam = boxData.header?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'home');
        const awayTeam = boxData.header?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'away');
        
        const homeTeamName = homeTeam?.team?.displayName || 'Unknown';
        const awayTeamName = awayTeam?.team?.displayName || 'Unknown';
        
        // Get player stats from boxscore
        const boxscore = boxData.boxscore;
        if (!boxscore?.players) continue;
        
        for (const teamStats of boxscore.players) {
          const isHome = teamStats.team?.id === homeTeam?.team?.id;
          const opponent = isHome ? awayTeamName : homeTeamName;
          
          for (const category of teamStats.statistics || []) {
            if (category.name?.toLowerCase() !== 'starters' && category.name?.toLowerCase() !== 'bench') continue;
            
            for (const athlete of category.athletes || []) {
              const playerName = athlete.athlete?.displayName;
              if (!playerName) continue;
              
              const stats = athlete.stats || [];
              // ESPN stats order: MIN, FG, 3PT, FT, OREB, DREB, REB, AST, STL, BLK, TO, PF, +/-, PTS
              
              let minutes = 0;
              if (stats[0]) {
                const minParts = stats[0].split(':');
                minutes = parseInt(minParts[0]) || 0;
              }
              
              const threeParts = (stats[2] || '0-0').split('-');
              const threesMade = parseInt(threeParts[0]) || 0;
              
              gameLogRecords.push({
                player_name: playerName,
                game_date: gameDate,
                opponent,
                is_home: isHome,
                points: parseInt(stats[13]) || 0,
                rebounds: parseInt(stats[6]) || 0,
                assists: parseInt(stats[7]) || 0,
                threes_made: threesMade,
                blocks: parseInt(stats[9]) || 0,
                steals: parseInt(stats[8]) || 0,
                turnovers: parseInt(stats[10]) || 0,
                minutes_played: minutes,
              });
            }
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (gameError) {
        console.error(`[ESPN NBA] Error processing game ${gameId}:`, gameError);
      }
    }
    
    console.log(`[ESPN NBA] Extracted ${gameLogRecords.length} player game logs`);
  } catch (error) {
    console.error('[ESPN NBA] Fatal error:', error);
  }
  
  return gameLogRecords;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  
  try {
    const apiKey = Deno.env.get('BALLDONTLIE_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { mode = 'sync', playerNames = [], daysBack = 7, useESPN = true } = await req.json().catch(() => ({}));
    
    console.log(`[NBA Stats Fetcher] Starting with mode: ${mode}, players: ${playerNames.length}, useESPN: ${useESPN}`);
    
    const results: Record<string, any> = {
      playersMatched: 0,
      statsInserted: 0,
      injuriesInserted: 0,
      espnRecords: 0,
      bdlRecords: 0,
      errors: [],
    };

    // First try ESPN (more reliable for recent data)
    if (useESPN) {
      console.log('[NBA Stats Fetcher] Fetching from ESPN API (primary)...');
      const espnRecords = await fetchESPNGameLogs(daysBack);
      
      if (espnRecords.length > 0) {
        const { error: espnError } = await supabase
          .from('nba_player_game_logs')
          .upsert(espnRecords, { 
            onConflict: 'player_name,game_date',
            ignoreDuplicates: false 
          });
        
        if (espnError) {
          console.error('[NBA Stats Fetcher] ESPN insert error:', espnError);
          results.errors.push(espnError.message);
        } else {
          results.espnRecords = espnRecords.length;
          results.statsInserted += espnRecords.length;
        }
      }
    }

    // Fallback to BallDontLie if API key is available
    if (apiKey) {
      console.log('[NBA Stats Fetcher] Fetching from BallDontLie API (secondary)...');
      
      let playersToFetch: string[] = playerNames;
      
      if (mode === 'sync' && playersToFetch.length === 0) {
        const { data: propsData, error: propsError } = await supabase
          .from('unified_props')
          .select('player_name')
          .eq('sport', 'basketball_nba')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
        
        if (propsError) {
          results.errors.push(propsError.message);
        } else if (propsData) {
          playersToFetch = [...new Set(propsData.map(p => p.player_name))];
          console.log(`[NBA Stats Fetcher] Found ${playersToFetch.length} unique players from props`);
        }
      }

      if (playersToFetch.length > 0) {
        const { data: cachedPlayers } = await supabase
          .from('bdl_player_cache')
          .select('*')
          .in('player_name', playersToFetch);

        const cachedMap = new Map(cachedPlayers?.map(p => [p.player_name, p]) || []);
        const uncachedPlayers = playersToFetch.filter(name => !cachedMap.has(name));
        
        const newPlayerMappings: any[] = [];
        
        for (const playerName of uncachedPlayers.slice(0, 20)) {
          const player = await searchPlayer(playerName, apiKey);
          
          if (player) {
            newPlayerMappings.push({
              player_name: playerName,
              bdl_player_id: player.id,
              position: player.position,
              team_name: player.team?.full_name || null,
              height: player.height,
              weight: player.weight,
              jersey_number: player.jersey_number,
              college: player.college,
              country: player.country,
              draft_year: player.draft_year,
              draft_round: player.draft_round,
              draft_number: player.draft_number,
              last_updated: new Date().toISOString(),
            });
            results.playersMatched++;
          }
          
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (newPlayerMappings.length > 0) {
          await supabase
            .from('bdl_player_cache')
            .upsert(newPlayerMappings, { onConflict: 'player_name' });
        }

        const allMappings = [...(cachedPlayers || []), ...newPlayerMappings];
        const gameLogRecords: any[] = [];
        
        for (const mapping of allMappings.slice(0, 30)) {
          if (!mapping.bdl_player_id) continue;
          
          const stats = await fetchPlayerStats(mapping.bdl_player_id, apiKey, 10);
          
          for (const stat of stats) {
            if (!stat.game?.date) continue;
            
            const gameDate = stat.game.date.split('T')[0];
            const isHome = stat.player?.team?.name === stat.game.home_team?.name;
            const opponent = isHome ? stat.game.visitor_team?.name : stat.game.home_team?.name;
            
            let minutes = 0;
            if (stat.min) {
              const parts = stat.min.split(':');
              minutes = parseInt(parts[0]) || 0;
            }
            
            gameLogRecords.push({
              player_name: mapping.player_name,
              game_date: gameDate,
              opponent: opponent || 'Unknown',
              is_home: isHome,
              points: stat.pts || 0,
              rebounds: stat.reb || 0,
              assists: stat.ast || 0,
              threes_made: stat.fg3m || 0,
              blocks: stat.blk || 0,
              steals: stat.stl || 0,
              turnovers: stat.turnover || 0,
              minutes_played: Math.round(minutes),
            });
          }
          
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (gameLogRecords.length > 0) {
          const { error: logsError } = await supabase
            .from('nba_player_game_logs')
            .upsert(gameLogRecords, { 
              onConflict: 'player_name,game_date',
              ignoreDuplicates: false 
            });
          
          if (logsError) {
            results.errors.push(logsError.message);
          } else {
            results.bdlRecords = gameLogRecords.length;
            results.statsInserted += gameLogRecords.length;
          }
        }
      }

      // Fetch injuries
      if (mode === 'sync' || mode === 'injuries') {
        const injuries = await fetchInjuries(apiKey);
        const today = new Date().toISOString().split('T')[0];
        
        await supabase
          .from('nba_injury_reports')
          .delete()
          .eq('game_date', today);
        
        const injuryRecords = injuries.map(inj => ({
          player_name: `${inj.player.first_name} ${inj.player.last_name}`,
          team_name: inj.player.team?.full_name || 'Unknown',
          status: inj.status,
          injury_type: inj.comment || 'Not specified',
          impact_level: inj.status === 'Out' ? 'high' : inj.status === 'Day-To-Day' ? 'medium' : 'low',
          affects_rotation: true,
          game_date: today,
        }));
        
        if (injuryRecords.length > 0) {
          const { error: injError } = await supabase
            .from('nba_injury_reports')
            .insert(injuryRecords);
          
          if (!injError) {
            results.injuriesInserted = injuryRecords.length;
          }
        }
      }
    } else {
      console.log('[NBA Stats Fetcher] No BDL API key configured, ESPN only');
    }

    const duration = Date.now() - startTime;
    console.log(`[NBA Stats Fetcher] Completed in ${duration}ms`, results);

    await supabase.from('cron_job_history').insert({
      job_name: 'nba-stats-fetcher',
      status: results.errors.length > 0 ? 'partial' : 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: results,
    });

    return new Response(JSON.stringify({
      success: true,
      duration,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[NBA Stats Fetcher] Fatal error:', error);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      await supabase.from('cron_job_history').insert({
        job_name: 'nba-stats-fetcher',
        status: 'failed',
        started_at: new Date(startTime).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        error_message: errorMessage,
      });
    }
    
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
