import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { UniversalLeg } from '@/types/universal-parlay';

export interface CoachingSignal {
  legId: string;
  teamName: string;
  coachName: string;
  recommendation: 'PICK' | 'FADE' | 'NEUTRAL';
  confidence: number;
  warnings: string[];
  propAdjustments: {
    points: number;
    minutes: number;
    rebounds: number;
    assists: number;
  };
  situation: string;
  reasoning: string[];
}

interface CoachProfile {
  coach_name: string;
  team_name: string;
  pace_preference: string | null;
  rotation_depth: number | null;
  star_usage_pct: number | null;
  b2b_rest_tendency: string | null;
  blowout_minutes_reduction: number | null;
  fourth_quarter_pattern: string | null;
}

// NBA team name mappings for detection
const NBA_TEAMS = [
  'Hawks', 'Celtics', 'Nets', 'Hornets', 'Bulls', 'Cavaliers', 'Mavericks', 'Nuggets',
  'Pistons', 'Warriors', 'Rockets', 'Pacers', 'Clippers', 'Lakers', 'Grizzlies', 'Heat',
  'Bucks', 'Timberwolves', 'Pelicans', 'Knicks', 'Thunder', 'Magic', 'Sixers', '76ers',
  'Suns', 'Trail Blazers', 'Blazers', 'Kings', 'Spurs', 'Raptors', 'Jazz', 'Wizards',
  'Atlanta', 'Boston', 'Brooklyn', 'Charlotte', 'Chicago', 'Cleveland', 'Dallas', 'Denver',
  'Detroit', 'Golden State', 'Houston', 'Indiana', 'LA Clippers', 'Los Angeles Lakers',
  'Memphis', 'Miami', 'Milwaukee', 'Minnesota', 'New Orleans', 'New York', 'Oklahoma City',
  'Orlando', 'Philadelphia', 'Phoenix', 'Portland', 'Sacramento', 'San Antonio', 'Toronto',
  'Utah', 'Washington'
];

const TEAM_NAME_MAP: Record<string, string> = {
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
  'Sixers': 'Philadelphia 76ers', '76ers': 'Philadelphia 76ers', 'Philadelphia': 'Philadelphia 76ers', 'Philly': 'Philadelphia 76ers',
  'Suns': 'Phoenix Suns', 'Phoenix': 'Phoenix Suns',
  'Trail Blazers': 'Portland Trail Blazers', 'Blazers': 'Portland Trail Blazers', 'Portland': 'Portland Trail Blazers',
  'Kings': 'Sacramento Kings', 'Sacramento': 'Sacramento Kings',
  'Spurs': 'San Antonio Spurs', 'San Antonio': 'San Antonio Spurs',
  'Raptors': 'Toronto Raptors', 'Toronto': 'Toronto Raptors',
  'Jazz': 'Utah Jazz', 'Utah': 'Utah Jazz',
  'Wizards': 'Washington Wizards', 'Washington': 'Washington Wizards'
};

function detectNBATeam(text: string): string | null {
  const upperText = text.toUpperCase();
  
  for (const [key, fullName] of Object.entries(TEAM_NAME_MAP)) {
    if (upperText.includes(key.toUpperCase())) {
      return fullName;
    }
  }
  
  return null;
}

function isNBALeg(leg: UniversalLeg): boolean {
  const sportLower = leg.sport?.toLowerCase() || '';
  if (sportLower.includes('nba') || sportLower.includes('basketball')) {
    return true;
  }
  
  // Check description for NBA team names
  return detectNBATeam(leg.description) !== null;
}

