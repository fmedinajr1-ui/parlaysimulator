import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, supabaseKey);

    // Get today's date in ET
    const now = new Date();
    const etDate = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    // Fetch today's floor_lock, optimal_combo, ceiling_shot parlays
    const { data: parlays, error } = await sb
      .from('bot_daily_parlays')
      .select('*')
      .eq('parlay_date', etDate)
      .in('strategy_name', [
        'floor_lock_nba_3l', 'floor_lock_nba_4l', 'floor_lock_all_3l', 'floor_lock_all_4l',
        'optimal_combo_nba_3l', 'optimal_combo_nba_4l', 'optimal_combo_all_3l',
        'ceiling_shot_nba_3l', 'ceiling_shot_nba_4l', 'ceiling_shot_all_3l', 'ceiling_shot_all_4l',
        'nhl_floor_lock', 'nhl_optimal_combo', 'nhl_ceiling_shot',
        'cross_sport_optimal', 'elite_cross_sport_6leg', 'l3_matchup_combo', 'l3_sweet_mispriced_hybrid', 'l3_cross_engine',
      ])
      .not('outcome', 'eq', 'voided');

    if (error) {
      console.error('Failed to fetch parlays:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }

    // Helper: filter out any parlay containing baseball legs (check sport AND category/prop_type for MLB)
    const isBaseballLeg = (l: any) => {
      const sport = (l.sport || '').toLowerCase();
      const cat = (l.category || '').toLowerCase();
      const prop = (l.prop_type || '').toLowerCase();
      return sport.includes('baseball') || cat.includes('mlb') || 
             ['pitcher_strikeouts', 'hits', 'total_bases', 'rbis', 'runs', 'stolen_bases', 'walks'].includes(prop) && cat.startsWith('mlb');
    };
    const filterBaseball = (list: any[]) => list.filter(p => {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      return !legs.some((l: any) => isBaseballLeg(l));
    });

    if (!parlays || parlays.length === 0) {
      // Try broader match
      const { data: broadParlays } = await sb
        .from('bot_daily_parlays')
        .select('*')
        .eq('parlay_date', etDate)
        .not('outcome', 'eq', 'voided')
        .or('strategy_name.ilike.%floor_lock%,strategy_name.ilike.%optimal_combo%,strategy_name.ilike.%ceiling_shot%');

      const cleanBroad = filterBaseball(broadParlays || []);

      if (cleanBroad.length === 0) {
        return new Response(JSON.stringify({ success: false, reason: 'no_parlays_found', filtered_out: (broadParlays?.length || 0) - cleanBroad.length }), { headers: corsHeaders });
      }

      // Approve any pending
      const pendingIds = cleanBroad.filter(p => p.approval_status === 'pending_approval').map(p => p.id);
      if (pendingIds.length > 0) {
        await sb.from('bot_daily_parlays').update({ approval_status: 'approved' }).in('id', pendingIds);
        console.log(`Approved ${pendingIds.length} pending parlays`);
      }

      // Send broadcast
      const resp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'new_strategies_broadcast',
          data: { parlays: cleanBroad },
        }),
      });

      const result = await resp.json();
      return new Response(JSON.stringify({ success: true, parlays_sent: cleanBroad.length, telegram: result }), { headers: corsHeaders });
    }

    // Filter baseball from primary results
    const cleanParlays = filterBaseball(parlays);
    console.log(`Filtered: ${parlays.length} total -> ${cleanParlays.length} clean (removed ${parlays.length - cleanParlays.length} with baseball)`);

    if (cleanParlays.length === 0) {
      return new Response(JSON.stringify({ success: false, reason: 'all_parlays_had_baseball', total: parlays.length }), { headers: corsHeaders });
    }

    // Approve any pending
    const pendingIds = cleanParlays.filter(p => p.approval_status === 'pending_approval').map(p => p.id);
    if (pendingIds.length > 0) {
      await sb.from('bot_daily_parlays').update({ approval_status: 'approved' }).in('id', pendingIds);
      console.log(`Approved ${pendingIds.length} pending parlays`);
    }

    // Send broadcast
    const resp = await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'new_strategies_broadcast',
        data: { parlays: cleanParlays },
      }),
    });

    const result = await resp.json();
    return new Response(JSON.stringify({ success: true, parlays_sent: cleanParlays.length, filtered_out: parlays.length - cleanParlays.length, telegram: result }), { headers: corsHeaders });

  } catch (err) {
    console.error('Error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
