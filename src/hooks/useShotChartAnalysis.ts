import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { PropType, ShotChartAnalysis, ZoneMatchup, ZoneType } from '@/types/sweetSpot';

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
  defense_rating: 'elite' | 'good' | 'average' | 'poor' | 'weak';
  rank: number;
}

// Zone display names
const ZONE_NAMES: Record<ZoneType, string> = {
  restricted_area: 'Restricted Area',
  paint: 'Paint',
  mid_range: 'Mid-Range',
  corner_3: 'Corner 3',
  above_break_3: 'Above Break 3',
};

// Calculate matchup grade based on player FG% vs defense allowed FG%
function calculateMatchupGrade(
  playerFgPct: number,
  defenseOppFgPct: number,
  defenseRank: number
): 'advantage' | 'neutral' | 'disadvantage' {
  // Player shoots better than what defense typically allows
  const differential = playerFgPct - defenseOppFgPct;
  
  // Also factor in defense rank
  if (differential > 0.05 || defenseRank > 20) {
    return 'advantage';
  } else if (differential < -0.05 || defenseRank < 10) {
    return 'disadvantage';
  }
  return 'neutral';
}

// Calculate impact score (-10 to +10)
function calculateImpact(
  grade: 'advantage' | 'neutral' | 'disadvantage',
  frequency: number
): number {
  const baseImpact = grade === 'advantage' ? 5 : grade === 'disadvantage' ? -5 : 0;
  // Weight by how often player shoots from this zone
  return Math.round(baseImpact * (1 + frequency));
}

// Generate recommendation text
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

export function useShotChartAnalysis(
  playerName: string,
  opponentAbbrev: string,
  propType: PropType,
  enabled: boolean = true
) {
  // Only relevant for scoring props
  const isRelevant = ['points', 'threes'].includes(propType);

  // Fetch player zone stats
  const { data: playerZones, isLoading: playerLoading } = useQuery({
    queryKey: ['player-zone-stats', playerName],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('player_zone_stats')
        .select('*')
        .eq('player_name', playerName)
        .eq('season', '2024-25');

      if (error) throw error;
      return data as PlayerZoneStats[];
    },
    enabled: enabled && isRelevant && !!playerName,
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  // Fetch opponent zone defense
  const { data: defenseZones, isLoading: defenseLoading } = useQuery({
    queryKey: ['team-zone-defense', opponentAbbrev],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_zone_defense')
        .select('*')
        .eq('team_abbrev', opponentAbbrev)
        .eq('season', '2024-25');

      if (error) throw error;
      return data as TeamZoneDefense[];
    },
    enabled: enabled && isRelevant && !!opponentAbbrev,
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  // Calculate analysis
  const analysis = useMemo((): ShotChartAnalysis | null => {
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
  }, [playerZones, defenseZones, playerName, opponentAbbrev, propType]);

  return {
    analysis,
    isLoading: playerLoading || defenseLoading,
    isRelevant,
  };
}

export { ZONE_NAMES };
