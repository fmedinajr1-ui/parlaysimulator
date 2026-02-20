/**
 * mlb-data-ingestion
 * 
 * Fetches MLB player game logs from ESPN box scores.
 * Parses both batting and pitching lines, calculates total_bases.
 * Supports days_back parameter for 2024 season backfill.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard';
const ESPN_SUMMARY_URL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary';

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
  total_bases: number;
  innings_pitched: number | null;
  earned_runs: number | null;
  pitcher_strikeouts: number | null;
  pitcher_hits_allowed: number | null;
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
  console.log(`[MLB Ingestion] Fetching scoreboard: ${url}`);
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

function calculateTotalBases(statMap: Record<string, string>): number {
  const h = parseInt(statMap['H'] || '0') || 0;
  const doubles = parseInt(statMap['2B'] || '0') || 0;
  const triples = parseInt(statMap['3B'] || '0') || 0;
  const hr = parseInt(statMap['HR'] || '0') || 0;
  const singles = h - doubles - triples - hr;
  return singles + (2 * doubles) + (3 * triples) + (4 * hr);
}

function extractStats(boxScore: any, gameDate: string): PlayerGameLog[] {
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
          if (ab === 0) continue;

          const totalBases = calculateTotalBases(statMap);

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
            total_bases: totalBases,
            innings_pitched: null,
            earned_runs: null,
            pitcher_strikeouts: null,
            pitcher_hits_allowed: null,
            is_home: isHome,
          });
        } else if (isPitching) {
          const ip = parseFloat(statMap['IP'] || '0') || 0;
          if (ip === 0) continue;

          const existing = logs.find(l => l.player_name === playerName && l.game_date === gameDate);
          if (existing) {
            existing.innings_pitched = ip;
            existing.earned_runs = parseInt(statMap['ER'] || '0') || 0;
            existing.pitcher_strikeouts = parseInt(statMap['SO'] || statMap['K'] || '0') || 0;
            existing.pitcher_hits_allowed = parseInt(statMap['H'] || '0') || 0;
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
              total_bases: 0,
              innings_pitched: ip,
              earned_runs: parseInt(statMap['ER'] || '0') || 0,
              pitcher_strikeouts: parseInt(statMap['SO'] || statMap['K'] || '0') || 0,
              pitcher_hits_allowed: parseInt(statMap['H'] || '0') || 0,
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
    let fetchAllPlayers = false;
    let startDate: string | null = null;
    let endDate: string | null = null;
    try {
      const body = await req.json();
      daysBack = body.days_back || 1;
      fetchAllPlayers = body.fetch_all === true || daysBack > 7;
      startDate = body.start_date || null; // e.g. "2025-09-01"
      endDate = body.end_date || null;     // e.g. "2025-09-30"
    } catch {}

    // Build list of dates to process
    const datesToProcess: string[] = [];
    if (startDate && endDate) {
      fetchAllPlayers = true;
      const start = new Date(startDate);
      const end = new Date(endDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        datesToProcess.push(d.toISOString().split('T')[0]);
      }
      console.log(`[MLB Ingestion] Date range mode: ${startDate} to ${endDate} (${datesToProcess.length} days)`);
    } else {
      for (let d = 0; d < daysBack; d++) {
        datesToProcess.push(getEasternDate(d));
      }
    }

    // For backfill, fetch ALL players. For daily, only players with active props.
    const targetPlayers = new Set<string>();
    if (!fetchAllPlayers) {
      const { data: mlbProps } = await supabase
        .from('unified_props')
        .select('player_name')
        .eq('sport', 'baseball_mlb')
        .eq('is_active', true);

      (mlbProps || []).forEach((p: any) => {
        if (p.player_name) targetPlayers.add(normalizeName(p.player_name));
      });
      console.log(`[MLB Ingestion] ${targetPlayers.size} players with active props`);
    } else {
      console.log(`[MLB Ingestion] Backfill mode: fetching ALL players for ${datesToProcess.length} days`);
    }

    let totalInserted = 0;
    let totalEvents = 0;
    const errors: string[] = [];

    for (const dateStr of datesToProcess) {
      const events = await fetchScoreboard(dateStr);
      const completedEvents = events.filter((e: any) =>
        e.status?.type?.completed === true || e.status?.type?.name === 'STATUS_FINAL'
      );

      if (completedEvents.length > 0) {
        console.log(`[MLB Ingestion] ${dateStr}: ${completedEvents.length} completed games`);
      }

      // Fetch box scores in parallel batches of 5
      const BATCH_SIZE = 5;
      for (let i = 0; i < completedEvents.length; i += BATCH_SIZE) {
        const batch = completedEvents.slice(i, i + BATCH_SIZE);
        const boxScores = await Promise.all(batch.map((e: any) => fetchBoxScore(e.id)));
        
        for (let j = 0; j < batch.length; j++) {
          totalEvents++;
          const boxScore = boxScores[j];
          if (!boxScore) {
            errors.push(`Failed boxscore for ${batch[j].id}`);
            continue;
          }

          const playerLogs = extractStats(boxScore, dateStr);
          const relevantLogs = (fetchAllPlayers || targetPlayers.size === 0)
            ? playerLogs
            : playerLogs.filter(log => targetPlayers.has(normalizeName(log.player_name)));

        if (relevantLogs.length === 0) continue;

        // Batch upsert in chunks of 50
        for (let i = 0; i < relevantLogs.length; i += 50) {
          const chunk = relevantLogs.slice(i, i + 50);
          const { error: upsertError } = await supabase
            .from('mlb_player_game_logs')
            .upsert(
              chunk.map(log => ({
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
                total_bases: log.total_bases,
                innings_pitched: log.innings_pitched,
                earned_runs: log.earned_runs,
                pitcher_strikeouts: log.pitcher_strikeouts,
                pitcher_hits_allowed: log.pitcher_hits_allowed,
                is_home: log.is_home,
              })),
              { onConflict: 'player_name,game_date' }
            );

          if (upsertError) {
            errors.push(`Upsert error: ${upsertError.message}`);
          } else {
            totalInserted += chunk.length;
          }
        }
        } // end box score loop
        await new Promise(r => setTimeout(r, 50)); // small delay between batches
      } // end batch loop
    }

    const duration = Date.now() - startTime;

    await supabase.from('cron_job_history').insert({
      job_name: 'mlb-data-ingestion',
      status: errors.length > 0 ? 'completed_with_errors' : 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: {
        days_back: daysBack,
        fetch_all: fetchAllPlayers,
        target_players: targetPlayers.size,
        events_processed: totalEvents,
        logs_inserted: totalInserted,
        errors: errors.slice(0, 10),
      },
    });

    console.log(`[MLB Ingestion] Done in ${duration}ms: ${totalInserted} logs from ${totalEvents} events`);

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      events_processed: totalEvents,
      logs_inserted: totalInserted,
      target_players: targetPlayers.size,
      fetch_all: fetchAllPlayers,
      errors: errors.slice(0, 10),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[MLB Ingestion] Fatal error:', msg);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from('cron_job_history').insert({
      job_name: 'mlb-data-ingestion',
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
