// Pull player-prop quotes for a specific live event across multiple books and
// persist into live_prop_quotes for side-by-side comparison.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ODDS_BASE = "https://api.the-odds-api.com/v4/sports";

const BOOKS = [
  "fanduel",
  "draftkings",
  "betmgm",
  "williamhill_us",
  "betrivers",
  "espnbet",
  "pinnacle",
];

// minimal per-sport prop market lists
const MARKETS: Record<string, string[]> = {
  NBA: ["player_points", "player_rebounds", "player_assists", "player_threes"],
  WNBA: ["player_points", "player_rebounds", "player_assists"],
  NCAAB: ["player_points", "player_rebounds", "player_assists"],
  NFL: ["player_pass_yds", "player_rush_yds", "player_receptions", "player_anytime_td"],
  NCAAF: ["player_pass_yds", "player_rush_yds", "player_receptions"],
  MLB: ["batter_hits", "batter_total_bases", "batter_home_runs", "pitcher_strikeouts"],
  NHL: ["player_shots_on_goal", "player_points", "player_goals"],
  Soccer: ["player_shots_on_target", "player_shots", "player_goal_scorer_anytime"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("THE_ODDS_API_KEY");
  if (!apiKey) return json({ success: false, error: "THE_ODDS_API_KEY not set" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { event_id?: string; sport_key?: string; sport?: string } = {};
  try {
    body = await req.json();
  } catch {
    // GET fallback - read from query
    const u = new URL(req.url);
    body = {
      event_id: u.searchParams.get("event_id") ?? undefined,
      sport_key: u.searchParams.get("sport_key") ?? undefined,
      sport: u.searchParams.get("sport") ?? undefined,
    };
  }

  const { event_id, sport_key, sport } = body;
  if (!event_id || !sport_key || !sport) {
    return json({ success: false, error: "event_id, sport_key and sport are required" }, 400);
  }

  const markets = MARKETS[sport] ?? [];
  if (!markets.length) return json({ success: true, written: 0, note: "no markets for sport" });

  const url =
    `${ODDS_BASE}/${sport_key}/events/${event_id}/odds/` +
    `?apiKey=${apiKey}` +
    `&regions=us` +
    `&oddsFormat=american` +
    `&markets=${markets.join(",")}` +
    `&bookmakers=${BOOKS.join(",")}`;

  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text();
    // Quota / auth issues: degrade gracefully so the client doesn't blank-screen.
    if (res.status === 401 || res.status === 429) {
      return json({
        success: true,
        written: 0,
        quota_exceeded: true,
        provider_status: res.status,
        provider_message: t.slice(0, 300),
      });
    }
    return json({ success: false, error: `Odds API ${res.status}: ${t.slice(0, 200)}` }, 502);
  }
  const data = await res.json();

  const rows: Array<{
    event_id: string;
    sport: string;
    player_name: string;
    prop_type: string;
    line: number | null;
    bookmaker: string;
    over_price: number | null;
    under_price: number | null;
    fetched_at: string;
  }> = [];
  const fetchedAt = new Date().toISOString();

  for (const bm of data?.bookmakers ?? []) {
    for (const mk of bm.markets ?? []) {
      // group outcomes by player+line
      const byKey = new Map<string, { over?: number; under?: number; line: number | null; name: string }>();
      for (const o of mk.outcomes ?? []) {
        const player: string = o.description ?? o.participant ?? o.name ?? "";
        const line = typeof o.point === "number" ? o.point : null;
        const key = `${player}|${line ?? "ML"}`;
        const slot = byKey.get(key) ?? { line, name: player };
        const side = (o.name ?? "").toLowerCase();
        if (side === "over" || side === "yes") slot.over = o.price;
        else if (side === "under" || side === "no") slot.under = o.price;
        else slot.over = o.price; // anytime TD / yes-only markets
        byKey.set(key, slot);
      }
      for (const slot of byKey.values()) {
        if (!slot.name) continue;
        rows.push({
          event_id,
          sport,
          player_name: slot.name,
          prop_type: mk.key,
          line: slot.line,
          bookmaker: bm.key,
          over_price: slot.over ?? null,
          under_price: slot.under ?? null,
          fetched_at: fetchedAt,
        });
      }
    }
  }

  let written = 0;
  const errors: string[] = [];
  // upsert in chunks
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error, count } = await supabase
      .from("live_prop_quotes")
      .upsert(chunk, {
        onConflict: "event_id,player_name,prop_type,line,bookmaker",
        count: "exact",
      });
    if (error) errors.push(error.message);
    else written += count ?? chunk.length;
  }

  return json({ success: errors.length === 0, written, errors, total: rows.length });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}