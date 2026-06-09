import { describe, it, expect } from 'vitest';
import { pickTopFadeAngle, type FadeAngle } from '@/hooks/useFadeAngles';

const make = (a: Partial<FadeAngle>): FadeAngle => ({
  player: 'Test Player',
  team: 'Test Team',
  sport: 'basketball_nba',
  status: 'QUESTIONABLE',
  severity: 'medium',
  detail: 'd',
  source: 'injury_reports',
  ...a,
});

describe('pickTopFadeAngle', () => {
  it('returns null for empty list', () => {
    expect(pickTopFadeAngle([])).toBeNull();
  });

  it('prefers higher severity over lower severity', () => {
    const top = pickTopFadeAngle([
      make({ severity: 'low', status: 'QUESTIONABLE' }),
      make({ severity: 'critical', status: 'OUT' }),
    ]);
    expect(top?.severity).toBe('critical');
    expect(top?.status).toBe('OUT');
  });

  it('breaks severity ties by status rank (OUT > DOUBTFUL > QUESTIONABLE)', () => {
    const top = pickTopFadeAngle([
      make({ severity: 'high', status: 'QUESTIONABLE' }),
      make({ severity: 'high', status: 'OUT' }),
      make({ severity: 'high', status: 'DOUBTFUL' }),
    ]);
    expect(top?.status).toBe('OUT');
  });

  it('ranks NEWS lowest when status rank only differentiates', () => {
    const top = pickTopFadeAngle([
      make({ severity: 'medium', status: 'NEWS' }),
      make({ severity: 'medium', status: 'MINUTES_RISK' }),
    ]);
    expect(top?.status).toBe('MINUTES_RISK');
  });

  it('preserves exploit metadata on the chosen angle', () => {
    const top = pickTopFadeAngle([
      make({
        severity: 'high',
        status: 'OUT',
        exploit: { kind: 'usage_shift', note: 'teammate out' },
      }),
      make({ severity: 'low', status: 'QUESTIONABLE' }),
    ]);
    expect(top?.exploit?.kind).toBe('usage_shift');
  });
});