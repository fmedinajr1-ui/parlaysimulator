

## GOD MODE: Superior Prediction Engine (Target 70-80% Parlay Hit Rate)

### Current State Assessment

The engine currently has all the components needed -- L10 feedback, offense/defense matchup scoring, coherence stacking, multi-engine consensus, and winning pattern detection. The problem is these components aren't working together at maximum intensity. Here's what's leaving accuracy on the table:

1. **Execution tier gates are too loose**: 60% minHitRate allows marginal picks that drag down parlay win rates
2. **Coherence gate at 70 is too low**: Parlays with mixed environments (SHOOTOUT + GRIND) still slip through
3. **No parlay-level hit rate floor**: Individual legs may pass but the combined probability isn't gated aggressively
4. **L10 feed doesn't boost composite scores**: Strategy multipliers throttle volume but don't amplify high-performers
5. **Offense/defense matchup doesn't hard-block bad matchups**: OVER picks against top-5 defenses + weak team offense still get through
6. **No "GOD MODE" execution tier**: The highest-conviction picks (triple-confirmed + favorable matchup + proven winner) aren't isolated into a premium tier

### Plan: 7 Surgical Upgrades

#### 1. Create GOD MODE Execution Tier
Add a new ultra-premium tier within the execution profiles that ONLY accepts picks meeting ALL of these criteria simultaneously:
- Triple-confirmed OR multi-engine consensus (3+ engines)
- Player is a proven winner (70%+ L10 hit rate, 5+ legs)
- Favorable offense/defense matchup (matchupFactor >= 0.6)
- NOT on a losing streak (streak >= 0)
- Environment coherence with other legs >= 85

This tier generates 5-8 parlays with the absolute highest conviction.

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**
- Add 8 new `god_mode_lock` profiles to the execution tier with `minHitRate: 70`, `sortBy: 'hit_rate'`
- These profiles draw from a new `godModePicks` pool (intersection of triple-confirmed + proven winners + favorable matchup)

#### 2. Raise Execution Tier Quality Gates
Tighten the execution tier to reject anything that isn't elite:
- Raise `minHitRate` from 60 to 65 for all execution profiles
- Raise coherence gate from 70 to 80 for execution tier
- Raise `minConfidence` from 0.60 to 0.65
- Add a parlay-level combined probability floor: reject if combinedProbability < 0.20 (each leg averaging ~58.5%+ for 3-leg)

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**
- Update `TIER_CONFIG.execution` thresholds
- Add combinedProbability floor check in the post-leg-selection validation block

#### 3. L10 Hit Rate Composite Score Amplifier
Make the L10 strategy multiplier directly boost composite scores, not just throttle volume:
- When a strategy has >45% win rate (7d), apply a +8 composite bonus to all its candidate picks
- When a strategy has >55% win rate, apply +15 composite bonus
- When a strategy has <25% win rate, apply -15 composite penalty (actively demote, not just cap volume)

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**
- Add `getStrategyCompositeBoost(strategy)` function
- Apply boost during candidate sorting in `generateTierParlays`

#### 4. Hard Matchup Block for Execution Tier
Extend the existing prop-specific defense routing to HARD BLOCK execution-tier picks with terrible matchups:
- OVER picks: Block when opponent defense rank <= 5 AND team offense rank >= 25 (strong D vs weak O)
- UNDER picks: Block when opponent defense rank >= 25 AND team offense rank <= 5 (weak D vs strong O)
- Apply a sliding matchup penalty: -10 composite for borderline matchups (rank 6-10 defense + rank 20-25 offense)

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**
- Add `passesGodModeMatchup()` function that checks bidirectional matchup
- Insert matchup check in the candidate pick loop for execution tier, using the defenseDetailMap offensive ranks

#### 5. Proven Winner Priority Queue
Restructure execution tier pick selection to prioritize proven winners:
- Sort proven winners (70%+ L10, 5+ legs, streak >= 0) to the TOP of every candidate list
- Apply +20 composite bonus for proven winners in execution tier
- Apply -999 (hard block) for serial losers (hit rate < 30%, 5+ legs) -- already exists but verify it's active in all pools

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**
- Enhance the accuracy-first sorting to add a proven-winner priority tier above archetype bonuses
- Verify serial loser blocking is applied to mispriced and team pick pools (not just sweet spots)

#### 6. Coherence-Aware Stacking Enforcer
Strengthen the coherence system to ensure every parlay is environmentally aligned:
- Raise coherence gate to 85 for GOD MODE profiles
- Add a new coherence check: all legs must share the same environment cluster (SHOOTOUT or GRIND) -- no mixing allowed for execution tier
- Add offense/defense alignment check: all OVER legs must face bottom-half defenses (rank 16-30), all UNDER legs must face top-half defenses (rank 1-15)

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**
- Update `calculateParlayCoherence()` to include matchup alignment scoring
- Add cluster homogeneity check in the post-leg validation block

#### 7. Autonomous Hit Rate Recalibration Loop
Ensure the L10 feed is working end-to-end autonomously:
- Verify `bot-update-engine-hit-rates` is called after settlement (already wired)
- Add a pre-generation verification step: if `bot_strategies.win_rate` hasn't been updated in 24 hours, trigger an immediate refresh before generating
- Log the effective strategy multipliers to `bot_activity_log` for daily monitoring

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**
- Add stale-check logic at the start of the main handler: query `bot_strategies.updated_at` and trigger refresh if stale
- Log strategy multipliers to `bot_activity_log` after loading

### Technical Details

**Modified file: `supabase/functions/bot-generate-daily-parlays/index.ts`**

Changes (by section):
1. New `god_mode_lock` profiles added to `TIER_CONFIG.execution.profiles` (8 profiles)
2. `TIER_CONFIG.execution` thresholds raised: `minHitRate: 65`, `minConfidence: 0.65`
3. New `getStrategyCompositeBoost()` function added near `getStrategyVolumeCap()`
4. New `passesGodModeMatchup()` function added near defense filter helpers
5. Proven winner +20 bonus in accuracy-first sorting
6. Coherence gate raised to 80 for execution, 85 for god_mode profiles
7. Combined probability floor (0.20) added to parlay validation
8. Stale hit rate detection + auto-refresh at start of main handler
9. New `godModePicks` pool creation in `buildPropPool()` -- intersection of triple-confirmed + proven winners + favorable matchup
10. Matchup hard-block in execution tier candidate loop

No new files or database migrations needed -- this is pure logic hardening within the existing generation engine.

### Expected Impact

- **Execution tier**: Only elite picks survive the raised gates, pushing individual leg accuracy from ~60% to ~70%+
- **GOD MODE tier**: The intersection of triple-confirmed + proven winner + favorable matchup targets 75-80% per-leg accuracy
- **3-leg parlay math**: At 70% per-leg accuracy, 3-leg parlays hit 34.3%. At 75%, they hit 42.2%. At 80%, they hit 51.2%.
- **Volume trade-off**: Execution tier output drops from ~15 to ~8-12 parlays, but quality dramatically increases. GOD MODE adds 5-8 ultra-premium parlays.
- **Autonomous feedback**: Stale hit rate detection ensures the engine never runs blind again

