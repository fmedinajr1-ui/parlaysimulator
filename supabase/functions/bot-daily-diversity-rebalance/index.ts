/**
 * bot-daily-diversity-rebalance
 * 
 * Post-rebuild pass that caps any single strategy family at 30% of the
 * total pending daily slate. Voids excess parlays from the least-scoring entries.
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

/** Extract base strategy family from full strategy_name (e.g., "mispriced_edge_execution_high_edge" → "mispriced_edge") */
function getStrategyFamily(strategyName: string): string {
  const name = (strategyName || 'unknown').toLowerCase();
  // Known family prefixes — match the longest prefix
  const families = [
    'mispriced_edge', 'category_momentum', 'hot_streak', 'trend_follower',
    'archetype_match', 'composite_elite', 'bankroll_doubler', 'monster_parlay',
    'master_parlay', 'leftover_sweep', 'round_robin',
  ];
  for (const f of families) {
    if (name.startsWith(f)) return f;
  }
  // Fallback: take first two underscore segments
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
    const maxPct = body.max_strategy_pct ?? 0.30; // 30% default cap
    const today = body.date || getEasternDate();

    // Fetch all pending parlays for today
    const { data: pending, error } = await supabase
      .from('bot_daily_parlays')
      .select('id, strategy_name, combined_probability, tier, created_at')
      .eq('parlay_date', today)
      .eq('outcome', 'pending')
      .order('combined_probability', { ascending: false }); // Keep highest prob first

    if (error) throw error;

    const totalCount = (pending || []).length;
    if (totalCount === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No pending parlays to rebalance', voided: 0 }), {
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

    // Void excess
    let totalVoided = 0;
    const voidDetails: Record<string, number> = {};

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
      console.log(`[DiversityRebalance] ${family}: kept ${entry.kept}, voided ${voided} (was ${entry.kept + voided})`);
    }

    // Log distribution after rebalance
    const afterCount = totalCount - totalVoided;
    const familySummary: Record<string, number> = {};
    for (const [family, entry] of familyCounts) {
      familySummary[family] = entry.kept;
    }

    await supabase.from('bot_activity_log').insert({
      event_type: 'diversity_rebalance',
      message: `Rebalanced: ${totalCount} → ${afterCount} parlays (voided ${totalVoided})`,
      metadata: { date: today, maxPct, maxPerFamily, totalBefore: totalCount, totalAfter: afterCount, voidDetails, familySummary },
      severity: totalVoided > 0 ? 'info' : 'success',
    });

    return new Response(JSON.stringify({
      success: true,
      date: today,
      totalBefore: totalCount,
      totalAfter: afterCount,
      voided: totalVoided,
      maxPerFamily,
      voidDetails,
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
