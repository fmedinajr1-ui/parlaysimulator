// Scout Speed Edge — Phase 1 model loader + lightweight trainer.
// Model is fit OFFLINE by `scout-speed-model-trainer` and stored in
// `scout_speed_models`. At runtime, `scout-live-edge` calls `loadActiveModel`
// once per request and hands the result to `scoreEdge`. If no active model
// exists (cold-start), `scoreEdge` falls back to the Phase-0 heuristic.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface SpeedModelCoefficients {
  // Logistic regression on hit probability (actual_move > 0 in expected direction).
  // logit(p) = intercept + b_lag*excess_lag + b_impact*event_impact + b_time*time_remaining
  prob_intercept: number;
  prob_b_lag: number;
  prob_b_impact: number;
  prob_b_time: number;
  prob_cap: number; // upper bound on prob (default 0.95)

  // Linear regression on expected_move magnitude.
  // move = m_intercept + m_b_lag*excess_lag + m_b_impact*event_impact
  move_intercept: number;
  move_b_lag: number;
  move_b_impact: number;
  move_floor: number; // min returned value (default 0.05)
}

export interface SpeedModel {
  id: string;
  version: number;
  coefficients: SpeedModelCoefficients;
  n_samples: number;
  log_loss: number | null;
  brier: number | null;
  mse_move: number | null;
  fit_at: string;
}

let cached: { model: SpeedModel | null; ts: number } | null = null;
const CACHE_TTL_MS = 60_000;

export async function loadActiveModel(
  supabase: SupabaseClient,
  opts: { force?: boolean } = {},
): Promise<SpeedModel | null> {
  if (!opts.force && cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.model;
  try {
    const { data, error } = await supabase
      .from("scout_speed_models")
      .select("id, version, coefficients, n_samples, log_loss, brier, mse_move, fit_at")
      .eq("active", true)
      .order("fit_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[scout-speed/model] load error", error);
      cached = { model: null, ts: Date.now() };
      return null;
    }
    const model = data ? ({ ...data, coefficients: data.coefficients as SpeedModelCoefficients }) as SpeedModel : null;
    cached = { model, ts: Date.now() };
    return model;
  } catch (e) {
    console.error("[scout-speed/model] load failed", e);
    cached = { model: null, ts: Date.now() };
    return null;
  }
}

export function resetModelCache() { cached = null; }

// ---------- Training utilities (pure; called by trainer edge function) ----------

export interface TrainingRow {
  excess_lag: number;
  event_impact: number;
  time_remaining: number;
  hit: 0 | 1;          // logistic label
  actual_move: number; // linear label (absolute move magnitude)
}

function sigmoid(x: number): number {
  if (x > 30) return 1;
  if (x < -30) return 0;
  return 1 / (1 + Math.exp(-x));
}

/** Batch gradient descent logistic regression with L2. Returns weights [b0, b_lag, b_impact, b_time]. */
export function fitLogistic(rows: TrainingRow[], opts: { lr?: number; iters?: number; l2?: number } = {}): number[] {
  const lr = opts.lr ?? 0.05;
  const iters = opts.iters ?? 2000;
  const l2 = opts.l2 ?? 0.001;
  const n = rows.length;
  if (n === 0) return [0, 0, 0, 0];
  const w = [0, 0, 0, 0];
  for (let it = 0; it < iters; it++) {
    const g = [0, 0, 0, 0];
    for (const r of rows) {
      const z = w[0] + w[1] * r.excess_lag + w[2] * r.event_impact + w[3] * r.time_remaining;
      const p = sigmoid(z);
      const err = p - r.hit;
      g[0] += err;
      g[1] += err * r.excess_lag;
      g[2] += err * r.event_impact;
      g[3] += err * r.time_remaining;
    }
    for (let i = 0; i < 4; i++) {
      const reg = i === 0 ? 0 : l2 * w[i];
      w[i] -= lr * (g[i] / n + reg);
    }
  }
  return w;
}

/** Closed-form OLS for [intercept, b_lag, b_impact]. Returns weights. */
export function fitLinear(rows: TrainingRow[]): number[] {
  const n = rows.length;
  if (n === 0) return [0.5, 0, 0];
  // Build X^T X (3x3) and X^T y
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const b = [0, 0, 0];
  for (const r of rows) {
    const x = [1, r.excess_lag, r.event_impact];
    const y = r.actual_move;
    for (let i = 0; i < 3; i++) {
      b[i] += x[i] * y;
      for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j];
    }
  }
  return solve3x3(A, b) ?? [0.5, 0, 0];
}

function solve3x3(A: number[][], b: number[]): number[] | null {
  // Gaussian elimination with partial pivoting on 3x3.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 3; i++) {
    let maxRow = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[maxRow][i])) maxRow = r;
    if (Math.abs(M[maxRow][i]) < 1e-12) return null;
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    for (let r = i + 1; r < 3; r++) {
      const f = M[r][i] / M[i][i];
      for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c];
    }
  }
  const x = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let s = M[i][3];
    for (let c = i + 1; c < 3; c++) s -= M[i][c] * x[c];
    x[i] = s / M[i][i];
  }
  return x;
}

export function logLoss(rows: TrainingRow[], w: number[]): number {
  if (rows.length === 0) return 0;
  let s = 0;
  for (const r of rows) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(w[0] + w[1] * r.excess_lag + w[2] * r.event_impact + w[3] * r.time_remaining)));
    s += r.hit === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return s / rows.length;
}

export function brierScore(rows: TrainingRow[], w: number[]): number {
  if (rows.length === 0) return 0;
  let s = 0;
  for (const r of rows) {
    const p = sigmoid(w[0] + w[1] * r.excess_lag + w[2] * r.event_impact + w[3] * r.time_remaining);
    s += (p - r.hit) ** 2;
  }
  return s / rows.length;
}

export function mseMove(rows: TrainingRow[], w: number[]): number {
  if (rows.length === 0) return 0;
  let s = 0;
  for (const r of rows) {
    const yhat = w[0] + w[1] * r.excess_lag + w[2] * r.event_impact;
    s += (yhat - r.actual_move) ** 2;
  }
  return s / rows.length;
}