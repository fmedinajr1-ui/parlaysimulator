import { pickWarnings, type WarnInput } from "./pickWarnings";

/** Presentation audit only. Never modifies model probabilities or logged picks. */
export function reviewDeskPicks<T extends WarnInput>(picks: T[]) {
  const reviewed = picks.map((pick) => ({ pick, warnings: pickWarnings(pick) }));
  return {
    clear: reviewed.filter((row) => row.warnings.length === 0).map((row) => row.pick),
    flagged: reviewed.filter((row) => row.warnings.length > 0).map((row) => row.pick),
    total: reviewed.length,
  };
}