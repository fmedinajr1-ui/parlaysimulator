import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { UniversalLeg } from '@/types/universal-parlay';

export type SportType = 'NBA' | 'NFL' | 'NHL' | 'MLB';

export interface SportsCoachingSignal {
  legId: string;
  teamName: string;
  coachName: string;
  sport: SportType;
  recommendation: 'PICK' | 'FADE' | 'NEUTRAL';
  confidence: number;
  warnings: string[];
  propAdjustments: Record<string, number>;
  situation: string;
  reasoning: string[];
}

interface CoachProfile {
  coach_name: string;
  team_name: string;
  sport: string;
  // NBA-specific
  pace_preference?: string | null;
  rotation_depth?: number | null;
  star_usage_pct?: number | null;
  b2b_rest_tendency?: string | null;
  blowout_minutes_reduction?: number | null;
  fourth_quarter_pattern?: string | null;
  // NFL-specific
  run_pass_tendency?: string | null;
  fourth_down_aggression?: string | null;
  garbage_time_behavior?: string | null;
  qb_usage_style?: string | null;
  red_zone_tendency?: string | null;
  // NHL-specific
  line_matching?: string | null;
  goalie_pull_tendency?: string | null;
  pp_aggression?: string | null;
  empty_net_tendency?: string | null;
  // MLB-specific
  bullpen_usage?: string | null;
  lineup_consistency?: string | null;
  platoon_tendency?: string | null;
  pinch_hit_frequency?: string | null;
}

// Sport icons for UI
export const SPORT_ICONS: Record<SportType, string> = {
  NBA: '🏀',
  NFL: '🏈',
  NHL: '🏒',
  MLB: '⚾'
};

// Team mappings per sport
const NBA_TEAM_MAP: Record<string, string> = {
  'Hawks': 'Atlanta Hawks', 'Atlanta': 'Atlanta Hawks',
  'Celtics': 'Boston Celtics', 'Boston': 'Boston Celtics',
  'Nets': 'Brooklyn Nets', 'Brooklyn': 'Brooklyn Nets',
  'Hornets': 'Charlotte Hornets', 'Charlotte': 'Charlotte Hornets',
  'Bulls': 'Chicago Bulls', 'Chicago': 'Chicago Bulls',
  'Cavaliers': 'Cleveland Cavaliers', 'Cleveland': 'Cleveland Cavaliers', 'Cavs': 'Cleveland Cavaliers',
  'Mavericks': 'Dallas Mavericks', 'Dallas': 'Dallas Mavericks', 'Mavs': 'Dallas Mavericks',
  'Nuggets': 'Denver Nuggets', 'Denver': 'Denver Nuggets',
  'Pistons': 'Detroit Pistons', 'Detroit': 'Detroit Pistons',
  'Warriors': 'Golden State Warriors', 'Golden State': 'Golden State Warriors', 'GSW': 'Golden State Warriors',
  'Rockets': 'Houston Rockets', 'Houston': 'Houston Rockets',
  'Pacers': 'Indiana Pacers', 'Indiana': 'Indiana Pacers',
  'Clippers': 'Los Angeles Clippers', 'LA Clippers': 'Los Angeles Clippers', 'LAC': 'Los Angeles Clippers',
  'Lakers': 'Los Angeles Lakers', 'LA Lakers': 'Los Angeles Lakers', 'LAL': 'Los Angeles Lakers',
  'Grizzlies': 'Memphis Grizzlies', 'Memphis': 'Memphis Grizzlies',
  'Heat': 'Miami Heat', 'Miami': 'Miami Heat',
  'Bucks': 'Milwaukee Bucks', 'Milwaukee': 'Milwaukee Bucks',
  'Timberwolves': 'Minnesota Timberwolves', 'Minnesota': 'Minnesota Timberwolves', 'Wolves': 'Minnesota Timberwolves',
  'Pelicans': 'New Orleans Pelicans', 'New Orleans': 'New Orleans Pelicans', 'NOLA': 'New Orleans Pelicans',
  'Knicks': 'New York Knicks', 'New York': 'New York Knicks', 'NYK': 'New York Knicks',
  'Thunder': 'Oklahoma City Thunder', 'Oklahoma City': 'Oklahoma City Thunder', 'OKC': 'Oklahoma City Thunder',
  'Magic': 'Orlando Magic', 'Orlando': 'Orlando Magic',
  'Sixers': 'Philadelphia 76ers', '76ers': 'Philadelphia 76ers', 'Philadelphia': 'Philadelphia 76ers',
  'Suns': 'Phoenix Suns', 'Phoenix': 'Phoenix Suns',
  'Trail Blazers': 'Portland Trail Blazers', 'Blazers': 'Portland Trail Blazers', 'Portland': 'Portland Trail Blazers',
  'Kings': 'Sacramento Kings', 'Sacramento': 'Sacramento Kings',
  'Spurs': 'San Antonio Spurs', 'San Antonio': 'San Antonio Spurs',
  'Raptors': 'Toronto Raptors', 'Toronto': 'Toronto Raptors',
  'Jazz': 'Utah Jazz', 'Utah': 'Utah Jazz',
  'Wizards': 'Washington Wizards', 'Washington': 'Washington Wizards'
};

