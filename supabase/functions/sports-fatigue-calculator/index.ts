import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TeamLocation {
  team_name: string;
  city: string;
  latitude: number;
  longitude: number;
  timezone: string;
  altitude_ft: number;
  sport: string;
}

interface FatigueFactors {
  isBackToBack: boolean;
  isRoadBackToBack: boolean;
  travelMiles: number;
  timezoneChanges: number;
  isAltitudeGame: boolean;
  isThreeInFour: boolean;
  isFourInSix: boolean;
  isEarlyStart: boolean;
  isShortWeek: boolean;
  roadTripGames: number;
  restDays: number;
  gamesLast7Days: number;
  gamesLast14Days: number;
}

// Sport-specific fatigue weights
const SPORT_WEIGHTS: Record<string, Record<string, number>> = {
  basketball_nba: {
    backToBack: 25,
    roadBackToBack: 15,
    threeInFour: 12,
    fourInSix: 18,
    travel1500: 15,
    travel1000: 10,
    travel500: 5,
    timezone2: 10,
    timezone1: 5,
    altitude: 8,
    earlyStart: 5,
  },
  americanfootball_nfl: {
    shortWeek: 20, // Thursday games
    crossCountry: 15,
    travel2000: 12,
    travel1000: 8,
    timezone2: 12,
    timezone1: 6,
    altitude: 10,
    mondayToSunday: 5, // Short rest after Monday night
  },
  baseball_mlb: {
    backToBack: 8, // Less impact in baseball
    roadTripLong: 15, // 5+ games road trip
    roadTripMedium: 10, // 3-4 games
    travel1500: 10,
    travel1000: 6,
    timezone2: 8,
    dayNight: 12, // Day game after night game
    doubleheader: 18,
  },
  icehockey_nhl: {
    backToBack: 22,
    roadBackToBack: 14,
    threeInFour: 15,
    travel1500: 12,
    travel1000: 8,
    timezone2: 10,
    timezone1: 5,
    altitude: 10,
  },
};

// API sport keys mapping
const SPORT_KEYS: Record<string, string> = {
  basketball_nba: 'basketball_nba',
  americanfootball_nfl: 'americanfootball_nfl',
  baseball_mlb: 'baseball_mlb',
  icehockey_nhl: 'icehockey_nhl',
};

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function calculateFatigueScore(factors: FatigueFactors, sport: string): number {
  const weights = SPORT_WEIGHTS[sport] || SPORT_WEIGHTS.basketball_nba;
  let score = 0;

  if (factors.isBackToBack) score += weights.backToBack || 20;
  if (factors.isRoadBackToBack) score += weights.roadBackToBack || 12;
  if (factors.isShortWeek) score += weights.shortWeek || 15;
  
  if (factors.travelMiles > 2000) score += weights.travel2000 || weights.travel1500 || 15;
  else if (factors.travelMiles > 1500) score += weights.travel1500 || 12;
  else if (factors.travelMiles > 1000) score += weights.travel1000 || 8;
  else if (factors.travelMiles > 500) score += weights.travel500 || 4;
  
  if (factors.timezoneChanges >= 2) score += weights.timezone2 || 10;
  else if (factors.timezoneChanges >= 1) score += weights.timezone1 || 5;
  
  if (factors.isAltitudeGame) score += weights.altitude || 8;
  if (factors.isThreeInFour) score += weights.threeInFour || 12;
  if (factors.isFourInSix) score += weights.fourInSix || 15;
  if (factors.isEarlyStart) score += weights.earlyStart || 4;
  
  // Road trip fatigue (MLB specific)
  if (factors.roadTripGames >= 5) score += weights.roadTripLong || 10;
  else if (factors.roadTripGames >= 3) score += weights.roadTripMedium || 6;
  
  return Math.min(score, 100);
}

function getFatigueCategory(score: number): string {
  if (score >= 50) return 'Red Alert';
  if (score >= 35) return 'Exhausted';
  if (score >= 20) return 'Tired';
  if (score >= 10) return 'Normal';
  return 'Fresh';
}

