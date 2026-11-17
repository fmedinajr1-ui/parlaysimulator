/**
 * Calibration filters learned from settled picks (Nov 9–13, 2026):
 * - Cold player on an Over for points/PRA went 0–5; for threes 2–3.
 * - Hot player on an Under for points went 5–7.
 * - Threes made went 14–17 overall (coin-flip noise on 1.5/2.5 lines).
 * - Same-player stacks were swept 0–2 / 0–3 repeatedly.
 * Pure rules; they decide which props may qualify, never the win chance.
 */
export interface FilterInput {
  player: string; stat: string; side: "over" | "under"; trend: "hot" | "cold" | "flat" | string; hitRate: number; ev: number;
  /** Tonight's line and our projection (trap cap). */
  line?: number; projection?: number;
  /** Stat in the last 5 played games (ceiling check). */
  last5?: number[];
  /** Averages over the last 3 played games (Over volume gate). */
  minutesL3?: number; fgaL3?: number;
  /** Stress test: rotation teammates (28+ min) ruled out tonight. */
  keyMatesOut?: number;
  /** Stress test: this stat in earlier games vs tonight's opponent this season. */
  vsOpponent?: number[];
  /** Stress test: minutes in the most recent played game. */
  lastMinutes?: number;
  /** Coach roles: season averages (points per game, minutes per game). */
  seasonPoints?: number; seasonMinutes?: number;
}

/** Season scoring average that marks a franchise scorer (never fade low points lines). */
export const STAR_PPG = 25;
export const STAR_UNDER_MAX_LINE = 24.5;
/** Season minutes below this mark a rotation/bench role (no Overs off short hot streaks). */
export const BENCH_MINUTES = 22;

export const KEY_MATE_MINUTES = 28;
export const OVER_MIN_LAST_MINUTES = 26;

/** Below this win chance plays went 2-6 (main) and 18-26 (shelf). */
export const MIN_WIN = 0.65;
/** Gap from line beyond which the book likely knows something we don't (Jan 2026 trap cap). */
export const TRAP_ABS: Record<string, number> = { points: 6, rebounds: 3, assists: 3, threes_made: 1.5, pra: 6 };
export const TRAP_REL = 0.35;
export const OVER_MIN_MINUTES = 28;
export const OVER_MIN_FGA = 10;

export const THREES_MIN_WIN = 0.65;
export const THREES_MIN_EV = 0.08;

/** Reason a prop is blocked, or null when it may qualify. */
export function calibrationVeto(p: FilterInput): string | null {
  if (p.trend === "cold" && p.side === "over" && (p.stat === "points" || p.stat === "pra" || p.stat === "threes_made"))
    return "Cold scorer on an Over — this setup lost most often.";
  if (p.trend === "hot" && p.side === "under" && p.stat === "points")
    return "Fading a hot scorer's points — this setup lost most often.";
  if (p.hitRate < MIN_WIN) return "Below 65% win chance — this zone lost on both lists.";
  if (p.line != null && p.projection != null) {
    const gap = Math.abs(p.projection - p.line);
    if (gap > Math.max(TRAP_REL * p.line, TRAP_ABS[p.stat] ?? Infinity))
      return "Our number is far from the book's — likely a role change the book priced in (trap).";
  }
  if (p.side === "under" && p.line != null && p.last5 && p.last5.filter((v) => v > p.line!).length >= 2)
    return "Went over this line in 2+ of the last 5 — ceiling risk on the Under.";
  if (p.side === "over" && p.minutesL3 != null) {
    const scoring = p.stat === "points" || p.stat === "pra";
    const volume = p.minutesL3 >= OVER_MIN_MINUTES || (scoring && (p.fgaL3 ?? 0) >= OVER_MIN_FGA);
    if (!volume) return "Low-volume role for an Over (under 28 min and under 10 shots lately).";
  }
  if (p.side === "under" && (p.keyMatesOut ?? 0) >= 2)
    return "Role alert: 2+ key teammates out — usage goes up, Under is risky.";
  if (p.side === "under" && p.stat === "points" && (p.seasonPoints ?? 0) >= STAR_PPG && p.line != null && p.line < STAR_UNDER_MAX_LINE)
    return "Star scorer: never fade a 25+ PPG player's points on a line under 24.5.";
  if (p.side === "over" && p.seasonMinutes != null && p.seasonMinutes < BENCH_MINUTES)
    return "Bench role: under 22 minutes a night this season — coach's leash is too short for an Over.";
  if (p.stat === "threes_made" && (p.hitRate < THREES_MIN_WIN || p.ev < THREES_MIN_EV))
    return "Threes are high-variance; needs 65%+ win chance and 8%+ edge.";
  return null;
}

/** Stress-test cautions shown on the card; they never block a pick. */
export function stressNotes(p: FilterInput): string[] {
  const notes: string[] = [];
  if (p.line != null && p.vsOpponent?.length && p.vsOpponent.some((v) => (p.side === "under" ? v > p.line! : v < p.line!)))
    notes.push("Matchup alert: this side missed once already against tonight's opponent.");
  if (p.side === "over" && p.lastMinutes != null && p.lastMinutes < OVER_MIN_LAST_MINUTES)
    notes.push("Minutes alert: played under 26 minutes last game.");
  return notes;
}

/** Keeps only the best (first, list must be sorted best-first) qualifying prop per player. */
export function onePerPlayer<T extends { player: string }>(sorted: T[]): T[] {
  const seen = new Set<string>();
  return sorted.filter((p) => (seen.has(p.player) ? false : (seen.add(p.player), true)));
}
