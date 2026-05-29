import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  evaluateHealthGate,
  isFixedPayoutBook,
  type HealthGateBundle,
} from './velocity-spike-health-gate.ts';

function bundle(opts: {
  injury?: Record<string, any>;
  form?: Partial<{ games: number; ab: number; hits: number; total_bases: number; hrs: number; k: number }>;
  name?: string;
}): HealthGateBundle {
  const b: HealthGateBundle = { injuries: new Map(), mlbForm: new Map() };
  const k = (opts.name ?? 'Ronald Acuna Jr.').toLowerCase();
  if (opts.injury) {
    b.injuries.set(k, {
      status: opts.injury.status ?? null,
      injury_type: opts.injury.injury_type ?? null,
      injury_detail: opts.injury.injury_detail ?? null,
      impact_score: opts.injury.impact_score ?? null,
      updated_at: opts.injury.updated_at ?? null,
    });
  }
  if (opts.form) {
    const games = opts.form.games ?? 5;
    const ab = opts.form.ab ?? 0;
    const hits = opts.form.hits ?? 0;
    const total_bases = opts.form.total_bases ?? hits;
    b.mlbForm.set(k, {
      games,
      ab,
      hits,
      total_bases,
      hrs: opts.form.hrs ?? 0,
      k: opts.form.k ?? 0,
      ba: ab > 0 ? hits / ab : 0,
      l5_hits_per_game: games > 0 ? hits / games : 0,
      l5_tb_per_game: games > 0 ? total_bases / games : 0,
    });
  }
  return b;
}

Deno.test('blocks cold MLB Hits Over (BA < .200)', () => {
  const b = bundle({ form: { games: 5, ab: 20, hits: 3, total_bases: 4 } });
  const r = evaluateHealthGate(
    { player_name: 'Ronald Acuna Jr.', sport: 'MLB', prop_type: 'batter_hits', side: 'Over', line: 0.5 },
    b,
  );
  assertEquals(r.block, true);
});

Deno.test('blocks contact-prop Over when player has hamstring injury', () => {
  const b = bundle({ injury: { status: 'GTD', injury_detail: 'left hamstring strain', impact_score: 4 } });
  const r = evaluateHealthGate(
    { player_name: 'Ronald Acuna Jr.', sport: 'MLB', prop_type: 'batter_total_bases', side: 'Over', line: 1.5 },
    b,
  );
  assertEquals(r.block, true);
});

Deno.test('lets healthy hot hitter through with no warning', () => {
  const b = bundle({ form: { games: 5, ab: 20, hits: 7, total_bases: 12, k: 3 } });
  const r = evaluateHealthGate(
    { player_name: 'Ronald Acuna Jr.', sport: 'MLB', prop_type: 'batter_hits', side: 'Over', line: 0.5 },
    b,
  );
  assertEquals(r.block, false);
  assertEquals(r.soft_warn, null);
});

Deno.test('hard-blocks any prop when player is listed OUT', () => {
  const b = bundle({ injury: { status: 'OUT', injury_detail: 'thumb bone bruise' } });
  const r = evaluateHealthGate(
    { player_name: 'Ronald Acuna Jr.', sport: 'MLB', prop_type: 'batter_total_bases', side: 'Over', line: 1.5 },
    b,
  );
  assertEquals(r.block, true);
});

Deno.test('isFixedPayoutBook recognizes PrizePicks/Underdog and rejects FanDuel', () => {
  assertEquals(isFixedPayoutBook('prizepicks'), true);
  assertEquals(isFixedPayoutBook('PrizePicks'), true);
  assertEquals(isFixedPayoutBook('underdog'), true);
  assertEquals(isFixedPayoutBook('fanduel'), false);
  assertEquals(isFixedPayoutBook(null), false);
});