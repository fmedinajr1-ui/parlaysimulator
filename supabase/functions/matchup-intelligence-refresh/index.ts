// matchup-intelligence-refresh
// Builds/refreshes public.matchup_intelligence rows for today + tomorrow (ET)
// from active unified_props across every supported sport.
//
// Sport handlers (each builds UpRow[]):
//   • basketball_nba      → team_defensive_ratings (points/rebs/asts/3s)
//   • baseball_mlb        → mlb_pitcher_k_analysis  (pitcher + batter sides)
//   • americanfootball_*  → nfl_team_defense_stats  (vs_qb/rb/wr/te ranks)
//   • icehockey_nhl       → nhl_team_defense_rankings (goalie + skater)
//   • basketball_wnba     → team_defense_rankings (sport='WNBA' or NBA fallback)
//   • mma_mixed_*         → currently no per-fighter defense → skipped
// Idempotent upsert keyed by (player, prop_type, side, line, game_date).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function etDateKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(at);
}

// Map NBA/WNBA prop_type → team_defensive_ratings.stat_type
function propToStatType(prop: string): string | null {
  const p = prop.toLowerCase();
  if (p === "points") return "points";
  if (p === "rebounds") return "rebounds";
  if (p === "assists") return "assists";
  if (p === "threes" || p === "3-pt made" || p === "3pt made" || p === "threes made") return "threes";
  if (p === "pts+rebs+asts" || p === "pts+rebs" || p === "pts+asts" || p === "rebs+asts") return "points";
  return null;
}

function parseTeams(gameDescription: string | null): { home: string; away: string } {
  if (!gameDescription) return { home: "", away: "" };
  const m = /^(.+?)\s+@\s+(.+?)$/.exec(gameDescription.trim());
  if (!m) return { home: "", away: "" };
  return { away: m[1].trim(), home: m[2].trim() };
}

/** Returns matchup_score on the OVER side for a given defensive rank.
 *  Rank 1 = best defense (bad for Over). Rank 30 = worst defense (good for Over).
 *  Output range approx -5..+5. */
function defenseRankToScore(rank: number | null | undefined): number {
  if (rank == null || !Number.isFinite(rank)) return 0;
  return Math.max(-5, Math.min(5, (rank - 15.5) / 3));
}

function blowoutFromSpread(spread: number | null | undefined): number {
  if (spread == null) return 0;
  const a = Math.abs(Number(spread));
  if (a >= 14) return 0.85;
  if (a >= 10) return 0.6;
  if (a >= 7)  return 0.4;
  return 0.15;
}

function gameScript(spread: number | null | undefined): string {
  if (spread == null) return "COMPETITIVE";
  const a = Math.abs(Number(spread));
  if (a >= 10) return "BLOWOUT_RISK";
  if (a >= 6) return "MODERATE";
  return "COMPETITIVE";
}

/** Shared shape every sport handler emits. */
type UpRow = {
  player_name: string;
  opponent_team: string;
  prop_type: string;
  side: string;
  line: number;
  game_date: string;
  opponent_defensive_rank: number | null;
  opponent_stat_allowed: number | null;
  matchup_score: number;
  vegas_total: number | null;
  vegas_spread: number | null;
  implied_team_total: number | null;
  blowout_risk: number;
  is_blocked: boolean;
  block_reason: string | null;
  risk_flags: string[];
  confidence_adjustment: number;
  game_script: string;
  position_group?: string | null;
};

type EnvMap = Map<string, { total: number | null; spread: number | null; blowout: number | null }>;

async function loadEnv(supabase: any, dates: string[]): Promise<EnvMap> {
  const m: EnvMap = new Map();
  const { data } = await supabase
    .from("game_environment")
    .select("home_team, away_team, vegas_total, vegas_spread, blowout_probability, game_date")
    .in("game_date", dates);
  for (const g of (data ?? [])) {
    if (!g.home_team || !g.away_team) continue;
    const k = `${String(g.away_team).toLowerCase()}@${String(g.home_team).toLowerCase()}`;
    m.set(k, {
      total: g.vegas_total != null ? Number(g.vegas_total) : null,
      spread: g.vegas_spread != null ? Number(g.vegas_spread) : null,
      blowout: g.blowout_probability != null ? Number(g.blowout_probability) : null,
    });
  }
  return m;
}

