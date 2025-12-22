/**
 * Enhanced Probability Hook
 * 
 * Consolidates all probability engines (naive, AI-adjusted, correlation, Monte Carlo)
 * into a single weighted ensemble with confidence scoring.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { ParlaySimulation, ParlayAnalysis, ParlayLeg } from '@/types/parlay';
import { quickCorrelationAnalysis } from '@/lib/monte-carlo-correlated';
import { CorrelationMatrix } from '@/lib/correlation-engine';

export interface ConfidenceFactor {
  name: string;
  score: number;
  maxScore: number;
  status: 'good' | 'warning' | 'critical';
  description: string;
}

export interface EnhancedProbabilityResult {
  // Probability values (as decimals 0-1)
  naiveProbability: number;
  aiAdjustedProbability: number;
  correlatedProbability: number;
  finalProbability: number;
  
  // Correlation data
  correlationMatrix: CorrelationMatrix | null;
  correlationImpact: number;
  correlationWarnings: string[];
  
  // Confidence scoring
  confidenceScore: number;
  confidenceLevel: 'high' | 'medium' | 'low' | 'uncertain';
  confidenceFactors: ConfidenceFactor[];
  
  // Meta
  isCalculating: boolean;
  hasAiData: boolean;
  hasCorrelationData: boolean;
  
  // Breakdown percentages for display
  breakdown: {
    bookOdds: number;
    aiAdjusted: number;
    correlation: number;
    final: number;
  };
}

interface UseEnhancedProbabilityOptions {
  debounceMs?: number;
}

/**
 * Calculate enhanced probability using all available engines
 */
