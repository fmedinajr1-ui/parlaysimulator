

# Fix: Move Floor Lock & Ceiling Shot to Top of Profile Lists + Add Timeout Guard

## Root Cause (confirmed)
Floor/ceiling profiles sit at the **bottom** of both tier arrays:
- Exploration: lines 818-827 (positions ~85-92 out of ~92 profiles)  
- Execution: lines 1016-1023 (positions ~30-33 out of ~33 profiles)

The function times out processing the ~80+ profiles before them and never reaches floor/ceiling.

## Changes

### 1. Reorder profiles in `bot-generate-daily-parlays/index.ts`

**Exploration tier** (~line 728): Move the 8 floor_lock + ceiling_shot profiles (currently lines 818-827) to the **top** of the exploration profiles array, right after the opening bracket. This ensures they're processed first.

**Execution tier** (~line 975): Move the 7 floor_lock + ceiling_shot profiles (currently lines 1016-1023) to the **top** of the execution profiles array.

### 2. Add timeout guard in profile iteration loop

Add a wall-clock check at the start of each profile iteration. If elapsed time exceeds 140 seconds (out of typical 150s limit), log a warning with which profiles were skipped and break out of the loop. This provides visibility into future timeout-related skips.

### 3. Trigger test run

After deploying, invoke the function with `{"admin_only": true}` and check logs + database for `floor_lock` and `ceiling_shot` parlays.

### Files Changed
1. **`supabase/functions/bot-generate-daily-parlays/index.ts`** — reorder profiles, add timeout guard