function envFor(env: EnvMap, away: string, home: string) {
  return env.get(`${away.toLowerCase()}@${home.toLowerCase()}`) ?? null;
}

// =====================================================================
// NBA handler (kept from original)
// =====================================================================
async function buildNba(supabase: any, dates: string[], env: EnvMap): Promise<{ rows: UpRow[]; skipped: any }> {
  const today = dates[0];
  const { data: props } = await supabase
    .from("unified_props")
    .select("player_name, prop_type, current_line, sport, game_description, commence_time, market_type")
    .eq("is_active", true).eq("sport", "basketball_nba")
    .gt("commence_time", new Date(Date.now() - 30 * 60_000).toISOString())
    .lt("commence_time", new Date(Date.now() + 48 * 3600_000).toISOString());

  const { data: playerRows } = await supabase.from("bdl_player_cache").select("player_name, team_name");
  const playerTeam = new Map<string, string>();
  for (const p of (playerRows ?? [])) if (p.player_name && p.team_name) playerTeam.set(String(p.player_name).toLowerCase(), String(p.team_name));

  const { data: defRows } = await supabase.from("team_defensive_ratings").select("team_name, stat_type, defensive_rank, stat_allowed_per_game, position_group");
  const defByTeamStat = new Map<string, { rank: number; allowed: number | null; position_group: string | null }>();
  for (const d of (defRows ?? [])) {
    if (!d.team_name || !d.stat_type || d.defensive_rank == null) continue;
    const k = `${String(d.team_name).toLowerCase()}|${String(d.stat_type).toLowerCase()}`;
    const prev = defByTeamStat.get(k);
    if (!prev || (d.position_group ?? "") === "all") {
      defByTeamStat.set(k, { rank: Number(d.defensive_rank), allowed: d.stat_allowed_per_game != null ? Number(d.stat_allowed_per_game) : null, position_group: d.position_group ?? null });
    }
  }

  const rows: UpRow[] = [];
  let noStat = 0, noPlayer = 0, noTeam = 0, noDefense = 0;
  for (const p of (props ?? [])) {
    if ((p.market_type ?? "player") !== "player") continue;
    const player = String(p.player_name ?? "");
    const prop = String(p.prop_type ?? "");
    const line = p.current_line != null ? Number(p.current_line) : null;
    if (!player || !prop || line == null) continue;
    const statType = propToStatType(prop);
    if (!statType) { noStat++; continue; }
    const team = playerTeam.get(player.toLowerCase());
    if (!team) { noPlayer++; continue; }
    const { home, away } = parseTeams(p.game_description ?? null);
    if (!home || !away) { noTeam++; continue; }
    const opponent = team.toLowerCase() === home.toLowerCase() ? away
                   : team.toLowerCase() === away.toLowerCase() ? home
                   : (home.toLowerCase().includes(team.toLowerCase()) ? away : home);
    const def = defByTeamStat.get(`${opponent.toLowerCase()}|${statType}`);
    if (!def) { noDefense++; continue; }
    const overScore = defenseRankToScore(def.rank);
    const e = envFor(env, away, home);
    const spread = e?.spread ?? null;
    const blowout = e?.blowout ?? blowoutFromSpread(spread);
    const script = gameScript(spread);
    const gameDate = (p.commence_time ?? "").slice(0, 10) || today;
    for (const side of ["OVER", "UNDER"] as const) {
      const matchup_score = side === "OVER" ? overScore : -overScore;
      const risk_flags: string[] = [];
      if (blowout >= 0.7 && side === "OVER") risk_flags.push("BLOWOUT");
      if (def.rank <= 5 && side === "OVER") risk_flags.push("TOP5_D");
      if (def.rank >= 26 && side === "UNDER") risk_flags.push("BOTTOM5_D");
      const is_blocked = (def.rank <= 3 && side === "OVER") || (blowout >= 0.85 && side === "OVER");
      rows.push({
        player_name: player, opponent_team: opponent, prop_type: prop, side, line, game_date: gameDate,
        opponent_defensive_rank: def.rank, opponent_stat_allowed: def.allowed, matchup_score,
        vegas_total: e?.total ?? null, vegas_spread: spread, implied_team_total: null,
        blowout_risk: blowout,
        is_blocked,
        block_reason: is_blocked ? (blowout >= 0.85 ? `Severe blowout risk (${(blowout * 100).toFixed(0)}%)` : `Elite defense vs ${statType} (rank ${def.rank})`) : null,
        risk_flags,
        confidence_adjustment: Math.max(-0.05, Math.min(0.05, matchup_score / 100)),
        game_script: script,
        position_group: def.position_group ?? "all",
      });
    }
  }
  return { rows, skipped: { noStat, noPlayer, noTeam, noDefense } };
}

