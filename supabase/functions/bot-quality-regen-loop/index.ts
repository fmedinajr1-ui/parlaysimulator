// v6.0 — Wide Generate → Rank → Select Best 25 (2026-03-18)
/**
 * bot-quality-regen-loop v6.0
 * 
 * New paradigm: Generate 60-80 diverse parlays (including contrarian flips),
 * score them all with a composite ranking, then select the top 25.
 * No voiding, no swapping — just selection from a wide pool.
 * 
 * Phases:
 *   A) Wide Generation — call bot-generate-daily-parlays (all tiers, no cap)
 *   B) Contrarian Injection — detect over-represented combos, generate flipped parlays
 *   C) Composite Ranking — score each parlay on probability + hit rate + diversity + contrarian bonus
 *   D) Select Top 25 — keep best, mark rest as pool_unselected
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FINAL_PARLAY_CAP = 25;
const MAX_PLAYER_IN_FINAL = 5; // safety net: no player in more than 5 of the final 25
const MAX_STRATEGY_PCT = 0.40; // no strategy > 40% of final 25

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

  // 1. Combined probability (0-1)
  const prob = parlay.combined_probability || 0;

  // 2. Average leg hit rate
  let totalHitRate = 0;
  let hitRateCount = 0;
  const playerKeys: string[] = [];
  for (const leg of legs) {
    const hr = leg.l10_hit_rate || leg.hit_rate || leg.confidence_score || 0;
    // Normalize: if > 1 it's a percentage, convert to 0-1
    totalHitRate += hr > 1 ? hr / 100 : hr;
    hitRateCount++;
    if (leg.player_name) {
      playerKeys.push(normalizePlayer(leg.player_name));
    }
  }
  const avgLegHitRate = hitRateCount > 0 ? totalHitRate / hitRateCount : 0;

  // 3. Diversity bonus: reward parlays with players NOT already heavily selected
  let diversityBonus = 0;
  for (const pk of playerKeys) {
    const count = selectedPlayerCounts.get(pk) || 0;
    if (count === 0) diversityBonus += 0.15; // new player = big bonus
    else if (count <= 2) diversityBonus += 0.05;
    else diversityBonus -= 0.05; // over-represented = penalty
  }
  diversityBonus = Math.max(-0.3, Math.min(0.5, diversityBonus / Math.max(playerKeys.length, 1)));

  // 4. Contrarian bonus
  const contrarianBonus = isContrarian ? 0.08 : 0;

  // 5. Strategy diversity: penalty if this strategy already dominates
  const stratKey = (parlay.strategy_name || 'unknown').split('_').slice(0, 2).join('_');
  const stratCount = selectedStratCounts.get(stratKey) || 0;
  const stratPenalty = stratCount >= Math.ceil(FINAL_PARLAY_CAP * MAX_STRATEGY_PCT) ? -0.15 : 0;

  // Weighted composite
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

    console.log(`[QualityRegen v6] Starting wide-generate → rank → select for ${today} | cap=${finalCap}`);

    // ════════════════════════════════════════════════════════════
    // PHASE A: Wide Generation
    // ════════════════════════════════════════════════════════════
    console.log(`[QualityRegen v6] === PHASE A: Wide Generation ===`);

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
        console.error(`[QualityRegen v6] Wide generation failed: ${errText}`);
      } else {
        const genResult = await genResp.json();
        console.log(`[QualityRegen v6] Wide generation complete: ${genResult.totalParlays || '?'} parlays`);
      }
    } catch (genErr) {
      console.error(`[QualityRegen v6] Generation error:`, genErr);
    }

    // ════════════════════════════════════════════════════════════
    // PHASE B: Contrarian Injection
    // ════════════════════════════════════════════════════════════
    console.log(`[QualityRegen v6] === PHASE B: Contrarian Injection ===`);

    // Fetch all pending parlays for today
    const { data: allPending } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, combined_probability, strategy_name, tier, selection_rationale')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    const pendingCount = (allPending || []).length;
    console.log(`[QualityRegen v6] Pool size: ${pendingCount} pending parlays`);

    // Detect over-represented player+prop+side combos
    const comboUsage = new Map<string, number>();
    for (const p of (allPending || [])) {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      for (const leg of legs) {
        if (!leg.player_name) continue;
        const key = `${normalizePlayer(leg.player_name)}|${(leg.prop_type || '').toLowerCase()}|${(leg.side || 'over').toLowerCase()}`;
        comboUsage.set(key, (comboUsage.get(key) || 0) + 1);
      }
    }

    // Find top 5 most over-represented combos (appearing 4+ times)
    const overRepresented = [...comboUsage.entries()]
      .filter(([, count]) => count >= 4)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    let contrarianGenerated = 0;
    if (overRepresented.length > 0) {
      console.log(`[QualityRegen v6] Over-represented combos: ${overRepresented.map(([k, c]) => `${k}(${c}x)`).join(', ')}`);

      // For each over-represented combo, generate 2-3 contrarian parlays via bot-generate-daily-parlays
      // with contrarian flag
      for (const [comboKey, count] of overRepresented) {
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
              // Generate just a few contrarian parlays
              tier: 'exploration',
              max_profiles: 3,
            }),
          });

          if (contResp.ok) {
            const contResult = await contResp.json();
            contrarianGenerated += contResult.totalParlays || 0;
            console.log(`[QualityRegen v6] Contrarian for ${playerName} ${propType} ${flippedSide}: ${contResult.totalParlays || 0} parlays`);
          }
        } catch (contErr) {
          console.warn(`[QualityRegen v6] Contrarian generation failed for ${comboKey}:`, contErr);
        }
      }
    } else {
      console.log(`[QualityRegen v6] No over-represented combos (all <4 appearances)`);
    }

    // ════════════════════════════════════════════════════════════
    // PHASE C: Composite Ranking
    // ════════════════════════════════════════════════════════════
    console.log(`[QualityRegen v6] === PHASE C: Composite Ranking ===`);

    // Re-fetch all pending parlays (including contrarian ones just generated)
    const { data: fullPool } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, combined_probability, strategy_name, tier, selection_rationale')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    const poolSize = (fullPool || []).length;
    console.log(`[QualityRegen v6] Full pool: ${poolSize} parlays (${contrarianGenerated} contrarian injected)`);

    if (poolSize === 0) {
      console.log(`[QualityRegen v6] No parlays to rank. Exiting.`);
      return new Response(JSON.stringify({ success: true, message: 'No parlays generated', selected: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === DEDUP PASS: Remove identical parlays (same leg fingerprint) ===
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
      console.log(`[QualityRegen v6] 🧹 Deduped ${dupeIds.length} identical parlays`);
    }

    // Get unique pool after dedup
    const uniquePool = (fullPool || []).filter(p => !dupeIds.includes(p.id));
    console.log(`[QualityRegen v6] Unique pool: ${uniquePool.length} parlays after dedup`);

    // Greedy selection: score → pick best → update diversity counters → re-score → repeat
    const selectedIds: string[] = [];
    const selectedPlayerCounts = new Map<string, number>();
    const selectedStratCounts = new Map<string, number>();
    const remaining = [...uniquePool];
    const contrarianIds = new Set(
      uniquePool
        .filter(p => (p.selection_rationale || '').includes('contrarian'))
        .map(p => p.id)
    );

    while (selectedIds.length < finalCap && remaining.length > 0) {
      // Score all remaining parlays with current diversity state
      const scored = remaining.map(p =>
        computeParlayComposite(p, selectedPlayerCounts, selectedStratCounts, contrarianIds.has(p.id))
      );

      // Sort by composite score descending
      scored.sort((a, b) => b.compositeScore - a.compositeScore);

      // Pick the best one that doesn't violate hard caps
      let picked = false;
      for (const candidate of scored) {
        // Check player cap
        let playerOk = true;
        for (const pk of candidate.playerKeys) {
          if ((selectedPlayerCounts.get(pk) || 0) >= MAX_PLAYER_IN_FINAL) {
            playerOk = false;
            break;
          }
        }
        if (!playerOk) continue;

        // Check strategy cap
        const stratKey = candidate.strategy_name.split('_').slice(0, 2).join('_');
        if ((selectedStratCounts.get(stratKey) || 0) >= Math.ceil(finalCap * MAX_STRATEGY_PCT)) continue;

        // Select this parlay
        selectedIds.push(candidate.id);
        for (const pk of candidate.playerKeys) {
          selectedPlayerCounts.set(pk, (selectedPlayerCounts.get(pk) || 0) + 1);
        }
        selectedStratCounts.set(stratKey, (selectedStratCounts.get(stratKey) || 0) + 1);

        // Remove from remaining
        const idx = remaining.findIndex(p => p.id === candidate.id);
        if (idx >= 0) remaining.splice(idx, 1);

        picked = true;
        break;
      }

      if (!picked) {
        console.log(`[QualityRegen v6] No more eligible parlays (caps hit). Selected ${selectedIds.length}/${finalCap}`);
        break;
      }
    }

    // ════════════════════════════════════════════════════════════
    // PHASE D: Select Top 25, Mark Rest as pool_unselected
    // ════════════════════════════════════════════════════════════
    console.log(`[QualityRegen v6] === PHASE D: Selecting top ${selectedIds.length} ===`);

    // Mark unselected parlays
    const unselectedIds = uniquePool
      .filter(p => !selectedIds.includes(p.id))
      .map(p => p.id);

    if (unselectedIds.length > 0) {
      for (let i = 0; i < unselectedIds.length; i += 100) {
        const chunk = unselectedIds.slice(i, i + 100);
        await supabase
          .from('bot_daily_parlays')
          .update({ outcome: 'pool_unselected', lesson_learned: 'wide_pool_rank_not_selected' })
          .in('id', chunk)
          .eq('outcome', 'pending');
      }
      console.log(`[QualityRegen v6] Marked ${unselectedIds.length} parlays as pool_unselected`);
    }

    // Log selection summary
    const contrarianSelected = selectedIds.filter(id => contrarianIds.has(id)).length;
    const stratSummary: Record<string, number> = {};
    for (const [k, v] of selectedStratCounts) stratSummary[k] = v;
    const playerSummary: Record<string, number> = {};
    for (const [k, v] of selectedPlayerCounts) {
      if (v >= 3) playerSummary[k] = v; // only log players with 3+ appearances
    }

    console.log(`[QualityRegen v6] ✅ Selected ${selectedIds.length} parlays from ${uniquePool.length} pool`);
    console.log(`[QualityRegen v6] Contrarian selected: ${contrarianSelected}`);
    console.log(`[QualityRegen v6] Strategy distribution: ${JSON.stringify(stratSummary)}`);
    if (Object.keys(playerSummary).length > 0) {
      console.log(`[QualityRegen v6] High-exposure players (3+): ${JSON.stringify(playerSummary)}`);
    }

    // Activity log
    await supabase.from('bot_activity_log').insert({
      event_type: 'quality_regen_wide_select',
      message: `Wide pool: ${poolSize} → ${uniquePool.length} (dedup ${dupeIds.length}) → selected ${selectedIds.length}/${finalCap} (${contrarianSelected} contrarian)`,
      metadata: {
        date: today,
        poolSize,
        deduplicated: dupeIds.length,
        uniquePool: uniquePool.length,
        selected: selectedIds.length,
        contrarianInjected: contrarianGenerated,
        contrarianSelected,
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
            version: 'v6.0-wide-select',
            poolSize,
            deduped: dupeIds.length,
            selected: selectedIds.length,
            cap: finalCap,
            contrarianInjected: contrarianGenerated,
            contrarianSelected,
            strategyDistribution: stratSummary,
          },
        }),
      });
    } catch (tgErr) {
      console.error('[QualityRegen v6] Telegram failed:', tgErr);
    }

    const summary = {
      success: true,
      version: 'v6.0-wide-select',
      date: today,
      poolSize,
      deduplicated: dupeIds.length,
      uniquePool: uniquePool.length,
      selected: selectedIds.length,
      finalCap,
      contrarianInjected: contrarianGenerated,
      contrarianSelected,
      strategyDistribution: stratSummary,
    };

    console.log('[QualityRegen v6] Complete:', JSON.stringify(summary));
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QualityRegen v6] Fatal error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
