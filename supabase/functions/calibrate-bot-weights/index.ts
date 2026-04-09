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
const BLOCK_HIT_RATE_THRESHOLD = 0.45; // Block if hit rate < 45%
const BLOCK_MIN_SAMPLES = 10; // Need at least 10 samples to block

// Streak penalty constants
const STREAK_MILD_THRESHOLD = -3;
const STREAK_SEVERE_THRESHOLD = -8;
const STREAK_BLOCK_THRESHOLD = -5; // Tightened: block after 5 consecutive misses
const STREAK_MILD_PENALTY_PER = 0.02;
const STREAK_SEVERE_PENALTY_PER = 0.03;

// DB-driven force blocks and boosts (loaded at runtime)
let FORCE_BLOCKED = new Set<string>();
let FORCE_BOOST: Record<string, number> = {};

// Static fallback boosts (used only if DB has no data)
const FALLBACK_FORCE_BOOST: Record<string, number> = {
  'THREE_POINT_SHOOTER__over': 1.45,
  'LOW_SCORER_UNDER__under': 1.45,
  'HIGH_ASSIST__under': 1.20,
  'LOW_LINE_REBOUNDER__under': 1.45,
};

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

function calculateStreakPenalty(currentStreak: number): number {
  if (currentStreak >= STREAK_MILD_THRESHOLD) return 0;
  if (currentStreak >= STREAK_SEVERE_THRESHOLD) {
    return currentStreak * STREAK_MILD_PENALTY_PER;
  }
  return currentStreak * STREAK_SEVERE_PENALTY_PER;
}

function calculateWeight(hitRate: number, sampleSize: number, currentStreak: number = 0): number {
  const hitRateAdjustment = (hitRate - HIT_RATE_BASELINE) * WEIGHT_SENSITIVITY;
  
  let sampleBonus = 0;
  if (sampleSize >= LARGE_SAMPLE_THRESHOLD) {
    sampleBonus = LARGE_SAMPLE_BONUS;
  } else if (sampleSize >= MEDIUM_SAMPLE_THRESHOLD) {
    sampleBonus = MEDIUM_SAMPLE_BONUS;
  }
  
  const streakPenalty = calculateStreakPenalty(currentStreak);
  const rawWeight = BASE_WEIGHT + hitRateAdjustment + sampleBonus + streakPenalty;
  return clamp(MIN_WEIGHT, MAX_WEIGHT, rawWeight);
}

