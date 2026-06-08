// Bridges The Odds API (baseball_mlb h2h) into market_snapshot with
// market_type='live_ml' so scout-live-edge can attach a book line and
// mlb_fair_price_events.book_id stops being NULL.
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

function norm(s: string) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const apiKey = Deno.env.get("THE_ODDS_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: "THE_ODDS_API_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 1. Today's MLB schedule → name→gamePk map.
  const date = etDateKey();
  const schedRes = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}`);
  const schedJson = await schedRes.json();
  const gameMap = new Map<string, { pk: number; home: string; away: string }>();
  for (const g of schedJson?.dates?.[0]?.games ?? []) {
    const home = g?.teams?.home?.team?.name;
    const away = g?.teams?.away?.team?.name;
    if (!g.gamePk || !home || !away) continue;
    gameMap.set(`${norm(away)}@${norm(home)}`, { pk: g.gamePk, home, away });
  }

  // 2. Odds API h2h.
  const oddsUrl =
    `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}` +
    `&regions=us&markets=h2h&oddsFormat=american`;
  const oddsRes = await fetch(oddsUrl);
  if (!oddsRes.ok) {
    const text = await oddsRes.text();
    return new Response(JSON.stringify({ ok: false, error: `odds api ${oddsRes.status}: ${text}` }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const events = await oddsRes.json();

  // 3. Build snapshot rows.
  const rows: any[] = [];
  let matched = 0;
  let unmatched = 0;
  for (const ev of events) {
    const key = `${norm(ev.away_team)}@${norm(ev.home_team)}`;
    const game = gameMap.get(key);
    if (!game) { unmatched++; continue; }
    matched++;
    const gameId = `mlb_${game.pk}`;
    for (const bm of ev.bookmakers ?? []) {
      const h2h = bm.markets?.find((m: any) => m.key === "h2h");
      if (!h2h) continue;
      const homeOut = h2h.outcomes?.find((o: any) => o.name === ev.home_team);
      const awayOut = h2h.outcomes?.find((o: any) => o.name === ev.away_team);
      if (!homeOut || !awayOut) continue;
      const ts = bm.last_update ?? new Date().toISOString();
      rows.push({
        sportsbook: bm.key,
        game_id: gameId,
        market_type: "live_ml",
        player_name: ev.home_team,
        line: null,
        odds: Number(homeOut.price),
        captured_at: ts,
      });
      rows.push({
        sportsbook: bm.key,
        game_id: gameId,
        market_type: "live_ml",
        player_name: ev.away_team,
        line: null,
        odds: Number(awayOut.price),
        captured_at: ts,
      });
    }
  }

  let inserted = 0;
  if (rows.length) {
    const { error } = await supabase.from("market_snapshot").insert(rows);
    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message, rows: rows.length }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    inserted = rows.length;
  }

  return new Response(JSON.stringify({
    ok: true, date, events: events.length, matched, unmatched, inserted,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});