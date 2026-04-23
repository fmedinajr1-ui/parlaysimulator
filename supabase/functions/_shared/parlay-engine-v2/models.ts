// ============================================================================
// models.ts — Direct port of models.py
// CandidateLeg, Parlay, GenerationReport + helpers
// ============================================================================

import { propKey } from "./config.ts";

export interface CandidateLeg {
  sport: string;                              // "NBA" | "MLB" | "NHL" | "NCAAB"
  player_name: string | null;                 // null for team/game props
  team: string;
  opponent: string;
  prop_type: string;
  side: string;                               // "OVER" | "UNDER" | "WIN" | ...
  line: number;
  american_odds: number;
  projected: number;
  confidence: number;                         // 0.0–1.0
  edge: number;
  signal_source: string;
  tipoff: Date;
  projection_updated_at: Date;
  line_confirmed_on_book?: boolean;
  player_active?: boolean;
  defensive_context_updated_at?: Date | null;
  /** v2.6: which bookmaker the line + price came from (e.g. "fanduel"). */
  selected_book?: string | null;
  /** Origin of the underlying pick row: "risk" | "fallback" | "raw_props". */
  source_origin?: string | null;
}

// ---------- Leg helpers ----------

export function decimalOdds(leg: CandidateLeg): number {
  if (leg.american_odds > 0) return 1.0 + leg.american_odds / 100.0;
  return 1.0 + 100.0 / Math.abs(leg.american_odds);
}

export function impliedProb(leg: CandidateLeg): number {
  if (leg.american_odds > 0) return 100.0 / (leg.american_odds + 100.0);
  return Math.abs(leg.american_odds) / (Math.abs(leg.american_odds) + 100.0);
}

export function legPropKey(leg: CandidateLeg): string {
  return propKey(leg.prop_type, leg.side);
}

export function signalNorm(leg: CandidateLeg): string {
  return (leg.signal_source || "").toUpperCase();
}

/** Stable short hash from player+prop+side+line. Uses simple FNV-1a hex. */
export function fingerprint(leg: CandidateLeg): string {
  const key = `${leg.sport}|${leg.player_name ?? leg.team}|${leg.prop_type}|${leg.side}|${leg.line}`;
  return md5Like(key).slice(0, 10);
}

// ---------- Parlay ----------

export interface Parlay {
  strategy: string;
  tier: "CORE" | "EDGE" | "LOTTERY";
  legs: CandidateLeg[];
  stake_units: number;
  rationale: string;
  generated_at: Date;
  /** v2.5: filled when a CorrelationModel is supplied to the engine. */
  adjusted_combined_probability?: number | null;
  /** v2.5: same-game pairs whose lift fell below the negative threshold. */
  correlation_warnings?: Array<{ pair: string; lift: number; same_game: boolean }>;
}

export function legCount(p: Parlay): number {
  return p.legs.length;
}

export function combinedDecimalOdds(p: Parlay): number {
  let odds = 1.0;
  for (const leg of p.legs) odds *= decimalOdds(leg);
  return odds;
}

export function combinedAmericanOdds(p: Parlay): number {
  const d = combinedDecimalOdds(p);
  if (d >= 2.0) return Math.round((d - 1.0) * 100);
  return Math.round(-100.0 / (d - 1.0));
}

export function combinedProbability(p: Parlay): number {
  let prob = 1.0;
  for (const leg of p.legs) prob *= leg.confidence;
  return prob;
}

export function expectedValueUnits(p: Parlay): number {
  const prob = combinedProbability(p);
  const payout = p.stake_units * (combinedDecimalOdds(p) - 1.0);
  return prob * payout - (1.0 - prob) * p.stake_units;
}

export function avgLegConfidence(p: Parlay): number {
  return p.legs.reduce((s, l) => s + l.confidence, 0) / p.legs.length;
}

export function sportsPresent(p: Parlay): string[] {
  return Array.from(new Set(p.legs.map(l => l.sport))).sort();
}

export function sportMixKey(p: Parlay): string {
  return sportsPresent(p).join(",");
}

/** Order-independent hash of leg fingerprints. */
export function comboHash(p: Parlay): string {
  const prints = p.legs.map(fingerprint).sort();
  return md5Like(prints.join("|")).slice(0, 12);
}

// ---------- Report ----------

export interface GenerationReport {
  run_date: string;
  total_candidates_in: number;
  candidates_kept: number;
  candidates_rejected: number;
  parlays_built: number;
  parlays_rejected_by_filter: number;
  unique_combos: number;
  duplicates_skipped: number;
  strategy_breakdown: Record<string, number>;
  tier_breakdown: Record<string, number>;
  rejection_reasons: Record<string, number>;
}

// ---------- Hash helper ----------
// Lightweight non-crypto hash producing a hex digest. Good enough for
// fingerprints/combo identity; we don't need MD5's properties.
function md5Like(input: string): string {
  // 64-bit FNV-1a, then expand to 32 hex chars by mixing.
  let h1 = 0xcbf29ce4n; let h2 = 0x84222325n;
  const PRIME = 0x100000001b3n;
  const bytes = new TextEncoder().encode(input);
  for (const b of bytes) {
    h1 = BigInt.asUintN(64, (h1 ^ BigInt(b)) * PRIME);
    h2 = BigInt.asUintN(64, (h2 ^ BigInt((b * 131) & 0xff)) * PRIME);
  }
  const a = h1.toString(16).padStart(16, "0");
  const b = h2.toString(16).padStart(16, "0");
  return (a + b).slice(0, 32);
}