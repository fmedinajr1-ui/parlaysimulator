

## Fix Inverted Defense Rank Normalization

### The Bug
The comment in the code correctly states the intent: "rank 1=best defense, 30=worst" and "30=soft=1.0, 1=tough=0.0". But the formula does the opposite:

```text
Current:  (30 - rank) / 29
  Rank 1  (toughest) -> 29/29 = 1.0  (treated as FAVORABLE for Overs -- WRONG)
  Rank 30 (softest)  ->  0/29 = 0.0  (treated as UNFAVORABLE for Overs -- WRONG)

Fixed:    (rank - 1) / 29
  Rank 1  (toughest) ->  0/29 = 0.0  (unfavorable for Overs -- CORRECT)
  Rank 30 (softest)  -> 29/29 = 1.0  (favorable for Overs -- CORRECT)
```

This means elite defenses like Memphis (Rank 5) are currently *boosting* Over confidence when they should be *suppressing* it, and weak defenses are being penalized when they should help.

### The Fix
Change `(30 - rank) / 29` to `(rank - 1) / 29` in all three places it appears, across both edge functions.

### Files to Change

**1. `supabase/functions/bot-generate-daily-parlays/index.ts`**
- Line 108: `defenseFactor = (oppDefenseRank - 1) / 29;` (was `(30 - oppDefenseRank) / 29`)
- Line 116: `rebAstFactor = (oppRebRank - 1) / 29;` (was `(30 - oppRebRank) / 29`)
- Line 119: `rebAstFactor = (oppAstRank - 1) / 29;` (was `(30 - oppAstRank) / 29`)
- Lines 122-123: Same fix for the PRA combo calculation

**2. `supabase/functions/prop-engine-v2/index.ts`**
- Line 108: `defenseFactor = (oppDefenseRank - 1) / 29;`
- Line 115: `rebAstFactor = (oppRebRank - 1) / 29;`
- Line 118: `rebAstFactor = (oppAstRank - 1) / 29;`

### Impact
- Memphis (Rank 5): defense factor drops from 0.86 to 0.14 for Overs -- correctly penalizing Overs against a top-5 defense
- A Rank 25 (soft) defense: factor rises from 0.17 to 0.83 -- correctly boosting Overs against a weak defense
- All REB and AST environment factors also corrected in the same way

### Deployment
Both `bot-generate-daily-parlays` and `prop-engine-v2` edge functions will be redeployed.

