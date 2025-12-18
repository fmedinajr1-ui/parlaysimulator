import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SharpTrackerRecord {
  id: string;
  player_name: string;
  prop_type: string;
  opening_line: number;
  ai_direction: string;
  ai_recommendation: string;
  ai_confidence: number;
  sport: string;
  commence_time: string;
  event_id: string;
  outcome: string | null;
  actual_value: number | null;
  verified_at: string | null;
  was_correct: boolean | null;
}

interface PlayerStats {
  player_name: string;
  stat_type: string;
  stat_value: number;
  game_date: string;
}

// Map prop types to stat columns
const PROP_TYPE_TO_STAT: Record<string, string[]> = {
  'points': ['points', 'pts'],
  'rebounds': ['rebounds', 'reb', 'total_rebounds'],
  'assists': ['assists', 'ast'],
  'three_pointers': ['three_pointers_made', 'fg3m', 'threes'],
  'steals': ['steals', 'stl'],
  'blocks': ['blocks', 'blk'],
  'turnovers': ['turnovers', 'tov'],
  'pts_rebs_asts': ['pts_rebs_asts', 'pra'],
  'pts_rebs': ['pts_rebs', 'pr'],
  'pts_asts': ['pts_asts', 'pa'],
  'rebs_asts': ['rebs_asts', 'ra'],
  'double_double': ['double_double'],
  'triple_double': ['triple_double'],
  // Hockey
  'goals': ['goals'],
  'shots_on_goal': ['shots_on_goal', 'sog'],
  'saves': ['saves'],
  // Football
  'passing_yards': ['passing_yards', 'pass_yds'],
  'rushing_yards': ['rushing_yards', 'rush_yds'],
  'receiving_yards': ['receiving_yards', 'rec_yds'],
  'touchdowns': ['touchdowns', 'tds'],
  'receptions': ['receptions', 'rec'],
};

