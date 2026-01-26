import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLiveScores, LiveGame, PlayerStat } from './useLiveScores';

// Role-based baseline production rates per 36 minutes
const ROLE_BASELINES: Record<string, Record<string, number>> = {
  PRIMARY: { points: 22, rebounds: 5.5, assists: 5.5, threes: 2.5, pra: 33 },
  SECONDARY: { points: 16, rebounds: 5, assists: 4, threes: 1.8, pra: 25 },
  ROLE: { points: 10, rebounds: 4, assists: 2.5, threes: 1.2, pra: 16.5 },
  SPACER: { points: 7, rebounds: 3, assists: 1.5, threes: 1, pra: 11.5 },
  BENCH: { points: 5, rebounds: 2.5, assists: 1, threes: 0.5, pra: 8.5 },
};

// Map prop types to stat fields
const PROP_TO_STAT: Record<string, string | ((s: PlayerStat) => number)> = {
  'player_points': 'points',
  'points': 'points',
  'player_rebounds': 'rebounds',
  'rebounds': 'rebounds',
  'player_assists': 'assists',
  'assists': 'assists',
  'player_threes': 'threePointersMade',
  'threes': 'threePointersMade',
  '3pm': 'threePointersMade',
  'player_pts_rebs_asts': (s) => (s.points || 0) + (s.rebounds || 0) + (s.assists || 0),
  'pts+reb+ast': (s) => (s.points || 0) + (s.rebounds || 0) + (s.assists || 0),
  'pra': (s) => (s.points || 0) + (s.rebounds || 0) + (s.assists || 0),
  'player_pts_rebs': (s) => (s.points || 0) + (s.rebounds || 0),
  'pts+reb': (s) => (s.points || 0) + (s.rebounds || 0),
  'player_pts_asts': (s) => (s.points || 0) + (s.assists || 0),
  'pts+ast': (s) => (s.points || 0) + (s.assists || 0),
  'player_rebs_asts': (s) => (s.rebounds || 0) + (s.assists || 0),
  'reb+ast': (s) => (s.rebounds || 0) + (s.assists || 0),
  'player_steals': 'steals',
  'steals': 'steals',
  'player_blocks': 'blocks',
  'blocks': 'blocks',
};

export interface PropToTrack {
  playerName: string;
  propType: string;
  line: number;
  side: 'over' | 'under';
  eventId?: string;
  sport?: string;
}

export interface LiveProjection {
  playerName: string;
  propType: string;
  line: number;
  side: 'over' | 'under';
  
  // Live data
  currentValue: number;
  projectedFinal: number;
  confidence: number;
  
  // Game context
  gameProgress: number;
  period: string;
  clock: string;
  minutesPlayed: number;
  remainingMinutes: number;
  gameStatus: 'scheduled' | 'in_progress' | 'final' | 'halftime';
  
  // Risk factors
  riskFlags: string[];
  trend: 'strengthening' | 'weakening' | 'stable';
  
  // Recommendation
  isHitting: boolean;
  isOnPace: boolean;
  pacePercentage: number;
  
  // Game info
  gameInfo: {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    eventId: string;
  } | null;
}

interface ProjectionHistory {
  timestamp: number;
  projectedFinal: number;
  confidence: number;
}

interface UseLiveProjectionsOptions {
  refreshInterval?: number;
  autoRefresh?: boolean;
}

// Normalize player name for matching
const normalizePlayerName = (name: string | undefined | null): string => {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-z\s]/g, '').trim();
};

// Fuzzy match player names
const matchPlayerNames = (name1: string | undefined | null, name2: string | undefined | null): boolean => {
  if (!name1 || !name2) return false;
  
  const n1 = normalizePlayerName(name1);
  const n2 = normalizePlayerName(name2);
  
  if (!n1 || !n2) return false;
  if (n1 === n2) return true;
  
  // Check last names
  const parts1 = n1.split(' ').filter(p => p.length > 1);
  const parts2 = n2.split(' ').filter(p => p.length > 1);
  
  if (parts1.length === 0 || parts2.length === 0) return false;
  
  const lastName1 = parts1[parts1.length - 1];
  const lastName2 = parts2[parts2.length - 1];
  
  if (lastName1 === lastName2) {
    if (parts1[0] && parts2[0]) {
      return parts1[0][0] === parts2[0][0];
    }
    return true;
  }
  
  return n1.includes(n2) || n2.includes(n1);
};

// Get stat value from player stats
const getStatValue = (playerStat: PlayerStat, propType: string): number | null => {
  const normalizedProp = propType.toLowerCase().replace(/[_\s]/g, '');
  
  for (const [key, mapper] of Object.entries(PROP_TO_STAT)) {
    const normalizedKey = key.replace(/[_\s]/g, '');
    if (normalizedProp.includes(normalizedKey) || normalizedKey.includes(normalizedProp)) {
      if (typeof mapper === 'function') {
        return mapper(playerStat);
      }
      return (playerStat as any)[mapper] ?? null;
    }
  }
  
  return (playerStat as any)[propType] ?? null;
};

