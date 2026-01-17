// Category Props Analyzer v1.1
// Analyzes props by player category with accurate L10 hit rates
// Categories: BIG_REBOUNDER, LOW_LINE_REBOUNDER, NON_SCORING_SHOOTER

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GameLog {
  player_name: string;
  game_date: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  threes_made: number;
  minutes_played: number;
}

interface CategoryConfig {
  name: string;
  propType: string;
  avgRange: { min: number; max: number };
  lines: number[];
  side: 'over' | 'under';
  minHitRate: number;
}

const CATEGORIES: Record<string, CategoryConfig> = {
  BIG_REBOUNDER: {
    name: 'Big Rebounder',
    propType: 'rebounds',
    avgRange: { min: 9, max: 20 },
    lines: [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5],
    side: 'over',
    minHitRate: 0.7
  },
  LOW_LINE_REBOUNDER: {
    name: 'Low Line Rebounder',
    propType: 'rebounds',
    avgRange: { min: 4, max: 6 },
    lines: [3.5, 4.5, 5.5],
    side: 'over',
    minHitRate: 0.7
  },
  NON_SCORING_SHOOTER: {
    name: 'Non-Scoring Shooter',
    propType: 'points',
    avgRange: { min: 8, max: 14 },
    lines: [10.5, 11.5, 12.5, 13.5, 14.5],
    side: 'under',
    minHitRate: 0.7
  }
};

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateHitRate(values: number[], line: number, side: 'over' | 'under'): number {
  if (values.length === 0) return 0;
  const hits = values.filter(v => side === 'over' ? v > line : v < line).length;
  return hits / values.length;
}

