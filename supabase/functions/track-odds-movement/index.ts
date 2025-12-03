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
  description?: string;
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
  movement_authenticity?: 'real' | 'fake' | 'uncertain';
  authenticity_confidence?: number;
  recommendation?: 'pick' | 'fade' | 'caution';
  recommendation_reason?: string;
  opposite_side_moved?: boolean;
  books_consensus?: number;
  final_pick?: string;
  is_primary_record?: boolean;
  determination_status?: 'pending' | 'final';
  opening_price?: number;
  opening_point?: number;
  preliminary_confidence?: number;
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

// OPTIMIZED: Only track 2 key prop markets to avoid timeouts
const PLAYER_PROP_MARKETS = [
  'player_points',
  'player_assists',
];

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
    fakeScore += 1;
    signals.push('SINGLE_BOOK_DIVERGENCE');
  }
  
  if (Math.abs(movement.price_change) >= 8 && 
      (!movement.point_change || Math.abs(movement.point_change) < 0.5)) {
    fakeScore += 3;
    signals.push('PRICE_ONLY_MOVE_TRAP');
  }
  
  if (movement.point_change && Math.abs(movement.point_change) >= 0.5 &&
      Math.abs(movement.price_change) >= 5 && !oppositeMoved) {
    realScore += 3;
    signals.push('LINE_AND_JUICE_CONFIRMED');
  }
  
  if (movement.point_change && Math.abs(movement.point_change) >= 0.5 &&
      Math.abs(movement.price_change) >= 5 && oppositeMoved) {
    fakeScore += 2;
    signals.push('MARKET_ADJUSTMENT');
  }
  
  if (hoursToGame >= 1 && hoursToGame <= 3) {
    realScore += 3;
    signals.push('LATE_MONEY_SWEET_SPOT');
  } else if (hoursToGame < 1) {
    realScore += 1;
    signals.push('VERY_LATE_MONEY');
  } else if (hoursToGame >= 8) {
    fakeScore += 2;
    signals.push('EARLY_MORNING_MOVE');
  } else if (hoursToGame >= 4) {
    signals.push('MODERATE_TIMING');
  }
  
  if (Math.abs(movement.price_change) >= 15) {
    if (booksConsensus >= 2) {
      realScore += 2;
      signals.push('STEAM_MOVE_CONFIRMED');
    } else {
      fakeScore += 2;
      signals.push('STEAM_MOVE_NO_CONSENSUS');
    }
  }
  
  if (movement.player_name) {
    realScore += 1;
    signals.push('PLAYER_PROP');
  }
  
  if (movement.new_price < -200 && movement.price_change < -5) {
    fakeScore += 2;
    signals.push('HEAVY_FAVORITE_SHORTENING');
  }
  
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

// OPTIMIZED: Batch fetch all existing snapshots for events
async function fetchExistingSnapshots(
  supabase: any,
  eventIds: string[]
): Promise<Map<string, any>> {
  const snapshotMap = new Map<string, any>();
  
  if (eventIds.length === 0) return snapshotMap;
  
  // Fetch latest snapshots for all events in one query
  const { data: snapshots, error } = await supabase
    .from('odds_snapshots')
    .select('*')
    .in('event_id', eventIds)
    .order('snapshot_time', { ascending: false });
  
  if (error) {
    console.error('[Snapshot Fetch Error]:', error);
    return snapshotMap;
  }
  
  // Build lookup map: event_id_bookmaker_market_outcome -> snapshot
  for (const snap of snapshots || []) {
    const key = `${snap.event_id}_${snap.bookmaker}_${snap.market_type}_${snap.outcome_name}`;
    // Only keep the most recent (first encountered due to DESC order)
    if (!snapshotMap.has(key)) {
      snapshotMap.set(key, snap);
    }
  }
  
  console.log(`[Snapshots] Loaded ${snapshotMap.size} existing snapshots for ${eventIds.length} events`);
  return snapshotMap;
}

