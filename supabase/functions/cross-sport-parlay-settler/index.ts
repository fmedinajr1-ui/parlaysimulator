/**
 * cross-sport-parlay-settler
 *
 * Grades pending `cross_sport_*` parlays in bot_daily_parlays.
 * - Pulls live_game_scores per leg's event_id; only grades when ALL legs' games are final.
 * - Player legs graded from per-sport game_logs via PROP_STAT_MAP.
 * - Team legs (moneyline/spread/total) graded from final home/away scores.
 * - DNP (no game-log row but game is final) ⇒ leg voided; remaining legs decide outcome.
 * - Writes outcome/legs_hit/legs_missed/settled_at/lesson_learned back to bot_daily_parlays.
 * - Records per-leg outcomes into cross_sport_leg_feedback for learning aggregation.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
function add(...xs: (number | null)[]): number | null {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length === xs.length ? ok.reduce((a, b) => a + b, 0) : null;
}

const STAT: Record<string, Record<string, (g: Record<string, unknown>) => number | null>> = {
  baseball_mlb: {
    batter_hits: g => num(g.hits),
    batter_total_bases: g => num(g.total_bases),
    batter_runs_scored: g => num(g.runs),
    batter_rbis: g => num(g.rbis),
    batter_home_runs: g => num(g.home_runs),
    batter_walks: g => num(g.walks),
    batter_stolen_bases: g => num(g.stolen_bases),
    batter_hits_runs_rbis: g => add(num(g.hits), num(g.runs), num(g.rbis)),
    pitcher_strikeouts: g => num(g.pitcher_strikeouts),
    pitcher_earned_runs: g => num(g.earned_runs),
    pitcher_hits_allowed: g => num(g.pitcher_hits_allowed),
    pitcher_outs: g => { const ip = num(g.innings_pitched); return ip == null ? null : ip * 3; },
  },
  basketball_nba: {
    player_points: g => num(g.points),
    player_rebounds: g => num(g.rebounds),
    player_assists: g => num(g.assists),
    player_threes: g => num(g.threes_made),
    player_steals: g => num(g.steals),
    player_blocks: g => num(g.blocks),
    player_points_rebounds: g => add(num(g.points), num(g.rebounds)),
    player_points_assists: g => add(num(g.points), num(g.assists)),
    player_rebounds_assists: g => add(num(g.rebounds), num(g.assists)),
    player_points_rebounds_assists: g => add(num(g.points), num(g.rebounds), num(g.assists)),
  },
  icehockey_nhl: {
    player_shots_on_goal: g => num(g.shots_on_goal),
    player_points: g => num(g.points),
    player_goals: g => num(g.goals),
    player_assists: g => num(g.assists),
    player_blocked_shots: g => num(g.blocked_shots),
  },
};
const LOG_TABLE_FOR: Record<string, string> = {
  baseball_mlb: "mlb_player_game_logs",
  basketball_nba: "nba_player_game_logs",
  icehockey_nhl: "nhl_player_game_logs",
};

type LegOut = "hit" | "miss" | "void" | "pending";

function gradePlayerLeg(leg: Record<string, unknown>, log: Record<string, unknown> | null): { result: LegOut; actual: number | null } {
  if (!log) return { result: "void", actual: null };
  const mapper = STAT[leg.sport as string]?.[leg.prop_type as string];
  if (!mapper) return { result: "void", actual: null };
  const v = mapper(log);
  if (v == null) return { result: "void", actual: null };
  const line = Number(leg.line);
  const side = String(leg.side ?? "").toUpperCase();
  if (side === "OVER") return { result: v > line ? "hit" : "miss", actual: v };
  if (side === "UNDER") return { result: v < line ? "hit" : "miss", actual: v };
  return { result: "void", actual: v };
}

function gradeTeamLeg(leg: Record<string, unknown>, score: { home_score: number; away_score: number; home_team: string; away_team: string }): { result: LegOut; actual: string } {
  const mt = String(leg.market_type);
  const side = String(leg.side ?? "").toUpperCase();
  const team = String(leg.team ?? "").toLowerCase();
  const isHome = team && score.home_team?.toLowerCase().includes(team);
  const myScore = isHome ? score.home_score : score.away_score;
  const oppScore = isHome ? score.away_score : score.home_score;
  if (mt === "moneyline") {
    return { result: myScore > oppScore ? "hit" : "miss", actual: `${score.home_score}-${score.away_score}` };
  }
  if (mt === "spread") {
    const line = Number(leg.line);
    const margin = myScore - oppScore + line;
    if (margin === 0) return { result: "void", actual: `${score.home_score}-${score.away_score}` };
    return { result: margin > 0 ? "hit" : "miss", actual: `${score.home_score}-${score.away_score}` };
  }
  if (mt === "total") {
    const line = Number(leg.line);
    const total = score.home_score + score.away_score;
    if (total === line) return { result: "void", actual: `total ${total}` };
    if (side === "OVER") return { result: total > line ? "hit" : "miss", actual: `total ${total}` };
    if (side === "UNDER") return { result: total < line ? "hit" : "miss", actual: `total ${total}` };
  }
  return { result: "void", actual: `${score.home_score}-${score.away_score}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const since = new Date(Date.now() - 36 * 3600_000).toISOString().slice(0, 10);
    const { data: pendings, error } = await supabase
      .from("bot_daily_parlays")
      .select("id, parlay_date, legs, leg_count, strategy_name")
      .like("strategy_name", "cross_sport_%")
      .is("settled_at", null)
      .gte("parlay_date", since);
    if (error) throw error;

    const allEventIds = new Set<string>();
    const allPlayerKeys = new Map<string, Set<string>>(); // sport -> set(player_name)
    for (const p of pendings ?? []) {
      for (const l of (p as { legs: Record<string, unknown>[] }).legs ?? []) {
        if (l.event_id) allEventIds.add(String(l.event_id));
        if (l.market_type === "player" && l.player_name) {
          const sp = String(l.sport);
          if (!allPlayerKeys.has(sp)) allPlayerKeys.set(sp, new Set());
          allPlayerKeys.get(sp)!.add(String(l.player_name));
        }
      }
    }

    // Bulk fetch scores
    const scoreMap = new Map<string, { home_score: number; away_score: number; status: string; home_team: string; away_team: string }>();
    if (allEventIds.size > 0) {
      const { data: scores } = await supabase
        .from("live_game_scores")
        .select("event_id, home_score, away_score, game_status, home_team, away_team")
        .in("event_id", [...allEventIds]);
      for (const s of scores ?? []) {
        const r = s as Record<string, unknown>;
        scoreMap.set(String(r.event_id), {
          home_score: Number(r.home_score ?? 0),
          away_score: Number(r.away_score ?? 0),
          status: String(r.game_status ?? ""),
          home_team: String(r.home_team ?? ""),
          away_team: String(r.away_team ?? ""),
        });
      }
    }

    // Bulk fetch logs per sport for all dates we touch
    const logMap = new Map<string, Map<string, Record<string, unknown>>>(); // sport -> "player|date" -> log
    const dates = [...new Set((pendings ?? []).map(p => (p as { parlay_date: string }).parlay_date))];
    for (const [sport, players] of allPlayerKeys) {
      const table = LOG_TABLE_FOR[sport];
      if (!table) continue;
      const { data: logs } = await supabase
        .from(table).select("*").in("player_name", [...players]).in("game_date", dates);
      const m = new Map<string, Record<string, unknown>>();
      for (const log of logs ?? []) {
        const r = log as Record<string, unknown>;
        m.set(`${r.player_name}|${r.game_date}`, r);
      }
      logMap.set(sport, m);
    }

    let settled = 0, stillPending = 0;
    const feedbackRows: Record<string, unknown>[] = [];

    for (const p of pendings ?? []) {
      const par = p as { id: string; parlay_date: string; legs: Record<string, unknown>[]; leg_count: number; strategy_name: string };
      const legs = par.legs ?? [];
      // Require ALL legs' games to be final before grading the parlay
      const allFinal = legs.every(l => /final/i.test(scoreMap.get(String(l.event_id))?.status ?? ""));
      if (!allFinal) { stillPending++; continue; }

      const legResults: Array<{ leg: Record<string, unknown>; result: LegOut; actual: unknown }> = [];
      for (const l of legs) {
        const score = scoreMap.get(String(l.event_id));
        if (!score) { legResults.push({ leg: l, result: "void", actual: null }); continue; }
        if (l.market_type === "player") {
          const log = logMap.get(String(l.sport))?.get(`${l.player_name}|${par.parlay_date}`) ?? null;
          legResults.push({ leg: l, ...gradePlayerLeg(l, log) });
        } else {
          legResults.push({ leg: l, ...gradeTeamLeg(l, score) });
        }
      }

      const hits = legResults.filter(r => r.result === "hit").length;
      const misses = legResults.filter(r => r.result === "miss").length;
      const voids = legResults.filter(r => r.result === "void").length;
      let outcome: "won" | "lost" | "void";
      if (misses > 0) outcome = "lost";
      else if (hits + voids === legs.length && hits > 0) outcome = "won";
      else outcome = "void";

      const lesson = `graded: ${hits}H/${misses}M/${voids}V | ${legResults.filter(r => r.result === "miss").map(r => `MISS ${r.leg.player_name ?? r.leg.team} ${r.leg.prop_type ?? r.leg.market_type} ${r.leg.side} ${r.leg.line ?? ""} (actual ${r.actual})`).join(" ; ")}`.slice(0, 1000);

      const { error: uerr } = await supabase.from("bot_daily_parlays").update({
        outcome,
        legs_hit: hits,
        legs_missed: misses,
        legs_voided: voids,
        settled_at: new Date().toISOString(),
        lesson_learned: lesson,
      }).eq("id", par.id);
      if (uerr) { console.error("settle update err", uerr); continue; }
      settled++;

      for (const r of legResults) {
        if (r.result === "void") continue;
        feedbackRows.push({
          parlay_id: par.id,
          parlay_date: par.parlay_date,
          strategy_name: par.strategy_name,
          sport: r.leg.sport,
          market_type: r.leg.market_type,
          prop_type: r.leg.prop_type ?? null,
          side: r.leg.side ?? null,
          line: r.leg.line ?? null,
          player_name: r.leg.player_name ?? null,
          team: r.leg.team ?? null,
          tier: r.leg.tier ?? null,
          safety_score: r.leg.safety_score ?? null,
          l10_hit_rate: r.leg.l10_hit_rate ?? null,
          result: r.result,
          actual_value: typeof r.actual === "number" ? r.actual : null,
          actual_text: typeof r.actual === "string" ? r.actual : null,
        });
      }
    }

    if (feedbackRows.length > 0) {
      const { error: ferr } = await supabase.from("cross_sport_leg_feedback").insert(feedbackRows);
      if (ferr) console.error("feedback insert err", ferr);
    }

    return new Response(JSON.stringify({
      ok: true, pending_total: (pendings ?? []).length, settled, stillPending,
      feedback_rows: feedbackRows.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("cross-sport-parlay-settler error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});