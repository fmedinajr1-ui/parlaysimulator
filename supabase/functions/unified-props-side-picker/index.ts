// unified-props-side-picker (v2 — price-edge + sport tuning, no poison-fallback)
//
// What changed vs v1:
//   • v1 cascaded to "under" when every score was 0/null. Since unified_props ships with
//     scores = 0 today, v1 mass-poisoned the pool. v2 NEVER picks a side unless a real
//     signal fires; otherwise it leaves the row neutral.
//   • v2 derives the side from VIG-FREE implied probability of over_price/under_price
//     (the only signal that is actually populated upstream right now). This mirrors the
//     NBA Sharp Money reasoning: take the side the market is paying up for, because
//     that's the side sharp money has already moved into.
//   • v2 only acts on player-prop rows (prop_type NOT in h2h/spreads/totals). Game-line
//     rows belong to game_bets engines, not the props settler.
//   • v2 applies per-sport thresholds so we don't generate paper plays in low-edge
//     sports (golf futures, soccer outrights).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Per-sport minimum vig-free edge over 50% required to publish a side.
// Tuned to mirror NBA Sharp Money's ~54.7% cohort: require >=3pp implied edge in
// mature markets, >=5pp in thin/volatile ones, skip futures-style markets entirely.
const SPORT_EDGE_FLOOR: Record<string, number> = {
  baseball_mlb: 0.03,
  basketball_wnba: 0.04,
  basketball_nba: 0.03,
  icehockey_nhl: 0.04,
  americanfootball_nfl: 0.03,
  americanfootball_ncaaf: 0.04,
  mma_mixed_martial_arts: 0.05,
  tennis_atp: 0.04,
  tennis_wta: 0.04,
  soccer_epl: 0.04,
  soccer_mls: 0.05,
};
const DEFAULT_EDGE_FLOOR = 0.05;
const SKIP_PROP_TYPES = new Set(["h2h", "spreads", "totals", "outright", "winner"]);
const SKIP_SPORT_PREFIXES = ["golf", "soccer_fifa_world_cup"];

function americanToProb(odds: number | null): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function pickSide(r: any): { side: "over" | "under" | null; reason: string; confidence: number } {
  // Primary: vig-free price edge from over_price / under_price.
  const pOver = americanToProb(num(r.over_price));
  const pUnder = americanToProb(num(r.under_price));
  if (pOver != null && pUnder != null && (pOver + pUnder) > 0) {
    const vigFreeOver = pOver / (pOver + pUnder);
    const edge = vigFreeOver - 0.5;
    const floor = SPORT_EDGE_FLOOR[String(r.sport).toLowerCase()] ?? DEFAULT_EDGE_FLOOR;
    if (Math.abs(edge) >= floor) {
      return {
        side: edge > 0 ? "over" : "under",
        reason: `price_edge_${(Math.abs(edge) * 100).toFixed(1)}pp`,
        confidence: Math.min(0.9, 0.5 + Math.abs(edge) * 2),
      };
    }
  }

  // Secondary signals (only fire if upstream actually populates them — guard against 0).
  const tl = num(r.true_line);
  const cl = num(r.current_line);
  const sharp = num(r.sharp_money_score);
  const hit = num(r.hit_rate_score);

  if (tl != null && cl != null && tl !== 0 && Math.abs(tl - cl) >= 0.25) {
    return {
      side: tl > cl ? "over" : "under",
      reason: "true_line_diff",
      confidence: Math.min(0.95, 0.5 + Math.min(0.4, Math.abs(tl - cl) / 4)),
    };
  }
  if (sharp != null && sharp !== 0 && Math.abs(sharp) >= 0.05) {
    return { side: sharp > 0 ? "over" : "under", reason: "sharp_money", confidence: Math.min(0.85, 0.5 + Math.abs(sharp)) };
  }
  if (hit != null && hit !== 0 && (hit > 0.55 || hit < 0.45)) {
    return { side: hit > 0.5 ? "over" : "under", reason: "hit_rate", confidence: Math.abs(hit - 0.5) * 2 };
  }
  // NO under-fallback. If nothing fires, the row stays neutral. Better to ship 0 picks
  // than to ship a fake one that pollutes the accuracy pool.
  return { side: null, reason: "no_signal", confidence: 0 };
}

function num(v: any): number | null {
  const n = Number(v); return v == null || !Number.isFinite(n) ? null : n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = Boolean(body?.dry_run ?? false);
    const sportFilter: string | null = body?.sport ?? null;
    const includeGameLines: boolean = Boolean(body?.include_game_lines ?? false);

    // Step 1: fix unified_props rows
    let q = supabase.from("unified_props")
      .select("id, sport, player_name, prop_type, current_line, over_price, under_price, true_line, sharp_money_score, hit_rate_score, composite_score, recommended_side")
      .is("recommended_side", null)
      .eq("is_active", true)
      .not("current_line", "is", null);
    if (sportFilter) q = q.ilike("sport", sportFilter);
    const { data: rows, error } = await q.limit(5000);
    if (error) throw new Error(`unified_props: ${error.message}`);

    const upUnified: any[] = [];
    const propagation: any[] = [];
    let skippedNoSignal = 0;
    let skippedGameLine = 0;
    let skippedFutures = 0;
    const reasonCounts: Record<string, number> = {};
    for (const r of rows ?? []) {
      const sport = String(r.sport ?? "").toLowerCase();
      const propType = String(r.prop_type ?? "").toLowerCase();
      if (!includeGameLines && SKIP_PROP_TYPES.has(propType)) { skippedGameLine++; continue; }
      if (SKIP_SPORT_PREFIXES.some((p) => sport.startsWith(p))) { skippedFutures++; continue; }
      const pick = pickSide(r);
      if (!pick.side) { skippedNoSignal++; continue; }
      reasonCounts[pick.reason.replace(/_\d.*$/, "")] = (reasonCounts[pick.reason.replace(/_\d.*$/, "")] ?? 0) + 1;
      upUnified.push({ id: r.id, recommended_side: pick.side, confidence: pick.confidence });
      propagation.push({ sport: r.sport, player_name: r.player_name, prop_type: r.prop_type, line: r.current_line, side: pick.side });
    }

    let updated = 0;
    if (!dryRun && upUnified.length) {
      await Promise.all(upUnified.map((u) =>
        supabase.from("unified_props")
          .update({ recommended_side: u.recommended_side, confidence: u.confidence, updated_at: new Date().toISOString() })
          .eq("id", u.id)
      ));
      updated = upUnified.length;
    }

    // Step 2: propagate to engine_live_tracker neutral rows
    let propagated = 0;
    if (!dryRun) {
      // batch-by-match — match by sport + player_name + prop_type + line
      for (const p of propagation) {
        const { error: upErr } = await supabase
          .from("engine_live_tracker")
          .update({ side: p.side, updated_at: new Date().toISOString() })
          .eq("engine_name", "Unified Props")
          .eq("sport", p.sport)
          .eq("player_name", p.player_name)
          .eq("prop_type", p.prop_type)
          .eq("side", "neutral")
          .eq("status", "pending");
        if (!upErr) propagated++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      scanned: rows?.length ?? 0,
      unified_updated: updated,
      tracker_batches_propagated: propagated,
      skipped_no_signal: skippedNoSignal,
      skipped_game_line: skippedGameLine,
      skipped_futures: skippedFutures,
      reason_counts: reasonCounts,
      dry_run: dryRun,
      sample: upUnified.slice(0, 5),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[unified-props-side-picker] fatal", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});