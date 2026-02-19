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

// Helper to parse ESPN boxscore stats dynamically based on headers
function parseESPNPlayerStats(athlete: any, labels: string[]): Record<string, number> {
  const stats: Record<string, number> = {
    points: 0,
    rebounds: 0,
    assists: 0,
    threes_made: 0,
    blocks: 0,
    steals: 0,
    turnovers: 0,
    minutes_played: 0,
  };

  if (!athlete.stats || !labels) return stats;

  const rawStats = athlete.stats;
  
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]?.toLowerCase() || '';
    const value = rawStats[i] || '0';
    
    if (label === 'min') {
      const minParts = value.split(':');
      stats.minutes_played = parseInt(minParts[0]) || 0;
    } else if (label === 'pts') {
      stats.points = parseInt(value) || 0;
    } else if (label === 'reb') {
      stats.rebounds = parseInt(value) || 0;
    } else if (label === 'ast') {
      stats.assists = parseInt(value) || 0;
    } else if (label === '3pt') {
      // Format: "made-attempted"
      const parts = value.split('-');
      stats.threes_made = parseInt(parts[0]) || 0;
    } else if (label === 'blk') {
      stats.blocks = parseInt(value) || 0;
    } else if (label === 'stl') {
      stats.steals = parseInt(value) || 0;
    } else if (label === 'to') {
      stats.turnovers = parseInt(value) || 0;
    }
  }
  
  return stats;
}

