// Regression tests for the slate-outlier fade-mode side/odds flip contract.
// See mem://logic/betting/slate-outlier-side-flip for the underlying rule.

import {
  assertEquals,
  assertAlmostEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  playSide,
  publicSide,
  playAmericanOdds,
  playDecimalPrice,
  americanToDecimal,
} from '../_shared/slate-outlier-flip.ts';

// Helper to build a minimal alert-shaped object.
function alert(opts: {
  prediction?: string | null;
  mode?: string | null;
  original_side?: string | null;
  over_price?: number | null;
  under_price?: number | null;
}) {
  return {
    prediction: opts.prediction ?? null,
    metadata: {
      mode: opts.mode ?? null,
      original_side: opts.original_side ?? null,
      over_price: opts.over_price ?? null,
      under_price: opts.under_price ?? null,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// 1. Real-world inverted bug: public Under at -122, fade flips to Over @ +100
//    (Atlanta @ Cincinnati totals leg that triggered the original bug.)
// ───────────────────────────────────────────────────────────────────────
Deno.test('fade-mode: public Under flips to Over and uses over_price', () => {
  const a = alert({
    prediction: 'Under',
    mode: 'fade',
    original_side: 'Under',
    over_price: 100,
    under_price: -122,
  });
  assertEquals(publicSide(a), 'Under');
  assertEquals(playSide(a), 'Over');
  assertEquals(playAmericanOdds(a), 100, 'must use over_price after flip');
  assertAlmostEquals(playDecimalPrice(a), 2.0, 1e-6);
});

// ───────────────────────────────────────────────────────────────────────
// 2. Real-world: public Over at -155, fade flips to Under @ +110
//    (SGA blocks leg.)
// ───────────────────────────────────────────────────────────────────────
Deno.test('fade-mode: public Over flips to Under and uses under_price', () => {
  const a = alert({
    prediction: 'Over',
    mode: 'fade',
    original_side: 'Over',
    over_price: -155,
    under_price: 110,
  });
  assertEquals(publicSide(a), 'Over');
  assertEquals(playSide(a), 'Under');
  assertEquals(playAmericanOdds(a), 110, 'must use under_price after flip');
  assertAlmostEquals(playDecimalPrice(a), 2.10, 1e-6);
});

// ───────────────────────────────────────────────────────────────────────
// 3. No-flip path: when mode is not 'fade', side stays as prediction
//    and the corresponding price is used.
// ───────────────────────────────────────────────────────────────────────
Deno.test('non-fade-mode: side stays as prediction (no flip)', () => {
  const overPlay = alert({
    prediction: 'Over',
    mode: 'play',
    original_side: 'Over',
    over_price: -120,
    under_price: 100,
  });
  assertEquals(playSide(overPlay), 'Over');
  assertEquals(playAmericanOdds(overPlay), -120);

  const underPlay = alert({
    prediction: 'Under',
    mode: null, // unspecified mode === no flip
    original_side: 'Under',
    over_price: 105,
    under_price: -125,
  });
  assertEquals(playSide(underPlay), 'Under');
  assertEquals(playAmericanOdds(underPlay), -125);
});

// ───────────────────────────────────────────────────────────────────────
// 4. metadata.original_side takes precedence over a stale `prediction`
//    field. Even if prediction got mutated, the contract reads original_side.
// ───────────────────────────────────────────────────────────────────────
Deno.test('original_side takes precedence over prediction', () => {
  const a = alert({
    prediction: 'Over', // stale / inconsistent
    mode: 'fade',
    original_side: 'Under', // authoritative public side
    over_price: -150,
    under_price: 120,
  });
  assertEquals(publicSide(a), 'Under');
  assertEquals(playSide(a), 'Over');
  assertEquals(playAmericanOdds(a), -150);
});

// ───────────────────────────────────────────────────────────────────────
// 5. Case-insensitivity + parlay-odds invariance: combined odds for a
//    fade ticket must equal the product of the FADE-side decimal prices,
//    never the public-side prices.
// ───────────────────────────────────────────────────────────────────────
Deno.test('case-insensitive + ticket combined odds use post-flip prices', () => {
  const legs = [
    alert({ prediction: 'over', mode: 'FADE', original_side: 'OVER', over_price: -155, under_price: 110 }),  // flips to Under @ +110
    alert({ prediction: 'Under', mode: 'fade', original_side: 'Under', over_price: 100, under_price: -122 }), // flips to Over @ +100
    alert({ prediction: 'Under', mode: 'fade', original_side: 'Under', over_price: -122, under_price: 100 }), // flips to Over @ -122
  ];

  // Every leg must have flipped.
  assertEquals(legs.map(playSide), ['Under', 'Over', 'Over']);

  const playTotal = legs.reduce((acc, a) => acc * playDecimalPrice(a), 1);
  const publicTotal = legs.reduce(
    (acc, a) =>
      acc *
      americanToDecimal(
        publicSide(a) === 'Over' ? a.metadata!.over_price as number : a.metadata!.under_price as number,
      ),
    1,
  );

  // Expected fade-side decimal product: 2.10 * 2.00 * 1.819672... ≈ 7.6428
  assertAlmostEquals(playTotal, 2.10 * 2.0 * (1 + 100 / 122), 1e-6);
  // Must NOT equal the public-side product (which would be the bug we're guarding).
  if (Math.abs(playTotal - publicTotal) < 1e-6) {
    throw new Error('Combined odds collapsed to public-side product — flip regression!');
  }
});

// ───────────────────────────────────────────────────────────────────────
// 6. Defensive: missing odds on the play side should not throw,
//    should return null odds and a -110 (1.91) decimal fallback.
// ───────────────────────────────────────────────────────────────────────
Deno.test('missing play-side odds returns null and -110 decimal fallback', () => {
  const a = alert({
    prediction: 'Under',
    mode: 'fade',
    original_side: 'Under',
    over_price: null, // flip wants over_price, which is missing
    under_price: -122,
  });
  assertEquals(playSide(a), 'Over');
  assertEquals(playAmericanOdds(a), null);
  assertAlmostEquals(playDecimalPrice(a), 1.91, 1e-6);
});