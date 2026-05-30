// Velocity Spike settler — grades ALL unsettled `signal_type='velocity_spike'`
// alerts against player_game_logs (regardless of engine verdict: STRONG /
// WEAK / LEAN / NEUTRAL / missing), then mirrors results into
// `fanduel_prediction_accuracy`. The engine verdict is preserved in
// signal_factors so accuracy-by-verdict queries work.
//
// Modes:
//   default → settle a rolling batch (cron)
//   {"mode":"backfill","since":"2026-04-15","batch":2000} → bulk backfill

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Sport = "MLB" | "NBA" | "NHL";

interface Alert {
  id: string;
  player_name: string;
  event_id: string;
  prop_type: string | null;
  sport: string | null;
  prediction: string;
  confidence: number;
  commence_time: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

const SPORT_TO_TABLE: Record<Sport, string> = {
  MLB: "mlb_player_game_logs",
  NBA: "nba_player_game_logs",
  NHL: "nhl_player_game_logs",
};

/** Map a prop_type to a closure that extracts the actual numeric outcome
 *  from a single game-log row. Returns null when the prop isn't gradeable
 *  from the available schema (we just skip those for v1). */
function resolver(sport: Sport, propType: string): ((row: any) => number | null) | null {
  const pt = propType.toLowerCase();

  if (sport === "MLB") {
    switch (pt) {
      case "batter_hits": return (r) => num(r.hits);
      case "batter_total_bases": return (r) => num(r.total_bases);
      case "batter_rbis": return (r) => num(r.rbis);
      case "batter_runs_scored": return (r) => num(r.runs);
      case "batter_home_runs":
      case "batter_home_runs_mlb": return (r) => num(r.home_runs);
      case "batter_stolen_bases": return (r) => num(r.stolen_bases);
      case "batter_walks": return (r) => num(r.walks);
      case "batter_strikeouts": return (r) => num(r.strikeouts);
      case "batter_hits_runs_rbis":
        return (r) => num(r.hits) + num(r.runs) + num(r.rbis);
      case "pitcher_strikeouts": return (r) => num(r.pitcher_strikeouts);
      case "pitcher_outs":
        return (r) => Math.round(num(r.innings_pitched) * 3);
      case "pitcher_hits_allowed": return (r) => num(r.pitcher_hits_allowed);
      default: return null; // singles/doubles/spreads/h2h/totals — out of scope v1
    }
  }

  if (sport === "NBA") {
    switch (pt) {
      case "player_points": return (r) => num(r.points);
      case "player_rebounds": return (r) => num(r.rebounds);
      case "player_assists": return (r) => num(r.assists);
      case "player_threes":
      case "player_3_pointers_made": return (r) => num(r.threes_made);
      case "player_blocks": return (r) => num(r.blocks);
      case "player_steals": return (r) => num(r.steals);
      case "player_turnovers": return (r) => num(r.turnovers);
      case "player_points_rebounds_assists":
        return (r) => num(r.points) + num(r.rebounds) + num(r.assists);
      case "player_points_rebounds":
        return (r) => num(r.points) + num(r.rebounds);
      case "player_points_assists":
        return (r) => num(r.points) + num(r.assists);
      case "player_rebounds_assists":
        return (r) => num(r.rebounds) + num(r.assists);
      default: return null;
    }
  }

  if (sport === "NHL") {
    switch (pt) {
      case "player_goals": return (r) => num(r.goals);
      case "player_assists_nhl":
      case "player_assists": return (r) => num(r.assists);
      case "player_points_nhl":
      case "player_points": return (r) => num(r.points);
      case "player_shots_on_goal": return (r) => num(r.shots_on_goal);
      case "player_blocked_shots": return (r) => num(r.blocked_shots);
      case "player_power_play_points": return (r) => num(r.power_play_points);
      default: return null;
    }
  }

  return null;
}

function num(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

function etDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  // ET — use America/New_York
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function gradeOverUnder(actual: number, line: number, prediction: string):
  { was_correct: boolean | null; outcome: string } {
  const dir = prediction.trim().toLowerCase();
  if (Math.abs(actual - line) < 1e-9) return { was_correct: null, outcome: "push" };
  if (dir === "over") return { was_correct: actual > line, outcome: actual > line ? "won" : "lost" };
  if (dir === "under") return { was_correct: actual < line, outcome: actual < line ? "won" : "lost" };
  return { was_correct: null, outcome: "unknown_direction" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* GET / empty */ }
  const mode = body?.mode === "backfill" ? "backfill" : "incremental";
  const since: string = body?.since ?? "2026-04-15";
  const batchSize: number = Math.min(Math.max(Number(body?.batch ?? (mode === "backfill" ? 2000 : 500)), 1), 5000);

  const cutoffIso = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

  let query = supabase
    .from("fanduel_prediction_alerts")
    .select("id, player_name, event_id, prop_type, sport, prediction, confidence, commence_time, created_at, metadata")
    .eq("signal_type", "velocity_spike")
    .is("was_correct", null)
    .is("settlement_method", null)
    .lt("commence_time", cutoffIso)
    .order("commence_time", { ascending: true })
    .limit(batchSize);

  if (mode === "backfill") query = query.gte("created_at", since);

  const { data: alerts, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let settled = 0;
  let skippedNoStat = 0;
  let skippedNoLog = 0;
  let skippedTeam = 0;
  const accuracyRows: any[] = [];
  const updates: { id: string; was_correct: boolean | null; actual_outcome: string }[] = [];
  const ungradeable: string[] = [];

  for (const a of (alerts ?? []) as Alert[]) {
    const sportRaw = (a.sport ?? "").toUpperCase() as Sport;
    if (!SPORT_TO_TABLE[sportRaw]) { skippedTeam++; ungradeable.push(a.id); continue; }
    if (!a.prop_type) { skippedTeam++; ungradeable.push(a.id); continue; }
    if (a.player_name && /game total|\//i.test(a.player_name)) { skippedTeam++; ungradeable.push(a.id); continue; }

    const resolve = resolver(sportRaw, a.prop_type);
    if (!resolve) { skippedNoStat++; ungradeable.push(a.id); continue; }

    const lineRaw = a.metadata?.["line"];
    const line = typeof lineRaw === "number" ? lineRaw : Number(lineRaw);
    if (!Number.isFinite(line)) { skippedNoStat++; ungradeable.push(a.id); continue; }

    const gameDate = etDate(a.commence_time);
    if (!gameDate) { skippedNoLog++; continue; }

    const table = SPORT_TO_TABLE[sportRaw];
    const { data: logs, error: logErr } = await supabase
      .from(table)
      .select("*")
      .eq("player_name", a.player_name)
      .eq("game_date", gameDate)
      .limit(1);

    if (logErr) {
      console.error("log lookup error", logErr.message);
      continue;
    }
    if (!logs || logs.length === 0) { skippedNoLog++; continue; }

    const actual = resolve(logs[0]);
    if (actual === null || !Number.isFinite(actual)) { skippedNoStat++; ungradeable.push(a.id); continue; }

    const { was_correct, outcome } = gradeOverUnder(actual, line, a.prediction);

    updates.push({ id: a.id, was_correct, actual_outcome: outcome });

    const verdict = (a.metadata as any)?.engine_reasoning?.verdict ?? null;
    accuracyRows.push({
      signal_type: "velocity_spike",
      sport: sportRaw,
      prop_type: a.prop_type,
      player_name: a.player_name,
      event_id: a.event_id,
      prediction: a.prediction,
      predicted_direction: a.prediction.toLowerCase(),
      line_at_alert: line,
      actual_outcome: outcome,
      actual_value: actual,
      was_correct,
      confidence_at_signal: a.confidence,
      edge_at_signal: typeof a.metadata?.["edge"] === "number" ? a.metadata!["edge"] : null,
      drift_pct_at_alert: typeof a.metadata?.["drift_pct"] === "number" ? a.metadata!["drift_pct"] : null,
      signal_factors: { ...(a.metadata ?? {}), engine_verdict: verdict },
      alert_sent_at: a.created_at,
      verified_at: new Date().toISOString(),
      settlement_method: "velocity_spike_game_log_v1",
      is_gated: false,
    });
    settled++;
  }

  // Persist accuracy rows first (the recap depends on these)
  if (accuracyRows.length > 0) {
    for (let i = 0; i < accuracyRows.length; i += 200) {
      const chunk = accuracyRows.slice(i, i + 200);
      const { error: upErr } = await supabase
        .from("fanduel_prediction_accuracy")
        .upsert(chunk, { onConflict: "event_id,player_name,prop_type,signal_type" });
      if (upErr) console.error("accuracy upsert error", upErr.message);
    }
  }

  // Then persist alert grading in parallel chunks
  const nowIso = new Date().toISOString();
  const updTasks = updates.map((u) =>
    supabase.from("fanduel_prediction_alerts")
      .update({
        was_correct: u.was_correct,
        actual_outcome: u.actual_outcome,
        settled_at: nowIso,
        settlement_method: "velocity_spike_game_log_v1",
      })
      .eq("id", u.id)
  );
  for (let i = 0; i < updTasks.length; i += 25) {
    await Promise.all(updTasks.slice(i, i + 25));
  }

  // Tombstone ungradeable rows so they stop being rescanned
  if (ungradeable.length > 0) {
    for (let i = 0; i < ungradeable.length; i += 500) {
      await supabase.from("fanduel_prediction_alerts")
        .update({ settlement_method: "velocity_spike_ungradeable_v1", settled_at: nowIso })
        .in("id", ungradeable.slice(i, i + 500));
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    mode,
    scanned: alerts?.length ?? 0,
    settled,
    skipped: { team_or_market: skippedTeam, no_stat_resolver: skippedNoStat, no_game_log: skippedNoLog },
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});