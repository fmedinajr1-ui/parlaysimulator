import { describe, expect, it } from "vitest";
import { runCalibrationExperiment, winProfit } from "./calibrationExperiment";
import type { ResearchPick } from "./accuracyResearch";

const row = (overrides: Partial<ResearchPick> = {}): ResearchPick => ({
  id: "1", game_date: "2026-11-08", player_name: "Player", stat: "rebounds", side: "over", line: 3.5,
  win_prob: 0.7, hits_l10: 8, games_l10: 10, warnings: [], status: "won", result_value: 6,
  model_version: "v5", ...overrides,
});
const options = { winChanceWeight: 0.75, l10Weight: 0.25, cutoff: 0.6 };

describe("skeptical calibration experiment", () => {
  it("keeps the saved forecast unchanged at zero L10 weight", () => {
    const result = runCalibrationExperiment([row()], "pregame", { winChanceWeight: 1, l10Weight: 0 });
    expect(result.candidate.averageForecast).toBe(0.7);
    expect(result.candidate.brier).toBeCloseTo(0.09);
  });

  it("uses the real L10 hit rate at full L10 weight", () => {
    const result = runCalibrationExperiment([row()], "pregame", { winChanceWeight: 0, l10Weight: 1 });
    expect(result.candidate.averageForecast).toBe(0.8);
  });

  it("normalizes percentage-style and ratio-style weights identically", () => {
    const a = runCalibrationExperiment([row()], "pregame", { winChanceWeight: 75, l10Weight: 25 });
    const b = runCalibrationExperiment([row()], "pregame", options);
    expect(a.candidate.averageForecast).toBeCloseTo(0.725);
    expect(a.candidate).toEqual(b.candidate);
  });

  it("falls back to the saved forecast when both weights are zero", () => {
    const result = runCalibrationExperiment([row()], "pregame", { winChanceWeight: 0, l10Weight: 0 });
    expect(result.weights).toEqual({ winChance: 1, l10: 0 });
    expect(result.candidate.averageForecast).toBe(0.7);
  });

  it("computes a concrete Brier improvement", () => {
    const result = runCalibrationExperiment([row({ win_prob: 0.5, hits_l10: 10 })], "pregame", { winChanceWeight: 0, l10Weight: 1 });
    expect(result.baseline.brier).toBe(0.25);
    expect(result.candidate.brier).toBe(0);
    expect(result.delta.brier).toBe(-0.25);
  });

  it("reports signed forecast-minus-actual calibration gap", () => {
    const result = runCalibrationExperiment([
      row(), row({ id: "2", player_name: "B", status: "lost", result_value: 1 }),
    ], "pregame", options);
    expect(result.candidate.actual).toBe(0.5);
    expect(result.candidate.averageForecast).toBeCloseTo(0.725);
    expect(result.candidate.calibrationGap).toBeCloseTo(0.225);
  });

  it("shows how cutoff accuracy and coverage change", () => {
    const result = runCalibrationExperiment([
      row({ id: "a", player_name: "A", win_prob: 0.8, hits_l10: 2, status: "lost", result_value: 1 }),
      row({ id: "b", player_name: "B", win_prob: 0.8, hits_l10: 9 }),
      row({ id: "c", player_name: "C", win_prob: 0.55, hits_l10: 5.5 }),
    ], "pregame", { winChanceWeight: 0.5, l10Weight: 0.5, cutoff: 0.6 });
    expect(result.baseline).toMatchObject({ qualified: 2, qualifiedWon: 1, qualifiedAccuracy: 0.5 });
    expect(result.candidate).toMatchObject({ qualified: 1, qualifiedWon: 1, qualifiedAccuracy: 1, coverage: 1 / 3 });
  });

  it("includes a forecast exactly on the cutoff", () => {
    const result = runCalibrationExperiment([row({ win_prob: 0.6, hits_l10: 6 })], "pregame", options);
    expect(result.candidate.qualified).toBe(1);
  });

  it("excludes invalid or missing L10 records from both compared forecasts", () => {
    const result = runCalibrationExperiment([
      row(), row({ id: "2", player_name: "B", games_l10: 0, hits_l10: 0 }),
      row({ id: "3", player_name: "C", games_l10: 10, hits_l10: 11 }),
    ], "pregame", options);
    expect(result).toMatchObject({ n: 1, excluded: 2 });
  });

  it("excludes pending, push, void and missing result values", () => {
    const result = runCalibrationExperiment([
      row(), row({ id: "2", player_name: "B", status: "open" }),
      row({ id: "3", player_name: "C", status: "push" }), row({ id: "4", player_name: "D", status: "void" }),
      row({ id: "5", player_name: "E", result_value: null }),
    ], "pregame", options);
    expect(result).toMatchObject({ n: 1, excluded: 4 });
  });

  it("deduplicates snapshots before comparing metrics", () => {
    expect(runCalibrationExperiment([row(), row()], "pregame", options).n).toBe(1);
  });

  it("preserves retrospective provenance", () => {
    expect(runCalibrationExperiment([row()], "review", options).retrospective).toBe(true);
  });

  it("does not mutate saved picks", () => {
    const rows = [row()];
    const before = structuredClone(rows);
    runCalibrationExperiment(rows, "pregame", options);
    expect(rows).toEqual(before);
  });

  it("returns null metrics rather than fabricated zeroes when empty", () => {
    const result = runCalibrationExperiment([], "pregame", options);
    expect(result.candidate).toMatchObject({ actual: null, brier: null, calibrationGap: null, qualifiedAccuracy: null });
  });
});

describe("calibration bankroll backtest", () => {
  const base = { stat: "points", side: "over", line: 10, warnings: [], result_value: 12, model_version: "v5", hits_l10: 5, games_l10: 10 };
  const rows = [
    { ...base, id: "a", game_date: "2026-11-01", player_name: "A", win_prob: 0.7, status: "won", odds: -110 },
    { ...base, id: "b", game_date: "2026-11-01", player_name: "B", win_prob: 0.7, status: "lost", odds: 150 },
    { ...base, id: "c", game_date: "2026-11-02", player_name: "C", win_prob: 0.7, status: "won", odds: 200 },
    { ...base, id: "d", game_date: "2026-11-02", player_name: "D", win_prob: 0.7, status: "won", odds: null },
    { ...base, id: "e", game_date: "2026-11-02", player_name: "E", win_prob: 0.5, status: "won", odds: 100 },
  ];
  const run = (o = {}) => runCalibrationExperiment(rows as never, "pregame", { winChanceWeight: 1, l10Weight: 0, cutoff: 0.6, stake: 10, startingBankroll: 1000, ...o });
  it("pays -110 wins at 100/110 of stake", () => expect(winProfit(11, -110)).toBeCloseTo(10));
  it("pays +200 wins at double stake", () => expect(winProfit(10, 200)).toBe(20));
  it("only bets picks clearing the cutoff and skips missing odds", () => {
    const b = run().bankroll.baseline;
    expect(b.bets).toBe(3); expect(b.skippedNoOdds).toBe(1);
  });
  it("computes profit, ROI and ending bankroll", () => {
    const b = run().bankroll.baseline;
    expect(b.profit).toBeCloseTo(100 / 11 - 10 + 20); expect(b.endingBankroll).toBeCloseTo(1000 + b.profit); expect(b.roi).toBeCloseTo(b.profit / 30);
  });
  it("experiment weights change which picks are bet", () => {
    const r = run({ winChanceWeight: 0, l10Weight: 1 });
    expect(r.bankroll.candidate.bets).toBe(0); expect(r.bankroll.profitChange).toBeCloseTo(-r.bankroll.baseline.profit);
  });
});
