import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrapInput {
  event_id: string;
  outcome_name: string;
  player_name?: string;
  market_type?: string;
  sport?: string;
  opening_odds?: number;
  current_odds?: number;
  opening_line?: number;
  current_line?: number;
  both_sides_moved?: boolean;
  price_only_move?: boolean;
  public_bet_percentage?: number;
  is_primetime?: boolean;
  is_star_player?: boolean;
  has_narrative_angle?: boolean;
  sharp_indicators?: boolean;
  reverse_line_movement?: boolean;
  multi_book_alignment?: boolean;
  is_early_movement?: boolean;
  confirming_books?: number;
}

interface TrapSignal {
  signal: string;
  points: number;
  reason: string;
  category: 'trap' | 'safe';
}

interface TrapResult {
  trap_probability: number;
  risk_label: 'Low' | 'Medium' | 'High';
  recommendation: 'Play' | 'Reduce Line' | 'Avoid';
  explanation: string;
  triggered_signals: TrapSignal[];
  scores: {
    both_sides_score: number;
    price_freeze_score: number;
    favorite_shorten_score: number;
    round_number_score: number;
    star_boost_score: number;
    sharp_only_movement_score: number;
    reverse_line_movement_score: number;
    multi_book_early_score: number;
  };
}

// Check if a number is near a round number (for overs trap detection)
function isNearRoundNumber(line: number): boolean {
  const roundNumbers = [10, 15, 20, 25, 30, 35, 40, 50, 100, 150, 200];
  return roundNumbers.some(rn => Math.abs(line - rn) <= 0.5);
}

