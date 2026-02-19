import { describe, it, expect } from 'vitest';
import {
  demoGameContext,
  demoConfidencePicks,
  demoWhisperPicks,
  demoWhaleSignals,
} from '@/data/demoScoutData';

describe('Demo Scout Data Integrity', () => {
  it('demoGameContext has required fields', () => {
    expect(demoGameContext.eventId).toBeTruthy();
    expect(demoGameContext.homeTeam).toBeTruthy();
    expect(demoGameContext.awayTeam).toBeTruthy();
    expect(demoGameContext.commenceTime).toBeTruthy();
  });

  it('all confidence picks have required fields', () => {
    expect(demoConfidencePicks.length).toBeGreaterThan(0);
    for (const pick of demoConfidencePicks) {
      expect(pick.playerName).toBeTruthy();
      expect(pick.propType).toBeTruthy();
      expect(typeof pick.line).toBe('number');
      expect(typeof pick.currentValue).toBe('number');
      expect(['over', 'under']).toContain(pick.side);
    }
  });

  it('whisper picks include gameProgress', () => {
    for (const pick of demoWhisperPicks) {
      expect(typeof pick.gameProgress).toBe('number');
      expect(pick.gameProgress).toBeGreaterThanOrEqual(0);
      expect(pick.gameProgress).toBeLessThanOrEqual(1);
    }
  });

  it('whale signal keys match AI Whisper lookup format (lowercase player name)', () => {
    // CustomerAIWhisper looks up signals via: signals.get(pick.playerName.toLowerCase())
    const playerNamesLower = demoConfidencePicks.map(p => p.playerName.toLowerCase());

    for (const [key] of demoWhaleSignals) {
      expect(key).toBe(key.toLowerCase()); // Keys must be lowercase
      expect(playerNamesLower).toContain(key); // Keys must match a player
    }
  });

  it('whale signals have valid signal types', () => {
    for (const [, signal] of demoWhaleSignals) {
      expect(['STEAM', 'FREEZE', 'DIVERGENCE']).toContain(signal.signalType);
      expect(typeof signal.sharpScore).toBe('number');
    }
  });
});
