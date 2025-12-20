import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Prop type to stat column mapping
const PROP_TO_STAT_MAP: Record<string, string | string[]> = {
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_turnovers': 'turnovers',
  'Points': 'points',
  'Rebounds': 'rebounds',
  'Assists': 'assists',
  '3-Pointers': 'threes_made',
  '3-Pointers Made': 'threes_made',
  'Blocks': 'blocks',
  'Steals': 'steals',
  'Turnovers': 'turnovers',
  'Pts+Reb+Ast': ['points', 'rebounds', 'assists'],
  'Pts+Reb': ['points', 'rebounds'],
  'Pts+Ast': ['points', 'assists'],
  'Reb+Ast': ['rebounds', 'assists'],
  'Steals+Blocks': ['steals', 'blocks'],
};

// Probability buckets for accuracy tracking
const PROBABILITY_BUCKETS = [
  { name: '55-60%', min: 0.55, max: 0.60 },
  { name: '60-70%', min: 0.60, max: 0.70 },
  { name: '70-80%', min: 0.70, max: 0.80 },
  { name: '80%+', min: 0.80, max: 1.0 },
];

function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getProbabilityBucket(prob: number): string | null {
  for (const bucket of PROBABILITY_BUCKETS) {
    if (prob >= bucket.min && prob < bucket.max) {
      return bucket.name;
    }
  }
  if (prob >= 0.80) return '80%+';
  return null;
}

interface LegData {
  playerName: string;
  propType: string;
  line: number;
  side: string;
  probability: number;
  engine: string;
  eventId?: string;
}

