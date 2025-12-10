import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface JuicedProp {
  id: string;
  player_name: string;
  prop_type: string;
  line: number;
  final_pick: string;
  sport: string;
  event_id: string;
  commence_time: string;
  juice_level: string;
  juice_direction: string;
}

// Map prop types to stat types - FIXED to match actual database values
const PROP_TO_STAT_MAP: Record<string, string> = {
  // Primary mappings (actual database prop_type values)
  'Points': 'points',
  'Rebounds': 'rebounds', 
  'Assists': 'assists',
  '3-Pointers': 'threes_made',
  'Blocks': 'blocks',
  'Steals': 'steals',
  'Turnovers': 'turnovers',
  'Pts+Reb+Ast': 'pra',
  'Pts+Reb': 'pr',
  'Pts+Ast': 'pa',
  'Reb+Ast': 'ra',
  // Alternative formats
  'points': 'points',
  'rebounds': 'rebounds',
  'assists': 'assists',
  'threes': 'threes_made',
  'blocks': 'blocks',
  'steals': 'steals',
  'turnovers': 'turnovers',
  // Legacy mappings (backwards compatibility)
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_turnovers': 'turnovers',
  'player_points_rebounds_assists': 'pra',
  'player_points_rebounds': 'pr',
  'player_points_assists': 'pa',
  'player_rebounds_assists': 'ra',
  // NFL props
  'Rush Yards': 'rush_yards',
  'Pass TDs': 'pass_tds',
  'Pass Yards': 'pass_yards',
  'Receiving Yards': 'receiving_yards',
  'Receptions': 'receptions',
};

