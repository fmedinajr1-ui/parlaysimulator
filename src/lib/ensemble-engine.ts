/**
 * Ensemble Engine - Multi-Signal Consensus System
 * 
 * Combines predictions from multiple engines:
 * - Sharp Money Tracker
 * - Hit Rate Parlays
 * - Juiced Props Scanner
 * - Fatigue Edge
 * - God Mode Upsets
 * - FanDuel Trap Scanner
 * 
 * Each engine is weighted by its historical accuracy
 */

export interface EngineSignal {
  engineName: string;
  recommendation: 'pick' | 'fade' | 'neutral';
  confidence: number; // 0-1
  reasoning?: string;
  historicalAccuracy?: number;
  sampleSize?: number;
}

export interface EnsembleResult {
  consensus: 'strong_pick' | 'lean_pick' | 'neutral' | 'lean_fade' | 'strong_fade';
  consensusScore: number; // -100 to +100
  weightedConfidence: number; // 0-1
  agreementPercent: number;
  signals: EngineSignal[];
  topContributors: string[];
  conflictingSignals: string[];
  recommendation: string;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface EngineWeight {
  name: string;
  displayName: string;
  baseWeight: number;
  accuracyMultiplier: number;
  sampleSizeThreshold: number;
}

// Default engine weights based on typical performance
export const DEFAULT_ENGINE_WEIGHTS: EngineWeight[] = [
  { name: 'sharp_money', displayName: 'Sharp Money', baseWeight: 1.0, accuracyMultiplier: 1.2, sampleSizeThreshold: 20 },
  { name: 'hitrate', displayName: 'Hit Rate', baseWeight: 0.9, accuracyMultiplier: 1.1, sampleSizeThreshold: 30 },
  { name: 'juiced_props', displayName: 'Juiced Props', baseWeight: 0.85, accuracyMultiplier: 1.0, sampleSizeThreshold: 25 },
  { name: 'fatigue', displayName: 'Fatigue Edge', baseWeight: 0.8, accuracyMultiplier: 1.15, sampleSizeThreshold: 15 },
  { name: 'god_mode', displayName: 'God Mode', baseWeight: 0.75, accuracyMultiplier: 1.3, sampleSizeThreshold: 10 },
  { name: 'trap_scanner', displayName: 'Trap Scanner', baseWeight: 0.9, accuracyMultiplier: 1.1, sampleSizeThreshold: 20 },
  { name: 'correlation', displayName: 'Correlation Model', baseWeight: 0.7, accuracyMultiplier: 1.0, sampleSizeThreshold: 50 },
  { name: 'monte_carlo', displayName: 'Monte Carlo', baseWeight: 0.85, accuracyMultiplier: 1.0, sampleSizeThreshold: 100 },
];

/**
 * Calculate dynamic weight for an engine based on accuracy and sample size
 */
export function calculateEngineWeight(
  baseWeight: number,
  accuracyMultiplier: number,
  historicalAccuracy: number | undefined,
  sampleSize: number | undefined,
  sampleSizeThreshold: number
): number {
  // If no accuracy data, use base weight with penalty
  if (!historicalAccuracy || !sampleSize) {
    return baseWeight * 0.7;
  }

  // Sample size confidence factor (0.5 to 1.0)
  const sampleConfidence = Math.min(1, (sampleSize / sampleSizeThreshold) * 0.5 + 0.5);

  // Accuracy factor (0.5 to 1.5 based on 40-70% accuracy range)
  const normalizedAccuracy = Math.max(0, Math.min(1, (historicalAccuracy - 0.4) / 0.3));
  const accuracyFactor = 0.5 + normalizedAccuracy;

  return baseWeight * accuracyMultiplier * sampleConfidence * accuracyFactor;
}

/**
 * Run the ensemble engine on a set of signals
 */
export function runEnsemble(signals: EngineSignal[]): EnsembleResult {
  if (signals.length === 0) {
    return {
      consensus: 'neutral',
      consensusScore: 0,
      weightedConfidence: 0,
      agreementPercent: 0,
      signals: [],
      topContributors: [],
      conflictingSignals: [],
      recommendation: 'Insufficient data for consensus',
      riskLevel: 'high'
    };
  }

  // Calculate weighted scores
  let totalWeight = 0;
  let weightedScore = 0;
  const weightedSignals: Array<EngineSignal & { weight: number; contribution: number }> = [];

  for (const signal of signals) {
    const engineConfig = DEFAULT_ENGINE_WEIGHTS.find(
      e => e.name === signal.engineName
    ) || { baseWeight: 0.5, accuracyMultiplier: 1.0, sampleSizeThreshold: 20 };

    const weight = calculateEngineWeight(
      engineConfig.baseWeight,
      engineConfig.accuracyMultiplier,
      signal.historicalAccuracy,
      signal.sampleSize,
      engineConfig.sampleSizeThreshold
    );

    // Convert recommendation to score (-1 to +1)
    let signalScore = 0;
    if (signal.recommendation === 'pick') {
      signalScore = signal.confidence;
    } else if (signal.recommendation === 'fade') {
      signalScore = -signal.confidence;
    }

    const contribution = signalScore * weight;
    weightedScore += contribution;
    totalWeight += weight;

    weightedSignals.push({
      ...signal,
      weight,
      contribution
    });
  }

  // Normalize to -100 to +100 scale
  const normalizedScore = totalWeight > 0 
    ? (weightedScore / totalWeight) * 100 
    : 0;

  // Determine consensus level
  let consensus: EnsembleResult['consensus'];
  if (normalizedScore >= 40) {
    consensus = 'strong_pick';
  } else if (normalizedScore >= 15) {
    consensus = 'lean_pick';
  } else if (normalizedScore <= -40) {
    consensus = 'strong_fade';
  } else if (normalizedScore <= -15) {
    consensus = 'lean_fade';
  } else {
    consensus = 'neutral';
  }

  // Calculate agreement percentage
  const pickCount = signals.filter(s => s.recommendation === 'pick').length;
  const fadeCount = signals.filter(s => s.recommendation === 'fade').length;
  const majorityDirection = pickCount >= fadeCount ? 'pick' : 'fade';
  const majorityCount = Math.max(pickCount, fadeCount);
  const agreementPercent = (majorityCount / signals.length) * 100;

  // Find top contributors (highest absolute contribution)
  const sortedByContribution = [...weightedSignals]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
  const topContributors = sortedByContribution
    .slice(0, 3)
    .map(s => s.engineName);

  // Find conflicting signals
  const conflictingSignals = signals
    .filter(s => 
      (normalizedScore > 0 && s.recommendation === 'fade') ||
      (normalizedScore < 0 && s.recommendation === 'pick')
    )
    .map(s => s.engineName);

  // Calculate weighted confidence
  const weightedConfidence = weightedSignals.reduce(
    (acc, s) => acc + (s.confidence * s.weight), 
    0
  ) / totalWeight;

  // Determine risk level
  let riskLevel: EnsembleResult['riskLevel'];
  if (agreementPercent >= 70 && Math.abs(normalizedScore) >= 30) {
    riskLevel = 'low';
  } else if (agreementPercent >= 50 || Math.abs(normalizedScore) >= 20) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'high';
  }

