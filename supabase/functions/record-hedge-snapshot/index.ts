import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HedgeSnapshotPayload {
  sweet_spot_id: string;
  player_name: string;
  prop_type: string;
  line: number;
  side: string;
  quarter: number;
  game_progress: number;
  hedge_status: string;
  hit_probability: number;
  current_value: number;
  projected_final: number;
  rate_per_minute?: number;
  rate_needed?: number;
  gap_to_line?: number;
  pace_rating?: number;
  zone_matchup_score?: number;
  rotation_tier?: string;
  risk_flags?: string[];
  live_book_line?: number;
  line_movement?: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const payload: HedgeSnapshotPayload = await req.json();
    
    console.log('[record-hedge-snapshot] Received payload:', {
      spotId: payload.sweet_spot_id,
      player: payload.player_name,
      quarter: payload.quarter,
      status: payload.hedge_status,
      probability: payload.hit_probability,
    });
    
    // Validate required fields
    if (!payload.sweet_spot_id || !payload.player_name || !payload.quarter) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: sweet_spot_id, player_name, quarter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate quarter range
    if (payload.quarter < 1 || payload.quarter > 4) {
      return new Response(
        JSON.stringify({ error: 'Quarter must be between 1 and 4' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Upsert snapshot (allows updating if same spot+quarter already exists)
    const { data, error } = await supabase
      .from('sweet_spot_hedge_snapshots')
      .upsert({
        sweet_spot_id: payload.sweet_spot_id,
        player_name: payload.player_name,
        prop_type: payload.prop_type,
        line: payload.line,
        side: payload.side,
        quarter: payload.quarter,
        game_progress: payload.game_progress,
        hedge_status: payload.hedge_status,
        hit_probability: Math.round(payload.hit_probability),
        current_value: payload.current_value,
        projected_final: payload.projected_final,
        rate_per_minute: payload.rate_per_minute,
        rate_needed: payload.rate_needed,
        gap_to_line: payload.gap_to_line,
        pace_rating: payload.pace_rating,
        zone_matchup_score: payload.zone_matchup_score,
        rotation_tier: payload.rotation_tier,
        risk_flags: payload.risk_flags,
        live_book_line: payload.live_book_line,
        line_movement: payload.line_movement,
        captured_at: new Date().toISOString(),
      }, {
        onConflict: 'sweet_spot_id,quarter',
      })
      .select()
      .single();
    
    if (error) {
      console.error('[record-hedge-snapshot] Database error:', error);
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log('[record-hedge-snapshot] Successfully recorded snapshot:', {
      id: data?.id,
      spotId: payload.sweet_spot_id,
      quarter: payload.quarter,
    });
    
    return new Response(
      JSON.stringify({ success: true, data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[record-hedge-snapshot] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
