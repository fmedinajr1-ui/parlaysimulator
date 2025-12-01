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
  // New classification fields
  movement_authenticity?: 'real' | 'fake' | 'uncertain';
  authenticity_confidence?: number;
  recommendation?: 'pick' | 'fade' | 'caution';
  recommendation_reason?: string;
  opposite_side_moved?: boolean;
  books_consensus?: number;
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
  
  // Check price vs line movement (price moved without spread change = classic sharp)
  if (Math.abs(movement.price_change) >= 8 && 
      (!movement.point_change || Math.abs(movement.point_change) < 0.5)) {
    realScore += 2;
    signals.push('PRICE_WITHOUT_LINE_CHANGE');
  }
  
  // Line AND price moved together = normal adjustment
  if (movement.point_change && Math.abs(movement.point_change) >= 0.5 &&
      Math.abs(movement.price_change) >= 5) {
    fakeScore += 1;
    signals.push('LINE_AND_PRICE_MOVED');
  }
  
  // Late money is sharper (< 4 hours to game)
  if (hoursToGame <= 4) {
    realScore += 2;
    signals.push('LATE_MONEY');
  } else if (hoursToGame >= 12) {
    fakeScore += 1;
    signals.push('EARLY_MOVEMENT');
  }
  
  // Steam move analysis (very large movement)
  if (Math.abs(movement.price_change) >= 15) {
    realScore += 1;
    signals.push('STEAM_MOVE');
  }
  
  // Player props tend to be sharper (books have less data)
  if (movement.player_name) {
    realScore += 1;
    signals.push('PLAYER_PROP');
  }
  
  // Favorite shortening even more = could be public overreaction
  if (movement.new_price < -200 && movement.price_change < -5) {
    fakeScore += 1;
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

    // Insert line movements
    if (analyzedMovements.length > 0) {
      const { error: movementError } = await supabase
        .from('line_movements')
        .insert(analyzedMovements.map(m => ({
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
        })));

      if (movementError) {
        console.error('Error inserting movements:', movementError);
      } else {
        const sharpCount = analyzedMovements.filter(m => m.is_sharp_action).length;
        const playerPropCount = analyzedMovements.filter(m => m.player_name).length;
        const realSharpCount = analyzedMovements.filter(m => m.movement_authenticity === 'real').length;
        const fakeSharpCount = analyzedMovements.filter(m => m.movement_authenticity === 'fake').length;
        
        console.log(`Detected ${analyzedMovements.length} movements:`);
        console.log(`  - ${sharpCount} sharp (${realSharpCount} real, ${fakeSharpCount} fake)`);
        console.log(`  - ${playerPropCount} player props`);
        
        // Send push notifications for sharp alerts
        const sharpMovements = analyzedMovements.filter(m => m.is_sharp_action);
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
                }
              })
            });
            console.log(`Push notification sent for sharp move: ${sharpMove.player_name || sharpMove.description} (${sharpMove.movement_authenticity})`);
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

    const realSharpMoves = analyzedMovements.filter(m => m.movement_authenticity === 'real');
    const fakeSharpMoves = analyzedMovements.filter(m => m.movement_authenticity === 'fake');

    return new Response(JSON.stringify({
      success: true,
      snapshotsCreated: snapshotsToInsert.length,
      movementsDetected: analyzedMovements.length,
      sharpAlerts: analyzedMovements.filter(m => m.is_sharp_action).length,
      playerPropMovements: analyzedMovements.filter(m => m.player_name).length,
      realSharpMoves: realSharpMoves.length,
      fakeSharpMoves: fakeSharpMoves.length,
      movements: analyzedMovements
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
