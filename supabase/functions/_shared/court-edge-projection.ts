// Court.Edge — pure projection engine. No I/O. Importable by edge functions and tests.

import { priorFor, type Tour as PriorTour, type Sets as PriorSets, type Surface as PriorSurface } from "./court-edge-prior.ts";

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
  // Phase 2: tour drives prior lookup. Optional for back-compat; default 'unknown' → WTA row.
  tour?: "atp" | "wta" | "unknown";
}

export interface ProjectionBreakdown {
  base_l3: number;
  /** @deprecated Phase 2 — kept at 1.0 for back-compat. Surface/sets effect now lives in the prior. */
  surface_mult: number;
  /** @deprecated Phase 2 — kept at 1.0 for back-compat. */
  sets_mult: number;
  spread_adj: number;
  weather_adj: number;
  indoor_adj: number;
  role_adj_home: number;
  role_adj_away: number;
  projection: number;
  // Phase 2 additions:
  prior_mu: number;
  prior_sd: number;
  delta_l3: number;
  shrunk: number;
  blowout_adj: number;
  spread_adj_v2: number;
  clamped: boolean;
}

const WEIGHTS = [0.5, 0.3, 0.2];
// Phase 2 tunables — keep as a constants block for easy adjustment without a redeploy chain.
const SHRINK_K = 4;                 // virtual matches pulling toward the prior
const BLOWOUT_CUTOFF_BO3 = 14;      // Bo3 match total ≤ this → recent blowout flag
const BLOWOUT_CUTOFF_BO5 = 22;
const BLOWOUT_PENALTY = 0.5;        // games subtracted per flagged player
const SANITY_SIGMAS = 3;            // ±Nσ around prior mean

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

