// Nuke Backtest Phase 1 — pulls historical games + closing prop lines from
// The Odds API and stores them in nuke_historical_games / nuke_historical_props.
// Then settles results from existing tables + ESPN scoreboard.
//
// POST { days_back?: number, sports?: string[], settle_only?: boolean }
// sports keys: "nba" | "mlb" | "soccer_epl" | "soccer_ucl" | "soccer_mls" | "tennis_atp" | "tennis_wta"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SPORT_KEY_MAP: Record<string, { apiKey: string; sport: "nba" | "mlb" | "soccer" | "tennis"; markets: string[] }> = {
  nba:        { apiKey: "basketball_nba",            sport: "nba",    markets: ["player_points", "player_points_rebounds_assists", "player_threes"] },
  mlb:        { apiKey: "baseball_mlb",              sport: "mlb",    markets: ["pitcher_strikeouts", "pitcher_outs", "batter_total_bases", "batter_hits", "batter_home_runs"] },
  soccer_epl: { apiKey: "soccer_epl",                sport: "soccer", markets: ["player_shots_on_goal", "player_shots", "player_passes_attempted", "player_saves"] },
  soccer_ucl: { apiKey: "soccer_uefa_champs_league", sport: "soccer", markets: ["player_shots_on_goal", "player_shots", "player_passes_attempted", "player_saves"] },
  soccer_mls: { apiKey: "soccer_usa_mls",            sport: "soccer", markets: ["player_shots_on_goal", "player_shots", "player_passes_attempted", "player_saves"] },
  tennis_atp: { apiKey: "tennis_atp",                sport: "tennis", markets: ["player_aces", "player_double_faults", "player_total_games_won"] },
  tennis_wta: { apiKey: "tennis_wta",                sport: "tennis", markets: ["player_aces", "player_double_faults", "player_total_games_won"] },
};

