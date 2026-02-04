import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Prop type configurations
const PROP_CONFIGS = [
  { propType: 'points', gameLogField: 'points' },
  { propType: 'assists', gameLogField: 'assists' },
  { propType: 'threes', gameLogField: 'threes_made' },
  { propType: 'blocks', gameLogField: 'blocks' },
];

// Quarter distribution patterns based on player tier and NBA research
// Stars tend to pace in Q1, peak Q2/Q3, and conserve/close in Q4
// Role players more affected by garbage time in Q4
const TIER_DISTRIBUTIONS = {
  star: { q1: 0.24, q2: 0.26, q3: 0.26, q4: 0.24 },      // 32+ min
  starter: { q1: 0.25, q2: 0.25, q3: 0.26, q4: 0.24 },   // 24-32 min
  role_player: { q1: 0.26, q2: 0.26, q3: 0.24, q4: 0.24 }, // <24 min
};

// Determine player tier based on average minutes
function getPlayerTier(avgMinutes: number): 'star' | 'starter' | 'role_player' {
  if (avgMinutes >= 32) return 'star';
  if (avgMinutes >= 24) return 'starter';
  return 'role_player';
}

// Calculate baselines for a single player from their L10 game logs
function calculatePlayerBaselines(
  playerName: string,
  gameLogs: any[],
  propType: string,
  gameLogField: string
) {
  if (!gameLogs || gameLogs.length === 0) return null;

  // Calculate L10 averages
  const sampleSize = gameLogs.length;
  let totalStat = 0;
  let totalMinutes = 0;

  for (const log of gameLogs) {
    totalStat += log[gameLogField] || 0;
    totalMinutes += log.minutes_played || 0;
  }

  const gameAvg = totalStat / sampleSize;
  const minutesAvg = totalMinutes / sampleSize;
  const tier = getPlayerTier(minutesAvg);
  const distribution = TIER_DISTRIBUTIONS[tier];

  // Calculate quarter averages based on distribution
  const q1Avg = gameAvg * distribution.q1;
  const q2Avg = gameAvg * distribution.q2;
  const q3Avg = gameAvg * distribution.q3;
  const q4Avg = gameAvg * distribution.q4;

  // Calculate per-minute rates (assuming 12 min quarters)
  const avgMinutesPerQuarter = minutesAvg / 4;
  const q1Rate = avgMinutesPerQuarter > 0 ? q1Avg / avgMinutesPerQuarter : 0;
  const q2Rate = avgMinutesPerQuarter > 0 ? q2Avg / avgMinutesPerQuarter : 0;
  const q3Rate = avgMinutesPerQuarter > 0 ? q3Avg / avgMinutesPerQuarter : 0;
  const q4Rate = avgMinutesPerQuarter > 0 ? q4Avg / avgMinutesPerQuarter : 0;

  // Half distributions
  const h1Pct = distribution.q1 + distribution.q2;
  const h2Pct = distribution.q3 + distribution.q4;

  return {
    player_name: playerName,
    prop_type: propType,
    q1_pct: distribution.q1,
    q2_pct: distribution.q2,
    q3_pct: distribution.q3,
    q4_pct: distribution.q4,
    q1_avg: Math.round(q1Avg * 100) / 100,
    q2_avg: Math.round(q2Avg * 100) / 100,
    q3_avg: Math.round(q3Avg * 100) / 100,
    q4_avg: Math.round(q4Avg * 100) / 100,
    h1_pct: h1Pct,
    h2_pct: h2Pct,
    q1_rate: Math.round(q1Rate * 10000) / 10000,
    q2_rate: Math.round(q2Rate * 10000) / 10000,
    q3_rate: Math.round(q3Rate * 10000) / 10000,
    q4_rate: Math.round(q4Rate * 10000) / 10000,
    game_avg: Math.round(gameAvg * 100) / 100,
    sample_size: sampleSize,
    minutes_avg: Math.round(minutesAvg * 100) / 100,
    player_tier: tier,
    updated_at: new Date().toISOString(),
  };
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

    console.log('[calculate-quarter-baselines] Starting baseline calculation...');

    // Get all unique players from recent game logs (L10 window)
    const { data: players, error: playersError } = await supabase
      .from('nba_player_game_logs')
      .select('player_name')
      .gte('game_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]) // Last 30 days
      .order('player_name');

    if (playersError) {
      console.error('[calculate-quarter-baselines] Error fetching players:', playersError);
      throw playersError;
    }

    // Get unique player names
    const uniquePlayers = [...new Set(players?.map(p => p.player_name) || [])];
    console.log(`[calculate-quarter-baselines] Found ${uniquePlayers.length} unique players`);

    const allBaselines: any[] = [];
    const batchSize = 10;

    // Process players in batches to avoid timeout
    for (let i = 0; i < uniquePlayers.length; i += batchSize) {
      const batch = uniquePlayers.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (playerName) => {
        // Fetch L10 game logs for this player
        const { data: gameLogs, error: logsError } = await supabase
          .from('nba_player_game_logs')
          .select('player_name, points, assists, threes_made, blocks, minutes_played, game_date')
          .eq('player_name', playerName)
          .order('game_date', { ascending: false })
          .limit(10);

        if (logsError) {
          console.warn(`[calculate-quarter-baselines] Error fetching logs for ${playerName}:`, logsError);
          return;
        }

        if (!gameLogs || gameLogs.length < 3) {
          // Skip players with insufficient data
          return;
        }

        // Calculate baselines for each prop type
        for (const config of PROP_CONFIGS) {
          const baseline = calculatePlayerBaselines(
            playerName,
            gameLogs,
            config.propType,
            config.gameLogField
          );
          
          if (baseline && baseline.game_avg > 0) {
            allBaselines.push(baseline);
          }
        }
      }));

      console.log(`[calculate-quarter-baselines] Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(uniquePlayers.length / batchSize)}`);
    }

    console.log(`[calculate-quarter-baselines] Generated ${allBaselines.length} baseline records`);

    // Upsert all baselines
    if (allBaselines.length > 0) {
      // Process in chunks to avoid payload limits
      const chunkSize = 50;
      let upsertedCount = 0;

      for (let i = 0; i < allBaselines.length; i += chunkSize) {
        const chunk = allBaselines.slice(i, i + chunkSize);
        
        const { error: upsertError } = await supabase
          .from('player_quarter_baselines')
          .upsert(chunk, { 
            onConflict: 'player_name,prop_type',
            ignoreDuplicates: false 
          });

        if (upsertError) {
          console.error(`[calculate-quarter-baselines] Upsert error for chunk ${i}:`, upsertError);
        } else {
          upsertedCount += chunk.length;
        }
      }

      console.log(`[calculate-quarter-baselines] Upserted ${upsertedCount} baseline records`);
    }

    const result = {
      success: true,
      playersProcessed: uniquePlayers.length,
      baselinesGenerated: allBaselines.length,
      timestamp: new Date().toISOString(),
    };

    console.log('[calculate-quarter-baselines] Complete:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[calculate-quarter-baselines] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
