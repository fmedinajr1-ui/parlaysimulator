/**
 * ncaab-team-stats-fetcher
 * 
 * Fetches NCAAB team efficiency data from ESPN APIs
 * and populates ncaab_team_stats with KenPom-style metrics.
 * 
 * Optimized: extracts stats from team detail endpoints in parallel batches.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_TEAMS_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams';


interface TeamStats {
  team_name: string;
  espn_id: string;
  conference: string | null;
  kenpom_rank: number | null;
  adj_offense: number | null;
  adj_defense: number | null;
  adj_tempo: number | null;
  ppg: number | null;
  oppg: number | null;
  home_record: string | null;
  away_record: string | null;
  ats_record: string | null;
  over_under_record: string | null;
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

  for (let page = 1; page <= 4; page++) {
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
  ppg: number; oppg: number; home: string | null; away: string | null; conference: string | null;
} | null> {
  const resp = await fetchWithRetry(`${ESPN_TEAMS_URL}/${teamId}`);
  if (!resp) return null;
  const data = await resp.json();

  const team = data.team || data;
  let ppg = 0, oppg = 0, home: string | null = null, away: string | null = null;
  
  // Extract conference from standingSummary (e.g. "12th in ACC")
  let conference: string | null = null;
  const standingSummary: string | null = team.standingSummary || null;
  if (standingSummary) {
    const match = standingSummary.match(/in\s+(.+)$/);
    if (match) conference = match[1].trim();
  }

  // Extract from record items — ESPN uses "road" not "away"
  const recordItems = team.record?.items || [];
  for (const item of recordItems) {
    if (item.type === 'home') home = item.summary || null;
    if (item.type === 'road') away = item.summary || null;
    if (item.type === 'total' || !item.type) {
      for (const stat of (item.stats || [])) {
        if (stat.name === 'avgPointsFor' || stat.name === 'pointsFor') {
          const v = parseFloat(stat.value);
          if (stat.name === 'avgPointsFor') ppg = v;
          else if (v > 0 && ppg === 0) ppg = v;
        }
        if (stat.name === 'avgPointsAgainst' || stat.name === 'pointsAgainst') {
          const v = parseFloat(stat.value);
          if (stat.name === 'avgPointsAgainst') oppg = v;
          else if (v > 0 && oppg === 0) oppg = v;
        }
      }
    }
  }

  // If we got total points but not averages, try to compute
  if (ppg > 200 && recordItems.length > 0) {
    const totalItem = recordItems.find((i: any) => i.type === 'total' || !i.type);
    if (totalItem) {
      const gpStat = (totalItem.stats || []).find((s: any) => s.name === 'gamesPlayed');
      if (gpStat) {
        const gp = parseFloat(gpStat.value);
        if (gp > 0) {
          if (ppg > 200) ppg = ppg / gp;
          if (oppg > 200) oppg = oppg / gp;
        }
      }
    }
  }

  if (ppg === 0) return null;
  return { ppg, oppg, home, away, conference };
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

    console.log('[NCAAB Stats] Starting optimized fetch');

    // Step 1: Get all team IDs
    const teams = await fetchAllTeamIds();
    console.log(`[NCAAB Stats] Found ${teams.length} teams`);

    if (teams.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No teams found' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 2: Enrich in parallel batches of 15
    const BATCH_SIZE = 15;
    const MAX_TEAMS = 200; // Focus on top teams, stay within time limits
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
          const avgTempo = 67;
          const avgTotal = 135;
          let tempo: number | null = null;

          if (stats.oppg > 0) {
            const totalPPG = stats.ppg + stats.oppg;
            const tempoDelta = ((totalPPG - avgTotal) / 10) * 3;
            tempo = Math.round((avgTempo + tempoDelta) * 10) / 10;
          }

          results.push({
            team_name: t.name,
            espn_id: t.id,
            conference: stats.conference || t.conference,
            kenpom_rank: null,
            adj_offense: Math.round(stats.ppg * 10) / 10,
            adj_defense: stats.oppg > 0 ? Math.round(stats.oppg * 10) / 10 : null,
            adj_tempo: tempo,
            ppg: Math.round(stats.ppg * 10) / 10,
            oppg: stats.oppg > 0 ? Math.round(stats.oppg * 10) / 10 : null,
            home_record: stats.home,
            away_record: stats.away,
            ats_record: null,
            over_under_record: null,
          });
          enriched++;
        }
      }

      // Check time budget (50s max for edge function)
      if (Date.now() - startTime > 45000) {
        console.log(`[NCAAB Stats] Time budget hit at batch ${i}, stopping enrichment`);
        break;
      }

      await new Promise(r => setTimeout(r, 300));
    }

    // Also add non-enriched teams (basic info only)
    const enrichedNames = new Set(results.map(r => r.team_name));
    for (const t of teams) {
      if (!enrichedNames.has(t.name)) {
        results.push({
          team_name: t.name,
          espn_id: t.id,
          conference: t.conference,
          kenpom_rank: null,
          adj_offense: null,
          adj_defense: null,
          adj_tempo: null,
          ppg: null,
          oppg: null,
          home_record: null,
          away_record: null,
          ats_record: null,
          over_under_record: null,
        });
      }
    }

    // Rank by efficiency differential
    const ranked = results
      .filter(t => t.adj_offense !== null && t.adj_defense !== null)
      .sort((a, b) => {
        const effA = (a.adj_offense || 0) - (a.adj_defense || 100);
        const effB = (b.adj_offense || 0) - (b.adj_defense || 100);
        return effB - effA;
      });

    ranked.forEach((team, idx) => { team.kenpom_rank = idx + 1; });

    console.log(`[NCAAB Stats] Enriched ${enriched}, ranked ${ranked.length}`);

    // Upsert in chunks
    let totalUpserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < results.length; i += 100) {
      const chunk = results.slice(i, i + 100).map(t => ({
        team_name: t.team_name,
        conference: t.conference,
        kenpom_rank: t.kenpom_rank,
        adj_offense: t.adj_offense,
        adj_defense: t.adj_defense,
        adj_tempo: t.adj_tempo,
        ppg: t.ppg,
        oppg: t.oppg,
        home_record: t.home_record,
        away_record: t.away_record,
        ats_record: t.ats_record,
        over_under_record: t.over_under_record,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('ncaab_team_stats')
        .upsert(chunk, { onConflict: 'team_name' });

      if (error) errors.push(error.message);
      else totalUpserted += chunk.length;
    }

    const duration = Date.now() - startTime;

    await supabase.from('cron_job_history').insert({
      job_name: 'ncaab-team-stats-fetcher',
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

    console.log(`[NCAAB Stats] Done in ${duration}ms: ${totalUpserted} upserted, ${enriched} enriched`);

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
    console.error('[NCAAB Stats] Fatal error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
