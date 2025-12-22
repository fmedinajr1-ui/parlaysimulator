import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MarketSignalInput {
  event_id: string;
  outcome_name: string;
  player_name?: string;
  market_type?: string;
  sport?: string;
  opening_price?: number;
  opening_point?: number;
  current_price?: number;
  current_point?: number;
  hours_to_game?: number;
  confirming_books?: number;
  public_side?: string;
  line_direction?: string;
}

interface MarketSignalResult {
  line_move_score: number;
  juice_move_score: number;
  timing_sharpness_score: number;
  multi_book_consensus_score: number;
  public_fade_score: number;
  market_score: number;
  signal_label: 'sharp_aligned' | 'neutral' | 'trap_risk';
  rationale: string;
}

// Line Move Score (35% weight) - Scale magnitude into 0-100
function calculateLineMoveScore(openingPoint: number | null, currentPoint: number | null): number {
  if (!openingPoint || !currentPoint) return 50;
  
  const pointChange = Math.abs(currentPoint - openingPoint);
  
  if (pointChange >= 2.0) return 100;
  if (pointChange >= 1.5) return 85;
  if (pointChange >= 1.0) return 70;
  if (pointChange >= 0.5) return 55;
  if (pointChange >= 0.25) return 40;
  return 25;
}

// Juice Move Score (20% weight) - Price without line move = public pressure
function calculateJuiceMoveScore(
  openingPrice: number | null, 
  currentPrice: number | null, 
  lineChanged: boolean
): number {
  if (!openingPrice || !currentPrice) return 50;
  
  const priceDiff = Math.abs(currentPrice - openingPrice);
  
  // Large price move without line change = likely public pressure (bad signal)
  if (!lineChanged && priceDiff >= 20) return 25; // Penalty
  if (!lineChanged && priceDiff >= 15) return 35;
  if (!lineChanged && priceDiff >= 10) return 45;
  
  // Line + juice move together = sharp confirmation
  if (lineChanged && priceDiff >= 15) return 90;
  if (lineChanged && priceDiff >= 10) return 80;
  if (lineChanged && priceDiff >= 5) return 70;
  
  return 55; // Neutral
}

// Timing Sharpness (15% weight) - Early moves (12-24h) > last minute
function calculateTimingScore(hoursToGame: number | null): number {
  if (!hoursToGame || hoursToGame <= 0) return 50;
  
  // Sweet spot is 12-24 hours before game
  if (hoursToGame >= 12 && hoursToGame <= 24) return 100;
  if (hoursToGame >= 8 && hoursToGame < 12) return 85;
  if (hoursToGame >= 4 && hoursToGame < 8) return 75;
  if (hoursToGame >= 1 && hoursToGame < 4) return 65; // Late sharp money
  if (hoursToGame < 1) return 45; // Steam/panic moves
  if (hoursToGame > 24 && hoursToGame <= 48) return 70;
  
  return 50; // Very early setup
}

// Multi-Book Consensus (15% weight)
function calculateConsensusScore(confirmingBooks: number | null): number {
  if (!confirmingBooks) return 40;
  
  if (confirmingBooks >= 5) return 100;
  if (confirmingBooks >= 4) return 85;
  if (confirmingBooks >= 3) return 70;
  if (confirmingBooks >= 2) return 55;
  return 30; // Single book divergence - suspicious
}

// Public Fade Score (15% weight) - Line moves against public
function calculatePublicFadeScore(publicSide: string | null, lineDirection: string | null): number {
  if (!publicSide || !lineDirection) return 50; // No data
  
  // Line moving against public = sharp signal
  if (lineDirection !== publicSide) return 95;
  
  // Line moving with public = trap risk
  if (lineDirection === publicSide) return 25;
  
  return 50;
}

// Generate one-sentence rationale
function generateRationale(
  scores: MarketSignalResult,
  data: MarketSignalInput
): string {
  const reasons: string[] = [];
  
  // Line movement
  if (data.opening_point && data.current_point) {
    const pointChange = Math.abs(data.current_point - data.opening_point);
    const direction = data.current_point > data.opening_point ? 'up' : 'down';
    if (pointChange >= 0.5) {
      reasons.push(`Line moved ${pointChange.toFixed(1)} pts ${direction}`);
    }
  }
  
  // Book consensus
  if (data.confirming_books && data.confirming_books >= 3) {
    reasons.push(`across ${data.confirming_books} books`);
  }
  
  // Timing
  if (scores.timing_sharpness_score >= 80 && data.hours_to_game) {
    reasons.push(`early in cycle (${Math.round(data.hours_to_game)}h out)`);
  }
  
  // Juice analysis
  if (data.opening_price && data.current_price) {
    const priceChange = Math.abs(data.current_price - data.opening_price);
    const lineChanged = data.opening_point !== data.current_point;
    
    if (!lineChanged && priceChange >= 10) {
      reasons.push(`price drift of ${priceChange}¢ without line adjustment suggests public pressure`);
    } else if (lineChanged && priceChange >= 10) {
      reasons.push(`juice drift confirms sharp buying`);
    }
  }
  
  // Public fade
  if (scores.public_fade_score >= 80) {
    reasons.push(`line moving against public`);
  } else if (scores.public_fade_score <= 30) {
    reasons.push(`line moving with public (trap risk)`);
  }
  
  // Construct final rationale
  if (reasons.length === 0) {
    if (scores.market_score >= 70) {
      return 'Strong market signals indicate sharp action';
    } else if (scores.market_score < 40) {
      return 'Market signals suggest potential trap - proceed with caution';
    }
    return 'Neutral market activity with no clear directional signal';
  }
  
  return reasons.join('; ') + '.';
}

