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
  VisionSignal,
  TeamLiveState,
  GameBetEdge,
  QuarterSnapshotStatus
} from '@/types/scout-agent';
import { GameContext } from '@/pages/Scout';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { parseGameMinutes, type ProjectionSnapshot, PROJECTION_MILESTONES } from '@/components/scout/ProjectionMilestone';

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
    lastBreakRefreshTime: null, // V8: Commercial/timeout refresh debounce
    gameContext: gameContext ? {
      eventId: gameContext.eventId,
      homeTeam: gameContext.homeTeam,
      awayTeam: gameContext.awayTeam,
      homeRoster: gameContext.homeRoster,
      awayRoster: gameContext.awayRoster,
      propLines: gameContext.propLines,
      preGameBaselines: gameContext.preGameBaselines,
      homeTeamFatigue: gameContext.homeTeamFatigue,
      awayTeamFatigue: gameContext.awayTeamFatigue,
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

  // Projection milestone tracking
  const [lastProjectionMilestone, setLastProjectionMilestone] = useState(0);
  const [projectionSnapshots, setProjectionSnapshots] = useState<ProjectionSnapshot[]>([]);
  const [currentGameMinute, setCurrentGameMinute] = useState(0);
  
  // Team-level state for game bets
  const [homeTeamState, setHomeTeamState] = useState<TeamLiveState | null>(null);
  const [awayTeamState, setAwayTeamState] = useState<TeamLiveState | null>(null);
  const [gameBetEdges, setGameBetEdges] = useState<GameBetEdge[]>([]);
  
  // PBP freshness tracking
  const [lastPbpUpdate, setLastPbpUpdate] = useState<Date | null>(null);
  const [lastPbpGameTime, setLastPbpGameTime] = useState<string | null>(null);
  
  // Quarter snapshot tracking
  const [quarterSnapshots, setQuarterSnapshots] = useState<QuarterSnapshotStatus[]>([
    { quarter: 1, recorded: false, playersRecorded: 0 },
    { quarter: 2, recorded: false, playersRecorded: 0 },
    { quarter: 3, recorded: false, playersRecorded: 0 },
    { quarter: 4, recorded: false, playersRecorded: 0 },
  ]);
  const quarterSnapshotTriggered = useRef<Set<number>>(new Set());
  
  // Session persistence
  const [sessionRestored, setSessionRestored] = useState(false);
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Save session to database
  const saveSession = useCallback(async () => {
    if (!state.gameContext?.eventId) return;
    
    // Convert Map to plain object for JSON storage
    const playerStatesObj: Record<string, PlayerLiveState> = {};
    state.playerStates.forEach((value, key) => {
      playerStatesObj[key] = value;
    });
    
    try {
      // Use raw SQL-style upsert since types may not be fully synced
      const sessionData = {
        event_id: state.gameContext.eventId,
        home_team: state.gameContext.homeTeam,
        away_team: state.gameContext.awayTeam,
        player_states: playerStatesObj,
        prop_edges: state.activePropEdges,
        projection_snapshots: projectionSnapshots,
        halftime_lock: state.halftimeLock,
        pbp_data: state.pbpData,
        current_game_time: state.currentGameTime,
        current_score: state.currentScore,
        frames_processed: state.framesProcessed,
        analysis_count: state.analysisCount,
        commercial_skip_count: state.commercialSkipCount,
        last_updated_at: new Date().toISOString(),
      };
      
      const { error } = await supabase
        .from('scout_sessions')
        .upsert(sessionData as any, { onConflict: 'event_id' });
      
      if (error) {
        console.error('[Scout Session] Save error:', error);
      } else {
        console.log('[Scout Session] Saved successfully');
      }
    } catch (err) {
      console.error('[Scout Session] Save exception:', err);
    }
  }, [state, projectionSnapshots]);

  // Load existing session from database
  const loadExistingSession = useCallback(async (eventId: string): Promise<boolean> => {
    try {
      const { data: session, error } = await supabase
        .from('scout_sessions')
        .select('*')
        .eq('event_id', eventId)
        .maybeSingle();
      
      if (error) {
        console.error('[Scout Session] Load error:', error);
        return false;
      }
      
      if (session && session.player_states) {
        const lastUpdated = new Date(session.last_updated_at);
        const hoursSince = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60);
        
        if (hoursSince < 4) { // Within 4 hours
          console.log('[Scout Session] Restoring previous session from', session.current_game_time || 'unknown time');
          
          // Convert plain object back to Map with proper typing
          const playerStatesData = session.player_states as unknown as Record<string, PlayerLiveState>;
          const restoredStates = new Map<string, PlayerLiveState>(
            Object.entries(playerStatesData || {})
          );
          
          setState(prev => ({
            ...prev,
            playerStates: restoredStates,
            activePropEdges: (session.prop_edges as unknown as PropEdge[]) || [],
            halftimeLock: (session.halftime_lock as unknown as HalftimeLockState) || { isLocked: false, lockedRecommendations: [] },
            pbpData: (session.pbp_data as unknown as LivePBPData) || null,
            currentGameTime: session.current_game_time,
            currentScore: session.current_score,
            framesProcessed: session.frames_processed || 0,
            analysisCount: session.analysis_count || 0,
            commercialSkipCount: session.commercial_skip_count || 0,
          }));
          
          setProjectionSnapshots((session.projection_snapshots as unknown as ProjectionSnapshot[]) || []);
          setSessionRestored(true);
          
          toast({
            title: "Session Restored",
            description: `Resumed from ${session.current_game_time || 'previous state'} with ${session.analysis_count || 0} analyses`,
          });
          
          return true;
        } else {
          console.log('[Scout Session] Session too old (', hoursSince.toFixed(1), 'hours), starting fresh');
        }
      }
      return false;
    } catch (err) {
      console.error('[Scout Session] Load exception:', err);
      return false;
    }
  }, [toast]);

  // Clear session and start fresh
  const clearSession = useCallback(async () => {
    if (!gameContext?.eventId) return;
    
    try {
      await supabase
        .from('scout_sessions')
        .delete()
        .eq('event_id', gameContext.eventId);
      
      setSessionRestored(false);
      initializePlayerStates(gameContext);
      setProjectionSnapshots([]);
      setLastProjectionMilestone(0);
      setCurrentGameMinute(0);
      
      setState(prev => ({
        ...prev,
        activePropEdges: [],
        halftimeLock: { isLocked: false, lockedRecommendations: [] },
        framesProcessed: 0,
        analysisCount: 0,
        commercialSkipCount: 0,
        currentGameTime: null,
        currentScore: null,
      }));
      
      toast({
        title: "Session Cleared",
        description: "Starting fresh tracking",
      });
    } catch (err) {
      console.error('[Scout Session] Clear error:', err);
    }
  }, [gameContext, toast]);

  // Auto-save interval while running
  useEffect(() => {
    if (state.isRunning && state.gameContext?.eventId && state.analysisCount > 0) {
      saveIntervalRef.current = setInterval(saveSession, 10000); // Every 10s
      return () => {
        if (saveIntervalRef.current) clearInterval(saveIntervalRef.current);
      };
    }
  }, [state.isRunning, state.gameContext?.eventId, state.analysisCount, saveSession]);

  // Save on pause/stop
  useEffect(() => {
    if (!state.isRunning && state.analysisCount > 0 && state.gameContext?.eventId) {
      saveSession();
    }
  }, [state.isRunning, state.analysisCount, state.gameContext?.eventId, saveSession]);

  // Update game context when it changes
  useEffect(() => {
    if (gameContext) {
      // Try to load existing session first
      loadExistingSession(gameContext.eventId).then(restored => {
        if (!restored) {
          // Initialize fresh if no session found
          initializePlayerStates(gameContext);
          setLastProjectionMilestone(0);
          setProjectionSnapshots([]);
          setCurrentGameMinute(0);
          setSessionRestored(false);
        }
      });
      
      setState(prev => ({
        ...prev,
        gameContext: {
          eventId: gameContext.eventId,
          homeTeam: gameContext.homeTeam,
          awayTeam: gameContext.awayTeam,
          homeRoster: gameContext.homeRoster,
          awayRoster: gameContext.awayRoster,
          propLines: gameContext.propLines,
          preGameBaselines: gameContext.preGameBaselines,
          homeTeamFatigue: gameContext.homeTeamFatigue,
          awayTeamFatigue: gameContext.awayTeamFatigue,
        },
      }));
    }
  }, [gameContext?.eventId, loadExistingSession]);

  const initializePlayerStates = useCallback((context: GameContext) => {
    const newStates = new Map<string, PlayerLiveState>();
    
    const initPlayer = (player: { name: string; jersey: string; position: string; injuryStatus?: 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'GTD' | 'DTD' | null; injuryDetail?: string }, team: string) => {
      const role = getInitialRole(player.position);
      
      // Find pre-game baseline for this player
      const baseline = context.preGameBaselines?.find(
        b => b.playerName.toLowerCase() === player.name.toLowerCase()
      );
      
      newStates.set(player.name, {
        playerName: player.name,
        jersey: player.jersey,
        team,
        onCourt: !player.injuryStatus || player.injuryStatus !== 'OUT', // If OUT, not on court
        role,
        // Use pre-game baselines if available, otherwise defaults
        fatigueScore: baseline?.fatigueScore ?? 15,
        effortScore: baseline?.effortScore ?? 55,
        speedIndex: baseline?.speedIndex ?? 65,
        reboundPositionScore: 50,
        minutesEstimate: baseline?.minutesEstimate ?? 25,
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
        // Store baseline metadata for UI
        preGameTrend: baseline?.trend,
        preGameConsistency: baseline?.consistency,
        // Injury status from ESPN
        injuryStatus: player.injuryStatus,
        injuryDetail: player.injuryDetail,
      });
      
      // Initialize fatigue history with baseline
      fatigueHistory.current.set(player.name, {
        scores: [baseline?.fatigueScore ?? 15],
        timestamps: [Date.now()],
      });
    };

    context.homeRoster.forEach(p => initPlayer(p, context.homeTeam));
    context.awayRoster.forEach(p => initPlayer(p, context.awayTeam));
    
    console.log(`[Scout Agent State] Initialized ${newStates.size} players from rosters with pre-game baselines`);
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

  // Track last period for auto-suggest triggers
  const lastPeriodRef = useRef(1);

  // Record quarter snapshot to database
  const recordQuarterSnapshot = useCallback(async (
    quarter: number,
    playerStates: Map<string, PlayerLiveState>,
    pbpData: LivePBPData
  ) => {
    if (!state.gameContext?.eventId) return;
    
    // Prevent duplicate triggers for same quarter
    if (quarterSnapshotTriggered.current.has(quarter)) {
      console.log(`[Quarter Snapshot] Q${quarter} already triggered, skipping`);
      return;
    }
    quarterSnapshotTriggered.current.add(quarter);
    
    console.log(`[Quarter Snapshot] Recording Q${quarter} snapshot...`);
    
    try {
      const { data, error } = await supabase.functions.invoke('record-quarter-snapshot', {
        body: {
          eventId: state.gameContext.eventId,
          espnEventId: (state.gameContext as any).espnEventId,
          quarter,
          gameTime: pbpData.gameTime,
          playerStates: Object.fromEntries(playerStates),
          pbpPlayers: pbpData.players,
        },
      });
      
      if (error) {
        console.error(`[Quarter Snapshot] Q${quarter} recording failed:`, error);
        quarterSnapshotTriggered.current.delete(quarter); // Allow retry
        return;
      }
      
      // Update snapshot status
      setQuarterSnapshots(prev => prev.map(s => 
        s.quarter === quarter 
          ? { ...s, recorded: true, playersRecorded: data.playersRecorded, capturedAt: data.capturedAt }
          : s
      ));
      
      toast({
        title: `📊 Q${quarter} Snapshot Recorded`,
        description: `${data.playersRecorded} players captured at ${pbpData.gameTime}`,
      });
      
      console.log(`[Quarter Snapshot] Q${quarter} recorded: ${data.playersRecorded} players`);
    } catch (err) {
      console.error(`[Quarter Snapshot] Q${quarter} exception:`, err);
      quarterSnapshotTriggered.current.delete(quarter); // Allow retry
    }
  }, [state.gameContext, toast]);

  const updatePBPData = useCallback((data: LivePBPData) => {
    // Check for quarter endings and trigger snapshots BEFORE state update
    if (data.isQ1Ending) {
      recordQuarterSnapshot(1, state.playerStates, data);
    }
    if (data.isQ2Ending || data.isHalftime) {
      recordQuarterSnapshot(2, state.playerStates, data);
    }
    if (data.isQ3Ending) {
      recordQuarterSnapshot(3, state.playerStates, data);
    }
    if (data.isQ4Ending || data.isGameOver) {
      recordQuarterSnapshot(4, state.playerStates, data);
    }
    
    setState(prev => {
      // Update player states with PBP stats
      const updatedStates = new Map(prev.playerStates);
      
      data.players.forEach(pbpPlayer => {
        const existingState = updatedStates.get(pbpPlayer.playerName);
        if (existingState) {
          updatedStates.set(pbpPlayer.playerName, {
            ...existingState,
            // DO NOT overwrite minutesEstimate - that's the expected TOTAL minutes (pre-game baseline)
            // The current minutes played comes from pbpPlayer.minutes and is sent to edge function via pbpData
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

      // Check for halftime via ESPN flag
      let halftimeLock = prev.halftimeLock;
      if (data.isHalftime && !prev.halftimeLock.isLocked) {
        console.log('[Scout Agent State] Halftime detected via ESPN - triggering lock');
        // Generate inline lock since lockHalftimeState is defined later
        halftimeLock = generateInlineHalftimeLock(updatedStates, prev.activePropEdges, data.gameTime);
      }
      
      // Detect Q3 start for auto-suggest (period changed from 2 to 3)
      const currentPeriod = data.period;
      const lastPeriod = lastPeriodRef.current;
      
      if (currentPeriod === 3 && lastPeriod === 2 && !halftimeLock.isLocked) {
        console.log('[Scout Agent State] Q3 started - auto-generating halftime bets');
        halftimeLock = generateInlineHalftimeLock(updatedStates, prev.activePropEdges, data.gameTime);
      }
      
      // Update last period ref
      lastPeriodRef.current = currentPeriod;

      return {
        ...prev,
        pbpData: data,
        playerStates: updatedStates,
        currentGameTime: data.gameTime,
        currentScore: `${data.homeTeam} ${data.homeScore} - ${data.awayTeam} ${data.awayScore}`,
        halftimeLock,
      };
    });
  }, [state.playerStates, recordQuarterSnapshot]);
  
  // Inline halftime lock generator (to avoid forward reference issues)
  const generateInlineHalftimeLock = (
    playerStates: Map<string, PlayerLiveState>,
    propEdges: PropEdge[],
    gameTime: string
  ): HalftimeLockState => {
    const lockedRecommendations: HalftimeLockedProp[] = [];
    
    playerStates.forEach((player, name) => {
      if (player.minutesEstimate < 5) return;
      
      const playerEdges = propEdges.filter(e => e.player === name);
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
            expectedFinal: existingEdge?.expectedFinal || 0,
            drivers: [
              isFatigued ? `Fatigue: ${player.fatigueScore}/100 (slope: ${slope.toFixed(1)}/min)` : `Energy: ${player.effortScore}/100`,
              `Speed index: ${player.speedIndex}/100`,
            ],
            riskFlags: player.foulCount >= 3 ? ['foul_trouble'] : [],
            lockTime: gameTime,
            firstHalfStats: player.boxScore,
            overPrice: existingEdge?.overPrice,
            underPrice: existingEdge?.underPrice,
            bookmaker: existingEdge?.bookmaker,
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
            expectedFinal: existingEdge?.expectedFinal || 0,
            drivers: [
              `Rebound positioning: ${player.reboundPositionScore}/100`,
              player.fatigueScore > 40 ? `Fatigue affecting box-outs` : `Active on glass`,
            ],
            riskFlags: [],
            lockTime: gameTime,
            firstHalfStats: player.boxScore,
            overPrice: existingEdge?.overPrice,
            underPrice: existingEdge?.underPrice,
            bookmaker: existingEdge?.bookmaker,
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
  };

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

      // PHASE 4 ENHANCEMENT: Apply vision signals to player states with improved counter population
      if (response.visionSignals && response.visionSignals.length > 0) {
        console.log('[Scout Agent State] Applying vision signals:', response.visionSignals.length, 'signals');
        response.visionSignals.forEach(signal => {
          const existing = updatedPlayerStates.get(signal.player);
          if (existing) {
            const updates: Partial<PlayerLiveState> = {
              lastUpdated: response.gameTime || prev.currentGameTime || 'Unknown',
            };
            
            const observation = signal.observation?.toLowerCase() || '';

            switch (signal.signalType) {
              case 'fatigue':
                const newFatigue = Math.min(100, existing.fatigueScore + signal.value);
                updates.fatigueScore = newFatigue;
                updates.fatigueSlope = calculateFatigueSlope(signal.player, newFatigue);
                updates.visualFlags = [...existing.visualFlags.slice(-4), signal.observation];
                
                // PHASE 4: Populate handsOnKneesCount from observation
                if (observation.includes('hands on knees') || observation.includes('bent over')) {
                  updates.handsOnKneesCount = (existing.handsOnKneesCount || 0) + 1;
                  console.log(`[Scout Agent State] 🦵 ${signal.player}: handsOnKneesCount++ (now ${updates.handsOnKneesCount})`);
                }
                
                // PHASE 4: Populate slowRecoveryCount from high fatigue or slow indicators
                if (observation.includes('slow') || observation.includes('labored') || signal.value >= 8) {
                  updates.slowRecoveryCount = (existing.slowRecoveryCount || 0) + 1;
                  console.log(`[Scout Agent State] 🐌 ${signal.player}: slowRecoveryCount++ (now ${updates.slowRecoveryCount})`);
                }
                break;
                
              case 'speed':
                updates.speedIndex = Math.max(0, Math.min(100, existing.speedIndex + signal.value));
                
                // PHASE 4: Sprint detection from speed signals
                if (observation.includes('sprint') || observation.includes('fast') || observation.includes('burst')) {
                  updates.sprintCount = (existing.sprintCount || 0) + 1;
                  console.log(`[Scout Agent State] 🏃 ${signal.player}: sprintCount++ from speed signal (now ${updates.sprintCount})`);
                }
                break;
                
              case 'effort':
                updates.effortScore = Math.max(0, Math.min(100, existing.effortScore + signal.value));
                
                // PHASE 4: Enhanced sprint detection from effort signals
                if (observation.includes('sprint') || observation.includes('racing') || observation.includes('explosive')) {
                  updates.sprintCount = (existing.sprintCount || 0) + 1;
                  const newFatigue = Math.min(100, existing.fatigueScore + 4);
                  updates.fatigueScore = newFatigue;
                  updates.fatigueSlope = calculateFatigueSlope(signal.player, newFatigue);
                  console.log(`[Scout Agent State] 🏃 ${signal.player}: sprintCount++ from effort (now ${updates.sprintCount})`);
                }
                
                // PHASE 4: Active hustle should reduce fatigue perception
                if (observation.includes('active') || observation.includes('hustl')) {
                  updates.fatigueScore = Math.max(0, existing.fatigueScore - 2);
                }
                break;
                
              case 'positioning':
                updates.reboundPositionScore = Math.max(0, Math.min(100, existing.reboundPositionScore + signal.value));
                
                // PHASE 4: Box-out/crash detection
                if (observation.includes('crash') || observation.includes('box')) {
                  updates.sprintCount = (existing.sprintCount || 0) + 1;
                  console.log(`[Scout Agent State] 🏀 ${signal.player}: sprintCount++ from positioning effort`);
                }
                break;
            }

            updatedPlayerStates.set(signal.player, { ...existing, ...updates });
          } else {
            // Log unmatched signals for debugging
            console.log(`[Scout Agent State] ⚠️ Signal for unknown player: ${signal.player}`);
          }
        });
        
        // Log counter summary after processing
        const counters = Array.from(updatedPlayerStates.values())
          .filter(p => p.sprintCount > 0 || p.handsOnKneesCount > 0 || p.slowRecoveryCount > 0)
          .map(p => `${p.playerName}: sprint=${p.sprintCount} knee=${p.handsOnKneesCount} slow=${p.slowRecoveryCount}`)
          .slice(0, 5);
        if (counters.length > 0) {
          console.log(`[Scout Agent State] Counter summary: ${counters.join(', ')}`);
        }
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

      // V8: Detect break scenes and flag for refresh
      const isBreakScene = ['commercial', 'timeout', 'dead_time'].includes(
        response.sceneClassification?.sceneType || ''
      );
      const shouldTriggerBreakRefresh = isBreakScene && (
        !prev.lastBreakRefreshTime || 
        (Date.now() - prev.lastBreakRefreshTime > 10000) // 10s debounce
      );

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
        // V8: Mark for break refresh (handled externally via shouldRefresh response)
        lastBreakRefreshTime: shouldTriggerBreakRefresh ? Date.now() : prev.lastBreakRefreshTime,
      };
    });
    
    // Update team-level state for game bets (outside setState to avoid nested updates)
    if (response.homeTeamState) {
      setHomeTeamState(response.homeTeamState);
    }
    if (response.awayTeamState) {
      setAwayTeamState(response.awayTeamState);
    }
    if (response.gameBetEdges && response.gameBetEdges.length > 0) {
      setGameBetEdges(response.gameBetEdges);
    }
    
    // Track PBP freshness
    if (response.pbpTimestamp) {
      setLastPbpUpdate(new Date(response.pbpTimestamp));
    }
    if (response.pbpGameTime) {
      setLastPbpGameTime(response.pbpGameTime);
    }

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

  // Manual PBP refresh function
  const refreshPBPData = useCallback(async () => {
    if (!state.gameContext?.eventId) return { success: false, reason: 'No game context' };
    
    const eventIdToUse = (state.gameContext as any).espnEventId || state.gameContext.eventId;
    
    try {
      const { data, error } = await supabase.functions.invoke('fetch-live-pbp', {
        body: { eventId: eventIdToUse },
      });
      
      if (!error && data && !data.notAvailable) {
        updatePBPData(data);
        setLastPbpUpdate(new Date());
        setLastPbpGameTime(data.gameTime || null);
        return { success: true, playerCount: data.players?.length || 0 };
      }
      return { success: false, reason: data?.reason || error?.message || 'Unknown error' };
    } catch (e) {
      console.error('[Scout] Manual PBP refresh failed:', e);
      return { success: false, reason: 'Network error' };
    }
  }, [state.gameContext, updatePBPData]);

  // V8: Commercial/timeout break refresh trigger
  const triggerBreakRefresh = useCallback(async () => {
    console.log('[Scout Agent] Break detected - triggering refresh cascade');
    
    // 1. Refresh PBP data immediately
    const pbpResult = await refreshPBPData();
    console.log('[Scout Agent] Break refresh: PBP', pbpResult.success ? '✓' : '✗');
    
    // 2. Force save session state
    await saveSession();
    console.log('[Scout Agent] Break refresh: Session saved');
    
    // 3. Update last break refresh time to debounce
    setState(prev => ({
      ...prev,
      lastBreakRefreshTime: Date.now(),
    }));
    
  }, [refreshPBPData, saveSession]);

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
    // V3: Projection Milestones
    projectionSnapshots,
    currentGameMinute,
    lastProjectionMilestone,
    // V4: Session Persistence
    sessionRestored,
    clearSession,
    // V5: Game Bets (Team-level)
    homeTeamState,
    awayTeamState,
    gameBetEdges,
    setHomeTeamState,
    setAwayTeamState,
    setGameBetEdges,
    // V6: PBP Freshness
    lastPbpUpdate,
    lastPbpGameTime,
    refreshPBPData,
    // V7: Quarter Snapshots
    quarterSnapshots,
    // V8: Break Refresh
    triggerBreakRefresh,
  };
}
