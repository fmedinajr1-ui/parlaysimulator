// Shared helpers for AI Models Intelligence layer.
// Pure functions only — no DB / network.

export const SPORTS = ["nba", "mlb", "nhl"] as const;
export type ModelSport = typeof SPORTS[number];

/** Logistic / sigmoid */
export function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

/** American odds -> implied probability (no vig removal) */
export function americanToProb(odds: number | null | undefined): number | null {
  if (odds === null || odds === undefined || !Number.isFinite(odds)) return null;
  if (odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

/** Standard Elo expectation */
export function eloExpected(rA: number, rB: number, homeAdv = 65): number {
  return 1 / (1 + Math.pow(10, ((rB - (rA + homeAdv)) / 400)));
}

/** Elo update with margin-of-victory multiplier (538-style). */
export function eloUpdate(
  homeRating: number,
  awayRating: number,
  homeScore: number,
  awayScore: number,
  k = 20,
  homeAdv = 65,
): { home: number; away: number } {
  const expHome = eloExpected(homeRating, awayRating, homeAdv);
  const actualHome = homeScore > awayScore ? 1 : homeScore < awayScore ? 0 : 0.5;
  const margin = Math.abs(homeScore - awayScore);
  const eloDiff = homeRating + homeAdv - awayRating;
  const winnerDiff = homeScore > awayScore ? eloDiff : -eloDiff;
  const mov = Math.log(Math.max(margin, 1) + 1) * (2.2 / (winnerDiff * 0.001 + 2.2));
  const delta = k * mov * (actualHome - expHome);
  return { home: homeRating + delta, away: awayRating - delta };
}

/** Poisson pmf */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** P(home + away total > line) using independent Poissons. */
export function poissonOverProb(lambdaHome: number, lambdaAway: number, line: number): number {
  // Sum of independent Poissons is Poisson(lambdaHome+lambdaAway).
  const lam = lambdaHome + lambdaAway;
  // P(total > line). For half lines line+0.5, P(total >= ceil(line+0.5)).
  const threshold = Math.floor(line) + 1; // total must be >= threshold to be Over for half-line
  // sum pmf from 0..threshold-1 then 1 - cdf
  let cdf = 0;
  for (let k = 0; k < threshold; k++) cdf += poissonPmf(k, lam);
  return Math.max(0, Math.min(1, 1 - cdf));
}

/**
 * Tiny gradient-boosting style learner: trains an ensemble of decision *stumps*
 * (depth-1 trees) via gradient boosting on log-loss. Good enough for v1 prop
 * hit-rate modeling at our data sizes (~hundreds-thousands rows per sport/prop_type).
 */
export interface Stump {
  feature: number;
  threshold: number;
  left: number;   // leaf value contributed to logit if x[feature] < threshold
  right: number;  // leaf value contributed otherwise
}

export interface GbmModel {
  base: number;          // initial logit (log-odds of base rate)
  stumps: Stump[];
  learningRate: number;
  featureNames: string[];
}

function bestStump(
  X: number[][],
  residuals: number[],
  featureCount: number,
): Stump {
  let best: Stump = { feature: 0, threshold: 0, left: 0, right: 0 };
  let bestLoss = Infinity;

  for (let f = 0; f < featureCount; f++) {
    // candidate thresholds: deciles
    const vals = X.map((row) => row[f]).sort((a, b) => a - b);
    const candidates: number[] = [];
    for (let q = 1; q < 10; q++) {
      const idx = Math.floor((vals.length * q) / 10);
      candidates.push(vals[idx]);
    }
    for (const t of candidates) {
      let lSum = 0, lN = 0, rSum = 0, rN = 0;
      for (let i = 0; i < X.length; i++) {
        if (X[i][f] < t) { lSum += residuals[i]; lN++; }
        else { rSum += residuals[i]; rN++; }
      }
      if (lN === 0 || rN === 0) continue;
      const lMean = lSum / lN;
      const rMean = rSum / rN;
      let loss = 0;
      for (let i = 0; i < X.length; i++) {
        const pred = X[i][f] < t ? lMean : rMean;
        loss += (residuals[i] - pred) ** 2;
      }
      if (loss < bestLoss) {
        bestLoss = loss;
        best = { feature: f, threshold: t, left: lMean, right: rMean };
      }
    }
  }
  return best;
}

/** Train tiny GBM on binary labels in {0,1}. */
export function trainGbm(
  X: number[][],
  y: number[],
  featureNames: string[],
  rounds = 40,
  learningRate = 0.1,
): GbmModel {
  const baseRate = Math.max(0.05, Math.min(0.95, y.reduce((a, b) => a + b, 0) / Math.max(1, y.length)));
  const base = Math.log(baseRate / (1 - baseRate));
  const stumps: Stump[] = [];
  const logits = new Array(X.length).fill(base);

  for (let r = 0; r < rounds; r++) {
    const residuals = logits.map((l, i) => y[i] - sigmoid(l));
    const stump = bestStump(X, residuals, featureNames.length);
    stump.left *= learningRate;
    stump.right *= learningRate;
    stumps.push(stump);
    for (let i = 0; i < X.length; i++) {
      logits[i] += X[i][stump.feature] < stump.threshold ? stump.left : stump.right;
    }
  }

  return { base, stumps, learningRate, featureNames };
}

export function predictGbm(model: GbmModel, x: number[]): number {
  let logit = model.base;
  for (const s of model.stumps) {
    logit += x[s.feature] < s.threshold ? s.left : s.right;
  }
  return sigmoid(logit);
}
