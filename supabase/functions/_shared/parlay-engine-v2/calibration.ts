// ============================================================================
// calibration.ts — Direct port of calibration.py
// Advisory report: never mutates config.ts
// ============================================================================

import * as config from "./config.ts";
import { CandidateLeg, legPropKey, signalNorm } from "./models.ts";
import { HistoricalParlay } from "./backtest.ts";

const MIN_N_SIGNAL = 50;
const MIN_N_PROP = 20;
const MIN_N_STRATEGY = 15;
const MIN_N_DRIFT_MONTH = 20;
const DRIFT_THRESHOLD = 0.10;
const SHARE_NUDGE_PCT = 0.03;

export interface TierChange {
  signal: string;
  current_tier: "S" | "A" | "B" | "WATCHLIST" | "BLACKLIST" | "UNKNOWN";
  observed_hit_rate: number;
  n: number;
  recommended_tier: "S" | "A" | "B" | "WATCHLIST" | "BLACKLIST";
  reason: string;
}

export interface DriftWarning {
  signal: string;
  earlier_period: { month: string; hit_rate: number; n: number };
  later_period: { month: string; hit_rate: number; n: number };
  delta: number;
}

export interface PropCrossing {
  prop_key: string;       // "Points|OVER"
  current: "WHITELIST" | "BLACKLIST" | "NONE";
  observed_hit_rate: number;
  n: number;
  recommended: "WHITELIST" | "BLACKLIST" | "REVIEW";
}

export interface KillCandidate {
  strategy: string;
  n: number;
  net_profit: number;
  win_rate: number;
}

export interface ShareNudge {
  strategy: string;
  current_share: number;
  observed_roi: number;
  recommended_share: number;
  delta: number;
}

export interface CalibrationReport {
  generated_at: string;
  total_parlays: number;
  total_legs: number;
  tier_changes: TierChange[];
  drift_warnings: DriftWarning[];
  prop_crossings: PropCrossing[];
  kill_candidates: KillCandidate[];
  share_nudges: ShareNudge[];
}

// ---------- Helpers ----------

function currentTier(sig: string): TierChange["current_tier"] {
  if (config.SIGNAL_TIER_S.has(sig)) return "S";
  if (config.SIGNAL_TIER_A.has(sig)) return "A";
  if (config.SIGNAL_TIER_B.has(sig)) return "B";
  if (config.SIGNAL_WATCHLIST.has(sig)) return "WATCHLIST";
  if (config.SIGNAL_BLACKLIST.has(sig)) return "BLACKLIST";
  return "UNKNOWN";
}

function recommendTier(rate: number): TierChange["recommended_tier"] {
  if (rate >= 0.75) return "S";
  if (rate >= 0.65) return "A";
  if (rate >= 0.55) return "B";
  if (rate >= 0.50) return "WATCHLIST";
  return "BLACKLIST";
}

function americanProfit(stake: number, american: number, outcome: string): number {
  if (outcome === "won") {
    if (american > 0) return stake * (american / 100);
    return stake * (100 / Math.abs(american));
  }
  if (outcome === "lost") return -stake;
  return 0;
}

function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM
}

// ---------- Main ----------

