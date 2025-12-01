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
    'basketball_ncaab': 'NCAAB',
    'americanfootball_nfl': 'NFL',
    'americanfootball_ncaaf': 'NCAAF',
    'icehockey_nhl': 'NHL',
    'baseball_mlb': 'MLB',
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    console.log('🌅 Starting morning props scanner...');
    
    // Sports to scan for player props
    const sportsToScan = [
      'basketball_nba',
      'basketball_ncaab',
      'americanfootball_nfl',
      'americanfootball_ncaaf',
      'icehockey_nhl',
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
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    
    // Scan each sport
    for (const sport of sportsToScan) {
      console.log(`📊 Scanning ${sport} for juiced props...`);
      
      try {
        // Get events for today
        const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${oddsApiKey}`;
        const eventsResponse = await fetch(eventsUrl);
        
        if (!eventsResponse.ok) {
          console.log(`No events for ${sport}`);
          continue;
        }
        
        const events = await eventsResponse.json();
        const todayEvents = events.filter((e: any) => {
          const eventTime = new Date(e.commence_time);
          return eventTime >= now && eventTime <= endOfDay;
        });
        
        console.log(`Found ${todayEvents.length} events for ${sport} today`);
        
        // For each event, get player props
        for (const event of todayEvents.slice(0, 5)) { // Limit to 5 events per sport to save API calls
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
                      allJuicedProps.push({
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
                      });
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
          // Morning trap flagging for AI knowledge
          // These will be faded by lock-final-picks
        };
      });
      
      const { error: insertError } = await supabase
        .from('juiced_props')
        .insert(insertData);
      
      if (insertError) {
        console.error('Error inserting juiced props:', insertError);
      } else {
        console.log(`✅ Inserted ${insertData.length} juiced props`);
      }
    }
    
    // Send morning notification if we found juiced props
    if (sortedProps.length > 0) {
      const heavyCount = sortedProps.filter(p => p.juice_level === 'heavy').length;
      
      try {
        await supabase.functions.invoke('send-push-notification', {
          body: {
            action: 'notify_morning_juice',
            data: {
              total: sortedProps.length,
              heavy: heavyCount,
              topProps: sortedProps.slice(0, 3).map(p => ({
                player: p.player_name,
                prop: p.prop_type,
                line: p.line,
                over_price: p.over_price,
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
      message: `Found ${sortedProps.length} juiced over props`,
      props: sortedProps.slice(0, 20), // Return top 20 for preview
      stats: {
        total: sortedProps.length,
        heavy: sortedProps.filter(p => p.juice_level === 'heavy').length,
        moderate: sortedProps.filter(p => p.juice_level === 'moderate').length,
        light: sortedProps.filter(p => p.juice_level === 'light').length,
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
