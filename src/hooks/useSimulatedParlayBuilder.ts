/**
 * useSimulatedParlayBuilder.ts
 * 
 * Monte Carlo simulation wrapper for parlay generation.
 * Validates parlay combinations using hybrid simulation before recommending.
 */

import { useState, useCallback, useMemo } from 'react';
import { 
  runHybridSimulation, 
  HybridSimulationResult, 
  ParlayLegInput,
  HybridSimulationConfig,
  quickHybridAnalysis,
} from '@/lib/hybrid-monte-carlo';
import type { SweetSpotPick } from './useSweetSpotParlayBuilder';

// ============= TYPES =============

export type SimulationMode = 'quick' | 'standard' | 'deep';

export interface SimulationConfig {
  mode: SimulationMode;
  minWinRate: number;      // Minimum win probability (0.15 = 15%)
  minEdge: number;         // Minimum edge vs implied (0.03 = 3%)
  minSharpe: number;       // Minimum Sharpe ratio (0.5)
  maxCombinations: number; // Max combinations to simulate
}

export interface SimulatedParlay {
  legs: SweetSpotPick[];
  simulation: HybridSimulationResult;
  rank: number;
  isViable: boolean;
  viabilityReasons: string[];
}

export interface SimulationProgress {
  stage: 'idle' | 'filtering' | 'simulating' | 'ranking' | 'complete';
  combinationsTotal: number;
  combinationsSimulated: number;
  viableParlays: number;
  elapsedMs: number;
}

export interface UseSimulatedParlayBuilderReturn {
  // Actions
  runSimulation: (candidates: SweetSpotPick[], legCount: number) => Promise<SimulatedParlay[]>;
  runQuickAnalysis: (legs: SweetSpotPick[]) => { winProbability: number; edge: number; recommendation: string; insights: string[] };
  cancelSimulation: () => void;
  
  // State
  isSimulating: boolean;
  progress: SimulationProgress;
  bestParlay: SimulatedParlay | null;
  viableParlays: SimulatedParlay[];
  
  // Config
  config: SimulationConfig;
  setMode: (mode: SimulationMode) => void;
}

// ============= CONSTANTS =============

const MODE_CONFIG: Record<SimulationMode, { iterations: number; label: string }> = {
  quick: { iterations: 5000, label: 'Quick (5K)' },
  standard: { iterations: 25000, label: 'Standard (25K)' },
  deep: { iterations: 50000, label: 'Deep (50K)' },
};

const DEFAULT_CONFIG: SimulationConfig = {
  mode: 'standard',
  minWinRate: 0.12,    // 12% min for 6-leg
  minEdge: 0.03,       // 3% edge
  minSharpe: 0.5,      // Decent risk-adjusted return
  maxCombinations: 100, // Limit for performance
};

// ============= HELPERS =============

/**
 * Convert SweetSpotPick to ParlayLegInput for simulation
 */
function convertToLegInput(pick: SweetSpotPick): ParlayLegInput {
  // Estimate American odds from confidence (simplified)
  const baseOdds = pick.side === 'over' ? -110 : -110;
  
  return {
    id: pick.id,
    propType: pick.prop_type,
    playerName: pick.player_name,
    teamName: pick.team_name,
    line: pick.line,
    side: pick.side as 'over' | 'under',
    americanOdds: baseOdds,
    expectedValue: pick.projectedValue || pick.line,
    sport: 'basketball',
    gameId: pick.event_id,
    context: undefined,
  };
}

/**
 * Generate combinations using greedy selection for performance
 * Instead of C(n,k) which explodes, use scored greedy approach
 */
