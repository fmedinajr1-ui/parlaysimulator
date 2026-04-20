// _shared/alert-enricher.ts
//
// Wraps every legacy {type, data} alert with stake advice + accuracy context + humor.
// Called by bot-send-telegram dispatcher in compat path so all 99 legacy generators
// get the upgrade automatically with zero changes to their source.
//
// Bypassable via DISABLE_ENRICHMENT=true env var (rollback safety).

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getAlertTypeAccuracy, getStakeRecommendation, getExposureUsedPct, type StakeAdvice, type AlertAccuracy } from './accuracy-lookup.ts';
import { type BotForm } from './voice.ts';
import { loadBankrollState } from './bankroll-curator.ts';
import { renderAlertCardV3, extractHeadline, extractSport, deriveTier } from './alert-format-v3.ts';
import { getLineContext, getGameContext } from './alert-context.ts';

export interface EnrichInput {
  alertType: string;
  rawText: string;
  seed?: string;
  /** Optional event id — unlocks line + tip context if known. */
  eventId?: string | null;
  /** Optional sport hint — overrides regex extraction. */
  sport?: string | null;
  /** Optional confidence hint (0-100) — overrides tier derivation. */
  confidence?: number | null;
}

export interface EnrichOutput {
  message: string;
  stake: StakeAdvice;
  accuracy: AlertAccuracy;
  enriched: boolean;
}

/**
 * Returns the original text wrapped with personality + stake + accuracy context.
 * Header above original message, footer below. Original message untouched in middle.
 */
export async function enrichLegacyAlert(
  sb: SupabaseClient,
  input: EnrichInput
): Promise<EnrichOutput> {
  // Rollback escape hatch
  if (Deno.env.get('DISABLE_ENRICHMENT') === 'true') {
    return {
      message: input.rawText,
      stake: { stake: 0, tier: 'validation', reasoning: 'enrichment disabled', multiplier: 1 },
      accuracy: { alert_type: input.alertType, l7_hit_rate: null, l30_hit_rate: null, sample_size_l7: 0, sample_size_l30: 0, trend: 'neutral', stake_multiplier: 1, recommendation: 'standard' },
      enriched: false,
    };
  }

  const seed = input.seed || `${input.alertType}|${input.rawText.slice(0, 40)}`;

  // Parallel-fetch every context piece we can get our hands on
  const [accuracy, bankroll, lineCtx, gameCtx] = await Promise.all([
    getAlertTypeAccuracy(sb, input.alertType),
    loadBankrollState(sb).catch(() => null),
    input.eventId ? getLineContext(sb, input.eventId).catch(() => null) : Promise.resolve(null),
    input.eventId ? getGameContext(sb, input.eventId).catch(() => null) : Promise.resolve(null),
  ]);

  let exposurePct = 0;
  let form: BotForm = 'neutral';
  let bankrollAmount = 5000;
  if (bankroll) {
    form = bankroll.current_form;
    bankrollAmount = bankroll.current_bankroll;
    exposurePct = await getExposureUsedPct(sb, bankrollAmount).catch(() => 0);
  }

  const stake = getStakeRecommendation(accuracy, form, bankrollAmount, exposurePct);

  // v3 4-zone render — try to extract a glance headline + sport from raw text
  const headline = extractHeadline(input.rawText);
  const sport = input.sport ?? extractSport(input.rawText);
  const tier = deriveTier({ stakeTier: stake.tier, confidence: input.confidence ?? undefined });

  const message = renderAlertCardV3({
    body: input.rawText,
    sport,
    headline,
    confidence: input.confidence ?? null,
    tier,
    accuracy,
    stake,
    bankroll: bankrollAmount,
    line: lineCtx,
    game: gameCtx,
    form,
    seed,
  });

  return { message, stake, accuracy, enriched: true };
}

/** Detect if a payload should be enriched. v2 picks already include their own context. */
export function shouldEnrich(body: { type?: string; message?: string }): boolean {
  if (Deno.env.get('DISABLE_ENRICHMENT') === 'true') return false;
  // Only enrich legacy typed payloads; v2 messages already enriched upstream
  if (!body.type) return false;
  // Don't double-enrich orchestrator phase messages
  const skipTypes = ['playcard', 'dawn_brief', 'settlement_story', 'tomorrow_tease', 'pre_game_pulse', 'accuracy_pulse', 'pipeline_failure'];
  if (skipTypes.some(t => body.type!.toLowerCase().includes(t))) return false;
  return true;
}
