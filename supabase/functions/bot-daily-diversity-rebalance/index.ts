/**
 * bot-daily-diversity-rebalance v2.2
 * 
 * Post-rebuild pass that:
 * 1. Caps any single strategy family at 40% (60% on light slates) of the total pending daily slate
 * 2. Enforces max-2-per-player-prop (max-3 on light slates) across ALL pending parlays
 * 3. Auto-detects light-slate conditions (≤8 unique players in pending parlays)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VERSION = 'diversity-rebalance-v2.2';

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
    const maxPlayerPropUsage = body.max_player_prop_usage ?? 2;
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
    // PASS 2: Player-Prop Exposure Cap (max 1 per player-prop combo)
    // ═══════════════════════════════════════════════════════════════

    console.log(`[DiversityRebalance] Starting player-prop exposure pass (max ${maxPlayerPropUsage} per combo)...`);

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

    // Find parlays to void: for each player-prop, keep first N, void rest
    // Explicitly exclude IDs already voided by strategy pass
    const exposureVoidSet = new Set<string>();
    const exposureCandidatesRaw = new Set<string>();
    const exposureDetails: Record<string, { kept: number; voided: number }> = {};

    for (const [key, parlayIds] of playerPropMap) {
      if (parlayIds.length <= maxPlayerPropUsage) continue;
      
      const toVoid = parlayIds.slice(maxPlayerPropUsage);
      for (const id of toVoid) {
        exposureCandidatesRaw.add(id);
        // Only add if NOT already voided by strategy pass
        if (!strategyVoidedIds.has(id)) {
          exposureVoidSet.add(id);
        }
      }
      exposureDetails[key] = { kept: maxPlayerPropUsage, voided: toVoid.length };
    }

    const exposureAlreadyVoidedByStrategy = exposureCandidatesRaw.size - exposureVoidSet.size;
    let exposureVoided = 0;

    if (exposureVoidSet.size > 0) {
      const idsToVoid = Array.from(exposureVoidSet);
      
      for (let i = 0; i < idsToVoid.length; i += 50) {
        const chunk = idsToVoid.slice(i, i + 50);
        const { data: voidedRows } = await supabase
          .from('bot_daily_parlays')
          .update({ outcome: 'void', lesson_learned: 'exposure_cap_player_prop' })
          .in('id', chunk)
          .eq('outcome', 'pending')
          .select('id');
        exposureVoided += (voidedRows || []).length;
      }

      // Log top offenders
      const sortedExposure = Object.entries(exposureDetails)
        .sort((a, b) => b[1].voided - a[1].voided)
        .slice(0, 10);
      for (const [key, info] of sortedExposure) {
        console.log(`[DiversityRebalance] Exposure: ${key} → kept ${info.kept}, voided ${info.voided}`);
      }
    }

    console.log(`[DiversityRebalance] Exposure pass: raw candidates=${exposureCandidatesRaw.size}, already voided by strategy=${exposureAlreadyVoidedByStrategy}, actually voided=${exposureVoided}`);

    // ═══════════════════════════════════════════════════════════════
    // Final Summary — recount from DB for accuracy
    // ═══════════════════════════════════════════════════════════════

    const { count: finalPendingCount } = await supabase
      .from('bot_daily_parlays')
      .select('*', { count: 'exact', head: true })
      .eq('parlay_date', today)
      .eq('outcome', 'pending');

    const totalAfter = finalPendingCount ?? (totalCount - totalStrategyVoided - exposureVoided);

    const familySummary: Record<string, number> = {};
    for (const [family, entry] of familyCounts) {
      familySummary[family] = entry.kept;
    }

    await supabase.from('bot_activity_log').insert({
      event_type: 'diversity_rebalance',
      message: `Rebalanced: ${totalCount} → ${totalAfter} parlays (strategy voided ${totalStrategyVoided}, exposure voided ${exposureVoided})`,
      metadata: {
        version: VERSION,
        date: today,
        maxPct,
        maxPerFamily,
        maxPlayerPropUsage,
        totalBefore: totalCount,
        totalAfter,
        strategyVoided: totalStrategyVoided,
        exposureCandidatesRaw: exposureCandidatesRaw.size,
        exposureAlreadyVoidedByStrategy,
        exposureCandidatesAfterStrategyFilter: exposureVoidSet.size,
        exposureVoided,
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
      exposureCandidatesRaw: exposureCandidatesRaw.size,
      exposureAlreadyVoidedByStrategy,
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
