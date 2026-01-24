import { describe, it, expect, beforeEach } from 'vitest';
import frozenSlate from '../__fixtures__/frozen_slate.json';
import { 
  buildSweetSpotParlayCore,
  SCORE_PRESETS, 
  SCORE_WEIGHTS, 
  setScorePreset, 
  scorePick,
  type ScorePresetKey,
  type BuilderInput,
} from './useSweetSpotParlayBuilder';

// Helper to compute score using same logic as scorePick
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

  return (
    (pat * SCORE_WEIGHTS.pattern) +
    (l10 * SCORE_WEIGHTS.l10) +
    (conf * SCORE_WEIGHTS.confidence) +
    penalty
  );
}

describe('SweetSpot Parlay Builder - Scoring System', () => {
  beforeEach(() => {
    // Reset to balanced preset for consistent tests
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

    it('sharp preset gives more weight to confidence', () => {
      expect(SCORE_PRESETS.sharp.confidence).toBeGreaterThan(SCORE_PRESETS.balanced.confidence);
    });

    it('reliabilityMax preset gives more weight to L10', () => {
      expect(SCORE_PRESETS.reliabilityMax.l10).toBeGreaterThan(SCORE_PRESETS.balanced.l10);
    });
  });

  describe('setScorePreset', () => {
    it('switches to sharp preset', () => {
      setScorePreset('sharp');
      expect(SCORE_WEIGHTS.presetKey).toBe('sharp');
      expect(SCORE_WEIGHTS.confidence).toBe(0.35);
    });

    it('switches back to balanced', () => {
      setScorePreset('sharp');
      setScorePreset('balanced');
      expect(SCORE_WEIGHTS.presetKey).toBe('balanced');
      expect(SCORE_WEIGHTS.confidence).toBe(0.25);
    });
  });

  describe('Score Computation', () => {
    it('confidence breaks ties between equal L10/pattern picks', () => {
      const pickA = { _patternScore: 2, l10HitRate: 0.78, confidence_score: 0.92 };
      const pickB = { _patternScore: 2, l10HitRate: 0.78, confidence_score: 0.75 };
      
      const scoreA = computeScore(pickA);
      const scoreB = computeScore(pickB);
      
      expect(scoreA).toBeGreaterThan(scoreB);
    });

    it('missing L10 picks cannot outrank known data picks', () => {
      const knownPick = { _patternScore: 2, l10HitRate: 0.70, confidence_score: 0.80 };
      const missingPick = { _patternScore: 2, l10HitRate: null, confidence_score: 0.85 };
      
      const knownScore = computeScore(knownPick);
      const missingScore = computeScore(missingPick);
      
      expect(knownScore).toBeGreaterThan(missingScore);
    });

    it('pattern score contributes correctly', () => {
      const lowPattern = { _patternScore: 1, l10HitRate: 0.70, confidence_score: 0.80 };
      const highPattern = { _patternScore: 3, l10HitRate: 0.70, confidence_score: 0.80 };
      
      const lowScore = computeScore(lowPattern);
      const highScore = computeScore(highPattern);
      
      // Difference should be exactly 2 (3-1) * pattern weight
      expect(highScore - lowScore).toBeCloseTo(2 * SCORE_WEIGHTS.pattern, 2);
    });

    it('L10 is the primary signal', () => {
      const lowL10 = { _patternScore: 2, l10HitRate: 0.55, confidence_score: 0.90 };
      const highL10 = { _patternScore: 2, l10HitRate: 0.85, confidence_score: 0.70 };
      
      const lowScore = computeScore(lowL10);
      const highScore = computeScore(highL10);
      
      // L10 should dominate even though lowL10 has higher confidence
      expect(highScore).toBeGreaterThan(lowScore);
    });
  });

  describe('Preset Comparison', () => {
    it('different presets produce different scores for same pick', () => {
      const pick = { _patternScore: 2, l10HitRate: 0.75, confidence_score: 0.85 };
      
      setScorePreset('balanced');
      const balancedScore = computeScore(pick);
      
      setScorePreset('sharp');
      const sharpScore = computeScore(pick);
      
      setScorePreset('reliabilityMax');
      const reliabilityScore = computeScore(pick);
      
      // All three should be different (unless by coincidence)
      expect(balancedScore).not.toBe(sharpScore);
      expect(balancedScore).not.toBe(reliabilityScore);
    });

    it('sharp preset amplifies confidence influence', () => {
      const highConf = { _patternScore: 2, l10HitRate: 0.75, confidence_score: 0.95 };
      const lowConf = { _patternScore: 2, l10HitRate: 0.75, confidence_score: 0.65 };
      
      setScorePreset('balanced');
      const balancedDiff = computeScore(highConf) - computeScore(lowConf);
      
      setScorePreset('sharp');
      const sharpDiff = computeScore(highConf) - computeScore(lowConf);
      
      // Sharp preset should make confidence difference more pronounced
      expect(sharpDiff).toBeGreaterThan(balancedDiff);
    });
  });
});

