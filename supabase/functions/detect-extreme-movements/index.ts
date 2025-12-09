import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Movement thresholds
const THRESHOLDS = {
  WARNING: 150,
  EXTREME: 200,
  CRITICAL: 300
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Extreme Movements] Starting detection scan...');

    // Fetch recent line movements with opening prices
    const { data: movements, error: fetchError } = await supabase
      .from('line_movements')
      .select('*')
      .not('opening_price', 'is', null)
      .gte('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to fetch movements: ${fetchError.message}`);
    }

    console.log(`[Extreme Movements] Analyzing ${movements?.length || 0} movements`);

    const alerts: any[] = [];

    // Group by event_id and outcome to find total movement
    const eventGroups = new Map<string, any[]>();
    
    for (const movement of movements || []) {
      const key = `${movement.event_id}_${movement.outcome_name}_${movement.market_type}`;
      if (!eventGroups.has(key)) {
        eventGroups.set(key, []);
      }
      eventGroups.get(key)!.push(movement);
    }

    // Analyze each group for extreme movements
    for (const [key, groupMovements] of eventGroups) {
      // Sort by time to get opening and current
      groupMovements.sort((a, b) => 
        new Date(a.detected_at).getTime() - new Date(b.detected_at).getTime()
      );

      const firstMovement = groupMovements[0];
      const lastMovement = groupMovements[groupMovements.length - 1];

      const openingPrice = firstMovement.opening_price || firstMovement.old_price;
      const currentPrice = lastMovement.new_price;
      const totalMovement = Math.abs(currentPrice - openingPrice);

      // Skip if movement is below threshold
      if (totalMovement < THRESHOLDS.WARNING) continue;

      // Determine alert level
      let alertLevel: 'warning' | 'extreme' | 'critical';
      if (totalMovement >= THRESHOLDS.CRITICAL) {
        alertLevel = 'critical';
      } else if (totalMovement >= THRESHOLDS.EXTREME) {
        alertLevel = 'extreme';
      } else {
        alertLevel = 'warning';
      }

      // Determine direction
      const direction = currentPrice < openingPrice ? 'shortened' : 'lengthened';

      // Calculate movement percentage
      const movementPercentage = Math.abs((currentPrice - openingPrice) / openingPrice) * 100;

      // Generate reasons
      const reasons = generateReasons(
        totalMovement, 
        direction, 
        groupMovements.length,
        lastMovement.is_sharp_action,
        lastMovement.trap_score
      );

      // Check if this is a trap indicator
      const isTrapIndicator = detectTrapIndicator(
        direction,
        totalMovement,
        lastMovement.is_sharp_action,
        groupMovements
      );

      const alert = {
        event_id: firstMovement.event_id,
        sport: firstMovement.sport,
        description: firstMovement.description,
        movement_type: firstMovement.player_name ? 'prop' : 'game_line',
        opening_price: openingPrice,
        current_price: currentPrice,
        total_movement: totalMovement,
        movement_percentage: Math.round(movementPercentage * 10) / 10,
        direction,
        alert_level: alertLevel,
        bookmaker: lastMovement.bookmaker,
        player_name: firstMovement.player_name,
        prop_type: firstMovement.market_type?.includes('player') ? firstMovement.market_type : null,
        reasons,
        is_trap_indicator: isTrapIndicator,
        commence_time: firstMovement.commence_time
      };

      alerts.push(alert);
    }

    console.log(`[Extreme Movements] Found ${alerts.length} extreme movement alerts`);

    // Upsert alerts to database
    let insertedCount = 0;
    for (const alert of alerts) {
      const { error } = await supabase
        .from('extreme_movement_alerts')
        .upsert(alert, {
          onConflict: 'event_id,description,movement_type'
        });

      if (error) {
        console.error(`[Extreme Movements] Insert error:`, error);
      } else {
        insertedCount++;
      }
    }

    // Clean up old alerts (>48 hours)
    await supabase
      .from('extreme_movement_alerts')
      .delete()
      .lt('created_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString());

    const summary = {
      critical: alerts.filter(a => a.alert_level === 'critical').length,
      extreme: alerts.filter(a => a.alert_level === 'extreme').length,
      warning: alerts.filter(a => a.alert_level === 'warning').length,
      traps: alerts.filter(a => a.is_trap_indicator).length
    };

    console.log(`[Extreme Movements] Summary: ${JSON.stringify(summary)}`);

    return new Response(JSON.stringify({
      success: true,
      alertsCreated: insertedCount,
      summary,
      alerts
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('[Extreme Movements] Error:', error);
    return new Response(JSON.stringify({ error: error?.message || 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function generateReasons(
  totalMovement: number,
  direction: string,
  movementCount: number,
  isSharp: boolean,
  trapScore: number
): string[] {
  const reasons: string[] = [];

  // Movement size
  if (totalMovement >= THRESHOLDS.CRITICAL) {
    reasons.push(`⚠️ CRITICAL: ${totalMovement} point move from open`);
  } else if (totalMovement >= THRESHOLDS.EXTREME) {
    reasons.push(`🔴 EXTREME: ${totalMovement} point line swing`);
  } else {
    reasons.push(`⚡ WARNING: ${totalMovement} point movement detected`);
  }

  // Direction
  if (direction === 'shortened') {
    reasons.push('Line shortened significantly - heavy action on this side');
  } else {
    reasons.push('Line lengthened significantly - action going against');
  }

  // Movement count
  if (movementCount >= 5) {
    reasons.push(`Multiple adjustments (${movementCount}x) - volatile line`);
  }

  // Sharp action
  if (isSharp) {
    reasons.push('Sharp money detected on this movement');
  }

  // Trap warning
  if (trapScore >= 50) {
    reasons.push('⚠️ Historical trap pattern detected');
  }

  return reasons;
}

function detectTrapIndicator(
  direction: string,
  totalMovement: number,
  isSharp: boolean,
  movements: any[]
): boolean {
  // Large movement towards public side without sharp confirmation
  if (totalMovement >= 200 && !isSharp) {
    return true;
  }

  // Line moved one way then reversed (possible trap setup)
  if (movements.length >= 3) {
    const firstDirection = movements[1].price_change > 0 ? 'up' : 'down';
    const lastDirection = movements[movements.length - 1].price_change > 0 ? 'up' : 'down';
    if (firstDirection !== lastDirection) {
      return true;
    }
  }

  // High trap score on any movement
  const maxTrapScore = Math.max(...movements.map(m => m.trap_score || 0));
  if (maxTrapScore >= 60) {
    return true;
  }

  return false;
}
