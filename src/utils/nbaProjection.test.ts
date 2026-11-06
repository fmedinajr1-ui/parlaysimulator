import { describe, it, expect } from "vitest";
import { projectProp, opponentFactors, type ProjectionContext, type MissingMate } from "./nbaProjection";
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

describe("teammate out by position and minutes", () => {
  const center: MissingMate = { name: "Big Man", position: "C", stat: 10, minutes: 32 };
  const reb = (pos: string, min = 30) =>
    projectProp(games([6, 6, 6, 6, 6, 6, 6, 6]).map((g) => ({ ...g, rebounds: 6, minutes_played: min })), "rebounds", 5.5, -110, -110,
      { ...ctx, position: pos, teammatesOut: [center] })!;
  it("a big gets more of a missing center's rebounds than a guard", () => {
    expect(reb("PF").projection).toBeGreaterThan(reb("PG").projection);
  });
  it("a guard gets no 'Teammate out' reason from a missing center", () => {
    expect(reb("PG").notes).not.toContain("Teammate out");
  });
  it("a bench big gets a smaller bump than a starter big", () => {
    expect(reb("C", 30).projection).toBeGreaterThan(reb("C", 14).projection);
  });
  it("the reason names the missing player and his minutes", () => {
    const r = reb("C").reasons.find((x) => x.label === "Teammate out")!;
    expect(r.why).toContain("Big Man (C, 32 min)");
  });
  it("a teammate who barely plays adds no reason", () => {
    const p = projectProp(games([6, 6, 6, 6, 6, 6]).map((g) => ({ ...g, rebounds: 6 })), "rebounds", 5.5, -110, -110,
      { ...ctx, position: "C", teammatesOut: [{ name: "Deep Bench", position: "C", stat: 1, minutes: 6 }] })!;
    expect(p.notes).not.toContain("Teammate out");
  });
});

describe("home / road venue reasons", () => {
  // 5 home games at 20 pts, 5 road games at 10 pts -> overall 15.
  const split: [number, boolean][] = [
    [20, true], [10, false], [20, true], [10, false], [20, true],
    [10, false], [20, true], [10, false], [20, true], [10, false],
  ];
  const venueGames = (rows: [number, boolean][], startDay = 25): GameLog[] =>
    rows.map(([p, home], i) => ({
      player_name: "A", game_date: `2026-10-${String(startDay - i).padStart(2, "0")}`, opponent: "X",
      minutes_played: 30, points: p, rebounds: 5, assists: 5, threes_made: 1, is_home: home,
    }));
  const at = (home: boolean | null, rows = split) =>
    projectProp(venueGames(rows), "points", 25.5, -110, -110, { ...ctx, home })!;

  it("a player on the road with a lower road average gets 'Road dip'", () => {
    const p = at(false);
    expect(p.notes).toContain("Road dip");
    expect(p.notes.some((n) => n.startsWith("Home"))).toBe(false);
    const r = p.reasons.find((x) => x.label === "Road dip")!;
    expect(r.pct).toBe(-5);
    expect(r.why).toContain("on the road");
  });
  it("the same player at home gets 'Home boost' instead", () => {
    const p = at(true);
    expect(p.notes).toContain("Home boost");
    expect(p.notes.some((n) => n.startsWith("Road"))).toBe(false);
    const r = p.reasons.find((x) => x.label === "Home boost")!;
    expect(r.pct).toBe(5);
    expect(r.why).toContain("at home");
  });
  it("adds no venue reason when the venue is unknown", () => {
    const p = at(null);
    expect(p.notes.some((n) => /Home |Road /.test(n))).toBe(false);
  });
  it("needs 3 games at that venue before it speaks", () => {
    const thin: [number, boolean][] = [
      [20, true], [20, true], [20, true], [20, true], [20, true],
      [20, true], [20, true], [20, true], [10, false], [10, false],
    ];
    expect(at(false, thin).notes.some((n) => /Home |Road /.test(n))).toBe(false);
  });
  it("never moves the projection more than 5% for venue", () => {
    const extreme: [number, boolean][] = [
      [30, true], [0, false], [30, true], [0, false], [30, true],
      [0, false], [30, true], [0, false], [30, true], [0, false],
    ];
    for (const home of [true, false]) {
      const r = at(home, extreme).reasons.find((x) => /Home |Road /.test(x.label))!;
      expect(Math.abs(r.pct)).toBeLessThanOrEqual(5);
    }
  });
});

describe("v3 calibration lessons from Bam's 0-assist game", () => {
  const bamGames: GameLog[] = [
    ["2026-11-04", 4, 41, false], ["2026-11-02", 4, 31, false],
    ["2026-10-30", 3, 33, true], ["2026-10-28", 3, 33, false],
    ["2026-10-26", 3, 30, true], ["2026-10-24", 4, 39, false],
    ["2026-10-23", 3, 23, true], ["2026-10-21", 4, 31, true],
    ["2026-10-20", 3, 29, true], ["2026-04-14", 1, 11, false],
  ].map(([date, assists, minutes, home]) => ({
    player_name: "Bam Adebayo", game_date: String(date), opponent: "X",
    minutes_played: Number(minutes), points: 20, rebounds: 10,
    assists: Number(assists), threes_made: 1, is_home: Boolean(home),
  }));
  const bamCtx: ProjectionContext = {
    seasonStart: "2026-10-01", today: "2026-11-05", home: false,
    oppFactor: 1.16, teammatesOut: [], position: "C",
  };

  it("does not turn Bam's 4-for-9 Over into a 90% recommendation", () => {
    const p = projectProp(bamGames, "assists", 3.5, -138, 100, bamCtx)!;
    expect(p.side).toBe("under");
    expect(p.prob).toBeLessThan(0.6);
    expect(p.projection).toBe(3.36);
  });

  it("uses typical minutes so one overtime game cannot add 15%", () => {
    const p = projectProp(bamGames, "assists", 3.5, -138, 100, bamCtx)!;
    const minutes = p.reasons.find((r) => r.label.startsWith("Minutes"))!;
    expect(minutes.pct).toBeLessThan(15);
    expect(minutes.why).toContain("overtime outliers");
  });

  it("does not import old road games into this season's venue boost", () => {
    const currentHome = bamGames.slice(0, 5).map((g) => ({ ...g, is_home: true }));
    const oldRoad = bamGames.slice(5).map((g) => ({ ...g, game_date: g.game_date.replace("2026", "2025"), is_home: false }));
    const p = projectProp([...currentHome, ...oldRoad], "assists", 3.5, -110, -110, { ...bamCtx, oppFactor: 1 })!;
    expect(p.notes.some((n) => n.startsWith("Road"))).toBe(false);
  });

  it("caps all combined context boosts at 12%", () => {
    const heavyMinutes = games([10, 10, 10, 10, 10, 10, 10, 10]).map((g, i) => ({ ...g, minutes_played: i < 3 ? 40 : 30 }));
    const p = projectProp(heavyMinutes, "points", 9.5, -110, -110, {
      ...ctx, oppFactor: 1.5, position: "C",
      teammatesOut: [{ name: "Star", position: "C", stat: 100, minutes: 40 }],
    })!;
    expect(p.projection).toBe(11.2);
  });

  it("keeps the actual weighted hit rate in the win probability", () => {
    const actual = games([4, 4, 4, 4, 3, 3, 3, 3, 3]).map((g) => ({ ...g, assists: g.points }));
    const p = projectProp(actual, "assists", 3.5, 1000, -1000, ctx)!;
    expect(p.side).toBe("over");
    expect(p.prob).toBeCloseTo(0.45, 2);
  });
});
