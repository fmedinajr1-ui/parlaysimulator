// deno-lint-ignore-file no-explicit-any
// Smoke tests for Spike persona + share-link gating.
// Validates the prompt contract and tool registry, not the live AI.
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// Read the source as text and run contract assertions against the prompt + tool list.
const src = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("persona answers general questions and teaches betting concepts", () => {
  assert(src.includes("General questions, small talk, jokes, sports trivia"));
  assert(src.includes("Sports betting EDUCATION"));
  assert(src.includes("Kelly criterion"));
});

Deno.test("persona guards proprietary picks for anon/sample users", () => {
  assert(src.includes("WHAT YOU GUARD"));
  assert(src.includes("NEVER drop a free pick"));
  assert(src.includes("/upgrade"));
});

Deno.test("share_my_link tool is registered and triggered on link requests", () => {
  assert(src.includes('name: "share_my_link"'));
  assert(src.includes("send me the link"));
  assert(src.includes("text it to my phone"));
});

Deno.test("anonymous users have gated tools stripped (incl. share_my_link)", () => {
  assert(src.includes('GATED = new Set(["build_parlay", "analyze_slip", "get_top_picks", "get_whale_signals", "share_my_link"])'));
  assert(src.includes("(sample || !user)"));
});

Deno.test("share_link is surfaced on the response payload for the UI", () => {
  assert(src.includes("share_link: shareLink"));
  assert(src.includes('toolTrace.find((t: any) => t?.name === "share_my_link"'));
});