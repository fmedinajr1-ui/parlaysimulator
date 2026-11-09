import { describe, expect, it } from "vitest";
import { opponentAllowances, productionContext } from "./projectionContext";
import { projectProp, MODEL_VERSION } from "./nbaProjection";
import type { GameLog } from "./nbaBoxScoreMath";

const today = "2026-11-09";
const log = (i: number, extra: Partial<GameLog> = {}): GameLog => ({ player_name: `Player ${i}`, game_date: `2026-11-${String(8 - i).padStart(2, "0")}`, opponent: "Defense", minutes_played: 30, points: 20, rebounds: 5, assists: 4, threes_made: 2, ...extra });
const teamGames = (opp: string, assists: number, rebounds: number) => Array.from({ length: 3 }, (_, d) => Array.from({ length: 8 }, (_, p) => log(d, { player_name: `P${p}`, opponent: opp, assists, rebounds }))).flat();

describe("complete opponent allowances", () => {
  it("calculates team assists and rebounds allowed against league averages", () => {
    const out = opponentAllowances([...teamGames("A", 3, 5), ...teamGames("B", 5, 7)], today, "2026-10-01");
    expect(out.get("A")?.assists).toEqual({ average: 24, league: 32, games: 3, factor: 0.75 });
    expect(out.get("B")?.rebounds.average).toBe(56);
  });
  it("excludes incomplete team games", () => {
    expect(opponentAllowances([log(0)], today, "2026-10-01").size).toBe(0);
  });
  it("requires three complete games per opponent", () => {
    expect(opponentAllowances(teamGames("A", 3, 5).filter((g) => g.game_date !== "2026-11-06"), today, "2026-10-01").size).toBe(0);
  });
  it("does not double count duplicate player box scores", () => {
    const games = teamGames("A", 3, 5);
    expect(opponentAllowances([...games, ...games], today, "2026-10-01").get("A")?.assists.average).toBe(24);
  });
  it("excludes same-day and prior-season data", () => {
    const games = teamGames("A", 3, 5).map((g) => ({ ...g, game_date: today }));
    expect(opponentAllowances(games, today, "2026-10-01").size).toBe(0);
    expect(opponentAllowances(teamGames("A", 3, 5), today, "2026-12-01").size).toBe(0);
  });
});

describe("shot attempts and plus-minus context", () => {
  const games = Array.from({ length: 7 }, (_, i) => log(i, { field_goals_attempted: i < 5 ? 20 : 10, plus_minus: -5 }));
  it("shows L5 and L10 shot attempts", () => {
    const p = productionContext(games, today);
    expect(p.fgaL5).toBe(20); expect(p.fgaL10).toBeCloseTo(120 / 7);
  });
  it("caps shot opportunity adjustment at five percent", () => {
    expect(productionContext(games, today).shotFactor).toBe(1.05);
  });
  it("does not apply another minutes adjustment", () => {
    const proportional = games.map((g, i) => ({ ...g, field_goals_attempted: i < 5 ? 20 : 10, minutes_played: i < 5 ? 40 : 20 }));
    expect(productionContext(proportional, today).shotFactor).toBe(1);
  });
  it("does not turn missing plus-minus into zero", () => {
    const p = productionContext(games.map((g) => ({ ...g, plus_minus: null })), today);
    expect(p.plusMinus).toBeNull(); expect(p.plusMinusGames).toBe(0);
  });
  it("keeps signed plus-minus as context", () => {
    expect(productionContext(games, today).plusMinus).toBe(-5);
  });
  it("leaves insufficient attempts neutral", () => {
    expect(productionContext([log(0)], today).shotFactor).toBe(1);
  });
  it("does not use today's results", () => {
    expect(productionContext(games.map((g) => ({ ...g, game_date: today })), today).fgaL10).toBeNull();
  });
  it("changes only the trial, not v5", () => {
    const ctx = { today, seasonStart: "2026-10-01", home: null, oppFactor: 1, teammatesOut: [] };
    const p = productionContext(games, today);
    expect(projectProp(games, "points", 20, -110, -110, { ...ctx, production: p })).toEqual(projectProp(games, "points", 20, -110, -110, ctx));
    expect(MODEL_VERSION).toBe("v5-rest-aware");
    expect(projectProp(games, "points", 20, -110, -110, { ...ctx, production: p, projectedMinutesModel: true })?.projection).toBeGreaterThan(20);
  });
  it("never adjusts production directly for plus-minus", () => {
    const ctx = { today, seasonStart: "2026-10-01", home: null, oppFactor: 1, teammatesOut: [], projectedMinutesModel: true };
    const p = productionContext(games, today);
    const a = projectProp(games, "points", 20, -110, -110, { ...ctx, production: p });
    const b = projectProp(games, "points", 20, -110, -110, { ...ctx, production: { ...p, plusMinus: 30 } });
    expect(a?.projection).toBe(b?.projection);
    expect(a?.prob).toBe(b?.prob);
  });
});