// Parse minutes string to number
const parseMinutes = (minutes: string | undefined): number => {
  if (!minutes) return 0;
  const parts = minutes.split(':');
  if (parts.length === 2) {
    return parseInt(parts[0]) + parseInt(parts[1]) / 60;
  }
  return parseFloat(minutes) || 0;
};

// Determine player role based on minutes played percentage
const determinePlayerRole = (minutesPct: number): string => {
  if (minutesPct >= 0.75) return 'PRIMARY';
  if (minutesPct >= 0.60) return 'SECONDARY';
  if (minutesPct >= 0.45) return 'ROLE';
  if (minutesPct >= 0.25) return 'SPACER';
  return 'BENCH';
};

// Get baseline stat rate per minute
const getBaselineRate = (role: string, propType: string): number => {
  const normalizedProp = propType.toLowerCase().replace(/[_\s]/g, '');
  const baselines = ROLE_BASELINES[role] || ROLE_BASELINES.ROLE;
  
  // Convert per-36 to per-minute
  if (normalizedProp.includes('point')) return baselines.points / 36;
  if (normalizedProp.includes('rebound')) return baselines.rebounds / 36;
  if (normalizedProp.includes('assist')) return baselines.assists / 36;
  if (normalizedProp.includes('three') || normalizedProp.includes('3pm')) return baselines.threes / 36;
  if (normalizedProp.includes('pra') || normalizedProp.includes('ptsrebast')) return baselines.pra / 36;
  
  return baselines.points / 36; // Default to points rate
};

// v5.0: TIGHTENED PROJECTION with variance shrinkage and recalibrated confidence
const calculateProjection = (
  currentValue: number,
  minutesPlayed: number,
  remainingMinutes: number,
  playerRole: string,
  propType: string,
  riskFlags: string[]
): { projectedFinal: number; confidence: number } => {
  if (minutesPlayed <= 0) {
    // No minutes yet, use baseline with lower confidence
    const baselineRate = getBaselineRate(playerRole, propType);
    const totalMinutes = remainingMinutes + minutesPlayed;
    return {
      projectedFinal: Math.round(baselineRate * totalMinutes * 10) / 10,
      confidence: 15, // v5.0: Lower pre-game confidence
    };
  }
  
  // Calculate live rate
  const liveRate = currentValue / minutesPlayed;
  const baselineRate = getBaselineRate(playerRole, propType);
  
  // v5.0: Tightened blending - trust live data faster but with variance consideration
  const gameProgressPct = minutesPlayed / (minutesPlayed + remainingMinutes);
  const liveWeight = Math.min(0.85, 0.35 + gameProgressPct * 0.5); // 35-85% based on progress
  const baselineWeight = 1 - liveWeight;
  
  const blendedRate = liveRate * liveWeight + baselineRate * baselineWeight;
  
  // v5.0: Calculate rate deviation for variance penalty
  const rateDeviation = Math.abs(liveRate - baselineRate) / (baselineRate || 1);
  
  // v5.0: Apply variance shrinkage - high deviation = regress toward baseline
  const shrinkageFactor = Math.max(0.88, Math.min(1.0, 1 - rateDeviation * 0.15));
  const adjustedRate = blendedRate * shrinkageFactor + baselineRate * (1 - shrinkageFactor);
  
  // Apply risk modifiers with tighter limits
  let remainingMinsAdjusted = remainingMinutes;
  
  if (riskFlags.includes('blowout')) {
    // v5.0: Tighter - reduce expected minutes by 35% in blowout
    remainingMinsAdjusted *= 0.65;
  }
  
  if (riskFlags.includes('foul_trouble')) {
    // v5.0: Tighter - reduce expected minutes by 25% in foul trouble
    remainingMinsAdjusted *= 0.75;
  }
  
  if (riskFlags.includes('losing_blowout')) {
    // v5.0: New - extra penalty for losing side of blowout
    remainingMinsAdjusted *= 0.85;
  }
  
  const projectedFinal = currentValue + adjustedRate * remainingMinsAdjusted;
  
  // v5.0: RECALIBRATED CONFIDENCE - variance-aware
  let confidence = 45; // Lower base
  
  // More minutes = more confidence (capped at +20)
  confidence += Math.min(20, minutesPlayed * 1.2);
  
  // v5.0: Variance penalty - high deviation = lower confidence
  if (rateDeviation > 0.35) confidence -= 12;
  else if (rateDeviation > 0.20) confidence -= 6;
  else if (rateDeviation < 0.15) confidence += 6;
  
  // v5.0: Early projection penalty (< 10 minutes)
  if (minutesPlayed < 10) confidence -= 10;
  
  // Risk flag penalties
  if (riskFlags.includes('blowout')) confidence -= 12;
  if (riskFlags.includes('foul_trouble')) confidence -= 10;
  if (riskFlags.includes('losing_blowout')) confidence -= 8;
  
  confidence = Math.max(1, Math.min(92, Math.round(confidence))); // v5.0: Cap at 92
  
  return {
    projectedFinal: Math.round(projectedFinal * 10) / 10,
    confidence,
  };
};