// Calculate all trap signals
function calculateTrapSignals(data: TrapInput): { trapPoints: number; triggeredSignals: TrapSignal[]; scores: TrapResult['scores'] } {
  let trapPoints = 0;
  const triggeredSignals: TrapSignal[] = [];
  const scores: TrapResult['scores'] = {
    both_sides_score: 0,
    price_freeze_score: 0,
    favorite_shorten_score: 0,
    round_number_score: 0,
    star_boost_score: 0,
    sharp_only_movement_score: 0,
    reverse_line_movement_score: 0,
    multi_book_early_score: 0,
  };

  // ========== ADD TRAP POINTS ==========

  // 1. Both sides moved simultaneously (+25 points)
  if (data.both_sides_moved) {
    const points = 25;
    trapPoints += points;
    scores.both_sides_score = points;
    triggeredSignals.push({
      signal: 'BOTH_SIDES_MOVED',
      points,
      reason: 'Both sides of the market moved simultaneously - classic trap signal where books move both sides to confuse bettors',
      category: 'trap'
    });
  }

  // 2. Price moved ≥10 points but line frozen (+30 points)
  if (data.opening_odds !== undefined && data.current_odds !== undefined) {
    const priceDiff = Math.abs(data.current_odds - data.opening_odds);
    const lineChanged = data.opening_line !== data.current_line && data.opening_line !== undefined && data.current_line !== undefined;
    
    if (priceDiff >= 10 && !lineChanged) {
      const points = 30;
      trapPoints += points;
      scores.price_freeze_score = points;
      triggeredSignals.push({
        signal: 'PRICE_FREEZE_TRAP',
        points,
        reason: `Odds moved ${priceDiff} points but line stayed frozen at ${data.current_line || 'same'} - indicates public pressure without real market movement`,
        category: 'trap'
      });
    }
  }

  // 3. Favorite shortened without sharp indicators (+20 points)
  if (data.opening_odds !== undefined && data.current_odds !== undefined) {
    // For American odds, shorter favorite means more negative
    const favoriteShortened = data.current_odds < data.opening_odds && data.current_odds < -110;
    
    if (favoriteShortened && !data.sharp_indicators) {
      const points = 20;
      trapPoints += points;
      scores.favorite_shorten_score = points;
      triggeredSignals.push({
        signal: 'FAKE_FAVORITE_MOVE',
        points,
        reason: `Favorite price shortened from ${data.opening_odds} to ${data.current_odds} without sharp money confirmation`,
        category: 'trap'
      });
    }
  }

  // 4. Popular overs near round numbers (+15 points)
  if (data.current_line && data.market_type?.toLowerCase().includes('over')) {
    if (isNearRoundNumber(data.current_line)) {
      const points = 15;
      trapPoints += points;
      scores.round_number_score = points;
      triggeredSignals.push({
        signal: 'ROUND_NUMBER_OVER',
        points,
        reason: `Over at ${data.current_line} is a popular round number target - books often inflate these knowing public loves betting overs at round numbers`,
        category: 'trap'
      });
    }
  }

  // 5. Star player prop boosted without market confirmation (+20 points)
  if (data.is_star_player) {
    const hasMarketConfirmation = data.multi_book_alignment && (data.confirming_books || 0) >= 3;
    
    if (!hasMarketConfirmation) {
      const points = 20;
      trapPoints += points;
      scores.star_boost_score = points;
      triggeredSignals.push({
        signal: 'STAR_PLAYER_BOOST',
        points,
        reason: `${data.player_name || 'Star player'} prop boosted without multi-book confirmation - likely narrative-driven trap`,
        category: 'trap'
      });
    }
  }

  // 6. Primetime game with narrative angle (+10 points)
  if (data.is_primetime && data.has_narrative_angle) {
    const points = 10;
    trapPoints += points;
    triggeredSignals.push({
      signal: 'PRIMETIME_NARRATIVE',
      points,
      reason: 'Primetime game with strong narrative angle - books exploit public bias on high-profile matchups',
      category: 'trap'
    });
  }

  // 7. High public bet percentage on one side (+15 points)
  if (data.public_bet_percentage && data.public_bet_percentage >= 70) {
    const points = 15;
    trapPoints += points;
    triggeredSignals.push({
      signal: 'PUBLIC_OVERLOAD',
      points,
      reason: `${data.public_bet_percentage}% of public money on one side - books are rarely on the losing end when public is this lopsided`,
      category: 'trap'
    });
  }

  // ========== SUBTRACT TRAP POINTS (SAFE SIGNALS) ==========

  // 1. Clear sharp-only line movement (-25 points)
  if (data.sharp_indicators && !data.both_sides_moved) {
    const points = -25;
    trapPoints += points;
    scores.sharp_only_movement_score = Math.abs(points);
    triggeredSignals.push({
      signal: 'SHARP_CONFIRMED',
      points,
      reason: 'Line movement driven by sharp action only - professional bettors have identified value',
      category: 'safe'
    });
  }

  // 2. Reverse line movement detected (-20 points)
  if (data.reverse_line_movement) {
    const points = -20;
    trapPoints += points;
    scores.reverse_line_movement_score = Math.abs(points);
    triggeredSignals.push({
      signal: 'RLM_DETECTED',
      points,
      reason: 'Reverse line movement - sharps betting against public, line moving opposite of ticket count',
      category: 'safe'
    });
  }

  // 3. Multi-book alignment early (-15 points)
  if (data.multi_book_alignment && data.is_early_movement) {
    const points = -15;
    trapPoints += points;
    scores.multi_book_early_score = Math.abs(points);
    triggeredSignals.push({
      signal: 'EARLY_CONSENSUS',
      points,
      reason: `${data.confirming_books || 'Multiple'} books aligned early - legitimate market consensus, not trap`,
      category: 'safe'
    });
  }

  // 4. Low public percentage with line movement (-10 points)
  if (data.public_bet_percentage && data.public_bet_percentage <= 35) {
    const lineChanged = data.opening_line !== data.current_line && data.opening_line !== undefined && data.current_line !== undefined;
    if (lineChanged) {
      const points = -10;
      trapPoints += points;
      triggeredSignals.push({
        signal: 'CONTRARIAN_MOVE',
        points,
        reason: 'Line moved despite low public interest - indicates sharp money driving the action',
        category: 'safe'
      });
    }
  }

  return { trapPoints, triggeredSignals, scores };
}

// Calculate final trap probability and recommendation
function calculateTrapProbability(trapPoints: number): { trapProbability: number; riskLabel: 'Low' | 'Medium' | 'High'; recommendation: 'Play' | 'Reduce Line' | 'Avoid' } {
  // Base probability is 50%, adjust by trap points
  // Each point adjusts by ~1%
  const trapProbability = Math.max(0, Math.min(100, 50 + trapPoints));
  
  let riskLabel: 'Low' | 'Medium' | 'High';
  let recommendation: 'Play' | 'Reduce Line' | 'Avoid';
  
  if (trapProbability <= 30) {
    riskLabel = 'Low';
    recommendation = 'Play';
  } else if (trapProbability <= 60) {
    riskLabel = 'Medium';
    recommendation = 'Reduce Line';
  } else {
    riskLabel = 'High';
    recommendation = 'Avoid';
  }
  
  return { trapProbability, riskLabel, recommendation };
}

