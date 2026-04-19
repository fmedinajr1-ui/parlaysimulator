import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const TARGET = 8;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffDate = thirtyDaysAgo.toISOString().slice(0, 10);

    // 1. Recent wins from last 30 days (min $50 profit) — top by profit
    const { data: recent, error: recentErr } = await supabase
      .from("bot_daily_parlays")
      .select("id, parlay_date, tier, strategy_name, expected_odds, simulated_stake, profit_loss, leg_count, legs_hit, legs_missed, outcome")
      .eq("outcome", "won")
      .gte("profit_loss", 50)
      .gte("parlay_date", cutoffDate)
      .order("profit_loss", { ascending: false })
      .limit(TARGET);

    if (recentErr) throw recentErr;

    let combined = recent || [];

    // 2. If we don't have enough recent, fill with all-time biggest wins (excluding already-included IDs)
    if (combined.length < TARGET) {
      const excludeIds = combined.map((p: any) => p.id);
      const need = TARGET - combined.length;

      let fillerQuery = supabase
        .from("bot_daily_parlays")
        .select("id, parlay_date, tier, strategy_name, expected_odds, simulated_stake, profit_loss, leg_count, legs_hit, legs_missed, outcome")
        .eq("outcome", "won")
        .gte("profit_loss", 100)
        .order("profit_loss", { ascending: false })
        .limit(need);

      if (excludeIds.length > 0) {
        fillerQuery = fillerQuery.not("id", "in", `(${excludeIds.join(",")})`);
      }

      const { data: filler } = await fillerQuery;
      if (filler) combined = [...combined, ...filler];
    }

    // 3. Sort final list by date DESC (newest first)
    combined.sort((a: any, b: any) => (b.parlay_date > a.parlay_date ? 1 : -1));

    const wins = combined.map((p: any) => ({
      id: p.id,
      date: p.parlay_date,
      tier: p.tier || p.strategy_name,
      odds: p.expected_odds,
      stake: p.simulated_stake || 0,
      profit: p.profit_loss || 0,
      legCount: p.leg_count,
      legsHit: p.legs_hit,
    }));

    return new Response(JSON.stringify({ wins }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
