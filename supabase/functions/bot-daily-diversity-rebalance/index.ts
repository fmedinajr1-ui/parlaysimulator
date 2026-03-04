/**
 * bot-daily-diversity-rebalance
 * 
 * Post-rebuild pass that:
 * 1. Caps any single strategy family at 30% of the total pending daily slate
 * 2. Enforces max-1-per-player-prop across ALL pending parlays (global exposure cap)
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

/** Extract base strategy family from full strategy_name */
function getStrategyFamily(strategyName: string): string {
  const name = (strategyName || 'unknown').toLowerCase();
  const families = [
    'mispriced_edge', 'category_momentum', 'hot_streak', 'trend_follower',
    'archetype_match', 'composite_elite', 'bankroll_doubler', 'monster_parlay',
    'master_parlay', 'leftover_sweep', 'round_robin',
  ];
  for (const f of families) {
    if (name.startsWith(f)) return f;
  }
  const parts = name.split('_');
  return parts.length >= 2 ? `${parts[0]}_${parts[1]}` : name;
}

/** Normalize prop type: strip "player_" prefix for consistent matching */
function normalizePropType(propType: string): string {
  return (propType || '').replace(/^player_/i, '').toLowerCase().trim();
}

/** Normalize player name for consistent matching */
function normalizePlayerName(name: string): string {
  return (name || '').toLowerCase().trim();
}