function calculateBettingAdjustments(fatigueScore: number, sport: string) {
  const factor = fatigueScore / 100;
  
  // Sport-specific adjustments
  const adjustments: Record<string, number> = {
    mlAdjustment: Math.round(factor * 8 * 10) / 10,
    spreadAdjustment: Math.round(factor * 3 * 10) / 10,
  };

  if (sport === 'basketball_nba') {
    adjustments.pointsAdjustment = Math.round(factor * -5 * 10) / 10;
    adjustments.reboundsAdjustment = Math.round(factor * -3 * 10) / 10;
    adjustments.assistsAdjustment = Math.round(factor * -4 * 10) / 10;
    adjustments.threePtAdjustment = Math.round(factor * -6 * 10) / 10;
  } else if (sport === 'americanfootball_nfl') {
    adjustments.passingYardsAdjustment = Math.round(factor * -4 * 10) / 10;
    adjustments.rushingYardsAdjustment = Math.round(factor * -3 * 10) / 10;
    adjustments.totalPointsAdjustment = Math.round(factor * -5 * 10) / 10;
  } else if (sport === 'icehockey_nhl') {
    adjustments.goalsAdjustment = Math.round(factor * -4 * 10) / 10;
    adjustments.shotsAdjustment = Math.round(factor * -3 * 10) / 10;
  } else if (sport === 'baseball_mlb') {
    adjustments.runsAdjustment = Math.round(factor * -3 * 10) / 10;
    adjustments.hitsAdjustment = Math.round(factor * -2 * 10) / 10;
  }

  return adjustments;
}

