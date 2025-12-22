// Comprehensive team abbreviation mappings for all major sports

const NBA_TEAMS: Record<string, string> = {
  'Atlanta Hawks': 'ATL',
  'Boston Celtics': 'BOS',
  'Brooklyn Nets': 'BKN',
  'Charlotte Hornets': 'CHA',
  'Chicago Bulls': 'CHI',
  'Cleveland Cavaliers': 'CLE',
  'Dallas Mavericks': 'DAL',
  'Denver Nuggets': 'DEN',
  'Detroit Pistons': 'DET',
  'Golden State Warriors': 'GSW',
  'Houston Rockets': 'HOU',
  'Indiana Pacers': 'IND',
  'Los Angeles Clippers': 'LAC',
  'LA Clippers': 'LAC',
  'Los Angeles Lakers': 'LAL',
  'LA Lakers': 'LAL',
  'Memphis Grizzlies': 'MEM',
  'Miami Heat': 'MIA',
  'Milwaukee Bucks': 'MIL',
  'Minnesota Timberwolves': 'MIN',
  'New Orleans Pelicans': 'NOP',
  'New York Knicks': 'NYK',
  'Oklahoma City Thunder': 'OKC',
  'Orlando Magic': 'ORL',
  'Philadelphia 76ers': 'PHI',
  'Phoenix Suns': 'PHX',
  'Portland Trail Blazers': 'POR',
  'Sacramento Kings': 'SAC',
  'San Antonio Spurs': 'SAS',
  'Toronto Raptors': 'TOR',
  'Utah Jazz': 'UTA',
  'Washington Wizards': 'WAS',
  // Common variations
  'Hawks': 'ATL',
  'Celtics': 'BOS',
  'Nets': 'BKN',
  'Hornets': 'CHA',
  'Bulls': 'CHI',
  'Cavaliers': 'CLE',
  'Cavs': 'CLE',
  'Mavericks': 'DAL',
  'Mavs': 'DAL',
  'Nuggets': 'DEN',
  'Pistons': 'DET',
  'Warriors': 'GSW',
  'Rockets': 'HOU',
  'Pacers': 'IND',
  'Clippers': 'LAC',
  'Lakers': 'LAL',
  'Grizzlies': 'MEM',
  'Heat': 'MIA',
  'Bucks': 'MIL',
  'Timberwolves': 'MIN',
  'Wolves': 'MIN',
  'Pelicans': 'NOP',
  'Knicks': 'NYK',
  'Thunder': 'OKC',
  'Magic': 'ORL',
  '76ers': 'PHI',
  'Sixers': 'PHI',
  'Suns': 'PHX',
  'Trail Blazers': 'POR',
  'Blazers': 'POR',
  'Kings': 'SAC',
  'Spurs': 'SAS',
  'Raptors': 'TOR',
  'Jazz': 'UTA',
  'Wizards': 'WAS',
};

const NFL_TEAMS: Record<string, string> = {
  'Arizona Cardinals': 'ARI',
  'Atlanta Falcons': 'ATL',
  'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF',
  'Carolina Panthers': 'CAR',
  'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN',
  'Cleveland Browns': 'CLE',
  'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN',
  'Detroit Lions': 'DET',
  'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU',
  'Indianapolis Colts': 'IND',
  'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC',
  'Las Vegas Raiders': 'LV',
  'Los Angeles Chargers': 'LAC',
  'LA Chargers': 'LAC',
  'Los Angeles Rams': 'LAR',
  'LA Rams': 'LAR',
  'Miami Dolphins': 'MIA',
  'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE',
  'New Orleans Saints': 'NO',
  'New York Giants': 'NYG',
  'New York Jets': 'NYJ',
  'Philadelphia Eagles': 'PHI',
  'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF',
  'Seattle Seahawks': 'SEA',
  'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN',
  'Washington Commanders': 'WAS',
  // Common variations
  'Cardinals': 'ARI',
  'Falcons': 'ATL',
  'Ravens': 'BAL',
  'Bills': 'BUF',
  'Panthers': 'CAR',
  'Bears': 'CHI',
  'Bengals': 'CIN',
  'Browns': 'CLE',
  'Cowboys': 'DAL',
  'Broncos': 'DEN',
  'Lions': 'DET',
  'Packers': 'GB',
  'Texans': 'HOU',
  'Colts': 'IND',
  'Jaguars': 'JAX',
  'Chiefs': 'KC',
  'Raiders': 'LV',
  'Chargers': 'LAC',
  'Rams': 'LAR',
  'Dolphins': 'MIA',
  'Vikings': 'MIN',
  'Patriots': 'NE',
  'Pats': 'NE',
  'Saints': 'NO',
  'Giants': 'NYG',
  'Jets': 'NYJ',
  'Eagles': 'PHI',
  'Steelers': 'PIT',
  '49ers': 'SF',
  'Niners': 'SF',
  'Seahawks': 'SEA',
  'Buccaneers': 'TB',
  'Bucs': 'TB',
  'Titans': 'TEN',
  'Commanders': 'WAS',
};

