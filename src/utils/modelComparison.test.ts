import { describe, expect, it } from "vitest";
import { pairModelPicks, summarizeModelResults, type ComparablePick } from "./modelComparison";

const pick = (player: string, ev: number, side: "over" | "under" = "over"): ComparablePick => ({ player, stat: "points", line: 20.5, median: 22, hitRate: 0.6, ev, side });
const result = (version: string, status: string, game_date = "2026-11-10", odds: number | null = -110) => ({ model_version: version, status, game_date, odds });

describe("side-by-side model comparison", () => {
  it("pairs the same player and stat", () => expect(pairModelPicks([pick("A", 0.1)], [pick("A", 0.2)])).toHaveLength(1));
  it("keeps a v5-only pick", () => expect(pairModelPicks([pick("A", 0.1)], [])[0].v5?.player).toBe("A"));
  it("keeps a v6-only pick", () => expect(pairModelPicks([], [pick("B", 0.1)])[0].v6?.player).toBe("B"));
  it("sorts by the better expected profit", () => expect(pairModelPicks([pick("A", 0.1), pick("B", 0.2)], [])[0].player).toBe("B"));
  it("does not merge different stats", () => {
    const rebounds = { ...pick("A", 0.1), stat: "rebounds" as const };
    expect(pairModelPicks([pick("A", 0.1)], [rebounds])).toHaveLength(2);
  });
  it("summarizes only dates where both models participated", () => {
    const rows = [result("v5", "won"), result("v5", "lost"), result("v5", "won", "2026-11-09")];
    expect(summarizeModelResults(rows, "v5", new Set(["2026-11-10"]))).toMatchObject({ w: 1, l: 1, p: 0, open: 0 });
  });
  it("uses actual odds for units and defaults missing odds to -110", () => {
    const rows = [result("v6", "won", "2026-11-10", 120), result("v6", "won", "2026-11-10", null), result("v6", "lost")];
    expect(summarizeModelResults(rows, "v6", new Set(["2026-11-10"])).units).toBeCloseTo(1.2 + 100 / 110 - 1);
  });
});
