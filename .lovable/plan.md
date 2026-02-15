

## Fix Parlay Generator: Dedup Mirrors + Over-Stacking Cap + Line Snapping

### Problems Identified

1. **Mirror parlays not caught by deduplication** -- The fingerprint includes the `side` field, so "Arizona spread UNDER 2.17" and "Arizona spread OVER 2.17" produce different fingerprints. Parlays sharing the same games/matchups but with flipped sides slip through.

2. **Over-stacking has no hard default** -- The anti-stacking variable `maxSameSidePerParlay` defaults to `99` when `winningPatterns` doesn't provide a value, effectively disabling the cap. The screenshot shows parlays with 2-3 OVER totals stacked together.

3. **Fractional lines (e.g., 2.1667)** -- Whale signal lines are raw averages that aren't snapped to valid sportsbook increments (0.5 steps for spreads/totals).

---

### Changes (single file)

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

#### 1. Side-agnostic mirror fingerprint

Add a second "mirror fingerprint" that strips the `side` from team legs, so two parlays covering the same set of games (regardless of over/under/home/away) are treated as duplicates.

```text
createParlayFingerprint  -- existing, keeps side (exact dupe)
createMirrorFingerprint  -- NEW, drops side (catches flipped mirrors)
```

Both fingerprint sets will be checked before accepting a parlay.

#### 2. Hard-code max 2 OVER totals per parlay

Change the default from `99` to `2`:

```typescript
const maxSameSidePerParlay = winningPatterns?.max_same_side_per_parlay || 2;
```

This ensures no parlay can have more than 2 legs of the same bet-type + side combination (e.g., `total_over`), matching the review engine's flagged failure pattern.

#### 3. Snap lines to valid sportsbook increments

Add a `snapLine` utility that rounds fractional lines to the nearest 0.5:

```typescript
function snapLine(raw: number): number {
  return Math.round(raw * 2) / 2;
}
```

Apply it when building team leg data (line 2947) and player leg data so lines like `2.1667` become `2.0` or `2.5`.

---

### Technical Details

| Change | Location (approx line) | Description |
|--------|----------------------|-------------|
| `createMirrorFingerprint()` | After line 2664 | New function, team legs keyed by matchup+bet_type only |
| Mirror fingerprint set | Lines 3056-3061 + 3291-3301 | Add `globalMirrorPrints` set, check both before accepting |
| Default cap `99` to `2` | Line 2812 | Hard default for `maxSameSidePerParlay` |
| `snapLine()` utility | After line 2664 | Round to nearest 0.5 |
| Apply `snapLine` to team legs | Line 2947 | `line: snapLine(teamPick.line)` |
| Apply `snapLine` to player legs | Where player `legData.line` is set | Same treatment |