const ODDS_BASE = "https://api.the-odds-api.com/v4";
const BOOK = "fanduel";

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function snapshotIso(commenceISO: string, hoursBefore = 1): string {
  const t = new Date(commenceISO).getTime() - hoursBefore * 3600_000;
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function fetchJson(url: string): Promise<{ status: number; body: any; remaining?: string }> {
  const r = await fetch(url);
  const remaining = r.headers.get("x-requests-remaining") ?? undefined;
  let body: any = null;
  try { body = await r.json(); } catch { /* ignore */ }
  return { status: r.status, body, remaining };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const apiKey = Deno.env.get("THE_ODDS_API_KEY") || Deno.env.get("ODDS_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: "missing THE_ODDS_API_KEY" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const daysBack = Math.max(1, Math.min(120, Number(body.days_back ?? 30)));
  const requestedSports: string[] = Array.isArray(body.sports) && body.sports.length
    ? body.sports
    : ["nba", "mlb", "soccer_epl", "tennis_atp"];
  const settleOnly: boolean = body.settle_only === true;
  const maxCredits: number = Number(body.max_credits ?? 1500);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const summary: Record<string, any> = {};
  let creditsSpent = 0;
  const startCredits = await fetchJson(`${ODDS_BASE}/sports?apiKey=${apiKey}`);
  const initialRemaining = startCredits.remaining ? Number(startCredits.remaining) : null;

  for (const key of requestedSports) {
    const cfg = SPORT_KEY_MAP[key];
    if (!cfg) { summary[key] = { error: "unknown_sport_key" }; continue; }
    const stat: any = { games_inserted: 0, props_inserted: 0, days: 0, errors: [] };

    if (!settleOnly) {
      // Walk back day-by-day, pull events list per day at noon UTC snapshot.
      for (let i = 1; i <= daysBack; i++) {
        if (creditsSpent >= maxCredits) { stat.errors.push("credits_cap_reached"); break; }
        const d = new Date(Date.now() - i * 86400_000);
        const dayStr = isoDay(d);
        const probeISO = `${dayStr}T12:00:00Z`;

        const eventsURL = `${ODDS_BASE}/historical/sports/${cfg.apiKey}/events?apiKey=${apiKey}&date=${probeISO}`;
        const ev = await fetchJson(eventsURL);
        creditsSpent++;
        if (ev.status !== 200 || !Array.isArray(ev.body?.data)) {
          stat.errors.push({ day: dayStr, stage: "events", status: ev.status });
          continue;
        }
        const events: any[] = ev.body.data;
        const eventsToday = events.filter((e: any) => {
          const t = new Date(e.commence_time).getTime();
          const dayStart = Date.parse(`${dayStr}T00:00:00Z`);
          return t >= dayStart && t < dayStart + 86400_000;
        });
        stat.days++;

        for (const e of eventsToday) {
          if (creditsSpent >= maxCredits) break;
          const snap = snapshotIso(e.commence_time, 1);
          const oddsURL = `${ODDS_BASE}/historical/sports/${cfg.apiKey}/events/${e.id}/odds?apiKey=${apiKey}&regions=us&bookmakers=${BOOK}&markets=${["spreads", "totals", "h2h", ...cfg.markets].join(",")}&oddsFormat=american&date=${snap}`;
          const od = await fetchJson(oddsURL);
          creditsSpent += 10; // historical odds = 10 credits
          if (od.status !== 200 || !od.body?.data) {
            stat.errors.push({ event_id: e.id, status: od.status });
            continue;
          }
          const data = od.body.data;
          const fd = (data.bookmakers ?? []).find((b: any) => b.key === BOOK);
          if (!fd) continue;

          // Game-level lines
          const spreadsMkt = fd.markets.find((m: any) => m.key === "spreads");
          const totalsMkt = fd.markets.find((m: any) => m.key === "totals");
          const h2hMkt = fd.markets.find((m: any) => m.key === "h2h");
          const home = data.home_team ?? e.home_team;
          const away = data.away_team ?? e.away_team;

          let spread: number | null = null;
          if (spreadsMkt) {
            const homeOut = spreadsMkt.outcomes.find((o: any) => o.name === home);
            spread = homeOut ? Number(homeOut.point) : null;
          }
          const total = totalsMkt?.outcomes?.[0]?.point ?? null;
          let mlHome: number | null = null, mlAway: number | null = null;
          if (h2hMkt) {
            const ho = h2hMkt.outcomes.find((o: any) => o.name === home);
            const ao = h2hMkt.outcomes.find((o: any) => o.name === away);
            mlHome = ho ? Math.round(Number(ho.price)) : null;
            mlAway = ao ? Math.round(Number(ao.price)) : null;
          }

          const { data: upGame, error: gErr } = await sb.from("nuke_historical_games").upsert({
            sport: cfg.sport,
            game_date: dayStr,
            external_id: e.id,
            home, away,
            spread, total,
            ml_home: mlHome, ml_away: mlAway,
            closing_snapshot_ts: snap,
          }, { onConflict: "sport,game_date,home,away" }).select("id").single();
          if (gErr || !upGame) { stat.errors.push({ event_id: e.id, stage: "upsert_game", err: String(gErr) }); continue; }
          stat.games_inserted++;

          // Player props
          const propRows: any[] = [];
          for (const mkt of fd.markets) {
            if (!cfg.markets.includes(mkt.key)) continue;
            for (const o of mkt.outcomes ?? []) {
              const player = o.description ?? o.name;
              const side = String(o.name).toLowerCase().includes("under") ? "under" : "over";
              if (player == null || o.point == null || o.price == null) continue;
              propRows.push({
                game_id: upGame.id,
                player,
                prop_type: mkt.key,
                side,
                line: Number(o.point),
                price: Math.round(Number(o.price)),
                book: BOOK,
                snapshot_ts: snap,
              });
            }
          }
          if (propRows.length) {
            const { error: pErr } = await sb.from("nuke_historical_props").insert(propRows);
            if (pErr) stat.errors.push({ event_id: e.id, stage: "insert_props", err: String(pErr) });
            else stat.props_inserted += propRows.length;
          }
        }
      }
    }

    // ── Settle scores from Odds API /scores (free, last 3 days) + historical scores
    try {
      const scoresURL = `${ODDS_BASE}/sports/${cfg.apiKey}/scores?apiKey=${apiKey}&daysFrom=3`;
      const sc = await fetchJson(scoresURL);
      if (sc.status === 200 && Array.isArray(sc.body)) {
        for (const g of sc.body) {
          if (!g.completed || !g.scores) continue;
          const home = g.home_team, away = g.away_team;
          const homeScore = Number(g.scores.find((s: any) => s.name === home)?.score ?? NaN);
          const awayScore = Number(g.scores.find((s: any) => s.name === away)?.score ?? NaN);
          if (isNaN(homeScore) || isNaN(awayScore)) continue;
          await sb.from("nuke_historical_games")
            .update({ actual_home_score: homeScore, actual_away_score: awayScore, settled: true })
            .eq("sport", cfg.sport).eq("home", home).eq("away", away);
        }
      }
    } catch (e) {
      stat.errors.push({ stage: "settle_scores", err: String(e) });
    }

    summary[key] = { ...stat, credits_spent_so_far: creditsSpent };
  }

  return new Response(JSON.stringify({
    ok: true,
    days_back: daysBack,
    credits_spent_estimate: creditsSpent,
    api_credits_remaining: initialRemaining,
    summary,
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});