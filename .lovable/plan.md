

# Shift NCAAB Strategy: Totals and Spreads Over Moneylines

## Why

Yesterday's data was clear:
- NCAAB ML Favorites: **0/12 (0%)**
- NCAAB Totals: **100% hit rate**
- NCAAB Spreads: **43% hit rate**
- NCAAB Underdogs: **71% hit rate**

College moneyline favorites -- especially outside the Top 50 -- are unreliable. Totals are the most predictable bet type in college basketball because tempo is measurable. Spreads with large efficiency gaps also carry edge.

## Changes to `bot-generate-daily-parlays/index.ts`

### Exploration Tier (lines 81-97)

**Before:** 5 generic NCAAB profiles + 6 ML-heavy team profiles
**After:** Rebalance to favor totals/spreads, reduce pure ML exposure

| Profile | Before | After |
|---------|--------|-------|
| `ncaab_safe` (generic) | 2 | 0 (replaced with totals-focused) |
| `ncaab_totals` | 0 | 3 (new) |
| `ncaab_spreads` | 0 | 2 (new) |
| `team_ml` (pure ML) | 4 | 1 |
| `team_ml_cross` (ML cross-sport) | 2 | 1 |
| `team_totals` | 2 | 4 |
| `team_spreads` | 0 | 2 (new) |

### Validation Tier (lines 140-141)

**Before:** 2 generic `validated_ncaab` profiles
**After:** Split into 1 totals-focused + 1 spreads-focused, both requiring composite score 62+

### Execution Tier (lines 193-195)

**Before:** 1 `ncaab_ml_lock` (moneyline) + 1 `ncaab_totals`
**After:** Remove `ncaab_ml_lock` entirely, replace with:
- 2x `ncaab_totals` (tempo-driven, most reliable)
- 1x `ncaab_spreads` (efficiency-gap driven, Top 100 only)

### Safety Gate: Block NCAAB ML Favorites Ranked 150+

Add a filter in the team leg selection logic: when sport is `basketball_ncaab` and bet type is `moneyline` and the team's KenPom rank is outside the Top 150, **reject the leg**. This prevents the bot from blindly backing weak favorites like Binghamton or Maine.

### Composite Score Minimum for NCAAB

Raise the minimum composite score for NCAAB team legs from 55 to 62 across all tiers. The KenPom scoring engine now produces real differentiated scores, so a higher floor filters out low-confidence noise.

## Summary of Profile Count Changes

| Bet Type | Before (all tiers) | After (all tiers) |
|----------|--------------------|--------------------|
| NCAAB Moneyline | ~8 profiles | 1 profile (underdog-only, Top 100) |
| NCAAB Totals | 1 profile | 6 profiles |
| NCAAB Spreads | 0 profiles | 5 profiles |
| Generic NCAAB | 7 profiles | 0 profiles |

## File Modified

1. `supabase/functions/bot-generate-daily-parlays/index.ts` -- Profile rebalancing, NCAAB ML safety gate, composite score floor increase

