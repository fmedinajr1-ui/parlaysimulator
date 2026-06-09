// soccer-engine-settler (Phase 1 scaffold)
// Settles pending soccer picks in engine_live_tracker against
// soccer_match_results (team markets) and soccer_player_match_stats (player props).
// Returns { success, scanned, settled, breakdown, missing_data } so the orchestrator
// can show real coverage instead of silently skipping soccer.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLAYER_PROP_TO_FIELD: Record<string, string> = {
  player_goals: "goals",
  player_assists: "assists",
  player_shots: "shots",
  player_shots_on_target: "shots_on_target",
  player_passes: "passes",
  player_tackles: "tackles",
  player_fouls: "fouls",
  player_yellow_cards: "cards_yellow",
  player_red_cards: "cards_red",
};

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function gradeOverUnder(actual: number, line: number, side: string): "win" | "loss" | "push" {
  if (actual === line) return "push";
  const isOver = actual > line;
  return (isOver === (side.toLowerCase() === "over")) ? "win" : "loss";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = Date.now();
  try {
    const { data: pending, error: pendErr } = await supabase
      .from("engine_live_tracker")
      .select("id, engine_name, sport, player_name, team_name, prop_type, line, side, signals, created_at")
      .ilike("sport", "%soccer%")
      .eq("status", "pending")
      .not("side", "eq", "neutral")
      .not("line", "is", null);
    if (pendErr) throw new Error(`pending: ${pendErr.message}`);

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({
        success: true, scanned: 0, settled: 0, message: "no pending soccer picks",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: matches } = await supabase
      .from("soccer_match_results")
      .select("external_id, league, match_date, home_team, away_team, home_score, away_score, status, settled");
    const { data: stats } = await supabase
      .from("soccer_player_match_stats")
      .select("player_name, match_date, goals, assists, shots, shots_on_target, passes, tackles, fouls, cards_yellow, cards_red, minutes");

    const statsByPlayer = new Map<string, any[]>();
    for (const s of stats ?? []) {
      const k = String(s.player_name ?? "").toLowerCase().trim();
      if (!k) continue;
      if (!statsByPlayer.has(k)) statsByPlayer.set(k, []);
      statsByPlayer.get(k)!.push(s);
    }

    const updates: Array<{ id: string; result: string; actual: number; pick: any }> = [];
    let unmatched = 0, unsupported = 0;

    for (const p of pending) {
      const field = PLAYER_PROP_TO_FIELD[p.prop_type as string];
      if (field && p.player_name) {
        const arr = statsByPlayer.get(String(p.player_name).toLowerCase().trim()) ?? [];
        const row = arr[0];
        if (!row) { unmatched++; continue; }
        const actual = num((row as any)[field]);
        if (actual == null) { unsupported++; continue; }
        updates.push({ id: p.id as string, result: gradeOverUnder(actual, Number(p.line), String(p.side)), actual, pick: p });
      } else {
        // team markets — not implemented yet, surface as unsupported for visibility
        unsupported++;
      }
    }

    let settled = 0;
    if (updates.length) {
      await Promise.all(updates.map((u) =>
        supabase.from("engine_live_tracker")
          .update({ status: u.result, settled_at: new Date().toISOString(),
            signals: { ...(u.pick.signals ?? {}), settlement: { actual: u.actual, source: "soccer-engine-settler" } } })
          .eq("id", u.id)
      ));
      settled = updates.length;
    }

    return new Response(JSON.stringify({
      success: true,
      duration_ms: Date.now() - startedAt,
      scanned: pending.length,
      settled,
      unmatched,
      unsupported,
      stats_rows: stats?.length ?? 0,
      match_rows: matches?.length ?? 0,
      breakdown: {
        wins: updates.filter((u) => u.result === "win").length,
        losses: updates.filter((u) => u.result === "loss").length,
        pushes: updates.filter((u) => u.result === "push").length,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[soccer-engine-settler] fatal", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});