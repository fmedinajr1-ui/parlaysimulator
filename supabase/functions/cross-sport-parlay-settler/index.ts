/**
 * cross-sport-parlay-settler (v2)
 *
 * Grades pending parlays from cross_sport_*, ladder_challenge, mega_lottery_scanner.
 * v2 drops the event_id requirement and matches:
 *   - player legs by (sport, player_name, parlay_date) against per-sport *_player_game_logs
 *   - team legs by team-name substring against live_game_scores filtered to parlay_date
 * Treats "no log + ingest complete" as DNP-void; "no log + ingest incomplete" keeps
 * the parlay pending (no false-loss). Legs with no game context (e.g. mega_lottery
 * team legs missing team/opponent/game) are graded as void with
 * reason `ungradable_missing_context`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bayesianHitRate, evPerUnit, breakevenDecimal, priorForLegCount } from "../_shared/staking/kelly.ts";

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

const SPORT_ALIASES: Record<string, string> = {
  mlb: "baseball_mlb", baseball_mlb: "baseball_mlb",
  nba: "basketball_nba", basketball_nba: "basketball_nba",
  nhl: "icehockey_nhl", icehockey_nhl: "icehockey_nhl",
  ncaab: "basketball_ncaab", basketball_ncaab: "basketball_ncaab",
  nfl: "americanfootball_nfl", americanfootball_nfl: "americanfootball_nfl",
  wnba: "basketball_wnba", basketball_wnba: "basketball_wnba",
  mma: "mma_mixed_martial_arts", mma_mixed_martial_arts: "mma_mixed_martial_arts",
  ncaaf: "americanfootball_ncaaf", americanfootball_ncaaf: "americanfootball_ncaaf",
};
function canonSport(s: unknown): string | null {
  const k = String(s ?? "").toLowerCase();
  return SPORT_ALIASES[k] ?? null;
}

const PROP_ALIASES: Record<string, string> = {
  hits: "batter_hits", "batter hits": "batter_hits",
  "total bases": "batter_total_bases", tb: "batter_total_bases",
  "runs scored": "batter_runs_scored", runs: "batter_runs_scored",
  rbis: "batter_rbis", rbi: "batter_rbis",
  "home runs": "batter_home_runs", hr: "batter_home_runs",
  walks: "batter_walks", bb: "batter_walks",
  "stolen bases": "batter_stolen_bases", sb: "batter_stolen_bases",
  "hits+runs+rbis": "batter_hits_runs_rbis", "h+r+rbi": "batter_hits_runs_rbis",
  strikeouts: "pitcher_strikeouts", ks: "pitcher_strikeouts",
  "earned runs": "pitcher_earned_runs", er: "pitcher_earned_runs",
  "hits allowed": "pitcher_hits_allowed",
  outs: "pitcher_outs",
  points: "player_points", pts: "player_points",
  rebounds: "player_rebounds", reb: "player_rebounds",
  assists: "player_assists", ast: "player_assists",
  threes: "player_threes", "3pm": "player_threes",
  steals: "player_steals", stl: "player_steals",
  blocks: "player_blocks", blk: "player_blocks",
  "shots on goal": "player_shots_on_goal", sog: "player_shots_on_goal",
  goals: "player_goals",
  "blocked shots": "player_blocked_shots",
};
function canonProp(p: unknown): string {
  const raw = String(p ?? "").trim();
  if (!raw) return "";
  const low = raw.toLowerCase();
  return PROP_ALIASES[low] ?? low;
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
type LegKind = "player" | "moneyline" | "spread" | "total" | "unknown";

function classifyLeg(leg: Record<string, unknown>): { kind: LegKind; prop: string } {
  const mt = String(leg.market_type ?? "").toLowerCase();
  const pt = canonProp(leg.prop_type);
  if (mt === "moneyline" || pt === "moneyline" || pt === "h2h") return { kind: "moneyline", prop: "moneyline" };
  if (mt === "spread" || pt === "spread" || pt === "spreads" || pt === "run_line" || pt === "run line") return { kind: "spread", prop: "spread" };
  if (mt === "total" || pt === "total" || pt === "totals") return { kind: "total", prop: "total" };
  if (mt === "player" || leg.player_name) return { kind: "player", prop: pt };
  return { kind: "unknown", prop: pt };
}

function gradePlayerLeg(
  leg: Record<string, unknown>,
  log: Record<string, unknown>,
  sportCanon: string,
  propCanon: string,
): { result: LegOut; actual: number | null; reason?: string } {
  const mapper = STAT[sportCanon]?.[propCanon];
  if (!mapper) return { result: "void", actual: null, reason: `unmapped_prop:${propCanon}` };
  const v = mapper(log);
  if (v == null) return { result: "void", actual: null, reason: "null_stat_value" };
  const line = Number(leg.line);
  const side = String(leg.side ?? "").toUpperCase();
  if (side === "OVER") return { result: v > line ? "hit" : "miss", actual: v };
  if (side === "UNDER") return { result: v < line ? "hit" : "miss", actual: v };
  return { result: "void", actual: v, reason: `unknown_side:${side}` };
}

function gradeTeamLeg(
  leg: Record<string, unknown>,
  score: { home_score: number; away_score: number; home_team: string; away_team: string },
  kind: LegKind,
): { result: LegOut; actual: string; reason?: string } {
  const side = String(leg.side ?? "").toUpperCase();
  const teamRaw = String(leg.team ?? leg.player_team ?? "").toLowerCase().trim();
  let isHome: boolean;
  if (teamRaw) {
    isHome = score.home_team?.toLowerCase().includes(teamRaw)
         || teamRaw.includes(score.home_team?.toLowerCase() ?? "__nope__");
  } else if (side === "HOME") isHome = true;
  else if (side === "AWAY") isHome = false;
  else if (kind === "total") isHome = true;
  else return { result: "void", actual: `${score.home_score}-${score.away_score}`, reason: "ungradable_missing_team" };

  const myScore = isHome ? score.home_score : score.away_score;
  const oppScore = isHome ? score.away_score : score.home_score;
  if (kind === "moneyline") {
    return { result: myScore > oppScore ? "hit" : "miss", actual: `${score.home_score}-${score.away_score}` };
  }
  if (kind === "spread") {
    const line = Number(leg.line);
    const margin = myScore - oppScore + line;
    if (margin === 0) return { result: "void", actual: `${score.home_score}-${score.away_score}` };
    return { result: margin > 0 ? "hit" : "miss", actual: `${score.home_score}-${score.away_score}` };
  }
  if (kind === "total") {
    const line = Number(leg.line);
    const total = score.home_score + score.away_score;
    if (total === line) return { result: "void", actual: `total ${total}` };
    if (side === "OVER") return { result: total > line ? "hit" : "miss", actual: `total ${total}` };
    if (side === "UNDER") return { result: total < line ? "hit" : "miss", actual: `total ${total}` };
  }
  return { result: "void", actual: `${score.home_score}-${score.away_score}`, reason: `unknown_kind:${kind}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const since = new Date(Date.now() - 72 * 3600_000).toISOString().slice(0, 10);
    // Widen the lookback for fade parlays (they sit pending for weeks while
    // historical MMA/NCAAF cards play out). Bot_daily_parlays keeps the 72h
    // window so we don't re-grade ancient cross-sport tickets.
    const fadeSince = new Date(Date.now() - 60 * 24 * 3600_000).toISOString().slice(0, 10);

    // Cross-sport family stays inside the rolling 72h window.
    const { data: csRows, error: csErr } = await supabase
      .from("bot_daily_parlays")
      .select("id, parlay_date, legs, leg_count, strategy_name")
      .or(
        "strategy_name.like.cross_sport_%," +
        "strategy_name.eq.ladder_challenge," +
        "strategy_name.eq.mega_lottery_scanner",
      )
      .is("settled_at", null)
      .gte("parlay_date", since);
    if (csErr) throw csErr;

    // Optimal-combo has its own (wider) backlog window so historical
    // parlays still get a chance to settle.
    const { data: ocRows, error: ocErr } = await supabase
      .from("bot_daily_parlays")
      .select("id, parlay_date, legs, leg_count, strategy_name")
      .eq("strategy_name", "optimal_combo")
      .is("settled_at", null)
      .gte("parlay_date", fadeSince);
    if (ocErr) throw ocErr;

    const pendings = [...(csRows ?? []), ...(ocRows ?? [])];

    // Fade parlays live in ai_generated_parlays with strategy_used. Normalize
    // them into the same shape (id, parlay_date, legs, leg_count, strategy_name)
    // so the grading loop can treat them uniformly.
    const { data: fadeRows, error: fadeErr } = await supabase
      .from("ai_generated_parlays")
      .select("id, created_at, legs")
      .eq("strategy_used", "fade_parlay_of_the_day")
      .eq("outcome", "pending")
      .gte("created_at", `${fadeSince}T00:00:00Z`);
    if (fadeErr) throw fadeErr;

    const fadeNormalized = (fadeRows ?? []).map((r) => {
      const o = r as { id: string; created_at: string; legs: Record<string, unknown>[] };
      // ET date stamp (parlay_date semantics matches the generator's broadcast).
      const etDate = new Date(o.created_at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      return {
        id: o.id,
        parlay_date: etDate,
        legs: o.legs ?? [],
        leg_count: (o.legs ?? []).length,
        strategy_name: "fade_parlay_of_the_day",
        _table: "ai_generated_parlays" as const,
      };
    });

    const botPendings = (pendings ?? []).map((p) => ({ ...(p as Record<string, unknown>), _table: "bot_daily_parlays" as const }));
    const allPendings = [...botPendings, ...fadeNormalized];

    const dates = [...new Set(allPendings.map(p => (p as { parlay_date: string }).parlay_date))];

    // Bulk-load scores per date (no event_id required).
    type ScoreRow = { home_team: string; away_team: string; home_score: number; away_score: number; status: string };
    const scoresByDate = new Map<string, ScoreRow[]>();
    for (const d of dates) {
      // Widen the window to cover ET-evening games whose UTC start crosses midnight.
      const nextDay = new Date(`${d}T00:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const endIso = nextDay.toISOString().slice(0, 10) + "T08:00:00";
      const { data: rows } = await supabase
        .from("live_game_scores")
        .select("home_team, away_team, home_score, away_score, game_status, start_time")
        .gte("start_time", `${d}T00:00:00`)
        .lte("start_time", endIso);
      scoresByDate.set(d, (rows ?? []).map(r => {
        const o = r as Record<string, unknown>;
        return {
          home_team: String(o.home_team ?? ""),
          away_team: String(o.away_team ?? ""),
          home_score: Number(o.home_score ?? 0),
          away_score: Number(o.away_score ?? 0),
          status: String(o.game_status ?? ""),
        };
      }));
    }

    // Bulk-load player game logs per sport.
    const allPlayerKeys = new Map<string, Set<string>>(); // sportCanon -> set(player_name)
    for (const p of allPendings) {
      for (const l of (p as { legs: Record<string, unknown>[] }).legs ?? []) {
        const sp = canonSport(l.sport);
        if (sp && l.player_name) {
          if (!allPlayerKeys.has(sp)) allPlayerKeys.set(sp, new Set());
          allPlayerKeys.get(sp)!.add(String(l.player_name));
        }
      }
    }
    const logMap = new Map<string, Map<string, Record<string, unknown>>>(); // sport -> "lname|date" -> log
    const ingestComplete = new Map<string, boolean>(); // `${sport}|${date}` -> any rows present
    for (const [sport, players] of allPlayerKeys) {
      const table = LOG_TABLE_FOR[sport];
      if (!table) continue;
      const { data: logs } = await supabase.from(table).select("*").in("player_name", [...players]).in("game_date", dates);
      const m = new Map<string, Record<string, unknown>>();
      for (const log of logs ?? []) {
        const r = log as Record<string, unknown>;
        const gd = String(r.game_date ?? "").slice(0, 10); // YYYY-MM-DD
        m.set(`${String(r.player_name).toLowerCase()}|${gd}`, r);
      }
      logMap.set(sport, m);
      // Heuristic: ingest complete for sport+date if ANY log row exists for that date.
      for (const d of dates) {
        const any = [...m.values()].some(r => String(r.game_date ?? "").slice(0, 10) === d);
        ingestComplete.set(`${sport}|${d}`, any);
      }
    }

    function findScore(date: string, hint: string): ScoreRow | null {
      const rows = scoresByDate.get(date) ?? [];
      const t = hint.toLowerCase().trim();
      if (!t) return null;
      for (const r of rows) {
        const ht = r.home_team.toLowerCase();
        const at = r.away_team.toLowerCase();
        if (ht.includes(t) || at.includes(t) || t.includes(ht) || t.includes(at)) return r;
      }
      return null;
    }

    let settled = 0, stillPending = 0;
    const feedbackRows: Record<string, unknown>[] = [];

    for (const p of allPendings) {
      const par = p as { id: string; parlay_date: string; legs: Record<string, unknown>[]; leg_count: number; strategy_name: string; _table: "bot_daily_parlays" | "ai_generated_parlays" };
      const legs = par.legs ?? [];
      const legResults: Array<{ leg: Record<string, unknown>; result: LegOut; actual: unknown; reason?: string; kind: LegKind; sport: string | null }> = [];
      let parlayPending = false;

      for (const l of legs) {
        const sport = canonSport(l.sport);
        const { kind, prop } = classifyLeg(l);

        if (kind === "player") {
          if (!sport) { legResults.push({ leg: l, result: "void", actual: null, reason: "unknown_sport", kind, sport }); continue; }
          const log = logMap.get(sport)?.get(`${String(l.player_name).toLowerCase()}|${par.parlay_date}`) ?? null;
          if (!log) {
            const complete = ingestComplete.get(`${sport}|${par.parlay_date}`);
            if (!complete) { parlayPending = true; break; }
            legResults.push({ leg: l, result: "void", actual: null, reason: "dnp_or_missing_log", kind, sport });
            continue;
          }
          legResults.push({ leg: l, ...gradePlayerLeg(l, log, sport, prop), kind, sport });
          continue;
        }

        // Team-market leg: derive game context from team/player_team/opponent/game.
        let hint = String(l.team ?? l.player_team ?? l.opponent ?? "").trim();
        if (!hint && typeof l.game === "string") {
          hint = (l.game as string).split(/\s+(?:@|vs\.?|v)\s+/i)[0].trim();
        }
        if (!hint) {
          legResults.push({ leg: l, result: "void", actual: null, reason: "ungradable_missing_context", kind, sport });
          continue;
        }
        const score = findScore(par.parlay_date, hint);
        if (!score) {
          const rowsForDate = scoresByDate.get(par.parlay_date) ?? [];
          if (rowsForDate.length === 0) { parlayPending = true; break; }
          legResults.push({ leg: l, result: "void", actual: null, reason: "ungradable_missing_context", kind, sport });
          continue;
        }
        if (!/final/i.test(score.status)) { parlayPending = true; break; }
        legResults.push({ leg: l, ...gradeTeamLeg(l, score, kind), kind, sport });
      }

      if (parlayPending) { stillPending++; continue; }

      const hits = legResults.filter(r => r.result === "hit").length;
      const misses = legResults.filter(r => r.result === "miss").length;
      const voids = legResults.filter(r => r.result === "void").length;
      let outcome: "won" | "lost" | "void";
      if (misses > 0) outcome = "lost";
      else if (hits + voids === legs.length && hits > 0) outcome = "won";
      else outcome = "void";

      const lesson = `graded(v2): ${hits}H/${misses}M/${voids}V | ${legResults
        .filter(r => r.result === "miss" || (r.result === "void" && r.reason && r.reason !== "no_game_log"))
        .map(r => `${r.result.toUpperCase()} ${r.leg.player_name ?? r.leg.team ?? r.kind} ${r.leg.prop_type ?? r.kind} ${r.leg.side ?? ""} ${r.leg.line ?? ""}${r.actual != null ? ` (actual ${r.actual})` : ""}${r.reason ? ` [${r.reason}]` : ""}`)
        .join(" ; ")}`.slice(0, 1000);

      // Per-leg detail (powers the leg-by-leg report).
      const legsGraded = legResults.map((r) => ({
        player_name: r.leg.player_name ?? null,
        team: r.leg.team ?? null,
        sport: r.sport ?? r.leg.sport ?? null,
        prop_type: r.leg.prop_type ?? null,
        side: r.leg.side ?? null,
        line: r.leg.line ?? null,
        kind: r.kind,
        result: r.result,
        actual: r.actual ?? null,
        reason: r.reason ?? null,
        game: r.leg.game ?? r.leg.game_description ?? null,
      }));

      if (par._table === "ai_generated_parlays") {
        const { error: uerr } = await supabase.from("ai_generated_parlays").update({
          outcome, settled_at: new Date().toISOString(), legs_graded: legsGraded,
        }).eq("id", par.id);
        if (uerr) { console.error("settle update err (fade)", uerr); continue; }
      } else {
        const { error: uerr } = await supabase.from("bot_daily_parlays").update({
          outcome, legs_hit: hits, legs_missed: misses, legs_voided: voids,
          settled_at: new Date().toISOString(), lesson_learned: lesson,
          legs_graded: legsGraded,
        }).eq("id", par.id);
        if (uerr) { console.error("settle update err", uerr); continue; }
      }
      settled++;

      for (const r of legResults) {
        if (r.result === "void") continue;
        // Only emit leg-level feedback for the original cross_sport_* family.
        // Fade and optimal_combo strategies persist their per-leg detail in
        // legs_graded; they don't participate in the cross-sport feedback loop.
        if (!par.strategy_name.startsWith("cross_sport_") && par.strategy_name !== "ladder_challenge" && par.strategy_name !== "mega_lottery_scanner") continue;
        feedbackRows.push({
          parlay_id: par.id,
          parlay_date: par.parlay_date,
          strategy_name: par.strategy_name,
          sport: r.sport ?? r.leg.sport,
          market_type: r.leg.market_type ?? r.kind,
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

    // -------------------------------------------------------------------------
    // Refresh strategy_pnl_rolling (7d + 30d windows). Pulls settled tickets,
    // computes empirical hit rate, smoothed p, avg decimal odds, EV/unit and
    // ROI per strategy. Generators read this on the next run to gate emission.
    // -------------------------------------------------------------------------
    try {
      const today = new Date();
      const isoSlice = (d: Date) => d.toISOString().slice(0, 10);
      for (const windowDays of [7, 30]) {
        const start = new Date(today.getTime() - windowDays * 24 * 3600_000);
        const { data: rows } = await supabase
          .from("bot_daily_parlays")
          .select("strategy_name, outcome, expected_odds, leg_count")
          .gte("parlay_date", isoSlice(start))
          .in("outcome", ["won", "lost", "void"]);
        const byStrat = new Map<string, { wins: number; losses: number; voids: number; decOdds: number[]; legSum: number; n: number }>();
        for (const r of (rows ?? []) as Array<{ strategy_name: string; outcome: string; expected_odds: number | null; leg_count: number | null }>) {
          const k = r.strategy_name;
          if (!byStrat.has(k)) byStrat.set(k, { wins: 0, losses: 0, voids: 0, decOdds: [], legSum: 0, n: 0 });
          const s = byStrat.get(k)!;
          if (r.outcome === "won") s.wins++;
          else if (r.outcome === "lost") s.losses++;
          else s.voids++;
          const amer = Number(r.expected_odds ?? 0);
          if (Number.isFinite(amer) && amer !== 0) {
            const dec = amer > 0 ? 1 + amer / 100 : 1 + 100 / Math.abs(amer);
            s.decOdds.push(dec);
          }
          s.legSum += Number(r.leg_count ?? 0);
          s.n++;
        }
        const upserts: Record<string, unknown>[] = [];
        for (const [strategy, s] of byStrat) {
          const graded = s.wins + s.losses; // voids don't count toward hit rate
          const hitRate = graded > 0 ? s.wins / graded : 0;
          const avgLegCount = s.n > 0 ? s.legSum / s.n : 0;
          const prior = priorForLegCount(Math.round(avgLegCount || 3));
          const pSmoothed = bayesianHitRate(s.wins, graded, prior, 10);
          const avgDec = s.decOdds.length > 0
            ? s.decOdds.reduce((a, b) => a + b, 0) / s.decOdds.length
            : 0;
          const ev = avgDec > 1 ? evPerUnit(pSmoothed, avgDec) : 0;
          const roi = graded > 0 ? (s.wins * (avgDec - 1) - s.losses) / graded : 0;
          upserts.push({
            strategy_name: strategy,
            window_days: windowDays,
            n: s.n,
            wins: s.wins,
            losses: s.losses,
            voids: s.voids,
            hit_rate: Number(hitRate.toFixed(4)),
            p_smoothed: Number(pSmoothed.toFixed(4)),
            avg_decimal_odds: Number(avgDec.toFixed(4)),
            avg_leg_count: Number(avgLegCount.toFixed(2)),
            rolling_ev_per_unit: Number(ev.toFixed(4)),
            rolling_roi: Number(roi.toFixed(4)),
            breakeven_min_decimal: Number(breakevenDecimal(Math.max(pSmoothed, 0.0001)).toFixed(4)),
            updated_at: new Date().toISOString(),
          });
        }
        if (upserts.length > 0) {
          const { error: uerr } = await supabase
            .from("strategy_pnl_rolling")
            .upsert(upserts, { onConflict: "strategy_name,window_days" });
          if (uerr) console.error("strategy_pnl_rolling upsert err", uerr);
        }
      }
    } catch (e) {
      console.error("strategy_pnl_rolling refresh failed (non-fatal):", e);
    }

    return new Response(JSON.stringify({
      ok: true,
      pending_total: allPendings.length,
      bot_pending: botPendings.length,
      fade_pending: fadeNormalized.length,
      settled, stillPending,
      feedback_rows: feedbackRows.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("cross-sport-parlay-settler error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});