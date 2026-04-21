// Tests for parlay-engine-v2. Run with `deno test`.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CandidateLeg,
  ExposureTracker,
  ParlayEngine,
  comboHash,
  combinedAmericanOdds,
  legCount,
  legQualityScore,
  mispricedEdge,
  validateLeg,
} from "../../_shared/parlay-engine-v2/index.ts";
import {
  ACTIVE_STRATEGIES,
  LEG_COUNT_ALLOCATION,
  STAKE_BY_TIER,
} from "../../_shared/parlay-engine-v2/config.ts";

const NOW = new Date("2026-04-21T18:00:00Z");
const FRESH = new Date(NOW.getTime() - 30 * 60 * 1000);
const STALE = new Date(NOW.getTime() - 200 * 60 * 1000);
const TIPOFF = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);

function makeLeg(overrides: Partial<CandidateLeg> = {}): CandidateLeg {
  return {
    sport: "NBA",
    player_name: "Player A",
    team: "LAL",
    opponent: "GSW",
    prop_type: "Points",
    side: "OVER",
    line: 22.5,
    american_odds: -120,
    projected: 24.0,
    confidence: 0.72,
    edge: 1.5,
    signal_source: "ASSISTS",
    tipoff: TIPOFF,
    projection_updated_at: FRESH,
    line_confirmed_on_book: true,
    player_active: true,
    defensive_context_updated_at: null,
    ...overrides,
  };
}

// Test 1 — leg quality score: S-tier whitelist > B-tier non-whitelist
Deno.test("legQualityScore ranks S-tier whitelist above B-tier non-whitelist", () => {
  const sTier = makeLeg({
    signal_source: "ASSISTS", prop_type: "Assists", side: "OVER", confidence: 0.70,
  });
  const bTier = makeLeg({
    signal_source: "MID_SCORER_UNDER", prop_type: "Free Throws", side: "OVER", confidence: 0.70,
  });
  assert(legQualityScore(sTier) > legQualityScore(bTier),
    `expected S-tier > B-tier, got ${legQualityScore(sTier)} vs ${legQualityScore(bTier)}`);
});

// Test 2 — validateLeg rejects stale projection, accepts fresh
Deno.test("validateLeg rejects stale projection, accepts fresh", () => {
  const fresh = makeLeg();
  const stale = makeLeg({ projection_updated_at: STALE });
  assertEquals(validateLeg(fresh, NOW)[0], true);
  const [ok, reason] = validateLeg(stale, NOW);
  assertEquals(ok, false);
  assert(reason.startsWith("projection_stale"), `got reason ${reason}`);
});

// Test 3 — ExposureTracker blocks 5th parlay containing same player
Deno.test("ExposureTracker blocks 5th parlay containing same player", () => {
  const exp = new ExposureTracker();
  // build 4 distinct accepted parlays each containing "Star Player"
  for (let i = 0; i < 4; i++) {
    const p = {
      strategy: "test", tier: "CORE" as const,
      legs: [
        makeLeg({ player_name: "Star Player", prop_type: "Points",   line: 20 + i, team: `T${i}A`, opponent: `T${i}B` }),
        makeLeg({ player_name: `Other ${i}A`, prop_type: "Assists",  side: "OVER", signal_source: "ASSISTS", team: `T${i}C`, opponent: `T${i}D` }),
        makeLeg({ player_name: `Other ${i}B`, prop_type: "Rebounds", side: "OVER", team: `T${i}E`, opponent: `T${i}F` }),
      ],
      stake_units: 1, rationale: "t", generated_at: NOW,
    };
    const [ok] = exp.canAccept(p);
    assert(ok, `parlay ${i} should be acceptable`);
    exp.accept(p);
  }
  const fifth = {
    strategy: "test", tier: "CORE" as const,
    legs: [
      makeLeg({ player_name: "Star Player", prop_type: "Steals", line: 1.5, team: "T5A", opponent: "T5B" }),
      makeLeg({ player_name: "Other 5A", prop_type: "Assists", side: "OVER", signal_source: "ASSISTS", team: "T5C", opponent: "T5D" }),
      makeLeg({ player_name: "Other 5B", prop_type: "Rebounds", side: "OVER", team: "T5E", opponent: "T5F" }),
    ],
    stake_units: 1, rationale: "t", generated_at: NOW,
  };
  const [ok, reason] = exp.canAccept(fifth);
  assertEquals(ok, false);
  assert(reason.startsWith("player_exposure_cap"), `got ${reason}`);
});

