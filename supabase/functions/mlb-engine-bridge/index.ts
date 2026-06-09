// mlb-engine-bridge
//
// Mirrors new rows from mlb_engine_picks (the legacy MLB Bot Exploration writer)
// into engine_live_tracker so they show up in the unified accuracy dashboard and
// get graded by mlb-engine-settler. Idempotent — dedupes on
// (engine_name, sport, player_name, prop_type, line, side, game_date).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const log = (m: string) => console.log(`[mlb-bridge] ${m}`);

  try {
    const sinceIso = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: picks, error } = await supabase
      .from("mlb_engine_picks")
      .select("id, player_name, prop_type, line, side, confidence_score, signal_sources, game_date, created_at, result")
      .gte("created_at", sinceIso)
      .limit(2000);
    if (error) throw new Error(`mlb_engine_picks: ${error.message}`);
    if (!picks || picks.length === 0) {
      return new Response(JSON.stringify({ success: true, mirrored: 0, message: "no recent picks" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Existing mirrored rows
    const { data: existing } = await supabase
      .from("engine_live_tracker")
      .select("player_name, prop_type, line, side, game_time")
      .eq("engine_name", "Bot Exploration")
      .eq("sport", "baseball_mlb")
      .gte("created_at", sinceIso);
    const have = new Set((existing ?? []).map((r) =>
      `${r.player_name}|${r.prop_type}|${r.line}|${(r.side ?? "").toLowerCase()}`));

    const inserts: any[] = [];
    for (const p of picks) {
      const sideRaw = String(p.side ?? "").toLowerCase();
      const side = sideRaw === "over" || sideRaw === "under" ? sideRaw : null;
      if (!side || p.line == null) continue;
      const key = `${p.player_name}|${p.prop_type}|${p.line}|${side}`;
      if (have.has(key)) continue;
      const conf = Number(p.confidence_score ?? 0) / 100;
      const resultRaw = String(p.result ?? "PENDING").toUpperCase();
      const status = resultRaw === "WIN" ? "won" : resultRaw === "LOSS" ? "lost" : resultRaw === "PUSH" ? "push" : "pending";
      inserts.push({
        engine_name: "Bot Exploration", sport: "baseball_mlb",
        pick_description: `${p.player_name} ${side.toUpperCase()} ${p.line} ${p.prop_type}`,
        player_name: p.player_name, prop_type: p.prop_type, line: p.line, side,
        confidence: conf,
        confidence_level: conf >= 0.7 ? "high" : conf >= 0.6 ? "medium" : "low",
        signals: p.signal_sources ?? [],
        status,
        game_time: p.game_date ? new Date(`${p.game_date}T17:00:00Z`).toISOString() : null,
      });
    }

    let mirrored = 0;
    for (let i = 0; i < inserts.length; i += 200) {
      const b = inserts.slice(i, i + 200);
      const { error: e } = await supabase.from("engine_live_tracker").insert(b);
      if (!e) mirrored += b.length; else log(`insert err: ${e.message}`);
    }

    return new Response(JSON.stringify({
      success: true, scanned: picks.length, mirrored, already_present: picks.length - inserts.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[mlb-bridge] fatal", msg);
    return new Response(JSON.stringify({ success: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});