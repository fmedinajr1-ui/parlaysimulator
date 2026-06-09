// unified-props-side-picker
// Fixes the upstream bug where Unified Props rows ship with side='neutral' / no recommendation.
// Uses true_line vs current_line edge, sharp_money_score, hit_rate_score, and composite_score
// to pick over/under. Then propagates the recommended_side + line to matching neutral rows in
// engine_live_tracker so they become gradable by the per-sport settlers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function pickSide(r: any): { side: "over" | "under" | null; reason: string; confidence: number } {
  const tl = num(r.true_line);
  const cl = num(r.current_line);
  const sharp = num(r.sharp_money_score);
  const hit = num(r.hit_rate_score);
  const comp = num(r.composite_score);

  // Primary signal: true_line vs current_line
  if (tl != null && cl != null && Math.abs(tl - cl) >= 0.25) {
    return {
      side: tl > cl ? "over" : "under",
      reason: "true_line_diff",
      confidence: Math.min(0.95, 0.5 + Math.min(0.4, Math.abs(tl - cl) / 4)),
    };
  }
  // Secondary: sharp money score is signed in many engines (>0 over, <0 under)
  if (sharp != null && Math.abs(sharp) >= 0.05) {
    return { side: sharp > 0 ? "over" : "under", reason: "sharp_money", confidence: Math.min(0.85, 0.5 + Math.abs(sharp)) };
  }
  // Tertiary: hit rate score (treated as P(over) when 0..1)
  if (hit != null && (hit > 0.55 || hit < 0.45)) {
    return { side: hit > 0.5 ? "over" : "under", reason: "hit_rate", confidence: Math.abs(hit - 0.5) * 2 };
  }
  // Fallback: composite_score sign
  if (comp != null && Math.abs(comp) >= 0.05) {
    return { side: comp > 0 ? "over" : "under", reason: "composite", confidence: Math.min(0.8, 0.5 + Math.abs(comp) / 2) };
  }
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

    // Step 1: fix unified_props rows
    let q = supabase.from("unified_props")
      .select("id, sport, player_name, prop_type, current_line, true_line, sharp_money_score, hit_rate_score, composite_score, recommended_side")
      .is("recommended_side", null)
      .eq("is_active", true)
      .not("current_line", "is", null);
    if (sportFilter) q = q.ilike("sport", sportFilter);
    const { data: rows, error } = await q.limit(5000);
    if (error) throw new Error(`unified_props: ${error.message}`);

    const upUnified: any[] = [];
    const propagation: any[] = [];
    let skipped = 0;
    for (const r of rows ?? []) {
      const pick = pickSide(r);
      if (!pick.side) { skipped++; continue; }
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
      skipped_no_signal: skipped,
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