  // Generate recommendation text
  let recommendation: string;
  if (consensus === 'strong_pick') {
    recommendation = `Strong consensus to PICK. ${topContributors.length} engines agree with ${agreementPercent.toFixed(0)}% alignment.`;
  } else if (consensus === 'lean_pick') {
    recommendation = `Lean PICK with moderate confidence. Some engines disagree.`;
  } else if (consensus === 'strong_fade') {
    recommendation = `Strong consensus to FADE. ${topContributors.length} engines see trap signals.`;
  } else if (consensus === 'lean_fade') {
    recommendation = `Lean FADE. Proceed with caution.`;
  } else {
    recommendation = `Mixed signals - no clear consensus. Consider passing or reducing stake.`;
  }

  return {
    consensus,
    consensusScore: normalizedScore,
    weightedConfidence,
    agreementPercent,
    signals,
    topContributors,
    conflictingSignals,
    recommendation,
    riskLevel
  };
}

/**
 * Extract signals from leg analysis
 */
export function extractSignalsFromAnalysis(legAnalysis: {
  recommendation?: string;
  confidenceLevel?: string;
  adjustedProbability?: number;
  signals?: Array<{ type: string; value?: number; description?: string }>;
  trapScore?: number;
  sharpIndicator?: string;
  fatigueScore?: number;
}): EngineSignal[] {
  const signals: EngineSignal[] = [];

  // Sharp money signal
  if (legAnalysis.sharpIndicator) {
    const isSharp = legAnalysis.sharpIndicator.toLowerCase().includes('sharp');
    signals.push({
      engineName: 'sharp_money',
      recommendation: isSharp ? 'pick' : 'neutral',
      confidence: isSharp ? 0.75 : 0.5,
      reasoning: legAnalysis.sharpIndicator
    });
  }

  // Trap signal
  if (legAnalysis.trapScore !== undefined) {
    const isTrap = legAnalysis.trapScore > 50;
    signals.push({
      engineName: 'trap_scanner',
      recommendation: isTrap ? 'fade' : 'pick',
      confidence: Math.abs(legAnalysis.trapScore - 50) / 50,
      reasoning: isTrap ? 'High trap probability detected' : 'Low trap risk'
    });
  }

  // Fatigue signal
  if (legAnalysis.fatigueScore !== undefined) {
    const highFatigue = legAnalysis.fatigueScore > 60;
    signals.push({
      engineName: 'fatigue',
      recommendation: highFatigue ? 'fade' : 'neutral',
      confidence: Math.min(legAnalysis.fatigueScore / 100, 1),
      reasoning: `Fatigue score: ${legAnalysis.fatigueScore}`
    });
  }

  // Overall recommendation as a signal
  if (legAnalysis.recommendation) {
    const rec = legAnalysis.recommendation.toLowerCase();
    const confidenceMap: Record<string, number> = {
      'high': 0.85,
      'medium': 0.65,
      'low': 0.45
    };
    signals.push({
      engineName: 'correlation',
      recommendation: rec.includes('pick') ? 'pick' : rec.includes('fade') ? 'fade' : 'neutral',
      confidence: confidenceMap[legAnalysis.confidenceLevel || 'medium'] || 0.5,
      reasoning: `AI recommendation: ${legAnalysis.recommendation}`
    });
  }

  // Monte Carlo signal from adjusted probability
  if (legAnalysis.adjustedProbability !== undefined) {
    const implied = legAnalysis.adjustedProbability;
    signals.push({
      engineName: 'monte_carlo',
      recommendation: implied > 0.55 ? 'pick' : implied < 0.45 ? 'fade' : 'neutral',
      confidence: Math.abs(implied - 0.5) * 2,
      reasoning: `Adjusted probability: ${(implied * 100).toFixed(1)}%`
    });
  }

  return signals;
}

