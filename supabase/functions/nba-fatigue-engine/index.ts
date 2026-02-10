import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// EST-aware date helper
function getEasternDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

// Timezone to UTC offset mapping
const TIMEZONE_OFFSETS: Record<string, number> = {
  'America/New_York': -5,
  'America/Chicago': -6,
  'America/Denver': -7,
  'America/Phoenix': -7,
  'America/Los_Angeles': -8,
  'America/Toronto': -5,
};

interface TeamLocation {
  team_name: string;
  city: string;
  latitude: number;
  longitude: number;
  altitude_feet: number;
  timezone: string;
}

interface ScheduleGame {
  team_name: string;
  game_date: string;
  opponent: string;
  is_home: boolean;
  game_time: string;
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

interface FatigueResult {
  teamName: string;
  opponent: string;
  fatigueScore: number;
  fatigueCategory: string;
  factors: FatigueFactors;
  mlAdjustmentPct: number;
  spreadAdjustment: number;
  propAdjustments: {
    points: number;
    rebounds: number;
    assists: number;
    threePt: number;
    blocks: number;
  };
  recommendedAngle: string;
  bettingEdgeSummary: string;
}

// Calculate distance between two coordinates using Haversine formula
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Calculate fatigue score based on factors
function calculateFatigueScore(factors: FatigueFactors): number {
  let score = 0;
  
  if (factors.isBackToBack) score += 22;
  if (factors.isRoadBackToBack) score += 14;
  score += factors.travelMiles / 120;
  score += factors.timezoneChanges * 6;
  if (factors.isAltitudeGame) score += 10;
  if (factors.isThreeInFour) score += 12;
  if (factors.isFourInSix) score += 18;
  if (factors.isEarlyStart) score += 8;
  
  return Math.min(100, Math.round(score));
}

// Get fatigue category from score
function getFatigueCategory(score: number): string {
  if (score <= 20) return 'Fresh';
  if (score <= 40) return 'Mild Fatigue';
  if (score <= 60) return 'Significant Fatigue';
  if (score <= 80) return 'Heavy Fatigue';
  return 'Red Alert';
}

// Calculate betting adjustments based on fatigue score
function calculateBettingAdjustments(fatigueScore: number) {
  const factor = fatigueScore / 10;
  
  return {
    mlAdjustmentPct: -0.5 * factor,
    spreadAdjustment: 0.15 * factor,
    propAdjustments: {
      points: -1.5 * factor,
      rebounds: -2.5 * factor,
      assists: -1.0 * factor,
      threePt: -2.0 * factor,
      blocks: -1.8 * factor,
    }
  };
}

// Generate recommended angle based on fatigue differential
function getRecommendedAngle(teamFatigue: number, opponentFatigue: number): string {
  const diff = teamFatigue - opponentFatigue;
  
  if (diff >= 30) return 'ATTACK opponent ML, team player UNDERS';
  if (diff >= 15) return 'LEAN opponent, team player prop UNDERS';
  if (diff <= -30) return 'ATTACK team ML, opponent player UNDERS';
  if (diff <= -15) return 'LEAN team, opponent player prop UNDERS';
  return 'PASS - No significant fatigue edge';
}

// Analyze fatigue for a team
async function analyzeTeamFatigue(
  supabase: any,
  teamName: string,
  gameDate: Date,
  gameTime: Date,
  isHome: boolean,
  venueLocation: TeamLocation,
  teamLocations: Map<string, TeamLocation>,
  recentGames: ScheduleGame[]
): Promise<FatigueFactors> {
  const teamLocation = teamLocations.get(teamName);
  if (!teamLocation) {
    return {
      isBackToBack: false,
      isRoadBackToBack: false,
      travelMiles: 0,
      timezoneChanges: 0,
      isAltitudeGame: false,
      isThreeInFour: false,
      isFourInSix: false,
      isEarlyStart: false,
    };
  }
  
  // Sort games by date descending
  const sortedGames = recentGames
    .filter(g => new Date(g.game_date) < gameDate)
    .sort((a, b) => new Date(b.game_date).getTime() - new Date(a.game_date).getTime());
  
  // Check back-to-back
  const yesterday = new Date(gameDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const yesterdayGame = sortedGames.find(g => g.game_date === yesterdayStr);
  const isBackToBack = !!yesterdayGame;
  
  // Check road back-to-back (traveling between cities)
  const isRoadBackToBack = isBackToBack && yesterdayGame && !yesterdayGame.is_home && !isHome;
  
  // Calculate travel miles in last 3 games
  let travelMiles = 0;
  let lastLocation = teamLocation;
  
  for (let i = 0; i < Math.min(3, sortedGames.length); i++) {
    const game = sortedGames[i];
    let gameLocation: TeamLocation | undefined;
    
    if (game.is_home) {
      gameLocation = teamLocation;
    } else {
      // Find opponent location
      gameLocation = teamLocations.get(game.opponent);
    }
    
    if (gameLocation && lastLocation) {
      travelMiles += calculateDistance(
        lastLocation.latitude, lastLocation.longitude,
        gameLocation.latitude, gameLocation.longitude
      );
      lastLocation = gameLocation;
    }
  }
  
  // Add travel to current game venue
  if (lastLocation && venueLocation) {
    travelMiles += calculateDistance(
      lastLocation.latitude, lastLocation.longitude,
      venueLocation.latitude, venueLocation.longitude
    );
  }
  
  // Calculate timezone changes
  let timezoneChanges = 0;
  if (sortedGames.length > 0 && !isHome) {
    const lastGame = sortedGames[0];
    let lastTimezone: string;
    
    if (lastGame.is_home) {
      lastTimezone = teamLocation.timezone;
    } else {
      const opponentLoc = teamLocations.get(lastGame.opponent);
      lastTimezone = opponentLoc?.timezone || teamLocation.timezone;
    }
    
    const lastOffset = TIMEZONE_OFFSETS[lastTimezone] || -5;
    const currentOffset = TIMEZONE_OFFSETS[venueLocation.timezone] || -5;
    timezoneChanges = Math.abs(currentOffset - lastOffset);
  }
  
  // Check altitude (Denver = 5280ft, Utah = 4226ft)
  const isAltitudeGame = venueLocation.altitude_feet >= 4000;
  
  // Check 3-in-4 days
  const fourDaysAgo = new Date(gameDate);
  fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
  const gamesInFourDays = sortedGames.filter(g => new Date(g.game_date) >= fourDaysAgo).length;
  const isThreeInFour = gamesInFourDays >= 2; // 2 previous + current = 3
  
  // Check 4-in-6 days
  const sixDaysAgo = new Date(gameDate);
  sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
  const gamesInSixDays = sortedGames.filter(g => new Date(g.game_date) >= sixDaysAgo).length;
  const isFourInSix = gamesInSixDays >= 3; // 3 previous + current = 4
  
  // Check early start (before 1pm local time)
  const gameHour = gameTime.getHours();
  const localOffset = TIMEZONE_OFFSETS[venueLocation.timezone] || -5;
  const utcHour = gameHour;
  const localHour = utcHour + localOffset;
  const isEarlyStart = localHour < 13 && localHour >= 0;
  
  return {
    isBackToBack,
    isRoadBackToBack,
    travelMiles: Math.round(travelMiles),
    timezoneChanges,
    isAltitudeGame,
    isThreeInFour,
    isFourInSix,
    isEarlyStart,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, eventId, homeTeam, awayTeam, gameTime } = await req.json();

    // Get all team locations
    const { data: locations, error: locError } = await supabase
      .from('nba_team_locations')
      .select('*');
    
    if (locError) throw locError;
    
    const teamLocations = new Map<string, TeamLocation>();
    for (const loc of locations || []) {
      teamLocations.set(loc.team_name, loc);
    }

    if (action === 'calculate') {
      // Calculate fatigue for a specific game
      const gameDate = new Date(gameTime);
      const homeLoc = teamLocations.get(homeTeam);
      const awayLoc = teamLocations.get(awayTeam);
      
      if (!homeLoc || !awayLoc) {
        throw new Error(`Team not found: ${!homeLoc ? homeTeam : awayTeam}`);
      }

      // Get recent games for both teams (last 10 games)
      const tenDaysAgo = new Date(gameDate);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 14);
      
      const { data: homeGames } = await supabase
        .from('nba_schedule_cache')
        .select('*')
        .eq('team_name', homeTeam)
        .gte('game_date', tenDaysAgo.toISOString().split('T')[0])
        .lt('game_date', gameDate.toISOString().split('T')[0])
        .order('game_date', { ascending: false })
        .limit(10);
      
      const { data: awayGames } = await supabase
        .from('nba_schedule_cache')
        .select('*')
        .eq('team_name', awayTeam)
        .gte('game_date', tenDaysAgo.toISOString().split('T')[0])
        .lt('game_date', gameDate.toISOString().split('T')[0])
        .order('game_date', { ascending: false })
        .limit(10);

      // Analyze fatigue for both teams
      const homeFactors = await analyzeTeamFatigue(
        supabase, homeTeam, gameDate, gameDate, true, homeLoc, teamLocations, homeGames || []
      );
      const awayFactors = await analyzeTeamFatigue(
        supabase, awayTeam, gameDate, gameDate, false, homeLoc, teamLocations, awayGames || []
      );

      const homeFatigueScore = calculateFatigueScore(homeFactors);
      const awayFatigueScore = calculateFatigueScore(awayFactors);
      
      const homeAdjustments = calculateBettingAdjustments(homeFatigueScore);
      const awayAdjustments = calculateBettingAdjustments(awayFatigueScore);

      const results: FatigueResult[] = [
        {
          teamName: homeTeam,
          opponent: awayTeam,
          fatigueScore: homeFatigueScore,
          fatigueCategory: getFatigueCategory(homeFatigueScore),
          factors: homeFactors,
          ...homeAdjustments,
          recommendedAngle: getRecommendedAngle(homeFatigueScore, awayFatigueScore),
          bettingEdgeSummary: homeFatigueScore > awayFatigueScore + 20 
            ? `Fade ${homeTeam} - ${homeFatigueScore - awayFatigueScore}pt fatigue disadvantage`
            : homeFatigueScore < awayFatigueScore - 20
            ? `Lean ${homeTeam} - ${awayFatigueScore - homeFatigueScore}pt fatigue advantage`
            : 'No significant fatigue edge',
        },
        {
          teamName: awayTeam,
          opponent: homeTeam,
          fatigueScore: awayFatigueScore,
          fatigueCategory: getFatigueCategory(awayFatigueScore),
          factors: awayFactors,
          ...awayAdjustments,
          recommendedAngle: getRecommendedAngle(awayFatigueScore, homeFatigueScore),
          bettingEdgeSummary: awayFatigueScore > homeFatigueScore + 20 
            ? `Fade ${awayTeam} - ${awayFatigueScore - homeFatigueScore}pt fatigue disadvantage`
            : awayFatigueScore < homeFatigueScore - 20
            ? `Lean ${awayTeam} - ${homeFatigueScore - awayFatigueScore}pt fatigue advantage`
            : 'No significant fatigue edge',
        }
      ];

      // Store results in database
      for (const result of results) {
        await supabase.from('nba_fatigue_scores').upsert({
          event_id: eventId,
          team_name: result.teamName,
          opponent: result.opponent,
          game_date: gameDate.toISOString().split('T')[0],
          game_time: gameTime,
          is_home: result.teamName === homeTeam,
          fatigue_score: result.fatigueScore,
          fatigue_category: result.fatigueCategory,
          is_back_to_back: result.factors.isBackToBack,
          is_road_back_to_back: result.factors.isRoadBackToBack,
          travel_miles: result.factors.travelMiles,
          timezone_changes: result.factors.timezoneChanges,
          is_altitude_game: result.factors.isAltitudeGame,
          is_three_in_four: result.factors.isThreeInFour,
          is_four_in_six: result.factors.isFourInSix,
          is_early_start: result.factors.isEarlyStart,
          ml_adjustment_pct: result.mlAdjustmentPct,
          spread_adjustment: result.spreadAdjustment,
          points_adjustment_pct: result.propAdjustments.points,
          rebounds_adjustment_pct: result.propAdjustments.rebounds,
          assists_adjustment_pct: result.propAdjustments.assists,
          three_pt_adjustment_pct: result.propAdjustments.threePt,
          blocks_adjustment_pct: result.propAdjustments.blocks,
          recommended_angle: result.recommendedAngle,
          betting_edge_summary: result.bettingEdgeSummary,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'event_id,team_name' });
      }

      return new Response(JSON.stringify({
        success: true,
        homeTeam: results[0],
        awayTeam: results[1],
        fatigueDifferential: awayFatigueScore - homeFatigueScore,
        bestBettingEdge: Math.abs(homeFatigueScore - awayFatigueScore) >= 20
          ? (homeFatigueScore > awayFatigueScore 
              ? `Fade ${homeTeam}, attack ${awayTeam} ML/spread`
              : `Fade ${awayTeam}, attack ${homeTeam} ML/spread`)
          : 'No significant fatigue edge detected',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get-scores') {
      // Get fatigue scores for a specific game
      const { data: scores, error } = await supabase
        .from('nba_fatigue_scores')
        .select('*')
        .eq('event_id', eventId);
      
      if (error) throw error;
      
      return new Response(JSON.stringify({ scores }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get-today') {
      // Get all fatigue scores for today's games
      const today = getEasternDate();
      
      const { data: scores, error } = await supabase
        .from('nba_fatigue_scores')
        .select('*')
        .eq('game_date', today)
        .order('game_time', { ascending: true });
      
      if (error) throw error;
      
      // Group by event_id for game pairs
      const games = new Map<string, any[]>();
      for (const score of scores || []) {
        if (!games.has(score.event_id)) {
          games.set(score.event_id, []);
        }
        games.get(score.event_id)!.push(score);
      }
      
      return new Response(JSON.stringify({ 
        games: Array.from(games.entries()).map(([eventId, teams]) => ({
          eventId,
          teams,
          fatigueDifferential: teams.length === 2 
            ? Math.abs(teams[0].fatigue_score - teams[1].fatigue_score)
            : 0,
        }))
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in nba-fatigue-engine:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
