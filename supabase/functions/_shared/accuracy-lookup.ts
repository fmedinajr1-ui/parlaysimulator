// _shared/accuracy-lookup.ts
//
// Per-alert-type accuracy lookup + stake recommendation engine.
// Reads from `alert_type_accuracy_cache` (refreshed every 30 min) and combines
// with current bot form + remaining daily exposure to produce a stake suggestion
// for ANY alert in the pipeline.
//
// Used by: alert-enricher.ts (legacy compat path) and pick-formatter.ts (v2 cards).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { BotForm } from './voice.ts';

export interface AlertAccuracy {
  alert_type: string;
  l7_hit_rate: number | null;
  l30_hit_rate: number | null;
  sample_size_l7: number;
  sample_size_l30: number;
  trend: 'hot' | 'neutral' | 'cold' | 'ice_cold';
  stake_multiplier: number;
  recommendation: 'size_up' | 'standard' | 'light' | 'skip';
}

export interface StakeAdvice {
  stake: number;
  tier: 'execution' | 'validation' | 'exploration' | 'skip';
  reasoning: string;
  multiplier: number;
}

// In-memory cache (per dispatcher invocation) — avoids hammering DB on burst sends
const memoryCache = new Map<string, AlertAccuracy>();
let cacheLoadedAt: number | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60s — invocation-scoped

