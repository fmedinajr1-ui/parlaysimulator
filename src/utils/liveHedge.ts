/** Live leg win %, parlay cash chance and hedge math. Pure so it stays testable and explainable. */
import type { Side } from "@/utils/paperBets";
import { toDecimal } from "@/utils/betSlip";

export interface LiveLegInput {
  side: Side;
  line: number;
  value: number;          // current stat total
  minutesPlayed: number;
  period: number;         // 0 = not started
  clockSec: number;       // seconds left in the period
  final: boolean;
  avgMinutes: number;     // pregame expected minutes (L10)
  ratePerMin: number;     // pregame stat per minute (L10)
}

/** Never label a missing feed or an empty historical baseline as a live prediction. */
export function livePredictionAvailable(live: { period?: number } | undefined, baseline: { avgMinutes: number; ratePerMin: number }): boolean {
  return !!live && (live.period ?? 0) > 0 && Number.isFinite(baseline.avgMinutes) && baseline.avgMinutes > 0
    && Number.isFinite(baseline.ratePerMin) && baseline.ratePerMin > 0;
}

export function gameMinutesElapsed(period: number, clockSec: number): number {
  if (period <= 0) return 0;
  const left = Math.max(0, clockSec) / 60;
  if (period <= 4) return (period - 1) * 12 + (12 - Math.min(12, left));
  return 48 + (period - 5) * 5 + (5 - Math.min(5, left));
}

function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

/** Expected remaining stat and live win probability for one leg. */
export function liveLegProb(i: LiveLegInput): { prob: number; expectedFinal: number } {
  if (i.final) {
    const won = i.side === "over" ? i.value > i.line : i.value < i.line;
    return { prob: won ? 1 : 0, expectedFinal: i.value };
  }
  const frac = Math.min(1, gameMinutesElapsed(i.period, i.clockSec) / 48);
  const M = i.avgMinutes > 0 ? i.avgMinutes : 30;
  const remMin = Math.max(0, Math.min(M * (1 - frac), M * 1.15 - i.minutesPlayed));
  const PRIOR = 24; // minutes of pregame weight before live pace takes over
  const liveRate = i.minutesPlayed > 0 ? i.value / i.minutesPlayed : i.ratePerMin;
  const rate = (i.ratePerMin * PRIOR + liveRate * i.minutesPlayed) / (PRIOR + i.minutesPlayed);
  const mu = rate * remMin;
  const sd = Math.sqrt(Math.max(mu, 0) * 1.3) + 0.35;
  const gap = i.line - i.value; // remaining needed vs line
  // Over wins when remaining X > gap; Under wins when X < gap (half-point continuity).
  const overNeed = Math.floor(gap) + 1;
  const pOver = gap < 0 ? 1 : 1 - normCdf((overNeed - 0.5 - mu) / sd);
  const underMax = Math.ceil(gap) - 1;
  const pUnder = underMax < 0 ? 0 : normCdf((underMax + 0.5 - mu) / sd);
  const prob = i.side === "over" ? pOver : pUnder;
  return { prob: Math.max(0, Math.min(1, prob)), expectedFinal: i.value + mu };
}

export const DANGER_PROB = 0.35;
export const isDanger = (prob: number, final: boolean) => !final && prob < DANGER_PROB;

/** Chance every remaining leg hits (graded legs count as 1 or 0; void legs are ignored). */
export function parlayCashProb(legProbs: number[]): number {
  return legProbs.reduce((p, x) => p * x, 1);
}

export interface HedgePlan { hedgeStake: number; hedgeOdds: number; lockedProfit: number; recommended: boolean }

/**
 * Equal-outcome hedge on the opposite side of the last open leg.
 * Ticket returns R = stake × decimal(ticketOdds); hedge stake H = R / decimal(hedgeOdds) pays the same either way.
 */
export function hedgePlan(stake: number, ticketOdds: number, hedgeOdds: number, lastLegProb: number): HedgePlan | null {
  if (!(stake > 0) || Math.abs(hedgeOdds) < 100) return null;
  const R = stake * toDecimal(ticketOdds);
  const H = R / toDecimal(hedgeOdds);
  const locked = R - stake - H;
  return { hedgeStake: Math.round(H * 100) / 100, hedgeOdds, lockedProfit: Math.round(locked * 100) / 100, recommended: locked > 0 && lastLegProb < 0.6 };
}
