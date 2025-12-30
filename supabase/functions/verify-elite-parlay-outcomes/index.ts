import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Prop type to stat column mapping - comprehensive list
const PROP_TO_STAT_MAP: Record<string, string | string[]> = {
  // Standard prop types
  'player_points': 'points',
  'player_rebounds': 'rebounds',
  'player_assists': 'assists',
  'player_threes': 'threes_made',
  'player_blocks': 'blocks',
  'player_steals': 'steals',
  'player_turnovers': 'turnovers',
  // Title case variants
  'Points': 'points',
  'Rebounds': 'rebounds',
  'Assists': 'assists',
  '3-Pointers': 'threes_made',
  '3-Pointers Made': 'threes_made',
  'Threes': 'threes_made',
  'Blocks': 'blocks',
  'Steals': 'steals',
  'Turnovers': 'turnovers',
  // Combined props
  'Pts+Reb+Ast': ['points', 'rebounds', 'assists'],
  'Pts+Reb': ['points', 'rebounds'],
  'Pts+Ast': ['points', 'assists'],
  'Reb+Ast': ['rebounds', 'assists'],
  'Steals+Blocks': ['steals', 'blocks'],
  'player_points_rebounds_assists': ['points', 'rebounds', 'assists'],
  'player_points_rebounds': ['points', 'rebounds'],
  'player_points_assists': ['points', 'assists'],
  'player_rebounds_assists': ['rebounds', 'assists'],
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

// Fuzzy match for player names (handles Jr., III, nicknames, etc.)
function fuzzyMatchPlayerName(targetName: string, candidateName: string): number {
  const target = normalizePlayerName(targetName);
  const candidate = normalizePlayerName(candidateName);
  
  // Exact match
  if (target === candidate) return 1.0;
  
  // One contains the other
  if (target.includes(candidate) || candidate.includes(target)) return 0.9;
  
  // Split into parts and check overlap
  const targetParts = target.split(' ');
  const candidateParts = candidate.split(' ');
  
  // Check last name match (most important)
  const targetLast = targetParts[targetParts.length - 1];
  const candidateLast = candidateParts[candidateParts.length - 1];
  
  if (targetLast === candidateLast) {
    // Last names match, check first initial
    const targetFirst = targetParts[0]?.[0] || '';
    const candidateFirst = candidateParts[0]?.[0] || '';
    if (targetFirst === candidateFirst) return 0.85;
    return 0.7;
  }
  
  // Check if any parts match
  const matchingParts = targetParts.filter(p => candidateParts.includes(p));
  if (matchingParts.length > 0) {
    return 0.5 + (matchingParts.length / Math.max(targetParts.length, candidateParts.length)) * 0.3;
  }
  
  return 0;
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
  sport?: string;
}

function parseLegFromJson(leg: any, index: number): LegData | null {
  try {
    return {
      playerName: leg.playerName || leg.player_name || leg.player || '',
      propType: leg.propType || leg.prop_type || leg.market || '',
      line: parseFloat(leg.line || leg.currentLine || leg.current_line || 0),
      side: leg.side || leg.bet_side || leg.recommended_side || 'OVER',
      probability: parseFloat(leg.probability || leg.p_leg || leg.predicted_probability || 0.5),
      engine: leg.engine || leg.source || leg.engines?.[0] || 'unknown',
      eventId: leg.eventId || leg.event_id,
      sport: leg.sport || 'basketball_nba',
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
    parlaysNoData: 0,
    legsVerified: 0,
    legsHit: 0,
    legsMissed: 0,
    legsNoData: 0,
    missingPlayers: [] as string[],
    errors: [] as string[],
  };

  try {
    console.log('=== Starting Elite Parlay Outcome Verification ===');
    
    // Parse request options
    const { forceFetch = false, dateRange = 14 } = await req.json().catch(() => ({}));
    
    // Fetch pending parlays that are at least 24 hours old
    const cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const { data: pendingParlays, error: fetchError } = await supabase
      .from('daily_elite_parlays')
      .select('*')
      .in('outcome', ['pending', 'no_data'])
      .lte('parlay_date', cutoffDate)
      .order('parlay_date', { ascending: false });

    if (fetchError) {
      throw new Error(`Failed to fetch pending parlays: ${fetchError.message}`);
    }

    console.log(`Found ${pendingParlays?.length || 0} pending/no_data parlays to verify`);

    // Fetch all game logs from the date range
    const oldestParlay = pendingParlays?.[pendingParlays.length - 1];
    const dateStart = oldestParlay ? 
      new Date(new Date(oldestParlay.parlay_date).getTime() - 2 * 24 * 60 * 60 * 1000) : 
      new Date(Date.now() - dateRange * 24 * 60 * 60 * 1000);
    
    console.log(`Fetching game logs from ${dateStart.toISOString().split('T')[0]} onwards`);
    
    const { data: allGameLogs, error: logsError } = await supabase
      .from('nba_player_game_logs')
      .select('*')
      .gte('game_date', dateStart.toISOString().split('T')[0]);
    
    if (logsError) {
      console.error(`Error fetching game logs: ${logsError.message}`);
    }
    
    console.log(`Loaded ${allGameLogs?.length || 0} game log records`);
    
    // Create lookup maps for faster searching
    const gameLogsByDate = new Map<string, any[]>();
    for (const log of allGameLogs || []) {
      const date = log.game_date;
      if (!gameLogsByDate.has(date)) {
        gameLogsByDate.set(date, []);
      }
      gameLogsByDate.get(date)!.push(log);
    }

    for (const parlay of pendingParlays || []) {
      results.parlaysProcessed++;
      
      try {
        const legs = parlay.legs as any[];
        if (!legs || legs.length === 0) {
          console.log(`Parlay ${parlay.id} has no legs, skipping`);
          continue;
        }

        const legResults: any[] = [];
        let legsWithData = 0;

        // Process each leg
        for (let i = 0; i < legs.length; i++) {
          const legData = parseLegFromJson(legs[i], i);
          if (!legData) {
            legResults.push({ legIndex: i, outcome: 'parse_error' });
            continue;
          }

          // Skip non-NBA legs for now
          if (legData.sport && !legData.sport.includes('basketball')) {
            console.log(`Skipping non-NBA leg: ${legData.playerName} (${legData.sport})`);
            legResults.push({
              ...legData,
              legIndex: i,
              outcome: 'skipped_sport',
              actualValue: null,
            });
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

          // Search for player game log around the parlay date (+/- 2 days window)
          const parlayDate = new Date(parlay.parlay_date);
          const searchDates = [
            parlay.parlay_date,
            new Date(parlayDate.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            new Date(parlayDate.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            new Date(parlayDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          ];

          let playerLog: any = null;
          let matchScore = 0;
          
          for (const searchDate of searchDates) {
            const logsForDate = gameLogsByDate.get(searchDate) || [];
            
            for (const log of logsForDate) {
              const score = fuzzyMatchPlayerName(legData.playerName, log.player_name);
              if (score > matchScore && score >= 0.7) {
                matchScore = score;
                playerLog = log;
                if (score === 1.0) break; // Perfect match, stop searching
              }
            }
            
            if (matchScore === 1.0) break;
          }

          if (!playerLog) {
            console.log(`No game log found for ${legData.playerName} around ${parlay.parlay_date}`);
            if (!results.missingPlayers.includes(legData.playerName)) {
              results.missingPlayers.push(legData.playerName);
            }
            legResults.push({
              ...legData,
              legIndex: i,
              outcome: 'no_data',
              actualValue: null,
            });
            results.legsNoData++;
            continue;
          }

          if (matchScore < 1.0) {
            console.log(`Fuzzy matched: "${legData.playerName}" -> "${playerLog.player_name}" (score: ${matchScore})`);
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

          console.log(`Leg ${i}: ${legData.playerName} ${legData.propType} ${legData.side} ${legData.line} -> Actual: ${actualValue} = ${legOutcome}`);

          legResults.push({
            ...legData,
            legIndex: i,
            outcome: legOutcome,
            actualValue,
            matchedPlayer: playerLog.player_name,
            matchScore,
          });

          legsWithData++;
          results.legsVerified++;
          if (legOutcome === 'hit' || legOutcome === 'push') {
            results.legsHit++;
          } else {
            results.legsMissed++;
          }

          // Insert leg outcome record
          await supabase.from('daily_elite_leg_outcomes').upsert({
            parlay_id: parlay.id,
            leg_index: i,
            player_name: legData.playerName,
            prop_type: legData.propType,
            line: legData.line,
            side: legData.side,
            predicted_probability: legData.probability,
            actual_value: actualValue,
            outcome: legOutcome,
            engine_signals: { engine: legData.engine, eventId: legData.eventId, matchScore },
            verified_at: new Date().toISOString(),
          }, { onConflict: 'parlay_id,leg_index' });
        }

        // Determine overall parlay outcome
        let parlayOutcome: string;
        const verifiedLegs = legResults.filter(l => ['hit', 'miss', 'push'].includes(l.outcome));
        const hitLegs = legResults.filter(l => l.outcome === 'hit' || l.outcome === 'push');
        const missedLegs = legResults.filter(l => l.outcome === 'miss');
        const nbaLegs = legResults.filter(l => l.outcome !== 'skipped_sport');

        if (verifiedLegs.length === 0) {
          parlayOutcome = 'no_data';
          results.parlaysNoData++;
        } else if (missedLegs.length > 0) {
          // Any miss = parlay lost
          parlayOutcome = 'lost';
          results.parlaysLost++;
        } else if (hitLegs.length === nbaLegs.length) {
          // All NBA legs hit = won
          parlayOutcome = 'won';
          results.parlaysWon++;
        } else if (hitLegs.length > 0) {
          // Some hit, some pending = partial
          parlayOutcome = 'partial';
          results.parlaysPartial++;
        } else {
          parlayOutcome = 'no_data';
          results.parlaysNoData++;
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
        console.log(`Parlay ${parlay.id} (${parlay.parlay_date}): ${parlayOutcome} (${hitLegs.length}/${nbaLegs.length} legs hit)`);

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
    console.log(`Won: ${results.parlaysWon}, Lost: ${results.parlaysLost}, No Data: ${results.parlaysNoData}`);
    console.log(`Legs - Hit: ${results.legsHit}, Missed: ${results.legsMissed}, No Data: ${results.legsNoData}`);
    if (results.missingPlayers.length > 0) {
      console.log(`Missing players: ${results.missingPlayers.join(', ')}`);
    }

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
