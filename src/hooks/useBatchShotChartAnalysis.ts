import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PropType, ShotChartAnalysis, ZoneMatchup, ZoneType, DefenseRating } from '@/types/sweetSpot';

interface PlayerZoneStats {
  player_name: string;
  zone: ZoneType;
  fga: number;
  fgm: number;
  fg_pct: number;
  frequency: number;
}

interface TeamZoneDefense {
  team_abbrev: string;
  zone: ZoneType;
  opp_fga: number;
  opp_fg_pct: number;
  league_avg_pct: number;
  defense_rating: DefenseRating;
  rank: number;
}

// Zone display names for recommendations
const ZONE_NAMES: Record<ZoneType, string> = {
  restricted_area: 'Restricted Area',
  paint: 'Paint',
  mid_range: 'Mid-Range',
  corner_3: 'Corner 3',
  above_break_3: 'Above Break 3',
};

// NBA Team abbreviation mapping
const TEAM_ABBREV_MAP: Record<string, string> = {
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
  'LA Clippers': 'LAC',
  'Los Angeles Clippers': 'LAC',
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
};

// Nickname to abbreviation mapping for partial matches
const NICKNAME_ABBREV_MAP: Record<string, string> = {
  'hawks': 'ATL',
  'celtics': 'BOS',
  'nets': 'BKN',
  'hornets': 'CHA',
  'bulls': 'CHI',
  'cavaliers': 'CLE',
  'cavs': 'CLE',
  'mavericks': 'DAL',
  'mavs': 'DAL',
  'nuggets': 'DEN',
  'pistons': 'DET',
  'warriors': 'GSW',
  'rockets': 'HOU',
  'pacers': 'IND',
  'clippers': 'LAC',
  'lakers': 'LAL',
  'grizzlies': 'MEM',
  'heat': 'MIA',
  'bucks': 'MIL',
  'timberwolves': 'MIN',
  'wolves': 'MIN',
  'pelicans': 'NOP',
  'knicks': 'NYK',
  'thunder': 'OKC',
  'magic': 'ORL',
  '76ers': 'PHI',
  'sixers': 'PHI',
  'suns': 'PHX',
  'trail blazers': 'POR',
  'blazers': 'POR',
  'kings': 'SAC',
  'spurs': 'SAS',
  'raptors': 'TOR',
  'jazz': 'UTA',
  'wizards': 'WAS',
};

/**
 * Normalize opponent name to team abbreviation
 */
function normalizeOpponent(opponentName: string): string {
  if (!opponentName) return '';
  
  // Already an abbreviation (3-4 chars)
  if (opponentName.length <= 4 && opponentName === opponentName.toUpperCase()) {
    return opponentName;
  }
  
  // Try direct full name match
  if (TEAM_ABBREV_MAP[opponentName]) {
    return TEAM_ABBREV_MAP[opponentName];
  }
  
  // Try nickname match
  const lower = opponentName.toLowerCase();
  if (NICKNAME_ABBREV_MAP[lower]) {
    return NICKNAME_ABBREV_MAP[lower];
  }
  
  // Try partial nickname match (e.g., "vs Lakers" -> "LAL")
  for (const [nickname, abbrev] of Object.entries(NICKNAME_ABBREV_MAP)) {
    if (lower.includes(nickname)) {
      return abbrev;
    }
  }
  
  // Fallback: return as-is (might already be abbreviation)
  return opponentName.toUpperCase().slice(0, 3);
}

/**
 * Calculate matchup grade based on player FG% vs defense allowed FG%
 */
function calculateMatchupGrade(
  playerFgPct: number,
  defenseOppFgPct: number,
  defenseRank: number
): 'advantage' | 'neutral' | 'disadvantage' {
  const differential = playerFgPct - defenseOppFgPct;
  
  if (differential > 0.05 || defenseRank > 20) {
    return 'advantage';
  } else if (differential < -0.05 || defenseRank < 10) {
    return 'disadvantage';
  }
  return 'neutral';
}

/**
 * Calculate impact score (-10 to +10)
 */
function calculateImpact(
  grade: 'advantage' | 'neutral' | 'disadvantage',
  frequency: number
): number {
  const baseImpact = grade === 'advantage' ? 5 : grade === 'disadvantage' ? -5 : 0;
  return Math.round(baseImpact * (1 + frequency));
}

/**
 * Generate recommendation text
 */
