import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ComboPropsConfig {
  minGamesRequired: number;
  minHitRateThreshold: number;
  maxPropsPerPlayer: number;
}

const DEFAULT_CONFIG: ComboPropsConfig = {
  minGamesRequired: 5,
  minHitRateThreshold: 0.60,
  maxPropsPerPlayer: 3,
};

// Combo prop definitions with their component stats
const COMBO_PROP_DEFINITIONS = [
  { 
    propType: 'player_pra', 
    displayName: 'PRA',
    components: ['points', 'rebounds', 'assists'],
    minLine: 15,
    maxLine: 60
  },
  { 
    propType: 'player_pts_rebs', 
    displayName: 'P+R',
    components: ['points', 'rebounds'],
    minLine: 10,
    maxLine: 45
  },
  { 
    propType: 'player_pts_asts', 
    displayName: 'P+A',
    components: ['points', 'assists'],
    minLine: 8,
    maxLine: 45
  },
  { 
    propType: 'player_rebs_asts', 
    displayName: 'R+A',
    components: ['rebounds', 'assists'],
    minLine: 5,
    maxLine: 30
  },
  { 
    propType: 'player_stl_blk', 
    displayName: 'S+B',
    components: ['steals', 'blocks'],
    minLine: 1,
    maxLine: 10
  },
];

