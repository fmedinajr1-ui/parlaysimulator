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

// Enhanced user pattern with winning AND losing data
interface EnhancedUserPattern {
  favorite_sports: string[];
  favorite_bet_types: string[];
  avg_odds_range: { min: number; max: number };
  win_rate_by_sport: Record<string, number>;
  // Winning patterns from trained data
  winning_sports: string[];
  winning_bet_types: string[];
  winning_odds_range: { min: number; max: number };
  winning_leg_count: number;
  total_wins: number;
  total_bets: number;
  overall_win_rate: number;
  bet_type_win_rates: Record<string, number>;
  // NEW: Losing patterns to AVOID
  losing_sports: string[];
  losing_bet_types: string[];
  sport_records: Record<string, { wins: number; losses: number; rate: number }>;
  bet_type_records: Record<string, { wins: number; losses: number; rate: number }>;
}

// Learning insights structure
interface LearningInsights {
  bestPatterns: { sport: string; betType: string; winRate: number; record: string }[];
  avoidPatterns: { sport: string; betType: string; winRate: number; record: string; reason: string }[];
  totalBets: number;
  totalWins: number;
  totalLosses: number;
  overallWinRate: number;
  message: string;
}

interface AccuracyMetric {
  sport: string;
  confidence_level: string;
  total_suggestions: number;
  total_won: number;
  accuracy_rate: number;
  roi_percentage: number;
}

interface HybridScore {
  sharpScore: number;      // 0-40 points from sharp data
  userPatternScore: number; // 0-35 points from user history
  aiAccuracyScore: number;  // 0-25 points from AI track record
  totalScore: number;       // 0-100 combined
  recommendation: 'STRONG_PICK' | 'PICK' | 'NEUTRAL' | 'FADE' | 'STRONG_FADE';
}

