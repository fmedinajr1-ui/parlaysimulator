// ============================================================================
// outrights-sync — Pulls futures / outright winner markets across Golf, Tennis,
// Soccer, and Darts from The Odds API and upserts them into `unified_props`
// so the lottery-1500 Kitchen-Sink builder can use them as legs.
//
// Strategy: discover any sport with `has_outrights=true` and a group in our
// allowlist, then call /odds/?markets=outrights. Each outcome (player/team)
// becomes one row with prop_type='outright_winner', market_type='outright'.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_GROUPS = new Set(["Golf", "Tennis", "Soccer", "Darts"]);
const PREFERRED_BOOKS = ["fanduel", "draftkings", "betmgm", "caesars", "betrivers", "hardrockbet"];

function americanFromOutcome(price: unknown): number | null {
  const n = Number(price);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function pickPreferredBook<T extends { key: string }>(books: T[]): T | null {
  if (!books || books.length === 0) return null;
  for (const want of PREFERRED_BOOKS) {
    const hit = books.find((b) => b.key === want);
    if (hit) return hit;
  }
  return books[0];
}

// Coarse sport bucket so lottery-builder's per-sport diversity counts work.
function bucketSport(group: string, key: string): string {
  if (group === "Golf") return "golf";
  if (group === "Darts") return "darts";
  if (group === "Tennis") return key.startsWith("tennis_wta") ? "tennis_wta" : "tennis_atp";
  // Soccer: keep raw key so distinct competitions count as distinct
  return key;
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

  // 1. Discover active outright sport keys in allowed groups.
  const sportsRes = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}&all=true`);
  if (!sportsRes.ok) {
    return new Response(JSON.stringify({ success: false, error: `sports list HTTP ${sportsRes.status}` }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const sports = await sportsRes.json() as Array<{
    key: string; title: string; group: string; active: boolean; has_outrights: boolean;
  }>;
  const targets = sports.filter((s) =>
    s.active && s.has_outrights && ALLOWED_GROUPS.has(s.group)
  );

  const now = new Date().toISOString();
  const summary: Record<string, { events: number; rows: number; skipped: number; error?: string }> = {};
  const allRows: any[] = [];

  for (const sport of targets) {
    summary[sport.key] = { events: 0, rows: 0, skipped: 0 };
    try {
      const url =
        `https://api.the-odds-api.com/v4/sports/${sport.key}/odds/` +
        `?apiKey=${apiKey}&regions=us&markets=outrights&oddsFormat=american`;
      const res = await fetch(url);
      if (!res.ok) {
        summary[sport.key].error = `HTTP ${res.status}`;
        summary[sport.key].skipped++;
        continue;
      }
      const events = await res.json() as Array<{
        id: string; commence_time: string; sport_key: string; sport_title: string;
        bookmakers: Array<{ key: string; markets: Array<{ key: string; outcomes: Array<{ name: string; price: number }> }> }>;
      }>;

      const bucket = bucketSport(sport.group, sport.key);

      for (const ev of events) {
        summary[sport.key].events++;
        const book = pickPreferredBook(ev.bookmakers ?? []);
        if (!book) { summary[sport.key].skipped++; continue; }
        const market = book.markets?.find((m) => m.key === "outrights");
        if (!market || !market.outcomes?.length) { summary[sport.key].skipped++; continue; }

        for (const outcome of market.outcomes) {
          const price = americanFromOutcome(outcome.price);
          if (price === null) continue;
          // Skip absurd longshots — keep tickets reachable
          if (price > 50000) continue;

          allRows.push({
            // Share event_id across all outcomes in the same tournament so the
            // lottery builder's MAX_PER_GAME=1 prevents stacking multiple
            // (mutually-exclusive) winners from the same field.
            event_id: ev.id,
            sport: bucket,
            game_description: `${sport.title}`,
            commence_time: ev.commence_time,
            player_name: outcome.name,
            prop_type: "outright_winner",
            bookmaker: book.key,
            current_line: 0,
            over_price: price,        // "Yes / will win"
            under_price: null,
            is_active: true,
            market_type: "outright",
            category: "futures",
            updated_at: now,
            odds_updated_at: now,
          });
          summary[sport.key].rows++;
        }
      }
    } catch (e) {
      summary[sport.key].error = (e as Error).message;
      summary[sport.key].skipped++;
    }
  }

  let inserted = 0;
  if (allRows.length > 0) {
    // Chunked upsert to stay under PostgREST payload limits
    for (let i = 0; i < allRows.length; i += 200) {
      const chunk = allRows.slice(i, i + 200);
      const { error } = await sb
        .from("unified_props")
        .upsert(chunk, { onConflict: "event_id,player_name,prop_type,bookmaker" });
      if (error) {
        return new Response(JSON.stringify({ success: false, error: error.message, inserted, summary }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      inserted += chunk.length;
    }
  }

  return new Response(JSON.stringify({
    success: true,
    discovered_sports: targets.map((t) => ({ key: t.key, title: t.title, group: t.group })),
    inserted,
    summary,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
