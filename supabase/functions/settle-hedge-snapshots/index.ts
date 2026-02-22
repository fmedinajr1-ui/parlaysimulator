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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find unsettled snapshots
    const { data: unsettled, error: fetchError } = await supabase
      .from('sweet_spot_hedge_snapshots')
      .select('id, player_name, prop_type, line, side, analysis_date')
      .is('outcome', null)
      .order('analysis_date', { ascending: false })
      .limit(500);

    if (fetchError) {
      console.error('[settle-hedge-snapshots] Fetch error:', fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!unsettled || unsettled.length === 0) {
      return new Response(JSON.stringify({ settled: 0, message: 'No unsettled snapshots' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[settle-hedge-snapshots] Found ${unsettled.length} unsettled snapshots`);

    // Get unique analysis dates
    const dates = [...new Set(unsettled.map(s => s.analysis_date))];

    // Fetch settled outcomes from category_sweet_spots
    const { data: outcomes, error: outcomeError } = await supabase
      .from('category_sweet_spots')
      .select('player_name, prop_type, recommended_line, actual_value, analysis_date')
      .in('analysis_date', dates)
      .not('actual_value', 'is', null);

    if (outcomeError) {
      console.error('[settle-hedge-snapshots] Outcome fetch error:', outcomeError);
      return new Response(JSON.stringify({ error: outcomeError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!outcomes || outcomes.length === 0) {
      return new Response(JSON.stringify({ settled: 0, message: 'No settled outcomes found for snapshot dates' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build lookup: normalized_player_name + prop_type + date -> actual_value
    const outcomeLookup = new Map<string, number>();
    for (const o of outcomes) {
      const key = `${o.player_name.toLowerCase().trim()}_${o.prop_type.toLowerCase().trim()}_${o.analysis_date}`;
      outcomeLookup.set(key, o.actual_value);
    }

    let settledCount = 0;
    const updates: Array<{ id: string; actual_final: number; outcome: string }> = [];

    for (const snap of unsettled) {
      const key = `${snap.player_name.toLowerCase().trim()}_${snap.prop_type.toLowerCase().trim()}_${snap.analysis_date}`;
      const actualValue = outcomeLookup.get(key);

      if (actualValue === undefined) continue;

      const isOver = (snap.side ?? 'over').toLowerCase() === 'over';
      let outcome: string;

      if (actualValue === snap.line) {
        outcome = 'push';
      } else if (isOver) {
        outcome = actualValue > snap.line ? 'hit' : 'miss';
      } else {
        outcome = actualValue < snap.line ? 'hit' : 'miss';
      }

      updates.push({ id: snap.id, actual_final: actualValue, outcome });
    }

    // Batch updates
    for (const u of updates) {
      const { error: updateError } = await supabase
        .from('sweet_spot_hedge_snapshots')
        .update({ actual_final: u.actual_final, outcome: u.outcome })
        .eq('id', u.id);

      if (updateError) {
        console.error(`[settle-hedge-snapshots] Update error for ${u.id}:`, updateError);
      } else {
        settledCount++;
      }
    }

    console.log(`[settle-hedge-snapshots] Settled ${settledCount} snapshots`);

    return new Response(JSON.stringify({ settled: settledCount, total: unsettled.length }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[settle-hedge-snapshots] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
