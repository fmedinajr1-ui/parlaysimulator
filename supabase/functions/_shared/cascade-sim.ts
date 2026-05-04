// Cascade Alert Simulation Panel
// Pure helper — translates verdict_counts + per-leg reasoning into bankroll-impact estimates
// for TAIL (full), TAIL (small / top-3 non-WEAK), and FADE.
//
// Probability mapping (see mem://logic/alerts/cascade-sim-panel):
//   STRONG → 0.62
//   LEAN   → 0.52
//   WEAK   → 0.42
// All legs assumed -110, parlay assumed independent (acknowledged simplification).
//
// This is a DISPLAY AID. It does not influence the Action verdict.

const VERDICT_PROB: Record<string, number> = {
  STRONG: 0.62,
  LEAN: 0.52,
  NEUTRAL: 0.50,
  WEAK: 0.42,
};

const DEFAULT_ODDS = -110;
const DEFAULT_BANKROLL = 100;

export type LegInput = {
  verdict?: string | null;
};

export type SimLine = {
  prob: number;       // hit probability (0-1)
  ev: number;         // expected $ profit on suggested stake
  stake: number;      // suggested stake in $
  payout: number;     // profit if win (not total return)
  available: boolean; // false → render "n/a"
};

export type CascadeSim = {
  tailFull: SimLine;
  tailSmall: SimLine;
  fade: SimLine;
  bankroll: number;
};

function americanToDecimal(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function americanProfit(stake: number, odds: number): number {
  return odds > 0 ? (stake * odds) / 100 : (stake * 100) / Math.abs(odds);
}

function legProb(verdict: string | null | undefined): number {
  const v = (verdict ?? 'LEAN').toUpperCase();
  return VERDICT_PROB[v] ?? VERDICT_PROB.LEAN;
}

// Half-Kelly stake capped at 3% of bankroll, floored at 0.
function kellyStake(prob: number, decimalOdds: number, bankroll: number): number {
  if (bankroll <= 0 || prob <= 0 || prob >= 1) return 0;
  const b = decimalOdds - 1;
  if (b <= 0) return 0;
  const kelly = (b * prob - (1 - prob)) / b;
  if (kelly <= 0) return 0;
  const fraction = Math.min(kelly * 0.5, 0.03);
  return Math.max(0, Math.round(bankroll * fraction * 100) / 100);
}

function buildLine(prob: number, decimalOdds: number, bankroll: number, available = true): SimLine {
  if (!available) {
    return { prob: 0, ev: 0, stake: 0, payout: 0, available: false };
  }
  const stake = kellyStake(prob, decimalOdds, bankroll);
  const profit = americanProfitFromDecimal(stake, decimalOdds);
  const ev = stake > 0 ? prob * profit - (1 - prob) * stake : 0;
  return {
    prob,
    ev: Math.round(ev * 100) / 100,
    stake,
    payout: Math.round(profit * 100) / 100,
    available: true,
  };
}

function americanProfitFromDecimal(stake: number, decimalOdds: number): number {
  return stake * (decimalOdds - 1);
}

export function buildCascadeSim(
  verdictCounts: { strong?: number; lean?: number; neutral?: number; weak?: number } | null | undefined,
  legs: LegInput[] | null | undefined,
  bankroll: number = DEFAULT_BANKROLL,
): CascadeSim | null {
  const counts = verdictCounts ?? {};
  const total = (counts.strong ?? 0) + (counts.lean ?? 0) + (counts.neutral ?? 0) + (counts.weak ?? 0);
  if (total === 0) return null;

  // Derive per-leg verdicts. If `legs` is missing, synthesise from counts.
  let verdicts: string[];
  if (Array.isArray(legs) && legs.length > 0) {
    verdicts = legs.map((l) => (l?.verdict ?? 'LEAN').toUpperCase());
  } else {
    verdicts = [
      ...Array(counts.strong ?? 0).fill('STRONG'),
      ...Array(counts.lean ?? 0).fill('LEAN'),
      ...Array(counts.neutral ?? 0).fill('NEUTRAL'),
      ...Array(counts.weak ?? 0).fill('WEAK'),
    ];
  }
  if (verdicts.length === 0) return null;

  const probs = verdicts.map(legProb);
  const legDecimal = americanToDecimal(DEFAULT_ODDS);

  // TAIL full — parlay all legs.
  const fullProb = probs.reduce((a, b) => a * b, 1);
  const fullDecimal = Math.pow(legDecimal, probs.length);
  const tailFull = buildLine(fullProb, fullDecimal, bankroll);

  // TAIL small — top 3 non-WEAK legs (STRONG > LEAN priority).
  const nonWeak = verdicts
    .map((v, i) => ({ v, p: probs[i] }))
    .filter((x) => x.v !== 'WEAK')
    .sort((a, b) => b.p - a.p)
    .slice(0, 3);
  let tailSmall: SimLine;
  if (nonWeak.length < 3) {
    tailSmall = buildLine(0, 1, bankroll, false);
  } else {
    const sp = nonWeak.reduce((a, x) => a * x.p, 1);
    const sd = Math.pow(legDecimal, nonWeak.length);
    tailSmall = buildLine(sp, sd, bankroll);
  }

  // FADE — probability that at least one leg busts (parlay fails).
  const fadeProb = 1 - fullProb;
  // Fading a parlay leg-by-leg is impractical; treat fade as a single -110 bet on "any leg misses".
  const fade = buildLine(fadeProb, legDecimal, bankroll);

  return { tailFull, tailSmall, fade, bankroll };
}

export function formatCascadeSimLines(sim: CascadeSim, totalLegs: number): string[] {
  const lines: string[] = [];
  lines.push(`💰 *Sim* ($${sim.bankroll} bankroll, -110 legs)`);
  lines.push(formatRow(`TAIL full (${totalLegs}-leg)`, sim.tailFull));
  lines.push(formatRow(`TAIL small (top 3)`, sim.tailSmall));
  lines.push(formatRow(`FADE (any miss)`, sim.fade));
  return lines;
}

function formatRow(label: string, line: SimLine): string {
  if (!line.available) {
    return `   • ${label}: n/a (need 3+ non-WEAK legs)`;
  }
  const pct = `${Math.round(line.prob * 100)}%`;
  const evSign = line.ev >= 0 ? '+' : '-';
  const evStr = `${evSign}$${Math.abs(line.ev).toFixed(2)}`;
  if (line.stake <= 0) {
    return `   • ${label}: p=${pct}  EV=${evStr}  Risk: $0 — skip`;
  }
  return `   • ${label}: p=${pct}  EV=${evStr}  Risk: $${line.stake.toFixed(2)} → win $${line.payout.toFixed(2)}`;
}
