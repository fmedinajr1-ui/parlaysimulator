import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  roleAdjustment,
  inferRoleFromL3,
  UNKNOWN_ROLE,
  type PlayerRole,
} from "./court-edge-roles.ts";

function makeRole(over: Partial<PlayerRole>): PlayerRole {
  return { ...UNKNOWN_ROLE, archetype: "all_court", source: "seed", ...over };
}

Deno.test("big_server on slow clay outdoors gets +0.4 with reason", () => {
  const r = makeRole({ archetype: "big_server", clay_score: 0.6 });
  const out = roleAdjustment(r, { surface: "clay", indoor: false, wind_mph: 5 });
  assertEquals(out.adj_games, 0.4);
  assert(out.reason && out.reason.includes("Big serve neutralised"));
});

Deno.test("clay_grinder on grass gets -0.6 with grass-exposed reason", () => {
  const r = makeRole({ archetype: "clay_grinder", grass_score: 0.55 });
  const out = roleAdjustment(r, { surface: "grass", indoor: false });
  assertEquals(out.adj_games, -0.6);
  assert(out.reason && out.reason.includes("grass"));
});

Deno.test("unknown role yields zero adjustment regardless of context", () => {
  const out = roleAdjustment(UNKNOWN_ROLE, { surface: "clay", indoor: false });
  assertEquals(out.adj_games, 0);
  assertEquals(out.reason, null);
});

Deno.test("heuristic classifier flags big_server from tiebreak-heavy L3", () => {
  const role = inferRoleFromL3(["7-6(5) 7-6(3)", "7-6(2) 6-4 7-6(7)", "7-5 7-6(4)"], "hard");
  assertEquals(role, "big_server");
});

Deno.test("heuristic classifier returns all_court for routine straight-set wins", () => {
  const role = inferRoleFromL3(["6-3 6-2", "6-4 6-3", "6-2 6-4"], "hard");
  assertEquals(role, "all_court");
});