/**
 * Extract signals from Best Bet data for ensemble processing
 */
export function extractBestBetSignals(
  event: {
    sharp_indicator?: string;
    trap_score?: number;
    fatigue_differential?: number;
    confidence?: number;
    recommendation?: string;
  },
  type: string
): EngineSignal[] {
  const signals: EngineSignal[] = [];

  // Sharp Money signal
  if (event.sharp_indicator) {
    const isSharpPick = event.sharp_indicator.toLowerCase().includes('sharp') || 
                        event.sharp_indicator.toLowerCase().includes('steam');
    signals.push({
      engineName: 'sharp_money',
      recommendation: isSharpPick ? 'pick' : 'fade',
      confidence: 0.7,
      historicalAccuracy: 0.58,
      sampleSize: 150
    });
  }

  // Trap Scanner signal
  if (event.trap_score !== undefined && event.trap_score > 0) {
    const isTrap = event.trap_score >= 60;
    signals.push({
      engineName: 'trap_scanner',
      recommendation: isTrap ? 'fade' : 'pick',
      confidence: Math.min(event.trap_score / 100, 0.9),
      historicalAccuracy: 0.54,
      sampleSize: 80
    });
  }

  // Fatigue Edge signal
  if (event.fatigue_differential !== undefined && event.fatigue_differential > 0) {
    signals.push({
      engineName: 'fatigue',
      recommendation: 'pick',
      confidence: Math.min(0.5 + (event.fatigue_differential / 20), 0.85),
      historicalAccuracy: 0.56,
      sampleSize: 60
    });
  }

  // Base confidence signal from the specific engine type
  if (event.confidence !== undefined) {
    const engineMap: Record<string, string> = {
      'nhl_sharp': 'sharp_money',
      'ncaab_steam': 'sharp_money',
      'fade_signal': 'trap_scanner',
      'nba_fatigue': 'fatigue'
    };
    
    const engineName = engineMap[type] || 'hitrate';
    const recommendation = event.recommendation === 'fade' ? 'fade' : 'pick';
    
    // Only add if not already present
    if (!signals.find(s => s.engineName === engineName)) {
      signals.push({
        engineName,
        recommendation,
        confidence: event.confidence,
        historicalAccuracy: 0.55,
        sampleSize: 100
      });
    }
  }

  return signals;
}

