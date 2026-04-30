// Court.Edge — player playstyle archetypes ("roles") and matchup-aware adjustments.
// Pure logic. Static seeds + DB lookup + heuristic fallback.

import type { Surface } from "./court-edge-projection.ts";

export type Archetype =
  | "big_server"
  | "aggressive_baseliner"
  | "counter_puncher"
  | "clay_grinder"
  | "serve_and_volleyer"
  | "all_court"
  | "unknown";

export type ServeTier = "elite" | "good" | "avg";

export interface PlayerRole {
  player_slug: string;
  player_name: string;
  archetype: Archetype;
  serve_tier: ServeTier;
  clay_score: number;
  grass_score: number;
  hard_score: number;
  notes?: string | null;
  source: "seed" | "db" | "heuristic" | "unknown";
}

export interface RoleContext {
  surface: Surface;
  indoor: boolean;
  wind_mph?: number | null;
  temp_f?: number | null;
}

export interface RoleAdjustment {
  adj_games: number;
  reason: string | null;
}

export const UNKNOWN_ROLE: PlayerRole = {
  player_slug: "",
  player_name: "",
  archetype: "unknown",
  serve_tier: "avg",
  clay_score: 0.5,
  grass_score: 0.5,
  hard_score: 0.5,
  notes: null,
  source: "unknown",
};

export function archetypeLabel(a: Archetype): string {
  switch (a) {
    case "big_server": return "Big server";
    case "aggressive_baseliner": return "Aggressive baseliner";
    case "counter_puncher": return "Counter-puncher";
    case "clay_grinder": return "Clay grinder";
    case "serve_and_volleyer": return "Serve & volleyer";
    case "all_court": return "All-court";
    default: return "Unknown";
  }
}

/**
 * Compute the games-adjustment + human reason for a player given the night's context.
 * Positive adj = more games (favours OVER); negative = fewer games (favours UNDER).
 * Each branch is intentionally small (≤ 0.6) so total swing across both players
 * caps near ±1.2 games — meaningful but not dominant vs the surface multiplier.
 */
export function roleAdjustment(role: PlayerRole, ctx: RoleContext): RoleAdjustment {
  const reasons: string[] = [];
  let adj = 0;

  if (role.archetype === "big_server") {
    if (ctx.surface === "clay" && !ctx.indoor) {
      adj += 0.4;
      reasons.push("Big serve neutralised on slow clay");
    } else if (ctx.surface === "grass" || ctx.indoor) {
      adj -= 0.3;
      reasons.push("Big serve dominates — quicker holds");
    }
    if (typeof ctx.wind_mph === "number" && ctx.wind_mph > 15) {
      adj -= 0.3;
      reasons.push("Wind disrupts serve toss");
    }
  } else if (role.archetype === "clay_grinder") {
    if (ctx.surface === "grass") {
      adj -= 0.6;
      reasons.push("Baseline grinder exposed on fast grass");
    } else if (ctx.surface === "hard" && ctx.indoor) {
      adj -= 0.3;
      reasons.push("Indoor speed limits clay grinder's defence");
    } else if (ctx.surface === "clay") {
      adj += 0.2;
      reasons.push("Comfort zone — extended rallies");
    }
  } else if (role.archetype === "counter_puncher") {
    if (ctx.surface === "hard" && ctx.indoor) {
      adj -= 0.3;
      reasons.push("No time to reset on quick indoor courts");
    } else if (ctx.surface === "clay") {
      adj += 0.3;
      reasons.push("Long rallies favour the counter-puncher");
    }
  } else if (role.archetype === "serve_and_volleyer") {
    if (ctx.surface === "clay") {
      adj -= 0.5;
      reasons.push("S&V style stalls on clay");
    } else if (ctx.surface === "grass" || ctx.indoor) {
      adj -= 0.2;
      reasons.push("S&V shortens points on fast surface");
    }
  } else if (role.archetype === "aggressive_baseliner") {
    if (typeof ctx.temp_f === "number" && ctx.temp_f < 50) {
      adj -= 0.2;
      reasons.push("Cold ball kills aggressive baseline winners");
    }
    if (ctx.surface === "clay" && role.clay_score < 0.6) {
      adj += 0.2;
      reasons.push("First-strike game blunted on slow clay");
    }
  }

  // Surface-fitness penalty when a player has a poor surface score.
  const surfScore = ctx.surface === "clay" ? role.clay_score
    : ctx.surface === "grass" ? role.grass_score
    : role.hard_score;
  if (role.archetype !== "unknown" && surfScore < 0.55) {
    adj -= 0.2;
    reasons.push(`Weak ${ctx.surface} fit (${surfScore.toFixed(2)})`);
  }

  return {
    adj_games: Number(adj.toFixed(2)),
    reason: reasons.length > 0 ? reasons.join(" · ") : null,
  };
}

// ─── Heuristic classifier from L3 raw scores ──────────────────────────────

function parseSets(raw: string): Array<{ a: number; b: number }> {
  const out: Array<{ a: number; b: number }> = [];
  for (const s of raw.split(/\s+/)) {
    const m = s.match(/^(\d{1,2})-(\d{1,2})/);
    if (m) out.push({ a: parseInt(m[1], 10), b: parseInt(m[2], 10) });
  }
  return out;
}

/**
 * Heuristic role inference using raw L3 set scores (e.g. "7-6(5) 7-5").
 * Falls back to "all_court" when nothing distinctive is detected.
 */
export function inferRoleFromL3(rawScores: string[] | null | undefined, surface: Surface): Archetype {
  if (!rawScores || rawScores.length === 0) return "unknown";
  let totalSets = 0;
  let tiebreaks = 0;
  let highGameSets = 0; // sets summing >= 12 games (e.g. 7-6, 7-5)
  let totalGames = 0;
  let matchCount = 0;

  for (const raw of rawScores) {
    const sets = parseSets(raw);
    if (sets.length === 0) continue;
    matchCount += 1;
    let m = 0;
    for (const s of sets) {
      totalSets += 1;
      const sum = s.a + s.b;
      m += sum;
      if (sum >= 12) highGameSets += 1;
      if ((s.a === 7 && s.b === 6) || (s.a === 6 && s.b === 7)) tiebreaks += 1;
    }
    totalGames += m;
  }

  if (totalSets === 0) return "unknown";
  const tbRate = tiebreaks / totalSets;
  const highRate = highGameSets / totalSets;
  const avgMatchGames = totalGames / Math.max(1, matchCount);

  if (tbRate >= 0.34 || highRate >= 0.6) return "big_server";
  if (surface === "clay" && avgMatchGames >= 26) return "clay_grinder";
  if (avgMatchGames >= 26) return "counter_puncher";
  return "all_court";
}

/**
 * Build a PlayerRole purely from heuristic inference.
 */
export function heuristicRole(playerName: string, slug: string, archetype: Archetype): PlayerRole {
  return {
    player_slug: slug,
    player_name: playerName,
    archetype,
    serve_tier: archetype === "big_server" ? "elite" : "avg",
    clay_score: archetype === "clay_grinder" ? 0.75 : 0.5,
    grass_score: archetype === "big_server" || archetype === "serve_and_volleyer" ? 0.7 : 0.5,
    hard_score: 0.6,
    notes: "inferred from L3",
    source: "heuristic",
  };
}