/** Extract player-prop keys from a parlay's legs JSONB */
function extractPlayerPropKeys(legs: any): string[] {
  const keys: string[] = [];
  if (!Array.isArray(legs)) return keys;
  for (const leg of legs) {
    const player = normalizePlayerName(leg.player_name || leg.playerName || leg.player || '');
    const prop = normalizePropType(leg.prop_type || leg.propType || leg.prop || leg.market || '');
    if (player && prop) {
      keys.push(`${player}|${prop}`);
    }
  }
  return keys;
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
    const maxPct = body.max_strategy_pct ?? 0.30;
    const maxPlayerPropUsage = body.max_player_prop_usage ?? 1; // Global cap: 1 parlay per player-prop
    const today = body.date || getEasternDate();

    // ═══════════════════════════════════════════════════════════════
    // PASS 1: Strategy Family Cap (30%)
    // ═══════════════════════════════════════════════════════════════

    const { data: pending, error } = await supabase
      .from('bot_daily_parlays')
      .select('id, strategy_name, combined_probability, tier, created_at')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    if (error) throw error;

    const totalCount = (pending || []).length;
    if (totalCount === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No pending parlays to rebalance', voided: 0, exposureVoided: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const maxPerFamily = Math.max(2, Math.ceil(totalCount * maxPct));
    console.log(`[DiversityRebalance] ${totalCount} pending parlays, max per family: ${maxPerFamily} (${(maxPct * 100).toFixed(0)}%)`);

    // Count by family
    const familyCounts = new Map<string, { kept: number; toVoid: string[] }>();
    
    for (const p of pending!) {
      const family = getStrategyFamily(p.strategy_name);
      const entry = familyCounts.get(family) || { kept: 0, toVoid: [] };
      
      if (entry.kept < maxPerFamily) {
        entry.kept++;
      } else {
        entry.toVoid.push(p.id);
      }
      familyCounts.set(family, entry);
    }

    // Void excess from strategy cap
    let totalVoided = 0;
    const voidDetails: Record<string, number> = {};
    const strategyVoidedIds = new Set<string>();

    for (const [family, entry] of familyCounts) {
      if (entry.toVoid.length === 0) continue;
      
      const { count } = await supabase
        .from('bot_daily_parlays')
        .update({ outcome: 'void', lesson_learned: `diversity_rebalance_cap_${maxPerFamily}` })
        .in('id', entry.toVoid)
        .eq('outcome', 'pending')
        .select('*', { count: 'exact', head: true });

      const voided = count || 0;
      totalVoided += voided;
      voidDetails[family] = voided;
      entry.toVoid.forEach(id => strategyVoidedIds.add(id));
      console.log(`[DiversityRebalance] ${family}: kept ${entry.kept}, voided ${voided}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // PASS 2: Player-Prop Exposure Cap (max 1 per player-prop combo)
    // ═══════════════════════════════════════════════════════════════

    console.log(`[DiversityRebalance] Starting player-prop exposure pass (max ${maxPlayerPropUsage} per combo)...`);

    // Re-fetch remaining pending parlays WITH legs data
    const { data: remainingParlays, error: err2 } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, combined_probability, strategy_name, tier')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false }); // Highest prob first = kept

    if (err2) throw err2;

    // Build map: player|prop → list of parlay IDs (already sorted by probability desc)
    const playerPropMap = new Map<string, string[]>();

    for (const parlay of (remainingParlays || [])) {
      const keys = extractPlayerPropKeys(parlay.legs);
      for (const key of keys) {
        const list = playerPropMap.get(key) || [];
        if (!list.includes(parlay.id)) {
          list.push(parlay.id);
        }
        playerPropMap.set(key, list);
      }
    }

    // Find parlays to void: for each player-prop, keep first N (highest prob), void rest
    const exposureVoidSet = new Set<string>();
    const exposureDetails: Record<string, { kept: number; voided: number }> = {};

    for (const [key, parlayIds] of playerPropMap) {
      if (parlayIds.length <= maxPlayerPropUsage) continue;
      
      const toVoid = parlayIds.slice(maxPlayerPropUsage);
      for (const id of toVoid) {
        exposureVoidSet.add(id);
      }
      exposureDetails[key] = { kept: maxPlayerPropUsage, voided: toVoid.length };
    }

    let exposureVoided = 0;
    if (exposureVoidSet.size > 0) {
      const idsToVoid = Array.from(exposureVoidSet);
      
      // Batch void in chunks of 50
      for (let i = 0; i < idsToVoid.length; i += 50) {
        const chunk = idsToVoid.slice(i, i + 50);
        const { count } = await supabase
          .from('bot_daily_parlays')
          .update({ outcome: 'void', lesson_learned: 'exposure_cap_player_prop' })
          .in('id', chunk)
          .eq('outcome', 'pending')
          .select('*', { count: 'exact', head: true });
        exposureVoided += (count || 0);
      }

      // Log top offenders
      const sortedExposure = Object.entries(exposureDetails)
        .sort((a, b) => b[1].voided - a[1].voided)
        .slice(0, 10);
      for (const [key, info] of sortedExposure) {
        console.log(`[DiversityRebalance] Exposure: ${key} → kept ${info.kept}, voided ${info.voided}`);
      }
    }

    console.log(`[DiversityRebalance] Exposure pass: voided ${exposureVoided} parlays from ${exposureVoidSet.size} candidates`);

    // ═══════════════════════════════════════════════════════════════
    // Final Summary
    // ═══════════════════════════════════════════════════════════════

    const afterCount = totalCount - totalVoided - exposureVoided;
    const familySummary: Record<string, number> = {};
    for (const [family, entry] of familyCounts) {
      familySummary[family] = entry.kept;
    }

    await supabase.from('bot_activity_log').insert({
      event_type: 'diversity_rebalance',
      message: `Rebalanced: ${totalCount} → ${afterCount} parlays (strategy voided ${totalVoided}, exposure voided ${exposureVoided})`,
      metadata: {
        date: today,
        maxPct,
        maxPerFamily,
        maxPlayerPropUsage,
        totalBefore: totalCount,
        totalAfter: afterCount,
        strategyVoided: totalVoided,
        exposureVoided,
        voidDetails,
        exposureDetails,
        familySummary,
      },
      severity: (totalVoided + exposureVoided) > 0 ? 'info' : 'success',
    });

    return new Response(JSON.stringify({
      success: true,
      date: today,
      totalBefore: totalCount,
      totalAfter: afterCount,
      strategyVoided: totalVoided,
      exposureVoided,
      maxPerFamily,
      maxPlayerPropUsage,
      voidDetails,
      exposureDetails,
      familySummary,
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
