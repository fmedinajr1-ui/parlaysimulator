// @ts-nocheck
// Build parlays from a scan session pool
// Input: { session_id, target_legs?: 2..6, mode?: 'auto'|'manual', selected_prop_ids?: string[] }
// Output: { ok, parlays: [{ legs, american_odds, decimal_odds, composite, reasoning }] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function americanToDecimal(odds: number | null | undefined): number {
  if (odds == null) return 1.91;
  if (odds > 0) return odds / 100 + 1;
  return 100 / Math.abs(odds) + 1;
}

function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

const SAME_GAME_CAP = 0.75;

function gameId(tags: string[] | null): string | null {
  if (!tags) return null;
  const t = tags.find((x) => x.startsWith("game:"));
  return t ? t.slice(5) : null;
}

function buildLegReasoning(l: any): string {
  const bits: string[] = [];
  if (l.edge_pct != null) bits.push(`+${Number(l.edge_pct).toFixed(0)}% edge`);
  if (l.l10_hit_rate != null) bits.push(`L10 ${(l.l10_hit_rate * 100).toFixed(0)}%`);
  if (l.l10_avg != null) bits.push(`avg ${l.l10_avg.toFixed(1)}`);
  if (l.sweet_spot_id) bits.push("sweet spot");
  if (l.dna_score != null) bits.push(`DNA ${l.dna_score}`);
  return bits.join(" · ");
}

function buildParlay(props: any[], targetLegs: number) {
  const sorted = [...props].sort(
    (a, b) => (Number(b.edge_pct ?? 0) - Number(a.edge_pct ?? 0)) || ((b.composite_score ?? 0) - (a.composite_score ?? 0)),
  );
  const legs: any[] = [];
  const playerSet = new Set<string>();
  const gameCounts = new Map<string, number>();

  for (const p of sorted) {
    if (legs.length >= targetLegs) break;
    if (playerSet.has(p.player_name.toLowerCase())) continue;
    const g = gameId(p.correlation_tags);
    if (g) {
      const c = gameCounts.get(g) ?? 0;
      const sharePct = (c + 1) / (legs.length + 1);
      if (legs.length >= 2 && sharePct > SAME_GAME_CAP) continue;
    }
    legs.push(p);
    playerSet.add(p.player_name.toLowerCase());
    if (g) gameCounts.set(g, (gameCounts.get(g) ?? 0) + 1);
  }

  if (legs.length < 2) return null;

  const decimal = legs.reduce((acc, l) => {
    const odds = l.side === "over" ? l.over_price : l.under_price;
    return acc * americanToDecimal(odds);
  }, 1);
  const composite =
    legs.reduce((a, l) => a + (l.composite_score ?? 0), 0) / legs.length;

  return {
    legs: legs.map((l) => ({
      id: l.id,
      player_name: l.player_name,
      prop_type: l.prop_type,
      side: l.side,
      line: l.line,
      odds: l.side === "over" ? l.over_price : l.under_price,
      dna_score: l.dna_score,
      composite_score: l.composite_score,
      l10_hit_rate: l.l10_hit_rate,
      reasoning: buildLegReasoning(l),
    })),
    american_odds: decimalToAmerican(decimal),
    decimal_odds: Number(decimal.toFixed(3)),
    composite_score: Math.round(composite),
    distinct_games: gameCounts.size,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const session_id = body.session_id as string;
    const target_legs = Math.min(6, Math.max(2, Number(body.target_legs) || 3));
    const mode = body.mode === "manual" ? "manual" : "auto";
    const selected_prop_ids: string[] | undefined = body.selected_prop_ids;

    if (!session_id) {
      return new Response(JSON.stringify({ ok: false, error: "session_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let q = supabase
      .from("ocr_scanned_props")
      .select("*")
      .eq("session_id", session_id)
      .eq("blocked", false);
    // Auto mode requires a real edge AND a recommended side.
    if (mode !== "manual") {
      q = q.not("recommended_side", "is", null).gte("edge_pct", 4);
    }
    if (mode === "manual" && selected_prop_ids?.length) {
      q = q.in("id", selected_prop_ids);
    }
    const { data: pool, error } = await q;
    if (error) throw new Error(error.message);
    if (!pool || pool.length < 2) {
      // Surface a friendly reason for the Telegram renderer
      const { count: totalCount } = await supabase
        .from("ocr_scanned_props")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session_id);
      const { count: edgeCount } = await supabase
        .from("ocr_scanned_props")
        .select("id", { count: "exact", head: true })
        .eq("session_id", session_id)
        .eq("blocked", false)
        .gte("edge_pct", 4);
      return new Response(
        JSON.stringify({
          ok: true,
          parlays: [],
          reason: "pool_too_small",
          pool_size: pool?.length ?? 0,
          total_scanned: totalCount ?? 0,
          with_edge: edgeCount ?? 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const parlays: any[] = [];
    if (mode === "manual") {
      const single = buildParlay(pool, Math.min(pool.length, target_legs));
      if (single) parlays.push(single);
    } else {
      const sizes = Array.from(
        new Set([target_legs, target_legs + 1, Math.max(2, target_legs - 1)]),
      );
      for (const size of sizes) {
        const p = buildParlay(pool, size);
        if (p) parlays.push(p);
        if (parlays.length >= 3) break;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, parlays, pool_size: pool.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("ocr-pool-build-parlays error", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});