/**
 * Flags picks where the desk's own data disagrees with the recommendation, so a
 * card never shows a confident win chance next to a cold trend or a weak hit record.
 * Display only: does not change projections or MODEL_VERSION.
 */
export interface WarnInput { side: "over" | "under"; hitRate: number; hitsL10: number; gamesL10: number; trend?: string }

export function pickWarnings(p: WarnInput): string[] {
  const out: string[] = [];
  const actual = p.gamesL10 ? p.hitsL10 / p.gamesL10 : 0;
  if (p.gamesL10 && p.hitRate - actual >= 0.1)
    out.push(`Model says ${Math.round(p.hitRate * 100)}% but this side only hit ${p.hitsL10} of his last ${p.gamesL10} (${Math.round(actual * 100)}%).`);
  if (p.trend === "cold" && p.side === "over") out.push("He's cold right now (last 5 below his last 10) and this is an Over.");
  if (p.trend === "hot" && p.side === "under") out.push("He's hot right now (last 5 above his last 10) and this is an Under.");
  return out;
}
