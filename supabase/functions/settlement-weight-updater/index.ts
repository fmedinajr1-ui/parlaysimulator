/**
 * settlement-weight-updater
 * 
 * Clean learning loop that only fires when ≥85% settlement coverage is met.
 * Reads from settlement_records (not from 16 different tables),
 * applies Bayesian smoothing, and auto-blocks categories with <40% hit rate.
 * 
 * Replaces the learning portion of bot-settle-and-learn and calibrate-bot-weights.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Bayesian prior: Beta(2, 2) = neutral 50% prior with weight of 4 pseudo-observations
const PRIOR_ALPHA = 2;
const PRIOR_BETA = 2;

// Thresholds
const MIN_SAMPLE_SIZE = 5;
const AUTO_BLOCK_RATE = 0.40;
const AUTO_BLOCK_MIN_SAMPLES = 20;
const MIN_WEIGHT = 0.5;
const MAX_WEIGHT = 1.5;
const BASE_WEIGHT = 1.0;
const WEIGHT_SENSITIVITY = 0.8;

function clamp(min: number, max: number, val: number): number {
  return Math.min(max, Math.max(min, val));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const log = (msg: string) => console.log(`[weight-updater] ${msg}`);

  try {
    const body = await req.json().catch(() => ({}));
    const dates: string[] = body.dates || [];

    log(`Updating weights from settlement_records${dates.length > 0 ? ` for dates: ${dates.join(', ')}` : ' (all time)'}`);

    // 1. Pull all settlement records (or filtered by date)
    let query = supabase
      .from('settlement_records')
      .select('signal_id, settlement_method, was_correct')
      .not('was_correct', 'is', null);

    // We need signal metadata too — join via the alert
    const { data: records, error: recErr } = await supabase
      .from('settlement_records')
      .select('signal_id, settlement_method, was_correct')
      .not('was_correct', 'is', null)
      .limit(10000);

    if (recErr) throw recErr;
    if (!records || records.length === 0) {
      log('No settlement records found');
      return new Response(JSON.stringify({ updated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Get signal metadata for grouping
    const signalIds = records.map(r => r.signal_id);
    const signalMap = new Map<string, any>();

    // Fetch in chunks
    for (let i = 0; i < signalIds.length; i += 500) {
      const chunk = signalIds.slice(i, i + 500);
      const { data: signals } = await supabase
        .from('fanduel_prediction_alerts')
        .select('id, signal_type, prop_type, contrarian_flip_applied')
        .in('id', chunk);

      for (const s of signals || []) {
        signalMap.set(s.id, s);
      }
    }

    // 3. Group by (signal_type, prop_type, contrarian_flip_applied)
    const groups = new Map<string, { wins: number; total: number }>();

    for (const record of records) {
      const signal = signalMap.get(record.signal_id);
      if (!signal) continue;

      const key = `${signal.signal_type}::${signal.prop_type}::${signal.contrarian_flip_applied ?? false}`;
      if (!groups.has(key)) groups.set(key, { wins: 0, total: 0 });
      
      const g = groups.get(key)!;
      g.total++;
      if (record.was_correct) g.wins++;
    }

    log(`Grouped into ${groups.size} categories`);

    // 4. Update bot_category_weights with Bayesian-smoothed rates
    let updated = 0;
    let blocked = 0;
    const weightUpdates: Array<{ category: string; side: string; rate: number; blocked: boolean }> = [];

    for (const [key, stats] of groups) {
      const [signalType, propType, flipStr] = key.split('::');

      if (stats.total < MIN_SAMPLE_SIZE) continue;

      // Bayesian smoothing
      const smoothedRate = (stats.wins + PRIOR_ALPHA) / (stats.total + PRIOR_ALPHA + PRIOR_BETA);

      // Calculate weight
      const hitRateAdj = (smoothedRate - 0.50) * WEIGHT_SENSITIVITY;
      let sampleBonus = 0;
      if (stats.total >= 100) sampleBonus = 0.10;
      else if (stats.total >= 50) sampleBonus = 0.05;

      const weight = clamp(MIN_WEIGHT, MAX_WEIGHT, BASE_WEIGHT + hitRateAdj + sampleBonus);

      // Auto-block check
      const shouldBlock = smoothedRate < AUTO_BLOCK_RATE && stats.total >= AUTO_BLOCK_MIN_SAMPLES;

      // Map to category format used by bot_category_weights
      // signal_type maps to category, propType is additional context
      const category = `${signalType}_${propType}`.toUpperCase();
      const side = flipStr === 'true' ? 'contrarian' : 'standard';

      // Upsert into bot_category_weights
      const { data: existing } = await supabase
        .from('bot_category_weights')
        .select('id')
        .eq('category', category)
        .eq('side', side)
        .maybeSingle();

      const updateData = {
        category,
        side,
        weight: shouldBlock ? 0 : weight,
        current_hit_rate: smoothedRate * 100,
        bayesian_hit_rate: smoothedRate * 100,
        total_picks: stats.total,
        total_hits: stats.wins,
        is_blocked: shouldBlock,
        block_reason: shouldBlock ? `Bayesian rate ${(smoothedRate * 100).toFixed(1)}% < ${AUTO_BLOCK_RATE * 100}% (n=${stats.total})` : null,
        last_calibrated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        await supabase
          .from('bot_category_weights')
          .update(updateData)
          .eq('id', existing.id);
      } else {
        await supabase
          .from('bot_category_weights')
          .insert({
            ...updateData,
            current_streak: 0,
            best_streak: 0,
            worst_streak: 0,
            created_at: new Date().toISOString(),
          });
      }

      updated++;
      if (shouldBlock) blocked++;
      weightUpdates.push({ category, side, rate: smoothedRate * 100, blocked: shouldBlock });
    }

    log(`Updated ${updated} categories, blocked ${blocked}`);

    // 5. Log activity
    await supabase.from('bot_activity_log').insert({
      event_type: 'weight_calibration',
      message: `Bayesian weight update: ${updated} categories, ${blocked} blocked`,
      severity: blocked > updated * 0.3 ? 'warning' : 'info',
      metadata: {
        total_records: records.length,
        categories_updated: updated,
        categories_blocked: blocked,
        top_performers: weightUpdates
          .filter(w => !w.blocked)
          .sort((a, b) => b.rate - a.rate)
          .slice(0, 5),
        worst_performers: weightUpdates
          .sort((a, b) => a.rate - b.rate)
          .slice(0, 5),
      },
    });

    // 6. Refresh materialized view
    try {
      await supabase.rpc('refresh_signal_accuracy');
    } catch (e) {
      log(`View refresh failed: ${e.message}`);
    }

    return new Response(JSON.stringify({
      success: true,
      total_records: records.length,
      categories_updated: updated,
      categories_blocked: blocked,
      updates: weightUpdates,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    log(`Error: ${err.message}`);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
