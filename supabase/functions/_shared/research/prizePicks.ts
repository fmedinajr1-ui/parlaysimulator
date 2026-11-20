/** PrizePicks comparison: display only, never feeds picks or MODEL_VERSION. */
export type PPStat = "points" | "rebounds" | "assists" | "threes_made" | "pra";

/** Break-even chance each leg needs on common PrizePicks entries. */
export const PP_HURDLES = { power2: 0.577, flex5: 0.543 } as const;

const STAT_MAP: Record<string, PPStat> = {
  "points": "points", "rebounds": "rebounds", "assists": "assists",
  "3-pt made": "threes_made", "3-pointers made": "threes_made",
  "pts+rebs+asts": "pra", "points+rebounds+assists": "pra",
};
export function ppStat(name: string): PPStat | null {
  return STAT_MAP[name.trim().toLowerCase()] ?? null;
}

export interface PPLine { player: string; stat: PPStat; line: number }

/** Parse the public PrizePicks projections payload; standard lines only (no goblins/demons). */
export function parsePrizePicks(body: { data?: any[]; included?: any[] }): PPLine[] {
  const names: Record<string, string> = {};
  for (const inc of body.included ?? []) if (inc?.type === "new_player" && inc.attributes?.name) names[inc.id] = inc.attributes.name;
  const out: PPLine[] = [];
  for (const p of body.data ?? []) {
    const a = p?.attributes ?? {};
    if (a.odds_type && a.odds_type !== "standard") continue;
    const stat = ppStat(String(a.stat_type ?? ""));
    const line = Number(a.line_score);
    const player = names[p?.relationships?.new_player?.data?.id];
    if (stat && player && Number.isFinite(line)) out.push({ player, stat, line });
  }
  return out;
}

export type PPVerdict = "beats power" | "beats flex" | "below hurdle";
/** Verdict for a pure model chance (no sportsbook price blended in). */
export function ppVerdict(chance: number): PPVerdict {
  if (chance > PP_HURDLES.power2) return "beats power";
  if (chance > PP_HURDLES.flex5) return "beats flex";
  return "below hurdle";
}
