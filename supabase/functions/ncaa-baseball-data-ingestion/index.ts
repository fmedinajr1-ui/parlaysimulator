/**
 * ncaa-baseball-data-ingestion
 * 
 * Fetches NCAA baseball player game logs from ESPN box scores for players
 * that have active props in unified_props. Parses both batting and pitching lines.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard';
const ESPN_SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/summary';

interface PlayerGameLog {
  player_name: string;
  team: string;
  game_date: string;
  opponent: string;
  at_bats: number;
  hits: number;
  runs: number;
  rbis: number;
  home_runs: number;
  stolen_bases: number;
  walks: number;
  strikeouts: number;
  batting_avg: number;
  innings_pitched: number | null;
  earned_runs: number | null;
  pitcher_strikeouts: number | null;
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

async function fetchScoreboard(dateStr: string): Promise<any[]> {
  const formattedDate = dateStr.replace(/-/g, '');
  const url = `${ESPN_SCOREBOARD_URL}?dates=${formattedDate}&limit=100`;
  console.log(`[Baseball Ingestion] Fetching scoreboard: ${url}`);
  try {
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.events || [];
  } catch {
    return [];
  }
}

async function fetchBoxScore(eventId: string): Promise<any | null> {
  const url = `${ESPN_SUMMARY_URL}?event=${eventId}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

function extractBattingStats(boxScore: any, gameDate: string): PlayerGameLog[] {
  const logs: PlayerGameLog[] = [];
  if (!boxScore?.boxscore?.players) return logs;

  for (const teamStats of boxScore.boxscore.players) {
    const teamName = teamStats.team?.displayName || 'Unknown';
    const teamId = teamStats.team?.id;
    const isHome = boxScore.header?.competitions?.[0]?.competitors?.find(
      (c: any) => c.id === teamId
    )?.homeAway === 'home';

    const competitors = boxScore.header?.competitions?.[0]?.competitors || [];
    const opponent = competitors.find((c: any) => c.id !== teamId)?.team?.displayName || 'Unknown';

    for (const statGroup of (teamStats.statistics || [])) {
      // Check if this is a batting or pitching group
      const labels = (statGroup.labels || []).map((l: string) => l.toUpperCase());
      const isBatting = labels.includes('AB') || labels.includes('H') || labels.includes('RBI');
      const isPitching = labels.includes('IP') || labels.includes('ER') || labels.includes('ERA');

      for (const athlete of (statGroup.athletes || [])) {
        const playerName = athlete.athlete?.displayName;
        if (!playerName) continue;

        const stats = athlete.stats || [];
        const statMap: Record<string, string> = {};
        labels.forEach((label: string, i: number) => {
          statMap[label] = stats[i] || '0';
        });

        if (isBatting) {
          const ab = parseInt(statMap['AB'] || '0') || 0;
          if (ab === 0) continue; // Skip non-batters

          logs.push({
            player_name: playerName,
            team: teamName,
            game_date: gameDate,
            opponent,
            at_bats: ab,
            hits: parseInt(statMap['H'] || '0') || 0,
            runs: parseInt(statMap['R'] || '0') || 0,
            rbis: parseInt(statMap['RBI'] || '0') || 0,
            home_runs: parseInt(statMap['HR'] || '0') || 0,
            stolen_bases: parseInt(statMap['SB'] || '0') || 0,
            walks: parseInt(statMap['BB'] || '0') || 0,
            strikeouts: parseInt(statMap['SO'] || statMap['K'] || '0') || 0,
            batting_avg: parseFloat(statMap['AVG'] || '0') || 0,
            innings_pitched: null,
            earned_runs: null,
            pitcher_strikeouts: null,
            is_home: isHome,
          });
        } else if (isPitching) {
          const ip = parseFloat(statMap['IP'] || '0') || 0;
          if (ip === 0) continue;

          // Find or create a log for this pitcher (may also have a batting line)
          const existing = logs.find(l => l.player_name === playerName && l.game_date === gameDate);
          if (existing) {
            existing.innings_pitched = ip;
            existing.earned_runs = parseInt(statMap['ER'] || '0') || 0;
            existing.pitcher_strikeouts = parseInt(statMap['SO'] || statMap['K'] || '0') || 0;
          } else {
            logs.push({
              player_name: playerName,
              team: teamName,
              game_date: gameDate,
              opponent,
              at_bats: 0,
              hits: 0,
              runs: 0,
              rbis: 0,
              home_runs: 0,
              stolen_bases: 0,
              walks: 0,
              strikeouts: 0,
              batting_avg: 0,
              innings_pitched: ip,
              earned_runs: parseInt(statMap['ER'] || '0') || 0,
              pitcher_strikeouts: parseInt(statMap['SO'] || statMap['K'] || '0') || 0,
              is_home: isHome,
            });
          }
        }
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

    let daysBack = 1;
    try {
      const body = await req.json();
      daysBack = body.days_back || 1;
    } catch {}

    // Get baseball players with active props
    const { data: baseballProps } = await supabase
      .from('unified_props')
      .select('player_name')
      .eq('sport', 'baseball_ncaa')
      .eq('is_active', true);

    const targetPlayers = new Set<string>();
    (baseballProps || []).forEach((p: any) => {
      if (p.player_name) targetPlayers.add(normalizeName(p.player_name));
    });

    console.log(`[Baseball Ingestion] ${targetPlayers.size} players with active props`);

    let totalInserted = 0;
    let totalEvents = 0;
    const errors: string[] = [];

    for (let d = 0; d < daysBack; d++) {
      const dateStr = getEasternDate(d);
      const events = await fetchScoreboard(dateStr);
      const completedEvents = events.filter((e: any) =>
        e.status?.type?.completed === true || e.status?.type?.name === 'STATUS_FINAL'
      );

      console.log(`[Baseball Ingestion] ${dateStr}: ${completedEvents.length} completed games`);

      for (const event of completedEvents) {
        totalEvents++;
        if (totalEvents > 1) await new Promise(r => setTimeout(r, 200));

        const boxScore = await fetchBoxScore(event.id);
        if (!boxScore) {
          errors.push(`Failed boxscore for ${event.id}`);
          continue;
        }

        const playerLogs = extractBattingStats(boxScore, dateStr);
        const relevantLogs = targetPlayers.size > 0
          ? playerLogs.filter(log => targetPlayers.has(normalizeName(log.player_name)))
          : playerLogs;

        if (relevantLogs.length === 0) continue;

        const { error: upsertError } = await supabase
          .from('ncaa_baseball_player_game_logs')
          .upsert(
            relevantLogs.map(log => ({
              player_name: log.player_name,
              team: log.team,
              game_date: log.game_date,
              opponent: log.opponent,
              at_bats: log.at_bats,
              hits: log.hits,
              runs: log.runs,
              rbis: log.rbis,
              home_runs: log.home_runs,
              stolen_bases: log.stolen_bases,
              walks: log.walks,
              strikeouts: log.strikeouts,
              batting_avg: log.batting_avg,
              innings_pitched: log.innings_pitched,
              earned_runs: log.earned_runs,
              pitcher_strikeouts: log.pitcher_strikeouts,
              is_home: log.is_home,
            })),
            { onConflict: 'player_name,game_date' }
          );

        if (upsertError) {
          errors.push(`Upsert error ${event.id}: ${upsertError.message}`);
        } else {
          totalInserted += relevantLogs.length;
        }
      }
    }

    const duration = Date.now() - startTime;

    await supabase.from('cron_job_history').insert({
      job_name: 'ncaa-baseball-data-ingestion',
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

    console.log(`[Baseball Ingestion] Done in ${duration}ms: ${totalInserted} logs from ${totalEvents} events`);

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
    console.error('[Baseball Ingestion] Fatal error:', msg);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from('cron_job_history').insert({
      job_name: 'ncaa-baseball-data-ingestion',
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
