import { describe, it, expect } from "vitest";
import { gradeGamePlay } from "../../supabase/functions/_shared/research/gameBoard.ts";

const base = { home: "Minnesota Timberwolves", away: "Portland Trail Blazers" };
describe("gradeGamePlay", () => {
  it("Under wins when total is below the line", () => expect(gradeGamePlay({ ...base, market: "total", pick: "Under 225.5", odds: -110 }, 110, 100).status).toBe("won"));
  it("Over loses when total is below the line", () => expect(gradeGamePlay({ ...base, market: "total", pick: "Over 225.5", odds: -110 }, 110, 100)).toEqual({ status: "lost", profit_units: -1 }));
  it("whole-number total landing exactly is a push with 0 units", () => expect(gradeGamePlay({ ...base, market: "total", pick: "Over 220", odds: -110 }, 120, 100)).toEqual({ status: "push", profit_units: 0 }));
  it("underdog ML win pays +124 as 1.24 units", () => expect(gradeGamePlay({ ...base, market: "moneyline", pick: "Portland Trail Blazers ML", odds: 124 }, 100, 105)).toEqual({ status: "won", profit_units: 1.24 }));
  it("favorite ML win at -146 pays about 0.685 units", () => expect(gradeGamePlay({ ...base, market: "moneyline", pick: "Minnesota Timberwolves ML", odds: -146 }, 115, 100).profit_units).toBeCloseTo(0.685, 3));
  it("home ML loses when away team wins", () => expect(gradeGamePlay({ ...base, market: "moneyline", pick: "Minnesota Timberwolves ML", odds: -146 }, 99, 100).status).toBe("lost"));
});
