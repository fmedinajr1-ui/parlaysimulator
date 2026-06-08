// Bridges hardrock-worker (Hard Rock Bet MLB moneylines) into
// market_snapshot with sportsbook='hardrockbet', market_type='live_ml'.
// Runs every 30s via pg_cron. scout-live-edge picks up these rows and
// attaches book_id='hardrockbet' to mlb_fair_price_events whenever HR
// posts the freshest line.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function etDateKey(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}

export function norm(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface HrEvent {
  event_id: string;
  start_time?: string;
  home_team: string;
  away_team: string;
  home_price: number;
  away_price: number;
  captured_at: string;
}

export function buildSnapshotRows(
  events: HrEvent[],
  gameMap: Map<string, { pk: number; home: string; away: string }>,
): { rows: any[]; matched: number; unmatched: number } {
  const rows: any[] = [];
  let matched = 0;
  let unmatched = 0;
  for (const ev of events) {
    const key = `${norm(ev.away_team)}@${norm(ev.home_team)}`;
    const game = gameMap.get(key);
    if (!game) { unmatched++; continue; }
    matched++;
    const gameId = `mlb_${game.pk}`;
    rows.push({
      sportsbook: "hardrockbet",
      game_id: gameId,
      market_type: "live_ml",
      player_name: game.home,
      line: null,
      odds: Number(ev.home_price),
      captured_at: ev.captured_at,
    });
    rows.push({
      sportsbook: "hardrockbet",
      game_id: gameId,
      market_type: "live_ml",
      player_name: game.away,
      line: null,
      odds: Number(ev.away_price),
      captured_at: ev.captured_at,
    });
  }
  return { rows, matched, unmatched };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const workerUrl = Deno.env.get("HARDROCK_WORKER_URL");
  const workerSecret = Deno.env.get("HARDROCK_WORKER_SECRET");
  if (!workerUrl || !workerSecret) {
    return new Response(JSON.stringify({ ok: false, error: "HARDROCK_WORKER_URL/SECRET missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Today's MLB schedule.
  const date = etDateKey();
  const gameMap = new Map<string, { pk: number; home: string; away: string }>();
  try {
    const schedRes = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
    const schedJson = await schedRes.json();
    for (const g of schedJson?.dates?.[0]?.games ?? []) {
      const home = g?.teams?.home?.team?.name;
      const away = g?.teams?.away?.team?.name;
      if (!g.gamePk || !home || !away) continue;
      gameMap.set(`${norm(away)}@${norm(home)}`, { pk: g.gamePk, home, away });
    }
  } catch (e) {
    console.warn("[hr-bridge] schedule fetch failed:", e);
  }

  // 2. Scrape HR via worker. Silent retry: log and return 200 with ok:false
  // so cron doesn't alarm.
  let events: HrEvent[] = [];
  try {
    const r = await fetch(`${workerUrl.replace(/\/$/, "")}/scrape-hardrock-mlb-ml`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerSecret}`, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) {
      const text = await r.text();
      console.warn(`[hr-bridge] worker ${r.status}: ${text}`);
      return new Response(JSON.stringify({ ok: false, error: `worker_${r.status}`, inserted: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await r.json();
    events = data?.events ?? [];
  } catch (e) {
    console.warn("[hr-bridge] worker fetch threw:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e), inserted: 0 }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { rows, matched, unmatched } = buildSnapshotRows(events, gameMap);

  let inserted = 0;
  if (rows.length) {
    try {
      const { error } = await supabase.from("market_snapshot").insert(rows);
      if (error) {
        console.warn("[hr-bridge] insert error:", error.message);
        return new Response(JSON.stringify({ ok: false, error: error.message, rows: rows.length }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      inserted = rows.length;
    } catch (e) {
      console.warn("[hr-bridge] insert threw:", e);
    }
  }

  return new Response(JSON.stringify({
    ok: true, date, events: events.length, matched, unmatched, inserted,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});