import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalysisInput {
  id: string;
  opening_line: number;
  opening_over_price: number;
  opening_under_price: number;
  current_line: number;
  current_over_price: number;
  current_under_price: number;
  sport: string;
  prop_type: string;
  commence_time?: string;
}

interface AnalysisResult {
  recommendation: 'pick' | 'fade' | 'caution';
  direction: 'over' | 'under';
  confidence: number;
  reasoning: string;
  signals: {
    sharp: string[];
    trap: string[];
  };
  calibrationApplied?: boolean;
  strategyBoost?: number;
}

interface CalibrationFactor {
  sport: string;
  bet_type: string;
  odds_bucket: string;
  calibration_factor: number;
  sample_size: number;
  actual_win_rate: number;
}

interface StrategyPerformance {
  strategy_name: string;
  win_rate: number;
  total_suggestions: number;
  confidence_adjustment: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const input: AnalysisInput = await req.json();
    console.log('Analyzing sharp line with enhanced AI:', input);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // === FETCH CALIBRATION DATA ===
    let calibrationFactor = 1.0;
    let calibrationApplied = false;
    
    // Determine odds bucket based on current over price
    const oddsBucket = getOddsBucket(input.current_over_price);
    
    const { data: calibrationData } = await supabase
      .from('ai_calibration_factors')
      .select('*')
      .eq('sport', input.sport)
      .eq('odds_bucket', oddsBucket)
      .single();

    if (calibrationData && calibrationData.sample_size >= 10) {
      calibrationFactor = calibrationData.calibration_factor;
      calibrationApplied = true;
      console.log(`Applied calibration factor: ${calibrationFactor} (${calibrationData.sample_size} samples)`);
    }

    // === FETCH STRATEGY PERFORMANCE ===
    let strategyBoost = 0;
    const { data: strategyData } = await supabase
      .from('strategy_performance')
      .select('*')
      .in('strategy_name', ['VERIFIED_SHARP', 'SHARP_PROPS', 'FADE']);

    const strategyMap = new Map<string, StrategyPerformance>();
    if (strategyData) {
      strategyData.forEach((s: StrategyPerformance) => {
        strategyMap.set(s.strategy_name, s);
      });
    }

    // === FETCH MARKET CONSENSUS (multiple books) ===
    let marketConsensusBooks = 0;
    let consensusDirection: 'over' | 'under' | null = null;
    
