import { describe, expect, it } from "vitest";
import { reviewDeskPicks } from "./deskReview";
const clean = { side: "over" as const, hitRate: 0.65, hitsL10: 7, gamesL10: 10, trend: "hot" };
describe("desk review placement", () => {
  it("keeps a backed pick in the clear pool", () => {
    expect(reviewDeskPicks([clean]).clear).toEqual([clean]);
  });
  it("moves a cold Over out of main recommendations", () => {
    const pick = { ...clean, trend: "cold" };
    expect(reviewDeskPicks([pick])).toEqual({ clear: [], flagged: [pick], total: 1 });
  });
  it("moves a hot Under to skeptical placement", () => {
    const pick = { ...clean, side: "under" as const };
    expect(reviewDeskPicks([pick]).flagged).toEqual([pick]);
  });
  it("flags the exact ten-point model vs actual gap", () => {
    const pick = { ...clean, hitRate: 0.7, hitsL10: 6, trend: "flat" };
    expect(reviewDeskPicks([pick]).clear).toHaveLength(0);
    expect(reviewDeskPicks([pick]).flagged).toEqual([pick]);
  });
  it("preserves ranking and all original probability values", () => {
    const next = { ...clean, hitRate: 0.6 };
    const picks = [clean, { ...clean, trend: "cold" }, next];
    const before = structuredClone(picks);
    expect(reviewDeskPicks(picks).clear).toEqual([clean, next]);
    expect(picks).toEqual(before);
  });
});