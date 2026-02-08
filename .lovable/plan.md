
# ✅ COMPLETED: Fix Parlay Generation Bugs

## Bugs Fixed

### Bug 1: Confidence Score Threshold ✅
**Location:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Changed `.gte('confidence_score', 55)` → `.gte('confidence_score', 0.55)` (decimal format)

### Bug 2: Category Mismatch ✅
Added logic to match both base categories (`HIGH_ASSIST`) and suffixed categories (`HIGH_ASSIST_UNDER`).

### Bug 3: Hit Rate Calculation ✅
Fixed `l10_hit_rate` handling - values are decimals (0.9 = 90%), not percentages. Was being divided by 100 twice.

### Bug 4: Missing team_name Column ✅
Made `team_name` optional since `category_sweet_spots` table doesn't have this column.

### Bug 5: Profile Thresholds ✅
Adjusted parlay profile thresholds to work with available data (lowered minHitRate and minOddsValue).

## Test Results

**Run for 2026-02-06:**
- 17 valid picks with 100% real sportsbook lines
- 4 parlays generated (2 x 3-leg, 2 x 4-leg)
- Telegram notification sent successfully
- Activity logged to `bot_daily_parlays` table