// Detect risk flags
const detectRiskFlags = (
  game: LiveGame,
  playerStat: PlayerStat
): string[] => {
  const flags: string[] = [];
  
  // Blowout detection (15+ point lead in Q4)
  const scoreDiff = Math.abs(game.homeScore - game.awayScore);
  const period = parseInt(game.period || '1');
  
  if (scoreDiff >= 15 && period >= 4) {
    flags.push('blowout');
  } else if (scoreDiff >= 20 && period >= 3) {
    flags.push('blowout');
  }
  
  // Foul trouble (4+ fouls)
  if ((playerStat as any).fouls >= 4) {
    flags.push('foul_trouble');
  }
  
  // Check if player is on losing side of blowout
  // (would affect minutes more)
  if (flags.includes('blowout')) {
    // Add losing_blowout if applicable
    const isHome = playerStat.team?.toLowerCase().includes('home') || false;
    const isWinning = isHome ? game.homeScore > game.awayScore : game.awayScore > game.homeScore;
    if (!isWinning) {
      flags.push('losing_blowout');
    }
  }
  
  return flags;
};

// Calculate remaining minutes estimate
const estimateRemainingMinutes = (
  game: LiveGame,
  minutesPlayed: number,
  gameProgress: number
): number => {
  const sport = game.sport?.toUpperCase() || 'NBA';
  
  // Total game minutes by sport
  let totalGameMinutes = 48; // NBA default
  if (sport === 'NCAAB') totalGameMinutes = 40;
  if (sport === 'NHL') totalGameMinutes = 60;
  if (sport === 'NFL' || sport === 'NCAAF') totalGameMinutes = 60;
  
  // Estimate player's share of game
  const currentPct = gameProgress / 100;
  if (currentPct <= 0 || currentPct >= 1) return 0;
  
  const totalExpectedMinutes = minutesPlayed / currentPct;
  return Math.max(0, totalExpectedMinutes - minutesPlayed);
};

// Calculate game progress
const getGameProgress = (game: LiveGame): number => {
  if (game.status === 'scheduled') return 0;
  if (game.status === 'final') return 100;
  if (game.status === 'halftime') return 50;
  
  const period = game.period;
  if (!period) return 0;
  
  const sport = game.sport?.toUpperCase() || 'NBA';
  
  // Parse period number
  let p = parseInt(period.replace(/\D/g, '')) || 1;
  
  if (sport === 'NBA' || sport === 'NCAAB') {
    if (period.includes('OT')) return 100 + p * 10;
    return (p / 4) * 100;
  }
  
  if (sport === 'NFL' || sport === 'NCAAF') {
    if (period.includes('OT')) return 100;
    return (p / 4) * 100;
  }
  
  if (sport === 'NHL') {
    if (period.includes('OT')) return 100;
    return (p / 3) * 100;
  }
  
  if (sport === 'MLB') {
    return Math.min((p / 9) * 100, 100);
  }
  
  return 50;
};

