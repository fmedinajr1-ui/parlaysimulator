

# Fix: Block Duplicate Single Picks Across Runs

## Problem

The single-pick fallback uses an in-memory `usedSingleKeys` set for deduplication, but this resets on every function invocation. When the generator runs multiple times per day (e.g., at 16:23 and 16:24), identical single picks get inserted again, inflating the count (36 picks = 18 x 2 runs).

Multi-leg parlays already handle this via `globalFingerprints` pre-loaded from the DB, but single picks bypass that system entirely.

## Solution

Pre-load existing single-pick dedup keys from the database at the start of the run, and seed `usedSingleKeys` with them. This way, if a single pick was already inserted in a prior run, it gets skipped.

## Changes to `bot-generate-daily-parlays/index.ts`

### 1. Pre-load existing single-pick keys from DB (after the globalFingerprints block, ~line 4535)

After the existing fingerprint pre-loading block, add a second pass that extracts dedup keys from existing 1-leg parlays for the target date:

```text
// Pre-load single-pick dedup keys from existing DB entries
const existingSingleKeys = new Set<string>();
if (existingParlays) {
  for (const p of existingParlays) {
    if (p.leg_count === 1) {
      const legs = Array.isArray(p.legs) ? p.legs : JSON.parse(p.legs);
      const leg = legs[0];
      if (leg) {
        const key = leg.type === 'team'
          ? `${leg.home_team}_${leg.away_team}_${leg.bet_type}_${leg.side}`.toLowerCase()
          : `${leg.player_name}_${leg.prop_type}_${leg.side}`.toLowerCase();
        existingSingleKeys.add(key);
      }
    }
  }
  console.log(`[Bot v2] Pre-loaded ${existingSingleKeys.size} single-pick keys`);
}
```

### 2. Seed `usedSingleKeys` with pre-loaded keys (~line 4583)

Change the initialization of `usedSingleKeys` from an empty set to a copy of the pre-loaded keys:

```text
// Before (current):
const usedSingleKeys = new Set<string>();

// After:
const usedSingleKeys = new Set<string>(existingSingleKeys);
```

This ensures any single pick that was already written to the DB in a previous run gets skipped via the existing `if (usedSingleKeys.has(singleKey)) continue;` check at line 4636.

## Technical Details

| Aspect | Detail |
|--------|--------|
| File modified | `supabase/functions/bot-generate-daily-parlays/index.ts` |
| Lines affected | ~4535 (add pre-load block), ~4583 (seed set) |
| Risk | Low -- uses the same dedup key format already in use |
| Backward compatible | Yes -- only prevents future duplicates, does not delete existing ones |

## What This Fixes

- Prevents duplicate single picks when the generator runs multiple times per day
- Uses the same composite key format (`home_away_bettype_side` or `player_proptype_side`) already used for in-run dedup
- Leverages the existing `existingParlays` query (no extra DB call needed)

