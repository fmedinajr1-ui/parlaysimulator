/**
 * Calibration filters learned from settled picks (Nov 9–13, 2026):
 * - Cold player on an Over for points/PRA went 0–5; for threes 2–3.
 * - Hot player on an Under for points went 5–7.
 * - Threes made went 14–17 overall (coin-flip noise on 1.5/2.5 lines).
 * - Same-player stacks were swept 0–2 / 0–3 repeatedly.
 * Pure rules; they decide which props may qualify, never the win chance.
 */
export interface FilterInput { player: string; stat: string; side: "over" | "under"; trend: "hot" | "cold" | "flat" | string; hitRate: number; ev: number; }

export const THREES_MIN_WIN = 0.65;
export const THREES_MIN_EV = 0.08;

/** Reason a prop is blocked, or null when it may qualify. */
export function calibrationVeto(p: FilterInput): string | null {
  if (p.trend === "cold" && p.side === "over" && (p.stat === "points" || p.stat === "pra" || p.stat === "threes_made"))
    return "Cold scorer on an Over — this setup lost most often.";
  if (p.trend === "hot" && p.side === "under" && p.stat === "points")
    return "Fading a hot scorer's points — this setup lost most often.";
  if (p.stat === "threes_made" && (p.hitRate < THREES_MIN_WIN || p.ev < THREES_MIN_EV))
    return "Threes are high-variance; needs 65%+ win chance and 8%+ edge.";
  return null;
}

/** Keeps only the best (first, list must be sorted best-first) qualifying prop per player. */
export function onePerPlayer<T extends { player: string }>(sorted: T[]): T[] {
  const seen = new Set<string>();
  return sorted.filter((p) => (seen.has(p.player) ? false : (seen.add(p.player), true)));
}
