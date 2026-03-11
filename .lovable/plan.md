

## Disable Losing Strategies & Boost Top Performers

### Current State

After searching the codebase, here's what I found:
- **`validated_conservative`**: Exists with 6 profiles in the validation tier (lines 881-883, 926-928). This is the only active "losing" strategy still generating parlays.
- **`validation_mispriced_edge`** and **`strong_cash_cross_sport`**: These do NOT exist as active generation profiles — they were likely legacy strategy names from older settled parlays. No action needed.

### Changes (1 file: `bot-generate-daily-parlays/index.ts`)

**1. Remove `validated_conservative` (6 profiles)**
Comment out or delete all 6 `validated_conservative` profiles (lines 881-883 standard + lines 926-928 shuffle variants) from the validation tier.

**2. Boost top performers with the freed-up slots**

Replace those 6 profiles with:
- **+2 `cross_sport_4`** profiles in validation tier (currently only in execution/exploration) — add `minHitRate: 50` to allow validation-level filtering
- **+2 `double_confirmed_conviction`** profiles in validation tier (supplement the 2 already there at lines 891-892) — add shuffle sort variants for diversity
- **+2 `role_stacked_5leg`** profiles in exploration tier (supplement the 2 already there at lines 863-864) — add shuffle and composite sort variants

This maintains the same total profile count while shifting volume from the 0% win rate `validated_conservative` to the three strategies driving 90%+ of profits.

### Summary

| Strategy | Before | After |
|----------|--------|-------|
| `validated_conservative` | 6 profiles | 0 (disabled) |
| `cross_sport_4` | 10 execution + 2 exploration | +2 validation = 14 total |
| `double_confirmed_conviction` | 2 validation + ~20 exec/explore | +2 validation = ~24 total |
| `role_stacked_5leg` | 2 exploration | +2 exploration = 4 total |