// Generate human-readable explanation
function generateExplanation(triggeredSignals: TrapSignal[], riskLabel: string, trapProbability: number): string {
  const trapSignals = triggeredSignals.filter(s => s.category === 'trap');
  const safeSignals = triggeredSignals.filter(s => s.category === 'safe');
  
  const parts: string[] = [];
  
  if (trapSignals.length > 0) {
    const trapReasons = trapSignals.slice(0, 3).map(s => s.signal.replace(/_/g, ' ').toLowerCase()).join(', ');
    parts.push(`⚠️ Trap signals detected: ${trapReasons}`);
  }
  
  if (safeSignals.length > 0) {
    const safeReasons = safeSignals.slice(0, 2).map(s => s.signal.replace(/_/g, ' ').toLowerCase()).join(', ');
    parts.push(`✅ Safe signals: ${safeReasons}`);
  }
  
  if (parts.length === 0) {
    return `${trapProbability}% trap probability - No significant signals detected.`;
  }
  
  return `${trapProbability}% trap probability (${riskLabel} Risk). ${parts.join('. ')}.`;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const { legs, single_leg } = body;
    
    // Handle single leg or multiple legs
    const legsToProcess: TrapInput[] = single_leg ? [single_leg] : (legs || []);
    
    if (legsToProcess.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No legs provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing ${legsToProcess.length} legs for trap probability`);
    
    const results: TrapResult[] = [];
    
    for (const leg of legsToProcess) {
      // Calculate trap signals
      const { trapPoints, triggeredSignals, scores } = calculateTrapSignals(leg);
      
      // Calculate final probability and recommendation
      const { trapProbability, riskLabel, recommendation } = calculateTrapProbability(trapPoints);
      
      // Generate explanation
      const explanation = generateExplanation(triggeredSignals, riskLabel, trapProbability);
      
      const result: TrapResult = {
        trap_probability: trapProbability,
        risk_label: riskLabel,
        recommendation,
        explanation,
        triggered_signals: triggeredSignals,
        scores
      };
      
      results.push(result);
      
      // Store in database for tracking
      try {
        await supabase.from('trap_probability_analysis').upsert({
          event_id: leg.event_id,
          outcome_name: leg.outcome_name,
          player_name: leg.player_name,
          market_type: leg.market_type,
          sport: leg.sport,
          opening_odds: leg.opening_odds,
          current_odds: leg.current_odds,
          opening_line: leg.opening_line,
          current_line: leg.current_line,
          line_movement_magnitude: leg.current_line && leg.opening_line ? Math.abs(leg.current_line - leg.opening_line) : null,
          both_sides_moved: leg.both_sides_moved || false,
          price_only_move: leg.price_only_move || false,
          public_bet_percentage: leg.public_bet_percentage,
          is_primetime: leg.is_primetime || false,
          is_star_player: leg.is_star_player || false,
          has_narrative_angle: leg.has_narrative_angle || false,
          both_sides_score: scores.both_sides_score,
          price_freeze_score: scores.price_freeze_score,
          favorite_shorten_score: scores.favorite_shorten_score,
          round_number_score: scores.round_number_score,
          star_boost_score: scores.star_boost_score,
          sharp_only_movement_score: scores.sharp_only_movement_score,
          reverse_line_movement_score: scores.reverse_line_movement_score,
          multi_book_early_score: scores.multi_book_early_score,
          trap_probability: trapProbability,
          risk_label: riskLabel,
          recommendation,
          explanation,
          triggered_signals: triggeredSignals,
          outcome: 'pending',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'event_id,outcome_name'
        });
      } catch (dbError) {
        console.error('Error storing trap analysis:', dbError);
        // Continue processing even if storage fails
      }
    }

    console.log(`Completed trap analysis for ${results.length} legs`);
    
    return new Response(
      JSON.stringify({
        success: true,
        results: single_leg ? results[0] : results,
        summary: {
          total_legs: results.length,
          high_risk: results.filter(r => r.risk_label === 'High').length,
          medium_risk: results.filter(r => r.risk_label === 'Medium').length,
          low_risk: results.filter(r => r.risk_label === 'Low').length,
          avg_trap_probability: Math.round(results.reduce((acc, r) => acc + r.trap_probability, 0) / results.length)
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in trap-probability-engine:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});