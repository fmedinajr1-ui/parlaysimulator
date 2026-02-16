

# Add 2-Leg Mini-Parlay Hybrid Fallback

## Overview
Insert a new generation pass between the multi-leg parlay assembly and the single pick fallback. When fewer than 10 parlays are produced, first attempt to pair quality picks into 2-leg "mini-parlays" before falling back to singles. This gives you actual parlay action on light-slate days instead of only straight bets.

## How It Works

The new block runs at line ~4571 (after tier generation, before single pick fallback):

1. **Trigger**: Same condition as singles -- `allParlays.length < 10`
2. **Build candidate pool**: Reuse the same merged+deduplicated pool (team, player, whale, sweet spots)
3. **Pair generation**: Iterate through top candidates and pair them using constraints:
   - Both legs must have composite score >= 58 and hit rate >= 50%
   - Legs must be from **different games** (no same-game correlation tax)
   - Respect weight checks and spread caps (same as singles)
   - No mirror pairs (e.g., Team A spread + Team A moneyline)
4. **Quality gates**: Each mini-parlay must have:
   - Average composite score >= 60
   - Combined probability >= 25% (both legs hitting)
   - Positive expected edge
5. **Tier assignment**: Mini-parlays are assigned tiers based on average composite:
   - Execution: avg composite >= 70 and avg hit rate >= 58% (max 3)
   - Validation: avg composite >= 62 (max 5)
   - Exploration: everything else that passes gates (max 8)
6. **Cap**: Generate up to 16 mini-parlays total, then let remaining candidates fall through to single pick fallback
7. **Fallback continues**: After mini-parlays, if total parlays (multi-leg + mini) is still < 10, the single pick fallback runs as before

## Technical Details

### File Modified
`supabase/functions/bot-generate-daily-parlays/index.ts`

### Change Location
Insert new block at line 4571, between the tier generation loop and the `// === SINGLE PICK FALLBACK ===` comment.

### New Code Block (pseudo-structure)

```text
// === 2-LEG MINI-PARLAY HYBRID FALLBACK ===
if (allParlays.length < 10) {
  1. Build candidatePool (same merge + dedup as singles, reuse allPicksForSingles logic)
  2. Filter candidates: composite >= 58, hitRate >= 50%, weight > 0.5, spread < MAX_SPREAD_LINE
  3. Generate pairs:
     for i in candidates:
       for j in candidates (j > i):
         - Skip if same game (matching home_team+away_team or event_id)
         - Skip if mirror (same matchup, opposite sides)
         - Skip if duplicate fingerprint already in globalFingerprints
         - Calculate combined probability, edge, sharpe
         - If passes quality gates, add to miniParlays[]
  4. Sort miniParlays by combined edge descending
  5. Assign tiers + cap counts
  6. Push to allParlays[]
  7. Log: "[Bot v2] Mini-parlays created: X (exec=Y, valid=Z, explore=W)"
}

// === SINGLE PICK FALLBACK === (existing, now checks allParlays.length < 10 again)
```

### Key Details
- Mini-parlay `strategy_name` uses format: `{strategyName}_{tier}_mini_parlay`
- `leg_count` is set to 2
- `selection_rationale` includes both leg names and composite scores
- Combined odds calculated using standard multiplication of implied probabilities
- `is_simulated` follows same tier logic (only execution tier is not simulated)
- Stake uses existing `getDynamicStake()` function
- Dedup keys are added to `globalFingerprints` to prevent the DB insert from duplicating with existing parlays
- The single pick fallback threshold remains `< 10`, so if mini-parlays push the count above 10, singles are skipped entirely

### No Database Changes
Uses the existing `bot_daily_parlays` table -- 2-leg parlays are already a valid `leg_count`.

## Impact
- Light-slate days will now produce a mix of 2-leg parlays AND singles instead of only singles
- The pairing constraint (different games) avoids the 15% correlation tax
- Quality gates ensure mini-parlays maintain the same accuracy standards as regular tiers
- Existing multi-leg generation is completely untouched -- this only activates when the normal pipeline underproduces
