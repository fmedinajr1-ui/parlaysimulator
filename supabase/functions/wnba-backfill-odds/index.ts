// WNBA historical odds backfill via The Odds API v4 historical endpoints.
// Idempotent: upserts on the wnba_historical_odds_snapshots composite unique index.
//
// Trigger:
//   POST /functions/v1/wnba-backfill-odds
//   body: {
//     "start": "2024-05-14",
//     "end":   "2024-10-20",
//     "snapshots": ["t-2h"],            // subset of ["t-24h","t-2h","t-30m"]
//     "markets":   ["player_points","player_rebounds","player_assists","totals","h2h"],
//     "max_events": 500
//   }
//
// COST WARNING: The Odds API historical = 10 credits per market per snapshot per event.
// Defaults are conservative; expand only when you have budget headroom.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const ODDS_API_KEY = Deno.env.get("THE_ODDS_API_KEY")!;
const ODDS_BASE    = "https://api.the-odds-api.com/v4";
const SPORT_KEY    = "basketball_wnba";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SNAPSHOT_OFFSETS_MS: Record<string, number> = {
  "t-24h": 24 * 3600_000,
  "t-2h":   2 * 3600_000,
  "t-30m":  30 * 60_000,
};

function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function listEventsForDay(dayIso: string): Promise<any[]> {
  // historical events index for the day at midday UTC — cheap (1 credit/event)
  const date = `${dayIso}T12:00:00Z`;
  const url = `${ODDS_BASE}/historical/sports/${SPORT_KEY}/events?apiKey=${ODDS_API_KEY}&date=${date}`;
  const r = await fetch(url);
  if (!r.ok) {
    console.warn(`[wnba-odds] events list ${dayIso} -> ${r.status}`);
    return [];
  }
  const j = await r.json();
  return (j.data ?? j ?? []) as any[];
}

async function fetchEventOdds(eventId: string, dateIso: string, markets: string[]) {
  const url = `${ODDS_BASE}/historical/sports/${SPORT_KEY}/events/${eventId}/odds`
    + `?apiKey=${ODDS_API_KEY}&date=${dateIso}`
    + `&regions=us&bookmakers=fanduel&oddsFormat=american`
    + `&markets=${markets.join(",")}`;
  const r = await fetch(url);
  if (!r.ok) {
    console.warn(`[wnba-odds] odds ${eventId} ${dateIso} -> ${r.status}`);
    return null;
  }
  return await r.json();
}

function gameDateEt(iso: string): string {
  return new Date(new Date(iso).getTime() - 4 * 3600_000).toISOString().slice(0, 10);
}

function rowsFromOddsPayload(payload: any, snapshotTag: string, snapshotTs: string): any[] {
  const data = payload?.data ?? payload;
  if (!data) return [];
  const eventId = data.id;
  const home = data.home_team;
  const away = data.away_team;
  const commenceTime = data.commence_time;
  const gameDate = gameDateEt(commenceTime);
  const out: any[] = [];
  for (const bk of (data.bookmakers ?? [])) {
    if (bk.key !== "fanduel") continue;
    for (const mk of (bk.markets ?? [])) {
      for (const oc of (mk.outcomes ?? [])) {
        out.push({
          event_id: eventId,
          game_start_ts: commenceTime,
          game_date_et: gameDate,
          home_team: home,
          away_team: away,
          market: mk.key,
          player_name: oc.description ?? null, // player props put player in `description`
          line: oc.point ?? null,
          side: String(oc.name ?? "").toLowerCase(),
          price: Number(oc.price),
          snapshot_ts: snapshotTs,
          snapshot_tag: snapshotTag,
          bookmaker: "fanduel",
        });
      }
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!ODDS_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "THE_ODDS_API_KEY not set" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  const start = new Date(body.start ?? "2024-05-14");
  const end   = new Date(body.end   ?? "2024-10-20");
  const snapshots: string[] = (body.snapshots ?? ["t-2h"]).filter((s: string) => s in SNAPSHOT_OFFSETS_MS);
  const markets: string[]   = body.markets ?? ["player_points","player_rebounds","player_assists","totals","h2h"];
  const maxEvents = Number(body.max_events ?? 500);
  const dryRun = !!body.dry_run;

  const cost_per_event = markets.length * snapshots.length * 10; // approximate credit cost

  let eventsSeen = 0;
  let eventsPriced = 0;
  let rowsUpserted = 0;
  let failed = 0;
  let creditsApprox = 0;

  const dayCursor = new Date(start);
  while (dayCursor <= end && eventsPriced < maxEvents) {
    const dayIso = isoDay(dayCursor);
    try {
      const events = await listEventsForDay(dayIso);
      eventsSeen += events.length;
      creditsApprox += events.length; // events index ~1 credit/event
      for (const ev of events) {
        if (eventsPriced >= maxEvents) break;
        const commenceTime = ev.commence_time;
        if (!commenceTime) continue;
        const tip = new Date(commenceTime).getTime();
        if (dryRun) { eventsPriced += 1; creditsApprox += cost_per_event; continue; }

        for (const snap of snapshots) {
          const snapTs = new Date(tip - SNAPSHOT_OFFSETS_MS[snap]).toISOString();
          try {
            const payload = await fetchEventOdds(ev.id, snapTs, markets);
            if (!payload) { failed += 1; continue; }
            const rows = rowsFromOddsPayload(payload, snap, snapTs);
            if (rows.length > 0) {
              const { error } = await sb.from("wnba_historical_odds_snapshots")
                .upsert(rows, { onConflict: "event_id,market,player_name,line,side,snapshot_tag", ignoreDuplicates: false });
              if (error) {
                console.warn(`[wnba-odds] upsert err event=${ev.id} snap=${snap}:`, error.message);
                failed += 1;
              } else {
                rowsUpserted += rows.length;
              }
            }
            creditsApprox += markets.length * 10;
            await sleep(120);
          } catch (e) {
            failed += 1;
            console.warn(`[wnba-odds] fetch err ${ev.id} ${snap}:`, (e as Error).message);
          }
        }
        eventsPriced += 1;
      }
    } catch (e) {
      console.warn(`[wnba-odds] day ${dayIso} err:`, (e as Error).message);
    }
    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
  }

  return new Response(JSON.stringify({
    ok: true,
    dry_run: dryRun,
    start: isoDay(start),
    end: isoDay(end),
    snapshots,
    markets,
    events_seen: eventsSeen,
    events_priced: eventsPriced,
    rows_upserted: rowsUpserted,
    failed,
    credits_approx: creditsApprox,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});