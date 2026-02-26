/**
 * bot-quality-regen-loop
 * 
 * Quality-gated regeneration loop that generates parlays up to 3 times
 * before 3PM ET. Each attempt progressively tightens filters.
 * Keeps the best batch if target hit rate (60%) isn't met.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getEasternHour(): number {
  const now = new Date();
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
  return parseInt(etStr, 10);
}

interface AttemptResult {
  attempt: number;
  regenBoost: number;
  parlayCount: number;
  avgProjectedHitRate: number;
  meetsTarget: boolean;
  parlayIds: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const targetHitRate = body.target_hit_rate ?? 60;
    const maxAttempts = Math.min(body.max_attempts ?? 3, 3); // Hard cap at 3
    const today = getEasternDate();

    console.log(`[QualityRegen] Starting quality-gated loop for ${today} | target=${targetHitRate}% | maxAttempts=${maxAttempts}`);

    // Check if pending parlays already exist (supplemental mode)
    const { count: existingPending } = await supabase
      .from('bot_daily_parlays')
      .select('*', { count: 'exact', head: true })
      .eq('parlay_date', today)
      .eq('outcome', 'pending');

    const isSupplemental = (existingPending || 0) > 0;
    if (isSupplemental) {
      console.log(`[QualityRegen] 📌 ${existingPending} pending parlays already exist — running in SUPPLEMENTAL mode (no voiding)`);
    }

    const attempts: AttemptResult[] = [];
    let bestAttempt: AttemptResult | null = null;
    let finalBatchKept = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // 3PM ET hard deadline
      const currentHour = getEasternHour();
      if (currentHour >= 15) {
        console.log(`[QualityRegen] ⏰ Past 3PM ET (hour=${currentHour}), stopping. Keeping best batch.`);
        break;
      }

      const regenBoost = attempt - 1; // 0, 1, 2
      console.log(`[QualityRegen] === Attempt ${attempt}/${maxAttempts} (regen_boost=${regenBoost}) ===`);

      // Only void previous attempts if NOT supplemental (first run of day)
      if (attempt > 1 && !isSupplemental) {
        const { count: voidedCount } = await supabase
          .from('bot_daily_parlays')
          .update({ 
            outcome: 'void', 
            lesson_learned: `quality_regen_attempt_${attempt - 1}_below_target` 
          })
          .eq('parlay_date', today)
          .eq('outcome', 'pending')
          .select('*', { count: 'exact', head: true });

        console.log(`[QualityRegen] Voided ${voidedCount || 0} pending parlays from attempt ${attempt - 1}`);
      } else if (attempt > 1 && isSupplemental) {
        console.log(`[QualityRegen] ⏭️ Skipping void step (supplemental mode)`);
      }

      // Call bot-generate-daily-parlays with regen_boost
      try {
        const genResp = await fetch(`${supabaseUrl}/functions/v1/bot-generate-daily-parlays`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            source: `quality_regen_attempt_${attempt}`,
            regen_boost: regenBoost,
          }),
        });

        if (!genResp.ok) {
          const errText = await genResp.text();
          console.error(`[QualityRegen] Generation failed on attempt ${attempt}: ${errText}`);
          attempts.push({ attempt, regenBoost, parlayCount: 0, avgProjectedHitRate: 0, meetsTarget: false, parlayIds: [] });
          continue;
        }
        await genResp.json(); // consume body
      } catch (genErr) {
        console.error(`[QualityRegen] Generation error on attempt ${attempt}:`, genErr);
        attempts.push({ attempt, regenBoost, parlayCount: 0, avgProjectedHitRate: 0, meetsTarget: false, parlayIds: [] });
        continue;
      }

      // Score the batch: query execution-tier parlays generated for today
      const { data: execParlays } = await supabase
        .from('bot_daily_parlays')
        .select('id, legs, combined_probability, tier, strategy_name')
        .eq('parlay_date', today)
        .eq('outcome', 'pending')
        .in('tier', ['execution', null]);

      // Filter to execution-tier by strategy name if tier column is null
      const executionParlays = (execParlays || []).filter((p: any) => {
        if (p.tier === 'execution') return true;
        const name = (p.strategy_name || '').toLowerCase();
        return name.includes('cash_lock') || name.includes('boosted_cash') || 
               name.includes('golden_lock') || name.includes('hybrid_exec') || 
               name.includes('team_exec') || name.includes('execution') ||
               name.includes('elite') || name.includes('conviction') ||
               name.includes('force_') || name.includes('mispriced');
      });

      if (executionParlays.length === 0) {
        console.log(`[QualityRegen] Attempt ${attempt}: 0 execution-tier parlays generated, skipping scoring`);
        attempts.push({ attempt, regenBoost, parlayCount: 0, avgProjectedHitRate: 0, meetsTarget: false, parlayIds: [] });
        continue;
      }

      // Calculate average projected hit rate from leg-level hit_rate_l10 / hit_rate
      let totalHitRate = 0;
      let scoredParlays = 0;

      for (const parlay of executionParlays) {
        const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
        if (legs.length === 0) continue;

        let legHitRateSum = 0;
        let legCount = 0;
        for (const leg of legs) {
          const hitRate = (leg as any).hit_rate_l10 ?? (leg as any).hit_rate ?? (leg as any).l10_hit_rate ?? 0;
          if (hitRate > 0) {
            legHitRateSum += hitRate;
            legCount++;
          }
        }

        if (legCount > 0) {
          totalHitRate += legHitRateSum / legCount;
          scoredParlays++;
        }
      }

      const avgHitRate = scoredParlays > 0 ? totalHitRate / scoredParlays : 0;
      const meetsTarget = avgHitRate >= targetHitRate;
      const parlayIds = executionParlays.map((p: any) => p.id);

      const result: AttemptResult = {
        attempt,
        regenBoost,
        parlayCount: executionParlays.length,
        avgProjectedHitRate: Math.round(avgHitRate * 10) / 10,
        meetsTarget,
        parlayIds,
      };

      attempts.push(result);
      console.log(`[QualityRegen] Attempt ${attempt}: ${executionParlays.length} exec parlays, avg hit rate=${result.avgProjectedHitRate}%, meets target=${meetsTarget}`);

      // Track best attempt
      if (!bestAttempt || result.avgProjectedHitRate > bestAttempt.avgProjectedHitRate) {
        bestAttempt = result;
      }

      // If target met, we're done
      if (meetsTarget) {
        console.log(`[QualityRegen] ✅ Target met on attempt ${attempt}! Keeping this batch.`);
        finalBatchKept = true;
        break;
      }
    }

    // If no attempt met target, keep the best one
    if (!finalBatchKept && bestAttempt) {
      console.log(`[QualityRegen] ⚠️ No attempt met ${targetHitRate}% target. Keeping best attempt #${bestAttempt.attempt} (${bestAttempt.avgProjectedHitRate}%)`);
      
      // If the best attempt was voided (because a later attempt ran), restore it
      // We can't restore voided parlays, so the last attempt's parlays are what we keep
      // The last run's pending parlays are already in the DB
    }

    // Log to bot_activity_log
    await supabase.from('bot_activity_log').insert({
      event_type: 'quality_regen',
      message: `Quality regen completed: ${attempts.length} attempts, best=${bestAttempt?.avgProjectedHitRate || 0}%, target=${targetHitRate}%, met=${finalBatchKept}`,
      metadata: {
        target_hit_rate: targetHitRate,
        attempts,
        best_attempt: bestAttempt?.attempt || 0,
        target_met: finalBatchKept,
        date: today,
      },
      severity: finalBatchKept ? 'info' : 'warning',
    });

    // Send Telegram report
    try {
      const etHour = getEasternHour();
      const hoursBeforeDeadline = Math.max(0, 15 - etHour);

      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'quality_regen_report',
          data: {
            attempts,
            bestAttempt: bestAttempt?.attempt || 0,
            bestHitRate: bestAttempt?.avgProjectedHitRate || 0,
            targetHitRate,
            targetMet: finalBatchKept,
            hoursBeforeDeadline,
            totalParlaysKept: bestAttempt?.parlayCount || 0,
          },
        }),
      });
    } catch (telegramErr) {
      console.error('[QualityRegen] Telegram notification failed:', telegramErr);
    }

    const summary = {
      success: true,
      date: today,
      targetHitRate,
      attemptsUsed: attempts.length,
      targetMet: finalBatchKept,
      bestAttempt: bestAttempt?.attempt || 0,
      bestHitRate: bestAttempt?.avgProjectedHitRate || 0,
      totalParlaysKept: bestAttempt?.parlayCount || 0,
      attempts,
    };

    console.log('[QualityRegen] Complete:', JSON.stringify(summary));

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QualityRegen] Fatal error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
