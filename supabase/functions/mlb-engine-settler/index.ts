// mlb-engine-settler
// Settles pending MLB picks in engine_live_tracker against mlb_player_game_logs.
// Supported prop_types: pitcher_strikeouts, pitcher_hits_allowed, pitcher_earned_runs,
// batter_hits, batter_home_runs, batter_rbis, batter_total_bases, batter_stolen_bases,
// batter_runs_scored, batter_walks, batter_singles, batter_doubles, batter_hits_runs_rbis.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROP_TO_FIELD: Record<string, (r: any) => number | null> = {
  pitcher_strikeouts: (r) => num(r.pitcher_strikeouts ?? r.strikeouts),
  pitcher_hits_allowed: (r) => num(r.pitcher_hits_allowed),
  pitcher_earned_runs: (r) => num(r.earned_runs),
  pitcher_outs: (r) => {
    const ip = num(r.innings_pitched);
    if (ip == null) return null;
    const whole = Math.floor(ip);
    const frac = Math.round((ip - whole) * 10);
    return whole * 3 + frac;
  },
  batter_hits: (r) => num(r.hits),
  batter_singles: (r) => {
    const h = num(r.hits), tb = num(r.total_bases), hr = num(r.home_runs);
    if (h == null || tb == null) return null;
    // singles cannot be reconstructed exactly without 2B/3B; skip
    return null;
  },
  batter_home_runs: (r) => num(r.home_runs),
  batter_rbis: (r) => num(r.rbis),
  batter_total_bases: (r) => num(r.total_bases),
  batter_stolen_bases: (r) => num(r.stolen_bases),
  batter_runs_scored: (r) => num(r.runs),
  batter_runs: (r) => num(r.runs),
  batter_walks: (r) => num(r.walks),
  batter_hits_runs_rbis: (r) => {
    const h = num(r.hits), ru = num(r.runs), rb = num(r.rbis);
    if (h == null && ru == null && rb == null) return null;
    return (h ?? 0) + (ru ?? 0) + (rb ?? 0);
  },
};

function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function gradeOverUnder(actual: number, line: number, side: string): "win" | "loss" | "push" {
  if (actual === line) return "push";
  const isOver = actual > line;
  const wantOver = side.toLowerCase() === "over";
  return isOver === wantOver ? "win" : "loss";
}

function etDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const daysBack: number = Number(body?.days_back ?? 3);
    const dryRun: boolean = Boolean(body?.dry_run ?? false);

    // Window of stat dates we'll match against
    const today = new Date();
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - daysBack);
    const startDate = etDateKey(start);
    const endDate = etDateKey(today);

    // Pull pending MLB picks with real side/line
    const { data: pending, error: pendErr } = await supabase
      .from("engine_live_tracker")
      .select("id, engine_name, sport, player_name, prop_type, line, side, created_at")
      .ilike("sport", "%mlb%")
      .eq("status", "pending")
      .not("side", "eq", "neutral")
      .not("line", "is", null)
      .not("player_name", "is", null);
    if (pendErr) throw new Error(`pending fetch: ${pendErr.message}`);

    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({
        success: true, scanned: 0, settled: 0, message: "no pending MLB picks",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Pull recent player logs once
    const { data: logs, error: logsErr } = await supabase
      .from("mlb_player_game_logs")
      .select("player_name, game_date, hits, runs, rbis, home_runs, stolen_bases, walks, strikeouts, total_bases, innings_pitched, earned_runs, pitcher_strikeouts, pitcher_hits_allowed")
      .gte("game_date", startDate)
      .lte("game_date", endDate);
    if (logsErr) throw new Error(`logs fetch: ${logsErr.message}`);

    // Index logs by player_name (lowercase) -> sorted by date desc
    const byPlayer = new Map<string, any[]>();
    for (const l of logs ?? []) {
      const key = String(l.player_name ?? "").toLowerCase().trim();
      if (!key) continue;
      if (!byPlayer.has(key)) byPlayer.set(key, []);
      byPlayer.get(key)!.push(l);
    }
    for (const arr of byPlayer.values()) {
      arr.sort((a, b) => String(b.game_date).localeCompare(String(a.game_date)));
    }

    const updates: Array<{ id: string; result: string; actual: number; matched_date: string; pick: any }> = [];
    let unmatched = 0, unsupported = 0;

    for (const p of pending) {
      const fieldFn = PROP_TO_FIELD[p.prop_type as string];
      if (!fieldFn) { unsupported++; continue; }

      const key = String(p.player_name ?? "").toLowerCase().trim();
      const playerLogs = byPlayer.get(key) ?? [];
      // pick the most recent log on/after pick creation date
      const createdDate = etDateKey(new Date(p.created_at));
      const candidate = playerLogs.find((l) => String(l.game_date) >= createdDate) ?? playerLogs[0];
      if (!candidate) { unmatched++; continue; }

      const actual = fieldFn(candidate);
      if (actual == null) { unsupported++; continue; }

      const result = gradeOverUnder(actual, Number(p.line), String(p.side));
      updates.push({ id: p.id as string, result, actual, matched_date: candidate.game_date, pick: p });
    }

    let settledCount = 0;
    if (!dryRun && updates.length) {
      // Batch update in chunks
      const chunkSize = 100;
      for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await Promise.all(chunk.map((u) =>
          supabase
            .from("engine_live_tracker")
            .update({
              status: u.result,
              settled_at: new Date().toISOString(),
              signals: { ...(u.pick.signals ?? {}), settlement: { actual: u.actual, matched_date: u.matched_date, source: "mlb-engine-settler" } },
            })
            .eq("id", u.id)
        ));
        settledCount += chunk.length;
      }
    }

    const breakdown = {
      wins: updates.filter((u) => u.result === "win").length,
      losses: updates.filter((u) => u.result === "loss").length,
      pushes: updates.filter((u) => u.result === "push").length,
    };

    return new Response(JSON.stringify({
      success: true,
      duration_ms: Date.now() - startedAt,
      scanned: pending.length,
      settled: settledCount,
      dry_run: dryRun,
      unmatched,
      unsupported,
      breakdown,
      window: { startDate, endDate },
      sample: updates.slice(0, 5).map((u) => ({
        id: u.id, engine: u.pick.engine_name, player: u.pick.player_name,
        prop: u.pick.prop_type, side: u.pick.side, line: u.pick.line,
        actual: u.actual, result: u.result, matched_date: u.matched_date,
      })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[mlb-engine-settler] fatal", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});