// v7.0 — Wide Generate → Rank → Keep All Valid (Reverted aggressive caps)
/**
 * bot-quality-regen-loop v7.0
 * 
 * REVERTED from v6.0 based on backtest showing 82% void rate.
 * 
 * Changes from v6.0:
 * - Raised final cap from 25 → 50 (let more parlays survive)
 * - Raised player cap from 5 → 10
 * - Raised strategy cap from 40% → 60%
 * - Unselected parlays stay as 'pending' instead of being marked 'pool_unselected'
 *   (pool_unselected was functionally a void, killing 40+ parlays daily)
 * - Dedup still runs (legitimate)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// REVERTED: raised caps significantly
const FINAL_PARLAY_CAP = 50;
const MAX_PLAYER_IN_FINAL = 10;
const MAX_STRATEGY_PCT = 0.60;

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizePlayer(name: string): string {
  return (name || '').toLowerCase().trim();
}

interface ScoredParlay {
  id: string;
  legs: any[];
  combined_probability: number;
  strategy_name: string;
  tier: string;
  compositeScore: number;
  avgLegHitRate: number;
  diversityBonus: number;
  contrarianBonus: number;
  playerKeys: string[];
}

function computeParlayComposite(
  parlay: any,
  selectedPlayerCounts: Map<string, number>,
  selectedStratCounts: Map<string, number>,
  isContrarian: boolean,
): ScoredParlay {
  const legs = Array.isArray(parlay.legs) ? parlay.legs : [];

  const prob = parlay.combined_probability || 0;

  let totalHitRate = 0;
  let hitRateCount = 0;
  const playerKeys: string[] = [];
  for (const leg of legs) {
    const hr = leg.l10_hit_rate || leg.hit_rate || leg.confidence_score || 0;
    totalHitRate += hr > 1 ? hr / 100 : hr;
    hitRateCount++;
    if (leg.player_name) {
      playerKeys.push(normalizePlayer(leg.player_name));
    }
  }
  const avgLegHitRate = hitRateCount > 0 ? totalHitRate / hitRateCount : 0;

  let diversityBonus = 0;
  for (const pk of playerKeys) {
    const count = selectedPlayerCounts.get(pk) || 0;
    if (count === 0) diversityBonus += 0.15;
    else if (count <= 2) diversityBonus += 0.05;
    else diversityBonus -= 0.05;
  }
  diversityBonus = Math.max(-0.3, Math.min(0.5, diversityBonus / Math.max(playerKeys.length, 1)));

  const contrarianBonus = isContrarian ? 0.08 : 0;

  const stratKey = (parlay.strategy_name || 'unknown').split('_').slice(0, 2).join('_');
  const stratCount = selectedStratCounts.get(stratKey) || 0;
  const stratPenalty = stratCount >= Math.ceil(FINAL_PARLAY_CAP * MAX_STRATEGY_PCT) ? -0.15 : 0;

  const compositeScore =
    (prob * 0.40) +
    (avgLegHitRate * 0.30) +
    (diversityBonus * 0.20) +
    (contrarianBonus * 0.10) +
    stratPenalty;

  return {
    id: parlay.id,
    legs,
    combined_probability: prob,
    strategy_name: parlay.strategy_name || 'unknown',
    tier: parlay.tier || 'unknown',
    compositeScore,
    avgLegHitRate,
    diversityBonus,
    contrarianBonus,
    playerKeys,
  };
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
    const today = getEasternDate();
    const finalCap = body.final_cap ?? FINAL_PARLAY_CAP;

    console.log(`[QualityRegen v7] Starting wide-generate → rank → select for ${today} | cap=${finalCap}`);

    // ════════════════════════════════════════════════════════════
    // PHASE A: Wide Generation
    // ════════════════════════════════════════════════════════════
    console.log(`[QualityRegen v7] === PHASE A: Wide Generation ===`);

    try {
      const genResp = await fetch(`${supabaseUrl}/functions/v1/bot-generate-daily-parlays`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'quality_regen_wide',
          wide_mode: true,
        }),
      });

      if (!genResp.ok) {
        const errText = await genResp.text();
        console.error(`[QualityRegen v7] Wide generation failed: ${errText}`);
      } else {
        const genResult = await genResp.json();
        console.log(`[QualityRegen v7] Wide generation complete: ${genResult.totalParlays || '?'} parlays`);
      }
    } catch (genErr) {
      console.error(`[QualityRegen v7] Generation error:`, genErr);
    }

    // ════════════════════════════════════════════════════════════
    // PHASE B: Contrarian Injection (unchanged)
    // ════════════════════════════════════════════════════════════
    console.log(`[QualityRegen v7] === PHASE B: Contrarian Injection ===`);

    const { data: allPending } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, combined_probability, strategy_name, tier, selection_rationale')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    const pendingCount = (allPending || []).length;
    console.log(`[QualityRegen v7] Pool size: ${pendingCount} pending parlays`);

    const comboUsage = new Map<string, number>();
    for (const p of (allPending || [])) {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      for (const leg of legs) {
        if (!leg.player_name) continue;
        const key = `${normalizePlayer(leg.player_name)}|${(leg.prop_type || '').toLowerCase()}|${(leg.side || 'over').toLowerCase()}`;
        comboUsage.set(key, (comboUsage.get(key) || 0) + 1);
      }
    }

    const overRepresented = [...comboUsage.entries()]
      .filter(([, count]) => count >= 4)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    let contrarianGenerated = 0;
    if (overRepresented.length > 0) {
      console.log(`[QualityRegen v7] Over-represented combos: ${overRepresented.map(([k, c]) => `${k}(${c}x)`).join(', ')}`);

      for (const [comboKey] of overRepresented) {
        const [playerName, propType, side] = comboKey.split('|');
        const flippedSide = side === 'over' ? 'under' : 'over';

        try {
          const contResp = await fetch(`${supabaseUrl}/functions/v1/bot-generate-daily-parlays`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              source: 'quality_regen_contrarian',
              contrarian: true,
              contrarian_target: {
                player_name: playerName,
                prop_type: propType,
                original_side: side,
                flipped_side: flippedSide,
              },
              tier: 'exploration',
              max_profiles: 3,
            }),
          });

          if (contResp.ok) {
            const contResult = await contResp.json();
            contrarianGenerated += contResult.totalParlays || 0;
            console.log(`[QualityRegen v7] Contrarian for ${playerName} ${propType} ${flippedSide}: ${contResult.totalParlays || 0} parlays`);
          }
        } catch (contErr) {
          console.warn(`[QualityRegen v7] Contrarian generation failed for ${comboKey}:`, contErr);
        }
      }
    } else {
      console.log(`[QualityRegen v7] No over-represented combos (all <4 appearances)`);
    }

    // ════════════════════════════════════════════════════════════
    // PHASE C: Dedup Only (NO ranking/selection void)
    // ════════════════════════════════════════════════════════════
    console.log(`[QualityRegen v7] === PHASE C: Dedup + Rank ===`);

    const { data: fullPool } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, combined_probability, strategy_name, tier, selection_rationale')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    const poolSize = (fullPool || []).length;
    console.log(`[QualityRegen v7] Full pool: ${poolSize} parlays (${contrarianGenerated} contrarian injected)`);

    if (poolSize === 0) {
      console.log(`[QualityRegen v7] No parlays to rank. Exiting.`);
      return new Response(JSON.stringify({ success: true, message: 'No parlays generated', selected: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === DEDUP PASS: Remove identical parlays (legitimate) ===
    const seenFingerprints = new Map<string, string>();
    const dupeIds: string[] = [];
    for (const p of (fullPool || [])) {
      const fingerprint = JSON.stringify(
        (Array.isArray(p.legs) ? p.legs : [])
          .map((l: any) => `${normalizePlayer(l.player_name || '')}_${(l.prop_type || '').toLowerCase()}_${(l.side || '').toLowerCase()}`)
          .sort()
      );
      if (seenFingerprints.has(fingerprint)) {
        dupeIds.push(p.id);
      } else {
        seenFingerprints.set(fingerprint, p.id);
      }
    }

    if (dupeIds.length > 0) {
      for (let i = 0; i < dupeIds.length; i += 100) {
        const chunk = dupeIds.slice(i, i + 100);
        await supabase
          .from('bot_daily_parlays')
          .update({ outcome: 'void', lesson_learned: 'wide_pool_dedup_identical' })
          .in('id', chunk)
          .eq('outcome', 'pending');
      }
      console.log(`[QualityRegen v7] 🧹 Deduped ${dupeIds.length} identical parlays`);
    }

    // REVERTED: v6 would greedy-select top 25 and mark rest as pool_unselected (=void).
    // v7 keeps ALL unique parlays as pending. Only dedup voids are applied.
    // The diversity rebalancer downstream will handle extreme outliers only.

    const uniquePool = (fullPool || []).filter(p => !dupeIds.includes(p.id));
    console.log(`[QualityRegen v7] ✅ ${uniquePool.length} parlays remain pending (deduped ${dupeIds.length})`);

    // Still compute scores for logging/reporting purposes
    const selectedPlayerCounts = new Map<string, number>();
    const selectedStratCounts = new Map<string, number>();
    const contrarianIds = new Set(
      uniquePool
        .filter(p => (p.selection_rationale || '').includes('contrarian'))
        .map(p => p.id)
    );

    for (const p of uniquePool) {
      const scored = computeParlayComposite(p, selectedPlayerCounts, selectedStratCounts, contrarianIds.has(p.id));
      for (const pk of scored.playerKeys) {
        selectedPlayerCounts.set(pk, (selectedPlayerCounts.get(pk) || 0) + 1);
      }
      const stratKey = scored.strategy_name.split('_').slice(0, 2).join('_');
      selectedStratCounts.set(stratKey, (selectedStratCounts.get(stratKey) || 0) + 1);
    }

    const contrarianKept = uniquePool.filter(p => contrarianIds.has(p.id)).length;
    const stratSummary: Record<string, number> = {};
    for (const [k, v] of selectedStratCounts) stratSummary[k] = v;
    const playerSummary: Record<string, number> = {};
    for (const [k, v] of selectedPlayerCounts) {
      if (v >= 3) playerSummary[k] = v;
    }

    console.log(`[QualityRegen v7] Strategy distribution: ${JSON.stringify(stratSummary)}`);

    // Activity log
    await supabase.from('bot_activity_log').insert({
      event_type: 'quality_regen_wide_select',
      message: `v7 Pool: ${poolSize} → dedup ${dupeIds.length} → ${uniquePool.length} kept pending (NO selection void)`,
      metadata: {
        version: 'v7.0-no-selection-void',
        date: today,
        poolSize,
        deduplicated: dupeIds.length,
        keptPending: uniquePool.length,
        contrarianInjected: contrarianGenerated,
        contrarianKept,
        strategyDistribution: stratSummary,
        highExposurePlayers: playerSummary,
      },
      severity: 'success',
    });

    // Telegram report
    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'quality_regen_report',
          data: {
            version: 'v7.0-no-selection-void',
            poolSize,
            deduped: dupeIds.length,
            keptPending: uniquePool.length,
            contrarianInjected: contrarianGenerated,
            contrarianKept,
            strategyDistribution: stratSummary,
          },
        }),
      });
    } catch (tgErr) {
      console.error('[QualityRegen v7] Telegram failed:', tgErr);
    }

    const summary = {
      success: true,
      version: 'v7.0-no-selection-void',
      date: today,
      poolSize,
      deduplicated: dupeIds.length,
      keptPending: uniquePool.length,
      contrarianInjected: contrarianGenerated,
      contrarianKept,
      strategyDistribution: stratSummary,
    };

    console.log('[QualityRegen v7] Complete:', JSON.stringify(summary));
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QualityRegen v7] Fatal error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
