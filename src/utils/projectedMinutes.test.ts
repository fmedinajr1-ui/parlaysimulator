import { describe, it, expect } from "vitest";
import { projectMinutes } from "./projectedMinutes";
import type { GameLog } from "./nbaBoxScoreMath";

const g = (date: string, min: number) => ({ player_name: "A", game_date: date, minutes_played: min, points: 10, rebounds: 1, assists: 1, threes_made: 1 } as unknown as GameLog);
const days = (mins: number[], start = 10) => mins.map((m, i) => g(`2026-11-${String(start - i).padStart(2, "0")}`, m));

describe("projectMinutes", () => {
  it("needs at least 3 played games", () => {
    expect(projectMinutes(days([30, 30]), "2026-11-20")).toBeNull();
  });
  it("uses the L10 median when minutes are steady", () => {
    expect(projectMinutes(days(Array(10).fill(30)), "2026-11-20")!.minutes).toBe(30);
  });
  it("caps a recent minutes surge at +15% of the L10 median", () => {
    const p = projectMinutes(days([44, 44, 44, 20, 20, 20, 20, 20, 20, 20]), "2026-11-20")!;
    expect(p.minutes).toBe(23);
  });
  it("trims 5% on a back-to-back for 32+ minute players", () => {
    const p = projectMinutes(days(Array(10).fill(34), 19), "2026-11-20")!;
    expect(p.b2b).toBe(true);
    expect(p.minutes).toBe(32.3);
  });
  it("adds a capped bump when teammates are out", () => {
    const p = projectMinutes(days(Array(10).fill(30)), "2026-11-20", 100)!;
    expect(p.mateBump).toBe(4);
    expect(p.minutes).toBe(34);
  });
  it("ignores DNPs and games on or after today", () => {
    const p = projectMinutes([...days([0, 0]), ...days(Array(5).fill(25), 8), g("2026-11-20", 40)], "2026-11-20")!;
    expect(p.l10).toBe(25);
  });
});
