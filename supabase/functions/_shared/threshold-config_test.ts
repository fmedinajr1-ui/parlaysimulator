import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_THRESHOLDS,
  buildThresholdSetFromRows,
  validateFieldValue,
  AXIS_KEYS,
} from "./threshold-config.ts";

Deno.test("returns defaults when no rows", () => {
  const t = buildThresholdSetFromRows([], "NBA");
  assertEquals(t.form.aligned_over, DEFAULT_THRESHOLDS.ALL.form.aligned_over);
  assertEquals(t.pace.aligned_over, DEFAULT_THRESHOLDS.ALL.pace.aligned_over);
});

Deno.test("MLB defaults override pace", () => {
  const t = buildThresholdSetFromRows([], "MLB");
  assertEquals(t.pace.aligned_over, 9);
  assertEquals(t.pace.aligned_under, 7.5);
});

Deno.test("sport-specific row beats ALL row", () => {
  const rows = [
    { sport: "ALL", axis: "form", aligned_over: 0.55, aligned_under: 0.55, against_over: 0.25, against_under: 0.25, neutral_band: null },
    { sport: "NBA", axis: "form", aligned_over: 0.45, aligned_under: 0.45, against_over: 0.20, against_under: 0.20, neutral_band: null },
  ];
  const nba = buildThresholdSetFromRows(rows, "NBA");
  const mlb = buildThresholdSetFromRows(rows, "MLB");
  assertEquals(nba.form.aligned_over, 0.45);
  assertEquals(mlb.form.aligned_over, 0.55);
});

Deno.test("validateFieldValue enforces bounds", () => {
  assert(validateFieldValue("form", 0.5).ok);
  assert(!validateFieldValue("form", 5).ok);
  assert(!validateFieldValue("defense", 100).ok);
  assert(validateFieldValue("model_edge", -1.0).ok);
});

Deno.test("AXIS_KEYS covers expected axes", () => {
  assertEquals(new Set(AXIS_KEYS), new Set(["form", "defense", "pace", "juice", "model_edge"]));
});