import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PlayerProp {
  event_id: string;
  sport: string;
  game_description: string;
  player_name: string;
  prop_type: string;
  line: number;
  over_price: number;
  under_price: number;
  bookmaker: string;
  commence_time: string;
}

interface JuicedProp extends PlayerProp {
  juice_level: 'heavy' | 'moderate' | 'light';
  juice_direction: 'over' | 'under';
  juice_amount: number;
  opening_over_price?: number;
  is_morning_trap?: boolean;
  trap_reason?: string;
  // Unified intelligence data
  unified_composite_score?: number;
  unified_pvs_tier?: string;
  unified_recommendation?: string;
  unified_confidence?: number;
  unified_trap_score?: number;
  used_unified_intelligence?: boolean;
}

interface UnifiedProp {
  event_id: string;
  player_name: string;
  prop_type: string;
  composite_score: number;
  pvs_tier: string;
  recommended_side: string;
  confidence: number;
  trap_score: number;
}

// Detect juice on a prop
function detectJuice(overPrice: number, underPrice: number, openingOverPrice?: number): {
  juiceLevel: 'heavy' | 'moderate' | 'light';
  juiceDirection: 'over' | 'under';
  juiceAmount: number;
  isJuiced: boolean;
} {
  // Determine which side is juiced (more negative = more action)
  const juiceDirection: 'over' | 'under' = overPrice < underPrice ? 'over' : 'under';
  const juiceAmount = Math.abs(overPrice - underPrice);
  
  let juiceLevel: 'heavy' | 'moderate' | 'light' = 'light';
  let isJuiced = false;
  
  // Heavy juice: -130 or worse on one side (20+ pt difference)
  if (Math.min(overPrice, underPrice) <= -130) {
    juiceLevel = 'heavy';
    isJuiced = true;
  }
  // Moderate juice: -120 to -129
  else if (Math.min(overPrice, underPrice) <= -120) {
    juiceLevel = 'moderate';
    isJuiced = true;
  }
  // Light juice: -115 to -119
  else if (Math.min(overPrice, underPrice) <= -115 && juiceAmount >= 10) {
    juiceLevel = 'light';
    isJuiced = true;
  }
  
  // Also check if moved significantly from opening (if available)
  if (openingOverPrice && Math.abs(overPrice - openingOverPrice) >= 15) {
    isJuiced = true;
    if (juiceLevel === 'light') juiceLevel = 'moderate';
    if (Math.abs(overPrice - openingOverPrice) >= 25) juiceLevel = 'heavy';
  }
  
  return { juiceLevel, juiceDirection, juiceAmount, isJuiced };
}

// Map API sport keys to display names
function mapSportDisplay(sport: string): string {
  const sportMap: Record<string, string> = {
    'basketball_nba': 'NBA',
    'americanfootball_nfl': 'NFL',
    'americanfootball_ncaaf': 'NCAAF',
    'icehockey_nhl': 'NHL',
  };
  return sportMap[sport] || sport;
}

// Map prop market keys to readable names
function mapPropType(market: string): string {
  const propMap: Record<string, string> = {
    'player_points': 'Points',
    'player_rebounds': 'Rebounds',
    'player_assists': 'Assists',
    'player_threes': '3-Pointers',
    'player_points_rebounds_assists': 'PRA',
    'player_pass_tds': 'Pass TDs',
    'player_pass_yds': 'Pass Yards',
    'player_rush_yds': 'Rush Yards',
    'player_receptions': 'Receptions',
    'player_goals': 'Goals',
    'player_shots_on_goal': 'Shots',
    'player_power_play_points': 'PP Points',
  };
  return propMap[market] || market.replace('player_', '').replace(/_/g, ' ');
}

// Normalize player name for matching
function normalizePlayerName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z\s]/g, '');
}