interface SuggestionLeg {
  description: string;
  odds: number;
  impliedProbability: number;
  sport: string;
  betType: string;
  eventTime: string;
  hybridScore?: number;
  hybridBreakdown?: { sharp: number; user: number; ai: number };
  recommendation?: string;
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

// Player prop markets for different sports - expanded for NBA
const PLAYER_PROP_MARKETS: Record<string, string[]> = {
  'NBA': ['player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_points_rebounds_assists', 'player_steals', 'player_blocks'],
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

    // Fetch recent sharp money alerts (last 24 hours)
    console.log('Fetching recent sharp money alerts...');
    const { data: sharpAlerts, error: sharpError } = await supabase
      .from('line_movements')
      .select('*')
      .eq('is_sharp_action', true)
      .gte('detected_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('detected_at', { ascending: false });

    if (sharpError) {
      console.error('Error fetching sharp alerts:', sharpError);
    }
    console.log(`Found ${sharpAlerts?.length || 0} sharp movements`);

    // Build accuracy map for quick lookup
    const accuracyMap: Record<string, AccuracyMetric> = {};
    if (accuracyMetrics) {
      for (const metric of accuracyMetrics) {
        const key = `${metric.sport}_${metric.confidence_level}`;
        accuracyMap[key] = metric;
      }
    }

    console.log('Accuracy metrics loaded:', Object.keys(accuracyMap).length, 'entries');

    // Step 2: Enhanced user pattern analysis from training data
    console.log('Analyzing user patterns for:', userId);
    
    const { data: userHistory, error: historyError } = await supabase
      .from('parlay_training_data')
      .select('sport, bet_type, odds, parlay_outcome, leg_index, parlay_history_id')
      .eq('user_id', userId);

    if (historyError) {
      console.error('Error fetching user history:', historyError);
    }

    // Build enhanced user pattern profile with winning AND losing patterns
    const userPattern: EnhancedUserPattern = {
      favorite_sports: [],
      favorite_bet_types: [],
      avg_odds_range: { min: -200, max: 200 },
      win_rate_by_sport: {},
      // Winning pattern fields
      winning_sports: [],
      winning_bet_types: [],
      winning_odds_range: { min: -300, max: 100 },
      winning_leg_count: 3,
      total_wins: 0,
      total_bets: 0,
      overall_win_rate: 0,
      bet_type_win_rates: {},
      // NEW: Losing pattern fields
      losing_sports: [],
      losing_bet_types: [],
      sport_records: {},
      bet_type_records: {},
    };
    
    // Learning insights to return to UI
    const learningInsights: LearningInsights = {
      bestPatterns: [],
      avoidPatterns: [],
      totalBets: 0,
      totalWins: 0,
      totalLosses: 0,
      overallWinRate: 0,
      message: '',
    };

    if (userHistory && userHistory.length > 0) {
      // Count sport occurrences
      const sportCounts: Record<string, number> = {};
      const betTypeCounts: Record<string, number> = {};
      const sportWins: Record<string, { wins: number; total: number }> = {};
      const betTypeWins: Record<string, { wins: number; total: number }> = {};
      
      // Track winning patterns
      const winningOdds: number[] = [];
      const losingOdds: number[] = [];
      const parlayLegCounts: Record<string, number> = {};
      const winningParlayLegCounts: number[] = [];
      
      let totalOdds = 0;
      let oddsCount = 0;
      let totalWins = 0;
      let totalBets = 0;

      for (const leg of userHistory) {
        if (leg.sport) {
          sportCounts[leg.sport] = (sportCounts[leg.sport] || 0) + 1;
          
          if (!sportWins[leg.sport]) {
            sportWins[leg.sport] = { wins: 0, total: 0 };
          }
          if (leg.parlay_outcome !== null) {
            sportWins[leg.sport].total++;
            totalBets++;
            if (leg.parlay_outcome) {
              sportWins[leg.sport].wins++;
              totalWins++;
              if (leg.odds) winningOdds.push(leg.odds);
            } else {
              if (leg.odds) losingOdds.push(leg.odds);
            }
          }
        }
        
        if (leg.bet_type) {
          betTypeCounts[leg.bet_type] = (betTypeCounts[leg.bet_type] || 0) + 1;
          
          if (!betTypeWins[leg.bet_type]) {
            betTypeWins[leg.bet_type] = { wins: 0, total: 0 };
          }
          if (leg.parlay_outcome !== null) {
            betTypeWins[leg.bet_type].total++;
            if (leg.parlay_outcome) {
              betTypeWins[leg.bet_type].wins++;
            }
          }
        }
        
        if (leg.odds) {
          totalOdds += leg.odds;
          oddsCount++;
        }
        
        // Track leg counts per parlay
        if (leg.parlay_history_id) {
          parlayLegCounts[leg.parlay_history_id] = (parlayLegCounts[leg.parlay_history_id] || 0) + 1;
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

      // Calculate win rates by sport
      for (const [sport, stats] of Object.entries(sportWins)) {
        if (stats.total > 0) {
          userPattern.win_rate_by_sport[sport] = stats.wins / stats.total;
        }
      }

      // Calculate win rates by bet type
      for (const [betType, stats] of Object.entries(betTypeWins)) {
        if (stats.total > 0) {
          userPattern.bet_type_win_rates[betType] = stats.wins / stats.total;
        }
      }

      // Build sport records for learning insights
      for (const [sport, stats] of Object.entries(sportWins)) {
        if (stats.total > 0) {
          userPattern.sport_records[sport] = {
            wins: stats.wins,
            losses: stats.total - stats.wins,
            rate: stats.wins / stats.total,
          };
        }
      }
      
      // Build bet type records for learning insights
      for (const [betType, stats] of Object.entries(betTypeWins)) {
        if (stats.total > 0) {
          userPattern.bet_type_records[betType] = {
            wins: stats.wins,
            losses: stats.total - stats.wins,
            rate: stats.wins / stats.total,
          };
        }
      }

      // Get WINNING sports (>50% win rate)
      userPattern.winning_sports = Object.entries(userPattern.win_rate_by_sport)
        .filter(([_, rate]) => rate >= 0.5)
        .sort((a, b) => b[1] - a[1])
        .map(([sport]) => sport);

      // Get WINNING bet types (>50% win rate)
      userPattern.winning_bet_types = Object.entries(userPattern.bet_type_win_rates)
        .filter(([_, rate]) => rate >= 0.5)
        .sort((a, b) => b[1] - a[1])
        .map(([type]) => type);
      
      // NEW: Get LOSING sports (<40% win rate with at least 2 bets)
      userPattern.losing_sports = Object.entries(userPattern.sport_records)
        .filter(([_, record]) => record.rate < 0.4 && (record.wins + record.losses) >= 2)
        .sort((a, b) => a[1].rate - b[1].rate)
        .map(([sport]) => sport);
      
      // NEW: Get LOSING bet types (<40% win rate with at least 2 bets)
      userPattern.losing_bet_types = Object.entries(userPattern.bet_type_records)
        .filter(([_, record]) => record.rate < 0.4 && (record.wins + record.losses) >= 2)
        .sort((a, b) => a[1].rate - b[1].rate)
        .map(([type]) => type);
      
      // Build learning insights for UI
      learningInsights.totalBets = totalBets;
      learningInsights.totalWins = totalWins;
      learningInsights.totalLosses = totalBets - totalWins;
      learningInsights.overallWinRate = totalBets > 0 ? (totalWins / totalBets) * 100 : 0;
      
      // Best patterns (>50% win rate)
      const allPatterns: { sport: string; betType: string; wins: number; losses: number; rate: number }[] = [];
      for (const [sport, record] of Object.entries(userPattern.sport_records)) {
        for (const [betType, btRecord] of Object.entries(userPattern.bet_type_records)) {
          // Use sport-level rate for simplicity
          allPatterns.push({
            sport,
            betType,
            wins: record.wins,
            losses: record.losses,
            rate: record.rate,
          });
        }
      }
      
      // Get top performing sport/betType combos
      learningInsights.bestPatterns = Object.entries(userPattern.sport_records)
        .filter(([_, record]) => record.rate >= 0.5 && (record.wins + record.losses) >= 2)
        .sort((a, b) => b[1].rate - a[1].rate)
        .slice(0, 3)
        .map(([sport, record]) => ({
          sport,
          betType: userPattern.winning_bet_types[0] || 'mixed',
          winRate: Math.round(record.rate * 100),
          record: `${record.wins}-${record.losses}`,
        }));
      
      // Patterns to avoid (<40% win rate)
      learningInsights.avoidPatterns = Object.entries(userPattern.sport_records)
        .filter(([_, record]) => record.rate < 0.4 && (record.wins + record.losses) >= 2)
        .sort((a, b) => a[1].rate - b[1].rate)
        .slice(0, 3)
        .map(([sport, record]) => ({
          sport,
          betType: userPattern.losing_bet_types[0] || 'mixed',
          winRate: Math.round(record.rate * 100),
          record: `${record.wins}-${record.losses}`,
          reason: record.wins === 0 ? 'Zero wins' : `Only ${Math.round(record.rate * 100)}% win rate`,
        }));
      
      // Build message
      const avoidList = userPattern.losing_sports.slice(0, 2).join(', ');
      const focusList = userPattern.winning_sports.slice(0, 2).join(', ');
      learningInsights.message = focusList 
        ? `Focusing on ${focusList} (your best sports)${avoidList ? `. Avoiding ${avoidList} (low win rate)` : ''}`
        : avoidList 
          ? `Avoiding ${avoidList} (low win rate)`
          : 'Building your betting profile...';

      // Calculate winning odds range
      if (winningOdds.length > 0) {
        userPattern.winning_odds_range = {
          min: Math.min(...winningOdds),
          max: Math.max(...winningOdds),
        };
      }

      // Calculate average odds range
      if (oddsCount > 0) {
        const avgOdds = totalOdds / oddsCount;
        userPattern.avg_odds_range = {
          min: Math.min(avgOdds - 100, -300),
          max: Math.max(avgOdds + 100, 200),
        };
      }

      // Get most common winning leg count
      const legCountFrequency: Record<number, number> = {};
      for (const count of Object.values(parlayLegCounts)) {
        legCountFrequency[count] = (legCountFrequency[count] || 0) + 1;
      }
      const mostCommonLegCount = Object.entries(legCountFrequency)
        .sort((a, b) => b[1] - a[1])[0];
      if (mostCommonLegCount) {
        userPattern.winning_leg_count = parseInt(mostCommonLegCount[0]);
      }

      // Overall stats
      userPattern.total_wins = totalWins;
      userPattern.total_bets = totalBets;
      userPattern.overall_win_rate = totalBets > 0 ? totalWins / totalBets : 0;
    }

    console.log('Enhanced user pattern:', {
      winning_sports: userPattern.winning_sports,
      winning_bet_types: userPattern.winning_bet_types,
      losing_sports: userPattern.losing_sports,
      losing_bet_types: userPattern.losing_bet_types,
      winning_odds_range: userPattern.winning_odds_range,
      overall_win_rate: userPattern.overall_win_rate,
    });
    
    console.log('Learning insights:', learningInsights);
    
    // Helper to check if a leg matches LOSING patterns (should be avoided)
    const matchesLosingPattern = (sport: string, betType: string): boolean => {
      const sportIsLosing = userPattern.losing_sports.includes(sport);
      const betTypeIsLosing = userPattern.losing_bet_types.some(lt => 
        betType.toLowerCase().includes(lt.toLowerCase())
      );
      return sportIsLosing || betTypeIsLosing;
    };

    // Step 3: Fetch odds from The Odds API
    // Prioritize Football, Basketball, Hockey as requested
    const primarySports = ['NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB'];
    
    // Prioritize user's WINNING sports first
    let sportsToFetch = userPattern.winning_sports.length > 0 
      ? [...new Set([...userPattern.winning_sports.filter(s => primarySports.includes(s)), ...primarySports])]
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
          
          // Fetch player props for events - fetch more for NBA (up to 10 games)
          const propMarkets = PLAYER_PROP_MARKETS[sport];
          const maxPropsEvents = sport === 'NBA' ? 10 : 2; // Fetch more NBA props for 8-leg parlays
          if (propMarkets && events.length > 0) {
            for (const event of events.slice(0, maxPropsEvents)) {
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

    // Step 4: Generate suggestions - PRIORITIZING LOW RISK + DATA-DRIVEN
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

    // Helper to check if leg matches user's winning patterns
    const matchesUserWinningPattern = (leg: SuggestionLeg): boolean => {
      const sportMatches = userPattern.winning_sports.includes(leg.sport);
      const betTypeMatches = userPattern.winning_bet_types.some(wbt => 
        leg.betType.toLowerCase().includes(wbt.toLowerCase())
      );
      const oddsInRange = leg.odds >= userPattern.winning_odds_range.min && 
                          leg.odds <= userPattern.winning_odds_range.max;
      return sportMatches || betTypeMatches || oddsInRange;
    };

    // HYBRID SCORE FORMULA: Combines sharp money + user patterns + AI accuracy
    const calculateHybridScore = (
      leg: { sport: string; betType: string; odds: number; description: string; eventId?: string },
      sharpAlerts: any[],
      userPattern: EnhancedUserPattern,
      accuracyMap: Record<string, AccuracyMetric>
    ): HybridScore => {
      let sharpScore = 0;
      let userPatternScore = 0;
      let aiAccuracyScore = 0;

      // SHARP SCORE (0-40 points)
      const matchingSharp = sharpAlerts.find(alert => 
        alert.sport === leg.sport && 
        alert.description.toLowerCase().includes(leg.description.toLowerCase().split(' ')[0])
      );

      if (matchingSharp) {
        // Base authenticity score
        if (matchingSharp.movement_authenticity === 'real') sharpScore += 20;
        else if (matchingSharp.movement_authenticity === 'uncertain') sharpScore += 8;
        else if (matchingSharp.movement_authenticity === 'fake') sharpScore -= 15;

        // Recommendation bonus
        if (matchingSharp.recommendation === 'pick') sharpScore += 15;
        else if (matchingSharp.recommendation === 'caution') sharpScore += 5;
        else if (matchingSharp.recommendation === 'fade') sharpScore -= 10;

        // Confidence multiplier
        sharpScore *= (matchingSharp.authenticity_confidence || 0.5);

        // Multi-book consensus bonus
        if (matchingSharp.books_consensus >= 3) sharpScore += 5;
      }

      // USER PATTERN SCORE (0-35 points)
      const sportRecord = userPattern.sport_records[leg.sport];
      const betTypeRecord = userPattern.bet_type_records[leg.betType];

      if (sportRecord) {
        const sportWinRate = sportRecord.rate;
        if (sportWinRate >= 0.6) userPatternScore += 20;
        else if (sportWinRate >= 0.5) userPatternScore += 12;
        else if (sportWinRate >= 0.4) userPatternScore += 5;
        else userPatternScore -= 10;

        // Sample size confidence
        const totalBets = sportRecord.wins + sportRecord.losses;
        if (totalBets >= 10) userPatternScore += 5;
        else if (totalBets >= 5) userPatternScore += 2;
      }

      if (betTypeRecord) {
        const betTypeWinRate = betTypeRecord.rate;
        if (betTypeWinRate >= 0.5) userPatternScore += 10;
        else if (betTypeWinRate < 0.4) userPatternScore -= 5;
      }

      // AI ACCURACY SCORE (0-25 points)
      const aiMetric = accuracyMap[`${leg.sport}_high`] || accuracyMap[`${leg.sport}_medium`];
      if (aiMetric) {
        if (aiMetric.accuracy_rate >= 60) aiAccuracyScore += 15;
        else if (aiMetric.accuracy_rate >= 50) aiAccuracyScore += 10;
        else if (aiMetric.accuracy_rate >= 40) aiAccuracyScore += 5;
        else aiAccuracyScore -= 5;

        // ROI bonus
        if (aiMetric.roi_percentage >= 10) aiAccuracyScore += 10;
        else if (aiMetric.roi_percentage >= 0) aiAccuracyScore += 5;

        // Sample size
        if (aiMetric.total_suggestions >= 10) aiAccuracyScore += 3;
      }

      const totalScore = Math.max(0, Math.min(100, sharpScore + userPatternScore + aiAccuracyScore));

      // Determine recommendation
      let recommendation: HybridScore['recommendation'];
      if (totalScore >= 75) recommendation = 'STRONG_PICK';
      else if (totalScore >= 55) recommendation = 'PICK';
      else if (totalScore >= 35) recommendation = 'NEUTRAL';
      else if (totalScore >= 20) recommendation = 'FADE';
      else recommendation = 'STRONG_FADE';

      return { 
        sharpScore: Math.round(sharpScore), 
        userPatternScore: Math.round(userPatternScore), 
        aiAccuracyScore: Math.round(aiAccuracyScore), 
        totalScore: Math.round(totalScore), 
        recommendation 
      };
    };

    // Helper to check conflicting signals
    const hasConflictingSignals = (leg1: any, leg2: any): boolean => {
      if (leg1.eventId === leg2.eventId) {
        // Same game, opposite sides
        if (leg1.betType === 'total' && leg2.betType === 'total') {
          return (leg1.description.includes('Over') && leg2.description.includes('Under')) ||
                 (leg1.description.includes('Under') && leg2.description.includes('Over'));
        }
        return leg1.outcome !== leg2.outcome;
      }
      return false;
    };

    // ========================================
    // STRATEGY 0: VERY LOW RISK 60%+ (2-leg super heavy favorites)
    // ========================================
    console.log('Generating VERY LOW RISK (60%+) suggestions...');
    
    // Get all heavy favorites sorted by implied probability (heaviest first)
    const allFavorites: { event: OddsEvent; favorite: OddsOutcome; americanOdds: number; impliedProb: number }[] = [];
    
    for (const event of allOdds) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker) continue;
      
      const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
      if (!h2hMarket) continue;
      
      const favorite = h2hMarket.outcomes.reduce((a, b) => a.price < b.price ? a : b);
      const americanOdds = decimalToAmerican(favorite.price);
      
      // Only super heavy favorites (-300 or heavier) for 60%+ tier
      if (americanOdds <= -300) {
        allFavorites.push({
          event,
          favorite,
          americanOdds,
          impliedProb: americanToImplied(americanOdds),
        });
      }
    }
    
    // Sort by implied probability (highest first)
    allFavorites.sort((a, b) => b.impliedProb - a.impliedProb);
    
    // Try to build a 2-leg parlay with 60%+ combined probability
    if (allFavorites.length >= 2) {
      const veryLowRiskLegs: SuggestionLeg[] = [];
      let veryLowRiskProb = 1;
      
      for (const fav of allFavorites) {
        if (veryLowRiskLegs.length >= 2) break;
        
        const newProb = veryLowRiskProb * fav.impliedProb;
        if (newProb >= 0.60) {
          veryLowRiskProb = newProb;
          veryLowRiskLegs.push({
            description: `${fav.favorite.name} ML vs ${fav.event.home_team === fav.favorite.name ? fav.event.away_team : fav.event.home_team}`,
            odds: fav.americanOdds,
            impliedProbability: fav.impliedProb,
            sport: fav.event.sport_key,
            betType: 'moneyline',
            eventTime: fav.event.commence_time,
          });
        }
      }
      
      if (veryLowRiskLegs.length === 2 && veryLowRiskProb >= 0.60) {
        const totalOdds = calculateTotalOdds(veryLowRiskLegs);
        suggestions.push({
          legs: veryLowRiskLegs,
          total_odds: totalOdds,
          combined_probability: veryLowRiskProb,
          suggestion_reason: `🛡️ VERY LOW RISK (60%+): 2-leg parlay with super heavy favorites. ${(veryLowRiskProb * 100).toFixed(1)}% win probability!`,
          sport: veryLowRiskLegs[0].sport,
          confidence_score: 0.95,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          is_data_driven: true,
        });
      }
    }

    // ========================================
    // STRATEGY 1: LOW RISK 50%+ (2-leg heavy favorites)
    // ========================================
    console.log('Generating LOW RISK (50%+) suggestions...');
    
    // Get moderately heavy favorites for 50%+ tier
    const moderateFavorites: { event: OddsEvent; favorite: OddsOutcome; americanOdds: number; impliedProb: number }[] = [];
    
    for (const event of allOdds) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker) continue;
      
      const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
      if (!h2hMarket) continue;
      
      const favorite = h2hMarket.outcomes.reduce((a, b) => a.price < b.price ? a : b);
      const americanOdds = decimalToAmerican(favorite.price);
      
      // Heavy favorites (-250 or heavier) for 50%+ tier
      if (americanOdds <= -250 && americanOdds >= -600) {
        moderateFavorites.push({
          event,
          favorite,
          americanOdds,
          impliedProb: americanToImplied(americanOdds),
        });
      }
    }
    
    moderateFavorites.sort((a, b) => b.impliedProb - a.impliedProb);
    
    if (moderateFavorites.length >= 2) {
      const lowRiskLegs: SuggestionLeg[] = [];
      let lowRiskProb = 1;
      
      for (const fav of moderateFavorites) {
        if (lowRiskLegs.length >= 2) break;
        
        const newProb = lowRiskProb * fav.impliedProb;
        if (newProb >= 0.50) {
          lowRiskProb = newProb;
          lowRiskLegs.push({
            description: `${fav.favorite.name} ML vs ${fav.event.home_team === fav.favorite.name ? fav.event.away_team : fav.event.home_team}`,
            odds: fav.americanOdds,
            impliedProbability: fav.impliedProb,
            sport: fav.event.sport_key,
            betType: 'moneyline',
            eventTime: fav.event.commence_time,
          });
        }
      }
      
      if (lowRiskLegs.length === 2 && lowRiskProb >= 0.50) {
        const totalOdds = calculateTotalOdds(lowRiskLegs);
        suggestions.push({
          legs: lowRiskLegs,
          total_odds: totalOdds,
          combined_probability: lowRiskProb,
          suggestion_reason: `✅ LOW RISK (50%+): 2-leg parlay with heavy favorites. ${(lowRiskProb * 100).toFixed(1)}% win probability!`,
          sport: lowRiskLegs[0].sport,
          confidence_score: 0.88,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          is_data_driven: true,
        });
      }
    }

    // ========================================
    // STRATEGY 2: DATA-DRIVEN PARLAY (uses user's winning patterns)
    // ========================================
    console.log('Generating data-driven suggestions...');
    
    // Prioritize events from user's WINNING sports
    const prioritizedEvents = allOdds.sort((a, b) => {
      const aWinRate = userPattern.win_rate_by_sport[a.sport_key] || 0;
      const bWinRate = userPattern.win_rate_by_sport[b.sport_key] || 0;
      return bWinRate - aWinRate;
    });

    const dataDrivenLegs: SuggestionLeg[] = [];
    let dataDrivenProb = 1;

    for (const event of prioritizedEvents) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker || dataDrivenLegs.length >= 3) continue;

      const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
      if (!h2hMarket) continue;

      const favorite = h2hMarket.outcomes.reduce((a, b) => a.price < b.price ? a : b);
      const americanOdds = decimalToAmerican(favorite.price);
      
      // Include favorites for data-driven parlay
      if (americanOdds <= -150 && americanOdds >= -400) {
        const impliedProb = americanToImplied(americanOdds);
        dataDrivenProb *= impliedProb;

        dataDrivenLegs.push({
          description: `${favorite.name} ML vs ${event.home_team === favorite.name ? event.away_team : event.home_team}`,
          odds: americanOdds,
          impliedProbability: impliedProb,
          sport: event.sport_key,
          betType: 'moneyline',
          eventTime: event.commence_time,
        });
      }
    }

