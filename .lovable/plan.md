

# Fix Sweet Spot Pool: Real Lines Only + Prop Type & Name Matching

## Root Cause Analysis

Three issues are preventing sweet spot picks from matching to real sportsbook lines:

### Issue 1: Prop Type Mismatch
- Sweet spots use: `threes`, `points`, `rebounds`, `assists`
- Unified props use BOTH: `player_threes` AND `threes`, `player_points` AND `points`
- The oddsMap key is built as `playerName_propType` -- but when the formats differ, lookups fail
- Example: Sweet spot has `Moses Moody_threes`, but oddsMap only indexed `Moses Moody_player_threes`

### Issue 2: Player Name Mismatch
- Sweet spots: `Kelly Oubre Jr.` (with period)
- Unified props: `Kelly Oubre Jr` (no period)
- Exact string matching fails on suffixes like Jr./Jr, III/III., etc.

### Issue 3: Default -110 Fallback Keeps Bad Picks
- When a sweet spot pick can't find a real line, the code falls back to -110 default odds and keeps the pick
- User requirement: picks WITHOUT real sportsbook lines should be EXCLUDED, not given fake odds
- The sweet spot engine's own hit rate is already high-confidence -- the line just needs to be real

## Current Impact
- 500 sweet spot picks today, only ~6-8 actually match to real unified_props lines
- Most high-hit-rate picks (100% L10) are for players NOT playing today -- those correctly have 0 matches
- Players who ARE playing today still fail to match due to prop type format or name punctuation

## Fix Plan

### Change 1: Normalize oddsMap keys (line 4212-4223)

When building the oddsMap from unified_props, index each entry under BOTH the raw prop_type key AND the normalized form using PROP_TYPE_NORMALIZE. This way `player_threes` creates entries for both `moses moody_player_threes` AND `moses moody_threes`.

Also normalize player names by stripping trailing periods from suffixes (Jr., Sr., III.).

### Change 2: Normalize sweet spot lookup keys (line 4247)

When looking up a sweet spot pick against the oddsMap, also strip trailing periods from the player name so `Kelly Oubre Jr.` matches `Kelly Oubre Jr`.

### Change 3: Require real lines for sweet spot picks (lines 4306-4316)

Replace the current fallback behavior. Instead of assigning -110 default odds when no real line exists, EXCLUDE the pick entirely. The filter at line 4306 should return `false` when `has_real_line` is false.

```text
Before:
  if (!p.has_real_line) {
    p.americanOdds = -110;
    p.line_source = 'engine_recommended';
  }
  return true;

After:
  if (!p.has_real_line) return false;  // No real line = no parlay leg
  return true;
```

### Change 4: Relax bonus leg gate for sweet_spot_plus (lines 6084-6088)

Lower the bonus leg quality gate from composite >= 75 / hit rate >= 60% to composite >= 65 / hit rate >= 55%. On thin slates with only 3 games, the current gate blocks all bonus candidates, forcing every sweet_spot_plus to fall back to 3 legs.

## Technical Details

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

**Changes:**
- Lines 4212-4223: Add normalized aliases when building oddsMap (dual-index by raw and PROP_TYPE_NORMALIZE'd key, strip trailing periods from player names)
- Line 4247: Strip trailing periods from player name in sweet spot oddsKey lookup
- Lines 4306-4316: Change `has_real_line` fallback to exclusion filter
- Lines 6084-6088: Lower bonus gate thresholds (75 to 65 composite, 60% to 55% hit rate)

**After deploying:**
- Re-run `category-props-analyzer` to refresh active flags
- Re-run `bot-generate-daily-parlays` with sweet spot source to generate fresh parlays

## Expected Result
- Many more sweet spot picks match to real sportsbook lines (prop type + name normalization)
- Zero picks with fake -110 default odds enter the pool
- sweet_spot_plus parlays can actually reach 4 legs
- More sweet_spot_core parlays generated from the larger matched pool

