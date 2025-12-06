import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BDL_API_BASE = "https://api.balldontlie.io/v1";

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
  
  // Log rate limit info
  const remaining = response.headers.get('X-RateLimit-Remaining');
  const limit = response.headers.get('X-RateLimit-Limit');
  console.log(`[BDL API] Rate limit: ${remaining}/${limit} remaining`);
  
  return response;
}

async function searchPlayer(playerName: string, apiKey: string): Promise<BDLPlayer | null> {
  try {
    // Split name and search
    const parts = playerName.trim().split(' ');
    const firstName = parts[0];
    const lastName = parts.slice(1).join(' ');
    
    // Try exact search first
    const url = `${BDL_API_BASE}/players?search=${encodeURIComponent(playerName)}`;
    const response = await fetchWithRateLimit(url, apiKey);
    
    if (!response.ok) {
      console.error(`[BDL API] Search failed for ${playerName}: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.data && data.data.length > 0) {
      // Find best match
      const exactMatch = data.data.find((p: BDLPlayer) => 
        `${p.first_name} ${p.last_name}`.toLowerCase() === playerName.toLowerCase()
      );
      
      if (exactMatch) return exactMatch;
      
      // Partial match on last name
      const lastNameMatch = data.data.find((p: BDLPlayer) => 
        p.last_name.toLowerCase() === lastName.toLowerCase()
      );
      
      if (lastNameMatch) return lastNameMatch;
      
      // Return first result as fallback
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

async function fetchActivePlayers(apiKey: string, page: number = 1): Promise<BDLPlayer[]> {
  try {
    const url = `${BDL_API_BASE}/players/active?per_page=100&page=${page}`;
    const response = await fetchWithRateLimit(url, apiKey);
    
    if (!response.ok) {
      console.error(`[BDL API] Active players fetch failed: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    return data.data || [];
  } catch (error) {
    console.error(`[BDL API] Error fetching active players:`, error);
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
    if (!apiKey) {
      throw new Error('BALLDONTLIE_API_KEY not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { mode = 'sync', playerNames = [] } = await req.json().catch(() => ({}));
    
    console.log(`[NBA Stats Fetcher] Starting with mode: ${mode}, players: ${playerNames.length}`);
    
    const results: Record<string, any> = {
      playersMatched: 0,
      statsInserted: 0,
      injuriesInserted: 0,
      errors: [],
    };

    // Get unique players from unified_props if not provided
    let playersToFetch: string[] = playerNames;
    
    if (mode === 'sync' && playersToFetch.length === 0) {
      console.log('[NBA Stats Fetcher] Fetching unique players from unified_props...');
      
      const { data: propsData, error: propsError } = await supabase
        .from('unified_props')
        .select('player_name')
        .eq('sport', 'basketball_nba')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      
      if (propsError) {
        console.error('[NBA Stats Fetcher] Error fetching props:', propsError);
        results.errors.push(propsError.message);
      } else if (propsData) {
        playersToFetch = [...new Set(propsData.map(p => p.player_name))];
        console.log(`[NBA Stats Fetcher] Found ${playersToFetch.length} unique players`);
      }
    }

    // Check cache for existing player mappings
    const { data: cachedPlayers } = await supabase
      .from('bdl_player_cache')
      .select('*')
      .in('player_name', playersToFetch);

    const cachedMap = new Map(cachedPlayers?.map(p => [p.player_name, p]) || []);
    const uncachedPlayers = playersToFetch.filter(name => !cachedMap.has(name));
    
    console.log(`[NBA Stats Fetcher] Cached: ${cachedMap.size}, Uncached: ${uncachedPlayers.length}`);

    // Search for uncached players
    const newPlayerMappings: any[] = [];
    
    for (const playerName of uncachedPlayers) {
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
      } else {
        console.log(`[NBA Stats Fetcher] No match found for: ${playerName}`);
        results.errors.push(`No match for: ${playerName}`);
      }
      
      // Rate limiting delay (100ms between requests)
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Cache new player mappings
    if (newPlayerMappings.length > 0) {
      const { error: cacheError } = await supabase
        .from('bdl_player_cache')
        .upsert(newPlayerMappings, { onConflict: 'player_name' });
      
      if (cacheError) {
        console.error('[NBA Stats Fetcher] Cache error:', cacheError);
        results.errors.push(cacheError.message);
      }
    }

    // Combine cached and new mappings
    const allMappings = [
      ...(cachedPlayers || []),
      ...newPlayerMappings,
    ];

    // Fetch stats for all players with BDL IDs
    const gameLogRecords: any[] = [];
    
    for (const mapping of allMappings) {
      if (!mapping.bdl_player_id) continue;
      
      const stats = await fetchPlayerStats(mapping.bdl_player_id, apiKey, 10);
      
      for (const stat of stats) {
        if (!stat.game?.date) continue;
        
        const gameDate = stat.game.date.split('T')[0];
        const isHome = stat.player?.team?.name === stat.game.home_team?.name;
        const opponent = isHome ? stat.game.visitor_team?.name : stat.game.home_team?.name;
        
        // Parse minutes (format: "32:15" or "32")
        let minutes = 0;
        if (stat.min) {
          const parts = stat.min.split(':');
          minutes = parseInt(parts[0]) || 0;
          if (parts[1]) {
            minutes += parseInt(parts[1]) / 60;
          }
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
      
      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Insert game logs
    if (gameLogRecords.length > 0) {
      const { error: logsError } = await supabase
        .from('nba_player_game_logs')
        .upsert(gameLogRecords, { 
          onConflict: 'player_name,game_date',
          ignoreDuplicates: false 
        });
      
      if (logsError) {
        console.error('[NBA Stats Fetcher] Game logs error:', logsError);
        results.errors.push(logsError.message);
      } else {
        results.statsInserted = gameLogRecords.length;
      }
    }

    // Fetch and insert injuries
    if (mode === 'sync' || mode === 'injuries') {
      console.log('[NBA Stats Fetcher] Fetching injury reports...');
      
      const injuries = await fetchInjuries(apiKey);
      const today = new Date().toISOString().split('T')[0];
      
      // Delete existing injury reports for today
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
        
        if (injError) {
          console.error('[NBA Stats Fetcher] Injuries error:', injError);
          results.errors.push(injError.message);
        } else {
          results.injuriesInserted = injuryRecords.length;
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[NBA Stats Fetcher] Completed in ${duration}ms`, results);

    // Log to cron history
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
    
    // Log failure
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
