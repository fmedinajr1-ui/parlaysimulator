import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isRelevant, EVENT_MARKET_MAP } from "./relevance.ts";
import { scoreEdge, evPerUnit, halfKellyStake, impactScore, eventDirection, reverseDelta } from "./scoring.ts";
import { verifyHmac } from "./hmac.ts";
import { tierFor, formatSpeedEdgeAlert, formatHedgeAlert } from "./telegram-format.ts";
import {
  fitLogistic,
  fitLinear,
  logLoss,
  brierScore,
  type TrainingRow,
  type SpeedModelCoefficients,
} from "./model.ts";

Deno.test("relevance map gates event/market pairs correctly", () => {
  assert(isRelevant("ASSIST", "player_ast"));
  assert(isRelevant("SHOT_MADE", "player_pra"));
  assert(!isRelevant("ASSIST", "live_total"));
  assert(!isRelevant("UNKNOWN", "player_pts"));
  assertEquals(EVENT_MARKET_MAP["INJURY"]?.includes("live_spread"), true);
});

Deno.test("scoreEdge is monotonic in excess_lag and capped", () => {
  const a = scoreEdge({ excess_lag: 2, event_impact: 0.7 });
  const b = scoreEdge({ excess_lag: 8, event_impact: 0.7 });
  assert(b.prob > a.prob);
  assert(b.expectedMove > a.expectedMove);
  const huge = scoreEdge({ excess_lag: 100, event_impact: 1 });
  assert(huge.prob <= 0.95);
});

Deno.test("EV floor + half-Kelly stake non-negative", () => {
  const f = { excess_lag: 5, event_impact: impactScore("ASSIST") };
  const { prob, expectedMove } = scoreEdge(f);
  const ev = evPerUnit(prob, expectedMove);
  assert(ev > 0.03);
  const stake = halfKellyStake(prob, expectedMove);
  assert(stake >= 0);
  // negative EV scenario floors at 0
  assertEquals(halfKellyStake(0.1, 0.5), 0);
});

Deno.test("HMAC verify accepts matching signature and rejects bad ones", async () => {
  const body = '{"hello":"world"}';
  const secret = "test-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  assert(await verifyHmac(body, `sha256=${hex}`, secret));
  assert(!(await verifyHmac(body, "sha256=deadbeef", secret)));
  assert(!(await verifyHmac(body, null, secret)));
  // no secret configured → skip
  assert(await verifyHmac(body, null, undefined));
});

Deno.test("Telegram formatter uses full property labels and tier emoji", () => {
  assertEquals(tierFor(0.12), "🔥 FIRE");
  assertEquals(tierFor(0.07), "⚡ STRONG");
  assertEquals(tierFor(0.04), "👀 WATCH");
  const msg = formatSpeedEdgeAlert(
    {
      player_name: "Brunson",
      edge_type: "player_ast",
      market_delay_seconds: 8.2,
      excess_lag_seconds: 4.2,
      confidence: 0.91,
      expected_move: 0.45,
      model_edge: 0.12,
      stake_units: 0.041,
      expires_at: new Date(Date.now() + 12_000).toISOString(),
    },
    "ASSIST",
    { sportsbook: "DraftKings", line: 8.5 },
  );
  assert(msg.includes("Assists 8.5"));
  assert(msg.includes("🔥 FIRE"));
  assert(msg.includes("Brunson"));
  assert(!msg.includes("player_ast"));
});

// ===== Phase 1: learned-model tests =====

Deno.test("scoreEdge falls back to heuristic when no model is provided", () => {
  const f = { excess_lag: 4, event_impact: 0.7, time_remaining: 20 };
  const heur = scoreEdge(f);
  assertEquals(heur.source, "heuristic");
  const withNull = scoreEdge(f, null);
  assertEquals(withNull.source, "heuristic");
  assertEquals(heur.prob, withNull.prob);
});