// Normalize prop type for matching
function normalizePropType(propType: string): string {
  // Map display names back to unified prop types
  const reverseMap: Record<string, string> = {
    'points': 'player_points',
    'rebounds': 'player_rebounds',
    'assists': 'player_assists',
    '3-pointers': 'player_threes',
    'pra': 'player_points_rebounds_assists',
    'pass tds': 'player_pass_tds',
    'pass yards': 'player_pass_yds',
    'rush yards': 'player_rush_yds',
    'receptions': 'player_receptions',
    'goals': 'player_goals',
    'shots': 'player_shots_on_goal',
    'pp points': 'player_power_play_points',
  };
  return reverseMap[propType.toLowerCase()] || propType.toLowerCase();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    console.log('🌅 Starting morning props scanner with Unified Intelligence...');
    
    // Fetch existing hit rate data to cross-reference with juiced props
    const { data: hitRateData } = await supabase
      .from('player_prop_hitrates')
      .select('player_name, prop_type, hit_rate_over, hit_rate_under, recommended_side, confidence_score')
      .gte('analyzed_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    
    // Fetch unified props for cross-reference
    const { data: unifiedPropsData } = await supabase
      .from('unified_props')
      .select('event_id, player_name, prop_type, composite_score, pvs_tier, recommended_side, confidence, trap_score')
      .eq('is_active', true)
      .gte('commence_time', new Date().toISOString());
    
    // Build lookup map for hit rate cross-referencing
    const hitRateMap = new Map<string, any>();
    if (hitRateData) {
      for (const hr of hitRateData) {
        const key = `${normalizePlayerName(hr.player_name)}_${hr.prop_type}`;
        hitRateMap.set(key, hr);
      }
    }
    console.log(`Loaded ${hitRateMap.size} hit rate records for cross-reference`);
    
    // Build lookup map for unified props
    const unifiedPropsMap = new Map<string, UnifiedProp>();
    if (unifiedPropsData) {
      for (const up of unifiedPropsData) {
        const key = `${normalizePlayerName(up.player_name)}_${up.prop_type}`;
        unifiedPropsMap.set(key, up as UnifiedProp);
      }
    }
    console.log(`🧠 Loaded ${unifiedPropsMap.size} unified props for intelligence cross-reference`);
    
  // Sports to scan for player props - NBA, Football, Hockey only
  const sportsToScan = [
    'basketball_nba',           // NBA player props
    'americanfootball_nfl',     // NFL player props
    'americanfootball_ncaaf',   // College football player props
    'icehockey_nhl',            // NHL player props
  ];
    
    // Player prop markets to check
    const propMarkets = [
      'player_points',
      'player_rebounds',
      'player_assists',
      'player_threes',
      'player_pass_tds',
      'player_pass_yds',
      'player_rush_yds',
      'player_goals',
    ];
    
    const allJuicedProps: JuicedProp[] = [];
    const now = new Date();
    const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    let unifiedMatchCount = 0;
    
    // Scan each sport
    for (const sport of sportsToScan) {
      console.log(`📊 Scanning ${sport} for juiced props...`);
      
      try {
        // Get events for next 24 hours
        const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${oddsApiKey}`;
        const eventsResponse = await fetch(eventsUrl);
        
        if (!eventsResponse.ok) {
          console.log(`No events for ${sport}`);
          continue;
        }
        
        const events = await eventsResponse.json();
        const upcomingEvents = events.filter((e: any) => {
          const eventTime = new Date(e.commence_time);
          return eventTime >= now && eventTime <= next24Hours;
        });
        
        console.log(`Found ${upcomingEvents.length} events for ${sport} in next 24h`);
        
        // For each event, get player props
        for (const event of upcomingEvents.slice(0, 5)) { // Limit to 5 events per sport to save API calls
          for (const market of propMarkets) {
            try {
              const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${oddsApiKey}&regions=us&markets=${market}&oddsFormat=american`;
              const oddsResponse = await fetch(oddsUrl);
              
              if (!oddsResponse.ok) continue;
              
              const oddsData = await oddsResponse.json();
              
              // Process each bookmaker
              for (const bookmaker of oddsData.bookmakers || []) {
                for (const marketData of bookmaker.markets || []) {
                  // Group outcomes by player (over/under pairs)
                  const playerOutcomes: Record<string, { over?: any; under?: any; line?: number }> = {};
                  
                  for (const outcome of marketData.outcomes || []) {
                    const playerName = outcome.description;
                    if (!playerOutcomes[playerName]) playerOutcomes[playerName] = {};
                    
                    if (outcome.name === 'Over') {
                      playerOutcomes[playerName].over = outcome;
                      playerOutcomes[playerName].line = outcome.point;
                    } else if (outcome.name === 'Under') {
                      playerOutcomes[playerName].under = outcome;
                    }
                  }
                  
                  // Check each player prop for juice
                  for (const [playerName, outcomes] of Object.entries(playerOutcomes)) {
                    if (!outcomes.over || !outcomes.under) continue;
                    
                    const overPrice = outcomes.over.price;
                    const underPrice = outcomes.under.price;
                    const line = outcomes.line || 0;
                    
                    const { juiceLevel, juiceDirection, juiceAmount, isJuiced } = detectJuice(overPrice, underPrice);
                    
                    // Only include props with juice on the OVER
                    if (isJuiced && juiceDirection === 'over') {
                      // Cross-reference with hit rate data
                      const hitRateKey = `${normalizePlayerName(playerName)}_${market}`;
                      const playerHitRate = hitRateMap.get(hitRateKey);
                      
                      // Cross-reference with unified props for intelligence
                      const unifiedKey = `${normalizePlayerName(playerName)}_${market}`;
                      const unifiedProp = unifiedPropsMap.get(unifiedKey);
                      
                      // If we have hit rate data showing under is better, flag this as potential trap
                      let isTrap = false;
                      let trapReason = '';
                      
                      if (playerHitRate) {
                        if (playerHitRate.recommended_side === 'under' && playerHitRate.hit_rate_under >= 0.6) {
                          isTrap = true;
                          trapReason = `Hit rate favors UNDER (${Math.round(playerHitRate.hit_rate_under * 100)}%)`;
                        }
                      }
                      
                      // Also check unified trap score
                      if (unifiedProp && unifiedProp.trap_score >= 60) {
                        isTrap = true;
                        trapReason = trapReason 
                          ? `${trapReason} | Unified trap score: ${unifiedProp.trap_score}`
                          : `Unified trap score: ${unifiedProp.trap_score}`;
                      }
                      
                      const juicedProp: JuicedProp = {
                        event_id: event.id,
                        sport: mapSportDisplay(sport),
                        game_description: `${event.away_team} @ ${event.home_team}`,
                        player_name: playerName,
                        prop_type: mapPropType(market),
                        line,
                        over_price: overPrice,
                        under_price: underPrice,
                        bookmaker: bookmaker.key,
                        commence_time: event.commence_time,
                        juice_level: juiceLevel,
                        juice_direction: juiceDirection,
                        juice_amount: juiceAmount,
                        is_morning_trap: isTrap,
                        trap_reason: trapReason || undefined,
                      };
                      
                      // Add unified intelligence data if available
                      if (unifiedProp) {
                        juicedProp.unified_composite_score = unifiedProp.composite_score;
                        juicedProp.unified_pvs_tier = unifiedProp.pvs_tier;
                        juicedProp.unified_recommendation = unifiedProp.recommended_side;
                        juicedProp.unified_confidence = unifiedProp.confidence;
                        juicedProp.unified_trap_score = unifiedProp.trap_score;
                        juicedProp.used_unified_intelligence = true;
                        unifiedMatchCount++;
                      } else {
                        juicedProp.used_unified_intelligence = false;
                      }
                      
                      allJuicedProps.push(juicedProp);
                    }
                  }
                }
              }
              
              // Small delay to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch (propError) {
              console.log(`Error fetching ${market} for event ${event.id}:`, propError);
            }
          }
        }
      } catch (sportError) {
        console.log(`Error scanning ${sport}:`, sportError);
      }
    }
    
    console.log(`🔥 Found ${allJuicedProps.length} juiced over props`);
    console.log(`🧠 ${unifiedMatchCount} props matched with Unified Intelligence data`);
    
    // Sort by juice level (heavy first) and insert into database
    const sortedProps = allJuicedProps.sort((a, b) => {
      const levelOrder = { heavy: 0, moderate: 1, light: 2 };
      return levelOrder[a.juice_level] - levelOrder[b.juice_level];
    });
    
    // Clear old props from today and insert new ones
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    await supabase
      .from('juiced_props')
      .delete()
      .gte('morning_scan_time', todayStart.toISOString())
      .eq('is_locked', false);
    
    // Insert new juiced props with morning trap detection
    // ❌ RULE: Early morning overs (before 10 AM ET) are potential traps
    const currentHourUTC = now.getUTCHours();
    const isEarlyMorning = currentHourUTC < 15; // Before 10 AM ET (UTC-5)
    
    if (sortedProps.length > 0) {
      const insertData = sortedProps.map(prop => {
        // Check if this is a morning over trap
        const hoursToGame = (new Date(prop.commence_time).getTime() - now.getTime()) / (1000 * 60 * 60);
        const isMorningTrap = isEarlyMorning && prop.juice_direction === 'over' && hoursToGame > 6;
        
        return {
          event_id: prop.event_id,
          sport: prop.sport,
          game_description: prop.game_description,
          player_name: prop.player_name,
          prop_type: prop.prop_type,
          line: prop.line,
          over_price: prop.over_price,
          under_price: prop.under_price,
          bookmaker: prop.bookmaker,
          commence_time: prop.commence_time,
          juice_level: prop.juice_level,
          juice_direction: prop.juice_direction,
          juice_amount: prop.juice_amount,
          is_locked: false,
          // Unified intelligence columns
          unified_composite_score: prop.unified_composite_score,
          unified_pvs_tier: prop.unified_pvs_tier,
          unified_recommendation: prop.unified_recommendation,
          unified_confidence: prop.unified_confidence,
          unified_trap_score: prop.unified_trap_score,
          used_unified_intelligence: prop.used_unified_intelligence || false,
        };
      });
      
      const { error: insertError } = await supabase
        .from('juiced_props')
        .insert(insertData);
      
      if (insertError) {
        console.error('Error inserting juiced props:', insertError);
      } else {
        console.log(`✅ Inserted ${insertData.length} juiced props (${unifiedMatchCount} with unified intelligence)`);
      }
    }
    
    // Send morning notification if we found juiced props
    if (sortedProps.length > 0) {
      const heavyCount = sortedProps.filter(p => p.juice_level === 'heavy').length;
      const withUnifiedCount = sortedProps.filter(p => p.used_unified_intelligence).length;
      
      try {
        await supabase.functions.invoke('send-push-notification', {
          body: {
            action: 'notify_morning_juice',
            data: {
              total: sortedProps.length,
              heavy: heavyCount,
              withUnified: withUnifiedCount,
              topProps: sortedProps.slice(0, 3).map(p => ({
                player: p.player_name,
                prop: p.prop_type,
                line: p.line,
                over_price: p.over_price,
                pvs_tier: p.unified_pvs_tier || 'N/A',
              })),
            },
          },
        });
        console.log('📱 Morning notification sent');
      } catch (notifyError) {
        console.error('Failed to send notification:', notifyError);
      }
    }
    
    return new Response(JSON.stringify({
      success: true,
      message: `Found ${sortedProps.length} juiced over props (${unifiedMatchCount} with unified intelligence)`,
      props: sortedProps.slice(0, 20), // Return top 20 for preview
      stats: {
        total: sortedProps.length,
        heavy: sortedProps.filter(p => p.juice_level === 'heavy').length,
        moderate: sortedProps.filter(p => p.juice_level === 'moderate').length,
        light: sortedProps.filter(p => p.juice_level === 'light').length,
        withUnifiedIntelligence: unifiedMatchCount,
      },
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error: any) {
    console.error('Error in morning-props-scanner:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
