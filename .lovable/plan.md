

## Bug: L3_DECLINE + L3_CONFIRMED firing simultaneously

**Root cause**: The risk tag conditions in `generateRiskTags()` (line ~148-173 of `bot-matchup-defense-scanner/index.ts`) are independent — they don't exclude each other. For UNDER bets on declining players, `L3_DECLINE` fires (ratio < 0.80) AND `L3_CONFIRMED` fires (L3 < line && ratio <= 1.10), which is contradictory messaging even though both are technically true.

**Example from screenshot**: Caris LeVert UNDER 10.5 — L10: 5.4, L3: 3
- ratio = 3/5.4 = 0.56 → triggers L3_DECLINE (< 0.80)
- L3 (3) < line (10.5) + ratio (0.56) <= 1.10 → triggers L3_CONFIRMED

**Fix**: Make `L3_CONFIRMED` take priority when both would fire. The decline is already implicit — if L3 confirms the side, the user doesn't need a scary "DECLINE" warning since it actually *helps* their bet.

### Implementation

**File**: `supabase/functions/bot-matchup-defense-scanner/index.ts` (~line 157-173)

Add mutual exclusion logic: if `L3_CONFIRMED` would fire, suppress `L3_DECLINE` (for unders) and `L3_SURGE` (for overs) since the directional confirmation subsumes the trend warning.

Specifically:
1. Calculate both conditions first
2. If CONFIRMED + DECLINE both true on an UNDER → keep only CONFIRMED (decline *helps* the under)
3. If CONFIRMED + SURGE both true on an OVER → keep only CONFIRMED (surge *helps* the over)  
4. If DECLINE fires on an OVER or SURGE on an UNDER → keep both (these are genuine warnings)

This is a ~10-line logic change + redeploy of `bot-matchup-defense-scanner`.

