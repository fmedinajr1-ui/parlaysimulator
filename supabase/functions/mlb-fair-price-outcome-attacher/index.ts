// Attaches final game outcomes to mlb_fair_price_events rows so the
// uncalibrated WP model can be refit later. Runs on cron (every 30m).
// Joins on game_id -> live_game_scores.event_id (sport='MLB', status final).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FINAL_STATUSES = new Set([
  "final", "completed", "complete", "finished", "ended", "closed", "post",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Find unattached events from the last 14 days.
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data: events, error: evErr } = await supabase
    .from("mlb_fair_price_events")
    .select("id, game_id, pre_state, post_state, edge")
    .is("outcome_attached_at", null)
    .gte("created_at", since)
    .limit(2000);

  if (evErr) {
    return new Response(JSON.stringify({ ok: false, error: evErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!events || events.length === 0) {
    return new Response(JSON.stringify({ ok: true, attached: 0, scanned: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const gameIds = [...new Set(events.map((e) => e.game_id))];
  const { data: scores, error: scErr } = await supabase
    .from("live_game_scores")
    .select("event_id, home_score, away_score, game_status, sport")
    .in("event_id", gameIds);

  if (scErr) {
    return new Response(JSON.stringify({ ok: false, error: scErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const scoreMap = new Map<string, { home: number; away: number; status: string }>();
  for (const s of scores ?? []) {
    if ((s.sport || "").toUpperCase() !== "MLB") continue;
    if (!FINAL_STATUSES.has((s.game_status || "").toLowerCase())) continue;
    scoreMap.set(s.event_id, {
      home: Number(s.home_score ?? 0),
      away: Number(s.away_score ?? 0),
      status: s.game_status || "",
    });
  }

  let attached = 0;
  const nowIso = new Date().toISOString();

  for (const ev of events) {
    const sc = scoreMap.get(ev.game_id);
    if (!sc) continue;
    const homeWon = sc.home > sc.away;
    // Realized hit: positive edge on home ML -> home_won; negative edge -> away_won.
    const realizedHit = (ev.edge ?? 0) >= 0 ? homeWon : !homeWon;

    const { error: upErr } = await supabase
      .from("mlb_fair_price_events")
      .update({
        final_home_score: sc.home,
        final_away_score: sc.away,
        home_won: homeWon,
        realized_hit: realizedHit,
        outcome_attached_at: nowIso,
      })
      .eq("id", ev.id);
    if (!upErr) attached += 1;
  }

  return new Response(JSON.stringify({
    ok: true,
    scanned: events.length,
    games_resolved: scoreMap.size,
    attached,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});