

# Add `optimal_combo` Strategy + Relax Ceiling Shot Gates

## Problem
1. High-probability winning picks aren't being combined because the engine builds parlays greedily per-profile (sort-and-take-top-N), missing optimal combinations.
2. Ceiling shot parlays are hard to generate because they require alt lines with plus-money odds — a strict gate that filters out most candidates.

## Changes — `supabase/functions/bot-generate-daily-parlays/index.ts`

### 1. Add `buildOptimalComboParlays()` function (~60 lines)
New combinatorial function that:
- Takes all sweet spot candidates passing 70%+ L10 hit rate
- Generates all valid 3-leg combinations (capped at top 30 candidates to keep C(30,3) = 4060 manageable)
- Scores each combo by **product of individual L10 hit rates** (combined probability)
- Filters out combos with correlated props (same player, same game_id)
- Returns top 5 non-overlapping combinations ranked by combined probability
- Uses relaxed `maxCategoryUsage: 4` to allow rebound-heavy or assist-heavy parlays when math supports it

### 2. Add `optimal_combo` profile entries (at TOP, right after floor_lock/ceiling_shot)
- **Execution tier** (3 profiles):
  - `{ legs: 3, strategy: 'optimal_combo', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'combined_probability' }`
  - `{ legs: 4, strategy: 'optimal_combo', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'combined_probability' }`
  - `{ legs: 3, strategy: 'optimal_combo', sports: ['all'], minHitRate: 70, sortBy: 'combined_probability' }`
- **Exploration tier** (3 profiles):
  - `{ legs: 3, strategy: 'optimal_combo', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'combined_probability' }`
  - `{ legs: 4, strategy: 'optimal_combo', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'combined_probability' }`
  - `{ legs: 3, strategy: 'optimal_combo', sports: ['all'], minHitRate: 60, sortBy: 'combined_probability' }`

### 3. Add strategy detection + assembly logic in the profile iteration loop (~line 6416)
- Detect `profile.strategy === 'optimal_combo'`
- Call `buildOptimalComboParlays()` which returns pre-assembled parlay leg sets
- Each returned combo becomes a full parlay (bypasses the standard greedy leg-by-leg assembly)
- Label with `🎲 OPTIMAL COMBO` in `selection_rationale`

### 4. Relax ceiling_shot candidate gate
- Currently requires alt lines with plus-money odds — most candidates get filtered here
- Relax: allow alt lines with odds >= -130 (not just > +100), broadening the candidate pool
- Also allow ceiling candidates WITHOUT alt lines to use the standard line if `l10_max >= line * 1.5` (very high ceiling = worth it even at standard odds)

### 5. Add `optimal_combo` and `floor_lock`/`ceiling_shot` to PRIORITY_STRATEGIES set
So they bypass the strategy diversity cap and always get processed.

### 6. After deploy: trigger test with `admin_only: true` and verify results

## Expected Output
- **Optimal combo parlays**: 3-5 parlays that maximize combined L10 hit rate probability (e.g., 90% × 100% × 90% = 81% combined)
- **More ceiling shot parlays**: relaxed odds gate should yield candidates that were previously filtered out

