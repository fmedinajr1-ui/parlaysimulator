import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SharpMovement {
  player_name: string;
  prop_type: string;
  total_movement: number;
  direction: string;
  alert_level: string;
  is_trap: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { mode = 'pregame_check' } = await req.json().catch(() => ({}));
    
    console.log(`[prop-sharp-sync] Running in mode: ${mode}`);

    // Get upcoming games (1-3 hours from now)
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
    const threeHoursFromNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);

    // Fetch risk engine picks for today's games
    const { data: picks, error: picksError } = await supabase
      .from('nba_risk_engine_picks')
      .select('*')
      .gte('game_date', now.toISOString().split('T')[0])
      .order('confidence_score', { ascending: false });

    if (picksError) {
      console.error('[prop-sharp-sync] Error fetching picks:', picksError);
      throw picksError;
    }

    console.log(`[prop-sharp-sync] Found ${picks?.length || 0} pending picks`);

    if (!picks || picks.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No pending picks to sync',
        updated: 0 
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Fetch recent line movements with sharp action (last 2 hours)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    
    const { data: movements, error: movementsError } = await supabase
      .from('line_movements')
      .select('*')
      .gte('created_at', twoHoursAgo.toISOString())
      .or('is_sharp.eq.true,total_movement.gte.50')
      .order('created_at', { ascending: false });

    if (movementsError) {
      console.error('[prop-sharp-sync] Error fetching movements:', movementsError);
    }

    console.log(`[prop-sharp-sync] Found ${movements?.length || 0} sharp movements`);

    // Fetch extreme movement alerts
    const { data: alerts, error: alertsError } = await supabase
      .from('extreme_movement_alerts')
      .select('*')
      .gte('created_at', twoHoursAgo.toISOString())
      .in('alert_level', ['extreme', 'critical'])
      .order('created_at', { ascending: false });

    if (alertsError) {
      console.error('[prop-sharp-sync] Error fetching alerts:', alertsError);
    }

    console.log(`[prop-sharp-sync] Found ${alerts?.length || 0} extreme alerts`);

    // Match movements to picks
    const sharpMatches: { pickId: string; movement: SharpMovement }[] = [];

    for (const pick of picks) {
      const playerNameLower = pick.player_name.toLowerCase();
      const propTypeLower = pick.prop_type.toLowerCase().replace(/_/g, ' ');

      // Check line movements
      const matchingMovement = movements?.find(m => {
        const mPlayerLower = (m.player_name || '').toLowerCase();
        const mMarketLower = (m.market_type || '').toLowerCase();
        
        const nameMatch = mPlayerLower.includes(playerNameLower) || 
                          playerNameLower.includes(mPlayerLower);
        const propMatch = mMarketLower.includes(propTypeLower) || 
                          propTypeLower.includes(mMarketLower.replace('player ', ''));
        
        return nameMatch && propMatch;
      });

      // Check extreme alerts
      const matchingAlert = alerts?.find(a => {
        const aPlayerLower = (a.player_name || '').toLowerCase();
        const aPropLower = (a.prop_type || '').toLowerCase();
        
        const nameMatch = aPlayerLower.includes(playerNameLower) || 
                          playerNameLower.includes(aPlayerLower);
        const propMatch = aPropLower.includes(propTypeLower) || 
                          propTypeLower.includes(aPropLower);
        
        return nameMatch && propMatch;
      });

      if (matchingMovement || matchingAlert) {
        const movement = matchingMovement;
        const alert = matchingAlert;

        const totalMovement = movement?.total_movement || alert?.total_movement || 0;
        const direction = movement?.direction || alert?.direction || 'unknown';
        const alertLevel = alert?.alert_level || (totalMovement >= 100 ? 'extreme' : 'warning');
        const isTrap = alert?.is_trap_indicator || 
                       (totalMovement >= 150 && !movement?.is_sharp);

        sharpMatches.push({
          pickId: pick.id,
          movement: {
            player_name: pick.player_name,
            prop_type: pick.prop_type,
            total_movement: Math.abs(totalMovement),
            direction,
            alert_level: alertLevel,
            is_trap: isTrap
          }
        });

        console.log(`[prop-sharp-sync] Matched: ${pick.player_name} ${pick.prop_type} - ${alertLevel} movement (${totalMovement} pts)`);
      }
    }

    console.log(`[prop-sharp-sync] Total matches: ${sharpMatches.length}`);

    // Update picks with sharp alert data
    let updatedCount = 0;
    for (const match of sharpMatches) {
      const { error: updateError } = await supabase
        .from('nba_risk_engine_picks')
        .update({
          sharp_alert: true,
          sharp_alert_level: match.movement.alert_level,
          sharp_movement_pts: match.movement.total_movement,
          sharp_direction: match.movement.direction,
          sharp_detected_at: new Date().toISOString(),
          is_trap_indicator: match.movement.is_trap
        })
        .eq('id', match.pickId);

      if (updateError) {
        console.error(`[prop-sharp-sync] Error updating pick ${match.pickId}:`, updateError);
      } else {
        updatedCount++;

        // Insert into engine_live_tracker for real-time broadcast
        await supabase
          .from('engine_live_tracker')
          .insert({
            engine_name: 'SHARP_SYNC',
            sport: 'NBA',
            pick_description: `🔴 SHARP: ${match.movement.player_name} ${match.movement.prop_type} (${match.movement.total_movement}pts ${match.movement.direction})`,
            player_name: match.movement.player_name,
            prop_type: match.movement.prop_type,
            confidence: match.movement.total_movement,
            status: 'active',
            signals: {
              alert_level: match.movement.alert_level,
              movement_pts: match.movement.total_movement,
              direction: match.movement.direction,
              is_trap: match.movement.is_trap
            }
          });
      }
    }

    console.log(`[prop-sharp-sync] Updated ${updatedCount} picks with sharp alerts`);

    return new Response(JSON.stringify({
      success: true,
      mode,
      picks_checked: picks.length,
      movements_found: movements?.length || 0,
      alerts_found: alerts?.length || 0,
      matches: sharpMatches.length,
      updated: updatedCount,
      details: sharpMatches.map(m => ({
        player: m.movement.player_name,
        prop: m.movement.prop_type,
        movement: m.movement.total_movement,
        level: m.movement.alert_level,
        is_trap: m.movement.is_trap
      }))
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[prop-sharp-sync] Error:', errorMessage);
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
