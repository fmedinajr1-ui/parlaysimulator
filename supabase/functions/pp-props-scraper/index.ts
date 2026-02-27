import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PPSnapshotRow {
  player_name: string;
  stat_type: string;
  pp_line: number;
  captured_at: string;
}

interface PPSnapshotInsert {
  player_name: string;
  pp_line: number;
  stat_type: string;
  sport: string;
  start_time: string;
  pp_projection_id: string;
  team: string | null;
  position: string | null;
  captured_at: string;
  previous_line: number | null;
  market_key: string;
  matchup: string | null;
  league: string;
  event_id: string;
  period: string;
  is_active: boolean;
}

interface ExtractedProjection {
  player_name: string;
  team?: string;
  opponent?: string;
  stat_type: string;
  line: number;
  league?: string;
  game_time?: string;
}

// Parse game time strings into ISO timestamps
function parseGameTime(timeStr: string | undefined): string {
  if (!timeStr) {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
  try {
    const isoDate = new Date(timeStr);
    if (!isNaN(isoDate.getTime())) return isoDate.toISOString();
    
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (timeMatch) {
      const [, hours, minutes, period] = timeMatch;
      let hour = parseInt(hours, 10);
      if (period.toUpperCase() === 'PM' && hour !== 12) hour += 12;
      if (period.toUpperCase() === 'AM' && hour === 12) hour = 0;
      const today = new Date();
      today.setHours(hour, parseInt(minutes, 10), 0, 0);
      if (today < new Date()) today.setDate(today.getDate() + 1);
      return today.toISOString();
    }
  } catch (e) {
    console.log('[PP Scraper] Could not parse game_time:', timeStr);
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

// Map PP league names to our sport keys
const LEAGUE_TO_SPORT: Record<string, string> = {
  'NBA': 'basketball_nba',
  'WNBA': 'basketball_wnba',
  'NHL': 'hockey_nhl',
  'NFL': 'americanfootball_nfl',
  'MLB': 'baseball_mlb',
  'MLBST': 'baseball_mlb',
  'ATP': 'tennis_atp',
  'WTA': 'tennis_wta',
  'PGA': 'golf_pga',
  'UFC': 'mma_ufc',
  'MMA': 'mma_ufc',
  'ESPORTS': 'esports',
  'CBB': 'basketball_ncaab',
  'NCAAB': 'basketball_ncaab',
  'CFB': 'americanfootball_ncaaf',
  'NCAAF': 'americanfootball_ncaaf',
  'COD': 'esports_cod',
  'CSGO': 'esports_csgo',
  'CS2': 'esports_csgo',
  'LOL': 'esports_lol',
  'DOTA2': 'esports_dota2',
  'VAL': 'esports_val',
  'SOCCER': 'soccer',
  'EPL': 'soccer_epl',
  'KBO': 'baseball_kbo',
  'NPB': 'baseball_npb',
  'CFL': 'americanfootball_cfl',
  'LPGA': 'golf_lpga',
  'TT': 'table_tennis',
};

// Leagues we actually want to process (skip esports, etc. to save CPU)
const SUPPORTED_LEAGUES = new Set([
  'NBA', 'WNBA', 'NHL', 'NFL', 'MLB', 'MLBST', 'ATP', 'WTA',
  'PGA', 'UFC', 'MMA', 'CBB', 'NCAAB', 'CFB', 'NCAAF', 'TT',
]);

// Normalize stat types to match our unified_props format
const STAT_TYPE_MAP: Record<string, string> = {
  'Points': 'player_points',
  'Rebounds': 'player_rebounds',
  'Assists': 'player_assists',
  'Pts+Rebs+Asts': 'player_points_rebounds_assists',
  'Pts+Rebs': 'player_points_rebounds',
  'Pts+Asts': 'player_points_assists',
  'Rebs+Asts': 'player_rebounds_assists',
  'Steals': 'player_steals',
  'Blocks': 'player_blocks',
  'Turnovers': 'player_turnovers',
  '3-Pointers Made': 'player_threes',
  '3-PT Made': 'player_threes',
  'Fantasy Score': 'player_fantasy_score',
  'Goals': 'player_goals',
  'Shots On Goal': 'player_shots_on_goal',
  'Saves': 'player_saves',
  'Hits': 'player_hits',
  'Runs': 'player_runs',
  'RBIs': 'player_rbis',
  'Strikeouts': 'player_strikeouts',
  'Passing Yards': 'player_pass_yds',
  'Rushing Yards': 'player_rush_yds',
  'Receiving Yards': 'player_reception_yds',
  'Passing TDs': 'player_pass_tds',
  'Receptions': 'player_receptions',
  'Pitcher Strikeouts': 'pitcher_strikeouts',
  'Strikeouts (Pitching)': 'pitcher_strikeouts',
  'Ks': 'pitcher_strikeouts',
  'Pitching Strikeouts': 'pitcher_strikeouts',
  'Earned Runs Allowed': 'pitcher_earned_runs',
  'Hits Allowed': 'pitcher_hits_allowed',
  'Outs': 'pitcher_outs',
  'Total Bases': 'batter_total_bases',
  'Home Runs': 'batter_home_runs',
  'Stolen Bases': 'batter_stolen_bases',
};

// Process extracted projections into snapshot rows
function processExtractedProjections(
  projections: ExtractedProjection[],
  targetSports: string[]
): PPSnapshotInsert[] {
  const now = new Date().toISOString();
  const props: PPSnapshotInsert[] = [];
  
  for (const proj of projections) {
    const league = proj.league?.toUpperCase() || 'NBA';
    
    // Skip unsupported leagues early to save CPU
    if (!SUPPORTED_LEAGUES.has(league) && !LEAGUE_TO_SPORT[league]) {
      continue;
    }
    
    const sport = LEAGUE_TO_SPORT[league] || 'basketball_nba';
    
    const targetSportKeys = targetSports.map(s => LEAGUE_TO_SPORT[s] || s);
    if (!targetSports.some(s => league.includes(s)) && !targetSportKeys.includes(sport)) continue;
    
    let normalizedStat = STAT_TYPE_MAP[proj.stat_type] || 
      `player_${proj.stat_type.toLowerCase().replace(/\s+/g, '_')}`;
    
    // MLB-specific stat overrides
    if (league === 'MLB' || league === 'MLBST') {
      if (proj.stat_type === 'Strikeouts') normalizedStat = 'pitcher_strikeouts';
      if (proj.stat_type === 'Hits') normalizedStat = 'batter_hits';
      if (proj.stat_type === 'RBIs') normalizedStat = 'batter_rbis';
      if (proj.stat_type === 'Runs') normalizedStat = 'batter_runs';
      if (proj.stat_type === 'Stolen Bases') normalizedStat = 'batter_stolen_bases';
      if (proj.stat_type === 'Fantasy Score') normalizedStat = 'player_hitter_fantasy_score';
    }
    
    const matchup = proj.team && proj.opponent 
      ? `${proj.team} vs ${proj.opponent}` 
      : null;
    
    props.push({
      player_name: proj.player_name,
      pp_line: proj.line,
      stat_type: normalizedStat,
      sport: sport,
      start_time: parseGameTime(proj.game_time),
      pp_projection_id: `pp_api_${Date.now()}_${props.length}`,
      team: proj.team || null,
      position: null,
      captured_at: now,
      previous_line: null,
      market_key: `${sport}_${proj.player_name}_${normalizedStat}`,
      matchup: matchup,
      league: league,
      event_id: `pp_${league}_${proj.player_name}_${Date.now()}`,
      period: 'Game',
      is_active: true,
    });
  }
  
  return props;
}

// User-Agent rotation for API requests
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
];

async function fetchPrizePicksAPI(retries = 3): Promise<any> {
  // Try multiple API endpoints — PrizePicks has both v1 and alternate paths
  const endpoints = [
    'https://api.prizepicks.com/projections?single_stat=true&per_page=250',
    'https://partner-api.prizepicks.com/projections?single_stat=true&per_page=250',
    'https://api.prizepicks.com/projections?per_page=250',
  ];
  
  for (const url of endpoints) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      console.log(`[PP Scraper] Trying ${url} (attempt ${attempt}/${retries})`);
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': ua,
            'X-Device-ID': crypto.randomUUID(),
            'Referer': 'https://app.prizepicks.com/',
            'Origin': 'https://app.prizepicks.com',
            'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"macOS"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
          },
        });
        clearTimeout(timeoutId);
        
        if (response.status === 403 || response.status === 429) {
          console.warn(`[PP Scraper] Got ${response.status} from ${url}`);
          await response.text();
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, attempt * 2000));
          }
          continue;
        }
        
        if (!response.ok) {
          const text = await response.text();
          console.warn(`[PP Scraper] ${url} returned ${response.status}: ${text.slice(0, 100)}`);
          break; // Try next endpoint
        }
        
        const data = await response.json();
        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
          console.log(`[PP Scraper] ✅ Success from ${url} — ${data.data.length} projections`);
          return data;
        }
        
        console.warn(`[PP Scraper] ${url} returned empty data array`);
        break; // Try next endpoint
      } catch (err) {
        console.warn(`[PP Scraper] ${url} attempt ${attempt} error:`, err instanceof Error ? err.message : err);
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, attempt * 2000));
        }
      }
    }
  }
  
  throw new Error('All PrizePicks API endpoints returned 403 or failed — Cloudflare may be blocking server-side requests');
}

