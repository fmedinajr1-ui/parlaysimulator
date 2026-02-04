/**
 * Pre-Game Matchup Scanner Type Definitions
 * Analyzes player production zones against opponent defensive rankings
 */

import type { ZoneType, DefenseRating } from './sweetSpot';

export type MatchupGradeLetter = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';

export type BoostLevel = 'strong' | 'moderate' | 'neutral' | 'negative';

export interface ZoneAnalysis {
  zone: ZoneType;
  playerFrequency: number; // % of shots (0-1)
  playerFgPct: number; // Player's FG% in zone (0-1)
  defenseAllowedPct: number; // What defense allows in zone (0-1)
  leagueAvgPct: number; // League average for zone (0-1)
  advantage: number; // playerFgPct - defenseAllowedPct
  defenseRank: number; // 1-30
  defenseRating: DefenseRating;
  grade: 'advantage' | 'neutral' | 'disadvantage';
}

export interface PlayerMatchupAnalysis {
  id: string;
  playerName: string;
  teamAbbrev: string;
  opponentAbbrev: string;
  gameTime: string;
  gameDescription: string;
  eventId: string;
  
  // Matchup metrics
  overallGrade: MatchupGradeLetter;
  overallScore: number; // -15 to +15
  
  // Zone breakdown
  zones: ZoneAnalysis[];
  
  // Key insights
  primaryZone: ZoneType;
  primaryZoneFrequency: number;
  primaryZoneAdvantage: number;
  exploitableZones: ZoneType[]; // Zones with advantage > 5%
  avoidZones: ZoneType[]; // Zones with disadvantage < -5%
  
  // Prop recommendation
  scoringBoost: BoostLevel;
  threesBoost: BoostLevel;
  recommendation: string;
  
  // Analysis timestamp
  analysisTimestamp: string;
}

export interface GameMatchupGroup {
  gameDescription: string;
  gameTime: string;
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  players: PlayerMatchupAnalysis[];
}

export interface MatchupScannerStats {
  totalPlayers: number;
  totalGames: number;
  gradeDistribution: Record<MatchupGradeLetter, number>;
  scoringBoostCount: number;
  threesBoostCount: number;
}

export interface MatchupScannerFilters {
  gradeFilter: MatchupGradeLetter | 'all' | 'A+A' | 'B+B';
  boostFilter: 'all' | 'scoring' | 'threes';
  teamFilter: string | 'all';
}

// Grade thresholds for scoring
export const GRADE_THRESHOLDS = {
  'A+': { min: 8.0, color: 'amber', label: 'Elite Matchup' },
  'A': { min: 5.0, color: 'green', label: 'Strong Advantage' },
  'B+': { min: 2.0, color: 'teal', label: 'Moderate Advantage' },
  'B': { min: 0, color: 'yellow', label: 'Slight Edge' },
  'C': { min: -3.0, color: 'gray', label: 'Neutral' },
  'D': { min: -Infinity, color: 'red', label: 'Disadvantage' },
} as const;

// Zone display names
export const ZONE_DISPLAY_NAMES: Record<ZoneType, string> = {
  restricted_area: 'Restricted Area',
  paint: 'Paint',
  mid_range: 'Mid-Range',
  corner_3: 'Corner 3',
  above_break_3: 'Above Break 3',
};

// Short zone labels for chips
export const ZONE_SHORT_LABELS: Record<ZoneType, string> = {
  restricted_area: 'RA',
  paint: 'Paint',
  mid_range: 'Mid',
  corner_3: 'C3',
  above_break_3: 'AB3',
};

// League average FG% by zone (for reference)
export const LEAGUE_AVG_BY_ZONE: Record<ZoneType, number> = {
  restricted_area: 0.65,
  paint: 0.42,
  mid_range: 0.41,
  corner_3: 0.38,
  above_break_3: 0.36,
};
