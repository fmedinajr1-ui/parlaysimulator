import { describe, it, expect } from 'vitest';
import {
  canAddPlayerLeg,
  violatesComboOverlap,
  noSamePlayer,
  noBaseComboOverlap,
  noSameEventInSafeMode,
  normalizePlayerName,
  normalizeStatType,
  selectBestPropFromList,
  assertNoDuplicatePlayers,
  LegBase,
} from './parlayVetoUtils';

describe('normalizePlayerName', () => {
  it('normalizes player names to lowercase', () => {
    expect(normalizePlayerName({ player_name: 'LeBron James' })).toBe('lebron james');
  });

  it('handles playerName field', () => {
    expect(normalizePlayerName({ playerName: 'Stephen Curry' })).toBe('stephen curry');
  });

  it('trims whitespace', () => {
    expect(normalizePlayerName({ player_name: '  Kevin Durant  ' })).toBe('kevin durant');
  });

  it('handles empty/missing values', () => {
    expect(normalizePlayerName({})).toBe('');
    expect(normalizePlayerName({ player_name: undefined })).toBe('');
  });
});

describe('normalizeStatType', () => {
  it('normalizes pra variations', () => {
    expect(normalizeStatType({ stat_type: 'player_points_rebounds_assists' })).toBe('pra');
    expect(normalizeStatType({ stat_type: 'points_rebounds_assists' })).toBe('pra');
  });

  it('normalizes pr variations', () => {
    expect(normalizeStatType({ stat_type: 'player_points_rebounds' })).toBe('pr');
    expect(normalizeStatType({ stat_type: 'points_rebounds' })).toBe('pr');
  });

  it('normalizes pa variations', () => {
    expect(normalizeStatType({ stat_type: 'player_points_assists' })).toBe('pa');
    expect(normalizeStatType({ stat_type: 'points_assists' })).toBe('pa');
  });

  it('normalizes ra variations', () => {
    expect(normalizeStatType({ stat_type: 'player_rebounds_assists' })).toBe('ra');
    expect(normalizeStatType({ stat_type: 'rebounds_assists' })).toBe('ra');
  });

  it('normalizes base stats', () => {
    expect(normalizeStatType({ stat_type: 'player_points' })).toBe('points');
    expect(normalizeStatType({ stat_type: 'player_rebounds' })).toBe('rebounds');
    expect(normalizeStatType({ stat_type: 'player_assists' })).toBe('assists');
  });

  it('handles propType field', () => {
    expect(normalizeStatType({ propType: 'player_points' })).toBe('points');
  });
});

describe('canAddPlayerLeg', () => {
  it('returns true for empty player count', () => {
    expect(canAddPlayerLeg({}, 'LeBron James')).toBe(true);
  });

  it('returns true for new player', () => {
    const playerCount = { 'stephen curry': 1 };
    expect(canAddPlayerLeg(playerCount, 'LeBron James')).toBe(true);
  });

  it('returns false for existing player', () => {
    const playerCount = { 'lebron james': 1 };
    expect(canAddPlayerLeg(playerCount, 'LeBron James')).toBe(false);
  });

  it('handles case-insensitive player names', () => {
    const playerCount = { 'lebron james': 1 };
    expect(canAddPlayerLeg(playerCount, 'LEBRON JAMES')).toBe(false);
    expect(canAddPlayerLeg(playerCount, 'LeBron James')).toBe(false);
  });

  it('trims whitespace from player names', () => {
    const playerCount = { 'lebron james': 1 };
    expect(canAddPlayerLeg(playerCount, '  LeBron James  ')).toBe(false);
  });
});

