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

interface PlayerPropTarget {
  player: string;
  prop: string;
  direction: 'under' | 'over';
  reason: string;
}

interface PropTargets {
  fade_team: string;
  lean_team: string;
  player_props: PlayerPropTarget[];
  confidence: 'strong' | 'good' | 'slight' | 'minimal';
  edge_factors: string[];
}

// Comprehensive star player database for all sports (Updated Dec 2025)
const STAR_PLAYERS: Record<string, Record<string, string[]>> = {
  basketball_nba: {
    'Atlanta Hawks': ['Trae Young', 'Jalen Johnson', 'De\'Andre Hunter'],
    'Boston Celtics': ['Jayson Tatum', 'Jaylen Brown', 'Derrick White'],
    'Brooklyn Nets': ['Cam Thomas', 'Ben Simmons', 'Cam Johnson'],
    'Charlotte Hornets': ['LaMelo Ball', 'Brandon Miller', 'Miles Bridges'],
    'Chicago Bulls': ['Zach LaVine', 'Coby White', 'Nikola Vucevic'],
    'Cleveland Cavaliers': ['Donovan Mitchell', 'Darius Garland', 'Evan Mobley'],
    'Dallas Mavericks': ['Luka Doncic', 'Kyrie Irving', 'P.J. Washington'],
    'Denver Nuggets': ['Nikola Jokic', 'Jamal Murray', 'Michael Porter Jr.'],
    'Detroit Pistons': ['Cade Cunningham', 'Jaden Ivey', 'Jalen Duren'],
    'Golden State Warriors': ['Stephen Curry', 'Andrew Wiggins', 'Draymond Green'],
    'Houston Rockets': ['Amen Thompson', 'Alperen Sengun', 'Fred VanVleet'],
    'Indiana Pacers': ['Tyrese Haliburton', 'Pascal Siakam', 'Myles Turner'],
    'LA Clippers': ['Kawhi Leonard', 'James Harden', 'Norman Powell'],
    'Los Angeles Lakers': ['LeBron James', 'Anthony Davis', 'Austin Reaves'],
    'Memphis Grizzlies': ['Ja Morant', 'Desmond Bane', 'Jaren Jackson Jr.'],
    'Miami Heat': ['Jimmy Butler', 'Bam Adebayo', 'Tyler Herro'],
    'Milwaukee Bucks': ['Giannis Antetokounmpo', 'Damian Lillard', 'Khris Middleton'],
    'Minnesota Timberwolves': ['Anthony Edwards', 'Julius Randle', 'Rudy Gobert'],
    'New Orleans Pelicans': ['Zion Williamson', 'Brandon Ingram', 'CJ McCollum'],
    'New York Knicks': ['Jalen Brunson', 'Karl-Anthony Towns', 'Mikal Bridges'],
    'Oklahoma City Thunder': ['Shai Gilgeous-Alexander', 'Chet Holmgren', 'Jalen Williams'],
    'Orlando Magic': ['Paolo Banchero', 'Franz Wagner', 'Wendell Carter Jr.'],
    'Philadelphia 76ers': ['Joel Embiid', 'Tyrese Maxey', 'Paul George'],
    'Phoenix Suns': ['Kevin Durant', 'Devin Booker', 'Jalen Green'],
    'Portland Trail Blazers': ['Anfernee Simons', 'Scoot Henderson', 'Jerami Grant'],
    'Sacramento Kings': ["De'Aaron Fox", 'Domantas Sabonis', 'Keegan Murray'],
    'San Antonio Spurs': ['Victor Wembanyama', 'Devin Vassell', 'Keldon Johnson'],
    'Toronto Raptors': ['Scottie Barnes', 'RJ Barrett', 'Immanuel Quickley'],
    'Utah Jazz': ['Lauri Markkanen', 'Jordan Clarkson', 'Collin Sexton'],
    'Washington Wizards': ['Kyle Kuzma', 'Jordan Poole', 'Bilal Coulibaly'],
  },
  americanfootball_nfl: {
    'Arizona Cardinals': ['Kyler Murray', 'James Conner', 'Marvin Harrison Jr.'],
    'Atlanta Falcons': ['Bijan Robinson', 'Drake London', 'Kyle Pitts'],
    'Baltimore Ravens': ['Lamar Jackson', 'Derrick Henry', 'Zay Flowers'],
    'Buffalo Bills': ['Josh Allen', 'James Cook', 'Khalil Shakir'],
    'Carolina Panthers': ['Bryce Young', 'Chuba Hubbard', 'Adam Thielen'],
    'Chicago Bears': ['Caleb Williams', 'DJ Moore', 'Cole Kmet'],
    'Cincinnati Bengals': ["Ja'Marr Chase", 'Joe Burrow', 'Tee Higgins'],
    'Cleveland Browns': ['Deshaun Watson', 'Nick Chubb', 'Amari Cooper'],
    'Dallas Cowboys': ['CeeDee Lamb', 'Dak Prescott', 'Rico Dowdle'],
    'Denver Broncos': ['Bo Nix', 'Javonte Williams', 'Courtland Sutton'],
    'Detroit Lions': ["Amon-Ra St. Brown", 'Jahmyr Gibbs', 'Jared Goff'],
    'Green Bay Packers': ['Jordan Love', 'Josh Jacobs', 'Jayden Reed'],
    'Houston Texans': ['CJ Stroud', 'Stefon Diggs', 'Nico Collins'],
    'Indianapolis Colts': ['Anthony Richardson', 'Jonathan Taylor', 'Michael Pittman Jr.'],
    'Jacksonville Jaguars': ['Travis Etienne', 'Trevor Lawrence', 'Brian Thomas Jr.'],
    'Kansas City Chiefs': ['Patrick Mahomes', 'Travis Kelce', 'Isiah Pacheco'],
    'Las Vegas Raiders': ['Davante Adams', 'Jakobi Meyers', 'Brock Bowers'],
    'Los Angeles Chargers': ['Justin Herbert', 'J.K. Dobbins', 'Ladd McConkey'],
    'Los Angeles Rams': ['Cooper Kupp', 'Puka Nacua', 'Kyren Williams'],
    'Miami Dolphins': ['Tyreek Hill', 'Tua Tagovailoa', 'Jaylen Waddle'],
    'Minnesota Vikings': ['Justin Jefferson', 'Jordan Addison', 'Aaron Jones'],
    'New England Patriots': ['Drake Maye', 'Rhamondre Stevenson', 'Hunter Henry'],
    'New Orleans Saints': ['Alvin Kamara', 'Chris Olave', 'Derek Carr'],
    'New York Giants': ['Malik Nabers', 'Devin Singletary', 'Wan\'Dale Robinson'],
    'New York Jets': ['Breece Hall', 'Garrett Wilson', 'Davante Adams'],
    'Philadelphia Eagles': ["A.J. Brown", 'Jalen Hurts', 'DeVonta Smith'],
    'Pittsburgh Steelers': ['Najee Harris', 'George Pickens', 'Pat Freiermuth'],
    'San Francisco 49ers': ['Christian McCaffrey', 'Brandon Aiyuk', 'Deebo Samuel'],
    'Seattle Seahawks': ['DK Metcalf', 'Geno Smith', 'Jaxon Smith-Njigba'],
    'Tampa Bay Buccaneers': ['Mike Evans', 'Chris Godwin', 'Rachaad White'],
    'Tennessee Titans': ['Tony Pollard', 'DeAndre Hopkins', 'Calvin Ridley'],
    'Washington Commanders': ['Jayden Daniels', 'Terry McLaurin', 'Brian Robinson Jr.'],
  },
  baseball_mlb: {
    'Arizona Diamondbacks': ['Corbin Carroll', 'Ketel Marte', 'Zac Gallen'],
    'Atlanta Braves': ['Ronald Acuña Jr.', 'Matt Olson', 'Austin Riley'],
    'Baltimore Orioles': ['Gunnar Henderson', 'Adley Rutschman', 'Cedric Mullins'],
    'Boston Red Sox': ['Rafael Devers', 'Masataka Yoshida', 'Trevor Story'],
    'Chicago Cubs': ['Dansby Swanson', 'Ian Happ', 'Seiya Suzuki'],
    'Chicago White Sox': ['Luis Robert Jr.', 'Andrew Benintendi', 'Garrett Crochet'],
    'Cincinnati Reds': ['Elly De La Cruz', 'Matt McLain', 'Spencer Steer'],
    'Cleveland Guardians': ['José Ramírez', 'Josh Naylor', 'Steven Kwan'],
    'Colorado Rockies': ['Ezequiel Tovar', 'Brenton Doyle', 'Ryan McMahon'],
    'Detroit Tigers': ['Spencer Torkelson', 'Riley Greene', 'Kerry Carpenter'],
    'Houston Astros': ['Jose Altuve', 'Yordan Alvarez', 'Kyle Tucker'],
    'Kansas City Royals': ['Bobby Witt Jr.', 'Salvador Perez', 'Vinnie Pasquantino'],
    'Los Angeles Angels': ['Mike Trout', 'Taylor Ward', 'Zach Neto'],
    'Los Angeles Dodgers': ['Mookie Betts', 'Freddie Freeman', 'Shohei Ohtani'],
    'Miami Marlins': ['Jazz Chisholm Jr.', 'Luis Arraez', 'Jorge Soler'],
    'Milwaukee Brewers': ['Christian Yelich', 'William Contreras', 'Willy Adames'],
    'Minnesota Twins': ['Byron Buxton', 'Carlos Correa', 'Royce Lewis'],
    'New York Mets': ['Pete Alonso', 'Francisco Lindor', 'Brandon Nimmo'],
    'New York Yankees': ['Aaron Judge', 'Juan Soto', 'Giancarlo Stanton'],
    'Oakland Athletics': ['Brent Rooker', 'JJ Bleday', 'Shea Langeliers'],
    'Philadelphia Phillies': ['Bryce Harper', 'Trea Turner', 'Kyle Schwarber'],
    'Pittsburgh Pirates': ['Bryan Reynolds', 'Ke\'Bryan Hayes', 'Oneil Cruz'],
    'San Diego Padres': ['Fernando Tatis Jr.', 'Manny Machado', 'Xander Bogaerts'],
    'San Francisco Giants': ['Matt Chapman', 'Michael Conforto', 'LaMonte Wade Jr.'],
    'Seattle Mariners': ['Julio Rodríguez', 'Cal Raleigh', 'JP Crawford'],
    'St. Louis Cardinals': ['Paul Goldschmidt', 'Nolan Arenado', 'Willson Contreras'],
    'Tampa Bay Rays': ['Wander Franco', 'Randy Arozarena', 'Yandy Díaz'],
    'Texas Rangers': ['Corey Seager', 'Marcus Semien', 'Adolis García'],
    'Toronto Blue Jays': ['Vladimir Guerrero Jr.', 'Bo Bichette', 'George Springer'],
    'Washington Nationals': ['CJ Abrams', 'Lane Thomas', 'Joey Meneses'],
  },
  icehockey_nhl: {
    'Anaheim Ducks': ['Trevor Zegras', 'Troy Terry', 'Mason McTavish'],
    'Arizona Coyotes': ['Clayton Keller', 'Nick Schmaltz', 'Dylan Guenther'],
    'Boston Bruins': ['David Pastrnak', 'Brad Marchand', 'Charlie McAvoy'],
    'Buffalo Sabres': ['Tage Thompson', 'Rasmus Dahlin', 'Alex Tuch'],
    'Calgary Flames': ['Nazem Kadri', 'Jonathan Huberdeau', 'Mikael Backlund'],
    'Carolina Hurricanes': ['Sebastian Aho', 'Andrei Svechnikov', 'Martin Necas'],
    'Chicago Blackhawks': ['Connor Bedard', 'Tyler Bertuzzi', 'Nick Foligno'],
    'Colorado Avalanche': ['Nathan MacKinnon', 'Cale Makar', 'Mikko Rantanen'],
    'Columbus Blue Jackets': ['Zach Werenski', 'Kirill Marchenko', 'Adam Fantilli'],
    'Dallas Stars': ['Jason Robertson', 'Roope Hintz', 'Joe Pavelski'],
    'Detroit Red Wings': ['Dylan Larkin', 'Lucas Raymond', 'Moritz Seider'],
    'Edmonton Oilers': ['Connor McDavid', 'Leon Draisaitl', 'Zach Hyman'],
    'Florida Panthers': ['Aleksander Barkov', 'Matthew Tkachuk', 'Carter Verhaeghe'],
    'Los Angeles Kings': ['Anze Kopitar', 'Adrian Kempe', 'Quinton Byfield'],
    'Minnesota Wild': ['Kirill Kaprizov', 'Matt Boldy', 'Joel Eriksson Ek'],
    'Montreal Canadiens': ['Nick Suzuki', 'Cole Caufield', 'Juraj Slafkovsky'],
    'Nashville Predators': ['Filip Forsberg', 'Roman Josi', 'Gustav Nyquist'],
    'New Jersey Devils': ['Jack Hughes', 'Nico Hischier', 'Jesper Bratt'],
    'New York Islanders': ['Mathew Barzal', 'Brock Nelson', 'Bo Horvat'],
    'New York Rangers': ['Artemi Panarin', 'Mika Zibanejad', 'Adam Fox'],
    'Ottawa Senators': ['Brady Tkachuk', 'Tim Stützle', 'Claude Giroux'],
    'Philadelphia Flyers': ['Travis Konecny', 'Owen Tippett', 'Sean Couturier'],
    'Pittsburgh Penguins': ['Sidney Crosby', 'Evgeni Malkin', 'Bryan Rust'],
    'San Jose Sharks': ['Macklin Celebrini', 'Will Smith', 'Mikael Granlund'],
    'Seattle Kraken': ['Matty Beniers', 'Jared McCann', 'Jordan Eberle'],
    'St. Louis Blues': ['Robert Thomas', 'Jordan Kyrou', 'Pavel Buchnevich'],
    'Tampa Bay Lightning': ['Nikita Kucherov', 'Brayden Point', 'Jake Guentzel'],
    'Toronto Maple Leafs': ['Auston Matthews', 'Mitch Marner', 'William Nylander'],
    'Utah Hockey Club': ['Clayton Keller', 'Nick Schmaltz', 'Dylan Guenther'],
    'Vancouver Canucks': ['Elias Pettersson', 'JT Miller', 'Brock Boeser'],
    'Vegas Golden Knights': ['Jack Eichel', 'Mark Stone', 'Chandler Stephenson'],
    'Washington Capitals': ['Alex Ovechkin', 'Dylan Strome', 'Tom Wilson'],
    'Winnipeg Jets': ['Kyle Connor', 'Mark Scheifele', 'Nikolaj Ehlers'],
  },
};

