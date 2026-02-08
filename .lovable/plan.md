
# Fix Parlay Generation - Two Critical Bugs

## Issues Discovered

### Bug 1: Confidence Score Threshold
**Location:** `supabase/functions/bot-generate-daily-parlays/index.ts`, line 360

```typescript
// CURRENT (BROKEN):
.gte('confidence_score', 55)

// SHOULD BE:
.gte('confidence_score', 0.55)
```

The confidence scores are stored as decimals (0.49 to 0.85), but the filter is checking for `>= 55`, which means **ALL picks are filtered out**.

### Bug 2: Category Mismatch
**Picks table categories:** `HIGH_ASSIST`, `VOLUME_SCORER`, `THREE_POINT_SHOOTER`
**Bot weights categories:** `HIGH_ASSIST_UNDER`, `LOW_SCORER_UNDER`, `BIG_ASSIST_OVER`

The bot weights have side suffixes (`_OVER`/`_UNDER`) while the sweet spots table has base categories. The `IN` clause never matches because `'HIGH_ASSIST' NOT IN ('HIGH_ASSIST_UNDER', ...)`.

## Fix Required

Update lines 353-362 in `bot-generate-daily-parlays/index.ts`:

```typescript
// 2. Fetch today's sweet spot picks with REAL line verification
// Note: confidence_score is stored as decimal (0.0-1.0), not percentage
// Also: category_sweet_spots uses base categories like "HIGH_ASSIST" 
// while bot_category_weights uses suffixed categories like "HIGH_ASSIST_UNDER"
// So we extract base categories for matching
const baseCategoryMap = new Map<string, string>();
eligibleCategories.forEach((cat: string) => {
  // Remove _OVER or _UNDER suffix to get base category
  const baseCat = cat.replace(/_OVER$|_UNDER$/, '');
  baseCategoryMap.set(baseCat, cat);
});
const baseCategories = [...baseCategoryMap.keys()];

console.log(`[Bot] Looking for base categories: ${baseCategories.join(', ')}`);

const { data: picks, error: picksError } = await supabase
  .from('category_sweet_spots')
  .select('*, actual_line, recommended_line, bookmaker')
  .eq('analysis_date', targetDate)
  .eq('is_active', true)
  .in('category', baseCategories)
  .gte('confidence_score', 0.55)  // Fixed: decimal not percentage
  .order('confidence_score', { ascending: false })
  .limit(80);
```

## Expected Result After Fix

Running parlay generation for 2026-02-06 should:
1. Find 66 active picks across matching categories
2. Filter to ~50 picks with confidence >= 0.55
3. Generate 8-10 parlays
4. Send Telegram notification with results
5. Log activity to `bot_activity_log`

## File Changes

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Fix confidence threshold (0.55) and category matching |
