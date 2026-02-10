/**
 * bot-settle-and-learn (v2 - Calibration Integration)
 * 
 * Settles yesterday's parlays, updates category weights based on outcomes,
 * syncs weights from category_sweet_spots verified outcomes, and tracks activation progress.
 * 
 * Now includes:
 * - Direct sync from category_sweet_spots settled outcomes (last 24h)
 * - Streak-based weight adjustments for bot parlay legs
 * - Auto-blocking for underperforming categories
 * - Triggers calibrate-bot-weights after processing
 * 
 * Runs 3x daily via cron (6 AM, 12 PM, 6 PM ET).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// EST-aware date helper to avoid UTC date mismatch after 7 PM EST
function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Learning constants
const WEIGHT_BOOST_BASE = 0.02;
const WEIGHT_BOOST_STREAK = 0.005;
const WEIGHT_PENALTY_BASE = 0.03;
const WEIGHT_PENALTY_STREAK = 0.01;
const MIN_WEIGHT = 0.5;
const MAX_WEIGHT = 1.5;

// Blocking thresholds
const BLOCK_STREAK_THRESHOLD = -5; // Block after 5 consecutive misses
const BLOCK_HIT_RATE_THRESHOLD = 35; // Block if hit rate drops below 35%
const BLOCK_MIN_SAMPLES = 20;

interface BotLeg {
  id: string;
  player_name: string;
  team_name: string;
  prop_type: string;
  line: number;
  side: string;
  category: string;
  weight: number;
  hit_rate: number;
  outcome?: string;
  actual_value?: number;
}

interface RecentOutcome {
  category: string;
  recommended_side: string;
  outcome: string;
  settled_at: string;
}

function adjustWeight(
  currentWeight: number,
  hit: boolean,
  currentStreak: number
): { newWeight: number; blocked: boolean; newStreak: number; blockReason?: string } {
  let newStreak = currentStreak;
  
  if (hit) {
    newStreak = Math.max(1, currentStreak + 1);
    const boost = WEIGHT_BOOST_BASE + (Math.max(0, newStreak - 1) * WEIGHT_BOOST_STREAK);
    return {
      newWeight: Math.min(currentWeight + boost, MAX_WEIGHT),
      blocked: false,
      newStreak,
    };
  } else {
    newStreak = Math.min(-1, currentStreak - 1);
    const absStreak = Math.abs(newStreak);
    const penalty = WEIGHT_PENALTY_BASE + ((absStreak - 1) * WEIGHT_PENALTY_STREAK);
    const newWeight = currentWeight - penalty;
    
    // Check streak-based blocking
    if (newStreak <= BLOCK_STREAK_THRESHOLD) {
      return { 
        newWeight: 0, 
        blocked: true, 
        newStreak,
        blockReason: `${absStreak} consecutive misses`,
      };
    }
    
    if (newWeight < MIN_WEIGHT) {
      return { 
        newWeight: 0, 
        blocked: true, 
        newStreak,
        blockReason: 'Weight dropped below minimum threshold',
      };
    }
    return { newWeight: Math.max(newWeight, MIN_WEIGHT), blocked: false, newStreak };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Accept targetDate from request body, or settle both yesterday and today
    let targetDates: string[] = [];
    try {
      const body = await req.json();
      if (body.date) {
        targetDates = [body.date];
      }
    } catch {
      // No body - use defaults
    }

    if (targetDates.length === 0) {
      const todayStr = getEasternDate();
      // Calculate yesterday in Eastern time
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(yesterday);
      targetDates = [yesterdayStr, todayStr];
    }

    console.log(`[Bot Settle] Processing parlays for dates: ${targetDates.join(', ')}`);

    // 0. Pre-step: Verify sweet spot outcomes for target dates BEFORE settlement
    // This ensures picks are graded (hit/miss) so parlays can be settled
    for (const targetDate of targetDates) {
      try {
        console.log(`[Bot Settle] Triggering verify-sweet-spot-outcomes for ${targetDate}...`);
        const { data: verifyData, error: verifyError } = await supabase.functions.invoke('verify-sweet-spot-outcomes', {
          body: { date: targetDate },
        });
        if (verifyError) {
          console.error(`[Bot Settle] Verification error for ${targetDate}:`, verifyError);
        } else {
          console.log(`[Bot Settle] Verification result for ${targetDate}:`, JSON.stringify(verifyData));
        }
      } catch (vErr) {
        console.error(`[Bot Settle] Verification invoke failed for ${targetDate}:`, vErr);
      }
    }

    // Brief pause to let verification complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 1. Get pending parlays from target dates
    const { data: pendingParlays, error: parlaysError } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .in('parlay_date', targetDates)
      .eq('outcome', 'pending');

    if (parlaysError) throw parlaysError;

    if (!pendingParlays || pendingParlays.length === 0) {
      console.log('[Bot Settle] No pending parlays to settle');
      return new Response(
        JSON.stringify({ success: true, parlaysSettled: 0, message: 'No pending parlays' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[Bot Settle] Found ${pendingParlays.length} pending parlays`);

    // 2. Load category weights for learning
    const { data: categoryWeights, error: weightsError } = await supabase
      .from('bot_category_weights')
      .select('*');

    if (weightsError) throw weightsError;

    const weightMap = new Map<string, any>();
    (categoryWeights || []).forEach((w: any) => {
      weightMap.set(w.category, w);
    });

    // 3. For each parlay, check leg outcomes
    let parlaysSettled = 0;
    let parlaysWon = 0;
    let parlaysLost = 0;
    let totalProfitLoss = 0;
    const categoryUpdates = new Map<string, { hits: number; misses: number }>();

    for (const parlay of pendingParlays) {
      const legs = (Array.isArray(parlay.legs) ? parlay.legs : JSON.parse(parlay.legs)) as BotLeg[];
      let legsHit = 0;
      let legsMissed = 0;
      let legsVoided = 0;
      const updatedLegs: BotLeg[] = [];

      for (const leg of legs) {
        // Check outcome from category_sweet_spots
        const { data: sweetSpot } = await supabase
          .from('category_sweet_spots')
          .select('outcome, actual_value')
          .eq('id', leg.id)
          .maybeSingle();

        if (sweetSpot) {
          let legOutcome: string;
          if (sweetSpot.outcome === 'hit') {
            legOutcome = 'hit';
            legsHit++;
          } else if (sweetSpot.outcome === 'miss') {
            legOutcome = 'miss';
            legsMissed++;
          } else if (sweetSpot.outcome === 'no_data') {
            // Player didn't play — void this leg
            legOutcome = 'void';
            legsVoided++;
          } else {
            legOutcome = 'pending';
          }

          updatedLegs.push({
            ...leg,
            outcome: legOutcome,
            actual_value: sweetSpot.actual_value,
          });

          // Track for category weight updates
          if (legOutcome === 'hit' || legOutcome === 'miss') {
            const existing = categoryUpdates.get(leg.category) || { hits: 0, misses: 0 };
            if (legOutcome === 'hit') {
              existing.hits++;
            } else {
              existing.misses++;
            }
            categoryUpdates.set(leg.category, existing);
          }
        } else {
          updatedLegs.push(leg);
        }
      }

      // Determine parlay outcome
      // Voided legs (no_data = player didn't play) are excluded from grading
      const activeLegCount = legs.length - legsVoided;
      let outcome = 'pending';
      let profitLoss = 0;
      
      if (activeLegCount === 0 || legsVoided > legs.length / 2) {
        // All or majority of legs voided — void entire parlay
        outcome = 'void';
        parlaysSettled++;
      } else if (legsHit + legsMissed === activeLegCount) {
        if (legsMissed === 0) {
          outcome = 'won';
          // Calculate payout: stake * (odds / 100 + 1)
          const payout = (parlay.simulated_stake || 50) * ((parlay.expected_odds || 500) / 100 + 1);
          profitLoss = payout - (parlay.simulated_stake || 50);
          parlaysWon++;
        } else {
          outcome = 'lost';
          profitLoss = -(parlay.simulated_stake || 50);
          parlaysLost++;
        }
        parlaysSettled++;
        totalProfitLoss += profitLoss;
    }
      // If some legs missed but not all settled yet, keep as pending
      // Only mark lost when ALL legs have been graded

      // Update parlay
      await supabase
        .from('bot_daily_parlays')
        .update({
          legs: updatedLegs,
          outcome,
          legs_hit: legsHit,
          legs_missed: legsMissed,
          profit_loss: profitLoss,
          simulated_payout: outcome === 'won' ? profitLoss + (parlay.simulated_stake || 50) : 0,
          settled_at: outcome !== 'pending' ? new Date().toISOString() : null,
        })
        .eq('id', parlay.id);
    }

    console.log(`[Bot Settle] Settled ${parlaysSettled} parlays (${parlaysWon}W ${parlaysLost}L)`);

    // 4. Update category weights based on outcomes and collect deltas
    const weightChanges: Array<{ category: string; oldWeight: number; newWeight: number; delta: number }> = [];
    
    for (const [category, stats] of categoryUpdates) {
      const existing = weightMap.get(category);
      if (!existing) continue;

      const oldWeight = existing.weight;
      let currentWeight = existing.weight;
      let currentStreak = existing.current_streak;

      for (let i = 0; i < stats.hits; i++) {
        const result = adjustWeight(currentWeight, true, currentStreak);
        currentWeight = result.newWeight;
        currentStreak = result.newStreak;
      }

      for (let i = 0; i < stats.misses; i++) {
        const result = adjustWeight(currentWeight, false, currentStreak);
        currentWeight = result.newWeight;
        currentStreak = result.newStreak;
      }

      // Track weight change
      if (currentWeight !== oldWeight) {
        weightChanges.push({
          category,
          oldWeight,
          newWeight: currentWeight,
          delta: currentWeight - oldWeight,
        });
      }

      // Update in database
      await supabase
        .from('bot_category_weights')
        .update({
          weight: currentWeight,
          is_blocked: currentWeight === 0,
          block_reason: currentWeight === 0 ? 'Weight dropped below threshold' : null,
          current_streak: currentStreak,
          best_streak: Math.max(existing.best_streak || 0, currentStreak > 0 ? currentStreak : 0),
          worst_streak: Math.min(existing.worst_streak || 0, currentStreak < 0 ? currentStreak : 0),
          total_picks: (existing.total_picks || 0) + stats.hits + stats.misses,
          total_hits: (existing.total_hits || 0) + stats.hits,
          current_hit_rate: ((existing.total_hits || 0) + stats.hits) / 
                           ((existing.total_picks || 0) + stats.hits + stats.misses) * 100,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    }

    // 5. Update activation status
    const today = getEasternDate();
    const isProfitableDay = totalProfitLoss > 0;

    // Get previous day's status for consecutive days calculation
    const { data: prevStatus } = await supabase
      .from('bot_activation_status')
      .select('*')
      .lt('check_date', today)
      .order('check_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const prevConsecutive = prevStatus?.consecutive_profitable_days || 0;
    const newConsecutive = isProfitableDay ? prevConsecutive + 1 : 0;
    const prevBankroll = prevStatus?.simulated_bankroll || 1000;
    const newBankroll = prevBankroll + totalProfitLoss;

    // Check if ready for real mode
    const isRealModeReady = newConsecutive >= 3 && 
                            (parlaysWon / Math.max(1, parlaysWon + parlaysLost)) >= 0.60;

    const { data: existingToday } = await supabase
      .from('bot_activation_status')
      .select('*')
      .eq('check_date', today)
      .maybeSingle();

    if (existingToday) {
      await supabase
        .from('bot_activation_status')
        .update({
          parlays_won: (existingToday.parlays_won || 0) + parlaysWon,
          parlays_lost: (existingToday.parlays_lost || 0) + parlaysLost,
          daily_profit_loss: totalProfitLoss,
          is_profitable_day: isProfitableDay,
          consecutive_profitable_days: newConsecutive,
          is_real_mode_ready: isRealModeReady,
          simulated_bankroll: newBankroll,
          activated_at: isRealModeReady && !existingToday.is_real_mode_ready 
            ? new Date().toISOString() 
            : existingToday.activated_at,
        })
        .eq('id', existingToday.id);
    } else {
      await supabase
        .from('bot_activation_status')
        .insert({
          check_date: today,
          parlays_won: parlaysWon,
          parlays_lost: parlaysLost,
          daily_profit_loss: totalProfitLoss,
          is_profitable_day: isProfitableDay,
          consecutive_profitable_days: newConsecutive,
          is_real_mode_ready: isRealModeReady,
          simulated_bankroll: newBankroll,
          activated_at: isRealModeReady ? new Date().toISOString() : null,
        });
    }

    // 6. Update strategy performance
    if (parlaysSettled > 0) {
      const { data: strategy } = await supabase
        .from('bot_strategies')
        .select('*')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (strategy) {
        const newTimesWon = (strategy.times_won || 0) + parlaysWon;
        const newTimesUsed = strategy.times_used || 0;
        const newWinRate = newTimesUsed > 0 ? newTimesWon / newTimesUsed : 0;

        await supabase
          .from('bot_strategies')
          .update({
            times_won: newTimesWon,
            win_rate: newWinRate,
            updated_at: new Date().toISOString(),
          })
          .eq('id', strategy.id);
      }
    }

    console.log(`[Bot Settle] Complete. P/L: $${totalProfitLoss}, Consecutive: ${newConsecutive}`);

    // 7. Sync weights from recently settled category_sweet_spots (last 24h)
    // This provides continuous learning from verified outcomes beyond bot parlays
    let sweetSpotSynced = 0;
    try {
      const yesterday24h = new Date();
      yesterday24h.setHours(yesterday24h.getHours() - 24);
      
      const { data: recentOutcomes, error: recentError } = await supabase
        .from('category_sweet_spots')
        .select('category, recommended_side, outcome, settled_at')
        .gte('settled_at', yesterday24h.toISOString())
        .not('outcome', 'is', null);

      if (!recentError && recentOutcomes && recentOutcomes.length > 0) {
        // Group by category+side
        const outcomeMap = new Map<string, { hits: number; misses: number }>();
        
        for (const outcome of recentOutcomes as RecentOutcome[]) {
          const key = `${outcome.category}__${outcome.recommended_side || 'over'}`;
          let stats = outcomeMap.get(key);
          if (!stats) {
            stats = { hits: 0, misses: 0 };
            outcomeMap.set(key, stats);
          }
          
          if (outcome.outcome === 'hit') {
            stats.hits++;
          } else if (outcome.outcome === 'miss') {
            stats.misses++;
          }
        }

        // Apply incremental learning to each category
        for (const [key, stats] of outcomeMap) {
          const [category, side] = key.split('__');
          
          const { data: existingWeight } = await supabase
            .from('bot_category_weights')
            .select('*')
            .eq('category', category)
            .eq('side', side)
            .maybeSingle();

          if (existingWeight && !existingWeight.is_blocked) {
            let currentWeight = existingWeight.weight || 1.0;
            let currentStreak = existingWeight.current_streak || 0;
            let blocked = false;
            let blockReason: string | null = null;

            // Apply learning for hits first, then misses
            for (let i = 0; i < stats.hits; i++) {
              const result = adjustWeight(currentWeight, true, currentStreak);
              currentWeight = result.newWeight;
              currentStreak = result.newStreak;
            }

            for (let i = 0; i < stats.misses; i++) {
              const result = adjustWeight(currentWeight, false, currentStreak);
              currentWeight = result.newWeight;
              currentStreak = result.newStreak;
              if (result.blocked) {
                blocked = true;
                blockReason = result.blockReason || 'Weight dropped below threshold';
              }
            }

            // Check hit rate blocking
            const newTotalPicks = (existingWeight.total_picks || 0) + stats.hits + stats.misses;
            const newTotalHits = (existingWeight.total_hits || 0) + stats.hits;
            const newHitRate = newTotalPicks > 0 ? (newTotalHits / newTotalPicks) * 100 : 0;

            if (newTotalPicks >= BLOCK_MIN_SAMPLES && newHitRate < BLOCK_HIT_RATE_THRESHOLD) {
              blocked = true;
              blockReason = `Hit rate ${newHitRate.toFixed(1)}% below ${BLOCK_HIT_RATE_THRESHOLD}% with ${newTotalPicks} samples`;
              currentWeight = 0;
            }

            await supabase
              .from('bot_category_weights')
              .update({
                weight: currentWeight,
                is_blocked: blocked,
                block_reason: blockReason,
                current_streak: currentStreak,
                best_streak: Math.max(existingWeight.best_streak || 0, currentStreak > 0 ? currentStreak : 0),
                worst_streak: Math.min(existingWeight.worst_streak || 0, currentStreak < 0 ? currentStreak : 0),
                total_picks: newTotalPicks,
                total_hits: newTotalHits,
                current_hit_rate: newHitRate,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingWeight.id);

            sweetSpotSynced++;
          }
        }
        
        console.log(`[Bot Settle] Synced ${sweetSpotSynced} categories from ${recentOutcomes.length} sweet spot outcomes`);
      }
    } catch (syncError) {
      console.error('[Bot Settle] Sweet spot sync error:', syncError);
    }

    // 8. Trigger calibration function for full recalculation
    try {
      await fetch(`${supabaseUrl}/functions/v1/calibrate-bot-weights`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({ fullRebuild: false }),
      });
      console.log('[Bot Settle] Calibration triggered');
    } catch (calibrateError) {
      console.error('[Bot Settle] Calibration trigger failed:', calibrateError);
    }

    // 9. Log activity
    await supabase.from('bot_activity_log').insert({
      event_type: 'settlement_complete',
      message: `Settled ${parlaysSettled} parlays: ${parlaysWon}W ${parlaysLost}L | Synced ${sweetSpotSynced} categories`,
      metadata: { 
        parlaysWon,
        parlaysLost,
        totalProfitLoss,
        consecutiveDays: newConsecutive,
        isRealModeReady,
        newBankroll,
        sweetSpotSynced,
        categoryUpdates: Array.from(categoryUpdates.entries()).map(([cat, stats]) => ({
          category: cat,
          hits: stats.hits,
          misses: stats.misses,
        })),
      },
      severity: isProfitableDay ? 'success' : 'warning',
    });

    // 10. Gather strategy info and blocked categories for Telegram
    let activeStrategyName: string | undefined;
    let activeStrategyWinRate: number | undefined;
    let blockedCategories: string[] = [];

    try {
      const { data: activeStrategy } = await supabase
        .from('bot_strategies')
        .select('strategy_name, win_rate')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (activeStrategy) {
        activeStrategyName = activeStrategy.strategy_name;
        activeStrategyWinRate = activeStrategy.win_rate ?? undefined;
      }

      const { data: blockedRows } = await supabase
        .from('bot_category_weights')
        .select('category, side')
        .eq('is_blocked', true)
        .limit(10);

      if (blockedRows) {
        blockedCategories = blockedRows.map(r => `${r.category}_${r.side}`);
      }
    } catch (stratError) {
      console.error('[Bot Settle] Strategy/blocked query error:', stratError);
    }

    // Send Telegram notification
    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          type: isRealModeReady && !prevStatus?.is_real_mode_ready ? 'activation_ready' : 'settlement_complete',
          data: {
            parlaysWon,
            parlaysLost,
            profitLoss: totalProfitLoss,
            consecutiveDays: newConsecutive,
            bankroll: newBankroll,
            isRealModeReady,
            sweetSpotSynced,
            winRate: parlaysWon + parlaysLost > 0 
              ? Math.round((parlaysWon / (parlaysWon + parlaysLost)) * 100) 
              : 0,
            weightChanges,
            strategyName: activeStrategyName,
            strategyWinRate: activeStrategyWinRate,
            blockedCategories,
          },
        }),
      });
      console.log('[Bot Settle] Telegram notification sent');
    } catch (telegramError) {
      console.error('[Bot Settle] Telegram notification failed:', telegramError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        parlaysSettled,
        parlaysWon,
        parlaysLost,
        totalProfitLoss,
        isProfitableDay,
        consecutiveProfitDays: newConsecutive,
        isRealModeReady,
        newBankroll,
        sweetSpotSynced,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Bot Settle] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
