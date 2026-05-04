import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildRunDiagnostics, diagnosticsFooter } from "./court-edge-diagnostics.ts";

const baseCtx = {
  tier: "grand_slam",
  baseline_sides_used: 0,
  l3_hits: 20,
  l3_total: 20,
  weather_present: true,
  pp_blocked: false,
  errors_count: 0,
};

Deno.test("diagnostics: empty input → zero counts, no warnings except weather/pp guards off", () => {
  const d = buildRunDiagnostics([], baseCtx);
  assertEquals(d.total, 0);
  assertEquals(d.quarantine_rate, 0);
  assertEquals(d.actionable_count, 0);
  assertEquals(d.warnings.includes("high_quarantine_rate"), false);
  assertEquals(d.warnings.includes("no_actionable_picks"), false);
});

Deno.test("diagnostics: healthy slate → no warnings, footer null", () => {
  const picks = [
    { verdict: "STRONG_OVER" as const, formula: { tournament_tier: "grand_slam" } },
    { verdict: "LEAN_UNDER" as const, formula: { tournament_tier: "grand_slam" } },
    { verdict: "PASS" as const, formula: { tournament_tier: "grand_slam" } },
    { verdict: "PASS" as const, formula: { tournament_tier: "grand_slam" } },
  ];
  const d = buildRunDiagnostics(picks, baseCtx);
  assertEquals(d.warnings.length, 0);
  assertEquals(diagnosticsFooter(d), null);
  assertEquals(d.actionable_count, 2);
});

Deno.test("diagnostics: ≥20% quarantine rate triggers warning + footer", () => {
  const picks = [
    { verdict: "QUARANTINE" as const, formula: { tournament_tier: "grand_slam", quarantine_reason: "edge_above_hard_cap" } },
    { verdict: "QUARANTINE" as const, formula: { tournament_tier: "grand_slam", quarantine_reason: "line_outside_prior_band" } },
    { verdict: "LEAN_OVER" as const, formula: { tournament_tier: "grand_slam" } },
    { verdict: "PASS" as const, formula: { tournament_tier: "grand_slam" } },
    { verdict: "PASS" as const, formula: { tournament_tier: "grand_slam" } },
  ];
  const d = buildRunDiagnostics(picks, baseCtx); // 2/5 = 40%
  assertEquals(d.warnings.includes("high_quarantine_rate"), true);
  assertEquals(d.quarantine_reasons.edge_above_hard_cap, 1);
  assertEquals(d.quarantine_reasons.line_outside_prior_band, 1);
  const footer = diagnosticsFooter(d);
  assertEquals(typeof footer === "string" && footer.includes("40%"), true);
});

Deno.test("diagnostics: tier breakdown counts and promotion demotions aggregate", () => {
  const picks = [
    { verdict: "LEAN_OVER" as const, formula: { tournament_tier: "grand_slam", promotion_blocked_reason: "single_book_only" } },
    { verdict: "LEAN_OVER" as const, formula: { tournament_tier: "atp_250", promotion_blocked_reason: "single_book_only" } },
    { verdict: "LEAN_UNDER" as const, formula: { tournament_tier: "atp_250", promotion_blocked_reason: "outdoor_weather_missing" } },
    { verdict: "STRONG_OVER" as const, formula: { tournament_tier: "atp_250", clamped: true, blowout_adj: -0.5 } },
  ];
  const d = buildRunDiagnostics(picks, baseCtx);
  assertEquals(d.by_tier.grand_slam, 1);
  assertEquals(d.by_tier.atp_250, 3);
  assertEquals(d.promotion_demotions.single_book_only, 2);
  assertEquals(d.promotion_demotions.outdoor_weather_missing, 1);
  assertEquals(d.clamped, 1);
  assertEquals(d.blowout_flags, 1);
});

Deno.test("diagnostics: low L3 coverage + weather missing + errors stack warnings", () => {
  const d = buildRunDiagnostics(
    [{ verdict: "LEAN_OVER" as const, formula: { tournament_tier: "grand_slam" } }],
    { ...baseCtx, l3_hits: 3, l3_total: 20, weather_present: false, errors_count: 2, pp_blocked: true },
  );
  assertEquals(d.warnings.includes("low_l3_coverage"), true);
  assertEquals(d.warnings.includes("weather_missing"), true);
  assertEquals(d.warnings.includes("pipeline_errors"), true);
  assertEquals(d.warnings.includes("prizepicks_blocked"), true);
});

Deno.test("diagnostics: all-quarantine slate also flags no_actionable_picks", () => {
  const picks = [
    { verdict: "QUARANTINE" as const, formula: { tournament_tier: "itf", quarantine_reason: "tier_auto_quarantine" } },
    { verdict: "QUARANTINE" as const, formula: { tournament_tier: "itf", quarantine_reason: "tier_auto_quarantine" } },
  ];
  const d = buildRunDiagnostics(picks, baseCtx);
  assertEquals(d.warnings.includes("high_quarantine_rate"), true);
  assertEquals(d.warnings.includes("no_actionable_picks"), true);
  assertEquals(d.quarantine_reasons.tier_auto_quarantine, 2);
});