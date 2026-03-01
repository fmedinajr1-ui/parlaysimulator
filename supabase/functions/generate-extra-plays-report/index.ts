import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    console.log(`[extra-plays] Generating report for ${today}`);

    // 1. Fetch today's sweet spots (high confidence, active)
    const { data: sweetSpots } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, recommended_side, recommended_line, confidence_score, actual_hit_rate, quality_tier')
      .eq('analysis_date', today)
      .eq('is_active', true)
      .gte('confidence_score', 70)
      .order('confidence_score', { ascending: false });

    // 2. Fetch today's mispriced lines (ELITE/HIGH tier)
    const { data: mispricedLines } = await supabase
      .from('mispriced_lines')
      .select('player_name, prop_type, signal, book_line, edge_pct, tier, analysis_date')
      .eq('analysis_date', today)
      .in('tier', ['ELITE', 'HIGH'])
      .order('edge_pct', { ascending: false });

    // 3. Fetch today's parlay legs to exclude
    const { data: parlays } = await supabase
      .from('bot_daily_parlays')
      .select('legs')
      .eq('parlay_date', today);

    // 4. Extract all player+prop combos from parlays
    const parlayKeys = new Set<string>();
    for (const p of (parlays || [])) {
      const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs || '[]');
      for (const leg of legs) {
        const playerName = (leg.player_name || leg.player || '').toLowerCase().trim();
        const propType = (leg.prop_type || leg.market || leg.prop || '').toLowerCase().trim();
        if (playerName && propType) {
          parlayKeys.add(`${playerName}__${propType}`);
        }
      }
    }

    console.log(`[extra-plays] Found ${parlayKeys.size} player+prop combos in parlays`);

    // 5. Filter out picks already in parlays
    const extraMispriced = (mispricedLines || []).filter(m => {
      const key = `${m.player_name.toLowerCase().trim()}__${m.prop_type.toLowerCase().trim()}`;
      return !parlayKeys.has(key);
    });

    const extraSweetSpots = (sweetSpots || []).filter(s => {
      const key = `${s.player_name.toLowerCase().trim()}__${s.prop_type.toLowerCase().trim()}`;
      return !parlayKeys.has(key);
    });

    // 6. Deduplicate across tables (mispriced takes priority)
    const mispricedKeys = new Set(extraMispriced.map(m =>
      `${m.player_name.toLowerCase().trim()}__${m.prop_type.toLowerCase().trim()}`
    ));
    const dedupedSweetSpots = extraSweetSpots.filter(s => {
      const key = `${s.player_name.toLowerCase().trim()}__${s.prop_type.toLowerCase().trim()}`;
      return !mispricedKeys.has(key);
    });

    const totalExtras = extraMispriced.length + dedupedSweetSpots.length;
    console.log(`[extra-plays] ${totalExtras} extra plays found (${extraMispriced.length} mispriced, ${dedupedSweetSpots.length} sweet spots)`);

    if (totalExtras === 0) {
      return new Response(JSON.stringify({ success: true, totalExtras: 0, message: 'No extra plays found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 7. Send to admin via bot-send-telegram
    await fetch(`${supabaseUrl}/functions/v1/bot-send-telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        type: 'extra_plays_report',
        data: {
          mispriced: extraMispriced,
          sweetSpots: dedupedSweetSpots,
          totalExtras,
          parlayCount: (parlays || []).length,
        },
      }),
    });

    return new Response(JSON.stringify({
      success: true,
      totalExtras,
      mispriced: extraMispriced.length,
      sweetSpots: dedupedSweetSpots.length,
      parlayLegsExcluded: parlayKeys.size,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[extra-plays] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
