import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Team location data for fatigue calculations
const TEAM_LOCATIONS: Record<string, { lat: number; lon: number; altitude: number; timezone: string; city: string }> = {
  'Atlanta Hawks': { lat: 33.757, lon: -84.396, altitude: 1050, timezone: 'America/New_York', city: 'Atlanta' },
  'Boston Celtics': { lat: 42.366, lon: -71.062, altitude: 20, timezone: 'America/New_York', city: 'Boston' },
  'Brooklyn Nets': { lat: 40.683, lon: -73.975, altitude: 30, timezone: 'America/New_York', city: 'Brooklyn' },
  'Charlotte Hornets': { lat: 35.225, lon: -80.839, altitude: 751, timezone: 'America/New_York', city: 'Charlotte' },
  'Chicago Bulls': { lat: 41.881, lon: -87.674, altitude: 594, timezone: 'America/Chicago', city: 'Chicago' },
  'Cleveland Cavaliers': { lat: 41.496, lon: -81.688, altitude: 653, timezone: 'America/New_York', city: 'Cleveland' },
  'Dallas Mavericks': { lat: 32.790, lon: -96.810, altitude: 430, timezone: 'America/Chicago', city: 'Dallas' },
  'Denver Nuggets': { lat: 39.749, lon: -105.008, altitude: 5280, timezone: 'America/Denver', city: 'Denver' },
  'Detroit Pistons': { lat: 42.341, lon: -83.055, altitude: 600, timezone: 'America/Detroit', city: 'Detroit' },
  'Golden State Warriors': { lat: 37.768, lon: -122.388, altitude: 10, timezone: 'America/Los_Angeles', city: 'San Francisco' },
  'Houston Rockets': { lat: 29.751, lon: -95.362, altitude: 50, timezone: 'America/Chicago', city: 'Houston' },
  'Indiana Pacers': { lat: 39.764, lon: -86.156, altitude: 715, timezone: 'America/Indiana/Indianapolis', city: 'Indianapolis' },
  'LA Clippers': { lat: 33.944, lon: -118.340, altitude: 340, timezone: 'America/Los_Angeles', city: 'Inglewood' },
  'Los Angeles Lakers': { lat: 34.043, lon: -118.267, altitude: 270, timezone: 'America/Los_Angeles', city: 'Los Angeles' },
  'Memphis Grizzlies': { lat: 35.138, lon: -90.051, altitude: 337, timezone: 'America/Chicago', city: 'Memphis' },
  'Miami Heat': { lat: 25.781, lon: -80.188, altitude: 10, timezone: 'America/New_York', city: 'Miami' },
  'Milwaukee Bucks': { lat: 43.044, lon: -87.917, altitude: 617, timezone: 'America/Chicago', city: 'Milwaukee' },
  'Minnesota Timberwolves': { lat: 44.980, lon: -93.276, altitude: 830, timezone: 'America/Chicago', city: 'Minneapolis' },
  'New Orleans Pelicans': { lat: 29.949, lon: -90.082, altitude: 3, timezone: 'America/Chicago', city: 'New Orleans' },
  'New York Knicks': { lat: 40.751, lon: -73.994, altitude: 33, timezone: 'America/New_York', city: 'New York' },
  'Oklahoma City Thunder': { lat: 35.463, lon: -97.515, altitude: 1201, timezone: 'America/Chicago', city: 'Oklahoma City' },
  'Orlando Magic': { lat: 28.539, lon: -81.384, altitude: 82, timezone: 'America/New_York', city: 'Orlando' },
  'Philadelphia 76ers': { lat: 39.901, lon: -75.172, altitude: 39, timezone: 'America/New_York', city: 'Philadelphia' },
  'Phoenix Suns': { lat: 33.446, lon: -112.071, altitude: 1086, timezone: 'America/Phoenix', city: 'Phoenix' },
  'Portland Trail Blazers': { lat: 45.532, lon: -122.667, altitude: 50, timezone: 'America/Los_Angeles', city: 'Portland' },
  'Sacramento Kings': { lat: 38.580, lon: -121.500, altitude: 30, timezone: 'America/Los_Angeles', city: 'Sacramento' },
  'San Antonio Spurs': { lat: 29.427, lon: -98.438, altitude: 650, timezone: 'America/Chicago', city: 'San Antonio' },
  'Toronto Raptors': { lat: 43.643, lon: -79.379, altitude: 249, timezone: 'America/Toronto', city: 'Toronto' },
  'Utah Jazz': { lat: 40.768, lon: -111.901, altitude: 4226, timezone: 'America/Denver', city: 'Salt Lake City' },
  'Washington Wizards': { lat: 38.898, lon: -77.021, altitude: 25, timezone: 'America/New_York', city: 'Washington' },
};