// OPTIMIZED: Background processing with batched operations
async function processOddsInBackground(
  sports: string[],
  includePlayerProps: boolean
) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const ODDS_API_KEY = Deno.env.get('THE_ODDS_API_KEY')!;

  const allMovements: LineMovement[] = [];
  const snapshotsToInsert: any[] = [];

  console.log(`[Background] Starting OPTIMIZED odds processing for: ${sports.join(', ')}`);
  console.log(`[Background] Player props: ${includePlayerProps ? 'ENABLED (limited)' : 'DISABLED'}`);

  for (const sport of sports) {
    const sportKey = SPORT_KEYS[sport];
    if (!sportKey) continue;

    console.log(`[Background] Fetching odds for ${sport}...`);

    try {
      // Fetch game lines
      const oddsResponse = await fetch(
        `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads,h2h,totals&oddsFormat=american`
      );

      if (!oddsResponse.ok) {
        console.error(`[Background] Failed to fetch ${sport} odds:`, oddsResponse.status);
        continue;
      }

      const events: OddsEvent[] = await oddsResponse.json();
      console.log(`[Background] Got ${events.length} events for ${sport}`);

      // Get all event IDs for batch snapshot lookup
      const eventIds = events.map(e => e.id);
      const existingSnapshots = await fetchExistingSnapshots(supabase, eventIds);

      // Process game lines with in-memory snapshot lookup
      for (const event of events) {
        processEventOddsBatched(event, sport, existingSnapshots, snapshotsToInsert, allMovements);
      }

      // Save game line snapshots immediately for this sport
      if (snapshotsToInsert.length > 0) {
        const batch = [...snapshotsToInsert];
        snapshotsToInsert.length = 0; // Clear for next sport
        
        for (let i = 0; i < batch.length; i += 100) {
          const chunk = batch.slice(i, i + 100);
          const { error } = await supabase.from('odds_snapshots').insert(chunk);
          if (error) console.error('[Background] Snapshot insert error:', error);
        }
        console.log(`[Background] Saved ${batch.length} game line snapshots for ${sport}`);
      }

      // OPTIMIZED: Fetch player props for NBA only, max 2 games
      if (sport === 'NBA' && includePlayerProps) {
        const now = new Date();
        const sixHoursFromNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);
        
        const upcomingEvents = events
          .filter(event => {
            const eventTime = new Date(event.commence_time);
            return eventTime > now && eventTime < sixHoursFromNow;
          })
          .slice(0, 2); // LIMIT: Only process 2 games max

        console.log(`[Background] Processing player props for ${upcomingEvents.length} NBA games (max 2)`);

        for (const event of upcomingEvents) {
          try {
            await processPlayerPropsOptimized(
              event, sport, ODDS_API_KEY, supabase, snapshotsToInsert, allMovements
            );
            
            // Save after each game to avoid data loss
            if (snapshotsToInsert.length > 0) {
              const batch = [...snapshotsToInsert];
              snapshotsToInsert.length = 0;
              
              for (let i = 0; i < batch.length; i += 100) {
                const chunk = batch.slice(i, i + 100);
                const { error } = await supabase.from('odds_snapshots').insert(chunk);
                if (error) console.error('[Background] Props snapshot error:', error);
              }
              console.log(`[Background] Saved ${batch.length} prop snapshots for ${event.away_team} @ ${event.home_team}`);
            }
          } catch (propError) {
            console.error(`[Background] Error fetching props for ${event.id}:`, propError);
          }
        }
      }
    } catch (sportError) {
      console.error(`[Background] Error processing ${sport}:`, sportError);
    }
  }

  // Analyze and insert movements
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

  const consolidatedMovements = consolidateMovements(analyzedMovements);
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
        determination_status: m.determination_status || 'pending',
        opening_price: m.opening_price,
        opening_point: m.opening_point,
        preliminary_confidence: m.authenticity_confidence || 0.5,
      })));

    if (movementError) {
      console.error('[Background] Error inserting movements:', movementError);
    } else {
      const sharpCount = primaryMovements.filter(m => m.is_sharp_action).length;
      const playerPropCount = primaryMovements.filter(m => m.player_name).length;
      
      console.log(`[Background] Detected ${primaryMovements.length} movements (${sharpCount} sharp, ${playerPropCount} props)`);
      
      // Send push notifications for sharp alerts
      for (const sharpMove of primaryMovements.filter(m => m.is_sharp_action)) {
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
        } catch (pushError) {
          console.error('[Background] Push notification error:', pushError);
        }
      }
    }
  }

  // Clean up old snapshots
  const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await supabase.from('odds_snapshots').delete().lt('snapshot_time', cutoffTime);

  console.log(`[Background] COMPLETED - ${primaryMovements.length} movements detected`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Handle empty body gracefully (e.g., from cron jobs)
    let body: { sports?: string[]; action?: string; includePlayerProps?: boolean } = {};
    try {
      const text = await req.text();
      if (text && text.trim()) {
        body = JSON.parse(text);
      }
    } catch {
      // Empty or invalid JSON, use defaults
      console.log('[track-odds-movement] No body or invalid JSON, using defaults');
    }
    
    const { sports, action, includePlayerProps } = body as {
      sports?: string[];
      action?: 'fetch' | 'get_movements' | 'get_sharp_alerts';
      includePlayerProps?: boolean;
    };

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    if (action === 'get_movements') {
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

    const ODDS_API_KEY = Deno.env.get('THE_ODDS_API_KEY');
    if (!ODDS_API_KEY) {
      throw new Error('THE_ODDS_API_KEY is not configured');
    }

    const targetSports = sports || ['NBA', 'NFL', 'NCAAB'];
    const shouldFetchProps = includePlayerProps !== false;

    // @ts-ignore
    EdgeRuntime.waitUntil(processOddsInBackground(targetSports, shouldFetchProps));

    return new Response(JSON.stringify({
      success: true,
      message: 'Optimized odds tracking started',
      sports: targetSports,
      includePlayerProps: shouldFetchProps,
      optimization: 'Batched queries, limited to 2 games for props, only PTS/AST markets'
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
  const groups = new Map<string, LineMovement[]>();
  
  for (const movement of movements) {
    const key = `${movement.event_id}_${movement.market_type}_${movement.bookmaker}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(movement);
  }
  
  const consolidatedMovements: LineMovement[] = [];
  
  for (const [key, groupMovements] of groups) {
    if (groupMovements.length <= 1) {
      const m = groupMovements[0];
      let finalPick = m.outcome_name;
      
      if (m.movement_authenticity === 'fake') {
        m.recommendation_reason = `FADE ${m.outcome_name} - ${m.recommendation_reason || 'Market adjustment detected'}`;
      }
      
      consolidatedMovements.push({
        ...m,
        final_pick: finalPick,
        is_primary_record: true
      });
      continue;
    }
    
    const sorted = [...groupMovements].sort((a, b) => 
      Math.abs(b.price_change) - Math.abs(a.price_change)
    );
    
    const primary = sorted[0];
    const secondary = sorted[1];
    
    let finalPick: string;
    let updatedReason = primary.recommendation_reason || '';
    
    if (primary.movement_authenticity === 'real') {
      finalPick = primary.outcome_name;
      updatedReason = `BET ${finalPick} - ${updatedReason}`;
    } else if (primary.movement_authenticity === 'fake') {
      finalPick = secondary?.outcome_name || `Opposite of ${primary.outcome_name}`;
      updatedReason = `FADE ${primary.outcome_name}, BET ${finalPick} - ${updatedReason}`;
    } else {
      finalPick = primary.outcome_name;
      updatedReason = `Consider ${finalPick} - ${updatedReason}`;
    }
    
    consolidatedMovements.push({
      ...primary,
      final_pick: finalPick,
      is_primary_record: true,
      recommendation_reason: updatedReason,
    });
  }
  
  return consolidatedMovements;
}

// OPTIMIZED: Process game line odds with in-memory snapshot lookup (no DB calls)
function processEventOddsBatched(
  event: OddsEvent,
  sport: string,
  existingSnapshots: Map<string, any>,
  snapshotsToInsert: any[],
  allMovements: LineMovement[]
) {
  for (const bookmaker of event.bookmakers) {
    if (!['fanduel', 'draftkings', 'betmgm', 'caesars'].includes(bookmaker.key)) {
      continue;
    }

    for (const market of bookmaker.markets) {
      for (const outcome of market.outcomes) {
        const outcomeName = outcome.name;
        const snapshotKey = `${event.id}_${bookmaker.key}_${market.key}_${outcomeName}`;
        const existingSnapshot = existingSnapshots.get(snapshotKey);

        // Create new snapshot
        snapshotsToInsert.push({
          event_id: event.id,
          sport: sport,
          home_team: event.home_team,
          away_team: event.away_team,
          commence_time: event.commence_time,
          bookmaker: bookmaker.key,
          market_type: market.key,
          outcome_name: outcomeName,
          price: outcome.price,
          point: outcome.point || null,
          player_name: null,
          snapshot_time: new Date().toISOString()
        });

        // Detect movement
        if (existingSnapshot) {
          const priceChange = outcome.price - existingSnapshot.price;
          const pointChange = outcome.point !== undefined && existingSnapshot.point !== null
            ? outcome.point - existingSnapshot.point
            : null;

          const isSignificantMove = Math.abs(priceChange) >= 3 || 
            (pointChange !== null && Math.abs(pointChange) >= 0.5);

          if (isSignificantMove) {
            let isSharp = false;
            let sharpIndicator: string | undefined;

            if (Math.abs(priceChange) >= 10) {
              isSharp = true;
              sharpIndicator = 'STEAM MOVE - Major price shift detected';
            } else if (Math.abs(priceChange) >= 7 && (pointChange === null || Math.abs(pointChange) < 0.5)) {
              isSharp = true;
              sharpIndicator = 'SHARP ACTION - Price moved without spread change';
            } else if (Math.abs(priceChange) >= 5) {
              isSharp = true;
              sharpIndicator = 'POSSIBLE SHARP - Significant line movement';
            }

            allMovements.push({
              event_id: event.id,
              sport: sport,
              description: `${event.away_team} @ ${event.home_team}`,
              bookmaker: bookmaker.key,
              market_type: market.key,
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
              opening_price: existingSnapshot.price,
              opening_point: existingSnapshot.point,
              determination_status: 'pending'
            });
          }
        }
      }
    }
  }
}

// OPTIMIZED: Fetch player props with batched snapshot lookup
async function processPlayerPropsOptimized(
  event: OddsEvent,
  sport: string,
  apiKey: string,
  supabase: any,
  snapshotsToInsert: any[],
  allMovements: LineMovement[]
) {
  // Only fetch the 2 key markets
  const propsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${PLAYER_PROP_MARKETS.join(',')}&oddsFormat=american`;
  
  console.log(`[Props] Fetching ${PLAYER_PROP_MARKETS.join(', ')} for: ${event.away_team} @ ${event.home_team}`);
  
  const propsResponse = await fetch(propsUrl);
  
  if (!propsResponse.ok) {
    console.error(`[Props] Failed to fetch for ${event.id}:`, propsResponse.status);
    return;
  }

  const propsData = await propsResponse.json();
  
  if (!propsData.bookmakers || propsData.bookmakers.length === 0) {
    console.log(`[Props] No props available for ${event.id}`);
    return;
  }

  // Fetch existing snapshots for this event
  const existingSnapshots = await fetchExistingSnapshots(supabase, [event.id]);
  
  let propCount = 0;
  
  for (const bookmaker of propsData.bookmakers) {
    if (!['fanduel', 'draftkings'].includes(bookmaker.key)) { // Only 2 books for props
      continue;
    }

    for (const market of bookmaker.markets) {
      if (!PLAYER_PROP_MARKETS.includes(market.key)) continue;

      for (const outcome of market.outcomes) {
        const playerName = outcome.description || 'Unknown Player';
        const outcomeName = `${playerName} ${outcome.name} ${outcome.point || ''}`;
        const snapshotKey = `${event.id}_${bookmaker.key}_${market.key}_${outcomeName}`;
        const existingSnapshot = existingSnapshots.get(snapshotKey);

        // Create new snapshot
        snapshotsToInsert.push({
          event_id: event.id,
          sport: sport,
          home_team: event.home_team,
          away_team: event.away_team,
          commence_time: event.commence_time,
          bookmaker: bookmaker.key,
          market_type: market.key,
          outcome_name: outcomeName,
          price: outcome.price,
          point: outcome.point || null,
          player_name: playerName,
          snapshot_time: new Date().toISOString()
        });
        propCount++;

        // Detect movement
        if (existingSnapshot) {
          const priceChange = outcome.price - existingSnapshot.price;
          const pointChange = outcome.point !== undefined && existingSnapshot.point !== null
            ? outcome.point - existingSnapshot.point
            : null;

          const isSignificantMove = Math.abs(priceChange) >= 2 || 
            (pointChange !== null && Math.abs(pointChange) >= 0.5);

          if (isSignificantMove) {
            let isSharp = false;
            let sharpIndicator: string | undefined;

            if (Math.abs(priceChange) >= 10) {
              isSharp = true;
              sharpIndicator = `STEAM MOVE - ${MARKET_LABELS[market.key] || market.key} prop shifted ${Math.abs(priceChange)} pts`;
            } else if (Math.abs(priceChange) >= 7 && (pointChange === null || Math.abs(pointChange) < 0.5)) {
              isSharp = true;
              sharpIndicator = `SHARP ACTION - ${MARKET_LABELS[market.key] || market.key} moved without line change`;
            } else if (Math.abs(priceChange) >= 5) {
              isSharp = true;
              sharpIndicator = `POSSIBLE SHARP - ${MARKET_LABELS[market.key] || market.key} line movement`;
            }

            allMovements.push({
              event_id: event.id,
              sport: sport,
              description: `${event.away_team} @ ${event.home_team}`,
              bookmaker: bookmaker.key,
              market_type: market.key,
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
              player_name: playerName,
              opening_price: existingSnapshot.price,
              opening_point: existingSnapshot.point,
              determination_status: 'pending'
            });
          }
        }
      }
    }
  }
  
  console.log(`[Props] Processed ${propCount} prop outcomes for ${event.id}`);
}