const NFL_TEAM_MAP: Record<string, string> = {
  'Cardinals': 'Arizona Cardinals', 'Arizona': 'Arizona Cardinals',
  'Falcons': 'Atlanta Falcons',
  'Ravens': 'Baltimore Ravens', 'Baltimore': 'Baltimore Ravens',
  'Bills': 'Buffalo Bills', 'Buffalo': 'Buffalo Bills',
  'Panthers': 'Carolina Panthers', 'Carolina': 'Carolina Panthers',
  'Bears': 'Chicago Bears',
  'Bengals': 'Cincinnati Bengals', 'Cincinnati': 'Cincinnati Bengals',
  'Browns': 'Cleveland Browns',
  'Cowboys': 'Dallas Cowboys',
  'Broncos': 'Denver Broncos',
  'Lions': 'Detroit Lions',
  'Packers': 'Green Bay Packers', 'Green Bay': 'Green Bay Packers',
  'Texans': 'Houston Texans',
  'Colts': 'Indianapolis Colts', 'Indianapolis': 'Indianapolis Colts',
  'Jaguars': 'Jacksonville Jaguars', 'Jacksonville': 'Jacksonville Jaguars',
  'Chiefs': 'Kansas City Chiefs', 'Kansas City': 'Kansas City Chiefs',
  'Raiders': 'Las Vegas Raiders', 'Las Vegas': 'Las Vegas Raiders',
  'Chargers': 'Los Angeles Chargers', 'LA Chargers': 'Los Angeles Chargers',
  'Rams': 'Los Angeles Rams', 'LA Rams': 'Los Angeles Rams',
  'Dolphins': 'Miami Dolphins',
  'Vikings': 'Minnesota Vikings',
  'Patriots': 'New England Patriots', 'New England': 'New England Patriots',
  'Saints': 'New Orleans Saints',
  'Giants': 'New York Giants', 'NY Giants': 'New York Giants',
  'Jets': 'New York Jets', 'NY Jets': 'New York Jets',
  'Eagles': 'Philadelphia Eagles',
  'Steelers': 'Pittsburgh Steelers', 'Pittsburgh': 'Pittsburgh Steelers',
  '49ers': 'San Francisco 49ers', 'San Francisco': 'San Francisco 49ers', 'Niners': 'San Francisco 49ers',
  'Seahawks': 'Seattle Seahawks', 'Seattle': 'Seattle Seahawks',
  'Buccaneers': 'Tampa Bay Buccaneers', 'Tampa Bay': 'Tampa Bay Buccaneers', 'Bucs': 'Tampa Bay Buccaneers',
  'Titans': 'Tennessee Titans', 'Tennessee': 'Tennessee Titans',
  'Commanders': 'Washington Commanders'
};

