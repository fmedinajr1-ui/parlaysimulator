import type { StatKey } from "./nbaBoxScoreMath";

export interface ComparablePick {
  player: string;
  stat: StatKey;
  line: number;
  median: number;
  hitRate: number;
  ev: number;
  side: "over" | "under";
}

export interface ComparisonRow {
  key: string;
  player: string;
  stat: StatKey;
  v5?: ComparablePick;
  v6?: ComparablePick;
}

/** Pair recommendations for the same player and stat, including one-model-only picks. */
export function pairModelPicks(v5: ComparablePick[], v6: ComparablePick[]): ComparisonRow[] {
  const rows = new Map<string, ComparisonRow>();
  for (const [version, picks] of [["v5", v5], ["v6", v6]] as const) {
    for (const pick of picks) {
      const key = `${pick.player.toLowerCase()}|${pick.stat}`;
      const row = rows.get(key) ?? { key, player: pick.player, stat: pick.stat };
      row[version] = pick;
      rows.set(key, row);
    }
  }
  return [...rows.values()].sort((a, b) => Math.max(b.v5?.ev ?? -1, b.v6?.ev ?? -1) - Math.max(a.v5?.ev ?? -1, a.v6?.ev ?? -1));
}

export interface ModelResult {
  game_date: string;
  model_version: string;
  status: string;
  odds: number | null;
}

export function summarizeModelResults(rows: ModelResult[], version: string, sharedDates: Set<string>) {
  const selected = rows.filter((r) => r.model_version === version && sharedDates.has(r.game_date));
  const won = selected.filter((r) => r.status === "won");
  const lost = selected.filter((r) => r.status === "lost").length;
  const push = selected.filter((r) => r.status === "push").length;
  const open = selected.filter((r) => r.status === "open").length;
  const units = won.reduce((n, r) => {
    const odds = r.odds ?? -110;
    return n + (odds > 0 ? odds / 100 : 100 / -odds);
  }, 0) - lost;
  return { w: won.length, l: lost, p: push, open, units };
}