function getStatValue(log: GameLog, propType: string): number {
  switch (propType) {
    case 'points': return log.points || 0;
    case 'rebounds': return log.rebounds || 0;
    case 'assists': return log.assists || 0;
    case 'steals': return log.steals || 0;
    case 'blocks': return log.blocks || 0;
    case 'threes': return log.threes_made || 0;
    default: return 0;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { category, minHitRate = 0.7, forceRefresh = false } = await req.json().catch(() => ({}));

    console.log(`[Category Analyzer] Starting analysis for category: ${category || 'ALL'}`);

    // Get today's date for analysis
    const today = new Date().toISOString().split('T')[0];

    // Check if we already have fresh data
    if (!forceRefresh) {
      const { data: existingData } = await supabase
        .from('category_sweet_spots')
        .select('*')
        .eq('analysis_date', today)
        .eq('is_active', true);

      if (existingData && existingData.length > 0) {
        console.log(`[Category Analyzer] Found ${existingData.length} existing sweet spots for today`);
        
        if (category) {
          const filtered = existingData.filter((d: any) => d.category === category);
          return new Response(JSON.stringify({
            success: true,
            data: filtered,
            cached: true,
            count: filtered.length
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        
        return new Response(JSON.stringify({
          success: true,
          data: existingData,
          cached: true,
          count: existingData.length
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Fetch all game logs from last 30 days to ensure we have L10 for most players
    // Use pagination to get all logs (Supabase has 1000 row limit)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let allGameLogs: GameLog[] = [];
    let page = 0;
    const pageSize = 1000;
    
    while (true) {
      const { data: gameLogs, error: logsError } = await supabase
        .from('nba_player_game_logs')
        .select('player_name, game_date, points, rebounds, assists, steals, blocks, threes_made, minutes_played')
        .gte('game_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('game_date', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (logsError) {
        console.error('[Category Analyzer] Error fetching game logs:', logsError);
        throw new Error(`Failed to fetch game logs: ${logsError.message}`);
      }

      if (!gameLogs || gameLogs.length === 0) break;
      
      allGameLogs = allGameLogs.concat(gameLogs as GameLog[]);
      console.log(`[Category Analyzer] Fetched page ${page + 1} with ${gameLogs.length} logs`);
      
      if (gameLogs.length < pageSize) break;
      page++;
    }

    console.log(`[Category Analyzer] Total game logs fetched: ${allGameLogs.length}`);

    if (allGameLogs.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No game logs found',
        data: []
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Group logs by player
    const playerLogs: Record<string, GameLog[]> = {};
    for (const log of allGameLogs) {
      const name = log.player_name;
      if (!playerLogs[name]) playerLogs[name] = [];
      playerLogs[name].push(log);
    }

    console.log(`[Category Analyzer] Grouped logs for ${Object.keys(playerLogs).length} players`);

    // Analyze each category
    const categoriesToAnalyze = category ? [category] : Object.keys(CATEGORIES);
    const sweetSpots: any[] = [];

    for (const catKey of categoriesToAnalyze) {
      const config = CATEGORIES[catKey];
      if (!config) continue;

      console.log(`[Category Analyzer] Analyzing category: ${catKey}`);
      let playersInRange = 0;
      let qualifiedPlayers = 0;

      for (const [playerName, logs] of Object.entries(playerLogs)) {
        // Take last 10 games only
        const l10Logs = logs.slice(0, 10);
        if (l10Logs.length < 5) continue; // Need at least 5 games for reliable analysis

        const statValues = l10Logs.map(log => getStatValue(log, config.propType));
        const l10Avg = statValues.reduce((a, b) => a + b, 0) / statValues.length;

        // Check if player fits this category's average range
        if (l10Avg < config.avgRange.min || l10Avg > config.avgRange.max) continue;
        
        playersInRange++;

        const l10Min = Math.min(...statValues);
        const l10Max = Math.max(...statValues);
        const l10Median = calculateMedian(statValues);

        // Find the best line for this player
        let bestLine: number | null = null;
        let bestHitRate = 0;

        for (const line of config.lines) {
          const hitRate = calculateHitRate(statValues, line, config.side);
          
          if (hitRate >= (minHitRate || config.minHitRate) && hitRate > bestHitRate) {
            bestHitRate = hitRate;
            bestLine = line;
          }
        }

        // Log top candidates even if they don't qualify
        if (playersInRange <= 5) {
          console.log(`[Category Analyzer] ${catKey} - ${playerName}: avg=${l10Avg.toFixed(1)}, bestLine=${bestLine}, hitRate=${(bestHitRate * 100).toFixed(0)}%, values=[${statValues.join(',')}]`);
        }

        if (bestLine !== null && bestHitRate >= (minHitRate || config.minHitRate)) {
          qualifiedPlayers++;
          
          // Calculate confidence score based on consistency and hit rate
          const stdDev = Math.sqrt(
            statValues.reduce((sum, v) => sum + Math.pow(v - l10Avg, 2), 0) / statValues.length
          );
          const consistency = 1 - (stdDev / l10Avg); // Higher is more consistent
          const confidenceScore = (bestHitRate * 0.6) + (Math.max(0, consistency) * 0.4);

          sweetSpots.push({
            category: catKey,
            player_name: playerName,
            prop_type: config.propType,
            recommended_line: bestLine,
            recommended_side: config.side,
            l10_hit_rate: Math.round(bestHitRate * 100) / 100,
            l10_avg: Math.round(l10Avg * 10) / 10,
            l10_min: l10Min,
            l10_max: l10Max,
            l10_median: Math.round(l10Median * 10) / 10,
            games_played: l10Logs.length,
            archetype: catKey,
            confidence_score: Math.round(confidenceScore * 100) / 100,
            analysis_date: today,
            is_active: true
          });
        }
      }
      
      console.log(`[Category Analyzer] ${catKey}: ${playersInRange} players in range, ${qualifiedPlayers} qualified (70%+ hit rate)`);
    }

    console.log(`[Category Analyzer] Found ${sweetSpots.length} total sweet spots`);

    // Sort by confidence score
    sweetSpots.sort((a, b) => b.confidence_score - a.confidence_score);

    // Upsert to database (clear old data first for today)
    if (sweetSpots.length > 0) {
      // Delete existing data for today
      await supabase
        .from('category_sweet_spots')
        .delete()
        .eq('analysis_date', today);

      // Insert new data
      const { error: insertError } = await supabase
        .from('category_sweet_spots')
        .insert(sweetSpots);

      if (insertError) {
        console.error('[Category Analyzer] Error inserting sweet spots:', insertError);
      } else {
        console.log(`[Category Analyzer] Inserted ${sweetSpots.length} sweet spots`);
      }
    }

    // Group by category for response
    const grouped: Record<string, any[]> = {};
    for (const spot of sweetSpots) {
      if (!grouped[spot.category]) grouped[spot.category] = [];
      grouped[spot.category].push(spot);
    }

    return new Response(JSON.stringify({
      success: true,
      data: sweetSpots,
      grouped,
      count: sweetSpots.length,
      categories: Object.keys(grouped),
      analyzedAt: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Category Analyzer] Error:', errorMessage);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