const NHL_TEAM_MAP: Record<string, string> = {
  'Ducks': 'Anaheim Ducks', 'Anaheim': 'Anaheim Ducks',
  'Coyotes': 'Arizona Coyotes',
  'Bruins': 'Boston Bruins',
  'Sabres': 'Buffalo Sabres',
  'Flames': 'Calgary Flames', 'Calgary': 'Calgary Flames',
  'Hurricanes': 'Carolina Hurricanes',
  'Blackhawks': 'Chicago Blackhawks',
  'Avalanche': 'Colorado Avalanche', 'Colorado': 'Colorado Avalanche',
  'Blue Jackets': 'Columbus Blue Jackets', 'Columbus': 'Columbus Blue Jackets',
  'Stars': 'Dallas Stars',
  'Red Wings': 'Detroit Red Wings',
  'Oilers': 'Edmonton Oilers', 'Edmonton': 'Edmonton Oilers',
  'Panthers': 'Florida Panthers', 'Florida': 'Florida Panthers',
  'Kings': 'Los Angeles Kings',
  'Wild': 'Minnesota Wild',
  'Canadiens': 'Montreal Canadiens', 'Montreal': 'Montreal Canadiens', 'Habs': 'Montreal Canadiens',
  'Predators': 'Nashville Predators', 'Nashville': 'Nashville Predators', 'Preds': 'Nashville Predators',
  'Devils': 'New Jersey Devils', 'New Jersey': 'New Jersey Devils',
  'Islanders': 'New York Islanders', 'NY Islanders': 'New York Islanders',
  'Rangers': 'New York Rangers', 'NY Rangers': 'New York Rangers',
  'Senators': 'Ottawa Senators', 'Ottawa': 'Ottawa Senators',
  'Flyers': 'Philadelphia Flyers',
  'Penguins': 'Pittsburgh Penguins',
  'Sharks': 'San Jose Sharks', 'San Jose': 'San Jose Sharks',
  'Kraken': 'Seattle Kraken',
  'Blues': 'St. Louis Blues', 'St. Louis': 'St. Louis Blues',
  'Lightning': 'Tampa Bay Lightning',
  'Maple Leafs': 'Toronto Maple Leafs', 'Leafs': 'Toronto Maple Leafs',
  'Canucks': 'Vancouver Canucks', 'Vancouver': 'Vancouver Canucks',
  'Golden Knights': 'Vegas Golden Knights', 'Vegas': 'Vegas Golden Knights', 'VGK': 'Vegas Golden Knights',
  'Capitals': 'Washington Capitals',
  'Jets': 'Winnipeg Jets', 'Winnipeg': 'Winnipeg Jets'
};

const MLB_TEAM_MAP: Record<string, string> = {
  'Diamondbacks': 'Arizona Diamondbacks', 'D-backs': 'Arizona Diamondbacks',
  'Braves': 'Atlanta Braves',
  'Orioles': 'Baltimore Orioles',
  'Red Sox': 'Boston Red Sox',
  'Cubs': 'Chicago Cubs',
  'White Sox': 'Chicago White Sox',
  'Reds': 'Cincinnati Reds',
  'Guardians': 'Cleveland Guardians',
  'Rockies': 'Colorado Rockies',
  'Tigers': 'Detroit Tigers',
  'Astros': 'Houston Astros',
  'Royals': 'Kansas City Royals',
  'Angels': 'Los Angeles Angels', 'LA Angels': 'Los Angeles Angels',
  'Dodgers': 'Los Angeles Dodgers', 'LA Dodgers': 'Los Angeles Dodgers',
  'Marlins': 'Miami Marlins',
  'Brewers': 'Milwaukee Brewers',
  'Twins': 'Minnesota Twins',
  'Mets': 'New York Mets', 'NY Mets': 'New York Mets',
  'Yankees': 'New York Yankees', 'NY Yankees': 'New York Yankees',
  'Athletics': 'Oakland Athletics', 'A\'s': 'Oakland Athletics',
  'Phillies': 'Philadelphia Phillies',
  'Pirates': 'Pittsburgh Pirates',
  'Padres': 'San Diego Padres', 'San Diego': 'San Diego Padres',
  'Giants': 'San Francisco Giants',
  'Mariners': 'Seattle Mariners',
  'Cardinals': 'St. Louis Cardinals',
  'Rays': 'Tampa Bay Rays',
  'Rangers': 'Texas Rangers', 'Texas': 'Texas Rangers',
  'Blue Jays': 'Toronto Blue Jays', 'Jays': 'Toronto Blue Jays',
  'Nationals': 'Washington Nationals'
};

