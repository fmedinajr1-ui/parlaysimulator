import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getEasternDate } from '@/lib/dateUtils';
import type { ZoneType, DefenseRating } from '@/types/sweetSpot';
import type {
  PlayerMatchupAnalysis,
  ZoneAnalysis,
  GameMatchupGroup,
  MatchupScannerStats,
  MatchupGradeLetter,
  BoostLevel,
  MatchupScannerFilters,
} from '@/types/matchupScanner';
import { GRADE_THRESHOLDS, LEAGUE_AVG_BY_ZONE } from '@/types/matchupScanner';

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

interface TodayProp {
  player_name: string;
  teamAbbrev: string;
  opponentAbbrev: string;
  game_description: string;
  commence_time: string;
  event_id: string;
}

// Parse team abbreviations from game description (e.g., "MIN @ CHI")
function parseTeamsFromDescription(description: string, playerName: string): { teamAbbrev: string; opponentAbbrev: string } {
  const parts = description.split(' @ ');
  if (parts.length !== 2) {
    return { teamAbbrev: '', opponentAbbrev: '' };
  }
  const awayTeam = parts[0].trim();
  const homeTeam = parts[1].trim();
  
  // We don't know which team the player is on from this query alone
  // Return away as team and home as opponent (will be refined with zone data)
  return { teamAbbrev: awayTeam, opponentAbbrev: homeTeam };
}

// Calculate matchup grade based on overall score
function calculateGrade(score: number): MatchupGradeLetter {
  if (score > 8) return 'A+';
  if (score > 5) return 'A';
  if (score > 2) return 'B+';
  if (score > 0) return 'B';
  if (score > -3) return 'C';
  return 'D';
}

// Calculate zone grade
function calculateZoneGrade(advantage: number): 'advantage' | 'neutral' | 'disadvantage' {
  if (advantage > 0.03) return 'advantage';
  if (advantage < -0.03) return 'disadvantage';
  return 'neutral';
}

// Calculate boost level
function calculateBoostLevel(grade: MatchupGradeLetter, primaryZone: ZoneType): BoostLevel {
  const scoringZones: ZoneType[] = ['restricted_area', 'paint', 'mid_range'];
  const isScoring = scoringZones.includes(primaryZone);
  
  if ((grade === 'A+' || grade === 'A') && isScoring) return 'strong';
  if ((grade === 'B+' || grade === 'B') && isScoring) return 'moderate';
  if (grade === 'D') return 'negative';
  return 'neutral';
}

function calculateThreesBoostLevel(grade: MatchupGradeLetter, zones: ZoneAnalysis[]): BoostLevel {
  const threeZones = zones.filter(z => z.zone === 'corner_3' || z.zone === 'above_break_3');
  const avgThreeAdvantage = threeZones.reduce((sum, z) => sum + z.advantage, 0) / threeZones.length;
  
  if (avgThreeAdvantage > 0.05) return 'strong';
  if (avgThreeAdvantage > 0.02) return 'moderate';
  if (avgThreeAdvantage < -0.05) return 'negative';
  return 'neutral';
}

// Generate recommendation text
function generateRecommendation(
  grade: MatchupGradeLetter,
  primaryZone: ZoneType,
  scoringBoost: BoostLevel,
  threesBoost: BoostLevel
): string {
  const zoneLabels: Record<ZoneType, string> = {
    restricted_area: 'Rim',
    paint: 'Paint',
    mid_range: 'Mid-Range',
    corner_3: 'Corner 3',
    above_break_3: 'Above Break 3',
  };
  
  if (grade === 'A+' || grade === 'A') {
    if (scoringBoost === 'strong') {
      return `Strong PTS OVER • ${zoneLabels[primaryZone]} dominance`;
    }
    if (threesBoost === 'strong') {
      return `Strong 3PT OVER • Perimeter advantage`;
    }
    return `Favorable matchup • ${zoneLabels[primaryZone]} primary`;
  }
  
  if (grade === 'B+' || grade === 'B') {
    if (scoringBoost === 'moderate') {
      return `Moderate PTS OVER boost • ${zoneLabels[primaryZone]} edge`;
    }
    return `Slight edge in ${zoneLabels[primaryZone]}`;
  }
  
  if (grade === 'C') {
    return `Neutral matchup • Monitor usage`;
  }
  
  return `Tough matchup • Caution on OVER`;
}

