import { describe, it, expect } from "vitest";
import { calibrationVeto, stressNotes } from "./calibratedFilters";
const base = { player: "A", stat: "points", trend: "flat", hitRate: 0.75, ev: 0.1, line: 10, projection: 8 } as const;
describe("stress-test and coach rules", () => {
  it("blocks Under with 2 key teammates out", () => expect(calibrationVeto({ ...base, side: "under", keyMatesOut: 2 })).toMatch(/Role alert/));
  it("allows Under with 1 key teammate out", () => expect(calibrationVeto({ ...base, side: "under", keyMatesOut: 1 })).toBeNull());
  it("matchup miss no longer blocks, only warns", () => {
    const p = { ...base, side: "under" as const, vsOpponent: [12] };
    expect(calibrationVeto(p)).toBeNull(); expect(stressNotes(p)[0]).toMatch(/Matchup/);
  });
  it("short last game no longer blocks an Over, only warns", () => {
    const p = { ...base, side: "over" as const, projection: 12, lastMinutes: 21 };
    expect(calibrationVeto(p)).toBeNull(); expect(stressNotes(p)[0]).toMatch(/Minutes/);
  });
  it("blocks points Under on a 25+ PPG star under 24.5", () =>
    expect(calibrationVeto({ ...base, side: "under", line: 21.5, projection: 18, seasonPoints: 28 })).toMatch(/Star/));
  it("allows star Under on a 26.5 line", () =>
    expect(calibrationVeto({ ...base, side: "under", line: 26.5, projection: 23, seasonPoints: 28 })).toBeNull());
  it("blocks Over for a sub-22 minute bench player", () =>
    expect(calibrationVeto({ ...base, side: "over", projection: 12, seasonMinutes: 15 })).toMatch(/Bench/));
});