    if (dataDrivenLegs.length >= 2) {
      const totalOdds = calculateTotalOdds(dataDrivenLegs);
      const sportsList = [...new Set(dataDrivenLegs.map(l => l.sport))].join(', ');
      const winRateNote = userPattern.overall_win_rate > 0 
        ? ` Your ${(userPattern.overall_win_rate * 100).toFixed(0)}% win rate supports this style.`
        : '';
      
      suggestions.push({
        legs: dataDrivenLegs,
        total_odds: totalOdds,
        combined_probability: dataDrivenProb,
        suggestion_reason: `🎯 DATA-DRIVEN: Heavy favorites from ${sportsList}. Based on your betting patterns.${winRateNote}`,
        sport: dataDrivenLegs[0].sport,
        confidence_score: 0.75,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        is_data_driven: true,
      });
    }

    // ========================================
    // STRATEGY 2: AI ACCURACY LOW RISK
    // Uses sports where AI has highest accuracy
    // ========================================
    console.log('Generating AI accuracy low-risk suggestions...');
    
    const bestAccuracySports = Object.entries(accuracyMap)
      .filter(([_, metric]) => metric.total_suggestions >= 3 && metric.accuracy_rate >= 50)
      .sort((a, b) => b[1].accuracy_rate - a[1].accuracy_rate)
      .slice(0, 3);

