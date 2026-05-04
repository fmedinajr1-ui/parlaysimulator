import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCounterRead, verdictBadge, type PlayerReasoning } from "./alert-explainer.ts";

// ---- Pure helpers we re-test in isolation (mirrors of the private ones) ----
function computeVerdict(aligned: number, against: number, known: number): 'STRONG'|'LEAN'|'NEUTRAL'|'WEAK' {
  if (aligned >= 3 && against <= 1) return 'STRONG';
  if (aligned >= 2 && against <= 1) return 'LEAN';
  if (against >= 3) return 'WEAK';
  if (known >= 4 && aligned === 0) return 'WEAK';
  return 'NEUTRAL';
}

Deno.test("verdict: 3 aligned + 0 against = STRONG", () => {
  assertEquals(computeVerdict(3, 0, 5), 'STRONG');
});

Deno.test("verdict: 2 aligned + 0 against = LEAN (was STRONG before)", () => {
  assertEquals(computeVerdict(2, 0, 4), 'LEAN');
});

Deno.test("verdict: 1 aligned + 1 against + lots of no_data = NEUTRAL (was WEAK before)", () => {
  // 1 aligned, 1 against, 4 no_data → known=2 → NEUTRAL, not WEAK
  assertEquals(computeVerdict(1, 1, 2), 'NEUTRAL');
});

Deno.test("verdict: 0 aligned + 0 against + thin known = NEUTRAL", () => {
  assertEquals(computeVerdict(0, 0, 1), 'NEUTRAL');
});

Deno.test("verdict: 0 aligned + 4+ known = WEAK (real disagreement)", () => {
  assertEquals(computeVerdict(0, 2, 5), 'WEAK');
});

Deno.test("verdict: 3+ against = WEAK regardless of known", () => {
  assertEquals(computeVerdict(1, 3, 6), 'WEAK');
});

Deno.test("verdictBadge handles all four verdicts", () => {
  assertEquals(verdictBadge('STRONG'), '✅ STRONG');
  assertEquals(verdictBadge('LEAN'), '⚠️ LEAN');
  assertEquals(verdictBadge('NEUTRAL'), '🟡 NEUTRAL');
  assertEquals(verdictBadge('WEAK'), '❌ WEAK');
});

// ---- Counter-read ----
function fakePlayer(modelEdge: 'aligned'|'against'|'neutral'|'no_data', form: 'aligned'|'against'|'neutral'|'no_data' = 'neutral'): PlayerReasoning {
  return {
    version: 'v1',
    matchup: { opponent_team: null, defense_rank: null, position_defense_rank: null, stat_allowed: null, game_script: null, blowout_risk: null, vegas_total: null },
    form: { l10_hits: null, l10_total: null, hit_rate: null, last_value: null },
    role: { minutes_score: null, minutes_flag: null },
    pvs: { tier: null, matchup_score: null, pace_score: null },
    juice: { gap: null, aligned_with_side: null },
    injuries: { relevant_count: 0, headlines: [] },
    alignment: { defense: 'no_data', form, pace: 'no_data', juice: 'no_data', role: 'no_data', model_edge: modelEdge },
    aligned_count: 0, against_count: 0, known_count: 0, model_edge_value: null,
    verdict: 'NEUTRAL', headline: '', flags: [],
  };
}

Deno.test("counter-read flags model agreement with alerted side", () => {
  const players = [fakePlayer('aligned'), fakePlayer('aligned'), fakePlayer('aligned'), fakePlayer('neutral')];
  const cr = buildCounterRead(players, 'Over');
  // Should encourage taking the alerted side, not flip away from it
  if (!cr || !cr.includes('take *Over*')) throw new Error(`Expected counter-read to recommend Over, got: ${cr}`);
});

Deno.test("counter-read confirms fade only when model actually disagrees", () => {
  const players = [fakePlayer('against'), fakePlayer('against'), fakePlayer('against')];
  const cr = buildCounterRead(players, 'Over');
  if (!cr || !cr.includes('Under')) throw new Error(`Expected counter-read to confirm Under fade, got: ${cr}`);
});

Deno.test("counter-read defaults to SKIP-not-FADE when split", () => {
  const players = [fakePlayer('neutral'), fakePlayer('neutral'), fakePlayer('no_data')];
  const cr = buildCounterRead(players, 'Over');
  if (!cr || !cr.includes('split')) throw new Error(`Expected split counter-read, got: ${cr}`);
});