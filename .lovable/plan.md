

## Plan: Promote Cross Sport 4-Leg to Execution Tier

**Current State**: `cross_sport_4` has 7 profiles in the exploration tier (lines 732-736 + 800-801), using exploration-level stakes ($50) and constraints. It's 8-0 with $3,930 profit — a proven winner sitting in the wrong tier.

**Goal**: Promote to execution tier, increase volume, apply $250 execution stakes, and add dedicated sort/filter variations to maximize output.

---

### Changes (1 file: `bot-generate-daily-parlays/index.ts`)

#### 1. Move cross_sport_4 profiles from exploration to execution tier
- Remove 7 `cross_sport_4` entries from the exploration profiles array (lines 732-736, 800-801)
- Add 10 `cross_sport_4` profiles to the execution tier with varied configurations:
  - 3x `sortBy: 'composite'` (default high-confidence selection)
  - 3x `sortBy: 'hit_rate'` (prioritize proven hitters)
  - 2x `sortBy: 'shuffle'` (break deterministic overlap)
  - 2x with `minHitRate: 55` for tighter filtering
- All execution profiles inherit execution-tier gates: `minHitRate: 55+`, `minEdge`, `minSharpe`, verified source requirement, and `$250` stake from `bot_stake_config`

#### 2. Add sport-specific cross_sport_4 variants
- Add targeted sport-pair profiles to execution:
  - `sports: ['basketball_nba', 'icehockey_nhl']` — proven NBA+NHL correlation
  - `sports: ['basketball_nba', 'basketball_ncaab']` — basketball stack
- These force at least 2 sports represented in every 4-leg parlay

#### 3. Keep 2 exploration copies as feeders
- Retain 2 `cross_sport_4` profiles in exploration with `sortBy: 'shuffle'` and relaxed `minHitRate: 45` to continue discovering new cross-sport combos that can graduate to execution

### Impact
- **Volume**: ~5 daily → ~12-15 daily cross-sport 4-leg parlays
- **Stakes**: $50 exploration → $250 execution ($5x amplifier on winning strategy)
- **Settlement**: Already works via `bot-settle-and-learn` — no changes needed
- **Projected P&L boost**: At 100% win rate on $250 stakes, each win adds ~$500-2000 vs $100-400 previously