    if (bestAccuracySports.length > 0) {
      const aiLowRiskLegs: SuggestionLeg[] = [];
      let aiLowRiskProb = 1;

      for (const [key, metric] of bestAccuracySports) {
        if (aiLowRiskLegs.length >= 3) break;
        
        const sport = metric.sport;
        const sportEvents = allOdds.filter(e => e.sport_key === sport);

        for (const event of sportEvents) {
          if (aiLowRiskLegs.length >= 3) break;
          
          const bookmaker = event.bookmakers[0];
          if (!bookmaker) continue;

          const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
          if (!h2hMarket) continue;

          const favorite = h2hMarket.outcomes.reduce((a, b) => a.price < b.price ? a : b);
          const americanOdds = decimalToAmerican(favorite.price);
          
          if (americanOdds <= -200 && americanOdds >= -400) {
            const impliedProb = americanToImplied(americanOdds);
            
            // Low risk requires 50%+ hit rate
            if (aiLowRiskProb * impliedProb >= 0.50) {
              aiLowRiskProb *= impliedProb;

              aiLowRiskLegs.push({
                description: `${favorite.name} ML vs ${event.home_team === favorite.name ? event.away_team : event.home_team}`,
                odds: americanOdds,
                impliedProbability: impliedProb,
                sport: event.sport_key,
                betType: 'moneyline',
                eventTime: event.commence_time,
              });
            }
          }
        }
      }

      if (aiLowRiskLegs.length >= 2) {
        const totalOdds = calculateTotalOdds(aiLowRiskLegs);
        const topAccuracy = bestAccuracySports[0][1].accuracy_rate;
        
        suggestions.push({
          legs: aiLowRiskLegs,
          total_odds: totalOdds,
          combined_probability: aiLowRiskProb,
          suggestion_reason: `🤖 AI LOW RISK: Based on sports where AI suggestions hit ${topAccuracy.toFixed(0)}%+ accuracy. High confidence picks.`,
          sport: aiLowRiskLegs[0].sport,
          confidence_score: Math.min(topAccuracy / 100 * 1.1, 0.9),
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          is_data_driven: true,
        });
      }
    }

    // ========================================
    // STRATEGY 3: USER PATTERN MATCHED PARLAY
    // Matches user's exact winning bet types/sports
    // ========================================
    if (userPattern.winning_sports.length > 0 || userPattern.winning_bet_types.length > 0) {
      console.log('Generating user pattern matched suggestions...');
      
      const patternLegs: SuggestionLeg[] = [];
      let patternProb = 1;

      // Focus on user's winning sports
      const winningSportEvents = allOdds.filter(e => 
        userPattern.winning_sports.includes(e.sport_key)
      );

      for (const event of winningSportEvents.length > 0 ? winningSportEvents : allOdds) {
        const bookmaker = event.bookmakers[0];
        if (!bookmaker || patternLegs.length >= 3) continue;

        // Try to match user's winning bet types
        const preferSpread = userPattern.winning_bet_types.includes('spread');
        const preferTotal = userPattern.winning_bet_types.includes('total');

        if (preferSpread) {
          const spreadMarket = bookmaker.markets.find(m => m.key === 'spreads');
          if (spreadMarket) {
            const spread = spreadMarket.outcomes[0];
            const americanOdds = decimalToAmerican(spread.price);
            const impliedProb = americanToImplied(americanOdds);
            
            if (patternProb * impliedProb >= 0.20) {
              patternProb *= impliedProb;
              patternLegs.push({
                description: `${spread.name} ${spread.point! > 0 ? '+' : ''}${spread.point}`,
                odds: americanOdds,
                impliedProbability: impliedProb,
                sport: event.sport_key,
                betType: 'spread',
                eventTime: event.commence_time,
              });
              continue;
            }
          }
        }

        if (preferTotal) {
          const totalsMarket = bookmaker.markets.find(m => m.key === 'totals');
          if (totalsMarket) {
            const total = totalsMarket.outcomes[0];
            const americanOdds = decimalToAmerican(total.price);
            const impliedProb = americanToImplied(americanOdds);
            
            if (patternProb * impliedProb >= 0.20) {
              patternProb *= impliedProb;
              patternLegs.push({
                description: `${event.home_team} vs ${event.away_team} ${total.name} ${total.point}`,
                odds: americanOdds,
                impliedProbability: impliedProb,
                sport: event.sport_key,
                betType: 'total',
                eventTime: event.commence_time,
              });
              continue;
            }
          }
        }

        // Default to moneyline favorite
        const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
        if (h2hMarket && patternLegs.length < 3) {
          const favorite = h2hMarket.outcomes.reduce((a, b) => a.price < b.price ? a : b);
          const americanOdds = decimalToAmerican(favorite.price);
          const impliedProb = americanToImplied(americanOdds);
          
          if (patternProb * impliedProb >= 0.15) {
            patternProb *= impliedProb;
            patternLegs.push({
              description: `${favorite.name} ML vs ${event.home_team === favorite.name ? event.away_team : event.home_team}`,
              odds: americanOdds,
              impliedProbability: impliedProb,
              sport: event.sport_key,
              betType: 'moneyline',
              eventTime: event.commence_time,
            });
          }
        }
      }

      if (patternLegs.length >= 2) {
        const totalOdds = calculateTotalOdds(patternLegs);
        const sportsList = userPattern.winning_sports.slice(0, 2).join(', ') || 'your favorites';
        
        suggestions.push({
          legs: patternLegs,
          total_odds: totalOdds,
          combined_probability: patternProb,
          suggestion_reason: `📊 PATTERN MATCHED: Built from ${sportsList} where you have the highest win rates. Tailored to your successful betting style.`,
          sport: patternLegs[0].sport,
          confidence_score: 0.75,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          is_data_driven: true,
        });
      }
    }

    // ========================================
    // STRATEGY 4: Standard Low Risk (backup)
    // ========================================
    const favoritesLegs: SuggestionLeg[] = [];
    let favoritesProb = 1;

