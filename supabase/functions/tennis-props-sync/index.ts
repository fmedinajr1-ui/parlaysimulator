import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// tennis-props-sync (v3 — The Odds API direct scrape + game_bets fallback)
//
// PrizePicks is permanently 403-blocked from edge functions. This version
// scrapes tennis player props directly from The Odds API for ATP/WTA events,
// then falls back to syncing match totals from game_bets.
//
// Also runs self-healing: updates tennis_player_stats from settled results.
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function normName(s: string): string {
  return (s || "").toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

const ODDS_API_BASE = "https://api.the-odds-api.com/v4/sports";

// Player prop markets to request
const PLAYER_PROP_MARKETS = [
  "player_total_games",
  "player_games_won", 
  "player_total_sets",
  "alternate_total_games",
].join(",");

// Match-level total markets (fallback from game_bets)
const MATCH_TOTAL_MARKETS = ["totals", "total", "total_games"].join(",");

interface OddsApiEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
  description?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const log = (msg: string) => console.log(`[tennis-props-sync] ${msg}`);
  const now = new Date();
  const today = getEasternDate();
  const apiKey = Deno.env.get("THE_ODDS_API_KEY");

  try {
    log(`=== Tennis Props Sync v3 — ${today} ===`);

    let totalSynced = 0;
    const propTypesWritten = new Set<string>();
    const sportKeysSeen = new Set<string>();
    const allRows: any[] = [];

    // ── Part 1: Scrape The Odds API for player props ──────────────────
    // Dynamically discover ALL active tennis sport keys (API uses tournament-specific keys
    // like "tennis_atp_monte_carlo_masters", not generic "tennis_atp")
    let tennisSportKeys: string[] = [];
    if (apiKey) {
      try {
        const sportsRes = await fetch(`${ODDS_API_BASE}?apiKey=${apiKey}`);
        if (sportsRes.ok) {
          const allSports = await sportsRes.json();
          tennisSportKeys = allSports
            .filter((s: any) => s.active && (
              s.key?.toLowerCase().includes("tennis") ||
              s.group?.toLowerCase().includes("tennis")
            ))
            .map((s: any) => s.key);
          log(`Discovered ${tennisSportKeys.length} active tennis sports: ${tennisSportKeys.join(", ")}`);
        } else {
          const txt = await sportsRes.text();
          log(`Sports discovery failed: ${sportsRes.status} — ${txt.slice(0, 100)}`);
        }
      } catch (e: any) {
        log(`Sports discovery error: ${e.message}`);
      }
    }

    if (apiKey && tennisSportKeys.length > 0) {
      for (const sportKey of tennisSportKeys) {
        try {
          // Step 1: Get today's events
          const eventsUrl = `${ODDS_API_BASE}/${sportKey}/events?apiKey=${apiKey}`;
          const eventsRes = await fetch(eventsUrl);
          if (!eventsRes.ok) {
            const txt = await eventsRes.text();
            log(`${sportKey} events: ${eventsRes.status} — ${txt.slice(0, 100)}`);
            continue;
          }
          const events: OddsApiEvent[] = await eventsRes.json();

          // Filter to today's events (ET)
          const todayEvents = events.filter(e => {
            const etDate = new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/New_York",
              year: "numeric", month: "2-digit", day: "2-digit",
            }).format(new Date(e.commence_time));
            return etDate === today;
          });

          log(`${sportKey}: ${todayEvents.length}/${events.length} events today`);
          if (todayEvents.length === 0) continue;

          sportKeysSeen.add(sportKey);

          // Step 2: Fetch props for each event (batch max 5 to conserve API calls)
          const eventsToFetch = todayEvents.slice(0, 8);
          for (const event of eventsToFetch) {
            try {
              const oddsUrl = `${ODDS_API_BASE}/${sportKey}/events/${event.id}/odds?apiKey=${apiKey}&regions=us,us2,eu&markets=${PLAYER_PROP_MARKETS},${MATCH_TOTAL_MARKETS}&oddsFormat=american`;
              const oddsRes = await fetch(oddsUrl);
              if (!oddsRes.ok) {
                const txt = await oddsRes.text();
                log(`  ${event.away_team} vs ${event.home_team}: odds ${oddsRes.status} — ${txt.slice(0, 80)}`);
                continue;
              }

              const oddsData = await oddsRes.json();
              const bookmakers = oddsData.bookmakers || [];
              const gameDesc = `${event.away_team} vs ${event.home_team}`;

              for (const book of bookmakers) {
                for (const market of book.markets || []) {
                  const marketKey = market.key as string;
                  // Group outcomes into over/under pairs
                  const outcomes: OddsApiOutcome[] = market.outcomes || [];

                  // Player props: each outcome has a description (player name) + name (Over/Under) + point
                  if (marketKey.includes("player_")) {
                    // Group by player+point
                    const groups = new Map<string, { over?: OddsApiOutcome; under?: OddsApiOutcome }>();
                    for (const o of outcomes) {
                      const key = `${o.description || o.name}|${o.point ?? 0}`;
                      if (!groups.has(key)) groups.set(key, {});
                      const g = groups.get(key)!;
                      if (o.name === "Over") g.over = o;
                      else if (o.name === "Under") g.under = o;
                    }

                    for (const [groupKey, g] of groups) {
                      const playerName = groupKey.split("|")[0];
                      const line = g.over?.point ?? g.under?.point;
                      if (!line || !playerName) continue;

                      const propType = marketKey; // e.g. "player_total_games"
                      propTypesWritten.add(propType);

                      allRows.push({
                        event_id: event.id,
                        sport: sportKey.includes("wta") ? "tennis_wta" : "tennis_atp",
                        game_description: gameDesc,
                        commence_time: event.commence_time,
                        player_name: playerName,
                        prop_type: propType,
                        bookmaker: book.key,
                        current_line: line,
                        over_price: g.over?.price ?? -110,
                        under_price: g.under?.price ?? -110,
                        is_active: true,
                        updated_at: new Date().toISOString(),
                      });
                    }
                  } else {
                    // Match-level totals (Over/Under on total games)
                    const overOutcome = outcomes.find(o => o.name === "Over");
                    const underOutcome = outcomes.find(o => o.name === "Under");
                    const line = overOutcome?.point ?? underOutcome?.point;
                    if (!line) continue;

                    propTypesWritten.add("total_games");

                    allRows.push({
                      event_id: event.id,
                      sport: sportKey.includes("wta") ? "tennis_wta" : "tennis_atp",
                      game_description: gameDesc,
                      commence_time: event.commence_time,
                      player_name: gameDesc,
                      prop_type: "total_games",
                      bookmaker: book.key,
                      current_line: line,
                      over_price: overOutcome?.price ?? -110,
                      under_price: underOutcome?.price ?? -110,
                      is_active: true,
                      updated_at: new Date().toISOString(),
                    });
                  }
                }
              }
            } catch (eventErr: any) {
              log(`  Event error ${event.id}: ${eventErr.message}`);
            }
          }
        } catch (sportErr: any) {
          log(`Sport ${sportKey} error: ${sportErr.message}`);
        }
      }

      log(`Odds API scraped: ${allRows.length} prop lines across ${sportKeysSeen.size} sports`);
    } else if (!apiKey) {
      log("⚠ THE_ODDS_API_KEY not set — skipping direct scrape");
    } else {
      log("No active tennis sports found on Odds API today");
    }

    // ── Part 2: Fallback — sync tennis totals from game_bets ────────────
    const { data: gameBets } = await supabase
      .from("game_bets")
      .select("*")
      .or("sport.ilike.%tennis%,sport.ilike.%atp%,sport.ilike.%wta%")
      .eq("bet_type", "total")
      .gte("commence_time", `${today}T00:00:00`);

    if (gameBets && gameBets.length > 0) {
      log(`game_bets fallback: ${gameBets.length} tennis totals`);
      for (const b of gameBets) {
        const line = Number(b.line);
        if (!line || line < 10 || line > 60) continue;

        const sportKey = (b.sport || "").toLowerCase().includes("wta") ? "tennis_wta" : "tennis_atp";
        const desc = `${b.away_team} vs ${b.home_team}`;

        allRows.push({
          event_id: b.game_id || `tennis_${b.home_team}_${b.away_team}_${today}`,
          sport: sportKey,
          game_description: desc,
          commence_time: b.commence_time,
          player_name: desc,
          prop_type: "total_games",
          bookmaker: b.bookmaker || "consensus",
          current_line: line,
          over_price: b.over_odds || -110,
          under_price: b.under_odds || -110,
          is_active: true,
          updated_at: new Date().toISOString(),
        });
        propTypesWritten.add("total_games");
        sportKeysSeen.add(sportKey);
      }
    }

    // ── Part 3: Deduplicate and upsert ──────────────────────────────────
    const seen = new Map<string, any>();
    for (const row of allRows) {
      const key = `${row.event_id}|${row.player_name}|${row.prop_type}|${row.bookmaker}`;
      if (!seen.has(key)) seen.set(key, row);
    }
    const uniqueRows = [...seen.values()];

    if (uniqueRows.length > 0) {
      // Batch upsert in chunks of 200
      for (let i = 0; i < uniqueRows.length; i += 200) {
        const chunk = uniqueRows.slice(i, i + 200);
        const { error: upsertErr } = await supabase
          .from("unified_props")
          .upsert(chunk, { onConflict: "event_id,player_name,prop_type,bookmaker" });
        if (upsertErr) log(`⚠ Upsert error (chunk ${i}): ${upsertErr.message}`);
      }
      totalSynced = uniqueRows.length;
      log(`✅ Synced ${totalSynced} tennis props to unified_props`);
    } else {
      log("No tennis props to sync today");
    }

    // ── Part 4: Self-healing — update tennis_player_stats from settled results ─
    const { data: settledPicks } = await supabase
      .from("tennis_match_model")
      .select("player_a, player_b, tour, surface, actual_total_games, outcome, settled_at")
      .not("outcome", "is", null)
      .not("actual_total_games", "is", null)
      .gte("analysis_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]);

    if (settledPicks && settledPicks.length > 0) {
      // Build per-player avg games from history
      const playerGames = new Map<string, number[]>();
      for (const pick of settledPicks) {
        const games = Number(pick.actual_total_games);
        if (!games) continue;
        for (const name of [pick.player_a, pick.player_b]) {
          if (!name) continue;
          const key = normName(name);
          if (!playerGames.has(key)) playerGames.set(key, []);
          playerGames.get(key)!.push(games);
        }
      }

      // Update stats for players with 3+ settled matches
      let statsUpdated = 0;
      for (const [playerKey, gamesList] of playerGames) {
        if (gamesList.length < 3) continue;
        const l10 = gamesList.slice(-10);
        const l5 = gamesList.slice(-5);
        const avgL10 = l10.reduce((a, b) => a + b, 0) / l10.length;
        const avgL5 = l5.reduce((a, b) => a + b, 0) / l5.length;

        await supabase
          .from("tennis_player_stats")
          .upsert({
            player_name: playerKey,
            surface: "all",
            avg_games_l10: Math.round(avgL10 * 10) / 10,
            avg_games_l5: Math.round(avgL5 * 10) / 10,
            updated_at: new Date().toISOString(),
          }, { onConflict: "player_name,surface" }).then(() => statsUpdated++);
      }
      log(`Self-healing: updated ${statsUpdated} player stats`);
    }

    // ── Part 5: Telegram ───────────────────────────────────────────────
    const propBreakdown: Record<string, number> = {};
    for (const r of uniqueRows) propBreakdown[r.prop_type] = (propBreakdown[r.prop_type] || 0) + 1;

    const telegramLines = [
      `🎾 *Tennis Props Sync v3 — ${today}*`,
      `Synced: ${totalSynced} props to unified_props`,
      `Sports: ${[...sportKeysSeen].join(", ") || "none"}`,
      `Prop types: ${[...propTypesWritten].join(", ") || "none"}`,
      `Sources: ${apiKey ? "Odds API" : "⚠ no API key"} + game_bets (${gameBets?.length || 0})`,
    ];
    if (Object.keys(propBreakdown).length > 0) {
      telegramLines.push("", "📊 *Breakdown:*");
      for (const [pt, count] of Object.entries(propBreakdown)) {
        telegramLines.push(`• ${pt}: ${count}`);
      }
    }
    await supabase.functions.invoke("bot-send-telegram", {
      body: { message: telegramLines.join("\n"), parse_mode: "Markdown", admin_only: true },
    }).catch(() => {});

    const result = {
      success: true,
      synced: totalSynced,
      sport_keys: [...sportKeysSeen],
      prop_types: [...propTypesWritten],
      prop_breakdown: propBreakdown,
      game_bets_fallback: gameBets?.length || 0,
    };

    await supabase.from("cron_job_history").insert({
      job_name: "tennis-props-sync", status: "completed",
      started_at: now.toISOString(), completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(), result,
    });

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