const NHL_TEAMS: Record<string, string> = {
  'Anaheim Ducks': 'ANA',
  'Arizona Coyotes': 'ARI',
  'Boston Bruins': 'BOS',
  'Buffalo Sabres': 'BUF',
  'Calgary Flames': 'CGY',
  'Carolina Hurricanes': 'CAR',
  'Chicago Blackhawks': 'CHI',
  'Colorado Avalanche': 'COL',
  'Columbus Blue Jackets': 'CBJ',
  'Dallas Stars': 'DAL',
  'Detroit Red Wings': 'DET',
  'Edmonton Oilers': 'EDM',
  'Florida Panthers': 'FLA',
  'Los Angeles Kings': 'LAK',
  'LA Kings': 'LAK',
  'Minnesota Wild': 'MIN',
  'Montreal Canadiens': 'MTL',
  'Nashville Predators': 'NSH',
  'New Jersey Devils': 'NJD',
  'New York Islanders': 'NYI',
  'New York Rangers': 'NYR',
  'Ottawa Senators': 'OTT',
  'Philadelphia Flyers': 'PHI',
  'Pittsburgh Penguins': 'PIT',
  'San Jose Sharks': 'SJS',
  'Seattle Kraken': 'SEA',
  'St. Louis Blues': 'STL',
  'Tampa Bay Lightning': 'TBL',
  'Toronto Maple Leafs': 'TOR',
  'Utah Hockey Club': 'UTA',
  'Vancouver Canucks': 'VAN',
  'Vegas Golden Knights': 'VGK',
  'Washington Capitals': 'WSH',
  'Winnipeg Jets': 'WPG',
  // Common variations
  'Ducks': 'ANA',
  'Coyotes': 'ARI',
  'Bruins': 'BOS',
  'Sabres': 'BUF',
  'Flames': 'CGY',
  'Hurricanes': 'CAR',
  'Canes': 'CAR',
  'Blackhawks': 'CHI',
  'Avalanche': 'COL',
  'Avs': 'COL',
  'Blue Jackets': 'CBJ',
  'Stars': 'DAL',
  'Red Wings': 'DET',
  'Oilers': 'EDM',
  'Wild': 'MIN',
  'Canadiens': 'MTL',
  'Habs': 'MTL',
  'Predators': 'NSH',
  'Preds': 'NSH',
  'Devils': 'NJD',
  'Islanders': 'NYI',
  'Isles': 'NYI',
  'Rangers': 'NYR',
  'Senators': 'OTT',
  'Sens': 'OTT',
  'Flyers': 'PHI',
  'Penguins': 'PIT',
  'Pens': 'PIT',
  'Sharks': 'SJS',
  'Kraken': 'SEA',
  'Blues': 'STL',
  'Lightning': 'TBL',
  'Bolts': 'TBL',
  'Maple Leafs': 'TOR',
  'Leafs': 'TOR',
  'Canucks': 'VAN',
  'Golden Knights': 'VGK',
  'Knights': 'VGK',
  'Capitals': 'WSH',
  'Caps': 'WSH',
};

