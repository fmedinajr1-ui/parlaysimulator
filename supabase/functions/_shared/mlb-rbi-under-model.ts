/**
 * mlb-rbi-under-model.ts
 *
 * Pure-math model for the Batter RBI UNDER market.
 * Replaces the deleted RBI analyzer that last wrote 2026-04-11.
 *
 * expected_RBI = RBI_per_PA_blended * expected_PA
 *               * pitcher_quality_mult * park_RBI_mult * lineup_spot_mult
 * p_under = P(RBI <= floor(line)) under Poisson(λ = expected_RBI)
 *
 * Four candidate L3 gates run in parallel (variants A/B/C/D); each
 * batter is tagged with every variant it passes so settled accuracy
 * can be compared.
 */

export type RbiVariant = "A" | "B" | "C" | "D";

export interface RbiUnderInput {
  playerName: string;
  team: string;
  opponent: string;
  homeTeam: string;
  park?: string;
  line: number | null;

  // batter
  rbiPerPaL15: number | null;
  rbiPerPaSeason: number | null;
  paSeason: number;            // sample size for shrink
  l3Rbis: number | null;       // sum of RBIs over last 3 games
  l3Pa: number | null;         // sum of PAs over last 3 games
  l10RbiPerPa: number | null;  // hot-bat hard-block input
  lineupSpot: number | null;   // 1..9, null if unknown

  // pitcher
  pitcherEra: number | null;
  pitcherK9: number | null;

  parkRbiMult?: number;        // default 1.0; COL forced block
}

export interface RbiUnderResult {
  expectedRbi: number;
  pUnder: number;
  edge: number;
  rbiPerPaBlended: number;
  expectedPa: number;
  pitcherQualityMult: number;
  parkRbiMult: number;
  lineupSpotMult: number;
  l3RbisPerPa: number | null;
  blockReason: string | null;
  variantsPassed: RbiVariant[];
  tierByVariant: Record<RbiVariant, "S" | "A" | "PASS">;
  confidenceScore: number;
}

const LEAGUE_AVG_ERA = 4.20;
const PRIOR_PA = 60;
const IMPLIED_AT_MINUS_115 = 115 / (115 + 100); // ~0.535

function blendRbiPerPa(
  l15: number | null,
  season: number | null,
  pa: number,
): number | null {
  if (l15 == null && season == null) return null;
  if (l15 == null) return season;
  if (season == null) return l15;
  // weight L15 by sample, shrink toward season
  const w = Math.min(pa, PRIOR_PA) / (PRIOR_PA + PRIOR_PA);
  return w * l15 + (1 - w) * season;
}

function expectedPaFromSpot(spot: number | null): number {
  if (spot == null) return 4.1;
  if (spot <= 2) return 4.4;
  if (spot <= 5) return 4.2;
  return 3.8;
}

function lineupSpotMult(spot: number | null): number {
  if (spot == null) return 1.0;
  if (spot <= 2) return 1.00;
  if (spot <= 5) return 1.05;
  return 0.92;
}

function pitcherQualityMult(era: number | null): number {
  if (era == null) return 1.0;
  // ace (low ERA) suppresses RBI; bad pitcher inflates
  return Math.min(1.25, Math.max(0.65, era / LEAGUE_AVG_ERA));
}

/** Poisson P(X <= k). */
function poissonCdf(lambda: number, k: number): number {
  if (lambda <= 0) return 1;
  let cdf = 0;
  let term = Math.exp(-lambda);
  cdf += term;
  for (let i = 1; i <= k; i++) {
    term = term * lambda / i;
    cdf += term;
  }
  return Math.max(0, Math.min(1, cdf));
}

