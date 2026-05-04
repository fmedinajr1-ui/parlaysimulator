import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { tournamentTier, thresholdsFor } from "./court-edge-tournament-tier.ts";

Deno.test("tournamentTier: grand slams", () => {
  assertEquals(tournamentTier("tennis_atp_wimbledon"), "grand_slam");
  assertEquals(tournamentTier(undefined, "Roland Garros - R32"), "grand_slam");
  assertEquals(tournamentTier("tennis_us_open"), "grand_slam");
});

Deno.test("tournamentTier: masters / 1000s", () => {
  assertEquals(tournamentTier("tennis_atp_madrid"), "masters_1000");
  assertEquals(tournamentTier(undefined, "Miami Open"), "masters_1000");
  assertEquals(tournamentTier(undefined, "Cincinnati"), "masters_1000");
});

Deno.test("tournamentTier: 500 / 250 / challenger / itf / unknown", () => {
  assertEquals(tournamentTier(undefined, "Dubai Championships"), "atp_500");
  assertEquals(tournamentTier(undefined, "ATP 250 Lyon"), "atp_250");
  assertEquals(tournamentTier(undefined, "Lyon Challenger"), "challenger");
  assertEquals(tournamentTier(undefined, "M15 Cancun"), "itf");
  assertEquals(tournamentTier(undefined, "Random Mystery Cup"), "unknown");
});

Deno.test("thresholdsFor: ITF auto-quarantines, unknown maps to 250-tier strict bar", () => {
  assertEquals(thresholdsFor("itf").auto_quarantine, true);
  const u = thresholdsFor("unknown");
  assertEquals(u.strong_pp, 0.05);
  assertEquals(u.lean_pp, 0.03);
});

Deno.test("thresholdsFor: grand slam looser than 250", () => {
  const gs = thresholdsFor("grand_slam");
  const t250 = thresholdsFor("atp_250");
  assertEquals(gs.lean_pp < t250.lean_pp, true);
  assertEquals(gs.strong_pp <= t250.strong_pp, true);
});