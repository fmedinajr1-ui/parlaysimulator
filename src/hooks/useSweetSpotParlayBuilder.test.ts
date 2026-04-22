import { describe, it, expect, beforeEach } from 'vitest';
import frozenSlate from '../__fixtures__/frozen_slate.json';
import {
  buildSweetSpotParlayCore,
  SCORE_PRESETS,
  SCORE_WEIGHTS,
  setScorePreset,
  scorePick,
  type BuilderInput,
} from './useSweetSpotParlayBuilder';

function computeScore(p: {
  _patternScore?: number;
  l10HitRate?: number | null;
  confidence_score?: number;
}): number {
  const pat = p._patternScore ?? 0;
  const hasL10 = p.l10HitRate != null;
  const l10 = hasL10 ? p.l10HitRate! : SCORE_WEIGHTS.l10Default;
  const penalty = hasL10 ? 0 : SCORE_WEIGHTS.missingL10Penalty;
  const conf = p.confidence_score ?? SCORE_WEIGHTS.confDefault;

  return pat * SCORE_WEIGHTS.pattern + l10 * SCORE_WEIGHTS.l10 + conf * SCORE_WEIGHTS.confidence + penalty;
}

describe('SweetSpot Parlay Builder - Scoring System', () => {
  beforeEach(() => {
    setScorePreset('balanced');
  });

  describe('SCORE_PRESETS', () => {
    it('has all three required presets', () => {
      expect(SCORE_PRESETS.balanced).toBeDefined();
      expect(SCORE_PRESETS.reliabilityMax).toBeDefined();
      expect(SCORE_PRESETS.sharp).toBeDefined();
    });

    it('balanced preset has correct weights', () => {
      expect(SCORE_PRESETS.balanced.pattern).toBe(1.0);
      expect(SCORE_PRESETS.balanced.l10).toBe(6.0);
      expect(SCORE_PRESETS.balanced.confidence).toBe(0.25);
      expect(SCORE_PRESETS.balanced.missingL10Penalty).toBe(-0.5);
    });
  });

  describe('Score Computation', () => {
    it('confidence breaks ties between equal L10/pattern picks', () => {
      const pickA = { _patternScore: 2, l10HitRate: 0.78, confidence_score: 0.92 };
      const pickB = { _patternScore: 2, l10HitRate: 0.78, confidence_score: 0.75 };
      expect(computeScore(pickA)).toBeGreaterThan(computeScore(pickB));
    });

    it('missing L10 picks cannot outrank known data picks', () => {
      const knownPick = { _patternScore: 2, l10HitRate: 0.7, confidence_score: 0.8 };
      const missingPick = { _patternScore: 2, l10HitRate: null, confidence_score: 0.85 };
      expect(computeScore(knownPick)).toBeGreaterThan(computeScore(missingPick));
    });
  });
});

describe('SweetSpot Parlay Builder - Ranked Recommendation Packs', () => {
  beforeEach(() => {
    setScorePreset('balanced');
  });

  it('produces deterministic 2-, 3-, and 4-leg packs for aggressive funnel', () => {
    const result = buildSweetSpotParlayCore({
      ...(frozenSlate as unknown as BuilderInput),
      funnelMode: 'aggressive',
    });

    expect(result.recommendations.twoLeg?.legs.map((l) => l.pick.player_name)).toMatchSnapshot();
    expect(result.recommendations.threeLeg?.legs.map((l) => l.pick.player_name)).toMatchSnapshot();
    expect(result.recommendations.fourLeg?.legs.map((l) => l.pick.player_name)).toMatchSnapshot();
  });

  it('core funnel stays narrower than aggressive', () => {
    const aggressive = buildSweetSpotParlayCore({
      ...(frozenSlate as unknown as BuilderInput),
      funnelMode: 'aggressive',
    });
    const core = buildSweetSpotParlayCore({
      ...(frozenSlate as unknown as BuilderInput),
      funnelMode: 'core',
    });

    expect(aggressive.poolStats.candidateCount).toBeGreaterThanOrEqual(core.poolStats.candidateCount);
  });

  it('returns ranked candidates ordered by safety score', () => {
    const result = buildSweetSpotParlayCore({
      ...(frozenSlate as unknown as BuilderInput),
      funnelMode: 'aggressive',
    });

    expect(result.rankedCandidates[0].score).toBeGreaterThanOrEqual(result.rankedCandidates[1].score);
  });

  it('collects traces for ranked candidates', () => {
    const result = buildSweetSpotParlayCore({
      ...(frozenSlate as unknown as BuilderInput),
      funnelMode: 'aggressive',
    });

    expect(result.traces.length).toBe(result.rankedCandidates.length);
  });
});

describe('SweetSpot Parlay Builder - scorePick function', () => {
  beforeEach(() => {
    setScorePreset('balanced');
  });

  it('exported scorePick matches computeScore helper', () => {
    const pick = { _patternScore: 2, l10HitRate: 0.75, confidence_score: 0.85 };
    expect(scorePick(pick)).toBeCloseTo(computeScore(pick), 5);
  });
});
