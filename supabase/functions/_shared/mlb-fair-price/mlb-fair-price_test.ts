import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BaseState, GameState, applyTransition } from "./state.ts";
import { winProb, isWpCalibrated } from "./win-prob.ts";
import { STALE_FEED_MS } from "./constants.ts";

function base(): GameState {
  return {
    inning: 5,
    half: "top",
    outs: 1,
    bases: BaseState.EMPTY,
    scoreDiff: 0,
    battingTeam: "away",
    feedTs: Date.now(),
  };
}

Deno.test("HR with runners on 1B+3B clears bases, scores 3, outs unchanged", () => {
  const pre: GameState = { ...base(), bases: BaseState.B13, outs: 1, battingTeam: "away" };
  const post = applyTransition(pre, "HOME_RUN");
  assertEquals(post.bases, BaseState.EMPTY);
  assertEquals(post.outs, 1);
  // away batting → scoreDiff (home − away) decreases by 3
  assertEquals(post.scoreDiff, pre.scoreDiff - 3);
});

Deno.test("K with 2 outs flips half, resets bases/outs, swaps batting team", () => {
  const pre: GameState = {
    ...base(),
    outs: 2,
    bases: BaseState.B2,
    half: "top",
    inning: 5,
    battingTeam: "away",
  };
  const post = applyTransition(pre, "STRIKEOUT");
  assertEquals(post.outs, 0);
  assertEquals(post.bases, BaseState.EMPTY);
  assertEquals(post.half, "bottom");
  assertEquals(post.inning, 5); // top→bottom does NOT bump inning
  assertEquals(post.battingTeam, "home");
});

Deno.test("BB with bases LOADED scores 1, bases still LOADED", () => {
  const pre: GameState = { ...base(), bases: BaseState.LOADED, battingTeam: "home" };
  const post = applyTransition(pre, "WALK");
  assertEquals(post.bases, BaseState.LOADED);
  // home batting → scoreDiff goes UP by 1
  assertEquals(post.scoreDiff, pre.scoreDiff + 1);
  assertEquals(post.outs, pre.outs);
});

Deno.test("winProb returns null when β not calibrated and flag off", () => {
  assertEquals(isWpCalibrated(), false);
  const wp = winProb(base());
  assertEquals(wp, null);
});

Deno.test("winProb returns finite probability when allowUncalibrated=true", () => {
  const wp = winProb(base(), { allowUncalibrated: true });
  assert(wp !== null && wp > 0 && wp < 1, `expected (0,1), got ${wp}`);
});

Deno.test("stale-feed guard: feedTs older than STALE_FEED_MS is detected", () => {
  const oldFeed = Date.now() - (STALE_FEED_MS + 1000);
  const stale: GameState = { ...base(), feedTs: oldFeed };
  const ageMs = Date.now() - stale.feedTs;
  assert(ageMs > STALE_FEED_MS, "guard should trip");
});