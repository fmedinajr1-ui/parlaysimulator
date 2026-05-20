// model-elo-rebuild
// Recompute rolling Elo for NBA / MLB / NHL from nuke_historical_games (settled=true).
// Overwrites model_team_elo every run. Idempotent.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { eloUpdate, SPORTS, type ModelSport } from "../_shared/model-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HOME_ADV: Record<ModelSport, number> = { nba: 65, mlb: 25, nhl: 35 };
const K_FACTOR: Record<ModelSport, number> = { nba: 20, mlb: 4, nhl: 8 };

async function rebuildSport(supabase: any, sport: ModelSport): Promise<{ teams: number; games: number }> {
  const { data, error } = await supabase
    .from("nuke_historical_games")
    .select("home, away, actual_home_score, actual_away_score, game_date")
    .eq("sport", sport)
    .eq("settled", true)
    .not("actual_home_score", "is", null)
    .not("actual_away_score", "is", null)
    .order("game_date", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`elo fetch ${sport}: ${error.message}`);

  const ratings = new Map<string, { rating: number; games: number }>();
  const get = (team: string) => {
    if (!ratings.has(team)) ratings.set(team, { rating: 1500, games: 0 });
    return ratings.get(team)!;
  };

  for (const g of data ?? []) {
    if (!g.home || !g.away) continue;
    const h = get(g.home);
    const a = get(g.away);
    const next = eloUpdate(h.rating, a.rating, g.actual_home_score, g.actual_away_score, K_FACTOR[sport], HOME_ADV[sport]);
    h.rating = next.home; h.games += 1;
    a.rating = next.away; a.games += 1;
  }

  const rows = [...ratings.entries()].map(([team, v]) => ({
    sport, team, rating: Math.round(v.rating * 100) / 100,
    games_played: v.games, last_updated_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error: upErr } = await supabase
      .from("model_team_elo")
      .upsert(rows, { onConflict: "sport,team" });
    if (upErr) throw new Error(`elo upsert ${sport}: ${upErr.message}`);
  }

  return { teams: rows.length, games: (data ?? []).length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const out: Record<string, { teams: number; games: number }> = {};
    for (const s of SPORTS) {
      try {
        out[s] = await rebuildSport(supabase, s);
      } catch (e) {
        console.error(`[model-elo-rebuild] ${s}`, e);
        out[s] = { teams: 0, games: 0 };
      }
    }
    return new Response(JSON.stringify({ success: true, sports: out }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[model-elo-rebuild] fatal", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});