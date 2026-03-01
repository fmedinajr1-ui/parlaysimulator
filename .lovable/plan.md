

## Fix: Prioritize Double/Triple Confirmed Conviction in Pipeline

### Problem
The `double_confirmed_conviction` and `triple_confirmed_conviction` profiles are buried at lines 907-911 in the execution tier profile list, after ~27 other profiles (cash_lock, boosted_cash, golden_lock, hybrid, team, ncaab, whale, etc.). The pipeline iterates profiles sequentially and stops when `config.count` is reached (line 5863). This means on busy days, the high-conviction profiles never get a chance to run.

Additionally, the 30% strategy diversity cap can block them if other strategies already consumed their slots.

### Solution
Move all `double_confirmed_conviction` and `triple_confirmed_conviction` profiles to the **top** of the execution tier profile list, before all other strategies. This guarantees they run first and get their parlays generated before the count cap or diversity cap kicks in for other strategies.

### Changes

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. **Remove** the 6 double/triple confirmed profiles from their current positions (lines 906-911 and 930-932)
2. **Insert** them at the very top of the execution tier profiles array (before line 880's `cash_lock`), grouped together with a clear comment:

```text
// ============= PRIORITY: HIGH-CONVICTION STRATEGIES (run first) =============
// Triple-confirmed: sweet spot + mispriced + risk engine agreement
{ legs: 3, strategy: 'triple_confirmed_conviction', sports: ['all'], minHitRate: 70, sortBy: 'composite' },
// Double-confirmed: sweet spot + mispriced edge agreement
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 70, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'composite' },
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 65, sortBy: 'composite' },
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 65, sortBy: 'composite', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
// ============= STANDARD EXECUTION STRATEGIES =============
```

3. **Exempt from diversity cap**: Add `double_confirmed_conviction` and `triple_confirmed_conviction` to a priority bypass list in the profile loop (around line 5865-5872) so they are never skipped by the 30% strategy diversity cap. These are cross-referenced picks with the highest conviction -- they should always generate if data exists.

```text
// Priority strategies bypass the diversity cap
const PRIORITY_STRATEGIES = new Set([
  'double_confirmed_conviction',
  'triple_confirmed_conviction',
]);

// In the loop, before the cap check:
if (!PRIORITY_STRATEGIES.has(profile.strategy)) {
  // existing diversity cap logic
}
```

### Files Modified
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- reorder profiles + add diversity cap bypass

### Impact
- Double/triple confirmed picks will always attempt to generate first
- Other strategies still run normally after priority strategies
- The 30% diversity cap still applies to all non-priority strategies
- No changes to strategy logic, pick selection, or scoring -- only execution order