describe('violatesComboOverlap', () => {
  it('returns false when no existing legs', () => {
    const candidate: LegBase = { player_name: 'LeBron James', stat_type: 'points' };
    expect(violatesComboOverlap([], candidate)).toBe(false);
  });

  it('returns false for different players', () => {
    const existing: LegBase[] = [{ player_name: 'Stephen Curry', stat_type: 'points' }];
    const candidate: LegBase = { player_name: 'LeBron James', stat_type: 'pra' };
    expect(violatesComboOverlap(existing, candidate)).toBe(false);
  });

  it('returns true for points + PRA same player', () => {
    const existing: LegBase[] = [{ player_name: 'LeBron James', stat_type: 'points' }];
    const candidate: LegBase = { player_name: 'LeBron James', stat_type: 'pra' };
    expect(violatesComboOverlap(existing, candidate)).toBe(true);
  });

  it('returns true for PRA + points same player', () => {
    const existing: LegBase[] = [{ player_name: 'LeBron James', stat_type: 'pra' }];
    const candidate: LegBase = { player_name: 'LeBron James', stat_type: 'points' };
    expect(violatesComboOverlap(existing, candidate)).toBe(true);
  });

  it('returns true for rebounds + PR same player', () => {
    const existing: LegBase[] = [{ player_name: 'LeBron James', stat_type: 'rebounds' }];
    const candidate: LegBase = { player_name: 'LeBron James', stat_type: 'pr' };
    expect(violatesComboOverlap(existing, candidate)).toBe(true);
  });

  it('returns true for assists + PA same player', () => {
    const existing: LegBase[] = [{ player_name: 'LeBron James', stat_type: 'assists' }];
    const candidate: LegBase = { player_name: 'LeBron James', stat_type: 'pa' };
    expect(violatesComboOverlap(existing, candidate)).toBe(true);
  });

  it('returns true for rebounds + RA same player', () => {
    const existing: LegBase[] = [{ player_name: 'LeBron James', stat_type: 'rebounds' }];
    const candidate: LegBase = { player_name: 'LeBron James', stat_type: 'ra' };
    expect(violatesComboOverlap(existing, candidate)).toBe(true);
  });

  it('returns false for points + rebounds same player (no combo)', () => {
    const existing: LegBase[] = [{ player_name: 'LeBron James', stat_type: 'points' }];
    const candidate: LegBase = { player_name: 'LeBron James', stat_type: 'rebounds' };
    expect(violatesComboOverlap(existing, candidate)).toBe(false);
  });

  it('handles playerName field (alternative format)', () => {
    const existing: LegBase[] = [{ playerName: 'LeBron James', propType: 'points' }];
    const candidate: LegBase = { playerName: 'LeBron James', propType: 'pra' };
    expect(violatesComboOverlap(existing, candidate)).toBe(true);
  });

  it('returns true for combo + combo same player', () => {
    const existing: LegBase[] = [{ player_name: 'LeBron James', stat_type: 'pra' }];
    const candidate: LegBase = { player_name: 'LeBron James', stat_type: 'pr' };
    expect(violatesComboOverlap(existing, candidate)).toBe(true);
  });
});

describe('noSamePlayer', () => {
  it('returns true for empty legs', () => {
    expect(noSamePlayer([])).toBe(true);
  });

  it('returns true for unique players', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James', stat_type: 'points' },
      { player_name: 'Stephen Curry', stat_type: 'points' },
      { player_name: 'Kevin Durant', stat_type: 'rebounds' },
    ];
    expect(noSamePlayer(legs)).toBe(true);
  });

  it('returns false for duplicate players', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James', stat_type: 'points' },
      { player_name: 'LeBron James', stat_type: 'assists' },
    ];
    expect(noSamePlayer(legs)).toBe(false);
  });

  it('handles case-insensitive matching', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James', stat_type: 'points' },
      { player_name: 'LEBRON JAMES', stat_type: 'assists' },
    ];
    expect(noSamePlayer(legs)).toBe(false);
  });

  it('returns true for single leg', () => {
    const legs: LegBase[] = [{ player_name: 'LeBron James', stat_type: 'points' }];
    expect(noSamePlayer(legs)).toBe(true);
  });
});

describe('noBaseComboOverlap', () => {
  it('returns true for no overlapping combos', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James', stat_type: 'points' },
      { player_name: 'Stephen Curry', stat_type: 'pra' },
    ];
    expect(noBaseComboOverlap(legs)).toBe(true);
  });

  it('returns false for points + PRA same player', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James', stat_type: 'points' },
      { player_name: 'LeBron James', stat_type: 'pra' },
    ];
    expect(noBaseComboOverlap(legs)).toBe(false);
  });

  it('returns false for rebounds + PR same player', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James', stat_type: 'rebounds' },
      { player_name: 'LeBron James', stat_type: 'pr' },
    ];
    expect(noBaseComboOverlap(legs)).toBe(false);
  });

  it('returns true for points + rebounds same player (allowed)', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James', stat_type: 'points' },
      { player_name: 'LeBron James', stat_type: 'rebounds' },
    ];
    expect(noBaseComboOverlap(legs)).toBe(true);
  });

  it('handles empty legs', () => {
    expect(noBaseComboOverlap([])).toBe(true);
  });

  it('handles single leg', () => {
    const legs: LegBase[] = [{ player_name: 'LeBron James', stat_type: 'pra' }];
    expect(noBaseComboOverlap(legs)).toBe(true);
  });
});

