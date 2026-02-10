/**
 * ncaab-data-ingestion
 * 
 * Fetches NCAAB player game logs from ESPN box scores for players
 * that have active props in unified_props. Also seeds ncaab_team_stats.
 * 
 * Runs on cron schedule alongside pvs-data-ingestion.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard';
const ESPN_BOXSCORE_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary';

interface PlayerGameLog {
  player_name: string;
  team: string;
  game_date: string;
  opponent: string;
  minutes_played: number;
  points: number;
  rebounds: number;
  assists: number;
  threes_made: number;
  blocks: number;
  steals: number;
  turnovers: number;
  is_home: boolean;
}

function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getEasternDate(daysAgo = 0): string {
  const now = new Date();
  now.setDate(now.getDate() - daysAgo);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

async function fetchESPNScoreboard(dateStr: string): Promise<any[]> {
  const formattedDate = dateStr.replace(/-/g, '');
  const url = `${ESPN_SCOREBOARD_URL}?dates=${formattedDate}&limit=100`;
  console.log(`[NCAAB Ingestion] Fetching scoreboard: ${url}`);
  
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error(`[NCAAB Ingestion] Scoreboard fetch failed: ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    return data.events || [];
  } catch (e) {
    console.error(`[NCAAB Ingestion] Scoreboard error:`, e);
    return [];
  }
}

async function fetchESPNBoxScore(eventId: string): Promise<any | null> {
  const url = `${ESPN_BOXSCORE_URL}?event=${eventId}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function extractPlayerStats(boxScore: any, gameDate: string): PlayerGameLog[] {
  const logs: PlayerGameLog[] = [];
  
  if (!boxScore?.boxscore?.players) return logs;
  
  for (const teamStats of boxScore.boxscore.players) {
    const teamName = teamStats.team?.displayName || teamStats.team?.shortDisplayName || 'Unknown';
    const teamId = teamStats.team?.id;
    const isHome = boxScore.header?.competitions?.[0]?.competitors?.find(
      (c: any) => c.id === teamId
    )?.homeAway === 'home';
    
    // Find opponent
    const competitors = boxScore.header?.competitions?.[0]?.competitors || [];
    const opponent = competitors.find((c: any) => c.id !== teamId)?.team?.displayName || 'Unknown';
    
    for (const statGroup of (teamStats.statistics || [])) {
      for (const athlete of (statGroup.athletes || [])) {
        const playerName = athlete.athlete?.displayName;
        if (!playerName) continue;
        
        const stats = athlete.stats || [];
        const labels = statGroup.labels || [];
        
        // Build stat map from labels + stats arrays
        const statMap: Record<string, string> = {};
        labels.forEach((label: string, i: number) => {
          statMap[label.toUpperCase()] = stats[i] || '0';
        });
        
        // Parse minutes
        const minStr = statMap['MIN'] || '0';
        const minutes = parseFloat(minStr) || 0;
        if (minutes === 0) continue; // Skip DNP
        
        // Parse FG3M (three-pointers made) from the FG3 field "made-attempted"
        let threesMade = 0;
        const fg3 = statMap['3PT'] || statMap['FG3'] || '0-0';
        if (fg3.includes('-')) {
          threesMade = parseInt(fg3.split('-')[0]) || 0;
        }
        
        logs.push({
          player_name: playerName,
          team: teamName,
          game_date: gameDate,
          opponent,
          minutes_played: minutes,
          points: parseInt(statMap['PTS'] || '0') || 0,
          rebounds: parseInt(statMap['REB'] || '0') || 0,
          assists: parseInt(statMap['AST'] || '0') || 0,
          threes_made: threesMade,
          blocks: parseInt(statMap['BLK'] || '0') || 0,
          steals: parseInt(statMap['STL'] || '0') || 0,
          turnovers: parseInt(statMap['TO'] || '0') || 0,
          is_home: isHome,
        });
      }
    }
  }
  
  return logs;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request
    let daysBack = 1;
    try {
      const body = await req.json();
      daysBack = body.days_back || 1;
    } catch {}

    // Step 1: Get NCAAB players that have active props
    const { data: ncaabProps } = await supabase
      .from('unified_props')
      .select('player_name')
      .eq('sport', 'basketball_ncaab')
      .eq('is_active', true);

    const targetPlayers = new Set<string>();
    (ncaabProps || []).forEach((p: any) => {
      if (p.player_name) targetPlayers.add(normalizeName(p.player_name));
    });

    console.log(`[NCAAB Ingestion] ${targetPlayers.size} NCAAB players with active props`);

    // Step 2: Fetch box scores for recent days
    let totalInserted = 0;
    let totalEvents = 0;
    const errors: string[] = [];

    for (let d = 0; d < daysBack; d++) {
      const dateStr = getEasternDate(d);
      console.log(`[NCAAB Ingestion] Processing date: ${dateStr}`);

      const events = await fetchESPNScoreboard(dateStr);
      console.log(`[NCAAB Ingestion] Found ${events.length} events for ${dateStr}`);

      // Only process completed games
      const completedEvents = events.filter((e: any) => 
        e.status?.type?.completed === true || e.status?.type?.name === 'STATUS_FINAL'
      );

      for (const event of completedEvents) {
        totalEvents++;
        const eventId = event.id;
        
        // Rate limit: small delay between requests
        if (totalEvents > 1) await new Promise(r => setTimeout(r, 200));
        
        const boxScore = await fetchESPNBoxScore(eventId);
        if (!boxScore) {
          errors.push(`Failed to fetch boxscore for event ${eventId}`);
          continue;
        }

        const playerLogs = extractPlayerStats(boxScore, dateStr);
        
        // Filter to only players with active props (or insert all if no filter)
        const relevantLogs = targetPlayers.size > 0
          ? playerLogs.filter(log => targetPlayers.has(normalizeName(log.player_name)))
          : playerLogs;

        if (relevantLogs.length === 0) continue;

        // Upsert into ncaab_player_game_logs
        const { error: upsertError } = await supabase
          .from('ncaab_player_game_logs')
          .upsert(
            relevantLogs.map(log => ({
              player_name: log.player_name,
              team: log.team,
              game_date: log.game_date,
              opponent: log.opponent,
              minutes_played: log.minutes_played,
              points: log.points,
              rebounds: log.rebounds,
              assists: log.assists,
              threes_made: log.threes_made,
              blocks: log.blocks,
              steals: log.steals,
              turnovers: log.turnovers,
              is_home: log.is_home,
            })),
            { onConflict: 'player_name,game_date' }
          );

        if (upsertError) {
          errors.push(`Upsert error for event ${eventId}: ${upsertError.message}`);
        } else {
          totalInserted += relevantLogs.length;
        }
      }
    }

    const duration = Date.now() - startTime;

    // Log to cron_job_history
    await supabase.from('cron_job_history').insert({
      job_name: 'ncaab-data-ingestion',
      status: errors.length > 0 ? 'completed_with_errors' : 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: {
        days_back: daysBack,
        target_players: targetPlayers.size,
        events_processed: totalEvents,
        logs_inserted: totalInserted,
        errors: errors.slice(0, 10),
      },
    });

    console.log(`[NCAAB Ingestion] Done in ${duration}ms: ${totalInserted} logs from ${totalEvents} events`);

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      events_processed: totalEvents,
      logs_inserted: totalInserted,
      target_players: targetPlayers.size,
      errors: errors.slice(0, 10),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[NCAAB Ingestion] Fatal error:', msg);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from('cron_job_history').insert({
      job_name: 'ncaab-data-ingestion',
      status: 'failed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      error_message: msg,
    });

    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
