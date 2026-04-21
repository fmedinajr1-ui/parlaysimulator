// ============================================================================
// Phase B unit tests — backtest + calibration
// ============================================================================

import { assert, assertEquals, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CandidateLeg,
  HistoricalParlay,
  ExposureTracker,
  replayParlays,
  calibrate,
} from "../../_shared/parlay-engine-v2/index.ts";

// ---------- Fixture helpers ----------

function makeLeg(overrides: Partial<CandidateLeg> = {}): CandidateLeg {
  const now = new Date("2026-03-15T18:00:00Z");
  return {
    sport: "NBA",
    player_name: "Player A",
    team: "LAL",
    opponent: "GSW",
    prop_type: "Points",
    side: "OVER",
    line: 22.5,
    american_odds: -110,
    projected: 24.0,
    confidence: 0.72,
    edge: 1.5,
    signal_source: "ASSISTS",
    tipoff: new Date(now.getTime() + 6 * 3600_000),
    projection_updated_at: now,
    line_confirmed_on_book: true,
    player_active: true,
    defensive_context_updated_at: null,
    ...overrides,
  };
}

function makeParlay(overrides: Partial<HistoricalParlay> = {}): HistoricalParlay {
  return {
    id: crypto.randomUUID(),
    parlay_date: "2026-03-15",
    created_at: "2026-03-15T18:00:00Z",
    strategy_name: "mispriced_edge",
    tier: "CORE",
    legs: [makeLeg(), makeLeg({ player_name: "Player B", team: "BOS", opponent: "MIA" }), makeLeg({ player_name: "Player C", team: "DEN", opponent: "PHX" })],
    outcome: "won",
    simulated_stake: 1,
    expected_odds: 400,
    combined_probability: 0.30,
    ...overrides,
  };
}

// ---------- Test 1: void_rate_v2 = 0 under strict mode ----------

Deno.test("replayParlays: strict_void_mode collapses voids to 0 in v2", () => {
  const parlays: HistoricalParlay[] = [];
  // 70 won, 30 voids
  for (let i = 0; i < 70; i++) {
    parlays.push(makeParlay({
      id: `won-${i}`,
      parlay_date: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
      legs: [
        makeLeg({ player_name: `P${i}-1`, team: `T${i}`, opponent: `O${i}` }),
        makeLeg({ player_name: `P${i}-2`, team: `U${i}`, opponent: `V${i}` }),
        makeLeg({ player_name: `P${i}-3`, team: `W${i}`, opponent: `X${i}` }),
      ],
      outcome: "won",
    }));
  }
  for (let i = 0; i < 30; i++) {
    parlays.push(makeParlay({
      id: `void-${i}`,
      outcome: "void",
    }));
  }

  const report = replayParlays(parlays, { strict_void_mode: true, apply_exposure_caps: false });
  assertEquals(report.v1_actual.void, 30);
  assertEquals(report.v2_shipped.void, 0, "strict mode should drop all voids");
  assert(
    report.rejection_reasons["void_caught_by_freshness_gate"] === 30,
    "all 30 voids should be tagged as freshness-caught",
  );
});

// ---------- Test 2: THREES blacklist rejection ----------

Deno.test("replayParlays: rejects parlay containing blacklisted THREES signal", () => {
  const parlay = makeParlay({
    legs: [
      makeLeg({ signal_source: "THREES", player_name: "Curry", team: "GSW", opponent: "LAL" }),
      makeLeg({ player_name: "LeBron", team: "LAL", opponent: "GSW" }),
      makeLeg({ player_name: "Tatum", team: "BOS", opponent: "MIA" }),
    ],
  });
  const report = replayParlays([parlay], { apply_exposure_caps: false });
  assertEquals(report.v2_shipped.resolved, 0, "blacklisted leg should reject parlay");
  const keys = Object.keys(report.rejection_reasons);
  assert(
    keys.some(k => k.includes("signal_blacklisted") && k.includes("THREES")),
    `expected THREES blacklist rejection, got: ${JSON.stringify(report.rejection_reasons)}`,
  );
});

// ---------- Test 3: ExposureTracker blocks 5th same-player parlay ----------

Deno.test("ExposureTracker: blocks 5th parlay with same player (cap=4)", () => {
  const tracker = new ExposureTracker();
  let lastResult: readonly [boolean, string] = [true, "ok"];
  for (let i = 0; i < 5; i++) {
    const parlay = {
      strategy: "test",
      tier: "CORE" as const,
      legs: [
        makeLeg({ player_name: "Repeat Star", team: "LAL", opponent: `Opp${i}`, line: 20 + i }),
        makeLeg({ player_name: `Other${i}`, team: `T${i}`, opponent: `O${i}` }),
        makeLeg({ player_name: `Third${i}`, team: `U${i}`, opponent: `V${i}` }),
      ],
      stake_units: 1,
      rationale: "test",
      generated_at: new Date(),
    };
    lastResult = tracker.canAccept(parlay);
    if (lastResult[0]) tracker.accept(parlay);
  }
  assertEquals(lastResult[0], false, "5th parlay must be blocked");
  assert(lastResult[1].includes("player_exposure_cap"), `got: ${lastResult[1]}`);
});

// ---------- Test 4: drift warning when monthly hit-rate swings ≥10pp ----------

Deno.test("calibrate: flags signal drift ≥10pp month-over-month", () => {
  const parlays: HistoricalParlay[] = [];
  // Feb: BIG_ASSIST_OVER hits 24/25 (96%)
  for (let i = 0; i < 25; i++) {
    parlays.push(makeParlay({
      id: `feb-${i}`,
      parlay_date: "2026-02-15",
      created_at: "2026-02-15T18:00:00Z",
      legs: [makeLeg({
        signal_source: "BIG_ASSIST_OVER",
        player_name: `Feb-P${i}`,
        team: `FT${i}`, opponent: `FO${i}`,
      })],
      outcome: i === 0 ? "lost" : "won",
    }));
  }
  // Mar: BIG_ASSIST_OVER hits 19/25 (76%) → -20pp
  for (let i = 0; i < 25; i++) {
    parlays.push(makeParlay({
      id: `mar-${i}`,
      parlay_date: "2026-03-15",
      created_at: "2026-03-15T18:00:00Z",
      legs: [makeLeg({
        signal_source: "BIG_ASSIST_OVER",
        player_name: `Mar-P${i}`,
        team: `MT${i}`, opponent: `MO${i}`,
      })],
      outcome: i < 6 ? "lost" : "won",
    }));
  }

  const report = calibrate(parlays);
  const drift = report.drift_warnings.find(d => d.signal === "BIG_ASSIST_OVER");
  assert(drift, `expected drift warning for BIG_ASSIST_OVER, got: ${JSON.stringify(report.drift_warnings)}`);
  assert(Math.abs(drift!.delta) >= 0.10, `delta should be >= 0.10, got ${drift!.delta}`);
});

// ---------- Test 5: ROI calculation matches spec ----------

Deno.test("replayParlays: +400 won parlay → profit=4, roi=4", () => {
  const parlay = makeParlay({
    expected_odds: 400,
    simulated_stake: 1,
    outcome: "won",
  });
  const report = replayParlays([parlay], { apply_exposure_caps: false });
  // v1 actual numbers should equal raw inputs
  assertEquals(report.v1_actual.resolved, 1);
  assertEquals(report.v1_actual.won, 1);
  assertAlmostEquals(report.v1_actual.profit, 4.0, 1e-6);
  assertEquals(report.v1_actual.stake, 1);
  assertAlmostEquals(report.v1_actual.roi, 4.0, 1e-6);
});
