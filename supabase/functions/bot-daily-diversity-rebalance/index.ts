/**
 * bot-daily-diversity-rebalance v6.0 — Loosened Caps + Hard Floor
 * 
 * v6.0 changes (from v5.0):
 * - Raised player appearance cap from 10 → 15
 * - Raised strategy family cap from 60% → 80%
 * - Added hard floor: never void below 20 active parlays
 * - Borderline cases tagged as warning instead of voided
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const VERSION = 'diversity-rebalance-v6.0-loosened';
const MIN_ACTIVE_FLOOR = 20;

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
    const maxPlayerAppearances = body.max_player_appearances ?? 15;
    const maxStrategyPct = body.max_strategy_pct ?? 0.80;

    console.log(`[DiversityRebalance] ${VERSION} | date=${today} | playerCap=${maxPlayerAppearances} | stratPct=${maxStrategyPct} | floor=${MIN_ACTIVE_FLOOR}`);

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
    let totalWarned = 0;
    const voidReasons: Record<string, number> = {};

    // ═══════════════════════════════════════════════════════════
    // PASS 1: Global Player Appearance Cap (15)
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
      // Check floor: don't void if it would drop below MIN_ACTIVE_FLOOR
      const currentActive = totalCount - playerVoidIds.size;
      const canVoid = Math.max(0, currentActive - MIN_ACTIVE_FLOOR);
      const actualVoid = toVoid.slice(0, canVoid);
      for (const id of actualVoid) {
        playerVoidIds.add(id);
      }
      if (actualVoid.length < toVoid.length) {
        console.log(`[DiversityRebalance] Player ${player}: would void ${toVoid.length} but floor limits to ${actualVoid.length}`);
      }
    }

    if (playerVoidIds.size > 0) {
      const ids = [...playerVoidIds];
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const { count } = await supabase
          .from('bot_daily_parlays')
          .update({ outcome: 'void', lesson_learned: 'diversity_v6_player_cap' })
          .in('id', chunk)
          .eq('outcome', 'pending')
          .select('*', { count: 'exact', head: true });
        totalVoided += (count || 0);
      }
      voidReasons['player_cap'] = playerVoidIds.size;
    }

    // ═══════════════════════════════════════════════════════════
    // PASS 2: Strategy Family Cap (80%)
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
      // Check floor before voiding
      const currentActive = remainingCount - strategyVoided;
      const canVoid = Math.max(0, currentActive - MIN_ACTIVE_FLOOR);
      if (canVoid === 0) {
        // Tag as warning instead
        await supabase
          .from('bot_daily_parlays')
          .update({ lesson_learned: 'diversity_v6_warning_strategy_cap' })
          .in('id', entry.toVoid)
          .eq('outcome', 'pending');
        totalWarned += entry.toVoid.length;
        console.log(`[DiversityRebalance] ${family}: ${entry.toVoid.length} warned (floor protection)`);
        continue;
      }
      const voidSlice = entry.toVoid.slice(0, canVoid);
      const warnSlice = entry.toVoid.slice(canVoid);
      if (voidSlice.length > 0) {
        const { count } = await supabase
          .from('bot_daily_parlays')
          .update({ outcome: 'void', lesson_learned: `diversity_v6_strategy_cap` })
          .in('id', voidSlice)
          .eq('outcome', 'pending')
          .select('*', { count: 'exact', head: true });
        strategyVoided += (count || 0);
      }
      if (warnSlice.length > 0) {
        await supabase
          .from('bot_daily_parlays')
          .update({ lesson_learned: 'diversity_v6_warning_strategy_cap' })
          .in('id', warnSlice)
          .eq('outcome', 'pending');
        totalWarned += warnSlice.length;
      }
      console.log(`[DiversityRebalance] ${family}: kept ${entry.kept}, voided ${voidSlice.length}, warned ${warnSlice.length}`);
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

    await supabase.from('bot_activity_log').insert({
      event_type: 'diversity_rebalance',
      message: `Validation: ${totalCount} → ${totalAfter} parlays (voided ${totalVoided}, warned ${totalWarned}, stake ${volumeMultiplier}×)`,
      metadata: {
        version: VERSION,
        date: today,
        totalBefore: totalCount,
        totalAfter,
        totalVoided,
        totalWarned,
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
      totalWarned,
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
