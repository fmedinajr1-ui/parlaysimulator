// ============================================================================
// team-markets-sync — Pulls H2H (moneyline), spreads, and totals for all
// in-season sports from The Odds API and upserts them into unified_props as
// market_type-tagged rows so the parlay engine can build team-market legs.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SPORTS = [
  "basketball_nba",
  "baseball_mlb",
  "icehockey_nhl",
];
const PREFERRED_BOOKS = ["fanduel", "hardrockbet", "draftkings", "betmgm", "caesars"];
const MARKETS = "h2h,spreads,totals";

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

function pickPreferredBook<T extends { key: string }>(books: T[]): T | null {
  if (!books || books.length === 0) return null;
  for (const want of PREFERRED_BOOKS) {
    const hit = books.find(b => b.key === want);
    if (hit) return hit;
  }
  return books[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const apiKey = Deno.env.get("THE_ODDS_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ success: false, error: "THE_ODDS_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const now = new Date().toISOString();
  const summary: Record<string, { events: number; rows: number; skipped: number }> = {};
  const allRows: UnifiedRow[] = [];

  for (const sport of SPORTS) {
    summary[sport] = { events: 0, rows: 0, skipped: 0 };
    try {
      const url =
        `https://api.the-odds-api.com/v4/sports/${sport}/odds` +
        `?apiKey=${apiKey}&regions=us&markets=${MARKETS}&oddsFormat=american`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[team-markets-sync] ${sport} HTTP ${res.status}`);
        summary[sport].skipped++;
        continue;
      }
      const events = await res.json() as Array<{
        id: string; commence_time: string;
        home_team: string; away_team: string;
        bookmakers: Array<{ key: string; markets: Array<{ key: string; outcomes: Array<Record<string, unknown>> }> }>;
      }>;

      for (const ev of events) {
        summary[sport].events++;
        const book = pickPreferredBook(ev.bookmakers ?? []);
        if (!book) { summary[sport].skipped++; continue; }
        const desc = `${ev.away_team} @ ${ev.home_team}`;

        for (const m of book.markets ?? []) {
          if (m.key === "h2h") {
            const homeO = m.outcomes.find(o => o.name === ev.home_team);
            const awayO = m.outcomes.find(o => o.name === ev.away_team);
            allRows.push({
              event_id: `${ev.id}_h2h`,
              sport,
              game_description: desc,
              commence_time: ev.commence_time,
              player_name: `${ev.home_team} / ${ev.away_team}`,
              prop_type: "h2h",
              bookmaker: book.key,
              current_line: 0,
              over_price: americanFromOutcome(homeO?.price),
              under_price: americanFromOutcome(awayO?.price),
              is_active: true,
              market_type: "moneyline",
              category: "team_market",
              updated_at: now,
              odds_updated_at: now,
            });
            summary[sport].rows++;
          } else if (m.key === "spreads") {
            const homeO = m.outcomes.find(o => o.name === ev.home_team);
            const awayO = m.outcomes.find(o => o.name === ev.away_team);
            const line = Number(homeO?.point ?? 0);
            allRows.push({
              event_id: `${ev.id}_spread`,
              sport,
              game_description: desc,
              commence_time: ev.commence_time,
              player_name: `${ev.home_team} / ${ev.away_team}`,
              prop_type: "spreads",
              bookmaker: book.key,
              current_line: line,
              over_price: americanFromOutcome(homeO?.price),   // home covers
              under_price: americanFromOutcome(awayO?.price),  // away covers
              is_active: true,
              market_type: "spread",
              category: "team_market",
              updated_at: now,
              odds_updated_at: now,
            });
            summary[sport].rows++;
          } else if (m.key === "totals") {
            const overO = m.outcomes.find(o => String(o.name).toLowerCase() === "over");
            const underO = m.outcomes.find(o => String(o.name).toLowerCase() === "under");
            const line = Number(overO?.point ?? underO?.point ?? 0);
            allRows.push({
              event_id: `${ev.id}_total`,
              sport,
              game_description: desc,
              commence_time: ev.commence_time,
              player_name: "Game Total",
              prop_type: "totals",
              bookmaker: book.key,
              current_line: line,
              over_price: americanFromOutcome(overO?.price),
              under_price: americanFromOutcome(underO?.price),
              is_active: true,
              market_type: "total",
              category: "team_market",
              updated_at: now,
              odds_updated_at: now,
            });
            summary[sport].rows++;
          }
        }
      }
    } catch (e) {
      console.warn(`[team-markets-sync] ${sport} error:`, (e as Error).message);
      summary[sport].skipped++;
    }
  }

  let inserted = 0;
  if (allRows.length > 0) {
    const { error } = await sb
      .from("unified_props")
      .upsert(allRows, { onConflict: "event_id,player_name,prop_type,bookmaker" });
    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message, summary }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    inserted = allRows.length;
  }

  return new Response(JSON.stringify({ success: true, inserted, summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});