// Monte Carlo audit for a bet slip: correlated legs via a Gaussian copula.
import { toAmerican, toDecimal } from "./betSlip";

export interface SimLeg { player: string; stat: string; side: "over" | "under"; odds: number; winProb?: number | null; team?: string | null; opp?: string | null }

export const impliedProb = (odds: number) => 1 / toDecimal(odds);

/** Pairwise correlation of two legs' outcomes (rules of thumb, display-only). */
export function legCorrelation(a: SimLeg, b: SimLeg): number {
  const same = a.side === b.side ? 1 : -1;
  if (a.player.toLowerCase() === b.player.toLowerCase()) return 0.45 * same;
  if (a.team && b.team && a.team === b.team) {
    // Two scoring Overs on one team compete for shots.
    if (a.side === "over" && b.side === "over" && a.stat === "points" && b.stat === "points") return -0.15;
    return 0.15 * same;
  }
  if ((a.team && b.opp && a.team === b.opp) || (b.team && a.opp && b.team === a.opp)) return 0.1 * same;
  return 0;
}

export function cholesky(m: number[][]): number[][] {
  const n = m.length, L = m.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = m[i][j];
    for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-9)) : s / L[j][j];
  }
  return L;
}

// Inverse normal CDF (Acklam).
export function invNorm(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const q = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  if (q < 0.02425) { const r = Math.sqrt(-2 * Math.log(q)); return (((((c[0]*r+c[1])*r+c[2])*r+c[3])*r+c[4])*r+c[5]) / ((((d[0]*r+d[1])*r+d[2])*r+d[3])*r+1); }
  if (q > 1 - 0.02425) { const r = Math.sqrt(-2 * Math.log(1 - q)); return -(((((c[0]*r+c[1])*r+c[2])*r+c[3])*r+c[4])*r+c[5]) / ((((d[0]*r+d[1])*r+d[2])*r+d[3])*r+1); }
  const r = q - 0.5, s = r * r;
  return (((((a[0]*s+a[1])*s+a[2])*s+a[3])*s+a[4])*s+a[5])*r / (((((b[0]*s+b[1])*s+b[2])*s+b[3])*s+b[4])*s+1);
}

function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) + 0.5) / 4294967297; }; }

export interface SlipAudit { simProb: number; naiveProb: number; bookProb: number; fairOdds: number; correlationImpact: number; ev: number; divergence: number; warning: string | null; usedModel: boolean }

/** Simulate the parlay `runs` times; legs without a model probability fall back to the book price. */
export function auditSlip(legs: SimLeg[], runs = 10000, seed = 7): SlipAudit {
  const n = legs.length;
  const usedModel = legs.some((l) => l.winProb != null);
  const p = legs.map((l) => Math.min(0.97, Math.max(0.03, l.winProb ?? impliedProb(l.odds))));
  const naiveProb = p.reduce((a, b) => a * b, 1);
  const bookDec = legs.reduce((a, l) => a * toDecimal(l.odds), 1);
  const bookProb = 1 / bookDec;
  const R = legs.map((a, i) => legs.map((b, j) => (i === j ? 1 : legCorrelation(a, b))));
  const L = cholesky(R), cut = p.map(invNorm), rand = rng(seed);
  let hits = 0;
  for (let r = 0; r < runs; r++) {
    const z = Array.from({ length: n }, () => { const u = rand(), v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); });
    let ok = true;
    for (let i = 0; i < n && ok; i++) { let x = 0; for (let k = 0; k <= i; k++) x += L[i][k] * z[k]; if (x > cut[i]) ok = false; }
    if (ok) hits++;
  }
  const simProb = hits / runs;
  const divergence = bookProb > 0 ? simProb / bookProb : 0;
  const warning = divergence > 1.5 ? `Model claims ${divergence.toFixed(1)}× the book's chance — inputs are probably too optimistic.` : divergence < 0.8 ? "Book prices this better than the model — negative value." : null;
  return { simProb, naiveProb, bookProb, fairOdds: simProb > 0 ? toAmerican(1 / simProb) : 0, correlationImpact: naiveProb > 0 ? simProb / naiveProb - 1 : 0, ev: simProb * bookDec - 1, divergence, warning, usedModel };
}
