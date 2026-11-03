import { describe, it, expect } from "vitest";
import { percentile, hitRate, summarizePlayer, type GameLog } from "./nbaBoxScoreMath";

const mk = (d: string, pts: number, min = 30): GameLog => ({
  player_name: "Test", game_date: d, opponent: "BOS", minutes_played: min,
  points: pts, rebounds: 5, assists: 2, threes_made: 1,
});

describe("nba box score math", () => {
  it("median of odd set", () => expect(percentile([3, 1, 2], 0.5)).toBe(2));
  it("20th/80th percentile", () => {
    expect(percentile([0, 10, 20, 30, 40, 50], 0.2)).toBe(10);
    expect(percentile([0, 10, 20, 30, 40, 50], 0.8)).toBe(40);
  });
  it("hit rate counts strictly over", () => expect(hitRate([10, 20, 20, 30], 20)).toBe(0.25));
  it("excludes DNP games", () => {
    const s = summarizePlayer([mk("2026-01-02", 0, 0), mk("2026-01-01", 25)], "points")!;
    expect(s.l10.games).toBe(1);
    expect(s.l10.median).toBe(25);
  });
  it("PRA sums and L5 uses most recent games", () => {
    const logs = Array.from({ length: 10 }, (_, i) => mk(`2026-01-${String(i + 1).padStart(2, "0")}`, i < 5 ? 10 : 30));
    const s = summarizePlayer(logs, "pra")!;
    expect(s.l5.median).toBe(37);
    expect(s.trend).toBe("hot");
  });
});