/** Bulk-load the entire accuracy cache once per invocation. */
async function loadCache(sb: SupabaseClient): Promise<void> {
  if (cacheLoadedAt && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return;
  const { data, error } = await sb
    .from('alert_type_accuracy_cache')
    .select('*');
  if (error) {
    console.warn('[accuracy-lookup] cache load failed:', error.message);
    return;
  }
  memoryCache.clear();
  for (const row of data || []) {
    memoryCache.set(String(row.alert_type).toLowerCase(), row as AlertAccuracy);
  }
  cacheLoadedAt = Date.now();
}

/**
 * Get accuracy data for an alert type. Falls back to a neutral default if not found.
 * Normalizes alert_type to lowercase + strips common prefixes.
 */
export async function getAlertTypeAccuracy(
  sb: SupabaseClient,
  alertType: string
): Promise<AlertAccuracy> {
  await loadCache(sb);
  const key = normalizeAlertType(alertType);
  const cached = memoryCache.get(key);
  if (cached) return cached;

  // Fallback: try a fuzzy match (substring)
  for (const [k, v] of memoryCache.entries()) {
    if (k.includes(key) || key.includes(k)) return v;
  }

  // Unknown alert type — return neutral default
  return {
    alert_type: alertType,
    l7_hit_rate: null,
    l30_hit_rate: null,
    sample_size_l7: 0,
    sample_size_l30: 0,
    trend: 'neutral',
    stake_multiplier: 1.0,
    recommendation: 'standard',
  };
}

/** Normalize alert type strings: lowercase + strip prefixes for fuzzy lookup. */
export function normalizeAlertType(alertType: string): string {
  return String(alertType || '')
    .toLowerCase()
    .replace(/^(alert_|bot_|pipeline_|generate_|new_)/, '')
    .replace(/_alert$|_signal$|_v\d+$/, '')
    .trim();
}

/**
 * Pure function — no DB. Combines accuracy + form + exposure into a stake recommendation.
 *
 * Tiers:
 *   - execution  : $300 base — high accuracy + good form + room in budget
 *   - validation : $150 base — mid accuracy or neutral form
 *   - exploration: $50 base  — low accuracy or cold form
 *   - skip       : $0        — bleeding signal type, or no exposure left
 */
export function getStakeRecommendation(
  accuracy: AlertAccuracy,
  form: BotForm,
  bankroll: number,
  exposureUsedPct: number
): StakeAdvice {
  // Hard skip: signal type is bleeding
  if (accuracy.recommendation === 'skip' || (accuracy.l7_hit_rate != null && accuracy.l7_hit_rate < 0.45 && accuracy.sample_size_l7 >= 8)) {
    return {
      stake: 0,
      tier: 'skip',
      reasoning: `${accuracy.alert_type} hit rate at ${pctStr(accuracy.l7_hit_rate)} L7 — fading this signal type today`,
      multiplier: 0,
    };
  }

  // Hard skip: exposure cap nearly hit
  if (exposureUsedPct >= 0.18) {
    return {
      stake: 0,
      tier: 'skip',
      reasoning: `Daily exposure at ${(exposureUsedPct * 100).toFixed(0)}% — cap is 20%. Sitting this one out.`,
      multiplier: 0,
    };
  }

  // Base stake by accuracy tier
  let baseStake: number;
  let tier: 'execution' | 'validation' | 'exploration';
  const acc = accuracy.l7_hit_rate ?? accuracy.l30_hit_rate ?? 0.5;
  const sample = accuracy.sample_size_l7;

  if (acc >= 0.65 && sample >= 5) {
    baseStake = 300;
    tier = 'execution';
  } else if (acc >= 0.55 || sample < 5) {
    baseStake = 150;
    tier = 'validation';
  } else {
    baseStake = 50;
    tier = 'exploration';
  }

  // Form multiplier
  const formMult: Record<BotForm, number> = {
    hot: 1.2,
    neutral: 1.0,
    cold: 0.6,
    ice_cold: 0.4,
  };

  // Trend multiplier (signal-type-specific recent trend)
  const trendMult: Record<typeof accuracy.trend, number> = {
    hot: 1.2,
    neutral: 1.0,
    cold: 0.7,
    ice_cold: 0.5,
  };

  const totalMult = formMult[form] * trendMult[accuracy.trend] * accuracy.stake_multiplier;
  let stake = Math.round(baseStake * totalMult);

  // Round to nearest $25 for cleaner numbers
  stake = Math.max(25, Math.round(stake / 25) * 25);

  // Cap at remaining exposure budget
  const maxExposureDollars = bankroll * 0.20;
  const usedDollars = bankroll * exposureUsedPct;
  const remaining = Math.max(0, maxExposureDollars - usedDollars);
  if (stake > remaining) {
    stake = Math.max(25, Math.round(remaining / 25) * 25);
  }

  // Build reasoning
  const reasoning = buildReasoning(accuracy, form, stake, baseStake, exposureUsedPct);

  return { stake, tier, reasoning, multiplier: totalMult };
}

function buildReasoning(
  accuracy: AlertAccuracy,
  form: BotForm,
  finalStake: number,
  baseStake: number,
  exposureUsedPct: number
): string {
  const parts: string[] = [];

  if (accuracy.l7_hit_rate != null && accuracy.sample_size_l7 >= 3) {
    parts.push(`${accuracy.alert_type} ${pctStr(accuracy.l7_hit_rate)} L7 (${accuracy.sample_size_l7})`);
  }

  if (form === 'hot') parts.push('bot riding hot');
  else if (form === 'cold') parts.push('bot cooling off');
  else if (form === 'ice_cold') parts.push('bot in survival mode');

  if (finalStake < baseStake * 0.8) {
    parts.push(`sized down from $${baseStake}`);
  } else if (finalStake > baseStake * 1.1) {
    parts.push(`pressed up from $${baseStake}`);
  }

  if (exposureUsedPct >= 0.12) {
    parts.push(`exposure at ${(exposureUsedPct * 100).toFixed(0)}% — staying disciplined`);
  }

  return parts.length ? parts.join(' · ') : 'standard play';
}

function pctStr(v: number | null): string {
  if (v == null) return 'unknown';
  return `${Math.round(v * 100)}%`;
}

/** Quick helper: get current daily exposure used as a fraction of bankroll. */
export async function getExposureUsedPct(sb: SupabaseClient, bankroll: number): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await sb
    .from('bot_daily_picks')
    .select('stake_amount')
    .eq('pick_date', today)
    .eq('status', 'approved');
  const used = (data || []).reduce((s: number, r: any) => s + (Number(r.stake_amount) || 0), 0);
  if (bankroll <= 0) return 0;
  return Math.min(1, used / bankroll);
}

/** Bulk read for the accuracy_pulse phase — returns top alert types by sample size. */
export async function listTopAlertTypes(
  sb: SupabaseClient,
  limit: number = 10
): Promise<AlertAccuracy[]> {
  await loadCache(sb);
  const all = Array.from(memoryCache.values());
  return all
    .filter(a => a.sample_size_l7 >= 3)
    .sort((a, b) => (b.sample_size_l7 || 0) - (a.sample_size_l7 || 0))
    .slice(0, limit);
}
