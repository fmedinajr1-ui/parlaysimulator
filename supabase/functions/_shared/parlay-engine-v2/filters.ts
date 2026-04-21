// ============================================================================
// filters.ts — Direct port of filters.py
// Leg-level + parlay-level validation gates
// ============================================================================

import * as config from "./config.ts";
import {
  CandidateLeg,
  Parlay,
  combinedAmericanOdds,
  combinedDecimalOdds,
  combinedProbability,
  legCount,
  legPropKey,
  signalNorm,
} from "./models.ts";

export type GateResult = readonly [boolean, string];

// ---------- Leg-level gates ----------

export function legIsBettable(leg: CandidateLeg, now: Date): GateResult {
  if (!(leg.line_confirmed_on_book ?? true)) {
    return [false, "line_not_on_book"];
  }

  if (leg.player_name && leg.player_active === false) {
    return [false, "player_inactive"];
  }

  const projAgeMin = (now.getTime() - leg.projection_updated_at.getTime()) / 60_000;
  if (projAgeMin > config.VOID_GUARDS.require_fresh_projection_age_minutes) {
    return [false, `projection_stale_${Math.floor(projAgeMin)}m`];
  }

  if (leg.defensive_context_updated_at) {
    const defAgeMin = (now.getTime() - leg.defensive_context_updated_at.getTime()) / 60_000;
    if (defAgeMin > config.VOID_GUARDS.require_defensive_context_minutes) {
      return [false, `def_context_stale_${Math.floor(defAgeMin)}m`];
    }
  }

  const minsToTip = (leg.tipoff.getTime() - now.getTime()) / 60_000;
  if (minsToTip < config.VOID_GUARDS.min_minutes_before_tipoff) {
    return [false, `too_close_to_tipoff_${Math.floor(minsToTip)}m`];
  }

  return [true, "ok"];
}

export function legPassesSignalGate(leg: CandidateLeg): GateResult {
  const sig = signalNorm(leg);
  if (config.SIGNAL_BLACKLIST.has(sig)) {
    return [false, `signal_blacklisted:${sig}`];
  }
  const minConf = config.SIGNAL_TIER_S.has(sig)
    ? config.S_TIER_CONFIDENCE_OVERRIDE
    : config.MIN_LEG_CONFIDENCE;
  if (leg.confidence < minConf) {
    return [false, `confidence_below_${minConf.toFixed(2)}`];
  }
  return [true, "ok"];
}

export function legPassesPropGate(leg: CandidateLeg): GateResult {
  if (leg.sport !== "NBA") return [true, "non_nba_passthrough"];
  if (config.PROP_BLACKLIST.has(legPropKey(leg))) {
    return [false, `prop_blacklisted:${leg.prop_type}_${leg.side}`];
  }
  return [true, "ok"];
}

export function validateLeg(leg: CandidateLeg, now: Date): GateResult {
  const r1 = legIsBettable(leg, now);
  if (!r1[0]) return r1;
  const r2 = legPassesSignalGate(leg);
  if (!r2[0]) return r2;
  const r3 = legPassesPropGate(leg);
  if (!r3[0]) return r3;
  return [true, "ok"];
}

// ---------- Parlay-level gates ----------

export function parlayWithinOddsBand(p: Parlay): GateResult {
  const odds = combinedAmericanOdds(p);
  if (odds < config.MIN_PARLAY_ODDS) return [false, `combined_odds_${odds}_below_min`];
  if (odds > config.MAX_PARLAY_ODDS) return [false, `combined_odds_${odds}_above_max`];
  return [true, "ok"];
}

export function parlayEdgeSufficient(p: Parlay): GateResult {
  const implied = 1.0 / combinedDecimalOdds(p);
  const edge = combinedProbability(p) / implied - 1.0;
  if (edge < config.MIN_PARLAY_EDGE) return [false, `edge_${edge.toFixed(2)}_below_min`];
  return [true, "ok"];
}

export function parlayNoConflictingLegs(p: Parlay): GateResult {
  const seen = new Set<string>();
  for (const leg of p.legs) {
    const key = `${leg.player_name ?? `TEAM:${leg.team}`}|${leg.prop_type}`;
    if (seen.has(key)) return [false, `conflicting_leg:${key}`];
    seen.add(key);
  }
  return [true, "ok"];
}

export function parlayLegCountValid(p: Parlay): GateResult {
  if (!(legCount(p) in config.LEG_COUNT_ALLOCATION)) {
    return [false, `leg_count_${legCount(p)}_not_allocated`];
  }
  return [true, "ok"];
}

export function parlaySameGameConcentration(p: Parlay, max_share = 0.6): GateResult {
  const counts = new Map<string, number>();
  for (const l of p.legs) {
    const k = l.team < l.opponent ? `${l.team}|${l.opponent}` : `${l.opponent}|${l.team}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const top = Math.max(...counts.values());
  const share = top / legCount(p);
  if (share > max_share) return [false, `same_game_share_${share.toFixed(2)}`];
  return [true, "ok"];
}

export function validateParlay(p: Parlay): GateResult {
  const gates: Array<(p: Parlay) => GateResult> = [
    parlayLegCountValid,
    parlayWithinOddsBand,
    parlayNoConflictingLegs,
    parlaySameGameConcentration,
    parlayEdgeSufficient,
  ];
  for (const g of gates) {
    const r = g(p);
    if (!r[0]) return r;
  }
  return [true, "ok"];
}