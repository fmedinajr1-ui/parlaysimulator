

# Settle All Remaining Parlays

## Problem
132 bot parlays sit in "pending" across Feb 9 – Mar 26. Three categories:

1. **Already graded but not closed** — All legs have outcomes (hit/miss/push) but the parlay-level `outcome` was never updated (e.g., Mar 25: 2 hits, 0 misses, 0 pending → should be "won")
2. **Partially graded, has a miss** — At least one leg is "miss" so the parlay is already lost regardless of pending legs
3. **Unresolvable** — All legs still "pending" on dates >7 days old (mostly `bidirectional_bench_under` with null player names — ghost legs). Game data is no longer available via APIs.

Additionally, 19 user `parlay_history` entries (Nov 2025 – Jan 2026) are unsettled — these require manual user action via the UI.

## Plan

### 1. Bulk SQL settlement for clear-cut cases
Run SQL updates directly for parlays where the outcome is deterministic:

**a) Any parlay with at least 1 miss → lost**
```sql
UPDATE bot_daily_parlays
SET outcome = 'lost', settled_at = now(),
    lesson_learned = 'bulk_settled:has_miss'
WHERE outcome = 'pending'
  AND parlay_date < '2026-03-27'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(legs) l
    WHERE l->>'outcome' = 'miss'
  );
```

**b) All legs hit (no misses, no pending) → won**
```sql
UPDATE bot_daily_parlays
SET outcome = 'won', settled_at = now(),
    lesson_learned = 'bulk_settled:all_hit'
WHERE outcome = 'pending'
  AND parlay_date < '2026-03-27'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(legs) l
    WHERE l->>'outcome' IN ('miss', 'pending') OR l->>'outcome' IS NULL
  );
```

**c) Void unresolvable parlays older than 14 days with all-pending legs**
```sql
UPDATE bot_daily_parlays
SET outcome = 'void', settled_at = now(),
    lesson_learned = 'bulk_voided:stale_unresolvable'
WHERE outcome = 'pending'
  AND parlay_date < '2026-03-13'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(legs) l
    WHERE l->>'outcome' IS NOT NULL AND l->>'outcome' != 'pending'
  );
```

### 2. Re-invoke settlement for remaining recent parlays
After bulk updates, invoke `bot-settle-and-learn` one date at a time for any remaining pending parlays (Mar 19–26) to resolve individual legs via game log API.

### 3. Report results
Query final counts and report the settlement summary.

## Technical Details
- Uses database migrations for the bulk UPDATE statements
- No code file changes needed
- The `parlay_history` (user parlays) cannot be auto-settled — they require manual Won/Lost clicks in the UI