// Calculate weighted market score
function calculateMarketScore(
  lineMoveScore: number,
  juiceMoveScore: number,
  timingScore: number,
  consensusScore: number,
  publicFadeScore: number,
  weights?: Record<string, number>
): number {
  const w = weights || {
    line_move: 0.35,
    juice_move: 0.20,
    timing_sharpness: 0.15,
    multi_book_consensus: 0.15,
    public_fade: 0.15,
  };
  
  return Math.round(
    (lineMoveScore * w.line_move) +
    (juiceMoveScore * w.juice_move) +
    (timingScore * w.timing_sharpness) +
    (consensusScore * w.multi_book_consensus) +
    (publicFadeScore * w.public_fade)
  );
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    console.log('Received request:', JSON.stringify(body));

    // Handle action-based requests from Smart Analyze
    if (body.action === 'scan') {
      console.log('Scanning for market signals...');
      
      // Fetch recent market signals
      const { data: signals, error: fetchError } = await supabase
        .from('market_signals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (fetchError) {
        console.error('Error fetching signals:', fetchError);
      }
      
      const hasSignals = signals && signals.length > 0;
      
      return new Response(JSON.stringify({
        success: true,
        action: 'scan',
        signals: signals || [],
        summary: hasSignals 
          ? `Found ${signals.length} active market signals`
          : 'No active market signals - markets are stable',
        market_health: hasSignals ? 'active' : 'quiet',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Handle direct signal calculation
    const inputs: MarketSignalInput[] = Array.isArray(body) ? body : [body];
    
    console.log(`Processing ${inputs.length} market signal requests`);
    
    // Fetch current weights from database
    const { data: weightsData } = await supabase
      .from('market_signal_weights')
      .select('weight_key, weight_value');
    
    const weights: Record<string, number> = {};
    if (weightsData) {
      for (const w of weightsData) {
        weights[w.weight_key] = w.weight_value;
      }
    }
    
    const results: MarketSignalResult[] = [];
    const dbInserts: any[] = [];
    
    for (const input of inputs) {
      // Calculate individual scores
      const lineChanged = input.opening_point !== input.current_point;
      
      const lineMoveScore = calculateLineMoveScore(
        input.opening_point ?? null, 
        input.current_point ?? null
      );
      
      const juiceMoveScore = calculateJuiceMoveScore(
        input.opening_price ?? null,
        input.current_price ?? null,
        lineChanged
      );
      
      const timingScore = calculateTimingScore(input.hours_to_game ?? null);
      
      const consensusScore = calculateConsensusScore(input.confirming_books ?? null);
      
      const publicFadeScore = calculatePublicFadeScore(
        input.public_side ?? null,
        input.line_direction ?? null
      );
      
      // Calculate final market score
      const marketScore = calculateMarketScore(
        lineMoveScore,
        juiceMoveScore,
        timingScore,
        consensusScore,
        publicFadeScore,
        Object.keys(weights).length > 0 ? weights : undefined
      );
      
      // Determine signal label
      const signalLabel: 'sharp_aligned' | 'neutral' | 'trap_risk' = 
        marketScore >= 70 ? 'sharp_aligned' :
        marketScore >= 40 ? 'neutral' :
        'trap_risk';
      
      const result: MarketSignalResult = {
        line_move_score: lineMoveScore,
        juice_move_score: juiceMoveScore,
        timing_sharpness_score: timingScore,
        multi_book_consensus_score: consensusScore,
        public_fade_score: publicFadeScore,
        market_score: marketScore,
        signal_label: signalLabel,
        rationale: '',
      };
      
      // Generate rationale
      result.rationale = generateRationale(result, input);
      
      results.push(result);
      
      // Prepare DB insert
      dbInserts.push({
        event_id: input.event_id,
        outcome_name: input.outcome_name,
        player_name: input.player_name,
        market_type: input.market_type,
        sport: input.sport,
        opening_price: input.opening_price,
        opening_point: input.opening_point,
        current_price: input.current_price,
        current_point: input.current_point,
        hours_to_game: input.hours_to_game,
        confirming_books: input.confirming_books,
        ...result,
      });
    }
    
    // Upsert to database
    if (dbInserts.length > 0) {
      const { error: insertError } = await supabase
        .from('market_signals')
        .upsert(dbInserts, {
          onConflict: 'event_id,outcome_name,player_name',
          ignoreDuplicates: false,
        });
      
      if (insertError) {
        console.error('Error inserting market signals:', insertError);
      } else {
        console.log(`Successfully stored ${dbInserts.length} market signals`);
      }
    }
    
    return new Response(JSON.stringify({
      success: true,
      signals: results.length === 1 ? results[0] : results,
      count: results.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Market signal engine error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