// Normalize player names for matching
function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.\-']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    const startTime = Date.now();

    // Get juiced props that need verification (have final_pick, game time passed, not verified)
    const { data: pendingProps, error: fetchError } = await supabase
      .from('juiced_props')
      .select('*')
      .not('final_pick', 'is', null)
      .eq('outcome', 'pending')
      .lt('commence_time', new Date().toISOString())
      .order('commence_time', { ascending: true })
      .limit(100);

    if (fetchError) throw fetchError;

    console.log(`[VerifyJuiced] Found ${pendingProps?.length || 0} props to verify`);

    if (!pendingProps || pendingProps.length === 0) {
      return new Response(JSON.stringify({
        message: 'No juiced props to verify',
        verified: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let verifiedCount = 0;
    let wonCount = 0;
    let lostCount = 0;
    let pushCount = 0;
    let notFoundCount = 0;

    for (const prop of pendingProps as JuicedProp[]) {
      const statType = PROP_TO_STAT_MAP[prop.prop_type];
      if (!statType) {
        console.log(`[VerifyJuiced] Unknown prop type: "${prop.prop_type}" for ${prop.player_name}`);
        notFoundCount++;
        continue;
      }

      const normalizedName = normalizePlayerName(prop.player_name);
      const nameParts = normalizedName.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts[nameParts.length - 1] || '';

      console.log(`[VerifyJuiced] Processing: ${prop.player_name} (${normalizedName}) - ${prop.prop_type} -> ${statType}`);

      // Try to find player stats from cache
      let actualValue: number | null = null;

      // Get game date range (±1 day to handle timezone differences)
      const gameDate = new Date(prop.commence_time);
      const startDate = new Date(gameDate.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const endDate = new Date(gameDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const exactDate = gameDate.toISOString().split('T')[0];

      // Check player_stats_cache first
      const { data: statsCache } = await supabase
        .from('player_stats_cache')
        .select('stat_value, player_name')
        .ilike('player_name', `%${firstName}%`)
        .ilike('player_name', `%${lastName}%`)
        .eq('stat_type', statType)
        .gte('game_date', startDate)
        .lte('game_date', endDate)
        .limit(1);

      if (statsCache && statsCache.length > 0) {
        actualValue = statsCache[0].stat_value;
        console.log(`[VerifyJuiced] Found in player_stats_cache: ${statsCache[0].player_name} = ${actualValue}`);
      }

      // Check NBA game logs as fallback for basketball
      if (actualValue === null && (prop.sport.includes('basketball') || prop.sport.includes('NBA'))) {
        // Try exact date first
        let { data: gameLogs } = await supabase
          .from('nba_player_game_logs')
          .select('*')
          .ilike('player_name', `%${firstName}%`)
          .ilike('player_name', `%${lastName}%`)
          .eq('game_date', exactDate)
          .limit(1);

        // If no exact match, try date range
        if (!gameLogs || gameLogs.length === 0) {
          const { data: rangeGameLogs } = await supabase
            .from('nba_player_game_logs')
            .select('*')
            .ilike('player_name', `%${firstName}%`)
            .ilike('player_name', `%${lastName}%`)
            .gte('game_date', startDate)
            .lte('game_date', endDate)
            .limit(1);
          gameLogs = rangeGameLogs;
        }

        if (gameLogs && gameLogs.length > 0) {
          const log = gameLogs[0];
          console.log(`[VerifyJuiced] Found in nba_player_game_logs: ${log.player_name} on ${log.game_date}`);
          
          switch (statType) {
            case 'points': actualValue = log.points; break;
            case 'rebounds': actualValue = log.rebounds; break;
            case 'assists': actualValue = log.assists; break;
            case 'threes_made': actualValue = log.threes_made; break;
            case 'blocks': actualValue = log.blocks; break;
            case 'steals': actualValue = log.steals; break;
            case 'turnovers': actualValue = log.turnovers; break;
            case 'pra': actualValue = (log.points || 0) + (log.rebounds || 0) + (log.assists || 0); break;
            case 'pr': actualValue = (log.points || 0) + (log.rebounds || 0); break;
            case 'pa': actualValue = (log.points || 0) + (log.assists || 0); break;
            case 'ra': actualValue = (log.rebounds || 0) + (log.assists || 0); break;
          }
        }
      }

      if (actualValue === null) {
        console.log(`[VerifyJuiced] No stats found for ${prop.player_name} - ${prop.prop_type} (date: ${exactDate})`);
        notFoundCount++;
        continue;
      }

      // Determine outcome
      let outcome: 'won' | 'lost' | 'push';
      
      if (actualValue === prop.line) {
        outcome = 'push';
        pushCount++;
      } else if (prop.final_pick === 'over' || prop.final_pick === 'Over') {
        outcome = actualValue > prop.line ? 'won' : 'lost';
      } else {
        outcome = actualValue < prop.line ? 'won' : 'lost';
      }

      if (outcome === 'won') wonCount++;
      if (outcome === 'lost') lostCount++;

      // Update the juiced prop
      const { error: updateError } = await supabase
        .from('juiced_props')
        .update({
          outcome,
          actual_value: actualValue,
          verified_at: new Date().toISOString()
        })
        .eq('id', prop.id);

      if (!updateError) {
        verifiedCount++;
        console.log(`[VerifyJuiced] ✅ Verified: ${prop.player_name} ${prop.prop_type} - Line: ${prop.line}, Actual: ${actualValue}, Pick: ${prop.final_pick}, Outcome: ${outcome}`);
      } else {
        console.error(`[VerifyJuiced] Update error for ${prop.id}:`, updateError);
      }
    }

    // Update accuracy metrics
    const { data: accuracyData } = await supabase
      .from('juiced_props')
      .select('juice_level, juice_direction, prop_type, sport, outcome')
      .not('outcome', 'eq', 'pending');

    if (accuracyData && accuracyData.length > 0) {
      // Group by juice_level and juice_direction
      const groups: Record<string, any[]> = {};
      for (const row of accuracyData) {
        const key = `${row.juice_level}|${row.juice_direction}|${row.prop_type || 'all'}|${row.sport || 'all'}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(row);
      }

      for (const [key, rows] of Object.entries(groups)) {
        const [juice_level, juice_direction, prop_type, sport] = key.split('|');
        const total = rows.length;
        const won = rows.filter(r => r.outcome === 'won').length;
        const lost = rows.filter(r => r.outcome === 'lost').length;
        const push = rows.filter(r => r.outcome === 'push').length;
        const winRate = total > 0 ? (won / (total - push)) * 100 : 0;
        const roi = total > 0 ? ((won * 0.91 - lost) / (total - push)) * 100 : 0;

        await supabase.from('juiced_props_accuracy_metrics').upsert({
          juice_level,
          juice_direction,
          prop_type: prop_type === 'all' ? null : prop_type,
          sport: sport === 'all' ? null : sport,
          total_picks: total,
          total_won: won,
          total_lost: lost,
          total_push: push,
          win_rate: Math.round(winRate * 10) / 10,
          roi_percentage: Math.round(roi * 10) / 10,
          updated_at: new Date().toISOString()
        }, { onConflict: 'juice_level,juice_direction,prop_type,sport' });
      }
    }

    const duration = Date.now() - startTime;

    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-juiced-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: { 
        verified: verifiedCount, 
        won: wonCount,
        lost: lostCount,
        push: pushCount,
        notFound: notFoundCount,
        winRate: verifiedCount > 0 ? Math.round((wonCount / (verifiedCount - pushCount)) * 1000) / 10 : 0
      }
    });

    console.log(`[VerifyJuiced] Summary: Verified=${verifiedCount}, Won=${wonCount}, Lost=${lostCount}, Push=${pushCount}, NotFound=${notFoundCount}`);

    return new Response(JSON.stringify({
      message: `Verified ${verifiedCount} juiced props`,
      verified: verifiedCount,
      won: wonCount,
      lost: lostCount,
      push: pushCount,
      notFound: notFoundCount,
      winRate: verifiedCount > 0 ? Math.round((wonCount / (verifiedCount - pushCount)) * 1000) / 10 : 0,
      duration
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('[VerifyJuiced] Error:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
