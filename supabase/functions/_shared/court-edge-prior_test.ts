import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { priorFor } from "./court-edge-prior.ts";

Deno.test("priorFor: ATP hard Bo3 returns 22.0 / 3.6", () => {
  const p = priorFor("atp", "bo3", "hard");
  assertEquals(p.mu, 22.0);
  assertEquals(p.sd, 3.6);
});

Deno.test("priorFor: unknown tour falls back to WTA; unknown surface falls back to hard", () => {
  const p = priorFor("unknown", "bo3", "unknown");
  // WTA hard Bo3
  assertEquals(p.mu, 20.8);
  assertEquals(p.sd, 3.4);
});