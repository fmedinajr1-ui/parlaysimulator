import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { americanToImplied, devigPair, modelProbOver } from "./court-edge-edge.ts";
import { edgeFor } from "./court-edge-projection.ts";

Deno.test("americanToImplied: -110 ≈ 0.5238", () => {
  assertAlmostEquals(americanToImplied(-110), 0.5238, 0.001);
});

Deno.test("devigPair: -110/-110 normalizes to 0.5/0.5", () => {
  const r = devigPair(-110, -110)!;
  assertAlmostEquals(r.p_over_fair, 0.5, 0.0001);
  assertAlmostEquals(r.p_under_fair, 0.5, 0.0001);
});

Deno.test("modelProbOver: projection above line yields prob in (0.5, 0.99)", () => {
  const p = modelProbOver(22, 20, 3.5);
  assertEquals(p > 0.5, true);
  assertEquals(p < 0.99, true);
});

Deno.test("edgeFor: small positive edge stays under hard cap and tiers properly", () => {
  const r = edgeFor("match_total", 22, 20.5, { over_price: -110, under_price: -110, sigma: 3.5 });
  assertEquals(Math.abs(r.edge_pp) < 0.12, true);
  assertEquals(r.edge_side, "over");
  // Should not be QUARANTINE; either LEAN_OVER, STRONG_OVER, or PASS depending on σ math.
  assertEquals(r.verdict !== "QUARANTINE", true);
});

Deno.test("edgeFor: absurd projection delta routes to QUARANTINE", () => {
  const r = edgeFor("match_total", 30, 20, { over_price: -110, under_price: -110, sigma: 3.5 });
  assertEquals(r.verdict, "QUARANTINE");
  assertEquals(r.quarantine_reason, "edge_above_hard_cap");
});