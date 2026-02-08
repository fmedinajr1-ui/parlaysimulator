
# Deep Calibration & Weighting System Overhaul

## Problem Analysis

After analyzing the codebase and database, I've identified **5 critical gaps** preventing the bot from correctly weighting and calibrating picks:

### Issue 1: Massive Data Mismatch - Stored vs Actual Hit Rates
```text
┌─────────────────────┬────────────────┬───────────────┬─────────────────┐
│ Category            │ Stored Rate    │ ACTUAL Rate   │ Picks Settled   │
├─────────────────────┼────────────────┼───────────────┼─────────────────┤
│ THREE_POINT_SHOOTER │ 63.2%          │ 2.7%          │ 2,214           │
│ LOW_SCORER_UNDER    │ 66.0%          │ 5.7%          │ 613             │
│ BIG_ASSIST_OVER     │ 59.0%          │ 11.8%         │ 306             │
│ HIGH_ASSIST_UNDER   │ 69.2%          │ 25.7%         │ 35              │
│ ROLE_PLAYER_REB     │ 48.2%          │ 4.8%          │ 1,417           │
└─────────────────────┴────────────────┴───────────────┴─────────────────┘
```
**Root Cause**: The `bot_category_weights` table has hardcoded "initial" hit rates that were never updated from actual outcomes. The weights show `total_picks: 0` and `total_hits: 0` for every category - meaning the learning engine has NEVER consumed real outcome data.

### Issue 2: Bot Learning Loop is Broken
The `bot-settle-and-learn` function tries to update weights based on leg outcomes from `category_sweet_spots`, but:
- It only looks up picks by `id` directly, which doesn't match the ID scheme
- Bot parlays have 0 settled outcomes (all 4 parlays are still "pending")
- The cron job only just started running today

### Issue 3: Missing Category Weights
Only **4 NBA categories** have configured weights in `bot_category_weights`:
- HIGH_ASSIST_UNDER (1.2)
- LOW_SCORER_UNDER (1.15)
- THREE_POINT_SHOOTER (1.1)
- BIG_ASSIST_OVER (1.0)

But `category_sweet_spots` has **16+ categories** generating picks:
- VOLUME_SCORER (691 picks - no weight)
- HIGH_ASSIST (801 picks - no weight)
- STAR_FLOOR_OVER (413 picks - no weight)
- BIG_REBOUNDER (390 picks - no weight)
- etc.

### Issue 4: No Feedback Loop from Verified Outcomes to Bot Weights
The `verify-sweet-spot-outcomes` function correctly settles picks in `category_sweet_spots`, but there's NO connection to:
1. Update `bot_category_weights.current_hit_rate` based on actual verified data
2. Recalculate weights based on real performance
3. Block underperforming categories automatically

### Issue 5: Composite Score Uses Stale Data
The bot's `calculateCompositeScore` formula relies on `categoryWeight` from `bot_category_weights`, but those weights are static (never updated), causing the scoring to be meaningless.

---

## Solution: Complete Calibration Pipeline

### Phase 1: Bootstrap Weights from Historical Data (New Edge Function)

Create `calibrate-bot-weights` edge function that:
1. Queries actual hit rates from `category_sweet_spots` (8,863 settled picks available)
2. Calculates true hit rates per category/side
3. Upserts ALL active categories into `bot_category_weights` with real data
4. Sets initial weights based on actual performance (not hardcoded guesses)

**Weight Formula:**
```
weight = clamp(0.5, 1.5, 
  base(1.0) + 
  (actualHitRate - 0.50) * 0.8 + 
  sampleSizeBonus(picks >= 100 ? +0.1 : picks >= 50 ? +0.05 : 0)
)
```

### Phase 2: Continuous Learning Integration

Modify `bot-settle-and-learn` to:
1. Also update weights from `category_sweet_spots` verified outcomes (not just bot parlay legs)
2. Query recently settled picks (last 24h) and apply incremental learning
3. Sync `current_hit_rate` from actual data

### Phase 3: Add Blocking Rules Based on Performance

Implement automatic category blocking when:
- Hit rate drops below 35% with 20+ samples
- 5+ consecutive misses (streak-based block)
- Edge is consistently negative

### Phase 4: Daily Calibration Cron Job

Schedule `calibrate-bot-weights` to run:
- After settlement verification (chain: `verify-sweet-spot-outcomes` → `calibrate-bot-weights`)
- Rebuild weights from the full historical dataset weekly

---

## Technical Implementation

### New Files

| File | Purpose |
|------|---------|
| `supabase/functions/calibrate-bot-weights/index.ts` | Calculate real hit rates → update weights |

### Modified Files

| File | Changes |
|------|---------|
| `supabase/functions/bot-settle-and-learn/index.ts` | Add outcome sync from `category_sweet_spots` |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Use calibrated weights, block low-performers |

### Database Changes

Add migration to:
1. Add missing categories to `bot_category_weights` table
2. Add `last_calibrated_at` timestamp column
3. Create index on `(category, side)` for faster lookups

---

## Expected Outcome

After implementation:
- Weights will reflect ACTUAL performance (e.g., THREE_POINT_SHOOTER would have weight ~0.5 instead of 1.1)
- Categories with <40% hit rate will be auto-blocked
- Bot will only use picks from categories with proven 55%+ accuracy
- The composite score will meaningfully rank picks by real predictive value

This will transform the bot from "randomly picking from all categories equally" to "intelligently weighting based on verified historical performance."
