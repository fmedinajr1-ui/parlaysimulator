

## Add Outcome Tracking for ALL Engine Picks

### Current State

| Engine Table | Outcome Columns | Verification | Settled Data |
|---|---|---|---|
| `category_sweet_spots` | outcome, actual_value, settled_at | `verify-sweet-spot-outcomes` | 1,690 hits / 948 misses |
| `nba_risk_engine_picks` | outcome, actual_value, settled_at | `verify-all-engine-outcomes` | 0 settled (1 pending) |
| `mispriced_lines` | outcome, actual_value, settled_at | `verify-all-engine-outcomes` | 0 settled (1,061 pending) |
| `high_conviction_results` | NONE | NONE | N/A (98 rows) |

### What Needs to Happen

**1. Add outcome columns to `high_conviction_results`**

Database migration to add `outcome` (text, default 'pending'), `actual_value` (numeric), and `settled_at` (timestamptz) to `high_conviction_results`.

**2. Add High Conviction verification to `verify-all-engine-outcomes`**

Add a new section after the Mispriced Lines block that:
- Queries `high_conviction_results` where outcome is null or 'pending' for the last 3 days
- Uses `signal` (OVER/UNDER) as side, `current_line` as the line
- Looks up game logs by normalized player name + analysis_date
- Updates outcome, actual_value, settled_at
- Adds a `high_conviction` entry to the results array

**3. Add High Conviction to `/engineaccuracy` command**

Update `handleEngineAccuracy` in `telegram-webhook/index.ts` to also query `high_conviction_results` settled outcomes and include it in the report as a 4th engine.

**4. Add High Conviction to `bot-send-telegram` formatter**

The `engine_accuracy_report` formatter already renders a dynamic list of engines, so it will automatically include the new engine once the data is passed in.

### Files Modified
- **Database**: `high_conviction_results` table -- add outcome, actual_value, settled_at columns (migration)
- **`supabase/functions/verify-all-engine-outcomes/index.ts`** -- add high conviction verification section
- **`supabase/functions/telegram-webhook/index.ts`** -- add high conviction query to `handleEngineAccuracy`

