

# Void Orphaned Parlays, Recalibrate, and Generate Fresh Parlays

## Overview

Three-step pipeline: void the 4 orphaned Feb 9 parlays, recalibrate all bot weights from verified historical data, then generate today's parlays with the updated weights.

## Step 1: Void Orphaned Feb 9 Parlays

Run a SQL update to mark the 4 remaining `pending` Feb 9 parlays as `void` since their source data no longer exists and they cannot be graded.

```text
UPDATE bot_daily_parlays 
SET outcome = 'void', 
    settled_at = NOW(), 
    lesson_learned = 'Voided: source data missing, cannot grade'
WHERE parlay_date = '2025-02-09' AND outcome = 'pending';
```

## Step 2: Recalibrate Bot Weights

Invoke `calibrate-bot-weights` to rebuild all category weights from the full historical outcome dataset in `category_sweet_spots`. This uses the weight formula:

```text
weight = clamp(0.5, 1.5, 1.0 + (hitRate - 0.50) * 0.8 + sampleBonus)
```

Categories below 40% hit rate (min 10 samples) get auto-blocked.

## Step 3: Generate New Daily Parlays

Invoke `bot-generate-daily-parlays` to produce today's parlays using the freshly calibrated weights. The generator creates parlays across three tiers:
- **Exploration** (50): Edge discovery, low-cost
- **Validation** (15): Pattern confirmation
- **Execution** (8): Best bets with Kelly sizing

## Technical Details

### Execution Order (sequential, each depends on prior step)

1. **SQL migration** -- void the 4 orphaned parlays
2. **Call** `calibrate-bot-weights` -- full weight rebuild
3. **Call** `bot-generate-daily-parlays` -- generate today's parlays with new weights
4. **Query results** -- show the user a summary of new parlays generated, weight changes, and blocked categories

### No Code Changes Required

All three functions already exist and are deployed. This is purely an operational execution -- run the pipeline in order and report results.