// Always generate an angle for any differential
function getRecommendedAngle(homeFatigue: number, awayFatigue: number, sport: string): string {
  const diff = Math.abs(homeFatigue - awayFatigue);
  const fresherTeam = homeFatigue < awayFatigue ? 'home' : 'away';
  const tiredTeam = homeFatigue < awayFatigue ? 'away' : 'home';
  
  // Sport-specific recommendations
  const sportTips: Record<string, Record<string, string>> = {
    basketball_nba: {
      strong: `🔥 Strong edge: Fade ${tiredTeam} player props, target ${fresherTeam} ML/spread. Focus on unders.`,
      good: `✅ Good edge: ${fresherTeam} team favored. Consider unders on ${tiredTeam} players.`,
      slight: `👀 Slight edge: Monitor ${tiredTeam} starters minutes. Look for value on ${fresherTeam}.`,
      minimal: `📊 Minimal edge: ${fresherTeam} has slight fatigue advantage. Watch late-game performance.`,
    },
    americanfootball_nfl: {
      strong: `🔥 Strong edge: Fade ${tiredTeam} on short week. Target game under.`,
      good: `✅ Good edge: ${fresherTeam} favored. Consider ${tiredTeam} QB under on passing.`,
      slight: `👀 Slight edge: ${fresherTeam} has rest advantage. Watch 4th quarter.`,
      minimal: `📊 ${fresherTeam} slightly fresher. Minor edge on execution plays.`,
    },
    baseball_mlb: {
      strong: `🔥 Strong edge: Target first 5 innings under. Fade ${tiredTeam} bats.`,
      good: `✅ Good edge: ${fresherTeam} bullpen advantage. Look at F5 ML.`,
      slight: `👀 Slight edge: ${tiredTeam} on long road trip. Watch late innings.`,
      minimal: `📊 ${fresherTeam} marginally fresher. Consider pitcher rest days.`,
    },
    icehockey_nhl: {
      strong: `🔥 Strong edge: ${tiredTeam} B2B, target under. ${fresherTeam} puck line value.`,
      good: `✅ Good edge: ${fresherTeam} should dominate possession. Consider over on their shots.`,
      slight: `👀 Slight edge: ${fresherTeam} fresher legs in 3rd period.`,
      minimal: `📊 ${fresherTeam} minor rest advantage. Watch goalie fatigue.`,
    },
  };

  const tips = sportTips[sport] || sportTips.basketball_nba;
  
  if (diff >= 30) return tips.strong;
  if (diff >= 20) return tips.good;
  if (diff >= 15) return tips.slight;
  return tips.minimal;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY');

    const body = await req.json().catch(() => ({}));
    const targetSports = body.sports || ['basketball_nba', 'americanfootball_nfl', 'baseball_mlb', 'icehockey_nhl'];

    console.log(`Starting sports fatigue calculation for: ${targetSports.join(', ')}`);

    const today = new Date().toISOString().split('T')[0];
    console.log(`Calculating fatigue for date: ${today}`);

    // Archive old verified edges to training data
    console.log('Archiving old verified edges to training data...');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: oldEdges } = await supabase
      .from('fatigue_edge_tracking')
      .select('*')
      .lt('game_date', thirtyDaysAgo.toISOString().split('T')[0])
      .not('verified_at', 'is', null);

    if (oldEdges && oldEdges.length > 0) {
      const trainingData = oldEdges.map(edge => ({
        event_id: edge.event_id,
        sport: 'basketball_nba', // Legacy data
        home_team: edge.home_team,
        away_team: edge.away_team,
        game_date: edge.game_date,
        home_fatigue_score: edge.home_fatigue_score,
        away_fatigue_score: edge.away_fatigue_score,
        fatigue_differential: edge.fatigue_differential,
        recommended_side: edge.recommended_side,
        recommended_angle: edge.recommended_angle,
        recommended_side_won: edge.recommended_side_won,
        game_result: edge.game_result,
        actual_spread: edge.actual_spread,
        actual_total: edge.actual_total,
      }));

      await supabase.from('fatigue_training_data').upsert(trainingData, { onConflict: 'event_id' });
      await supabase.from('fatigue_edge_tracking').delete().lt('game_date', thirtyDaysAgo.toISOString().split('T')[0]);
      console.log(`Archived ${trainingData.length} old edges to training data`);
    }

    // Delete old fatigue scores (keep only today)
    await supabase.from('sports_fatigue_scores').delete().lt('game_date', today);

    // Get all team locations
    const { data: teamLocations, error: locError } = await supabase
      .from('sports_team_locations')
      .select('*');

    if (locError) {
      throw new Error(`Failed to fetch team locations: ${locError.message}`);
    }

    const teamLocationMap = new Map<string, TeamLocation>();
    teamLocations?.forEach(loc => {
      const key = `${loc.sport}:${loc.team_name}`;
      teamLocationMap.set(key, loc);
    });

    console.log(`Loaded ${teamLocations?.length || 0} team locations`);

    const allResults: any[] = [];

    // Process each sport
    for (const sport of targetSports) {
      console.log(`\nProcessing ${sport}...`);

      let todaysGames: Array<{ eventId: string; homeTeam: string; awayTeam: string; gameTime: string }> = [];

      // Fetch games from The Odds API
      if (oddsApiKey) {
        try {
          const sportKey = SPORT_KEYS[sport] || sport;
          const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sportKey}/odds/?apiKey=${oddsApiKey}&regions=us&markets=h2h&oddsFormat=american`;
          const oddsResponse = await fetch(oddsUrl);
          
          if (oddsResponse.ok) {
            const oddsData = await oddsResponse.json();
            const todayStart = new Date(today);
            const todayEnd = new Date(today);
            todayEnd.setDate(todayEnd.getDate() + 1);

            todaysGames = oddsData
              .filter((game: any) => {
                const gameDate = new Date(game.commence_time);
                return gameDate >= todayStart && gameDate < todayEnd;
              })
              .map((game: any) => ({
                eventId: game.id,
                homeTeam: game.home_team,
                awayTeam: game.away_team,
                gameTime: game.commence_time,
              }));
            
            console.log(`Found ${todaysGames.length} ${sport} games for today`);
          }
        } catch (e) {
          console.error(`Error fetching ${sport} odds:`, e);
        }
      }

      if (todaysGames.length === 0) {
        console.log(`No ${sport} games found for today`);
        continue;
      }

      // Process each game
      for (const game of todaysGames) {
        console.log(`Processing: ${game.awayTeam} @ ${game.homeTeam}`);

        const homeLocKey = `${sport}:${game.homeTeam}`;
        const awayLocKey = `${sport}:${game.awayTeam}`;
        
        const homeLoc = teamLocationMap.get(homeLocKey);
        const awayLoc = teamLocationMap.get(awayLocKey);

        // Default factors if no location data
        const defaultFactors: FatigueFactors = {
          isBackToBack: false,
          isRoadBackToBack: false,
          travelMiles: 0,
          timezoneChanges: 0,
          isAltitudeGame: false,
          isThreeInFour: false,
          isFourInSix: false,
          isEarlyStart: false,
          isShortWeek: false,
          roadTripGames: 0,
          restDays: 3,
          gamesLast7Days: 0,
          gamesLast14Days: 0,
        };

        // Calculate travel if we have locations
        let travelMiles = 0;
        let timezoneChanges = 0;
        let isAltitudeGame = false;

        if (homeLoc && awayLoc) {
          travelMiles = calculateDistance(
            awayLoc.latitude, awayLoc.longitude,
            homeLoc.latitude, homeLoc.longitude
          );

          const tzMap: Record<string, number> = {
            'America/New_York': -5, 'America/Toronto': -5, 'America/Montreal': -5,
            'America/Chicago': -6, 'America/Winnipeg': -6,
            'America/Denver': -7, 'America/Edmonton': -7,
            'America/Los_Angeles': -8, 'America/Vancouver': -8,
            'America/Phoenix': -7,
          };
          
          const homeTz = tzMap[homeLoc.timezone] || -5;
          const awayTz = tzMap[awayLoc.timezone] || -5;
          timezoneChanges = Math.abs(homeTz - awayTz);
          
          isAltitudeGame = (homeLoc.altitude_ft || 0) > 4000;
        }

        // Create fatigue records for both teams
        const homeFactors = { ...defaultFactors, isAltitudeGame: false };
        const awayFactors = { 
          ...defaultFactors, 
          travelMiles, 
          timezoneChanges, 
          isAltitudeGame 
        };

        const homeFatigueScore = calculateFatigueScore(homeFactors, sport);
        const awayFatigueScore = calculateFatigueScore(awayFactors, sport);

        const homeCategory = getFatigueCategory(homeFatigueScore);
        const awayCategory = getFatigueCategory(awayFatigueScore);

        const homeAdjustments = calculateBettingAdjustments(homeFatigueScore, sport);
        const awayAdjustments = calculateBettingAdjustments(awayFatigueScore, sport);

        const differential = Math.abs(homeFatigueScore - awayFatigueScore);
        const angle = getRecommendedAngle(homeFatigueScore, awayFatigueScore, sport);

        // Prepare records
        const homeRecord = {
          event_id: game.eventId,
          sport,
          team_name: game.homeTeam,
          fatigue_score: homeFatigueScore,
          fatigue_category: homeCategory,
          is_back_to_back: homeFactors.isBackToBack,
          is_three_in_four: homeFactors.isThreeInFour,
          travel_miles: 0,
          timezone_changes: 0,
          altitude_factor: 0,
          rest_days: homeFactors.restDays,
          games_last_7_days: homeFactors.gamesLast7Days,
          games_last_14_days: homeFactors.gamesLast14Days,
          short_week: homeFactors.isShortWeek,
          road_trip_games: 0,
          betting_adjustments: homeAdjustments,
          recommended_angle: angle,
          game_date: today,
          commence_time: game.gameTime,
          opponent_name: game.awayTeam,
        };

        const awayRecord = {
          event_id: game.eventId,
          sport,
          team_name: game.awayTeam,
          fatigue_score: awayFatigueScore,
          fatigue_category: awayCategory,
          is_back_to_back: awayFactors.isBackToBack,
          is_three_in_four: awayFactors.isThreeInFour,
          travel_miles: Math.round(travelMiles),
          timezone_changes: timezoneChanges,
          altitude_factor: isAltitudeGame ? 1 : 0,
          rest_days: awayFactors.restDays,
          games_last_7_days: awayFactors.gamesLast7Days,
          games_last_14_days: awayFactors.gamesLast14Days,
          short_week: awayFactors.isShortWeek,
          road_trip_games: awayFactors.roadTripGames,
          betting_adjustments: awayAdjustments,
          recommended_angle: angle,
          game_date: today,
          commence_time: game.gameTime,
          opponent_name: game.homeTeam,
        };

        // Upsert fatigue scores
        const { error: upsertError } = await supabase
          .from('sports_fatigue_scores')
          .upsert([homeRecord, awayRecord], {
            onConflict: 'event_id,team_name,game_date',
          });

        if (upsertError) {
          console.error(`Error upserting fatigue for ${game.homeTeam} vs ${game.awayTeam}:`, upsertError);
        } else {
          // Track edges with 10+ differential (lowered threshold for more recommendations)
          if (differential >= 10) {
            const recommendedSide = homeFatigueScore < awayFatigueScore ? 'home' : 'away';
            
            await supabase
              .from('sports_fatigue_edge_tracking')
              .upsert({
                event_id: game.eventId,
                sport,
                game_date: today,
                home_team: game.homeTeam,
                away_team: game.awayTeam,
                fatigue_differential: differential,
                recommended_side: recommendedSide,
                recommended_angle: angle,
                home_fatigue_score: homeFatigueScore,
                away_fatigue_score: awayFatigueScore,
              }, {
                onConflict: 'event_id,sport',
              });
          }
          
          allResults.push({
            sport,
            game: `${game.awayTeam} @ ${game.homeTeam}`,
            homeFatigue: homeFatigueScore,
            awayFatigue: awayFatigueScore,
            differential,
            edge: angle,
          });
        }
      }
    }

    console.log(`\nSuccessfully processed ${allResults.length} total games across all sports`);

    return new Response(
      JSON.stringify({
        success: true,
        date: today,
        gamesProcessed: allResults.length,
        results: allResults,
        sportBreakdown: targetSports.map((sport: string) => ({
          sport,
          games: allResults.filter(r => r.sport === sport).length,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in sports fatigue calculator:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