export function useEnhancedProbability(
  legs: ParlayLeg[],
  aiAnalysis?: ParlayAnalysis | null,
  options: UseEnhancedProbabilityOptions = {}
): EnhancedProbabilityResult {
  const { debounceMs = 300 } = options;
  
  const [isCalculating, setIsCalculating] = useState(false);
  const [correlationData, setCorrelationData] = useState<{
    matrix: CorrelationMatrix | null;
    correlatedProb: number;
    warnings: string[];
  }>({ matrix: null, correlatedProb: 0, warnings: [] });

  // Calculate naive probability (simple product of implied probs)
  const naiveProbability = useMemo(() => {
    if (legs.length === 0) return 0;
    return legs.reduce((prod, leg) => prod * leg.impliedProbability, 1);
  }, [legs]);

  // Calculate AI-adjusted probability
  const aiAdjustedProbability = useMemo(() => {
    if (!aiAnalysis?.legAnalyses || legs.length === 0) {
      return naiveProbability;
    }

    let adjustedProb = 1;
    for (let i = 0; i < legs.length; i++) {
      const legAnalysis = aiAnalysis.legAnalyses.find(la => la.legIndex === i);
      if (legAnalysis?.adjustedProbability && legAnalysis.adjustedProbability > 0) {
        adjustedProb *= legAnalysis.adjustedProbability;
      } else {
        adjustedProb *= legs[i].impliedProbability;
      }
    }
    return adjustedProb;
  }, [legs, aiAnalysis, naiveProbability]);

  // Run correlation analysis (async)
  useEffect(() => {
    if (legs.length < 2) {
      setCorrelationData({ 
        matrix: null, 
        correlatedProb: naiveProbability, 
        warnings: [] 
      });
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setIsCalculating(true);
      try {
        const result = await quickCorrelationAnalysis(legs);
        if (!cancelled) {
          setCorrelationData({
            matrix: result.correlationMatrix,
            correlatedProb: result.estimatedCorrelatedProbability,
            warnings: result.warnings,
          });
        }
      } catch (err) {
        console.error('Correlation analysis failed:', err);
        if (!cancelled) {
          setCorrelationData({ 
            matrix: null, 
            correlatedProb: naiveProbability, 
            warnings: [] 
          });
        }
      } finally {
        if (!cancelled) {
          setIsCalculating(false);
        }
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [legs, naiveProbability, debounceMs]);

  // Calculate confidence factors
  const confidenceFactors = useMemo((): ConfidenceFactor[] => {
    const factors: ConfidenceFactor[] = [];

    // 1. Leg count factor (fewer legs = more confidence)
    const legScore = legs.length <= 3 ? 20 : legs.length <= 5 ? 15 : legs.length <= 7 ? 10 : 5;
    factors.push({
      name: 'Leg Count',
      score: legScore,
      maxScore: 20,
      status: legScore >= 15 ? 'good' : legScore >= 10 ? 'warning' : 'critical',
      description: `${legs.length} legs in parlay`,
    });

    // 2. AI data coverage
    const aiLegsCount = aiAnalysis?.legAnalyses?.filter(la => la.adjustedProbability)?.length || 0;
    const aiCoverage = legs.length > 0 ? (aiLegsCount / legs.length) : 0;
    const aiScore = Math.round(aiCoverage * 25);
    factors.push({
      name: 'AI Analysis',
      score: aiScore,
      maxScore: 25,
      status: aiCoverage >= 0.8 ? 'good' : aiCoverage >= 0.5 ? 'warning' : 'critical',
      description: `${aiLegsCount}/${legs.length} legs analyzed`,
    });

    // 3. Correlation data quality
    const hasDbCorrelations = correlationData.matrix?.correlations?.some(
      c => c.confidence === 'high' || c.confidence === 'medium'
    ) || false;
    const corrScore = hasDbCorrelations ? 20 : correlationData.matrix ? 10 : 5;
    factors.push({
      name: 'Correlation Data',
      score: corrScore,
      maxScore: 20,
      status: hasDbCorrelations ? 'good' : correlationData.matrix ? 'warning' : 'critical',
      description: hasDbCorrelations ? 'Historical data available' : 'Using estimates',
    });

    // 4. Correlation risk
    const hasHighCorrelation = correlationData.matrix?.hasHighCorrelation || false;
    const avgCorr = correlationData.matrix?.avgCorrelation || 0;
    const corrRiskScore = hasHighCorrelation ? 5 : avgCorr > 0.15 ? 10 : 20;
    factors.push({
      name: 'Correlation Risk',
      score: corrRiskScore,
      maxScore: 20,
      status: corrRiskScore >= 15 ? 'good' : corrRiskScore >= 10 ? 'warning' : 'critical',
      description: hasHighCorrelation 
        ? 'High leg dependency detected' 
        : avgCorr > 0.15 
        ? 'Moderate correlation' 
        : 'Low correlation between legs',
    });

    // 5. Odds spread (extreme odds = less reliable)
    const hasExtremeOdds = legs.some(leg => leg.odds > 500 || leg.odds < -500);
    const oddsScore = hasExtremeOdds ? 8 : 15;
    factors.push({
      name: 'Odds Reliability',
      score: oddsScore,
      maxScore: 15,
      status: hasExtremeOdds ? 'warning' : 'good',
      description: hasExtremeOdds ? 'Contains extreme odds' : 'Odds in normal range',
    });

    return factors;
  }, [legs, aiAnalysis, correlationData]);

  // Calculate overall confidence score
  const confidenceScore = useMemo(() => {
    if (legs.length === 0) return 0;
    const totalScore = confidenceFactors.reduce((sum, f) => sum + f.score, 0);
    const maxPossible = confidenceFactors.reduce((sum, f) => sum + f.maxScore, 0);
    return Math.round((totalScore / maxPossible) * 100);
  }, [confidenceFactors, legs.length]);

  // Determine confidence level
  const confidenceLevel = useMemo((): 'high' | 'medium' | 'low' | 'uncertain' => {
    if (confidenceScore >= 75) return 'high';
    if (confidenceScore >= 55) return 'medium';
    if (confidenceScore >= 35) return 'low';
    return 'uncertain';
  }, [confidenceScore]);

  // Calculate final weighted probability
  const finalProbability = useMemo(() => {
    if (legs.length === 0) return 0;

    const hasAi = aiAnalysis?.legAnalyses && aiAnalysis.legAnalyses.length > 0;
    const hasCorrelation = correlationData.matrix !== null;

    // Weights based on data availability
    let naiveWeight = 0.1;
    let aiWeight = hasAi ? 0.4 : 0;
    let corrWeight = hasCorrelation ? 0.5 : 0;

    // Redistribute weights if data is missing
    if (!hasAi && !hasCorrelation) {
      naiveWeight = 1.0;
    } else if (!hasAi) {
      naiveWeight = 0.2;
      corrWeight = 0.8;
    } else if (!hasCorrelation) {
      naiveWeight = 0.2;
      aiWeight = 0.8;
    }

    const weighted = 
      (naiveProbability * naiveWeight) +
      (aiAdjustedProbability * aiWeight) +
      (correlationData.correlatedProb * corrWeight);

    // Clamp to reasonable bounds
    return Math.min(0.95, Math.max(0.0001, weighted));
  }, [legs.length, naiveProbability, aiAdjustedProbability, correlationData, aiAnalysis]);

  // Correlation impact
  const correlationImpact = useMemo(() => {
    if (!correlationData.matrix) return 0;
    return (correlationData.correlatedProb - naiveProbability) * 100;
  }, [correlationData.correlatedProb, naiveProbability]);

  return {
    naiveProbability,
    aiAdjustedProbability,
    correlatedProbability: correlationData.correlatedProb,
    finalProbability,
    
    correlationMatrix: correlationData.matrix,
    correlationImpact,
    correlationWarnings: correlationData.warnings,
    
    confidenceScore,
    confidenceLevel,
    confidenceFactors,
    
    isCalculating,
    hasAiData: (aiAnalysis?.legAnalyses?.length || 0) > 0,
    hasCorrelationData: correlationData.matrix !== null,
    
    breakdown: {
      bookOdds: naiveProbability * 100,
      aiAdjusted: aiAdjustedProbability * 100,
      correlation: correlationData.correlatedProb * 100,
      final: finalProbability * 100,
    },
  };
}

/**
 * Simpler hook for parlay builder (uses legs directly)
 */
export function useBuilderProbability(legs: { odds: number; impliedProbability?: number }[]) {
  const parlayLegs = useMemo((): ParlayLeg[] => {
    return legs.map((leg, i) => ({
      id: `leg-${i}`,
      description: '',
      odds: leg.odds,
      impliedProbability: leg.impliedProbability || (leg.odds > 0 
        ? 100 / (leg.odds + 100) 
        : Math.abs(leg.odds) / (Math.abs(leg.odds) + 100)),
      riskLevel: 'medium' as const,
    }));
  }, [legs]);

  return useEnhancedProbability(parlayLegs, null, { debounceMs: 200 });
}