const MLB_TEAMS: Record<string, string> = {
  'Arizona Diamondbacks': 'ARI',
  'Atlanta Braves': 'ATL',
  'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS',
  'Chicago Cubs': 'CHC',
  'Chicago White Sox': 'CHW',
  'Cincinnati Reds': 'CIN',
  'Cleveland Guardians': 'CLE',
  'Colorado Rockies': 'COL',
  'Detroit Tigers': 'DET',
  'Houston Astros': 'HOU',
  'Kansas City Royals': 'KC',
  'Los Angeles Angels': 'LAA',
  'LA Angels': 'LAA',
  'Los Angeles Dodgers': 'LAD',
  'LA Dodgers': 'LAD',
  'Miami Marlins': 'MIA',
  'Milwaukee Brewers': 'MIL',
  'Minnesota Twins': 'MIN',
  'New York Mets': 'NYM',
  'New York Yankees': 'NYY',
  'Oakland Athletics': 'OAK',
  'Philadelphia Phillies': 'PHI',
  'Pittsburgh Pirates': 'PIT',
  'San Diego Padres': 'SD',
  'San Francisco Giants': 'SF',
  'Seattle Mariners': 'SEA',
  'St. Louis Cardinals': 'STL',
  'Tampa Bay Rays': 'TB',
  'Texas Rangers': 'TEX',
  'Toronto Blue Jays': 'TOR',
  'Washington Nationals': 'WSH',
  // Common variations
  'Diamondbacks': 'ARI',
  'D-backs': 'ARI',
  'Braves': 'ATL',
  'Orioles': 'BAL',
  'Os': 'BAL',
  'Red Sox': 'BOS',
  'Sox': 'BOS',
  'Cubs': 'CHC',
  'White Sox': 'CHW',
  'Reds': 'CIN',
  'Guardians': 'CLE',
  'Rockies': 'COL',
  'Tigers': 'DET',
  'Astros': 'HOU',
  'Royals': 'KC',
  'Angels': 'LAA',
  'Dodgers': 'LAD',
  'Marlins': 'MIA',
  'Brewers': 'MIL',
  'Twins': 'MIN',
  'Mets': 'NYM',
  'Yankees': 'NYY',
  'Yanks': 'NYY',
  'Athletics': 'OAK',
  'As': 'OAK',
  'Phillies': 'PHI',
  'Pirates': 'PIT',
  'Buccos': 'PIT',
  'Padres': 'SD',
  'Mariners': 'SEA',
  'Ms': 'SEA',
  'Blue Jays': 'TOR',
  'Jays': 'TOR',
  'Nationals': 'WSH',
  'Nats': 'WSH',
};

const NCAAB_TEAMS: Record<string, string> = {
  // Top programs with common names
  'Duke Blue Devils': 'DUKE',
  'Duke': 'DUKE',
  'North Carolina Tar Heels': 'UNC',
  'North Carolina': 'UNC',
  'UNC': 'UNC',
  'Kentucky Wildcats': 'UK',
  'Kentucky': 'UK',
  'Kansas Jayhawks': 'KU',
  'Kansas': 'KU',
  'UCLA Bruins': 'UCLA',
  'UCLA': 'UCLA',
  'Gonzaga Bulldogs': 'GONZ',
  'Gonzaga': 'GONZ',
  'Michigan State Spartans': 'MSU',
  'Michigan State': 'MSU',
  'Michigan Wolverines': 'MICH',
  'Michigan': 'MICH',
  'Syracuse Orange': 'CUSE',
  'Syracuse': 'CUSE',
  'Indiana Hoosiers': 'IU',
  'Indiana': 'IU',
  'Louisville Cardinals': 'LOU',
  'Louisville': 'LOU',
  'Villanova Wildcats': 'NOVA',
  'Villanova': 'NOVA',
  'Arizona Wildcats': 'ARIZ',
  'Arizona': 'ARIZ',
  'Connecticut Huskies': 'UCONN',
  'Connecticut': 'UCONN',
  'UConn': 'UCONN',
  'Purdue Boilermakers': 'PUR',
  'Purdue': 'PUR',
  'Ohio State Buckeyes': 'OSU',
  'Ohio State': 'OSU',
  'Texas Longhorns': 'TEX',
  'Texas': 'TEX',
  'Florida Gators': 'FLA',
  'Florida': 'FLA',
  'Auburn Tigers': 'AUB',
  'Auburn': 'AUB',
  'Tennessee Volunteers': 'TENN',
  'Tennessee': 'TENN',
  'Alabama Crimson Tide': 'BAMA',
  'Alabama': 'BAMA',
  'Baylor Bears': 'BAY',
  'Baylor': 'BAY',
  'Houston Cougars': 'HOU',
  'Iowa State Cyclones': 'ISU',
  'Iowa State': 'ISU',
  'Creighton Bluejays': 'CREI',
  'Creighton': 'CREI',
  'Marquette Golden Eagles': 'MARQ',
  'Marquette': 'MARQ',
};