    const { data: oddsSnapshots } = await supabase
      .from('odds_snapshots')
      .select('bookmaker, price, outcome_name')
      .eq('sport', input.sport)
      .gte('snapshot_time', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .limit(50);

    if (oddsSnapshots && oddsSnapshots.length > 0) {
      const bookmakers = new Set(oddsSnapshots.map(s => s.bookmaker));
      marketConsensusBooks = bookmakers.size;
      
      // Check if most books favor same direction
      const overBooks = oddsSnapshots.filter(s => 
        s.outcome_name?.toLowerCase().includes('over') && s.price < -115
      ).length;
      const underBooks = oddsSnapshots.filter(s => 
        s.outcome_name?.toLowerCase().includes('under') && s.price < -115
      ).length;
      
      if (overBooks > underBooks * 2) consensusDirection = 'over';
      else if (underBooks > overBooks * 2) consensusDirection = 'under';
    }

    // Calculate movements
    const lineChange = input.current_line - input.opening_line;
    const overPriceChange = input.current_over_price - input.opening_over_price;
    const underPriceChange = input.current_under_price - input.opening_under_price;

    // Determine hours to game
    let hoursToGame = 24;
    if (input.commence_time) {
      const gameTime = new Date(input.commence_time);
      const now = new Date();
      hoursToGame = (gameTime.getTime() - now.getTime()) / (1000 * 60 * 60);
    }

    // Analyze signals
    const signals: { sharp: string[]; trap: string[] } = { sharp: [], trap: [] };
    let sharpScore = 0;
    let trapScore = 0;

    // === ENHANCED SHARP SIGNALS ===

    // 1. Line + juice moved together (strongest signal)
    if (Math.abs(lineChange) >= 0.5 && Math.abs(overPriceChange) >= 10) {
      signals.sharp.push('LINE_AND_JUICE_MOVED');
      sharpScore += 35;
    }

    // 2. Late money (1-3 hours pregame) - optimal window
    if (hoursToGame >= 1 && hoursToGame <= 3) {
      signals.sharp.push('LATE_MONEY_SWEET_SPOT');
      sharpScore += 25;
    }

    // 3. Significant juice movement (15+ points) = Steam move
    if (Math.abs(overPriceChange) >= 15 || Math.abs(underPriceChange) >= 15) {
      signals.sharp.push('STEAM_MOVE_DETECTED');
      sharpScore += 30;
    }

    // 4. Single-side movement (over moved, under didn't move opposite)
    const expectedOppositeMove = -overPriceChange;
    const actualUnderMove = underPriceChange;
    if (Math.abs(overPriceChange) >= 10 && Math.abs(actualUnderMove - expectedOppositeMove) > 10) {
      signals.sharp.push('SINGLE_SIDE_MOVEMENT');
      sharpScore += 20;
    }

    // 5. High-value prop types
    if (input.prop_type && ['points', 'rebounds', 'assists', 'passing_yards', 'rushing_yards'].includes(input.prop_type)) {
      signals.sharp.push('HIGH_VALUE_PROP_TYPE');
      sharpScore += 10;
    }

    // 6. NEW: Reverse Line Movement (RLM) - line moves against expected public direction
    // If over price is getting juicier but line is moving up = sharp on over
    if (overPriceChange < -10 && lineChange > 0) {
      signals.sharp.push('REVERSE_LINE_MOVEMENT');
      sharpScore += 35;
    } else if (underPriceChange < -10 && lineChange < 0) {
      signals.sharp.push('REVERSE_LINE_MOVEMENT');
      sharpScore += 35;
    }

    // 7. NEW: Market consensus across books
    if (marketConsensusBooks >= 3 && consensusDirection) {
      signals.sharp.push(`MARKET_CONSENSUS_${marketConsensusBooks}_BOOKS`);
      sharpScore += 25;
    }

    // 8. NEW: Accelerating movement (movement in last hour larger than earlier)
    if (Math.abs(overPriceChange) >= 20 && hoursToGame < 2) {
      signals.sharp.push('ACCELERATING_STEAM');
      sharpScore += 20;
    }

    // 9. NEW: CLV projection - current price better than typical closing
    // If current juice is mild (-110 to -115) but movement suggests it'll close at -130+
    if (input.current_over_price >= -115 && overPriceChange < -15) {
      signals.sharp.push('CLV_VALUE_DETECTED');
      sharpScore += 25;
    } else if (input.current_under_price >= -115 && underPriceChange < -15) {
      signals.sharp.push('CLV_VALUE_DETECTED');
      sharpScore += 25;
    }

    // === ENHANCED TRAP SIGNALS ===

    // 1. Price-only move (juice changed, line didn't)
    if (Math.abs(lineChange) < 0.5 && Math.abs(overPriceChange) >= 10) {
      signals.trap.push('PRICE_ONLY_MOVE');
      trapScore += 30;
    }

    // 2. Early morning action (6+ hours out)
    if (hoursToGame > 6) {
      signals.trap.push('EARLY_MORNING_ACTION');
      trapScore += 15;
    }

    // 3. Both sides moved (market adjustment, not sharp action)
    if (overPriceChange < -5 && underPriceChange < -5) {
      signals.trap.push('BOTH_SIDES_MOVED');
      trapScore += 35;
    }

    // 4. Small movement (under 8 points) - could be noise
    if (Math.abs(overPriceChange) < 8 && Math.abs(underPriceChange) < 8) {
      signals.trap.push('INSIGNIFICANT_MOVEMENT');
      trapScore += 20;
    }

    // 5. Heavy favorite getting shorter (public pile-on)
    if (input.opening_over_price <= -150 && overPriceChange < -10) {
      signals.trap.push('FAVORITE_SHORTENING_MORE');
      trapScore += 25;
    }

    // 6. NEW: Market divergence (books moving different directions)
    if (marketConsensusBooks >= 2 && !consensusDirection) {
      signals.trap.push('MARKET_DIVERGENCE');
      trapScore += 20;
    }

    // 7. NEW: Stale line trap (no movement close to game time)
    if (hoursToGame < 1 && Math.abs(overPriceChange) < 5 && Math.abs(lineChange) < 0.5) {
      signals.trap.push('STALE_LINE_WARNING');
      trapScore += 15;
    }

    // 8. NEW: Extreme juice warning (-150 or worse)
    if (input.current_over_price <= -150 || input.current_under_price <= -150) {
      signals.trap.push('EXTREME_JUICE_WARNING');
      trapScore += 20;
    }

    // Determine direction based on movement
    let direction: 'over' | 'under' = 'over';
    if (overPriceChange < 0) {
      direction = 'over';
    } else if (underPriceChange < 0) {
      direction = 'under';
    } else if (Math.abs(overPriceChange) > Math.abs(underPriceChange)) {
      direction = overPriceChange < 0 ? 'over' : 'under';
    } else {
      direction = underPriceChange < 0 ? 'under' : 'over';
    }

    // === CALCULATE CALIBRATED SCORE ===
    let netScore = sharpScore - trapScore;
    
    // Apply calibration factor
    const calibratedScore = netScore * calibrationFactor;
    
    // Apply strategy performance boost
    if (calibratedScore >= 30) {
      const sharpStrategy = strategyMap.get('VERIFIED_SHARP') || strategyMap.get('SHARP_PROPS');
      if (sharpStrategy && sharpStrategy.total_suggestions >= 20) {
        strategyBoost = (sharpStrategy.win_rate / 100 - 0.5) * 20; // +10 if 75% win rate
        console.log(`Strategy boost applied: ${strategyBoost} (${sharpStrategy.win_rate}% win rate)`);
      }
    } else if (calibratedScore <= -20) {
      const fadeStrategy = strategyMap.get('FADE');
      if (fadeStrategy && fadeStrategy.total_suggestions >= 10) {
        strategyBoost = (fadeStrategy.win_rate / 100 - 0.5) * 15;
      }
    }

    const finalScore = calibratedScore + strategyBoost;

    // Calculate final recommendation
    let recommendation: 'pick' | 'fade' | 'caution';
    let confidence: number;

    if (finalScore >= 35) {
      recommendation = 'pick';
      confidence = Math.min(0.95, 0.65 + (finalScore - 35) / 100);
    } else if (finalScore <= -25) {
      recommendation = 'fade';
      direction = direction === 'over' ? 'under' : 'over';
      confidence = Math.min(0.9, 0.55 + Math.abs(finalScore + 25) / 80);
    } else {
      recommendation = 'caution';
      confidence = 0.35 + Math.abs(finalScore) / 150;
    }

    // Build enhanced reasoning
    let reasoning = '';
    
    if (recommendation === 'pick') {
      reasoning = `Sharp action detected on ${direction.toUpperCase()}. `;
      if (signals.sharp.includes('LINE_AND_JUICE_MOVED')) {
        reasoning += `Line moved ${lineChange > 0 ? '+' : ''}${lineChange.toFixed(1)} with ${Math.abs(overPriceChange)} point juice shift. `;
      }
      if (signals.sharp.includes('STEAM_MOVE_DETECTED')) {
        reasoning += `Steam move of ${Math.abs(Math.max(Math.abs(overPriceChange), Math.abs(underPriceChange)))} points. `;
      }
      if (signals.sharp.includes('REVERSE_LINE_MOVEMENT')) {
        reasoning += `RLM detected - line moving against public action. `;
      }
      if (signals.sharp.includes('LATE_MONEY_SWEET_SPOT')) {
        reasoning += `Late money ${hoursToGame.toFixed(1)}h pregame. `;
      }
      if (signals.sharp.includes('CLV_VALUE_DETECTED')) {
        reasoning += `CLV opportunity - current price better than projected close. `;
      }
      if (calibrationApplied) {
        reasoning += `[Calibration: ${(calibrationFactor * 100).toFixed(0)}%] `;
      }
    } else if (recommendation === 'fade') {
      reasoning = `Trap detected - bet ${direction.toUpperCase()} against the movement. `;
      if (signals.trap.includes('PRICE_ONLY_MOVE')) {
        reasoning += `Price moved but line held - classic trap. `;
      }
      if (signals.trap.includes('BOTH_SIDES_MOVED')) {
        reasoning += `Both sides moved - market adjustment, not sharp action. `;
      }
      if (signals.trap.includes('EARLY_MORNING_ACTION')) {
        reasoning += `Early movement often represents public overreaction. `;
      }
      if (signals.trap.includes('EXTREME_JUICE_WARNING')) {
        reasoning += `Extreme juice indicates public overload. `;
      }
    } else {
      reasoning = `Mixed signals - wait for clarity. `;
      reasoning += `Sharp: ${sharpScore}, Trap: ${trapScore}, Net: ${finalScore.toFixed(1)}. `;
      if (signals.sharp.length > 0) {
        reasoning += `Positive: ${signals.sharp.slice(0, 3).join(', ')}. `;
      }
      if (signals.trap.length > 0) {
        reasoning += `Concerns: ${signals.trap.slice(0, 3).join(', ')}. `;
      }
    }

    const result: AnalysisResult = {
      recommendation,
      direction,
      confidence,
      reasoning: reasoning.trim(),
      signals,
      calibrationApplied,
      strategyBoost
    };

    console.log('Enhanced analysis result:', result);

    // Update the database record
    const { error: updateError } = await supabase
      .from('sharp_line_tracker')
      .update({
        ai_recommendation: result.recommendation,
        ai_direction: result.direction,
        ai_confidence: result.confidence,
        ai_reasoning: result.reasoning,
        ai_signals: result.signals,
        status: 'analyzed'
      })
      .eq('id', input.id);

    if (updateError) {
      console.error('Error updating record:', updateError);
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-sharp-line:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Helper function to determine odds bucket
function getOddsBucket(price: number): string {
  if (price <= -300) return '-500_to_-300';
  if (price <= -200) return '-300_to_-200';
  if (price <= -150) return '-200_to_-150';
  if (price <= -110) return '-150_to_-110';
  if (price <= 100) return '-110_to_100';
  if (price <= 150) return '100_to_150';
  if (price <= 200) return '150_to_200';
  if (price <= 300) return '200_to_300';
  return '300_to_500';
}
