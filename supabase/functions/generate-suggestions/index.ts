import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

interface SuggestionLeg {
  description: string;
  odds: number;
  impliedProbability: number;
  sport: string;
  betType: string;
  eventTime: string;
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

// Player prop markets for different sports
const PLAYER_PROP_MARKETS: Record<string, string[]> = {
  'NBA': ['player_points', 'player_rebounds', 'player_assists', 'player_threes'],
  'NCAAB': ['player_points', 'player_rebounds', 'player_assists'],
  'NFL': ['player_pass_tds', 'player_pass_yds', 'player_rush_yds', 'player_reception_yds'],
  'NCAAF': ['player_pass_tds', 'player_pass_yds', 'player_rush_yds'],
  'NHL': ['player_points', 'player_goals', 'player_assists'],
  'MLB': ['batter_hits', 'batter_total_bases', 'pitcher_strikeouts'],
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
    // Prioritize Football, Basketball, Hockey as requested
    const primarySports = ['NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB'];
    let sportsToFetch = userPattern.favorite_sports.length > 0 
      ? [...new Set([...userPattern.favorite_sports.filter(s => primarySports.includes(s)), ...primarySports])]
      : primarySports;

    // Sort sports by AI accuracy if we have metrics
    if (Object.keys(accuracyMap).length > 0) {
      sportsToFetch = sportsToFetch.sort((a, b) => {
        const aMetric = accuracyMap[`${a}_high`] || accuracyMap[`${a}_medium`];
        const bMetric = accuracyMap[`${b}_high`] || accuracyMap[`${b}_medium`];
        const aAccuracy = aMetric?.accuracy_rate || 50;
        const bAccuracy = bMetric?.accuracy_rate || 50;
        return bAccuracy - aAccuracy;
      });
      console.log('Sports prioritized by AI accuracy:', sportsToFetch);
    }

    const allOdds: OddsEvent[] = [];
    const playerPropsData: Map<string, OddsMarket[]> = new Map();

    for (const sport of sportsToFetch.slice(0, 4)) {
      const sportKey = SPORT_KEYS[sport] || SPORT_KEYS['NBA'];
      
      try {
        // Fetch standard markets (h2h, spreads, totals)
        const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=decimal`;
        
        console.log(`Fetching odds for ${sport}...`);
        const oddsResponse = await fetch(oddsUrl);
        
        if (oddsResponse.ok) {
          const events: OddsEvent[] = await oddsResponse.json();
          for (const event of events) {
            event.sport_key = sport;
          }
          allOdds.push(...events.slice(0, 6));
          
          // Fetch player props for the first few events
          const propMarkets = PLAYER_PROP_MARKETS[sport];
          if (propMarkets && events.length > 0) {
            for (const event of events.slice(0, 2)) {
              try {
                const propsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/events/${event.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${propMarkets.join(',')}&oddsFormat=decimal`;
                const propsResponse = await fetch(propsUrl);
                
                if (propsResponse.ok) {
                  const propsData = await propsResponse.json();
                  if (propsData.bookmakers && propsData.bookmakers.length > 0) {
                    playerPropsData.set(event.id, propsData.bookmakers[0].markets);
                    console.log(`Fetched ${propsData.bookmakers[0].markets?.length || 0} prop markets for ${event.home_team} vs ${event.away_team}`);
                  }
                }
              } catch (propError) {
                console.log(`Could not fetch props for event ${event.id}:`, propError);
              }
            }
          }
        } else {
          console.error(`Failed to fetch odds for ${sport}:`, oddsResponse.status);
        }
      } catch (error) {
        console.error(`Error fetching ${sport} odds:`, error);
      }
    }

    console.log(`Fetched ${allOdds.length} events total, ${playerPropsData.size} with player props`);

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
        const accuracyFactor = metric.accuracy_rate / 100;
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

    // Helper to calculate total odds from legs
    const calculateTotalOdds = (legs: SuggestionLeg[]): number => {
      const totalDecimal = legs.reduce((acc, leg) => {
        const decimal = leg.odds > 0 ? (leg.odds / 100) + 1 : (100 / Math.abs(leg.odds)) + 1;
        return acc * decimal;
      }, 1);
      return decimalToAmerican(totalDecimal);
    };
    
    // Strategy 1: Low Risk - 3 leg favorites parlay (25%+ probability)
    const favoritesLegs: SuggestionLeg[] = [];
    let favoritesProb = 1;

    for (const event of allOdds.slice(0, 5)) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker || favoritesLegs.length >= 3) continue;

      const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
      if (!h2hMarket) continue;

      // Pick heavy favorites only (odds -200 or better)
      const favorite = h2hMarket.outcomes.reduce((a, b) => a.price < b.price ? a : b);
      const americanOdds = decimalToAmerican(favorite.price);
      
      if (americanOdds <= -150 && americanOdds >= -300) {
        const impliedProb = americanToImplied(americanOdds);
        favoritesProb *= impliedProb;

        favoritesLegs.push({
          description: `${favorite.name} ML vs ${event.home_team === favorite.name ? event.away_team : event.home_team}`,
          odds: americanOdds,
          impliedProbability: impliedProb,
          sport: event.sport_key,
          betType: 'moneyline',
          eventTime: event.commence_time,
        });
      }
    }

    if (favoritesLegs.length >= 3) {
      const totalOdds = calculateTotalOdds(favoritesLegs);
      const adjustedConfidence = adjustConfidence(0.7, favoritesLegs[0].sport, 'high');
      
      suggestions.push({
        legs: favoritesLegs,
        total_odds: totalOdds,
        combined_probability: favoritesProb,
        suggestion_reason: buildReason('Low risk chalk parlay with heavy favorites. Safe play with decent odds.', favoritesLegs[0].sport, 'high'),
        sport: favoritesLegs[0].sport,
        confidence_score: adjustedConfidence,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Strategy 2: Medium Risk - 4 leg mixed parlay (10-25% probability)
    const mixedLegs: SuggestionLeg[] = [];
    let mixedProb = 1;

    for (const event of allOdds) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker || mixedLegs.length >= 4) continue;

      // Alternate between moneylines and spreads
      if (mixedLegs.length % 2 === 0) {
        const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
        if (h2hMarket) {
          const favorite = h2hMarket.outcomes.reduce((a, b) => a.price < b.price ? a : b);
          const americanOdds = decimalToAmerican(favorite.price);
          const impliedProb = americanToImplied(americanOdds);
          mixedProb *= impliedProb;

          mixedLegs.push({
            description: `${favorite.name} ML vs ${event.home_team === favorite.name ? event.away_team : event.home_team}`,
            odds: americanOdds,
            impliedProbability: impliedProb,
            sport: event.sport_key,
            betType: 'moneyline',
            eventTime: event.commence_time,
          });
        }
      } else {
        const spreadMarket = bookmaker.markets.find(m => m.key === 'spreads');
        if (spreadMarket) {
          const spread = spreadMarket.outcomes[0];
          const americanOdds = decimalToAmerican(spread.price);
          const impliedProb = americanToImplied(americanOdds);
          mixedProb *= impliedProb;

          mixedLegs.push({
            description: `${spread.name} ${spread.point! > 0 ? '+' : ''}${spread.point}`,
            odds: americanOdds,
            impliedProbability: impliedProb,
            sport: event.sport_key,
            betType: 'spread',
            eventTime: event.commence_time,
          });
        }
      }
    }

    if (mixedLegs.length >= 4) {
      const totalOdds = calculateTotalOdds(mixedLegs);
      
      suggestions.push({
        legs: mixedLegs,
        total_odds: totalOdds,
        combined_probability: mixedProb,
        suggestion_reason: buildReason('Medium risk 4-leg parlay mixing moneylines and spreads. Balanced risk/reward.', 'Mixed', 'medium'),
        sport: 'Mixed',
        confidence_score: 0.5,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Strategy 3: High Risk - 5-6 leg underdog parlay (<10% probability, big payout)
    const underdogLegs: SuggestionLeg[] = [];
    let underdogProb = 1;

    for (const event of allOdds) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker || underdogLegs.length >= 5) continue;

      const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
      if (!h2hMarket) continue;

      // Pick slight to medium underdogs (+100 to +300)
      const underdog = h2hMarket.outcomes.reduce((a, b) => a.price > b.price ? a : b);
      const americanOdds = decimalToAmerican(underdog.price);
      
      if (americanOdds >= 100 && americanOdds <= 300) {
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
      }
    }

    if (underdogLegs.length >= 4) {
      const totalOdds = calculateTotalOdds(underdogLegs);
      
      suggestions.push({
        legs: underdogLegs,
        total_odds: totalOdds,
        combined_probability: underdogProb,
        suggestion_reason: buildReason('🔥 HIGH RISK: Underdog parlay for massive payout potential. Lottery ticket play!', 'Mixed', 'low'),
        sport: 'Mixed',
        confidence_score: 0.3,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Strategy 4: Player Props Parlay (3-4 props from games)
    const propLegs: SuggestionLeg[] = [];
    let propProb = 1;

    for (const [eventId, markets] of playerPropsData) {
      if (propLegs.length >= 4) break;
      
      const event = allOdds.find(e => e.id === eventId);
      if (!event) continue;

      for (const market of markets) {
        if (propLegs.length >= 4) break;
        
        // Look for over/under props with reasonable odds
        for (const outcome of market.outcomes) {
          if (propLegs.length >= 4) break;
          
          const americanOdds = decimalToAmerican(outcome.price);
          
          // Only include props with decent odds (-150 to +150)
          if (americanOdds >= -150 && americanOdds <= 150) {
            const impliedProb = americanToImplied(americanOdds);
            propProb *= impliedProb;

            const propType = market.key.replace('player_', '').replace('_', ' ');
            propLegs.push({
              description: `${outcome.description || outcome.name} ${propType} ${outcome.point ? (outcome.name.includes('Over') ? 'O' : 'U') + outcome.point : ''}`,
              odds: americanOdds,
              impliedProbability: impliedProb,
              sport: event.sport_key,
              betType: market.key,
              eventTime: event.commence_time,
            });
            break;
          }
        }
      }
    }

    if (propLegs.length >= 3) {
      const totalOdds = calculateTotalOdds(propLegs);
      
      suggestions.push({
        legs: propLegs,
        total_odds: totalOdds,
        combined_probability: propProb,
        suggestion_reason: buildReason('Player props parlay! Individual player performances across games.', propLegs[0].sport, 'medium'),
        sport: propLegs[0].sport,
        confidence_score: 0.45,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Strategy 5: Totals parlay (over/unders)
    const totalsLegs: SuggestionLeg[] = [];
    let totalsProb = 1;

    for (const event of allOdds) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker || totalsLegs.length >= 4) continue;

      const totalsMarket = bookmaker.markets.find(m => m.key === 'totals');
      if (!totalsMarket) continue;

      // Pick over or under based on odds
      const bestTotal = totalsMarket.outcomes.reduce((a, b) => a.price < b.price ? a : b);
      const americanOdds = decimalToAmerican(bestTotal.price);
      const impliedProb = americanToImplied(americanOdds);
      totalsProb *= impliedProb;

      totalsLegs.push({
        description: `${event.home_team} vs ${event.away_team} ${bestTotal.name} ${bestTotal.point}`,
        odds: americanOdds,
        impliedProbability: impliedProb,
        sport: event.sport_key,
        betType: 'total',
        eventTime: event.commence_time,
      });
    }

    if (totalsLegs.length >= 3) {
      const totalOdds = calculateTotalOdds(totalsLegs);
      
      suggestions.push({
        legs: totalsLegs,
        total_odds: totalOdds,
        combined_probability: totalsProb,
        suggestion_reason: buildReason('Totals-only parlay focusing on game over/unders. Great for high-scoring matchups.', totalsLegs[0].sport, 'medium'),
        sport: 'Mixed',
        confidence_score: 0.5,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // Strategy 6: High accuracy sport-specific suggestion
    const bestAccuracySport = Object.entries(accuracyMap)
      .filter(([_, metric]) => metric.total_suggestions >= 5 && metric.accuracy_rate >= 55)
      .sort((a, b) => b[1].accuracy_rate - a[1].accuracy_rate)[0];

    if (bestAccuracySport) {
      const [key, metric] = bestAccuracySport;
      const sport = metric.sport;
      const sportEvents = allOdds.filter(e => e.sport_key === sport).slice(0, 3);

      if (sportEvents.length >= 2) {
        const legs: SuggestionLeg[] = [];
        let totalProb = 1;

        for (const event of sportEvents) {
          const bookmaker = event.bookmakers[0];
          if (!bookmaker) continue;

          const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
          if (!h2hMarket) continue;

          const favorite = h2hMarket.outcomes.reduce((a, b) => a.price < b.price ? a : b);
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
          const totalOdds = calculateTotalOdds(legs);

          suggestions.push({
            legs,
            total_odds: totalOdds,
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