// Test 4 — mispricedEdge returns null when pool too thin, parlay when full
Deno.test("mispricedEdge: null on thin pool, parlay on full whitelist pool", () => {
  const slot = ACTIVE_STRATEGIES.find(s => s.name === "mispriced_edge")!;

  // empty pool → null
  assertEquals(mispricedEdge([], slot), null);

  // pool of B-tier non-whitelist legs at 0.66 conf → null (below 0.70 + not whitelist)
  const weak = Array.from({ length: 6 }, (_, i) => makeLeg({
    player_name: `Weak ${i}`, prop_type: "Free Throws", confidence: 0.66, signal_source: "UNKNOWN",
  }));
  assertEquals(mispricedEdge(weak, slot), null);

  // strong NBA whitelist pool, conf >= 0.72 → returns 3-leg parlay
  const strong = Array.from({ length: 8 }, (_, i) => makeLeg({
    player_name: `Star ${i}`, prop_type: "Points", side: "OVER",
    confidence: 0.74, american_odds: -135, signal_source: "VOLUME_SCORER",
  }));
  const parlay = mispricedEdge(strong, slot);
  assert(parlay !== null, "expected parlay from strong pool");
  assertEquals(parlay!.legs.length, 3);
  assertEquals(parlay!.tier, "CORE");
});

// Test 5 — generateSlate on synthetic 200-leg pool produces realistic output
Deno.test("generateSlate produces strategy/tier mix and high combo uniqueness", () => {
  const players = Array.from({ length: 80 }, (_, i) => `Player ${i}`);
  const props: Array<[string, string]> = [
    ["Points", "OVER"], ["Points", "UNDER"], ["Assists", "OVER"], ["Rebounds", "OVER"],
    ["3PM", "OVER"], ["3PM", "UNDER"], ["Steals", "OVER"], ["Blocks", "UNDER"], ["R+A", "OVER"],
  ];
  const signals = ["ASSISTS", "STEALS", "VOLUME_SCORER", "BIG_REBOUNDER", "BLOCKS", "THREE_POINT_SHOOTER"];

  const pool: CandidateLeg[] = [];
  for (let i = 0; i < 200; i++) {
    const [pt, side] = props[i % props.length];
    pool.push(makeLeg({
      player_name: players[i % players.length] + (i < 80 ? "" : "_v2"),
      team: `T${i % 16}`,
      opponent: `O${(i + 1) % 16}`,
      prop_type: pt,
      side,
      line: 5 + (i % 30),
      american_odds: -110 - (i % 60),
      confidence: 0.66 + (i % 25) / 100,
      signal_source: signals[i % signals.length],
      sport: i % 19 === 0 ? "MLB" : i % 23 === 0 ? "NHL" : "NBA",
    }));
  }

  const engine = new ParlayEngine();
  const result = engine.generateSlate(pool, NOW);

  assert(result.parlays.length >= 5, `expected at least 5 parlays, got ${result.parlays.length}`);
  // every parlay's leg count must be in the allocation table
  for (const p of result.parlays) {
    assert(legCount(p) in LEG_COUNT_ALLOCATION,
      `unexpected leg_count ${legCount(p)}`);
    assert(STAKE_BY_TIER[p.tier] > 0, `missing stake for tier ${p.tier}`);
    assert(combinedAmericanOdds(p) >= 300, `parlay below min odds: ${combinedAmericanOdds(p)}`);
  }
  // combo uniqueness ≥ 95%
  const combos = new Set(result.parlays.map(comboHash));
  const uniqueRatio = combos.size / Math.max(1, result.parlays.length);
  assert(uniqueRatio >= 0.95, `combo uniqueness ${uniqueRatio}`);
});