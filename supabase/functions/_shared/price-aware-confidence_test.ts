import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  americanToImplied,
  devigPair,
  resolvePrice,
  evaluate,
  HARD_CONFIDENCE_CAP,
  MAX_EDGE_OVER_FAIR,
} from "./price-aware-confidence.ts";

Deno.test("devigPair: -110/-110 normalizes to ~0.5/0.5", () => {
  const r = devigPair(-110, -110)!;
  assertAlmostEquals(r.fair_over, 0.5, 0.0001);
  assertAlmostEquals(r.fair_under, 0.5, 0.0001);
});

Deno.test("resolvePrice: rejects extreme juice as ALT", () => {
  const r = resolvePrice(244, -360);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "ALT_LINE_SUSPECTED");
});

Deno.test("resolvePrice: rejects missing side as UNPRICED_MAIN", () => {
  const r = resolvePrice(-110, null);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "UNPRICED_MAIN");
});

Deno.test("resolvePrice: accepts standard main line", () => {
  const r = resolvePrice(-120, +100);
  assertEquals(r.ok, true);
});

Deno.test("evaluate: caps a 0.90 model claim at fair + 0.08", () => {
  // -120/+100 → fair_over ≈ 0.5455
  const r = evaluate({ side: "Over", modelProb: 0.90, over: -120, under: +100 });
  // ceiling = min(0.85, 0.5455 + 0.08) = 0.6255
  assertAlmostEquals(r.capped_prob, 0.6255, 0.005);
  assertEquals(r.verdict === "BACK" || r.verdict === "STRONG_BACK", true);
  assertEquals(r.is_plus_ev, true);
});

Deno.test("evaluate: low model prob on heavy fav routes to FADE", () => {
  // -180/+150 → fair_over ≈ 0.6207; model 0.45 → edge ≈ -0.17 → FADE
  const r = evaluate({ side: "Over", modelProb: 0.45, over: -180, under: +150 });
  assertEquals(r.verdict, "FADE");
});

Deno.test("evaluate: hard cap pins at 0.85 when fair very high", () => {
  // Force a fake "fair" of ~0.88 by pricing -800/+550. resolvePrice would
  // normally reject this as ALT, but evaluate() is pure math.
  const r = evaluate({ side: "Over", modelProb: 0.99, over: -800, under: +550 });
  assertEquals(r.capped_prob <= HARD_CONFIDENCE_CAP + 1e-9, true);
});

Deno.test("americanToImplied: +100 = 0.5", () => {
  assertAlmostEquals(americanToImplied(100), 0.5, 0.0001);
});

Deno.test("MAX_EDGE_OVER_FAIR sanity", () => {
  assertEquals(MAX_EDGE_OVER_FAIR, 0.08);
});