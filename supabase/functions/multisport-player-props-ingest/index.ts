// multisport-player-props-ingest
//
// Pulls REAL player-prop lines from The Odds API for every in-season sport that
// the existing tennis-props-sync does NOT cover: MLB, WNBA, Soccer (EPL/MLS/UCL/
// La Liga). Writes results into unified_props using the same schema tennis-props-
// sync uses so the rest of the stack (sharp tracker, side-picker, settlers) works
// without further changes.
//
// No mocked data. If The Odds API returns nothing, we write nothing. The function
// surfaces per-sport counts so the orchestrator can detect dead pipes early.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ODDS_API_BASE = "https://api.the-odds-api.com/v4/sports";

// Sport-key → player-prop markets. Keys MUST match The Odds API exactly.
// (Match-level markets like totals are handled by game_bets / mlb-odds-props-sync.)
const SPORT_MARKETS: Record<string, { canonical: string; markets: string[] }> = {
  baseball_mlb: {
    canonical: "baseball_mlb",
    markets: [
      "batter_hits", "batter_home_runs", "batter_total_bases", "batter_rbis",
      "batter_runs_scored", "batter_stolen_bases", "batter_strikeouts",
      "pitcher_strikeouts", "pitcher_outs", "pitcher_earned_runs", "pitcher_hits_allowed",
    ],
  },
  basketball_wnba: {
    canonical: "basketball_wnba",
    markets: [
      "player_points", "player_rebounds", "player_assists",
      "player_threes", "player_steals", "player_blocks",
      "player_points_rebounds_assists", "player_points_rebounds", "player_points_assists",
    ],
  },
  soccer_epl: {
    canonical: "soccer_epl",
    markets: ["player_goals", "player_assists", "player_shots", "player_shots_on_target", "player_total_passes"],
  },
  soccer_usa_mls: {
    canonical: "soccer_mls",
    markets: ["player_goals", "player_assists", "player_shots", "player_shots_on_target"],
  },
  soccer_uefa_champs_league: {
    canonical: "soccer_ucl",
    markets: ["player_goals", "player_assists", "player_shots", "player_shots_on_target"],
  },
  soccer_spain_la_liga: {
    canonical: "soccer_laliga",
    markets: ["player_goals", "player_assists", "player_shots", "player_shots_on_target"],
  },
  soccer_fifa_world_cup: {
    canonical: "soccer_world_cup",
    markets: ["player_goals", "player_assists", "player_shots", "player_shots_on_target"],
  },
  soccer_fifa_club_world_cup: {
    canonical: "soccer_club_world_cup",
    markets: ["player_goals", "player_assists", "player_shots", "player_shots_on_target"],
  },
};

const PREFERRED_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars", "pointsbetus"];

function getEasternDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

interface OddsEvent { id: string; commence_time: string; home_team: string; away_team: string; }
interface Outcome { name: string; price: number; point?: number; description?: string; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const apiKey = Deno.env.get("THE_ODDS_API_KEY");
  const log = (m: string) => console.log(`[multisport-ingest] ${m}`);

