

# Encode March 12 Winning Patterns into the Generator

## Key Takeaways from March 12 vs March 19

| Pattern | March 12 Winners | March 19 Risk |
|---------|-----------------|---------------|
| Leg count | ALL 7 winners = 3-leg | 5-leg and 8-leg parlays = 100% loss rate |
| Per-leg L10 hit rate | ALL winning legs had 100% L10 hit rate | Several legs at 70-90% caused losses |
| Categories | THREE_POINT_SHOOTER, HIGH_ASSIST dominated | VOLUME_SCORER is already blocked |

## Changes (3 targeted fixes)

### 1. Remove 5-leg and 8-leg role-stacked generation entirely
**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

The multi-leg ticket builder (lines ~10672-10687) creates 5-leg and 8-leg exploration parlays. These have a **0% historical win rate**. Remove or disable both `buildMultiLegTicket(5)` and `buildMultiLegTicket(8)` calls. Also remove the 4 `role_stacked_5leg` profiles from exploration tier (lines 870-874).

This keeps the 3-leg `role_stacked_3leg` profiles in execution tier, which match the winning pattern.

### 2. Raise per-leg L10 hit rate floor for execution tier
**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

Currently execution `minHitRate` is 55-70% depending on strategy. The March 12 data shows **100% L10 hit rate on every winning leg**. Add a hard gate in the parlay assembly loop: for execution-tier parlays, reject any individual leg where L10 hit rate < 90%. This doesn't change profile-level `minHitRate` (which is an average threshold) — it adds a per-leg floor.

In the leg selection logic (around line ~7100-7200 in the greedy assembly loop), add:
```typescript
// WINNING PATTERN GATE: Execution tier requires 90%+ L10 hit rate per leg
if (tier === 'execution') {
  const legL10 = rawL10 <= 1 ? rawL10 * 100 : rawL10;
  if (legL10 < 90) {
    // Skip this leg — March 12 analysis shows sub-90% legs cause losses
    continue;
  }
}
```

### 3. Remove `sweet_spot_l3` 5-leg profiles from exploration
**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

Lines 706-708 and 710-715 have 5-leg profiles (`sweet_spot_l3`, `l3_matchup_combo`, `l3_sweet_mispriced_hybrid`). Based on the 0% win rate on 5+ leg parlays, cap all exploration profiles at **4 legs max** by changing these from `legs: 5` to `legs: 4` (or removing them if 4-leg versions already exist).

## What This Preserves
- All 3-leg strategies (optimal_combo, floor_lock, ceiling_shot, sweet_spot_core, etc.)
- All 4-leg strategies (cross_sport_4, sweet_spot_plus)
- Exploration and validation tiers continue generating volume
- The existing composite filter, matchup gates, and player performance blocks remain intact

## Expected Impact
- Eliminates the 5-leg and 8-leg parlays that have never won
- Raises the quality floor for execution-tier legs to match March 12's 100% hit rate pattern
- Keeps parlay volume high (3-leg and 4-leg dominate the profile list already)

