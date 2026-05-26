// Scout Speed Edge scoring.
// Phase 1 supports an optional fitted model (logistic + linear) loaded from
// `scout_speed_models`. When no active model is present (cold start), the
// Phase-0 heuristic is used so the engine keeps firing.

import type { SpeedModelCoefficients } from "./model.ts";

const IMPACT_HEURISTICS: Record<string, number> = {
  SHOT_MADE: 0.9, ASSIST: 0.7, REBOUND: 0.6,
  FOUL: 0.5, SUBSTITUTION: 0.4, INJURY: 1.0,
  TIMEOUT: 0.3, GOAL: 0.9, TD: 1.0,
  // MLB
  HOME_RUN: 1.0, STRIKEOUT: 0.7, HIT: 0.6, WALK: 0.4,
  PITCHER_PULLED: 0.9, STOLEN_BASE: 0.6, RBI: 0.7, RUN_SCORED: 0.7,
};

export function impactScore(eventType: string): number {
  return IMPACT_HEURISTICS[eventType] ?? 0.5;
}

// Direction the speed edge expects the market line to move after the event.
// "up"   = line should rise (over-side becomes more valuable to grab now)
// "down" = line should fall (under-side becomes more valuable)
//
// Direction is per (event, market) because a single MLB event can push two
// markets in opposite directions (e.g. STRIKEOUT raises pitcher K market
// but suppresses batter hit/total-base markets).
const UNIVERSAL_DOWN_EVENTS = new Set(["INJURY", "FOUL", "SUBSTITUTION", "TIMEOUT", "PITCHER_PULLED"]);

// Markets that move DOWN when the named event happens (event-specific overrides).
const DOWN_OVERRIDES: Record<string, Set<string>> = {
  // A pitcher K shrinks the batter's hit ceiling
  STRIKEOUT: new Set(["player_hits"]),
  // A walk handed out reduces remaining K opportunities for the pitcher
  WALK:      new Set(["player_strikeouts"]),
};

export function eventDirection(eventType: string, marketType?: string): "up" | "down" {
  if (UNIVERSAL_DOWN_EVENTS.has(eventType)) return "down";
  if (marketType && DOWN_OVERRIDES[eventType]?.has(marketType)) return "down";
  return "up";
}

// A "reverse" is a market move OPPOSITE to the intended direction by at least
// `threshold` line units. Returns the signed delta against the intended dir
// (positive number = how far the market moved AGAINST us); 0 if not a reverse.
export function reverseDelta(
  intended: "up" | "down",
  firedLine: number,
  currentLine: number,
): number {
  const move = currentLine - firedLine;
  const against = intended === "up" ? -move : move;
  return against > 0 ? against : 0;
}

export interface ScoreFeatures {
  excess_lag: number;
  event_impact: number;
  time_remaining?: number;
}

function sigmoid(x: number): number {
  if (x > 30) return 1;
  if (x < -30) return 0;
  return 1 / (1 + Math.exp(-x));
}

export function scoreEdge(
  f: ScoreFeatures,
  model?: SpeedModelCoefficients | null,
): { prob: number; expectedMove: number; source: "model" | "heuristic" } {
  if (model) {
    const t = f.time_remaining ?? 24;
    const logit =
      model.prob_intercept +
      model.prob_b_lag * f.excess_lag +
      model.prob_b_impact * f.event_impact +
      model.prob_b_time * t;
    const prob = Math.min(model.prob_cap ?? 0.95, sigmoid(logit));
    const moveRaw =
      model.move_intercept +
      model.move_b_lag * f.excess_lag +
      model.move_b_impact * f.event_impact;
    const expectedMove = Math.max(model.move_floor ?? 0.05, moveRaw);
    return { prob, expectedMove, source: "model" };
  }
  const prob = Math.min(0.95, 0.55 + 0.03 * f.excess_lag + 0.10 * f.event_impact);
  const expectedMove = 0.5 + 0.10 * f.excess_lag;
  return { prob, expectedMove, source: "heuristic" };
}

export function evPerUnit(prob: number, expectedMove: number): number {
  return prob * expectedMove - (1 - prob) * 1.0;
}

export function halfKellyStake(prob: number, expectedMove: number): number {
  const denom = Math.max(expectedMove, 0.01);
  return Math.max(0, 0.5 * ((prob * (1 + expectedMove) - 1) / denom));
}