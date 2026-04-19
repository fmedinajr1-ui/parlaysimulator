// _shared/customer-pick-router.ts
//
// Decides — per customer, per alert — whether to deliver, and how to
// personalize the stake amount based on THEIR bankroll + risk profile.
//
// Called from telegram-client.ts → fanoutToCustomers for every (customer, alert)
// pair. Backwards-compatible: when alert_context is missing or customer is
// 'legacy_skip', it lets everything through (Phase 5 behavior).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface AlertContext {
  sport?: string;
  generator?: string;
  confidence?: number;       // 0-100
  is_parlay?: boolean;
  pick_id?: string;
  tier?: 'execution' | 'validation' | 'exploration' | string;
}

export interface CustomerPreferences {
  chat_id: string;
  bet_type: 'parlays_only' | 'singles_only' | 'both';
  sports: string[];
  bankroll_size: number;
  risk_profile: 'conservative' | 'balanced' | 'aggressive';
  min_confidence: number;
  max_legs: number;
  preferred_alert_types: string[];
  onboarding_step: string;
}

export interface RouterDecision {
  shouldSend: boolean;
  skipReason?: string;
  personalizedStake?: number;
  personalizedFooter?: string;
}

const TIER_PCT: Record<string, number> = {
  execution: 0.05,
  validation: 0.025,
  exploration: 0.01,
};

// Risk profile gate: which tiers a customer sees
const RISK_TIER_ALLOW: Record<string, Set<string>> = {
  conservative: new Set(['execution']),
  balanced:     new Set(['execution', 'validation']),
  aggressive:   new Set(['execution', 'validation', 'exploration']),
};

/**
 * Pure decision function — no DB access. Easy to unit test.
 */
export function decideForCustomer(
  prefs: CustomerPreferences | null,
  alert: AlertContext | undefined
): RouterDecision {
  // Rollback flag: bypass all personalization
  if (Deno.env.get('DISABLE_PERSONALIZATION') === 'true') {
    return { shouldSend: true };
  }

  // No prefs row at all → safest default is to skip (they'll get the
  // re-onboard nudge from bot-reonboard-existing on the next cycle).
  if (!prefs) {
    return { shouldSend: false, skipReason: 'no_prefs_row' };
  }

  // Mid-onboarding (or legacy_skip leftover) → no broadcast picks until
  // they finish the wizard. The nightly nudge phase re-prompts them.
  if (prefs.onboarding_step !== 'complete') {
    return { shouldSend: false, skipReason: `onboarding_${prefs.onboarding_step}` };
  }

  // No alert context → can't filter, so send (e.g. orchestrator phase messages)
  if (!alert) return { shouldSend: true };

  // Sport filter
  if (alert.sport && prefs.sports.length > 0) {
    const sportMatch = prefs.sports.some(
      s => s.toLowerCase() === alert.sport!.toLowerCase()
    );
    if (!sportMatch) return { shouldSend: false, skipReason: `sport_${alert.sport}_not_in_prefs` };
  }

  // Bet type filter
  if (alert.is_parlay === true && prefs.bet_type === 'singles_only') {
    return { shouldSend: false, skipReason: 'parlay_to_singles_only' };
  }
  if (alert.is_parlay === false && prefs.bet_type === 'parlays_only') {
    return { shouldSend: false, skipReason: 'single_to_parlays_only' };
  }

  // Confidence floor
  if (alert.confidence != null && alert.confidence < prefs.min_confidence) {
    return { shouldSend: false, skipReason: `confidence_${alert.confidence}_below_${prefs.min_confidence}` };
  }

  // Risk tier gate
  if (alert.tier) {
    const allowed = RISK_TIER_ALLOW[prefs.risk_profile] ?? RISK_TIER_ALLOW.balanced;
    if (!allowed.has(alert.tier)) {
      return { shouldSend: false, skipReason: `tier_${alert.tier}_blocked_by_${prefs.risk_profile}` };
    }
  }

  // Generator opt-in (only enforced if user has set explicit prefs)
  if (alert.generator && prefs.preferred_alert_types.length > 0) {
    if (!prefs.preferred_alert_types.includes(alert.generator)) {
      return { shouldSend: false, skipReason: `generator_${alert.generator}_not_opted_in` };
    }
  }

  // Personalized stake based on tier + their bankroll
  const tierPct = alert.tier ? (TIER_PCT[alert.tier] ?? 0.025) : 0.025;
  const stake = Math.round(prefs.bankroll_size * tierPct);
  const footer = `\n\n💰 *Your stake:* $${stake.toLocaleString()} (${(tierPct * 100).toFixed(1)}% of your $${prefs.bankroll_size.toLocaleString()} bankroll)`;

  return {
    shouldSend: true,
    personalizedStake: stake,
    personalizedFooter: footer,
  };
}

/**
 * Load preferences for a single customer (or null if none).
 */
export async function loadCustomerPrefs(
  sb: SupabaseClient,
  chatId: string
): Promise<CustomerPreferences | null> {
  const { data } = await sb
    .from('bot_user_preferences')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();
  return (data as CustomerPreferences) || null;
}

/**
 * Bulk-load preferences for many customers (used by fanout).
 */
export async function loadAllCustomerPrefs(
  sb: SupabaseClient,
  chatIds: string[]
): Promise<Map<string, CustomerPreferences>> {
  const map = new Map<string, CustomerPreferences>();
  if (chatIds.length === 0) return map;
  const { data } = await sb
    .from('bot_user_preferences')
    .select('*')
    .in('chat_id', chatIds);
  for (const row of (data || []) as CustomerPreferences[]) {
    map.set(row.chat_id, row);
  }
  return map;
}
