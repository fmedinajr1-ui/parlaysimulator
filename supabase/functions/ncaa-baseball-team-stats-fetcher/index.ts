/**
 * ncaa-baseball-team-stats-fetcher
 * 
 * Fetches NCAA baseball team stats from ESPN APIs
 * and populates ncaa_baseball_team_stats with efficiency metrics.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_TEAMS_URL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/teams';

interface TeamStats {
  team_name: string;
  espn_id: string;
  conference: string | null;
  national_rank: number | null;
  runs_per_game: number | null;
  runs_allowed_per_game: number | null;
  era: number | null;
  batting_avg: number | null;
  home_record: string | null;
  away_record: string | null;
}

async function fetchWithRetry(url: string, retries = 2): Promise<Response | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return resp;
      if (resp.status === 429 && i < retries) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      return null;
    } catch {
      if (i < retries) await new Promise(r => setTimeout(r, 500));
    }
  }
  return null;
}

async function fetchAllTeamIds(): Promise<{ id: string; name: string; conference: string | null }[]> {
  const teams: { id: string; name: string; conference: string | null }[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 6; page++) {
    const resp = await fetchWithRetry(`${ESPN_TEAMS_URL}?limit=100&page=${page}`);
    if (!resp) break;
    const data = await resp.json();
    const entries = data.sports?.[0]?.leagues?.[0]?.teams || [];
    if (entries.length === 0) break;

    for (const entry of entries) {
      const t = entry.team || entry;
      if (!t.id || !t.displayName || seen.has(t.id)) continue;
      seen.add(t.id);
      teams.push({
        id: t.id,
        name: t.displayName,
        conference: t.groups?.parent?.shortName || t.groups?.name || null,
      });
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return teams;
}

async function enrichTeamStats(teamId: string): Promise<{
  rpg: number; rapg: number; era: number | null; bavg: number | null;
  home: string | null; away: string | null;
} | null> {
  const resp = await fetchWithRetry(`${ESPN_TEAMS_URL}/${teamId}`);
  if (!resp) return null;
  const data = await resp.json();

  const team = data.team || data;
  let rpg = 0, rapg = 0, era: number | null = null, bavg: number | null = null;
  let home: string | null = null, away: string | null = null;

  const recordItems = team.record?.items || [];
  for (const item of recordItems) {
    if (item.type === 'home') home = item.summary || null;
    if (item.type === 'away') away = item.summary || null;
    if (item.type === 'total' || !item.type) {
      for (const stat of (item.stats || [])) {
        if (stat.name === 'avgPointsFor' || stat.name === 'runs' || stat.name === 'runsScored') {
          const v = parseFloat(stat.value);
          if (v > 0 && v < 50) rpg = v; // average
          else if (v > 50) rpg = v; // total, will divide later
        }
        if (stat.name === 'avgPointsAgainst' || stat.name === 'runsAllowed') {
          const v = parseFloat(stat.value);
          if (v > 0 && v < 50) rapg = v;
          else if (v > 50) rapg = v;
        }
        if (stat.name === 'ERA' || stat.name === 'era') {
          era = parseFloat(stat.value) || null;
        }
        if (stat.name === 'AVG' || stat.name === 'battingAverage' || stat.name === 'avg') {
          bavg = parseFloat(stat.value) || null;
        }
      }
    }
  }

  // If totals instead of averages, divide by games
  if (rpg > 50 && recordItems.length > 0) {
    const totalItem = recordItems.find((i: any) => i.type === 'total' || !i.type);
    if (totalItem) {
      const gpStat = (totalItem.stats || []).find((s: any) => s.name === 'gamesPlayed');
      if (gpStat) {
        const gp = parseFloat(gpStat.value);
        if (gp > 0) {
          if (rpg > 50) rpg = rpg / gp;
          if (rapg > 50) rapg = rapg / gp;
        }
      }
    }
  }

  if (rpg === 0) return null;
  return { rpg, rapg, era, bavg, home, away };
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

    console.log('[Baseball Stats] Starting fetch');

    const teams = await fetchAllTeamIds();
    console.log(`[Baseball Stats] Found ${teams.length} teams`);

    if (teams.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No teams found' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const BATCH_SIZE = 15;
    const MAX_TEAMS = 200;
    const teamsToEnrich = teams.slice(0, MAX_TEAMS);
    const results: TeamStats[] = [];
    let enriched = 0;

    for (let i = 0; i < teamsToEnrich.length; i += BATCH_SIZE) {
      const batch = teamsToEnrich.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async (t) => {
          const stats = await enrichTeamStats(t.id);
          return { team: t, stats };
        })
      );

      for (const r of batchResults) {
        if (r.status === 'fulfilled' && r.value.stats) {
          const { team: t, stats } = r.value;
          results.push({
            team_name: t.name,
            espn_id: t.id,
            conference: t.conference,
            national_rank: null,
            runs_per_game: Math.round(stats.rpg * 100) / 100,
            runs_allowed_per_game: stats.rapg > 0 ? Math.round(stats.rapg * 100) / 100 : null,
            era: stats.era,
            batting_avg: stats.bavg,
            home_record: stats.home,
            away_record: stats.away,
          });
          enriched++;
        }
      }

      if (Date.now() - startTime > 45000) {
        console.log(`[Baseball Stats] Time budget hit at batch ${i}`);
        break;
      }

      await new Promise(r => setTimeout(r, 300));
    }

    // Add non-enriched teams
    const enrichedNames = new Set(results.map(r => r.team_name));
    for (const t of teams) {
      if (!enrichedNames.has(t.name)) {
        results.push({
          team_name: t.name,
          espn_id: t.id,
          conference: t.conference,
          national_rank: null,
          runs_per_game: null,
          runs_allowed_per_game: null,
          era: null,
          batting_avg: null,
          home_record: null,
          away_record: null,
        });
      }
    }

    // Rank by run differential
    const ranked = results
      .filter(t => t.runs_per_game !== null && t.runs_allowed_per_game !== null)
      .sort((a, b) => {
        const diffA = (a.runs_per_game || 0) - (a.runs_allowed_per_game || 0);
        const diffB = (b.runs_per_game || 0) - (b.runs_allowed_per_game || 0);
        return diffB - diffA;
      });

    ranked.forEach((team, idx) => { team.national_rank = idx + 1; });

    // Upsert in chunks
    let totalUpserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < results.length; i += 100) {
      const chunk = results.slice(i, i + 100).map(t => ({
        team_name: t.team_name,
        espn_id: t.espn_id,
        conference: t.conference,
        national_rank: t.national_rank,
        runs_per_game: t.runs_per_game,
        runs_allowed_per_game: t.runs_allowed_per_game,
        era: t.era,
        batting_avg: t.batting_avg,
        home_record: t.home_record,
        away_record: t.away_record,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('ncaa_baseball_team_stats')
        .upsert(chunk, { onConflict: 'team_name' });

      if (error) errors.push(error.message);
      else totalUpserted += chunk.length;
    }

    const duration = Date.now() - startTime;

    await supabase.from('cron_job_history').insert({
      job_name: 'ncaa-baseball-team-stats-fetcher',
      status: errors.length > 0 ? 'completed_with_errors' : 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: {
        teams_fetched: results.length,
        teams_enriched: enriched,
        teams_ranked: ranked.length,
        teams_upserted: totalUpserted,
        errors: errors.slice(0, 3),
      },
    });

    console.log(`[Baseball Stats] Done in ${duration}ms: ${totalUpserted} upserted`);

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      teams_fetched: results.length,
      teams_enriched: enriched,
      teams_ranked: ranked.length,
      teams_upserted: totalUpserted,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Baseball Stats] Fatal error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
