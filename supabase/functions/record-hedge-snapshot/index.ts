import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HedgeSnapshotPayload {
  sweet_spot_id?: string; // Now optional - may be null for client-generated spots
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
  analysis_date?: string; // YYYY-MM-DD format for outcome matching
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
    
    // Validate required fields - sweet_spot_id no longer required
    if (!payload.player_name || !payload.quarter) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: player_name, quarter' }),
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
    
    // Calculate analysis_date from payload or use current date
    const analysisDate = payload.analysis_date || new Date().toISOString().split('T')[0];
    
    // Generate a composite key for deduplication (player+prop+line+quarter+date)
    const compositeKey = `${payload.player_name.toLowerCase()}_${payload.prop_type}_${payload.line}_${payload.quarter}_${analysisDate}`;
    
    console.log('[record-hedge-snapshot] Recording snapshot with composite key:', compositeKey);
    
    // Insert snapshot directly - no FK validation needed
    // Use composite key matching for outcome verification later
    const { data, error } = await supabase
      .from('sweet_spot_hedge_snapshots')
      .upsert({
        sweet_spot_id: payload.sweet_spot_id || null, // Nullable now
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
        analysis_date: analysisDate,
        captured_at: new Date().toISOString(),
      }, {
        onConflict: 'player_name,prop_type,line,quarter,analysis_date',
        ignoreDuplicates: false,
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
