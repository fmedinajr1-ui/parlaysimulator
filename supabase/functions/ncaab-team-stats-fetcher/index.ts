/**
 * ncaab-team-stats-fetcher
 * 
 * Fetches NCAAB team efficiency data from ESPN team stats APIs
 * and populates the ncaab_team_stats table with KenPom-style metrics.
 * 
 * Runs daily on cron alongside existing data pipeline.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_TEAMS_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams';
const ESPN_STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings';
const ESPN_STATS_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams';

interface TeamStats {
  team_name: string;
  conference: string | null;
  kenpom_rank: number | null;
  adj_offense: number | null;
  adj_defense: number | null;
  adj_tempo: number | null;
  home_record: string | null;
  away_record: string | null;
  ats_record: string | null;
  over_under_record: string | null;
}

// Top 25 conferences by team count (cover ~95% of D1)
const MAJOR_CONFERENCES = [
  '1', '2', '3', '4', '5', '7', '8', '9', '10', '12',  // Power + major conferences
  '11', '13', '14', '15', '16', '17', '18', '19', '20', '21',
  '22', '23', '24', '25', '26', '27', '28', '29', '30', '44', '46', '62'
];

async function fetchTeamStatsFromESPN(): Promise<TeamStats[]> {
  const allTeams: TeamStats[] = [];
  const seenTeams = new Set<string>();

  // Fetch teams across pages
  for (let page = 1; page <= 4; page++) {
    try {
      const url = `${ESPN_TEAMS_URL}?limit=100&page=${page}`;
      console.log(`[NCAAB Stats] Fetching page ${page}: ${url}`);
      const resp = await fetch(url);
      if (!resp.ok) break;
      const data = await resp.json();
      
      const teams = data.sports?.[0]?.leagues?.[0]?.teams || [];
      if (teams.length === 0) break;
      
      for (const entry of teams) {
        const team = entry.team || entry;
        if (!team.displayName || seenTeams.has(team.displayName)) continue;
        seenTeams.add(team.displayName);

        const conference = team.groups?.parent?.shortName || team.groups?.name || null;
        allTeams.push({
          team_name: team.displayName,
          conference,
          kenpom_rank: null,
          adj_offense: null,
          adj_defense: null,
          adj_tempo: null,
          home_record: null,
          away_record: null,
          ats_record: null,
          over_under_record: null,
        });
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`[NCAAB Stats] Error fetching page ${page}:`, e);
      break;
    }
  }

  console.log(`[NCAAB Stats] Found ${allTeams.length} teams, enriching with stats...`);

  // Enrich each team with stats from individual team endpoint
  // Process in batches to avoid rate limits
  let enriched = 0;
  for (const team of allTeams) {
    try {
      // Search for team ID from the teams list
      const searchUrl = `${ESPN_TEAMS_URL}?search=${encodeURIComponent(team.team_name)}&limit=1`;
      const searchResp = await fetch(searchUrl);
      if (!searchResp.ok) continue;
      const searchData = await searchResp.json();
      
      const foundTeam = searchData.sports?.[0]?.leagues?.[0]?.teams?.[0]?.team;
      if (!foundTeam?.id) continue;
      
      // Fetch team stats
      const statsUrl = `${ESPN_STATS_URL}/${foundTeam.id}/statistics`;
      const statsResp = await fetch(statsUrl);
      if (!statsResp.ok) continue;
      const statsData = await statsResp.json();
      
      // Extract scoring stats
      const splits = statsData.resultSets || statsData.splits || {};
      const categories = splits.categories || statsData.statistics?.splits?.categories || [];
      
      let ppg = 0, oppg = 0;
      for (const cat of categories) {
        const stats = cat.stats || [];
        for (const stat of stats) {
          if (stat.name === 'avgPoints' || stat.abbreviation === 'PTS') ppg = parseFloat(stat.value) || ppg;
          if (stat.name === 'avgPointsAgainst' || stat.abbreviation === 'OPP') oppg = parseFloat(stat.value) || oppg;
        }
      }
      
      // Fallback: try record stats
      if (ppg === 0 && foundTeam.record?.items) {
        for (const item of foundTeam.record.items) {
          for (const stat of (item.stats || [])) {
            if (stat.name === 'pointsFor' || stat.name === 'avgPointsFor') ppg = parseFloat(stat.value) || ppg;
            if (stat.name === 'pointsAgainst' || stat.name === 'avgPointsAgainst') oppg = parseFloat(stat.value) || oppg;
          }
          // Extract home/away records
          for (const stat of (item.stats || [])) {
            if (stat.name === 'homeRecord') team.home_record = stat.summary || stat.displayValue || null;
            if (stat.name === 'awayRecord') team.away_record = stat.summary || stat.displayValue || null;
          }
        }
      }

      if (ppg > 0) {
        team.adj_offense = ppg;
        team.adj_defense = oppg > 0 ? oppg : null;
        // Estimate tempo from combined scoring
        if (oppg > 0) {
          const totalPPG = ppg + oppg;
          const avgTotal = 135;
          const avgTempo = 67;
          const tempoDelta = ((totalPPG - avgTotal) / 10) * 3;
          team.adj_tempo = Math.round((avgTempo + tempoDelta) * 10) / 10;
        }
        enriched++;
      }
      
      // Rate limit
      if (enriched % 10 === 0) await new Promise(r => setTimeout(r, 500));
      else await new Promise(r => setTimeout(r, 150));
      
      // Cap at 150 to stay within edge function time limits
      if (enriched >= 150) break;
    } catch {
      // Non-critical, continue
    }
  }

  console.log(`[NCAAB Stats] Enriched ${enriched}/${allTeams.length} teams with scoring stats`);

  // Rank teams by efficiency differential
  const rankedTeams = allTeams
    .filter(t => t.adj_offense !== null && t.adj_defense !== null)
    .sort((a, b) => {
      const effA = (a.adj_offense || 0) - (a.adj_defense || 100);
      const effB = (b.adj_offense || 0) - (b.adj_defense || 100);
      return effB - effA;
    });

  rankedTeams.forEach((team, index) => {
    team.kenpom_rank = index + 1;
  });

  console.log(`[NCAAB Stats] Processed ${allTeams.length} teams, ${rankedTeams.length} ranked`);
  return allTeams;
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

    console.log('[NCAAB Stats] Starting team stats fetch');

    const teamStats = await fetchTeamStatsFromESPN();
    
    if (teamStats.length === 0) {
      console.log('[NCAAB Stats] No teams fetched - check ESPN API availability');
      return new Response(JSON.stringify({ success: false, error: 'No teams fetched' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert into ncaab_team_stats
    const upsertData = teamStats.map(t => ({
      team_name: t.team_name,
      conference: t.conference,
      kenpom_rank: t.kenpom_rank,
      adj_offense: t.adj_offense,
      adj_defense: t.adj_defense,
      adj_tempo: t.adj_tempo,
      home_record: t.home_record,
      away_record: t.away_record,
      ats_record: t.ats_record,
      over_under_record: t.over_under_record,
      updated_at: new Date().toISOString(),
    }));

    // Batch upsert in chunks of 100
    let totalUpserted = 0;
    const errors: string[] = [];
    
    for (let i = 0; i < upsertData.length; i += 100) {
      const chunk = upsertData.slice(i, i + 100);
      const { error } = await supabase
        .from('ncaab_team_stats')
        .upsert(chunk, { onConflict: 'team_name' });
      
      if (error) {
        errors.push(`Chunk ${i}: ${error.message}`);
      } else {
        totalUpserted += chunk.length;
      }
    }

    const duration = Date.now() - startTime;

    // Log to cron_job_history
    await supabase.from('cron_job_history').insert({
      job_name: 'ncaab-team-stats-fetcher',
      status: errors.length > 0 ? 'completed_with_errors' : 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: {
        teams_fetched: teamStats.length,
        teams_upserted: totalUpserted,
        teams_with_offense: teamStats.filter(t => t.adj_offense !== null).length,
        teams_with_tempo: teamStats.filter(t => t.adj_tempo !== null).length,
        teams_ranked: teamStats.filter(t => t.kenpom_rank !== null).length,
        errors: errors.slice(0, 5),
      },
    });

    console.log(`[NCAAB Stats] Done in ${duration}ms: ${totalUpserted} teams upserted`);

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      teams_fetched: teamStats.length,
      teams_upserted: totalUpserted,
      errors: errors.slice(0, 5),
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
