import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
  description?: string; // Player name for player props
}

interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

interface Bookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}

interface OddsEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
}

interface LineMovement {
  event_id: string;
  sport: string;
  description: string;
  bookmaker: string;
  market_type: string;
  outcome_name: string;
  old_price: number;
  new_price: number;
  old_point?: number;
  new_point?: number;
  price_change: number;
  point_change?: number;
  is_sharp_action: boolean;
  sharp_indicator?: string;
  commence_time?: string;
  player_name?: string;
  // Classification fields
  movement_authenticity?: 'real' | 'fake' | 'uncertain';
  authenticity_confidence?: number;
  recommendation?: 'pick' | 'fade' | 'caution';
  recommendation_reason?: string;
  opposite_side_moved?: boolean;
  books_consensus?: number;
  // Final pick fields
  final_pick?: string;
  is_primary_record?: boolean;
}

interface SharpAnalysis {
  authenticity: 'real' | 'fake' | 'uncertain';
  confidence: number;
  recommendation: 'pick' | 'fade' | 'caution';
  reason: string;
  signals: string[];
  oppositeSideMoved: boolean;
  booksConsensus: number;
}

const SPORT_KEYS: Record<string, string> = {
  'NBA': 'basketball_nba',
  'NFL': 'americanfootball_nfl',
  'NCAAF': 'americanfootball_ncaaf',
  'NCAAB': 'basketball_ncaab',
  'NHL': 'icehockey_nhl',
  'MLB': 'baseball_mlb',
};

// Player prop markets to track
const PLAYER_PROP_MARKETS = [
  'player_points',
  'player_rebounds',
  'player_assists',
  'player_threes',
  'player_points_rebounds_assists'
];

// Map market keys to readable labels
const MARKET_LABELS: Record<string, string> = {
  'player_points': 'PTS',
  'player_rebounds': 'REB',
  'player_assists': 'AST',
  'player_threes': '3PM',
  'player_points_rebounds_assists': 'PRA',
  'spreads': 'Spread',
  'h2h': 'ML',
  'totals': 'Total'
};

// AI BETTING KNOWLEDGE RULES
// Sharp signals to FOLLOW, Trap signals to FADE
const AI_BETTING_RULES = {
  // SHARP SIGNALS - Follow these
  sharp: {
    LINE_AND_JUICE_MOVED: { weight: 3, description: 'Line + juice moved together = confirmed action' },
    LATE_MONEY_SWEET_SPOT: { weight: 3, minHours: 1, maxHours: 3, description: 'Late moves 1-3 hours pregame' },
    INJURY_UNDER: { weight: 2, description: 'Unders with injury signals' },
    MULTI_BOOK_CONSENSUS: { weight: 2, description: 'Multiple books moved same direction' },
  },
  // TRAP SIGNALS - Fade these
  trap: {
    EARLY_MORNING_OVER: { weight: -3, description: 'Fade early morning overs' },
    PRICE_ONLY_MOVE: { weight: -3, description: 'Price moved but line stayed = trap' },
    FAKE_SHARP_TAG: { weight: -2, description: 'Sharp action label with no line move' },
    STEAM_MOVE_NO_CONSENSUS: { weight: -2, description: 'Big move on single book only' },
  },
};

