// redeploy: pick up rotated SERVICE_ROLE_KEY
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyHmac } from "../_shared/scout-speed/hmac.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-signature",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const raw = await req.text();
  const ok = await verifyHmac(
    raw,
    req.headers.get("x-webhook-signature"),
    Deno.env.get("ODDS_FEED_WEBHOOK_SECRET"),
  );
  if (!ok) return json({ error: "invalid signature" }, 401);

  let payload: any;
  try { payload = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }

  // ping short-circuit (warm-keeper)
  if (payload?.ping) return json({ ok: true, pong: true });

  const list = Array.isArray(payload?.snapshots) ? payload.snapshots : [payload];
  const rows = list
    .filter((s: any) => s && s.game_id && s.market_type && (s.book || s.sportsbook))
    .map((s: any) => ({
      sportsbook: s.book ?? s.sportsbook,
      game_id: String(s.game_id),
      market_type: String(s.market_type),
      player_name: s.player_name ?? null,
      line: s.line == null ? null : Number(s.line),
      odds: s.odds == null ? null : Number(s.odds),
      captured_at: s.captured_at ?? new Date().toISOString(),
    }));

  if (rows.length === 0) return json({ ok: true, inserted: 0 });

  try {
    const { error } = await supabase.from("market_snapshot").insert(rows);
    if (error) return json({ error: error.message }, 500);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "insert failed" }, 500);
  }

  return json({ ok: true, inserted: rows.length });
});