interface DetectedTeam {
  teamName: string;
  sport: SportType;
  sportKey: string;
}

function detectTeam(text: string): DetectedTeam | null {
  const upperText = text.toUpperCase();
  
  // Check NFL first (most distinctive team names)
  for (const [key, fullName] of Object.entries(NFL_TEAM_MAP)) {
    if (upperText.includes(key.toUpperCase())) {
      return { teamName: fullName, sport: 'NFL', sportKey: 'americanfootball_nfl' };
    }
  }
  
  // Check NHL
  for (const [key, fullName] of Object.entries(NHL_TEAM_MAP)) {
    if (upperText.includes(key.toUpperCase())) {
      return { teamName: fullName, sport: 'NHL', sportKey: 'icehockey_nhl' };
    }
  }
  
  // Check MLB
  for (const [key, fullName] of Object.entries(MLB_TEAM_MAP)) {
    if (upperText.includes(key.toUpperCase())) {
      return { teamName: fullName, sport: 'MLB', sportKey: 'baseball_mlb' };
    }
  }
  
  // Check NBA last (some city names overlap)
  for (const [key, fullName] of Object.entries(NBA_TEAM_MAP)) {
    if (upperText.includes(key.toUpperCase())) {
      return { teamName: fullName, sport: 'NBA', sportKey: 'basketball_nba' };
    }
  }
  
  return null;
}

function detectSportFromLeg(leg: UniversalLeg): SportType | null {
  const sportLower = leg.sport?.toLowerCase() || '';
  
  if (sportLower.includes('nfl') || sportLower.includes('football')) return 'NFL';
  if (sportLower.includes('nhl') || sportLower.includes('hockey')) return 'NHL';
  if (sportLower.includes('mlb') || sportLower.includes('baseball')) return 'MLB';
  if (sportLower.includes('nba') || sportLower.includes('basketball')) return 'NBA';
  
  // Fallback to team detection
  const detected = detectTeam(leg.description);
  return detected?.sport || null;
}

function analyzeNBACoach(coach: CoachProfile, propType?: string): Omit<SportsCoachingSignal, 'legId' | 'teamName' | 'sport'> {
  const warnings: string[] = [];
  const reasoning: string[] = [];
  let recommendation: 'PICK' | 'FADE' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 50;
  const propAdjustments: Record<string, number> = { points: 0, minutes: 0, rebounds: 0, assists: 0 };
  
  if (coach.pace_preference === 'fast') {
    warnings.push('Fast pace = more possessions');
    reasoning.push(`${coach.coach_name} runs a fast-paced offense`);
    propAdjustments.points = (propAdjustments.points || 0) + 3;
    propAdjustments.assists = (propAdjustments.assists || 0) + 1;
    if (propType?.toLowerCase().includes('points')) {
      recommendation = 'PICK';
      confidence += 15;
    }
  } else if (coach.pace_preference === 'slow') {
    warnings.push('Slow pace = fewer possessions');
    reasoning.push(`${coach.coach_name} plays a methodical game`);
    propAdjustments.points = (propAdjustments.points || 0) - 3;
    if (propType?.toLowerCase().includes('points')) {
      recommendation = 'FADE';
      confidence += 10;
    }
  }
  
  if (coach.rotation_depth && coach.rotation_depth <= 8) {
    warnings.push('Tight rotation = more star minutes');
    reasoning.push(`Uses a tight ${coach.rotation_depth}-man rotation`);
    propAdjustments.minutes = (propAdjustments.minutes || 0) + 3;
    propAdjustments.points = (propAdjustments.points || 0) + 2;
  } else if (coach.rotation_depth && coach.rotation_depth >= 10) {
    warnings.push('Deep rotation = spread minutes');
    reasoning.push(`Distributes minutes across ${coach.rotation_depth} players`);
    propAdjustments.minutes = (propAdjustments.minutes || 0) - 3;
  }
  
  if (coach.b2b_rest_tendency === 'cautious') {
    warnings.push('⚠️ Cautious on B2Bs');
    reasoning.push('Tends to rest stars on back-to-backs');
    propAdjustments.minutes = (propAdjustments.minutes || 0) - 4;
  }
  
  confidence = Math.min(Math.max(confidence, 30), 85);
  
  return { coachName: coach.coach_name, recommendation, confidence, warnings, propAdjustments, situation: 'regular', reasoning };
}

