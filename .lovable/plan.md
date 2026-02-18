
# Fix Parlay Generation: Ban 2-Leg NBA Minis, Block NCAAB, Enforce NBA 3-Leg Execution

## What's Broken Right Now

**Problem 1 — 2-leg mini-parlays dominating execution tier**
The execution tier has 15 pending 2-leg parlays today (all NBA, `premium_boost_execution_mini_parlay`). The mini-parlay fallback at line 5014 triggers when `allParlays.length < 12`, and those mini-parlays get assigned to the execution tier at $100 each. The root cause is the golden gate (`ENFORCE_GOLDEN_GATE = true`) rejecting valid 3-leg NBA profiles before they can build.

**Problem 2 — NCAAB is bleeding**
The DB shows NCAAB parlays settling as `void` repeatedly. The KenPom-powered NCAAB team bet profiles (execution: `ncaab_totals`, `ncaab_unders`, `ncaab_spreads`, `ncaab_mixed`) are producing parlays that then cannot be settled — wasting $100 stakes. NCAAB's hit rate for totals/spreads historically < 45% per the bot logs.

**Problem 3 — Stakes look correct in DB ($100) but config says $20**
Line 3969 already overrides with 100: `const stake = typeof config.stake === 'number' && config.stake > 0 ? config.stake : 100`. However `TIER_CONFIG` still shows `stake: 20` for all tiers, which is misleading. This needs to be corrected so the explicit logic is removed and the config value is the single source of truth at $100.

**Problem 4 — Best NBA props are being wasted in 2-leg combos**
Today's top picks (Joel Embiid PTS 84% hit rate, THREE_POINT_SHOOTER 96% avg hit rate) are being put into 2-leg parlays instead of building proper 3-leg NBA parlays. The golden gate is too aggressive for the current pool size.

---

## The Fix Plan

### Change 1 — Upgrade TIER_CONFIG stakes to $100 across all tiers

In `TIER_CONFIG` (lines 56-237), update `stake` to `100` for all three tiers (exploration, validation, execution). This makes the config the source of truth and removes the override at line 3969 (which becomes `config.stake` = 100 automatically).

```typescript
// Before — in all 3 tiers:
stake: 20,

// After — in all 3 tiers:
stake: 100,
```

### Change 2 — Remove NCAAB from execution tier profiles entirely

NCAAB parlays are producing voids and losses. Remove all 5 NCAAB profiles from the execution tier profiles array (lines 226-230):

```typescript
// REMOVE these 5 profiles from execution.profiles:
{ legs: 3, strategy: 'ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'], minHitRate: 55, sortBy: 'composite' },
{ legs: 3, strategy: 'ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'], minHitRate: 55, sortBy: 'composite' },
{ legs: 3, strategy: 'ncaab_unders', sports: ['basketball_ncaab'], betTypes: ['total'], minHitRate: 55, sortBy: 'composite' },
{ legs: 3, strategy: 'ncaab_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'], minHitRate: 55, sortBy: 'composite' },
{ legs: 3, strategy: 'ncaab_mixed', sports: ['basketball_ncaab'], betTypes: ['spread', 'total'], minHitRate: 55, sortBy: 'composite' },
```

Also remove the 2 NCAAB profiles from validation tier (lines 171-172):
```typescript
// REMOVE from validation.profiles:
{ legs: 3, strategy: 'validated_ncaab_totals', sports: ['basketball_ncaab'], betTypes: ['total'], minOddsValue: 45, minHitRate: 55 },
{ legs: 3, strategy: 'validated_ncaab_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'], minOddsValue: 45, minHitRate: 55 },
```

And remove/reduce NCAAB exploration profiles (lines 86-152) — keep only 2 conservative ones instead of 9.

### Change 3 — Add more NBA 3-leg execution profiles to replace NCAAB slots

Replace the 5 removed NCAAB execution profiles with 5 more NBA-focused 3-leg profiles:

```typescript
// ADD to execution.profiles — replacing the 5 NCAAB slots:
{ legs: 3, strategy: 'nba_under_specialist', sports: ['basketball_nba'], minHitRate: 62, sortBy: 'hit_rate', useAltLines: false },
{ legs: 3, strategy: 'nba_3pt_focus', sports: ['basketball_nba'], minHitRate: 62, sortBy: 'hit_rate', useAltLines: false },
{ legs: 3, strategy: 'nba_mixed_cats', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'composite', useAltLines: false },
{ legs: 3, strategy: 'cash_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
{ legs: 3, strategy: 'golden_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
```

### Change 4 — Fix the mini-parlay fallback to NEVER use the execution tier

The mini-parlay fallback at line 5161 assigns tiers. Change the execution cap from 3 to 0 — mini-parlays should never be execution tier bets:

```typescript
// Before (approx line 5161-5163):
const miniTierCaps = { execution: 3, validation: 5, exploration: 8 };

// After:
const miniTierCaps = { execution: 0, validation: 3, exploration: 6 };
```

This ensures the 2-leg combos stay in exploration/validation at reduced stakes, not execution at $100.

### Change 5 — Relax the golden gate threshold slightly for NBA

Currently `ENFORCE_GOLDEN_GATE = true` requires `playerLegs.length - 1` legs from golden categories. With a thin NBA sweet-spot pool, this blocks valid 3-leg parlays. Change to `Math.max(1, Math.floor(playerLegs.length * 0.5))` — at least 50% golden legs (1 of 2 player legs, or 1 of 3), not `all-1`:

```typescript
// Before (line 3808):
const minGoldenLegs = Math.max(1, playerLegs.length - 1); // Allow 1 non-golden player leg

// After:
const minGoldenLegs = Math.max(1, Math.floor(playerLegs.length * 0.5)); // 50% golden legs
```

This relaxes from requiring 2-of-3 golden to 1-of-2 or 2-of-4, building more valid NBA 3-leg parlays instead of falling back to 2-leg minis.

---

## Files to Change

**1 file: `supabase/functions/bot-generate-daily-parlays/index.ts`**

- Lines 57-237: Update `stake: 20 → 100` in all 3 tier configs
- Lines 171-172: Remove 2 NCAAB validation profiles  
- Lines 86-152: Trim NCAAB exploration from 9 profiles to 2 (keep `ncaab_accuracy` only)
- Lines 226-230: Remove 5 NCAAB execution profiles, add 5 NBA profiles
- Line 3808: Relax golden gate from `playerLegs.length - 1` to `Math.floor(playerLegs.length * 0.5)`
- Lines 5161-5163: Set mini-parlay execution cap to 0

Then redeploy the edge function.

---

## Expected Outcome

| Before | After |
|---|---|
| 15 x 2-leg NBA mini-parlays in execution ($100 each) | 0 mini-parlays in execution tier |
| 5 NCAAB execution profiles (bleeding $) | NCAAB execution = blocked |
| Golden gate blocking valid NBA 3-leg builds | 3-leg NBA parlays built with 50% golden threshold |
| Stake config says $20 but overrides to $100 | Config correctly says $100, no override needed |
| Best picks (Embiid 84%, 3PT 96%) stuck in 2-leg combos | Proper 3-leg NBA execution parlays using best picks |
