import { describe, it, expect } from 'vitest';
import { getSharpSportLabel } from '@/components/results/SharpMoneyAlerts';
import { computeDefaultSport } from '@/components/pools/SubmitLegModal';
import { SPORTS, getSportDisplay, getSportKey } from '@/components/team-bets/TeamBetsDashboard';

describe('SharpMoneyAlerts.getSharpSportLabel', () => {
  it('maps baseball_mlb -> MLB', () => {
    expect(getSharpSportLabel('baseball_mlb')).toBe('MLB');
  });
  it('maps tennis_atp and tennis_wta -> Tennis', () => {
    expect(getSharpSportLabel('tennis_atp')).toBe('Tennis');
    expect(getSharpSportLabel('tennis_wta')).toBe('Tennis');
  });
  it('still maps basketball_nba -> NBA', () => {
    expect(getSharpSportLabel('basketball_nba')).toBe('NBA');
  });
  it('falls back to raw value for unknown sport', () => {
    expect(getSharpSportLabel('cricket_ipl')).toBe('cricket_ipl');
  });
});

describe('SubmitLegModal.computeDefaultSport', () => {
  it('defaults to MLB in season (April-October)', () => {
    for (const m of [3, 4, 5, 6, 7, 8, 9]) {
      // JS months are 0-indexed; m here is 0-9 representing Apr-Oct
      const d = new Date(2026, m, 15);
      expect(computeDefaultSport(d)).toBe('MLB');
    }
  });
  it('defaults to NBA in offseason (Nov-Mar)', () => {
    for (const m of [0, 1, 2, 10, 11]) {
      const d = new Date(2026, m, 15);
      expect(computeDefaultSport(d)).toBe('NBA');
    }
  });
});

describe('TeamBetsDashboard sport mappings', () => {
  it('SPORTS tabs include MLB and TENNIS', () => {
    expect(SPORTS).toContain('MLB');
    expect(SPORTS).toContain('TENNIS');
  });
  it('getSportDisplay maps baseball_mlb -> MLB and tennis_* -> TENNIS', () => {
    expect(getSportDisplay('baseball_mlb')).toBe('MLB');
    expect(getSportDisplay('tennis_atp')).toBe('TENNIS');
    expect(getSportDisplay('tennis_wta')).toBe('TENNIS');
  });
  it('getSportKey round-trips display values', () => {
    expect(getSportKey('MLB')).toBe('baseball_mlb');
    expect(getSportKey('TENNIS')).toBe('tennis_atp');
    expect(getSportKey('NBA')).toBe('basketball_nba');
  });
});