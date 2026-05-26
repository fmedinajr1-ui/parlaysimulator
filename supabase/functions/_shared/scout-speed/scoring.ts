// Scout Speed Edge scoring.
// Phase 1 supports an optional fitted model (logistic + linear) loaded from
// `scout_speed_models`. When no active model is present (cold start), the
// Phase-0 heuristic is used so the engine keeps firing.

import type { SpeedModelCoefficients } from "./model.ts";

const IMPACT_HEURISTICS: Record<string, number> = {
  SHOT_MADE: 0.9, ASSIST: 0.7, REBOUND: 0.6,
  FOUL: 0.5, SUBSTITUTION: 0.4, INJURY: 1.0,
  TIMEOUT: 0.3, GOAL: 0.9, TD: 1.0,
};

export function impactScore(eventType: string): number {
  return IMPACT_HEURISTICS[eventType] ?? 0.5;
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