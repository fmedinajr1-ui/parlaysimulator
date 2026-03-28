import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// All prop markets per sport
const PROP_MARKETS: Record<string, string[][]> = {
  basketball_nba: [
    ["player_points", "player_rebounds", "player_assists"],
    ["player_threes", "player_blocks", "player_steals"],
    ["player_points_rebounds_assists", "player_points_rebounds", "player_points_assists", "player_rebounds_assists"],
  ],
  icehockey_nhl: [
    ["player_points", "player_assists", "player_goals"],
    ["player_shots_on_goal", "player_saves"],
  ],
  baseball_mlb: [
    ["batter_hits", "batter_rbis", "batter_runs_scored", "batter_total_bases"],
    ["batter_home_runs", "batter_stolen_bases", "pitcher_strikeouts", "pitcher_outs"],
  ],
};

const SPORT_KEYS = ["basketball_nba", "icehockey_nhl", "baseball_mlb"];

interface TimelineRow {
  sport: string;
  event_id: string;
  player_name: string;
  prop_type: string;
  line: number;
  over_price: number | null;
  under_price: number | null;
  snapshot_phase: string;
  snapshot_time: string;
  hours_to_tip: number | null;
  line_change_from_open: number;
  price_change_from_open: number;
  drift_velocity: number;
  opening_line: number | null;
  opening_over_price: number | null;
  opening_under_price: number | null;
  event_description: string;
  commence_time: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("THE_ODDS_API_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const log = (msg: string) => console.log(`[FanDuel Scanner] ${msg}`);
  const now = new Date();
  const nowISO = now.toISOString();

  // Determine snapshot phase based on ET time
  const etHour = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" })).getHours();
  const getPhase = (hoursToTip: number | null): string => {
    if (hoursToTip !== null && hoursToTip <= 0) return "live";
    if (etHour < 12) return "morning_open";
    if (etHour < 16) return "midday";
    if (hoursToTip !== null && hoursToTip <= 1) return "pre_tip";
    return "midday";
  };

  try {
    log("=== Starting 5-min FanDuel line scan ===");

    let totalSnapshots = 0;
    let totalApiCalls = 0;
    const sportSummary: Record<string, number> = {};

    for (const sportKey of SPORT_KEYS) {
      const sportLabel = sportKey.split("_").pop()?.toUpperCase() || sportKey;

      // 1. Fetch today's events for this sport
      const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events?apiKey=${apiKey}&dateFormat=iso`;
      const eventsResp = await fetch(eventsUrl);
      totalApiCalls++;

      if (!eventsResp.ok) {
        log(`⚠ ${sportLabel} events fetch failed: ${eventsResp.status}`);
        await eventsResp.text();
        continue;
      }

      const events = await eventsResp.json();
      // Filter to games within next 24 hours
      const upcomingEvents = events.filter((e: any) => {
        const tip = new Date(e.commence_time);
        const hoursAway = (tip.getTime() - now.getTime()) / (1000 * 60 * 60);
        return hoursAway > -3 && hoursAway < 24; // Include live games (up to 3h ago)
      });

      if (upcomingEvents.length === 0) {
        log(`${sportLabel}: No upcoming events`);
        continue;
      }

      log(`${sportLabel}: ${upcomingEvents.length} events found`);

      // Build event map for descriptions/times
      const eventMap = new Map<string, any>();
      for (const e of upcomingEvents) {
        eventMap.set(e.id, e);
      }
      const eventIds = upcomingEvents.map((e: any) => e.id);

      // 2. Fetch existing opening lines for today (to compute drift)
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const { data: existingOpenings } = await supabase
        .from("fanduel_line_timeline")
        .select("event_id, player_name, prop_type, line, over_price, under_price")
        .in("event_id", eventIds)
        .eq("snapshot_phase", "morning_open")
        .gte("created_at", todayStart.toISOString())
        .limit(1000);

      // Build opening line lookup
      const openingMap = new Map<string, { line: number; over: number | null; under: number | null }>();
      for (const o of existingOpenings || []) {
        const key = `${o.event_id}|${o.player_name}|${o.prop_type}`;
        if (!openingMap.has(key)) {
          openingMap.set(key, { line: o.line, over: o.over_price, under: o.under_price });
        }
      }

      // 3. Fetch prop markets from FanDuel
      const batches = PROP_MARKETS[sportKey] || [];
      const rows: TimelineRow[] = [];

      for (const batch of batches) {
        const marketsParam = batch.join(",");
        const propsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventIds[0]}/odds?apiKey=${apiKey}&regions=us&markets=${marketsParam}&bookmakers=fanduel&oddsFormat=american`;

        // For efficiency, use the odds endpoint per-event for first few events, batch for rest
        for (const eventId of eventIds) {
          const url = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventId}/odds?apiKey=${apiKey}&regions=us&markets=${marketsParam}&bookmakers=fanduel&oddsFormat=american`;

          try {
            const resp = await fetch(url);
            totalApiCalls++;

            if (!resp.ok) {
              if (resp.status === 422) {
                // Market not available for this event
                await resp.text();
                continue;
              }
              log(`⚠ ${sportLabel} props ${eventId} status ${resp.status}`);
              await resp.text();
              continue;
            }

            const data = await resp.json();
            const eventInfo = eventMap.get(eventId);
            const commenceTime = eventInfo?.commence_time;
            const description = eventInfo ? `${eventInfo.away_team} @ ${eventInfo.home_team}` : eventId;
            const tipTime = commenceTime ? new Date(commenceTime) : null;
            const hoursToTip = tipTime ? (tipTime.getTime() - now.getTime()) / (1000 * 60 * 60) : null;
            const phase = getPhase(hoursToTip);

            // Parse FanDuel bookmaker data
            const fanduel = data.bookmakers?.find((b: any) => b.key === "fanduel");
            if (!fanduel) continue;

            for (const market of fanduel.markets || []) {
              // Group outcomes by player (description field)
              const playerOutcomes = new Map<string, { over: any; under: any }>();

              for (const outcome of market.outcomes || []) {
                const playerName = outcome.description || outcome.name;
                if (!playerOutcomes.has(playerName)) {
                  playerOutcomes.set(playerName, { over: null, under: null });
                }
                const entry = playerOutcomes.get(playerName)!;
                if (outcome.name === "Over") entry.over = outcome;
                else if (outcome.name === "Under") entry.under = outcome;
              }

              for (const [playerName, sides] of playerOutcomes) {
                const line = sides.over?.point ?? sides.under?.point;
                if (line === undefined || line === null) continue;

                const overPrice = sides.over?.price ?? null;
                const underPrice = sides.under?.price ?? null;
                const key = `${eventId}|${playerName}|${market.key}`;
                const opening = openingMap.get(key);

                const lineChange = opening ? line - opening.line : 0;
                const priceChange = opening && overPrice && opening.over
                  ? overPrice - opening.over : 0;

                // Compute drift velocity (points per hour since opening)
                // For first snapshot, velocity is 0
                let driftVelocity = 0;
                if (opening && lineChange !== 0) {
                  // Rough estimate: hours since market open (assume 10 AM ET)
                  const hoursSinceOpen = Math.max(1, etHour - 10);
                  driftVelocity = Math.round((lineChange / hoursSinceOpen) * 100) / 100;
                }

                rows.push({
                  sport: sportLabel,
                  event_id: eventId,
                  player_name: playerName,
                  prop_type: market.key,
                  line,
                  over_price: overPrice,
                  under_price: underPrice,
                  snapshot_phase: phase,
                  snapshot_time: nowISO,
                  hours_to_tip: hoursToTip ? Math.round(hoursToTip * 100) / 100 : null,
                  line_change_from_open: lineChange,
                  price_change_from_open: priceChange,
                  drift_velocity: driftVelocity,
                  opening_line: opening?.line ?? (phase === "morning_open" ? line : null),
                  opening_over_price: opening?.over ?? (phase === "morning_open" ? overPrice : null),
                  opening_under_price: opening?.under ?? (phase === "morning_open" ? underPrice : null),
                  event_description: description,
                  commence_time: commenceTime || null,
                });
              }
            }
          } catch (fetchErr: any) {
            log(`⚠ ${sportLabel} event ${eventId} batch error: ${fetchErr.message}`);
          }
        }

        // Small delay between batches to avoid rate limiting
        await new Promise((r) => setTimeout(r, 200));
      }

      // 4. Insert rows
      if (rows.length > 0) {
        // Insert in chunks of 500
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = rows.slice(i, i + 500);
          const { error } = await supabase.from("fanduel_line_timeline").insert(chunk);
          if (error) {
            log(`❌ ${sportLabel} insert error: ${error.message}`);
          }
        }
        totalSnapshots += rows.length;
        sportSummary[sportLabel] = rows.length;
        log(`✅ ${sportLabel}: ${rows.length} snapshots stored`);
      }
    }

    // 5. Cleanup: delete records older than 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("fanduel_line_timeline").delete().lt("created_at", thirtyDaysAgo);

    // 6. Log summary
    log(`=== SCAN COMPLETE: ${totalSnapshots} snapshots, ${totalApiCalls} API calls ===`);
    log(`Sports: ${JSON.stringify(sportSummary)}`);

    // 7. Log to cron_job_history
    await supabase.from("cron_job_history").insert({
      job_name: "fanduel-line-scanner",
      status: totalSnapshots > 0 ? "completed" : "no_data",
      started_at: nowISO,
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - now.getTime(),
      result: { totalSnapshots, totalApiCalls, sportSummary },
    });

    return new Response(
      JSON.stringify({ success: true, totalSnapshots, totalApiCalls, sportSummary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    log(`❌ Fatal: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
