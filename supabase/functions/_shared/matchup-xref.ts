// _shared/matchup-xref.ts
// Shared matchup_intelligence cross-reference helpers used by lottery-1500-builder
// and parlay-engine-v2 (and any future parlay engine). Single source of truth for
// the per-leg matchup adjustment so engines stay in sync.

export type MatchupRow = {
  player_name?: string | null;
  prop_type?: string | null;
  side?: string | null;
  line?: number | null;
  matchup_score: number | null;
  opponent_defensive_rank: number | null;
  position_defense_rank: number | null;
  position_group: string | null;
  blowout_risk: number | null;
  game_script: string | null;
  is_blocked: boolean | null;
  block_reason: string | null;
  risk_flags: string[] | null;
  confidence_adjustment: number | null;
  opponent_team: string | null;
};

export type MatchupMap = Map<string, MatchupRow>;

function keyFor(player: string, prop: string, side: string, line: number | null | undefined): string {
  const sideKey = side === "OVER" || side === "UNDER" ? side : "ANY";
  const lineKey = line != null ? String(line) : "";
  return `${player.toLowerCase()}|${prop}|${sideKey}|${lineKey}`;
}

/** Load matchup_intelligence for today + tomorrow (ET) into a Map. Non-fatal. */
export async function loadMatchupMap(
  supabase: any,
  dates: string[],
): Promise<MatchupMap> {
  const map: MatchupMap = new Map();
  if (!dates?.length) return map;
  try {
    const { data, error } = await supabase
      .from("matchup_intelligence")
      .select(
        "player_name, prop_type, side, line, matchup_score, opponent_defensive_rank, position_defense_rank, position_group, blowout_risk, game_script, is_blocked, block_reason, risk_flags, confidence_adjustment, opponent_team",
      )
      .in("game_date", dates);
    if (error) {
      console.warn("[matchup-xref] load failed:", error.message);
      return map;
    }
    for (const m of (data ?? []) as MatchupRow[]) {
      const k = keyFor(String(m.player_name ?? ""), String(m.prop_type ?? ""), String(m.side ?? "ANY").toUpperCase(), m.line ?? null);
      map.set(k, m);
    }
  } catch (e) {
    console.warn("[matchup-xref] load threw:", e instanceof Error ? e.message : String(e));
  }
  return map;
}

export function lookupMatchup(
  player: string,
  prop: string,
  side: string,
  line: number | null | undefined,
  map: MatchupMap,
): MatchupRow | null {
  if (!player || !prop) return null;
  const exact = map.get(keyFor(player, prop, side, line));
  if (exact) return exact;
  const sideKey = side === "OVER" || side === "UNDER" ? side : "ANY";
  const prefix = `${player.toLowerCase()}|${prop}|${sideKey}|`;
  for (const [k, v] of map) {
    if (k.startsWith(prefix)) return v;
  }
  return null;
}

export function buildMatchupNote(m: MatchupRow): string {
  const bits: string[] = [];
  if (m.position_defense_rank != null) {
    bits.push(`pos D rk ${m.position_defense_rank}${m.position_group ? `/${m.position_group}` : ""}`);
  } else if (m.opponent_defensive_rank != null) {
    bits.push(`D rk ${m.opponent_defensive_rank}`);
  }
  if (m.matchup_score != null) bits.push(`m=${Number(m.matchup_score).toFixed(1)}`);
  if (m.game_script && m.game_script !== "COMPETITIVE") bits.push(`script ${m.game_script}`);
  if (m.blowout_risk != null && Number(m.blowout_risk) >= 0.5) bits.push("blowout");
  if (m.risk_flags && m.risk_flags.length) bits.push(m.risk_flags.slice(0, 2).join(","));
  return bits.join(" · ");
}

/**
 * Compute the additive safety/confidence adjustment for a single leg.
 * Returns 0 when no matchup row exists. `blocked` indicates the leg should be
 * dropped entirely (matchup_intelligence.is_blocked = true).
 *
 * matchup_score in DB ranges roughly -6..+6; normalized to ±1 and scaled by 0.07.
 * confidence_adjustment is clamped to ±0.05. Blowout risk on Overs takes -0.05.
 */
export function matchupAdjustment(
  player: string,
  prop: string,
  side: string,
  line: number | null | undefined,
  map: MatchupMap,
): { adj: number; blocked: boolean; note: string; row: MatchupRow | null } {
  const m = lookupMatchup(player, prop, side, line, map);
  if (!m) return { adj: 0, blocked: false, note: "", row: null };
  if (m.is_blocked) return { adj: 0, blocked: true, note: buildMatchupNote(m), row: m };
  const norm = m.matchup_score != null ? Math.max(-1, Math.min(1, Number(m.matchup_score) / 5)) : 0;
  const ca = m.confidence_adjustment != null ? Math.max(-0.05, Math.min(0.05, Number(m.confidence_adjustment))) : 0;
  let adj = norm * 0.07 + ca;
  if (side === "OVER" && m.blowout_risk != null && Number(m.blowout_risk) >= 0.7) adj -= 0.05;
  return { adj, blocked: false, note: buildMatchupNote(m), row: m };
}

/** ET date helpers for the two-day window we cross-reference. */
export function etTodayTomorrow(): [string, string] {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString().slice(0, 10);
  const tomorrow = new Date(new Date(Date.now() + 24 * 3600_000).toLocaleString("en-US", { timeZone: "America/New_York" }))
    .toISOString().slice(0, 10);
  return [today, tomorrow];
}