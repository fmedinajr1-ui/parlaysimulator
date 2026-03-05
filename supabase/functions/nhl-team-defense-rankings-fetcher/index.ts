import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NHL_API = "https://api-web.nhle.com/v1";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { season = '20242025' } = await req.json().catch(() => ({}));

    console.log('[NHL Rankings] Fetching standings for PP/PK data...');

    // Fetch standings for PP%/PK% + basic stats
    const standingsRes = await fetch(`${NHL_API}/standings/now`);
    if (!standingsRes.ok) throw new Error(`Standings fetch failed: ${standingsRes.status}`);

    const standingsData = await standingsRes.json();
    const standings = standingsData.standings || [];

    const teams = standings.map((t: any) => {
      const gp = t.gamesPlayed || 1;
      return {
        team_abbrev: t.teamAbbrev?.default || t.teamAbbrev,
        team_name: t.teamName?.default || t.teamName,
        goals_for_per_game: Math.round(((t.goalFor || 0) / gp) * 100) / 100,
        goals_against_per_game: Math.round(((t.goalAgainst || 0) / gp) * 100) / 100,
        shots_for_per_game: 0, // will fill from pace stats
        shots_against_per_game: 0,
        power_play_pct: Math.round((t.powerPlayPct || 0) * 100) / 100,
        penalty_kill_pct: Math.round((t.penaltyKillPct || 0) * 100) / 100,
        season,
      };
    });

    // Enrich with shot data from nhl_team_pace_stats
    const { data: paceStats } = await supabase
      .from('nhl_team_pace_stats')
      .select('team_abbrev, shots_for_per_game, shots_against_per_game');

    const paceMap = new Map((paceStats || []).map((p: any) => [p.team_abbrev, p]));
    for (const team of teams) {
      const pace = paceMap.get(team.team_abbrev);
      if (pace) {
        team.shots_for_per_game = Math.round((pace.shots_for_per_game || 0) * 100) / 100;
        team.shots_against_per_game = Math.round((pace.shots_against_per_game || 0) * 100) / 100;
      }
    }

    // Compute ranks (1 = best)
    const rank = (arr: any[], key: string, ascending: boolean) => {
      const sorted = [...arr].sort((a, b) => ascending ? a[key] - b[key] : b[key] - a[key]);
      return new Map(sorted.map((t, i) => [t.team_abbrev, i + 1]));
    };

    const gfRank = rank(teams, 'goals_for_per_game', false);
    const gaRank = rank(teams, 'goals_against_per_game', true);
    const sfRank = rank(teams, 'shots_for_per_game', false);
    const saRank = rank(teams, 'shots_against_per_game', true);
    const ppRank = rank(teams, 'power_play_pct', false);
    const pkRank = rank(teams, 'penalty_kill_pct', false);

    const rankedTeams = teams.map((t: any) => ({
      ...t,
      goals_for_rank: gfRank.get(t.team_abbrev),
      goals_against_rank: gaRank.get(t.team_abbrev),
      shots_for_rank: sfRank.get(t.team_abbrev),
      shots_against_rank: saRank.get(t.team_abbrev),
      power_play_rank: ppRank.get(t.team_abbrev),
      penalty_kill_rank: pkRank.get(t.team_abbrev),
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('nhl_team_defense_rankings')
      .upsert(rankedTeams, { onConflict: 'team_abbrev', ignoreDuplicates: false });

    if (error) {
      console.error('[NHL Rankings] Upsert error:', error);
      throw error;
    }

    const duration = Date.now() - startTime;
    console.log(`[NHL Rankings] Done: ${rankedTeams.length} teams ranked in ${duration}ms`);

    await supabase.from('cron_job_history').insert({
      job_name: 'nhl-team-defense-rankings-fetcher',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { teamsRanked: rankedTeams.length },
    });

    return new Response(
      JSON.stringify({ success: true, teamsRanked: rankedTeams.length, duration, sample: rankedTeams.slice(0, 3) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[NHL Rankings] Fatal error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
