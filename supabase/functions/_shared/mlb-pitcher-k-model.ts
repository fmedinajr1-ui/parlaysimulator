/**
 * mlb-pitcher-k-model.ts
 *
 * Pure-math model for the Pitcher Strikeouts OVER market ("Ace Edge").
 * Replacement for the retired team No-HR model — single-actor (pitcher
 * only), so far less variance than 9-batter HR exposure.
 *
 * expected_K = K9_blended * expected_IP * opp_K_rate_mult * park_K_mult
 * p_over     = P(K > line) under Poisson(λ = expected_K)
 */

export interface PitcherKInput {
  pitcherName: string;
  team: string;
  opponent: string;
  homeTeam: string;
  line: number | null;          // sportsbook K line; null = no line posted
  pitcherK9L5: number | null;   // L5 starts K/9
  pitcherK9Season: number | null;
  pitcherStartsSeason: number;  // sample size
  expectedIP: number;           // L10 avg IP per start (cap 7.0)
  oppKRateSeason: number | null;// opponent team K% (e.g. 0.235)
  leagueAvgKRate?: number;      // default 0.225
  parkKMult?: number;           // default 1.0
  weatherRainRisk?: boolean;    // true => block (early hook)
}

export interface PitcherKResult {
  expectedK: number;
  pOver: number;
  edge: number;                 // pOver - implied_prob(line at -115)
  k9Blended: number;
  oppKRateMult: number;
  parkKMult: number;
  tier: "S" | "A" | "PASS";
  blockReason: string | null;
  confidenceScore: number;
}

const LEAGUE_AVG_K_RATE_DEFAULT = 0.225;
const PRIOR_STARTS = 5;
const IP_CAP = 7.0;
const IMPLIED_AT_MINUS_115 = 115 / (115 + 100); // ~0.535

// Cushion requirements — fixes the "miss by 1" leak. Lines are set just
// above expectation, so naive p_over ≥ 0.62 still loses when expected_K is
// only ~0.3 above the line. Require real headroom.
const A_TIER_MIN_CUSHION = 1.0; // expected_K - line ≥ 1.0
const S_TIER_MIN_CUSHION = 1.5;
const A_TIER_MIN_IP = 5.0;

/** Bayesian shrink of L5 toward season prior (5-start prior weight). */
function blendK9(
  l5: number | null,
  season: number | null,
  starts: number,
): number | null {
  if (l5 == null && season == null) return null;
  if (l5 == null) return season;
  if (season == null) return l5;
  const w = Math.min(starts, PRIOR_STARTS) / (PRIOR_STARTS + PRIOR_STARTS);
  return w * l5 + (1 - w) * season;
}

/** Poisson P(X > k_line). Handles half-lines (e.g. 6.5). */
function poissonProbOver(lambda: number, line: number): number {
  // Need P(K >= ceil(line + epsilon)) — for 6.5 that's P(K>=7)
  const threshold = Math.floor(line) + 1;
  // P(X < threshold) = sum_{k=0}^{threshold-1} e^-λ λ^k / k!
  let cdf = 0;
  let term = Math.exp(-lambda);
  cdf += term;
  for (let k = 1; k < threshold; k++) {
    term = term * lambda / k;
    cdf += term;
  }
  return Math.max(0, Math.min(1, 1 - cdf));
}

export function modelPitcherKOver(input: PitcherKInput): PitcherKResult {
  const leagueAvg = input.leagueAvgKRate ?? LEAGUE_AVG_K_RATE_DEFAULT;
  const parkKMult = input.parkKMult ?? 1.0;
  const k9 = blendK9(input.pitcherK9L5, input.pitcherK9Season, input.pitcherStartsSeason);
  const ip = Math.min(IP_CAP, Math.max(0, input.expectedIP || 0));

  const oppKRateMult = input.oppKRateSeason != null
    ? Math.min(1.20, Math.max(0.85, input.oppKRateSeason / leagueAvg))
    : 1.0;

  const expectedK = (k9 ?? 0) * (ip / 9) * oppKRateMult * parkKMult;

  // Hard blocks
  let blockReason: string | null = null;
  if (input.line == null) blockReason = "no_line_posted";
  else if (input.pitcherStartsSeason < 5) blockReason = "small_sample_lt_5_starts";
  else if (k9 == null) blockReason = "missing_k9_data";
  else if (input.oppKRateSeason == null) blockReason = "missing_opp_k_rate";
  else if (ip < 4.5) blockReason = "early_hook_risk_ip_lt_4_5";
  else if (input.weatherRainRisk) blockReason = "weather_rain_risk";

  const pOver = blockReason ? 0 : poissonProbOver(expectedK, input.line!);
  const edge = blockReason ? 0 : pOver - IMPLIED_AT_MINUS_115;
  const cushion = blockReason ? 0 : expectedK - (input.line ?? 0);

  // Hard block: if the line sits at or above our expectation, this is the
  // "miss by 1" trap — no recommendation regardless of model probability.
  if (!blockReason && cushion < 0.5) {
    blockReason = "insufficient_cushion_vs_line";
  }

  let tier: PitcherKResult["tier"] = "PASS";
  if (!blockReason) {
    const k9val = k9 ?? 0;
    if (
      pOver >= 0.68 &&
      k9val >= 10.0 &&
      (input.oppKRateSeason ?? 0) >= leagueAvg &&
      ip >= 5.5 &&
      cushion >= S_TIER_MIN_CUSHION
    ) {
      tier = "S";
    } else if (
      pOver >= 0.65 &&
      edge >= 0.07 &&
      cushion >= A_TIER_MIN_CUSHION &&
      ip >= A_TIER_MIN_IP
    ) {
      tier = "A";
    }
  }

  let conf = pOver * 100;
  if (tier === "S") conf = Math.min(95, conf + 8);
  else if (tier === "A") conf = Math.min(88, conf + 4);
  else conf = Math.min(50, conf);

  return {
    expectedK: Math.round(expectedK * 100) / 100,
    pOver: Math.round(pOver * 1000) / 1000,
    edge: Math.round(edge * 1000) / 1000,
    k9Blended: k9 == null ? 0 : Math.round(k9 * 100) / 100,
    oppKRateMult: Math.round(oppKRateMult * 1000) / 1000,
    parkKMult,
    tier,
    blockReason,
    confidenceScore: Math.round(conf * 10) / 10,
  };
}