function analyzeNFLCoach(coach: CoachProfile, propType?: string): Omit<SportsCoachingSignal, 'legId' | 'teamName' | 'sport'> {
  const warnings: string[] = [];
  const reasoning: string[] = [];
  let recommendation: 'PICK' | 'FADE' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 50;
  const propAdjustments: Record<string, number> = { passing_yards: 0, rushing_yards: 0, receptions: 0, touchdowns: 0 };
  
  if (coach.run_pass_tendency === 'pass_heavy') {
    warnings.push('Pass-heavy offense');
    reasoning.push(`${coach.coach_name} favors the passing game`);
    propAdjustments.passing_yards = (propAdjustments.passing_yards || 0) + 25;
    propAdjustments.receptions = (propAdjustments.receptions || 0) + 2;
    propAdjustments.rushing_yards = (propAdjustments.rushing_yards || 0) - 15;
    if (propType?.toLowerCase().includes('pass') || propType?.toLowerCase().includes('rec')) {
      recommendation = 'PICK';
      confidence += 15;
    }
    if (propType?.toLowerCase().includes('rush')) {
      recommendation = 'FADE';
      confidence += 10;
    }
  } else if (coach.run_pass_tendency === 'run_heavy') {
    warnings.push('Run-heavy offense');
    reasoning.push(`${coach.coach_name} establishes the run`);
    propAdjustments.rushing_yards = (propAdjustments.rushing_yards || 0) + 20;
    propAdjustments.passing_yards = (propAdjustments.passing_yards || 0) - 20;
    if (propType?.toLowerCase().includes('rush')) {
      recommendation = 'PICK';
      confidence += 15;
    }
  }
  
  if (coach.fourth_down_aggression === 'aggressive') {
    warnings.push('Aggressive on 4th down');
    reasoning.push('Goes for it frequently on 4th down');
    propAdjustments.touchdowns = (propAdjustments.touchdowns || 0) + 1;
  }
  
  if (coach.garbage_time_behavior === 'rests_starters') {
    warnings.push('⚠️ Pulls starters in blowouts');
    reasoning.push('Tends to rest starters when game is decided');
  }
  
  if (coach.qb_usage_style === 'dual_threat') {
    warnings.push('Dual-threat QB system');
    reasoning.push('System incorporates QB runs');
    propAdjustments.rushing_yards = (propAdjustments.rushing_yards || 0) + 10;
  }
  
  if (coach.red_zone_tendency === 'pass_heavy') {
    warnings.push('Pass-heavy in red zone');
    reasoning.push('Prefers passing in scoring opportunities');
  }
  
  confidence = Math.min(Math.max(confidence, 30), 85);
  
  return { coachName: coach.coach_name, recommendation, confidence, warnings, propAdjustments, situation: 'regular', reasoning };
}