function shouldBlock(hitRate: number, sampleSize: number, currentStreak: number = 0): { blocked: boolean; reason: string | null } {
  if (currentStreak <= STREAK_BLOCK_THRESHOLD) {
    return {
      blocked: true,
      reason: `Streak ${currentStreak} below auto-block threshold (${STREAK_BLOCK_THRESHOLD})`,
    };
  }
  if (sampleSize >= BLOCK_MIN_SAMPLES && hitRate < BLOCK_HIT_RATE_THRESHOLD) {
    return {
      blocked: true,
      reason: `Hit rate ${(hitRate * 100).toFixed(1)}% below threshold (40%) with ${sampleSize} samples`,
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
    let forceRun = false;
    
    try {
      const body = await req.json();
      fullRebuild = body.fullRebuild ?? false;
      sport = body.sport ?? 'basketball_nba';
      forceRun = body.force_run ?? false;
    } catch {
      // No body, use defaults
    }

    console.log(`[Calibrate] Starting calibration (fullRebuild: ${fullRebuild}, sport: ${sport}, forceRun: ${forceRun})`);

    // Load DB-driven force blocks and boosts
    const { data: forceBlockRows } = await supabase
      .from('bot_category_weights')
      .select('category, side, weight')
      .eq('is_force_blocked', true);

    FORCE_BLOCKED = new Set(
      (forceBlockRows || []).map((r: any) => `${r.category}__${r.side}`)
    );
    console.log(`[Calibrate] Loaded ${FORCE_BLOCKED.size} force-blocked categories from DB`);

    // Load boosted categories from DB (is_boosted = true, not blocked)
    const { data: boostRows } = await supabase
      .from('bot_prop_type_performance')
      .select('prop_type, boost_multiplier')
      .eq('is_boosted', true)
      .eq('is_blocked', false);

    FORCE_BOOST = {};
    for (const b of boostRows || []) {
      if (b.boost_multiplier && b.boost_multiplier > 1.0) {
        FORCE_BOOST[b.prop_type] = b.boost_multiplier;
      }
    }
    if (Object.keys(FORCE_BOOST).length === 0) {
      FORCE_BOOST = { ...FALLBACK_FORCE_BOOST };
      console.log(`[Calibrate] Using fallback boost overrides`);
    } else {
      console.log(`[Calibrate] Loaded ${Object.keys(FORCE_BOOST).length} boost overrides from DB`);
    }

    // Bug 3 guard: only run if settlement has stabilized (latest run ≥2h old)
    if (!forceRun && !fullRebuild) {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(new Date());

      const { data: recentRuns } = await supabase
        .from('settlement_runs')
        .select('completed_at')
        .eq('run_date', today)
        .order('completed_at', { ascending: false })
        .limit(1);

      if (!recentRuns || recentRuns.length === 0) {
        console.log('[Calibrate] No settlement runs found for today — skipping (use force_run to override)');
        return new Response(
          JSON.stringify({ success: false, reason: 'no_settlement_runs_today', hint: 'Use force_run: true to override' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const latestRun = new Date(recentRuns[0].completed_at);
      if (latestRun > new Date(twoHoursAgo)) {
        console.log(`[Calibrate] Latest settlement run is too recent (${recentRuns[0].completed_at}) — waiting for stabilization`);
        return new Response(
          JSON.stringify({ success: false, reason: 'settlement_not_stabilized', latest_run: recentRuns[0].completed_at }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      console.log(`[Calibrate] Settlement stabilized (latest run: ${recentRuns[0].completed_at}) — proceeding`);
    }

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
      // Sport-specific key takes priority
      if (w.sport && w.sport !== 'team_all') {
        existingMap.set(`${w.category}__${w.side}__${w.sport}`, w);
      }
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
      const currentStreak = existing?.current_streak ?? 0;
      let newWeight = calculateWeight(stats.hit_rate, stats.total_picks, currentStreak);
      let blockStatus = shouldBlock(stats.hit_rate, stats.total_picks, currentStreak);

      // Apply force-block overrides
      if (FORCE_BLOCKED.has(key)) {
        blockStatus = { blocked: true, reason: 'Force-blocked: historically unprofitable' };
      }

      // Apply force-boost overrides (only if not blocked)
      if (!blockStatus.blocked && FORCE_BOOST[key] !== undefined) {
        newWeight = FORCE_BOOST[key];
      }

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

    // Sweep pass: force-block any DB categories with poor stats not in current categoryMap
    let sweepBlocked = 0;
    const { data: allWeights, error: allWeightsError } = await supabase
      .from('bot_category_weights')
      .select('id, category, side, current_hit_rate, total_picks, current_streak, is_blocked')
      .eq('is_blocked', false);

    if (!allWeightsError && allWeights) {
      for (const w of allWeights) {
        const sweepKey = `${w.category}__${w.side}`;
        const shouldSweepBlock =
          (w.total_picks >= BLOCK_MIN_SAMPLES && (w.current_hit_rate ?? 100) < 45) ||
          (w.current_streak !== null && w.current_streak <= STREAK_BLOCK_THRESHOLD) ||
          FORCE_BLOCKED.has(sweepKey);

        if (shouldSweepBlock) {
          let reason = 'Sweep-blocked: ';
          if (FORCE_BLOCKED.has(sweepKey)) {
            reason += 'force-blocked category';
          } else if (w.current_streak !== null && w.current_streak <= STREAK_BLOCK_THRESHOLD) {
            reason += `streak ${w.current_streak} <= ${STREAK_BLOCK_THRESHOLD}`;
          } else {
            reason += `hit rate ${(w.current_hit_rate ?? 0).toFixed(1)}% < 45% with ${w.total_picks} picks`;
          }

          const { error: sweepError } = await supabase
            .from('bot_category_weights')
            .update({ weight: 0, is_blocked: true, block_reason: reason, updated_at: new Date().toISOString() })
            .eq('id', w.id);

          if (!sweepError) sweepBlocked++;
        }
      }
    }

    if (sweepBlocked > 0) {
      console.log(`[Calibrate] Sweep pass blocked ${sweepBlocked} additional categories`);
      blocked += sweepBlocked;
    }

    // Bug 5 fix: Rehabilitation pass — unblock recovered categories
    let rehabilitated = 0;
    const { data: blockedWeights } = await supabase
      .from('bot_category_weights')
      .select('id, category, side, current_hit_rate, total_picks, block_reason')
      .eq('is_blocked', true)
      .not('block_reason', 'like', 'force-blocked%');

    for (const w of blockedWeights || []) {
      // Rehabilitation: 20+ picks since blocking AND hit rate now above 52%
      if ((w.total_picks ?? 0) >= 20 && (w.current_hit_rate ?? 0) >= 52) {
        const { error: rehabError } = await supabase
          .from('bot_category_weights')
          .update({
            is_blocked: false,
            block_reason: null,
            weight: BASE_WEIGHT * 0.5, // start at half weight, earn back trust
            updated_at: new Date().toISOString(),
          })
          .eq('id', w.id);

        if (!rehabError) {
          rehabilitated++;
          console.log(`[Calibrate] Rehabilitated: ${w.category}/${w.side} (hit rate ${w.current_hit_rate}%, ${w.total_picks} picks)`);
        }
      }
    }

    if (rehabilitated > 0) {
      console.log(`[Calibrate] Rehabilitation pass unblocked ${rehabilitated} categories at half weight`);
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

    // 5. Seed team prop categories if they don't exist yet
    const TEAM_CATEGORIES = [
      { category: 'SHARP_SPREAD', side: 'home', sport },
      { category: 'SHARP_SPREAD', side: 'away', sport },
      { category: 'OVER_TOTAL', side: 'over', sport },
      { category: 'UNDER_TOTAL', side: 'under', sport },
      { category: 'ML_FAVORITE', side: 'home', sport },
      { category: 'ML_UNDERDOG', side: 'away', sport },
      { category: 'TEAM_TOTAL_OVER', side: 'over', sport },
      { category: 'TEAM_TOTAL_UNDER', side: 'under', sport },
    ];

    let seeded = 0;
    for (const tc of TEAM_CATEGORIES) {
      const key = `${tc.category}__${tc.side}`;
      if (!existingMap.has(key) && !categoryMap.has(key)) {
        const { error: seedError } = await supabase
          .from('bot_category_weights')
          .insert({
            category: tc.category,
            side: tc.side,
            sport: tc.sport,
            weight: BASE_WEIGHT,
            current_hit_rate: 0,
            total_picks: 0,
            total_hits: 0,
            is_blocked: false,
            current_streak: 0,
            best_streak: 0,
            worst_streak: 0,
            last_calibrated_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        if (!seedError) seeded++;
      }
    }

    if (seeded > 0) {
      console.log(`[Calibrate] Seeded ${seeded} new team prop categories`);
    }

    // 6. Send summary via Telegram — include rehabilitated count
    if (created > 0 || blocked > 0 || rehabilitated > 0) {
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
              rehabilitated,
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
