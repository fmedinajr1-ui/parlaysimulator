import { describe, it, expect } from "vitest";
import { pickWarnings } from "./pickWarnings";
describe("pickWarnings", () => {
  it("flags Robinson case: 70% model vs 6/10 and cold Over", () => {
    expect(pickWarnings({ side: "over", hitRate: 0.7, hitsL10: 6, gamesL10: 10, trend: "cold" })).toHaveLength(2);
  });
  it("no warning when hit record backs the model", () => {
    expect(pickWarnings({ side: "over", hitRate: 0.65, hitsL10: 7, gamesL10: 10, trend: "hot" })).toEqual([]);
  });
  it("flags hot Under", () => {
    expect(pickWarnings({ side: "under", hitRate: 0.6, hitsL10: 6, gamesL10: 10, trend: "hot" })).toHaveLength(1);
  });
  it("gap under 10 points is not flagged", () => {
    expect(pickWarnings({ side: "under", hitRate: 0.65, hitsL10: 6, gamesL10: 10, trend: "flat" })).toEqual([]);
  });
  it("gap of exactly 10 points is flagged", () => {
    expect(pickWarnings({ side: "over", hitRate: 0.7, hitsL10: 6, gamesL10: 10 })).toHaveLength(1);
  });
});
