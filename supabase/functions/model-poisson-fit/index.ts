// model-poisson-fit
// Fit attack/defense scoring rates per team for MLB (runs) and NHL (goals) from
// settled nuke_historical_games. NBA totals are too high-variance for naive Poisson, skip.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HOME_ADV: Record<string, number> = { mlb: 0.20, nhl: 0.25 };

async function fitSport(supabase: any, sport: "mlb" | "nhl"): Promise<{ teams: number; games: number }> {
  const { data, error } = await supabase
    .from("nuke_historical_games")
    .select("home, away, actual_home_score, actual_away_score")
    .eq("sport", sport).eq("settled", true)
    .not("actual_home_score", "is", null).not("actual_away_score", "is", null)
    .limit(5000);
  if (error) throw new Error(`poisson fetch ${sport}: ${error.message}`);

  const games = data ?? [];
  if (games.length === 0) return { teams: 0, games: 0 };

  // league averages
  let totalScored = 0, totalGames = 0;
  for (const g of games) {
    totalScored += (g.actual_home_score ?? 0) + (g.actual_away_score ?? 0);
    totalGames += 1;
  }
  const leagueAvgPerTeam = totalScored / (2 * totalGames || 1);

  type Agg = { scored: number; conceded: number; games: number };
  const stats = new Map<string, Agg>();
  const bump = (t: string, scored: number, conceded: number) => {
    const cur = stats.get(t) ?? { scored: 0, conceded: 0, games: 0 };
    cur.scored += scored; cur.conceded += conceded; cur.games += 1;
    stats.set(t, cur);
  };
  for (const g of games) {
    if (!g.home || !g.away) continue;
    bump(g.home, g.actual_home_score, g.actual_away_score);
    bump(g.away, g.actual_away_score, g.actual_home_score);
  }

  const rows = [...stats.entries()].map(([team, s]) => {
    const avgScored = s.scored / Math.max(1, s.games);
    const avgConceded = s.conceded / Math.max(1, s.games);
    return {
      sport, team,
      attack: Math.round((avgScored / leagueAvgPerTeam) * 1000) / 1000,
      defense: Math.round((avgConceded / leagueAvgPerTeam) * 1000) / 1000,
      home_adv: HOME_ADV[sport],
      games_used: s.games,
      updated_at: new Date().toISOString(),
    };
  });

  if (rows.length > 0) {
    const { error: upErr } = await supabase
      .from("model_totals_params")
      .upsert(rows, { onConflict: "sport,team" });
    if (upErr) throw new Error(`poisson upsert ${sport}: ${upErr.message}`);
  }
  return { teams: rows.length, games: games.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const out: Record<string, { teams: number; games: number }> = {};
    for (const s of ["mlb", "nhl"] as const) {
      try { out[s] = await fitSport(supabase, s); }
      catch (e) { console.error(`[model-poisson-fit] ${s}`, e); out[s] = { teams: 0, games: 0 }; }
    }
    return new Response(JSON.stringify({ success: true, sports: out }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});