// Phase 2 — two-sided spread adjustment with a coin-flip OVER bias and a
// harder cap on lopsided favourites.
export function spreadAdjV2(mlHome?: number | null, mlAway?: number | null): number {
  if (mlHome == null || mlAway == null || !Number.isFinite(mlHome) || !Number.isFinite(mlAway)) return 0;
  const pH = americanToProb(mlHome);
  const pA = americanToProb(mlAway);
  const sum = pH + pA;
  if (sum <= 0) return 0;
  const nH = pH / sum;
  const nA = pA / sum;
  const diff = Math.abs(nH - nA);
  let adj: number;
  if (diff < 0.10) adj = 0.6;
  else adj = -3.0 * (diff - 0.10) / 0.40;
  if (adj > 0.8) adj = 0.8;
  if (adj < -3.0) adj = -3.0;
  return adj;
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

  // Phase 2: prior-based recompose + Bayesian shrink toward prior mean.
  const tour: PriorTour = (input.tour ?? "unknown") as PriorTour;
  const sets: PriorSets = input.sets_format === "bo5" ? "bo5" : "bo3";
  const surf: PriorSurface = (input.indoor ? "indoor" : (input.surface as PriorSurface));
  const prior = priorFor(tour, sets, surf);

  // Each player's L3-half contribution vs prior half → recompose around the prior mean.
  const half = prior.mu / 2;
  const halfP1 = Number.isFinite(w1) ? w1 / 2 : half;
  const halfP2 = Number.isFinite(w2) ? w2 / 2 : half;
  const delta_l3 = (halfP1 - half) + (halfP2 - half); // signed game delta
  const combined = prior.mu + delta_l3;

  const n_eff = Math.min((input.p1_l3?.length ?? 0) + (input.p2_l3?.length ?? 0), 6);
  const shrunk = (n_eff * combined + SHRINK_K * prior.mu) / (n_eff + SHRINK_K);

  const sa_v2 = spreadAdjV2(input.ml_home, input.ml_away);
  // Keep legacy spread_adj field populated (now equals v2) so existing callers keep getting a number.
  const sa = sa_v2;
  const wa = weatherAdj(input.weather);
  const ia = indoorAdj(input.indoor);
  const rh = Number.isFinite(input.role_adj_home as number) ? (input.role_adj_home as number) : 0;
  const ra = Number.isFinite(input.role_adj_away as number) ? (input.role_adj_away as number) : 0;

  // Blowout-recency penalty.
  const cutoff = sets === "bo5" ? BLOWOUT_CUTOFF_BO5 : BLOWOUT_CUTOFF_BO3;
  let blowout_adj = 0;
  if (Array.isArray(input.p1_l3) && input.p1_l3.length > 0 && input.p1_l3[0] <= cutoff) blowout_adj -= BLOWOUT_PENALTY;
  if (Array.isArray(input.p2_l3) && input.p2_l3.length > 0 && input.p2_l3[0] <= cutoff) blowout_adj -= BLOWOUT_PENALTY;

  let projection = shrunk + sa + wa + ia + rh + ra + blowout_adj;

  // Sanity clamp to prior ± Nσ.
  const lo = prior.mu - SANITY_SIGMAS * prior.sd;
  const hi = prior.mu + SANITY_SIGMAS * prior.sd;
  let clamped = false;
  if (projection < lo) { projection = lo; clamped = true; }
  else if (projection > hi) { projection = hi; clamped = true; }

  return {
    base_l3: base,
    surface_mult: 1,
    sets_mult: 1,
    spread_adj: sa,
    weather_adj: wa,
    indoor_adj: ia,
    role_adj_home: rh,
    role_adj_away: ra,
    projection,
    prior_mu: prior.mu,
    prior_sd: prior.sd,
    delta_l3,
    shrunk,
    blowout_adj,
    spread_adj_v2: sa_v2,
    clamped,
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
import { thresholdsFor, type TournamentTier } from "./court-edge-tournament-tier.ts";
import { priorFor, type Tour as PriorTour2, type Sets as PriorSets2 } from "./court-edge-prior.ts";

// Phase 1 placeholder thresholds in PROBABILITY POINTS. Phase 4 refines the
// promotion rules (multi-book agreement, weather present, calibrated tier).
const STRONG_PP = 0.04;
const LEAN_PP = 0.02;

export function verdictFromEdgePp(edgePp: number, tier?: TournamentTier): Verdict {
  if (!Number.isFinite(edgePp)) return "PASS";
  const a = Math.abs(edgePp);
  if (a > EDGE_HARD_CAP_PP) return "QUARANTINE";
  if (tier) {
    const t = thresholdsFor(tier);
    if (t.auto_quarantine) return "QUARANTINE";
    if (a >= t.strong_pp) return edgePp > 0 ? "STRONG_OVER" : "STRONG_UNDER";
    if (a >= t.lean_pp) return edgePp > 0 ? "LEAN_OVER" : "LEAN_UNDER";
    return "PASS";
  }
  if (a >= STRONG_PP) return edgePp > 0 ? "STRONG_OVER" : "STRONG_UNDER";
  if (a >= LEAN_PP) return edgePp > 0 ? "LEAN_OVER" : "LEAN_UNDER";
  return "PASS";
}

export interface EdgeOpts {
  over_price?: number | null;
  under_price?: number | null;
  sigma: number;
  // Phase 3: optional context for tier-calibrated tiers and line-range gating.
  tier?: TournamentTier;
  tour?: "atp" | "wta" | "unknown";
  sets_format?: SetsFormat;
  surface?: Surface;
  indoor?: boolean;
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

  // Phase 3 — line-range quarantine. Reject implausibly-priced lines BEFORE
  // measuring edge so a broken book line doesn't masquerade as a model edge.
  const sets: PriorSets2 = opts.sets_format === "bo5" ? "bo5" : "bo3";
  const surf = (opts.indoor ? "indoor" : (opts.surface ?? "unknown")) as any;
  const prior = priorFor((opts.tour ?? "unknown") as PriorTour2, sets, surf);
  let outOfRange = false;
  let outOfRangeReason: string | undefined;
  if (Number.isFinite(line)) {
    if (market === "match_total") {
      if (Math.abs(line - prior.mu) > 2.5 * prior.sd) {
        outOfRange = true;
        outOfRangeReason = "line_outside_prior_band";
      }
    } else {
      const lo = 6;
      const hi = sets === "bo5" ? 24 : 16;
      if (line < lo || line > hi) {
        outOfRange = true;
        outOfRangeReason = "line_out_of_range";
      }
    }
  }

  const pOver = modelProbOver(reference, line, sigma);
  const pUnder = 1 - pOver;
  const fair = devigPair(opts.over_price, opts.under_price);

  if (outOfRange) {
    return {
      reference,
      edge: 0,
      edge_pct: 0,
      model_prob_over: pOver,
      model_prob_under: pUnder,
      vig_free_implied_over: fair?.p_over_fair ?? null,
      vig_free_implied_under: fair?.p_under_fair ?? null,
      edge_pp: 0,
      edge_side: "none",
      verdict: "QUARANTINE",
      quarantine_reason: outOfRangeReason,
    };
  }

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

  const verdict = verdictFromEdgePp(edge_pp, opts.tier);
  const quarantine_reason = verdict === "QUARANTINE"
    ? (Math.abs(edge_pp) > EDGE_HARD_CAP_PP ? "edge_above_hard_cap" : "tier_auto_quarantine")
    : undefined;

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