function calculateComboStat(log: Record<string, number>, components: string[]): number {
  return components.reduce((sum, comp) => sum + (log[comp] || 0), 0);
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateHitRate(values: number[], line: number, side: 'over' | 'under'): number {
  if (values.length === 0) return 0;
  const hits = values.filter(v => side === 'over' ? v >= line : v < line).length;
  return hits / values.length;
}

function generateSyntheticLine(medianValue: number, comboType: typeof COMBO_PROP_DEFINITIONS[0]): number {
  // Generate a line that's slightly below median for over bets (more actionable)
  // Round to standard sportsbook increments (0.5)
  const rawLine = medianValue - 0.5;
  const roundedLine = Math.round(rawLine * 2) / 2;
  
  // Clamp to reasonable ranges
  return Math.max(comboType.minLine, Math.min(comboType.maxLine, roundedLine));
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

    const { action = 'generate', config = {} } = await req.json().catch(() => ({}));
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    console.log(`[generate-combo-props] Starting with action: ${action}`);

    // Get unique NBA players with sufficient game logs
    const { data: players, error: playersError } = await supabase
      .from('nba_player_game_logs')
      .select('player_name')
      .gte('game_date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]) // Last 30 days
      .order('game_date', { ascending: false });

    if (playersError) {
      console.error('Error fetching players:', playersError);
      throw playersError;
    }

    // Get unique players
    const uniquePlayers = [...new Set(players?.map(p => p.player_name) || [])];
    console.log(`[generate-combo-props] Found ${uniquePlayers.length} unique players with recent games`);

    const generatedProps: Array<{
      playerName: string;
      propType: string;
      displayName: string;
      syntheticLine: number;
      medianValue: number;
      hitRateOver: number;
      hitRateUnder: number;
      recommendedSide: 'over' | 'under';
      gamesAnalyzed: number;
      last5Values: number[];
      confidenceScore: number;
    }> = [];

    let inserted = 0;
    let skipped = 0;

    for (const playerName of uniquePlayers) {
      // Fetch game logs for this player
      const { data: logs, error: logsError } = await supabase
        .from('nba_player_game_logs')
        .select('*')
        .eq('player_name', playerName)
        .order('game_date', { ascending: false })
        .limit(15);

      if (logsError || !logs || logs.length < mergedConfig.minGamesRequired) {
        skipped++;
        continue;
      }

      // Generate combo props for this player
      for (const comboDef of COMBO_PROP_DEFINITIONS) {
        const comboValues = logs.map(log => calculateComboStat(log, comboDef.components));
        
        if (comboValues.length < mergedConfig.minGamesRequired) continue;

        const medianValue = median(comboValues);
        const syntheticLine = generateSyntheticLine(medianValue, comboDef);
        
        const hitRateOver = calculateHitRate(comboValues, syntheticLine, 'over');
        const hitRateUnder = calculateHitRate(comboValues, syntheticLine, 'under');
        
        // Skip if neither side meets threshold
        if (Math.max(hitRateOver, hitRateUnder) < mergedConfig.minHitRateThreshold) {
          continue;
        }

        const recommendedSide = hitRateOver >= hitRateUnder ? 'over' : 'under';
        const hitRate = recommendedSide === 'over' ? hitRateOver : hitRateUnder;
        
        // Calculate confidence score based on consistency
        const stdDev = Math.sqrt(
          comboValues.reduce((sum, val) => sum + Math.pow(val - medianValue, 2), 0) / comboValues.length
        );
        const consistencyScore = Math.max(0, 1 - (stdDev / medianValue));
        const confidenceScore = (hitRate * 0.7) + (consistencyScore * 0.3);

        generatedProps.push({
          playerName: playerName,
          propType: comboDef.propType,
          displayName: comboDef.displayName,
          syntheticLine,
          medianValue,
          hitRateOver,
          hitRateUnder,
          recommendedSide,
          gamesAnalyzed: comboValues.length,
          last5Values: comboValues.slice(0, 5),
          confidenceScore,
        });
      }
    }

    console.log(`[generate-combo-props] Generated ${generatedProps.length} combo props`);

    // Insert/upsert into player_prop_hitrates table
    for (const prop of generatedProps) {
      const hitRate = prop.recommendedSide === 'over' ? prop.hitRateOver : prop.hitRateUnder;
      
      const { error: upsertError } = await supabase
        .from('player_prop_hitrates')
        .upsert({
          player_name: prop.playerName,
          sport: 'NBA',
          prop_type: prop.propType,
          current_line: prop.syntheticLine,
          over_price: -110, // Synthetic standard price
          under_price: -110,
          games_analyzed: prop.gamesAnalyzed,
          over_hits: Math.round(prop.hitRateOver * prop.gamesAnalyzed),
          under_hits: Math.round(prop.hitRateUnder * prop.gamesAnalyzed),
          hit_rate_over: prop.hitRateOver,
          hit_rate_under: prop.hitRateUnder,
          recommended_side: prop.recommendedSide,
          confidence_score: prop.confidenceScore,
          last_5_results: prop.last5Values,
          last_5_avg: prop.last5Values.reduce((a, b) => a + b, 0) / prop.last5Values.length,
          season_avg: prop.medianValue,
          season_games_played: prop.gamesAnalyzed,
          analyzed_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
        }, {
          onConflict: 'player_name,prop_type,current_line',
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error(`Error upserting combo prop for ${prop.playerName}:`, upsertError);
      } else {
        inserted++;
      }
    }

    // Log to cron_job_history
    await supabase.from('cron_job_history').insert({
      job_name: 'generate-combo-props',
      status: 'completed',
      result: {
        playersProcessed: uniquePlayers.length,
        propsGenerated: generatedProps.length,
        propsInserted: inserted,
        propsSkipped: skipped,
        comboTypes: COMBO_PROP_DEFINITIONS.map(d => d.displayName),
      },
      completed_at: new Date().toISOString(),
    });

    // Get summary by prop type
    const summaryByType = COMBO_PROP_DEFINITIONS.reduce((acc, def) => {
      acc[def.displayName] = generatedProps.filter(p => p.propType === def.propType).length;
      return acc;
    }, {} as Record<string, number>);

    return new Response(JSON.stringify({
      success: true,
      summary: {
        playersProcessed: uniquePlayers.length,
        propsGenerated: generatedProps.length,
        propsInserted: inserted,
        propsSkipped: skipped,
        byType: summaryByType,
      },
      // Include sample props for verification
      sampleProps: generatedProps.slice(0, 10).map(p => ({
        player: p.playerName,
        type: p.displayName,
        line: p.syntheticLine,
        median: p.medianValue.toFixed(1),
        hitRate: (Math.max(p.hitRateOver, p.hitRateUnder) * 100).toFixed(0) + '%',
        side: p.recommendedSide,
        confidence: (p.confidenceScore * 100).toFixed(0) + '%',
      })),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[generate-combo-props] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
