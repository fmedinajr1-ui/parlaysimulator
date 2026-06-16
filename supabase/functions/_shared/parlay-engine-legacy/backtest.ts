// ============================================================================
// backtest.ts — Direct port of backtest.py
// Replays historical parlays through v2 leg/parlay gates + ExposureTracker.
// ============================================================================

import * as config from "./config.ts";
import {
  CandidateLeg,
  Parlay,
  combinedAmericanOdds,
  combinedDecimalOdds,
  comboHash,
  legPropKey,
  signalNorm,
} from "./models.ts";
import {
  validateLeg,
  validateParlay,
} from "./filters.ts";
import { ExposureTracker } from "./dedup.ts";

// ---------- Types ----------

export interface HistoricalParlay {
  id: string;
  parlay_date: string;            // YYYY-MM-DD
  created_at: string;
  strategy_name: string;
  tier: string | null;
  legs: CandidateLeg[];           // already mapped from jsonb
  outcome: "won" | "lost" | "void" | "pending" | string;
  simulated_stake: number;
  expected_odds: number;          // combined American
  combined_probability: number;
}

export interface BacktestOptions {
  strict_void_mode?: boolean;          // default true
  strict_confidence_mode?: boolean;    // default false
  apply_exposure_caps?: boolean;       // default true
}

export interface SegmentMetrics {
  resolved: number;
  won: number;
  lost: number;
  void: number;
  wr: number;
  stake: number;
  profit: number;
  roi: number;
  void_rate: number;
}

export interface BacktestReport {
  date_range: { start: string; end: string };
  total_parlays_in: number;
  v1_actual: SegmentMetrics;
  v2_shipped: SegmentMetrics & { volume_pct: number };
  rejected_count: number;
  profit_foregone: number;            // rejected winners we missed
  loss_avoided: number;               // rejected losers we dodged
  rejection_reasons: Record<string, number>;
  top_strategies_v1: Array<{ strategy: string; profit: number; n: number }>;
  top_strategies_v2: Array<{ strategy: string; profit: number; n: number }>;
  same_game_breakdown: Record<string, number>;  // bucket counts
  options_used: Required<BacktestOptions>;
}

// ---------- Helpers ----------

function americanProfit(stake: number, american: number, outcome: string): number {
  if (outcome === "won") {
    if (american > 0) return stake * (american / 100);
    return stake * (100 / Math.abs(american));
  }
  if (outcome === "lost") return -stake;
  return 0; // void / pending
}

function emptySegment(): SegmentMetrics {
  return { resolved: 0, won: 0, lost: 0, void: 0, wr: 0, stake: 0, profit: 0, roi: 0, void_rate: 0 };
}

function finalizeSegment(s: SegmentMetrics): SegmentMetrics {
  const total = s.resolved + s.void;
  s.wr = s.resolved > 0 ? s.won / s.resolved : 0;
  s.roi = s.stake > 0 ? s.profit / s.stake : 0;
  s.void_rate = total > 0 ? s.void / total : 0;
  return s;
}

