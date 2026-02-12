

# Bot Learning Metrics Table and Accelerated Data Collection

## Overview

The Learning Analytics dashboard currently has two problems:
1. **No persistent metrics store** -- every page load re-queries all parlays and computes stats from scratch
2. **No `tier` column** on `bot_daily_parlays` -- the dashboard defaults everything to "execution", making tier breakdowns meaningless
3. **Only 61 settled parlays** (17W / 44L) -- far below the 300+ per tier needed for statistical confidence

This plan adds a dedicated `bot_learning_metrics` table, backfills it from existing data, adds a `tier` column to parlays, and wires the settlement pipeline to update metrics automatically.

---

## What Changes

### 1. Add `tier` column to `bot_daily_parlays`

The strategy names already encode the tier (e.g., `elite_categories_v1_exploration_explore_mixed`). We'll add the column and backfill it by parsing the strategy name.

### 2. Create `bot_learning_metrics` table

A daily snapshot table that stores pre-computed stats per tier:

| Column | Type | Purpose |
|---|---|---|
| id | uuid | Primary key |
| snapshot_date | date | When this snapshot was taken |
| tier | text | exploration / validation / execution |
| total_generated | integer | Parlays generated in this tier |
| total_settled | integer | Parlays with outcomes |
| wins | integer | Won parlays |
| losses | integer | Lost parlays |
| win_rate | numeric | wins / settled |
| sample_sufficiency | numeric | % toward target sample count |
| ci_lower | numeric | Wilson score lower bound |
| ci_upper | numeric | Wilson score upper bound |
| days_to_convergence | integer | Estimated days remaining |
| created_at | timestamptz | Row creation time |

Unique constraint on `(snapshot_date, tier)` so each day has one row per tier.

### 3. Backfill tier and initial metrics

SQL migration will:
- Add `tier` column with default `'execution'`
- Parse existing `strategy_name` values to extract tier (`_exploration_`, `_validation_`, `_execution_`)
- Insert initial snapshot rows into `bot_learning_metrics`

### 4. Update settlement pipeline

Modify `bot-settle-and-learn` to:
- Set the `tier` on new parlays based on strategy name
- After settling, upsert a new snapshot row into `bot_learning_metrics`

### 5. Update `BotLearningAnalytics.tsx`

Instead of fetching all parlays and computing on the fly, read the latest snapshot from `bot_learning_metrics`. Falls back to live computation if no snapshots exist yet.

---

## Technical Details

### Database Migration

```sql
-- 1. Add tier column
ALTER TABLE bot_daily_parlays 
  ADD COLUMN IF NOT EXISTS tier text DEFAULT 'execution';

-- 2. Backfill tier from strategy_name
UPDATE bot_daily_parlays SET tier = 'exploration' 
  WHERE strategy_name LIKE '%exploration%';
UPDATE bot_daily_parlays SET tier = 'validation' 
  WHERE strategy_name LIKE '%validation%';
UPDATE bot_daily_parlays SET tier = 'execution' 
  WHERE strategy_name LIKE '%execution%' 
    AND tier = 'execution';

-- 3. Create metrics table
CREATE TABLE bot_learning_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL,
  tier text NOT NULL DEFAULT 'execution',
  total_generated integer DEFAULT 0,
  total_settled integer DEFAULT 0,
  wins integer DEFAULT 0,
  losses integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  sample_sufficiency numeric DEFAULT 0,
  ci_lower numeric DEFAULT 0,
  ci_upper numeric DEFAULT 0,
  days_to_convergence integer DEFAULT 999,
  created_at timestamptz DEFAULT now(),
  UNIQUE(snapshot_date, tier)
);

-- 4. RLS policy (service role only, read by anon)
ALTER TABLE bot_learning_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access" ON bot_learning_metrics
  FOR SELECT USING (true);
```

### Edge Function Changes

**`bot-settle-and-learn/index.ts`**: After settlement, compute and upsert metrics snapshot for the current date.

**`bot-generate-daily-parlays/index.ts`**: Set `tier` field on each parlay based on which profile generated it (exploration/validation/execution).

### Frontend Changes

**`BotLearningAnalytics.tsx`**: Query `bot_learning_metrics` for the latest snapshot per tier instead of fetching all parlays. The dashboard will load instantly instead of scanning the entire parlays table.

