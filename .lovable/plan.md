

## Fix: Empty Slate After Clean & Rebuild (3 Root Causes)

### Problem

The Clean & Rebuild completed but left **0 pending parlays**. All 97 rows for today are voided. Three issues caused this:

1. **Quality regen self-voiding during rebuilds** -- Step 2 voids everything, so `isSupplemental = false`. The regen loop then voids its own attempt 1 and attempt 2 output between cycles, destroying 38 parlays unnecessarily.

2. **Hit rate scoring reads empty fields** -- The quality regen loop scores parlays by reading `hit_rate_l10` / `hit_rate` from leg JSON. But `bot-generate-daily-parlays` doesn't populate those fields in the leg data. Result: 0.7% avg across all 3 attempts, never meeting the 60% target. The loop wastes all 3 attempts and keeps the worst batch.

3. **Final batch voided by duplicate void** -- The 29 parlays from attempt 3 + force-fresh were voided with "Voided for defense-aware rebuild" (the step 2 message). This indicates either a double-click on the button or a race condition where the client proceeded past step 8 while the edge function was still running, and a second rebuild was triggered.

### Changes

**File: `supabase/functions/bot-quality-regen-loop/index.ts`**

1. **Never void between attempts during a rebuild.** Change the loop so it NEVER voids between attempts. Instead, each attempt generates parlays additively. After all attempts, keep only the latest batch by voiding older attempt parlays (identified by `source` metadata in `selection_rationale`). This prevents the loop from destroying its own output.

2. **Fix hit rate scoring to use available data.** Instead of reading the missing `hit_rate_l10` field from legs, score parlays using:
   - `combined_probability` (already populated on every parlay) -- convert to percentage
   - Fall back to category weight data from `bot_category_weights` for the leg's category
   - This gives a realistic score that can actually meet the 60% target

3. **Lower the target to 45% as a realistic floor.** The 60% target was never achievable with the current data. Set default to 45% which represents a strong parlay batch. Allow override via the request body.

**File: `src/components/market/SlateRefreshControls.tsx`**

4. **Debounce the Clean & Rebuild button.** Add a guard that prevents the button from being clicked again while a rebuild is in progress. The current `disabled={isBusy}` should already do this, but add a `useRef` flag as a backup to prevent race conditions from React state batching.

5. **Remove the void step from the regen loop body.** Pass `skip_void: true` in the body when calling `bot-quality-regen-loop` from the Clean & Rebuild, since step 2 already handles voiding. The regen loop should respect this flag and skip ALL void operations.

### Technical Details

**Scoring fix (quality regen)**:
```text
Current (broken):
  leg.hit_rate_l10 ?? leg.hit_rate ?? leg.l10_hit_rate ?? 0
  Result: always 0 -> avg = 0.7%

Fixed:
  Use parlay.combined_probability * 100
  e.g. 0.45 probability -> 45% projected hit rate
  Falls within achievable range
```

**Void logic fix**:
```text
Current: void between attempts when !isSupplemental
Fixed: never void between attempts; only void previous-attempt parlays
        AFTER confirming the new attempt generated successfully
```

### Expected Result
- Clean & Rebuild generates 18-20+ parlays that remain pending
- Quality regen scores realistically (40-55% range) instead of 0.7%
- No more self-voiding between attempts
- Double-click protection prevents accidental wipe
