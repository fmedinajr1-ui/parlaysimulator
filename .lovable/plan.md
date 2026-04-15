

# Regenerate Today's Cascade Slate with New Thresholds

## Problem
Today's 20 tickets (8 GRIND + 7 STACK + 5 LONGSHOT) were generated at 1:42 PM ET using the **old 0.3–0.7 RBI filter**. The tightened 0.5–0.6 thresholds are deployed but won't take effect until the existing parlays are cleared.

## Plan

### 1. Delete today's old slate
Remove all 20 rows from `bot_daily_parlays` where `parlay_date = '2026-04-15'` and `strategy_name = 'mlb_cascade_parlays'` via a migration.

### 2. Re-invoke the generator
Call `mlb-cascade-parlay-generator` via curl — it will now run with the deployed 0.5–0.6 thresholds and generate a fresh 20-ticket slate, sending it to Telegram automatically.

### 3. Verify
Query the DB to confirm new tickets and check Telegram delivery.

## Files
- **Migration**: DELETE today's old cascade parlays
- **Invoke**: `mlb-cascade-parlay-generator` edge function