// Validated fetch wrapper for ESPN - distinguishes API failures from empty results
async function fetchWithValidation(url: string, label: string): Promise<{ ok: boolean; data: any | null; status: number }> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[ESPN NBA] ${label} failed: HTTP ${response.status} ${response.statusText} — ${url}`);
      return { ok: false, data: null, status: response.status };
    }
    const data = await response.json();
    return { ok: true, data, status: response.status };
  } catch (error) {
    console.error(`[ESPN NBA] ${label} network error: ${error} — ${url}`);
    return { ok: false, data: null, status: 0 };
  }
}

// ESPN Backup fetcher - more reliable for recent games
// Auto-expands lookback when 0 completed games found on first pass
async function fetchESPNGameLogs(daysBack: number = 7): Promise<{ records: any[]; daysSearched: number; apiErrors: number }> {
  let currentDaysBack = daysBack;
  const maxDaysBack = 14;
  let apiErrors = 0;

  while (currentDaysBack <= maxDaysBack) {
    const result = await _fetchESPNGameLogsInner(currentDaysBack);
    apiErrors += result.apiErrors;

    if (result.records.length > 0) {
      return { records: result.records, daysSearched: currentDaysBack, apiErrors };
    }

    if (currentDaysBack >= maxDaysBack) break;

    // Expand lookback on second pass
    const nextDays = Math.min(currentDaysBack * 2, maxDaysBack);
    console.log(`[ESPN NBA] 0 completed games in ${currentDaysBack} days — expanding lookback to ${nextDays} days`);
    currentDaysBack = nextDays;
  }

  console.warn(`[ESPN NBA] 0 completed games found after searching ${currentDaysBack} days`);
  return { records: [], daysSearched: currentDaysBack, apiErrors };
}

async function _fetchESPNGameLogsInner(daysBack: number): Promise<{ records: any[]; apiErrors: number }> {
  const gameLogRecords: any[] = [];
  let apiErrors = 0;
  
  try {
    console.log(`[ESPN NBA] Fetching game logs for last ${daysBack} days...`);
    
    // Get recent games from ESPN scoreboard
    const allGameIds: { id: string, dateStr: string }[] = [];
    
    for (let dayOffset = 0; dayOffset < daysBack; dayOffset++) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - dayOffset);
      const dateStr = targetDate.toISOString().split('T')[0].replace(/-/g, '');
      const isoDateStr = targetDate.toISOString().split('T')[0];
      
      const scoreboardUrl = `${ESPN_NBA_API}/scoreboard?dates=${dateStr}`;
      const { ok, data: scoreboardData, status } = await fetchWithValidation(scoreboardUrl, `Scoreboard ${isoDateStr}`);
      
      if (!ok) {
        apiErrors++;
        continue;
      }
      
      const events = scoreboardData.events || [];
      console.log(`[ESPN NBA] Day ${isoDateStr}: ${events.length} games found`);
      
      for (const event of events) {
        const statusObj = event.status?.type;
        console.log(`[ESPN NBA] Game ${event.id}: ${event.shortName}, status: ${statusObj?.name}`);
        
        // Check if game is completed
        if (statusObj?.completed === true || statusObj?.name === 'STATUS_FINAL') {
          allGameIds.push({ id: event.id, dateStr: isoDateStr });
        }
      }
    }
    
    console.log(`[ESPN NBA] Found ${allGameIds.length} completed games total`);
    
    // Process each game's boxscore
    for (const game of allGameIds.slice(0, 30)) {
      try {
        const boxscoreUrl = `${ESPN_NBA_API}/summary?event=${game.id}`;
        const { ok, data: boxData } = await fetchWithValidation(boxscoreUrl, `Boxscore ${game.id}`);
        
        if (!ok) {
          apiErrors++;
          continue;
        }
        
        // Get game date from header - MUST convert UTC to Eastern Time
        // ESPN returns UTC timestamps (e.g., "2026-01-30T00:10:00Z" for a 7:10 PM ET game on Jan 29th)
        // Without conversion, evening games get stored as the next day
        const rawDate = boxData.header?.competitions?.[0]?.date;
        const gameDate = rawDate 
          ? new Date(rawDate).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
          : game.dateStr;
        
        if (!gameDate) {
          console.error(`[ESPN NBA] No date for game ${game.id}`);
          continue;
        }
        
        const homeTeam = boxData.header?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'home');
        const awayTeam = boxData.header?.competitions?.[0]?.competitors?.find((c: any) => c.homeAway === 'away');
        
        const homeTeamName = homeTeam?.team?.displayName || 'Unknown';
        const awayTeamName = awayTeam?.team?.displayName || 'Unknown';
        
        console.log(`[ESPN NBA] Processing: ${awayTeamName} @ ${homeTeamName} on ${gameDate}`);
        
        // Get player stats from boxscore
        const boxscore = boxData.boxscore;
        if (!boxscore?.players) {
          console.log(`[ESPN NBA] No player boxscore data for game ${game.id}`);
          continue;
        }
        
        let playersExtracted = 0;
        
        for (const teamStats of boxscore.players) {
          const isHome = teamStats.team?.id === homeTeam?.team?.id;
          const opponent = isHome ? awayTeamName : homeTeamName;
          
          for (const category of teamStats.statistics || []) {
            // Get stat labels from this category
            const labels = category.labels || [];
            
            for (const athlete of category.athletes || []) {
              const playerName = athlete.athlete?.displayName;
              if (!playerName) continue;
              
              // Check if player played (didn't sit)
              const didNotPlay = athlete.didNotPlay === true;
              if (didNotPlay) continue;
              
              // Parse stats using dynamic labels
              const stats = parseESPNPlayerStats(athlete, labels);
              
              // Only add if they played some minutes
              if (stats.minutes_played > 0 || stats.points > 0) {
                gameLogRecords.push({
                  player_name: playerName,
                  game_date: gameDate,
                  opponent,
                  is_home: isHome,
                  ...stats,
                });
                playersExtracted++;
              }
            }
          }
        }
        
        console.log(`[ESPN NBA] Extracted ${playersExtracted} players from game ${game.id}`);
        
        // Rate limit between API calls
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (gameError) {
        console.error(`[ESPN NBA] Error processing game ${game.id}:`, gameError);
        apiErrors++;
      }
    }
    
    console.log(`[ESPN NBA] Total: ${gameLogRecords.length} player game logs extracted`);
  } catch (error) {
    console.error('[ESPN NBA] Fatal error:', error);
    apiErrors++;
  }
  
  return { records: gameLogRecords, apiErrors };
}

// Extract player names from pending elite parlays
async function getPlayersFromParlays(supabase: any): Promise<string[]> {
  const playerNames: Set<string> = new Set();
  
  try {
    // Get parlays from last 14 days that need verification
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 14);
    
    const { data: parlays, error } = await supabase
      .from('daily_elite_parlays')
      .select('legs')
      .gte('parlay_date', cutoff.toISOString().split('T')[0])
      .in('outcome', ['pending', 'no_data']);
    
    if (error) {
      console.error('[NBA Stats] Error fetching parlays:', error);
      return [];
    }
    
    for (const parlay of parlays || []) {
      const legs = parlay.legs as any[];
      for (const leg of legs || []) {
        const playerName = leg.playerName || leg.player_name || leg.player;
        const sport = leg.sport || 'basketball_nba';
        
        // Only NBA players
        if (playerName && sport.includes('basketball')) {
          playerNames.add(playerName);
        }
      }
    }
    
    console.log(`[NBA Stats] Found ${playerNames.size} unique NBA players from pending parlays`);
    return Array.from(playerNames);
  } catch (e) {
    console.error('[NBA Stats] Error extracting parlay players:', e);
    return [];
  }
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

    const { mode = 'sync', playerNames = [], daysBack = 7, useESPN = true, includeParlayPlayers = true } = await req.json().catch(() => ({}));
    
    console.log(`[NBA Stats Fetcher] Starting with mode: ${mode}, daysBack: ${daysBack}, useESPN: ${useESPN}`);
    
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
      const espnResult = await fetchESPNGameLogs(daysBack);
      
      console.log(`[NBA Stats Fetcher] ESPN returned ${espnResult.records.length} records (searched ${espnResult.daysSearched} days, ${espnResult.apiErrors} API errors)`);
      results.espnDaysSearched = espnResult.daysSearched;
      results.espnApiErrors = espnResult.apiErrors;
      
      if (espnResult.records.length > 0) {
        // Deduplicate by player_name+game_date (keep last occurrence which has most complete stats)
        const deduped = new Map<string, any>();
        for (const rec of espnResult.records) {
          deduped.set(`${rec.player_name}::${rec.game_date}`, rec);
        }
        const uniqueRecords = Array.from(deduped.values());
        console.log(`[NBA Stats Fetcher] Deduped ${espnResult.records.length} -> ${uniqueRecords.length} unique records`);

        // Batch insert in chunks of 100
        const chunkSize = 100;
        for (let i = 0; i < uniqueRecords.length; i += chunkSize) {
          const chunk = uniqueRecords.slice(i, i + chunkSize);
          const { error: espnError } = await supabase
            .from('nba_player_game_logs')
            .upsert(chunk, { 
              onConflict: 'player_name,game_date',
              ignoreDuplicates: false 
            });
          
          if (espnError) {
            console.error(`[NBA Stats Fetcher] ESPN insert error (batch ${i}):`, espnError);
            results.errors.push(espnError.message);
          } else {
            results.espnRecords += chunk.length;
          }
        }
        results.statsInserted += results.espnRecords;
        console.log(`[NBA Stats Fetcher] Successfully inserted ${results.espnRecords} ESPN records`);
      } else {
        const warning = `No NBA games found in last ${espnResult.daysSearched} days — possible schedule gap or API issue (${espnResult.apiErrors} API errors)`;
        console.warn(`[NBA Stats Fetcher] ${warning}`);
        results.espnWarning = warning;
      }
    }

    // Fallback to BallDontLie if API key is available
    if (apiKey) {
      console.log('[NBA Stats Fetcher] Fetching from BallDontLie API (secondary)...');
      
      let playersToFetch: string[] = [...playerNames];
      
      // Get players from pending parlays
      if (includeParlayPlayers) {
        const parlayPlayers = await getPlayersFromParlays(supabase);
        for (const player of parlayPlayers) {
          if (!playersToFetch.includes(player)) {
            playersToFetch.push(player);
          }
        }
      }
      
      // Also get from unified_props if in sync mode
      if (mode === 'sync' && playersToFetch.length < 10) {
        const { data: propsData, error: propsError } = await supabase
          .from('unified_props')
          .select('player_name')
          .eq('sport', 'basketball_nba')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
        
        if (propsError) {
          results.errors.push(propsError.message);
        } else if (propsData) {
          for (const p of propsData) {
            if (!playersToFetch.includes(p.player_name)) {
              playersToFetch.push(p.player_name);
            }
          }
        }
      }
      
      console.log(`[NBA Stats Fetcher] Total players to fetch: ${playersToFetch.length}`);
      if (playersToFetch.length > 0) {
        console.log(`[NBA Stats Fetcher] Sample players: ${playersToFetch.slice(0, 5).join(', ')}`);
      }

      if (playersToFetch.length > 0) {
        const { data: cachedPlayers } = await supabase
          .from('bdl_player_cache')
          .select('*')
          .in('player_name', playersToFetch);

        const cachedMap = new Map(cachedPlayers?.map(p => [p.player_name, p]) || []);
        const uncachedPlayers = playersToFetch.filter(name => !cachedMap.has(name));
        
        console.log(`[NBA Stats Fetcher] Cached: ${cachedMap.size}, Need to search: ${uncachedPlayers.length}`);
        
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
            console.log(`[NBA Stats Fetcher] Found BDL player: ${playerName} -> ID ${player.id}`);
          } else {
            console.log(`[NBA Stats Fetcher] Player not found in BDL: ${playerName}`);
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
            console.log(`[NBA Stats Fetcher] Inserted ${gameLogRecords.length} BDL records`);
          }
        }
      }

      // Fetch injuries
      if (mode === 'sync' || mode === 'injuries') {
        const injuries = await fetchInjuries(apiKey);
        const today = getEasternDate();
        
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

    // Determine accurate status
    let jobStatus = 'completed';
    if (results.errors.length > 0) {
      jobStatus = 'partial';
    } else if (results.statsInserted === 0) {
      jobStatus = 'no_data';
    }

    await supabase.from('cron_job_history').insert({
      job_name: 'nba-stats-fetcher',
      status: jobStatus,
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: results,
      ...(jobStatus === 'no_data' && results.espnWarning ? { error_message: results.espnWarning } : {}),
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
      error: errorMessage,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
