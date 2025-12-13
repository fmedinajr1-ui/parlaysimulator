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
}

function detectFanDuelTrap(movement: MovementData): TrapAnalysis {
  const signals: string[] = [];
  let trapScore = 0;
  const reasons: string[] = [];
  
  const priceChange = movement.priceChange;
  const pointChange = movement.pointChange || 0;
  
  // 1. Price moved without line change = TRAP (30 points)
  if (Math.abs(priceChange) >= 10 && Math.abs(pointChange) < 0.5) {
    trapScore += 30;
    signals.push('PRICE_ONLY_MOVE');
    reasons.push('Price moved without line change - likely public money trap');
  }
  
  // 2. Both sides moved = Not sharp, market adjustment (25 points)
  if (movement.oppositeSideAlsoMoved) {
    trapScore += 25;
    signals.push('BOTH_SIDES_MOVED');
    reasons.push('Both sides moved equally - market balancing, not sharp action');
  }
  
  // 3. Heavy favorite shortening = Public piling on (20 points)
  if (movement.currentPrice < -200 && priceChange < -5) {
    trapScore += 20;
    signals.push('HEAVY_FAVORITE_TRAP');
    reasons.push('Heavy favorite getting shorter - public overloading');
  }
  
  // 4. Early morning move = Setup trap (15 points)
  if (movement.hoursToGame > 8) {
    trapScore += 15;
    signals.push('EARLY_SETUP');
    reasons.push('Early movement suggests trap setup');
  }
  
  // 5. Large single-direction move (15 points)
  if (Math.abs(priceChange) >= 15) {
    trapScore += 15;
    signals.push('LARGE_MOVE');
    reasons.push(`Large ${priceChange > 0 ? 'lengthening' : 'shortening'} of ${Math.abs(priceChange)} points`);
  }
  
  // 6. Props with extreme juice adjustment (10 points)
  if (movement.marketType.includes('player') && Math.abs(priceChange) >= 8) {
    trapScore += 10;
    signals.push('PROP_JUICE_SHIFT');
    reasons.push('Player prop with significant juice shift');
  }
  
  const isTrap = trapScore >= 40;
  
  // Generate fade pick
  let fadePickDescription = '';
  if (isTrap) {
    if (priceChange < 0) {
      // Price shortened (more favored), fade by taking opposite
      fadePickDescription = `FADE: ${movement.outcomeName} shortened to ${movement.currentPrice} - take opposite side`;
    } else {
      // Price lengthened, the public isn't on this, might be value
      fadePickDescription = `VALUE: ${movement.outcomeName} lengthened to ${movement.currentPrice} - possible sharp move`;
    }
  }
  
  return {
    isTrap,
    trapScore,
    signals,
    publicBaitReason: reasons.join('; '),
    recommendedSide: isTrap ? 'fade' : 'caution',
    fadePickDescription
  };
}

function americanToDecimal(odds: number): number {
  if (odds > 0) {
    return (odds / 100) + 1;
  }
  return (100 / Math.abs(odds)) + 1;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('ODDS_API_KEY');
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    console.log('🎯 FanDuel Trap Scanner starting...');
    
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
    
    // Sports to scan
    const sports = [
      'basketball_nba',
      'basketball_ncaab',
      'americanfootball_nfl',
      'americanfootball_ncaaf',
      'icehockey_nhl'
    ];
    
    const allTrapAnalysis: any[] = [];
    let totalMovements = 0;
    let trapPatterns = 0;
    
    for (const sport of sports) {
      try {
        // Fetch FanDuel odds specifically
        const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/odds/?apiKey=${oddsApiKey}&regions=us&markets=h2h,spreads,totals&bookmakers=fanduel`;
        
        console.log(`🔍 Fetching ${sport} from FanDuel...`);
        const oddsResponse = await fetch(oddsUrl);
        
        if (!oddsResponse.ok) {
          console.log(`⚠️ Failed to fetch ${sport}: ${oddsResponse.status}`);
          continue;
        }
        
        const events = await oddsResponse.json();
        console.log(`📈 Found ${events.length} events for ${sport}`);
        
        for (const event of events) {
          const commenceTime = new Date(event.commence_time);
          const hoursToGame = (commenceTime.getTime() - Date.now()) / (1000 * 60 * 60);
          
          // Skip games that already started
          if (hoursToGame < 0) continue;
          
          const fanduelBookmaker = event.bookmakers?.find((b: any) => b.key === 'fanduel');
          if (!fanduelBookmaker) continue;
          
          for (const market of fanduelBookmaker.markets || []) {
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
                .single();
              
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
                hoursToGame
              };
              
              // Analyze for traps
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
                price_only_move: trapAnalysis.signals.includes('PRICE_ONLY_MOVE'),
                hourly_movements: hourlyMovements,
                movement_count: hourlyMovements.length,
                recommended_side: trapAnalysis.recommendedSide,
                fade_the_public_pick: trapAnalysis.fadePickDescription,
                confidence_score: Math.min(trapAnalysis.trapScore / 100, 1),
                odds_for_fade: oddsForFade,
                commence_time: event.commence_time,
                scanned_at: new Date().toISOString()
              };
              
              allTrapAnalysis.push(trapRecord);
            }
          }
        }
      } catch (sportError) {
        console.error(`Error processing ${sport}:`, sportError);
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
      .single();
    
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
    
    console.log(`✅ Scan complete! Round ${currentRound}, ${totalMovements} movements, ${trapPatterns} traps found`);
    
    return new Response(JSON.stringify({
      success: true,
      scanRound: currentRound,
      totalMovements,
      trapPatternsFound: trapPatterns,
      recordsUpserted: allTrapAnalysis.length
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
