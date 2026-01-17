import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLiveScores, LiveGame, PlayerStat } from './useLiveScores';
import { useUnifiedLiveFeed, UnifiedPlayer, UnifiedGame } from './useUnifiedLiveFeed';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface LegLiveProgress {
  legIndex: number;
  parlayId: string;
  playerName: string;
  propType: string;
  line: number;
  side: 'over' | 'under';
  currentValue: number | null;
  gameProgress: number;
  gameStatus: 'scheduled' | 'in_progress' | 'final' | 'halftime';
  gameInfo: {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    period: string;
    clock: string;
  } | null;
  isHitting: boolean;
  isOnPace: boolean;
  projectedFinal: number | null;
  eventId: string | null;
  isPlayerProp: boolean;
  description: string;
  betType: string;
  sport: string;
  matchup?: string;
  
  // Enhanced projection data
  confidence: number;
  riskFlags: string[];
  trend: 'strengthening' | 'weakening' | 'stable';
  remainingMinutes: number;
  ratePerMinute: number;
  pacePercentage: number;
  minutesPlayed: number;
}

export interface ParlayLiveProgress {
  parlayId: string;
  sport: string;
  totalOdds: number;
  legs: LegLiveProgress[];
  legsHitting: number;
  legsTotal: number;
  hasLiveGames: boolean;
  status: 'all_hitting' | 'mixed' | 'busting' | 'upcoming' | 'completed';
}

interface PendingParlay {
  id: string;
  sport: string;
  total_odds: number;
  legs: any[];
}

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
  'player_turnovers': 'turnovers',
  'turnovers': 'turnovers',
};

// Normalize game status from various ESPN values
const normalizeGameStatus = (status: string | undefined): 'scheduled' | 'in_progress' | 'final' | 'halftime' => {
  if (!status) return 'scheduled';
  const s = status.toLowerCase();
  if (s === 'final' || s === 'completed' || s === 'post') return 'final';
  if (s === 'in_progress' || s === 'live' || s.includes('quarter') || s.includes('period') || s.includes('half') || s.includes('inning')) return 'in_progress';
  if (s === 'halftime') return 'halftime';
  // Default: treat as scheduled (including 'pre', 'scheduled', 'postponed', etc.)
  return 'scheduled';
};

// Normalize player name for matching
const normalizePlayerName = (name: string | undefined | null): string => {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim();
};

// Fuzzy match player names
const matchPlayerNames = (parlayName: string | undefined | null, liveName: string | undefined | null): boolean => {
  if (!parlayName || !liveName) return false;
  
  const normalized1 = normalizePlayerName(parlayName);
  const normalized2 = normalizePlayerName(liveName);
  
  // Return false if either normalized name is empty
  if (!normalized1 || !normalized2) return false;
  
  // Exact match
  if (normalized1 === normalized2) return true;
  
  // Check if last names match (most common case)
  const parts1 = normalized1.split(' ').filter(p => p.length > 1);
  const parts2 = normalized2.split(' ').filter(p => p.length > 1);
  
  if (parts1.length === 0 || parts2.length === 0) return false;
  
  const lastName1 = parts1[parts1.length - 1];
  const lastName2 = parts2[parts2.length - 1];
  
  if (lastName1 === lastName2) {
    // Also check first initial if available
    if (parts1[0] && parts2[0]) {
      return parts1[0][0] === parts2[0][0];
    }
    return true;
  }
  
  // Check if one name contains the other
  return normalized1.includes(normalized2) || normalized2.includes(normalized1);
};

// Get stat value from player stats
const getStatValue = (playerStat: PlayerStat, propType: string): number | null => {
  const normalizedProp = propType.toLowerCase().replace(/[_\s]/g, '');
  
  for (const [key, mapper] of Object.entries(PROP_TO_STAT)) {
    if (normalizedProp.includes(key.replace(/[_\s]/g, '')) || key.replace(/[_\s]/g, '').includes(normalizedProp)) {
      if (typeof mapper === 'function') {
        return mapper(playerStat);
      }
      return (playerStat as any)[mapper] ?? null;
    }
  }
  
  // Fallback: try direct property access
  return (playerStat as any)[propType] ?? null;
};

