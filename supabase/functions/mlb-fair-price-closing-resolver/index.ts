// Attaches a "closing line" (last observed devig book implied probability)
// to each fired mlb_fair_price_events row so we can compute CLV.
// Runs on cron (every 30m, right after the outcome attacher).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { americanToImplied, deVig } from "../_shared/mlb-fair-price/edge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function devigForGame(rows: any[]): { devig: number | null; bookId: string | null; capturedAt: string | null } {
  if (!rows || rows.length === 0) return { devig: null, bookId: null, capturedAt: null };
  const top = rows[0];
  const opp = rows.find((r: any) => r.id !== top.id && r.sportsbook === top.sportsbook);
  const topOdds = Number(top.american_odds ?? top.odds ?? 0);
  const oppOdds = opp ? Number(opp.american_odds ?? opp.odds ?? 0) : topOdds;
  const impliedA = americanToImplied(topOdds);
  const impliedB = opp ? americanToImplied(oppOdds) : impliedA;
  const devig = deVig(impliedA, impliedB);
  return {
    devig: Number.isFinite(devig) ? devig : (Number.isFinite(impliedA) ? impliedA : null),
    bookId: top.sportsbook ?? null,
    capturedAt: top.captured_at ?? null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve only events whose game has finished (outcome already attached).
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data: events, error: evErr } = await supabase
    .from("mlb_fair_price_events")
    .select("id, game_id, side, book_implied_devig, outcome_attached_at, created_at")
    .not("outcome_attached_at", "is", null)
    .is("closing_attached_at", null)
    .gte("created_at", since)
    .limit(1000);

  if (evErr) {
    return new Response(JSON.stringify({ ok: false, error: evErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!events || events.length === 0) {
    return new Response(JSON.stringify({ ok: true, scanned: 0, resolved: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let resolved = 0;
  let unresolved = 0;
  const nowIso = new Date().toISOString();
  const gameCache = new Map<string, ReturnType<typeof devigForGame>>();

  for (const ev of events) {
    let entry = gameCache.get(ev.game_id);
    if (!entry) {
      const { data: snaps } = await supabase
        .from("market_snapshot")
        .select("*")
        .eq("game_id", String(ev.game_id))
        .eq("market_type", "live_ml")
        .order("captured_at", { ascending: false })
        .limit(8);
      entry = devigForGame(snaps ?? []);
      gameCache.set(ev.game_id, entry);
    }

    // No snapshot data → mark resolved with sentinel so we stop retrying.
    if (entry.devig == null) {
      await supabase
        .from("mlb_fair_price_events")
        .update({
          closing_attached_at: nowIso,
          closing_book_implied_devig: null,
          clv_pct: null,
          closing_resolution_status: "no_snapshot_data",
        })
        .eq("id", ev.id);
      unresolved += 1;
      continue;
    }

    // Devig in market_snapshot is treated as HOME-side implied (consistent with scout-live-edge fire).
    const homeDevig = entry.devig;
    const sideDevig = (ev.side === "AWAY") ? (1 - homeDevig) : homeDevig;
    const fireDevig = ev.book_implied_devig ?? null;
    const sideFireDevig = (ev.side === "AWAY" && fireDevig != null) ? (1 - fireDevig) : fireDevig;

    const clvPct = (sideFireDevig != null && sideFireDevig > 0)
      ? (sideDevig - sideFireDevig) / sideFireDevig
      : null;

    await supabase
      .from("mlb_fair_price_events")
      .update({
        closing_attached_at: nowIso,
        closing_book_implied_devig: sideDevig,
        clv_pct: clvPct,
        closing_resolution_status: "resolved",
      })
      .eq("id", ev.id);
    resolved += 1;
  }

  return new Response(JSON.stringify({
    ok: true, scanned: events.length, resolved, unresolved,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});