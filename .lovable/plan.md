

## Boost Mispriced Edge Strategy & Reduce Low-Performing Exploration Profiles

### What Changes
Increase `mispriced_edge` profile count across all three tiers (exploration, validation, execution) and reduce/remove lower-performing generic exploration strategies like `max_diversity`, `props_mixed`, and `cross_sport_4` that correspond to the "explore mixed" category in settled results.

### Profile Changes by Tier

#### Exploration Tier (50 profiles)
**Remove 8 low-value profiles:**
- 3x `max_diversity` (keep 2 -> remove 3)
- 2x `props_mixed` (keep 1 -> remove 2)
- 2x `cross_sport_4` (keep 2 -> remove 2)
- 1x `nighttime_mixed` (keep 1 -> remove 1)

**Add 8 new `mispriced_edge` profiles:**
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 52, sortBy: 'hit_rate' }`
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['icehockey_nhl'], minHitRate: 52, sortBy: 'hit_rate' }`
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 50, sortBy: 'hit_rate' }`
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 50, sortBy: 'composite' }`
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'composite' }` (duplicate for volume)
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba', 'icehockey_nhl'], minHitRate: 52, sortBy: 'composite' }`
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 55, sortBy: 'hit_rate' }` (duplicate for volume)
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['basketball_ncaab'], minHitRate: 52, sortBy: 'composite' }`

#### Validation Tier (15 profiles)
**Remove 1 profile:**
- 1x `validated_aggressive` (weakest filter profile)

**Add 2 new `mispriced_edge` profiles:**
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 58, sortBy: 'hit_rate' }`
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'composite' }`

#### Execution Tier (10 profiles)
**Add 2 new `mispriced_edge` profiles** (no removals needed since this is highest-stake):
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 62, sortBy: 'composite' }`
- `{ legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate' }`

### Net Effect
- **Mispriced edge profiles**: ~12 -> ~24 (doubled across all tiers)
- **Generic mixed/diversity profiles**: ~15 -> ~7 (halved)
- Total profile count stays roughly the same per tier
- All new mispriced_edge profiles are 3-leg only (proven optimal structure)

### Technical Details

**File modified:**
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- TIER_CONFIG profiles array updates in exploration (lines 226-315), validation (lines 328-373), and execution (lines 386-445)

