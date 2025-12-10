import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Map prop types to stat columns in nba_player_game_logs
const PROP_TO_STAT_MAP: Record<string, string> = {
  // Exact database prop_type values
  'Points': 'points',
  'Rebounds': 'rebounds', 
  'Assists': 'assists',
  '3-Pointers': 'threes_made',
  'Blocks': 'blocks',
  'Steals': 'steals',
  'Turnovers': 'turnovers',
  // Legacy/alternative formats
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_goals': 'goals',
  'player_shots_on_goal': 'shots',
  // Combined props (need special handling)
  'Pts+Reb+Ast': 'pra',
  'Pts+Reb': 'pr',
  'Pts+Ast': 'pa',
  'Reb+Ast': 'ra',
};

function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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
    let notFound = 0;

    for (const prop of pendingProps || []) {
      try {
        const propType = prop.prop_type;
        const statColumn = PROP_TO_STAT_MAP[propType];
        
        if (!statColumn) {
          console.log(`[VerifyUnified] Unknown prop type: ${propType}`);
          continue;
        }

        const playerName = prop.player_name;
        const normalizedName = normalizePlayerName(playerName);
        const nameParts = normalizedName.split(' ');
        const lastName = nameParts[nameParts.length - 1];
        const firstName = nameParts[0];

        // Calculate game date range
        const propDate = new Date(prop.commence_time);
        const startDate = new Date(propDate);
        startDate.setDate(startDate.getDate() - 1);
        const endDate = new Date(propDate);
        endDate.setDate(endDate.getDate() + 1);

        // Try to find player stats from nba_player_game_logs
        let actualValue: number | null = null;

        // Handle combined props
        if (statColumn === 'pra') {
          const { data: logs } = await supabase
            .from('nba_player_game_logs')
            .select('points, rebounds, assists')
            .or(`player_name.ilike.%${lastName}%,player_name.ilike.%${firstName}%`)
            .gte('game_date', startDate.toISOString().split('T')[0])
            .lte('game_date', endDate.toISOString().split('T')[0])
            .limit(5);

          if (logs && logs.length > 0) {
            const matchedLog = logs.find(log => 
              normalizePlayerName(log.player_name || '').includes(lastName)
            ) || logs[0];
            actualValue = (matchedLog.points || 0) + (matchedLog.rebounds || 0) + (matchedLog.assists || 0);
          }
        } else if (statColumn === 'pr') {
          const { data: logs } = await supabase
            .from('nba_player_game_logs')
            .select('points, rebounds')
            .or(`player_name.ilike.%${lastName}%,player_name.ilike.%${firstName}%`)
            .gte('game_date', startDate.toISOString().split('T')[0])
            .lte('game_date', endDate.toISOString().split('T')[0])
            .limit(5);

          if (logs && logs.length > 0) {
            const matchedLog = logs.find(log => 
              normalizePlayerName(log.player_name || '').includes(lastName)
            ) || logs[0];
            actualValue = (matchedLog.points || 0) + (matchedLog.rebounds || 0);
          }
        } else if (statColumn === 'pa') {
          const { data: logs } = await supabase
            .from('nba_player_game_logs')
            .select('points, assists')
            .or(`player_name.ilike.%${lastName}%,player_name.ilike.%${firstName}%`)
            .gte('game_date', startDate.toISOString().split('T')[0])
            .lte('game_date', endDate.toISOString().split('T')[0])
            .limit(5);

          if (logs && logs.length > 0) {
            const matchedLog = logs.find(log => 
              normalizePlayerName(log.player_name || '').includes(lastName)
            ) || logs[0];
            actualValue = (matchedLog.points || 0) + (matchedLog.assists || 0);
          }
        } else if (statColumn === 'ra') {
          const { data: logs } = await supabase
            .from('nba_player_game_logs')
            .select('rebounds, assists')
            .or(`player_name.ilike.%${lastName}%,player_name.ilike.%${firstName}%`)
            .gte('game_date', startDate.toISOString().split('T')[0])
            .lte('game_date', endDate.toISOString().split('T')[0])
            .limit(5);

          if (logs && logs.length > 0) {
            const matchedLog = logs.find(log => 
              normalizePlayerName(log.player_name || '').includes(lastName)
            ) || logs[0];
            actualValue = (matchedLog.rebounds || 0) + (matchedLog.assists || 0);
          }
        } else {
          // Single stat - select all relevant columns
          const { data: logs } = await supabase
            .from('nba_player_game_logs')
            .select('player_name, points, rebounds, assists, blocks, steals, turnovers, threes_made')
            .or(`player_name.ilike.%${lastName}%,player_name.ilike.%${firstName}%`)
            .gte('game_date', startDate.toISOString().split('T')[0])
            .lte('game_date', endDate.toISOString().split('T')[0])
            .limit(5);

          if (logs && logs.length > 0) {
            const matchedLog = logs.find((log: any) => 
              normalizePlayerName(log.player_name || '').includes(lastName)
            ) || logs[0];
            
            // Map stat column to actual value
            const statMap: Record<string, string> = {
              'points': 'points',
              'rebounds': 'rebounds',
              'assists': 'assists',
              'blocks': 'blocks',
              'steals': 'steals',
              'turnovers': 'turnovers',
              'threes_made': 'threes_made'
            };
            
            const actualColumn = statMap[statColumn] || statColumn;
            actualValue = (matchedLog as any)[actualColumn];
          }
        }

        if (actualValue === null) {
          notFound++;
          console.log(`[VerifyUnified] No stats found for ${playerName} (${propType})`);
          continue;
        }

        const line = prop.current_line;
        const side = prop.recommended_side;

        let isWin = false;
        if (side === 'over') {
          isWin = actualValue > line;
        } else if (side === 'under') {
          isWin = actualValue < line;
        }

        const outcome = isWin ? 'won' : 'lost';
        
        console.log(`[VerifyUnified] ${playerName} ${propType}: ${actualValue} vs ${line} (${side}) = ${outcome}`);

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

      } catch (err) {
        console.error(`[VerifyUnified] Error verifying prop ${prop.id}:`, err);
      }
    }

    // Update calibration based on outcomes
    await updateCalibration(supabase);

    // Also run upset calibration
    try {
      await supabase.rpc('update_upset_calibration');
    } catch (e) {
      console.log('[VerifyUnified] Upset calibration RPC error (non-fatal):', e);
    }

    const duration = Date.now() - startTime;

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-unified-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { verified, won, lost, notFound, winRate: verified > 0 ? (won / verified * 100).toFixed(1) : 0 }
    });

    console.log(`[VerifyUnified] Completed. Verified: ${verified}, Won: ${won}, Lost: ${lost}, Not Found: ${notFound}`);

    return new Response(JSON.stringify({
      success: true,
      verified,
      won,
      lost,
      notFound,
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
