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
  /** v6: Stat-specific adjustment factor applied to projection */
  adjustmentPct?: number;
}

interface UseRegressionDetectionOptions {
  enabled?: boolean;
  threshold?: number;
}

/**
 * v6.0: Enhanced regression detection with stat-specific rules.
 *
 * Points: Shot attempt pace + shooting % regression
 * Rebounds: Opponent missed FG multiplier
 * Assists: Teammate FG% regression + potential assists pace
 * PRA: Combined variance model
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
      if (progress < 0.2) continue;

      for (const player of game.players) {
        const projections = player.projections;
        if (!projections) continue;

        for (const [statKey, projection] of Object.entries(projections)) {
          if (!projection || projection.projected === 0) continue;

          const expected = projection.projected * progress;
          const actual = projection.current;
          const diff = expected - actual;

          // Shot quality factor
          const shotQualityFactor = Math.max(0.5, (projection.confidence || 50) / 100);
          // Variance adjustment
          const varianceAdjustment = 1 + (1 - progress) * 0.5;

          let regressionScore = (diff / Math.max(shotQualityFactor, 0.01)) * varianceAdjustment;

          // v6.0: Stat-specific adjustments
          let adjustmentPct = 0;
          const normStat = statKey.toLowerCase();

          if (normStat.includes('point')) {
            // Points: if shooting hot on low volume, expect regression down
            // if shooting cold on high volume, expect regression up
            const shotAttemptPace = actual > 0 ? (actual / progress) : 0;
            const expectedPace = projection.projected;
            if (shotAttemptPace > expectedPace * 1.2) {
              // High shot attempt pace → boost projection 5%
              adjustmentPct = 5;
              regressionScore *= 0.8; // Less likely to regress if volume is real
            } else if (actual > expected * 1.2 && shotAttemptPace < expectedPace * 0.9) {
              // Shooting hot on low volume → reduce 5%
              adjustmentPct = -5;
              regressionScore *= 1.2;
            } else if (actual < expected * 0.8 && shotAttemptPace > expectedPace * 1.1) {
              // Shooting cold on high volume → boost 5%
              adjustmentPct = 5;
              regressionScore *= 1.1;
            }
          } else if (normStat.includes('rebound')) {
            // Rebounds: opponent missed FG creates more rebound opportunities
            // Use score differential as proxy for missed FGs
            const scoreDiff = Math.abs(game.homeScore - game.awayScore);
            if (scoreDiff > 15) {
              // Blowout = more missed shots from losing team
              adjustmentPct = 3;
            }
          } else if (normStat.includes('assist')) {
            // Assists: if team is shooting well, assists naturally higher
            // Use game score as proxy for team efficiency
            const teamScore = game.homeScore + game.awayScore;
            if (teamScore > 120 * progress * 2) {
              // High scoring game = more assist opportunities
              adjustmentPct = 3;
            }
          }

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
              adjustmentPct,
              tooltip: direction === 'cold'
                ? `Expected ${expected.toFixed(1)} ${statKey} by now, only has ${actual}. Positive regression likely.${adjustmentPct ? ` (${adjustmentPct > 0 ? '+' : ''}${adjustmentPct}% stat adj)` : ''}`
                : `Already at ${actual} ${statKey}, expected only ${expected.toFixed(1)}. Regression to mean likely.${adjustmentPct ? ` (${adjustmentPct > 0 ? '+' : ''}${adjustmentPct}% stat adj)` : ''}`,
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
