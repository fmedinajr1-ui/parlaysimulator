import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  ScoutAgentState, 
  PlayerLiveState, 
  PropEdge, 
  SceneClassification,
  LivePBPData,
  PropType,
  AgentLoopResponse,
  HalftimeLockState,
  HalftimeLockedProp,
  VisionSignal
} from '@/types/scout-agent';
import { GameContext } from '@/pages/Scout';
import { useToast } from '@/hooks/use-toast';

const NOTIFICATION_COOLDOWN_MS = 15000; // 15 seconds between same-player alerts
const FATIGUE_SLOPE_WINDOW = 5; // Number of updates to track for slope calculation

interface UseScoutAgentStateProps {
  gameContext: GameContext | null;
}

interface FatigueHistory {
  scores: number[];
  timestamps: number[];
}

export function useScoutAgentState({ gameContext }: UseScoutAgentStateProps) {
  const { toast } = useToast();
  const notificationCooldowns = useRef<Map<string, number>>(new Map());
  const fatigueHistory = useRef<Map<string, FatigueHistory>>(new Map());
  
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
    halftimeLock: {
      isLocked: false,
      lockedRecommendations: [],
    },
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
        onCourt: true,
        role,
        fatigueScore: 15,
        effortScore: 55,
        speedIndex: 65,
        reboundPositionScore: 50,
        minutesEstimate: 5,
        foulCount: 0,
        visualFlags: [],
        lastUpdated: 'Pre-game',
        sprintCount: 0,
        handsOnKneesCount: 0,
        slowRecoveryCount: 0,
        fatigueSlope: 0,
        boxScore: {
          points: 0,
          rebounds: 0,
          assists: 0,
          fouls: 0,
          fga: 0,
          fta: 0,
          turnovers: 0,
          threes: 0,
          steals: 0,
          blocks: 0,
        },
      });
      
      // Initialize fatigue history
      fatigueHistory.current.set(player.name, {
        scores: [15],
        timestamps: [Date.now()],
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

  // Calculate fatigue slope based on recent history
  const calculateFatigueSlope = useCallback((playerName: string, currentFatigue: number): number => {
    const history = fatigueHistory.current.get(playerName);
    if (!history || history.scores.length < 2) return 0;
    
    // Add current reading
    history.scores.push(currentFatigue);
    history.timestamps.push(Date.now());
    
    // Keep only last N readings
    while (history.scores.length > FATIGUE_SLOPE_WINDOW) {
      history.scores.shift();
      history.timestamps.shift();
    }
    
    // Calculate slope (change per minute)
    if (history.scores.length >= 2) {
      const firstScore = history.scores[0];
      const lastScore = history.scores[history.scores.length - 1];
      const timeDiffMinutes = (history.timestamps[history.timestamps.length - 1] - history.timestamps[0]) / 60000;
      
      if (timeDiffMinutes > 0) {
        return (lastScore - firstScore) / timeDiffMinutes;
      }
    }
    
    return 0;
  }, []);

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
            onCourt: pbpPlayer.minutes > 0,
            boxScore: {
              points: pbpPlayer.points,
              rebounds: pbpPlayer.rebounds,
              assists: pbpPlayer.assists,
              fouls: pbpPlayer.fouls,
              fga: pbpPlayer.fga,
              fta: pbpPlayer.fta,
              turnovers: 0,
              threes: pbpPlayer.threePm,
              steals: pbpPlayer.steals,
              blocks: pbpPlayer.blocks,
            },
          });
        }
      });

      // Check for halftime
      let halftimeLock = prev.halftimeLock;
      if (data.isHalftime && !prev.halftimeLock.isLocked) {
        console.log('[Scout Agent State] Halftime detected - triggering lock');
        halftimeLock = lockHalftimeState(updatedStates, prev.activePropEdges, data.gameTime);
      }

      return {
        ...prev,
        pbpData: data,
        playerStates: updatedStates,
        currentGameTime: data.gameTime,
        currentScore: `${data.homeTeam} ${data.homeScore} - ${data.awayTeam} ${data.awayScore}`,
        halftimeLock,
      };
    });
  }, []);

  // Generate halftime locked recommendations
  const lockHalftimeState = useCallback((
    playerStates: Map<string, PlayerLiveState>,
    propEdges: PropEdge[],
    gameTime: string
  ): HalftimeLockState => {
    const lockedRecommendations: HalftimeLockedProp[] = [];
    
    // Generate final verdicts for each player with active edges
    playerStates.forEach((player, name) => {
      if (player.minutesEstimate < 5) return;
      
      // Find existing edges for this player
      const playerEdges = propEdges.filter(e => e.player === name);
      
      // Generate locked recommendation based on fatigue trajectory
      const slope = player.fatigueSlope || 0;
      
      // Points recommendation
      if (player.role === 'PRIMARY' || player.role === 'SECONDARY') {
        const isFatigued = player.fatigueScore >= 40 || slope > 2;
        const isEnergized = player.fatigueScore < 25 && player.effortScore > 60;
        
        if (isFatigued || isEnergized) {
          const existingEdge = playerEdges.find(e => e.prop === 'Points');
          lockedRecommendations.push({
            mode: 'HALFTIME_LOCK',
            player: name,
            prop: 'Points',
            line: existingEdge?.line || 22.5,
            lean: isFatigued ? 'UNDER' : 'OVER',
            confidence: isFatigued 
              ? Math.min(90, 50 + player.fatigueScore * 0.5)
              : Math.min(85, 40 + player.effortScore * 0.4),
            expectedFinal: 0,
            drivers: [
              isFatigued ? `Fatigue: ${player.fatigueScore}/100 (slope: ${slope.toFixed(1)}/min)` : `Energy: ${player.effortScore}/100`,
              `Speed index: ${player.speedIndex}/100`,
              `Minutes: ${player.minutesEstimate.toFixed(1)}`,
            ],
            riskFlags: player.foulCount >= 3 ? ['foul_trouble'] : [],
            lockTime: gameTime,
            firstHalfStats: player.boxScore,
          });
        }
      }
      
      // Rebounds recommendation for bigs
      if (player.role === 'BIG') {
        const lowPositioning = player.reboundPositionScore < 50;
        const goodPositioning = player.reboundPositionScore > 70;
        
        if (lowPositioning || goodPositioning) {
          const existingEdge = playerEdges.find(e => e.prop === 'Rebounds');
          lockedRecommendations.push({
            mode: 'HALFTIME_LOCK',
            player: name,
            prop: 'Rebounds',
            line: existingEdge?.line || 10.5,
            lean: lowPositioning ? 'UNDER' : 'OVER',
            confidence: lowPositioning
              ? Math.min(85, 50 + (50 - player.reboundPositionScore) * 0.7)
              : Math.min(80, 40 + player.reboundPositionScore * 0.4),
            expectedFinal: 0,
            drivers: [
              `Rebound positioning: ${player.reboundPositionScore}/100`,
              player.fatigueScore > 40 ? `Fatigue affecting box-outs` : `Active on glass`,
            ],
            riskFlags: [],
            lockTime: gameTime,
            firstHalfStats: player.boxScore,
          });
        }
      }
    });
    
    console.log(`[Scout Agent State] Generated ${lockedRecommendations.length} halftime locked recommendations`);
    
    return {
      isLocked: true,
      lockTime: gameTime,
      lockTimestamp: Date.now(),
      lockedRecommendations,
    };
  }, []);

  const processAgentResponse = useCallback((response: AgentLoopResponse) => {
    console.log('[Scout Agent State] Processing response:', {
      sceneType: response.sceneClassification?.sceneType,
      isAnalysisWorthy: response.sceneClassification?.isAnalysisWorthy,
      visionSignals: response.visionSignals?.length || 0,
      propEdges: response.propEdges?.length || 0,
      isHalftime: response.isHalftime,
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
                const newFatigue = Math.min(100, existing.fatigueScore + signal.value);
                updates.fatigueScore = newFatigue;
                updates.fatigueSlope = calculateFatigueSlope(signal.player, newFatigue);
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
                  const newFatigue = Math.min(100, existing.fatigueScore + 4);
                  updates.fatigueScore = newFatigue;
                  updates.fatigueSlope = calculateFatigueSlope(signal.player, newFatigue);
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
            
            // Only change lean if we have consistent signals
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

      // Handle halftime lock from response
      let halftimeLock = prev.halftimeLock;
      if (response.isHalftime && !prev.halftimeLock.isLocked) {
        if (response.halftimeRecommendations && response.halftimeRecommendations.length > 0) {
          halftimeLock = {
            isLocked: true,
            lockTime: response.gameTime || prev.currentGameTime || 'Halftime',
            lockTimestamp: Date.now(),
            lockedRecommendations: response.halftimeRecommendations,
          };
          console.log('[Scout Agent State] Halftime lock engaged with', response.halftimeRecommendations.length, 'recommendations');
        } else {
          // Generate locally if not provided
          halftimeLock = lockHalftimeState(updatedPlayerStates, updatedPropEdges, response.gameTime || 'Halftime');
        }
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
        halftimeLock,
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
  }, [toast, calculateFatigueSlope, lockHalftimeState]);

  const getPlayerState = useCallback((playerName: string): PlayerLiveState | undefined => {
    return state.playerStates.get(playerName);
  }, [state.playerStates]);

  const getTopEdges = useCallback((limit: number = 5): PropEdge[] => {
    return [...state.activePropEdges]
      .filter(e => e.confidence >= 50)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }, [state.activePropEdges]);

  const getFatiguedPlayers = useCallback((threshold: number = 30): PlayerLiveState[] => {
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

  const getHalftimeRecommendations = useCallback((): HalftimeLockedProp[] => {
    return state.halftimeLock.lockedRecommendations;
  }, [state.halftimeLock.lockedRecommendations]);

  const isHalftimeLocked = useCallback((): boolean => {
    return state.halftimeLock.isLocked;
  }, [state.halftimeLock.isLocked]);

  // Reset halftime lock for second half
  const resetHalftimeLock = useCallback(() => {
    setState(prev => ({
      ...prev,
      halftimeLock: {
        isLocked: false,
        lockedRecommendations: [],
      },
    }));
  }, []);

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
    // V2: Halftime Lock
    getHalftimeRecommendations,
    isHalftimeLocked,
    resetHalftimeLock,
  };
}
