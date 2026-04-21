// ============================================================================
// config.ts — Direct port of config.py
// All thresholds, allocations, whitelists, blacklists, and tier definitions
// for Parlay Engine v2. Values preserved exactly from Python source.
// ============================================================================

// ---------------------------------------------------------------------------
// GLOBAL BANKROLL / OUTPUT SHAPE
// ---------------------------------------------------------------------------

export const DAILY_BANKROLL_UNITS = 100.0;
export const MAX_PARLAYS_PER_DAY = 40;
export const MIN_PARLAYS_PER_DAY = 8;
export const TARGET_PARLAYS_PER_DAY = 20;

// ---------------------------------------------------------------------------
// LEG-COUNT ALLOCATION
// ---------------------------------------------------------------------------

export const LEG_COUNT_ALLOCATION: Record<number, number> = {
  3: 0.55,
  4: 0.20,
  5: 0.12,
  6: 0.07,
  8: 0.06,
};

// ---------------------------------------------------------------------------
// ODDS BANDS
// ---------------------------------------------------------------------------

export interface OddsBand {
  min_odds: number;
  max_odds: number;
  target_weight: number;
}

export const ODDS_BANDS: Record<string, OddsBand> = {
  CORE:      { min_odds: 300,   max_odds: 800,   target_weight: 0.35 },
  FAT_PITCH: { min_odds: 800,   max_odds: 1200,  target_weight: 0.30 },
  STRETCH:   { min_odds: 1200,  max_odds: 2500,  target_weight: 0.15 },
  UPSIDE:    { min_odds: 2500,  max_odds: 5000,  target_weight: 0.12 },
  LOTTERY:   { min_odds: 5000,  max_odds: 25000, target_weight: 0.08 },
};

export const MIN_PARLAY_ODDS = 300;
export const MAX_PARLAY_ODDS = 25000;

// ---------------------------------------------------------------------------
// STRATEGY TIERING
// ---------------------------------------------------------------------------

export type Tier = "CORE" | "EDGE" | "LOTTERY";

export interface StrategySlot {
  name: string;
  tier: Tier;
  target_leg_count: number;
  odds_band: string;
  daily_share: number;
}

export const ACTIVE_STRATEGIES: StrategySlot[] = [
  { name: "mispriced_edge",        tier: "CORE",    target_leg_count: 3, odds_band: "CORE",      daily_share: 0.28 },
  { name: "grind_stack",           tier: "CORE",    target_leg_count: 3, odds_band: "FAT_PITCH", daily_share: 0.22 },
  { name: "cross_sport",           tier: "CORE",    target_leg_count: 3, odds_band: "CORE",      daily_share: 0.10 },
  { name: "double_confirmed",      tier: "EDGE",    target_leg_count: 4, odds_band: "FAT_PITCH", daily_share: 0.12 },
  { name: "optimal_combo",         tier: "EDGE",    target_leg_count: 4, odds_band: "STRETCH",   daily_share: 0.10 },
  { name: "shootout_stack",        tier: "EDGE",    target_leg_count: 3, odds_band: "CORE",      daily_share: 0.08 },
  { name: "role_stacked_longshot", tier: "LOTTERY", target_leg_count: 8, odds_band: "LOTTERY",   daily_share: 0.06 },
  { name: "mega_lottery_scanner",  tier: "LOTTERY", target_leg_count: 4, odds_band: "UPSIDE",    daily_share: 0.04 },
];

export const KILLED_STRATEGIES: Set<string> = new Set([
  "cash_lock_exploration_cross_sport",
  "cash_lock_exploration_mispriced_edge",
  "cash_lock_validation_*",
  "max_boost_execution_nba_3pt_focus",
  "max_boost_execution_nba_under_specialist",
  "elite_categories_v1_execution_sweet_spot_core",
  "elite_categories_v1_validation_validated_conservative",
  "premium_boost_execution_hot_streak_lock",
  "sweet_spot_l3",
  "manual_curated",
  "ladder_challenge",
]);

// ---------------------------------------------------------------------------
// SIGNAL SOURCE TIERS
// ---------------------------------------------------------------------------

