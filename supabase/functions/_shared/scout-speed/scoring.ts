// PHASE-0 heuristic scoring. Do NOT hand-tune coefficients.
// Replace with logistic regression fit on lag_edges.actual_move after ~2 weeks of data.

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

export function scoreEdge(f: ScoreFeatures): { prob: number; expectedMove: number } {
  const prob = Math.min(0.95, 0.55 + 0.03 * f.excess_lag + 0.10 * f.event_impact);
  const expectedMove = 0.5 + 0.10 * f.excess_lag;
  return { prob, expectedMove };
}

export function evPerUnit(prob: number, expectedMove: number): number {
  return prob * expectedMove - (1 - prob) * 1.0;
}

export function halfKellyStake(prob: number, expectedMove: number): number {
  const denom = Math.max(expectedMove, 0.01);
  return Math.max(0, 0.5 * ((prob * (1 + expectedMove) - 1) / denom));
}