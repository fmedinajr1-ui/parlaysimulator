// ============================================================================
// strategies.ts — Direct port of strategies.py
// 8 strategy playbooks + helpers + registry
// ============================================================================

import * as config from "./config.ts";
import {
  CandidateLeg,
  Parlay,
  decimalOdds,
  fingerprint,
  legPropKey,
  signalNorm,
} from "./models.ts";
import { legQualityScore, rankLegs } from "./scoring.ts";

export type StrategyFn = (
  candidates: CandidateLeg[],
  slot: config.StrategySlot,
) => Parlay | null;

// ---------- Deterministic RNG (mulberry32) ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromLegs(legs: CandidateLeg[]): number {
  let h = 2166136261 >>> 0;
  for (const l of legs) {
    const fp = fingerprint(l);
    for (let i = 0; i < fp.length; i++) {
      h ^= fp.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

function sampleK<T>(arr: T[], k: number, rand: () => number): T[] {
  // Reservoir-style: copy + Fisher-Yates partial shuffle
  const a = arr.slice();
  const n = a.length;
  const out: T[] = [];
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rand() * (n - i));
    [a[i], a[j]] = [a[j], a[i]];
    out.push(a[i]);
  }
  return out;
}

// ---------- Combo helpers ----------

function combineMeetsBand(combo: CandidateLeg[], band_key: string): boolean {
  const band = config.ODDS_BANDS[band_key];
  let d = 1.0;
  for (const l of combo) d *= decimalOdds(l);
  const combinedAmerican = d >= 2.0
    ? Math.round((d - 1.0) * 100)
    : Math.round(-100.0 / (d - 1.0));
  return band.min_odds <= combinedAmerican && combinedAmerican <= band.max_odds;
}

export function bestComboToBand(
  legs: CandidateLeg[],
  leg_count: number,
  band_key: string,
  max_tries = 200,
): CandidateLeg[] | null {
  if (legs.length < leg_count) return null;

  const ranked = rankLegs(legs);
  const top_n = ranked.slice(0, leg_count);
  if (combineMeetsBand(top_n, band_key)) return top_n;

  const pool = ranked.slice(0, Math.max(leg_count * 4, 12));
  let best_in_band: CandidateLeg[] | null = null;
  let best_in_band_score = -Infinity;
  let best_overall = top_n;
  let best_overall_score = top_n.reduce((s, l) => s + legQualityScore(l), 0);

  const rand = mulberry32(seedFromLegs(pool));
  for (let i = 0; i < max_tries; i++) {
    const combo = sampleK(pool, leg_count, rand);
    const score = combo.reduce((s, l) => s + legQualityScore(l), 0);
    if (combineMeetsBand(combo, band_key)) {
      if (score > best_in_band_score) {
        best_in_band = combo;
        best_in_band_score = score;
      }
    }
    if (score > best_overall_score) {
      best_overall = combo;
      best_overall_score = score;
    }
  }

  return best_in_band ?? best_overall;
}

export function uniquePlayers(legs: CandidateLeg[]): boolean {
  const names = legs.filter(l => l.player_name).map(l => l.player_name as string);
  return names.length === new Set(names).size;
}

function build(slot: config.StrategySlot, legs: CandidateLeg[], rationale: string): Parlay | null {
  if (!legs || legs.length === 0 || !uniquePlayers(legs)) return null;
  const baseStake = config.STAKE_BY_TIER[slot.tier];
  const avgConf = legs.reduce((s, l) => s + l.confidence, 0) / legs.length;
  const stake = baseStake * config.stakeMultiplier(avgConf);
  if (stake <= 0) return null;
  return {
    strategy: slot.name,
    tier: slot.tier,
    legs,
    stake_units: Math.round(stake * 1000) / 1000,
    rationale,
    generated_at: new Date(),
  };
}

// ---------- Strategy playbooks ----------

export const mispricedEdge: StrategyFn = (candidates, slot) => {
  const nba = candidates.filter(l =>
    l.sport === "NBA" && l.confidence >= 0.70 && (legPropKey(l) in config.PROP_WHITELIST)
  );
  const combo = bestComboToBand(nba, slot.target_leg_count, slot.odds_band);
  if (!combo) return null;
  const avg = combo.reduce((s, l) => s + l.confidence, 0) / combo.length;
  return build(slot, combo,
    `mispriced_edge: ${slot.target_leg_count}-leg NBA whitelist, avg conf ${avg.toFixed(2)}`);
};

export const grindStack: StrategyFn = (candidates, slot) => {
  const eligible = candidates.filter(l => {
    const sig = signalNorm(l);
    return l.sport === "NBA"
      && (config.SIGNAL_TIER_S.has(sig) || config.SIGNAL_TIER_A.has(sig))
      && l.confidence >= 0.68;
  });
  const combo = bestComboToBand(eligible, slot.target_leg_count, slot.odds_band);
  if (!combo) return null;
  return build(slot, combo, "grind_stack: S/A-tier signals, FAT_PITCH target");
};

