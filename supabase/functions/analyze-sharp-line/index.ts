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
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const input: AnalysisInput = await req.json();
    console.log('Analyzing sharp line:', input);

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

    // === SHARP SIGNALS ===

    // 1. Line + juice moved together (strongest signal)
    if (Math.abs(lineChange) >= 0.5 && Math.abs(overPriceChange) >= 10) {
      signals.sharp.push('LINE_AND_JUICE_MOVED');
      sharpScore += 30;
    }

    // 2. Late money (1-3 hours pregame)
    if (hoursToGame >= 1 && hoursToGame <= 3) {
      signals.sharp.push('LATE_MONEY_SWEET_SPOT');
      sharpScore += 20;
    }

    // 3. Significant juice movement (15+ points)
    if (Math.abs(overPriceChange) >= 15 || Math.abs(underPriceChange) >= 15) {
      signals.sharp.push('STEAM_MOVE_DETECTED');
      sharpScore += 25;
    }

    // 4. Single-side movement (over moved, under didn't move opposite)
    const expectedOppositeMove = -overPriceChange;
    const actualUnderMove = underPriceChange;
    if (Math.abs(overPriceChange) >= 10 && Math.abs(actualUnderMove - expectedOppositeMove) > 10) {
      signals.sharp.push('SINGLE_SIDE_MOVEMENT');
      sharpScore += 15;
    }

    // 5. Player props are sharper markets
    if (input.prop_type && ['points', 'rebounds', 'assists'].includes(input.prop_type)) {
      signals.sharp.push('HIGH_VALUE_PROP_TYPE');
      sharpScore += 10;
    }

    // === TRAP SIGNALS ===

    // 1. Price-only move (juice changed, line didn't)
    if (Math.abs(lineChange) < 0.5 && Math.abs(overPriceChange) >= 10) {
      signals.trap.push('PRICE_ONLY_MOVE');
      trapScore += 25;
    }

    // 2. Early morning action (6+ hours out)
    if (hoursToGame > 6) {
      signals.trap.push('EARLY_MORNING_ACTION');
      trapScore += 15;
    }

    // 3. Both sides moved (market adjustment, not sharp action)
    if (overPriceChange < -5 && underPriceChange < -5) {
      signals.trap.push('BOTH_SIDES_MOVED');
      trapScore += 30;
    }

    // 4. Small movement (under 8 points) - could be noise
    if (Math.abs(overPriceChange) < 8 && Math.abs(underPriceChange) < 8) {
      signals.trap.push('INSIGNIFICANT_MOVEMENT');
      trapScore += 20;
    }

    // 5. Heavy favorite getting shorter (public pile-on)
    if (input.opening_over_price <= -150 && overPriceChange < -10) {
      signals.trap.push('FAVORITE_SHORTENING_MORE');
      trapScore += 20;
    }

    // Determine direction based on movement
    let direction: 'over' | 'under' = 'over';
    if (overPriceChange < 0) {
      // Over price went from -110 to -130 = money on Over
      direction = 'over';
    } else if (underPriceChange < 0) {
      // Under price dropped = money on Under
      direction = 'under';
    } else if (Math.abs(overPriceChange) > Math.abs(underPriceChange)) {
      direction = overPriceChange < 0 ? 'over' : 'under';
    } else {
      direction = underPriceChange < 0 ? 'under' : 'over';
    }

    // Calculate final recommendation
    let recommendation: 'pick' | 'fade' | 'caution';
    let confidence: number;

    const netScore = sharpScore - trapScore;

    if (netScore >= 30) {
      recommendation = 'pick';
      confidence = Math.min(0.95, 0.6 + (netScore - 30) / 100);
    } else if (netScore <= -20) {
      recommendation = 'fade';
      direction = direction === 'over' ? 'under' : 'over'; // Flip direction for fade
      confidence = Math.min(0.9, 0.5 + Math.abs(netScore + 20) / 80);
    } else {
      recommendation = 'caution';
      confidence = 0.4 + Math.abs(netScore) / 100;
    }

    // Build reasoning
    let reasoning = '';
    
    if (recommendation === 'pick') {
      reasoning = `Sharp action detected on ${direction.toUpperCase()}. `;
      if (signals.sharp.includes('LINE_AND_JUICE_MOVED')) {
        reasoning += `Line moved ${lineChange > 0 ? '+' : ''}${lineChange.toFixed(1)} with ${Math.abs(overPriceChange)} point juice increase. `;
      }
      if (signals.sharp.includes('STEAM_MOVE_DETECTED')) {
        reasoning += `Steam move of ${Math.abs(Math.max(Math.abs(overPriceChange), Math.abs(underPriceChange)))} points. `;
      }
      if (signals.sharp.includes('LATE_MONEY_SWEET_SPOT')) {
        reasoning += `Late money coming in ${hoursToGame.toFixed(1)} hours before game. `;
      }
    } else if (recommendation === 'fade') {
      reasoning = `Potential trap detected. Go ${direction.toUpperCase()} against the movement. `;
      if (signals.trap.includes('PRICE_ONLY_MOVE')) {
        reasoning += `Price moved but line held - classic trap signal. `;
      }
      if (signals.trap.includes('BOTH_SIDES_MOVED')) {
        reasoning += `Both sides moved - market adjustment, not sharp action. `;
      }
      if (signals.trap.includes('EARLY_MORNING_ACTION')) {
        reasoning += `Early morning movement often represents public overreaction. `;
      }
    } else {
      reasoning = `Mixed signals - wait for more clarity. `;
      reasoning += `Sharp score: ${sharpScore}, Trap score: ${trapScore}. `;
      if (signals.sharp.length > 0) {
        reasoning += `Positive: ${signals.sharp.join(', ')}. `;
      }
      if (signals.trap.length > 0) {
        reasoning += `Concerns: ${signals.trap.join(', ')}. `;
      }
    }

    const result: AnalysisResult = {
      recommendation,
      direction,
      confidence,
      reasoning: reasoning.trim(),
      signals
    };

    console.log('Analysis result:', result);

    // Update the database record
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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