export function usePreGameMatchupScanner(filters?: MatchupScannerFilters) {
  const todayET = getEasternDate();
  
  // Fetch today's pre-game props (unique players)
  const { data: todayProps, isLoading: propsLoading } = useQuery({
    queryKey: ['today-props-pregame', todayET],
    queryFn: async () => {
      // Calculate the UTC range for today's Eastern Time games
      // Games stored in UTC need offset: ET date maps to UTC noon-to-noon
      const todayETDate = getEasternDate(); // e.g., "2026-02-04"
      const [year, month, day] = todayETDate.split('-').map(Number);

      // Start: Today at 12:00 UTC (covers morning ET games)
      const startUTC = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
      // End: Tomorrow at 12:00 UTC (covers late-night ET games)
      const endUTC = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
      
      const { data, error } = await supabase
        .from('unified_props')
        .select('player_name, game_description, commence_time, event_id')
        .gte('commence_time', startUTC.toISOString())
        .lt('commence_time', endUTC.toISOString())
        .eq('sport', 'basketball_nba')
        .eq('is_active', true)
        .is('outcome', null); // Pre-game only (not settled)
      
      if (error) throw error;
      
      // Deduplicate by player and parse team info
      const seen = new Set<string>();
      const unique: TodayProp[] = [];
      for (const p of data || []) {
        if (!seen.has(p.player_name)) {
          seen.add(p.player_name);
          const teams = parseTeamsFromDescription(p.game_description, p.player_name);
          unique.push({
            player_name: p.player_name,
            game_description: p.game_description,
            commence_time: p.commence_time,
            event_id: p.event_id,
            teamAbbrev: teams.teamAbbrev,
            opponentAbbrev: teams.opponentAbbrev,
          });
        }
      }
      
      return unique;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
  
  // Extract player names and all team abbreviations (both teams since we're not sure which is which)
  const playerNames = useMemo(() => 
    todayProps?.map(p => p.player_name) || [], 
    [todayProps]
  );
  
  const allTeamAbbrevs = useMemo(() => {
    const abbrevs = new Set<string>();
    for (const p of todayProps || []) {
      if (p.teamAbbrev) abbrevs.add(p.teamAbbrev);
      if (p.opponentAbbrev) abbrevs.add(p.opponentAbbrev);
    }
    return [...abbrevs];
  }, [todayProps]);
  
  // Fetch player zone stats for all players
  const { data: playerZones, isLoading: zonesLoading } = useQuery({
    queryKey: ['player-zone-stats-batch', playerNames],
    queryFn: async () => {
      if (!playerNames.length) return [];
      
      const { data, error } = await supabase
        .from('player_zone_stats')
        .select('*')
        .in('player_name', playerNames)
        .eq('season', '2024-25');
      
      if (error) throw error;
      return data as PlayerZoneStats[];
    },
    enabled: playerNames.length > 0,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
  
  // Fetch team zone defense for all teams
  const { data: defenseZones, isLoading: defenseLoading } = useQuery({
    queryKey: ['team-zone-defense-batch', allTeamAbbrevs],
    queryFn: async () => {
      if (!allTeamAbbrevs.length) return [];
      
      const { data, error } = await supabase
        .from('team_zone_defense')
        .select('*')
        .in('team_abbrev', allTeamAbbrevs)
        .eq('season', '2024-25');
      
      if (error) throw error;
      return data as TeamZoneDefense[];
    },
    enabled: allTeamAbbrevs.length > 0,
    staleTime: 1000 * 60 * 60, // 1 hour
  });
  
  // Calculate matchup analysis for all players
  const analyses = useMemo((): PlayerMatchupAnalysis[] => {
    if (!todayProps?.length || !playerZones?.length || !defenseZones?.length) {
      return [];
    }
    
    const results: PlayerMatchupAnalysis[] = [];
    
    for (const prop of todayProps) {
      // Get player's zone stats
      const pZones = playerZones.filter(z => z.player_name === prop.player_name);
      if (pZones.length === 0) continue;
      
      // Get opponent's defense stats - try both teams since we don't know player's team
      let dZones = defenseZones.filter(z => z.team_abbrev === prop.opponentAbbrev);
      let actualOpponent = prop.opponentAbbrev;
      
      // If no match, try the other team
      if (dZones.length === 0) {
        dZones = defenseZones.filter(z => z.team_abbrev === prop.teamAbbrev);
        actualOpponent = prop.teamAbbrev;
      }
      if (dZones.length === 0) continue;
      
      // Calculate zone analysis
      const zones: ZoneAnalysis[] = [];
      let totalScore = 0;
      
      for (const pz of pZones) {
        const dz = dZones.find(d => d.zone === pz.zone);
        if (!dz) continue;
        
        const advantage = pz.fg_pct - dz.opp_fg_pct;
        const zoneScore = advantage * pz.frequency * 100;
        totalScore += zoneScore;
        
        zones.push({
          zone: pz.zone,
          playerFrequency: pz.frequency,
          playerFgPct: pz.fg_pct,
          defenseAllowedPct: dz.opp_fg_pct,
          leagueAvgPct: LEAGUE_AVG_BY_ZONE[pz.zone],
          advantage,
          defenseRank: dz.rank,
          defenseRating: dz.defense_rating,
          grade: calculateZoneGrade(advantage),
        });
      }
      
      // Sort zones by frequency (primary zone first)
      zones.sort((a, b) => b.playerFrequency - a.playerFrequency);
      
      const primaryZone = zones[0]?.zone || 'mid_range';
      const primaryZoneFrequency = zones[0]?.playerFrequency || 0;
      const primaryZoneAdvantage = zones[0]?.advantage || 0;
      
      const overallGrade = calculateGrade(totalScore);
      const scoringBoost = calculateBoostLevel(overallGrade, primaryZone);
      const threesBoost = calculateThreesBoostLevel(overallGrade, zones);
      
      results.push({
        id: `${prop.player_name}-${prop.event_id}`,
        playerName: prop.player_name,
        teamAbbrev: prop.teamAbbrev,
        opponentAbbrev: actualOpponent,
        gameTime: prop.commence_time,
        gameDescription: prop.game_description,
        eventId: prop.event_id,
        overallGrade,
        overallScore: Math.round(totalScore * 10) / 10,
        zones,
        primaryZone,
        primaryZoneFrequency,
        primaryZoneAdvantage,
        exploitableZones: zones.filter(z => z.advantage > 0.05).map(z => z.zone),
        avoidZones: zones.filter(z => z.advantage < -0.05).map(z => z.zone),
        scoringBoost,
        threesBoost,
        recommendation: generateRecommendation(overallGrade, primaryZone, scoringBoost, threesBoost),
        analysisTimestamp: new Date().toISOString(),
      });
    }
    
    // Sort by grade (A+ first)
    const gradeOrder: MatchupGradeLetter[] = ['A+', 'A', 'B+', 'B', 'C', 'D'];
    results.sort((a, b) => {
      const aIndex = gradeOrder.indexOf(a.overallGrade);
      const bIndex = gradeOrder.indexOf(b.overallGrade);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return b.overallScore - a.overallScore;
    });
    
    return results;
  }, [todayProps, playerZones, defenseZones]);
  
  // Apply filters
  const filteredAnalyses = useMemo(() => {
    if (!filters) return analyses;
    
    let filtered = [...analyses];
    
    // Grade filter
    if (filters.gradeFilter !== 'all') {
      if (filters.gradeFilter === 'A+A') {
        filtered = filtered.filter(a => a.overallGrade === 'A+' || a.overallGrade === 'A');
      } else if (filters.gradeFilter === 'B+B') {
        filtered = filtered.filter(a => a.overallGrade === 'B+' || a.overallGrade === 'B');
      } else {
        filtered = filtered.filter(a => a.overallGrade === filters.gradeFilter);
      }
    }
    
    // Boost filter
    if (filters.boostFilter === 'scoring') {
      filtered = filtered.filter(a => a.scoringBoost === 'strong' || a.scoringBoost === 'moderate');
    } else if (filters.boostFilter === 'threes') {
      filtered = filtered.filter(a => a.threesBoost === 'strong' || a.threesBoost === 'moderate');
    }
    
    // Team filter
    if (filters.teamFilter !== 'all') {
      filtered = filtered.filter(a => 
        a.teamAbbrev === filters.teamFilter || a.opponentAbbrev === filters.teamFilter
      );
    }
    
    return filtered;
  }, [analyses, filters]);
  
  // Group by game
  const gameGroups = useMemo((): GameMatchupGroup[] => {
    const groups = new Map<string, GameMatchupGroup>();
    
    for (const analysis of filteredAnalyses) {
      if (!groups.has(analysis.eventId)) {
        // Parse home/away from game description (e.g., "MIN @ CHI")
        const parts = analysis.gameDescription.split(' @ ');
        const awayTeam = parts[0] || '';
        const homeTeam = parts[1] || '';
        
        groups.set(analysis.eventId, {
          gameDescription: analysis.gameDescription,
          gameTime: analysis.gameTime,
          eventId: analysis.eventId,
          homeTeam,
          awayTeam,
          players: [],
        });
      }
      
      groups.get(analysis.eventId)!.players.push(analysis);
    }
    
    // Sort groups by game time
    return Array.from(groups.values()).sort((a, b) => 
      new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()
    );
  }, [filteredAnalyses]);
  
  // Calculate stats
  const stats = useMemo((): MatchupScannerStats => {
    const gradeDistribution: Record<MatchupGradeLetter, number> = {
      'A+': 0, 'A': 0, 'B+': 0, 'B': 0, 'C': 0, 'D': 0
    };
    
    let scoringBoostCount = 0;
    let threesBoostCount = 0;
    
    for (const a of analyses) {
      gradeDistribution[a.overallGrade]++;
      if (a.scoringBoost === 'strong' || a.scoringBoost === 'moderate') scoringBoostCount++;
      if (a.threesBoost === 'strong' || a.threesBoost === 'moderate') threesBoostCount++;
    }
    
    return {
      totalPlayers: analyses.length,
      totalGames: new Set(analyses.map(a => a.eventId)).size,
      gradeDistribution,
      scoringBoostCount,
      threesBoostCount,
    };
  }, [analyses]);
  
  return {
    analyses: filteredAnalyses,
    gameGroups,
    stats,
    isLoading: propsLoading || zonesLoading || defenseLoading,
    refetch: () => {
      // Trigger refetch of all queries
    },
  };
}
