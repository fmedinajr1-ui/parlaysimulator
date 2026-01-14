import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  ScoutAgentState, 
  PlayerLiveState, 
  PropEdge, 
  SceneClassification,
  LivePBPData,
  PropType,
  AgentLoopResponse
} from '@/types/scout-agent';
import { GameContext } from '@/pages/Scout';
import { useToast } from '@/hooks/use-toast';

const NOTIFICATION_COOLDOWN_MS = 15000; // 15 seconds between same-player alerts

interface UseScoutAgentStateProps {
  gameContext: GameContext | null;
}

export function useScoutAgentState({ gameContext }: UseScoutAgentStateProps) {
  const { toast } = useToast();
  const notificationCooldowns = useRef<Map<string, number>>(new Map());
  
  const [state, setState] = useState<ScoutAgentState>({
    isRunning: false,
    isPaused: false,
    captureRate: 2, // 2 FPS default
    gameContext: gameContext ? {
      eventId: gameContext.eventId,
      homeTeam: gameContext.homeTeam,
      awayTeam: gameContext.awayTeam,
      homeRoster: gameContext.homeRoster,
      awayRoster: gameContext.awayRoster,
    } : null,
    playerStates: new Map(),
    activePropEdges: [],
    sceneHistory: [],
    pbpData: null,
    lastAnalysisTime: null,
    analysisCount: 0,
    framesProcessed: 0,
    commercialSkipCount: 0,
    currentGameTime: null,
    currentScore: null,
  });

  // Update game context when it changes
  useEffect(() => {
    if (gameContext) {
      setState(prev => ({
        ...prev,
        gameContext: {
          eventId: gameContext.eventId,
          homeTeam: gameContext.homeTeam,
          awayTeam: gameContext.awayTeam,
          homeRoster: gameContext.homeRoster,
          awayRoster: gameContext.awayRoster,
        },
      }));
      
      // Initialize player states from rosters
      initializePlayerStates(gameContext);
    }
  }, [gameContext?.eventId]);

  const initializePlayerStates = useCallback((context: GameContext) => {
    const newStates = new Map<string, PlayerLiveState>();
    
    const initPlayer = (player: { name: string; jersey: string; position: string }, team: string) => {
      const role = getInitialRole(player.position);
      newStates.set(player.name, {
        playerName: player.name,
        jersey: player.jersey,
        team,
        onCourt: true, // Start as on-court so they show up initially
        role,
        fatigueScore: 15, // Start with some baseline fatigue
        effortScore: 55,
        speedIndex: 65,
        reboundPositionScore: 50,
        minutesEstimate: 5, // Assume they've played some minutes
        foulCount: 0,
        visualFlags: [],
        lastUpdated: 'Pre-game',
        sprintCount: 0,
        handsOnKneesCount: 0,
        slowRecoveryCount: 0,
      });
    };

    context.homeRoster.forEach(p => initPlayer(p, context.homeTeam));
    context.awayRoster.forEach(p => initPlayer(p, context.awayTeam));
    
    console.log(`[Scout Agent State] Initialized ${newStates.size} players from rosters`);
    setState(prev => ({ ...prev, playerStates: newStates }));
  }, []);

  const getInitialRole = (position: string): PlayerLiveState['role'] => {
    const pos = position.toLowerCase();
    if (pos.includes('c') || pos.includes('pf')) return 'BIG';
    if (pos.includes('pg') || pos.includes('sg')) return 'SECONDARY';
    return 'SPACER';
  };

  const startAgent = useCallback(() => {
    setState(prev => ({ ...prev, isRunning: true, isPaused: false }));
    toast({
      title: "🤖 Scout Autopilot Active",
      description: "Autonomous monitoring started",
    });
  }, [toast]);

  const stopAgent = useCallback(() => {
    setState(prev => ({ ...prev, isRunning: false, isPaused: false }));
    toast({
      title: "Scout Autopilot Stopped",
      description: `Processed ${state.framesProcessed} frames, ${state.analysisCount} analyses`,
    });
  }, [toast, state.framesProcessed, state.analysisCount]);

  const pauseAgent = useCallback(() => {
    setState(prev => ({ ...prev, isPaused: true }));
  }, []);

  const resumeAgent = useCallback(() => {
    setState(prev => ({ ...prev, isPaused: false }));
  }, []);

  const setCaptureRate = useCallback((rate: number) => {
    setState(prev => ({ ...prev, captureRate: Math.min(5, Math.max(1, rate)) }));
  }, []);

  const updatePBPData = useCallback((data: LivePBPData) => {
    setState(prev => {
      // Update player states with PBP stats
      const updatedStates = new Map(prev.playerStates);
      
      data.players.forEach(pbpPlayer => {
        const existingState = updatedStates.get(pbpPlayer.playerName);
        if (existingState) {
          updatedStates.set(pbpPlayer.playerName, {
            ...existingState,
            minutesEstimate: pbpPlayer.minutes,
            foulCount: pbpPlayer.fouls,
            onCourt: pbpPlayer.minutes > 0, // Rough estimate
          });
        }
      });

      return {
        ...prev,
        pbpData: data,
        playerStates: updatedStates,
        currentGameTime: data.gameTime,
        currentScore: `${data.homeTeam} ${data.homeScore} - ${data.awayTeam} ${data.awayScore}`,
      };
    });
  }, []);

  const processAgentResponse = useCallback((response: AgentLoopResponse) => {
    console.log('[Scout Agent State] Processing response:', {
      sceneType: response.sceneClassification?.sceneType,
      isAnalysisWorthy: response.sceneClassification?.isAnalysisWorthy,
      visionSignals: response.visionSignals?.length || 0,
      propEdges: response.propEdges?.length || 0,
    });
    
    setState(prev => {
      const newSceneHistory = [response.sceneClassification, ...prev.sceneHistory.slice(0, 49)];
      let newCommercialSkipCount = prev.commercialSkipCount;
      
      // Track commercial skips
      if (!response.sceneClassification.isAnalysisWorthy) {
        newCommercialSkipCount++;
      }

      // Update player states if provided
      const updatedPlayerStates = new Map(prev.playerStates);
      if (response.updatedPlayerStates) {
        Object.entries(response.updatedPlayerStates).forEach(([name, updates]) => {
          const existing = updatedPlayerStates.get(name);
          if (existing) {
            updatedPlayerStates.set(name, { ...existing, ...updates });
          }
        });
      }

      // Apply vision signals to player states
      if (response.visionSignals && response.visionSignals.length > 0) {
        console.log('[Scout Agent State] Applying vision signals:', response.visionSignals);
        response.visionSignals.forEach(signal => {
          const existing = updatedPlayerStates.get(signal.player);
          if (existing) {
            const updates: Partial<PlayerLiveState> = {
              lastUpdated: response.gameTime || prev.currentGameTime || 'Unknown',
            };

            switch (signal.signalType) {
              case 'fatigue':
                updates.fatigueScore = Math.min(100, existing.fatigueScore + signal.value);
                updates.visualFlags = [...existing.visualFlags.slice(-4), signal.observation];
                if (signal.observation.toLowerCase().includes('hands on knees')) {
                  updates.handsOnKneesCount = existing.handsOnKneesCount + 1;
                }
                break;
              case 'speed':
                updates.speedIndex = Math.max(0, Math.min(100, existing.speedIndex + signal.value));
                break;
              case 'effort':
                updates.effortScore = Math.max(0, Math.min(100, existing.effortScore + signal.value));
                if (signal.observation.toLowerCase().includes('sprint')) {
                  updates.sprintCount = existing.sprintCount + 1;
                  updates.fatigueScore = Math.min(100, existing.fatigueScore + 4);
                }
                break;
              case 'positioning':
                updates.reboundPositionScore = Math.max(0, Math.min(100, existing.reboundPositionScore + signal.value));
                break;
            }

            updatedPlayerStates.set(signal.player, { ...existing, ...updates });
          }
        });
      }

      // Merge prop edges with confidence smoothing
      let updatedPropEdges = [...prev.activePropEdges];
      if (response.propEdges) {
        response.propEdges.forEach(newEdge => {
          const existingIdx = updatedPropEdges.findIndex(
            e => e.player === newEdge.player && e.prop === newEdge.prop
          );
          
          if (existingIdx >= 0) {
            const existing = updatedPropEdges[existingIdx];
            // Apply exponential moving average for confidence smoothing
            const smoothedConfidence = Math.round(existing.confidence * 0.3 + newEdge.confidence * 0.7);
            
            // Only change lean if we have 3+ consistent signals
            const sameLean = existing.lean === newEdge.lean;
            const newTrend = sameLean && newEdge.confidence > existing.confidence
              ? 'strengthening'
              : sameLean && newEdge.confidence < existing.confidence
              ? 'weakening'
              : 'stable';

            updatedPropEdges[existingIdx] = {
              ...newEdge,
              confidence: smoothedConfidence,
              trend: newTrend,
            };
          } else {
            updatedPropEdges.push(newEdge);
          }
        });
      }

      return {
        ...prev,
        sceneHistory: newSceneHistory,
        playerStates: updatedPlayerStates,
        activePropEdges: updatedPropEdges,
        analysisCount: response.sceneClassification.isAnalysisWorthy 
          ? prev.analysisCount + 1 
          : prev.analysisCount,
        framesProcessed: prev.framesProcessed + 1,
        commercialSkipCount: newCommercialSkipCount,
        currentGameTime: response.gameTime || prev.currentGameTime,
        currentScore: response.score || prev.currentScore,
        lastAnalysisTime: new Date(),
      };
    });

    // Handle notifications
    if (response.shouldNotify && response.notification) {
      const notif = response.notification;
      const cooldownKey = `${notif.player}-${notif.prop}`;
      const lastNotified = notificationCooldowns.current.get(cooldownKey) || 0;
      const now = Date.now();

      if (now - lastNotified > NOTIFICATION_COOLDOWN_MS) {
        notificationCooldowns.current.set(cooldownKey, now);
        
        toast({
          title: `🎯 PROP ALERT: ${notif.player}`,
          description: `${notif.prop} ${notif.lean} | Conf: ${notif.confidence}%`,
        });
      }
    }
  }, [toast]);

  const getPlayerState = useCallback((playerName: string): PlayerLiveState | undefined => {
    return state.playerStates.get(playerName);
  }, [state.playerStates]);

  const getTopEdges = useCallback((limit: number = 5): PropEdge[] => {
    // LOWERED: Show edges with confidence >= 50 (was 70)
    return [...state.activePropEdges]
      .filter(e => e.confidence >= 50)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }, [state.activePropEdges]);

  const getFatiguedPlayers = useCallback((threshold: number = 30): PlayerLiveState[] => {
    // LOWERED: Default threshold is 30 (was 60)
    return Array.from(state.playerStates.values())
      .filter(p => p.fatigueScore >= threshold && (p.onCourt || p.minutesEstimate > 0))
      .sort((a, b) => b.fatigueScore - a.fatigueScore);
  }, [state.playerStates]);

  const getStateForAPI = useCallback((): Record<string, PlayerLiveState> => {
    const obj: Record<string, PlayerLiveState> = {};
    state.playerStates.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }, [state.playerStates]);

  return {
    state,
    startAgent,
    stopAgent,
    pauseAgent,
    resumeAgent,
    setCaptureRate,
    updatePBPData,
    processAgentResponse,
    getPlayerState,
    getTopEdges,
    getFatiguedPlayers,
    getStateForAPI,
  };
}
