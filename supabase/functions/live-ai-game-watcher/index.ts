import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const today = new Date().toISOString().slice(0, 10);
    const { data: parlays } = await supabase.from("live_ai_generated_parlays")
      .select("id,user_id,legs,mode,created_at")
      .gte("created_at", `${today}T00:00:00Z`)
      .in("status", ["suggested", "saved"])
      .limit(500);

    let alertCount = 0;
    for (const p of parlays ?? []) {
      for (const leg of (p.legs as any[]) ?? []) {
        if (!leg.player_name) continue;
        const { data: juiced } = await supabase.from("juiced_props")
          .select("player_name,prop_type,juice_amount,juice_direction,line,final_pick")
          .ilike("player_name", `%${leg.player_name}%`)
          .ilike("prop_type", `%${leg.prop_type}%`)
          .gte("juice_amount", 15)
          .limit(1).maybeSingle();
        if (!juiced) continue;

        const { data: existing } = await supabase.from("live_ai_alerts")
          .select("id").eq("user_id", p.user_id)
          .eq("player_name", leg.player_name).eq("alert_type", "take_it_now")
          .gte("created_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
          .limit(1).maybeSingle();
        if (existing) continue;

        await supabase.from("live_ai_alerts").insert({
          user_id: p.user_id,
          alert_type: "take_it_now",
          title: `🚨 TAKE IT NOW — ${leg.player_name}`,
          body: `Sharp money piled in ${juiced.juice_amount}¢ on ${leg.prop_type}. Lock it before the book corrects.`,
          player_name: leg.player_name,
          urgency: "take_it_now",
          payload: { leg, juiced },
        });
        alertCount++;

        try {
          await supabase.functions.invoke("send-push-notification", {
            body: {
              user_id: p.user_id,
              title: `🚨 TAKE IT NOW — ${leg.player_name}`,
              body: `Sharp move ${juiced.juice_amount}¢ • Spike says lock it`,
              tag: "live-ai-alert",
            },
          });
        } catch (e) { console.warn("push failed", e); }
      }
    }

    return new Response(JSON.stringify({ ok: true, alerts_created: alertCount, parlays_scanned: parlays?.length ?? 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("game watcher error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});