describe('noSameEventInSafeMode', () => {
  it('returns true in high_risk mode regardless of events', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James', event_id: 'event1' },
      { player_name: 'Stephen Curry', event_id: 'event1' },
    ];
    expect(noSameEventInSafeMode(legs, 'high_risk')).toBe(true);
  });

  it('returns true for unique events in safe mode', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James', event_id: 'event1' },
      { player_name: 'Stephen Curry', event_id: 'event2' },
    ];
    expect(noSameEventInSafeMode(legs, 'safe')).toBe(true);
  });

  it('returns false for same event in safe mode', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James', event_id: 'event1' },
      { player_name: 'Stephen Curry', event_id: 'event1' },
    ];
    expect(noSameEventInSafeMode(legs, 'safe')).toBe(false);
  });

  it('handles missing event_id gracefully', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James' },
      { player_name: 'Stephen Curry' },
    ];
    expect(noSameEventInSafeMode(legs, 'safe')).toBe(true);
  });

  it('handles eventId field (alternative format)', () => {
    const legs: LegBase[] = [
      { playerName: 'LeBron James', eventId: 'event1' },
      { playerName: 'Stephen Curry', eventId: 'event1' },
    ];
    expect(noSameEventInSafeMode(legs, 'safe')).toBe(false);
  });
});

describe('selectBestPropFromList', () => {
  it('returns null for empty list', () => {
    expect(selectBestPropFromList([])).toBe(null);
  });

  it('returns the highest quality score pick', () => {
    const picks = [
      { stat_type: 'points', hit_rate_over_10: 0.6, edge: 2, volatility: 0.3, recommendation: 'OVER' },
      { stat_type: 'rebounds', hit_rate_over_10: 0.8, edge: 3, volatility: 0.2, recommendation: 'OVER' },
    ];
    const result = selectBestPropFromList(picks);
    expect(result?.stat_type).toBe('rebounds');
  });

  it('factors in stat safety', () => {
    const picks = [
      { stat_type: 'pra', hit_rate_over_10: 0.7, edge: 4, volatility: 0.2, recommendation: 'OVER' },
      { stat_type: 'ra', hit_rate_over_10: 0.7, edge: 4, volatility: 0.2, recommendation: 'OVER' },
    ];
    const result = selectBestPropFromList(picks);
    // ra has higher STAT_SAFETY (5) vs pra (1), so ra should win
    expect(result?.stat_type).toBe('ra');
  });

  it('uses under hit rate for UNDER picks', () => {
    const picks = [
      { stat_type: 'points', hit_rate_under_10: 0.8, edge: 2, volatility: 0.2, recommendation: 'UNDER' },
    ];
    const result = selectBestPropFromList(picks);
    expect(result?.stat_type).toBe('points');
  });
});

describe('assertNoDuplicatePlayers', () => {
  it('does not throw for unique players', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James' },
      { player_name: 'Stephen Curry' },
    ];
    expect(() => assertNoDuplicatePlayers(legs, 'TEST')).not.toThrow();
  });

  it('throws for duplicate players', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James' },
      { player_name: 'LeBron James' },
    ];
    expect(() => assertNoDuplicatePlayers(legs, 'TEST')).toThrow('Invariant violation');
  });
});

describe('Bub Carrington regression test', () => {
  it('prevents assists + points from same player', () => {
    const legs: LegBase[] = [
      { player_name: 'Bub Carrington', stat_type: 'assists' },
      { player_name: 'Bub Carrington', stat_type: 'points' },
    ];
    expect(noSamePlayer(legs)).toBe(false);
  });

  it('prevents PRA when player already has points', () => {
    const existing: LegBase[] = [
      { player_name: 'Bub Carrington', stat_type: 'points' },
    ];
    const candidate: LegBase = { player_name: 'Bub Carrington', stat_type: 'pra' };
    expect(violatesComboOverlap(existing, candidate)).toBe(true);
  });

  it('blocks all three props from same player via noSamePlayer', () => {
    const legs: LegBase[] = [
      { player_name: 'Bub Carrington', stat_type: 'assists' },
      { player_name: 'Bub Carrington', stat_type: 'points' },
      { player_name: 'Bub Carrington', stat_type: 'pra' },
    ];
    expect(noSamePlayer(legs)).toBe(false);
  });

  it('correctly identifies combo overlap in Bub scenario', () => {
    const legs: LegBase[] = [
      { player_name: 'Bub Carrington', stat_type: 'assists' },
      { player_name: 'Bub Carrington', stat_type: 'pra' },
    ];
    expect(noBaseComboOverlap(legs)).toBe(false);
  });
});

describe('Edge cases', () => {
  it('handles null and undefined values', () => {
    expect(canAddPlayerLeg({}, '')).toBe(true);
    expect(violatesComboOverlap([], { player_name: '', stat_type: '' })).toBe(false);
  });

  it('handles mixed field formats in same array', () => {
    const legs: LegBase[] = [
      { player_name: 'LeBron James', stat_type: 'points' },
      { playerName: 'Stephen Curry', propType: 'rebounds' },
    ];
    expect(noSamePlayer(legs)).toBe(true);
  });

  it('handles very long player names', () => {
    const longName = 'Giannis Antetokounmpo The Greek Freak';
    const playerCount = { [longName.toLowerCase()]: 1 };
    expect(canAddPlayerLeg(playerCount, longName)).toBe(false);
  });
});