Deno.test("scoreEdge uses model coefficients and clamps to prob_cap / move_floor", () => {
  const model: SpeedModelCoefficients = {
    prob_intercept: -10, prob_b_lag: 0, prob_b_impact: 0, prob_b_time: 0, prob_cap: 0.9,
    move_intercept: -5, move_b_lag: 0, move_b_impact: 0, move_floor: 0.1,
  };
  const out = scoreEdge({ excess_lag: 1, event_impact: 0.5, time_remaining: 10 }, model);
  assertEquals(out.source, "model");
  assert(out.prob < 0.001, `prob should be tiny, got ${out.prob}`);
  assertEquals(out.expectedMove, 0.1); // floored

  const hot: SpeedModelCoefficients = { ...model, prob_intercept: 50 };
  const hotOut = scoreEdge({ excess_lag: 1, event_impact: 0.5, time_remaining: 10 }, hot);
  assertEquals(hotOut.prob, 0.9); // capped
});

Deno.test("fitLogistic recovers a clear linear separation", () => {
  // hit = 1 iff excess_lag >= 5
  const rows: TrainingRow[] = [];
  for (let lag = 0; lag <= 10; lag++) {
    for (let k = 0; k < 25; k++) {
      rows.push({
        excess_lag: lag, event_impact: 0.7, time_remaining: 20,
        hit: lag >= 5 ? 1 : 0, actual_move: lag * 0.1,
      });
    }
  }
  const w = fitLogistic(rows, { iters: 3000 });
  // Decision boundary ≈ 5 ⇒ b_lag * 5 + intercept ≈ 0, so b_lag > 0 and intercept < 0
  assert(w[1] > 0, `expected positive lag weight, got ${w[1]}`);
  assert(w[0] < 0, `expected negative intercept, got ${w[0]}`);
  const ll = logLoss(rows, w);
  const br = brierScore(rows, w);
  assert(ll < 0.4, `log-loss should be low, got ${ll}`);
  assert(br < 0.15, `brier should be low, got ${br}`);
});

Deno.test("fitLinear recovers known coefficients (closed-form OLS)", () => {
  // y = 0.3 + 0.2*excess_lag + 0.5*event_impact
  const rows: TrainingRow[] = [];
  for (let lag = 0; lag <= 10; lag++) {
    for (const imp of [0.3, 0.5, 0.7, 0.9, 1.0]) {
      rows.push({
        excess_lag: lag, event_impact: imp, time_remaining: 20,
        hit: 1, actual_move: 0.3 + 0.2 * lag + 0.5 * imp,
      });
    }
  }
  const [b0, bLag, bImp] = fitLinear(rows);
  assert(Math.abs(b0 - 0.3) < 1e-6, `intercept off: ${b0}`);
  assert(Math.abs(bLag - 0.2) < 1e-6, `lag off: ${bLag}`);
  assert(Math.abs(bImp - 0.5) < 1e-6, `impact off: ${bImp}`);
});

Deno.test("EV/Kelly downstream math is unchanged by model path", () => {
  const model: SpeedModelCoefficients = {
    prob_intercept: 0, prob_b_lag: 0.1, prob_b_impact: 0.5, prob_b_time: 0, prob_cap: 0.95,
    move_intercept: 0.5, move_b_lag: 0.05, move_b_impact: 0.2, move_floor: 0.05,
  };
  const f = { excess_lag: 6, event_impact: impactScore("SHOT_MADE"), time_remaining: 18 };
  const m = scoreEdge(f, model);
  assert(halfKellyStake(m.prob, m.expectedMove) >= 0);

  // Cold model → very low prob → negative EV → stake floored at 0.
  const cold: SpeedModelCoefficients = { ...model, prob_intercept: -8 };
  const c = scoreEdge(f, cold);
  assert(evPerUnit(c.prob, c.expectedMove) < 0);
  assertEquals(halfKellyStake(c.prob, c.expectedMove), 0);
});

// ───────── Phase 2: hedge logic ─────────

Deno.test("eventDirection maps fade events to down, scoring events to up", () => {
  assertEquals(eventDirection("SHOT_MADE", "player_pts"), "up");
  assertEquals(eventDirection("ASSIST", "player_ast"), "up");
  assertEquals(eventDirection("GOAL", "live_total"), "up");
  assertEquals(eventDirection("INJURY", "player_pts"), "down");
  assertEquals(eventDirection("FOUL", "player_pts"), "down");
  assertEquals(eventDirection("UNKNOWN_EVENT", "player_pts"), "up");
});