// =====================================================================
// MLB handler — pitcher K analysis covers pitcher props directly,
// and opposing-pitcher K/9 quality drives batter prop matchup score.
// =====================================================================
function mlbBatterProps(): Set<string> {
  return new Set([
    "batter_hits", "batter_singles", "batter_doubles", "batter_total_bases",
    "batter_rbis", "batter_runs_scored", "batter_home_runs",
    "batter_hits_runs_rbis", "batter_stolen_bases",
  ]);
}
function mlbPitcherProps(): Set<string> {
  return new Set([
    "pitcher_strikeouts", "pitcher_outs", "pitcher_earned_runs",
    "pitcher_hits_allowed", "pitcher_record_a_win", "batter_strikeouts",
  ]);
}

async function buildMlb(supabase: any, dates: string[], env: EnvMap): Promise<{ rows: UpRow[]; skipped: any }> {
  const { data: props } = await supabase
    .from("unified_props")
    .select("player_name, prop_type, current_line, sport, game_description, commence_time, market_type")
    .eq("is_active", true).eq("sport", "baseball_mlb")
    .gt("commence_time", new Date(Date.now() - 30 * 60_000).toISOString())
    .lt("commence_time", new Date(Date.now() + 48 * 3600_000).toISOString());

  // Pitcher K analysis (last few days) — keyed by (pitcher_name|game_date)
  const { data: pkRows } = await supabase
    .from("mlb_pitcher_k_analysis")
    .select("pitcher_name, team, opponent, game_date, line, pitcher_k9_blended, p_over, edge, tier, block_reason, opp_k_rate_mult, park_k_mult")
    .in("game_date", dates);
  const pkByPitcher = new Map<string, any>();           // pitcher_name → row (latest)
  const pkByTeamDate = new Map<string, any>();          // "team|date" → opposing pitcher row, so batters can xref
  for (const r of (pkRows ?? [])) {
    if (!r.pitcher_name) continue;
    pkByPitcher.set(String(r.pitcher_name).toLowerCase(), r);
    // Index by opponent team (the team this pitcher is throwing AGAINST) so we can look up "what pitcher faces team X today?"
    if (r.opponent && r.game_date) {
      pkByTeamDate.set(`${String(r.opponent).toLowerCase()}|${r.game_date}`, r);
    }
  }

  // Batter team lookup from recent game logs (last 30d)
  const { data: logRows } = await supabase
    .from("mlb_player_game_logs")
    .select("player_name, team, game_date")
    .gte("game_date", new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10))
    .limit(50_000);
  const playerTeam = new Map<string, string>();
  // Take the most recent team per player
  const playerLatest = new Map<string, string>();
  for (const l of (logRows ?? [])) {
    if (!l.player_name || !l.team) continue;
    const key = String(l.player_name).toLowerCase();
    const cur = playerLatest.get(key);
    if (!cur || (l.game_date ?? "") > cur) {
      playerLatest.set(key, l.game_date ?? "");
      playerTeam.set(key, String(l.team));
    }
  }

  const batterSet = mlbBatterProps();
  const pitcherSet = mlbPitcherProps();
  const rows: UpRow[] = [];
  let noPlayer = 0, noTeam = 0, noDefense = 0, noStat = 0;
  const today = dates[0];

  for (const p of (props ?? [])) {
    const player = String(p.player_name ?? "");
    const prop = String(p.prop_type ?? "").toLowerCase();
    const line = p.current_line != null ? Number(p.current_line) : null;
    if (!player || !prop || line == null) continue;

    const gameDate = (p.commence_time ?? "").slice(0, 10) || today;
    const { home, away } = parseTeams(p.game_description ?? null);
    if (!home || !away) { noTeam++; continue; }
    const e = envFor(env, away, home);
    const spread = e?.spread ?? null;
    const blowout = e?.blowout ?? blowoutFromSpread(spread);
    const script = gameScript(spread);

    let pos: "pitcher" | "batter" | null = null;
    if (pitcherSet.has(prop)) pos = "pitcher";
    else if (batterSet.has(prop)) pos = "batter";
    else { noStat++; continue; }

    let overScore = 0;
    let oppRank: number | null = null;
    let oppAllowed: number | null = null;
    let opponent = "";

    if (pos === "pitcher") {
      const pk = pkByPitcher.get(player.toLowerCase());
      if (!pk) { noDefense++; continue; }
      opponent = String(pk.opponent ?? "");
      // p_over from K analysis is directly the pitcher's strikeout-Over probability.
      // Map (p_over - 0.5) * 10 → roughly ±5. For non-K pitcher props, fall back to k9 quality.
      if (prop === "pitcher_strikeouts" && pk.p_over != null) {
        overScore = Math.max(-5, Math.min(5, (Number(pk.p_over) - 0.5) * 10));
      } else if (pk.pitcher_k9_blended != null) {
        // Stronger K-pitchers → Under more likely on hits_allowed/ER/outs Over generally tracks K dominance
        const k9 = Number(pk.pitcher_k9_blended);
        const strength = Math.max(-5, Math.min(5, (k9 - 8.5) * 1.5));
        overScore = (prop === "pitcher_outs" || prop === "pitcher_record_a_win") ? strength : -strength;
      }
      oppAllowed = pk.opp_k_rate_mult != null ? Number(pk.opp_k_rate_mult) : null;
    } else {
      // Batter: opposing pitcher quality matters.
      const team = playerTeam.get(player.toLowerCase());
      if (!team) { noPlayer++; continue; }
      opponent = team.toLowerCase() === home.toLowerCase() ? away
               : team.toLowerCase() === away.toLowerCase() ? home : home;
      const pk = pkByTeamDate.get(`${team.toLowerCase()}|${gameDate}`);
      if (!pk || pk.pitcher_k9_blended == null) { noDefense++; continue; }
      const k9 = Number(pk.pitcher_k9_blended);
      // High-K pitcher (>=10) → hurts batter Overs by ~-3. Weak pitcher (<=7) → +3.
      const strength = Math.max(-5, Math.min(5, (k9 - 8.5) * 1.5));
      overScore = -strength; // tough pitcher fades batter Over
    }

    for (const side of ["OVER", "UNDER"] as const) {
      const matchup_score = side === "OVER" ? overScore : -overScore;
      const risk_flags: string[] = [];
      if (blowout >= 0.7) risk_flags.push("BLOWOUT");
      if (overScore <= -3 && side === "OVER") risk_flags.push("TOUGH_MATCHUP");
      if (overScore >= 3 && side === "OVER") risk_flags.push("PLUS_MATCHUP");
      const is_blocked = overScore <= -4 && side === "OVER";
      rows.push({
        player_name: player, opponent_team: opponent, prop_type: p.prop_type, side, line, game_date: gameDate,
        opponent_defensive_rank: oppRank, opponent_stat_allowed: oppAllowed, matchup_score,
        vegas_total: e?.total ?? null, vegas_spread: spread, implied_team_total: null,
        blowout_risk: blowout, is_blocked,
        block_reason: is_blocked ? `Elite opposing pitcher matchup (score ${overScore.toFixed(1)})` : null,
        risk_flags,
        confidence_adjustment: Math.max(-0.05, Math.min(0.05, matchup_score / 100)),
        game_script: script,
        position_group: pos,
      });
    }
  }
  return { rows, skipped: { noStat, noPlayer, noTeam, noDefense } };
}

