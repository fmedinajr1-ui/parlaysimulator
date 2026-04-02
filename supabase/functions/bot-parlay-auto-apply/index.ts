import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface Action {
  parlay_id: string;
  leg_index: number;
  action: 'flip' | 'drop' | 'keep';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { actions }: { actions: Action[] } = await req.json();
    if (!actions?.length) {
      return new Response(JSON.stringify({ error: 'No actions provided' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group actions by parlay_id
    const grouped = new Map<string, Action[]>();
    for (const a of actions) {
      const list = grouped.get(a.parlay_id) || [];
      list.push(a);
      grouped.set(a.parlay_id, list);
    }

    const parlayIds = [...grouped.keys()];
    const { data: parlays, error: fetchErr } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .in('id', parlayIds);

    if (fetchErr) throw fetchErr;

    const results: any[] = [];
    const activityLogs: any[] = [];

    for (const parlay of (parlays || [])) {
      const parlayActions = grouped.get(parlay.id) || [];
      let legs = Array.isArray(parlay.legs) ? [...parlay.legs] : [];
      const changes: string[] = [];

      // Sort actions by leg_index descending so drops don't shift indices
      const sorted = [...parlayActions].sort((a, b) => b.leg_index - a.leg_index);

      for (const action of sorted) {
        if (action.leg_index >= legs.length) continue;

        if (action.action === 'flip') {
          const leg = legs[action.leg_index] as any;
          const oldSide = leg.side;
          const newSide = oldSide?.toLowerCase() === 'over' ? 'under' : 'over';

          // Only allow flip if the player has historical evidence of underperforming on the current side
          const playerName = leg.player_name || leg.playerName || '';
          const propType = leg.prop_type || '';

          // Check bot_player_performance for current side hit rate
          const { data: perfData } = await supabase
            .from('bot_player_performance')
            .select('hit_rate, legs_played')
            .eq('player_name', playerName)
            .eq('prop_type', propType)
            .eq('side', oldSide?.toLowerCase() || 'over')
            .maybeSingle();

          // Check bot_weak_leg_tracker for miss history on current side
          const { data: weakData } = await supabase
            .from('bot_weak_leg_tracker')
            .select('miss_count')
            .eq('player_name', playerName)
            .eq('prop_type', propType)
            .eq('side', oldSide?.toLowerCase() || 'over')
            .maybeSingle();

          const hasDownsideHistory =
            (perfData && perfData.legs_played >= 3 && perfData.hit_rate < 0.45) ||
            (weakData && (weakData.miss_count || 0) >= 2);

          if (!hasDownsideHistory) {
            changes.push(`SKIP FLIP leg ${action.leg_index}: ${playerName} ${propType} ${oldSide} — no downside history`);
            continue;
          }

          leg.side = newSide;
          legs[action.leg_index] = leg;
          changes.push(`FLIP leg ${action.leg_index}: ${playerName} ${oldSide} → ${newSide} (hit_rate: ${perfData?.hit_rate ?? 'N/A'}, misses: ${weakData?.miss_count ?? 0})`);
        } else if (action.action === 'drop') {
          const leg = legs[action.leg_index] as any;
          changes.push(`DROP leg ${action.leg_index}: ${leg.player_name} ${leg.prop_type}`);
          legs.splice(action.leg_index, 1);
        }
      }

      // Recalculate
      const newLegCount = legs.length;
      let update: Record<string, any> = {
        legs,
        leg_count: newLegCount,
        legs_swapped: (parlay.legs_swapped || 0) + parlayActions.filter(a => a.action === 'flip').length,
      };

      // Recalculate expected_odds based on remaining legs
      if (newLegCount >= 2) {
        // Approximate: each leg ~= +130 American odds contribution
        const perLegMultiplier = 2.3; // ~+130 per leg
        const decimalOdds = Math.pow(perLegMultiplier, newLegCount);
        const americanOdds = Math.round((decimalOdds - 1) * 100);
        update.expected_odds = americanOdds;
      }

      // Auto-void if < 2 legs
      if (newLegCount < 2) {
        update.outcome = 'void';
        update.lesson_learned = `Auto-voided: dropped to ${newLegCount} leg(s) after smart check`;
        changes.push(`VOID: parlay dropped below 2 legs`);
      }

      const { error: updateErr } = await supabase
        .from('bot_daily_parlays')
        .update(update)
        .eq('id', parlay.id);

      if (updateErr) {
        results.push({ parlay_id: parlay.id, success: false, error: updateErr.message });
        continue;
      }

      results.push({
        parlay_id: parlay.id,
        success: true,
        changes,
        new_leg_count: newLegCount,
        voided: newLegCount < 2,
      });

      // Log to activity
      activityLogs.push({
        event_type: 'smart_check_applied',
        message: `Smart check: ${changes.length} changes to ${parlay.strategy_name} parlay`,
        metadata: { parlay_id: parlay.id, changes, new_leg_count: newLegCount },
        severity: newLegCount < 2 ? 'warning' : 'info',
      });
    }

    // Batch insert activity logs
    if (activityLogs.length) {
      await supabase.from('bot_activity_log').insert(activityLogs);
    }

    return new Response(JSON.stringify({
      results,
      total_applied: results.filter(r => r.success).length,
      applied_at: new Date().toISOString(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Auto-apply error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
