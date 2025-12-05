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
  altitude_feet: number;
}

interface ScheduleGame {
  game_date: string;
  game_time: string;
  opponent: string;
  is_home: boolean;
  venue_city: string;
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
}

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

function calculateFatigueScore(factors: FatigueFactors): number {
  let score = 0;
  if (factors.isBackToBack) score += 25;
  if (factors.isRoadBackToBack) score += 15;
  if (factors.travelMiles > 1500) score += 15;
  else if (factors.travelMiles > 1000) score += 10;
  else if (factors.travelMiles > 500) score += 5;
  if (factors.timezoneChanges >= 2) score += 10;
  else if (factors.timezoneChanges >= 1) score += 5;
  if (factors.isAltitudeGame) score += 8;
  if (factors.isThreeInFour) score += 12;
  if (factors.isFourInSix) score += 18;
  if (factors.isEarlyStart) score += 5;
  return Math.min(score, 100);
}

function getFatigueCategory(score: number): string {
  if (score >= 50) return 'Red Alert';
  if (score >= 35) return 'High Fatigue';
  if (score >= 20) return 'Moderate';
  if (score >= 10) return 'Low';
  return 'Fresh';
}

function calculateBettingAdjustments(fatigueScore: number) {
  const factor = fatigueScore / 100;
  return {
    mlAdjustment: Math.round(factor * 8 * 10) / 10,
    spreadAdjustment: Math.round(factor * 3 * 10) / 10,
    pointsAdjustment: Math.round(factor * -5 * 10) / 10,
    reboundsAdjustment: Math.round(factor * -3 * 10) / 10,
    assistsAdjustment: Math.round(factor * -4 * 10) / 10,
    threePtAdjustment: Math.round(factor * -6 * 10) / 10,
    blocksAdjustment: Math.round(factor * -4 * 10) / 10,
  };
}

