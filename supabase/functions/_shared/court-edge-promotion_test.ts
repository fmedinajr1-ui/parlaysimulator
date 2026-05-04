import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyPromotionGates, medianBookLine } from "./court-edge-promotion.ts";

const baseCtx = {
  books_count: 4,
  reference_line: 22.5,
  median_line: 22.5,
  indoor: false,
  weather_present: true,
  baseline_used: false,
  projection: 23.5,
  prior_mu: 22.0,
  prior_sd: 3.6,
  edge_side: "over" as const,
};

Deno.test("promotion: all gates pass → STRONG keeps", () => {
  const r = applyPromotionGates("STRONG_OVER", baseCtx);
  assertEquals(r.verdict, "STRONG_OVER");
  assertEquals(r.blocked_reason, undefined);
});

Deno.test("promotion: single book → demote with single_book_only", () => {
  const r = applyPromotionGates("STRONG_OVER", { ...baseCtx, books_count: 1 });
  assertEquals(r.verdict, "LEAN_OVER");
  assertEquals(r.blocked_reason, "single_book_only");
});

Deno.test("promotion: outdoor + no weather → demote with outdoor_weather_missing", () => {
  const r = applyPromotionGates("STRONG_UNDER", { ...baseCtx, weather_present: false, edge_side: "under", projection: 20.0 });
  assertEquals(r.verdict, "LEAN_UNDER");
  assertEquals(r.blocked_reason, "outdoor_weather_missing");
});

Deno.test("promotion: STRONG_OVER but projection well below prior → demote contradiction", () => {
  const r = applyPromotionGates("STRONG_OVER", { ...baseCtx, projection: 18.0 }); // 22 - 0.5*3.6 = 20.2
  assertEquals(r.verdict, "LEAN_OVER");
  assertEquals(r.blocked_reason, "projection_contradicts_over");
});

Deno.test("promotion: book-line outlier (median far from reference) → demote", () => {
  const r = applyPromotionGates("STRONG_OVER", { ...baseCtx, median_line: 24.0 });
  assertEquals(r.verdict, "LEAN_OVER");
  assertEquals(r.blocked_reason, "book_line_outlier");
});

Deno.test("promotion: baseline fallback always demotes regardless of other gates", () => {
  const r = applyPromotionGates("STRONG_UNDER", { ...baseCtx, baseline_used: true, edge_side: "under", projection: 20.0 });
  assertEquals(r.verdict, "LEAN_UNDER");
  assertEquals(r.blocked_reason, "baseline_fallback_used");
});

Deno.test("promotion: LEAN/PASS pass through untouched", () => {
  assertEquals(applyPromotionGates("LEAN_OVER", baseCtx).verdict, "LEAN_OVER");
  assertEquals(applyPromotionGates("PASS", baseCtx).verdict, "PASS");
  assertEquals(applyPromotionGates("QUARANTINE", baseCtx).verdict, "QUARANTINE");
});

Deno.test("medianBookLine: odd/even/empty handling", () => {
  assertEquals(medianBookLine([{ point: 22 }, { point: 22.5 }, { point: 23 }]), 22.5);
  assertEquals(medianBookLine([{ point: 22 }, { point: 24 }]), 23);
  assertEquals(medianBookLine([]), null);
  assertEquals(medianBookLine(null), null);
});