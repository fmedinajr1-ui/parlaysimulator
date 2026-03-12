

## Add Defensive Matchup Filter: Block OVER Stacking in GRIND-Cluster Games

### Problem
Yesterday's losses were concentrated in GRIND-cluster games (DEN/HOU, CLE/ORL) where overs got crushed by tough defenses. The system currently penalizes these via coherence scoring (-8 per tough defense, -8 per slow pace) but doesn't hard-block them, so they still get through.

### Solution
Add a **GRIND+OVER hard-block** at the individual pick level during leg selection, preventing OVER picks in confirmed GRIND-cluster games with tough defense from entering parlays. This is more effective than coherence penalties because it stops the pick before it's even considered.

### Changes

**`supabase/functions/bot-generate-daily-parlays/index.ts`** — Two modifications:

1. **New filter in the pick selection loop (~line 7893, after the GodModeMatchup check)**:
   - When a pick is OVER and its `_gameContext.envCluster === 'GRIND'` AND `defenseStrength === 'tough'`, skip it entirely
   - Applies to ALL tiers (not just execution) since GRIND+tough defense+OVER is a fundamentally bad combination
   - Exception: bench_under and grind_under_core strategies are exempt (they're already under-focused)
   - Log skipped picks for tracking: `[GrindOverBlock] Skipped: {player} OVER in GRIND+tough defense game`
   - Increment the existing `rejectionCounters.envCluster` counter

2. **Strengthen coherence penalties for OVER legs in GRIND games (~line 1666-1672)**:
   - When an OVER leg has `envCluster === 'GRIND'` AND `defenseStrength === 'tough'`, apply a -20 penalty (up from -8 + -8 = -16)
   - This catches any OVER+GRIND legs that slip through in mixed-cluster parlays

### Technical Detail

The filter checks two fields already attached to every pick during enrichment:
- `pick._gameContext.envCluster` — classified by `classifyEnvironmentCluster()` using pace, defense, vegas total, team total signals
- `pick._gameContext.defenseStrength` — classified by `classifyDefense()` (rank ≤ 10 = tough)

Both are already computed and attached before the selection loop, so no additional data fetching is needed.

