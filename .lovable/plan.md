

# Fix: Add Spread Cap to Single-Pick Fallback

## Problem

The `MAX_SPREAD_LINE = 10` enforcement only exists in the multi-leg parlay builder (line 3622). The **single-pick fallback** path (line 4596+) has no spread cap, so high spreads like Miss Valley St +14.5 slip through unchecked.

## Solution

Add a spread cap check in the single-pick loop, right after the weight check block (~line 4648), before the dedup key. If a spread pick exceeds `MAX_SPREAD_LINE`, skip it entirely. No alternate-line shopping for singles — just block it.

## Technical Details

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Insert after line ~4648** (after the weight check, before the dedup key):

```text
// SPREAD CAP for singles: block spreads above MAX_SPREAD_LINE
if (
  (pick.bet_type === 'spread' || pick.prop_type === 'spread') &&
  Math.abs(pick.line || 0) >= MAX_SPREAD_LINE
) {
  console.log(`[Bot v2] SINGLE SKIP (SpreadCap): ${pick.player_name || pick.home_team} spread ${pick.line} exceeds max ${MAX_SPREAD_LINE}`);
  continue;
}
```

**DB cleanup**: Delete the existing Miss Valley St +14.5 single pick from today:

```sql
DELETE FROM bot_daily_parlays
WHERE parlay_date = '2026-02-16'
  AND leg_count = 1
  AND legs->0->>'prop_type' = 'spread'
  AND (legs->0->>'line')::float >= 10;
```

## Impact

| Before | After |
|--------|-------|
| Singles allow any spread size | Singles block spreads with abs(line) >= 10 |
| Miss Valley St +14.5 included | Blocked automatically |

