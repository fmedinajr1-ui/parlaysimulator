

# Regenerate Feb 9 Parlays and Verify Tier Distribution

## Current State

There are already **22 parlays** for Feb 9 with tiers parsed from `strategy_name`:
- Exploration: 10
- Validation: 7
- Execution: 5

The `tier` column does **not exist** in `bot_daily_parlays` -- tier is embedded in `strategy_name` (e.g., `elite_categories_v1_exploration_...`).

## Plan

### Step 1: Trigger fresh generation
Call `bot-generate-daily-parlays` with `{"date": "2026-02-09"}` to regenerate. The generator deletes existing pending parlays before inserting a new batch, so this will produce a clean set.

### Step 2: Verify tier distribution
Query `bot_daily_parlays` to confirm all three tiers are populated and the total is in the 65-75 range (or whatever the current pick pool supports).

### Step 3: Fix /tiers, /explore, /validate commands
The Telegram commands query a non-existent `tier` column. Update them to filter by `strategy_name` pattern instead:
- `/tiers`: Group by tier parsed from `strategy_name`
- `/explore`: Filter `strategy_name ilike '%exploration%'`
- `/validate`: Filter `strategy_name ilike '%validation%'`

## Technical Details

### File: `supabase/functions/telegram-webhook/index.ts`

**handleTiers** (~line 640): Replace `.eq('tier', ...)` queries with strategy_name pattern matching. Parse tier from strategy_name for grouping.

**handleExplore** (~line 693): Change `.eq('tier', 'exploration')` to `.ilike('strategy_name', '%exploration%')`.

**handleValidate** (~line 724): Change `.eq('tier', 'validation')` to `.ilike('strategy_name', '%validation%')`.

This ensures all Telegram tier commands work correctly without requiring a schema change.

