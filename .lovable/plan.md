## Revert the fade-side flip logic

The flip was based on a wrong reading of the alert schema. In `fanduel_prediction_alerts`, `prediction` is already the recommended play side — `metadata.original_side` is the *public* side being faded, and `metadata.price_aware.side_scored` confirms `prediction` is what was scored. The earlier Telegram parlay (SGA Over 0.5 Blocks -155, ATL/CIN Under 9.5, TOR/BAL Over 8) was correct; the "correction" that flipped sides was the bug.

### Changes

1. **`supabase/functions/daily-fade-parlay-generator/index.ts`**
   - Remove import from `_shared/slate-outlier-flip.ts`.
   - Use `a.prediction` directly as the leg side.
   - Price = `over_price` if prediction is Over, else `under_price`; convert American → decimal inline.
   - Drop the `fading public X` note and `original_public_side` field from the leg payload (no longer relevant — we just play `prediction`).

2. **Delete the flip scaffolding** (no longer used and actively misleading):
   - `supabase/functions/_shared/slate-outlier-flip.ts`
   - `supabase/functions/daily-fade-parlay-generator/flip_test.ts`

3. **Remove the bad memory rule:**
   - Delete `mem://logic/betting/slate-outlier-side-flip`
   - Remove its line from `mem://index.md`
   - Add a replacement Core rule so this mistake doesn't recur:
     > For `velocity_spike` fade alerts: `prediction` is already the recommended play side. `metadata.original_side` is the *public* side being faded. Never invert.

4. **Deploy** `daily-fade-parlay-generator`. Do **not** auto-send a new Telegram — user can trigger the next run manually if they want a corrected message today.

### Out of scope

No other consumer of `fanduel_prediction_alerts` is touched. If you want me to audit other engines for the inverse mistake (anyone who *was* correctly inverting and now needs to stop), say the word and I'll grep them in a follow-up.