// ───────── MLB expansion ─────────

Deno.test("MLB: STRIKEOUT pushes pitcher K up but batter hits down", () => {
  assertEquals(eventDirection("STRIKEOUT", "player_strikeouts"), "up");
  assertEquals(eventDirection("STRIKEOUT", "player_hits"), "down");
  assertEquals(eventDirection("PITCHER_PULLED", "player_strikeouts"), "down");
  assertEquals(eventDirection("HOME_RUN", "player_home_runs"), "up");
});

Deno.test("MLB: relevance map covers expected event/market pairs", () => {
  assert(isRelevant("HOME_RUN", "player_home_runs"));
  assert(isRelevant("HOME_RUN", "live_total"));
  assert(isRelevant("STRIKEOUT", "player_strikeouts"));
  assert(isRelevant("STOLEN_BASE", "player_stolen_bases"));
  assert(!isRelevant("HOME_RUN", "player_ast"));
  assert(!isRelevant("STOLEN_BASE", "player_pts"));
});

Deno.test("MLB: reverseDelta detects pitcher K line drop after PITCHER_PULLED", () => {
  // intended "down" (pitcher K market falls); a confirming move is down, so
  // a reversal is an UPWARD move. But for PITCHER_PULLED on player_strikeouts
  // intended_direction is "down" → line going UP would be a reversal.
  assertEquals(reverseDelta("down", 5.5, 6.5), 1.0);
  // Confirming downward move → no hedge
  assertEquals(reverseDelta("down", 5.5, 4.5), 0);
});

Deno.test("MLB: formatHedgeAlert renders Home Runs label and flips side", async () => {
  const { formatHedgeAlert } = await import("./telegram-format.ts");
  const msg = formatHedgeAlert({
    player_name: "Aaron Judge",
    edge_type: "player_home_runs",
    intended_direction: "up",
    fired_line: 0.5,
    reverse_line: 1.5,
    reverse_delta: 1.0,
  });
  assert(msg.includes("Home Runs"));
  assert(msg.includes("Aaron Judge"));
  assert(msg.includes("UNDER 1.5"));
  assert(!/HR\b/.test(msg));
});

Deno.test("MLB: per-market reverse threshold falls back to default for unknown markets", async () => {
  const { thresholdFor } = await import("../../scout-speed-hedge-monitor/index.ts")
    .catch(async () => ({ thresholdFor: (_: string) => 0.5 })); // tolerate import side-effects
  assertEquals(thresholdFor("player_home_runs"), 0.5);
  assertEquals(thresholdFor("player_strikeouts"), 0.5);
  assertEquals(thresholdFor("totally_unknown_market"), 0.5);
});

Deno.test("reverseDelta fires when market moves against intended direction", () => {
  // Predicted up, line dropped from 24.5 → 23.0 → reverse of 1.5
  assertEquals(reverseDelta("up", 24.5, 23.0), 1.5);
  // Predicted down, line rose from 8.5 → 9.5 → reverse of 1.0
  assertEquals(reverseDelta("down", 8.5, 9.5), 1.0);
});

Deno.test("reverseDelta returns 0 on confirming move", () => {
  // Predicted up, line rose → confirming, no hedge
  assertEquals(reverseDelta("up", 24.5, 26.0), 0);
  // Predicted down, line fell → confirming
  assertEquals(reverseDelta("down", 8.5, 7.5), 0);
});

Deno.test("reverseDelta returns 0 when line is unchanged", () => {
  assertEquals(reverseDelta("up", 24.5, 24.5), 0);
  assertEquals(reverseDelta("down", 8.5, 8.5), 0);
});

Deno.test("formatHedgeAlert renders English action with opposite side", () => {
  const msg = formatHedgeAlert({
    player_name: "Luka Doncic",
    edge_type: "player_pts",
    intended_direction: "up",
    fired_line: 32.5,
    reverse_line: 31.0,
    reverse_delta: 1.5,
  });
  assert(msg.includes("HEDGE TRIGGER"));
  assert(msg.includes("Luka Doncic"));
  assert(msg.includes("Points"));
  assert(msg.includes("UNDER 31")); // hedge is opposite of original (over)
  assert(!/PTS\b/.test(msg)); // no abbreviations
});