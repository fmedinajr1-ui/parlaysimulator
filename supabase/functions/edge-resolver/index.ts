import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let resolved = 0;
  try {
    const { data: expiring, error } = await supabase
      .from("lag_edges")
      .select("id, game_id, edge_type, source_snapshot_id")
      .eq("status", "active")
      .lt("expires_at", new Date().toISOString())
      .limit(500);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    for (const edge of expiring ?? []) {
      try {
        const { data: nowSnap } = await supabase
          .from("market_snapshot")
          .select("line")
          .eq("game_id", edge.game_id)
          .eq("market_type", edge.edge_type)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const { data: origin } = await supabase
          .from("market_snapshot")
          .select("line")
          .eq("id", edge.source_snapshot_id)
          .maybeSingle();

        const nowLine = nowSnap?.line == null ? null : Number(nowSnap.line);
        const origLine = origin?.line == null ? null : Number(origin.line);
        const actualMove = (nowLine ?? 0) - (origLine ?? 0);

        await supabase
          .from("lag_edges")
          .update({ status: "expired", actual_move: actualMove })
          .eq("id", edge.id);
        resolved++;
      } catch (e) {
        console.error("[edge-resolver] resolve failed for", edge.id, e);
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "resolver failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, resolved }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});