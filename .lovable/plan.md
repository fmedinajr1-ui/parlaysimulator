

## Fix: Matchup Defense Scanner Upsert Failing Silently

### Root Cause

The scanner's upsert on line 300 uses `onConflict: 'category,research_date'`, but there is **no unique constraint** on `(category, research_date)` in the `bot_research_findings` table. There's only a regular (non-unique) index on `category` alone. Without a matching unique constraint, the upsert silently fails and writes nothing.

### Changes

1. **Database Migration** -- Add a unique constraint on `(category, research_date)` to the `bot_research_findings` table:
   ```sql
   ALTER TABLE public.bot_research_findings
   ADD CONSTRAINT uq_research_findings_category_date UNIQUE (category, research_date);
   ```
   Note: Existing data may have duplicates for the same category+date (e.g., `team_research` and `optimization` appear twice for 2026-02-24). The migration will deduplicate first by keeping only the most recent row per category+date, then add the constraint.

2. **No code changes needed** -- The edge function's upsert logic is already correct once the unique constraint exists.

### After the Fix

Re-running the scanner will successfully upsert the matchup defense scan into `bot_research_findings`, making the 53 recommendations (17 prime, 20 favorable, 16 avoid) available for the parlay generator to consume.

