import { describe, expect, it } from "vitest";
import { gameMinutesElapsed, hedgePlan, isDanger, liveLegProb, parlayCashProb } from "./liveHedge";

const base = { side: "over" as const, line: 20.5, value: 10, minutesPlayed: 16, period: 2, clockSec: 0, final: false, avgMinutes: 32, ratePerMin: 0.65 };

describe("liveHedge", () => {
  it("halftime is 24 game minutes; Q1 not started is 0", () => {
    expect(gameMinutesElapsed(2, 0)).toBe(24);
    expect(gameMinutesElapsed(0, 720)).toBe(0);
  });
  it("an Over already past the line is 100%, an Under past the line is 0%", () => {
    expect(liveLegProb({ ...base, value: 22 }).prob).toBe(1);
    expect(liveLegProb({ ...base, side: "under", value: 22 }).prob).toBe(0);
  });
  it("final games settle to exactly 1 or 0", () => {
    expect(liveLegProb({ ...base, final: true, value: 21 }).prob).toBe(1);
    expect(liveLegProb({ ...base, final: true, value: 20 }).prob).toBe(0);
  });
  it("on pace at halftime the Over is near a coin flip; well behind it is in danger", () => {
    const onPace = liveLegProb(base).prob;
    expect(onPace).toBeGreaterThan(0.4);
    expect(onPace).toBeLessThan(0.75);
    const behind = liveLegProb({ ...base, value: 4, period: 4, clockSec: 300, minutesPlayed: 28 }).prob;
    expect(isDanger(behind, false)).toBe(true);
  });
  it("hedge at -110 on a $10 +300 ticket locks the same profit both ways", () => {
    const h = hedgePlan(10, 300, -110, 0.5)!;
    expect(h.hedgeStake).toBeCloseTo(40 / (1 + 100 / 110), 2);
    expect(h.lockedProfit).toBeCloseTo(40 - 10 - h.hedgeStake, 2);
    expect(parlayCashProb([1, 0.5, 0.5])).toBe(0.25);
  });
});
