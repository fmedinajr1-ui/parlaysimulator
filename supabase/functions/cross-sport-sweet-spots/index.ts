/**
 * cross-sport-sweet-spots
 *
 * Pulls active props from unified_props for every in-season sport, computes L10
 * stats from per-sport game-log tables for player legs, and derives confidence
 * from de-juiced implied probability for team legs (ML/Spread/Total). Applies
 * hard drops + Perplexity research_boost, then persists tiered candidates into
 * cross_sport_sweet_spots.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ----- formula constants -----
const W_HIT = 0.45, W_FLOOR = 0.20, W_MEDIAN = 0.15, W_EDGE = 0.10, W_RESEARCH = 0.10;
const TIER_LOCK = 0.80, TIER_STRONG = 0.70, TIER_LEAN = 0.60;
const MAX_SPREAD_ABS = 9.5;
const MIN_PRICE = -250; // worse than -250 dropped
const PREGAME_BUFFER_MIN = 15; // game must start at least 15 min from now
const MIN_PLAYER_SAMPLE = 5;   // below this, cap tier at "lean" and use implied only

// ----- prop -> stat key map per sport -----
const PROP_STAT_MAP: Record<string, Record<string, (g: Record<string, unknown>) => number | null>> = {
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
    pitcher_outs: g => mul(num(g.innings_pitched), 3),
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
  basketball_ncaab: {
    player_points: g => num(g.points),
    player_rebounds: g => num(g.rebounds),
    player_assists: g => num(g.assists),
    player_threes: g => num(g.threes_made),
  },
  baseball_ncaa: {
    batter_hits: g => num(g.hits),
    batter_total_bases: g => null,
    batter_rbis: g => num(g.rbis),
    pitcher_strikeouts: g => num(g.pitcher_strikeouts),
  },
  americanfootball_ncaaf: {
    player_passing_yards: g => num(g.passing_yards),
    player_rushing_yards: g => num(g.rushing_yards),
    player_receiving_yards: g => num(g.receiving_yards),
    player_receptions: g => num(g.receptions),
  },
};

const LOG_TABLE_FOR: Record<string, string> = {
  baseball_mlb: "mlb_player_game_logs",
  basketball_nba: "nba_player_game_logs",
  icehockey_nhl: "nhl_player_game_logs",
  basketball_ncaab: "ncaab_player_game_logs",
  baseball_ncaa: "ncaa_baseball_player_game_logs",
  americanfootball_ncaaf: "nfl_player_game_logs",
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function add(...xs: (number | null)[]): number | null {
  const ok = xs.filter((x): x is number => x !== null);
  if (ok.length !== xs.length) return null;
  return ok.reduce((a, b) => a + b, 0);
}
function mul(a: number | null, b: number): number | null {
  return a === null ? null : a * b;
}

// ----- odds helpers -----
function impliedProb(american: number): number {
  if (american >= 0) return 100 / (american + 100);
  return -american / (-american + 100);
}
function dejuice(over: number | null, under: number | null, side: "over" | "under"): number {
  if (over == null || under == null) {
    return impliedProb(side === "over" ? (over ?? -110) : (under ?? -110));
  }
  const po = impliedProb(over), pu = impliedProb(under);
  const total = po + pu;
  return side === "over" ? po / total : pu / total;
}

// ----- L10 -----
function l10Stats(values: number[], line: number) {
  if (values.length === 0) {
    return { hit: null, avg: null, min: null, max: null, median: null, games: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    hit: values.filter(v => v > line).length / values.length,
    avg, min: sorted[0], max: sorted[sorted.length - 1], median, games: values.length,
  };
}

function tierOf(s: number): "lock" | "strong" | "lean" | null {
  if (s >= TIER_LOCK) return "lock";
  if (s >= TIER_STRONG) return "strong";
  if (s >= TIER_LEAN) return "lean";
  return null;
}

function todayET() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString().slice(0, 10);
}

function parseTeams(gameDesc: string): { home: string; away: string } | null {
  // common formats: "TEAM_A @ TEAM_B" or "TEAM_A vs TEAM_B"
  const m = gameDesc?.match?.(/(.+?)\s+(?:@|vs\.?|at)\s+(.+)/i);
  if (!m) return null;
  return { away: m[1].trim(), home: m[2].trim() };
}

type Boost = { boost: number; reason: string };
function lookupResearchBoost(
  research: Record<string, Awaited<ReturnType<typeof loadResearch>>[string]> | null,
  sportKey: string,
  market: string,
  side: string,
  team?: string,
  player?: string,
  prop?: string,
): Boost {
  if (!research) return { boost: 0, reason: "" };
  const sportName = sportKey.includes("mlb") ? "MLB" :
    sportKey.includes("nhl") ? "NHL" :
    sportKey.includes("ncaab") ? "NCAAB" :
    sportKey.includes("ncaaf") || sportKey.includes("football_ncaa") ? "NCAAF" :
    sportKey.includes("nba") ? "NBA" : null;
  if (!sportName) return { boost: 0, reason: "" };
  const r = research[sportName];
  if (!r) return { boost: 0, reason: "" };
  let boost = 0; const reasons: string[] = [];
  if (market === "player" && player) {
    for (const pb of r.player_boosts ?? []) {
      if (typeof pb?.player !== "string") continue;
      if (pb.player.toLowerCase() === player.toLowerCase()
        && (pb.side === "any" || pb.side === side)) {
        const b = Math.max(-0.10, Math.min(0.10, Number(pb.boost) || 0));
        boost += b; if (pb.reason) reasons.push(pb.reason);
      }
    }
  } else if (team) {
    for (const tb of r.team_boosts ?? []) {
      if (typeof tb?.team !== "string") continue;
      const sameTeam = tb.team.toLowerCase() === team.toLowerCase();
      const sameMarket = tb.market === "any" || tb.market === market;
      const sameSide = tb.side === "any" || tb.side === side;
      if (sameTeam && sameMarket && sameSide) {
        const b = Math.max(-0.10, Math.min(0.10, Number(tb.boost) || 0));
        boost += b; if (tb.reason) reasons.push(tb.reason);
      }
    }
  }
  return { boost: Math.max(-0.10, Math.min(0.10, boost)), reason: reasons.join("; ") };
}

async function loadResearch(supabase: ReturnType<typeof createClient>, date: string) {
  const { data } = await supabase
    .from("bot_research_findings")
    .select("category, key_insights")
    .eq("research_date", date)
    .like("category", "cross_sport_%");
  const out: Record<string, { summary?: string; team_boosts?: Array<{team:string;market:string;side:string;boost:number;reason:string}>; player_boosts?: Array<{player:string;prop_hint?:string;side:string;boost:number;reason:string}> }> = {};
  for (const row of data ?? []) {
    const cat = (row as { category: string }).category;
    const sport = cat.replace("cross_sport_", "").toUpperCase();
    out[sport] = (row as { key_insights: Record<string, unknown> }).key_insights as never;
  }
  return out;
}

// ----- main -----
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const date = todayET();
    const research = await loadResearch(supabase, date);

    // Pull all active props that haven't started yet (+15min buffer)
    const cutoff = new Date(Date.now() + PREGAME_BUFFER_MIN * 60_000).toISOString();
    const { data: props, error } = await supabase
      .from("unified_props")
      .select("event_id, sport, game_description, commence_time, player_name, prop_type, bookmaker, current_line, over_price, under_price, market_type")
      .eq("is_active", true)
      .gte("commence_time", cutoff)
      .limit(10000);
    if (error) throw error;

    // Load today's confirmed MLB probable pitchers — pitcher props are dropped
    // unless the player is listed as today's starter.
    const mlbStarters = new Set<string>();
    {
      const { data: starters } = await supabase
        .from("mlb_pitcher_k_analysis")
        .select("pitcher_name")
        .eq("game_date", date);
      for (const s of starters ?? []) {
        const n = (s as { pitcher_name: string | null }).pitcher_name;
        if (n) mlbStarters.add(n.toLowerCase());
      }
    }
    const dropped = { stale: 0, not_starter: 0, thin_sample_blocked: 0 } as Record<string, number>;

    // Group player props by (sport, player_name) for log batching
    const sportPlayers = new Map<string, Set<string>>();
    for (const p of props ?? []) {
      if ((p as { market_type: string }).market_type !== "player") continue;
      const sp = (p as { sport: string }).sport;
      const pn = (p as { player_name: string | null }).player_name;
      if (!pn) continue;
      if (!sportPlayers.has(sp)) sportPlayers.set(sp, new Set());
      sportPlayers.get(sp)!.add(pn);
    }

    // Load last 30 days of game logs per sport
    const logsCache = new Map<string, Map<string, Record<string, unknown>[]>>();
    const since = new Date(); since.setDate(since.getDate() - 60);
    const sinceStr = since.toISOString().slice(0, 10);
    for (const [sport, players] of sportPlayers) {
      const table = LOG_TABLE_FOR[sport];
      if (!table) continue;
      const playerArr = [...players];
      const map = new Map<string, Record<string, unknown>[]>();
      // chunk in 200s
      for (let i = 0; i < playerArr.length; i += 200) {
        const chunk = playerArr.slice(i, i + 200);
        const { data: logs } = await supabase
          .from(table)
          .select("*")
          .in("player_name", chunk)
          .gte("game_date", sinceStr)
          .order("game_date", { ascending: false });
        for (const row of logs ?? []) {
          const k = (row as { player_name: string }).player_name;
          if (!map.has(k)) map.set(k, []);
          map.get(k)!.push(row as Record<string, unknown>);
        }
      }
      logsCache.set(sport, map);
    }

    const candidates: Record<string, unknown>[] = [];

    for (const raw of props ?? []) {
      const p = raw as {
        event_id: string; sport: string; game_description: string | null;
        commence_time: string | null; player_name: string | null; prop_type: string;
        bookmaker: string | null; current_line: number | null; over_price: number | null;
        under_price: number | null; market_type: string;
      };
      // belt-and-suspenders: filter ran in SQL, re-check in JS
      if (p.commence_time && new Date(p.commence_time).getTime() < Date.now() + PREGAME_BUFFER_MIN * 60_000) {
        dropped.stale++;
        continue;
      }
      // MLB pitcher props require confirmed starter status
      if (p.market_type === "player" && p.sport === "baseball_mlb"
        && p.prop_type?.startsWith("pitcher_")
        && p.player_name
        && !mlbStarters.has(p.player_name.toLowerCase())) {
        dropped.not_starter++;
        continue;
      }
      const teams = parseTeams(p.game_description ?? "");
      if (p.market_type === "player") {
        const mapper = PROP_STAT_MAP[p.sport]?.[p.prop_type];
        const logs = logsCache.get(p.sport)?.get(p.player_name ?? "") ?? [];
        const line = p.current_line ?? 0;
        let values: number[] = [];
        if (mapper) {
          values = logs.slice(0, 10).map(mapper).filter((v): v is number => v !== null);
        }
        const stats = l10Stats(values, line);
        // try both sides; only emit the better
        for (const side of ["over", "under"] as const) {
          const price = side === "over" ? p.over_price : p.under_price;
          if (price == null) continue;
          if (price < MIN_PRICE) continue; // worse than -250
          // all-zero Under guard
          if (side === "under" && values.length >= 3 && values.every(v => v === 0)) continue;
          const thinSample = values.length < MIN_PLAYER_SAMPLE;
          const hitForSide = stats.hit == null || thinSample ? null :
            (side === "over" ? stats.hit : 1 - stats.hit);
          const implied = dejuice(p.over_price, p.under_price, side);
          const modelProb = hitForSide ?? implied;
          const floorMargin = stats.min == null || thinSample ? 0 :
            side === "over" ? clamp01((stats.min - line) / Math.max(1, line)) :
              clamp01((line - stats.max!) / Math.max(1, line));
          const medianMargin = stats.median == null || thinSample ? 0 :
            side === "over" ? clamp01((stats.median - line) / Math.max(1, line + 1)) :
              clamp01((line - stats.median) / Math.max(1, line + 1));
          const edge = clamp01(modelProb - implied + 0.5);
          const rb = lookupResearchBoost(research, p.sport, "player", side, undefined, p.player_name ?? undefined, p.prop_type);
          const safety = clamp01(
            W_HIT * (hitForSide ?? 0) +
            W_FLOOR * floorMargin +
            W_MEDIAN * medianMargin +
            W_EDGE * edge +
            W_RESEARCH * (0.5 + rb.boost * 5) // map -0.10..+0.10 -> 0..1 centered 0.5
          );
          let tier = tierOf(safety);
          // Thin-sample cap: can't earn lock or strong without enough history
          if (thinSample && (tier === "lock" || tier === "strong")) {
            tier = "lean";
            dropped.thin_sample_blocked++;
          }
          if (!tier) continue;
          candidates.push({
            analysis_date: date,
            sport: p.sport,
            market_type: "player",
            event_id: p.event_id,
            game_description: p.game_description,
            commence_time: p.commence_time,
            team: null,
            opponent: null,
            player_name: p.player_name,
            prop_type: p.prop_type,
            recommended_side: side.toUpperCase(),
            recommended_line: line,
            price,
            implied_prob: implied,
            model_confidence: modelProb,
            safety_score: safety,
            tier,
            l10_hit_rate: hitForSide,
            l10_avg: stats.avg,
            l10_min: stats.min,
            l10_max: stats.max,
            l10_median: stats.median,
            games_played: stats.games,
            research_boost: rb.boost,
            research_notes: rb.reason || null,
            bookmaker: p.bookmaker,
          });
        }
      } else {
        // team market
        if (!teams) continue;
        if (p.market_type === "spread" && Math.abs(p.current_line ?? 0) >= MAX_SPREAD_ABS) continue;
        const sides = p.market_type === "total"
          ? [{ side: "OVER", team: null as string | null, opp: null as string | null, price: p.over_price, line: p.current_line }]
              .concat([{ side: "UNDER", team: null, opp: null, price: p.under_price, line: p.current_line }])
          : p.market_type === "spread"
            ? [{ side: "HOME", team: teams.home, opp: teams.away, price: p.over_price, line: p.current_line },
               { side: "AWAY", team: teams.away, opp: teams.home, price: p.under_price, line: p.current_line == null ? null : -p.current_line }]
            : [{ side: "HOME", team: teams.home, opp: teams.away, price: p.over_price, line: null },
               { side: "AWAY", team: teams.away, opp: teams.home, price: p.under_price, line: null }];
        for (const s of sides) {
          if (s.price == null || s.price < MIN_PRICE) continue;
          const implied = impliedProb(s.price);
          // structural bump
          let bump = 0.01;
          if (p.market_type === "moneyline" && s.side === "HOME") bump = 0.04;
          else if (p.market_type === "spread" && s.side === "HOME") bump = 0.03;
          else if (p.market_type === "total" && s.side === "UNDER") bump = 0.02;
          const conf = Math.min(0.85, implied + bump);
          const sideKey = (p.market_type === "total"
            ? (s.side === "OVER" ? "over" : "under")
            : (s.side === "HOME" ? "home" : "away"));
          const rb = lookupResearchBoost(research, p.sport, p.market_type, sideKey, s.team ?? undefined);
          // Rebalanced team-leg safety: anchor to conf, add a small favorite bonus
          // and research weight so fair-priced ML/spread/total favorites can clear
          // the 0.60 lean threshold (e.g. -150 → ~0.67, -200 → ~0.74) while
          // underdogs/pick'ems stay below 0.60.
          const safety = clamp01(
            0.95 * conf
            + 0.05
            + 0.10 * Math.max(0, conf - 0.50)
            + W_RESEARCH * rb.boost * 2.5
          );
          const tier = tierOf(safety);
          if (!tier) continue;
          candidates.push({
            analysis_date: date,
            sport: p.sport,
            market_type: p.market_type,
            event_id: p.event_id,
            game_description: p.game_description,
            commence_time: p.commence_time,
            team: s.team,
            opponent: s.opp,
            player_name: null,
            prop_type: p.prop_type,
            recommended_side: s.side,
            recommended_line: s.line,
            price: s.price,
            implied_prob: implied,
            model_confidence: conf,
            safety_score: safety,
            tier,
            l10_hit_rate: null,
            l10_avg: null, l10_min: null, l10_max: null, l10_median: null,
            games_played: 0,
            research_boost: rb.boost,
            research_notes: rb.reason || null,
            bookmaker: p.bookmaker,
          });
        }
      }
    }

    // Clear today's candidates, then insert fresh
    await supabase.from("cross_sport_sweet_spots").delete().eq("analysis_date", date);
    let inserted = 0;
    for (let i = 0; i < candidates.length; i += 500) {
      const chunk = candidates.slice(i, i + 500);
      const { error: ierr } = await supabase.from("cross_sport_sweet_spots").insert(chunk);
      if (ierr) { console.error("insert error", ierr); break; }
      inserted += chunk.length;
    }

    return new Response(JSON.stringify({
      ok: true, date, total_candidates: candidates.length, inserted,
      by_tier: tally(candidates, "tier"),
      by_sport: tally(candidates, "sport"),
      by_market: tally(candidates, "market_type"),
      dropped,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("cross-sport-sweet-spots error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function tally(rows: Record<string, unknown>[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String((r as Record<string, unknown>)[key] ?? "?");
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}