function analyzeCoachProfile(coach: CoachProfile, propType?: string): Omit<CoachingSignal, 'legId' | 'teamName'> {
  const warnings: string[] = [];
  const reasoning: string[] = [];
  let recommendation: 'PICK' | 'FADE' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 50;
  
  const propAdjustments = { points: 0, minutes: 0, rebounds: 0, assists: 0 };
  
  // Analyze pace preference
  if (coach.pace_preference === 'fast') {
    warnings.push('Fast pace = more possessions');
    reasoning.push(`${coach.coach_name} runs a fast-paced offense, increasing scoring opportunities`);
    propAdjustments.points += 3;
    propAdjustments.assists += 1;
    if (propType?.toLowerCase().includes('points') || propType?.toLowerCase().includes('pts')) {
      recommendation = 'PICK';
      confidence += 15;
    }
  } else if (coach.pace_preference === 'slow') {
    warnings.push('Slow pace = fewer possessions');
    reasoning.push(`${coach.coach_name} plays a methodical, slow-paced game`);
    propAdjustments.points -= 3;
    propAdjustments.assists -= 1;
    if (propType?.toLowerCase().includes('points') || propType?.toLowerCase().includes('pts')) {
      recommendation = 'FADE';
      confidence += 10;
    }
  }
  
  // Analyze rotation depth
  if (coach.rotation_depth) {
    if (coach.rotation_depth <= 8) {
      warnings.push('Tight rotation = more star minutes');
      reasoning.push(`${coach.coach_name} uses a tight ${coach.rotation_depth}-man rotation`);
      propAdjustments.minutes += 3;
      propAdjustments.points += 2;
      if (propType?.toLowerCase().includes('minutes') || propType?.toLowerCase().includes('min')) {
        recommendation = 'PICK';
        confidence += 12;
      }
    } else if (coach.rotation_depth >= 10) {
      warnings.push('Deep rotation = spread minutes');
      reasoning.push(`${coach.coach_name} distributes minutes across ${coach.rotation_depth} players`);
      propAdjustments.minutes -= 3;
      propAdjustments.points -= 2;
      if (propType?.toLowerCase().includes('minutes') || propType?.toLowerCase().includes('min')) {
        recommendation = 'FADE';
        confidence += 10;
      }
    }
  }
  
  // Analyze star usage
  if (coach.star_usage_pct) {
    if (coach.star_usage_pct >= 32) {
      warnings.push('High star usage');
      reasoning.push(`Star players see ${coach.star_usage_pct}% usage rate under ${coach.coach_name}`);
      propAdjustments.points += 2;
    } else if (coach.star_usage_pct <= 26) {
      warnings.push('Balanced ball movement');
      reasoning.push(`${coach.coach_name} spreads the ball, limiting individual star usage`);
      propAdjustments.assists += 2;
      propAdjustments.points -= 2;
    }
  }
  
  // Analyze B2B tendency
  if (coach.b2b_rest_tendency === 'cautious') {
    warnings.push('⚠️ Cautious on B2Bs');
    reasoning.push(`${coach.coach_name} tends to rest stars in back-to-back games`);
    propAdjustments.minutes -= 4;
  } else if (coach.b2b_rest_tendency === 'plays_through') {
    reasoning.push(`${coach.coach_name} typically plays through back-to-backs`);
  }
  
  // Analyze blowout behavior
  if (coach.blowout_minutes_reduction && coach.blowout_minutes_reduction >= 10) {
    warnings.push('Heavy blowout rest');
    reasoning.push(`${coach.coach_name} pulls starters early in blowouts (-${coach.blowout_minutes_reduction} min)`);
  }
  
  // Cap confidence
  confidence = Math.min(Math.max(confidence, 30), 85);
  
  return {
    coachName: coach.coach_name,
    recommendation,
    confidence,
    warnings,
    propAdjustments,
    situation: 'regular',
    reasoning
  };
}

export function useCoachingSignals(legs: UniversalLeg[]) {
  const [signals, setSignals] = useState<CoachingSignal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Memoize NBA legs detection
  const nbaLegs = useMemo(() => {
    return legs.filter(isNBALeg);
  }, [legs]);
  
  // Extract unique team names from NBA legs
  const teamNames = useMemo(() => {
    const teams = new Set<string>();
    nbaLegs.forEach(leg => {
      const team = detectNBATeam(leg.description);
      if (team) teams.add(team);
    });
    return Array.from(teams);
  }, [nbaLegs]);
  
  useEffect(() => {
    if (nbaLegs.length === 0) {
      setSignals([]);
      return;
    }
    
    const fetchCoachingData = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        // Fetch coach profiles for detected teams
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
        
        // Map coaches to legs
        const newSignals: CoachingSignal[] = [];
        
        for (const leg of nbaLegs) {
          const detectedTeam = detectNBATeam(leg.description);
          if (!detectedTeam) continue;
          
          const coach = coaches.find(c => c.team_name === detectedTeam);
          if (!coach) continue;
          
          const analysis = analyzeCoachProfile(coach as CoachProfile, leg.propType);
          
          newSignals.push({
            legId: leg.id,
            teamName: detectedTeam,
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
  }, [nbaLegs, teamNames]);
  
  // Helper to get signal for a specific leg
  const getSignalForLeg = (legId: string): CoachingSignal | undefined => {
    return signals.find(s => s.legId === legId);
  };
  
  // Get count of legs with warnings
  const warningCount = signals.filter(s => s.warnings.length > 0).length;
  
  // Get critical warnings (FADE recommendations)
  const criticalWarnings = signals.filter(s => s.recommendation === 'FADE');
  
  return {
    signals,
    isLoading,
    error,
    nbaLegCount: nbaLegs.length,
    warningCount,
    criticalWarnings,
    getSignalForLeg
  };
}
