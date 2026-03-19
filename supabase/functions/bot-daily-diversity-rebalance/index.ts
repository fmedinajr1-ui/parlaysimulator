/**
 * bot-daily-diversity-rebalance v5.0 — Minimal Safety Net (Reverted)
 * 
 * REVERTED from v4.0 aggressive caps based on backtest showing
 * 82% void rate post-Mar12 (vs 42% pre-Mar12).
 * 
 * v5.0 changes:
 * - Raised player appearance cap from 5 → 10
 * - Raised strategy family cap from 40% → 60%
 * - Only voids extreme outliers, NOT moderate duplicates
 * - Volume-aware stake scaling unchanged
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VERSION = 'diversity-rebalance-v5.0-minimal';

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

function normalizePlayerName(name: string): string {
  return (name || '').toLowerCase().trim();
}

function getStrategyFamily(strategyName: string): string {
  const name = (strategyName || 'unknown').toLowerCase();
  const parts = name.split('_');
  return parts.length >= 2 ? `${parts[0]}_${parts[1]}` : name;
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
    const today = body.date || getEasternDate();
    // REVERTED: raised from 5 → 10
    const maxPlayerAppearances = body.max_player_appearances ?? 10;
    // REVERTED: raised from 40% → 60%
    const maxStrategyPct = body.max_strategy_pct ?? 0.60;

    console.log(`[DiversityRebalance] ${VERSION} | date=${today} | playerCap=${maxPlayerAppearances} | stratPct=${maxStrategyPct}`);

    // Fetch pending parlays
    const { data: pending, error } = await supabase
      .from('bot_daily_parlays')
      .select('id, strategy_name, combined_probability, tier, legs')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    if (error) throw error;

    const totalCount = (pending || []).length;
    if (totalCount === 0) {
      return new Response(JSON.stringify({ success: true, version: VERSION, message: 'No pending parlays', voided: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[DiversityRebalance] ${totalCount} pending parlays to validate`);

    let totalVoided = 0;
    const voidReasons: Record<string, number> = {};

    // ═══════════════════════════════════════════════════════════
    // PASS 1: Global Player Appearance Cap (10)
    // ═══════════════════════════════════════════════════════════
    const playerUsage = new Map<string, string[]>();

    for (const p of (pending || [])) {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      for (const leg of legs as any[]) {
        const name = normalizePlayerName(leg.player_name || leg.playerName || leg.player || '');
        if (!name) continue;
        if (!playerUsage.has(name)) playerUsage.set(name, []);
        const list = playerUsage.get(name)!;
        if (!list.includes(p.id)) list.push(p.id);
      }
    }

    const playerVoidIds = new Set<string>();
    for (const [player, parlayIds] of playerUsage) {
      if (parlayIds.length <= maxPlayerAppearances) continue;
      const toVoid = parlayIds.slice(maxPlayerAppearances);
      for (const id of toVoid) {
        playerVoidIds.add(id);
      }
      console.log(`[DiversityRebalance] Player ${player}: ${parlayIds.length} appearances → voiding ${toVoid.length} (keeping ${maxPlayerAppearances})`);
    }

    if (playerVoidIds.size > 0) {
      const ids = [...playerVoidIds];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { count } = await supabase
          .from('bot_daily_parlays')
          .update({ outcome: 'void', lesson_learned: 'diversity_v5_player_cap' })
          .in('id', chunk)
          .eq('outcome', 'pending')
          .select('*', { count: 'exact', head: true });
        totalVoided += (count || 0);
      }
      voidReasons['player_cap'] = playerVoidIds.size;
    }

    // ═══════════════════════════════════════════════════════════
    // PASS 2: Strategy Family Cap (60%)
    // ═══════════════════════════════════════════════════════════
    const { data: remaining } = await supabase
      .from('bot_daily_parlays')
      .select('id, strategy_name, combined_probability')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    const remainingCount = (remaining || []).length;
    const maxPerFamily = Math.max(5, Math.ceil(remainingCount * maxStrategyPct));

    const familyCounts = new Map<string, { kept: number; toVoid: string[] }>();
    for (const p of (remaining || [])) {
      const family = getStrategyFamily(p.strategy_name);
      const entry = familyCounts.get(family) || { kept: 0, toVoid: [] };
      if (entry.kept < maxPerFamily) {
        entry.kept++;
      } else {
        entry.toVoid.push(p.id);
      }
      familyCounts.set(family, entry);
    }

    let strategyVoided = 0;
    for (const [family, entry] of familyCounts) {
      if (entry.toVoid.length === 0) continue;
      const { count } = await supabase
        .from('bot_daily_parlays')
        .update({ outcome: 'void', lesson_learned: `diversity_v5_strategy_cap_${maxPerFamily}` })
        .in('id', entry.toVoid)
        .eq('outcome', 'pending')
        .select('*', { count: 'exact', head: true });
      strategyVoided += (count || 0);
      console.log(`[DiversityRebalance] ${family}: kept ${entry.kept}, voided ${count || 0}`);
    }
    totalVoided += strategyVoided;
    if (strategyVoided > 0) voidReasons['strategy_cap'] = strategyVoided;

    // ═══════════════════════════════════════════════════════════
    // PASS 3: Volume-Aware Stake Scaling
    // ═══════════════════════════════════════════════════════════
    const { count: finalCount } = await supabase
      .from('bot_daily_parlays')
      .select('*', { count: 'exact', head: true })
      .eq('parlay_date', today)
      .eq('outcome', 'pending');

    const totalAfter = finalCount ?? (totalCount - totalVoided);

    let volumeMultiplier = 1.0;
    let stakesAdjusted = 0;
    if (totalAfter <= 3) {
      volumeMultiplier = 0.5;
    } else if (totalAfter <= 6) {
      volumeMultiplier = 0.75;
    }

    if (volumeMultiplier < 1.0) {
      const { data: survivors } = await supabase
        .from('bot_daily_parlays')
        .select('id, simulated_stake, simulated_payout')
        .eq('parlay_date', today)
        .eq('outcome', 'pending');

      for (const s of (survivors || [])) {
        const newStake = Math.round(((s.simulated_stake || 0) * volumeMultiplier) * 100) / 100;
        const newPayout = Math.round(((s.simulated_payout || 0) * volumeMultiplier) * 100) / 100;
        if (newStake !== s.simulated_stake || newPayout !== s.simulated_payout) {
          await supabase
            .from('bot_daily_parlays')
            .update({ simulated_stake: newStake, simulated_payout: newPayout })
            .eq('id', s.id);
          stakesAdjusted++;
        }
      }
      console.log(`[DiversityRebalance] Volume-scaled: ${totalAfter} parlays → ${volumeMultiplier}× (${stakesAdjusted} adjusted)`);
    }

    // Activity log
    await supabase.from('bot_activity_log').insert({
      event_type: 'diversity_rebalance',
      message: `Validation: ${totalCount} → ${totalAfter} parlays (voided ${totalVoided}, stake ${volumeMultiplier}×)`,
      metadata: {
        version: VERSION,
        date: today,
        totalBefore: totalCount,
        totalAfter,
        totalVoided,
        voidReasons,
        maxPlayerAppearances,
        maxPerFamily,
        volumeMultiplier,
        stakesAdjusted,
      },
      severity: totalVoided > 0 ? 'info' : 'success',
    });

    return new Response(JSON.stringify({
      success: true,
      version: VERSION,
      date: today,
      totalBefore: totalCount,
      totalAfter,
      totalVoided,
      voidReasons,
      volumeMultiplier,
      stakesAdjusted,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[DiversityRebalance] Error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
