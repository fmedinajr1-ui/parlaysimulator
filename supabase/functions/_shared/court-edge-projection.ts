// Court.Edge — pure projection engine. No I/O. Importable by edge functions and tests.

export type Surface = "clay" | "hard" | "grass";
export type SetsFormat = "bo3" | "bo5";

export interface WeatherInput {
  temp_f?: number | null;
  humidity?: number | null;
  wind_mph?: number | null;
}

export interface ProjectionInput {
  p1_l3: number[];          // last-3 match game totals for player 1 (most recent first)
  p2_l3: number[];          // last-3 match game totals for player 2 (most recent first)
  surface: Surface;
  sets_format: SetsFormat;
  ml_home?: number | null;  // American odds, home/p1
  ml_away?: number | null;  // American odds, away/p2
  weather?: WeatherInput | null;
  indoor?: boolean;
  // Role-driven, player-specific game adjustments. Pure additives — never re-multiplied.
  role_adj_home?: number | null;
  role_adj_away?: number | null;
}

export interface ProjectionBreakdown {
  base_l3: number;
  surface_mult: number;
  sets_mult: number;
  spread_adj: number;
  weather_adj: number;
  indoor_adj: number;
  role_adj_home: number;
  role_adj_away: number;
  projection: number;
}

const WEIGHTS = [0.5, 0.3, 0.2];

export function weightedL3(matches: number[]): number {
  if (!matches || matches.length === 0) return NaN;
  const slice = matches.slice(0, 3);
  let total = 0;
  let wsum = 0;
  for (let i = 0; i < slice.length; i += 1) {
    total += slice[i] * WEIGHTS[i];
    wsum += WEIGHTS[i];
  }
  return total / wsum; // re-normalise when fewer than 3 matches
}

export function surfaceMult(s: Surface): number {
  if (s === "clay") return 1.08;
  if (s === "grass") return 0.92;
  return 1.0;
}

export function setsMult(f: SetsFormat): number {
  return f === "bo5" ? 1.7 : 1.0;
}

// American odds → no-vig implied probability
function americanToProb(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return -odds / (-odds + 100);
}

export function spreadAdj(mlHome?: number | null, mlAway?: number | null): number {
  if (mlHome == null || mlAway == null || !Number.isFinite(mlHome) || !Number.isFinite(mlAway)) return 0;
  const pH = americanToProb(mlHome);
  const pA = americanToProb(mlAway);
  const sum = pH + pA;
  if (sum <= 0) return 0;
  const nH = pH / sum; // de-vig
  const nA = pA / sum;
  return -2.5 * Math.abs(nH - nA);
}

export function weatherAdj(w?: WeatherInput | null): number {
  if (!w) return 0;
  let adj = 0;
  if (typeof w.temp_f === "number") {
    if (w.temp_f > 85) adj += 0.3;
    if (w.temp_f < 50) adj -= 0.4;
  }
  if (typeof w.wind_mph === "number" && w.wind_mph > 15) adj -= 0.5;
  if (typeof w.humidity === "number" && w.humidity > 70) adj -= 0.2;
  return adj;
}

export function indoorAdj(isIndoor?: boolean): number {
  return isIndoor ? -0.5 : 0;
}

export function project(input: ProjectionInput): ProjectionBreakdown {
  const w1 = weightedL3(input.p1_l3);
  const w2 = weightedL3(input.p2_l3);
  const base = (w1 + w2) / 2;
  const sm = surfaceMult(input.surface);
  const sf = setsMult(input.sets_format);
  const sa = spreadAdj(input.ml_home, input.ml_away);
  const wa = weatherAdj(input.weather);
  const ia = indoorAdj(input.indoor);
  const rh = Number.isFinite(input.role_adj_home as number) ? (input.role_adj_home as number) : 0;
  const ra = Number.isFinite(input.role_adj_away as number) ? (input.role_adj_away as number) : 0;
  const projection = base * sm * sf + sa + wa + ia + rh + ra;
  return {
    base_l3: base,
    surface_mult: sm,
    sets_mult: sf,
    spread_adj: sa,
    weather_adj: wa,
    indoor_adj: ia,
    role_adj_home: rh,
    role_adj_away: ra,
    projection,
  };
}