// Analyze sharp movement to determine if it's real or fake
function analyzeSharpMovement(
  movement: LineMovement,
  allRecentMovements: LineMovement[],
  hoursToGame: number
): SharpAnalysis {
  const signals: string[] = [];
  let realScore = 0;
  let fakeScore = 0;
  
  // Check if opposite side also moved (both sides = market adjustment)
  const oppositeMoved = allRecentMovements.find(m => 
    m.event_id === movement.event_id && 
    m.market_type === movement.market_type &&
    m.outcome_name !== movement.outcome_name &&
    m.bookmaker === movement.bookmaker &&
    Math.abs(m.price_change) >= 5
  );
  
  if (oppositeMoved) {
    fakeScore += 3;
    signals.push('BOTH_SIDES_MOVED');
  } else {
    realScore += 2;
    signals.push('SINGLE_SIDE_MOVEMENT');
  }
  
  // Check if multiple books moved same direction
  const sameDirectionBooks = allRecentMovements.filter(m =>
    m.event_id === movement.event_id &&
    m.outcome_name === movement.outcome_name &&
    m.bookmaker !== movement.bookmaker &&
    Math.sign(m.price_change) === Math.sign(movement.price_change)
  );
  
  const booksConsensus = sameDirectionBooks.length + 1;
  
  if (booksConsensus >= 2) {
    realScore += 3;
    signals.push('MULTI_BOOK_CONSENSUS');
  } else if (booksConsensus === 1) {
    // Only one book moved - could be a trap
    fakeScore += 1;
    signals.push('SINGLE_BOOK_DIVERGENCE');
  }
  
  // ❌ TRAP: Price moved but line stayed = FAKE SHARP (most important fix!)
  if (Math.abs(movement.price_change) >= 8 && 
      (!movement.point_change || Math.abs(movement.point_change) < 0.5)) {
    fakeScore += 3;  // This is a TRAP - price only = fake
    signals.push('PRICE_ONLY_MOVE_TRAP');
  }
  
  // ✅ SHARP: Line AND juice moved together on SINGLE side = confirmed real action
  if (movement.point_change && Math.abs(movement.point_change) >= 0.5 &&
      Math.abs(movement.price_change) >= 5 && !oppositeMoved) {
    realScore += 3;
    signals.push('LINE_AND_JUICE_CONFIRMED');
  }
  
  // Line AND price moved together on BOTH sides = market adjustment
  if (movement.point_change && Math.abs(movement.point_change) >= 0.5 &&
      Math.abs(movement.price_change) >= 5 && oppositeMoved) {
    fakeScore += 2;
    signals.push('MARKET_ADJUSTMENT');
  }
  
  // ✅ SHARP: Late money 1-3 hours pregame = SWEET SPOT (highest confidence)
  if (hoursToGame >= 1 && hoursToGame <= 3) {
    realScore += 3;
    signals.push('LATE_MONEY_SWEET_SPOT');
  } else if (hoursToGame < 1) {
    // Very late money - still good but less time to react
    realScore += 1;
    signals.push('VERY_LATE_MONEY');
  } else if (hoursToGame >= 8) {
    // ❌ TRAP: Early morning moves are often public traps
    fakeScore += 2;
    signals.push('EARLY_MORNING_MOVE');
  } else if (hoursToGame >= 4) {
    // Medium timing - neutral
    signals.push('MODERATE_TIMING');
  }
  
  // Steam move analysis (very large movement) - only counts if multi-book
  if (Math.abs(movement.price_change) >= 15) {
    if (booksConsensus >= 2) {
      realScore += 2;
      signals.push('STEAM_MOVE_CONFIRMED');
    } else {
      // ❌ TRAP: Big move on single book = could be trap
      fakeScore += 2;
      signals.push('STEAM_MOVE_NO_CONSENSUS');
    }
  }
  
  // Player props tend to be sharper (books have less data)
  if (movement.player_name) {
    realScore += 1;
    signals.push('PLAYER_PROP');
  }
  
  // ❌ TRAP: Heavy favorite shortening even more = public overreaction
  if (movement.new_price < -200 && movement.price_change < -5) {
    fakeScore += 2;
    signals.push('HEAVY_FAVORITE_SHORTENING');
  }
  
  // Calculate final verdict
  const totalScore = Math.max(realScore + fakeScore, 1);
  const realConfidence = realScore / totalScore;
  
  let authenticity: 'real' | 'fake' | 'uncertain';
  let recommendation: 'pick' | 'fade' | 'caution';
  let reason: string;
  
  if (realScore >= fakeScore + 2) {
    authenticity = 'real';
    recommendation = 'pick';
    const keySignals = signals.filter(s => 
      ['MULTI_BOOK_CONSENSUS', 'SINGLE_SIDE_MOVEMENT', 'LATE_MONEY', 'PRICE_WITHOUT_LINE_CHANGE', 'STEAM_MOVE'].includes(s)
    );
    reason = `Strong professional action. ${keySignals.join(', ').replace(/_/g, ' ')}`;
  } else if (fakeScore >= realScore + 2) {
    authenticity = 'fake';
    recommendation = 'fade';
    const keySignals = signals.filter(s => 
      ['BOTH_SIDES_MOVED', 'EARLY_MOVEMENT', 'SINGLE_BOOK_DIVERGENCE', 'HEAVY_FAVORITE_SHORTENING'].includes(s)
    );
    reason = `Likely market adjustment or trap. ${keySignals.join(', ').replace(/_/g, ' ')}`;
  } else {
    authenticity = 'uncertain';
    recommendation = 'caution';
    reason = `Mixed signals - proceed with caution. ${signals.slice(0, 2).join(', ').replace(/_/g, ' ')}`;
  }
  
  return { 
    authenticity, 
    confidence: Math.round(realConfidence * 100) / 100, 
    recommendation, 
    reason, 
    signals,
    oppositeSideMoved: !!oppositeMoved,
    booksConsensus
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sports, action, includePlayerProps } = await req.json() as {
      sports?: string[];
      action?: 'fetch' | 'get_movements' | 'get_sharp_alerts';
      includePlayerProps?: boolean;
    };

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get recent line movements
    if (action === 'get_movements') {
      const sport = sports?.[0] || null;
      
      const { data: movements, error } = await supabase
        .from('line_movements')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      return new Response(JSON.stringify({ movements: movements || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get sharp money alerts only
    if (action === 'get_sharp_alerts') {
      const { data: alerts, error } = await supabase
        .from('line_movements')
        .select('*')
        .eq('is_sharp_action', true)
        .order('detected_at', { ascending: false })
        .limit(30);

      if (error) throw error;

      return new Response(JSON.stringify({ alerts: alerts || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch and track odds
    const ODDS_API_KEY = Deno.env.get('THE_ODDS_API_KEY');
    if (!ODDS_API_KEY) {
      throw new Error('THE_ODDS_API_KEY is not configured');
    }

    const targetSports = sports || ['NBA', 'NFL', 'NCAAB'];
    const allMovements: LineMovement[] = [];
    const snapshotsToInsert: any[] = [];
    const shouldFetchProps = includePlayerProps !== false; // Default to true

    for (const sport of targetSports) {
      const sportKey = SPORT_KEYS[sport];
      if (!sportKey) continue;

      console.log(`Fetching odds for ${sport}...`);

      try {
        // Fetch game lines (spreads, moneylines, totals)
        const oddsResponse = await fetch(
          `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads,h2h,totals&oddsFormat=american`
        );

        if (!oddsResponse.ok) {
          console.error(`Failed to fetch ${sport} odds:`, oddsResponse.status);
          continue;
        }

        const events: OddsEvent[] = await oddsResponse.json();
        console.log(`Got ${events.length} events for ${sport}`);

        // Process game lines
        for (const event of events) {
          await processEventOdds(event, sport, supabase, snapshotsToInsert, allMovements);
        }

        // Fetch player props for NBA games starting within 6 hours
        if (sport === 'NBA' && shouldFetchProps) {
          const now = new Date();
          const sixHoursFromNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);
          
          const upcomingEvents = events.filter(event => {
            const eventTime = new Date(event.commence_time);
            return eventTime > now && eventTime < sixHoursFromNow;
          });

          console.log(`Fetching player props for ${upcomingEvents.length} upcoming NBA games...`);

          for (const event of upcomingEvents) {
            try {
              await processPlayerProps(event, sport, ODDS_API_KEY, supabase, snapshotsToInsert, allMovements);
            } catch (propError) {
              console.error(`Error fetching props for ${event.id}:`, propError);
            }
          }
        }
      } catch (sportError) {
        console.error(`Error processing ${sport}:`, sportError);
      }
    }

    // Batch insert snapshots
    if (snapshotsToInsert.length > 0) {
      // Insert in batches of 100 to avoid payload limits
      for (let i = 0; i < snapshotsToInsert.length; i += 100) {
        const batch = snapshotsToInsert.slice(i, i + 100);
        const { error: snapshotError } = await supabase
          .from('odds_snapshots')
          .insert(batch);

        if (snapshotError) {
          console.error('Error inserting snapshot batch:', snapshotError);
        }
      }
      console.log(`Inserted ${snapshotsToInsert.length} odds snapshots`);
    }

    // Analyze sharp movements before inserting
    const now = new Date();
    const analyzedMovements = allMovements.map(m => {
      if (m.is_sharp_action) {
        const hoursToGame = m.commence_time 
          ? (new Date(m.commence_time).getTime() - now.getTime()) / (1000 * 60 * 60)
          : 24;
        
        const analysis = analyzeSharpMovement(m, allMovements, hoursToGame);
        
        return {
          ...m,
          movement_authenticity: analysis.authenticity,
          authenticity_confidence: analysis.confidence,
          recommendation: analysis.recommendation,
          recommendation_reason: analysis.reason,
          opposite_side_moved: analysis.oppositeSideMoved,
          books_consensus: analysis.booksConsensus,
        };
      }
      return m;
    });

    // Consolidate movements to determine final pick per event/market
    const consolidatedMovements = consolidateMovements(analyzedMovements);

    // Insert line movements (only primary records)
    const primaryMovements = consolidatedMovements.filter(m => m.is_primary_record !== false);
    if (primaryMovements.length > 0) {
      const { error: movementError } = await supabase
        .from('line_movements')
        .insert(primaryMovements.map(m => ({
          event_id: m.event_id,
          sport: m.sport,
          description: m.description,
          bookmaker: m.bookmaker,
          market_type: m.market_type,
          outcome_name: m.outcome_name,
          old_price: m.old_price,
          new_price: m.new_price,
          old_point: m.old_point,
          new_point: m.new_point,
          price_change: m.price_change,
          point_change: m.point_change,
          is_sharp_action: m.is_sharp_action,
          sharp_indicator: m.sharp_indicator,
          commence_time: m.commence_time,
          player_name: m.player_name,
          movement_authenticity: m.movement_authenticity || 'uncertain',
          authenticity_confidence: m.authenticity_confidence || 0.5,
          recommendation: m.recommendation || 'caution',
          recommendation_reason: m.recommendation_reason,
          opposite_side_moved: m.opposite_side_moved || false,
          books_consensus: m.books_consensus || 1,
          final_pick: m.final_pick,
          is_primary_record: m.is_primary_record ?? true,
        })));

      if (movementError) {
        console.error('Error inserting movements:', movementError);
      } else {
        const sharpCount = primaryMovements.filter(m => m.is_sharp_action).length;
        const playerPropCount = primaryMovements.filter(m => m.player_name).length;
        const realSharpCount = primaryMovements.filter(m => m.movement_authenticity === 'real').length;
        const fakeSharpCount = primaryMovements.filter(m => m.movement_authenticity === 'fake').length;
        
        console.log(`Detected ${primaryMovements.length} primary movements:`);
        console.log(`  - ${sharpCount} sharp (${realSharpCount} real, ${fakeSharpCount} fake)`);
        console.log(`  - ${playerPropCount} player props`);
        
        // Send push notifications for sharp alerts with final picks
        const sharpMovements = primaryMovements.filter(m => m.is_sharp_action);
        for (const sharpMove of sharpMovements) {
          try {
            await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                action: 'notify',
                alert: {
                  sport: sharpMove.sport,
                  description: sharpMove.description,
                  bookmaker: sharpMove.bookmaker,
                  price_change: sharpMove.price_change,
                  sharp_indicator: sharpMove.sharp_indicator,
                  player_name: sharpMove.player_name,
                  market_type: sharpMove.market_type,
                  movement_authenticity: sharpMove.movement_authenticity,
                  recommendation: sharpMove.recommendation,
                  final_pick: sharpMove.final_pick,
                }
              })
            });
            console.log(`Push notification sent: FINAL PICK ${sharpMove.final_pick} (${sharpMove.movement_authenticity})`);
          } catch (pushError) {
            console.error('Error sending push notification:', pushError);
          }
        }
      }
    }

    // Clean up old snapshots (keep last 24 hours)
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('odds_snapshots')
      .delete()
      .lt('snapshot_time', cutoffTime);

    const realSharpMoves = primaryMovements.filter(m => m.movement_authenticity === 'real');
    const fakeSharpMoves = primaryMovements.filter(m => m.movement_authenticity === 'fake');

    return new Response(JSON.stringify({
      success: true,
      snapshotsCreated: snapshotsToInsert.length,
      movementsDetected: primaryMovements.length,
      sharpAlerts: primaryMovements.filter(m => m.is_sharp_action).length,
      playerPropMovements: primaryMovements.filter(m => m.player_name).length,
      realSharpMoves: realSharpMoves.length,
      fakeSharpMoves: fakeSharpMoves.length,
      movements: primaryMovements
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in track-odds-movement:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      movements: []
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Consolidate movements to determine ONE final pick per event/market
function consolidateMovements(movements: LineMovement[]): LineMovement[] {
  // Group by event_id + market_type + bookmaker
  const groups = new Map<string, LineMovement[]>();
  
  for (const movement of movements) {
    const key = `${movement.event_id}_${movement.market_type}_${movement.bookmaker}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(movement);
  }
  
  const consolidatedMovements: LineMovement[] = [];
  
  for (const [key, groupMovements] of groups) {
    if (groupMovements.length <= 1) {
      // Single movement - it IS the final pick
      const m = groupMovements[0];
      let finalPick = m.outcome_name;
      
      // If fake, the final pick should be the opposite (but we only have one side)
      // So we just mark what we have
      if (m.movement_authenticity === 'fake') {
        // For fake movements, we want to fade this side, so final pick is still the opposite
        // But since we don't have the opposite outcome name directly, we'll indicate to bet AGAINST this
        m.recommendation_reason = `FADE ${m.outcome_name} - ${m.recommendation_reason || 'Market adjustment detected'}`;
      }
      
      consolidatedMovements.push({
        ...m,
        final_pick: finalPick,
        is_primary_record: true
      });
      continue;
    }
    
    // Multiple movements for same event/market/book - find the primary (bigger move)
    const sorted = [...groupMovements].sort((a, b) => 
      Math.abs(b.price_change) - Math.abs(a.price_change)
    );
    
    const primary = sorted[0];
    const secondary = sorted[1];
    
    // Determine final pick based on authenticity
    let finalPick: string;
    let updatedReason = primary.recommendation_reason || '';
    
    if (primary.movement_authenticity === 'real') {
      // REAL sharp = BET the side that moved (sharps are on it)
      finalPick = primary.outcome_name;
      updatedReason = `BET ${finalPick} - ${updatedReason}`;
    } else if (primary.movement_authenticity === 'fake') {
      // FAKE = FADE the fake movement = BET the opposite side
      finalPick = secondary?.outcome_name || `Opposite of ${primary.outcome_name}`;
      updatedReason = `FADE ${primary.outcome_name}, BET ${finalPick} - ${updatedReason}`;
    } else {
      // Uncertain - use the larger movement side as the pick with caution
      finalPick = primary.outcome_name;
      updatedReason = `Consider ${finalPick} - ${updatedReason}`;
    }
    
    // Mark primary record with final decision
    consolidatedMovements.push({
      ...primary,
      final_pick: finalPick,
      is_primary_record: true,
      recommendation_reason: updatedReason,
    });
    
    // Don't add secondary - we only want ONE record per event/market
  }
  
  return consolidatedMovements;
}

// Process game line odds for an event
async function processEventOdds(
  event: OddsEvent,
  sport: string,
  supabase: any,
  snapshotsToInsert: any[],
  allMovements: LineMovement[]
) {
  for (const bookmaker of event.bookmakers) {
    // Only track major books
    if (!['fanduel', 'draftkings', 'betmgm', 'caesars'].includes(bookmaker.key)) {
      continue;
    }

    for (const market of bookmaker.markets) {
      for (const outcome of market.outcomes) {
        await processOutcome(
          event,
          sport,
          bookmaker,
          market.key,
          outcome,
          supabase,
          snapshotsToInsert,
          allMovements
        );
      }
    }
  }
}

// Fetch and process player props for an NBA event
async function processPlayerProps(
  event: OddsEvent,
  sport: string,
  apiKey: string,
  supabase: any,
  snapshotsToInsert: any[],
  allMovements: LineMovement[]
) {
  const propsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${PLAYER_PROP_MARKETS.join(',')}&oddsFormat=american`;
  
  console.log(`Fetching player props for: ${event.away_team} @ ${event.home_team}`);
  
  const propsResponse = await fetch(propsUrl);
  
  if (!propsResponse.ok) {
    console.error(`Failed to fetch player props for ${event.id}:`, propsResponse.status);
    return;
  }

  const propsData = await propsResponse.json();
  
  if (!propsData.bookmakers || propsData.bookmakers.length === 0) {
    console.log(`No player props available for ${event.id}`);
    return;
  }

  let propCount = 0;
  
  for (const bookmaker of propsData.bookmakers) {
    // Only track major books
    if (!['fanduel', 'draftkings', 'betmgm', 'caesars'].includes(bookmaker.key)) {
      continue;
    }

    for (const market of bookmaker.markets) {
      if (!PLAYER_PROP_MARKETS.includes(market.key)) continue;

      for (const outcome of market.outcomes) {
        // outcome.description contains player name
        const playerName = outcome.description || 'Unknown Player';
        
        await processOutcome(
          event,
          sport,
          bookmaker,
          market.key,
          outcome,
          supabase,
          snapshotsToInsert,
          allMovements,
          playerName
        );
        propCount++;
      }
    }
  }
  
  console.log(`Processed ${propCount} player prop outcomes for ${event.id}`);
}

// Process a single outcome (game line or player prop)
async function processOutcome(
  event: OddsEvent,
  sport: string,
  bookmaker: Bookmaker,
  marketKey: string,
  outcome: OddsOutcome,
  supabase: any,
  snapshotsToInsert: any[],
  allMovements: LineMovement[],
  playerName?: string
) {
  const outcomeName = playerName 
    ? `${playerName} ${outcome.name} ${outcome.point || ''}`
    : outcome.name;
  
  // Check for existing snapshot
  let query = supabase
    .from('odds_snapshots')
    .select('*')
    .eq('event_id', event.id)
    .eq('bookmaker', bookmaker.key)
    .eq('market_type', marketKey)
    .eq('outcome_name', outcomeName);
  
  if (playerName) {
    query = query.eq('player_name', playerName);
  }
  
  const { data: existingSnapshot } = await query
    .order('snapshot_time', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Create new snapshot
  const newSnapshot = {
    event_id: event.id,
    sport: sport,
    home_team: event.home_team,
    away_team: event.away_team,
    commence_time: event.commence_time,
    bookmaker: bookmaker.key,
    market_type: marketKey,
    outcome_name: outcomeName,
    price: outcome.price,
    point: outcome.point || null,
    player_name: playerName || null,
    snapshot_time: new Date().toISOString()
  };

  snapshotsToInsert.push(newSnapshot);

  // Detect line movement
  if (existingSnapshot) {
    const priceChange = outcome.price - existingSnapshot.price;
    const pointChange = outcome.point !== undefined && existingSnapshot.point !== null
      ? outcome.point - existingSnapshot.point
      : null;

    // Only track significant movements
    // For player props, be slightly more sensitive (4+ point price change)
    const priceThreshold = playerName ? 4 : 5;
    const isSignificantMove = Math.abs(priceChange) >= priceThreshold || 
      (pointChange !== null && Math.abs(pointChange) >= 0.5);

    if (isSignificantMove) {
      // Detect sharp money
      let isSharp = false;
      let sharpIndicator: string | undefined;

      if (Math.abs(priceChange) >= 15) {
        isSharp = true;
        sharpIndicator = playerName 
          ? `STEAM MOVE - ${MARKET_LABELS[marketKey] || marketKey} prop shifted ${Math.abs(priceChange)} pts`
          : 'STEAM MOVE - Major price shift detected';
      } else if (Math.abs(priceChange) >= 10 && (pointChange === null || Math.abs(pointChange) < 0.5)) {
        isSharp = true;
        sharpIndicator = playerName
          ? `SHARP ACTION - ${MARKET_LABELS[marketKey] || marketKey} moved without line change`
          : 'SHARP ACTION - Price moved without spread change';
      } else if (Math.abs(priceChange) >= 8) {
        isSharp = true;
        sharpIndicator = playerName
          ? `POSSIBLE SHARP - ${MARKET_LABELS[marketKey] || marketKey} line movement`
          : 'POSSIBLE SHARP - Significant line movement';
      }

      const movement: LineMovement = {
        event_id: event.id,
        sport: sport,
        description: `${event.away_team} @ ${event.home_team}`,
        bookmaker: bookmaker.key,
        market_type: marketKey,
        outcome_name: outcomeName,
        old_price: existingSnapshot.price,
        new_price: outcome.price,
        old_point: existingSnapshot.point,
        new_point: outcome.point,
        price_change: priceChange,
        point_change: pointChange || undefined,
        is_sharp_action: isSharp,
        sharp_indicator: sharpIndicator,
        commence_time: event.commence_time,
        player_name: playerName
      };

      allMovements.push(movement);
    }
  }
}