function getRecommendedAngle(homeFatigue: number, awayFatigue: number): string | null {
  const diff = Math.abs(homeFatigue - awayFatigue);
  if (diff < 15) return null;
  
  const fresherTeam = homeFatigue < awayFatigue ? 'home' : 'away';
  const tiredTeam = homeFatigue < awayFatigue ? 'away' : 'home';
  
  if (diff >= 30) {
    return `Strong edge: Fade ${tiredTeam} team props, target ${fresherTeam} ML/spread`;
  } else if (diff >= 20) {
    return `Good edge: ${fresherTeam} team favored, consider unders on ${tiredTeam} players`;
  } else {
    return `Slight edge: Monitor ${tiredTeam} team performance props`;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting daily fatigue calculation...');

    // Get today's date
    const today = new Date().toISOString().split('T')[0];
    console.log(`Calculating fatigue for date: ${today}`);

    // Get all team locations
    const { data: teamLocations, error: locError } = await supabase
      .from('nba_team_locations')
      .select('*');

    if (locError) {
      throw new Error(`Failed to fetch team locations: ${locError.message}`);
    }

    const teamLocationMap = new Map<string, TeamLocation>();
    teamLocations?.forEach(loc => teamLocationMap.set(loc.team_name, loc));

    // Fetch today's NBA games from odds API
    const oddsApiKey = Deno.env.get('THE_ODDS_API_KEY');
    if (!oddsApiKey) {
      console.log('No odds API key, checking existing schedule cache');
    }

    let todaysGames: Array<{ eventId: string; homeTeam: string; awayTeam: string; gameTime: string }> = [];

    // Try to get games from odds API
    if (oddsApiKey) {
      try {
        const oddsUrl = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${oddsApiKey}&regions=us&markets=h2h&oddsFormat=american`;
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
          
          console.log(`Found ${todaysGames.length} NBA games for today from odds API`);
        }
      } catch (e) {
        console.error('Error fetching odds:', e);
      }
    }

    // If no games from API, check schedule cache
    if (todaysGames.length === 0) {
      const { data: cachedGames } = await supabase
        .from('nba_schedule_cache')
        .select('*')
        .eq('game_date', today);

      if (cachedGames && cachedGames.length > 0) {
        const gameMap = new Map<string, any>();
        cachedGames.forEach(g => {
          const key = `${g.game_time}`;
          if (!gameMap.has(key)) {
            gameMap.set(key, { games: [] });
          }
          gameMap.get(key).games.push(g);
        });

        gameMap.forEach((value, key) => {
          const homeGame = value.games.find((g: any) => g.is_home);
          const awayGame = value.games.find((g: any) => !g.is_home);
          if (homeGame && awayGame) {
            todaysGames.push({
              eventId: `${today}-${homeGame.team_name}-${awayGame.team_name}`,
              homeTeam: homeGame.team_name,
              awayTeam: awayGame.team_name,
              gameTime: homeGame.game_time,
            });
          }
        });
        console.log(`Found ${todaysGames.length} games from schedule cache`);
      }
    }

    if (todaysGames.length === 0) {
      console.log('No NBA games found for today');
      return new Response(
        JSON.stringify({ success: true, message: 'No NBA games today', gamesProcessed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process each game
    const results: any[] = [];
    
    for (const game of todaysGames) {
      console.log(`Processing: ${game.awayTeam} @ ${game.homeTeam}`);

      // Get recent schedule for both teams
      const getTeamSchedule = async (teamName: string) => {
        const { data } = await supabase
          .from('nba_schedule_cache')
          .select('*')
          .eq('team_name', teamName)
          .lt('game_date', today)
          .order('game_date', { ascending: false })
          .limit(10);
        return data || [];
      };

      const [homeSchedule, awaySchedule] = await Promise.all([
        getTeamSchedule(game.homeTeam),
        getTeamSchedule(game.awayTeam),
      ]);

      // Calculate fatigue for each team
      const calculateTeamFatigue = (
        teamName: string,
        schedule: ScheduleGame[],
        isHomeToday: boolean,
        opponentName: string
      ) => {
        const teamLoc = teamLocationMap.get(teamName);
        const opponentLoc = teamLocationMap.get(opponentName);
        
        if (!teamLoc) {
          console.log(`No location data for ${teamName}`);
          return null;
        }

        const factors: FatigueFactors = {
          isBackToBack: false,
          isRoadBackToBack: false,
          travelMiles: 0,
          timezoneChanges: 0,
          isAltitudeGame: false,
          isThreeInFour: false,
          isFourInSix: false,
          isEarlyStart: false,
        };

        // Check back-to-back
        if (schedule.length > 0) {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];
          
          const lastGame = schedule[0];
          if (lastGame.game_date === yesterdayStr) {
            factors.isBackToBack = true;
            if (!lastGame.is_home) {
              factors.isRoadBackToBack = true;
            }
          }

          // Calculate travel from last game location
          if (!lastGame.is_home && opponentLoc) {
            const lastOpponentLoc = teamLocationMap.get(lastGame.opponent);
            if (lastOpponentLoc) {
              const todayGameLoc = isHomeToday ? teamLoc : opponentLoc;
              factors.travelMiles = calculateDistance(
                lastOpponentLoc.latitude, lastOpponentLoc.longitude,
                todayGameLoc.latitude, todayGameLoc.longitude
              );
            }
          }
        }

        // Check 3-in-4 and 4-in-6
        const fourDaysAgo = new Date(today);
        fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
        const sixDaysAgo = new Date(today);
        sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

        const gamesInFour = schedule.filter(g => new Date(g.game_date) >= fourDaysAgo).length;
        const gamesInSix = schedule.filter(g => new Date(g.game_date) >= sixDaysAgo).length;

        if (gamesInFour >= 2) factors.isThreeInFour = true;
        if (gamesInSix >= 3) factors.isFourInSix = true;

        // Check altitude (Denver)
        if (!isHomeToday && opponentLoc && opponentLoc.altitude_feet > 5000) {
          factors.isAltitudeGame = true;
        }

        // Check timezone changes
        if (schedule.length > 0 && opponentLoc) {
          const tzMap: Record<string, number> = {
            'America/New_York': -5,
            'America/Chicago': -6,
            'America/Denver': -7,
            'America/Los_Angeles': -8,
          };
          const homeTz = tzMap[teamLoc.timezone] || -5;
          const gameTz = tzMap[isHomeToday ? teamLoc.timezone : opponentLoc.timezone] || -5;
          factors.timezoneChanges = Math.abs(homeTz - gameTz);
        }

        // Check early start
        const gameHour = new Date(game.gameTime).getUTCHours();
        if (gameHour < 19) factors.isEarlyStart = true;

        const fatigueScore = calculateFatigueScore(factors);
        const category = getFatigueCategory(fatigueScore);
        const adjustments = calculateBettingAdjustments(fatigueScore);

        return {
          team_name: teamName,
          opponent: opponentName,
          event_id: game.eventId,
          game_date: today,
          game_time: game.gameTime,
          is_home: isHomeToday,
          fatigue_score: fatigueScore,
          fatigue_category: category,
          is_back_to_back: factors.isBackToBack,
          is_road_back_to_back: factors.isRoadBackToBack,
          travel_miles: Math.round(factors.travelMiles),
          timezone_changes: factors.timezoneChanges,
          is_altitude_game: factors.isAltitudeGame,
          is_three_in_four: factors.isThreeInFour,
          is_four_in_six: factors.isFourInSix,
          is_early_start: factors.isEarlyStart,
          ml_adjustment_pct: adjustments.mlAdjustment,
          spread_adjustment: adjustments.spreadAdjustment,
          points_adjustment_pct: adjustments.pointsAdjustment,
          rebounds_adjustment_pct: adjustments.reboundsAdjustment,
          assists_adjustment_pct: adjustments.assistsAdjustment,
          three_pt_adjustment_pct: adjustments.threePtAdjustment,
          blocks_adjustment_pct: adjustments.blocksAdjustment,
          recommended_angle: null as string | null,
          betting_edge_summary: null as string | null,
        };
      };

      const homeFatigue = calculateTeamFatigue(game.homeTeam, homeSchedule, true, game.awayTeam);
      const awayFatigue = calculateTeamFatigue(game.awayTeam, awaySchedule, false, game.homeTeam);

      if (homeFatigue && awayFatigue) {
        const angle = getRecommendedAngle(homeFatigue.fatigue_score, awayFatigue.fatigue_score);
        const edgeSummary = angle ? `${Math.abs(homeFatigue.fatigue_score - awayFatigue.fatigue_score)} point differential` : null;

        homeFatigue.recommended_angle = angle;
        homeFatigue.betting_edge_summary = edgeSummary;
        awayFatigue.recommended_angle = angle;
        awayFatigue.betting_edge_summary = edgeSummary;

        // Upsert fatigue scores
        const { error: upsertError } = await supabase
          .from('nba_fatigue_scores')
          .upsert([homeFatigue, awayFatigue], {
            onConflict: 'event_id,team_name',
          });

        if (upsertError) {
          console.error(`Error upserting fatigue for ${game.homeTeam} vs ${game.awayTeam}:`, upsertError);
        } else {
          // Track edges with 15+ differential
          const differential = Math.abs(homeFatigue.fatigue_score - awayFatigue.fatigue_score);
          if (differential >= 15) {
            const recommendedSide = homeFatigue.fatigue_score < awayFatigue.fatigue_score ? 'home' : 'away';
            
            await supabase
              .from('fatigue_edge_tracking')
              .upsert({
                event_id: game.eventId,
                game_date: today,
                home_team: game.homeTeam,
                away_team: game.awayTeam,
                fatigue_differential: differential,
                recommended_side: recommendedSide,
                recommended_angle: angle,
                home_fatigue_score: homeFatigue.fatigue_score,
                away_fatigue_score: awayFatigue.fatigue_score,
              }, {
                onConflict: 'event_id',
              });
          }
          
          results.push({
            game: `${game.awayTeam} @ ${game.homeTeam}`,
            homeFatigue: homeFatigue.fatigue_score,
            awayFatigue: awayFatigue.fatigue_score,
            edge: angle,
          });
        }
      }
    }

    console.log(`Successfully processed ${results.length} games`);

    return new Response(
      JSON.stringify({
        success: true,
        date: today,
        gamesProcessed: results.length,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in daily fatigue calculator:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
