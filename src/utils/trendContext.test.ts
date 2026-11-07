import { describe, expect, it } from "vitest";
import { trendContext } from "./trendContext";
import type { GameLog } from "./nbaBoxScoreMath";

// 10 games, newest first: last 5 score `hot`, older 5 score 10.
const logs = (o: { hot?: number; min5?: number; fga5?: number; home5?: boolean; opp5?: string } = {}): GameLog[] =>
  Array.from({ length: 10 }, (_, k) => ({
    player_name: "P", game_date: `2026-10-${String(30 - k).padStart(2, "0")}`,
    opponent: k < 5 ? o.opp5 ?? "AVG" : "AVG", minutes_played: k < 5 ? o.min5 ?? 30 : 30,
    points: k < 5 ? o.hot ?? 15 : 10, rebounds: 0, assists: 0, threes_made: 0,
    field_goals_attempted: k < 5 ? o.fga5 ?? 12 : 12, threes_attempted: 4, is_home: k < 5 ? o.home5 ?? true : false,
  }));
const tone = (c: ReturnType<typeof trendContext>, key: string) => c.factors.find((f) => f.key === key)?.tone;

describe("trendContext", () => {
  it("labels hot when last-5 median is 10%+ above last-10", () => {
    expect(trendContext(logs(), "points").trend).toBe("hot");
  });
  it("hot streak with more minutes is supported by role", () => {
    expect(tone(trendContext(logs({ min5: 36 }), "points"), "minutes")).toBe("supports");
  });
  it("hot scoring on the same shot attempts is flagged as shooting luck", () => {
    expect(tone(trendContext(logs({ fga5: 12 }), "points"), "volume")).toBe("fragile");
  });
  it("hot streak built against soft defenses is fragile", () => {
    const c = trendContext(logs({ opp5: "SOFT" }), "points", { oppFactor: new Map([["SOFT", 1.1], ["AVG", 1]]) });
    expect(tone(c, "opponents")).toBe("fragile");
  });
  it("teammate back tonight makes a hot streak fragile", () => {
    const dates = new Set(["2026-10-30", "2026-10-29", "2026-10-28"]);
    expect(tone(trendContext(logs(), "points", { mateOutDates: dates, matesBackTonight: true }), "teammates")).toBe("fragile");
    expect(tone(trendContext(logs(), "points", { mateOutDates: dates, matesBackTonight: false }), "teammates")).toBe("supports");
  });
  it("back-to-back tonight is fragile for a hot streak", () => {
    expect(tone(trendContext(logs(), "points", { today: "2026-10-31" }), "rest")).toBe("fragile");
  });
  it("line raised with the streak means it's priced in", () => {
    expect(tone(trendContext(logs(), "points", { lineTonight: 15.5, linePrev: 12.5 }), "line")).toBe("fragile");
  });
  it("many fragile factors give a fragile verdict", () => {
    const c = trendContext(logs({ opp5: "SOFT" }), "points", {
      oppFactor: new Map([["SOFT", 1.1]]), today: "2026-10-31", lineTonight: 15.5, linePrev: 12.5, homeTonight: false,
    });
    expect(c.verdict).toBe("fragile");
  });
});
