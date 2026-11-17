import { describe, expect, it } from "vitest";
import { auditSlip, impliedProb, legCorrelation, type SimLeg } from "./slipMonteCarlo";
const leg = (o: Partial<SimLeg> = {}): SimLeg => ({ player: "A", stat: "points", side: "over", odds: -110, winProb: 0.6, team: "X", opp: "Y", ...o });
describe("slip Monte Carlo", () => {
  it("independent legs match the naive product", () => {
    const a = auditSlip([leg({ player: "A", team: "T1", opp: "T2" }), leg({ player: "B", team: "T3", opp: "T4" })], 40000);
    expect(a.simProb).toBeCloseTo(0.36, 1);
  });
  it("same-player same-side legs raise the joint chance", () => {
    const a = auditSlip([leg({ stat: "points" }), leg({ stat: "rebounds" })], 40000);
    expect(a.simProb).toBeGreaterThan(0.38);
  });
  it("two scoring Overs on one team are a drag", () => {
    expect(legCorrelation(leg({ player: "A" }), leg({ player: "B" }))).toBe(-0.15);
  });
  it("book implied for a 4-leg -110 parlay is about 7.5%", () => {
    const a = auditSlip([0, 1, 2, 3].map((i) => leg({ player: `P${i}`, team: `T${i}`, opp: `O${i}` })));
    expect(a.bookProb).toBeCloseTo(0.0753, 3);
  });
  it("flags divergence above 1.5x the book", () => {
    const a = auditSlip([0.77, 0.66, 0.66, 0.67].map((w, i) => leg({ player: `P${i}`, team: `T${i}`, opp: `O${i}`, winProb: w })));
    expect(a.divergence).toBeGreaterThan(1.5);
    expect(a.warning).not.toBeNull();
  });
  it("falls back to book price without a model chance", () => {
    expect(impliedProb(-110)).toBeCloseTo(0.5238, 3);
    expect(auditSlip([leg({ winProb: null })]).usedModel).toBe(false);
  });
});
