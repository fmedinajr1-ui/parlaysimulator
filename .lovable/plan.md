

# Fix Parlay Pipeline: Real FanDuel Lines

## Root Cause (Two Bugs)

### Bug 1: Wrong column name in FanDuel query
Line 4488 of `bot-generate-daily-parlays/index.ts`:
```
.eq('bookmaker_key', 'fanduel')
```
The column is actually `bookmaker`, not `bookmaker_key`. This query silently returns 0 results every time, always falling back to the "all books" query. FanDuel lines are never prioritized.

**Fix**: Change to `.eq('bookmaker', 'fanduel')`

### Bug 2: Prop type mismatch in oddsMap lookup
When building the oddsMap from `unified_props`, the keys use raw prop types like `points`, `rebounds`. But when looking up sweet spot picks (line 4791), it uses `pick.prop_type` which is `player_points`, `player_rebounds`. The normalization map exists but is only applied on the oddsMap build side — never on the lookup side.

Example: Sweet spot has `prop_type: 'player_points'` → lookup key = `lebron james_player_points` → oddsMap only has `lebron james_points` → **miss** → `has_real_line: false` → `line_source: 'projected'` → DNA audit voids it.

**Fix**: Normalize the sweet spot prop_type before looking up in oddsMap:
```typescript
const rawProp = (pick.prop_type || '').toLowerCase();
const normProp = PROP_TYPE_NORMALIZE[rawProp] || rawProp;
const rawOddsKey = `${pick.player_name}_${rawProp}`.toLowerCase();
const normOddsKey = `${pick.player_name}_${normProp}`.toLowerCase();
const oddsEntry = oddsMap.get(rawOddsKey) || oddsMap.get(normOddsKey) || oddsMap.get(stripTrailingPeriods(rawOddsKey)) || oddsMap.get(stripTrailingPeriods(normOddsKey));
```

## Impact
These two bugs together mean **every parlay leg** gets `has_real_line: false` and `line_source: 'projected'`, causing the DNA audit to void 100% of parlays. Fixing them will:
- Load actual FanDuel lines (500+ props)
- Match 80%+ of sweet spot picks to real sportsbook lines
- DNA audit will only void genuinely unbettable picks

## Files Changed

1. **`supabase/functions/bot-generate-daily-parlays/index.ts`**
   - Line 4488: `bookmaker_key` → `bookmaker`
   - Lines 4791-4793: Add prop type normalization to oddsMap lookup
   - Also fix the same pattern wherever legs are assembled (~6 locations) to ensure `line_source` propagates correctly

