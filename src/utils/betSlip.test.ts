import { describe, expect, it } from "vitest";
import { parlayOdds, parlayStatus } from "./betSlip";

describe("parlay math", () => {
  it("two -110 legs pay about +264", () => expect(parlayOdds([-110, -110])).toBe(264));
  it("+100 and +100 pays +300", () => expect(parlayOdds([100, 100])).toBe(300));
  it("one lost leg loses the parlay", () => expect(parlayStatus([{ status: "won", odds: -110 }, { status: "lost", odds: -110 }]).status).toBe("lost"));
  it("an open leg keeps it open", () => expect(parlayStatus([{ status: "won", odds: -110 }, { status: "open", odds: -110 }]).status).toBe("open"));
  it("void leg drops out and the rest pays", () => {
    const r = parlayStatus([{ status: "won", odds: 100 }, { status: "void", odds: -110 }]);
    expect(r).toEqual({ status: "won", odds: 100 });
  });
});