function topStrategies(
  byStrat: Map<string, { profit: number; n: number }>,
  k = 5,
): Array<{ strategy: string; profit: number; n: number }> {
  return Array.from(byStrat.entries())
    .map(([strategy, v]) => ({ strategy, profit: v.profit, n: v.n }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, k);
}

function sameGameBucket(legs: CandidateLeg[]): string {
  const games = new Set<string>();
  for (const l of legs) {
    const k = l.team < l.opponent ? `${l.team}|${l.opponent}` : `${l.opponent}|${l.team}`;
    games.add(k);
  }
  const ratio = games.size / Math.max(1, legs.length);
  if (games.size === 1) return "single_game";
  if (ratio < 0.5) return "concentrated";
  if (ratio < 1.0) return "mixed";
  return "fully_split";
}

// ---------- Main entry ----------

export function replayParlays(
  parlays: HistoricalParlay[],
  opts: BacktestOptions = {},
): BacktestReport {
  const options: Required<BacktestOptions> = {
    strict_void_mode: opts.strict_void_mode ?? true,
    strict_confidence_mode: opts.strict_confidence_mode ?? false,
    apply_exposure_caps: opts.apply_exposure_caps ?? true,
  };

  const v1 = emptySegment();
  const v2 = emptySegment();
  const stratV1 = new Map<string, { profit: number; n: number }>();
  const stratV2 = new Map<string, { profit: number; n: number }>();
  const rejectionReasons = new Map<string, number>();
  const sameGame = new Map<string, number>();
  let profitForegone = 0;
  let lossAvoided = 0;

  const exposure = new ExposureTracker();
  const dates = new Set<string>();

  // Sort by created_at so exposure cap simulates day order
  const sorted = parlays.slice().sort((a, b) =>
    a.parlay_date.localeCompare(b.parlay_date) ||
    a.created_at.localeCompare(b.created_at)
  );

  for (const hp of sorted) {
    dates.add(hp.parlay_date);

    // ----- v1 actual stats -----
    const profit = americanProfit(hp.simulated_stake, hp.expected_odds, hp.outcome);
    if (hp.outcome === "won" || hp.outcome === "lost") {
      v1.resolved += 1;
      if (hp.outcome === "won") v1.won += 1; else v1.lost += 1;
      v1.stake += hp.simulated_stake;
      v1.profit += profit;
    } else if (hp.outcome === "void") {
      v1.void += 1;
    }
    const sV1 = stratV1.get(hp.strategy_name) ?? { profit: 0, n: 0 };
    sV1.profit += profit; sV1.n += 1;
    stratV1.set(hp.strategy_name, sV1);

    // ----- v2 replay -----
    let rejectReason: string | null = null;

    // strict_void_mode: voids = "v2 freshness gate would have caught it"
    if (options.strict_void_mode && hp.outcome === "void") {
      rejectReason = "void_caught_by_freshness_gate";
    }

    // Leg-level filters
    if (!rejectReason) {
      const replayNow = new Date(hp.created_at);
      for (const leg of hp.legs) {
        if (options.strict_confidence_mode && (leg.confidence == null || isNaN(leg.confidence))) {
          rejectReason = "leg_missing_confidence_strict";
          break;
        }
        const [ok, why] = validateLeg(leg, replayNow);
        if (!ok) {
          rejectReason = `leg_${why}`;
          break;
        }
      }
    }

    // Build pseudo-Parlay for parlay-level gates
    const pseudo: Parlay = {
      strategy: hp.strategy_name,
      tier: (hp.tier as Parlay["tier"]) ?? "CORE",
      legs: hp.legs,
      stake_units: hp.simulated_stake,
      rationale: "backtest_replay",
      generated_at: new Date(hp.created_at),
    };

    if (!rejectReason) {
      const [ok, why] = validateParlay(pseudo);
      if (!ok) rejectReason = `parlay_${why}`;
    }

    // Exposure caps (second pass)
    if (!rejectReason && options.apply_exposure_caps) {
      const [ok, why] = exposure.canAccept(pseudo);
      if (!ok) rejectReason = `exposure_${why}`;
    }

    if (rejectReason) {
      rejectionReasons.set(rejectReason, (rejectionReasons.get(rejectReason) ?? 0) + 1);
      if (hp.outcome === "won") profitForegone += profit;
      else if (hp.outcome === "lost") lossAvoided += -profit; // positive number
      continue;
    }

    if (options.apply_exposure_caps) exposure.accept(pseudo);

    // ----- v2 accepted stats -----
    if (hp.outcome === "won" || hp.outcome === "lost") {
      v2.resolved += 1;
      if (hp.outcome === "won") v2.won += 1; else v2.lost += 1;
      v2.stake += hp.simulated_stake;
      v2.profit += profit;
    } else if (hp.outcome === "void") {
      v2.void += 1;
    }
    const sV2 = stratV2.get(hp.strategy_name) ?? { profit: 0, n: 0 };
    sV2.profit += profit; sV2.n += 1;
    stratV2.set(hp.strategy_name, sV2);

    const bucket = sameGameBucket(hp.legs);
    sameGame.set(bucket, (sameGame.get(bucket) ?? 0) + 1);
  }

  finalizeSegment(v1);
  finalizeSegment(v2);

  const v1Volume = v1.resolved + v1.void;
  const v2Volume = v2.resolved + v2.void;
  const volume_pct = v1Volume > 0 ? v2Volume / v1Volume : 0;

  // Top 10 rejection reasons
  const topReasons: Record<string, number> = {};
  Array.from(rejectionReasons.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([k, v]) => { topReasons[k] = v; });

  const sortedDates = Array.from(dates).sort();
  return {
    date_range: { start: sortedDates[0] ?? "", end: sortedDates[sortedDates.length - 1] ?? "" },
    total_parlays_in: parlays.length,
    v1_actual: v1,
    v2_shipped: { ...v2, volume_pct },
    rejected_count: parlays.length - v2Volume,
    profit_foregone: Math.round(profitForegone * 100) / 100,
    loss_avoided: Math.round(lossAvoided * 100) / 100,
    rejection_reasons: topReasons,
    top_strategies_v1: topStrategies(stratV1),
    top_strategies_v2: topStrategies(stratV2),
    same_game_breakdown: Object.fromEntries(sameGame),
    options_used: options,
  };
}
