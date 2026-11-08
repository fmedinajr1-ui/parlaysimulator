import { describe, expect, it } from "vitest";
import { MODEL_VERSION, projectProp, type ProjectionContext } from "./nbaProjection";
import type { GameLog } from "./nbaBoxScoreMath";
const ctx: ProjectionContext = { today: "2026-11-07", seasonStart: "2026-10-01", home: null, oppFactor: 1, teammatesOut: [] };
const logs = (minutes: number[], start = 5): GameLog[] => minutes.map((minutes_played, i) => ({
  player_name: "A", game_date: `2026-10-${String(25 - i).padStart(2, "0")}`, minutes_played, points: 20,
  assists: 5, rebounds: 5, threes_made: 2, opponent: "X",
}));
describe("v6 shadow model integration", () => {
  it("keeps the active version in the v5 family", () => expect(MODEL_VERSION).toBe("v5-rest-aware"));
  it("matches v5 on stable minutes", () => {
    const g = logs(Array(10).fill(30));
    expect(projectProp(g, "points", 18.5, -110, -110, { ...ctx, projectedMinutesModel: true })?.projection)
      .toBe(projectProp(g, "points", 18.5, -110, -110, ctx)?.projection);
  });
  it("dampens surges instead of applying v5's full trend", () => {
    const g = logs([40, 40, 40, 30, 30, 30, 30, 30, 30, 30]);
    expect(projectProp(g, "points", 18.5, -110, -110, { ...ctx, projectedMinutesModel: true })?.projection).toBe(21.6);
    expect(projectProp(g, "points", 18.5, -110, -110, ctx)?.projection).toBe(22.4);
  });
  it("applies rest only once through dampened minutes", () => {
    const g = logs(Array(10).fill(34)); g[0].game_date = "2026-11-06";
    const p = projectProp(g, "points", 18.5, -110, -110, { ...ctx, projectedMinutesModel: true });
    expect(p?.projection).toBe(19.35);
    expect(p?.notes).not.toContain("Back-to-back");
  });
  it("recalculates probability and EV when projected minutes change", () => {
    const g = logs([20, 20, 20, 30, 30, 30, 30, 30, 30, 30]);
    const a = projectProp(g, "points", 19.5, -110, -110, ctx);
    const b = projectProp(g, "points", 19.5, -110, -110, { ...ctx, projectedMinutesModel: true });
    expect(a?.prob).not.toBe(b?.prob); expect(a?.ev).not.toBe(b?.ev);
  });
});