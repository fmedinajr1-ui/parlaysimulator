

# Fix Duplicate Variable & Re-Run Generator

## Problem
The `bot-generate-daily-parlays` function has a boot error caused by a duplicate `const oddsKey` declaration (lines 1063 and 1066). This was likely introduced during the last edit when the game schedule gate was added alongside existing code.

## Fix

### 1. Remove duplicate `oddsKey` declaration (line 1066)
In `supabase/functions/bot-generate-daily-parlays/index.ts`, lines 1063-1067 currently read:

```typescript
const oddsKey = `${pick.player_name}_${pick.prop_type}`.toLowerCase();
const hasRealLine = oddsMap.has(oddsKey) || ...;

const oddsKey = `${pick.player_name}_${pick.prop_type}`.toLowerCase();  // DUPLICATE - remove this
const odds = oddsMap.get(oddsKey) || { ... };
```

Delete line 1066 (the second `const oddsKey` declaration). The first declaration on line 1063 already sets the variable, and line 1067 can reuse it.

### 2. Deploy and invoke
After fixing, deploy the function and call it with `{"date": "2025-02-11"}` to generate today's parlays.

### 3. Compare to Feb 9 baseline
- Feb 9 baseline: **55% void rate** (28 of 51 parlays voided due to players without games)
- Today's run has two new safety gates active:
  - **Real-line gate**: Only includes picks with verified sportsbook lines
  - **Game schedule gate**: Cross-references player teams against `upcoming_games_cache`
- We expect the void rate to drop to near 0%

