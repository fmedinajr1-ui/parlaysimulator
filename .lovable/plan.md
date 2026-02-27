

# Enable Alt Lines for Player Props + Fix Stripe Trial Card Enforcement

## Two Issues to Address

### Issue 1: Alt Lines Not Working for Player Props

**Root Cause:** The `selectOptimalLine` function (line 2843) has a strategy gate that only allows alt line selection when the strategy name contains `'aggressive'` or `'alt'`:

```text
if (!strategy.includes('aggressive') && !strategy.includes('alt')) {
    return { line: mainLine, odds: mainOdds, reason: 'safe_profile' };
}
```

But actual strategy names are `boosted_cash`, `golden_lock`, `proving_boosted`, etc. -- none contain those strings. So even when `useAltLines: true` is set on a profile, every call returns `'safe_profile'` immediately without ever checking alternate lines.

Additionally, player prop alternate lines are never fetched from the `fetch-alternate-lines` function. The only fetch call is for team spread cap shopping (lines 6143-6203).

**Fix (in `bot-generate-daily-parlays/index.ts`):**

1. **Update `selectOptimalLine` strategy gate** (line 2843) to also allow strategies containing `'boosted'`, `'golden'`, or `'cash_lock'`:
   - Change condition to: `if (!strategy.includes('aggressive') && !strategy.includes('alt') && !strategy.includes('boosted') && !strategy.includes('golden') && !strategy.includes('cash_lock'))`

2. **Add `fetchPlayerPropAltLines()` helper function** after the enrichment phase (~line 4189):
   - Identify profiles with `useAltLines: true` -- if none exist, skip entirely
   - Select top 15 enriched picks by composite score that have sufficient projection buffer (`projected_value - line >= getMinBuffer(prop_type)`)
   - For each qualifying pick, call `fetch-alternate-lines` with `{ eventId, playerName, propType, sport }`
   - Attach returned lines to `pick.alternateLines`
   - Sequential calls with 100ms delay, wrapped in try/catch so failures don't break the pipeline
   - Log results: `[AltLines] Fetched N alternate lines for PlayerName propType`

3. **Resolve `event_id` during enrichment** so the `fetch-alternate-lines` call has the required event ID:
   - During the enrichment loop, populate `event_id` from the oddsMap or unified_props data

4. **Enable `useAltLines` on 2 additional execution profiles:**
   - `golden_lock` (first NBA instance, line 851): `useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5`
   - `cash_lock` (3rd profile, line 844): `useAltLines: true, boostLegs: 1, minBufferMultiplier: 2.0`

---

### Issue 2: Stripe Not Enforcing Card During Free Trial

**Analysis:** The code in both `create-checkout` and `create-bot-checkout` already has the correct configuration:
- `payment_method_collection: "always"` (forces card collection)
- `trial_settings.end_behavior.missing_payment_method: "cancel"` (cancels if no card)

This configuration is correct per Stripe docs. The code-level implementation is right. Possible causes:

- **Stripe dashboard subscription settings** may override checkout session settings (e.g., if "Don't require payment method for trials" is enabled at the product/subscription level)
- The `consent_collection` parameter could add explicit terms acceptance

**Fix:** Add `consent_collection` with `terms_of_service: 'required'` to both checkout functions. This forces users to explicitly agree to terms and ensures card is validated with a $0 or $1 auth hold. Additionally, add `payment_intent_data` with `setup_future_usage: 'off_session'` to signal Stripe to validate the card more rigorously during trial signup.

### Files Modified

1. **`supabase/functions/bot-generate-daily-parlays/index.ts`**
   - Fix `selectOptimalLine` strategy gate to allow boosted/golden/cash_lock strategies
   - Add `fetchPlayerPropAltLines()` function after enrichment
   - Resolve `event_id` in enrichment loop
   - Enable `useAltLines: true` on `golden_lock` and one `cash_lock` profile

2. **`supabase/functions/create-checkout/index.ts`**
   - Add `consent_collection: { terms_of_service: 'required' }` to session creation
   - Add `custom_text` with trial terms disclosure

3. **`supabase/functions/create-bot-checkout/index.ts`**
   - Same Stripe trial enforcement changes as `create-checkout`

