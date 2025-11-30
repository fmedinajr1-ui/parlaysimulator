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

interface AccuracyMetric {
  sport: string;
  confidence_level: string;
  total_suggestions: number;
  total_won: number;
  accuracy_rate: number;
  roi_percentage: number;
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

    // Step 1: Fetch AI suggestion accuracy metrics for learning
    console.log('Fetching AI accuracy metrics for learning...');
    const { data: accuracyMetrics, error: accuracyError } = await supabase
      .rpc('get_suggestion_accuracy_stats');

    if (accuracyError) {
      console.error('Error fetching accuracy metrics:', accuracyError);
    }

    // Build accuracy map for quick lookup
    const accuracyMap: Record<string, AccuracyMetric> = {};
    if (accuracyMetrics) {
      for (const metric of accuracyMetrics) {
        const key = `${metric.sport}_${metric.confidence_level}`;
        accuracyMap[key] = metric;
      }
    }

    console.log('Accuracy metrics loaded:', Object.keys(accuracyMap).length, 'entries');

    // Step 2: Analyze user's betting patterns
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

    // Step 3: Fetch odds from The Odds API
    // Prioritize sports where AI has higher accuracy
    let sportsToFetch = userPattern.favorite_sports.length > 0 
      ? userPattern.favorite_sports 
      : ['NBA', 'NFL', 'NHL'];

    // Sort sports by AI accuracy if we have metrics
    if (Object.keys(accuracyMap).length > 0) {
      sportsToFetch = sportsToFetch.sort((a, b) => {
        const aMetric = accuracyMap[`${a}_high`] || accuracyMap[`${a}_medium`];
        const bMetric = accuracyMap[`${b}_high`] || accuracyMap[`${b}_medium`];
        const aAccuracy = aMetric?.accuracy_rate || 50;
        const bAccuracy = bMetric?.accuracy_rate || 50;
        return bAccuracy - aAccuracy; // Higher accuracy first
      });
      console.log('Sports prioritized by AI accuracy:', sportsToFetch);
    }

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

    // Step 4: Generate suggestions based on patterns AND AI learning
    const suggestions = [];
    
    // Helper to adjust confidence based on historical accuracy
    const adjustConfidence = (baseConfidence: number, sport: string, confidenceLevel: string): number => {
      const metric = accuracyMap[`${sport}_${confidenceLevel}`];
      if (metric && metric.total_suggestions >= 5) {
        // Adjust confidence based on actual historical performance
        const accuracyFactor = metric.accuracy_rate / 100;
        // Weight: 70% base confidence, 30% historical accuracy
        return baseConfidence * 0.7 + accuracyFactor * 0.3;
      }
      return baseConfidence;
    };

    // Helper to build suggestion reason with learning context
    const buildReason = (baseReason: string, sport: string, confidenceLevel: string): string => {
      const metric = accuracyMap[`${sport}_${confidenceLevel}`];
      if (metric && metric.total_suggestions >= 5) {
        const roiNote = metric.roi_percentage >= 0 
          ? `+${metric.roi_percentage.toFixed(0)}% ROI` 
          : `${metric.roi_percentage.toFixed(0)}% ROI`;
        return `${baseReason} AI track record: ${metric.accuracy_rate.toFixed(0)}% accuracy (${metric.total_won}/${metric.total_suggestions} won, ${roiNote})`;
      }
      return baseReason;
    };
    
    // Strategy 1: Single-sport parlay from favorite sport (favorites-focused)
    if (allOdds.length >= 2) {
      const favoriteSportEvents = allOdds.filter(e => 
        userPattern.favorite_sports.includes(e.sport_key)
      ).slice(0, 3);

      if (favoriteSportEvents.length >= 2) {
        const legs = [];
        let totalProb = 1;
        const primarySport = favoriteSportEvents[0]?.sport_key || 'Mixed';

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
          const baseConfidence = Math.min(totalProb * 1.2, 0.9);
          const adjustedConfidence = adjustConfidence(baseConfidence, primarySport, 'high');
          const confidenceLevel = adjustedConfidence >= 0.6 ? 'high' : adjustedConfidence >= 0.4 ? 'medium' : 'low';

          const baseReason = `Based on your ${userPattern.favorite_sports[0] || 'favorite'} betting history. Favorites-only parlay with ${Math.round(totalProb * 100)}% combined probability.`;

          suggestions.push({
            legs,
            total_odds: americanTotalOdds,
            combined_probability: totalProb,
            suggestion_reason: buildReason(baseReason, primarySport, confidenceLevel),
            sport: primarySport,
            confidence_score: adjustedConfidence,
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
      const baseConfidence = 0.4;
      const adjustedConfidence = adjustConfidence(baseConfidence, 'Mixed', 'low');

      const baseReason = `Value play! Slight underdogs with better payouts. Higher risk, higher reward.`;

      suggestions.push({
        legs: underdogLegs,
        total_odds: americanTotalOdds,
        combined_probability: underdogProb,
        suggestion_reason: buildReason(baseReason, 'Mixed', 'low'),
        sport: 'Mixed',
        confidence_score: adjustedConfidence,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Strategy 3: High accuracy sport-specific suggestion (if we have good accuracy data)
    const bestAccuracySport = Object.entries(accuracyMap)
      .filter(([_, metric]) => metric.total_suggestions >= 5 && metric.accuracy_rate >= 55)
      .sort((a, b) => b[1].accuracy_rate - a[1].accuracy_rate)[0];

    if (bestAccuracySport) {
      const [key, metric] = bestAccuracySport;
      const sport = metric.sport;
      const sportEvents = allOdds.filter(e => e.sport_key === sport).slice(0, 2);

      if (sportEvents.length >= 2) {
        const legs = [];
        let totalProb = 1;

        for (const event of sportEvents) {
          const bookmaker = event.bookmakers[0];
          if (!bookmaker) continue;

          const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
          if (!h2hMarket) continue;

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
            suggestion_reason: `🔥 HOT PICK: ${sport} suggestions have ${metric.accuracy_rate.toFixed(0)}% accuracy (${metric.total_won}/${metric.total_suggestions} won). Based on AI learning from historical performance.`,
            sport: sport,
            confidence_score: Math.min(metric.accuracy_rate / 100 * 1.1, 0.95),
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });
        }
      }
    }

    // Step 5: Save suggestions to database
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

    console.log(`Generated ${suggestions.length} suggestions with AI learning`);

    return new Response(JSON.stringify({ 
      suggestions,
      userPattern,
      accuracyMetrics: accuracyMetrics || [],
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