function generateGreedyCombinations(
  candidates: SweetSpotPick[],
  legCount: number,
  maxCombinations: number
): SweetSpotPick[][] {
  const combinations: SweetSpotPick[][] = [];
  
  // Sort by confidence score descending
  const sorted = [...candidates].sort((a, b) => b.confidence_score - a.confidence_score);
  
  // Take top candidates for diversity
  const topPool = sorted.slice(0, Math.min(15, sorted.length));
  
  // Generate combinations using sliding window + shuffle
  const usedPlayers = new Set<string>();
  
  function buildCombo(start: number, current: SweetSpotPick[]): void {
    if (current.length === legCount) {
      combinations.push([...current]);
      return;
    }
    
    if (combinations.length >= maxCombinations) return;
    
    for (let i = start; i < topPool.length && combinations.length < maxCombinations; i++) {
      const pick = topPool[i];
      const playerKey = pick.player_name.toLowerCase();
      
      // Skip same player
      if (usedPlayers.has(playerKey)) continue;
      
      // Check team diversity (max 2 per team)
      const teamCounts = new Map<string, number>();
      current.forEach(p => {
        const team = p.team_name?.toLowerCase() || '';
        teamCounts.set(team, (teamCounts.get(team) || 0) + 1);
      });
      const currentTeam = pick.team_name?.toLowerCase() || '';
      if ((teamCounts.get(currentTeam) || 0) >= 2) continue;
      
      usedPlayers.add(playerKey);
      current.push(pick);
      buildCombo(i + 1, current);
      current.pop();
      usedPlayers.delete(playerKey);
    }
  }
  
  buildCombo(0, []);
  
  // If we have too few, add random shuffles
  if (combinations.length < maxCombinations / 2 && topPool.length >= legCount) {
    for (let shuffle = 0; shuffle < 3 && combinations.length < maxCombinations; shuffle++) {
      const shuffled = [...topPool].sort(() => Math.random() - 0.5);
      const combo: SweetSpotPick[] = [];
      const usedInCombo = new Set<string>();
      
      for (const pick of shuffled) {
        if (combo.length >= legCount) break;
        const playerKey = pick.player_name.toLowerCase();
        if (usedInCombo.has(playerKey)) continue;
        usedInCombo.add(playerKey);
        combo.push(pick);
      }
      
      if (combo.length === legCount) {
        combinations.push(combo);
      }
    }
  }
  
  return combinations;
}

/**
 * Check if a simulation result meets viability thresholds
 */
function checkViability(
  result: HybridSimulationResult,
  config: SimulationConfig
): { isViable: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let isViable = true;
  
  if (result.hybridWinRate < config.minWinRate) {
    reasons.push(`Win rate ${(result.hybridWinRate * 100).toFixed(1)}% < ${(config.minWinRate * 100)}% min`);
    isViable = false;
  } else {
    reasons.push(`✓ Win rate ${(result.hybridWinRate * 100).toFixed(1)}%`);
  }
  
  if (result.overallEdge < config.minEdge) {
    reasons.push(`Edge ${(result.overallEdge * 100).toFixed(1)}% < ${(config.minEdge * 100)}% min`);
    isViable = false;
  } else {
    reasons.push(`✓ Edge ${(result.overallEdge * 100).toFixed(1)}%`);
  }
  
  if (result.sharpeRatio < config.minSharpe) {
    reasons.push(`Sharpe ${result.sharpeRatio.toFixed(2)} < ${config.minSharpe} min`);
    isViable = false;
  } else {
    reasons.push(`✓ Sharpe ${result.sharpeRatio.toFixed(2)}`);
  }
  
  if (result.expectedValue < 0) {
    reasons.push(`Negative EV: ${result.expectedValue.toFixed(3)}`);
    isViable = false;
  } else {
    reasons.push(`✓ Positive EV: +${result.expectedValue.toFixed(3)}`);
  }
  
  return { isViable, reasons };
}

// ============= HOOK =============