describe('SweetSpot Parlay Builder - Golden Snapshot', () => {
  beforeEach(() => {
    setScorePreset('balanced');
  });

  it('produces stable Optimal legs for frozen slate', () => {
    const result = buildSweetSpotParlayCore(frozenSlate as unknown as BuilderInput);

    // Lock player selection order by category
    expect(
      result.selectedLegs.map(l => `${l.pick.player_name}|${l.pick.category}`)
    ).toMatchSnapshot();
  });

  it('locks score values for frozen slate', () => {
    const result = buildSweetSpotParlayCore(frozenSlate as unknown as BuilderInput);

    // Lock score values (to 3 decimal places)
    expect(
      result.selectedLegs.map(l => ({
        player: l.pick.player_name,
        score: l.score.toFixed(3),
      }))
    ).toMatchSnapshot();
  });

  it('preset switch changes weights (sanity)', () => {
    setScorePreset('sharp');
    expect(SCORE_WEIGHTS.confidence).toBe(0.35);

    setScorePreset('reliabilityMax');
    expect(SCORE_WEIGHTS.l10).toBe(7.0);
  });

  it('different presets produce different orderings', () => {
    setScorePreset('balanced');
    const balanced = buildSweetSpotParlayCore(frozenSlate as unknown as BuilderInput);

    setScorePreset('sharp');
    const sharp = buildSweetSpotParlayCore(frozenSlate as unknown as BuilderInput);

    // Scores should differ when preset changes
    if (balanced.selectedLegs.length > 0 && sharp.selectedLegs.length > 0) {
      const balancedFirstScore = balanced.selectedLegs[0].score;
      const sharpFirstScore = sharp.selectedLegs[0].score;
      expect(balancedFirstScore).not.toBe(sharpFirstScore);
    }
  });

  it('collects decision traces for all selected picks', () => {
    const result = buildSweetSpotParlayCore(frozenSlate as unknown as BuilderInput);
    
    // Should have traces for selected picks
    const selectedTraces = result.traces.filter(t => t.selected);
    expect(selectedTraces.length).toBe(result.selectedLegs.length);
  });

  it('diagnostics tracks filtering correctly', () => {
    const result = buildSweetSpotParlayCore(frozenSlate as unknown as BuilderInput);
    
    expect(result.diagnostics.totalCandidates).toBe(frozenSlate.picks.length);
    expect(result.diagnostics.selectedCount).toBe(result.selectedLegs.length);
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

  it('handles missing l10HitRate correctly', () => {
    const pickWithL10 = { _patternScore: 2, l10HitRate: 0.70, confidence_score: 0.80 };
    const pickWithoutL10 = { _patternScore: 2, l10HitRate: null, confidence_score: 0.80 };
    
    // Pick without L10 should have penalty applied
    expect(scorePick(pickWithL10)).toBeGreaterThan(scorePick(pickWithoutL10));
  });

  it('uses confDefault when confidence_score is missing', () => {
    const pickWithConf = { _patternScore: 2, l10HitRate: 0.70, confidence_score: 0.80 };
    const pickWithoutConf = { _patternScore: 2, l10HitRate: 0.70 };
    
    // Both should produce valid scores
    expect(typeof scorePick(pickWithConf)).toBe('number');
    expect(typeof scorePick(pickWithoutConf)).toBe('number');
    expect(scorePick(pickWithoutConf)).toBeGreaterThan(0);
  });
});
