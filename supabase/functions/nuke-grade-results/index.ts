// Nuke Parlay Scout — Phase 1: NBA grader
// For each pending parlay where the game is final, mark legs hit/miss based on
// nba_player_game_logs and live_game_scores, set parlay outcome, write nuke_results.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function easternDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function statForPropType(log: any, propType: string): number | null {
  const pts = Number(log.points || 0);
  const reb = Number(log.rebounds || 0);
  const ast = Number(log.assists || 0);
  const thr = Number(log.threes_made || 0);
  const blk = Number(log.blocks || 0);
  const stl = Number(log.steals || 0);
  switch (propType) {
    case "player_points": return pts;
    case "player_rebounds": return reb;
    case "player_assists": return ast;
    case "player_threes": return thr;
    case "player_blocks": return blk;
    case "player_steals": return stl;
    case "player_points_rebounds": return pts + reb;
    case "player_points_assists": return pts + ast;
    case "player_rebounds_assists": return reb + ast;
    case "player_points_rebounds_assists": return pts + reb + ast;
    default: return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const targetDate: string = body.game_date || easternDateDaysAgo(1);
  const errors: unknown[] = [];
  let graded = 0;

  // Pull parlays for the date that have no result yet
  let parlays: any[] = [];
  try {
    const { data, error } = await supabase
      .from("nuke_parlays")
      .select("id, game_id, game_date, template, legs")
      .eq("game_date", targetDate);
    if (error) throw error;
    parlays = data || [];
  } catch (e) {
    errors.push({ stage: "fetch_parlays", message: String(e) });
  }

  // Filter out already-graded
  let existing: Set<string> = new Set();
  try {
    const { data } = await supabase
      .from("nuke_results")
      .select("parlay_id")
      .in("parlay_id", parlays.map((p) => p.id));
    existing = new Set((data || []).map((r) => r.parlay_id));
  } catch (e) {
    errors.push({ stage: "fetch_existing_results", message: String(e) });
  }

  for (const par of parlays) {
    if (existing.has(par.id)) continue;

    // Pull final score
    let scoreRow: any = null;
    try {
      const { data, error } = await supabase
        .from("live_game_scores")
        .select("home_score, away_score, game_status, home_team, away_team")
        .eq("event_id", par.game_id)
        .maybeSingle();
      if (error) throw error;
      scoreRow = data;
    } catch (e) {
      errors.push({ stage: "fetch_score", parlay_id: par.id, message: String(e) });
      continue;
    }

    if (!scoreRow || (scoreRow.game_status && !/final/i.test(scoreRow.game_status))) {
      // Not final yet; leave for next cron pass
      continue;
    }

    const legs: any[] = par.legs || [];
    let legsHit = 0;
    const legResults: any[] = [];

    for (const leg of legs) {
      try {
        const { data: log } = await supabase
          .from("nba_player_game_logs")
          .select("points, rebounds, assists, threes_made, blocks, steals")
          .eq("player_name", leg.player)
          .eq("game_date", par.game_date)
          .maybeSingle();
        if (!log) {
          legResults.push({ ...leg, hit: null, actual: null, note: "no_log" });
          continue;
        }
        const actual = statForPropType(log, leg.prop_type);
        if (actual == null) {
          legResults.push({ ...leg, hit: null, actual: null, note: "unknown_prop_type" });
          continue;
        }
        const hit = leg.side === "over" ? actual > leg.line : actual < leg.line;
        legResults.push({ ...leg, hit, actual });
        if (hit) legsHit++;
      } catch (e) {
        errors.push({ stage: "grade_leg", parlay_id: par.id, message: String(e) });
      }
    }

    const outcome = legsHit === legs.length ? "won" : "lost";
    const margin = Math.abs(Number(scoreRow.home_score || 0) - Number(scoreRow.away_score || 0));
    const wasBlowout = margin >= 10;

    try {
      const { error } = await supabase.from("nuke_results").insert({
        parlay_id: par.id,
        outcome,
        legs_hit: legsHit,
        legs_total: legs.length,
        final_score_home: scoreRow.home_score,
        final_score_away: scoreRow.away_score,
        margin,
        was_blowout: wasBlowout,
        notes: JSON.stringify({ legs: legResults }),
        graded_at: new Date().toISOString(),
      });
      if (error) throw error;
      graded++;
    } catch (e) {
      errors.push({ stage: "insert_result", parlay_id: par.id, message: String(e) });
    }
  }

  try {
    await supabase.from("nuke_run_log").insert({
      game_date: targetDate,
      phase: "grade",
      parlays_graded: graded,
      errors,
    });
  } catch (e) {
    console.error("nuke-grade run_log error", e);
  }

  return new Response(JSON.stringify({
    ok: true,
    game_date: targetDate,
    parlays_seen: parlays.length,
    graded,
    errors,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});