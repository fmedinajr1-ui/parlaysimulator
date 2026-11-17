import { describe, it, expect } from "vitest";
import { fatigue, paceFatigue, sharpStructure, noVig, type GameInput, type TeamGame } from "./gameModels";

const games = (dates: string[], pts = 115, oppPts = 110, poss = 100): TeamGame[] =>
  dates.map((date) => ({ date, pts, oppPts, poss, minutes: 240, home: true }));
const base = (over: Partial<GameInput> = {}): GameInput => ({
  date: "2026-11-17", home: "HOM", away: "AWY",
  homeGames: games(["2026-11-10", "2026-11-12", "2026-11-14"]),
  awayGames: games(["2026-11-10", "2026-11-12", "2026-11-14"]),
  total: 225, over: { odds: -110, book: "fd" }, under: { odds: -110, book: "fd" },
  homeSpread: -3, homeML: { odds: -150, book: "fd" }, awayML: { odds: 130, book: "fd" },
  sharp: { source: "Pinnacle", homeWin: 0.58, over: 0.5, total: 225 }, ...over,
});

describe("game models", () => {
  it("road back-to-back scores 36 fatigue", () => {
    expect(fatigue(games(["2026-11-16"]), "2026-11-17", false).score).toBe(36);
  });
  it("pace & fatigue backs the rested team when the gap is 15+", () => {
    const r = paceFatigue(base({ awayGames: games(["2026-11-14", "2026-11-15", "2026-11-16"]) }));
    expect(r.plays.find((p) => p.market === "moneyline")?.pick).toBe("HOM ML");
  });
  it("pace & fatigue skips a rested favorite priced over 80% (juice trap)", () => {
    const r = paceFatigue(base({ homeML: { odds: -500, book: "fd" }, awayGames: games(["2026-11-14", "2026-11-15", "2026-11-16"]) }));
    expect(r.plays.some((p) => p.market === "moneyline")).toBe(false);
  });
  it("sharp method bans moneylines on spreads of 9.5+", () => {
    expect(sharpStructure(base({ homeSpread: -10, sharp: { source: "P", homeWin: 0.3, over: 0.5, total: 225 } })).plays.some((p) => p.market === "moneyline")).toBe(false);
  });
  it("sharp method adds the 2% Under nudge to a fair 50/50 total and needs 2% profit", () => {
    expect(sharpStructure(base({ under: { odds: 105, book: "fd" } })).plays.find((p) => p.market === "total")?.pick).toBe("Under 225");
    expect(sharpStructure(base()).plays.some((p) => p.market === "total")).toBe(false);
  });
  it("no-vig splits -110/-110 to 50%", () => { expect(noVig(-110, -110)).toBeCloseTo(0.5); });
});
