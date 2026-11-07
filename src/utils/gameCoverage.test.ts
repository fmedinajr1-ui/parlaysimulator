import { describe, expect, it } from "vitest";
import { buildGameCoverage, type GameCoveragePlayerInput } from "./gameCoverage";

const row = (overrides: Partial<GameCoveragePlayerInput> = {}): GameCoveragePlayerInput => ({
  player: "Road Player",
  team: "Boston Celtics",
  opponent: "Miami Heat",
  home: false,
  stat: "points",
  ...overrides,
});

describe("buildGameCoverage", () => {
  it("combines players from both teams into one correctly oriented matchup", () => {
    const games = buildGameCoverage([
      row(),
      row({ player: "Home Player", team: "Miami Heat", opponent: "Boston Celtics", home: true, stat: "rebounds" }),
    ], []);
    expect(games).toHaveLength(1);
    expect(games[0].label).toBe("Boston Celtics @ Miami Heat");
    expect(games[0].playerCount).toBe(2);
  });

  it("counts each player's different props once across duplicate sportsbook rows", () => {
    const games = buildGameCoverage([
      row(),
      row(),
      row({ stat: "assists" }),
    ], []);
    expect(games[0].players[0].props).toEqual(["assists", "points"]);
    expect(games[0].propCount).toBe(2);
  });

  it("keeps separate games separate", () => {
    const games = buildGameCoverage([
      row(),
      row({ player: "Other Player", team: "New York Knicks", opponent: "Chicago Bulls", home: true }),
    ], []);
    expect(games).toHaveLength(2);
  });

  it("attaches every qualifying pick to the right player regardless of name casing", () => {
    const games = buildGameCoverage([row(), row({ stat: "assists" })], [
      { player: "ROAD PLAYER", stat: "points", side: "over", line: 20.5 },
      { player: "road player", stat: "assists", side: "under", line: 5.5 },
    ]);
    expect(games[0].players[0].picks.map((pick) => pick.stat)).toEqual(["points", "assists"]);
    expect(games[0].pickCount).toBe(2);
  });

  it("keeps covered players visible when they have no qualifying pick", () => {
    const games = buildGameCoverage([row()], []);
    expect(games[0].players[0].player).toBe("Road Player");
    expect(games[0].players[0].picks).toEqual([]);
    expect(games[0].pickCount).toBe(0);
  });

  it("excludes rows without a reliable venue or opponent", () => {
    const games = buildGameCoverage([
      row({ home: null }),
      row({ opponent: null }),
    ], []);
    expect(games).toEqual([]);
  });
});
