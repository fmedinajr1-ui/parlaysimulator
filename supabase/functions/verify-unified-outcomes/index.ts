import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log('[VerifyUnified] Starting unified outcome verification...');
    const startTime = Date.now();

    // Fetch pending unified props that should be settled
    const { data: pendingProps, error: fetchError } = await supabase
      .from('unified_props')
      .select('*')
      .eq('outcome', 'pending')
      .eq('is_active', true)
      .lt('commence_time', new Date().toISOString());

    if (fetchError) {
      throw new Error(`Failed to fetch pending props: ${fetchError.message}`);
    }

    console.log(`[VerifyUnified] Found ${pendingProps?.length || 0} pending props to verify`);

    let verified = 0;
    let won = 0;
    let lost = 0;

    // Group by event for efficient API calls
    const eventGroups = new Map<string, typeof pendingProps>();
    for (const prop of pendingProps || []) {
      if (!eventGroups.has(prop.event_id)) {
        eventGroups.set(prop.event_id, []);
      }
      eventGroups.get(prop.event_id)!.push(prop);
    }

    // Fetch player stats and verify outcomes
    for (const [eventId, props] of eventGroups) {
      try {
        // Check if game is completed via player stats cache
        for (const prop of props) {
          const { data: stats } = await supabase
            .from('player_stats_cache')
            .select('*')
            .ilike('player_name', `%${prop.player_name.split(' ').pop()}%`)
            .eq('stat_type', mapPropToStatType(prop.prop_type))
            .gte('game_date', new Date(prop.commence_time).toISOString().split('T')[0])
            .lte('game_date', new Date(new Date(prop.commence_time).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0])
            .limit(1);

          if (stats && stats.length > 0) {
            const actualValue = stats[0].stat_value;
            const line = prop.current_line;
            const side = prop.recommended_side;

            let isWin = false;
            if (side === 'over') {
              isWin = actualValue > line;
            } else if (side === 'under') {
              isWin = actualValue < line;
            }

            const outcome = isWin ? 'won' : 'lost';
            
            await supabase
              .from('unified_props')
              .update({
                outcome,
                settled_at: new Date().toISOString(),
                is_active: false
              })
              .eq('id', prop.id);

            verified++;
            if (isWin) won++;
            else lost++;
          }
        }
      } catch (err) {
        console.error(`[VerifyUnified] Error verifying event ${eventId}:`, err);
      }
    }

    // Update calibration based on outcomes
    await updateCalibration(supabase);

    // Also run upset calibration
    await supabase.rpc('update_upset_calibration');

    const duration = Date.now() - startTime;

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-unified-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { verified, won, lost, winRate: verified > 0 ? (won / verified * 100).toFixed(1) : 0 }
    });

    console.log(`[VerifyUnified] Completed. Verified: ${verified}, Won: ${won}, Lost: ${lost}`);

    return new Response(JSON.stringify({
      success: true,
      verified,
      won,
      lost,
      winRate: verified > 0 ? (won / verified * 100).toFixed(1) : 0,
      duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[VerifyUnified] Error:', errorMessage);
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

function mapPropToStatType(propType: string): string {
  const mapping: Record<string, string> = {
    'player_points': 'points',
    'player_rebounds': 'rebounds',
    'player_assists': 'assists',
    'player_threes': 'threes',
    'player_blocks': 'blocks',
    'player_steals': 'steals',
    'player_goals': 'goals',
    'player_shots_on_goal': 'shots'
  };
  return mapping[propType] || propType;
}

async function updateCalibration(supabase: any): Promise<void> {
  try {
    // Calculate accuracy by category
    const { data: categoryStats } = await supabase
      .from('unified_props')
      .select('category, outcome')
      .neq('outcome', 'pending');

    if (!categoryStats || categoryStats.length === 0) return;

    const categoryAccuracy: Record<string, { total: number; won: number }> = {};
    
    for (const stat of categoryStats) {
      if (!categoryAccuracy[stat.category]) {
        categoryAccuracy[stat.category] = { total: 0, won: 0 };
      }
      categoryAccuracy[stat.category].total++;
      if (stat.outcome === 'won') {
        categoryAccuracy[stat.category].won++;
      }
    }

    // Update calibration factors
    for (const [category, stats] of Object.entries(categoryAccuracy)) {
      if (stats.total >= 10) {
        const accuracy = stats.won / stats.total;
        
        await supabase.from('ai_calibration_factors').upsert({
          sport: 'unified',
          bet_type: category,
          odds_bucket: 'all',
          predicted_probability: 0.5,
          actual_win_rate: accuracy,
          calibration_factor: accuracy / 0.5,
          sample_size: stats.total,
          total_wins: stats.won,
          total_bets: stats.total,
          last_updated: new Date().toISOString()
        }, { onConflict: 'sport,bet_type,odds_bucket' });
      }
    }

    console.log('[VerifyUnified] Updated calibration factors:', categoryAccuracy);
  } catch (err) {
    console.error('[VerifyUnified] Calibration update error:', err);
  }
}
