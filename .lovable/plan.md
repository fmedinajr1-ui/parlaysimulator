

# Fix Parlay Count Discrepancy and Telegram Display

## Issues Found

1. **Dashboard generate button uses UTC date** -- `useBotEngine.ts` line 447 still uses `new Date().toISOString().split('T')[0]` instead of the EST helper, causing it to sometimes generate parlays for the wrong date after 7 PM EST.

2. **Only 16 parlays generated instead of 65-75** -- The generator targets 50 Exploration + 15 Validation + 8 Execution = 73, but the pick pool is too small (63 picks in the last run). With tight deduplication limits (`maxCategoryUsage: 2` for Exploration, `1` for Validation/Execution), the engine exhausts unique combinations early. The fix: relax `maxCategoryUsage` and `maxPlayerUsage` limits to allow more combinations from the available pool.

3. **Telegram /parlays only shows 5 items** -- `getParlays()` has `latestBatch.slice(0, 5)`, so even though the count says "16 total", only 5 are previewed. The fix: group by tier and show a summary with top picks per tier.

4. **Active player enforcement** -- The generator already has a 3-layer availability gate (unified_props + lineup_alerts for OUT/DOUBTFUL blocking). No changes needed here, but we should verify the gate is working by checking tomorrow's batch after generation.

## Changes

### 1. Fix UTC bug in dashboard generate button
**File: `src/hooks/useBotEngine.ts` (line 447)**
Replace `new Date().toISOString().split('T')[0]` with `getEasternDate()` (already imported at line 11).

### 2. Increase parlay output by relaxing deduplication limits
**File: `supabase/functions/bot-generate-daily-parlays/index.ts` (lines 49-100)**
- Exploration: `maxCategoryUsage: 2 -> 4`, `maxPlayerUsage: 3 -> 5`
- Validation: `maxCategoryUsage: 1 -> 3`, `maxPlayerUsage: 2 -> 4`
- Execution: `maxCategoryUsage: 1 -> 2`, `maxPlayerUsage: 2 -> 3`

This allows more unique parlays from the same pool without sacrificing diversity (interleaveByCategory still applies).

### 3. Fix Telegram /parlays to show tier-grouped summary
**File: `supabase/functions/telegram-webhook/index.ts`**

Update `getParlays()` (lines 121-158):
- Remove `slice(0, 5)` limit
- Add tier grouping by parsing `strategy_name`
- Return tier counts and top 2 picks per tier

Update `handleParlays()` (lines 345-368):
- Display tier-grouped format showing counts and sample picks per tier
- Keep message under Telegram's 4096 char limit

### 4. Redeploy and regenerate
- Deploy updated `bot-generate-daily-parlays` and `telegram-webhook`
- Trigger generation for today's date to verify output hits 65+ parlays
- Verify tier distribution

## Technical Details

### Telegram Output Format (after fix)
```text
Today's Parlays (68 total)

Exploration (45) -- $0 stake
  3-leg: 12 | 4-leg: 15 | 5-leg: 10 | 6-leg: 8
  Top: Deni Avdija 3s O0.5, LeBron Ast O2.5... +450

Validation (15) -- simulated
  3-leg: 5 | 4-leg: 6 | 5-leg: 4
  Top: Joel Embiid Reb O6.5, Maxey Ast O3.5... +820

Execution (8) -- Kelly stakes
  3-leg: 3 | 4-leg: 3 | 5-leg: 2
  Top: Holiday Ast O3.5, Avdija Pts O14.5... +620
```

### Dashboard Fix
Single line change in `useBotEngine.ts`:
```typescript
// Before (UTC bug):
body: { date: new Date().toISOString().split('T')[0] },

// After (EST-aware):
body: { date: getEasternDate() },
```
