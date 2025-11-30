import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OddsOutcome {
  name: string;
  price: number;
}

interface OddsMarket {
  key: string;
  outcomes: OddsOutcome[];
}

interface OddsBookmaker {
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
  bookmakers: OddsBookmaker[];
}

interface UserPattern {
  favorite_sports: string[];
  favorite_bet_types: string[];
  avg_odds_range: { min: number; max: number };
  win_rate_by_sport: Record<string, number>;
}

// Sport key mapping for The Odds API
const SPORT_KEYS: Record<string, string> = {
  'NBA': 'basketball_nba',
  'NFL': 'americanfootball_nfl',
  'MLB': 'baseball_mlb',
  'NHL': 'icehockey_nhl',
  'NCAAB': 'basketball_ncaab',
  'NCAAF': 'americanfootball_ncaaf',
  'Soccer': 'soccer_epl',
};

// Convert decimal odds to American odds
function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) {
    return Math.round((decimal - 1) * 100);
  } else {
    return Math.round(-100 / (decimal - 1));
  }
}

// Calculate implied probability from American odds
function americanToImplied(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await req.json();
    
    const ODDS_API_KEY = Deno.env.get('THE_ODDS_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    if (!ODDS_API_KEY) {
      throw new Error('THE_ODDS_API_KEY is not configured');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 1: Analyze user's betting patterns
    console.log('Analyzing user patterns for:', userId);
    
    const { data: userHistory, error: historyError } = await supabase
      .from('parlay_training_data')
      .select('sport, bet_type, odds, parlay_outcome')
      .eq('user_id', userId);

    if (historyError) {
      console.error('Error fetching user history:', historyError);
    }

    // Build user pattern profile
    const userPattern: UserPattern = {
      favorite_sports: [],
      favorite_bet_types: [],
      avg_odds_range: { min: -200, max: 200 },
      win_rate_by_sport: {},
    };

    if (userHistory && userHistory.length > 0) {
      // Count sport occurrences
      const sportCounts: Record<string, number> = {};
      const betTypeCounts: Record<string, number> = {};
      const sportWins: Record<string, { wins: number; total: number }> = {};
      let totalOdds = 0;
      let oddsCount = 0;

      for (const leg of userHistory) {
        if (leg.sport) {
          sportCounts[leg.sport] = (sportCounts[leg.sport] || 0) + 1;
          
          if (!sportWins[leg.sport]) {
            sportWins[leg.sport] = { wins: 0, total: 0 };
          }
          if (leg.parlay_outcome !== null) {
            sportWins[leg.sport].total++;
            if (leg.parlay_outcome) sportWins[leg.sport].wins++;
          }
        }
        if (leg.bet_type) {
          betTypeCounts[leg.bet_type] = (betTypeCounts[leg.bet_type] || 0) + 1;
        }
        if (leg.odds) {
          totalOdds += leg.odds;
          oddsCount++;
        }
      }

      // Get top sports and bet types
      userPattern.favorite_sports = Object.entries(sportCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([sport]) => sport);

      userPattern.favorite_bet_types = Object.entries(betTypeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([type]) => type);

      // Calculate win rates
      for (const [sport, stats] of Object.entries(sportWins)) {
        if (stats.total > 0) {
          userPattern.win_rate_by_sport[sport] = stats.wins / stats.total;
        }
      }

      // Calculate average odds range
      if (oddsCount > 0) {
        const avgOdds = totalOdds / oddsCount;
        userPattern.avg_odds_range = {
          min: Math.min(avgOdds - 100, -300),
          max: Math.max(avgOdds + 100, 200),
        };
      }
    }

    console.log('User pattern:', userPattern);

    // Step 2: Fetch odds from The Odds API
    // Determine which sports to fetch based on user patterns
    const sportsToFetch = userPattern.favorite_sports.length > 0 
      ? userPattern.favorite_sports 
      : ['NBA', 'NFL', 'NHL'];

    const allOdds: OddsEvent[] = [];

    for (const sport of sportsToFetch) {
      const sportKey = SPORT_KEYS[sport] || SPORT_KEYS['NBA'];
      
      try {
        const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=decimal`;
        
        console.log(`Fetching odds for ${sport}...`);
        const oddsResponse = await fetch(oddsUrl);
        
        if (oddsResponse.ok) {
          const events: OddsEvent[] = await oddsResponse.json();
          // Add sport info to each event
          for (const event of events) {
            event.sport_key = sport;
          }
          allOdds.push(...events.slice(0, 5)); // Limit to 5 events per sport
        } else {
          console.error(`Failed to fetch odds for ${sport}:`, oddsResponse.status);
        }
      } catch (error) {
        console.error(`Error fetching ${sport} odds:`, error);
      }
    }

    console.log(`Fetched ${allOdds.length} events total`);

    if (allOdds.length === 0) {
      return new Response(JSON.stringify({ 
        suggestions: [],
        message: 'No upcoming games found for your favorite sports' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Step 3: Generate suggestions based on patterns
    const suggestions = [];
    
    // Strategy 1: Single-sport parlay from favorite sport
    if (allOdds.length >= 2) {
      const favoriteSportEvents = allOdds.filter(e => 
        userPattern.favorite_sports.includes(e.sport_key)
      ).slice(0, 3);

      if (favoriteSportEvents.length >= 2) {
        const legs = [];
        let totalProb = 1;

        for (const event of favoriteSportEvents.slice(0, 3)) {
          const bookmaker = event.bookmakers[0];
          if (!bookmaker) continue;

          const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
          if (!h2hMarket) continue;

          // Pick the favorite (lower decimal odds)
          const favorite = h2hMarket.outcomes.reduce((a, b) => 
            a.price < b.price ? a : b
          );
          
          const americanOdds = decimalToAmerican(favorite.price);
          const impliedProb = americanToImplied(americanOdds);
          totalProb *= impliedProb;

          legs.push({
            description: `${favorite.name} ML vs ${event.home_team === favorite.name ? event.away_team : event.home_team}`,
            odds: americanOdds,
            impliedProbability: impliedProb,
            sport: event.sport_key,
            betType: 'moneyline',
            eventTime: event.commence_time,
          });
        }

        if (legs.length >= 2) {
          const totalOdds = legs.reduce((acc, leg) => {
            const decimal = leg.odds > 0 ? (leg.odds / 100) + 1 : (100 / Math.abs(leg.odds)) + 1;
            return acc * decimal;
          }, 1);

          const americanTotalOdds = decimalToAmerican(totalOdds);

          suggestions.push({
            legs,
            total_odds: americanTotalOdds,
            combined_probability: totalProb,
            suggestion_reason: `Based on your ${userPattern.favorite_sports[0] || 'favorite'} betting history. Favorites-only parlay with ${Math.round(totalProb * 100)}% combined probability.`,
            sport: userPattern.favorite_sports[0] || 'Mixed',
            confidence_score: Math.min(totalProb * 1.2, 0.9),
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });
        }
      }
    }

    // Strategy 2: Value parlay with underdogs
    const underdogLegs = [];
    let underdogProb = 1;

    for (const event of allOdds.slice(0, 4)) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker) continue;

      const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
      if (!h2hMarket) continue;

      // Pick slight underdog (higher odds but not crazy)
      const underdog = h2hMarket.outcomes.reduce((a, b) => 
        a.price > b.price ? a : b
      );
      
      const americanOdds = decimalToAmerican(underdog.price);
      
      // Only include reasonable underdogs (+100 to +250)
      if (americanOdds >= 100 && americanOdds <= 250) {
        const impliedProb = americanToImplied(americanOdds);
        underdogProb *= impliedProb;

        underdogLegs.push({
          description: `${underdog.name} ML vs ${event.home_team === underdog.name ? event.away_team : event.home_team}`,
          odds: americanOdds,
          impliedProbability: impliedProb,
          sport: event.sport_key,
          betType: 'moneyline',
          eventTime: event.commence_time,
        });

        if (underdogLegs.length >= 2) break;
      }
    }

    if (underdogLegs.length >= 2) {
      const totalOdds = underdogLegs.reduce((acc, leg) => {
        const decimal = leg.odds > 0 ? (leg.odds / 100) + 1 : (100 / Math.abs(leg.odds)) + 1;
        return acc * decimal;
      }, 1);

      const americanTotalOdds = decimalToAmerican(totalOdds);

      suggestions.push({
        legs: underdogLegs,
        total_odds: americanTotalOdds,
        combined_probability: underdogProb,
        suggestion_reason: `Value play! Slight underdogs with better payouts. Higher risk, higher reward.`,
        sport: 'Mixed',
        confidence_score: 0.4,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Step 4: Save suggestions to database
    if (suggestions.length > 0) {
      // Clear old suggestions for this user
      await supabase
        .from('suggested_parlays')
        .delete()
        .eq('user_id', userId);

      // Insert new suggestions
      const { error: insertError } = await supabase
        .from('suggested_parlays')
        .insert(suggestions.map(s => ({
          user_id: userId,
          legs: s.legs,
          total_odds: s.total_odds,
          combined_probability: s.combined_probability,
          suggestion_reason: s.suggestion_reason,
          sport: s.sport,
          confidence_score: s.confidence_score,
          expires_at: s.expires_at,
        })));

      if (insertError) {
        console.error('Error inserting suggestions:', insertError);
      }
    }

    console.log(`Generated ${suggestions.length} suggestions`);

    return new Response(JSON.stringify({ 
      suggestions,
      userPattern,
      message: `Generated ${suggestions.length} personalized parlay suggestions` 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error generating suggestions:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      suggestions: [] 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
