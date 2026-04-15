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
    const totalStakeRaw = parlays.reduce((sum, p) => sum + (p.simulated_stake || 0), 0);

    // Format active parlays with leg details
    // Readable prop label map
    const READABLE_PROPS: Record<string, string> = {
      pitcher_strikeouts: 'Strikeouts', batter_rbis: 'RBI', batter_total_bases: 'Total Bases',
      batter_stolen_bases: 'Stolen Bases', batter_home_runs: 'Home Runs', batter_hits: 'Hits',
      batter_runs_scored: 'Runs', pitcher_outs: 'Outs', player_points: 'PTS',
      player_rebounds: 'REB', player_assists: 'AST', player_threes: '3PT',
    };

    // Filter out parlays containing stolen base UNDER legs
    const isSBUnderLeg = (leg: any) => {
      const prop = (leg.prop_type || leg.propType || '').toLowerCase();
      const side = (leg.side || leg.recommended_side || '').toLowerCase();
      return (prop === 'batter_stolen_bases' || prop === 'stolen_bases') && side === 'under';
    };

    const cleanParlays = parlays.filter(p => {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      return !legs.some(isSBUnderLeg);
    });

    if (cleanParlays.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'No active parlays after filtering' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const formattedActive = cleanParlays.map(p => {
      const legs = Array.isArray(p.legs) ? p.legs : [];
      return {
        strategy_name: p.strategy_name,
        legs: legs.map((leg: any) => {
          const rawProp = leg.prop_type || leg.propType || '';
          return {
            player_name: leg.player_name || leg.playerName || leg.player || 'Unknown',
            side: leg.side || leg.recommended_side || 'over',
            line: leg.line || leg.recommended_line || 0,
            prop_type: READABLE_PROPS[rawProp] || rawProp.replace(/^(player_|batter_|pitcher_)/, '').replace(/_/g, ' '),
            hit_rate_l10: leg.hit_rate_l10 || leg.l10_hit_rate || leg.hitRate || null,
          };
        }),
      };
    });

    // Send to bot-send-telegram
    const { error: sendError } = await supabase.functions.invoke('bot-send-telegram', {
      body: {
        type: 'slate_status_update',
        data: {
          activeParlays: formattedActive,
          totalStake: cleanParlays.reduce((sum, p) => sum + (p.simulated_stake || 0), 0),
        },
      },
    });

    if (sendError) throw sendError;

    console.log(`[SlateStatus] Sent update: ${cleanParlays.length} active (filtered from ${parlays.length})`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        active: cleanParlays.length, 
        filtered: parlays.length - cleanParlays.length,
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
