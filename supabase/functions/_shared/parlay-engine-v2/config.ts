import type { SignalTier, TicketTier } from "./models.ts";

export const MIN_LEG_CONFIDENCE = 0.60;
export const PREFERRED_FLOOR = 0.68;
export const MIN_PARLAY_EDGE = 0.15;
export const MIN_OVER_L10_HIT_RATE = 0.55;
export const THIN_SAMPLE_GAMES = 5;
export const MIN_DISTINCT_GAMES = 2;
export const MAX_SAME_GAME_SHARE = 0.75;
export const MAX_TEAM_LEGS_PER_GAME = 1;
export const MAX_TEAM_LEG_SHARE_FOR_3_PLUS = 0.40;
export const MIN_COMBINED_AMERICAN_ODDS = 300;
export const MAX_COMBINED_AMERICAN_ODDS = 25000;

export const SIGNAL_TIER_MULT: Record<SignalTier, number> = {
  S: 1.25,
  A: 1.10,
  B: 1.00,
  Watch: 1.05,
  Unknown: 0.90,
};

export const STAKE_BY_TIER: Record<TicketTier, number> = {
  CORE: 1.00,
  EDGE: 0.75,
  LOTTERY: 0.25,
};

export const NBA_PROP_WHITELIST: Record<string, number> = {
  "points:over": 0.85,
  "points:under": 0.70,
  "rebounds:over": 0.80,
  "rebounds:under": 0.75,
  "assists:over": 0.82,
  "assists:under": 0.76,
  "pra:over": 0.72,
  "pr:over": 0.72,
  "ra:over": 0.72,
  "threes:over": 0.65,
  "blocks:over": 0.58,
  "steals:over": 0.58,
};

export const STRATEGY_COUNTS = {
  lock_2: 8,
  strong_3: 8,
  stretch_4: 6,
  lottery_5: 3,
} as const;

// ---- Sport allowlist (project-wide) -----------------------------------------
// Only these sports are eligible to enter the parlay/straight-bet pool.
// Soccer is intentionally limited to FIFA World Cup (and the long-shot winner
// market) — other competitions (Brazil Serie A/B, Copa Libertadores, etc.)
// are dropped. Tennis is allowed across all tours via the prefix check.
export const ALLOWED_SPORTS: ReadonlySet<string> = new Set([
  "baseball_mlb",
  "basketball_wnba",
  "soccer_fifa_world_cup",
  "soccer_fifa_world_cup_winner",
  // normalized variants that may appear after .toUpperCase() pipelines
  "mlb",
  "wnba",
]);
export const ALLOWED_SPORT_PREFIXES: readonly string[] = ["tennis_"];

export function isAllowedSport(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const s = String(raw).toLowerCase();
  if (ALLOWED_SPORTS.has(s)) return true;
  return ALLOWED_SPORT_PREFIXES.some((p) => s.startsWith(p));
}
