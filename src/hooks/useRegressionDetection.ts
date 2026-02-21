import { useMemo } from 'react';
import { useUnifiedLiveFeed, type UnifiedPlayer, type UnifiedGame } from './useUnifiedLiveFeed';

export interface RegressionAlert {
  playerName: string;
  propType: string;
  regressionScore: number;
  probability: number;
  direction: 'cold' | 'hot';
  suggestedSide: 'over' | 'under';
  expected: number;
  actual: number;
  tooltip: string;
}

interface UseRegressionDetectionOptions {
  enabled?: boolean;
  threshold?: number; // probability threshold to trigger alert (default 0.65)
}

/**
 * Detects when a player's current output deviates significantly from expected rate.
 * Cold regression = shooting below expected → positive regression likely → suggest Over
 * Hot regression = shooting above expected → negative regression likely → suggest Under
 *
 * Formula: regression_score = (expected - actual) / shot_quality_factor × variance_adjustment
 */
export function useRegressionDetection(options: UseRegressionDetectionOptions = {}) {
  const { enabled = true, threshold = 0.65 } = options;
  const { games, isLoading } = useUnifiedLiveFeed({ enabled });

  const alerts = useMemo<RegressionAlert[]>(() => {
    if (!games?.length) return [];

    const results: RegressionAlert[] = [];

    for (const game of games) {
      if (game.status !== 'in_progress') continue;
      const progress = game.gameProgress || 0;
      if (progress < 0.2) continue; // Need enough data

      for (const player of game.players) {
        const projections = player.projections;
        if (!projections) continue;

        for (const [statKey, projection] of Object.entries(projections)) {
          if (!projection || projection.projected === 0) continue;

          const expected = projection.projected * progress;
          const actual = projection.current;
          const diff = expected - actual;

          // Shot quality factor – use confidence as proxy (higher confidence = higher quality data)
          const shotQualityFactor = Math.max(0.5, (projection.confidence || 50) / 100);
          // Variance adjustment – higher with more game remaining
          const varianceAdjustment = 1 + (1 - progress) * 0.5;

          const regressionScore = (diff / Math.max(shotQualityFactor, 0.01)) * varianceAdjustment;

          // Convert score to probability (sigmoid-like)
          const absScore = Math.abs(regressionScore);
          const probability = 1 / (1 + Math.exp(-0.8 * (absScore - 2)));

          if (probability >= threshold) {
            const direction: 'cold' | 'hot' = regressionScore > 0 ? 'cold' : 'hot';
            const suggestedSide = direction === 'cold' ? 'over' : 'under';

            results.push({
              playerName: player.playerName,
              propType: statKey,
              regressionScore,
              probability,
              direction,
              suggestedSide,
              expected: Math.round(expected * 10) / 10,
              actual,
              tooltip: direction === 'cold'
                ? `Expected ${expected.toFixed(1)} ${statKey} by now, only has ${actual}. Positive regression likely.`
                : `Already at ${actual} ${statKey}, expected only ${expected.toFixed(1)}. Regression to mean likely.`,
            });
          }
        }
      }
    }

    return results.sort((a, b) => b.probability - a.probability);
  }, [games, threshold]);

  const getPlayerRegression = useMemo(() => {
    const map = new Map<string, RegressionAlert[]>();
    for (const alert of alerts) {
      const key = alert.playerName.toLowerCase();
      const existing = map.get(key) || [];
      existing.push(alert);
      map.set(key, existing);
    }
    return (playerName: string, propType?: string): RegressionAlert | null => {
      const playerAlerts = map.get(playerName.toLowerCase());
      if (!playerAlerts?.length) return null;
      if (propType) {
        return playerAlerts.find(a => a.propType === propType) || null;
      }
      return playerAlerts[0];
    };
  }, [alerts]);

  return {
    alerts,
    getPlayerRegression,
    isLoading,
  };
}