// ESPN team name mappings
const ESPN_TEAM_MAP: Record<string, string> = {
  'ATL': 'Atlanta Hawks', 'BOS': 'Boston Celtics', 'BKN': 'Brooklyn Nets', 'CHA': 'Charlotte Hornets',
  'CHI': 'Chicago Bulls', 'CLE': 'Cleveland Cavaliers', 'DAL': 'Dallas Mavericks', 'DEN': 'Denver Nuggets',
  'DET': 'Detroit Pistons', 'GS': 'Golden State Warriors', 'GSW': 'Golden State Warriors',
  'HOU': 'Houston Rockets', 'IND': 'Indiana Pacers', 'LAC': 'LA Clippers', 'LAL': 'Los Angeles Lakers',
  'MEM': 'Memphis Grizzlies', 'MIA': 'Miami Heat', 'MIL': 'Milwaukee Bucks', 'MIN': 'Minnesota Timberwolves',
  'NO': 'New Orleans Pelicans', 'NOP': 'New Orleans Pelicans', 'NY': 'New York Knicks', 'NYK': 'New York Knicks',
  'OKC': 'Oklahoma City Thunder', 'ORL': 'Orlando Magic', 'PHI': 'Philadelphia 76ers', 'PHX': 'Phoenix Suns',
  'POR': 'Portland Trail Blazers', 'SAC': 'Sacramento Kings', 'SA': 'San Antonio Spurs', 'SAS': 'San Antonio Spurs',
  'TOR': 'Toronto Raptors', 'UTA': 'Utah Jazz', 'UTAH': 'Utah Jazz', 'WAS': 'Washington Wizards', 'WSH': 'Washington Wizards',
};

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

function getTimezoneOffset(tz: string): number {
  const offsets: Record<string, number> = {
    'America/New_York': -5, 'America/Detroit': -5, 'America/Indiana/Indianapolis': -5,
    'America/Chicago': -6, 'America/Denver': -7, 'America/Phoenix': -7,
    'America/Los_Angeles': -8, 'America/Toronto': -5,
  };
  return offsets[tz] || -5;
}

interface GameSchedule {
  teamName: string;
  opponent: string;
  gameDate: string;
  gameTime: string;
  isHome: boolean;
  venueCity: string;
}

interface FatigueFactors {
  isBackToBack: boolean;
  isRoadBackToBack: boolean;
  isThreeInFour: boolean;
  isFourInSix: boolean;
  travelMiles: number;
  timezoneChanges: number;
  isAltitudeGame: boolean;
  isEarlyStart: boolean;
}

function calculateFatigueScore(factors: FatigueFactors): number {
  let score = 0;
  if (factors.isBackToBack) score += 25;
  if (factors.isRoadBackToBack) score += 10;
  if (factors.isThreeInFour) score += 12;
  if (factors.isFourInSix) score += 8;
  if (factors.travelMiles > 2000) score += 8;
  else if (factors.travelMiles > 1000) score += 5;
  else if (factors.travelMiles > 500) score += 3;
  if (factors.timezoneChanges >= 3) score += 6;
  else if (factors.timezoneChanges >= 2) score += 4;
  else if (factors.timezoneChanges >= 1) score += 2;
  if (factors.isAltitudeGame) score += 5;
  if (factors.isEarlyStart) score += 3;
  return score;
}

