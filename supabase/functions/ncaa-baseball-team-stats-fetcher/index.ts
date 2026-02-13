/**
 * ncaa-baseball-team-stats-fetcher
 * 
 * Fetches NCAA baseball team stats from ESPN Standings + Scoreboard APIs
 * and populates ncaa_baseball_team_stats with efficiency metrics.
 * 
 * Strategy:
 * 1. Standings endpoint: bulk fetch all teams with season records (primary, once games accumulate)
 * 2. Scoreboard endpoint: fetch recent games for ERA, AVG, runs (supplements early season)
 * 3. Teams list endpoint: fallback for any teams not in standings/scoreboard
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ESPN_STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/baseball/college-baseball/standings';
const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard';
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

interface TeamAccumulator {
  totalRuns: number;
  totalRunsAllowed: number;
  gamesPlayed: number;
  era: number | null;
  bavg: number | null;
  homeRecord: string | null;
  awayRecord: string | null;
  conference: string | null;
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
      console.warn(`[Baseball Stats] ${url} returned ${resp.status}`);
      return null;
    } catch {
      if (i < retries) await new Promise(r => setTimeout(r, 500));
    }
  }
  return null;
}

// Fetch from standings (works well once conference play begins)
async function fetchStandings(teamMap: Map<string, TeamAccumulator>, idMap: Map<string, string>): Promise<void> {
  const resp = await fetchWithRetry(ESPN_STANDINGS_URL);
  if (!resp) {
    console.warn('[Baseball Stats] Standings endpoint failed');
    return;
  }

  const data = await resp.json();
  const conferences = data.children || [];
  console.log(`[Baseball Stats] Standings: ${conferences.length} conferences`);

  for (const conf of conferences) {
    const conferenceName = conf.name || conf.abbreviation || null;
    const entries = conf.standings?.entries || [];

    for (const entry of entries) {
      const team = entry.team || {};
      const teamName = team.displayName || team.name || '';
      const teamId = team.id || '';
      if (!teamName) continue;

      idMap.set(teamName, teamId);

      const stats = entry.stats || [];
      const sm: Record<string, any> = {};
      for (const s of stats) {
        sm[s.name] = s.value;
        if (s.displayValue) sm[`${s.name}_display`] = s.displayValue;
      }

      const wins = sm.wins || 0;
      const losses = sm.losses || 0;
      const gp = wins + losses;

      const existing = teamMap.get(teamName) || {
        totalRuns: 0, totalRunsAllowed: 0, gamesPlayed: 0,
        era: null, bavg: null, homeRecord: null, awayRecord: null, conference: null
      };

      existing.conference = conferenceName;
      existing.homeRecord = sm.Home_display || sm.home_display || existing.homeRecord;
      existing.awayRecord = sm.Road_display || sm.away_display || sm.road_display || existing.awayRecord;

      if (sm.avgPointsFor && sm.avgPointsFor > 0 && gp > 0) {
        existing.totalRuns = sm.avgPointsFor * gp;
        existing.totalRunsAllowed = (sm.avgPointsAgainst || 0) * gp;
        existing.gamesPlayed = gp;
      } else if (sm.pointsFor && gp > 0) {
        existing.totalRuns = sm.pointsFor;
        existing.totalRunsAllowed = sm.pointsAgainst || 0;
        existing.gamesPlayed = gp;
      }

      teamMap.set(teamName, existing);
    }
  }
}

// Fetch from scoreboard - gets ERA, AVG, and game scores from recent/today's games
async function fetchScoreboard(teamMap: Map<string, TeamAccumulator>, idMap: Map<string, string>): Promise<void> {
  // Fetch today and a few recent dates
  const dates = getRecentDates(5);
  let totalEvents = 0;

  for (const date of dates) {
    const url = `${ESPN_SCOREBOARD_URL}?dates=${date}&limit=200`;
    const resp = await fetchWithRetry(url);
    if (!resp) continue;

    const data = await resp.json();
    const events = data.events || [];
    totalEvents += events.length;

    for (const event of events) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const isComplete = competition.status?.type?.completed === true;
      const competitors = competition.competitors || [];

      for (const comp of competitors) {
        const team = comp.team || {};
        const teamName = team.displayName || '';
        if (!teamName) continue;

        idMap.set(teamName, team.id || '');

        const existing = teamMap.get(teamName) || {
          totalRuns: 0, totalRunsAllowed: 0, gamesPlayed: 0,
          era: null, bavg: null, homeRecord: null, awayRecord: null, conference: null
        };

        // Extract season-level stats from competitor statistics array
        const stats = comp.statistics || [];
        for (const s of stats) {
          if ((s.name === 'ERA' || s.abbreviation === 'ERA') && s.displayValue) {
            const v = parseFloat(s.displayValue);
            if (!isNaN(v)) existing.era = v;
          }
          if ((s.name === 'avg' || s.abbreviation === 'AVG') && s.displayValue) {
            const v = parseFloat(s.displayValue);
            if (!isNaN(v) && v <= 1) existing.bavg = v;
          }
        }

        // Extract records
        const records = comp.records || [];
        for (const rec of records) {
          if (rec.type === 'total' && rec.summary) {
            const parts = rec.summary.split('-').map(Number);
            if (parts.length >= 2 && parts[0] + parts[1] > 0) {
              // We have overall record
            }
          }
        }

        // Accumulate runs from completed games
        if (isComplete && comp.score !== undefined) {
          const runs = parseFloat(comp.score);
          if (!isNaN(runs)) {
            // Find opponent score
            const opponent = competitors.find((c: any) => c !== comp);
            const oppRuns = opponent ? parseFloat(opponent.score || '0') : 0;

            existing.totalRuns += runs;
            existing.totalRunsAllowed += oppRuns;
            existing.gamesPlayed += 1;
          }
        }

        // Extract curated rank
        if (comp.curatedRank?.current && comp.curatedRank.current <= 25) {
          // We'll use this later for national rank
        }

        teamMap.set(teamName, existing);
      }
    }

    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[Baseball Stats] Scoreboard: ${totalEvents} events across ${dates.length} dates`);
}

// Fetch fallback team list for teams not seen in standings/scoreboard
async function fetchFallbackTeams(teamMap: Map<string, TeamAccumulator>, idMap: Map<string, string>): Promise<void> {
  let added = 0;
  for (let page = 1; page <= 6; page++) {
    const resp = await fetchWithRetry(`${ESPN_TEAMS_URL}?limit=100&page=${page}`);
    if (!resp) break;
    const data = await resp.json();
    const entries = data.sports?.[0]?.leagues?.[0]?.teams || [];
    if (entries.length === 0) break;

    for (const entry of entries) {
      const t = entry.team || entry;
      const name = t.displayName;
      if (!name || teamMap.has(name)) continue;

      idMap.set(name, t.id || '');
      teamMap.set(name, {
        totalRuns: 0, totalRunsAllowed: 0, gamesPlayed: 0,
        era: null, bavg: null, homeRecord: null, awayRecord: null,
        conference: t.groups?.parent?.shortName || t.groups?.name || null
      });
      added++;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`[Baseball Stats] Fallback teams: ${added} added`);
}

function getRecentDates(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
  }
  return dates;
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

    console.log('[Baseball Stats] Starting multi-source fetch');

    const teamMap = new Map<string, TeamAccumulator>();
    const idMap = new Map<string, string>();

    // Fetch from all sources
    await fetchStandings(teamMap, idMap);
    await fetchScoreboard(teamMap, idMap);
    await fetchFallbackTeams(teamMap, idMap);

    if (teamMap.size === 0) {
      return new Response(JSON.stringify({ success: false, error: 'No teams found' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build results
    const results: TeamStats[] = [];
    let enrichedCount = 0;

    for (const [name, acc] of teamMap) {
      const rpg = acc.gamesPlayed > 0 ? Math.round((acc.totalRuns / acc.gamesPlayed) * 100) / 100 : null;
      const rapg = acc.gamesPlayed > 0 ? Math.round((acc.totalRunsAllowed / acc.gamesPlayed) * 100) / 100 : null;

      if (rpg !== null) enrichedCount++;

      results.push({
        team_name: name,
        espn_id: idMap.get(name) || '',
        conference: acc.conference,
        national_rank: null,
        runs_per_game: rpg,
        runs_allowed_per_game: rapg,
        era: acc.era,
        batting_avg: acc.bavg,
        home_record: acc.homeRecord,
        away_record: acc.awayRecord,
      });
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
        total_teams: results.length,
        teams_enriched: enrichedCount,
        teams_ranked: ranked.length,
        teams_upserted: totalUpserted,
        errors: errors.slice(0, 3),
      },
    });

    console.log(`[Baseball Stats] Done in ${duration}ms: ${totalUpserted} upserted, ${enrichedCount} enriched, ${ranked.length} ranked`);

    return new Response(JSON.stringify({
      success: true,
      duration_ms: duration,
      total_teams: results.length,
      teams_enriched: enrichedCount,
      teams_ranked: ranked.length,
      teams_upserted: totalUpserted,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Baseball Stats] Fatal error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
