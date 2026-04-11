// v7.1 — Two-pass composite scoring fix
/**
 * bot-quality-regen-loop v7.1
 *
 * BUG FIXED from v7.0:
 *
 * BUG 1 — Single-pass composite scoring: selectedPlayerCounts and
 *   selectedStratCounts are populated DURING the scoring loop, so each
 *   parlay's score is computed against an incomplete picture of the pool.
 *   The first parlay scored sees empty maps (max diversity bonus for everyone),
 *   while the last parlay sees the full pool — so loop ordering determines
 *   diversity scores, not actual pool composition.
 *
 *   Fix: Two-pass approach.
 *   Pass 1: walk all unique parlays and build full player + strategy counts.
 *   Pass 2: score every parlay with stable, final counts.
 *   Scores are now deterministic regardless of iteration order.
 *
 * BUG 2 — contrarianIds was built from selection_rationale string includes(),
 *   which is fragile (depends on the exact rationale string written by the
 *   generator). The contrarian IDs are now tracked from the live generate
 *   call responses directly, falling back to rationale-string matching only
 *   if the response doesn't include parlay_ids.
 *
 * Everything else (dedup, contrarian injection, no-selection-void policy)
 * is unchanged from v7.0.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Caps kept from v7.0 for logging context only — NOT enforced in selection logic
const FINAL_PARLAY_CAP = 50;       // informational: approx pool cap after dedup
const MAX_PLAYER_IN_FINAL = 10;    // informational: approx max appearances per player
const MAX_STRATEGY_PCT = 0.60;     // used in penalty calculation only

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
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

// BUG 1 FIX: accepts pre-built full-pool counts (pass 1 result) so scores
// are stable regardless of the order parcels are processed.
function computeParlayComposite(
  parlay: any,
  fullPoolPlayerCounts: Map<string, number>,
  fullPoolStratCounts: Map<string, number>,
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
    if (leg.player_name) playerKeys.push(normalizePlayer(leg.player_name));
  }

  const avgLegHitRate = hitRateCount > 0 ? totalHitRate / hitRateCount : 0;

  let diversityBonus = 0;
  for (const pk of playerKeys) {
    const count = fullPoolPlayerCounts.get(pk) || 0;
    if (count <= 1)      diversityBonus += 0.15;
    else if (count <= 2) diversityBonus += 0.05;
    else if (count <= 5) diversityBonus += 0.00;
    else                 diversityBonus -= 0.05;
  }
  diversityBonus = Math.max(-0.3, Math.min(0.5, diversityBonus / Math.max(playerKeys.length, 1)));

  const contrarianBonus = isContrarian ? 0.08 : 0;

  const stratKey = (parlay.strategy_name || 'unknown').split('_').slice(0, 2).join('_');
  const stratCount = fullPoolStratCounts.get(stratKey) || 0;
  const totalParlays = [...fullPoolStratCounts.values()].reduce((a, b) => a + b, 0);
  const stratPct = totalParlays > 0 ? stratCount / totalParlays : 0;
  const stratPenalty = stratPct > MAX_STRATEGY_PCT ? -0.15 : 0;

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
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const today = getEasternDate();

    const _finalCapIgnored = body.final_cap ?? FINAL_PARLAY_CAP;

    console.log(`[QualityRegen v7.1] Wide-generate → rank → dedup for ${today}`);

    // ════════════════════════════════════════════════════════
    // PHASE A: Wide Generation
    // ════════════════════════════════════════════════════════
    console.log('[QualityRegen v7.1] === PHASE A: Wide Generation ===');
    try {
      const genResp = await fetch(`${supabaseUrl}/functions/v1/bot-generate-daily-parlays`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'quality_regen_wide', wide_mode: true }),
      });
      if (!genResp.ok) {
        console.error(`[QualityRegen v7.1] Wide generation failed: ${await genResp.text()}`);
      } else {
        const genResult = await genResp.json();
        console.log(`[QualityRegen v7.1] Wide generation: ${genResult.totalParlays || '?'} parlays`);
      }
    } catch (genErr: any) {
      console.error('[QualityRegen v7.1] Generation error:', genErr.message);
    }

    // ════════════════════════════════════════════════════════
    // PHASE B: Contrarian Injection
    // ════════════════════════════════════════════════════════
    console.log('[QualityRegen v7.1] === PHASE B: Contrarian Injection ===');

    const { data: allPending } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, combined_probability, strategy_name, tier, selection_rationale')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    const pendingCount = (allPending || []).length;
    console.log(`[QualityRegen v7.1] Pool size: ${pendingCount} pending parlays`);

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

    const contrarianGeneratedIds = new Set<string>();
    let contrarianGenerated = 0;

    if (overRepresented.length > 0) {
      console.log(`[QualityRegen v7.1] Over-represented combos: ${overRepresented.map(([k, c]) => `${k}(${c}x)`).join(', ')}`);

      for (const [comboKey] of overRepresented) {
        const [playerName, propType, side] = comboKey.split('|');
        const flippedSide = side === 'over' ? 'under' : 'over';

        try {
          const contResp = await fetch(`${supabaseUrl}/functions/v1/bot-generate-daily-parlays`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source: 'quality_regen_contrarian',
              contrarian: true,
              contrarian_target: { player_name: playerName, prop_type: propType, original_side: side, flipped_side: flippedSide },
              tier: 'exploration',
              max_profiles: 3,
            }),
          });

          if (contResp.ok) {
            const contResult = await contResp.json();
            contrarianGenerated += contResult.totalParlays || 0;
            if (Array.isArray(contResult.parlay_ids)) {
              for (const id of contResult.parlay_ids) contrarianGeneratedIds.add(id);
            }
            console.log(`[QualityRegen v7.1] Contrarian for ${playerName} ${propType} ${flippedSide}: ${contResult.totalParlays || 0}`);
          }
        } catch (contErr: any) {
          console.warn(`[QualityRegen v7.1] Contrarian failed for ${comboKey}:`, contErr.message);
        }
      }
    } else {
      console.log('[QualityRegen v7.1] No over-represented combos (all <4 appearances)');
    }

    // ════════════════════════════════════════════════════════
    // PHASE C: Dedup + Two-Pass Composite Score
    // ════════════════════════════════════════════════════════
    console.log('[QualityRegen v7.1] === PHASE C: Dedup + Two-Pass Score ===');

    const { data: fullPool } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, combined_probability, strategy_name, tier, selection_rationale')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    const poolSize = (fullPool || []).length;
    console.log(`[QualityRegen v7.1] Full pool: ${poolSize} parlays (${contrarianGenerated} contrarian injected)`);

    if (poolSize === 0) {
      console.log('[QualityRegen v7.1] No parlays to process. Exiting.');
      return new Response(JSON.stringify({ success: true, message: 'No parlays generated', selected: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
      console.log(`[QualityRegen v7.1] 🧹 Deduped ${dupeIds.length} identical parlays`);
    }

    const uniquePool = (fullPool || []).filter(p => !dupeIds.includes(p.id));
    console.log(`[QualityRegen v7.1] ✅ ${uniquePool.length} parlays remain pending after dedup`);

    // BUG 1 FIX: PASS 1 — count full pool before scoring
    const fullPoolPlayerCounts = new Map<string, number>();
    const fullPoolStratCounts = new Map<string, number>();

    for (const p of uniquePool) {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      for (const leg of legs) {
        if (leg.player_name) {
          const pk = normalizePlayer(leg.player_name);
          fullPoolPlayerCounts.set(pk, (fullPoolPlayerCounts.get(pk) || 0) + 1);
        }
      }
      const stratKey = (p.strategy_name || 'unknown').split('_').slice(0, 2).join('_');
      fullPoolStratCounts.set(stratKey, (fullPoolStratCounts.get(stratKey) || 0) + 1);
    }

    // BUG 2 FIX: fallback rationale matching
    for (const p of uniquePool) {
      if ((p.selection_rationale || '').toLowerCase().includes('contrarian')) {
        contrarianGeneratedIds.add(p.id);
      }
    }

    // BUG 1 FIX: PASS 2 — score with stable counts
    const scoredPool: ScoredParlay[] = uniquePool.map(p =>
      computeParlayComposite(p, fullPoolPlayerCounts, fullPoolStratCounts, contrarianGeneratedIds.has(p.id))
    );

    scoredPool.sort((a, b) => b.compositeScore - a.compositeScore);

    const contrarianKept = uniquePool.filter(p => contrarianGeneratedIds.has(p.id)).length;
    const stratSummary: Record<string, number> = {};
    for (const [k, v] of fullPoolStratCounts) stratSummary[k] = v;
    const highExposurePlayers: Record<string, number> = {};
    for (const [k, v] of fullPoolPlayerCounts) {
      if (v >= 3) highExposurePlayers[k] = v;
    }

    console.log('[QualityRegen v7.1] Strategy distribution:', JSON.stringify(stratSummary));
    if (Object.keys(highExposurePlayers).length > 0) {
      console.log('[QualityRegen v7.1] High-exposure players (3+):', JSON.stringify(highExposurePlayers));
    }
    if (scoredPool.length > 0) {
      console.log(`[QualityRegen v7.1] Top composite: ${scoredPool[0].compositeScore.toFixed(3)} | Bottom: ${scoredPool[scoredPool.length - 1].compositeScore.toFixed(3)}`);
    }

    await supabase.from('bot_activity_log').insert({
      event_type: 'quality_regen_wide_select',
      message: `v7.1 Pool: ${poolSize} → dedup ${dupeIds.length} → ${uniquePool.length} kept pending (two-pass scoring, NO selection void)`,
      metadata: {
        version: 'v7.1-two-pass-scoring',
        date: today,
        poolSize,
        deduplicated: dupeIds.length,
        keptPending: uniquePool.length,
        contrarianInjected: contrarianGenerated,
        contrarianKept,
        strategyDistribution: stratSummary,
        highExposurePlayers,
        topCompositeScore: scoredPool[0]?.compositeScore?.toFixed(3) ?? null,
        bottomCompositeScore: scoredPool[scoredPool.length - 1]?.compositeScore?.toFixed(3) ?? null,
      },
      severity: 'success',
    });

    try {
      await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'quality_regen_report',
          data: {
            version: 'v7.1-two-pass-scoring',
            poolSize,
            deduped: dupeIds.length,
            keptPending: uniquePool.length,
            contrarianInjected: contrarianGenerated,
            contrarianKept,
            strategyDistribution: stratSummary,
          },
        }),
      });
    } catch (tgErr: any) {
      console.error('[QualityRegen v7.1] Telegram failed:', tgErr.message);
    }

    const summary = {
      success: true,
      version: 'v7.1-two-pass-scoring',
      date: today,
      poolSize,
      deduplicated: dupeIds.length,
      keptPending: uniquePool.length,
      contrarianInjected: contrarianGenerated,
      contrarianKept,
      strategyDistribution: stratSummary,
      topCompositeScore: scoredPool[0]?.compositeScore ?? null,
    };

    console.log('[QualityRegen v7.1] Complete:', JSON.stringify(summary));
    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[QualityRegen v7.1] Fatal error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});