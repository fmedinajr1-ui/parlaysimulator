// ============================================================================
// mlb-odds-props-sync — Pulls a broad set of MLB player markets from The Odds
// API (pitcher + batter) and upserts them into unified_props so the parlay
// engine has full MLB coverage, not just the PrizePicks subset.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SPORT = "baseball_mlb";
const PREFERRED_BOOKS = ["fanduel", "hardrockbet", "draftkings", "betmgm", "caesars"];
const PLAYER_MARKETS = [
  "pitcher_strikeouts",
  "pitcher_outs",
  "pitcher_hits_allowed",
  "pitcher_walks",
  "pitcher_earned_runs",
  "pitcher_record_a_win",
  "batter_hits",
  "batter_total_bases",
  "batter_home_runs",
  "batter_rbis",
  "batter_runs_scored",
  "batter_stolen_bases",
  "batter_singles",
  "batter_doubles",
  "batter_walks",
  "batter_strikeouts",
  "batter_hits_runs_rbis",
];

interface OddsEvent { id: string; commence_time: string; home_team: string; away_team: string; }
interface UnifiedRow {
  event_id: string;
  sport: string;
  game_description: string;
  commence_time: string;
  player_name: string;
  prop_type: string;
  bookmaker: string;
  current_line: number;
  over_price: number | null;
  under_price: number | null;
  is_active: boolean;
  market_type: string;
  category: string;
  updated_at: string;
  odds_updated_at: string;
}

function americanFromOutcome(price: unknown): number | null {
  const n = Number(price);
  return Number.isFinite(n) ? Math.round(n) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const apiKey = Deno.env.get("THE_ODDS_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ success: false, error: "THE_ODDS_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date().toISOString();
  const allRows: UnifiedRow[] = [];
  const stats = { events: 0, eventsScanned: 0, marketsScanned: 0, marketHits: 0, skipped: 0 };

  // 1. Get today's MLB events
  const eventsRes = await fetch(
    `https://api.the-odds-api.com/v4/sports/${SPORT}/events?apiKey=${apiKey}`,
  );
  if (!eventsRes.ok) {
    return new Response(JSON.stringify({ success: false, error: `events HTTP ${eventsRes.status}` }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const events = await eventsRes.json() as OddsEvent[];
  stats.events = events.length;

  // 2. For each event, fetch player markets in one batched call
  const marketsParam = PLAYER_MARKETS.join(",");
  const bookmakerParam = PREFERRED_BOOKS.join(",");

  for (const ev of events) {
    stats.eventsScanned++;
    const desc = `${ev.away_team} @ ${ev.home_team}`;
    try {
      const url =
        `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${ev.id}/odds` +
        `?apiKey=${apiKey}&regions=us&markets=${marketsParam}` +
        `&oddsFormat=american&bookmakers=${bookmakerParam}`;
      const res = await fetch(url);
      if (!res.ok) { stats.skipped++; continue; }
      const ev2 = await res.json() as {
        bookmakers?: Array<{ key: string; markets: Array<{ key: string; outcomes: Array<Record<string, unknown>> }> }>;
      };

      // Pick best book per market (per outcome group)
      // Aggregate by (player_name, prop_type) keeping first preferred book.
      const seenKey = new Set<string>();
      const bookmakers = (ev2.bookmakers ?? [])
        .slice()
        .sort((a, b) => PREFERRED_BOOKS.indexOf(a.key) - PREFERRED_BOOKS.indexOf(b.key));

      for (const bk of bookmakers) {
        for (const m of bk.markets ?? []) {
          if (!PLAYER_MARKETS.includes(m.key)) continue;
          stats.marketsScanned++;
          // Group outcomes by description (player name).
          const byPlayer = new Map<string, { over?: Record<string, unknown>; under?: Record<string, unknown> }>();
          for (const o of m.outcomes ?? []) {
            const player = String(o.description ?? o.name ?? "").trim();
            if (!player) continue;
            const slot = byPlayer.get(player) ?? {};
            const nm = String(o.name ?? "").toLowerCase();
            if (nm === "over" || nm === "yes") slot.over = o;
            else if (nm === "under" || nm === "no") slot.under = o;
            byPlayer.set(player, slot);
          }
          for (const [player, sides] of byPlayer) {
            const key = `${player}|${m.key}`;
            if (seenKey.has(key)) continue;
            seenKey.add(key);
            const overO = sides.over;
            const underO = sides.under;
            const line = Number(overO?.point ?? underO?.point ?? 0.5);
            allRows.push({
              event_id: `${ev.id}_${m.key}_${player.replace(/\s+/g, "_")}`,
              sport: SPORT,
              game_description: desc,
              commence_time: ev.commence_time,
              player_name: player,
              prop_type: m.key,
              bookmaker: bk.key,
              current_line: line,
              over_price: americanFromOutcome(overO?.price),
              under_price: americanFromOutcome(underO?.price),
              is_active: true,
              market_type: "player",
              category: "mlb_player",
              updated_at: now,
              odds_updated_at: now,
            });
            stats.marketHits++;
          }
        }
      }
    } catch (e) {
      console.warn(`[mlb-odds-props-sync] event ${ev.id} error:`, (e as Error).message);
      stats.skipped++;
    }
  }

  let inserted = 0;
  if (allRows.length > 0) {
    const { error } = await sb
      .from("unified_props")
      .upsert(allRows, { onConflict: "event_id,player_name,prop_type,bookmaker" });
    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message, stats }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    inserted = allRows.length;
  }

  return new Response(JSON.stringify({ success: true, inserted, stats }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});