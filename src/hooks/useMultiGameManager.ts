import { useState, useCallback, useRef } from 'react';
import { 
  MultiGameState, 
  SingleGameState, 
  QueuedAlert, 
  PlayerLiveState,
  PropEdge,
  SceneClassification,
  AgentLoopResponse,
  HalftimeLockState,
  PropAlertNotification
} from '@/types/scout-agent';
import { GameContext } from '@/pages/Scout';
import { useToast } from '@/hooks/use-toast';

const ALERT_QUEUE_MAX = 20;
const ALERT_FIRE_INTERVAL_MS = 3000; // Minimum 3 seconds between alerts

export function useMultiGameManager() {
  const { toast } = useToast();
  const lastAlertTime = useRef<number>(0);
  
  const [state, setState] = useState<MultiGameState>({
    activeGames: new Map(),
    priorityGameIds: [],
    alertQueue: [],
    halftimeLocksReady: 0,
    totalFramesProcessed: 0,
  });

  // Add a new game to track
  const addGame = useCallback((gameContext: GameContext) => {
    const eventId = gameContext.eventId;
    
    setState(prev => {
      if (prev.activeGames.has(eventId)) {
        console.log(`[Multi-Game] Game ${eventId} already being tracked`);
        return prev;
      }
      
      const newGame: SingleGameState = {
        eventId,
        homeTeam: gameContext.homeTeam,
        awayTeam: gameContext.awayTeam,
        playerStates: initializePlayerStates(gameContext),
        propEdges: [],
        sceneHistory: [],
        halftimeLock: { isLocked: false, lockedRecommendations: [] },
        pbpData: null,
        priority: 50, // Default medium priority
        isActive: true,
        lastAnalysisTime: null,
        analysisCount: 0,
        framesProcessed: 0,
        commercialSkipCount: 0,
        currentGameTime: null,
        currentScore: null,
      };
      
      const updatedGames = new Map(prev.activeGames);
      updatedGames.set(eventId, newGame);
      
      console.log(`[Multi-Game] Added game: ${gameContext.awayTeam} @ ${gameContext.homeTeam}`);
      
      return {
        ...prev,
        activeGames: updatedGames,
      };
    });
  }, []);

  // Remove a game from tracking
  const removeGame = useCallback((eventId: string) => {
    setState(prev => {
      const updatedGames = new Map(prev.activeGames);
      updatedGames.delete(eventId);
      
      return {
        ...prev,
        activeGames: updatedGames,
        priorityGameIds: prev.priorityGameIds.filter(id => id !== eventId),
      };
    });
  }, []);

  // Set game priority (0-100)
  const prioritizeGame = useCallback((eventId: string, priority: number) => {
    setState(prev => {
      const game = prev.activeGames.get(eventId);
      if (!game) return prev;
      
      const updatedGames = new Map(prev.activeGames);
      updatedGames.set(eventId, { ...game, priority: Math.min(100, Math.max(0, priority)) });
      
      // Re-sort priority list
      const sortedIds = Array.from(updatedGames.entries())
        .sort((a, b) => b[1].priority - a[1].priority)
        .slice(0, 3) // Top 3 priority games
        .map(([id]) => id);
      
      return {
        ...prev,
        activeGames: updatedGames,
        priorityGameIds: sortedIds,
      };
    });
  }, []);

  // Process response for a specific game
  const processGameResponse = useCallback((eventId: string, response: AgentLoopResponse) => {
    setState(prev => {
      const game = prev.activeGames.get(eventId);
      if (!game) return prev;
      
      // Update scene history
      const newSceneHistory = [response.sceneClassification, ...game.sceneHistory.slice(0, 49)];
      
      // Update player states
      const updatedPlayerStates = new Map(game.playerStates);
      if (response.updatedPlayerStates) {
        Object.entries(response.updatedPlayerStates).forEach(([name, updates]) => {
          const existing = updatedPlayerStates.get(name);
          if (existing) {
            updatedPlayerStates.set(name, { ...existing, ...updates });
          }
        });
      }
      
      // Apply vision signals
      if (response.visionSignals) {
        response.visionSignals.forEach(signal => {
          const existing = updatedPlayerStates.get(signal.player);
          if (existing) {
            const updates: Partial<PlayerLiveState> = {
              lastUpdated: response.gameTime || game.currentGameTime || 'Unknown',
            };
            
            switch (signal.signalType) {
              case 'fatigue':
                updates.fatigueScore = Math.min(100, existing.fatigueScore + signal.value);
                break;
              case 'speed':
                updates.speedIndex = Math.max(0, Math.min(100, existing.speedIndex + signal.value));
                break;
              case 'effort':
                updates.effortScore = Math.max(0, Math.min(100, existing.effortScore + signal.value));
                break;
              case 'positioning':
                updates.reboundPositionScore = Math.max(0, Math.min(100, existing.reboundPositionScore + signal.value));
                break;
            }
            
            updatedPlayerStates.set(signal.player, { ...existing, ...updates });
          }
        });
      }
      
      // Merge prop edges
      let updatedPropEdges = [...game.propEdges];
      if (response.propEdges) {
        response.propEdges.forEach(newEdge => {
          const existingIdx = updatedPropEdges.findIndex(
            e => e.player === newEdge.player && e.prop === newEdge.prop
          );
          
          if (existingIdx >= 0) {
            const existing = updatedPropEdges[existingIdx];
            const smoothedConfidence = Math.round(existing.confidence * 0.3 + newEdge.confidence * 0.7);
            updatedPropEdges[existingIdx] = { ...newEdge, confidence: smoothedConfidence };
          } else {
            updatedPropEdges.push(newEdge);
          }
        });
      }
      
      // Handle halftime lock
      let halftimeLock = game.halftimeLock;
      if (response.isHalftime && !game.halftimeLock.isLocked && response.halftimeRecommendations) {
        halftimeLock = {
          isLocked: true,
          lockTime: response.gameTime || 'Halftime',
          lockTimestamp: Date.now(),
          lockedRecommendations: response.halftimeRecommendations,
        };
      }
      
      // Queue notification if warranted
      let updatedAlertQueue = [...prev.alertQueue];
      if (response.shouldNotify && response.notification) {
        const newAlert: QueuedAlert = {
          gameId: eventId,
          gameName: `${game.awayTeam} @ ${game.homeTeam}`,
          notification: {
            type: 'PROP_ALERT',
            ...response.notification,
          },
          confidence: response.notification.confidence,
          urgency: calculateUrgency(game, response.notification.confidence),
          timestamp: Date.now(),
        };
        
        // Insert sorted by urgency × confidence
        updatedAlertQueue.push(newAlert);
        updatedAlertQueue.sort((a, b) => (b.urgency * b.confidence) - (a.urgency * a.confidence));
        updatedAlertQueue = updatedAlertQueue.slice(0, ALERT_QUEUE_MAX);
      }
      
      const updatedGame: SingleGameState = {
        ...game,
        playerStates: updatedPlayerStates,
        propEdges: updatedPropEdges,
        sceneHistory: newSceneHistory,
        halftimeLock,
        framesProcessed: game.framesProcessed + 1,
        analysisCount: response.sceneClassification.isAnalysisWorthy 
          ? game.analysisCount + 1 
          : game.analysisCount,
        commercialSkipCount: !response.sceneClassification.isAnalysisWorthy
          ? game.commercialSkipCount + 1
          : game.commercialSkipCount,
        currentGameTime: response.gameTime || game.currentGameTime,
        currentScore: response.score || game.currentScore,
        lastAnalysisTime: new Date(),
      };
      
      const updatedGames = new Map(prev.activeGames);
      updatedGames.set(eventId, updatedGame);
      
      // Count halftime locks ready
      const halftimeLocksReady = Array.from(updatedGames.values())
        .filter(g => g.halftimeLock.isLocked)
        .length;
      
      return {
        ...prev,
        activeGames: updatedGames,
        alertQueue: updatedAlertQueue,
        halftimeLocksReady,
        totalFramesProcessed: prev.totalFramesProcessed + 1,
      };
    });
  }, []);

  // Fire the next alert in queue (respects cooldown)
  const fireNextAlert = useCallback(() => {
    const now = Date.now();
    if (now - lastAlertTime.current < ALERT_FIRE_INTERVAL_MS) {
      return; // Too soon
    }
    
    setState(prev => {
      if (prev.alertQueue.length === 0) return prev;
      
      const [nextAlert, ...remainingQueue] = prev.alertQueue;
      lastAlertTime.current = now;
      
      // Fire toast
      toast({
        title: `🎯 ${nextAlert.gameName}: ${nextAlert.notification.player}`,
        description: `${nextAlert.notification.prop} ${nextAlert.notification.lean} | ${nextAlert.confidence}%`,
      });
      
      return {
        ...prev,
        alertQueue: remainingQueue,
      };
    });
  }, [toast]);

  // Get game by ID
  const getGame = useCallback((eventId: string): SingleGameState | undefined => {
    return state.activeGames.get(eventId);
  }, [state.activeGames]);

  // Get all active games
  const getAllGames = useCallback((): SingleGameState[] => {
    return Array.from(state.activeGames.values());
  }, [state.activeGames]);

  // Get priority games
  const getPriorityGames = useCallback((): SingleGameState[] => {
    return state.priorityGameIds
      .map(id => state.activeGames.get(id))
      .filter((g): g is SingleGameState => g !== undefined);
  }, [state.priorityGameIds, state.activeGames]);

  // Get global stats
  const getGlobalStats = useCallback(() => ({
    activeGames: state.activeGames.size,
    priorityGames: state.priorityGameIds.length,
    alertsQueued: state.alertQueue.length,
    halftimeLocksReady: state.halftimeLocksReady,
    totalFramesProcessed: state.totalFramesProcessed,
  }), [state]);

  return {
    state,
    addGame,
    removeGame,
    prioritizeGame,
    processGameResponse,
    fireNextAlert,
    getGame,
    getAllGames,
    getPriorityGames,
    getGlobalStats,
  };
}

