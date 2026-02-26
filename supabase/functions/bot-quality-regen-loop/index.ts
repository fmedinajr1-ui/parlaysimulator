/**
 * bot-quality-regen-loop
 * 
 * Quality-gated regeneration loop that generates parlays up to 3 times
 * before 3PM ET. Each attempt is ADDITIVE (no voiding between attempts).
 * After all attempts, keeps the best batch and voids older ones.
 * 
 * v2: Proper attribution via [source:quality_regen_attempt_X] tags.
 *     Adaptive target band instead of fixed threshold.
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
  attributionMethod: 'source_tag' | 'fallback_all';
}

async function scoreAttempt(
  supabase: any,
  today: string,
  attempt: number
): Promise<{ parlays: any[]; attributionMethod: 'source_tag' | 'fallback_all' }> {
  const sourceTag = `quality_regen_attempt_${attempt}`;

  // Primary: find parlays tagged with this attempt's source marker
  const { data: tagged } = await supabase
    .from('bot_daily_parlays')
    .select('id, legs, combined_probability, tier, strategy_name, selection_rationale')
    .eq('parlay_date', today)
    .eq('outcome', 'pending')
    .like('selection_rationale', `%[source:${sourceTag}]%`);

  if (tagged && tagged.length > 0) {
    return { parlays: tagged, attributionMethod: 'source_tag' };
  }

  // No tagged parlays found — this means attribution failed.
  // Do NOT fall back to all pending (that was the old bug).
  console.warn(`[QualityRegen] ⚠️ Attempt ${attempt}: 0 parlays matched source tag [source:${sourceTag}]. Attribution failure — treating as 0 output.`);
  return { parlays: [], attributionMethod: 'source_tag' };
}

function computeAdaptiveTarget(baselineAvg: number | null, requestedTarget: number): number {
  // If no baseline yet (first attempt), use requested target
  if (baselineAvg === null || baselineAvg <= 0) return requestedTarget;
  
  // Adaptive: baseline + 1.0%, clamped to [33, 36]
  const adaptive = Math.min(36, Math.max(33, baselineAvg + 1.0));
  console.log(`[QualityRegen] Adaptive target: baseline=${baselineAvg.toFixed(1)}% → target=${adaptive.toFixed(1)}% (requested=${requestedTarget}%)`);
  return adaptive;
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
    const requestedTargetHitRate = body.target_hit_rate ?? 35;
    const maxAttempts = Math.min(body.max_attempts ?? 3, 3);
    const skipVoid = body.skip_void ?? false;
    const useAdaptiveTarget = body.adaptive_target !== false; // Default: enabled
    const today = getEasternDate();

    console.log(`[QualityRegen] Starting for ${today} | requestedTarget=${requestedTargetHitRate}% | maxAttempts=${maxAttempts} | skipVoid=${skipVoid} | adaptive=${useAdaptiveTarget}`);

    const attempts: AttemptResult[] = [];
    let bestAttempt: AttemptResult | null = null;
    let baselineAvg: number | null = null;
    let effectiveTarget = requestedTargetHitRate;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const currentHour = getEasternHour();
      if (currentHour >= 15) {
        console.log(`[QualityRegen] ⏰ Past 3PM ET (hour=${currentHour}), stopping.`);
        break;
      }

      const regenBoost = attempt - 1;
      console.log(`[QualityRegen] === Attempt ${attempt}/${maxAttempts} (regen_boost=${regenBoost}) ===`);

      // Generate parlays with source tag for attribution
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
          attempts.push({ attempt, regenBoost, parlayCount: 0, avgProjectedHitRate: 0, meetsTarget: false, parlayIds: [], attributionMethod: 'source_tag' });
          continue;
        }
        await genResp.json();
      } catch (genErr) {
        console.error(`[QualityRegen] Generation error on attempt ${attempt}:`, genErr);
        attempts.push({ attempt, regenBoost, parlayCount: 0, avgProjectedHitRate: 0, meetsTarget: false, parlayIds: [], attributionMethod: 'source_tag' });
        continue;
      }

      // Score ONLY this attempt's parlays using source tag attribution
      const { parlays: parlaysToScore, attributionMethod } = await scoreAttempt(supabase, today, attempt);

      if (parlaysToScore.length === 0) {
        console.log(`[QualityRegen] Attempt ${attempt}: 0 parlays attributed (${attributionMethod})`);
        attempts.push({ attempt, regenBoost, parlayCount: 0, avgProjectedHitRate: 0, meetsTarget: false, parlayIds: [], attributionMethod });
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

      // Set baseline from attempt 1 for adaptive targeting
      if (attempt === 1) {
        baselineAvg = avgHitRate;
        if (useAdaptiveTarget) {
          effectiveTarget = computeAdaptiveTarget(baselineAvg, requestedTargetHitRate);
        }
      }

      const meetsTarget = avgHitRate >= effectiveTarget;
      const parlayIds = parlaysToScore.map((p: any) => p.id);

      const result: AttemptResult = {
        attempt,
        regenBoost,
        parlayCount: parlaysToScore.length,
        avgProjectedHitRate: Math.round(avgHitRate * 10) / 10,
        meetsTarget,
        parlayIds,
        attributionMethod,
      };

      attempts.push(result);
      console.log(`[QualityRegen] Attempt ${attempt}: ${parlaysToScore.length} parlays (${attributionMethod}), avg prob=${result.avgProjectedHitRate}%, target=${effectiveTarget.toFixed(1)}%, meets=${meetsTarget}`);

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
      message: `Quality regen: ${attempts.length} attempts, best=${bestAttempt?.avgProjectedHitRate || 0}%, target=${effectiveTarget.toFixed(1)}%, met=${targetMet}`,
      metadata: { 
        requested_target: requestedTargetHitRate, 
        effective_target: effectiveTarget,
        adaptive: useAdaptiveTarget,
        baseline_avg: baselineAvg,
        attempts, 
        best_attempt: bestAttempt?.attempt || 0, 
        target_met: targetMet, 
        date: today, 
        skip_void: skipVoid,
      },
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
            targetHitRate: effectiveTarget,
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
      requestedTargetHitRate,
      effectiveTarget,
      adaptiveTargetUsed: useAdaptiveTarget,
      baselineAvg,
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
