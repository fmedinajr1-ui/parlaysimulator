import type { PlayerSummary } from "./nbaBoxScoreMath";

export type ResearchTrendFilter = "all" | PlayerSummary["trend"];
export type ResearchSort = "l10Median" | "l5Median" | "l5Hit" | "l10Hit";

export interface ResearchFilters {
  /** Minimum over-hit rate, from 0 to 1. */
  minL5Hit: number;
  /** Minimum over-hit rate, from 0 to 1. */
  minL10Hit: number;
  trend: ResearchTrendFilter;
  sort: ResearchSort;
}

export const DEFAULT_RESEARCH_FILTERS: ResearchFilters = {
  minL5Hit: 0,
  minL10Hit: 0,
  trend: "all",
  sort: "l10Median",
};

/** Filters and sorts researched players without mutating the supplied rows. */
export function filterResearchRows(rows: PlayerSummary[], filters: ResearchFilters): PlayerSummary[] {
  const value = (row: PlayerSummary) => {
    switch (filters.sort) {
      case "l5Median": return row.l5.median;
      case "l5Hit": return row.l5.hitRate;
      case "l10Hit": return row.l10.hitRate;
      default: return row.l10.median;
    }
  };

  return rows
    .filter((row) =>
      row.l5.hitRate >= filters.minL5Hit &&
      row.l10.hitRate >= filters.minL10Hit &&
      (filters.trend === "all" || row.trend === filters.trend)
    )
    .sort((a, b) => value(b) - value(a) || b.l10.median - a.l10.median || a.player.localeCompare(b.player));
}