function generateRecommendation(
  score: number,
  primaryZone: PlayerZoneStats | undefined,
  propType: PropType
): string {
  if (!primaryZone) return 'Insufficient data';

  const zoneName = ZONE_NAMES[primaryZone.zone];
  const propLabel = propType === 'threes' ? '3PM' : 'PTS';

  if (score > 5) {
    return `Strong ${propLabel} matchup - ${zoneName} advantage`;
  } else if (score > 0) {
    return `Favorable ${propLabel} matchup in ${zoneName}`;
  } else if (score < -5) {
    return `Tough ${propLabel} matchup - ${zoneName} disadvantage`;
  } else if (score < 0) {
    return `Slightly unfavorable ${propLabel} matchup`;
  }
  return `Neutral ${propLabel} matchup`;
}

/**
 * Calculate shot chart analysis from player and defense zone data
 */
function calculateAnalysis(
  playerZones: PlayerZoneStats[],
  defenseZones: TeamZoneDefense[],
  playerName: string,
  opponentAbbrev: string,
  propType: PropType
): ShotChartAnalysis | null {
  if (!playerZones?.length || !defenseZones?.length) return null;

  // Sort zones by player frequency
  const sorted = [...playerZones].sort((a, b) => b.frequency - a.frequency);
  const primaryZone = sorted[0];

  // Calculate weighted matchup score
  let totalScore = 0;
  const zones: ZoneMatchup[] = [];

  for (const pz of playerZones) {
    const dz = defenseZones.find(d => d.zone === pz.zone);
    if (!dz) continue;

    const matchupGrade = calculateMatchupGrade(pz.fg_pct, dz.opp_fg_pct, dz.rank);
    const impact = calculateImpact(matchupGrade, pz.frequency);

    zones.push({
      zone: pz.zone,
      playerFrequency: pz.frequency,
      playerFgPct: pz.fg_pct,
      defenseRating: dz.defense_rating,
      defenseRank: dz.rank,
      matchupGrade,
      impact,
    });

    // Weight score by frequency
    totalScore += impact * pz.frequency;
  }

  return {
    playerName,
    opponentName: opponentAbbrev,
    primaryZone: primaryZone.zone,
    primaryZonePct: primaryZone.frequency,
    zones,
    overallMatchupScore: Math.round(totalScore * 10) / 10,
    recommendation: generateRecommendation(totalScore, primaryZone, propType),
  };
}

/**
 * Batch shot chart analysis hook
 * Fetches ALL player zone stats and team defense data in 2 queries,
 * then provides a memoized lookup function for any player-opponent pair.
 */
export function useBatchShotChartAnalysis(enabled: boolean = true) {
  // Query 1: All player zone stats (cached 1 hour)
  const { data: allPlayerZones, isLoading: playerLoading } = useQuery({
    queryKey: ['all-player-zone-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_zone_stats')
        .select('*')
        .eq('season', '2024-25');
      
      if (error) throw error;
      return data as PlayerZoneStats[];
    },
    staleTime: 1000 * 60 * 60, // 1 hour
    enabled,
  });

  // Query 2: All team zone defense (cached 1 hour)
  const { data: allDefenseZones, isLoading: defenseLoading } = useQuery({
    queryKey: ['all-team-zone-defense'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_zone_defense')
        .select('*')
        .eq('season', '2024-25');
      
      if (error) throw error;
      return data as TeamZoneDefense[];
    },
    staleTime: 1000 * 60 * 60, // 1 hour
    enabled,
  });

  // Memoized lookup function
  const getMatchup = useCallback((
    playerName: string,
    opponentName: string,
    propType: PropType
  ): ShotChartAnalysis | null => {
    // Only relevant for scoring props
    if (!['points', 'threes'].includes(propType)) return null;
    if (!allPlayerZones?.length || !allDefenseZones?.length) return null;

    // Normalize opponent to abbreviation
    const opponentAbbrev = normalizeOpponent(opponentName);

    // Filter player zones
    const playerZones = allPlayerZones.filter(
      z => z.player_name === playerName
    );

    // Filter defense zones
    const defenseZones = allDefenseZones.filter(
      z => z.team_abbrev === opponentAbbrev
    );

    if (!playerZones.length || !defenseZones.length) return null;

    return calculateAnalysis(playerZones, defenseZones, playerName, opponentAbbrev, propType);
  }, [allPlayerZones, allDefenseZones]);

  return {
    getMatchup,
    isLoading: playerLoading || defenseLoading,
    playerCount: allPlayerZones?.length ?? 0,
    defenseCount: allDefenseZones?.length ?? 0,
  };
}

export { normalizeOpponent, ZONE_NAMES };
