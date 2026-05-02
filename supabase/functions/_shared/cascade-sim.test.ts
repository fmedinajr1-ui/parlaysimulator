import { assert, assertEquals, assertAlmostEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildCascadeSim, formatCascadeSimLines } from './cascade-sim.ts';

Deno.test('all-STRONG 3-leg cascade → TAIL full has positive EV', () => {
  const sim = buildCascadeSim({ strong: 3, lean: 0, weak: 0 }, null, 100);
  assert(sim);
  assert(sim!.tailFull.prob > 0.2 && sim!.tailFull.prob < 0.3, `prob=${sim!.tailFull.prob}`);
  assert(sim!.tailFull.ev >= 0, `EV should be non-negative for all-STRONG, got ${sim!.tailFull.ev}`);
  assert(sim!.tailSmall.available, 'top-3 should be available with 3 STRONG');
});

Deno.test('all-WEAK 5-leg cascade → FADE positive EV, TAIL full near 0', () => {
  const sim = buildCascadeSim({ strong: 0, lean: 0, weak: 5 }, null, 100);
  assert(sim);
  assert(sim!.tailFull.prob < 0.05, `tail full prob should be tiny, got ${sim!.tailFull.prob}`);
  assert(sim!.fade.prob > 0.9, `fade prob should be huge, got ${sim!.fade.prob}`);
  assert(sim!.fade.ev > 0, `FADE EV should be positive, got ${sim!.fade.ev}`);
  assertEquals(sim!.tailSmall.available, false, 'tail small should be n/a (no non-WEAK legs)');
});

Deno.test('mixed 2S/2L/1W → tailSmall picks top 3 non-weak', () => {
  const sim = buildCascadeSim({ strong: 2, lean: 2, weak: 1 }, null, 100);
  assert(sim);
  assert(sim!.tailSmall.available);
  // top-3 = 2 STRONG (0.62) + 1 LEAN (0.52) = 0.62*0.62*0.52 ≈ 0.20
  assertAlmostEquals(sim!.tailSmall.prob, 0.62 * 0.62 * 0.52, 0.01);
});

Deno.test('empty verdict_counts → returns null', () => {
  const sim = buildCascadeSim({ strong: 0, lean: 0, weak: 0 }, null, 100);
  assertEquals(sim, null);
});

Deno.test('bankroll=0 → all stakes 0, no NaN, formatter renders skip', () => {
  const sim = buildCascadeSim({ strong: 3, lean: 1, weak: 1 }, null, 0);
  assert(sim);
  assertEquals(sim!.tailFull.stake, 0);
  assertEquals(sim!.tailSmall.stake, 0);
  assertEquals(sim!.fade.stake, 0);
  assert(!Number.isNaN(sim!.tailFull.ev));
  const lines = formatCascadeSimLines(sim!, 5);
  assert(lines.some((l) => l.includes('skip')), `expected 'skip' in: ${lines.join(' | ')}`);
});
