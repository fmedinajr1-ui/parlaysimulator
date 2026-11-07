import { describe, expect, it } from "vitest";
import { buildSeasonVenueLeaders } from "./seasonVenueLeaders";
import type { GameLog } from "./nbaBoxScoreMath";

function game(overrides: Partial<GameLog> = {}): GameLog {
  return {
    player_name: "Alpha",
    game_date: "2026-11-01",
    opponent: "BOS",
    minutes_played: 30,
    points: 20,
    rebounds: 5,
    assists: 4,
    threes_made: 2,
    is_home: true,
    ...overrides,
  };
}

const lines = new Map([["alpha|points", 19.5]]);

describe("current-season venue leaders", () => {
  it("uses only games from the requested season", () => {
    const players = new Map([["Alpha", [
      game({ game_date: "2025-12-01", points: 50 }),
      game({ game_date: "2026-10-20", points: 20 }),
      game({ game_date: "2026-10-22", points: 22 }),
      game({ game_date: "2026-10-24", points: 24 }),
    ]]]);
    const [row] = buildSeasonVenueLeaders(players, "points", lines, "home");
    expect(row.games).toBe(3);
    expect(row.average).toBe(22);
    expect(row.median).toBe(22);
  });

  it("excludes DNPs and games with an unknown venue", () => {
    const players = new Map([["Alpha", [
      game({ points: 10 }),
      game({ game_date: "2026-11-02", points: 12 }),
      game({ game_date: "2026-11-03", points: 14, minutes_played: 0 }),
      game({ game_date: "2026-11-04", points: 30, is_home: null }),
    ]]]);
    expect(buildSeasonVenueLeaders(players, "points", lines, "home")).toEqual([]);
  });

  it("requires the minimum number of venue games", () => {
    const players = new Map([["Alpha", [
      game({ points: 25 }),
      game({ game_date: "2026-11-02", points: 25 }),
      game({ game_date: "2026-11-03", points: 25 }),
    ]]]);
    expect(buildSeasonVenueLeaders(players, "points", lines, "home", { minGames: 4 })).toEqual([]);
    expect(buildSeasonVenueLeaders(players, "points", lines, "home", { minGames: 3 })).toHaveLength(1);
  });

  it("separates home and road splits", () => {
    const players = new Map([["Alpha", [
      game({ points: 30 }),
      game({ game_date: "2026-11-02", points: 30 }),
      game({ game_date: "2026-11-03", points: 30 }),
      game({ game_date: "2026-11-04", points: 5, is_home: false }),
    ]]]);
    expect(buildSeasonVenueLeaders(players, "points", lines, "home")[0].hitRate).toBe(1);
    expect(buildSeasonVenueLeaders(players, "points", lines, "road")).toEqual([]);
  });

  it("ranks Overs by strict over-hit rate and then by sample size", () => {
    const players = new Map<string, GameLog[]>([
      ["Alpha", [20, 22, 24].map((points, index) => game({ game_date: `2026-11-0${index + 1}`, points }))],
      ["Beta", [20, 22, 24, 26].map((points, index) => game({ player_name: "Beta", game_date: `2026-10-2${index + 1}`, points }))],
    ]);
    const allLines = new Map([["alpha|points", 19.5], ["beta|points", 19.5]]);
    const rows = buildSeasonVenueLeaders(players, "points", allLines, "home");
    expect(rows.map((row) => row.player)).toEqual(["Beta", "Alpha"]);
    expect(rows[0]).toMatchObject({ hits: 4, games: 4, hitRate: 1 });
  });

  it("ranks Unders using values strictly below the line", () => {
    const players = new Map([["Alpha", [
      game({ points: 18 }),
      game({ game_date: "2026-11-02", points: 19 }),
      game({ game_date: "2026-11-03", points: 19.5 }),
      game({ game_date: "2026-11-04", points: 25 }),
    ]]]);
    const [row] = buildSeasonVenueLeaders(players, "points", lines, "home", { side: "under" });
    expect(row).toMatchObject({ hits: 2, games: 4, hitRate: 0.5, median: 19.25, margin: 0.25 });
  });

  it("omits players without a current line and honors the result limit", () => {
    const players = new Map<string, GameLog[]>([
      ["Alpha", [20, 22, 24].map((points, index) => game({ game_date: `2026-11-0${index + 1}`, points }))],
      ["Beta", [20, 22, 24].map((points, index) => game({ player_name: "Beta", game_date: `2026-11-0${index + 1}`, points }))],
    ]);
    expect(buildSeasonVenueLeaders(players, "points", lines, "home")).toHaveLength(1);
    const bothLines = new Map<string, number>([...lines, ["beta|points", 19.5]]);
    expect(buildSeasonVenueLeaders(players, "points", bothLines, "home", { limit: 1 })).toHaveLength(1);
  });

  it("calculates PRA from points, rebounds, and assists", () => {
    const players = new Map([["Alpha", [
      game({ points: 20, rebounds: 5, assists: 4 }),
      game({ game_date: "2026-11-02", points: 22, rebounds: 6, assists: 5 }),
      game({ game_date: "2026-11-03", points: 24, rebounds: 7, assists: 6 }),
    ]]]);
    const praLines = new Map([["alpha|pra", 29.5]]);
    const [row] = buildSeasonVenueLeaders(players, "pra", praLines, "home");
    expect(row).toMatchObject({ average: 33, median: 33, hits: 3, hitRate: 1 });
  });
});
