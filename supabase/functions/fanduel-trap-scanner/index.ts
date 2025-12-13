import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TrapAnalysis {
  isTrap: boolean;
  trapScore: number;
  signals: string[];
  publicBaitReason: string;
  recommendedSide: string;
  fadePickDescription: string;
  sharpEdgeScore: number;
}

interface MovementData {
  eventId: string;
  sport: string;
  description: string;
  playerName?: string;
  marketType: string;
  outcomeName: string;
  openingPrice: number;
  currentPrice: number;
  priceChange: number;
  pointChange?: number;
  oppositeSideAlsoMoved: boolean;
  commenceTime: string;
  hoursToGame: number;
  bookConsensus: number;
  isPlayerProp: boolean;
}

// Enhanced trap detection with Sharp Engine V2 integration
function detectFanDuelTrap(movement: MovementData): TrapAnalysis {
  const signals: string[] = [];
  let trapScore = 0;
  const reasons: string[] = [];
  let sharpEdgeScore = 0;
  
  const priceChange = movement.priceChange;
  const pointChange = movement.pointChange || 0;
  
  // ========== CORE TRAP SIGNALS (40+ points each) ==========
  
  // 1. REVERSE LINE MOVEMENT (RLM) - Most reliable trap indicator
  if (Math.abs(priceChange) >= 10 && Math.abs(pointChange) < 0.5) {
    trapScore += 35;
    sharpEdgeScore += 25;
    signals.push('RLM');
    reasons.push('Reverse Line Movement: Price moved without line change - classic sharp vs public pattern');
  }
  
  // 2. Both sides moved equally = Market balancing, not sharp
  if (movement.oppositeSideAlsoMoved) {
    trapScore += 25;
    signals.push('BOTH_SIDES_MOVED');
    reasons.push('Both sides moved equally - sportsbook balancing exposure, not sharp action');
  }
  
  // 3. Steam move detection (sudden 15+ point shift)
  if (Math.abs(priceChange) >= 15) {
    if (movement.bookConsensus >= 3) {
      // Multi-book consensus = likely sharp
      sharpEdgeScore += 30;
      signals.push('STEAM_MOVE');
      reasons.push(`Steam move: ${Math.abs(priceChange)} point shift across ${movement.bookConsensus} books`);
    } else {
      // Single book move = likely trap
      trapScore += 20;
      signals.push('SINGLE_BOOK_MOVE');
      reasons.push('Large single-book movement - possible trap setup');
    }
  }
  
  // ========== TIMING-BASED SIGNALS ==========
  
  // 4. Early morning trap setup (8+ hours before game)
  if (movement.hoursToGame > 8) {
    trapScore += 15;
    signals.push('EARLY_SETUP');
    reasons.push('Early movement suggests trap setup for public action');
  }
  
  // 5. Late money sweet spot (1-3 hours before game)
  if (movement.hoursToGame >= 1 && movement.hoursToGame <= 3) {
    sharpEdgeScore += 10;
    signals.push('LATE_MONEY_WINDOW');
    reasons.push('Movement in late money window - higher sharp probability');
  }
  
  // ========== FAVORITE/UNDERDOG PATTERNS ==========
  
  // 6. Heavy favorite getting shorter (public piling on)
  if (movement.currentPrice < -200 && priceChange < -5) {
    trapScore += 25;
    signals.push('HEAVY_FAV_TRAP');
    reasons.push(`Heavy favorite shortened from ${movement.openingPrice} to ${movement.currentPrice} - public overload`);
  }
  
  // 7. Heavy favorite getting longer (smart money on underdog)
  if (movement.openingPrice < -200 && priceChange > 10) {
    sharpEdgeScore += 20;
    signals.push('SMART_DOG');
    reasons.push('Heavy favorite lengthening - sharp money on underdog');
  }
  
  // ========== PLAYER PROP SPECIFIC SIGNALS ==========
  
  if (movement.isPlayerProp) {
    // 8. Prop juice differential shift
    if (Math.abs(priceChange) >= 8) {
      trapScore += 15;
      signals.push('PROP_JUICE_SHIFT');
      reasons.push('Significant player prop juice shift');
    }
    
    // 9. Line moved with juice = likely sharp
    if (Math.abs(pointChange) >= 0.5 && Math.abs(priceChange) >= 5) {
      sharpEdgeScore += 15;
      signals.push('PROP_LINE_MOVE');
      reasons.push('Player prop line + juice both moved - higher confidence');
    }
  }
  
  // ========== EXTREME JUICE PATTERNS ==========
  
  // 10. Extreme juice differential (one side -130 or worse)
  if (movement.currentPrice <= -130 || movement.currentPrice >= 115) {
    trapScore += 10;
    signals.push('EXTREME_JUICE');
    reasons.push('Extreme juice differential detected');
  }
  
  // ========== CALCULATE FINAL SCORES ==========
  
  // Movement weight based on size
  const movementWeight = Math.min(Math.abs(priceChange) / 10, 3);
  
  // Time weight (movements closer to game time are more meaningful)
  const timeWeight = movement.hoursToGame <= 3 ? 1.5 : movement.hoursToGame <= 8 ? 1.2 : 1.0;
  
  trapScore = Math.round(trapScore * timeWeight);
  sharpEdgeScore = Math.round(sharpEdgeScore * movementWeight * timeWeight);
  
  const isTrap = trapScore >= 40;
  
  // Generate fade pick description
  let fadePickDescription = '';
  if (isTrap) {
    if (priceChange < 0) {
      fadePickDescription = `FADE: ${movement.outcomeName} shortened to ${movement.currentPrice} - take opposite side`;
    } else {
      fadePickDescription = `VALUE: ${movement.outcomeName} lengthened to +${movement.currentPrice} - possible sharp move`;
    }
  }
  
  return {
    isTrap,
    trapScore: Math.min(trapScore, 100),
    signals,
    publicBaitReason: reasons.join('; '),
    recommendedSide: isTrap ? 'fade' : sharpEdgeScore >= 30 ? 'pick' : 'caution',
    fadePickDescription,
    sharpEdgeScore: Math.min(sharpEdgeScore, 100)
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY'); // FIXED: Correct env variable name
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('🎯 FanDuel Trap Scanner V2 starting...');
    
    // Validate API key
    if (!oddsApiKey) {
      console.error('❌ THE_ODDS_API_KEY is not configured!');
      return new Response(JSON.stringify({ 
        error: 'Odds API key not configured',
        hint: 'Please set THE_ODDS_API_KEY in your Supabase secrets'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    // Get current scan round for today
    const { data: existingScans } = await supabase
      .from('fanduel_trap_analysis')
      .select('scan_round')
      .eq('scan_date', today)
      .order('scan_round', { ascending: false })
      .limit(1);
    
    const currentRound = (existingScans?.[0]?.scan_round || 0) + 1;
    console.log(`📊 Scan round ${currentRound} for ${today}`);
    
    // Sports to scan - including player props markets
    const sports = [
      'basketball_nba',
      'basketball_ncaab',
      'americanfootball_nfl',
      'americanfootball_ncaaf',
      'icehockey_nhl'
    ];
    
    // Markets to scan - added player props
    const marketTypes = [
      'h2h,spreads,totals',
      'player_points,player_rebounds,player_assists,player_threes'
    ];
    
    const allTrapAnalysis: any[] = [];
    let totalMovements = 0;
    let trapPatterns = 0;
    let apiCallsUsed = 0;
    
    for (const sport of sports) {
      for (const markets of marketTypes) {
        try {
          const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${oddsApiKey}&regions=us&markets=${markets}&bookmakers=fanduel`;
          
          console.log(`🔍 Fetching ${sport} (${markets.split(',')[0]}...) from FanDuel...`);
          const oddsResponse = await fetch(oddsUrl);
          apiCallsUsed++;
          
          if (!oddsResponse.ok) {
            const errorText = await oddsResponse.text();
            console.log(`⚠️ Failed to fetch ${sport}: ${oddsResponse.status} - ${errorText}`);
            continue;
          }
          
          const events = await oddsResponse.json();
          
          // Log remaining API quota
          const remaining = oddsResponse.headers.get('x-requests-remaining');
          console.log(`📈 Found ${events.length} events for ${sport}, API calls remaining: ${remaining}`);
          
          for (const event of events) {
            const commenceTime = new Date(event.commence_time);
            const hoursToGame = (commenceTime.getTime() - Date.now()) / (1000 * 60 * 60);
            
            // Skip games that already started or are too far out (7+ days)
            if (hoursToGame < 0 || hoursToGame > 168) continue;
            
            const fanduelBookmaker = event.bookmakers?.find((b: any) => b.key === 'fanduel');
            if (!fanduelBookmaker) continue;
            
            // Count book consensus
            const bookConsensus = event.bookmakers?.length || 1;
            
            for (const market of fanduelBookmaker.markets || []) {
              const isPlayerProp = market.key.startsWith('player_');
              
              for (const outcome of market.outcomes || []) {
                totalMovements++;
                
                // Get existing record for this outcome
                const { data: existing } = await supabase
                  .from('fanduel_trap_analysis')
                  .select('*')
                  .eq('scan_date', today)
                  .eq('event_id', event.id)
                  .eq('outcome_name', outcome.name)
                  .eq('market_type', market.key)
                  .maybeSingle();
                
                const currentPrice = outcome.price;
                const openingPrice = existing?.opening_price || currentPrice;
                const priceChange = currentPrice - openingPrice;
                
                // Check if opposite side also moved
                const oppositeSide = market.outcomes.find((o: any) => o.name !== outcome.name);
                let oppositeSideAlsoMoved = false;
                
                if (existing && oppositeSide) {
                  const oppositeChange = Math.abs((oppositeSide.price || 0) - (existing.current_price || 0));
                  oppositeSideAlsoMoved = oppositeChange >= 5;
                }
                
                const movementData: MovementData = {
                  eventId: event.id,
                  sport: sport,
                  description: `${event.away_team} @ ${event.home_team}`,
                  playerName: outcome.description || undefined,
                  marketType: market.key,
                  outcomeName: outcome.name,
                  openingPrice,
                  currentPrice,
                  priceChange,
                  pointChange: outcome.point !== undefined && existing?.hourly_movements?.[0]?.point 
                    ? outcome.point - existing.hourly_movements[0].point 
                    : 0,
                  oppositeSideAlsoMoved,
                  commenceTime: event.commence_time,
                  hoursToGame,
                  bookConsensus,
                  isPlayerProp
                };
                
                // Analyze for traps with enhanced algorithm
                const trapAnalysis = detectFanDuelTrap(movementData);
                
                if (trapAnalysis.trapScore > 0) {
                  trapPatterns++;
                }
                
                // Build hourly movement entry
                const hourlyEntry = {
                  time: new Date().toISOString(),
                  price: currentPrice,
                  point: outcome.point,
                  change: priceChange,
                  round: currentRound
                };
                
                const hourlyMovements = existing?.hourly_movements || [];
                hourlyMovements.push(hourlyEntry);
                
                // Calculate odds for fade (opposite side)
                let oddsForFade = currentPrice;
                if (oppositeSide) {
                  oddsForFade = oppositeSide.price;
                }
                
                const trapRecord = {
                  scan_round: currentRound,
                  scan_date: today,
                  event_id: event.id,
                  sport: sport,
                  description: movementData.description,
                  player_name: movementData.playerName,
                  market_type: market.key,
                  outcome_name: outcome.name,
                  opening_price: openingPrice,
                  current_price: currentPrice,
                  total_movement: Math.abs(priceChange),
                  movement_direction: priceChange < 0 ? 'shortened' : priceChange > 0 ? 'lengthened' : 'stable',
                  trap_score: trapAnalysis.trapScore,
                  is_public_bait: trapAnalysis.isTrap,
                  public_bait_reason: trapAnalysis.publicBaitReason,
                  opposite_side_also_moved: oppositeSideAlsoMoved,
                  price_only_move: trapAnalysis.signals.includes('RLM'),
                  hourly_movements: hourlyMovements,
                  movement_count: hourlyMovements.length,
                  recommended_side: trapAnalysis.recommendedSide,
                  fade_the_public_pick: trapAnalysis.fadePickDescription,
                  confidence_score: Math.min(trapAnalysis.trapScore / 100, 1),
                  odds_for_fade: oddsForFade,
                  commence_time: event.commence_time,
                  scanned_at: new Date().toISOString(),
                  signals_detected: trapAnalysis.signals,
                  outcome: 'pending'
                };
                
                allTrapAnalysis.push(trapRecord);
              }
            }
          }
        } catch (sportError) {
          console.error(`Error processing ${sport} ${markets}:`, sportError);
        }
      }
    }
    
    // Upsert all trap analysis records
    if (allTrapAnalysis.length > 0) {
      const { error: upsertError } = await supabase
        .from('fanduel_trap_analysis')
        .upsert(allTrapAnalysis, {
          onConflict: 'scan_date,event_id,outcome_name,market_type'
        });
      
      if (upsertError) {
        console.error('Error upserting trap analysis:', upsertError);
      }
    }
    
    // Update or create daily parlay progress
    const { data: dailyParlay } = await supabase
      .from('fanduel_daily_parlay')
      .select('*')
      .eq('parlay_date', today)
      .maybeSingle();
    
    const parlayUpdate = {
      parlay_date: today,
      scans_completed: currentRound,
      total_movements_analyzed: totalMovements,
      trap_patterns_found: trapPatterns,
      updated_at: new Date().toISOString()
    };
    
    if (dailyParlay) {
      await supabase
        .from('fanduel_daily_parlay')
        .update(parlayUpdate)
        .eq('parlay_date', today);
    } else {
      await supabase
        .from('fanduel_daily_parlay')
        .insert({
          ...parlayUpdate,
          legs: [],
          total_odds: 0
        });
    }
    
    // Log to cron history
    await supabase.from('cron_job_history').insert({
      job_name: 'fanduel-trap-scanner',
      status: 'completed',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      result: {
        scanRound: currentRound,
        totalMovements,
        trapPatternsFound: trapPatterns,
        recordsUpserted: allTrapAnalysis.length,
        apiCallsUsed
      }
    });
    
    console.log(`✅ Scan complete! Round ${currentRound}, ${totalMovements} movements, ${trapPatterns} traps found`);
    
    return new Response(JSON.stringify({
      success: true,
      scanRound: currentRound,
      totalMovements,
      trapPatternsFound: trapPatterns,
      recordsUpserted: allTrapAnalysis.length,
      apiCallsUsed
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('FanDuel Trap Scanner error:', error);
    return new Response(JSON.stringify({ 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