function getFatigueCategory(score: number): string {
  if (score >= 35) return 'Exhausted';
  if (score >= 25) return 'High Fatigue';
  if (score >= 15) return 'Moderate';
  if (score >= 5) return 'Slight';
  return 'Fresh';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('Starting historical fatigue data seeding...');

    // Season start: Oct 22, 2024
    const seasonStart = new Date('2024-10-22');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // Collect all games from the season
    const allGames: Array<{
      date: string;
      homeTeam: string;
      awayTeam: string;
      homeScore: number;
      awayScore: number;
      eventId: string;
      gameTime: string;
    }> = [];

    // Fetch games day by day from ESPN
    let currentDate = new Date(seasonStart);
    let daysProcessed = 0;
    const maxDays = 60; // Process up to 60 days to avoid timeout

    while (currentDate <= yesterday && daysProcessed < maxDays) {
      const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '');
      console.log(`Fetching games for ${dateStr}...`);

      try {
        const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`;
        const response = await fetch(espnUrl);
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.events && data.events.length > 0) {
            for (const event of data.events) {
              const competition = event.competitions?.[0];
              if (!competition) continue;

              // Only process completed games
              if (competition.status?.type?.completed !== true) continue;

              const homeTeamData = competition.competitors?.find((c: any) => c.homeAway === 'home');
              const awayTeamData = competition.competitors?.find((c: any) => c.homeAway === 'away');

              if (!homeTeamData || !awayTeamData) continue;

              const homeAbbrev = homeTeamData.team?.abbreviation;
              const awayAbbrev = awayTeamData.team?.abbreviation;
              const homeTeam = ESPN_TEAM_MAP[homeAbbrev] || homeTeamData.team?.displayName;
              const awayTeam = ESPN_TEAM_MAP[awayAbbrev] || awayTeamData.team?.displayName;

              if (!TEAM_LOCATIONS[homeTeam] || !TEAM_LOCATIONS[awayTeam]) {
                console.log(`Skipping unknown team: ${homeTeam} or ${awayTeam}`);
                continue;
              }

              allGames.push({
                date: currentDate.toISOString().split('T')[0],
                homeTeam,
                awayTeam,
                homeScore: parseInt(homeTeamData.score || '0'),
                awayScore: parseInt(awayTeamData.score || '0'),
                eventId: event.id,
                gameTime: event.date || currentDate.toISOString(),
              });
            }
          }
        }
      } catch (fetchError) {
        console.error(`Error fetching games for ${dateStr}:`, fetchError);
      }

      currentDate.setDate(currentDate.getDate() + 1);
      daysProcessed++;
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`Fetched ${allGames.length} completed games`);

    // Sort games by date
    allGames.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Build schedule cache and track team schedules
    const teamSchedules: Record<string, GameSchedule[]> = {};
    const scheduleRecords: any[] = [];
    const fatigueRecords: any[] = [];
    const edgeRecords: any[] = [];

    for (const game of allGames) {
      const homeLocation = TEAM_LOCATIONS[game.homeTeam];
      const awayLocation = TEAM_LOCATIONS[game.awayTeam];

      // Add to team schedules
      if (!teamSchedules[game.homeTeam]) teamSchedules[game.homeTeam] = [];
      if (!teamSchedules[game.awayTeam]) teamSchedules[game.awayTeam] = [];

      const homeScheduleEntry: GameSchedule = {
        teamName: game.homeTeam,
        opponent: game.awayTeam,
        gameDate: game.date,
        gameTime: game.gameTime,
        isHome: true,
        venueCity: homeLocation.city,
      };

      const awayScheduleEntry: GameSchedule = {
        teamName: game.awayTeam,
        opponent: game.homeTeam,
        gameDate: game.date,
        gameTime: game.gameTime,
        isHome: false,
        venueCity: homeLocation.city,
      };

      // Calculate fatigue for both teams
      const calcFatigueForTeam = (teamName: string, isHome: boolean, opponentName: string): FatigueFactors & { score: number; category: string } => {
        const teamLocation = TEAM_LOCATIONS[teamName];
        const gameLocation = TEAM_LOCATIONS[game.homeTeam]; // Game is at home team's location
        const recentGames = teamSchedules[teamName].slice(-5);
        
        const gameDate = new Date(game.date);
        
        // Back-to-back check
        const yesterday = new Date(gameDate);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        const isBackToBack = recentGames.some(g => g.gameDate === yesterdayStr);
        const isRoadBackToBack = isBackToBack && recentGames.find(g => g.gameDate === yesterdayStr)?.isHome === false;

        // 3-in-4 check
        const fourDaysAgo = new Date(gameDate);
        fourDaysAgo.setDate(fourDaysAgo.getDate() - 3);
        const gamesInLast4Days = recentGames.filter(g => new Date(g.gameDate) >= fourDaysAgo).length;
        const isThreeInFour = gamesInLast4Days >= 2;

        // 4-in-6 check
        const sixDaysAgo = new Date(gameDate);
        sixDaysAgo.setDate(sixDaysAgo.getDate() - 5);
        const gamesInLast6Days = recentGames.filter(g => new Date(g.gameDate) >= sixDaysAgo).length;
        const isFourInSix = gamesInLast6Days >= 3;

        // Travel calculation (from last game location to this game)
        let travelMiles = 0;
        let timezoneChanges = 0;
        if (recentGames.length > 0) {
          const lastGame = recentGames[recentGames.length - 1];
          const lastGameLocation = lastGame.isHome ? teamLocation : TEAM_LOCATIONS[lastGame.opponent];
          if (lastGameLocation) {
            travelMiles = calculateDistance(
              lastGameLocation.lat, lastGameLocation.lon,
              gameLocation.lat, gameLocation.lon
            );
            timezoneChanges = Math.abs(
              getTimezoneOffset(lastGameLocation.timezone) - getTimezoneOffset(gameLocation.timezone)
            );
          }
        }

        // Altitude game (Denver or Utah)
        const isAltitudeGame = !isHome && gameLocation.altitude > 4000;

        // Early start (before 5pm local)
        const gameHour = new Date(game.gameTime).getHours();
        const isEarlyStart = gameHour < 17;

        const factors: FatigueFactors = {
          isBackToBack,
          isRoadBackToBack,
          isThreeInFour,
          isFourInSix,
          travelMiles,
          timezoneChanges,
          isAltitudeGame,
          isEarlyStart,
        };

        const score = calculateFatigueScore(factors);
        const category = getFatigueCategory(score);

        return { ...factors, score, category };
      };

      const homeFatigue = calcFatigueForTeam(game.homeTeam, true, game.awayTeam);
      const awayFatigue = calcFatigueForTeam(game.awayTeam, false, game.homeTeam);

      // Add to team schedules after calculation
      teamSchedules[game.homeTeam].push(homeScheduleEntry);
      teamSchedules[game.awayTeam].push(awayScheduleEntry);

      // Create schedule cache records
      scheduleRecords.push({
        team_name: game.homeTeam,
        opponent: game.awayTeam,
        game_date: game.date,
        game_time: game.gameTime,
        is_home: true,
        venue_city: homeLocation.city,
      });
      scheduleRecords.push({
        team_name: game.awayTeam,
        opponent: game.homeTeam,
        game_date: game.date,
        game_time: game.gameTime,
        is_home: false,
        venue_city: homeLocation.city,
      });

      // Create fatigue score records
      const createFatigueRecord = (teamName: string, opponent: string, isHome: boolean, fatigue: any) => ({
        event_id: game.eventId,
        team_name: teamName,
        opponent,
        game_date: game.date,
        game_time: game.gameTime,
        is_home: isHome,
        fatigue_score: fatigue.score,
        fatigue_category: fatigue.category,
        is_back_to_back: fatigue.isBackToBack,
        is_road_back_to_back: fatigue.isRoadBackToBack,
        is_three_in_four: fatigue.isThreeInFour,
        is_four_in_six: fatigue.isFourInSix,
        travel_miles: Math.round(fatigue.travelMiles),
        timezone_changes: fatigue.timezoneChanges,
        is_altitude_game: fatigue.isAltitudeGame,
        is_early_start: fatigue.isEarlyStart,
        spread_adjustment: fatigue.score * 0.1,
        ml_adjustment_pct: fatigue.score * 0.5,
        points_adjustment_pct: fatigue.score * -0.3,
        rebounds_adjustment_pct: fatigue.score * -0.2,
        assists_adjustment_pct: fatigue.score * -0.15,
        three_pt_adjustment_pct: fatigue.score * -0.25,
        blocks_adjustment_pct: fatigue.score * -0.1,
      });

      fatigueRecords.push(createFatigueRecord(game.homeTeam, game.awayTeam, true, homeFatigue));
      fatigueRecords.push(createFatigueRecord(game.awayTeam, game.homeTeam, false, awayFatigue));

      // Check for fatigue edge (15+ differential)
      const fatigueDifferential = Math.abs(homeFatigue.score - awayFatigue.score);
      if (fatigueDifferential >= 15) {
        const fresherTeam = homeFatigue.score < awayFatigue.score ? game.homeTeam : game.awayTeam;
        const fresherIsHome = fresherTeam === game.homeTeam;
        
        // Determine if fresher team won
        const fresherTeamWon = fresherIsHome 
          ? game.homeScore > game.awayScore 
          : game.awayScore > game.homeScore;

        const spread = game.homeScore - game.awayScore;
        const total = game.homeScore + game.awayScore;

        edgeRecords.push({
          event_id: game.eventId,
          game_date: game.date,
          home_team: game.homeTeam,
          away_team: game.awayTeam,
          home_fatigue_score: homeFatigue.score,
          away_fatigue_score: awayFatigue.score,
          fatigue_differential: fatigueDifferential,
          recommended_side: fresherTeam,
          recommended_angle: fresherIsHome ? 'Fade tired road team' : 'Back rested road team',
          recommended_side_won: fresherTeamWon,
          game_result: `${game.homeTeam} ${game.homeScore} - ${game.awayScore} ${game.awayTeam}`,
          actual_spread: spread,
          actual_total: total,
          verified_at: new Date().toISOString(),
        });
      }
    }

    console.log(`Created ${scheduleRecords.length} schedule records`);
    console.log(`Created ${fatigueRecords.length} fatigue records`);
    console.log(`Found ${edgeRecords.length} fatigue edges (15+ differential)`);

    // Upsert schedule cache in batches
    const batchSize = 100;
    for (let i = 0; i < scheduleRecords.length; i += batchSize) {
      const batch = scheduleRecords.slice(i, i + batchSize);
      const { error } = await supabase
        .from('nba_schedule_cache')
        .upsert(batch, { onConflict: 'team_name,game_date' });
      if (error) console.error('Schedule cache upsert error:', error);
    }

    // Upsert fatigue scores in batches
    for (let i = 0; i < fatigueRecords.length; i += batchSize) {
      const batch = fatigueRecords.slice(i, i + batchSize);
      const { error } = await supabase
        .from('nba_fatigue_scores')
        .upsert(batch, { onConflict: 'event_id,team_name' });
      if (error) console.error('Fatigue scores upsert error:', error);
    }

    // Upsert edge tracking records in batches
    for (let i = 0; i < edgeRecords.length; i += batchSize) {
      const batch = edgeRecords.slice(i, i + batchSize);
      const { error } = await supabase
        .from('fatigue_edge_tracking')
        .upsert(batch, { onConflict: 'event_id' });
      if (error) console.error('Edge tracking upsert error:', error);
    }

    // Calculate summary stats
    const wins = edgeRecords.filter(e => e.recommended_side_won === true).length;
    const losses = edgeRecords.filter(e => e.recommended_side_won === false).length;
    const winRate = edgeRecords.length > 0 ? (wins / edgeRecords.length * 100).toFixed(1) : 0;
    const roi = edgeRecords.length > 0 ? ((wins * 0.91 - losses) / edgeRecords.length * 100).toFixed(1) : 0;

    console.log(`Seeding complete! Edges: ${edgeRecords.length}, Win Rate: ${winRate}%, ROI: ${roi}%`);

    return new Response(JSON.stringify({
      success: true,
      gamesProcessed: allGames.length,
      scheduleRecords: scheduleRecords.length,
      fatigueRecords: fatigueRecords.length,
      edgesFound: edgeRecords.length,
      edgeStats: {
        wins,
        losses,
        winRate: parseFloat(winRate as string),
        roi: parseFloat(roi as string),
      },
      daysProcessed,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error seeding historical fatigue data:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      success: false,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
