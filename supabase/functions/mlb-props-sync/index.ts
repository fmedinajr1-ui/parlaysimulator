import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const today = getEasternDate();

  try {
    console.log(`[MLB-Props-Sync] Syncing MLB props to unified_props for ${today}`);

    // Fetch today's MLB props from pp_snapshot
    const { data: mlbProps, error: fetchErr } = await supabase
      .from('pp_snapshot')
      .select('*')
      .eq('sport', 'baseball_mlb')
      .eq('is_active', true)
      .gte('captured_at', `${today}T00:00:00`)
      .order('captured_at', { ascending: false });

    if (fetchErr) throw new Error(`pp_snapshot fetch error: ${fetchErr.message}`);

    const props = mlbProps || [];
    console.log(`[MLB-Props-Sync] Found ${props.length} MLB props in pp_snapshot`);

    if (props.length === 0) {
      return new Response(JSON.stringify({ success: true, synced: 0, message: 'No MLB props today' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Deduplicate: keep latest per player+stat combo
    const seen = new Map<string, typeof props[0]>();
    for (const p of props) {
      const key = `${p.player_name}|${p.stat_type}`;
      if (!seen.has(key)) seen.set(key, p);
    }

    const uniqueProps = [...seen.values()];
    console.log(`[MLB-Props-Sync] ${uniqueProps.length} unique player+stat combos`);

    // Build unified_props rows
    const unifiedRows = uniqueProps.map(p => ({
      event_id: p.event_id || `mlb_${p.player_name}_${p.stat_type}_${today}`,
      sport: 'baseball_mlb',
      game_description: p.matchup || `${p.team || 'TBD'} - MLB`,
      commence_time: p.start_time,
      player_name: p.player_name,
      prop_type: p.stat_type,
      bookmaker: 'prizepicks',
      current_line: p.pp_line,
      over_price: -110,
      under_price: -110,
      is_active: true,
      updated_at: new Date().toISOString(),
    }));

    // Upsert into unified_props
    const { error: upsertErr } = await supabase
      .from('unified_props')
      .upsert(unifiedRows, { onConflict: 'event_id,player_name,prop_type,bookmaker' });

    if (upsertErr) {
      console.error(`[MLB-Props-Sync] Upsert error:`, upsertErr);
      throw new Error(`unified_props upsert error: ${upsertErr.message}`);
    }

    console.log(`[MLB-Props-Sync] ✅ Synced ${unifiedRows.length} MLB props to unified_props`);

    // Log stat type breakdown
    const statBreakdown: Record<string, number> = {};
    for (const r of unifiedRows) {
      statBreakdown[r.prop_type] = (statBreakdown[r.prop_type] || 0) + 1;
    }

    return new Response(JSON.stringify({
      success: true,
      synced: unifiedRows.length,
      statBreakdown,
      sampleProps: unifiedRows.slice(0, 5).map(r => ({
        player: r.player_name,
        prop: r.prop_type,
        line: r.current_line,
      })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[MLB-Props-Sync] Error:`, msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

