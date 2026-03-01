

## Diversify Longshot Odds into Tiers

### What We'll Do
Update the `fetch-hardrock-longshots` function to categorize results into distinct odds tiers (+500, +650, +700, +900, +1000 and up) instead of a single +650 cutoff. This gives a clearer picture of risk/reward across the board.

### Technical Details

**File modified: `supabase/functions/fetch-hardrock-longshots/index.ts`**

1. **Lower the minimum odds threshold** from +650 to +500 to capture more longshots
2. **Add tier classification** to each longshot result: assign a `tier` field based on odds value
   - `"+1000+"` for odds >= 1000
   - `"+900"` for odds 900-999
   - `"+700"` for odds 700-899
   - `"+650"` for odds 650-699
   - `"+500"` for odds 500-649
3. **Group results by tier** in the response, adding a `tiers` summary object showing count per tier
4. **Update the Telegram message format** to organize picks by tier with section headers:
   ```
   🎰 HRB LONGSHOTS

   --- +1000 & UP ---
   +1000 | Spurs ML
   Spurs @ Knicks

   --- +700 ---
   +700 | Mavericks ML
   Thunder @ Mavericks

   --- +500 ---
   +550 | Player X O2.5 Threes
   Team A @ Team B
   ```
5. **Response structure** will include both the flat `longshots` array (with `tier` field) and a `tiers` object for quick counts

### After Deployment
Invoke the function with `send_telegram: true` to send the diversified results to the admin.

