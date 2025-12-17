import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProjectionSource {
  source: string;
  value: number;
  confidence: number;
  sampleSize: number;
  recency: number;
}

interface ProjectionUpdate {
  player_name: string;
  prop_type: string;
  previous_projection: number | null;
  new_projection: number;
  change_percent: number;
  affected_line: number | null;
  previous_probability: number | null;
  new_probability: number | null;
  change_reason: string;
  sport: string;
  is_significant: boolean;
}

// Standard deviation multipliers by prop type
const PROP_STD_DEV_MULTIPLIERS: Record<string, number> = {
  'points': 0.35,
  'rebounds': 0.40,
  'assists': 0.45,
  'threes': 0.55,
  'blocks': 0.60,
  'steals': 0.60,
  'turnovers': 0.50,
  'pra': 0.30,
  'default': 0.40,
};

// Calculate normal CDF for probability
function normalCDF(z: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

function calculateProbability(
  mean: number,
  stdDev: number,
  line: number,
  side: 'over' | 'under'
): number {
  const zScore = (line - mean) / stdDev;
  if (side === 'over') {
    return 1 - normalCDF(zScore);
  }
  return normalCDF(zScore);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { action, playerName, propType, sport = 'NBA' } = await req.json();
    console.log(`Auto-refresh projections: action=${action}, player=${playerName}, prop=${propType}`);

    if (action === 'refresh_all') {
      return await refreshAllProjections(supabase, sport);
    }

    if (action === 'refresh_player') {
      return await refreshPlayerProjection(supabase, playerName, propType, sport);
    }

    // Default: refresh recently updated players
    return await refreshRecentUpdates(supabase, sport);

  } catch (error: unknown) {
    console.error('Auto-refresh error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function refreshAllProjections(supabase: any, sport: string) {
  console.log(`Refreshing all ${sport} projections...`);

  // Get all players with active props from unified_props
  const { data: activeProps, error: propsError } = await supabase
    .from('unified_props')
    .select('player_name, prop_type, line, side')
    .eq('sport', sport)
    .eq('is_active', true)
    .limit(100);

  if (propsError) {
    console.error('Error fetching active props:', propsError);
    throw propsError;
  }

  console.log(`Found ${activeProps?.length || 0} active props to refresh`);

  const updates: ProjectionUpdate[] = [];
  const processedPlayers = new Set<string>();

  for (const prop of (activeProps || [])) {
    const key = `${prop.player_name}-${prop.prop_type}`;
    if (processedPlayers.has(key)) continue;
    processedPlayers.add(key);

    const update = await calculateProjectionUpdate(
      supabase,
      prop.player_name,
      prop.prop_type,
      prop.line,
      prop.side || 'over',
      sport
    );

    if (update) {
      updates.push(update);
    }
  }

  // Insert significant updates
  const significantUpdates = updates.filter(u => u.is_significant);
  if (significantUpdates.length > 0) {
    const { error: insertError } = await supabase
      .from('projection_updates')
      .insert(significantUpdates);

    if (insertError) {
      console.error('Error inserting projection updates:', insertError);
    }
  }

  console.log(`Processed ${updates.length} projections, ${significantUpdates.length} significant changes`);

  return new Response(
    JSON.stringify({
      success: true,
      totalProcessed: updates.length,
      significantChanges: significantUpdates.length,
      updates: significantUpdates,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function refreshPlayerProjection(
  supabase: any,
  playerName: string,
  propType: string,
  sport: string
) {
  console.log(`Refreshing projection for ${playerName} ${propType}`);

  // Get current prop info
  const { data: propData } = await supabase
    .from('unified_props')
    .select('line, side')
    .eq('player_name', playerName)
    .eq('prop_type', propType)
    .eq('sport', sport)
    .single();

  const line = propData?.line || 0;
  const side = propData?.side || 'over';

  const update = await calculateProjectionUpdate(
    supabase,
    playerName,
    propType,
    line,
    side,
    sport
  );

  if (update?.is_significant) {
    await supabase.from('projection_updates').insert(update);
  }

  return new Response(
    JSON.stringify({ success: true, update }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function refreshRecentUpdates(supabase: any, sport: string) {
  console.log(`Refreshing recent ${sport} projections...`);

  // Get game logs from the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: recentLogs, error: logsError } = await supabase
    .from('nba_player_game_logs')
    .select('player_name')
    .gte('created_at', oneHourAgo)
    .limit(50);

  if (logsError) {
    console.error('Error fetching recent logs:', logsError);
    throw logsError;
  }

  const uniquePlayers = [...new Set((recentLogs || []).map((l: { player_name: string }) => l.player_name))] as string[];
  console.log(`Found ${uniquePlayers.length} players with recent updates`);

  const updates: ProjectionUpdate[] = [];
  const propTypes = ['points', 'rebounds', 'assists', 'threes'];

  for (const playerName of uniquePlayers) {
    for (const propType of propTypes) {
      // Get current prop info
      const { data: propData } = await supabase
        .from('unified_props')
        .select('line, side')
        .eq('player_name', playerName)
        .ilike('prop_type', `%${propType}%`)
        .eq('sport', sport)
        .single();

      if (!propData) continue;

      const update = await calculateProjectionUpdate(
        supabase,
        playerName,
        propType,
        propData.line,
        propData.side || 'over',
        sport
      );

      if (update) {
        updates.push(update);
      }
    }
  }

  // Insert significant updates
  const significantUpdates = updates.filter(u => u.is_significant);
  if (significantUpdates.length > 0) {
    await supabase.from('projection_updates').insert(significantUpdates);
  }

  return new Response(
    JSON.stringify({
      success: true,
      playersChecked: uniquePlayers.length,
      significantChanges: significantUpdates.length,
      updates: significantUpdates,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function calculateProjectionUpdate(
  supabase: any,
  playerName: string,
  propType: string,
  line: number,
  side: 'over' | 'under',
  sport: string
): Promise<ProjectionUpdate | null> {
  try {
    // Gather projection sources
    const sources = await gatherProjectionSources(supabase, playerName, propType, sport);

    if (sources.length === 0) {
      return null;
    }

    // Aggregate projections
    const weights = sources.map(s => {
      const sampleWeight = Math.log(s.sampleSize + 1) / Math.log(100);
      const recencyWeight = 0.5 + 0.5 * s.recency;
      return s.confidence * sampleWeight * recencyWeight;
    });

    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const newProjection = sources.reduce(
      (sum, s, i) => sum + s.value * (weights[i] / totalWeight),
      0
    );

    // Get previous projection from player_usage_metrics
    const { data: previousData } = await supabase
      .from('player_usage_metrics')
      .select('avg_minutes, avg_stat_per_minute, hit_rate')
      .eq('player_name', playerName)
      .eq('prop_type', propType)
      .single();

    const previousProjection = previousData
      ? (previousData.avg_minutes || 30) * (previousData.avg_stat_per_minute || 0)
      : null;

    // Calculate change
    const changePercent = previousProjection
      ? ((newProjection - previousProjection) / previousProjection) * 100
      : 0;

    // Calculate probabilities
    const stdDevMultiplier = PROP_STD_DEV_MULTIPLIERS[propType] || PROP_STD_DEV_MULTIPLIERS['default'];
    const stdDev = newProjection * stdDevMultiplier;

    const newProbability = line > 0
      ? calculateProbability(newProjection, stdDev, line, side)
      : null;

    const previousProbability = previousProjection && line > 0
      ? calculateProbability(previousProjection, previousProjection * stdDevMultiplier, line, side)
      : null;

    const probChange = newProbability && previousProbability
      ? Math.abs(newProbability - previousProbability)
      : 0;

    // Determine significance (>5% probability change or >10% projection change)
    const isSignificant = probChange >= 0.05 || Math.abs(changePercent) >= 10;

    // Determine reason
    let changeReason = 'Projection updated with latest data';
    if (Math.abs(changePercent) >= 15) {
      changeReason = changePercent > 0
        ? 'Strong upward trend in recent performance'
        : 'Strong downward trend in recent performance';
    } else if (sources.some(s => s.recency > 0.9)) {
      changeReason = 'Updated with most recent game data';
    }

    // Update player_usage_metrics cache
    await supabase
      .from('player_usage_metrics')
      .upsert({
        player_name: playerName,
        prop_type: propType,
        avg_stat_per_minute: newProjection / 30, // Normalize to per-minute
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'player_name,prop_type',
      });

    return {
      player_name: playerName,
      prop_type: propType,
      previous_projection: previousProjection,
      new_projection: newProjection,
      change_percent: changePercent,
      affected_line: line,
      previous_probability: previousProbability,
      new_probability: newProbability,
      change_reason: changeReason,
      sport,
      is_significant: isSignificant,
    };
  } catch (error) {
    console.error(`Error calculating projection for ${playerName} ${propType}:`, error);
    return null;
  }
}

async function gatherProjectionSources(
  supabase: any,
  playerName: string,
  propType: string,
  sport: string
): Promise<ProjectionSource[]> {
  const sources: ProjectionSource[] = [];

  // Map prop type to stat column
  const statColumnMap: Record<string, string> = {
    'points': 'pts',
    'rebounds': 'reb',
    'assists': 'ast',
    'threes': 'fg3m',
    'blocks': 'blk',
    'steals': 'stl',
    'turnovers': 'tov',
  };

  const statColumn = statColumnMap[propType.toLowerCase()] || 'pts';

  // Source 1: Recent game logs (last 10 games)
  const { data: gameLogs } = await supabase
    .from('nba_player_game_logs')
    .select(`game_date, ${statColumn}, min`)
    .eq('player_name', playerName)
    .order('game_date', { ascending: false })
    .limit(10);

  if (gameLogs && gameLogs.length >= 3) {
    const values: number[] = gameLogs.map((g: Record<string, number>) => g[statColumn] || 0);
    const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;

    sources.push({
      source: 'game_logs_10',
      value: avg,
      confidence: Math.min(0.9, 0.5 + gameLogs.length * 0.04),
      sampleSize: gameLogs.length,
      recency: 1.0,
    });

    // Last 5 games (more recent weight)
    if (gameLogs.length >= 5) {
      const last5 = values.slice(0, 5);
      const avg5 = last5.reduce((a: number, b: number) => a + b, 0) / 5;
      sources.push({
        source: 'game_logs_5',
        value: avg5,
        confidence: 0.85,
        sampleSize: 5,
        recency: 1.0,
      });
    }
  }

  // Source 2: Season averages
  const { data: seasonStats } = await supabase
    .from('nba_season_stats')
    .select('games_played, pts_avg, reb_avg, ast_avg, fg3m_avg, blk_avg, stl_avg, tov_avg')
    .eq('player_name', playerName)
    .single();

  if (seasonStats) {
    const statAvgMap: Record<string, string> = {
      'points': 'pts_avg',
      'rebounds': 'reb_avg',
      'assists': 'ast_avg',
      'threes': 'fg3m_avg',
      'blocks': 'blk_avg',
      'steals': 'stl_avg',
      'turnovers': 'tov_avg',
    };

    const avgColumn = statAvgMap[propType.toLowerCase()] || 'pts_avg';
    const seasonAvg = seasonStats[avgColumn];

    if (seasonAvg) {
      sources.push({
        source: 'season_average',
        value: seasonAvg,
        confidence: 0.8,
        sampleSize: seasonStats.games_played || 20,
        recency: 0.7,
      });
    }
  }

  // Source 3: Hit rate data
  const { data: hitRateData } = await supabase
    .from('player_prop_hitrates')
    .select('season_avg, sample_size, hit_rate_over')
    .eq('player_name', playerName)
    .ilike('prop_type', `%${propType}%`)
    .single();

  if (hitRateData?.season_avg) {
    sources.push({
      source: 'hitrate_history',
      value: hitRateData.season_avg,
      confidence: Math.min(0.85, 0.5 + (hitRateData.sample_size || 0) * 0.02),
      sampleSize: hitRateData.sample_size || 10,
      recency: 0.6,
    });
  }

  // Source 4: Player usage metrics (existing cache)
  const { data: usageData } = await supabase
    .from('player_usage_metrics')
    .select('avg_minutes, avg_stat_per_minute, efficiency_margin')
    .eq('player_name', playerName)
    .eq('prop_type', propType)
    .single();

  if (usageData?.avg_stat_per_minute) {
    const projectedValue = (usageData.avg_minutes || 30) * usageData.avg_stat_per_minute;
    sources.push({
      source: 'usage_projection',
      value: projectedValue,
      confidence: 0.75,
      sampleSize: 15,
      recency: 0.8,
    });
  }

  return sources;
}
