/**
 * bot-close-miss-analyzer — Post-settlement weak leg tracker
 * 
 * Finds parlays that lost with 2/3 legs hitting (close misses),
 * identifies the weak leg, and logs it to bot_weak_leg_tracker
 * for future deprioritization in parlay generation.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json().catch(() => ({}));
    const lookbackDays = body.lookback_days ?? 3;

    // Find recent close-miss parlays: lost with legs_hit >= 2 and legs_missed = 1
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const cutoffDate = cutoff.toISOString().split('T')[0];

    const { data: closeMisses, error } = await supabase
      .from('bot_daily_parlays')
      .select('id, legs, legs_hit, legs_missed, parlay_date, strategy_name')
      .eq('outcome', 'lost')
      .gte('parlay_date', cutoffDate)
      .gte('legs_hit', 2)
      .eq('legs_missed', 1);

    if (error) throw error;

    if (!closeMisses || closeMisses.length === 0) {
      console.log('[CloseMissAnalyzer] No close misses found');
      return new Response(JSON.stringify({ success: true, analyzed: 0, weakLegs: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[CloseMissAnalyzer] Found ${closeMisses.length} close-miss parlays`);

    const weakLegs: Array<{
      player_name: string;
      prop_type: string;
      side: string;
      context: Record<string, any>;
    }> = [];

    for (const parlay of closeMisses) {
      const legs = Array.isArray(parlay.legs) ? parlay.legs : [];
      for (const leg of legs as any[]) {
        // Find the leg that missed (outcome = 'lost' or hit = false)
        const isHit = leg.outcome === 'won' || leg.outcome === 'hit' || leg.hit === true;
        if (isHit) continue;

        const playerName = (leg.player_name || leg.playerName || leg.player || '').toLowerCase().trim();
        const propType = leg.prop_type || leg.propType || '';
        const side = leg.side || leg.recommended_side || 'over';

        if (!playerName || !propType) continue;

        weakLegs.push({
          player_name: playerName,
          prop_type: propType,
          side: side.toLowerCase(),
          context: {
            parlay_id: parlay.id,
            parlay_date: parlay.parlay_date,
            strategy: parlay.strategy_name,
            line: leg.line || leg.recommended_line || null,
            hit_rate_at_pick: leg.hit_rate_l10 || leg.l10_hit_rate || leg.hitRate || null,
            actual_value: leg.actual_value || leg.actual || null,
            defense_rank: leg.defense_rank || leg.defenseRank || null,
          },
        });
      }
    }

    if (weakLegs.length === 0) {
      console.log('[CloseMissAnalyzer] No identifiable weak legs');
      return new Response(JSON.stringify({ success: true, analyzed: closeMisses.length, weakLegs: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Upsert weak legs — increment miss_count for existing entries
    let upserted = 0;
    for (const wl of weakLegs) {
      // Check if already tracked
      const { data: existing } = await supabase
        .from('bot_weak_leg_tracker')
        .select('id, miss_count')
        .eq('player_name', wl.player_name)
        .eq('prop_type', wl.prop_type)
        .eq('side', wl.side)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('bot_weak_leg_tracker')
          .update({
            miss_count: (existing.miss_count || 0) + 1,
            last_miss_date: getEasternDate(),
            context: wl.context,
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('bot_weak_leg_tracker')
          .insert({
            player_name: wl.player_name,
            prop_type: wl.prop_type,
            side: wl.side,
            miss_count: 1,
            last_miss_date: getEasternDate(),
            context: wl.context,
          });
      }
      upserted++;
    }

    console.log(`[CloseMissAnalyzer] Tracked ${upserted} weak legs from ${closeMisses.length} close misses`);

    await supabase.from('bot_activity_log').insert({
      event_type: 'close_miss_analysis',
      message: `Analyzed ${closeMisses.length} close misses, tracked ${upserted} weak legs`,
      metadata: {
        closeMissCount: closeMisses.length,
        weakLegsTracked: upserted,
        topWeakLegs: weakLegs.slice(0, 5).map(wl => `${wl.player_name} ${wl.prop_type} ${wl.side}`),
      },
      severity: 'info',
    });

    return new Response(JSON.stringify({
      success: true,
      analyzed: closeMisses.length,
      weakLegsTracked: upserted,
      weakLegs: weakLegs.map(wl => ({
        player: wl.player_name,
        prop: wl.prop_type,
        side: wl.side,
      })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[CloseMissAnalyzer] Error:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
