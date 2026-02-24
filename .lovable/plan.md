

## Apply Environment Score to Player Prop Composite Scores

### Problem

The environment score engine (`calculateEnvironmentScore`) is correctly computing pace, defense, rebound/assist environment, and blowout risk adjustments for every NBA player prop. However, the result is **only stored as metadata** -- it is never added to the `compositeScore` that drives pick selection and parlay generation.

This means:
- A player OVER prop facing the #1 defense in a slow-pace game gets the **same composite score** as one facing the #30 defense in a fast-pace game
- The environment intelligence is computed but wasted -- it only shows up in the UI badge, never influencing which picks actually get selected
- `prop-engine-v2` correctly includes environment as 10% of its SES score, but `bot-generate-daily-parlays` does not

### Current State

| Pipeline Stage | Environment Score Used? | How? |
|---|---|---|
| Game bets (totals/spreads) | YES | Added to composite score (line 1384) |
| Sweet spot player props | METADATA ONLY | Stored on pick but NOT added to compositeScore |
| Mispriced player props | METADATA ONLY | Stored on pick but NOT added to compositeScore |
| prop-engine-v2 (SES) | YES | 10% weight in total SES score |
| Parlay coherence scoring | YES | Pace/defense checks in parlay-level scoring |

### Fix

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

**Change 1: Sweet spot picks (~line 4430)**

After storing the environment score as metadata, also apply it to the composite score:

```typescript
(pick as any).environmentScore = envResult.confidenceAdjustment;
(pick as any).environmentComponents = envResult.components;
// APPLY environment adjustment to composite score
pick.compositeScore = Math.min(95, Math.max(0, pick.compositeScore + envResult.confidenceAdjustment));
```

**Change 2: Mispriced picks (~line 4725)**

Same pattern -- apply the confidence adjustment to the composite score:

```typescript
(pick as any).environmentScore = envResult2.confidenceAdjustment;
(pick as any).environmentComponents = envResult2.components;
// APPLY environment adjustment to composite score
pick.compositeScore = Math.min(95, Math.max(0, pick.compositeScore + envResult2.confidenceAdjustment));
```

**Redeploy `bot-generate-daily-parlays`.**

### Impact

- Player OVER props against soft defenses in fast-pace games get a score **boost up to +20**
- Player OVER props against elite defenses in slow-pace games get a score **penalty down to -20**
- UNDER props get the inverse adjustments (tough defense = boost, soft defense = penalty)
- Combo props (PRA, PR, PA, RA) benefit from the rebAst factor using opponent rebound/assist ranks
- Picks that currently squeak into parlays despite hostile environments will be filtered out
- Picks in favorable environments that were borderline will now make the cut
- The composite score range is still clamped to 0-95 to prevent overflow