export const crossSport: StrategyFn = (candidates, slot) => {
  const bySport = new Map<string, CandidateLeg[]>();
  for (const l of candidates) {
    if (l.confidence < 0.68) continue;
    if (!bySport.has(l.sport)) bySport.set(l.sport, []);
    bySport.get(l.sport)!.push(l);
  }
  if (bySport.size < 2) return null;

  const sportsSorted = Array.from(bySport.entries())
    .sort((a, b) => {
      const ma = Math.max(...a[1].map(legQualityScore));
      const mb = Math.max(...b[1].map(legQualityScore));
      return mb - ma;
    });

  const combo: CandidateLeg[] = [];
  const used = new Set<string>();
  for (const [sport, legs] of sportsSorted) {
    if (combo.length >= slot.target_leg_count) break;
    combo.push(rankLegs(legs)[0]);
    used.add(sport);
  }

  if (combo.length < slot.target_leg_count) {
    const usedFps = new Set(combo.map(fingerprint));
    const pad = rankLegs(candidates.filter(l =>
      l.confidence >= 0.68 && !usedFps.has(fingerprint(l))
    ));
    for (const l of pad) {
      if (combo.length >= slot.target_leg_count) break;
      combo.push(l);
    }
  }

  if (combo.length < slot.target_leg_count || used.size < 2) return null;
  return build(slot, combo, `cross_sport: ${Array.from(used).sort().join(",")}`);
};

export const doubleConfirmed: StrategyFn = (candidates, slot) => {
  const eligible = candidates.filter(l => {
    if (l.sport !== "NBA" || l.confidence < 0.72) return false;
    const sig = signalNorm(l);
    return config.SIGNAL_TIER_S.has(sig) || (legPropKey(l) in config.PROP_WHITELIST);
  });
  const combo = bestComboToBand(eligible, slot.target_leg_count, slot.odds_band);
  if (!combo) return null;
  return build(slot, combo, "double_confirmed: S-tier OR whitelist prop, conf>=0.72");
};

export const optimalCombo: StrategyFn = (candidates, slot) => {
  const eligible = candidates.filter(l =>
    l.confidence >= 0.70 && !config.SIGNAL_BLACKLIST.has(signalNorm(l))
  );
  const combo = bestComboToBand(eligible, slot.target_leg_count, slot.odds_band);
  if (!combo) return null;
  return build(slot, combo, "optimal_combo: 4-leg stretch into 1200–2500");
};

export const shootoutStack: StrategyFn = (candidates, slot) => {
  const hot = new Set(["Points|OVER", "3PM|OVER", "Assists|OVER", "R+A|OVER"]);
  const eligible = candidates.filter(l =>
    l.sport === "NBA" && hot.has(legPropKey(l)) && l.confidence >= 0.68
  );
  const combo = bestComboToBand(eligible, slot.target_leg_count, slot.odds_band);
  if (!combo) return null;
  return build(slot, combo, "shootout_stack: pace-up OVERs");
};

export const roleStackedLongshot: StrategyFn = (candidates, slot) => {
  const eligible = candidates.filter(l => {
    const sig = signalNorm(l);
    return (config.SIGNAL_TIER_S.has(sig) || config.SIGNAL_TIER_A.has(sig))
      && l.confidence >= 0.68;
  });
  if (eligible.length < slot.target_leg_count) return null;
  const top = rankLegs(eligible).slice(0, slot.target_leg_count);
  if (!uniquePlayers(top)) return null;
  return build(slot, top, "role_stacked_longshot: 8-leg S/A stack");
};

export const megaLotteryScanner: StrategyFn = (candidates, slot) => {
  const eligible = candidates.filter(l =>
    l.confidence >= 0.66 && !config.SIGNAL_BLACKLIST.has(signalNorm(l))
  );
  const combo = bestComboToBand(eligible, slot.target_leg_count, slot.odds_band);
  if (!combo) return null;
  return build(slot, combo, "mega_lottery: 4-leg UPSIDE (2500–5000)");
};

// ---------- Registry ----------

export const STRATEGY_REGISTRY: Record<string, StrategyFn> = {
  mispriced_edge:        mispricedEdge,
  grind_stack:           grindStack,
  cross_sport:           crossSport,
  double_confirmed:      doubleConfirmed,
  optimal_combo:         optimalCombo,
  shootout_stack:        shootoutStack,
  role_stacked_longshot: roleStackedLongshot,
  mega_lottery_scanner:  megaLotteryScanner,
};

export function getStrategy(name: string): StrategyFn {
  const fn = STRATEGY_REGISTRY[name];
  if (!fn) throw new Error(`Unknown strategy: ${name}. Available: ${Object.keys(STRATEGY_REGISTRY).join(", ")}`);
  return fn;
}