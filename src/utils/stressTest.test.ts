import { describe, it, expect } from "vitest";
import { calibrationVeto } from "./calibratedFilters";
const base = { player: "A", stat: "points", trend: "flat", hitRate: 0.75, ev: 0.1, line: 10, projection: 8 } as const;
describe("stress-test vetoes", () => {
  it("blocks Under with 2 key teammates out", () => expect(calibrationVeto({ ...base, side: "under", keyMatesOut: 2 })).toMatch(/Role alert/));
  it("allows Under with 1 key teammate out", () => expect(calibrationVeto({ ...base, side: "under", keyMatesOut: 1 })).toBeNull());
  it("blocks Under that went over vs this opponent", () => expect(calibrationVeto({ ...base, side: "under", vsOpponent: [12] })).toMatch(/Matchup/));
  it("blocks Over that fell short vs this opponent", () => expect(calibrationVeto({ ...base, side: "over", projection: 12, vsOpponent: [8] })).toMatch(/Matchup/));
  it("blocks Over after a sub-26 minute game", () => expect(calibrationVeto({ ...base, side: "over", projection: 12, lastMinutes: 21 })).toMatch(/Minutes/));
  it("allows Over after 26+ minutes", () => expect(calibrationVeto({ ...base, side: "over", projection: 12, lastMinutes: 30 })).toBeNull());
});