function analyzeNHLCoach(coach: CoachProfile, propType?: string): Omit<SportsCoachingSignal, 'legId' | 'teamName' | 'sport'> {
  const warnings: string[] = [];
  const reasoning: string[] = [];
  let recommendation: 'PICK' | 'FADE' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 50;
  const propAdjustments: Record<string, number> = { goals: 0, assists: 0, shots: 0, saves: 0, ice_time: 0 };
  
  if (coach.line_matching === 'heavy') {
    warnings.push('Heavy line matching');
    reasoning.push(`${coach.coach_name} matches lines aggressively`);
    propAdjustments.ice_time = (propAdjustments.ice_time || 0) - 2;
  } else if (coach.line_matching === 'minimal') {
    warnings.push('Minimal line matching');
    reasoning.push('Stars get consistent ice time');
    propAdjustments.ice_time = (propAdjustments.ice_time || 0) + 2;
  }
  
  if (coach.goalie_pull_tendency === 'early') {
    warnings.push('Early goalie pulls');
    reasoning.push('Pulls goalie early for extra attacker');
    propAdjustments.goals = (propAdjustments.goals || 0) + 0.5;
  }
  
  if (coach.pp_aggression === 'aggressive') {
    warnings.push('Aggressive power play');
    reasoning.push('High-octane power play system');
    propAdjustments.goals = (propAdjustments.goals || 0) + 0.3;
    propAdjustments.shots = (propAdjustments.shots || 0) + 2;
    if (propType?.toLowerCase().includes('goal') || propType?.toLowerCase().includes('point')) {
      recommendation = 'PICK';
      confidence += 12;
    }
  } else if (coach.pp_aggression === 'conservative') {
    warnings.push('Conservative power play');
    reasoning.push('Focus on puck possession over shots');
  }
  
  if (coach.empty_net_tendency === 'aggressive') {
    warnings.push('Aggressive empty net usage');
    reasoning.push('Quick to pull goalie late in games');
  }
  
  confidence = Math.min(Math.max(confidence, 30), 85);
  
  return { coachName: coach.coach_name, recommendation, confidence, warnings, propAdjustments, situation: 'regular', reasoning };
}

function analyzeMLBCoach(coach: CoachProfile, propType?: string): Omit<SportsCoachingSignal, 'legId' | 'teamName' | 'sport'> {
  const warnings: string[] = [];
  const reasoning: string[] = [];
  let recommendation: 'PICK' | 'FADE' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 50;
  const propAdjustments: Record<string, number> = { strikeouts: 0, hits: 0, runs: 0, rbis: 0, innings: 0 };
  
  if (coach.bullpen_usage === 'heavy') {
    warnings.push('Heavy bullpen usage');
    reasoning.push(`${coach.coach_name} uses bullpen aggressively`);
    propAdjustments.innings = (propAdjustments.innings || 0) - 1;
    propAdjustments.strikeouts = (propAdjustments.strikeouts || 0) - 1;
    if (propType?.toLowerCase().includes('strikeout') || propType?.toLowerCase().includes('k')) {
      recommendation = 'FADE';
      confidence += 12;
    }
  } else if (coach.bullpen_usage === 'starter_focused') {
    warnings.push('Lets starters work deep');
    reasoning.push('Gives starters long leashes');
    propAdjustments.innings = (propAdjustments.innings || 0) + 1;
    propAdjustments.strikeouts = (propAdjustments.strikeouts || 0) + 1;
    if (propType?.toLowerCase().includes('strikeout') || propType?.toLowerCase().includes('k')) {
      recommendation = 'PICK';
      confidence += 15;
    }
  }
  
  if (coach.lineup_consistency === 'very_consistent') {
    warnings.push('Consistent lineup usage');
    reasoning.push('Sets lineup and sticks with it');
  } else if (coach.lineup_consistency === 'platoon_heavy') {
    warnings.push('⚠️ Heavy platoon usage');
    reasoning.push('Platooning affects playing time');
    propAdjustments.hits = (propAdjustments.hits || 0) - 1;
  }
  
  if (coach.platoon_tendency === 'heavy') {
    warnings.push('Uses platoons frequently');
    reasoning.push('Expects L/R matchups to impact lineup');
  }
  
  if (coach.pinch_hit_frequency === 'high') {
    warnings.push('High pinch-hit usage');
    reasoning.push('Quick to use bench late in games');
  }
  
  confidence = Math.min(Math.max(confidence, 30), 85);
  
  return { coachName: coach.coach_name, recommendation, confidence, warnings, propAdjustments, situation: 'regular', reasoning };
}