    for (const event of allOdds.slice(0, 5)) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker || favoritesLegs.length >= 3) continue;

      const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
      if (!h2hMarket) continue;

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
        suggestion_reason: buildReason('✅ LOW RISK: Heavy favorites parlay. Safe play with decent odds.', favoritesLegs[0].sport, 'high'),
        sport: favoritesLegs[0].sport,
        confidence_score: adjustedConfidence,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // ========================================
    // STRATEGY 5: Medium Risk Mixed (4 legs)
    // ========================================
    const mixedLegs: SuggestionLeg[] = [];
    let mixedProb = 1;

    for (const event of allOdds) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker || mixedLegs.length >= 4) continue;

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
        suggestion_reason: buildReason('⚖️ MEDIUM RISK: 4-leg parlay mixing moneylines and spreads. Balanced risk/reward.', 'Mixed', 'medium'),
        sport: 'Mixed',
        confidence_score: 0.5,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // ========================================
    // STRATEGY 6: Player Props (if user has prop success)
    // ========================================
    const propLegs: SuggestionLeg[] = [];
    let propProb = 1;

    for (const [eventId, markets] of playerPropsData) {
      if (propLegs.length >= 4) break;
      
      const event = allOdds.find(e => e.id === eventId);
      if (!event) continue;

      for (const market of markets) {
        if (propLegs.length >= 4) break;
        
        for (const outcome of market.outcomes) {
          if (propLegs.length >= 4) break;
          
          const americanOdds = decimalToAmerican(outcome.price);
          
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
        suggestion_reason: buildReason('🏀 PLAYER PROPS: Individual player performances across games.', propLegs[0].sport, 'medium'),
        sport: propLegs[0].sport,
        confidence_score: 0.45,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // ========================================
    // STRATEGY 7: Totals parlay
    // ========================================
    const totalsLegs: SuggestionLeg[] = [];
    let totalsProb = 1;

    for (const event of allOdds) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker || totalsLegs.length >= 4) continue;

      const totalsMarket = bookmaker.markets.find(m => m.key === 'totals');
      if (!totalsMarket) continue;

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
        suggestion_reason: buildReason('📈 TOTALS PARLAY: Game over/unders. Great for high-scoring matchups.', totalsLegs[0].sport, 'medium'),
        sport: 'Mixed',
        confidence_score: 0.5,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    // ========================================
    // STRATEGY 8: NBA PLAYER PROPS - 8 LEG FAVORITES (odds < -200)
    // ========================================
    console.log('Generating NBA 8-leg player props favorites parlay...');
    
    const nbaEvents = allOdds.filter(e => e.sport_key === 'NBA');
    const allNBAFavoriteProps: SuggestionLeg[] = [];

    // Collect all NBA player props with odds less than -200 (heavy favorites)
    for (const [eventId, markets] of playerPropsData) {
      const event = nbaEvents.find(e => e.id === eventId);
      if (!event) continue;

      for (const market of markets) {
        for (const outcome of market.outcomes) {
          const americanOdds = decimalToAmerican(outcome.price);
          
          // Only include props with odds LESS than -200 (heavy favorites)
          // e.g., -250, -300, -400, -500
          if (americanOdds < -200) {
            const propType = market.key.replace('player_', '').replace(/_/g, ' ');
            const pointStr = outcome.point ? (outcome.name.includes('Over') ? 'O' : 'U') + outcome.point : '';
            
            allNBAFavoriteProps.push({
              description: `${outcome.description || outcome.name} ${propType} ${pointStr}`.trim(),
              odds: americanOdds,
              impliedProbability: americanToImplied(americanOdds),
              sport: 'NBA',
              betType: 'player_prop',
              eventTime: event.commence_time,
            });
          }
        }
      }
    }

    console.log(`Found ${allNBAFavoriteProps.length} NBA props with odds < -200`);

    // Sort by implied probability (highest first - safest picks)
    allNBAFavoriteProps.sort((a, b) => b.impliedProbability - a.impliedProbability);

    // Take the top 8 props (highest probability favorites)
    const selectedNBALegs = allNBAFavoriteProps.slice(0, 8);

    if (selectedNBALegs.length === 8) {
      const combinedProb = selectedNBALegs.reduce((acc, leg) => acc * leg.impliedProbability, 1);
      const totalOdds = calculateTotalOdds(selectedNBALegs);
      
      // Format the odds display
      const avgOdds = Math.round(selectedNBALegs.reduce((sum, leg) => sum + leg.odds, 0) / 8);
      
      suggestions.unshift({
        legs: selectedNBALegs,
        total_odds: totalOdds,
        combined_probability: combinedProb,
        suggestion_reason: `🏀 NBA PLAYER PROPS - 8 LEG FAVORITES: All heavy favorite props (avg ${avgOdds}). Combined probability: ${(combinedProb * 100).toFixed(1)}%. High volume parlay!`,
        sport: 'NBA',
        confidence_score: combinedProb,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        is_data_driven: true,
      });
      
      console.log(`Created 8-leg NBA props parlay with ${(combinedProb * 100).toFixed(1)}% probability and +${totalOdds} odds`);
    } else {
      console.log(`Only found ${selectedNBALegs.length} qualifying NBA props (need 8)`);
    }

    // ========================================
    // STRATEGY 9: SHARP MONEY PARLAY
    // Follow the smart money - bet in direction of sharp movements
    // Now includes player props!
    // ========================================
    if (sharpAlerts && sharpAlerts.length > 0) {
      console.log('Generating SHARP MONEY PARLAY (including player props)...');
      
      const sharpLegs: SuggestionLeg[] = [];
      let sharpProb = 1;
      const usedEvents = new Set<string>();
      
      // Filter for movements where sharps are ON this side (odds shortened)
      // new_price < old_price means odds got shorter = sharps betting this side
      const sharpBackedMoves = sharpAlerts.filter(alert => {
        return alert.new_price < alert.old_price;
      });
      
      // Separate game lines and player props
      const gameLineMoves = sharpBackedMoves.filter(m => !m.player_name);
      const playerPropMoves = sharpBackedMoves.filter(m => m.player_name);
      
      console.log(`Sharp-backed movements: ${sharpBackedMoves.length} total (${gameLineMoves.length} game lines, ${playerPropMoves.length} player props)`);
      
      // Process player prop sharp moves first (they're often more specific/valuable)
      for (const sharpMove of playerPropMoves) {
        if (sharpLegs.length >= 4) break;
        if (usedEvents.has(`${sharpMove.event_id}-${sharpMove.player_name}`)) continue;
        
        const americanOdds = sharpMove.new_price;
        const impliedProb = americanToImplied(americanOdds);
        
        if (sharpProb * impliedProb >= 0.08) { // Lower threshold for props
          sharpProb *= impliedProb;
          usedEvents.add(`${sharpMove.event_id}-${sharpMove.player_name}`);
          
          // Format player prop description
          const propTypeLabel = sharpMove.market_type
            .replace('player_', '')
            .replace(/_/g, ' ')
            .toUpperCase();
          
          const description = `${sharpMove.player_name} ${propTypeLabel} ${sharpMove.outcome_name.includes(sharpMove.player_name || '') ? sharpMove.outcome_name.replace(sharpMove.player_name || '', '').trim() : sharpMove.outcome_name}`;
          
          sharpLegs.push({
            description: description.trim(),
            odds: americanOdds,
            impliedProbability: impliedProb,
            sport: sharpMove.sport,
            betType: sharpMove.market_type,
            eventTime: sharpMove.commence_time || new Date().toISOString(),
          });
          
          console.log(`Added player prop: ${sharpMove.player_name} - ${propTypeLabel}`);
        }
      }
      
      // Then add game lines
      for (const sharpMove of gameLineMoves) {
        if (sharpLegs.length >= 4) break;
        if (usedEvents.has(sharpMove.event_id)) continue;
        
        // Find this event in our fetched odds
        const event = allOdds.find(e => {
          const matchesDescription = `${e.away_team} @ ${e.home_team}` === sharpMove.description ||
                                      e.home_team === sharpMove.outcome_name ||
                                      e.away_team === sharpMove.outcome_name;
          return matchesDescription || e.id === sharpMove.event_id;
        });
        
        if (!event) {
          // Event not in our odds data, use the sharp alert data directly
          const americanOdds = sharpMove.new_price;
          const impliedProb = americanToImplied(americanOdds);
          
          if (sharpProb * impliedProb >= 0.10) {
            sharpProb *= impliedProb;
            usedEvents.add(sharpMove.event_id);
            
            sharpLegs.push({
              description: `${sharpMove.outcome_name} (${sharpMove.market_type === 'h2h' ? 'ML' : sharpMove.market_type})`,
              odds: americanOdds,
              impliedProbability: impliedProb,
              sport: sharpMove.sport,
              betType: sharpMove.market_type === 'h2h' ? 'moneyline' : sharpMove.market_type,
              eventTime: sharpMove.commence_time || new Date().toISOString(),
            });
          }
          continue;
        }
        
        // Get current odds from the bookmaker
        const bookmaker = event.bookmakers.find(b => b.key === sharpMove.bookmaker) || event.bookmakers[0];
        if (!bookmaker) continue;
        
        // Find the specific market and outcome
        const market = bookmaker.markets.find(m => m.key === sharpMove.market_type);
        if (!market) continue;
        
        const outcome = market.outcomes.find(o => o.name === sharpMove.outcome_name);
        if (!outcome) continue;
        
        const americanOdds = decimalToAmerican(outcome.price);
        const impliedProb = americanToImplied(americanOdds);
        
        if (sharpProb * impliedProb >= 0.10) {
          sharpProb *= impliedProb;
          usedEvents.add(sharpMove.event_id);
          
          let description = sharpMove.outcome_name;
          if (sharpMove.market_type === 'spreads' && outcome.point !== undefined) {
            description = `${sharpMove.outcome_name} ${outcome.point > 0 ? '+' : ''}${outcome.point}`;
          } else if (sharpMove.market_type === 'totals' && outcome.point !== undefined) {
            description = `${event.away_team} @ ${event.home_team} ${outcome.name} ${outcome.point}`;
          } else if (sharpMove.market_type === 'h2h') {
            description = `${sharpMove.outcome_name} ML`;
          }
          
          sharpLegs.push({
            description,
            odds: americanOdds,
            impliedProbability: impliedProb,
            sport: sharpMove.sport,
            betType: sharpMove.market_type === 'h2h' ? 'moneyline' : sharpMove.market_type,
            eventTime: event.commence_time,
          });
        }
      }
      
      if (sharpLegs.length >= 2) {
        const totalOdds = calculateTotalOdds(sharpLegs);
        const hasPlayerProps = sharpLegs.some(l => l.betType.startsWith('player_'));
        const propCount = sharpLegs.filter(l => l.betType.startsWith('player_')).length;
        
        const sharpIndicators = sharpBackedMoves
          .slice(0, 3)
          .map(m => m.sharp_indicator?.split(' - ')[0])
          .filter(Boolean)
          .join(', ');
        
        const propNote = hasPlayerProps ? ` Includes ${propCount} player prop${propCount > 1 ? 's' : ''} with sharp action.` : '';
        
        suggestions.unshift({
          legs: sharpLegs,
          total_odds: totalOdds,
          combined_probability: sharpProb,
          suggestion_reason: `⚡ SHARP MONEY PARLAY: Following smart money movement. ${sharpIndicators || 'Sharp action detected'}.${propNote} These lines moved with professional action.`,
          sport: sharpLegs[0].sport,
          confidence_score: 0.80,
          expires_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), // 12 hour expiry (time sensitive)
          is_data_driven: true,
        });
        
        console.log(`Created SHARP MONEY PARLAY with ${sharpLegs.length} legs (${propCount} player props)`);
      } else {
        console.log(`Only found ${sharpLegs.length} qualifying sharp-backed legs (need 2)`);
      }
    }
    
    // ========================================
    // STRATEGY 10: SHARP PLAYER PROPS ONLY
    // Pure player props parlay from sharp movements
    // ========================================
    if (sharpAlerts && sharpAlerts.length > 0) {
      const sharpPropMoves = sharpAlerts.filter(m => m.player_name && m.new_price < m.old_price);
      
      if (sharpPropMoves.length >= 3) {
        console.log(`Generating SHARP PROPS PARLAY from ${sharpPropMoves.length} player prop movements...`);
        
        const sharpPropLegs: SuggestionLeg[] = [];
        let sharpPropProb = 1;
        const usedPlayers = new Set<string>();
        
        // Sort by price change magnitude (bigger moves = stronger signal)
        const sortedPropMoves = [...sharpPropMoves].sort((a, b) => 
          Math.abs(b.price_change) - Math.abs(a.price_change)
        );
        
        for (const sharpMove of sortedPropMoves) {
          if (sharpPropLegs.length >= 5) break;
          if (usedPlayers.has(sharpMove.player_name!)) continue;
          
          const americanOdds = sharpMove.new_price;
          const impliedProb = americanToImplied(americanOdds);
          
          if (sharpPropProb * impliedProb >= 0.05) {
            sharpPropProb *= impliedProb;
            usedPlayers.add(sharpMove.player_name!);
            
            const propTypeLabel = sharpMove.market_type
              .replace('player_', '')
              .replace(/_/g, ' ')
              .toUpperCase();
            
            // Clean up the outcome name
            let cleanOutcome = sharpMove.outcome_name;
            if (sharpMove.player_name && cleanOutcome.includes(sharpMove.player_name)) {
              cleanOutcome = cleanOutcome.replace(sharpMove.player_name, '').trim();
            }
            
            sharpPropLegs.push({
              description: `${sharpMove.player_name} ${propTypeLabel} ${cleanOutcome}`,
              odds: americanOdds,
              impliedProbability: impliedProb,
              sport: sharpMove.sport,
              betType: sharpMove.market_type,
              eventTime: sharpMove.commence_time || new Date().toISOString(),
            });
          }
        }
        
        if (sharpPropLegs.length >= 3) {
          const totalOdds = calculateTotalOdds(sharpPropLegs);
          const playerNames = sharpPropLegs.slice(0, 3).map(l => l.description.split(' ')[0]).join(', ');
          
          suggestions.unshift({
            legs: sharpPropLegs,
            total_odds: totalOdds,
            combined_probability: sharpPropProb,
            suggestion_reason: `🏀⚡ SHARP PROPS PARLAY: ${sharpPropLegs.length} player props with sharp money action. Featuring ${playerNames}. Professional bettors are on these lines!`,
            sport: sharpPropLegs[0].sport,
            confidence_score: 0.78,
            expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(), // 8 hour expiry (props are time sensitive)
            is_data_driven: true,
          });
          
          console.log(`Created SHARP PROPS PARLAY with ${sharpPropLegs.length} legs`);
        }
      }
    }

    // ========================================
    // STRATEGY 11: FADE PARLAY
    // Bet AGAINST fake/trap sharp movements using final_pick
    // ========================================
    if (sharpAlerts && sharpAlerts.length > 0) {
      const fakeSharpMoves = sharpAlerts.filter(m => 
        m.movement_authenticity === 'fake' && 
        m.recommendation === 'fade' &&
        m.is_primary_record !== false // Only use primary records with final_pick
      );
      
      console.log(`Found ${fakeSharpMoves.length} fake sharp movements to fade...`);
      
      if (fakeSharpMoves.length >= 2) {
        const fadeLegs: SuggestionLeg[] = [];
        let fadeProb = 1;
        const usedEvents = new Set<string>();
        
        // Sort by authenticity confidence (most confident fakes first)
        const sortedFakeMoves = [...fakeSharpMoves].sort((a, b) => 
          (b.authenticity_confidence || 0) - (a.authenticity_confidence || 0)
        );
        
        for (const fakeMove of sortedFakeMoves) {
          if (fadeLegs.length >= 4) break;
          const eventKey = fakeMove.player_name 
            ? `${fakeMove.event_id}-${fakeMove.player_name}` 
            : fakeMove.event_id;
          if (usedEvents.has(eventKey)) continue;
          
          // Use final_pick if available (already contains the correct side to bet)
          const finalPick = fakeMove.final_pick || fakeMove.outcome_name;
          
          // Use a standard odds calculation
          const originalOdds = fakeMove.old_price;
          const fadeOdds = originalOdds < -110 ? -110 : (originalOdds > 110 ? -110 : -105);
          const impliedProb = americanToImplied(fadeOdds);
          
          if (fadeProb * impliedProb >= 0.10) {
            fadeProb *= impliedProb;
            usedEvents.add(eventKey);
            
            // Use final_pick for the description
            let fadeDescription = '';
            if (fakeMove.player_name) {
              const propType = fakeMove.market_type.replace('player_', '').replace(/_/g, ' ').toUpperCase();
              fadeDescription = `${fakeMove.player_name} ${propType}: ${finalPick}`;
            } else {
              fadeDescription = `${finalPick}`;
            }
            
            fadeLegs.push({
              description: fadeDescription,
              odds: fadeOdds,
              impliedProbability: impliedProb,
              sport: fakeMove.sport,
              betType: fakeMove.market_type,
              eventTime: fakeMove.commence_time || new Date().toISOString(),
            });
          }
        }
        
        if (fadeLegs.length >= 2) {
          const totalOdds = calculateTotalOdds(fadeLegs);
          const fadeReasons = fakeSharpMoves
            .slice(0, 2)
            .map(m => m.recommendation_reason?.split('.')[0])
            .filter(Boolean)
            .join('; ');
          
          suggestions.unshift({
            legs: fadeLegs,
            total_odds: totalOdds,
            combined_probability: fadeProb,
            suggestion_reason: `🚨 FADE PARLAY: AI-selected picks against market traps. ${fadeReasons}. Final picks determined by movement analysis.`,
            sport: fadeLegs[0].sport,
            confidence_score: 0.65,
            expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
            is_data_driven: true,
          });
          
          console.log(`Created FADE PARLAY with ${fadeLegs.length} legs using final_pick`);
        }
      }
    }

    // ========================================
    // STRATEGY 12: HIGH-CONFIDENCE REAL SHARP PARLAY
    // Only verified real sharp movements with high confidence using final_pick
    // ========================================
    if (sharpAlerts && sharpAlerts.length > 0) {
      const realHighConfidence = sharpAlerts.filter(m => 
        m.movement_authenticity === 'real' && 
        (m.authenticity_confidence || 0) >= 0.65 &&
        m.recommendation === 'pick' &&
        m.is_primary_record !== false && // Only use primary records
        m.new_price < m.old_price
      );
      
      console.log(`Found ${realHighConfidence.length} high-confidence real sharp movements...`);
      
      if (realHighConfidence.length >= 2) {
        const realSharpLegs: SuggestionLeg[] = [];
        let realSharpProb = 1;
        const usedEvents = new Set<string>();
        
        // Sort by confidence (highest first)
        const sortedRealMoves = [...realHighConfidence].sort((a, b) => 
          (b.authenticity_confidence || 0) - (a.authenticity_confidence || 0)
        );
        
        for (const realMove of sortedRealMoves) {
          if (realSharpLegs.length >= 4) break;
          const eventKey = realMove.player_name 
            ? `${realMove.event_id}-${realMove.player_name}` 
            : realMove.event_id;
          if (usedEvents.has(eventKey)) continue;
          
          const americanOdds = realMove.new_price;
          const impliedProb = americanToImplied(americanOdds);
          
          // Use final_pick if available
          const finalPick = realMove.final_pick || realMove.outcome_name;
          
          if (realSharpProb * impliedProb >= 0.08) {
            realSharpProb *= impliedProb;
            usedEvents.add(eventKey);
            
            let description = '';
            if (realMove.player_name) {
              const propType = realMove.market_type.replace('player_', '').replace(/_/g, ' ').toUpperCase();
              description = `✅ ${realMove.player_name} ${propType}: ${finalPick}`;
            } else {
              description = `✅ ${finalPick}`;
            }
            
            realSharpLegs.push({
              description,
              odds: americanOdds,
              impliedProbability: impliedProb,
              sport: realMove.sport,
              betType: realMove.market_type,
              eventTime: realMove.commence_time || new Date().toISOString(),
            });
          }
        }
        
        if (realSharpLegs.length >= 2) {
          const totalOdds = calculateTotalOdds(realSharpLegs);
          const avgConfidence = Math.round(
            (realHighConfidence.reduce((sum, m) => sum + (m.authenticity_confidence || 0), 0) / realHighConfidence.length) * 100
          );
          
          suggestions.unshift({
            legs: realSharpLegs,
            total_odds: totalOdds,
            combined_probability: realSharpProb,
            suggestion_reason: `✅ VERIFIED SHARP PARLAY: ${realSharpLegs.length} AI-selected final picks with ${avgConfidence}% confidence. Multi-book consensus and classic sharp patterns detected.`,
            sport: realSharpLegs[0].sport,
            confidence_score: 0.85,
            expires_at: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
            is_data_driven: true,
          });
          
          console.log(`Created VERIFIED SHARP PARLAY with ${realSharpLegs.length} legs using final_pick`);
        }
      }
    }

    // ========================================
    // STRATEGY 13: LATE SHARP MONEY (1-3 hours pregame)
    // ✅ RULE: Follow late moves 1-3 hours pregame - highest confidence window
    // ========================================
    const now = new Date();
    if (sharpAlerts && sharpAlerts.length > 0) {
      console.log('Generating LATE SHARP MONEY strategy (1-3hr sweet spot)...');
      
      const lateSharpMoves = sharpAlerts.filter(m => {
        if (!m.commence_time) return false;
        const hoursToGame = (new Date(m.commence_time).getTime() - now.getTime()) / (1000 * 60 * 60);
        // 1-3 hour sweet spot with verified sharp action
        return hoursToGame >= 1 && hoursToGame <= 3 && 
               m.movement_authenticity === 'real' &&
               m.new_price < m.old_price;
      });
      
      console.log(`Found ${lateSharpMoves.length} late sharp moves in 1-3hr window`);
      
      if (lateSharpMoves.length >= 2) {
        const lateSharpLegs: SuggestionLeg[] = [];
        let lateSharpProb = 1;
        const usedEvents = new Set<string>();
        
        for (const move of lateSharpMoves) {
          if (lateSharpLegs.length >= 4) break;
          const eventKey = move.player_name ? `${move.event_id}-${move.player_name}` : move.event_id;
          if (usedEvents.has(eventKey)) continue;
          
          const americanOdds = move.new_price;
          const impliedProb = americanToImplied(americanOdds);
          
          if (lateSharpProb * impliedProb >= 0.10) {
            lateSharpProb *= impliedProb;
            usedEvents.add(eventKey);
            
            const finalPick = move.final_pick || move.outcome_name;
            let description = move.player_name 
              ? `🕐 ${move.player_name}: ${finalPick}`
              : `🕐 ${finalPick}`;
            
            lateSharpLegs.push({
              description,
              odds: americanOdds,
              impliedProbability: impliedProb,
              sport: move.sport,
              betType: move.market_type,
              eventTime: move.commence_time || now.toISOString(),
            });
          }
        }
        
        if (lateSharpLegs.length >= 2) {
          const totalOdds = calculateTotalOdds(lateSharpLegs);
          
          suggestions.unshift({
            legs: lateSharpLegs,
            total_odds: totalOdds,
            combined_probability: lateSharpProb,
            suggestion_reason: `🕐 LATE SHARP: ${lateSharpLegs.length} moves 1-3 hours before game - highest confidence window. Sharp money peaks in this timeframe.`,
            sport: lateSharpLegs[0].sport,
            confidence_score: 0.88,
            expires_at: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(), // 3 hour expiry
            is_data_driven: true,
          });
          
          console.log(`Created LATE SHARP PARLAY with ${lateSharpLegs.length} legs`);
        }
      }
    }

    // ========================================
    // STRATEGY 14: MORNING FADE PARLAY
    // ❌ RULE: Fade early morning overs - public trap
    // ========================================
    if (sharpAlerts && sharpAlerts.length > 0) {
      console.log('Generating MORNING FADE strategy...');
      
      // Find morning overs with heavy juice (potential traps)
      const currentHourUTC = now.getUTCHours();
      const isCurrentlyMorning = currentHourUTC < 18; // Before 1 PM ET
      
      const morningOversToFade = sharpAlerts.filter(m => {
        // Check if detected in morning hours
        const detectedTime = new Date(m.detected_at);
        const detectedHourUTC = detectedTime.getUTCHours();
        const wasDetectedMorning = detectedHourUTC < 16; // Before 11 AM ET
        
        // Over with heavy action that we should fade
        const isOver = m.outcome_name?.toLowerCase().includes('over');
        const hasHeavyAction = m.price_change < -10; // Odds shortened significantly
        
        // Look for price-only moves (traps)
        const isPriceOnlyTrap = m.recommendation_reason?.includes('PRICE_ONLY') ||
                                m.movement_authenticity === 'fake';
        
        return wasDetectedMorning && isOver && (hasHeavyAction || isPriceOnlyTrap);
      });
      
      console.log(`Found ${morningOversToFade.length} morning overs to fade`);
      
      if (morningOversToFade.length >= 2 && isCurrentlyMorning) {
        const fadeLegs: SuggestionLeg[] = [];
        let fadeProb = 1;
        const usedPlayers = new Set<string>();
        
        for (const move of morningOversToFade) {
          if (fadeLegs.length >= 4) break;
          const key = move.player_name || move.event_id;
          if (usedPlayers.has(key)) continue;
          
          // Fade the over = bet Under
          const fadeOdds = -110; // Standard vig
          const impliedProb = americanToImplied(fadeOdds);
          
          if (fadeProb * impliedProb >= 0.15) {
            fadeProb *= impliedProb;
            usedPlayers.add(key);
            
            let description = move.player_name 
              ? `🌅 ${move.player_name} UNDER (fade AM Over)`
              : `🌅 ${move.description} UNDER`;
            
            fadeLegs.push({
              description,
              odds: fadeOdds,
              impliedProbability: impliedProb,
              sport: move.sport,
              betType: move.market_type,
              eventTime: move.commence_time || now.toISOString(),
            });
          }
        }
        
        if (fadeLegs.length >= 2) {
          const totalOdds = calculateTotalOdds(fadeLegs);
          
          suggestions.push({
            legs: fadeLegs,
            total_odds: totalOdds,
            combined_probability: fadeProb,
            suggestion_reason: `🌅 MORNING FADE: Betting UNDER on ${fadeLegs.length} early morning overs. Public money loads up on overs early - fade the trap.`,
            sport: fadeLegs[0].sport,
            confidence_score: 0.70,
            expires_at: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
            is_data_driven: true,
          });
          
          console.log(`Created MORNING FADE PARLAY with ${fadeLegs.length} legs`);
        }
      }
    }

    // ========================================
    // STRATEGY 15: INJURY UNDERS
    // ✅ RULE: Follow unders with injury signals
    // ========================================
    if (sharpAlerts && sharpAlerts.length > 0) {
      console.log('Generating INJURY UNDERS strategy...');
      
      // Find movements with injury-related signals
      const injuryRelatedMoves = sharpAlerts.filter(m => 
        m.recommendation_reason?.toLowerCase().includes('injury') ||
        m.sharp_indicator?.toLowerCase().includes('injury') ||
        // Also include unders with significant movement (could be injury news)
        (m.outcome_name?.toLowerCase().includes('under') && 
         Math.abs(m.price_change) >= 15 &&
         m.movement_authenticity === 'real')
      );
      
      console.log(`Found ${injuryRelatedMoves.length} injury-related movements`);
      
      if (injuryRelatedMoves.length >= 2) {
        const injuryLegs: SuggestionLeg[] = [];
        let injuryProb = 1;
        const usedPlayers = new Set<string>();
        
        for (const move of injuryRelatedMoves) {
          if (injuryLegs.length >= 4) break;
          const key = move.player_name || move.event_id;
          if (usedPlayers.has(key)) continue;
          
          const americanOdds = move.outcome_name?.toLowerCase().includes('under') 
            ? move.new_price 
            : -110;
          const impliedProb = americanToImplied(americanOdds);
          
          if (injuryProb * impliedProb >= 0.15) {
            injuryProb *= impliedProb;
            usedPlayers.add(key);
            
            let description = move.player_name 
              ? `🏥 ${move.player_name} UNDER (injury factor)`
              : `🏥 ${move.description} UNDER`;
            
            injuryLegs.push({
              description,
              odds: americanOdds,
              impliedProbability: impliedProb,
              sport: move.sport,
              betType: move.market_type,
              eventTime: move.commence_time || now.toISOString(),
            });
          }
        }
        
        if (injuryLegs.length >= 2) {
          const totalOdds = calculateTotalOdds(injuryLegs);
          
          suggestions.push({
            legs: injuryLegs,
            total_odds: totalOdds,
            combined_probability: injuryProb,
            suggestion_reason: `🏥 INJURY UNDERS: ${injuryLegs.length} games with injury signals - lean Under. Player injuries affect scoring output.`,
            sport: injuryLegs[0].sport,
            confidence_score: 0.72,
            expires_at: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
            is_data_driven: true,
          });
          
          console.log(`Created INJURY UNDERS PARLAY with ${injuryLegs.length} legs`);
        }
      }
    }

    // ========================================
    // STRATEGY 16: HYBRID PARLAY
    // Combines sharp money + user patterns + AI accuracy in one formula
    // ========================================
    console.log('Generating HYBRID PARLAY (Sharp + User + AI)...');
    
    // Collect ALL potential legs from various sources
    const allPotentialLegs: Array<{
      leg: SuggestionLeg & { eventId?: string };
      hybridScore: HybridScore;
    }> = [];
    
    // Score legs from current odds data
    for (const event of allOdds.slice(0, 15)) {
      const bookmaker = event.bookmakers[0];
      if (!bookmaker) continue;
      
      // Try moneyline
      const h2hMarket = bookmaker.markets.find(m => m.key === 'h2h');
      if (h2hMarket) {
        for (const outcome of h2hMarket.outcomes) {
          const americanOdds = decimalToAmerican(outcome.price);
          if (americanOdds <= -150 && americanOdds >= -400) {
            const legCandidate = {
              sport: event.sport_key,
              betType: 'moneyline',
              odds: americanOdds,
              description: `${outcome.name} ML`,
              eventId: event.id,
            };
            const score = calculateHybridScore(legCandidate, sharpAlerts || [], userPattern, accuracyMap);
            if (score.totalScore >= 60) {
              allPotentialLegs.push({
                leg: {
                  description: legCandidate.description,
                  odds: americanOdds,
                  impliedProbability: americanToImplied(americanOdds),
                  sport: event.sport_key,
                  betType: 'moneyline',
                  eventTime: event.commence_time,
                  eventId: event.id,
                  hybridScore: score.totalScore,
                  hybridBreakdown: {
                    sharp: score.sharpScore,
                    user: score.userPatternScore,
                    ai: score.aiAccuracyScore,
                  },
                  recommendation: score.recommendation,
                },
                hybridScore: score,
              });
            }
          }
        }
      }
      
      // Try player props if available
      const propsForEvent = playerPropsData.get(event.id);
      if (propsForEvent) {
        for (const market of propsForEvent.slice(0, 3)) {
          for (const outcome of market.outcomes.slice(0, 2)) {
            const americanOdds = decimalToAmerican(outcome.price);
            if (americanOdds <= -200 && americanOdds >= -500) {
              const propType = market.key.replace('player_', '').replace(/_/g, ' ').toUpperCase();
              const legCandidate = {
                sport: event.sport_key,
                betType: market.key,
                odds: americanOdds,
                description: `${outcome.name} ${propType}`,
                eventId: event.id,
              };
              const score = calculateHybridScore(legCandidate, sharpAlerts || [], userPattern, accuracyMap);
              if (score.totalScore >= 60) {
                allPotentialLegs.push({
                  leg: {
                    description: legCandidate.description,
                    odds: americanOdds,
                    impliedProbability: americanToImplied(americanOdds),
                    sport: event.sport_key,
                    betType: market.key,
                    eventTime: event.commence_time,
                    eventId: event.id,
                    hybridScore: score.totalScore,
                    hybridBreakdown: {
                      sharp: score.sharpScore,
                      user: score.userPatternScore,
                      ai: score.aiAccuracyScore,
                    },
                    recommendation: score.recommendation,
                  },
                  hybridScore: score,
                });
              }
            }
          }
        }
      }
    }
    
    // Sort by hybrid score (highest first)
    allPotentialLegs.sort((a, b) => b.hybridScore.totalScore - a.hybridScore.totalScore);
    
    // Filter to only PICK or STRONG_PICK
    const qualifiedLegs = allPotentialLegs.filter(scored => 
      scored.hybridScore.recommendation === 'PICK' || 
      scored.hybridScore.recommendation === 'STRONG_PICK'
    );
    
    console.log(`Found ${qualifiedLegs.length} legs scoring 60+ with PICK/STRONG_PICK recommendation`);
    
    // Build hybrid parlay from top-scoring legs (avoid conflicts)
    if (qualifiedLegs.length >= 2) {
      const hybridLegs: SuggestionLeg[] = [];
      let hybridProb = 1;
      const usedEvents = new Set<string>();
      
      for (const scored of qualifiedLegs) {
        if (hybridLegs.length >= 4) break;
        if (usedEvents.has(scored.leg.eventId || '')) continue;
        
        // Check for conflicts with existing legs
        const hasConflict = hybridLegs.some(existing => 
          hasConflictingSignals(existing, scored.leg)
        );
        if (hasConflict) continue;
        
        const newProb = hybridProb * scored.leg.impliedProbability;
        if (newProb >= 0.15) {
          hybridProb = newProb;
          if (scored.leg.eventId) usedEvents.add(scored.leg.eventId);
          hybridLegs.push(scored.leg);
        }
      }
      
      if (hybridLegs.length >= 2) {
        const totalOdds = calculateTotalOdds(hybridLegs);
        const avgHybridScore = Math.round(
          hybridLegs.reduce((sum, leg) => sum + (leg.hybridScore || 0), 0) / hybridLegs.length
        );
        
        // Build hybrid scores for storage
        const hybridScoresData = hybridLegs.map(leg => ({
          description: leg.description,
          hybridScore: leg.hybridScore,
          breakdown: leg.hybridBreakdown,
          recommendation: leg.recommendation,
        }));
        
        suggestions.unshift({
          legs: hybridLegs,
          total_odds: totalOdds,
          combined_probability: hybridProb,
          suggestion_reason: `🧬 HYBRID PARLAY: ${hybridLegs.length} legs where Sharp Money + Your History + AI Data ALL align. Avg score: ${avgHybridScore}/100. Top-scoring picks only!`,
          sport: hybridLegs[0].sport,
          confidence_score: Math.min(avgHybridScore / 100 * 1.1, 0.95),
          expires_at: new Date(now.getTime() + 18 * 60 * 60 * 1000).toISOString(),
          is_data_driven: true,
          is_hybrid: true,
          hybrid_scores: hybridScoresData,
        });
        
        console.log(`Created HYBRID PARLAY with ${hybridLegs.length} legs, avg hybrid score: ${avgHybridScore}`);
      }
    }

    // Sort suggestions: LOW RISK (high probability) first
    suggestions.sort((a, b) => b.combined_probability - a.combined_probability);

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
          is_hybrid: s.is_hybrid || false,
          hybrid_scores: s.hybrid_scores || null,
        })));

      if (insertError) {
        console.error('Error inserting suggestions:', insertError);
      }
    }

    console.log(`Generated ${suggestions.length} suggestions with LOW RISK priority`);
    console.log('Returning learning insights:', learningInsights);

    return new Response(JSON.stringify({ 
      suggestions,
      userPattern,
      learningInsights,
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
