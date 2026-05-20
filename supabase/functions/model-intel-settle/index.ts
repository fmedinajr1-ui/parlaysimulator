// model-intel-settle
// Settle yesterday's model_predictions into model_intel_results for isolated ROI.
// H2H / totals settled against nuke_historical_games (settled rows w/ actual scores).
// Player-prop predictions settled against prop_results_archive matches.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { etDateKey } from "../_shared/date-et.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function yesterdayET(): string {
  const today = etDateKey();
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return etDateKey(d);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const target = typeof body?.date_et === "string" ? body.date_et : yesterdayET();

    const { data: preds, error } = await supabase
      .from("model_predictions")
      .select("*")
      .eq("game_date_et", target);
    if (error) throw new Error(`predictions: ${error.message}`);

    if (!preds || preds.length === 0) {
      return new Response(JSON.stringify({ success: true, date_et: target, settled: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // pull supporting result data once
    const eventIds = [...new Set(preds.map((p: any) => p.event_id).filter(Boolean))];
    const { data: games } = await supabase
      .from("nuke_historical_games")
      .select("external_id, sport, actual_home_score, actual_away_score, total, settled")
      .in("external_id", eventIds);
    const gameMap = new Map<string, any>();
    for (const g of games ?? []) gameMap.set(String(g.external_id), g);

    const { data: archive } = await supabase
      .from("prop_results_archive")
      .select("player_name, prop_type, sport, line, side, outcome, game_date")
      .eq("game_date", target);
    const archiveKey = (p: any) =>
      `${p.sport}::${(p.player_name ?? "").toLowerCase()}::${p.prop_type}::${p.side}::${p.line}`;
    const archiveMap = new Map<string, any>();
    for (const r of archive ?? []) archiveMap.set(archiveKey(r), r);

    const settlementRows: any[] = [];
    for (const p of preds) {
      let result: "win" | "loss" | "push" | "void" = "void";
      if (p.market_type === "h2h") {
        const g = gameMap.get(String(p.event_id));
        if (g?.settled && g.actual_home_score != null && g.actual_away_score != null) {
          const homeWon = g.actual_home_score > g.actual_away_score;
          const tie = g.actual_home_score === g.actual_away_score;
          if (tie) result = "push";
          else if ((p.side === "home" && homeWon) || (p.side === "away" && !homeWon)) result = "win";
          else result = "loss";
        } else { continue; }
      } else if (p.market_type === "total") {
        const g = gameMap.get(String(p.event_id));
        if (g?.settled && g.actual_home_score != null && g.actual_away_score != null) {
          const total = g.actual_home_score + g.actual_away_score;
          const line = Number(p.current_line);
          if (total === line) result = "push";
          else if ((p.side === "over" && total > line) || (p.side === "under" && total < line)) result = "win";
          else result = "loss";
        } else { continue; }
      } else if (p.market_type === "player_prop") {
        const k = `${p.sport}::${(p.player_name ?? "").toLowerCase()}::${p.prop_type}::${p.side}::${p.current_line}`;
        const a = archiveMap.get(k);
        if (!a) continue;
        const o = String(a.outcome ?? "").toLowerCase();
        if (o === "win" || o === "hit") result = "win";
        else if (o === "loss" || o === "miss") result = "loss";
        else if (o === "push") result = "push";
        else continue;
      } else { continue; }

      settlementRows.push({
        prediction_id: p.id, sport: p.sport, game_date_et: target,
        model: p.model, market_type: p.market_type, side: p.side,
        current_line: p.current_line, prob: p.prob, edge_pct: p.edge_pct,
        result,
      });
    }

    if (settlementRows.length) {
      await supabase.from("model_intel_results").insert(settlementRows);
    }

    return new Response(JSON.stringify({
      success: true, date_et: target,
      total_predictions: preds.length,
      settled: settlementRows.length,
      wins: settlementRows.filter((r) => r.result === "win").length,
      losses: settlementRows.filter((r) => r.result === "loss").length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[model-intel-settle] fatal", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});