

## Plan: Exposure Cap, 3PM Offensive Gate, and Under-Heavy Rebalance

### Problem Summary
March 3rd showed three clear failure patterns:
1. **Duplicate exposure** — Jarrett Allen appeared in 7+ parlays; one bad game wiped ~$700
2. **Blind 3PM overs** — shootout strategies pushed 3PM overs against teams where the player's own team doesn't even shoot well from three
3. **Under plays underweighted** — grind unders (Tre Johnson U PTS, Ty Jerome U PTS) were the day's best performers but had low allocation

---

### Changes

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

#### 1. Hard-cap player exposure to 1 across ALL tiers

| Config | Current | New |
|--------|---------|-----|
| `exploration.maxPlayerUsage` | 3 | **1** |
| `validation.maxPlayerUsage` | 3 | **1** |
| `execution.maxPlayerUsage` | 2 | **1** |
| `MAX_GLOBAL_PLAYER_PROP_USAGE` | 2 | **1** |
| Volume mode override | 4 | **1** |
| Matchup exploit override (line 6607) | 4 | **Remove override entirely** |

This means every player+prop combination can only appear in **1 parlay** across the entire daily slate. No more single-player wipeouts.

#### 2. Gate 3PM overs behind offensive threes ranking

Currently, 3PM overs are only blocked by **opponent defense** (top-5 block, top-10 penalty). There is NO check on whether the player's own team actually shoots well from three.

**Add new gate** in the defense hard-block section (~line 5461):
- If prop is threes/3pm AND side is over:
  - If team's `off_threes_rank >= 20` (bottom third offensively at 3PM): **hard-block** the pick entirely
  - If team's `off_threes_rank >= 15` (below average): apply **-12 composite penalty**
  - Only allow 3PM overs freely when `off_threes_rank <= 14` (top half of league in 3PM offense)

This uses the existing `teamDetail?.off_threes_rank` data that is already fetched but NOT used as a gate.

#### 3. Add under-heavy profiles to execution tier

Add new "grind_under" strategy profiles that specifically target UNDER plays with high hit rates:
- 4 new execution profiles: `grind_under_core` — NBA unders only, sorted by hit_rate, composite, env_cluster_grind, and shuffle
- 4 new validation profiles: same pattern
- 6 new exploration profiles with lower thresholds

These profiles will filter picks where `recommended_side === 'under'` during leg selection, similar to how `ncaab_unders_probe` already filters by `side: 'under'`.

#### 4. Boost GRIND cluster env_cluster_grind profile allocation

In the execution tier, increase grind-first profiles from 4 to 6 (add 2 more `env_cluster_grind` profiles). This shifts the balance from shootout-heavy to grind-heavy stacking.

#### 5. Remove/reduce 3PT archetype profiles

The `winning_archetype_3pt_scorer` strategy has multiple profiles across all three tiers. Reduce allocation:
- **Execution**: Remove all `winning_archetype_3pt_scorer` profiles (currently not present, confirm)
- **Validation**: Cut from 2 to 1 profile
- **Exploration**: Cut from 4 to 1 profile (keep only the highest hit-rate variant)

---

### Summary of Impact

| Metric | Before | After |
|--------|--------|-------|
| Max parlays per player | 3-4 (7+ observed) | **1** |
| 3PM over allowed without off ranking check | Yes | **No — blocked if team rank 20+** |
| Under-specific profiles in execution | 0 | **4** |
| Grind cluster profiles in execution | 4 | **6** |
| 3PT archetype profiles (total) | ~7 | **2** |

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | All five changes above — exposure cap, 3PM gate, under profiles, grind boost, 3PT archetype reduction |

