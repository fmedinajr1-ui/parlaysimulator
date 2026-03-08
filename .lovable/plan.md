

## Audit Findings: Win Accuracy & Void Issues

### Two bugs found in the settlement engine (`bot-settle-and-learn/index.ts`)

---

### Bug 1: `legs_voided` counter never written to database

The settlement engine computes `legsVoided` internally (line 902) but **never saves it** to the `bot_daily_parlays` update (lines 956-967). The update writes `legs_hit` and `legs_missed` but omits `legs_voided`. Every record shows `legs_voided: 0` even when legs are clearly voided in the JSON.

**Affected parlays (March 1-8):** 14 won parlays have voided legs but `legs_voided = 0`.

---

### Bug 2: Profit calculated at full expected odds, ignoring voided legs

When legs void, sportsbooks remove them and recalculate reduced odds. The settlement engine at line 912 uses `parlay.expected_odds` (the original full-parlay odds) regardless of how many legs voided. This inflates profit.

**Examples of inflated wins:**

| Parlay | Legs | Hit | Voided | Expected Odds | Profit Paid | Issue |
|--------|------|-----|--------|--------------|-------------|-------|
| `971da54b` (Mar 7) | 3 | 2 | 1 | +596 | $596 | Should be ~$263 (2-leg reduced odds) |
| `295fcdf3` cross-sport (Mar 7) | 6 | 4 | 2 | +850 | $425 | Should be recalculated for 4-leg parlay |
| 6x `cross_sport_4` (Mar 5) | 4 | 2 | 2 | +1228 | $245.60 each | Only 2 NBA legs hit; 2 MLB legs voided — should be 2-leg odds |

**Estimated profit inflation:** Several thousand dollars across 14 affected parlays.

---

### Fix Plan

**File:** `supabase/functions/bot-settle-and-learn/index.ts`

1. **Add `legs_voided` to the update** (line 956-967): Include `legs_voided: legsVoided` in the database update object.

2. **Recalculate odds when legs void**: When `legsVoided > 0` and the parlay wins, compute reduced odds from the remaining (non-voided) legs' individual odds instead of using `expected_odds`. Specifically:
   - Collect individual American odds from each non-voided leg (e.g., `leg.american_odds || leg.odds || -110`)
   - Multiply their decimal equivalents to get the true reduced parlay odds
   - Use that for payout calculation

3. **Backfill existing records**: Run a one-time SQL update to fix `legs_voided` counts and recalculate `profit_loss` for the 14 affected "won" parlays from March 1-8.

This is a **critical accuracy fix** — the P&L reporting is currently overstated due to voided legs being paid at full parlay odds.

