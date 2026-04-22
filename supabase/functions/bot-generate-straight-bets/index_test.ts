import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function buildCeilingLine(l3Avg: number, l10MaxProxy: number): number {
  return roundToHalf(Math.min(l3Avg * 0.95, l10MaxProxy * 0.8));
}

Deno.test("ceiling line rounds to nearest half from conservative cap", () => {
  assertEquals(buildCeilingLine(31.2, 38), 29.5);
  assertEquals(buildCeilingLine(26.1, 30.1), 24);
});

Deno.test("ceiling line stays above book only when upside is real", () => {
  const ceiling = buildCeilingLine(28.9, 36);
  assertEquals(ceiling > 24.5, true);
  assertEquals(buildCeilingLine(20.4, 23), 18.5);
});