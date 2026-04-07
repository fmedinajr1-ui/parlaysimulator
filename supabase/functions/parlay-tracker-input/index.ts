import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const { chat_id, legs: rawLegs } = await req.json();

    if (!chat_id || !rawLegs || !Array.isArray(rawLegs) || rawLegs.length === 0) {
      return new Response(JSON.stringify({ error: "chat_id and legs[] required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[Parlay Tracker Input] Received ${rawLegs.length} legs from chat ${chat_id}`);

    const enrichedLegs: any[] = [];

    for (const leg of rawLegs) {
      const { player_name, prop_type, side, line } = leg;

      if (!player_name || !prop_type || !side || line == null) {
        console.log(`[Parlay Tracker Input] Skipping incomplete leg: ${JSON.stringify(leg)}`);
        continue;
      }

      // Look up in unified_props to get current price, event_id, commence_time, sport
      const { data: props } = await supabase
        .from("unified_props")
        .select("*")
        .ilike("player_name", `%${player_name}%`)
        .eq("prop_type", prop_type)
        .limit(1);

      const match = props?.[0];

      const currentPrice = match
        ? (side === "over" ? match.over_price : match.under_price)
        : leg.odds || null;

      enrichedLegs.push({
        player_name: match?.player_name || player_name,
        prop_type,
        side,
        line: match?.line ?? line,
        initial_price: currentPrice,
        current_price: currentPrice,
        sport: match?.sport || leg.sport || "unknown",
        event_id: match?.event_id || leg.event_id || null,
        commence_time: match?.commence_time || leg.commence_time || null,
        team: match?.team || leg.team || null,
      });
    }

    if (enrichedLegs.length === 0) {
      return new Response(JSON.stringify({ error: "No valid legs found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert into tracked_parlays
    const { data: inserted, error: insertErr } = await supabase
      .from("tracked_parlays")
      .insert({
        chat_id,
        legs: enrichedLegs,
        leg_snapshots: [],
        status: "active",
        final_verdict_sent: false,
      })
      .select("id")
      .single();

    if (insertErr) throw insertErr;

    // Send confirmation to Telegram
    const legLines = enrichedLegs.map((l: any, i: number) => {
      const emoji = i === 0 ? "1️⃣" : i === 1 ? "2️⃣" : "3️⃣";
      const priceStr = l.initial_price ? ` (${l.initial_price > 0 ? "+" : ""}${l.initial_price})` : "";
      return `${emoji} ${l.player_name} ${l.prop_type} ${l.side.toUpperCase()} ${l.line}${priceStr}`;
    });

    const confirmMsg = [
      "🎯 *PARLAY TRACKER STARTED*",
      "",
      ...legLines,
      "",
      "📊 Monitoring every 15 min with team correlation",
      "🔒 Final verdict 30 min before tip",
      `🆔 Tracker: \`${inserted.id.slice(0, 8)}\``,
    ].join("\n");

    try {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message: confirmMsg, parse_mode: "Markdown", chat_id },
      });
    } catch (_) {
      console.log("[Parlay Tracker Input] Telegram send failed, continuing");
    }

    console.log(`[Parlay Tracker Input] Created tracker ${inserted.id} with ${enrichedLegs.length} legs`);

    return new Response(JSON.stringify({
      success: true,
      tracker_id: inserted.id,
      legs: enrichedLegs,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[Parlay Tracker Input] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