  if (!apiKey) {
    return new Response(JSON.stringify({ success: false, error: "THE_ODDS_API_KEY not set" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const today = getEasternDate();
  const tomorrow = getEasternDate(new Date(Date.now() + 24 * 3600 * 1000));
  const perSport: Record<string, { events: number; rows: number; markets: Set<string> }> = {};
  const allRows: any[] = [];

  // Discover which sport keys are actually active right now (saves API calls).
  let activeKeys: Set<string> = new Set();
  try {
    const r = await fetch(`${ODDS_API_BASE}?apiKey=${apiKey}`);
    if (r.ok) {
      const sports = await r.json();
      activeKeys = new Set(sports.filter((s: any) => s.active).map((s: any) => s.key));
    }
  } catch (e) { log(`sport discovery failed: ${(e as Error).message}`); }

  for (const [sportKey, cfg] of Object.entries(SPORT_MARKETS)) {
    if (activeKeys.size && !activeKeys.has(sportKey)) {
      log(`${sportKey}: not active on Odds API, skipping`);
      continue;
    }
    perSport[cfg.canonical] = { events: 0, rows: 0, markets: new Set() };
    try {
      const ev = await fetch(`${ODDS_API_BASE}/${sportKey}/events?apiKey=${apiKey}`);
      if (!ev.ok) { log(`${sportKey} events ${ev.status}`); continue; }
      const events: OddsEvent[] = await ev.json();
      const inWindow = events.filter((e) => {
        const d = getEasternDate(new Date(e.commence_time));
        return d === today || d === tomorrow;
      });
      perSport[cfg.canonical].events = inWindow.length;
      log(`${sportKey}: ${inWindow.length}/${events.length} events in window`);

      // Limit to 10 events per sport per run to stay under quota (~10k req/mo).
      for (const event of inWindow.slice(0, 10)) {
        const markets = cfg.markets.join(",");
        const url = `${ODDS_API_BASE}/${sportKey}/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american`;
        const r = await fetch(url);
        if (!r.ok) { log(`  ${event.id} ${r.status} ${(await r.text()).slice(0, 60)}`); continue; }
        const data = await r.json();
        const gameDesc = `${event.away_team} vs ${event.home_team}`;
        const bookmakers = (data.bookmakers ?? []).filter((b: any) => PREFERRED_BOOKS.includes(b.key));
        for (const book of bookmakers) {
          for (const market of book.markets ?? []) {
            const marketKey: string = market.key;
            const outcomes: Outcome[] = market.outcomes ?? [];
            // Group outcomes by player + line
            const groups = new Map<string, { over?: Outcome; under?: Outcome }>();
            for (const o of outcomes) {
              const player = o.description || o.name;
              const key = `${player}|${o.point ?? 0}`;
              if (!groups.has(key)) groups.set(key, {});
              const g = groups.get(key)!;
              const side = (o.name || "").toLowerCase();
              if (side === "over") g.over = o;
              else if (side === "under") g.under = o;
            }
            for (const [k, g] of groups) {
              const [player] = k.split("|");
              const line = g.over?.point ?? g.under?.point;
              if (line == null || !player) continue;
              perSport[cfg.canonical].markets.add(marketKey);
              perSport[cfg.canonical].rows++;
              allRows.push({
                event_id: event.id,
                sport: cfg.canonical,
                game_description: gameDesc,
                commence_time: event.commence_time,
                player_name: player,
                prop_type: marketKey,
                bookmaker: book.key,
                current_line: line,
                over_price: g.over?.price ?? null,
                under_price: g.under?.price ?? null,
                is_active: true,
                updated_at: new Date().toISOString(),
              });
            }
          }
        }
      }
    } catch (e) { log(`${sportKey} error: ${(e as Error).message}`); }
  }

  // Deduplicate: keep best (highest-volume) book per (sport, player, prop, line).
  // Bookmaker priority captured by PREFERRED_BOOKS order.
  const bookRank = new Map(PREFERRED_BOOKS.map((b, i) => [b, i]));
  const best = new Map<string, any>();
  for (const r of allRows) {
    const k = `${r.sport}|${r.player_name}|${r.prop_type}|${r.current_line}`;
    const prev = best.get(k);
    if (!prev || (bookRank.get(r.bookmaker) ?? 99) < (bookRank.get(prev.bookmaker) ?? 99)) best.set(k, r);
  }
  const dedup = [...best.values()];

  // Upsert into unified_props on the natural key.
  let written = 0;
  if (dedup.length) {
    // Batch by 500
    for (let i = 0; i < dedup.length; i += 500) {
      const batch = dedup.slice(i, i + 500);
      const { error } = await supabase.from("unified_props").upsert(batch, {
        onConflict: "sport,player_name,prop_type,current_line,bookmaker",
        ignoreDuplicates: false,
      });
      if (error) {
        // Fall back to insert with conflict-on-do-nothing if no unique index exists.
        const { error: insErr } = await supabase.from("unified_props").insert(batch);
        if (insErr) { log(`upsert+insert failed: ${insErr.message}`); continue; }
      }
      written += batch.length;
    }
  }

  const summary = Object.fromEntries(Object.entries(perSport).map(([k, v]) =>
    [k, { events: v.events, rows: v.rows, markets: [...v.markets] }]));

  return new Response(JSON.stringify({
    success: true, date: today, total_rows: allRows.length, deduped: dedup.length, written, per_sport: summary,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});