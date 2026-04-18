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

    // Pull biggest wins (min $100 profit) so the feed always looks strong
    const { data, error } = await supabase
      .from("bot_daily_parlays")
      .select("id, parlay_date, tier, strategy_name, expected_odds, simulated_stake, profit_loss, leg_count, legs_hit, legs_missed, outcome")
      .eq("outcome", "won")
      .gte("profit_loss", 100)
      .order("profit_loss", { ascending: false })
      .limit(12);

    if (error) throw error;

    const wins = (data || []).map((p: any) => ({
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
