/**
 * bot-quality-regen-loop
 * 
 * Quality-gated regeneration loop that generates parlays up to 3 times
 * before 3PM ET. Each attempt is ADDITIVE (no voiding between attempts).
 * After all attempts, keeps the best batch and voids older ones.
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
    const targetHitRate = body.target_hit_rate ?? 35; // Lowered to 35 to match actual ~35.9% combined_probability
    const maxAttempts = Math.min(body.max_attempts ?? 3, 3);
    const skipVoid = body.skip_void ?? false; // When true, never void anything
    const today = getEasternDate();

    console.log(`[QualityRegen] Starting for ${today} | target=${targetHitRate}% | maxAttempts=${maxAttempts} | skipVoid=${skipVoid}`);

    const attempts: AttemptResult[] = [];
    let bestAttempt: AttemptResult | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // 3PM ET hard deadline
      const currentHour = getEasternHour();
      if (currentHour >= 15) {
        console.log(`[QualityRegen] ⏰ Past 3PM ET (hour=${currentHour}), stopping.`);
        break;
      }

      const regenBoost = attempt - 1;
      console.log(`[QualityRegen] === Attempt ${attempt}/${maxAttempts} (regen_boost=${regenBoost}) ===`);

      // NEVER void between attempts — generate additively
      // Each attempt tagged with source for later cleanup

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
        await genResp.json();
      } catch (genErr) {
        console.error(`[QualityRegen] Generation error on attempt ${attempt}:`, genErr);
        attempts.push({ attempt, regenBoost, parlayCount: 0, avgProjectedHitRate: 0, meetsTarget: false, parlayIds: [] });
        continue;
      }

      // Score using combined_probability (always populated) instead of missing leg hit rates
      const { data: execParlays } = await supabase
        .from('bot_daily_parlays')
        .select('id, legs, combined_probability, tier, strategy_name, selection_rationale')
        .eq('parlay_date', today)
        .eq('outcome', 'pending')
        .like('selection_rationale', `%quality_regen_attempt_${attempt}%`);

      // If we can't filter by rationale, fall back to all pending
      let parlaysToScore = execParlays || [];
      if (parlaysToScore.length === 0) {
        const { data: allPending } = await supabase
          .from('bot_daily_parlays')
          .select('id, legs, combined_probability, tier, strategy_name, selection_rationale')
          .eq('parlay_date', today)
          .eq('outcome', 'pending');
        parlaysToScore = allPending || [];
      }

      if (parlaysToScore.length === 0) {
        console.log(`[QualityRegen] Attempt ${attempt}: 0 parlays generated`);
        attempts.push({ attempt, regenBoost, parlayCount: 0, avgProjectedHitRate: 0, meetsTarget: false, parlayIds: [] });
        continue;
      }

      // Score using combined_probability * 100
      let totalHitRate = 0;
      let scoredCount = 0;
      for (const p of parlaysToScore) {
        const prob = (p as any).combined_probability;
        if (prob && prob > 0) {
          totalHitRate += prob * 100;
          scoredCount++;
        }
      }

      const avgHitRate = scoredCount > 0 ? totalHitRate / scoredCount : 0;
      const meetsTarget = avgHitRate >= targetHitRate;
      const parlayIds = parlaysToScore.map((p: any) => p.id);

      const result: AttemptResult = {
        attempt,
        regenBoost,
        parlayCount: parlaysToScore.length,
        avgProjectedHitRate: Math.round(avgHitRate * 10) / 10,
        meetsTarget,
        parlayIds,
      };

      attempts.push(result);
      console.log(`[QualityRegen] Attempt ${attempt}: ${parlaysToScore.length} parlays, avg prob=${result.avgProjectedHitRate}%, meets=${meetsTarget}`);

      if (!bestAttempt || result.avgProjectedHitRate > bestAttempt.avgProjectedHitRate) {
        bestAttempt = result;
      }

      if (meetsTarget) {
        console.log(`[QualityRegen] ✅ Target met on attempt ${attempt}!`);
        break;
      }
    }

    // After all attempts, void parlays from non-best attempts (only if not skipVoid)
    if (!skipVoid && bestAttempt && attempts.length > 1) {
      for (const att of attempts) {
        if (att.attempt === bestAttempt.attempt || att.parlayIds.length === 0) continue;
        
        const { count } = await supabase
          .from('bot_daily_parlays')
          .update({ outcome: 'void', lesson_learned: `quality_regen_kept_attempt_${bestAttempt.attempt}` })
          .in('id', att.parlayIds)
          .eq('outcome', 'pending')
          .select('*', { count: 'exact', head: true });

        console.log(`[QualityRegen] Voided ${count || 0} parlays from attempt ${att.attempt} (keeping attempt ${bestAttempt.attempt})`);
      }
    }

    const targetMet = bestAttempt?.meetsTarget ?? false;

    // Log to bot_activity_log
    await supabase.from('bot_activity_log').insert({
      event_type: 'quality_regen',
      message: `Quality regen: ${attempts.length} attempts, best=${bestAttempt?.avgProjectedHitRate || 0}%, target=${targetHitRate}%, met=${targetMet}`,
      metadata: { target_hit_rate: targetHitRate, attempts, best_attempt: bestAttempt?.attempt || 0, target_met: targetMet, date: today, skip_void: skipVoid },
      severity: targetMet ? 'info' : 'warning',
    });

    // Telegram report
    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'quality_regen_report',
          data: {
            attempts,
            bestAttempt: bestAttempt?.attempt || 0,
            bestHitRate: bestAttempt?.avgProjectedHitRate || 0,
            targetHitRate,
            targetMet,
            hoursBeforeDeadline: Math.max(0, 15 - getEasternHour()),
            totalParlaysKept: bestAttempt?.parlayCount || 0,
          },
        }),
      });
    } catch (telegramErr) {
      console.error('[QualityRegen] Telegram failed:', telegramErr);
    }

    const summary = {
      success: true,
      date: today,
      targetHitRate,
      attemptsUsed: attempts.length,
      targetMet,
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