export function useParlayLiveProgress() {
  const { user } = useAuth();
  const [pendingParlays, setPendingParlays] = useState<PendingParlay[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Use both live scores (for game status) and unified feed (for player projections)
  const { games, liveGames, isConnected, triggerSync, lastUpdated } = useLiveScores({
    autoRefresh: true,
    refreshInterval: 30000,
  });
  
  // Unified feed provides real-time player projections with 15s refresh
  const { 
    games: unifiedGames, 
    findPlayer: findUnifiedPlayer,
    getPlayerProjection,
    isLoading: feedLoading,
    lastFetched: feedLastFetched,
  } = useUnifiedLiveFeed({
    enabled: pendingParlays.length > 0,
    refreshInterval: 15000, // 15s for live player updates
  });

  // Fetch pending parlays
  useEffect(() => {
    if (!user) return;

    const fetchPendingParlays = async () => {
      const { data, error } = await supabase
        .from('suggested_parlays')
        .select('id, sport, total_odds, legs')
        .eq('user_id', user.id)
        .eq('outcome', 'pending')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setPendingParlays(data.map(p => ({
          ...p,
          legs: p.legs as any[],
        })));
      }
      setIsLoading(false);
    };

    fetchPendingParlays();

    // Subscribe to changes
    const channel = supabase
      .channel('pending-parlays-live')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'suggested_parlays',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        fetchPendingParlays();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Auto-trigger sync when there are pending parlays
  useEffect(() => {
    if (pendingParlays.length > 0 && liveGames.length === 0) {
      triggerSync();
    }
  }, [pendingParlays.length]);

  // Detect if leg is a player prop vs game bet
  const isPlayerPropLeg = (leg: any): boolean => {
    const betType = (leg.betType || leg.bet_type || '').toLowerCase();
    const description = (leg.description || '').toLowerCase();
    const playerName = leg.playerName || leg.player_name || leg.player || '';
    
    // Has explicit player name
    if (playerName && playerName.length > 0) return true;
    
    // Bet type indicates player prop
    if (betType.includes('player')) return true;
    
    // Description contains player stat keywords
    const statKeywords = ['points', 'rebounds', 'assists', 'blocks', 'steals', 'threes', '3pm', 'pts', 'reb', 'ast'];
    return statKeywords.some(kw => description.includes(kw));
  };

  // Match parlays to live games
  const parlayProgress = useMemo((): ParlayLiveProgress[] => {
    return pendingParlays.map(parlay => {
      const legProgress: LegLiveProgress[] = parlay.legs.map((leg, index) => {
        const playerName = leg.playerName || leg.player_name || leg.player || '';
        const propType = leg.propType || leg.prop_type || leg.market || '';
        const line = parseFloat(leg.line) || 0;
        const side = ((leg.side || leg.pick || 'over').toLowerCase() || 'over') as 'over' | 'under';
        const description = leg.description || '';
        const betType = leg.betType || leg.bet_type || '';
        const isPlayerProp = isPlayerPropLeg(leg);

        // Find matching player in live games - prefer unified feed for projections
        let matchedStat: PlayerStat | null = null;
        let matchedGame: LiveGame | null = null;
        let unifiedPlayer: UnifiedPlayer | null = null;
        let unifiedGame: UnifiedGame | null = null;

        // Only try to match players for player prop bets
        if (isPlayerProp && playerName) {
          // First try unified feed for accurate projections
          const unifiedResult = findUnifiedPlayer(playerName);
          if (unifiedResult) {
            unifiedPlayer = unifiedResult.player;
            unifiedGame = unifiedResult.game;
          }
          
          // Also try live scores for fallback
          for (const game of games) {
            const playerStats = game.playerStats || [];
            for (const stat of playerStats) {
              if (stat.name && matchPlayerNames(playerName, stat.name)) {
                matchedStat = stat;
                matchedGame = game;
                break;
              }
            }
            if (matchedStat) break;
          }
        }

        // For non-player props (totals, spreads, ML), try to match by team name in description
        // IMPORTANT: Only match games of the same sport to avoid cross-sport matches
        if (!isPlayerProp && !matchedGame && description) {
          const descLower = description.toLowerCase();
          const legSport = (leg.sport || parlay.sport || '').toUpperCase();
          
          for (const game of games) {
            // Filter by sport first to avoid matching NBA bets to NFL games
            const gameSport = (game.sport || '').toUpperCase();
            if (legSport && gameSport && gameSport !== legSport) {
              continue;
            }
            
            const homeTeam = (game.homeTeam || '').toLowerCase();
            const awayTeam = (game.awayTeam || '').toLowerCase();
            
            // Get last word of team name (usually unique identifier like "Lakers", "Warriors")
            const homeWords = homeTeam.split(' ').filter(w => w.length > 3);
            const awayWords = awayTeam.split(' ').filter(w => w.length > 3);
            
            const matchesHome = homeWords.some(word => descLower.includes(word));
            const matchesAway = awayWords.some(word => descLower.includes(word));
            
            if (matchesHome || matchesAway) {
              matchedGame = game;
              break;
            }
          }
        }

        // Fallback: try to match by eventTime if available
        if (!matchedGame && leg.eventTime) {
          const eventTime = new Date(leg.eventTime);
          const legSport = (leg.sport || parlay.sport || '').toUpperCase();
          
          for (const game of games) {
            const gameSport = (game.sport || '').toUpperCase();
            if (legSport && gameSport && gameSport !== legSport) continue;
            
            // Match games within 30 minutes of event time
            const gameTime = new Date(game.startTime);
            const timeDiff = Math.abs(eventTime.getTime() - gameTime.getTime());
            if (timeDiff < 30 * 60 * 1000) {
              matchedGame = game;
              break;
            }
          }
        }

        // Use unified feed data if available, fallback to live scores
        let currentValue: number | null = null;
        let minutesPlayed = 0;
        let remainingMinutes = 0;
        let ratePerMinute = 0;
        let riskFlags: string[] = [];
        let confidence = 50;
        let projectedFinal: number | null = null;
        let trend: 'strengthening' | 'weakening' | 'stable' = 'stable';
        
        // Get projection from unified feed (preferred)
        const unifiedProjection = isPlayerProp && playerName 
          ? getPlayerProjection(playerName, propType) 
          : null;
        
        if (unifiedPlayer && unifiedProjection) {
          // Use unified feed data - more accurate projections
          currentValue = unifiedProjection.current;
          projectedFinal = unifiedProjection.projected;
          minutesPlayed = unifiedPlayer.minutesPlayed;
          remainingMinutes = unifiedPlayer.estimatedRemaining;
          ratePerMinute = unifiedProjection.ratePerMinute;
          confidence = unifiedProjection.confidence;
          riskFlags = unifiedPlayer.riskFlags;
          trend = unifiedProjection.trend === 'up' ? 'strengthening' : 
                  unifiedProjection.trend === 'down' ? 'weakening' : 'stable';
        } else if (matchedStat) {
          // Fallback to live scores data
          currentValue = getStatValue(matchedStat, propType);
          minutesPlayed = matchedStat?.minutes ? parseFloat(matchedStat.minutes.split(':')[0] || '0') : 0;
          
          const gameProgress = matchedGame ? 
            (matchedGame.status === 'in_progress' ? 
              Math.min(100, (parseInt(matchedGame.period) / 4) * 100) : 
              matchedGame.status === 'final' ? 100 : 0) : 0;
          
          remainingMinutes = gameProgress > 0 && gameProgress < 100 
            ? Math.max(0, (minutesPlayed / (gameProgress / 100)) - minutesPlayed)
            : 0;
          
          ratePerMinute = minutesPlayed > 0 && currentValue !== null 
            ? currentValue / minutesPlayed 
            : 0;
          
          projectedFinal = currentValue !== null && gameProgress > 0 && gameProgress < 100
            ? Math.round((currentValue + (ratePerMinute * remainingMinutes)) * 10) / 10
            : currentValue;
            
          // Detect risk flags from game state
          if (matchedGame) {
            const scoreDiff = Math.abs(matchedGame.homeScore - matchedGame.awayScore);
            const period = parseInt(matchedGame.period || '1');
            if (scoreDiff >= 15 && period >= 4) riskFlags.push('blowout');
            else if (scoreDiff >= 20 && period >= 3) riskFlags.push('blowout');
          }
          if ((matchedStat as any)?.fouls >= 4) riskFlags.push('foul_trouble');
          
          // Calculate confidence
          if (minutesPlayed > 0) confidence += Math.min(25, minutesPlayed);
          if (riskFlags.length > 0) confidence -= riskFlags.length * 10;
          confidence = Math.max(1, Math.min(99, confidence));
        }
        
        // Use unified game for game info if available
        const effectiveGame = unifiedGame || matchedGame;
        const gameProgress = unifiedGame?.gameProgress || (matchedGame ? 
          (matchedGame.status === 'in_progress' ? 
            Math.min(100, (parseInt(matchedGame.period) / 4) * 100) : 
            matchedGame.status === 'final' ? 100 : 0) : 0);

        const isHitting = currentValue !== null && (
          side === 'over' ? currentValue >= line : currentValue <= line
        );

        const isOnPace = projectedFinal !== null && (
          side === 'over' ? projectedFinal >= line : projectedFinal <= line
        );

        // Calculate pace percentage
        const pacePercentage = line > 0 && projectedFinal !== null
          ? Math.round((projectedFinal / line) * 100)
          : 100;

        return {
          legIndex: index,
          parlayId: parlay.id,
          playerName,
          propType,
          line,
          side,
          currentValue,
          gameProgress,
          gameStatus: normalizeGameStatus(unifiedGame?.status || matchedGame?.status),
          gameInfo: effectiveGame ? {
            homeTeam: effectiveGame.homeTeam,
            awayTeam: effectiveGame.awayTeam,
            homeScore: effectiveGame.homeScore,
            awayScore: effectiveGame.awayScore,
            period: String(effectiveGame.period || matchedGame?.period || '1'),
            clock: (effectiveGame as any).clock || matchedGame?.clock || '',
          } : null,
          isHitting,
          isOnPace,
          projectedFinal,
          eventId: unifiedGame?.eventId || matchedGame?.eventId || null,
          isPlayerProp,
          description,
          betType,
          sport: leg.sport || parlay.sport || '',
          matchup: leg.matchup,
          // Enhanced projection fields from unified feed
          confidence,
          riskFlags,
          trend,
          remainingMinutes,
          ratePerMinute,
          pacePercentage,
          minutesPlayed,
        };
      });

      const legsWithGames = legProgress.filter(l => l.gameStatus !== 'scheduled');
      const legsHitting = legProgress.filter(l => l.isHitting || l.isOnPace).length;
      const hasLiveGames = legsWithGames.some(l => l.gameStatus === 'in_progress');
      const allCompleted = legsWithGames.length === parlay.legs.length && 
        legsWithGames.every(l => l.gameStatus === 'final');

      let status: ParlayLiveProgress['status'] = 'upcoming';
      if (allCompleted) {
        status = 'completed';
      } else if (hasLiveGames) {
        const hittingRatio = legsHitting / parlay.legs.length;
        if (hittingRatio === 1) status = 'all_hitting';
        else if (hittingRatio >= 0.5) status = 'mixed';
        else status = 'busting';
      }

      return {
        parlayId: parlay.id,
        sport: parlay.sport,
        totalOdds: parlay.total_odds,
        legs: legProgress,
        legsHitting,
        legsTotal: parlay.legs.length,
        hasLiveGames,
        status,
      };
    });
  }, [pendingParlays, games]);

  const liveParlays = useMemo(() => 
    parlayProgress.filter(p => p.hasLiveGames),
    [parlayProgress]
  );

  const upcomingParlays = useMemo(() =>
    parlayProgress.filter(p => !p.hasLiveGames && p.status !== 'completed'),
    [parlayProgress]
  );

  return {
    parlayProgress,
    liveParlays,
    upcomingParlays,
    pendingParlays,
    liveGames,
    isLoading,
    isConnected,
    lastUpdated,
    triggerSync,
  };
}
