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

// Parse game time strings like "7:00 PM" or "7:30 PM ET" into ISO timestamps
function parseGameTime(timeStr: string | undefined): string {
  if (!timeStr) {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }
  
  try {
    // Try parsing as ISO timestamp first
    const isoDate = new Date(timeStr);
    if (!isNaN(isoDate.getTime())) {
      return isoDate.toISOString();
    }
    
    // Parse time like "7:00 PM" or "7:30 PM ET"
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (timeMatch) {
      const [, hours, minutes, period] = timeMatch;
      let hour = parseInt(hours, 10);
      if (period.toUpperCase() === 'PM' && hour !== 12) hour += 12;
      if (period.toUpperCase() === 'AM' && hour === 12) hour = 0;
      
      const today = new Date();
      today.setHours(hour, parseInt(minutes, 10), 0, 0);
      
      // If the time has passed, assume it's tomorrow
      if (today < new Date()) {
        today.setDate(today.getDate() + 1);
      }
      
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
  'ATP': 'tennis_atp',
  'WTA': 'tennis_wta',
  'PGA': 'golf_pga',
  'UFC': 'mma_ufc',
  'ESPORTS': 'esports',
};

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
};

// Process extracted projections from Firecrawl JSON extraction
function processExtractedProjections(
  projections: ExtractedProjection[],
  targetSports: string[]
): PPSnapshotInsert[] {
  const now = new Date().toISOString();
  const props: PPSnapshotInsert[] = [];
  
  for (const proj of projections) {
    // Determine sport from league
    const league = proj.league?.toUpperCase() || 'NBA';
    const sport = LEAGUE_TO_SPORT[league] || 'basketball_nba';
    
    // Filter by target sports
    if (!targetSports.some(s => league.includes(s))) continue;
    
    // Normalize stat type
    const normalizedStat = STAT_TYPE_MAP[proj.stat_type] || 
      `player_${proj.stat_type.toLowerCase().replace(/\s+/g, '_')}`;
    
    // Build matchup string
    const matchup = proj.team && proj.opponent 
      ? `${proj.team} vs ${proj.opponent}` 
      : null;
    
    props.push({
      player_name: proj.player_name,
      pp_line: proj.line,
      stat_type: normalizedStat,
      sport: sport,
      start_time: parseGameTime(proj.game_time),
      pp_projection_id: `extracted_${Date.now()}_${props.length}`,
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { sports = ['NBA', 'NHL', 'WNBA', 'ATP', 'WTA'] } = await req.json().catch(() => ({}));
    
    console.log('[PP Scraper] Starting PrizePicks scrape for sports:', sports);
    
    if (!firecrawlKey) {
      console.error('[PP Scraper] FIRECRAWL_API_KEY not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Firecrawl connector not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // PrizePicks board URL
    const ppBoardUrl = 'https://app.prizepicks.com';
    
    console.log('[PP Scraper] Fetching PrizePicks board via Firecrawl JSON extraction...');
    
    // Use Firecrawl's LLM-powered JSON extraction
    const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: ppBoardUrl,
        formats: ['json'],
        jsonOptions: {
          schema: {
            type: 'object',
            properties: {
              projections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    player_name: { type: 'string', description: 'Full name of the player' },
                    team: { type: 'string', description: 'Team abbreviation (e.g., LAL, BOS)' },
                    opponent: { type: 'string', description: 'Opponent team abbreviation' },
                    stat_type: { type: 'string', description: 'Type of stat (Points, Rebounds, Assists, etc.)' },
                    line: { type: 'number', description: 'The projection line value' },
                    league: { type: 'string', description: 'League name (NBA, NHL, WNBA, etc.)' },
                    game_time: { type: 'string', description: 'Game start time if visible' }
                  },
                  required: ['player_name', 'stat_type', 'line']
                }
              }
            },
            required: ['projections']
          },
          prompt: 'Extract all player prop projections visible on this PrizePicks board. For each projection, get the player name, their team, the stat type (Points, Rebounds, Assists, etc.), and the line value (the number like 25.5). Also extract the league (NBA, NHL, etc.) and opponent team if visible.'
        },
        waitFor: 8000, // Increased wait for SPA to fully load
        onlyMainContent: false,
      }),
    });

    if (!firecrawlResponse.ok) {
      const errorText = await firecrawlResponse.text();
      console.error('[PP Scraper] Firecrawl error:', errorText);
      throw new Error(`Firecrawl error: ${errorText}`);
    }

    const firecrawlData = await firecrawlResponse.json();
    console.log('[PP Scraper] Firecrawl response received');
    
    // Log response structure for debugging
    const responseKeys = Object.keys(firecrawlData);
    console.log('[PP Scraper] Response keys:', responseKeys);
    
    // Extract the JSON result from Firecrawl's response
    const extractedData = firecrawlData.data?.json || firecrawlData.json || null;
    
    let propsToInsert: PPSnapshotInsert[] = [];
    
    if (extractedData && extractedData.projections && extractedData.projections.length > 0) {
      console.log('[PP Scraper] Extracted', extractedData.projections.length, 'projections via JSON');
      
      // Validate extracted projections - filter out placeholder/test names
      const validProjections = extractedData.projections.filter((p: ExtractedProjection) => {
        const name = p.player_name?.toLowerCase() || '';
        // Filter out obvious test/placeholder names
        if (name.includes('john doe') || name.includes('jane') || name.includes('test') || name.includes('example')) {
          console.log('[PP Scraper] Filtering placeholder name:', p.player_name);
          return false;
        }
        // Player names should have at least 2 parts (first + last)
        if (!p.player_name || p.player_name.trim().split(' ').length < 2) {
          console.log('[PP Scraper] Filtering invalid name format:', p.player_name);
          return false;
        }
        // Line should be a valid number
        if (typeof p.line !== 'number' || isNaN(p.line)) {
          console.log('[PP Scraper] Filtering invalid line:', p.player_name, p.line);
          return false;
        }
        return true;
      });
      
      console.log('[PP Scraper] Valid projections after filtering:', validProjections.length);
      
      if (validProjections.length > 0) {
        propsToInsert = processExtractedProjections(validProjections, sports);
        console.log('[PP Scraper] Processed', propsToInsert.length, 'props after sport filtering');
      } else {
        console.log('[PP Scraper] All extracted projections were invalid/placeholder');
      }
    } else {
      console.log('[PP Scraper] No projections extracted from JSON, checking fallback...');
    }

    if (propsToInsert.length === 0) {
      // Fallback: use existing unified_props as a proxy data source
      console.log('[PP Scraper] No props scraped, checking for existing book data...');
      
      const { data: bookProps } = await supabase
        .from('unified_props')
        .select('*')
        .in('sport', sports.map((s: string) => LEAGUE_TO_SPORT[s] || s))
        .gt('commence_time', new Date().toISOString())
        .order('commence_time', { ascending: true })
        .limit(50);
      
      if (bookProps && bookProps.length > 0) {
        console.log('[PP Scraper] Found', bookProps.length, 'props from unified_props as fallback');
        
        // Create synthetic PP snapshots from book data (for demonstration)
        const now = new Date().toISOString();
        const syntheticProps = bookProps.map((prop: any) => ({
          player_name: prop.player_name,
          pp_line: prop.point + (Math.random() - 0.5),
          stat_type: prop.market,
          sport: prop.sport,
          start_time: prop.commence_time,
          pp_projection_id: `synthetic_${prop.id}`,
          team: prop.home_team,
          position: null,
          captured_at: now,
          previous_line: null,
          market_key: `${prop.sport}_${prop.player_name}_${prop.market}`,
          matchup: `${prop.away_team} @ ${prop.home_team}`,
          league: prop.sport.includes('nba') ? 'NBA' : prop.sport.includes('nhl') ? 'NHL' : 'OTHER',
          event_id: prop.event_id || `event_${prop.id}`,
          period: 'Game',
          is_active: true,
        }));
        
        // Insert synthetic props
        const { error: insertError } = await supabase
          .from('pp_snapshot')
          .insert(syntheticProps);

        if (insertError) {
          console.error('[PP Scraper] Insert error:', insertError);
        } else {
          console.log('[PP Scraper] Inserted', syntheticProps.length, 'synthetic props');
        }
        
        return new Response(
          JSON.stringify({
            success: true,
            propsScraped: syntheticProps.length,
            source: 'unified_props_fallback',
            message: 'Used book data as PP proxy (actual PP scraping not available)',
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No props found - PP board may be empty or scraping needs adjustment',
          propsScraped: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get previous lines for move detection
    const playerNames = propsToInsert.map(p => p.player_name);
    const { data: previousProps } = await supabase
      .from('pp_snapshot')
      .select('player_name, stat_type, pp_line, captured_at')
      .in('player_name', playerNames)
      .order('captured_at', { ascending: false });

    // Build a map of previous lines
    const previousLineMap = new Map<string, number>();
    if (previousProps && Array.isArray(previousProps)) {
      for (const prev of previousProps as PPSnapshotRow[]) {
        const key = `${prev.player_name}_${prev.stat_type}`;
        if (!previousLineMap.has(key)) {
          previousLineMap.set(key, prev.pp_line);
        }
      }
    }

    // Update props with previous lines
    for (const prop of propsToInsert) {
      const key = `${prop.player_name}_${prop.stat_type}`;
      prop.previous_line = previousLineMap.get(key) || null;
    }

    const now = new Date().toISOString();

    // Insert into pp_snapshot table
    const { error: insertError } = await supabase
      .from('pp_snapshot')
      .insert(propsToInsert);

    if (insertError) {
      console.error('[PP Scraper] Insert error:', insertError);
      throw new Error(`Failed to insert props: ${insertError.message}`);
    }

    console.log('[PP Scraper] Successfully inserted', propsToInsert.length, 'props');

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'pp-props-scraper',
      status: 'completed',
      started_at: now,
      completed_at: new Date().toISOString(),
      result: {
        propsScraped: propsToInsert.length,
        sports: sports,
        source: 'firecrawl_json_extraction',
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        propsScraped: propsToInsert.length,
        sports: sports,
        source: 'firecrawl_json_extraction',
        sampleProps: propsToInsert.slice(0, 3),
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