// Combine all teams
const ALL_TEAMS: Record<string, string> = {
  ...NBA_TEAMS,
  ...NFL_TEAMS,
  ...NHL_TEAMS,
  ...MLB_TEAMS,
  ...NCAAB_TEAMS,
};

/**
 * Get the abbreviation for a team name
 * @param teamName Full team name (e.g., "Los Angeles Lakers")
 * @param sport Optional sport to narrow down search
 * @returns Abbreviated team name (e.g., "LAL")
 */
export function getTeamAbbreviation(teamName: string, sport?: string): string {
  if (!teamName) return '';
  
  const normalized = teamName.trim();
  
  // Check if already an abbreviation (2-4 uppercase letters)
  if (/^[A-Z]{2,4}$/.test(normalized)) {
    return normalized;
  }
  
  // Look up in combined map first
  if (ALL_TEAMS[normalized]) {
    return ALL_TEAMS[normalized];
  }
  
  // Try case-insensitive match
  const lowerName = normalized.toLowerCase();
  for (const [key, value] of Object.entries(ALL_TEAMS)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  
  // Try partial match (team name contains the key)
  for (const [key, value] of Object.entries(ALL_TEAMS)) {
    if (lowerName.includes(key.toLowerCase()) || key.toLowerCase().includes(lowerName)) {
      return value;
    }
  }
  
  // Fallback: return first 3 letters uppercase
  return normalized.substring(0, 3).toUpperCase();
}

/**
 * Format a matchup with team abbreviations
 * @param awayTeam Away team name
 * @param homeTeam Home team name
 * @param sport Optional sport
 * @returns Formatted matchup (e.g., "LAL @ BOS")
 */
export function formatMatchupAbbreviation(awayTeam: string, homeTeam: string, sport?: string): string {
  const away = getTeamAbbreviation(awayTeam, sport);
  const home = getTeamAbbreviation(homeTeam, sport);
  return `${away} @ ${home}`;
}

/**
 * Extract and abbreviate teams from a description string
 * Handles formats like "Team A @ Team B", "Team A vs Team B", "Team A at Team B"
 * @param description Pick description
 * @param sport Optional sport
 * @returns Object with abbreviated matchup or null
 */
export function extractMatchupFromDescription(description: string, sport?: string): {
  matchup: string;
  awayTeam: string;
  homeTeam: string;
} | null {
  if (!description) return null;
  
  // Match patterns: "Team @ Team", "Team vs Team", "Team at Team", "Team vs. Team"
  const patterns = [
    /(.+?)\s*@\s*(.+)/i,
    /(.+?)\s+vs\.?\s+(.+)/i,
    /(.+?)\s+at\s+(.+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (match) {
      const away = match[1].trim();
      const home = match[2].trim();
      
      // Clean up - remove common suffixes like "- Over 24.5"
      const cleanAway = away.split(' - ')[0].trim();
      const cleanHome = home.split(' - ')[0].trim();
      
      return {
        matchup: formatMatchupAbbreviation(cleanAway, cleanHome, sport),
        awayTeam: getTeamAbbreviation(cleanAway, sport),
        homeTeam: getTeamAbbreviation(cleanHome, sport),
      };
    }
  }
  
  return null;
}

/**
 * Abbreviate team names within a description
 * @param description Original description
 * @param sport Optional sport
 * @returns Description with abbreviated team names
 */
export function abbreviateTeamsInDescription(description: string, sport?: string): string {
  if (!description) return '';
  
  let result = description;
  
  // Sort by length descending to replace longer names first
  const sortedTeams = Object.entries(ALL_TEAMS).sort((a, b) => b[0].length - a[0].length);
  
  for (const [teamName, abbrev] of sortedTeams) {
    // Use word boundaries to avoid partial matches
    const regex = new RegExp(`\\b${teamName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    result = result.replace(regex, abbrev);
  }
  
  return result;
}
