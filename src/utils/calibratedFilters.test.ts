import { describe, it, expect } from "vitest";
import { calibrationVeto, onePerPlayer } from "./calibratedFilters";
const base = { player: "A", stat: "points", side: "over" as const, trend: "flat", hitRate: 0.7, ev: 0.1 };
describe("calibration filters", () => {
  it("blocks cold scorers on points Overs", () => expect(calibrationVeto({ ...base, trend: "cold" })).not.toBeNull());
  it("blocks cold players on PRA Overs", () => expect(calibrationVeto({ ...base, stat: "pra", trend: "cold" })).not.toBeNull());
  it("blocks hot scorers on points Unders", () => expect(calibrationVeto({ ...base, side: "under", trend: "hot" })).not.toBeNull());
  it("keeps hot-player assist Unders (went 6-0)", () => expect(calibrationVeto({ ...base, stat: "assists", side: "under", trend: "hot" })).toBeNull());
  it("requires 65% and 8% edge on threes", () => {
    expect(calibrationVeto({ ...base, stat: "threes_made", hitRate: 0.64 })).not.toBeNull();
    expect(calibrationVeto({ ...base, stat: "threes_made", ev: 0.07 })).not.toBeNull();
    expect(calibrationVeto({ ...base, stat: "threes_made", hitRate: 0.65, ev: 0.08 })).toBeNull();
  });
  it("keeps only one prop per player", () =>
    expect(onePerPlayer([{ player: "Tyson", n: 1 }, { player: "Tyson", n: 2 }, { player: "Okoro", n: 3 }]).map((p) => p.n)).toEqual([1, 3]));
});