export type Verdict =
  | "STRONG_OVER"
  | "LEAN_OVER"
  | "PASS"
  | "LEAN_UNDER"
  | "STRONG_UNDER"
  | "QUARANTINE";

import { devigPair, modelProbOver, EDGE_HARD_CAP_PP } from "./court-edge-edge.ts";

// Phase 1 placeholder thresholds in PROBABILITY POINTS. Phase 4 refines the
// promotion rules (multi-book agreement, weather present, calibrated tier).
const STRONG_PP = 0.04;
const LEAN_PP = 0.02;

export function verdictFromEdgePp(edgePp: number): Verdict {
  if (!Number.isFinite(edgePp)) return "PASS";
  const a = Math.abs(edgePp);
  if (a > EDGE_HARD_CAP_PP) return "QUARANTINE";
  if (a >= STRONG_PP) return edgePp > 0 ? "STRONG_OVER" : "STRONG_UNDER";
  if (a >= LEAN_PP) return edgePp > 0 ? "LEAN_OVER" : "LEAN_UNDER";
  return "PASS";
}

export interface EdgeOpts {
  over_price?: number | null;
  under_price?: number | null;
  sigma: number;
}

export interface EdgeResult {
  reference: number;
  // Legacy fields kept so existing dashboards/columns keep populating.
  // edge / edge_pct now mean PROBABILITY POINTS, not relative %.
  edge: number;
  edge_pct: number;
  // New devigged-edge fields:
  model_prob_over: number;
  model_prob_under: number;
  vig_free_implied_over: number | null;
  vig_free_implied_under: number | null;
  edge_pp: number;
  edge_side: "over" | "under" | "none";
  verdict: Verdict;
  quarantine_reason?: string;
}

export function edgeFor(
  market: "match_total" | "player_total_games",
  projection: number,
  line: number,
  opts: EdgeOpts,
): EdgeResult {
  // For player_total_games, the projection (a MATCH total) is split in half.
  const reference = market === "player_total_games" ? projection / 2 : projection;
  const sigma = market === "player_total_games" ? Math.max(opts.sigma / 2, 0.5) : opts.sigma;

  const pOver = modelProbOver(reference, line, sigma);
  const pUnder = 1 - pOver;
  const fair = devigPair(opts.over_price, opts.under_price);

  // Without prices we can't compute an honest devigged edge → PASS, no fake edge.
  if (!fair) {
    return {
      reference,
      edge: 0,
      edge_pct: 0,
      model_prob_over: pOver,
      model_prob_under: pUnder,
      vig_free_implied_over: null,
      vig_free_implied_under: null,
      edge_pp: 0,
      edge_side: "none",
      verdict: "PASS",
    };
  }

  const edgeOver = pOver - fair.p_over_fair;
  const edgeUnder = pUnder - fair.p_under_fair;
  let edge_pp: number;
  let edge_side: "over" | "under";
  if (edgeOver >= edgeUnder) { edge_pp = edgeOver; edge_side = "over"; }
  else { edge_pp = -edgeUnder; edge_side = "under"; } // sign convention: + over, − under

  const verdict = verdictFromEdgePp(edge_pp);
  const quarantine_reason = verdict === "QUARANTINE" ? "edge_above_hard_cap" : undefined;

  return {
    reference,
    edge: edge_pp,
    edge_pct: edge_pp * 100, // legacy column — now reads as percentage points
    model_prob_over: pOver,
    model_prob_under: pUnder,
    vig_free_implied_over: fair.p_over_fair,
    vig_free_implied_under: fair.p_under_fair,
    edge_pp,
    edge_side,
    verdict,
    quarantine_reason,
  };
}