// Sport-specific prop types
const SPORT_PROP_TYPES: Record<string, string[]> = {
  basketball_nba: ['points', 'rebounds', 'assists', '3-pointers'],
  americanfootball_nfl: ['passing yards', 'rushing yards', 'receiving yards', 'TDs'],
  baseball_mlb: ['hits', 'RBIs', 'total bases', 'runs'],
  icehockey_nhl: ['goals', 'assists', 'shots on goal', 'points'],
};

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
    shortWeek: 20,
    crossCountry: 15,
    travel2000: 12,
    travel1000: 8,
    timezone2: 12,
    timezone1: 6,
    altitude: 10,
    mondayToSunday: 5,
  },
  baseball_mlb: {
    backToBack: 8,
    roadTripLong: 15,
    roadTripMedium: 10,
    travel1500: 10,
    travel1000: 6,
    timezone2: 8,
    dayNight: 12,
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

// Enhanced recommendation generator with specific player prop targets
function generatePropTargets(
  homeTeam: string,
  awayTeam: string,
  homeFatigue: number,
  awayFatigue: number,
  sport: string,
  travelMiles: number,
  isAltitudeGame: boolean,
  isBackToBack: boolean
): PropTargets {
  const diff = Math.abs(homeFatigue - awayFatigue);
  const fatigueTeam = homeFatigue > awayFatigue ? homeTeam : awayTeam;
  const freshTeam = homeFatigue > awayFatigue ? awayTeam : homeTeam;
  const fatigueScore = Math.max(homeFatigue, awayFatigue);
  
  // Determine confidence level
  let confidence: PropTargets['confidence'] = 'minimal';
  if (diff >= 30) confidence = 'strong';
  else if (diff >= 20) confidence = 'good';
  else if (diff >= 15) confidence = 'slight';
  
  // Build edge factors list
  const edgeFactors: string[] = [];
  if (travelMiles > 1000) edgeFactors.push(`${Math.round(travelMiles)}mi travel`);
  if (isAltitudeGame) edgeFactors.push('altitude disadvantage');
  if (isBackToBack) edgeFactors.push('B2B');
  if (edgeFactors.length === 0) edgeFactors.push(`+${diff} fatigue differential`);
  
  // Get star players for the fatigued team
  const sportPlayers = STAR_PLAYERS[sport] || {};
  const fatigueTeamPlayers = sportPlayers[fatigueTeam] || [];
  const propTypes = SPORT_PROP_TYPES[sport] || ['points'];
  
  // Generate player prop targets based on fatigue severity
  const playerProps: PlayerPropTarget[] = [];
  
  // More props suggested for higher fatigue differentials
  const numPlayers = diff >= 30 ? 3 : diff >= 20 ? 2 : 1;
  const numPropsPerPlayer = diff >= 25 ? 2 : 1;
  
  for (let i = 0; i < Math.min(numPlayers, fatigueTeamPlayers.length); i++) {
    const player = fatigueTeamPlayers[i];
    for (let j = 0; j < Math.min(numPropsPerPlayer, propTypes.length); j++) {
      const prop = propTypes[j];
      
      // Build reason string
      let reason = '';
      if (isBackToBack) reason = 'B2B fatigue';
      else if (travelMiles > 1000) reason = 'travel fatigue';
      else if (isAltitudeGame) reason = 'altitude';
      else reason = 'cumulative fatigue';
      
      playerProps.push({
        player,
        prop,
        direction: 'under',
        reason,
      });
    }
  }
  
  return {
    fade_team: fatigueTeam,
    lean_team: freshTeam,
    player_props: playerProps,
    confidence,
    edge_factors: edgeFactors,
  };
}

// Generate readable recommendation angle text
function getRecommendedAngle(
  homeTeam: string,
  awayTeam: string,
  homeFatigue: number,
  awayFatigue: number,
  sport: string,
  propTargets: PropTargets
): string {
  const diff = Math.abs(homeFatigue - awayFatigue);
  
  // Build player prop suggestions text
  const propSuggestions = propTargets.player_props
    .slice(0, 3)
    .map(p => `${p.player} ${p.direction.toUpperCase()} ${p.prop}`)
    .join(', ');
  
  const edgeText = propTargets.edge_factors.join(' + ');
  
  // Confidence emoji based on level
  const confEmoji = propTargets.confidence === 'strong' ? '🔥' : 
                    propTargets.confidence === 'good' ? '✅' : 
                    propTargets.confidence === 'slight' ? '👀' : '📊';
  
  // Sport-specific formatting
  const sportLabels: Record<string, string> = {
    basketball_nba: 'NBA',
    americanfootball_nfl: 'NFL',
    baseball_mlb: 'MLB',
    icehockey_nhl: 'NHL',
  };
  
  let angle = `${confEmoji} LEAN: ${propTargets.lean_team}`;
  
  if (propTargets.player_props.length > 0) {
    angle += ` | FADE ${propTargets.fade_team}: ${propSuggestions}`;
  }
  
  angle += ` | Edge: ${edgeText}`;
  
  // Add confidence indicator
  const confText = propTargets.confidence === 'strong' ? 'High Confidence' :
                   propTargets.confidence === 'good' ? 'Good Edge' :
                   propTargets.confidence === 'slight' ? 'Slight Edge' : 'Minor Edge';
  
  angle += ` | ${confText} (+${diff})`;
  
  return angle;
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
        sport: 'basketball_nba',
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
        
        // Generate player prop targets (the new enhanced recommendations)
        const propTargets = generatePropTargets(
          game.homeTeam,
          game.awayTeam,
          homeFatigueScore,
          awayFatigueScore,
          sport,
          travelMiles,
          isAltitudeGame,
          awayFactors.isBackToBack
        );
        
        // Generate the readable angle text
        const angle = getRecommendedAngle(
          game.homeTeam,
          game.awayTeam,
          homeFatigueScore,
          awayFatigueScore,
          sport,
          propTargets
        );

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
          prop_targets: propTargets,
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
          prop_targets: propTargets,
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
          // Track edges with 10+ differential
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
            propTargets,
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
