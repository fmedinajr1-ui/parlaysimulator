import { describe, expect, it } from "vitest";
import { minutesAccuracy, minutesElasticity, type MinutesRecord } from "./minutesValidation";

const rows = (error: number): MinutesRecord[] => ["2026-11-08", "2026-11-09", "2026-11-10"].map((game_date) => ({ game_date, projected_minutes: 30, actual_minutes: 30 + error, status: "graded" }));
describe("prospective minutes gate", () => {
  it("does not enable on two slates", () => expect(minutesAccuracy(rows(0).slice(0, 2)).ready).toBe(false));
  it("enables at exactly 3 slates and 2 minutes MAE", () => expect(minutesAccuracy(rows(2))).toMatchObject({ ready: true, mae: 2, slates: 3 }));
  it("blocks errors above 2 minutes", () => expect(minutesAccuracy(rows(2.01)).ready).toBe(false));
  it("does not count unfinished slates", () => expect(minutesAccuracy([...rows(0), { ...rows(0)[0], status: "open", actual_minutes: null }]).ready).toBe(false));
  it("excludes DNP rows instead of reporting zero error", () => expect(minutesAccuracy([...rows(1), { game_date: "2026-11-10", projected_minutes: 30, actual_minutes: 0, status: "excluded" }])).toMatchObject({ samples: 3, mae: 1 }));
  it("uses latest three completed slates", () => expect(minutesAccuracy([...rows(0), { ...rows(10)[0], game_date: "2026-11-07" }]).mae).toBe(0));
});
describe("elasticity dampener", () => {
  it("leaves steady minutes unchanged", () => expect(minutesElasticity(30, 30, 0.65)).toBe(1));
  it("shrinks a 10% increase to 6.5%", () => expect(minutesElasticity(33, 30, 0.65)).toBeCloseTo(1.065));
  it("shrinks a 10% decrease to 5% for assists", () => expect(minutesElasticity(27, 30, 0.5)).toBeCloseTo(0.95));
  it("caps an increase at 8%", () => expect(minutesElasticity(45, 30, 0.75)).toBe(1.08));
  it("caps a decrease at 8%", () => expect(minutesElasticity(10, 30, 0.75)).toBe(0.92));
  it("does not fabricate influence with a missing baseline", () => expect(minutesElasticity(30, 0, 0.65)).toBe(1));
});