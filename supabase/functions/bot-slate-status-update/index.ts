import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get today's date in ET
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    // Query only pending (active) parlays for today
    const { data: parlays, error } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .eq('parlay_date', today)
      .eq('outcome', 'pending');

    if (error) throw error;

    if (!parlays || parlays.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'No active parlays found for today' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Calculate total stake exposure
    const totalStake = parlays.reduce((sum, p) => sum + (p.simulated_stake || 0), 0);

    // Format active parlays with leg details
    const formattedActive = parlays.map(p => {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      return {
        strategy_name: p.strategy_name,
        legs: legs.map((leg: any) => ({
          player_name: leg.player_name || leg.playerName || 'Unknown',
          side: leg.side || leg.recommended_side || 'over',
          line: leg.line || leg.recommended_line || 0,
          prop_type: leg.prop_type || leg.propType || '',
          hit_rate_l10: leg.hit_rate_l10 || leg.l10_hit_rate || leg.hitRate || null,
        })),
      };
    });

    // Send to bot-send-telegram
    const { error: sendError } = await supabase.functions.invoke('bot-send-telegram', {
      body: {
        type: 'slate_status_update',
        data: {
          activeParlays: formattedActive,
          totalStake,
        },
      },
    });

    if (sendError) throw sendError;

    console.log(`[SlateStatus] Sent update: ${parlays.length} active, total risk $${totalStake}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        active: parlays.length, 
        totalStake,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[SlateStatus] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