function parseLegFromJson(leg: any, index: number): LegData | null {
  try {
    return {
      playerName: leg.playerName || leg.player_name || leg.player || '',
      propType: leg.propType || leg.prop_type || leg.market || '',
      line: parseFloat(leg.line || leg.currentLine || leg.current_line || 0),
      side: leg.side || leg.bet_side || leg.recommended_side || 'OVER',
      probability: parseFloat(leg.probability || leg.p_leg || leg.predicted_probability || 0.5),
      engine: leg.engine || leg.source || 'unknown',
      eventId: leg.eventId || leg.event_id,
    };
  } catch (e) {
    console.error(`Failed to parse leg ${index}:`, e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const startTime = Date.now();
  
  const results = {
    parlaysProcessed: 0,
    parlaysVerified: 0,
    parlaysWon: 0,
    parlaysLost: 0,
    parlaysPartial: 0,
    legsVerified: 0,
    legsHit: 0,
    legsMissed: 0,
    legsNoData: 0,
    errors: [] as string[],
  };

  try {
    console.log('=== Starting Elite Parlay Outcome Verification ===');
    
    // Fetch pending parlays that are at least 24 hours old
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const { data: pendingParlays, error: fetchError } = await supabase
      .from('daily_elite_parlays')
      .select('*')
      .eq('outcome', 'pending')
      .lte('parlay_date', cutoffDate);

    if (fetchError) {
      throw new Error(`Failed to fetch pending parlays: ${fetchError.message}`);
    }

    console.log(`Found ${pendingParlays?.length || 0} pending parlays to verify`);

    for (const parlay of pendingParlays || []) {
      results.parlaysProcessed++;
      
      try {
        const legs = parlay.legs as any[];
        if (!legs || legs.length === 0) {
          console.log(`Parlay ${parlay.id} has no legs, skipping`);
          continue;
        }

        const legResults: any[] = [];
        let allLegsVerified = true;
        let anyLegMissed = false;
        let anyLegHit = false;

        // Process each leg
        for (let i = 0; i < legs.length; i++) {
          const legData = parseLegFromJson(legs[i], i);
          if (!legData) {
            legResults.push({ legIndex: i, outcome: 'parse_error' });
            continue;
          }

          // Get stat column(s) for this prop type
          const statMapping = PROP_TO_STAT_MAP[legData.propType];
          if (!statMapping) {
            console.log(`Unknown prop type: ${legData.propType}`);
            legResults.push({
              ...legData,
              legIndex: i,
              outcome: 'unknown_prop',
              actualValue: null,
            });
            results.legsNoData++;
            continue;
          }

          // Normalize player name for lookup
          const normalizedName = normalizePlayerName(legData.playerName);
          
          // Query player game logs around the parlay date
          const parlayDate = new Date(parlay.parlay_date);
          const dateStart = new Date(parlayDate);
          dateStart.setDate(dateStart.getDate() - 1);
          const dateEnd = new Date(parlayDate);
          dateEnd.setDate(dateEnd.getDate() + 1);

          const { data: gameLogs, error: logError } = await supabase
            .from('nba_player_game_logs')
            .select('*')
            .gte('game_date', dateStart.toISOString().split('T')[0])
            .lte('game_date', dateEnd.toISOString().split('T')[0]);

          if (logError) {
            console.error(`Error fetching game logs: ${logError.message}`);
            legResults.push({
              ...legData,
              legIndex: i,
              outcome: 'fetch_error',
              actualValue: null,
            });
            results.legsNoData++;
            continue;
          }

          // Find matching player
          const playerLog = gameLogs?.find(log => 
            normalizePlayerName(log.player_name) === normalizedName
          );

          if (!playerLog) {
            console.log(`No game log found for ${legData.playerName} on ${parlay.parlay_date}`);
            legResults.push({
              ...legData,
              legIndex: i,
              outcome: 'no_data',
              actualValue: null,
            });
            allLegsVerified = false;
            results.legsNoData++;
            continue;
          }

          // Calculate actual value
          let actualValue: number;
          if (Array.isArray(statMapping)) {
            // Combined stat
            actualValue = statMapping.reduce((sum, col) => sum + (parseFloat(playerLog[col]) || 0), 0);
          } else {
            actualValue = parseFloat(playerLog[statMapping]) || 0;
          }

          // Determine outcome
          let legOutcome: string;
          const side = legData.side.toUpperCase();
          
          if (actualValue === legData.line) {
            legOutcome = 'push';
          } else if (side === 'OVER' || side === 'O') {
            legOutcome = actualValue > legData.line ? 'hit' : 'miss';
          } else {
            legOutcome = actualValue < legData.line ? 'hit' : 'miss';
          }

          legResults.push({
            ...legData,
            legIndex: i,
            outcome: legOutcome,
            actualValue,
          });

          results.legsVerified++;
          if (legOutcome === 'hit' || legOutcome === 'push') {
            results.legsHit++;
            anyLegHit = true;
          } else {
            results.legsMissed++;
            anyLegMissed = true;
          }

          // Insert leg outcome record
          await supabase.from('daily_elite_leg_outcomes').insert({
            parlay_id: parlay.id,
            leg_index: i,
            player_name: legData.playerName,
            prop_type: legData.propType,
            line: legData.line,
            side: legData.side,
            predicted_probability: legData.probability,
            actual_value: actualValue,
            outcome: legOutcome,
            engine_signals: { engine: legData.engine, eventId: legData.eventId },
            verified_at: new Date().toISOString(),
          });
        }

        // Determine overall parlay outcome
        let parlayOutcome: string;
        const verifiedLegs = legResults.filter(l => ['hit', 'miss', 'push'].includes(l.outcome));
        const hitLegs = legResults.filter(l => l.outcome === 'hit' || l.outcome === 'push');
        const missedLegs = legResults.filter(l => l.outcome === 'miss');

        if (verifiedLegs.length === 0) {
          parlayOutcome = 'no_data';
        } else if (missedLegs.length > 0) {
          parlayOutcome = 'lost';
          results.parlaysLost++;
        } else if (hitLegs.length === legs.length) {
          parlayOutcome = 'won';
          results.parlaysWon++;
        } else {
          parlayOutcome = 'partial';
          results.parlaysPartial++;
        }

        // Update parlay record
        const actualResult = {
          legs: legResults,
          legsHit: hitLegs.length,
          legsMissed: missedLegs.length,
          legsTotal: legs.length,
          legsVerified: verifiedLegs.length,
        };

        await supabase
          .from('daily_elite_parlays')
          .update({
            outcome: parlayOutcome,
            actual_result: actualResult,
            settled_at: new Date().toISOString(),
          })
          .eq('id', parlay.id);

        results.parlaysVerified++;
        console.log(`Parlay ${parlay.id}: ${parlayOutcome} (${hitLegs.length}/${legs.length} legs hit)`);

      } catch (parlayError) {
        const errorMsg = parlayError instanceof Error ? parlayError.message : 'Unknown error';
        console.error(`Error processing parlay ${parlay.id}:`, errorMsg);
        results.errors.push(`Parlay ${parlay.id}: ${errorMsg}`);
      }
    }

    // Update accuracy metrics
    await updateAccuracyMetrics(supabase);

    // Log to cron history
    const duration = Date.now() - startTime;
    await supabase.from('cron_job_history').insert({
      job_name: 'verify-elite-parlay-outcomes',
      status: 'completed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result: results,
    });

    console.log('=== Elite Parlay Verification Complete ===');
    console.log(`Processed: ${results.parlaysProcessed}, Verified: ${results.parlaysVerified}`);
    console.log(`Won: ${results.parlaysWon}, Lost: ${results.parlaysLost}, Partial: ${results.parlaysPartial}`);
    console.log(`Legs - Hit: ${results.legsHit}, Missed: ${results.legsMissed}, No Data: ${results.legsNoData}`);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Fatal error in verify-elite-parlay-outcomes:', error);

    await supabase.from('cron_job_history').insert({
      job_name: 'verify-elite-parlay-outcomes',
      status: 'failed',
      started_at: new Date(startTime).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      error_message: errorMessage,
      result: results,
    });

    return new Response(
      JSON.stringify({ success: false, error: errorMessage, results }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function updateAccuracyMetrics(supabase: any) {
  console.log('Updating accuracy metrics...');

  try {
    // Get all verified leg outcomes
    const { data: allLegs, error } = await supabase
      .from('daily_elite_leg_outcomes')
      .select('*')
      .in('outcome', ['hit', 'miss', 'push']);

    if (error || !allLegs?.length) {
      console.log('No verified legs to calculate metrics');
      return;
    }

    // Calculate overall accuracy
    const totalLegs = allLegs.length;
    const hitLegs = allLegs.filter((l: any) => l.outcome === 'hit' || l.outcome === 'push').length;
    const avgProbability = allLegs.reduce((sum: number, l: any) => sum + (l.predicted_probability || 0.5), 0) / totalLegs;

    await upsertMetric(supabase, 'overall', 'all_legs', totalLegs, hitLegs, avgProbability);

    // Calculate by engine
    const engineGroups = groupBy(allLegs, (l: any) => l.engine_signals?.engine || 'unknown');
    for (const [engine, legs] of Object.entries(engineGroups)) {
      const engineLegs = legs as any[];
      const engineHits = engineLegs.filter(l => l.outcome === 'hit' || l.outcome === 'push').length;
      const engineAvgProb = engineLegs.reduce((sum, l) => sum + (l.predicted_probability || 0.5), 0) / engineLegs.length;
      await upsertMetric(supabase, 'by_engine', engine, engineLegs.length, engineHits, engineAvgProb);
    }

    // Calculate by prop type
    const propGroups = groupBy(allLegs, (l: any) => l.prop_type || 'unknown');
    for (const [propType, legs] of Object.entries(propGroups)) {
      const propLegs = legs as any[];
      const propHits = propLegs.filter(l => l.outcome === 'hit' || l.outcome === 'push').length;
      const propAvgProb = propLegs.reduce((sum, l) => sum + (l.predicted_probability || 0.5), 0) / propLegs.length;
      await upsertMetric(supabase, 'by_prop_type', propType, propLegs.length, propHits, propAvgProb);
    }

    // Calculate by probability bucket
    for (const bucket of PROBABILITY_BUCKETS) {
      const bucketLegs = allLegs.filter((l: any) => {
        const prob = l.predicted_probability || 0;
        return prob >= bucket.min && prob < bucket.max;
      });
      if (bucketLegs.length > 0) {
        const bucketHits = bucketLegs.filter((l: any) => l.outcome === 'hit' || l.outcome === 'push').length;
        const bucketAvgProb = bucketLegs.reduce((sum: number, l: any) => sum + (l.predicted_probability || 0.5), 0) / bucketLegs.length;
        await upsertMetric(supabase, 'by_probability_bucket', bucket.name, bucketLegs.length, bucketHits, bucketAvgProb);
      }
    }

    // Update ai_calibration_factors for elite parlays
    await supabase.from('ai_calibration_factors').upsert({
      sport: 'elite_parlay',
      bet_type: 'combined',
      odds_bucket: 'all',
      predicted_probability: avgProbability,
      actual_win_rate: hitLegs / totalLegs,
      calibration_factor: avgProbability > 0 ? (hitLegs / totalLegs) / avgProbability : 1,
      sample_size: totalLegs,
      total_wins: hitLegs,
      total_bets: totalLegs,
      last_updated: new Date().toISOString(),
    }, { onConflict: 'sport,bet_type,odds_bucket' });

    console.log(`Updated metrics: ${totalLegs} legs, ${hitLegs} hits (${((hitLegs/totalLegs)*100).toFixed(1)}%)`);

  } catch (err) {
    console.error('Error updating accuracy metrics:', err);
  }
}

async function upsertMetric(
  supabase: any,
  metricType: string,
  metricKey: string,
  total: number,
  correct: number,
  avgPredictedProb: number
) {
  const accuracyRate = total > 0 ? (correct / total) * 100 : 0;
  const calibrationFactor = avgPredictedProb > 0 ? (correct / total) / avgPredictedProb : 1;
  const sampleConfidence = total >= 50 ? 'high' : total >= 20 ? 'medium' : total >= 10 ? 'low' : 'insufficient';

  await supabase.from('elite_parlay_accuracy_metrics').upsert({
    metric_type: metricType,
    metric_key: metricKey,
    total_predictions: total,
    correct_predictions: correct,
    accuracy_rate: accuracyRate,
    avg_predicted_probability: avgPredictedProb,
    calibration_factor: calibrationFactor,
    sample_confidence: sampleConfidence,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'metric_type,metric_key' });
}

function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return array.reduce((result, item) => {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
    return result;
  }, {} as Record<string, T[]>);
}