export const SIGNAL_TIER_S: Set<string> = new Set([
  "ASSISTS",
  "STEALS",
  "STAR_FLOOR_OVER",
]);

export const SIGNAL_TIER_A: Set<string> = new Set([
  "VOLUME_SCORER",
  "BIG_REBOUNDER",
  "BLOCKS",
  "THREE_POINT_SHOOTER",
]);

export const SIGNAL_TIER_B: Set<string> = new Set([
  "MID_SCORER_UNDER",
  "ROLE_PLAYER_REB",
  "HIGH_ASSIST",
]);

export const SIGNAL_WATCHLIST: Set<string> = new Set([
  "SHARP_SPREAD",
  "NBA_POINTS",
  "MLB_PITCHER_K_OVER",
  "NHL_POINTS",
  "OVER_TOTAL",
  "ML_FAVORITE",
]);

export const SIGNAL_BLACKLIST: Set<string> = new Set([
  "THREES",
]);

// ---------------------------------------------------------------------------
// PROP WHITELIST / BLACKLIST (NBA)
// ---------------------------------------------------------------------------

/** Key format: `${prop_type}|${side}` */
export const PROP_WHITELIST: Record<string, number> = {
  "R+A|OVER":      0.911,
  "Steals|OVER":   0.779,
  "Blocks|UNDER":  0.733,
  "3PM|UNDER":     0.685,
  "Assists|OVER":  0.675,
  "Points|OVER":   0.640,
  "Points|UNDER":  0.607,
  "Blocks|OVER":   0.581,
  "3PM|OVER":      0.549,
  "Rebounds|OVER": 0.535,
};

export const PROP_BLACKLIST: Set<string> = new Set([
  "Assists|UNDER",
  "Rebounds|UNDER",
  "PRA|UNDER",
]);

export function propKey(prop_type: string, side: string): string {
  return `${prop_type}|${side}`;
}

// ---------------------------------------------------------------------------
// CONFIDENCE & EDGE GATES
// ---------------------------------------------------------------------------

export const MIN_LEG_CONFIDENCE = 0.65;
export const PREFERRED_LEG_CONFIDENCE = 0.72;
export const S_TIER_CONFIDENCE_OVERRIDE = 0.60;
export const MIN_PARLAY_EDGE = 0.15;

// ---------------------------------------------------------------------------
// DUPLICATION / EXPOSURE CONTROLS
// ---------------------------------------------------------------------------

export const MAX_DAILY_DUPLICATION_RATIO = 0.05;
export const MAX_SAME_PLAYER_EXPOSURE = 4;
export const MAX_SAME_GAME_EXPOSURE = 8;
export const MAX_SAME_COMBO_HASH_REPEATS = 1;

// ---------------------------------------------------------------------------
// VOID GUARDS
// ---------------------------------------------------------------------------

export const VOID_GUARDS = {
  require_fresh_projection_age_minutes: 120,
  require_line_confirmed_on_book: true,
  require_player_active_today: true,
  require_defensive_context_minutes: 60,
  min_minutes_before_tipoff: 30,
  enforce_exposure_pre_build: true,
};

// ---------------------------------------------------------------------------
// STAKE SIZING
// ---------------------------------------------------------------------------

export const STAKE_BY_TIER: Record<Tier, number> = {
  CORE:    1.00,
  EDGE:    0.75,
  LOTTERY: 0.25,
};

/** Kelly-lite: scale stake by confidence vs threshold. */
export function stakeMultiplier(avg_leg_confidence: number): number {
  if (avg_leg_confidence < MIN_LEG_CONFIDENCE) return 0.0;
  const raw = 1.0 + (avg_leg_confidence - MIN_LEG_CONFIDENCE) * 3.33;
  return Math.min(2.0, Math.max(0.5, raw));
}

// ---------------------------------------------------------------------------
// SPORT CONCENTRATION
// ---------------------------------------------------------------------------

export const SPORT_ALLOCATION: Record<string, number> = {
  NBA:         0.80,
  NHL:         0.05,
  MLB:         0.04,
  NCAAB:       0.06,
  CROSS_SPORT: 0.05,
};