export function calibrate(parlays: HistoricalParlay[]): CalibrationReport {
  // Per-leg outcomes derived from parent parlay outcome.
  // (Historical legs don't have per-leg outcomes; we use parlay outcome
  // as a proxy: a parlay won → all legs hit; parlay lost → at least one missed.
  // We fall back to that approximation, matching the Python behavior.)

  // Signal-level counters
  const sigStats = new Map<string, { hits: number; n: number }>();
  // Signal × month
  const sigMonth = new Map<string, Map<string, { hits: number; n: number }>>();
  // Prop key (NBA only) counters
  const propStats = new Map<string, { hits: number; n: number }>();
  // Strategy-level counters
  const stratStats = new Map<string, { profit: number; stake: number; n: number; wins: number }>();

  let totalLegs = 0;

  for (const p of parlays) {
    if (p.outcome !== "won" && p.outcome !== "lost") continue;
    const parlayHit = p.outcome === "won";
    const m = monthOf(p.parlay_date);

    // Strategy
    const profit = americanProfit(p.simulated_stake, p.expected_odds, p.outcome);
    const ss = stratStats.get(p.strategy_name) ?? { profit: 0, stake: 0, n: 0, wins: 0 };
    ss.profit += profit; ss.stake += p.simulated_stake; ss.n += 1;
    if (parlayHit) ss.wins += 1;
    stratStats.set(p.strategy_name, ss);

    for (const leg of p.legs) {
      totalLegs += 1;
      const sig = signalNorm(leg);

      const cur = sigStats.get(sig) ?? { hits: 0, n: 0 };
      cur.n += 1;
      if (parlayHit) cur.hits += 1;
      sigStats.set(sig, cur);

      let monthMap = sigMonth.get(sig);
      if (!monthMap) { monthMap = new Map(); sigMonth.set(sig, monthMap); }
      const mc = monthMap.get(m) ?? { hits: 0, n: 0 };
      mc.n += 1;
      if (parlayHit) mc.hits += 1;
      monthMap.set(m, mc);

      if (leg.sport === "NBA") {
        const pk = legPropKey(leg);
        const ps = propStats.get(pk) ?? { hits: 0, n: 0 };
        ps.n += 1;
        if (parlayHit) ps.hits += 1;
        propStats.set(pk, ps);
      }
    }
  }

  // ---- Tier changes ----
  const tierChanges: TierChange[] = [];
  for (const [sig, { hits, n }] of sigStats) {
    if (n < MIN_N_SIGNAL) continue;
    const rate = hits / n;
    const cur = currentTier(sig);
    const rec = recommendTier(rate);
    const tierRank = { BLACKLIST: 0, WATCHLIST: 1, UNKNOWN: 1, B: 2, A: 3, S: 4 } as const;
    if (tierRank[rec] !== tierRank[cur]) {
      tierChanges.push({
        signal: sig,
        current_tier: cur,
        observed_hit_rate: Math.round(rate * 1000) / 1000,
        n,
        recommended_tier: rec,
        reason: rec === "BLACKLIST" ? "hit_rate_below_50" : "tier_drift_detected",
      });
    }
  }

  // ---- Drift warnings (compare consecutive months) ----
  const driftWarnings: DriftWarning[] = [];
  for (const [sig, monthMap] of sigMonth) {
    const months = Array.from(monthMap.entries())
      .filter(([, v]) => v.n >= MIN_N_DRIFT_MONTH)
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (let i = 1; i < months.length; i++) {
      const [mPrev, vPrev] = months[i - 1];
      const [mCur, vCur] = months[i];
      const ratePrev = vPrev.hits / vPrev.n;
      const rateCur = vCur.hits / vCur.n;
      const delta = rateCur - ratePrev;
      if (Math.abs(delta) >= DRIFT_THRESHOLD) {
        driftWarnings.push({
          signal: sig,
          earlier_period: { month: mPrev, hit_rate: Math.round(ratePrev * 1000) / 1000, n: vPrev.n },
          later_period: { month: mCur, hit_rate: Math.round(rateCur * 1000) / 1000, n: vCur.n },
          delta: Math.round(delta * 1000) / 1000,
        });
      }
    }
  }

  // ---- Prop crossings (NBA) ----
  const propCrossings: PropCrossing[] = [];
  for (const [pk, { hits, n }] of propStats) {
    if (n < MIN_N_PROP) continue;
    const rate = hits / n;
    const inWhite = pk in config.PROP_WHITELIST;
    const inBlack = config.PROP_BLACKLIST.has(pk);
    const cur: PropCrossing["current"] = inWhite ? "WHITELIST" : inBlack ? "BLACKLIST" : "NONE";
    let rec: PropCrossing["recommended"] | null = null;
    if (rate >= 0.55 && !inWhite) rec = "WHITELIST";
    else if (rate < 0.50 && !inBlack) rec = "BLACKLIST";
    else if (inWhite && rate < 0.50) rec = "REVIEW";
    else if (inBlack && rate >= 0.55) rec = "REVIEW";
    if (rec) {
      propCrossings.push({
        prop_key: pk,
        current: cur,
        observed_hit_rate: Math.round(rate * 1000) / 1000,
        n,
        recommended: rec,
      });
    }
  }

  // ---- Kill candidates + share nudges ----
  const killCandidates: KillCandidate[] = [];
  const shareNudges: ShareNudge[] = [];

  // Build current share map
  const currentShare = new Map<string, number>();
  for (const slot of config.ACTIVE_STRATEGIES) {
    currentShare.set(slot.name, (currentShare.get(slot.name) ?? 0) + slot.daily_share);
  }

  // ROI ranking
  const stratEntries = Array.from(stratStats.entries())
    .filter(([, v]) => v.n >= MIN_N_STRATEGY)
    .map(([name, v]) => ({
      name, n: v.n, profit: v.profit, stake: v.stake,
      roi: v.stake > 0 ? v.profit / v.stake : 0,
      wr: v.wins / v.n,
    }));

  for (const s of stratEntries) {
    if (s.profit < 0) {
      killCandidates.push({
        strategy: s.name,
        n: s.n,
        net_profit: Math.round(s.profit * 100) / 100,
        win_rate: Math.round(s.wr * 1000) / 1000,
      });
    }
  }

  // Share nudges: top ROI gets +3%, bottom (positive only) gets -3%
  const positive = stratEntries.filter(s => s.roi > 0).sort((a, b) => b.roi - a.roi);
  if (positive.length >= 2) {
    const winner = positive[0];
    const loser = positive[positive.length - 1];
    if (winner.name !== loser.name) {
      const wCur = currentShare.get(winner.name) ?? 0;
      const lCur = currentShare.get(loser.name) ?? 0;
      shareNudges.push({
        strategy: winner.name,
        current_share: wCur,
        observed_roi: Math.round(winner.roi * 1000) / 1000,
        recommended_share: Math.min(0.50, wCur + SHARE_NUDGE_PCT),
        delta: SHARE_NUDGE_PCT,
      });
      shareNudges.push({
        strategy: loser.name,
        current_share: lCur,
        observed_roi: Math.round(loser.roi * 1000) / 1000,
        recommended_share: Math.max(0, lCur - SHARE_NUDGE_PCT),
        delta: -SHARE_NUDGE_PCT,
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    total_parlays: parlays.length,
    total_legs: totalLegs,
    tier_changes: tierChanges,
    drift_warnings: driftWarnings,
    prop_crossings: propCrossings,
    kill_candidates: killCandidates,
    share_nudges: shareNudges,
  };
}