// =====================================================================
// NFL / NCAAF handler — vs_qb/rb/wr/te ranks
// =====================================================================
function nflPropPosition(prop: string): "QB" | "RB" | "WR" | "TE" | null {
  const p = prop.toLowerCase();
  if (p.startsWith("player_pass") || p === "player_anytime_td" && false) return "QB";
  if (p.includes("pass_")) return "QB";
  if (p.includes("rush_")) return "RB";
  if (p.includes("reception") || p.includes("receiving_")) return "WR";
  return null;
}
function nflRankCol(pos: "QB" | "RB" | "WR" | "TE"): string {
  return pos === "QB" ? "vs_qb_rank" : pos === "RB" ? "vs_rb_rank" : pos === "WR" ? "vs_wr_rank" : "vs_te_rank";
}

async function buildNfl(supabase: any, dates: string[], env: EnvMap, sport: "americanfootball_nfl" | "americanfootball_ncaaf"): Promise<{ rows: UpRow[]; skipped: any }> {
  const today = dates[0];
  const { data: props } = await supabase
    .from("unified_props")
    .select("player_name, prop_type, current_line, sport, game_description, commence_time, market_type")
    .eq("is_active", true).eq("sport", sport)
    .gt("commence_time", new Date(Date.now() - 30 * 60_000).toISOString())
    .lt("commence_time", new Date(Date.now() + 48 * 3600_000).toISOString());

  const { data: defRows } = await supabase
    .from("nfl_team_defense_stats")
    .select("team_abbrev, team_name, vs_qb_rank, vs_rb_rank, vs_wr_rank, vs_te_rank, overall_defense_rank, points_allowed_per_game");
  const defByTeam = new Map<string, any>();
  for (const d of (defRows ?? [])) {
    if (d.team_name) defByTeam.set(String(d.team_name).toLowerCase(), d);
    if (d.team_abbrev) defByTeam.set(String(d.team_abbrev).toLowerCase(), d);
  }

  const rows: UpRow[] = [];
  let noStat = 0, noPlayer = 0, noTeam = 0, noDefense = 0;
  for (const p of (props ?? [])) {
    if ((p.market_type ?? "player") !== "player") continue;
    const player = String(p.player_name ?? "");
    const prop = String(p.prop_type ?? "");
    const line = p.current_line != null ? Number(p.current_line) : null;
    if (!player || !prop || line == null) continue;
    const pos = nflPropPosition(prop);
    if (!pos) { noStat++; continue; }
    const { home, away } = parseTeams(p.game_description ?? null);
    if (!home || !away) { noTeam++; continue; }
    // We don't have a player→team map for NFL here; use both teams' defense as candidate, prefer the one with worse rank match — fallback to home.
    const dHome = defByTeam.get(home.toLowerCase());
    const dAway = defByTeam.get(away.toLowerCase());
    const candidates = [dHome, dAway].filter(Boolean);
    if (!candidates.length) { noDefense++; continue; }
    // Without team mapping we can't know opponent. Skip if both teams missing; otherwise pick the side whose defense rank is more extreme to be informative.
    const def = candidates.length === 1 ? candidates[0] : (Math.abs((dHome[nflRankCol(pos)] ?? 16) - 16) > Math.abs((dAway[nflRankCol(pos)] ?? 16) - 16) ? dHome : dAway);
    const opponent = def === dHome ? home : away;
    const rank = def[nflRankCol(pos)] ?? def.overall_defense_rank ?? null;
    if (rank == null) { noDefense++; continue; }
    const overScore = defenseRankToScore(rank);
    const e = envFor(env, away, home);
    const spread = e?.spread ?? null;
    const blowout = e?.blowout ?? blowoutFromSpread(spread);
    const script = gameScript(spread);
    const gameDate = (p.commence_time ?? "").slice(0, 10) || today;
    for (const side of ["OVER", "UNDER"] as const) {
      const matchup_score = side === "OVER" ? overScore : -overScore;
      const risk_flags: string[] = [];
      if (rank <= 5 && side === "OVER") risk_flags.push("TOP5_D");
      if (rank >= 26 && side === "UNDER") risk_flags.push("BOTTOM5_D");
      const is_blocked = rank <= 3 && side === "OVER";
      rows.push({
        player_name: player, opponent_team: opponent, prop_type: prop, side, line, game_date: gameDate,
        opponent_defensive_rank: rank, opponent_stat_allowed: def.points_allowed_per_game ?? null, matchup_score,
        vegas_total: e?.total ?? null, vegas_spread: spread, implied_team_total: null,
        blowout_risk: blowout, is_blocked,
        block_reason: is_blocked ? `Top-3 D vs ${pos} (rank ${rank})` : null,
        risk_flags,
        confidence_adjustment: Math.max(-0.05, Math.min(0.05, matchup_score / 100)),
        game_script: script,
        position_group: pos,
      });
    }
  }
  return { rows, skipped: { noStat, noPlayer, noTeam, noDefense } };
}