export function modelRbiUnder(input: RbiUnderInput): RbiUnderResult {
  const parkRbiMult = input.parkRbiMult ?? 1.0;
  const rbiPerPa = blendRbiPerPa(
    input.rbiPerPaL15,
    input.rbiPerPaSeason,
    input.paSeason,
  );
  const expectedPa = expectedPaFromSpot(input.lineupSpot);
  const lsMult = lineupSpotMult(input.lineupSpot);
  const pqMult = pitcherQualityMult(input.pitcherEra);

  const expectedRbi = (rbiPerPa ?? 0) * expectedPa * pqMult * parkRbiMult * lsMult;

  const l3RbisPerPa = (input.l3Rbis != null && input.l3Pa && input.l3Pa > 0)
    ? input.l3Rbis / input.l3Pa
    : null;

  // Universal hard blocks
  let blockReason: string | null = null;
  if (input.line == null) blockReason = "no_line_posted";
  else if (rbiPerPa == null) blockReason = "missing_rbi_per_pa";
  else if (input.paSeason < 30) blockReason = "small_sample_lt_30_pa";
  else if ((input.park ?? "").toUpperCase().includes("COORS")) blockReason = "park_coors_field";
  else if (
    input.l10RbiPerPa != null &&
    input.l10RbiPerPa > 0.18 &&
    input.lineupSpot != null &&
    input.lineupSpot >= 3 && input.lineupSpot <= 5
  ) {
    blockReason = "hot_middle_order_bat";
  }

  const lineFloor = input.line != null ? Math.floor(input.line) : 0;
  const pUnder = blockReason ? 0 : poissonCdf(expectedRbi, lineFloor);
  const edge = blockReason ? 0 : pUnder - IMPLIED_AT_MINUS_115;

  const variantsPassed: RbiVariant[] = [];
  const tierByVariant: Record<RbiVariant, "S" | "A" | "PASS"> = {
    A: "PASS", B: "PASS", C: "PASS", D: "PASS",
  };

  if (!blockReason) {
    const sTier = pUnder >= 0.74 && edge >= 0.08;

    // A: L3 RBI/PA <= 0.06, pUnder >= 0.66, edge >= 0.05
    if (
      l3RbisPerPa != null && l3RbisPerPa <= 0.06 &&
      pUnder >= 0.66 && edge >= 0.05
    ) {
      variantsPassed.push("A");
      tierByVariant.A = sTier ? "S" : "A";
    }
    // B: L3 total RBIs <= 0.6, pUnder >= 0.66, edge >= 0.05
    if (
      input.l3Rbis != null && input.l3Rbis <= 0.6 &&
      pUnder >= 0.66 && edge >= 0.05
    ) {
      variantsPassed.push("B");
      tierByVariant.B = sTier ? "S" : "A";
    }
    // C: no L3 gate, pUnder >= 0.68, edge >= 0.05
    if (pUnder >= 0.68 && edge >= 0.05) {
      variantsPassed.push("C");
      tierByVariant.C = sTier ? "S" : "A";
    }
    // D: L3 RBIs <= 1 AND pUnder >= 0.68, edge >= 0.05
    if (
      input.l3Rbis != null && input.l3Rbis <= 1 &&
      pUnder >= 0.68 && edge >= 0.05
    ) {
      variantsPassed.push("D");
      tierByVariant.D = sTier ? "S" : "A";
    }
  }

  let conf = pUnder * 100;
  if (variantsPassed.some((v) => tierByVariant[v] === "S")) {
    conf = Math.min(95, conf + 8);
  } else if (variantsPassed.length > 0) {
    conf = Math.min(88, conf + 4);
  } else {
    conf = Math.min(50, conf);
  }

  return {
    expectedRbi: Math.round(expectedRbi * 1000) / 1000,
    pUnder: Math.round(pUnder * 1000) / 1000,
    edge: Math.round(edge * 1000) / 1000,
    rbiPerPaBlended: rbiPerPa == null ? 0 : Math.round(rbiPerPa * 10000) / 10000,
    expectedPa,
    pitcherQualityMult: Math.round(pqMult * 1000) / 1000,
    parkRbiMult,
    lineupSpotMult: lsMult,
    l3RbisPerPa: l3RbisPerPa == null ? null : Math.round(l3RbisPerPa * 10000) / 10000,
    blockReason,
    variantsPassed,
    tierByVariant,
    confidenceScore: Math.round(conf * 10) / 10,
  };
}