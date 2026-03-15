import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Full prop type configs including rebounds and steals
const PROP_CONFIGS = [
  { propType: 'points', gameLogField: 'points' },
  { propType: 'assists', gameLogField: 'assists' },
  { propType: 'threes', gameLogField: 'threes_made' },
  { propType: 'blocks', gameLogField: 'blocks' },
  { propType: 'rebounds', gameLogField: 'rebounds' },
  { propType: 'steals', gameLogField: 'steals' },
];

// Refined tier distributions based on NBA research
// Stars: more even distribution, slight Q2/Q3 peak (highest usage periods)
// Starters: similar pattern with slight Q4 dip (subbed earlier in blowouts)
// Role players: stronger Q1 presence, weaker Q4 (garbage time less consistent)
const TIER_DISTRIBUTIONS = {
  star:        { q1: 0.24, q2: 0.26, q3: 0.27, q4: 0.23 },
  starter:     { q1: 0.25, q2: 0.26, q3: 0.26, q4: 0.23 },
  role_player: { q1: 0.26, q2: 0.26, q3: 0.25, q4: 0.23 },
};

function getPlayerTier(avgMinutes: number): 'star' | 'starter' | 'role_player' {
  if (avgMinutes >= 32) return 'star';
  if (avgMinutes >= 24) return 'starter';
  return 'role_player';
}

function calculateBaseline(
  playerName: string,
  gameLogs: any[],
  propType: string,
  gameLogField: string
) {
  if (!gameLogs || gameLogs.length < 3) return null;

  const sampleSize = gameLogs.length;
  const values: number[] = [];
  let totalMinutes = 0;

  for (const log of gameLogs) {
    values.push(log[gameLogField] || 0);
    totalMinutes += log.minutes_played || 0;
  }

  const gameAvg = values.reduce((a, b) => a + b, 0) / sampleSize;
  if (gameAvg <= 0) return null;

  const minutesAvg = totalMinutes / sampleSize;
  const tier = getPlayerTier(minutesAvg);
  const dist = TIER_DISTRIBUTIONS[tier];

  // Calculate standard deviation for consistency scoring
  const variance = values.reduce((sum, v) => sum + Math.pow(v - gameAvg, 2), 0) / sampleSize;
  const stdDev = Math.sqrt(variance);
  const cv = gameAvg > 0 ? stdDev / gameAvg : 1; // coefficient of variation

  // Adjust quarter distributions based on consistency
  // High-variance players tend to have more uneven quarter splits
  // Low-variance (consistent) players distribute more evenly
  const consistencyFactor = Math.max(0.8, Math.min(1.2, 1 + (0.5 - cv) * 0.1));

  const q1Avg = gameAvg * dist.q1 * consistencyFactor;
  const q2Avg = gameAvg * dist.q2;
  const q3Avg = gameAvg * dist.q3;
  // Q4 absorbs the remainder to ensure they sum correctly
  const q4Avg = gameAvg - q1Avg - q2Avg - q3Avg;

  const avgMinPerQ = minutesAvg / 4;
  const q1Rate = avgMinPerQ > 0 ? q1Avg / avgMinPerQ : 0;
  const q2Rate = avgMinPerQ > 0 ? q2Avg / avgMinPerQ : 0;
  const q3Rate = avgMinPerQ > 0 ? q3Avg / avgMinPerQ : 0;
  const q4Rate = avgMinPerQ > 0 ? q4Avg / avgMinPerQ : 0;

  const q1Pct = q1Avg / gameAvg;
  const q2Pct = q2Avg / gameAvg;
  const q3Pct = q3Avg / gameAvg;
  const q4Pct = q4Avg / gameAvg;

  return {
    player_name: playerName,
    prop_type: propType,
    q1_pct: Math.round(q1Pct * 10000) / 10000,
    q2_pct: Math.round(q2Pct * 10000) / 10000,
    q3_pct: Math.round(q3Pct * 10000) / 10000,
    q4_pct: Math.round(q4Pct * 10000) / 10000,
    q1_avg: Math.round(q1Avg * 100) / 100,
    q2_avg: Math.round(q2Avg * 100) / 100,
    q3_avg: Math.round(q3Avg * 100) / 100,
    q4_avg: Math.round(q4Avg * 100) / 100,
    h1_pct: Math.round((q1Pct + q2Pct) * 10000) / 10000,
    h2_pct: Math.round((q3Pct + q4Pct) * 10000) / 10000,
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('[quarter-baselines] Starting baseline calculation...');

    // Get unique players from recent game logs
    const { data: players, error: playersError } = await supabase
      .from('nba_player_game_logs')
      .select('player_name')
      .gte('game_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .order('player_name');

    if (playersError) throw playersError;

    const uniquePlayers = [...new Set(players?.map(p => p.player_name) || [])];
    console.log(`[quarter-baselines] Found ${uniquePlayers.length} unique players`);

    const allBaselines: any[] = [];
    const batchSize = 10;

    for (let i = 0; i < uniquePlayers.length; i += batchSize) {
      const batch = uniquePlayers.slice(i, i + batchSize);

      await Promise.all(batch.map(async (playerName) => {
        const { data: gameLogs, error } = await supabase
          .from('nba_player_game_logs')
          .select('player_name, points, assists, threes_made, blocks, rebounds, steals, minutes_played, game_date')
          .eq('player_name', playerName)
          .order('game_date', { ascending: false })
          .limit(10);

        if (error || !gameLogs || gameLogs.length < 3) return;

        for (const cfg of PROP_CONFIGS) {
          const baseline = calculateBaseline(playerName, gameLogs, cfg.propType, cfg.gameLogField);
          if (baseline) allBaselines.push(baseline);
        }
      }));
    }

    console.log(`[quarter-baselines] Generated ${allBaselines.length} baselines`);

    // Upsert in chunks
    let upsertedCount = 0;
    const chunkSize = 50;
    for (let i = 0; i < allBaselines.length; i += chunkSize) {
      const chunk = allBaselines.slice(i, i + chunkSize);
      const { error } = await supabase
        .from('player_quarter_baselines')
        .upsert(chunk, { onConflict: 'player_name,prop_type', ignoreDuplicates: false });

      if (error) {
        console.error(`[quarter-baselines] Upsert error chunk ${i}:`, error);
      } else {
        upsertedCount += chunk.length;
      }
    }

    const result = {
      success: true,
      source: 'game_logs_enhanced',
      playersProcessed: uniquePlayers.length,
      baselinesGenerated: allBaselines.length,
      baselinesUpserted: upsertedCount,
      propTypes: PROP_CONFIGS.map(c => c.propType),
      timestamp: new Date().toISOString(),
    };

    console.log('[quarter-baselines] Complete:', result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[quarter-baselines] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