/**
 * Extract signals from Hit Rate prop data
 */
export function extractHitRateSignals(prop: {
  hit_rate_over?: number;
  hit_rate_under?: number;
  recommended_side?: string;
  consistency_score?: number;
  line_value_label?: string;
  trend_direction?: string;
  sharp_aligned?: boolean;
  confidence_score?: number;
  season_avg?: number;
  current_line?: number;
}): EngineSignal[] {
  const signals: EngineSignal[] = [];
  const side = prop.recommended_side || 'over';
  const hitRate = side === 'over' ? (prop.hit_rate_over || 0) : (prop.hit_rate_under || 0);

  // Hit Rate signal (primary)
  if (hitRate > 0) {
    signals.push({
      engineName: 'hitrate',
      recommendation: hitRate >= 0.7 ? 'pick' : hitRate >= 0.5 ? 'neutral' : 'fade',
      confidence: hitRate,
      reasoning: `${(hitRate * 100).toFixed(0)}% hit rate on ${side}`,
      historicalAccuracy: 0.62,
      sampleSize: 100
    });
  }

  // Consistency signal
  if (prop.consistency_score !== undefined) {
    const isConsistent = prop.consistency_score >= 60;
    signals.push({
      engineName: 'correlation',
      recommendation: isConsistent ? 'pick' : prop.consistency_score < 40 ? 'fade' : 'neutral',
      confidence: prop.consistency_score / 100,
      reasoning: `Consistency score: ${prop.consistency_score}%`,
      historicalAccuracy: 0.55,
      sampleSize: 80
    });
  }

  // Line value signal
  if (prop.line_value_label) {
    const valueMap: Record<string, { rec: 'pick' | 'fade' | 'neutral'; conf: number }> = {
      'excellent': { rec: 'pick', conf: 0.8 },
      'good': { rec: 'pick', conf: 0.65 },
      'neutral': { rec: 'neutral', conf: 0.5 },
      'poor': { rec: 'fade', conf: 0.6 }
    };
    const value = valueMap[prop.line_value_label] || { rec: 'neutral', conf: 0.5 };
    signals.push({
      engineName: 'trap_scanner',
      recommendation: value.rec,
      confidence: value.conf,
      reasoning: `Line value: ${prop.line_value_label}`,
      historicalAccuracy: 0.54,
      sampleSize: 60
    });
  }

  // Trend signal
  if (prop.trend_direction) {
    const trendMap: Record<string, { rec: 'pick' | 'fade' | 'neutral'; conf: number }> = {
      'hot': { rec: 'pick', conf: 0.7 },
      'stable': { rec: 'neutral', conf: 0.5 },
      'cold': { rec: 'fade', conf: 0.65 }
    };
    const trend = trendMap[prop.trend_direction] || { rec: 'neutral', conf: 0.5 };
    signals.push({
      engineName: 'fatigue',
      recommendation: trend.rec,
      confidence: trend.conf,
      reasoning: `Player trend: ${prop.trend_direction}`,
      historicalAccuracy: 0.56,
      sampleSize: 50
    });
  }

  // Season avg vs line signal
  if (prop.season_avg !== undefined && prop.current_line !== undefined) {
    const diff = prop.season_avg - prop.current_line;
    const favorsOver = diff > 0;
    const magnitude = Math.min(Math.abs(diff) / 5, 1);
    
    const isAligned = (favorsOver && side === 'over') || (!favorsOver && side === 'under');
    signals.push({
      engineName: 'monte_carlo',
      recommendation: isAligned ? 'pick' : 'fade',
      confidence: 0.5 + (magnitude * 0.3),
      reasoning: `Season avg ${prop.season_avg} vs line ${prop.current_line}`,
      historicalAccuracy: 0.52,
      sampleSize: 120
    });
  }

  return signals;
}

