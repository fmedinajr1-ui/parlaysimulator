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
        'l3_matchup_combo', 'l3_sweet_mispriced_hybrid', 'l3_cross_engine',
      ])
      .not('outcome', 'eq', 'voided');

    if (error) {
      console.error('Failed to fetch parlays:', error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }

    if (!parlays || parlays.length === 0) {
      // Try broader match
      const { data: broadParlays } = await sb
        .from('bot_daily_parlays')
        .select('*')
        .eq('parlay_date', etDate)
        .not('outcome', 'eq', 'voided')
        .or('strategy_name.ilike.%floor_lock%,strategy_name.ilike.%optimal_combo%,strategy_name.ilike.%ceiling_shot%');

      if (!broadParlays || broadParlays.length === 0) {
        return new Response(JSON.stringify({ success: false, reason: 'no_parlays_found' }), { headers: corsHeaders });
      }

      // Approve any pending
      const pendingIds = broadParlays.filter(p => p.approval_status === 'pending_approval').map(p => p.id);
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
          data: { parlays: broadParlays },
        }),
      });

      const result = await resp.json();
      return new Response(JSON.stringify({ success: true, parlays_sent: broadParlays.length, telegram: result }), { headers: corsHeaders });
    }

    console.log(`Found ${parlays.length} parlays for broadcast (including MLB)`);

    // Approve any pending
    const pendingIds = parlays.filter(p => p.approval_status === 'pending_approval').map(p => p.id);
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
        data: { parlays },
      }),
    });

    const result = await resp.json();
    return new Response(JSON.stringify({ success: true, parlays_sent: parlays.length, telegram: result }), { headers: corsHeaders });

  } catch (err) {
    console.error('Error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
