// multisport-player-props-backfill
//
// Backfills player-prop lines into unified_props from The Odds API HISTORICAL
// endpoints for the last N days. Use this to fill any gaps caused by past silent
// upsert failures or by sports/leagues that were not yet wired into the live
// ingest. Mirrors multisport-player-props-ingest's SPORT_MARKETS + dedup logic
// and writes via the same unique-constraint upsert.
//
// Trigger:
//   POST /functions/v1/multisport-player-props-backfill
//   body: {
//     "days": 14,                    // how many days back from today (ET). Default 14.
//     "start": "2026-05-26",         // optional explicit window (overrides days)
//     "end":   "2026-06-09",
//     "sports": ["baseball_mlb"],    // optional subset of Odds API sport keys
//     "max_events_per_day": 10,
//     "snapshot_offset_hours": 2,    // grab lines this many hours pre-tip
//     "dry_run": false
//   }
//
// COST WARNING: historical = 10 credits per market per snapshot per event +
// 1 credit per events-index call. The defaults below are conservative.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ODDS_BASE = "https://api.the-odds-api.com/v4";

// Same shape as multisport-player-props-ingest's SPORT_MARKETS. Keep in sync.
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
  soccer_epl: { canonical: "soccer_epl", markets: ["player_goals","player_assists","player_shots","player_shots_on_target","player_total_passes"] },
  soccer_usa_mls: { canonical: "soccer_mls", markets: ["player_goals","player_assists","player_shots","player_shots_on_target"] },
  soccer_uefa_champs_league: { canonical: "soccer_ucl", markets: ["player_goals","player_assists","player_shots","player_shots_on_target"] },
  soccer_spain_la_liga: { canonical: "soccer_laliga", markets: ["player_goals","player_assists","player_shots","player_shots_on_target"] },
  soccer_fifa_world_cup: { canonical: "soccer_world_cup", markets: ["player_goals","player_assists","player_shots","player_shots_on_target"] },
  soccer_fifa_club_world_cup: { canonical: "soccer_club_world_cup", markets: ["player_goals","player_assists","player_shots","player_shots_on_target"] },
  soccer_brazil_campeonato: { canonical: "soccer_brazil_serie_a", markets: ["player_goals","player_assists","player_shots","player_shots_on_target"] },
  soccer_brazil_serie_b: { canonical: "soccer_brazil_serie_b", markets: ["player_goals","player_assists","player_shots","player_shots_on_target"] },
  soccer_conmebol_copa_libertadores: { canonical: "soccer_copa_libertadores", markets: ["player_goals","player_assists","player_shots","player_shots_on_target"] },
  soccer_conmebol_copa_sudamericana: { canonical: "soccer_copa_sudamericana", markets: ["player_goals","player_assists","player_shots","player_shots_on_target"] },
};

const PREFERRED_BOOKS = ["draftkings", "fanduel", "betmgm", "caesars", "pointsbetus"];

function etDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}
function isoDay(d: Date) { return d.toISOString().slice(0, 10); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface OddsEvent { id: string; commence_time: string; home_team: string; away_team: string; }
interface Outcome { name: string; price: number; point?: number; description?: string; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const apiKey = Deno.env.get("THE_ODDS_API_KEY");
  const log = (m: string) => console.log(`[multisport-backfill] ${m}`);

  if (!apiKey) {
    return new Response(JSON.stringify({ success: false, error: "THE_ODDS_API_KEY not set" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  const days = Number(body.days ?? 14);
  const today = new Date();
  const startDate = body.start ? new Date(`${body.start}T12:00:00Z`)
    : new Date(Date.now() - days * 86400_000);
  const endDate = body.end ? new Date(`${body.end}T12:00:00Z`) : today;
  const sportsFilter: string[] | null = Array.isArray(body.sports) && body.sports.length ? body.sports : null;
  const maxEventsPerDay = Number(body.max_events_per_day ?? 10);
  const snapshotOffsetMs = Number(body.snapshot_offset_hours ?? 2) * 3600_000;
  const dryRun = !!body.dry_run;

  const sports = Object.entries(SPORT_MARKETS).filter(([k]) => !sportsFilter || sportsFilter.includes(k));
  const perSport: Record<string, { events: number; rows: number; markets: Set<string> }> = {};
  const allRows: any[] = [];
  let creditsApprox = 0;

  for (const [sportKey, cfg] of sports) {
    perSport[cfg.canonical] = { events: 0, rows: 0, markets: new Set() };
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const dayIso = isoDay(cursor);
      try {
        // Historical events index for the day @ noon UTC
        const evUrl = `${ODDS_BASE}/historical/sports/${sportKey}/events?apiKey=${apiKey}&date=${dayIso}T12:00:00Z`;
        const evR = await fetch(evUrl);
        if (!evR.ok) {
          log(`${sportKey} ${dayIso} events ${evR.status}`);
        } else {
          const evJ = await evR.json();
          const events: OddsEvent[] = (evJ.data ?? evJ ?? []) as OddsEvent[];
          creditsApprox += 1;
          const dayEvents = events.filter(e => etDate(new Date(e.commence_time)) === dayIso).slice(0, maxEventsPerDay);
          perSport[cfg.canonical].events += dayEvents.length;

          for (const event of dayEvents) {
            if (dryRun) continue;
            const tip = new Date(event.commence_time).getTime();
            // The Odds API requires historical snapshot timestamps to land on
            // recorded 5-minute boundaries. Snap down to the nearest 5 min.
            const snapMs = Math.floor((tip - snapshotOffsetMs) / 300_000) * 300_000;
            const snapTs = new Date(snapMs).toISOString();
            const markets = cfg.markets.join(",");
            const oddsUrl = `${ODDS_BASE}/historical/sports/${sportKey}/events/${event.id}/odds`
              + `?apiKey=${apiKey}&date=${snapTs}`
              + `&regions=us&markets=${markets}&oddsFormat=american`;
            const r = await fetch(oddsUrl);
            creditsApprox += cfg.markets.length * 10;
            if (!r.ok) {
              const txt = await r.text().catch(() => "");
              log(`  ${sportKey} ${event.id} odds ${r.status} ${txt.slice(0, 200)}`);
              await sleep(120); continue;
            }
            const payload = await r.json();
            const data = payload?.data ?? payload;
            const gameDesc = `${event.away_team} vs ${event.home_team}`;
            const bookmakers = (data?.bookmakers ?? []).filter((b: any) => PREFERRED_BOOKS.includes(b.key));
            for (const book of bookmakers) {
              for (const market of book.markets ?? []) {
                const marketKey: string = market.key;
                const outcomes: Outcome[] = market.outcomes ?? [];
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
                    is_active: false, // historical snapshot, not a live line
                    updated_at: new Date().toISOString(),
                  });
                }
              }
            }
            await sleep(120);
          }
        }
      } catch (e) {
        log(`${sportKey} ${dayIso} error: ${(e as Error).message}`);
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  // Dedup: keep highest-ranked book per (sport,player,prop,line)
  const bookRank = new Map(PREFERRED_BOOKS.map((b, i) => [b, i]));
  const best = new Map<string, any>();
  for (const r of allRows) {
    const k = `${r.event_id}|${r.player_name}|${r.prop_type}|${r.bookmaker}`;
    const prev = best.get(k);
    if (!prev || (bookRank.get(r.bookmaker) ?? 99) < (bookRank.get(prev.bookmaker) ?? 99)) best.set(k, r);
  }
  const dedup = [...best.values()];

  let written = 0;
  const errors: string[] = [];
  if (!dryRun && dedup.length) {
    for (let i = 0; i < dedup.length; i += 500) {
      const batch = dedup.slice(i, i + 500);
      const { error, count } = await supabase
        .from("unified_props")
        .upsert(batch, {
          onConflict: "event_id,player_name,prop_type,bookmaker",
          ignoreDuplicates: false,
          count: "exact",
        });
      if (error) {
        const msg = `batch ${i}-${i + batch.length}: ${error.message}`;
        log(`upsert failed: ${msg}`);
        errors.push(msg);
        continue;
      }
      written += count ?? batch.length;
    }
  }

  const summary = Object.fromEntries(Object.entries(perSport).map(([k, v]) =>
    [k, { events: v.events, rows: v.rows, markets: [...v.markets] }]));

  return new Response(JSON.stringify({
    success: errors.length === 0,
    dry_run: dryRun,
    window: { start: isoDay(startDate), end: isoDay(endDate) },
    sports: sports.map(([k]) => k),
    total_rows: allRows.length,
    deduped: dedup.length,
    written,
    credits_approx: creditsApprox,
    errors,
    per_sport: summary,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});