export function useSimulatedParlayBuilder(): UseSimulatedParlayBuilderReturn {
  const [config, setConfig] = useState<SimulationConfig>(DEFAULT_CONFIG);
  const [isSimulating, setIsSimulating] = useState(false);
  const [progress, setProgress] = useState<SimulationProgress>({
    stage: 'idle',
    combinationsTotal: 0,
    combinationsSimulated: 0,
    viableParlays: 0,
    elapsedMs: 0,
  });
  const [results, setResults] = useState<SimulatedParlay[]>([]);
  const [cancelRequested, setCancelRequested] = useState(false);
  
  const setMode = useCallback((mode: SimulationMode) => {
    setConfig(prev => ({ ...prev, mode }));
  }, []);
  
  const cancelSimulation = useCallback(() => {
    setCancelRequested(true);
  }, []);
  
  /**
   * Quick analysis without full simulation - for instant feedback
   */
  const runQuickAnalysis = useCallback((legs: SweetSpotPick[]) => {
    const legInputs: ParlayLegInput[] = legs.map(convertToLegInput);
    const result = quickHybridAnalysis(legInputs);
    return {
      winProbability: result.winProbability,
      edge: result.edge,
      recommendation: result.recommendation,
      insights: result.keyInsights,
    };
  }, []);
  
  /**
   * Full Monte Carlo simulation across combinations
   */
  const runSimulation = useCallback(async (
    candidates: SweetSpotPick[],
    legCount: number
  ): Promise<SimulatedParlay[]> => {
    if (candidates.length < legCount) {
      console.warn('[Simulation] Not enough candidates for requested leg count');
      return [];
    }
    
    const startTime = Date.now();
    setIsSimulating(true);
    setCancelRequested(false);
    setResults([]);
    
    try {
      // Stage 1: Generate combinations
      setProgress({
        stage: 'filtering',
        combinationsTotal: 0,
        combinationsSimulated: 0,
        viableParlays: 0,
        elapsedMs: 0,
      });
      
      const combinations = generateGreedyCombinations(
        candidates,
        legCount,
        config.maxCombinations
      );
      
      console.log(`[Simulation] Generated ${combinations.length} combinations from ${candidates.length} candidates`);
      
      if (combinations.length === 0) {
        setProgress(prev => ({ ...prev, stage: 'complete' }));
        setIsSimulating(false);
        return [];
      }
      
      // Stage 2: Simulate each combination
      setProgress({
        stage: 'simulating',
        combinationsTotal: combinations.length,
        combinationsSimulated: 0,
        viableParlays: 0,
        elapsedMs: Date.now() - startTime,
      });
      
      const iterations = MODE_CONFIG[config.mode].iterations;
      const simulatedParlays: SimulatedParlay[] = [];
      
      for (let i = 0; i < combinations.length; i++) {
        if (cancelRequested) {
          console.log('[Simulation] Cancelled by user');
          break;
        }
        
        const combo = combinations[i];
        const legInputs: ParlayLegInput[] = combo.map(convertToLegInput);
        
        const simConfig: HybridSimulationConfig = {
          iterations,
          useCorrelations: true,
          parametricWeight: 0.4,
          monteCarloWeight: 0.6,
          minEdgeThreshold: 0,
        };
        
        const simulation = runHybridSimulation(legInputs, simConfig);
        const { isViable, reasons } = checkViability(simulation, config);
        
        simulatedParlays.push({
          legs: combo,
          simulation,
          rank: 0,
          isViable,
          viabilityReasons: reasons,
        });
        
        // Update progress every 5 iterations
        if (i % 5 === 0 || i === combinations.length - 1) {
          setProgress({
            stage: 'simulating',
            combinationsTotal: combinations.length,
            combinationsSimulated: i + 1,
            viableParlays: simulatedParlays.filter(p => p.isViable).length,
            elapsedMs: Date.now() - startTime,
          });
          
          // Yield to UI thread
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      
      // Stage 3: Rank results
      setProgress(prev => ({ ...prev, stage: 'ranking' }));
      
      // Sort by: viable first, then by Sharpe ratio
      simulatedParlays.sort((a, b) => {
        if (a.isViable !== b.isViable) return a.isViable ? -1 : 1;
        return b.simulation.sharpeRatio - a.simulation.sharpeRatio;
      });
      
      // Assign ranks
      simulatedParlays.forEach((p, i) => {
        p.rank = i + 1;
      });
      
      // Stage 4: Complete
      setProgress({
        stage: 'complete',
        combinationsTotal: combinations.length,
        combinationsSimulated: combinations.length,
        viableParlays: simulatedParlays.filter(p => p.isViable).length,
        elapsedMs: Date.now() - startTime,
      });
      
      setResults(simulatedParlays);
      console.log(`[Simulation] Complete: ${simulatedParlays.filter(p => p.isViable).length}/${combinations.length} viable`);
      
      return simulatedParlays;
      
    } finally {
      setIsSimulating(false);
    }
  }, [config, cancelRequested]);
  
  // Derived state
  const bestParlay = useMemo(() => {
    const viable = results.filter(p => p.isViable);
    return viable.length > 0 ? viable[0] : null;
  }, [results]);
  
  const viableParlays = useMemo(() => {
    return results.filter(p => p.isViable);
  }, [results]);
  
  return {
    runSimulation,
    runQuickAnalysis,
    cancelSimulation,
    isSimulating,
    progress,
    bestParlay,
    viableParlays,
    config,
    setMode,
  };
}
