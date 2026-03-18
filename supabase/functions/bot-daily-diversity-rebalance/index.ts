/**
 * bot-daily-diversity-rebalance v3.0 — Swap-Not-Void
 * 
 * Post-rebuild pass that:
 * 1. Caps any single strategy family at 40% (60% on light slates) of the total pending daily slate
 * 2. Enforces max-2-per-player-prop (max-3 on light slates) across ALL pending parlays
 * 3. Auto-detects light-slate conditions (≤8 unique players in pending parlays)
 * 4. Volume-aware stake scaling: reduces stakes when few parlays survive (≤3 → 0.5×, ≤6 → 0.75×)
 * 5. v3.0: Swaps excess legs from bench pool instead of voiding entire parlays
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VERSION = 'diversity-rebalance-v3.0';

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

function normalizePropType(propType: string): string {
  const lower = (propType || '').replace(/^player_/i, '').toLowerCase().trim();
  const map: Record<string, string> = {
    'points': 'points', 'pts': 'points',
    'rebounds': 'rebounds', 'reb': 'rebounds',
    'assists': 'assists', 'ast': 'assists',
    'threes': 'threes', '3pm': 'threes', 'three_pointers': 'threes',
    'blocks': 'blocks', 'blk': 'blocks',
    'steals': 'steals', 'stl': 'steals',
    'turnovers': 'turnovers', 'to': 'turnovers',
  };
  return map[lower] || lower;
}

function normalizePlayerName(name: string): string {
  return (name || '').toLowerCase().trim();
}

function extractPlayerPropSideKeys(legs: any): string[] {
  const keys: string[] = [];
  if (!Array.isArray(legs)) return keys;
  for (const leg of legs) {
    const player = normalizePlayerName(leg.player_name || leg.playerName || leg.player || '');
    const prop = normalizePropType(leg.prop_type || leg.propType || leg.prop || leg.market || '');
    const side = (leg.side || leg.recommended_side || 'over').toLowerCase().trim();
    if (player && prop) {
      keys.push(`${player}|${prop}|${side}`);
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
    const maxPct = body.max_strategy_pct ?? 0.40;
    const maxPlayerPropUsage = body.max_player_prop_usage ?? 3;
    const today = body.date || getEasternDate();

    console.log(`[DiversityRebalance] ${VERSION} | date=${today}`);

    // ═══════════════════════════════════════════════════════════════
    // Fetch pending parlays + detect light-slate
    // ═══════════════════════════════════════════════════════════════

    const { data: pending, error } = await supabase
      .from('bot_daily_parlays')
      .select('id, strategy_name, combined_probability, tier, created_at, legs')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    if (error) throw error;

    const totalCount = (pending || []).length;
    if (totalCount === 0) {
      return new Response(JSON.stringify({ success: true, version: VERSION, message: 'No pending parlays to rebalance', strategyVoided: 0, exposureVoided: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Count unique players across all pending parlays
    const uniquePlayers = new Set<string>();
    for (const p of pending!) {
      if (Array.isArray(p.legs)) {
        for (const leg of p.legs as any[]) {
          const name = normalizePlayerName(leg.player_name || leg.playerName || leg.player || '');
          if (name) uniquePlayers.add(name);
        }
      }
    }

    const isLightSlate = uniquePlayers.size <= 8;
    const effectiveMaxPct = isLightSlate ? 0.60 : maxPct;
    const effectiveMaxPlayerPropUsage = isLightSlate ? 3 : maxPlayerPropUsage;
    const effectiveMinFloor = isLightSlate ? 3 : 2;

    console.log(`[DiversityRebalance] ${totalCount} pending, ${uniquePlayers.size} unique players → ${isLightSlate ? 'LIGHT-SLATE' : 'NORMAL'} mode`);

    // ═══════════════════════════════════════════════════════════════
    // PASS 1: Strategy Family Cap
    // ═══════════════════════════════════════════════════════════════

    const maxPerFamily = Math.max(effectiveMinFloor, Math.ceil(totalCount * effectiveMaxPct));
    console.log(`[DiversityRebalance] max per family: ${maxPerFamily} (${(effectiveMaxPct * 100).toFixed(0)}%, floor=${effectiveMinFloor})`);

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

    // Void excess from strategy cap — collect actually voided IDs
    let totalStrategyVoided = 0;
    const voidDetails: Record<string, number> = {};
    const strategyVoidedIds = new Set<string>();

    for (const [family, entry] of familyCounts) {
      if (entry.toVoid.length === 0) continue;
      
      const { data: voidedRows } = await supabase
        .from('bot_daily_parlays')
        .update({ outcome: 'void', lesson_learned: `diversity_rebalance_cap_${maxPerFamily}` })
        .in('id', entry.toVoid)
        .eq('outcome', 'pending')
        .select('id');

      const voided = (voidedRows || []).length;
      totalStrategyVoided += voided;
      voidDetails[family] = voided;
      for (const row of (voidedRows || [])) {
        strategyVoidedIds.add(row.id);
      }
      console.log(`[DiversityRebalance] ${family}: kept ${entry.kept}, voided ${voided}`);
    }

    // ═══════════════════════════════════════════════════════════════
    // PASS 2: Player-Prop Exposure Cap
    // ═══════════════════════════════════════════════════════════════

    console.log(`[DiversityRebalance] Starting player-prop exposure pass (max ${effectiveMaxPlayerPropUsage} per combo)...`);

    // Re-fetch remaining pending parlays WITH legs data
    const { data: remainingParlays, error: err2 } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, combined_probability, strategy_name, tier')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false });

    if (err2) throw err2;

    // Build map: player|prop|side → list of parlay IDs (sorted by probability desc)
    const playerPropMap = new Map<string, string[]>();

    for (const parlay of (remainingParlays || [])) {
      const keys = extractPlayerPropSideKeys(parlay.legs);
      for (const key of keys) {
        const list = playerPropMap.get(key) || [];
        if (!list.includes(parlay.id)) {
          list.push(parlay.id);
        }
        playerPropMap.set(key, list);
      }
    }

    // Find parlays to fix: for each player-prop, keep first N, swap rest
    const exposureSwapSet = new Set<string>();
    const exposureDetails: Record<string, { kept: number; swapped: number; voided: number }> = {};

    // Fetch bench picks for swapping
    const { data: benchPicksRaw } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, recommended_side, actual_line, confidence_score, projected_value, l10_hit_rate, l10_avg, category')
      .eq('analysis_date', today)
      .eq('is_active', true)
      .order('confidence_score', { ascending: false });

    // Build set of all players currently in pending parlays
    const allUsedPlayersDiv = new Set<string>();
    for (const parlay of (remainingParlays || [])) {
      const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
      for (const leg of legs as any[]) {
        const name = normalizePlayerName(leg.player_name || leg.playerName || leg.player || '');
        if (name) allUsedPlayersDiv.add(name);
      }
    }

    const availableBenchDiv = (benchPicksRaw || []).filter((bp: any) => {
      const bpPlayer = normalizePlayerName(bp.player_name || '');
      return !allUsedPlayersDiv.has(bpPlayer);
    });

    let swapsPerformed = 0;
    let voidedNoSwap = 0;

    for (const [key, parlayIds] of playerPropMap) {
      if (parlayIds.length <= effectiveMaxPlayerPropUsage) continue;
      
      const toFixIds = parlayIds.slice(effectiveMaxPlayerPropUsage);
      let swapped = 0;
      let voided = 0;

      for (const parlayId of toFixIds) {
        if (strategyVoidedIds.has(parlayId)) continue; // already handled
        
        const parlay = (remainingParlays || []).find((p: any) => p.id === parlayId);
        if (!parlay) continue;

        const legs = Array.isArray(parlay.legs) ? [...(parlay.legs as any[])] : [];
        const [playerName, propType, side] = key.split('|');
        const exposedIdx = legs.findIndex((l: any) => {
          const lPlayer = normalizePlayerName(l.player_name || l.playerName || l.player || '');
          const lProp = normalizePropType(l.prop_type || l.propType || l.prop || l.market || '');
          return lPlayer === playerName && lProp === propType;
        });

        if (exposedIdx === -1) continue;

        // Find replacement — prefer different category for diversity
        const replacement = availableBenchDiv.find((bp: any) => {
          const bpPlayer = normalizePlayerName(bp.player_name || '');
          const alreadyInParlay = legs.some((l: any) => 
            normalizePlayerName(l.player_name || l.playerName || l.player || '') === bpPlayer
          );
          return !alreadyInParlay && (bp.confidence_score || 0) > 0.4;
        });

        if (replacement) {
          const oldLeg = legs[exposedIdx];
          legs[exposedIdx] = {
            ...oldLeg,
            player_name: replacement.player_name,
            prop_type: replacement.prop_type,
            side: replacement.recommended_side || 'over',
            line: replacement.actual_line,
            confidence_score: replacement.confidence_score,
            projected_value: replacement.projected_value,
            l10_hit_rate: replacement.l10_hit_rate,
            l10_avg: replacement.l10_avg,
            category: replacement.category,
            swapped_from: oldLeg.player_name || oldLeg.playerName,
            swap_reason: 'diversity_exposure_cap',
          };

          const avgConf = legs.reduce((sum: number, l: any) => sum + ((l as any).confidence_score || 0.5), 0) / legs.length;

          await supabase
            .from('bot_daily_parlays')
            .update({ 
              legs,
              combined_probability: Math.round(avgConf * 1000) / 1000,
              lesson_learned: `diversity_swap:${oldLeg.player_name || oldLeg.playerName}→${replacement.player_name}`,
              legs_swapped: ((parlay as any).legs_swapped || 0) + 1,
            })
            .eq('id', parlayId);

          // Remove from bench
          const repIdx = availableBenchDiv.findIndex((bp: any) => 
            bp.player_name === replacement.player_name && bp.prop_type === replacement.prop_type
          );
          if (repIdx >= 0) availableBenchDiv.splice(repIdx, 1);
          allUsedPlayersDiv.add(normalizePlayerName(replacement.player_name || ''));

          swapped++;
          swapsPerformed++;
          exposureSwapSet.add(parlayId);
          console.log(`[DiversityRebalance] 🔄 SWAPPED: ${key} → ${replacement.player_name} ${replacement.prop_type} in parlay ${parlayId}`);
        } else {
          // No swap candidate — void as last resort
          await supabase
            .from('bot_daily_parlays')
            .update({ outcome: 'void', lesson_learned: 'exposure_cap_no_swap' })
            .eq('id', parlayId)
            .eq('outcome', 'pending');
          voided++;
          voidedNoSwap++;
        }
      }

      exposureDetails[key] = { kept: effectiveMaxPlayerPropUsage, swapped, voided };
    }

    const exposureVoided = voidedNoSwap;

    // ═══════════════════════════════════════════════════════════════
    // Final Summary — recount from DB for accuracy
    // ═══════════════════════════════════════════════════════════════

    const { count: finalPendingCount } = await supabase
      .from('bot_daily_parlays')
      .select('*', { count: 'exact', head: true })
      .eq('parlay_date', today)
      .eq('outcome', 'pending');

    const totalAfter = finalPendingCount ?? (totalCount - totalStrategyVoided - exposureVoided);

    // ═══════════════════════════════════════════════════════════════
    // PASS 3: Volume-Aware Stake Scaling
    // ═══════════════════════════════════════════════════════════════

    let volumeMultiplier = 1.0;
    if (totalAfter <= 3) {
      volumeMultiplier = 0.5;
    } else if (totalAfter <= 6) {
      volumeMultiplier = 0.75;
    }

    let stakesAdjusted = 0;
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
      console.log(`[DiversityRebalance] Volume-scaled stakes: ${totalAfter} active parlays → ${volumeMultiplier}× multiplier (${stakesAdjusted} adjusted)`);
    }

    const familySummary: Record<string, number> = {};
    for (const [family, entry] of familyCounts) {
      familySummary[family] = entry.kept;
    }

    await supabase.from('bot_activity_log').insert({
      event_type: 'diversity_rebalance',
      message: `Rebalanced: ${totalCount} → ${totalAfter} parlays (strategy voided ${totalStrategyVoided}, exposure swaps ${swapsPerformed}, exposure voided ${exposureVoided}, stake multiplier ${volumeMultiplier}×)`,
      metadata: {
        version: VERSION,
        date: today,
        maxPct: effectiveMaxPct,
        maxPerFamily,
        maxPlayerPropUsage: effectiveMaxPlayerPropUsage,
        isLightSlate,
        uniquePlayerCount: uniquePlayers.size,
        totalBefore: totalCount,
        totalAfter,
        strategyVoided: totalStrategyVoided,
        swapsPerformed,
        exposureVoided,
        volumeMultiplier,
        stakesAdjusted,
        voidDetails,
        exposureDetails,
        familySummary,
      },
      severity: (totalStrategyVoided + exposureVoided) > 0 ? 'info' : 'success',
    });

    return new Response(JSON.stringify({
      success: true,
      version: VERSION,
      date: today,
      totalBefore: totalCount,
      totalAfter,
      strategyVoided: totalStrategyVoided,
      swapsPerformed,
      exposureVoided,
      maxPerFamily,
      maxPlayerPropUsage: effectiveMaxPlayerPropUsage,
      isLightSlate,
      uniquePlayerCount: uniquePlayers.size,
      volumeMultiplier,
      stakesAdjusted,
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
