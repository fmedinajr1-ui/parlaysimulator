import { describe, it, expect } from "vitest";
import { slateProfitTrend } from "./calibrationExperiment";
const pick = (d: string, status: string, odds = -100, win = 0.7, hits = 7) => ({ game_date: d, player_name: d + status + odds + win, stat: "points", side: "under", model_version: "v5", status, odds, win_prob: win, hits_l10: hits, games_l10: 10, result_value: 1 }) as any;
const o = { winChanceWeight: 65, l10Weight: 35, cutoff: 0.66, stake: 10 };
describe("slateProfitTrend", () => {
  it("wins at -100 pay $10", () => expect(slateProfitTrend([pick("a", "won")], o)[0].profit).toBeCloseTo(10));
  it("losses cost the stake", () => expect(slateProfitTrend([pick("a", "lost")], o)[0].profit).toBe(-10));
  it("running total accumulates in date order", () => expect(slateProfitTrend([pick("b", "lost"), pick("a", "won")], o).map(r => r.cumulative)).toEqual([10, 0]));
  it("below 66% blend is skipped", () => expect(slateProfitTrend([pick("a", "won", -100, 0.6, 6)], o)).toEqual([]));
  it("open picks count but add no profit", () => { const r = slateProfitTrend([pick("a", "open")], o)[0]; expect([r.open, r.profit]).toEqual([1, 0]); });
});