// =====================================================================
// NHL handler — goals_against / shots_against rank drives the score.
// =====================================================================
function nhlPropKind(prop: string): "shots" | "goals" | "points" | "saves" | null {
  const p = prop.toLowerCase();
  if (p.includes("shots_on_goal") || p.includes("shots")) return "shots";
  if (p.includes("goal_scorer") || p.includes("anytime_goal") || p === "player_goals") return "goals";
  if (p.includes("points")) return "points";
  if (p.includes("saves")) return "saves";
  return null;
}

async function buildNhl(supabase: any, dates: string[], env: EnvMap): Promise<{ rows: UpRow[]; skipped: any }> {
  const today = dates[0];
  const { data: props } = await supabase
    .from("unified_props")
    .select("player_name, prop_type, current_line, sport, game_description, commence_time, market_type")
    .eq("is_active", true).eq("sport", "icehockey_nhl")
    .gt("commence_time", new Date(Date.now() - 30 * 60_000).toISOString())
    .lt("commence_time", new Date(Date.now() + 48 * 3600_000).toISOString());

  const { data: defRows } = await supabase
    .from("nhl_team_defense_rankings")
    .select("team_abbrev, team_name, goals_against_rank, shots_against_rank, goals_against_per_game, shots_against_per_game");
  const defByTeam = new Map<string, any>();
  for (const d of (defRows ?? [])) {
    if (d.team_name) defByTeam.set(String(d.team_name).toLowerCase(), d);
    if (d.team_abbrev) defByTeam.set(String(d.team_abbrev).toLowerCase(), d);
  }

  const rows: UpRow[] = [];
  let noStat = 0, noPlayer = 0, noTeam = 0, noDefense = 0;
  for (const p of (props ?? [])) {
    if ((p.market_type ?? "player") !== "player") continue;
    const player = String(p.player_name ?? "");
    const prop = String(p.prop_type ?? "");
    const line = p.current_line != null ? Number(p.current_line) : null;
    if (!player || !prop || line == null) continue;
    const kind = nhlPropKind(prop);
    if (!kind) { noStat++; continue; }
    const { home, away } = parseTeams(p.game_description ?? null);
    if (!home || !away) { noTeam++; continue; }
    const dHome = defByTeam.get(home.toLowerCase()), dAway = defByTeam.get(away.toLowerCase());
    const candidates = [dHome, dAway].filter(Boolean);
    if (!candidates.length) { noDefense++; continue; }
    const rankCol = kind === "shots" || kind === "saves" ? "shots_against_rank" : "goals_against_rank";
    const def = candidates.length === 1 ? candidates[0]
      : (Math.abs((dHome[rankCol] ?? 16) - 16) > Math.abs((dAway[rankCol] ?? 16) - 16) ? dHome : dAway);
    const opponent = def === dHome ? home : away;
    const rank = def[rankCol] ?? null;
    if (rank == null) { noDefense++; continue; }
    // For saves prop: high shots_against_rank (=allows many shots) → MORE saves expected → +score
    const overScore = kind === "saves" ? defenseRankToScore(rank) * -1 : defenseRankToScore(rank);
    const e = envFor(env, away, home);
    const spread = e?.spread ?? null;
    const blowout = e?.blowout ?? blowoutFromSpread(spread);
    const script = gameScript(spread);
    const gameDate = (p.commence_time ?? "").slice(0, 10) || today;
    for (const side of ["OVER", "UNDER"] as const) {
      const matchup_score = side === "OVER" ? overScore : -overScore;
      const is_blocked = rank <= 3 && side === "OVER" && kind !== "saves";
      rows.push({
        player_name: player, opponent_team: opponent, prop_type: prop, side, line, game_date: gameDate,
        opponent_defensive_rank: rank, opponent_stat_allowed: def[`${rankCol.replace("_rank","_per_game")}`] ?? null,
        matchup_score, vegas_total: e?.total ?? null, vegas_spread: spread, implied_team_total: null,
        blowout_risk: blowout, is_blocked,
        block_reason: is_blocked ? `Top-3 NHL ${kind} D (rank ${rank})` : null,
        risk_flags: [],
        confidence_adjustment: Math.max(-0.05, Math.min(0.05, matchup_score / 100)),
        game_script: script,
        position_group: kind,
      });
    }
  }
  return { rows, skipped: { noStat, noPlayer, noTeam, noDefense } };
}