function normalizeStatType(propType: string): string[] {
  const normalized = propType.toLowerCase()
    .replace(/\s+/g, '_')
    .replace('player_', '')
    .replace('_made', '');
  
  return PROP_TYPE_TO_STAT[normalized] || [normalized];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log('🔍 Starting God Mode Tracker (sharp_line_tracker) verification...');
    
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // Fetch unverified records where game should have completed
    const { data: unverifiedRecords, error: fetchError } = await supabase
      .from('sharp_line_tracker')
      .select('*')
      .is('outcome', null)
      .not('ai_direction', 'is', null)
      .lt('commence_time', twentyFourHoursAgo.toISOString())
      .gte('commence_time', fortyEightHoursAgo.toISOString())
      .limit(100);

    if (fetchError) {
      console.error('Error fetching unverified records:', fetchError);
      throw fetchError;
    }

    console.log(`📋 Found ${unverifiedRecords?.length || 0} unverified God Mode Tracker predictions`);

    if (!unverifiedRecords || unverifiedRecords.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No unverified predictions to process',
        verified: 0,
        won: 0,
        lost: 0,
        push: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Group by player to batch lookups
    const playerGroups = new Map<string, SharpTrackerRecord[]>();
    for (const record of unverifiedRecords as SharpTrackerRecord[]) {
      const key = `${record.player_name.toLowerCase()}|${record.prop_type}`;
      if (!playerGroups.has(key)) {
        playerGroups.set(key, []);
      }
      playerGroups.get(key)!.push(record);
    }

    let verified = 0;
    let won = 0;
    let lost = 0;
    let push = 0;
    let notFound = 0;

    // Process each player group
    for (const [key, records] of playerGroups) {
      const [playerName, propType] = key.split('|');
      const statTypes = normalizeStatType(propType);
      
      // Try to find actual stats from player_stats_cache or nba_player_game_logs
      for (const record of records) {
        const gameDate = new Date(record.commence_time).toISOString().split('T')[0];
        
        // Try player_stats_cache first
        let actualValue: number | null = null;
        
        const { data: statsCache } = await supabase
          .from('player_stats_cache')
          .select('*')
          .ilike('player_name', `%${playerName}%`)
          .gte('game_date', gameDate)
          .lte('game_date', new Date(new Date(gameDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0])
          .limit(1);
        
        if (statsCache && statsCache.length > 0) {
          const stats = statsCache[0];
          // Try to find the matching stat
          for (const statType of statTypes) {
            if (stats[statType] !== undefined && stats[statType] !== null) {
              actualValue = Number(stats[statType]);
              break;
            }
          }
        }
        
        // Try nba_player_game_logs if not found
        if (actualValue === null && record.sport?.toLowerCase() === 'basketball_nba') {
          const { data: gameLogs } = await supabase
            .from('nba_player_game_logs')
            .select('*')
            .ilike('player_name', `%${playerName}%`)
            .gte('game_date', gameDate)
            .lte('game_date', new Date(new Date(gameDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0])
            .limit(1);
          
          if (gameLogs && gameLogs.length > 0) {
            const log = gameLogs[0];
            for (const statType of statTypes) {
              if (log[statType] !== undefined && log[statType] !== null) {
                actualValue = Number(log[statType]);
                break;
              }
            }
          }
        }
        
        // Determine outcome
        let outcome: string = 'pending';
        let wasCorrect: boolean | null = null;
        
        if (actualValue !== null) {
          const line = record.opening_line;
          const direction = record.ai_direction?.toLowerCase();
          
          if (actualValue > line) {
            outcome = direction === 'over' ? 'won' : 'lost';
            wasCorrect = direction === 'over';
          } else if (actualValue < line) {
            outcome = direction === 'under' ? 'won' : 'lost';
            wasCorrect = direction === 'under';
          } else {
            outcome = 'push';
            wasCorrect = null;
          }
          
          // Update the record
          const { error: updateError } = await supabase
            .from('sharp_line_tracker')
            .update({
              outcome,
              actual_value: actualValue,
              was_correct: wasCorrect,
              verified_at: now.toISOString(),
            })
            .eq('id', record.id);
          
          if (!updateError) {
            verified++;
            if (outcome === 'won') won++;
            else if (outcome === 'lost') lost++;
            else if (outcome === 'push') push++;
            
            console.log(`✅ ${record.player_name} ${record.prop_type}: ${direction} ${line} → Actual: ${actualValue} = ${outcome}`);
          }
        } else {
          notFound++;
          console.log(`❓ No stats found for ${record.player_name} ${record.prop_type} on ${gameDate}`);
        }
      }
    }

    // Update accuracy metrics
    console.log('📊 Updating sharp_tracker_accuracy_metrics...');
    
    // Get aggregated stats from verified records
    const { data: aggregatedStats } = await supabase
      .from('sharp_line_tracker')
      .select('sport, ai_recommendation, ai_direction, ai_confidence, outcome, was_correct')
      .not('outcome', 'is', null)
      .in('outcome', ['won', 'lost', 'push']);

    if (aggregatedStats && aggregatedStats.length > 0) {
      // Group by sport, recommendation, direction
      const metricsMap = new Map<string, {
        sport: string;
        aiRec: string;
        aiDir: string;
        total: number;
        won: number;
        lost: number;
        push: number;
        confidenceSum: number;
      }>();

      for (const stat of aggregatedStats) {
        const key = `${stat.sport || 'all'}|${stat.ai_recommendation || 'unknown'}|${stat.ai_direction || 'unknown'}`;
        if (!metricsMap.has(key)) {
          metricsMap.set(key, {
            sport: stat.sport || 'all',
            aiRec: stat.ai_recommendation || 'unknown',
            aiDir: stat.ai_direction || 'unknown',
            total: 0,
            won: 0,
            lost: 0,
            push: 0,
            confidenceSum: 0,
          });
        }
        const m = metricsMap.get(key)!;
        m.total++;
        if (stat.outcome === 'won') m.won++;
        else if (stat.outcome === 'lost') m.lost++;
        else if (stat.outcome === 'push') m.push++;
        m.confidenceSum += stat.ai_confidence || 0;
      }

      // Upsert metrics
      for (const [_, metrics] of metricsMap) {
        const winRate = metrics.total > 0 ? (metrics.won / (metrics.total - metrics.push)) * 100 : 0;
        const avgConfidence = metrics.total > 0 ? metrics.confidenceSum / metrics.total : 0;
        
        // Calculate ROI assuming -110 juice
        const roi = metrics.total > 0 
          ? ((metrics.won * 0.91 - metrics.lost) / (metrics.total - metrics.push)) * 100 
          : 0;

        const confidenceBucket = avgConfidence >= 80 ? '80%+' : avgConfidence >= 60 ? '60-79%' : '<60%';
        const sampleConfidence = (metrics.total - metrics.push) >= 50 ? 'high' 
          : (metrics.total - metrics.push) >= 20 ? 'medium' 
          : (metrics.total - metrics.push) >= 10 ? 'low' : 'insufficient';

        await supabase
          .from('sharp_tracker_accuracy_metrics')
          .upsert({
            sport: metrics.sport,
            ai_recommendation: metrics.aiRec,
            ai_direction: metrics.aiDir,
            confidence_bucket: confidenceBucket,
            total_predictions: metrics.total,
            total_won: metrics.won,
            total_lost: metrics.lost,
            total_push: metrics.push,
            win_rate: Math.round(winRate * 10) / 10,
            roi_percentage: Math.round(roi * 10) / 10,
            avg_confidence: Math.round(avgConfidence * 10) / 10,
            sample_size_confidence: sampleConfidence,
            updated_at: now.toISOString(),
          }, {
            onConflict: 'sport,ai_recommendation,ai_direction,confidence_bucket',
          });
      }
      
      console.log(`📈 Updated ${metricsMap.size} accuracy metric records`);
    }

    const winRate = verified > 0 ? ((won / (verified - push)) * 100).toFixed(1) : '0';
    const roi = verified > 0 ? (((won * 0.91 - lost) / (verified - push)) * 100).toFixed(1) : '0';

    console.log(`\n📊 VERIFICATION SUMMARY:`);
    console.log(`   ✅ Verified: ${verified}`);
    console.log(`   🏆 Won: ${won}`);
    console.log(`   ❌ Lost: ${lost}`);
    console.log(`   🤝 Push: ${push}`);
    console.log(`   ❓ Not Found: ${notFound}`);
    console.log(`   📈 Win Rate: ${winRate}%`);
    console.log(`   💰 ROI: ${roi}%`);

    return new Response(JSON.stringify({
      success: true,
      message: `Verified ${verified} God Mode Tracker predictions`,
      verified,
      won,
      lost,
      push,
      notFound,
      winRate: parseFloat(winRate),
      roi: parseFloat(roi),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error in verify-sharp-tracker-outcomes:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
