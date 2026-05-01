// Court.Edge — surface-tier baseline totals.
// Used as a fallback when TennisAbstract L3 scrape misses a player so the
// projection pipeline never silently drops a match. Numbers are derived from
// long-run averages of total games per match/player on each surface and sets
// format. Treat any pick that uses a baseline side as LOW confidence — the
// orchestrator will cap the verdict to LEAN_* in that case.

export type Surface = "hard" | "clay" | "grass" | "indoor" | "unknown";
export type SetsFormat = "best_of_3" | "best_of_5";

export interface BaselineResult {
  // Per-player "recent total games" baseline (one player's contribution to the match).
  player_total: number;
  // Confidence tag — "low" whenever this baseline is used.
  confidence: "low";
  // Human-readable reason, surfaced in drilldown.
  reason: string;
}

// Per-player average total games (own + opponent's against them) across a match.
// Roughly half of a typical match total. Bo5 ~1.6× Bo3.
const TABLE: Record<SetsFormat, Record<Surface, number>> = {
  best_of_3: {
    hard: 21.4,
    clay: 20.8,
    grass: 22.0,
    indoor: 21.2,
    unknown: 21.2,
  },
  best_of_5: {
    hard: 33.6,
    clay: 33.0,
    grass: 34.2,
    indoor: 33.4,
    unknown: 33.4,
  },
};

export function baselineFor(surface: Surface, sets_format: SetsFormat): BaselineResult {
  const sf: SetsFormat = sets_format === "best_of_5" ? "best_of_5" : "best_of_3";
  const su: Surface = (TABLE.best_of_3[surface] ? surface : "unknown") as Surface;
  return {
    player_total: TABLE[sf][su],
    confidence: "low",
    reason: `surface baseline (${su}, ${sf.replace("_", "-")})`,
  };
}

// Convert a per-player baseline into an L3-shaped array (3 entries) so it can
// be plugged straight into the existing projection function without changing
// downstream signatures.
export function baselineL3(surface: Surface, sets_format: SetsFormat): number[] {
  const b = baselineFor(surface, sets_format);
  return [b.player_total, b.player_total, b.player_total];
}

// True when the surface key isn't one of the explicit ones.
export function isUnknownSurface(s: string | null | undefined): boolean {
  return !s || !(s in TABLE.best_of_3);
}