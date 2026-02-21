

## Admin Parlay Management Commands via Telegram

### What You're Getting

New admin-only Telegram commands to directly manage parlays and trigger fixes when issues arise:

### New Commands

**Parlay Management:**
- `/deleteparlay [id]` -- Delete a specific parlay by its UUID (marks it as voided with reason)
- `/voidtoday` -- Void all of today's pending parlays (with confirmation button)
- `/fixleg [parlay_id] [leg_index] [field] [value]` -- Edit a specific leg in a parlay (e.g., fix a wrong line or side)
- `/deletesweep` -- Delete all sweep-tier parlays from today
- `/deletebystrat [strategy_name]` -- Delete all today's parlays matching a strategy name

**Error Recovery / Quick Fixes:**
- `/fixpipeline` -- Run the full data pipeline orchestrator (stats sync + analysis + generation)
- `/regenparlay` -- Void today's parlays and force-regenerate fresh ones (calls `bot-force-fresh-parlays`)
- `/fixprops` -- Re-scrape props + refresh sweet spots + regenerate
- `/healthcheck` -- Run preflight + integrity check and report results
- `/errorlog` -- Show the last 10 error-severity entries from `bot_activity_log`

### Technical Implementation

**File modified:** `supabase/functions/telegram-webhook/index.ts`

**1. `/deleteparlay [id]`**
- Validates UUID format
- Updates the parlay: sets `outcome = 'void'`, `lesson_learned = 'Voided by admin via Telegram'`
- Confirms with parlay details (strategy, leg count)

**2. `/voidtoday`**
- Sends an inline confirmation button (`fix:void_today_confirm`)
- On confirm: updates all today's pending parlays to `outcome = 'void'`
- Reports count voided

**3. `/fixleg [parlay_id] [leg_index] [field] [value]`**
- Fetches the parlay, parses legs JSON
- Validates leg_index is in range
- Supports fields: `line`, `side`, `player_name`, `prop_type`
- Updates the leg in the JSON array and writes back
- Confirms with before/after values

**4. `/deletesweep`**
- Deletes (voids) all today's parlays where `strategy_name = 'leftover_sweep'`

**5. `/deletebystrat [name]`**
- Voids all today's pending parlays matching the given strategy name

**6. `/fixpipeline`**
- Calls `data-pipeline-orchestrator` with `{ mode: 'full' }`
- Reports success/failure

**7. `/regenparlay`**
- Calls `bot-force-fresh-parlays` (already voids + regenerates)

**8. `/fixprops`**
- Sequentially calls: `refresh-todays-props`, then `bot-generate-daily-parlays`
- Reports each step

**9. `/healthcheck`**
- Calls `bot-pipeline-preflight` and `bot-parlay-integrity-check` in parallel
- Returns combined results

**10. `/errorlog`**
- Queries `bot_activity_log` for last 10 `severity = 'error'` entries
- Displays timestamp, event type, and message

**Callback handler additions:**
- `fix:void_today_confirm` -- executes the void-all action after button press

**Updated `/start` and `/help`:**
- Add a "Management" section listing the new commands

All commands are admin-only (gated by existing `isAdmin()` check).

