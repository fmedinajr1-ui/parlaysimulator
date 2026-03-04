## Plan: Exposure Cap, 3PM Offensive Gate, and Under-Heavy Rebalance — IMPLEMENTED ✅

### Changes Applied

1. **Player exposure capped to 1** — `maxPlayerUsage: 1` in all three tiers + `MAX_GLOBAL_PLAYER_PROP_USAGE = 1` globally. Matchup exploit override removed.

2. **3PM offensive ranking gate** — Hard-blocks 3PM overs when team `off_threes_rank >= 20`, penalizes -12 when `>= 15`.

3. **grind_under_core profiles added** — 4 execution, 4 validation, 6 exploration profiles filtering `recommended_side === 'under'`.

4. **GRIND cluster boosted** — 6 `env_cluster_grind` profiles in execution (was 4).

5. **3PT archetype profiles reduced** — Exploration: 3→1, Validation: 2→1 (3pt_scorer), reb_ast kept intact.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | All five changes |
