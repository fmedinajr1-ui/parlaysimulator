import { describe, expect, it } from "vitest";
import { BOT_DAILY_CAP, buildBotStrategy, settleBotPosition, summarizeBotProfit, type BotCandidate } from "./botStrategy";

const pick = (over: Partial<BotCandidate> = {}): BotCandidate => ({
  player: "Test Player", stat: "points", side: "over", line: 20.5, odds: -110,
  median: 24, ev: 0.1, tonight: "Away Team", hitRate: 0.75, hitsL10: 5, gamesL10: 10,
  trend: "cold", ...over,
});

describe("Oversight Bot strategy", () => {
  it("ignores clear picks and selects only skeptical plays", () => {
    const result = buildBotStrategy([pick({ hitRate: 0.55, hitsL10: 5, trend: "flat" }), pick({ player: "Flagged" })]);
    expect(result.map((p) => p.pick.player)).toEqual(["Flagged"]);
  });

  it("ranks by warning-adjusted EV and takes only the top three", () => {
    const result = buildBotStrategy([
      pick({ player: "A", ev: 0.08 }), pick({ player: "B", ev: 0.2 }),
      pick({ player: "C", ev: 0.15 }), pick({ player: "D", ev: 0.12 }),
    ]);
    expect(result.map((p) => p.pick.player)).toEqual(["B", "C", "D"]);
    expect(result.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it("breaks equal-score ties deterministically", () => {
    const result = buildBotStrategy([pick({ player: "Zed" }), pick({ player: "Alpha" })]);
    expect(result.map((p) => p.pick.player)).toEqual(["Alpha", "Zed"]);
  });

  it("rejects missing or invalid active odds", () => {
    expect(buildBotStrategy([pick({ odds: 0 }), pick({ odds: Number.NaN })])).toEqual([]);
  });

  it("sizes one disagreement at 0.75 units", () => {
    const result = buildBotStrategy([pick({ trend: "flat", hitRate: 0.6 })]);
    expect(result[0].stakeUnits).toBe(0.75);
    expect(result[0].riskScore).toBe(55);
  });

  it("cuts stake for an additional warning", () => {
    const result = buildBotStrategy([pick({ hitRate: 0.6 })]);
    expect(result[0].warnings).toHaveLength(2);
    expect(result[0].stakeUnits).toBe(0.55);
  });

  it("cuts stake again for a 20-point model/hit-rate gap", () => {
    const result = buildBotStrategy([pick({ trend: "flat", hitRate: 0.8, hitsL10: 5 })]);
    expect(result[0].stakeUnits).toBe(0.5);
  });

  it("cuts stake for long plus-money odds", () => {
    const result = buildBotStrategy([pick({ trend: "flat", hitRate: 0.6, odds: 200 })]);
    expect(result[0].stakeUnits).toBe(0.6);
    expect(result[0].riskScore).toBe(65);
  });

  it("keeps total daily risk at or below 1.5 units", () => {
    const result = buildBotStrategy(["A", "B", "C"].map((player) => pick({ player, trend: "flat", hitRate: 0.6 })));
    expect(result.reduce((sum, p) => sum + p.stakeUnits, 0)).toBeLessThanOrEqual(BOT_DAILY_CAP);
    expect(result.every((p) => p.stakeUnits >= 0.1)).toBe(true);
  });
});

describe("Oversight Bot profit", () => {
  it("pays American underdog odds against the risk-sized stake", () => {
    expect(settleBotPosition({ status: "won", odds: 150, stake_units: 0.4 })).toBeCloseTo(0.6);
  });

  it("pays favorite odds against the risk-sized stake", () => {
    expect(settleBotPosition({ status: "won", odds: -200, stake_units: 0.4 })).toBeCloseTo(0.2);
  });

  it("loses only the stake and refunds pushes, voids and open picks", () => {
    expect(settleBotPosition({ status: "lost", odds: -110, stake_units: 0.5 })).toBe(-0.5);
    for (const status of ["push", "void", "open"]) expect(settleBotPosition({ status, odds: -110, stake_units: 0.5 })).toBe(0);
  });

  it("tracks bankroll, settled ROI and open exposure separately", () => {
    const result = summarizeBotProfit([
      { status: "won", odds: 100, stake_units: 0.5 },
      { status: "lost", odds: -110, stake_units: 0.25 },
      { status: "push", odds: -110, stake_units: 0.25 },
      { status: "open", odds: -110, stake_units: 0.75 },
    ]);
    expect(result.profit).toBeCloseTo(0.25);
    expect(result.bankroll).toBeCloseTo(100.25);
    expect(result.risked).toBe(1);
    expect(result.roi).toBeCloseTo(0.25);
    expect(result.exposure).toBe(0.75);
    expect([result.won, result.lost, result.push, result.open]).toEqual([1, 1, 1, 1]);
  });

  it("does not report ROI before any position settles", () => {
    const result = summarizeBotProfit([{ status: "open", odds: -110, stake_units: 1 }]);
    expect(result.roi).toBeNull();
    expect(result.profit).toBe(0);
  });
});
