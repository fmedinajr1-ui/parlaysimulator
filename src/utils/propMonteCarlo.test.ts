import { describe, expect, it } from "vitest";
import { simulateProp } from "./propMonteCarlo";
import type { GameLog } from "./nbaBoxScoreMath";

const g = (pts: number, min = 30, d = 1): GameLog => ({ player_name: "A", game_date: `2026-11-${String(d).padStart(2, "0")}`, opponent: "X", minutes_played: min, points: pts, rebounds: 5, assists: 3, threes_made: 1 });
const logs = [20, 22, 18, 25, 15, 21, 19, 23, 17, 24].map((p, i) => g(p, 30, i + 1));

describe("simulateProp", () => {
  it("needs at least 5 real games", () => {
    expect(simulateProp(logs.slice(0, 4), "points", 20.5, 20, 30)).toBeNull();
  });
  it("ignores games under 5 minutes", () => {
    expect(simulateProp([...logs.slice(0, 4), g(0, 2)], "points", 20.5, 20, 30)).toBeNull();
  });
  it("centers near the model projection", () => {
    const s = simulateProp(logs, "points", 20.5, 26, 30)!;
    expect(Math.abs(s.p50 - 26)).toBeLessThan(2);
  });
  it("line far below projection gives a high over chance", () => {
    expect(simulateProp(logs, "points", 10.5, 20, 30)!.over).toBeGreaterThan(0.9);
  });
  it("line far above projection gives a low over chance", () => {
    expect(simulateProp(logs, "points", 35.5, 20, 30)!.over).toBeLessThan(0.1);
  });
  it("is repeatable and ordered", () => {
    const a = simulateProp(logs, "points", 20.5, 20, 30)!;
    expect(simulateProp(logs, "points", 20.5, 20, 30)).toEqual(a);
    expect(a.p10).toBeLessThanOrEqual(a.p50);
    expect(a.p50).toBeLessThanOrEqual(a.p90);
  });
});