function analyzeCoachBySport(coach: CoachProfile, sport: SportType, propType?: string): Omit<SportsCoachingSignal, 'legId' | 'teamName' | 'sport'> {
  switch (sport) {
    case 'NBA':
      return analyzeNBACoach(coach, propType);
    case 'NFL':
      return analyzeNFLCoach(coach, propType);
    case 'NHL':
      return analyzeNHLCoach(coach, propType);
    case 'MLB':
      return analyzeMLBCoach(coach, propType);
    default:
      return analyzeNBACoach(coach, propType); // Fallback
  }
}

export function useSportsCoachingSignals(legs: UniversalLeg[]) {
  const [signals, setSignals] = useState<SportsCoachingSignal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Detect teams and sports from legs
  const detectedLegs = useMemo(() => {
    return legs.map(leg => {
      const sport = detectSportFromLeg(leg);
      const detected = detectTeam(leg.description);
      return {
        leg,
        sport: sport || detected?.sport || null,
        teamName: detected?.teamName || null,
        sportKey: detected?.sportKey || null
      };
    }).filter(d => d.sport && d.teamName);
  }, [legs]);
  
  // Extract unique teams with their sports
  const teamsBySport = useMemo(() => {
    const result: { teamName: string; sport: SportType; sportKey: string }[] = [];
    const seen = new Set<string>();
    
    detectedLegs.forEach(d => {
      if (d.teamName && d.sport && !seen.has(d.teamName)) {
        seen.add(d.teamName);
        result.push({
          teamName: d.teamName,
          sport: d.sport,
          sportKey: d.sportKey || ''
        });
      }
    });
    
    return result;
  }, [detectedLegs]);
  
  // Count legs by sport
  const legCountBySport = useMemo(() => {
    const counts: Record<SportType, number> = { NBA: 0, NFL: 0, NHL: 0, MLB: 0 };
    detectedLegs.forEach(d => {
      if (d.sport) counts[d.sport]++;
    });
    return counts;
  }, [detectedLegs]);
  
  useEffect(() => {
    if (teamsBySport.length === 0) {
      setSignals([]);
      return;
    }
    
    const fetchCoachingData = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const teamNames = teamsBySport.map(t => t.teamName);
        
        const { data: coaches, error: coachError } = await supabase
          .from('coach_profiles')
          .select('*')
          .in('team_name', teamNames)
          .eq('is_active', true);
        
        if (coachError) throw coachError;
        
        if (!coaches || coaches.length === 0) {
          setSignals([]);
          return;
        }
        
        const newSignals: SportsCoachingSignal[] = [];
        
        for (const d of detectedLegs) {
          if (!d.teamName || !d.sport) continue;
          
          const coach = coaches.find(c => c.team_name === d.teamName);
          if (!coach) continue;
          
          const analysis = analyzeCoachBySport(coach as CoachProfile, d.sport, d.leg.propType);
          
          newSignals.push({
            legId: d.leg.id,
            teamName: d.teamName,
            sport: d.sport,
            ...analysis
          });
        }
        
        setSignals(newSignals);
      } catch (err) {
        console.error('Error fetching coaching signals:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch coaching data');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchCoachingData();
  }, [teamsBySport, detectedLegs]);
  
  const getSignalForLeg = (legId: string): SportsCoachingSignal | undefined => {
    return signals.find(s => s.legId === legId);
  };
  
  const warningCount = signals.filter(s => s.warnings.length > 0).length;
  const criticalWarnings = signals.filter(s => s.recommendation === 'FADE');
  
  return {
    signals,
    isLoading,
    error,
    legCountBySport,
    totalLegsWithCoaching: detectedLegs.length,
    warningCount,
    criticalWarnings,
    getSignalForLeg
  };
}