/**
 * Aggregate ensemble results for multiple legs
 */
export function aggregateParlayEnsemble(
  legResults: EnsembleResult[]
): {
  overallConsensus: EnsembleResult['consensus'];
  overallScore: number;
  weakestLeg: number;
  strongestLeg: number;
  parlayRisk: 'low' | 'medium' | 'high' | 'extreme';
  recommendation: string;
} {
  if (legResults.length === 0) {
    return {
      overallConsensus: 'neutral',
      overallScore: 0,
      weakestLeg: -1,
      strongestLeg: -1,
      parlayRisk: 'extreme',
      recommendation: 'No legs to analyze'
    };
  }

  // Find strongest and weakest legs
  let weakestIdx = 0;
  let strongestIdx = 0;
  let weakestScore = legResults[0].consensusScore;
  let strongestScore = legResults[0].consensusScore;

  legResults.forEach((result, idx) => {
    if (result.consensusScore < weakestScore) {
      weakestScore = result.consensusScore;
      weakestIdx = idx;
    }
    if (result.consensusScore > strongestScore) {
      strongestScore = result.consensusScore;
      strongestIdx = idx;
    }
  });

  // Average score weighted by confidence
  const totalConfidence = legResults.reduce((acc, r) => acc + r.weightedConfidence, 0);
  const weightedAvgScore = legResults.reduce(
    (acc, r) => acc + (r.consensusScore * r.weightedConfidence),
    0
  ) / totalConfidence;

  // Determine overall consensus
  let overallConsensus: EnsembleResult['consensus'];
  if (weightedAvgScore >= 30 && weakestScore >= 0) {
    overallConsensus = 'strong_pick';
  } else if (weightedAvgScore >= 10) {
    overallConsensus = 'lean_pick';
  } else if (weightedAvgScore <= -30 || weakestScore <= -30) {
    overallConsensus = 'strong_fade';
  } else if (weightedAvgScore <= -10) {
    overallConsensus = 'lean_fade';
  } else {
    overallConsensus = 'neutral';
  }

  // Parlay risk assessment
  const fadeLegCount = legResults.filter(r => r.consensusScore < -15).length;
  const neutralLegCount = legResults.filter(r => Math.abs(r.consensusScore) < 15).length;
  
  let parlayRisk: 'low' | 'medium' | 'high' | 'extreme';
  if (fadeLegCount >= 2 || weakestScore < -40) {
    parlayRisk = 'extreme';
  } else if (fadeLegCount >= 1 || neutralLegCount >= legResults.length / 2) {
    parlayRisk = 'high';
  } else if (neutralLegCount >= 1 || weakestScore < 15) {
    parlayRisk = 'medium';
  } else {
    parlayRisk = 'low';
  }

  // Generate recommendation
  let recommendation: string;
  if (parlayRisk === 'extreme') {
    recommendation = `⚠️ EXTREME RISK: ${fadeLegCount} leg(s) flagged as fades. Consider removing weak legs.`;
  } else if (parlayRisk === 'high') {
    recommendation = `⚡ HIGH RISK: Leg ${weakestIdx + 1} is the weak link. Parlay success depends on it.`;
  } else if (parlayRisk === 'medium') {
    recommendation = `📊 MODERATE RISK: Solid parlay with some uncertainty. Monitor leg ${weakestIdx + 1}.`;
  } else {
    recommendation = `✅ LOW RISK: Strong consensus across all legs. Good parlay structure.`;
  }

  return {
    overallConsensus,
    overallScore: weightedAvgScore,
    weakestLeg: weakestIdx,
    strongestLeg: strongestIdx,
    parlayRisk,
    recommendation
  };
}
