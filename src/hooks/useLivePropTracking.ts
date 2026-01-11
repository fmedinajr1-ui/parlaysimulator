import { useMemo } from 'react';
import { useLiveScores, LiveGame, PlayerStat } from './useLiveScores';
import { PropResult } from './usePropResults';

// Map prop types to player stat keys
const PROP_TO_STAT_KEY: Record<string, string | string[]> = {
  'player_points': 'points',
  'points': 'points',
  'player_rebounds': 'rebounds',
  'rebounds': 'rebounds',
  'player_assists': 'assists',
  'assists': 'assists',
  'player_threes': 'threes_made',
  'threes': 'threes_made',
  'player_blocks': 'blocks',
  'blocks': 'blocks',
  'player_steals': 'steals',
  'steals': 'steals',
  'player_turnovers': 'turnovers',
  'turnovers': 'turnovers',
  'player_points_rebounds': ['points', 'rebounds'],
  'player_points_assists': ['points', 'assists'],
  'player_rebounds_assists': ['rebounds', 'assists'],
  'player_points_rebounds_assists': ['points', 'rebounds', 'assists'],
};

export interface LivePropData {
  isLive: boolean;
  currentValue: number;
  gameProgress: number;
  period: string | null;
  clock: string | null;
  gameStatus: 'scheduled' | 'in_progress' | 'final' | 'halftime' | 'postponed';
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

function normalizePlayerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim();
}

function findPlayerInGame(game: LiveGame, playerName: string): PlayerStat | null {
  const normalizedSearch = normalizePlayerName(playerName);
  
  for (const stat of game.playerStats) {
    const normalizedStat = normalizePlayerName(stat.playerName || '');
    
    // Exact match
    if (normalizedStat === normalizedSearch) return stat;
    
    // Partial match (last name)
    const searchParts = normalizedSearch.split(' ');
    const statParts = normalizedStat.split(' ');
    
    // Match by last name
    if (searchParts.length > 0 && statParts.length > 0) {
      const searchLast = searchParts[searchParts.length - 1];
      const statLast = statParts[statParts.length - 1];
      if (searchLast === statLast && searchLast.length > 3) return stat;
    }
    
    // Contains match
    if (normalizedStat.includes(normalizedSearch) || normalizedSearch.includes(normalizedStat)) {
      return stat;
    }
  }
  
  return null;
}

function getStatValue(playerStat: PlayerStat, propType: string): number {
  const statKey = PROP_TO_STAT_KEY[propType.toLowerCase()];
  
  if (!statKey) return 0;
  
  // Combo stats
  if (Array.isArray(statKey)) {
    return statKey.reduce((sum, key) => sum + (playerStat[key] || 0), 0);
  }
  
  return playerStat[statKey] || 0;
}

function findGameForProp(games: LiveGame[], prop: PropResult): LiveGame | null {
  const teamName = prop.team_name?.toLowerCase() || '';
  const opponent = prop.opponent?.toLowerCase() || '';
  
  for (const game of games) {
    const homeTeamLower = game.homeTeam.toLowerCase();
    const awayTeamLower = game.awayTeam.toLowerCase();
    
    // Match by team name (could be in either home or away)
    const teamMatches = 
      homeTeamLower.includes(teamName) || 
      awayTeamLower.includes(teamName) ||
      teamName.includes(homeTeamLower) ||
      teamName.includes(awayTeamLower);
    
    const opponentMatches = 
      homeTeamLower.includes(opponent) || 
      awayTeamLower.includes(opponent) ||
      opponent.includes(homeTeamLower) ||
      opponent.includes(awayTeamLower);
    
    if (teamMatches || opponentMatches) {
      // Verify the player is in this game
      const playerStat = findPlayerInGame(game, prop.player_name);
      if (playerStat) return game;
    }
    
    // Fallback: just check if player exists in game
    const playerStat = findPlayerInGame(game, prop.player_name);
    if (playerStat) return game;
  }
  
  return null;
}

export function useLivePropTracking(props: PropResult[]) {
  const { games, liveGames, isLoading, getGameProgress } = useLiveScores({ autoRefresh: true });
  
  // Debug logging
  console.log('[LivePropTracking] Props received:', props.length, 'pending:', props.filter(p => p.outcome === 'pending').length);
  console.log('[LivePropTracking] Live games available:', games.length, 'in-progress:', liveGames.length);
  
  const propsWithLiveData = useMemo(() => {
    if (!games.length) return props.map(p => ({ prop: p, liveData: null }));
    
    return props.map(prop => {
      // Only track pending props
      if (prop.outcome !== 'pending' && prop.outcome !== 'partial') {
        return { prop, liveData: null };
      }
      
      // Find the game for this prop
      const game = findGameForProp(games, prop);
      
      if (!game) {
        return { prop, liveData: null };
      }
      
      // Find the player in the game
      const playerStat = findPlayerInGame(game, prop.player_name);
      
      if (!playerStat) {
        return { 
          prop, 
          liveData: {
            isLive: game.status === 'in_progress' || game.status === 'halftime',
            currentValue: 0,
            gameProgress: getGameProgress(game),
            period: game.period,
            clock: game.clock,
            gameStatus: game.status,
            homeTeam: game.homeTeam,
            awayTeam: game.awayTeam,
            homeScore: game.homeScore,
            awayScore: game.awayScore,
          } as LivePropData
        };
      }
      
      const currentValue = getStatValue(playerStat, prop.prop_type);
      
      return {
        prop,
        liveData: {
          isLive: game.status === 'in_progress' || game.status === 'halftime',
          currentValue,
          gameProgress: getGameProgress(game),
          period: game.period,
          clock: game.clock,
          gameStatus: game.status,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
        } as LivePropData
      };
    });
  }, [props, games, getGameProgress]);
  
  // Count how many props have live games
  const livePropsCount = propsWithLiveData.filter(p => p.liveData?.isLive).length;
  
  return {
    propsWithLiveData,
    livePropsCount,
    isLoading,
    totalLiveGames: liveGames.length,
  };
}
