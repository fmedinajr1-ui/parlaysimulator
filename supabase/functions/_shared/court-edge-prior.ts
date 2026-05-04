// Court.Edge — match-total game priors (mu, sd) by surface × sets × tour.
// Pure data, no I/O. Used by project() to (a) recompose around a fixed mean
// instead of stacking multiplicative surface/sets effects on top of L3, and
// (b) bound the final projection to a 3σ envelope.

export type Tour = "atp" | "wta" | "unknown";
export type Sets = "bo3" | "bo5";
export type Surface = "hard" | "clay" | "grass" | "indoor" | "unknown";

export interface Prior { mu: number; sd: number }

const HARD_BO3_ATP: Prior = { mu: 22.0, sd: 3.6 };
const HARD_BO3_WTA: Prior = { mu: 20.8, sd: 3.4 };
const HARD_BO5: Prior     = { mu: 35.0, sd: 5.5 };

export const MATCH_TOTAL_PRIOR: Record<Sets, Record<"atp"|"wta", Record<Surface, Prior>>> = {
  bo3: {
    atp: {
      hard:   HARD_BO3_ATP,
      clay:   { mu: 21.4, sd: 3.4 },
      grass:  { mu: 22.6, sd: 4.0 },
      indoor: { mu: 21.8, sd: 3.6 },
      unknown: HARD_BO3_ATP,
    },
    wta: {
      hard:   HARD_BO3_WTA,
      clay:   { mu: 20.4, sd: 3.3 },
      grass:  { mu: 21.0, sd: 3.8 },
      indoor: { mu: 20.6, sd: 3.4 },
      unknown: HARD_BO3_WTA,
    },
  },
  bo5: {
    atp: {
      hard:   HARD_BO5,
      clay:   { mu: 34.0, sd: 5.2 },
      grass:  { mu: 36.0, sd: 6.0 },
      indoor: { mu: 34.6, sd: 5.4 },
      unknown: HARD_BO5,
    },
    // WTA bo5 doesn't really exist on tour; mirror ATP for safety.
    wta: {
      hard:   HARD_BO5,
      clay:   { mu: 34.0, sd: 5.2 },
      grass:  { mu: 36.0, sd: 6.0 },
      indoor: { mu: 34.6, sd: 5.4 },
      unknown: HARD_BO5,
    },
  },
};

export function priorFor(tour: Tour, sets: Sets, surface: Surface | string | null | undefined): Prior {
  const t: "atp" | "wta" = tour === "atp" ? "atp" : "wta"; // unknown → wta (more conservative mu)
  const s: Sets = sets === "bo5" ? "bo5" : "bo3";
  const surfKey = (surface ?? "unknown") as Surface;
  const row = MATCH_TOTAL_PRIOR[s][t];
  return row[surfKey] ?? row.unknown;
}