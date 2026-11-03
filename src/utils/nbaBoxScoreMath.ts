export type StatKey = "points" | "rebounds" | "assists" | "threes_made" | "pra";

export interface GameLog {
  player_name: string;
  game_date: string;
  opponent: string | null;
  minutes_played: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threes_made: number | null;
}

export function statValue(g: GameLog, stat: StatKey): number {
  if (stat === "pra") return (Number(g.points) || 0) + (Number(g.rebounds) || 0) + (Number(g.assists) || 0);
  return Number(g[stat]) || 0;
}

/** Linear-interpolated percentile (p in 0..1). */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function hitRate(values: number[], line: number): number {
  if (!values.length) return 0;
  return values.filter((v) => v > line).length / values.length;
}

export interface WindowStats { median: number; floor: number; ceiling: number; hitRate: number; games: number }

export function windowStats(values: number[], line: number): WindowStats {
  return {
    median: percentile(values, 0.5),
    floor: percentile(values, 0.2),
    ceiling: percentile(values, 0.8),
    hitRate: hitRate(values, line),
    games: values.length,
  };
}

export interface PlayerSummary {
  player: string;
  lastOpponent: string | null;
  lastDate: string;
  l5: WindowStats;
  l10: WindowStats;
  trend: "hot" | "cold" | "flat";
  recent: number[];
}

/** Logs: any order. Games with 0 minutes (DNP) are excluded. Line defaults to L10 median. */
export function summarizePlayer(logs: GameLog[], stat: StatKey, line?: number): PlayerSummary | null {
  const played = logs
    .filter((g) => (Number(g.minutes_played) || 0) > 0)
    .sort((a, b) => b.game_date.localeCompare(a.game_date));
  if (!played.length) return null;
  const l10v = played.slice(0, 10).map((g) => statValue(g, stat));
  const l5v = l10v.slice(0, 5);
  const ln = line ?? percentile(l10v, 0.5);
  const l5 = windowStats(l5v, ln);
  const l10 = windowStats(l10v, ln);
  const diff = l10.median ? (l5.median - l10.median) / l10.median : 0;
  return {
    player: played[0].player_name,
    lastOpponent: played[0].opponent,
    lastDate: played[0].game_date,
    l5,
    l10,
    trend: diff >= 0.1 ? "hot" : diff <= -0.1 ? "cold" : "flat",
    recent: l10v,
  };
}
