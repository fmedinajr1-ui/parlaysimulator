import { describe, expect, it } from "vitest";
import { restProfile } from "./restProfile";
import type { GameLog } from "./nbaBoxScoreMath";

const game = (date: string, minutes = 30): GameLog => ({
  player_name: "A", game_date: date, minutes_played: minutes, points: 20,
  rebounds: 5, assists: 5, threes_made: 2, opponent: "X",
});

describe("restProfile", () => {
  it("marks yesterday as a back-to-back and trims high-minute players 5%", () => {
    const rest = restProfile([game("2026-11-06", 36)], "2026-11-07");
    expect(rest).toMatchObject({ daysRest: 0, status: "back-to-back", factor: 0.95, b2b: true });
  });
  it("uses the smaller 3% back-to-back trim below 32 minutes", () => {
    expect(restProfile([game("2026-11-06", 28)], "2026-11-07").factor).toBe(0.97);
  });
  it("treats one full day off as normal rest with no adjustment", () => {
    expect(restProfile([game("2026-11-05")], "2026-11-07")).toMatchObject({ daysRest: 1, status: "normal", factor: 1 });
  });
  it("adds only 1% after two full days off", () => {
    expect(restProfile([game("2026-11-04")], "2026-11-07")).toMatchObject({ daysRest: 2, status: "rested", factor: 1.01 });
  });
  it("adds 2% after three or more full days off", () => {
    expect(restProfile([game("2026-11-03")], "2026-11-07")).toMatchObject({ daysRest: 3, status: "well-rested", factor: 1.02 });
  });
  it("caps the extended-rest boost at 2% even after a long break", () => {
    expect(restProfile([game("2026-10-20")], "2026-11-07").factor).toBe(1.02);
  });
  it("ignores DNPs and games dated today or later", () => {
    const rest = restProfile([game("2026-11-06"), game("2026-11-07"), game("2026-11-05", 0)], "2026-11-07");
    expect(rest.lastGameDate).toBe("2026-11-06");
  });
  it("handles month boundaries using calendar dates", () => {
    expect(restProfile([game("2026-10-30")], "2026-11-02").daysRest).toBe(2);
  });
  it("returns a neutral unknown state without played history", () => {
    expect(restProfile([], "2026-11-07")).toMatchObject({ daysRest: null, status: "unknown", factor: 1 });
  });
});
