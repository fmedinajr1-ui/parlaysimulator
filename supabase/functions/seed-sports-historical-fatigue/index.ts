import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Sport configurations for ESPN API
const SPORT_CONFIGS: Record<string, { espnSport: string; espnLeague: string; seasonStart: string }> = {
  basketball_nba: { espnSport: 'basketball', espnLeague: 'nba', seasonStart: '2024-10-22' },
  americanfootball_nfl: { espnSport: 'football', espnLeague: 'nfl', seasonStart: '2024-09-05' },
  baseball_mlb: { espnSport: 'baseball', espnLeague: 'mlb', seasonStart: '2024-03-28' },
  icehockey_nhl: { espnSport: 'hockey', espnLeague: 'nhl', seasonStart: '2024-10-08' },
};

// Team locations for fatigue calculations
const TEAM_LOCATIONS: Record<string, Record<string, { lat: number; lon: number; altitude: number; timezone: string; city: string }>> = {
  basketball_nba: {
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
  },
  americanfootball_nfl: {
    'Arizona Cardinals': { lat: 33.528, lon: -112.263, altitude: 1086, timezone: 'America/Phoenix', city: 'Glendale' },
    'Atlanta Falcons': { lat: 33.755, lon: -84.401, altitude: 1050, timezone: 'America/New_York', city: 'Atlanta' },
    'Baltimore Ravens': { lat: 39.278, lon: -76.623, altitude: 54, timezone: 'America/New_York', city: 'Baltimore' },
    'Buffalo Bills': { lat: 42.774, lon: -78.787, altitude: 600, timezone: 'America/New_York', city: 'Orchard Park' },
    'Carolina Panthers': { lat: 35.225, lon: -80.853, altitude: 751, timezone: 'America/New_York', city: 'Charlotte' },
    'Chicago Bears': { lat: 41.862, lon: -87.617, altitude: 594, timezone: 'America/Chicago', city: 'Chicago' },
    'Cincinnati Bengals': { lat: 39.095, lon: -84.516, altitude: 484, timezone: 'America/New_York', city: 'Cincinnati' },
    'Cleveland Browns': { lat: 41.506, lon: -81.700, altitude: 653, timezone: 'America/New_York', city: 'Cleveland' },
    'Dallas Cowboys': { lat: 32.748, lon: -97.093, altitude: 604, timezone: 'America/Chicago', city: 'Arlington' },
    'Denver Broncos': { lat: 39.744, lon: -105.020, altitude: 5280, timezone: 'America/Denver', city: 'Denver' },
    'Detroit Lions': { lat: 42.340, lon: -83.046, altitude: 600, timezone: 'America/Detroit', city: 'Detroit' },
    'Green Bay Packers': { lat: 44.501, lon: -88.062, altitude: 640, timezone: 'America/Chicago', city: 'Green Bay' },
    'Houston Texans': { lat: 29.685, lon: -95.411, altitude: 50, timezone: 'America/Chicago', city: 'Houston' },
    'Indianapolis Colts': { lat: 39.760, lon: -86.164, altitude: 715, timezone: 'America/Indiana/Indianapolis', city: 'Indianapolis' },
    'Jacksonville Jaguars': { lat: 30.324, lon: -81.637, altitude: 16, timezone: 'America/New_York', city: 'Jacksonville' },
    'Kansas City Chiefs': { lat: 39.049, lon: -94.484, altitude: 750, timezone: 'America/Chicago', city: 'Kansas City' },
    'Las Vegas Raiders': { lat: 36.091, lon: -115.184, altitude: 2030, timezone: 'America/Los_Angeles', city: 'Las Vegas' },
    'Los Angeles Chargers': { lat: 33.953, lon: -118.339, altitude: 340, timezone: 'America/Los_Angeles', city: 'Inglewood' },
    'Los Angeles Rams': { lat: 33.953, lon: -118.339, altitude: 340, timezone: 'America/Los_Angeles', city: 'Inglewood' },
    'Miami Dolphins': { lat: 25.958, lon: -80.239, altitude: 10, timezone: 'America/New_York', city: 'Miami Gardens' },
    'Minnesota Vikings': { lat: 44.974, lon: -93.258, altitude: 830, timezone: 'America/Chicago', city: 'Minneapolis' },
    'New England Patriots': { lat: 42.091, lon: -71.264, altitude: 236, timezone: 'America/New_York', city: 'Foxborough' },
    'New Orleans Saints': { lat: 29.951, lon: -90.081, altitude: 3, timezone: 'America/Chicago', city: 'New Orleans' },
    'New York Giants': { lat: 40.813, lon: -74.074, altitude: 10, timezone: 'America/New_York', city: 'East Rutherford' },
    'New York Jets': { lat: 40.813, lon: -74.074, altitude: 10, timezone: 'America/New_York', city: 'East Rutherford' },
    'Philadelphia Eagles': { lat: 39.901, lon: -75.168, altitude: 39, timezone: 'America/New_York', city: 'Philadelphia' },
    'Pittsburgh Steelers': { lat: 40.447, lon: -80.016, altitude: 730, timezone: 'America/New_York', city: 'Pittsburgh' },
    'San Francisco 49ers': { lat: 37.403, lon: -121.970, altitude: 10, timezone: 'America/Los_Angeles', city: 'Santa Clara' },
    'Seattle Seahawks': { lat: 47.595, lon: -122.332, altitude: 15, timezone: 'America/Los_Angeles', city: 'Seattle' },
    'Tampa Bay Buccaneers': { lat: 27.976, lon: -82.503, altitude: 40, timezone: 'America/New_York', city: 'Tampa' },
    'Tennessee Titans': { lat: 36.166, lon: -86.771, altitude: 550, timezone: 'America/Chicago', city: 'Nashville' },
    'Washington Commanders': { lat: 38.908, lon: -76.865, altitude: 50, timezone: 'America/New_York', city: 'Landover' },
  },
  icehockey_nhl: {
    'Anaheim Ducks': { lat: 33.808, lon: -117.877, altitude: 95, timezone: 'America/Los_Angeles', city: 'Anaheim' },
    'Arizona Coyotes': { lat: 33.532, lon: -112.261, altitude: 1086, timezone: 'America/Phoenix', city: 'Tempe' },
    'Boston Bruins': { lat: 42.366, lon: -71.062, altitude: 20, timezone: 'America/New_York', city: 'Boston' },
    'Buffalo Sabres': { lat: 42.875, lon: -78.876, altitude: 600, timezone: 'America/New_York', city: 'Buffalo' },
    'Calgary Flames': { lat: 51.037, lon: -114.052, altitude: 3557, timezone: 'America/Denver', city: 'Calgary' },
    'Carolina Hurricanes': { lat: 35.803, lon: -78.722, altitude: 315, timezone: 'America/New_York', city: 'Raleigh' },
    'Chicago Blackhawks': { lat: 41.881, lon: -87.674, altitude: 594, timezone: 'America/Chicago', city: 'Chicago' },
    'Colorado Avalanche': { lat: 39.749, lon: -105.008, altitude: 5280, timezone: 'America/Denver', city: 'Denver' },
    'Columbus Blue Jackets': { lat: 39.969, lon: -83.006, altitude: 761, timezone: 'America/New_York', city: 'Columbus' },
    'Dallas Stars': { lat: 32.790, lon: -96.810, altitude: 430, timezone: 'America/Chicago', city: 'Dallas' },
    'Detroit Red Wings': { lat: 42.341, lon: -83.055, altitude: 600, timezone: 'America/Detroit', city: 'Detroit' },
    'Edmonton Oilers': { lat: 53.547, lon: -113.498, altitude: 2116, timezone: 'America/Denver', city: 'Edmonton' },
    'Florida Panthers': { lat: 26.158, lon: -80.326, altitude: 10, timezone: 'America/New_York', city: 'Sunrise' },
    'Los Angeles Kings': { lat: 34.043, lon: -118.267, altitude: 270, timezone: 'America/Los_Angeles', city: 'Los Angeles' },
    'Minnesota Wild': { lat: 44.945, lon: -93.102, altitude: 830, timezone: 'America/Chicago', city: 'St. Paul' },
    'Montreal Canadiens': { lat: 45.496, lon: -73.569, altitude: 118, timezone: 'America/New_York', city: 'Montreal' },
    'Nashville Predators': { lat: 36.159, lon: -86.779, altitude: 550, timezone: 'America/Chicago', city: 'Nashville' },
    'New Jersey Devils': { lat: 40.733, lon: -74.171, altitude: 10, timezone: 'America/New_York', city: 'Newark' },
    'New York Islanders': { lat: 40.823, lon: -73.631, altitude: 25, timezone: 'America/New_York', city: 'Elmont' },
    'New York Rangers': { lat: 40.751, lon: -73.994, altitude: 33, timezone: 'America/New_York', city: 'New York' },
    'Ottawa Senators': { lat: 45.297, lon: -75.928, altitude: 230, timezone: 'America/New_York', city: 'Ottawa' },
    'Philadelphia Flyers': { lat: 39.901, lon: -75.172, altitude: 39, timezone: 'America/New_York', city: 'Philadelphia' },
    'Pittsburgh Penguins': { lat: 40.439, lon: -79.989, altitude: 730, timezone: 'America/New_York', city: 'Pittsburgh' },
    'San Jose Sharks': { lat: 37.333, lon: -121.901, altitude: 82, timezone: 'America/Los_Angeles', city: 'San Jose' },
    'Seattle Kraken': { lat: 47.622, lon: -122.354, altitude: 15, timezone: 'America/Los_Angeles', city: 'Seattle' },
    'St. Louis Blues': { lat: 38.627, lon: -90.203, altitude: 466, timezone: 'America/Chicago', city: 'St. Louis' },
    'Tampa Bay Lightning': { lat: 27.943, lon: -82.452, altitude: 40, timezone: 'America/New_York', city: 'Tampa' },
    'Toronto Maple Leafs': { lat: 43.643, lon: -79.379, altitude: 249, timezone: 'America/Toronto', city: 'Toronto' },
    'Vancouver Canucks': { lat: 49.278, lon: -123.109, altitude: 10, timezone: 'America/Los_Angeles', city: 'Vancouver' },
    'Vegas Golden Knights': { lat: 36.103, lon: -115.178, altitude: 2030, timezone: 'America/Los_Angeles', city: 'Las Vegas' },
    'Washington Capitals': { lat: 38.898, lon: -77.021, altitude: 25, timezone: 'America/New_York', city: 'Washington' },
    'Winnipeg Jets': { lat: 49.893, lon: -97.144, altitude: 760, timezone: 'America/Chicago', city: 'Winnipeg' },
  },
  baseball_mlb: {
    'Arizona Diamondbacks': { lat: 33.446, lon: -112.067, altitude: 1086, timezone: 'America/Phoenix', city: 'Phoenix' },
    'Atlanta Braves': { lat: 33.891, lon: -84.468, altitude: 1050, timezone: 'America/New_York', city: 'Atlanta' },
    'Baltimore Orioles': { lat: 39.284, lon: -76.622, altitude: 54, timezone: 'America/New_York', city: 'Baltimore' },
    'Boston Red Sox': { lat: 42.346, lon: -71.097, altitude: 20, timezone: 'America/New_York', city: 'Boston' },
    'Chicago Cubs': { lat: 41.948, lon: -87.656, altitude: 594, timezone: 'America/Chicago', city: 'Chicago' },
    'Chicago White Sox': { lat: 41.830, lon: -87.634, altitude: 594, timezone: 'America/Chicago', city: 'Chicago' },
    'Cincinnati Reds': { lat: 39.097, lon: -84.508, altitude: 484, timezone: 'America/New_York', city: 'Cincinnati' },
    'Cleveland Guardians': { lat: 41.496, lon: -81.685, altitude: 653, timezone: 'America/New_York', city: 'Cleveland' },
    'Colorado Rockies': { lat: 39.756, lon: -104.994, altitude: 5280, timezone: 'America/Denver', city: 'Denver' },
    'Detroit Tigers': { lat: 42.339, lon: -83.049, altitude: 600, timezone: 'America/Detroit', city: 'Detroit' },
    'Houston Astros': { lat: 29.757, lon: -95.355, altitude: 50, timezone: 'America/Chicago', city: 'Houston' },
    'Kansas City Royals': { lat: 39.051, lon: -94.481, altitude: 750, timezone: 'America/Chicago', city: 'Kansas City' },
    'Los Angeles Angels': { lat: 33.800, lon: -117.883, altitude: 95, timezone: 'America/Los_Angeles', city: 'Anaheim' },
    'Los Angeles Dodgers': { lat: 34.074, lon: -118.240, altitude: 340, timezone: 'America/Los_Angeles', city: 'Los Angeles' },
    'Miami Marlins': { lat: 25.778, lon: -80.220, altitude: 10, timezone: 'America/New_York', city: 'Miami' },
    'Milwaukee Brewers': { lat: 43.028, lon: -87.971, altitude: 617, timezone: 'America/Chicago', city: 'Milwaukee' },
    'Minnesota Twins': { lat: 44.982, lon: -93.278, altitude: 830, timezone: 'America/Chicago', city: 'Minneapolis' },
    'New York Mets': { lat: 40.757, lon: -73.846, altitude: 33, timezone: 'America/New_York', city: 'Queens' },
    'New York Yankees': { lat: 40.829, lon: -73.926, altitude: 33, timezone: 'America/New_York', city: 'Bronx' },
    'Oakland Athletics': { lat: 37.752, lon: -122.201, altitude: 10, timezone: 'America/Los_Angeles', city: 'Oakland' },
    'Philadelphia Phillies': { lat: 39.906, lon: -75.166, altitude: 39, timezone: 'America/New_York', city: 'Philadelphia' },
    'Pittsburgh Pirates': { lat: 40.447, lon: -80.006, altitude: 730, timezone: 'America/New_York', city: 'Pittsburgh' },
    'San Diego Padres': { lat: 32.707, lon: -117.157, altitude: 16, timezone: 'America/Los_Angeles', city: 'San Diego' },
    'San Francisco Giants': { lat: 37.778, lon: -122.389, altitude: 10, timezone: 'America/Los_Angeles', city: 'San Francisco' },
    'Seattle Mariners': { lat: 47.591, lon: -122.332, altitude: 15, timezone: 'America/Los_Angeles', city: 'Seattle' },
    'St. Louis Cardinals': { lat: 38.623, lon: -90.193, altitude: 466, timezone: 'America/Chicago', city: 'St. Louis' },
    'Tampa Bay Rays': { lat: 27.768, lon: -82.653, altitude: 40, timezone: 'America/New_York', city: 'St. Petersburg' },
    'Texas Rangers': { lat: 32.751, lon: -97.082, altitude: 604, timezone: 'America/Chicago', city: 'Arlington' },
    'Toronto Blue Jays': { lat: 43.641, lon: -79.389, altitude: 249, timezone: 'America/Toronto', city: 'Toronto' },
    'Washington Nationals': { lat: 38.873, lon: -77.008, altitude: 25, timezone: 'America/New_York', city: 'Washington' },
  },
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

function getTimezoneOffset(tz: string): number {
  const offsets: Record<string, number> = {
    'America/New_York': -5, 'America/Detroit': -5, 'America/Indiana/Indianapolis': -5,
    'America/Chicago': -6, 'America/Denver': -7, 'America/Phoenix': -7,
    'America/Los_Angeles': -8, 'America/Toronto': -5,
  };
  return offsets[tz] || -5;
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
  isShortWeek: boolean;
}

function calculateFatigueScore(factors: FatigueFactors, sport: string): number {
  let score = 0;
  
  // Sport-specific B2B impact
  const b2bWeight = sport === 'americanfootball_nfl' ? 0 : (sport === 'baseball_mlb' ? 15 : 25);
  if (factors.isBackToBack) score += b2bWeight;
  if (factors.isRoadBackToBack) score += 10;
  if (factors.isThreeInFour) score += 12;
  if (factors.isFourInSix) score += 8;
  if (factors.isShortWeek) score += 15; // NFL specific
  
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
  if (score >= 40) return 'Red Alert';
  if (score >= 30) return 'Exhausted';
  if (score >= 20) return 'Tired';
  if (score >= 10) return 'Normal';
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

    const { reset = false, sport = null } = await req.json().catch(() => ({}));

    console.log('Starting multi-sport historical fatigue seeding...');
    console.log(`Reset mode: ${reset}, Sport filter: ${sport || 'all'}`);

    // If reset, clear existing data
    if (reset) {
      console.log('Clearing existing sports fatigue data...');
      if (sport) {
        await supabase.from('sports_fatigue_scores').delete().eq('sport', sport);
        await supabase.from('fatigue_edge_tracking').delete().neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all
      } else {
        await supabase.from('sports_fatigue_scores').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        await supabase.from('fatigue_edge_tracking').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      }
      console.log('Cleared existing data');
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    let totalGamesProcessed = 0;
    let totalEdgesFound = 0;
    const fatigueRecords: any[] = [];
    const edgeRecords: any[] = [];

    // Process each sport
    const sportsToProcess = sport ? [sport] : Object.keys(SPORT_CONFIGS);

    for (const sportKey of sportsToProcess) {
      const config = SPORT_CONFIGS[sportKey];
      if (!config) continue;

      const teamLocations = TEAM_LOCATIONS[sportKey] || {};
      const seasonStart = new Date(config.seasonStart);
      
      // Don't process future sports
      if (seasonStart > yesterday) {
        console.log(`Skipping ${sportKey} - season hasn't started yet`);
        continue;
      }

      const allGames: Array<{
        date: string;
        homeTeam: string;
        awayTeam: string;
        homeScore: number;
        awayScore: number;
        eventId: string;
        gameTime: string;
      }> = [];

      // Fetch games day by day (limit to 30 days to avoid timeout)
      let currentDate = new Date(Math.max(seasonStart.getTime(), yesterday.getTime() - 30 * 24 * 60 * 60 * 1000));
      let daysProcessed = 0;
      const maxDays = 30;

      while (currentDate <= yesterday && daysProcessed < maxDays) {
        const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '');
        
        try {
          const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/${config.espnSport}/${config.espnLeague}/scoreboard?dates=${dateStr}`;
          const response = await fetch(espnUrl);
          
          if (response.ok) {
            const data = await response.json();
            
            if (data.events && data.events.length > 0) {
              for (const event of data.events) {
                const competition = event.competitions?.[0];
                if (!competition || competition.status?.type?.completed !== true) continue;

                const homeTeamData = competition.competitors?.find((c: any) => c.homeAway === 'home');
                const awayTeamData = competition.competitors?.find((c: any) => c.homeAway === 'away');

                if (!homeTeamData || !awayTeamData) continue;

                const homeTeam = homeTeamData.team?.displayName;
                const awayTeam = awayTeamData.team?.displayName;

                if (!teamLocations[homeTeam] || !teamLocations[awayTeam]) continue;

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
          console.error(`Error fetching ${sportKey} games for ${dateStr}:`, fetchError);
        }

        currentDate.setDate(currentDate.getDate() + 1);
        daysProcessed++;
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      console.log(`${sportKey}: Fetched ${allGames.length} completed games`);

      // Sort games by date
      allGames.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Track team schedules for fatigue calculation
      const teamSchedules: Record<string, Array<{ date: string; isHome: boolean; opponent: string }>> = {};

      for (const game of allGames) {
        const homeLocation = teamLocations[game.homeTeam];
        const awayLocation = teamLocations[game.awayTeam];
        
        if (!homeLocation || !awayLocation) continue;

        // Initialize team schedules
        if (!teamSchedules[game.homeTeam]) teamSchedules[game.homeTeam] = [];
        if (!teamSchedules[game.awayTeam]) teamSchedules[game.awayTeam] = [];

        const gameDate = new Date(game.date);
        const yesterdayDate = new Date(gameDate);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

        // Calculate fatigue for both teams
        const calcFatigue = (teamName: string, isHome: boolean): FatigueFactors & { score: number; category: string } => {
          const teamLocation = teamLocations[teamName];
          const gameLocation = homeLocation;
          const recentGames = teamSchedules[teamName].slice(-5);
          
          const isBackToBack = recentGames.some(g => g.date === yesterdayStr);
          const isRoadBackToBack = isBackToBack && recentGames.find(g => g.date === yesterdayStr)?.isHome === false;

          const fourDaysAgo = new Date(gameDate);
          fourDaysAgo.setDate(fourDaysAgo.getDate() - 3);
          const gamesInLast4Days = recentGames.filter(g => new Date(g.date) >= fourDaysAgo).length;
          const isThreeInFour = gamesInLast4Days >= 2;

          const sixDaysAgo = new Date(gameDate);
          sixDaysAgo.setDate(sixDaysAgo.getDate() - 5);
          const gamesInLast6Days = recentGames.filter(g => new Date(g.date) >= sixDaysAgo).length;
          const isFourInSix = gamesInLast6Days >= 3;

          // NFL short week check
          const isShortWeek = sportKey === 'americanfootball_nfl' && recentGames.length > 0 && 
            (gameDate.getTime() - new Date(recentGames[recentGames.length - 1]?.date || game.date).getTime()) < 6 * 24 * 60 * 60 * 1000;

          let travelMiles = 0;
          let timezoneChanges = 0;
          if (recentGames.length > 0 && teamLocation) {
            const lastGame = recentGames[recentGames.length - 1];
            const lastGameLocation = lastGame.isHome ? teamLocation : teamLocations[lastGame.opponent];
            if (lastGameLocation && gameLocation) {
              travelMiles = calculateDistance(
                lastGameLocation.lat, lastGameLocation.lon,
                gameLocation.lat, gameLocation.lon
              );
              timezoneChanges = Math.abs(
                getTimezoneOffset(lastGameLocation.timezone) - getTimezoneOffset(gameLocation.timezone)
              );
            }
          }

          const isAltitudeGame = !isHome && gameLocation.altitude > 4000;
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
            isShortWeek,
          };

          const score = calculateFatigueScore(factors, sportKey);
          const category = getFatigueCategory(score);

          return { ...factors, score, category };
        };

        const homeFatigue = calcFatigue(game.homeTeam, true);
        const awayFatigue = calcFatigue(game.awayTeam, false);

        // Update team schedules
        teamSchedules[game.homeTeam].push({ date: game.date, isHome: true, opponent: game.awayTeam });
        teamSchedules[game.awayTeam].push({ date: game.date, isHome: false, opponent: game.homeTeam });

        // Create fatigue records
        const createFatigueRecord = (teamName: string, opponent: string, fatigue: any) => ({
          event_id: game.eventId,
          sport: sportKey,
          team_name: teamName,
          opponent_name: opponent,
          game_date: game.date,
          commence_time: game.gameTime,
          fatigue_score: fatigue.score,
          fatigue_category: fatigue.category,
          is_back_to_back: fatigue.isBackToBack,
          is_three_in_four: fatigue.isThreeInFour,
          travel_miles: Math.round(fatigue.travelMiles),
          timezone_changes: fatigue.timezoneChanges,
          altitude_factor: fatigue.isAltitudeGame ? 5 : 0,
          rest_days: fatigue.isBackToBack ? 0 : 1,
          short_week: fatigue.isShortWeek || false,
          road_trip_games: 0,
        });

        fatigueRecords.push(createFatigueRecord(game.homeTeam, game.awayTeam, homeFatigue));
        fatigueRecords.push(createFatigueRecord(game.awayTeam, game.homeTeam, awayFatigue));

        // Check for fatigue edge
        const fatigueDiff = Math.abs(homeFatigue.score - awayFatigue.score);
        if (fatigueDiff >= 15) {
          const fresherTeam = homeFatigue.score < awayFatigue.score ? game.homeTeam : game.awayTeam;
          const fresherIsHome = fresherTeam === game.homeTeam;
          const fresherTeamWon = fresherIsHome 
            ? game.homeScore > game.awayScore 
            : game.awayScore > game.homeScore;

          edgeRecords.push({
            event_id: game.eventId,
            game_date: game.date,
            home_team: game.homeTeam,
            away_team: game.awayTeam,
            home_fatigue_score: homeFatigue.score,
            away_fatigue_score: awayFatigue.score,
            fatigue_differential: fatigueDiff,
            recommended_side: fresherTeam,
            recommended_angle: fresherIsHome ? 'Fade tired road team' : 'Back rested road team',
            recommended_side_won: fresherTeamWon,
            game_result: `${game.homeTeam} ${game.homeScore} - ${game.awayScore} ${game.awayTeam}`,
            actual_spread: game.homeScore - game.awayScore,
            actual_total: game.homeScore + game.awayScore,
            verified_at: new Date().toISOString(),
          });
          totalEdgesFound++;
        }

        totalGamesProcessed++;
      }
    }

    // Batch insert fatigue records
    if (fatigueRecords.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < fatigueRecords.length; i += batchSize) {
        const batch = fatigueRecords.slice(i, i + batchSize);
        const { error } = await supabase
          .from('sports_fatigue_scores')
          .upsert(batch, { onConflict: 'event_id,team_name' });
        if (error) console.error('Error inserting fatigue records:', error);
      }
    }

    // Batch insert edge records
    if (edgeRecords.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < edgeRecords.length; i += batchSize) {
        const batch = edgeRecords.slice(i, i + batchSize);
        const { error } = await supabase
          .from('fatigue_edge_tracking')
          .upsert(batch, { onConflict: 'event_id' });
        if (error) console.error('Error inserting edge records:', error);
      }
    }

    console.log(`Completed: ${totalGamesProcessed} games processed, ${totalEdgesFound} edges found`);

    return new Response(
      JSON.stringify({
        success: true,
        gamesProcessed: totalGamesProcessed,
        edgesFound: totalEdgesFound,
        fatigueRecords: fatigueRecords.length,
        reset,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error seeding historical fatigue data:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
