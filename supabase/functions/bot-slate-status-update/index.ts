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

    // Query all parlays for today
    const { data: parlays, error } = await supabase
      .from('bot_daily_parlays')
      .select('*')
      .eq('parlay_date', today);

    if (error) throw error;

    if (!parlays || parlays.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'No parlays found for today' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Separate active (pending) vs voided
    const activeParlays = parlays.filter(p => p.outcome === 'pending' || p.outcome === null);
    const voidedParlays = parlays.filter(p => p.outcome === 'void' || p.outcome === 'voided');

    // Build voided reasons from selection_rationale or lesson_learned
    const reasonSet = new Set<string>();
    for (const v of voidedParlays) {
      if (v.selection_rationale) {
        // Extract short reason keywords
        const r = v.selection_rationale.toLowerCase();
        if (r.includes('probability') || r.includes('low prob')) reasonSet.add('low probability');
        if (r.includes('redundant') || r.includes('duplicate') || r.includes('exposure')) reasonSet.add('redundant legs');
        if (r.includes('exposure') || r.includes('limit')) reasonSet.add('exposure limits');
        if (r.includes('blocked') || r.includes('banned')) reasonSet.add('blocked category');
        if (r.includes('quality') || r.includes('gate')) reasonSet.add('quality gate filter');
      }
    }
    const voidedReasons = reasonSet.size > 0 
      ? Array.from(reasonSet) 
      : ['low probability', 'redundant legs', 'exposure limits'];

    // Format active parlays with leg details
    const formattedActive = activeParlays.map(p => {
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
          voidedCount: voidedParlays.length,
          voidedReasons,
          activeParlays: formattedActive,
        },
      },
    });

    if (sendError) throw sendError;

    console.log(`[SlateStatus] Sent update: ${activeParlays.length} active, ${voidedParlays.length} voided`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        active: activeParlays.length, 
        voided: voidedParlays.length 
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
