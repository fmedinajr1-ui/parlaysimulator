// ============================================================================
// generator.ts — Direct port of generator.py
// Main ParlayEngine orchestrator. Pure logic; no I/O.
// ============================================================================

import * as config from "./config.ts";
import { CandidateLeg, GenerationReport, Parlay } from "./models.ts";
import { validateLeg, validateParlay } from "./filters.ts";
import { ExposureTracker } from "./dedup.ts";
import { parlayRankingScore } from "./scoring.ts";
import { getStrategy } from "./strategies.ts";
import { computeDailyPlan } from "./allocator.ts";

export interface SlateResult {
  parlays: Parlay[];
  report: GenerationReport;
}

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export class ParlayEngine {
  target_total: number;
  max_total: number;
  min_total: number;

  constructor(opts: { target_total?: number; max_total?: number; min_total?: number } = {}) {
    this.target_total = opts.target_total ?? config.TARGET_PARLAYS_PER_DAY;
    this.max_total = opts.max_total ?? config.MAX_PARLAYS_PER_DAY;
    this.min_total = opts.min_total ?? config.MIN_PARLAYS_PER_DAY;
  }

  generateSlate(candidates: CandidateLeg[], now: Date): SlateResult {
    const rejection_reasons: Record<string, number> = {};
    const strategy_breakdown: Record<string, number> = {};
    const tier_breakdown: Record<string, number> = {};

    // 1. Leg-level filter
    const kept: CandidateLeg[] = [];
    for (const leg of candidates) {
      const [ok, reason] = validateLeg(leg, now);
      if (ok) kept.push(leg);
      else bump(rejection_reasons, `leg:${reason}`);
    }

    // 2. Daily plan
    const plan = computeDailyPlan(this.target_total);

    // 3. Build parlays per strategy
    const exposure = new ExposureTracker();
    const built: Parlay[] = [];
    let parlay_filter_rejects = 0;

    for (const slot of config.ACTIVE_STRATEGIES) {
      const target = plan[slot.name] ?? 0;
      if (target <= 0) continue;
      const strategyFn = getStrategy(slot.name);

      let attempts = 0;
      let successes = 0;
      const max_attempts = target * 6;

      while (successes < target && attempts < max_attempts) {
        attempts += 1;

        const narrowed = this.narrowPool(kept, exposure);
        if (narrowed.length < slot.target_leg_count) {
          bump(rejection_reasons, `pool_thin:${slot.name}`);
          break;
        }

        const parlay = strategyFn(narrowed, slot);
        if (parlay === null) {
          bump(rejection_reasons, `strategy_returned_none:${slot.name}`);
          break;
        }

        const [okV, reasonV] = validateParlay(parlay);
        if (!okV) {
          parlay_filter_rejects += 1;
          bump(rejection_reasons, `parlay:${reasonV}`);
          continue;
        }

        const [okA, reasonA] = exposure.canAccept(parlay);
        if (!okA) {
          exposure.rejectDuplicate();
          bump(rejection_reasons, `exposure:${reasonA}`);
          continue;
        }

        exposure.accept(parlay);
        built.push(parlay);
        bump(strategy_breakdown, slot.name);
        bump(tier_breakdown, slot.tier);
        successes += 1;
      }
    }

    // 4. Trim if over max
    let final = built;
    if (final.length > this.max_total) {
      final = final.slice().sort((a, b) => parlayRankingScore(b) - parlayRankingScore(a))
        .slice(0, this.max_total);
    }

    // 5. Sort by ranking score for presentation
    final = final.slice().sort((a, b) => parlayRankingScore(b) - parlayRankingScore(a));

    // 6. Report
    const report: GenerationReport = {
      run_date: now.toISOString().slice(0, 10),
      total_candidates_in: candidates.length,
      candidates_kept: kept.length,
      candidates_rejected: candidates.length - kept.length,
      parlays_built: final.length,
      parlays_rejected_by_filter: parlay_filter_rejects,
      unique_combos: exposure.combo_hashes.size,
      duplicates_skipped: exposure.duplicate_skips,
      strategy_breakdown,
      tier_breakdown,
      rejection_reasons,
    };

    return { parlays: final, report };
  }

  private narrowPool(legs: CandidateLeg[], exposure: ExposureTracker): CandidateLeg[] {
    const out: CandidateLeg[] = [];
    for (const l of legs) {
      if (l.player_name != null
        && (exposure.player_exposure.get(l.player_name) ?? 0) >= config.MAX_SAME_PLAYER_EXPOSURE) {
        continue;
      }
      out.push(l);
    }
    return out;
  }
}