function parsePrizePicksResponse(apiData: any): ExtractedProjection[] {
  const playerMap = new Map<string, { name: string; team: string; position: string }>();
  const leagueMap = new Map<string, string>();
  
  for (const item of apiData.included || []) {
    if (item.type === 'new_player') {
      playerMap.set(item.id, {
        name: item.attributes.display_name || item.attributes.name,
        team: item.attributes.team || '',
        position: item.attributes.position || '',
      });
    }
    if (item.type === 'league') {
      leagueMap.set(item.id, item.attributes.name);
    }
  }
  
  console.log(`[PP Scraper] Parsed ${playerMap.size} players, ${leagueMap.size} leagues from included`);
  
  const projections: ExtractedProjection[] = [];
  
  for (const proj of apiData.data || []) {
    const attrs = proj.attributes;
    const playerId = proj.relationships?.new_player?.data?.id;
    const player = playerMap.get(playerId);
    if (!player) continue;
    
    const leagueId = proj.relationships?.league?.data?.id;
    const league = leagueMap.get(leagueId) || '';
    
    const line = parseFloat(attrs.line_score);
    if (isNaN(line)) continue;
    
    projections.push({
      player_name: player.name,
      team: player.team,
      stat_type: attrs.stat_type || '',
      line: line,
      league: league,
      game_time: attrs.start_time,
    });
  }
  
  return projections;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { sports = ['NBA', 'NHL', 'WNBA', 'ATP', 'WTA', 'MLB', 'MLBST'] } = await req.json().catch(() => ({}));
    
    console.log('[PP Scraper] Starting PrizePicks API fetch for sports:', sports);
    
    // Fetch directly from PrizePicks API (no Firecrawl needed)
    const apiData = await fetchPrizePicksAPI();
    
    console.log(`[PP Scraper] API returned ${apiData.data?.length || 0} projections, ${apiData.included?.length || 0} included resources`);
    
    // Parse JSON:API response into our format
    const extractedProjections = parsePrizePicksResponse(apiData);
    console.log(`[PP Scraper] Parsed ${extractedProjections.length} valid projections`);
    
    if (extractedProjections.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No projections returned from PrizePicks API — board may be empty',
          propsScraped: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Process through existing pipeline (stat mapping, sport filtering, MLBST handling)
    const propsToInsert = processExtractedProjections(extractedProjections, sports);
    console.log(`[PP Scraper] ${propsToInsert.length} props after sport filtering`);
    
    if (propsToInsert.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: `Fetched ${extractedProjections.length} projections but none matched target sports: ${sports.join(', ')}`,
          propsScraped: 0,
          totalFromAPI: extractedProjections.length,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get previous lines for move detection (batched to avoid query size limits)
    const playerNames = [...new Set(propsToInsert.map(p => p.player_name))];
    const LOOKUP_BATCH = 200;
    const allPreviousProps: PPSnapshotRow[] = [];
    for (let i = 0; i < playerNames.length; i += LOOKUP_BATCH) {
      const nameBatch = playerNames.slice(i, i + LOOKUP_BATCH);
      const { data: batchProps } = await supabase
        .from('pp_snapshot')
        .select('player_name, stat_type, pp_line, captured_at')
        .in('player_name', nameBatch)
        .order('captured_at', { ascending: false });
      if (batchProps) allPreviousProps.push(...(batchProps as PPSnapshotRow[]));
    }
    console.log(`[PP Scraper] Fetched ${allPreviousProps.length} previous lines in ${Math.ceil(playerNames.length / LOOKUP_BATCH)} batches`);

    const previousLineMap = new Map<string, number>();
    for (const prev of allPreviousProps) {
      const key = `${prev.player_name}_${prev.stat_type}`;
      if (!previousLineMap.has(key)) {
        previousLineMap.set(key, prev.pp_line);
      }
    }

    for (const prop of propsToInsert) {
      const key = `${prop.player_name}_${prop.stat_type}`;
      prop.previous_line = previousLineMap.get(key) || null;
    }

    const now = new Date().toISOString();

    // Batch insert in chunks of 500 to avoid statement timeout
    const INSERT_BATCH = 500;
    for (let i = 0; i < propsToInsert.length; i += INSERT_BATCH) {
      const batch = propsToInsert.slice(i, i + INSERT_BATCH);
      const { error: insertError } = await supabase.from('pp_snapshot').insert(batch);
      if (insertError) {
        console.error(`[PP Scraper] Batch ${Math.floor(i / INSERT_BATCH) + 1} error:`, insertError);
        throw new Error(`Failed to insert batch: ${insertError.message}`);
      }
      console.log(`[PP Scraper] Inserted batch ${Math.floor(i / INSERT_BATCH) + 1} (${batch.length} rows)`);
    }

    console.log('[PP Scraper] Successfully inserted', propsToInsert.length, 'props');

    await supabase.from('cron_job_history').insert({
      job_name: 'pp-props-scraper',
      status: 'completed',
      started_at: now,
      completed_at: new Date().toISOString(),
      result: {
        propsScraped: propsToInsert.length,
        sports: sports,
        source: 'prizepicks_api_direct',
        totalFromAPI: extractedProjections.length,
      }
    });

    // Log league breakdown
    const leagueBreakdown: Record<string, number> = {};
    for (const p of propsToInsert) {
      leagueBreakdown[p.league] = (leagueBreakdown[p.league] || 0) + 1;
    }
    console.log('[PP Scraper] League breakdown:', leagueBreakdown);

    return new Response(
      JSON.stringify({
        success: true,
        propsScraped: propsToInsert.length,
        totalFromAPI: extractedProjections.length,
        sports: sports,
        source: 'prizepicks_api_direct',
        leagueBreakdown,
        sampleProps: propsToInsert.slice(0, 5),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[PP Scraper] Fatal error:', errorMessage);
    
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});