// ---------------------------------------------------------------------------
// STAKE SIZING MODE (v2.5)
// ---------------------------------------------------------------------------

export type StakeSizingMode = "flat" | "kelly_lite" | "fractional_kelly";
export const STAKE_SIZING_MODE: StakeSizingMode = "kelly_lite";
export const KELLY_FRACTION = 0.25;

// ---------------------------------------------------------------------------
// REAL BOOK LINE GATES (v2.6 / Phase D)
// ---------------------------------------------------------------------------

/** Bookmaker priority — first match wins when multiple books quote the same prop. */
export const BOOKMAKER_PRIORITY: string[] = ["fanduel", "draftkings", "betmgm"];

/** Reject candidate legs whose unified_props.odds_updated_at is older than this.
 * TEMP (2026-04-21): widened from 20 → 360 so tonight's slate can ship while the
 * refresher is being patched. Revert to 20 once refresh-todays-props writes
 * player_*-prefixed prop_types and the morning cron repopulates fresh lines. */
export const MAX_BOOK_LINE_AGE_MIN = 360;

/** Reject candidate legs whose pool line drifts from the book's current_line by more than this. */
export const MAX_LINE_DRIFT = 0.5;

/** Short tag rendered in Telegram messages, e.g. "[FD]". */
export const BOOK_TAG: Record<string, string> = {
  fanduel: "FD",
  draftkings: "DK",
  betmgm: "MGM",
};

// ---------------------------------------------------------------------------
// SWEEP PRESETS (v2.5)
// ---------------------------------------------------------------------------

export interface ConfigOverride {
  MIN_LEG_CONFIDENCE?: number;
  PREFERRED_LEG_CONFIDENCE?: number;
  MIN_PARLAY_ODDS?: number;
  MAX_PARLAY_ODDS?: number;
  MIN_PARLAY_EDGE?: number;
  STAKE_SIZING_MODE?: StakeSizingMode;
  KELLY_FRACTION?: number;
  TARGET_PARLAYS_PER_DAY?: number;
}

export const PRESETS: Record<string, ConfigOverride> = {
  "v2.2": {
    MIN_LEG_CONFIDENCE: 0.65,
    MIN_PARLAY_ODDS: 300,
    STAKE_SIZING_MODE: "kelly_lite",
  },
  "v2.3-balanced": {
    MIN_LEG_CONFIDENCE: 0.65,
    MIN_PARLAY_ODDS: 500,
    STAKE_SIZING_MODE: "fractional_kelly",
  },
  "v2.3-max-ROI": {
    MIN_LEG_CONFIDENCE: 0.75,
    MIN_PARLAY_ODDS: 500,
    STAKE_SIZING_MODE: "fractional_kelly",
  },
  "live": {},
};

/** Apply an override on top of base config values, returning a resolved view. */
export function resolveConfig(override?: ConfigOverride) {
  return {
    MIN_LEG_CONFIDENCE: override?.MIN_LEG_CONFIDENCE ?? MIN_LEG_CONFIDENCE,
    PREFERRED_LEG_CONFIDENCE: override?.PREFERRED_LEG_CONFIDENCE ?? PREFERRED_LEG_CONFIDENCE,
    MIN_PARLAY_ODDS: override?.MIN_PARLAY_ODDS ?? MIN_PARLAY_ODDS,
    MAX_PARLAY_ODDS: override?.MAX_PARLAY_ODDS ?? MAX_PARLAY_ODDS,
    MIN_PARLAY_EDGE: override?.MIN_PARLAY_EDGE ?? MIN_PARLAY_EDGE,
    STAKE_SIZING_MODE: override?.STAKE_SIZING_MODE ?? STAKE_SIZING_MODE,
    KELLY_FRACTION: override?.KELLY_FRACTION ?? KELLY_FRACTION,
    TARGET_PARLAYS_PER_DAY: override?.TARGET_PARLAYS_PER_DAY ?? TARGET_PARLAYS_PER_DAY,
  };
}