import type { ResearchPick } from "./accuracyResearch.ts";

export interface CalibrationOptions {
  winChanceWeight: number;
  l10Weight: number;
  cutoff?: number;
  /** Hypothetical dollars per qualifying pick (paper backtest only). */
  stake?: number;
  startingBankroll?: number;
}

export interface BankrollMetrics {
  bets: number; skippedNoOdds: number; staked: number; profit: number; endingBankroll: number; roi: number | null;
}

/** American odds payout profit for a winning stake. */
export function winProfit(stake: number, odds: number): number {
  return odds > 0 ? stake * odds / 100 : stake * 100 / Math.abs(odds);
}

function bankroll(rows: ResearchPick[], probability: (p: ResearchPick) => number, cutoff: number, stake: number, start: number): BankrollMetrics {
  let bets = 0, skipped = 0, profit = 0;
  const ordered = [...rows].sort((a, b) => a.game_date.localeCompare(b.game_date));
  for (const pick of ordered) {
    if (probability(pick) < cutoff) continue;
    const odds = pick.odds;
    if (typeof odds !== "number" || !Number.isFinite(odds) || Math.abs(odds) < 100) { skipped++; continue; }
    bets++;
    profit += pick.status === "won" ? winProfit(stake, odds) : -stake;
  }
  const staked = bets * stake;
  return { bets, skippedNoOdds: skipped, staked, profit, endingBankroll: start + profit, roi: staked ? profit / staked : null };
}

export interface CalibrationMetrics {
  n: number;
  won: number;
  lost: number;
  actual: number | null;
  averageForecast: number | null;
  brier: number | null;
  calibrationGap: number | null;
  qualified: number;
  qualifiedWon: number;
  qualifiedLost: number;
  qualifiedAccuracy: number | null;
  coverage: number | null;
}

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function metrics(rows: ResearchPick[], probability: (pick: ResearchPick) => number, cutoff: number): CalibrationMetrics {
  const forecasts = rows.map(pick => ({ pick, probability: probability(pick) }));
  const won = rows.filter(pick => pick.status === "won").length;
  const selected = forecasts.filter(row => row.probability >= cutoff);
  const selectedWon = selected.filter(row => row.pick.status === "won").length;
  const actual = rows.length ? won / rows.length : null;
  const averageForecast = mean(forecasts.map(row => row.probability));
  return {
    n: rows.length,
    won,
    lost: rows.length - won,
    actual,
    averageForecast,
    brier: mean(forecasts.map(row => (row.probability - (row.pick.status === "won" ? 1 : 0)) ** 2)),
    calibrationGap: actual == null || averageForecast == null ? null : averageForecast - actual,
    qualified: selected.length,
    qualifiedWon: selectedWon,
    qualifiedLost: selected.length - selectedWon,
    qualifiedAccuracy: selected.length ? selectedWon / selected.length : null,
    coverage: rows.length ? selected.length / rows.length : null,
  };
}

/**
 * Re-scores immutable saved outcomes in memory. It never updates a pick, model,
 * database row, or live recommendation. Weights are normalized, so 75/25 and
 * 0.75/0.25 describe the same experiment.
 */
export function runCalibrationExperiment(
  input: ResearchPick[],
  kind: "pregame" | "review",
  options: CalibrationOptions,
) {
  const unique = [...new Map(input.map(row => [
    `${row.game_date}|${row.player_name}|${row.stat}|${row.side}|${row.model_version}`,
    row,
  ])).values()];
  const rows = unique.filter(row =>
    (row.status === "won" || row.status === "lost") &&
    row.result_value != null &&
    Number.isFinite(row.win_prob) && row.win_prob >= 0 && row.win_prob <= 1 &&
    Number.isFinite(row.games_l10) && row.games_l10 > 0 &&
    Number.isFinite(row.hits_l10) && row.hits_l10 >= 0 && row.hits_l10 <= row.games_l10
  );
  const rawWin = Number.isFinite(options.winChanceWeight) ? Math.max(0, options.winChanceWeight) : 0;
  const rawL10 = Number.isFinite(options.l10Weight) ? Math.max(0, options.l10Weight) : 0;
  const totalWeight = rawWin + rawL10;
  const winChanceWeight = totalWeight > 0 ? rawWin / totalWeight : 1;
  const l10Weight = totalWeight > 0 ? rawL10 / totalWeight : 0;
  const cutoff = typeof options.cutoff === "number" && Number.isFinite(options.cutoff)
    ? Math.min(1, Math.max(0, options.cutoff)) : 0.6;
  const blendedProbability = (pick: ResearchPick) =>
    winChanceWeight * pick.win_prob + l10Weight * (pick.hits_l10 / pick.games_l10);
  const stake = Number.isFinite(options.stake) && (options.stake as number) > 0 ? options.stake as number : 10;
  const start = Number.isFinite(options.startingBankroll) && (options.startingBankroll as number) >= 0 ? options.startingBankroll as number : 1000;
  const baselineBankroll = bankroll(rows, pick => pick.win_prob, cutoff, stake, start);
  const candidateBankroll = bankroll(rows, blendedProbability, cutoff, stake, start);
  const baseline = metrics(rows, pick => pick.win_prob, cutoff);
  const candidate = metrics(rows, blendedProbability, cutoff);
  const difference = (candidateValue: number | null, baselineValue: number | null) =>
    candidateValue == null || baselineValue == null ? null : candidateValue - baselineValue;

  return {
    kind,
    retrospective: kind === "review",
    n: rows.length,
    excluded: unique.length - rows.length,
    slates: new Set(rows.map(row => row.game_date)).size,
    weights: { winChance: winChanceWeight, l10: l10Weight },
    cutoff,
    stake,
    startingBankroll: start,
    bankroll: { baseline: baselineBankroll, candidate: candidateBankroll, profitChange: candidateBankroll.profit - baselineBankroll.profit },
    baseline,
    candidate,
    delta: {
      brier: difference(candidate.brier, baseline.brier),
      absoluteCalibrationGap: candidate.calibrationGap == null || baseline.calibrationGap == null
        ? null : Math.abs(candidate.calibrationGap) - Math.abs(baseline.calibrationGap),
      qualifiedAccuracy: difference(candidate.qualifiedAccuracy, baseline.qualifiedAccuracy),
      qualified: candidate.qualified - baseline.qualified,
    },
  };
}
