import { describe, it, expect } from "vitest";
import { projectProp, opponentFactors, type ProjectionContext } from "./nbaProjection";
import type { GameLog } from "./nbaBoxScoreMath";

const ctx: ProjectionContext = { seasonStart: "2026-10-01", today: "2026-11-04", home: null, oppFactor: 1, teammatesOut: [] };
const games = (pts: number[], opts: Partial<GameLog> = {}, startDay = 25): GameLog[] =>
  pts.map((p, i) => ({
    player_name: "A", game_date: `2026-10-${String(startDay - i).padStart(2, "0")}`, opponent: "X",
    minutes_played: 30, points: p, rebounds: 5, assists: 5, threes_made: 1, ...opts,
  }));

describe("projectProp", () => {
  it("picks Over when the player keeps clearing the line", () => {
    const p = projectProp(games([30, 28, 31, 29, 27, 30, 32, 26]), "points", 22.5, -110, -110, ctx)!;
    expect(p.side).toBe("over");
    expect(p.ev).toBeGreaterThan(0);
  });
  it("picks Under when the player stays below", () => {
    const p = projectProp(games([12, 10, 14, 11, 9, 13, 12, 10]), "points", 18.5, -110, -110, ctx)!;
    expect(p.side).toBe("under");
  });
  it("never rates a 10/10 hit rate as certain", () => {
    const p = projectProp(games([30, 30, 30, 30, 30, 30, 30, 30, 30, 30]), "points", 10.5, -110, -110, ctx)!;
    expect(p.prob).toBeLessThan(1);
  });
  it("cuts the projection on a back-to-back", () => {
    const rested = projectProp(games([20, 20, 20, 20, 20, 20]), "points", 19.5, -110, -110, ctx)!;
    const b2b = projectProp(games([20, 20, 20, 20, 20, 20], {}, 33).map((g, i) => ({ ...g, game_date: i === 0 ? "2026-11-03" : g.game_date })), "points", 19.5, -110, -110, ctx)!;
    expect(b2b.projection).toBeLessThan(rested.projection);
    expect(b2b.notes).toContain("Back-to-back");
  });
  it("needs 3+ games this season", () => {
    const old = games([20, 20, 20, 20, 20, 20]).map((g) => ({ ...g, game_date: g.game_date.replace("2026", "2025") }));
    expect(projectProp(old, "points", 19.5, -110, -110, ctx)).toBeNull();
  });
  it("rates a team that gives up more points as softer", () => {
    const logs: GameLog[] = [];
    for (const [opp, pts] of [["Soft", 130], ["Avg", 110], ["Tough", 100]] as const)
      for (let d = 10; d < 13; d++) logs.push({ player_name: opp + d, game_date: `2026-10-${d}`, opponent: opp, minutes_played: 30, points: pts, rebounds: 0, assists: 0, threes_made: 0 });
    const f = opponentFactors(logs, "points", "2026-10-01");
    expect(f.get("Soft")!).toBeGreaterThan(1);
    expect(f.get("Tough")!).toBeLessThan(1);
  });
});
