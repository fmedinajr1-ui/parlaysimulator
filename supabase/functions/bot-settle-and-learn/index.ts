/**
 * bot-settle-and-learn
 * 
 * Settles yesterday's parlays, updates category weights based on outcomes,
 * and tracks activation progress.
 * Runs at 6 AM ET daily via cron.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function adjustWeight(
  currentWeight: number,
  hit: boolean,
  currentStreak: number
): { newWeight: number; blocked: boolean; newStreak: number } {
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
    
    if (newWeight < MIN_WEIGHT) {
      return { newWeight: 0, blocked: true, newStreak };
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

    // Get yesterday's date
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const targetDate = yesterday.toISOString().split('T')[0];

    console.log(`[Bot Settle] Processing parlays for ${targetDate}`);

    // 1. Get pending parlays from yesterday
    const { data: pendingParlays, error: parlaysError } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .eq('parlay_date', targetDate)
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
          } else {
            legOutcome = 'pending';
          }

          updatedLegs.push({
            ...leg,
            outcome: legOutcome,
            actual_value: sweetSpot.actual_value,
          });

          // Track for category weight updates
          if (legOutcome !== 'pending') {
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
      let outcome = 'pending';
      let profitLoss = 0;
      
      if (legsHit + legsMissed === legs.length) {
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
      } else if (legsHit + legsMissed > 0 && legsMissed > 0) {
        // Some settled, some missed = lost
        outcome = 'lost';
        profitLoss = -(parlay.simulated_stake || 50);
        parlaysLost++;
        parlaysSettled++;
        totalProfitLoss += profitLoss;
      }

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

    // 4. Update category weights based on outcomes
    for (const [category, stats] of categoryUpdates) {
      const existing = weightMap.get(category);
      if (!existing) continue;

      // Apply learning for each hit/miss
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
    const today = new Date().toISOString().split('T')[0];
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

    // 7. Log activity
    await supabase.from('bot_activity_log').insert({
      event_type: 'settlement_complete',
      message: `Settled ${parlaysSettled} parlays: ${parlaysWon}W ${parlaysLost}L`,
      metadata: { 
        parlaysWon,
        parlaysLost,
        totalProfitLoss,
        consecutiveDays: newConsecutive,
        isRealModeReady,
        newBankroll,
      },
      severity: isProfitableDay ? 'success' : 'warning',
    });

    // 8. Send Telegram notification
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
            winRate: parlaysWon + parlaysLost > 0 
              ? Math.round((parlaysWon / (parlaysWon + parlaysLost)) * 100) 
              : 0,
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
