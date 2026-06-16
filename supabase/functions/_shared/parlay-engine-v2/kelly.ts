import { STAKE_BY_TIER } from "./config.ts";
import type { BankrollInput, TicketTier } from "./models.ts";
import { clamp } from "./scoring.ts";

export function kellyLiteStake(tier: TicketTier, avgConf: number): number {
  if (avgConf < 0.60) return 0;
  const mult = clamp(1 + (avgConf - 0.60) * 3.33, 0.5, 2.0);
  return STAKE_BY_TIER[tier] * mult;
}

export function quarterKellyFraction(p: number, decimalOdds: number): number {
  const b = decimalOdds - 1;
  const q = 1 - p;
  if (b <= 0) return 0;
  return Math.max(0, ((b * p - q) / b) * 0.25 * 4.0);
}

export function bayesianSmooth(hits = 0, n = 0, legCount = 2, k = 10): number {
  const prior = legCount <= 2 ? 0.36 : legCount === 3 ? 0.20 : legCount === 4 ? 0.12 : 0.07;
  return (hits + prior * k) / (n + k);
}

export function bankrollStake(
  bankrollInput: BankrollInput | undefined,
  legCount: number,
  decimalOdds: number,
  tierCapStake: number,
): { stake?: number; dropReason?: string } {
  if (!bankrollInput?.enabled) return {};
  const bankroll = bankrollInput.bankroll ?? 0;
  if (bankroll <= 0) return { dropReason: "bankroll_required" };
  if ((bankrollInput.n ?? 0) >= 5 && (bankrollInput.rollingEvPerUnit ?? 0) < 0) {
    return { dropReason: "negative_rolling_ev" };
  }

  const pHat = bayesianSmooth(bankrollInput.hits, bankrollInput.n, legCount, 10);
  if (decimalOdds < 1 / (pHat * 1.10)) return { dropReason: "price_below_bayesian_edge" };

  const rawStake = quarterKellyFraction(pHat, decimalOdds) * bankroll;
  return { stake: Math.min(rawStake, tierCapStake * 2) };
}
