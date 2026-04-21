// ============================================================================
// Tests for v2.5 engine upgrade: Kelly sizers, correlation model, generator.
// ============================================================================

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CandidateLeg,
  Parlay,
  ParlayEngine,
  fitCorrelationModel,
  flatSizer,
  fractionalKellySizer,
  getSizer,
  kellyLiteSizer,
} from "../../_shared/parlay-engine-v2/index.ts";
import { STAKE_BY_TIER } from "../../_shared/parlay-engine-v2/config.ts";

const NOW = new Date("2026-04-21T18:00:00Z");
const TIPOFF = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
const FRESH = new Date(NOW.getTime() - 30 * 60 * 1000);

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

function makeParlay(legs: CandidateLeg[], tier: "CORE" | "EDGE" | "LOTTERY" = "CORE"): Parlay {
  return {
    strategy: "test", tier, legs,
    stake_units: STAKE_BY_TIER[tier],
    rationale: "t", generated_at: NOW,
  };
}

// 1. flat sizer ignores confidence
Deno.test("flatSizer returns tier base regardless of confidence", () => {
  const a = makeParlay([makeLeg({ confidence: 0.66 }), makeLeg({ confidence: 0.66 }), makeLeg({ confidence: 0.66 })]);
  const b = makeParlay([makeLeg({ confidence: 0.95 }), makeLeg({ confidence: 0.95 }), makeLeg({ confidence: 0.95 })]);
  assertEquals(flatSizer(a), STAKE_BY_TIER.CORE);
  assertEquals(flatSizer(b), STAKE_BY_TIER.CORE);
});

// 2. fractional kelly is positive on +EV parlay and capped at 2× tier base
Deno.test("fractionalKellySizer caps at 2× tier base on a juicy +EV parlay", () => {
  // Need decimal=5.0 → +400 american; conf 0.30 each leg, prob ≈ 0.30
  const legs = [makeLeg({ confidence: 0.30, american_odds: 100 })]; // +100 → 2.0 dec
  // Build a 1-leg parlay manually with raw odds; combined dec = 2.0, prob 0.30 → -EV.
  // Use a clearly +EV: prob 0.30, decimal 5.0 ⇒ b·p - q = 4·0.30 - 0.70 = 0.50 > 0
  const p: Parlay = {
    strategy: "t", tier: "CORE",
    legs: [makeLeg({ confidence: 0.30, american_odds: 400 })],
    stake_units: STAKE_BY_TIER.CORE, rationale: "x", generated_at: NOW,
  };
  const sizer = fractionalKellySizer({ fraction: 0.25 });
  const stake = sizer(p);
  assert(stake > 0, `expected positive stake, got ${stake}`);
  assert(stake <= 2.0 * STAKE_BY_TIER.CORE + 1e-9,
    `expected cap 2× tier base (${2 * STAKE_BY_TIER.CORE}), got ${stake}`);
});

// 3. kelly_lite mode preserves regression behavior (matches kellyLiteSizer)
Deno.test("getSizer('kelly_lite') matches kellyLiteSizer (regression)", () => {
  const p = makeParlay([
    makeLeg({ confidence: 0.74 }),
    makeLeg({ confidence: 0.71 }),
    makeLeg({ confidence: 0.73 }),
  ]);
  assertEquals(getSizer("kelly_lite")(p), kellyLiteSizer(p));
});

// 4. fitCorrelationModel detects negatively correlated same-game pair
Deno.test("fitCorrelationModel: 60 same-game Rebounds OVER × Rebounds OVER pairs → lift < 1", () => {
  // 60 parlays, each with 2 same-game Rebounds OVER legs that mostly miss together.
  const parlays: any[] = [];
  for (let i = 0; i < 60; i++) {
    const a = { ...makeLeg({ player_name: `A${i}`, prop_type: "Rebounds", side: "OVER", team: "LAL", opponent: "GSW" }), outcome: i < 12 };
    const b = { ...makeLeg({ player_name: `B${i}`, prop_type: "Rebounds", side: "OVER", team: "LAL", opponent: "GSW" }), outcome: i < 12 ? false : i < 30 };
    parlays.push({ legs: [a, b] });
  }
  const model = fitCorrelationModel(parlays, 30);
  const lifts = Array.from(model.lift.values());
  assert(lifts.length >= 1, "expected at least one fitted pair");
  assert(lifts.every((l) => l < 1.0), `expected all lifts <1, got ${lifts}`);
});

// 5. ParlayEngine drops parlays flagged with negative correlation
Deno.test("ParlayEngine({ reject_negative_correlation: true }) drops negatively correlated parlays", () => {
  // Synthetic correlation model: flag Points OVER × Points OVER (same game) as negatively correlated.
  // Use a diverse pool so parlays survive other filters (mispriced_edge requires whitelist props,
  // 3-leg combos must pass leg_quality + same-game-share gates).
  const model = {
    lift: new Map([["Points|OVER||Points|OVER", 0.5]]),
    pair_counts: new Map(),
    min_pair_count: 0,
  };
  const pool: CandidateLeg[] = [];
  // 4 same-game Points OVER (LAL vs GSW) — strong whitelist signal
  for (let i = 0; i < 4; i++) {
    pool.push(makeLeg({
      player_name: `LALStar ${i}`, prop_type: "Points", side: "OVER",
      team: "LAL", opponent: "GSW",
      confidence: 0.78, american_odds: -135, signal_source: "VOLUME_SCORER",
    }));
  }
  // Many other diverse props in different games so non-same-game parlays still build
  const otherProps: Array<[string, string]> = [
    ["Assists", "OVER"], ["Rebounds", "OVER"], ["Steals", "OVER"], ["3PM", "UNDER"],
    ["Blocks", "UNDER"], ["R+A", "OVER"],
  ];
  for (let i = 0; i < 30; i++) {
    const [pt, side] = otherProps[i % otherProps.length];
    pool.push(makeLeg({
      player_name: `Diverse ${i}`,
      team: `T${i % 12}`, opponent: `O${(i + 1) % 12}`,
      prop_type: pt, side, line: 5 + (i % 10),
      confidence: 0.74, american_odds: -120, signal_source: "VOLUME_SCORER",
    }));
  }
  const engine = new ParlayEngine({
    correlation_model: model, reject_negative_correlation: true,
  });
  const res = engine.generateSlate(pool, NOW);
  const drops = res.report.rejection_reasons["parlay:negative_correlation"] ?? 0;
  assert(drops >= 1, `expected at least 1 negative_correlation drop, report=${JSON.stringify(res.report.rejection_reasons)}`);
});