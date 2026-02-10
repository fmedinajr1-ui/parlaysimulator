/**
 * calibrate-bot-weights
 * 
 * Bootstraps and recalibrates bot category weights from historical outcome data.
 * Queries verified outcomes from category_sweet_spots to calculate true hit rates,
 * then updates bot_category_weights with accurate weights and stats.
 * 
 * Weight Formula:
 * weight = clamp(0.5, 1.5, base(1.0) + (hitRate - 0.50) * 0.8 + sampleSizeBonus)
 * 
 * Runs:
 * - After verify-sweet-spot-outcomes (chained)
 * - Weekly full rebuild on Sundays
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Weight calculation constants
const BASE_WEIGHT = 1.0;
const WEIGHT_SENSITIVITY = 0.8; // How much hit rate affects weight
const MIN_WEIGHT = 0.5;
const MAX_WEIGHT = 1.5;
const HIT_RATE_BASELINE = 0.50; // 50% is neutral

// Sample size bonuses
const LARGE_SAMPLE_THRESHOLD = 100;
const MEDIUM_SAMPLE_THRESHOLD = 50;
const LARGE_SAMPLE_BONUS = 0.10;
const MEDIUM_SAMPLE_BONUS = 0.05;

// Blocking thresholds
const BLOCK_HIT_RATE_THRESHOLD = 0.40; // Block if hit rate < 40%
const BLOCK_MIN_SAMPLES = 10; // Need at least 10 samples to block

interface CategoryStats {
  category: string;
  side: string;
  sport: string;
  total_picks: number;
  hits: number;
  misses: number;
  pushes: number;
  hit_rate: number;
}

interface ExistingWeight {
  id: string;
  category: string;
  side: string;
  sport: string | null;
  weight: number;
  current_streak: number;
  best_streak: number;
  worst_streak: number;
}

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

function calculateWeight(hitRate: number, sampleSize: number): number {
  // Base weight adjustment from hit rate
  const hitRateAdjustment = (hitRate - HIT_RATE_BASELINE) * WEIGHT_SENSITIVITY;
  
  // Sample size bonus - reward categories with more data
  let sampleBonus = 0;
  if (sampleSize >= LARGE_SAMPLE_THRESHOLD) {
    sampleBonus = LARGE_SAMPLE_BONUS;
  } else if (sampleSize >= MEDIUM_SAMPLE_THRESHOLD) {
    sampleBonus = MEDIUM_SAMPLE_BONUS;
  }
  
  const rawWeight = BASE_WEIGHT + hitRateAdjustment + sampleBonus;
  return clamp(MIN_WEIGHT, MAX_WEIGHT, rawWeight);
}

function shouldBlock(hitRate: number, sampleSize: number): { blocked: boolean; reason: string | null } {
  if (sampleSize >= BLOCK_MIN_SAMPLES && hitRate < BLOCK_HIT_RATE_THRESHOLD) {
    return {
      blocked: true,
      reason: `Hit rate ${(hitRate * 100).toFixed(1)}% below threshold (35%) with ${sampleSize} samples`,
    };
  }
  return { blocked: false, reason: null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body for options
    let fullRebuild = false;
    let sport = 'basketball_nba'; // Default to NBA
    
    try {
      const body = await req.json();
      fullRebuild = body.fullRebuild ?? false;
      sport = body.sport ?? 'basketball_nba';
    } catch {
      // No body, use defaults
    }

    console.log(`[Calibrate] Starting calibration (fullRebuild: ${fullRebuild}, sport: ${sport})`);

    // 1. Get actual hit rates from category_sweet_spots
    // Query settled outcomes grouped by category and recommended_side
    const { data: outcomeStats, error: statsError } = await supabase
      .from('category_sweet_spots')
      .select('category, recommended_side, outcome')
      .not('outcome', 'is', null)
      .not('settled_at', 'is', null);

    if (statsError) throw statsError;

    // Aggregate stats by category + side
    const categoryMap = new Map<string, CategoryStats>();

    for (const row of outcomeStats || []) {
      const key = `${row.category}__${row.recommended_side || 'over'}`;
      
      let stats = categoryMap.get(key);
      if (!stats) {
        stats = {
          category: row.category,
          side: row.recommended_side || 'over',
          sport: sport,
          total_picks: 0,
          hits: 0,
          misses: 0,
          pushes: 0,
          hit_rate: 0,
        };
        categoryMap.set(key, stats);
      }

      stats.total_picks++;
      if (row.outcome === 'hit') {
        stats.hits++;
      } else if (row.outcome === 'miss') {
        stats.misses++;
      } else if (row.outcome === 'push') {
        stats.pushes++;
      }
    }

    // Calculate hit rates
    for (const stats of categoryMap.values()) {
      const gradedPicks = stats.hits + stats.misses; // Exclude pushes from rate calculation
      stats.hit_rate = gradedPicks > 0 ? stats.hits / gradedPicks : 0;
    }

    console.log(`[Calibrate] Calculated stats for ${categoryMap.size} category/side combinations`);

    // 2. Get existing weights to preserve streak data
    const { data: existingWeights, error: weightsError } = await supabase
      .from('bot_category_weights')
      .select('id, category, side, sport, weight, current_streak, best_streak, worst_streak');

    if (weightsError) throw weightsError;

    const existingMap = new Map<string, ExistingWeight>();
    for (const w of existingWeights || []) {
      existingMap.set(`${w.category}__${w.side}`, w);
    }

    // 3. Upsert weights for all categories with outcomes
    let updated = 0;
    let created = 0;
    let blocked = 0;
    const calibrationResults: Array<{
      category: string;
      side: string;
      old_weight: number | null;
      new_weight: number;
      hit_rate: number;
      sample_size: number;
      is_blocked: boolean;
    }> = [];

    for (const [key, stats] of categoryMap) {
      const existing = existingMap.get(key);
      const newWeight = calculateWeight(stats.hit_rate, stats.total_picks);
      const blockStatus = shouldBlock(stats.hit_rate, stats.total_picks);

      if (blockStatus.blocked) blocked++;

      const updateData = {
        category: stats.category,
        side: stats.side,
        sport: stats.sport,
        weight: blockStatus.blocked ? 0 : newWeight,
        current_hit_rate: stats.hit_rate * 100, // Store as percentage
        total_picks: stats.total_picks,
        total_hits: stats.hits,
        is_blocked: blockStatus.blocked,
        block_reason: blockStatus.reason,
        last_calibrated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      calibrationResults.push({
        category: stats.category,
        side: stats.side,
        old_weight: existing?.weight ?? null,
        new_weight: blockStatus.blocked ? 0 : newWeight,
        hit_rate: stats.hit_rate * 100,
        sample_size: stats.total_picks,
        is_blocked: blockStatus.blocked,
      });

      if (existing) {
        // Update existing record, preserve streaks unless full rebuild
        const { error: updateError } = await supabase
          .from('bot_category_weights')
          .update({
            ...updateData,
            // Preserve streak data unless full rebuild
            current_streak: fullRebuild ? 0 : existing.current_streak,
            best_streak: fullRebuild ? 0 : existing.best_streak,
            worst_streak: fullRebuild ? 0 : existing.worst_streak,
          })
          .eq('id', existing.id);

        if (updateError) {
          console.error(`[Calibrate] Update error for ${key}:`, updateError);
        } else {
          updated++;
        }
      } else {
        // Insert new category weight
        const { error: insertError } = await supabase
          .from('bot_category_weights')
          .insert({
            ...updateData,
            current_streak: 0,
            best_streak: 0,
            worst_streak: 0,
            created_at: new Date().toISOString(),
          });

        if (insertError) {
          console.error(`[Calibrate] Insert error for ${key}:`, insertError);
        } else {
          created++;
        }
      }
    }

    // 4. Log the calibration run
    const topPerformers = calibrationResults
      .filter(r => !r.is_blocked && r.sample_size >= 20)
      .sort((a, b) => b.hit_rate - a.hit_rate)
      .slice(0, 5);

    const worstPerformers = calibrationResults
      .filter(r => r.sample_size >= 10)
      .sort((a, b) => a.hit_rate - b.hit_rate)
      .slice(0, 5);

    await supabase.from('bot_activity_log').insert({
      event_type: 'calibration_complete',
      message: `Calibrated ${categoryMap.size} categories: ${updated} updated, ${created} created, ${blocked} blocked`,
      metadata: {
        totalCategories: categoryMap.size,
        updated,
        created,
        blocked,
        fullRebuild,
        sport,
        topPerformers: topPerformers.map(p => ({
          category: p.category,
          side: p.side,
          hitRate: p.hit_rate.toFixed(1),
          weight: p.new_weight.toFixed(2),
          samples: p.sample_size,
        })),
        worstPerformers: worstPerformers.map(p => ({
          category: p.category,
          side: p.side,
          hitRate: p.hit_rate.toFixed(1),
          blocked: p.is_blocked,
          samples: p.sample_size,
        })),
      },
      severity: blocked > categoryMap.size * 0.3 ? 'warning' : 'info',
    });

    console.log(`[Calibrate] Complete: ${updated} updated, ${created} created, ${blocked} blocked`);

    // 5. Send summary via Telegram if significant changes
    if (created > 0 || blocked > 0) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify({
            type: 'calibration_complete',
            data: {
              totalCategories: categoryMap.size,
              updated,
              created,
              blocked,
              topPerformers,
              worstPerformers,
            },
          }),
        });
      } catch (telegramError) {
        console.error('[Calibrate] Telegram notification failed:', telegramError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalCategories: categoryMap.size,
        updated,
        created,
        blocked,
        topPerformers,
        worstPerformers,
        fullRebuild,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Calibrate] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