// =====================================================================
// WNBA handler — reuses team_defense_rankings (sport='WNBA') if present;
// shapes match the NBA pipeline.
// =====================================================================
async function buildWnba(supabase: any, dates: string[], env: EnvMap): Promise<{ rows: UpRow[]; skipped: any }> {
  const today = dates[0];
  const { data: props } = await supabase
    .from("unified_props")
    .select("player_name, prop_type, current_line, sport, game_description, commence_time, market_type")
    .eq("is_active", true).eq("sport", "basketball_wnba")
    .gt("commence_time", new Date(Date.now() - 30 * 60_000).toISOString())
    .lt("commence_time", new Date(Date.now() + 48 * 3600_000).toISOString());

  const { data: defRows } = await supabase
    .from("team_defense_rankings")
    .select("team_abbreviation, team_name, sport, opp_points_rank, opp_rebounds_rank, opp_assists_rank, opp_threes_rank")
    .eq("sport", "WNBA").eq("is_current", true);
  const defByTeam = new Map<string, any>();
  for (const d of (defRows ?? [])) {
    if (d.team_name) defByTeam.set(String(d.team_name).toLowerCase(), d);
    if (d.team_abbreviation) defByTeam.set(String(d.team_abbreviation).toLowerCase(), d);
  }

  const rows: UpRow[] = [];
  let noStat = 0, noPlayer = 0, noTeam = 0, noDefense = 0;
  for (const p of (props ?? [])) {
    if ((p.market_type ?? "player") !== "player") continue;
    const player = String(p.player_name ?? "");
    const prop = String(p.prop_type ?? "");
    const line = p.current_line != null ? Number(p.current_line) : null;
    if (!player || !prop || line == null) continue;
    const statType = propToStatType(prop);
    if (!statType) { noStat++; continue; }
    const { home, away } = parseTeams(p.game_description ?? null);
    if (!home || !away) { noTeam++; continue; }
    const dHome = defByTeam.get(home.toLowerCase()), dAway = defByTeam.get(away.toLowerCase());
    const candidates = [dHome, dAway].filter(Boolean);
    if (!candidates.length) { noDefense++; continue; }
    const rankCol = statType === "points" ? "opp_points_rank" : statType === "rebounds" ? "opp_rebounds_rank" : statType === "assists" ? "opp_assists_rank" : "opp_threes_rank";
    const def = candidates.length === 1 ? candidates[0]
      : (Math.abs((dHome[rankCol] ?? 6) - 6) > Math.abs((dAway[rankCol] ?? 6) - 6) ? dHome : dAway);
    const opponent = def === dHome ? home : away;
    const rank = def[rankCol] ?? null;
    if (rank == null) { noDefense++; continue; }
    const overScore = defenseRankToScore(rank);
    const e = envFor(env, away, home);
    const spread = e?.spread ?? null;
    const blowout = e?.blowout ?? blowoutFromSpread(spread);
    const gameDate = (p.commence_time ?? "").slice(0, 10) || today;
    for (const side of ["OVER", "UNDER"] as const) {
      const matchup_score = side === "OVER" ? overScore : -overScore;
      const is_blocked = rank <= 2 && side === "OVER";
      rows.push({
        player_name: player, opponent_team: opponent, prop_type: prop, side, line, game_date: gameDate,
        opponent_defensive_rank: rank, opponent_stat_allowed: null, matchup_score,
        vegas_total: e?.total ?? null, vegas_spread: spread, implied_team_total: null,
        blowout_risk: blowout, is_blocked,
        block_reason: is_blocked ? `Top-2 WNBA D vs ${statType} (rank ${rank})` : null,
        risk_flags: [],
        confidence_adjustment: Math.max(-0.05, Math.min(0.05, matchup_score / 100)),
        game_script: gameScript(spread),
        position_group: "all",
      });
    }
  }
  return { rows, skipped: { noStat, noPlayer, noTeam, noDefense } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: { dry_run?: boolean; dates?: string[]; sports?: string[] } = {};
    try { body = await req.json(); } catch { /* allow empty */ }
    const dry = body.dry_run === true;

    const today = etDateKey();
    const tomorrow = etDateKey(new Date(Date.now() + 24 * 3600_000));
    const dates = body.dates && body.dates.length ? body.dates : [today, tomorrow];
    const env = await loadEnv(supabase, dates);
    const enabled = new Set((body.sports ?? ["NBA","MLB","NFL","NCAAF","NHL","WNBA"]).map(s => s.toUpperCase()));

    const all: UpRow[] = [];
    const per: Record<string, any> = {};
    if (enabled.has("NBA"))    { const r = await buildNba(supabase, dates, env);  per.NBA = { built: r.rows.length, skipped: r.skipped }; all.push(...r.rows); }
    if (enabled.has("MLB"))    { const r = await buildMlb(supabase, dates, env);  per.MLB = { built: r.rows.length, skipped: r.skipped }; all.push(...r.rows); }
    if (enabled.has("NFL"))    { const r = await buildNfl(supabase, dates, env, "americanfootball_nfl");   per.NFL = { built: r.rows.length, skipped: r.skipped }; all.push(...r.rows); }
    if (enabled.has("NCAAF"))  { const r = await buildNfl(supabase, dates, env, "americanfootball_ncaaf"); per.NCAAF = { built: r.rows.length, skipped: r.skipped }; all.push(...r.rows); }
    if (enabled.has("NHL"))    { const r = await buildNhl(supabase, dates, env);  per.NHL = { built: r.rows.length, skipped: r.skipped }; all.push(...r.rows); }
    if (enabled.has("WNBA"))   { const r = await buildWnba(supabase, dates, env); per.WNBA = { built: r.rows.length, skipped: r.skipped }; all.push(...r.rows); }

    console.log(`[matchup-refresh] built ${all.length} total rows across sports`, per);

    const upserts = all;
    let upserted = 0;
    if (!dry && upserts.length > 0) {
      // Chunk to keep payloads small.
      const chunkSize = 500;
      for (let i = 0; i < upserts.length; i += chunkSize) {
        const chunk = upserts.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("matchup_intelligence")
          .upsert(chunk, { onConflict: "player_name,prop_type,side,line,game_date" });
        if (error) {
          // Fallback: try without onConflict (table may lack unique idx) — delete-then-insert per date.
          console.warn("[matchup-refresh] upsert error, falling back to delete+insert:", error.message);
          const datesInChunk = Array.from(new Set(chunk.map(r => r.game_date)));
          await supabase.from("matchup_intelligence").delete().in("game_date", datesInChunk);
          const { error: insErr } = await supabase.from("matchup_intelligence").insert(chunk);
          if (insErr) throw new Error(`insert fallback failed: ${insErr.message}`);
        }
        upserted += chunk.length;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dry,
      dates,
      sports: [...enabled],
      per_sport: per,
      rows_built: upserts.length,
      rows_upserted: upserted,
      duration_ms: Date.now() - startedAt,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[matchup-refresh] error:", msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});