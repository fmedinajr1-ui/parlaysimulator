

## Fix: Double-Confirmed Scanner is Broken (2 Bugs)

The double-confirmed scanner has **never produced results** due to two critical bugs in the database query. It silently returns 0 matches every time.

### Bug 1: Hit Rate Threshold is Wrong Scale
The scanner filters `category_sweet_spots` with `.gte('l10_hit_rate', 70)`, but values are stored as **decimals (0 to 1)**, not percentages. A perfect 100% hit rate is stored as `1.0`, so filtering for `>= 70` matches nothing.

**Fix**: Change threshold from `70` to `0.70` (line 47).

### Bug 2: Wrong Column Name for Player Average
The scanner selects `player_avg` from `mispriced_lines`, but that column doesn't exist. The actual column is `player_avg_l10`. This causes the query to error silently via the Supabase client.

**Fix**: Change `player_avg` to `player_avg_l10` in the select statement (line 50) and update all references throughout the function.

### Changes

**File: `supabase/functions/double-confirmed-scanner/index.ts`**
- Line 47: Change `.gte('l10_hit_rate', 70)` to `.gte('l10_hit_rate', 0.70)`
- Line 50: Change `player_avg` to `player_avg_l10` in the select query
- Update all downstream references from `player_avg` to `player_avg_l10` (the pick object construction around line 95)

### Expected Outcome
- Scanner will correctly find sweet spots with 70%+ L10 hit rate (currently ~500 qualifying records per day)
- Cross-referencing against mispriced lines (37 qualifying on Feb 25) will produce actual double-confirmed picks
- Telegram reports will start delivering real double-confirmed picks
- The parlay generator's "double_confirmed_conviction" strategy will finally have data to work with
