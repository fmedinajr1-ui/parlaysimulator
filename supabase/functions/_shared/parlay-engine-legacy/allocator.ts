// ============================================================================
// allocator.ts — Direct port of allocator.py
// Distributes daily parlay budget across strategies.
// ============================================================================

import * as config from "./config.ts";

export function slotTargetCount(slot: config.StrategySlot, target_total: number): number {
  return Math.max(1, Math.round(slot.daily_share * target_total));
}

export function computeDailyPlan(
  target_total: number = config.TARGET_PARLAYS_PER_DAY,
): Record<string, number> {
  const plan: Record<string, number> = {};
  let running = 0;
  for (const slot of config.ACTIVE_STRATEGIES) {
    const n = slotTargetCount(slot, target_total);
    plan[slot.name] = n;
    running += n;
  }
  const diff = target_total - running;
  if (diff !== 0) {
    const coreSlot = config.ACTIVE_STRATEGIES.find(s => s.tier === "CORE");
    if (coreSlot) {
      plan[coreSlot.name] = Math.max(1, plan[coreSlot.name] + diff);
    }
  }
  return plan;
}

export function tierBankrollShare(): Record<string, number> {
  const agg: Record<string, number> = {};
  for (const slot of config.ACTIVE_STRATEGIES) {
    agg[slot.tier] = (agg[slot.tier] ?? 0) + slot.daily_share;
  }
  return agg;
}

export function estimateDailyExposureUnits(plan: Record<string, number>): number {
  let total = 0.0;
  for (const slot of config.ACTIVE_STRATEGIES) {
    const n = plan[slot.name] ?? 0;
    total += n * config.STAKE_BY_TIER[slot.tier];
  }
  return total;
}