export function useLiveProjections(
  propsToTrack: PropToTrack[],
  options: UseLiveProjectionsOptions = {}
) {
  const { refreshInterval = 30000, autoRefresh = true } = options;
  
  const { games, isLoading, isConnected, lastUpdated, refresh } = useLiveScores({
    autoRefresh,
    refreshInterval,
  });
  
  // Store projection history for trend detection
  const historyRef = useRef<Map<string, ProjectionHistory[]>>(new Map());
  
  // Calculate projections for all tracked props
  const projections = useMemo((): LiveProjection[] => {
    if (!propsToTrack || propsToTrack.length === 0) return [];
    
    return propsToTrack.map(prop => {
      const { playerName, propType, line, side, eventId, sport } = prop;
      
      // Find matching game and player
      let matchedGame: LiveGame | null = null;
      let matchedStat: PlayerStat | null = null;
      
      for (const game of games) {
        // Filter by eventId if provided
        if (eventId && game.eventId !== eventId) continue;
        
        // Filter by sport if provided
        if (sport && game.sport?.toUpperCase() !== sport.toUpperCase()) continue;
        
        for (const stat of game.playerStats || []) {
          if (matchPlayerNames(playerName, stat.playerName || stat.name)) {
            matchedGame = game;
            matchedStat = stat;
            break;
          }
        }
        if (matchedStat) break;
      }
      
      // Default values for non-matched or scheduled games
      if (!matchedGame || !matchedStat) {
        return {
          playerName,
          propType,
          line,
          side,
          currentValue: 0,
          projectedFinal: line, // Default to line
          confidence: 10,
          gameProgress: 0,
          period: '',
          clock: '',
          minutesPlayed: 0,
          remainingMinutes: 36, // Default assumption
          gameStatus: 'scheduled' as const,
          riskFlags: [],
          trend: 'stable' as const,
          isHitting: false,
          isOnPace: false,
          pacePercentage: 0,
          gameInfo: null,
        };
      }
      
      const gameProgress = getGameProgress(matchedGame);
      const gameStatus = matchedGame.status as 'scheduled' | 'in_progress' | 'final' | 'halftime';
      
      // Get current stat value
      const currentValue = getStatValue(matchedStat, propType) || 0;
      
      // Parse minutes played
      const minutesPlayed = parseMinutes(matchedStat.minutes);
      
      // Estimate remaining minutes
      const remainingMinutes = estimateRemainingMinutes(matchedGame, minutesPlayed, gameProgress);
      
      // Determine player role based on minutes percentage
      const expectedTotalMinutes = minutesPlayed + remainingMinutes;
      const minutesPct = expectedTotalMinutes > 0 ? expectedTotalMinutes / 48 : 0.5;
      const playerRole = determinePlayerRole(minutesPct);
      
      // Detect risk flags
      const riskFlags = detectRiskFlags(matchedGame, matchedStat);
      
      // Calculate projection
      const { projectedFinal, confidence } = calculateProjection(
        currentValue,
        minutesPlayed,
        remainingMinutes,
        playerRole,
        propType,
        riskFlags
      );
      
      // Determine if hitting and on pace
      const isHitting = side === 'over' 
        ? currentValue >= line 
        : currentValue <= line;
      
      const isOnPace = side === 'over'
        ? projectedFinal >= line
        : projectedFinal <= line;
      
      // Calculate pace percentage (how much of needed rate they're producing)
      const neededTotal = line;
      const pacePercentage = neededTotal > 0 
        ? Math.round((projectedFinal / neededTotal) * 100)
        : 100;
      
      // Determine trend by comparing to history
      const propKey = `${playerName}-${propType}`;
      const history = historyRef.current.get(propKey) || [];
      
      let trend: 'strengthening' | 'weakening' | 'stable' = 'stable';
      if (history.length >= 2) {
        const recent = history[history.length - 1];
        const previous = history[history.length - 2];
        const diff = recent.projectedFinal - previous.projectedFinal;
        
        if (side === 'over') {
          if (diff > 0.5) trend = 'strengthening';
          else if (diff < -0.5) trend = 'weakening';
        } else {
          if (diff < -0.5) trend = 'strengthening';
          else if (diff > 0.5) trend = 'weakening';
        }
      }
      
      // Update history (keep last 10 snapshots)
      const newHistory = [...history, { timestamp: Date.now(), projectedFinal, confidence }].slice(-10);
      historyRef.current.set(propKey, newHistory);
      
      return {
        playerName,
        propType,
        line,
        side,
        currentValue,
        projectedFinal,
        confidence,
        gameProgress,
        period: matchedGame.period || '',
        clock: matchedGame.clock || '',
        minutesPlayed,
        remainingMinutes,
        gameStatus,
        riskFlags,
        trend,
        isHitting,
        isOnPace,
        pacePercentage,
        gameInfo: {
          homeTeam: matchedGame.homeTeam,
          awayTeam: matchedGame.awayTeam,
          homeScore: matchedGame.homeScore,
          awayScore: matchedGame.awayScore,
          eventId: matchedGame.eventId,
        },
      };
    });
  }, [propsToTrack, games]);
  
  // Get projections that are currently live
  const liveProjections = useMemo(() => 
    projections.filter(p => p.gameStatus === 'in_progress' || p.gameStatus === 'halftime'),
    [projections]
  );
  
  // Get projections that are hitting
  const hittingProjections = useMemo(() =>
    projections.filter(p => p.isOnPace),
    [projections]
  );
  
  // Get projections with risk flags
  const atRiskProjections = useMemo(() =>
    projections.filter(p => p.riskFlags.length > 0),
    [projections]
  );
  
  // Manual refresh
  const refreshProjections = useCallback(() => {
    refresh();
  }, [refresh]);
  
  return {
    projections,
    liveProjections,
    hittingProjections,
    atRiskProjections,
    isLoading,
    isConnected,
    lastUpdated,
    refresh: refreshProjections,
  };
}
