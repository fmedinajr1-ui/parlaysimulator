

## Stricter Pre-Game Swap Logic: Drop Dead Legs, Reduce to 2-Leg, Raise Stakes

### Current Behavior (Problems)
1. Swap acceptance is too loose — accepts `slight_upgrade` which is barely better than the dead leg.
2. When no swap is found, the parlay is **voided entirely** if ≥50% of legs are dead. This wastes good remaining legs.
3. No stake adjustment when legs are removed — a 2-leg parlay from a former 4-leg ticket still uses the same stake.

### New Behavior
1. **Stricter swap criteria**: Only accept `strong_upgrade` or `upgrade` (drop `slight_upgrade`). Raise `minimumConfidence` from 65 → 70.
2. **Drop dead legs instead of voiding**: When no swap is found for a flagged leg, **remove it** from the parlay entirely rather than voiding the whole ticket. The parlay continues with the remaining healthy legs (minimum 2 legs required — if fewer than 2 healthy legs remain, then void).
3. **Recalculate odds**: After removing dead legs, recompute the parlay odds from the remaining legs' individual odds.
4. **Raise stakes on reduced parlays**: Load stake config from `bot_stake_config`. When legs are dropped (not swapped), increase the stake proportionally — e.g., a 4-leg parlay reduced to 2 legs gets ~1.5x the original stake (capped at `execution_stake` from config). Lower leg count = lower variance = higher confidence = justify more stake.
5. **Re-broadcast the updated ticket** to Telegram with clear messaging: "🔄 Reduced to 2-leg | Stake raised to $X"

### File Changes

**`supabase/functions/pre-game-leg-verifier/index.ts`**:
- Line 169: Remove `'slight_upgrade'` from accepted recommendations — only `['strong_upgrade', 'upgrade']`
- Line 159: Change `minimumConfidence: 65` → `minimumConfidence: 70`
- Lines 229-253: Replace void logic with **leg removal logic**:
  - Filter out dead legs (OUT players with no swap) from `updatedLegs`
  - If ≥2 healthy legs remain → keep the parlay, recalculate odds, raise stake
  - If <2 healthy legs → void as before
- Add stake config loading at the top (query `bot_stake_config` for `execution_stake`)
- Recalculate `expected_odds` from remaining legs' `american_odds`
- Set new `simulated_stake` = original stake × multiplier (e.g., 1.5x for losing 1+ legs, capped at execution_stake)
- Update the DB record with: reduced `legs`, new `expected_odds`, new `simulated_stake`, `legs_dropped` count
- Update Telegram report to show dropped legs and new stake

**`supabase/functions/bot-send-telegram/index.ts`**:
- Update `formatLegSwapReport` to include a section for **dropped legs** (not just swaps) and show the new stake amount

