import { percentile, type GameLog } from "./nbaBoxScoreMath";

export interface MinutesProjection {
  minutes: number;
  l10: number;
  l3: number;
  b2b: boolean;
  /** Extra minutes expected from same-team players ruled out (capped). */
  mateBump: number;
}

/**
 * Display-only minutes estimate: L10 median, nudged toward the last 3 games,
 * trimmed on a back-to-back, plus a capped share of teammates' missing minutes.
 * It explains the projection and does not change picks or MODEL_VERSION.
 */
export function projectMinutes(games: GameLog[], today: string, mateMinutesOut = 0): MinutesProjection | null {
  const played = games.filter((g) => Number(g.minutes_played) > 0 && g.game_date < today)
    .sort((a, b) => b.game_date.localeCompare(a.game_date));
  if (played.length < 3) return null;
  const mins = played.slice(0, 10).map((g) => Number(g.minutes_played));
  const l10 = percentile(mins, 0.5);
  const l3 = percentile(mins.slice(0, 3), 0.5);
  const base = Math.min(l10 * 1.15, Math.max(l10 * 0.85, 0.6 * l10 + 0.4 * l3));
  const y = new Date(`${today}T12:00:00Z`); y.setUTCDate(y.getUTCDate() - 1);
  const b2b = played[0].game_date === y.toISOString().slice(0, 10);
  const rest = b2b ? (l10 >= 32 ? 0.95 : 0.97) : 1;
  const mateBump = Math.min(4, Math.max(0, mateMinutesOut) * 0.1 * Math.min(1.2, l10 / 30));
  const minutes = Math.min(42, base * rest + mateBump);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { minutes: r1(minutes), l10: r1(l10), l3: r1(l3), b2b, mateBump: r1(mateBump) };
}