// Helper: Initialize player states from game context
function initializePlayerStates(context: GameContext): Map<string, PlayerLiveState> {
  const states = new Map<string, PlayerLiveState>();
  
  const initPlayer = (player: { name: string; jersey: string; position: string }, team: string) => {
    const pos = player.position.toLowerCase();
    const role: PlayerLiveState['role'] = 
      pos.includes('c') || pos.includes('pf') ? 'BIG' :
      pos.includes('pg') || pos.includes('sg') ? 'SECONDARY' : 'SPACER';
    
    // Find pre-game baseline for this player if available
    const baseline = context.preGameBaselines?.find(
      b => b.playerName.toLowerCase() === player.name.toLowerCase()
    );
    
    // Derive pre-game rotation role from baseline minutes estimate
    const minutesEstimate = baseline?.minutesEstimate ?? 25;
    const preGameRotationRole: 'STARTER' | 'CLOSER' | 'BENCH_CORE' | 'BENCH_FRINGE' = 
      baseline?.rotationRole ?? (
        minutesEstimate >= 28 ? 'STARTER' :
        minutesEstimate >= 12 ? 'BENCH_CORE' : 'BENCH_FRINGE'
      );
    
    states.set(player.name, {
      playerName: player.name,
      jersey: player.jersey,
      team,
      onCourt: true,
      role,
      fatigueScore: baseline?.fatigueScore ?? 15,
      effortScore: baseline?.effortScore ?? 55,
      speedIndex: baseline?.speedIndex ?? 65,
      reboundPositionScore: 50,
      minutesEstimate,
      foulCount: 0,
      visualFlags: [],
      lastUpdated: 'Pre-game',
      sprintCount: 0,
      handsOnKneesCount: 0,
      slowRecoveryCount: 0,
      // Initialize rotation state with pre-game role (critical for Lock Mode)
      rotation: {
        stintSeconds: 0,
        benchSecondsLast8: 0,
        onCourtStability: preGameRotationRole === 'STARTER' ? 0.90 : 0.65,
        projectedStintsRemaining: 3,
        foulRiskLevel: 'LOW',
        rotationRole: preGameRotationRole,
      },
    });
  };
  
  context.homeRoster.forEach(p => initPlayer(p, context.homeTeam));
  context.awayRoster.forEach(p => initPlayer(p, context.awayTeam));
  
  return states;
}

// Helper: Calculate urgency based on game state
function calculateUrgency(game: SingleGameState, confidence: number): number {
  let urgency = 50;
  
  // Boost for halftime approaching (Q2 with < 3 mins)
  if (game.currentGameTime?.includes('Q2') && game.currentGameTime.includes(':')) {
    const mins = parseInt(game.currentGameTime.split(':')[0].replace('Q2 ', ''));
    if (mins <= 3) urgency += 20;
  }
  
  // Boost for high priority games
  if (game.priority > 70) urgency += 15;
  
  // Boost for high confidence
  if (confidence > 80) urgency += 10;
  
  return Math.min(100, urgency);
}
