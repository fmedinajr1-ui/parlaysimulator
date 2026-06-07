// Interim parametric WP (spec §2.2).
// β are UNFIT placeholders — winProb() returns null unless explicitly
// allowed via { allowUncalibrated: true }. Every alert built on top of an
// uncalibrated WP must be tagged WARN, admin-only, never auto-bet.
import { GameState } from "./state.ts";
import { re24 } from "./re24.ts";
import { MAX_SCORE_DIFF, REG_INNINGS } from "./constants.ts";

// Placeholder coefficients — DO NOT TRUST.
// Fit via logistic regression on historical PBP before going live.
const BETA = {
  b0: 0,
  b1: 0.18,   // scoreDiff main effect
  b2: 0.55,   // scoreDiff × fracElapsed (late leads matter more)
  b3: 0.05,   // signed RE (current threat)
};
const CALIBRATED = false; // flip true only when fit on real data

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function sigmoid(z: number): number { return 1 / (1 + Math.exp(-z)); }

export interface WinProbOpts {
  allowUncalibrated?: boolean;
}

export function winProb(state: GameState, opts: WinProbOpts = {}): number | null {
  if (!CALIBRATED && !opts.allowUncalibrated) return null;
  const scoreDiff = clamp(state.scoreDiff, -MAX_SCORE_DIFF, MAX_SCORE_DIFF);
  const fracElapsed = clamp(
    ((state.inning - 1) + (state.half === "bottom" ? 0.5 : 0)) / REG_INNINGS,
    0,
    1,
  );
  const signedRE = re24(state.bases, state.outs) * (state.battingTeam === "home" ? +1 : -1);
  const z = BETA.b0
    + BETA.b1 * scoreDiff
    + BETA.b2 * scoreDiff * fracElapsed
    + BETA.b3 * signedRE;
  const p = sigmoid(z);
  if (!Number.isFinite(p)) return null;
  return p;
}

export function isWpCalibrated(): boolean { return CALIBRATED; }