

# Role-Based Leg Stacking + Replay Yesterday's Lottery Pattern

## Overview

Currently, both the **bot-generate-daily-parlays** and **nba-mega-parlay-scanner** (lottery) use greedy top-down composite scoring to fill parlay legs -- they just grab the highest-scoring picks in order. There's no concept of *role-based stacking* where each leg serves a distinct purpose (safe anchor, balanced value, high-odds upside).

This plan introduces **role-based 3-leg stacking** and runs one additional lottery today using yesterday's pattern to validate it.

---

## Part 1: Role-Based Leg Assignment in `nba-mega-parlay-scanner`

Instead of greedy composite sort, the lottery scanner will build each 3-leg parlay with intentional roles:

| Leg | Role | Criteria |
|-----|------|----------|
| 1 | **SAFE** | Highest L10 hit rate (>= 70%), mispriced edge confirmed, defense rank 15+ (neutral/weak), lowest variance |
| 2 | **BALANCED** | Hit rate >= 60%, edge >= 5%, defense-aware (rank 18+), mispriced or sweet spot agreement |
| 3 | **GREAT ODDS** | Plus-money odds (+120 or higher), alt line shopped, volume candidate, L10 avg clears line by 1.3x+ |

### Implementation in `nba-mega-parlay-scanner/index.ts`:

**Replace the single greedy loop (lines 585-636) with a 3-pass role-based builder:**

```text
Pass 1 (SAFE): Filter scoredProps for hitRate >= 70, edgePct >= 3, defenseRank >= 15 (or null).
               Sort by hitRate DESC. Pick the best one.

Pass 2 (BALANCED): Filter remaining for hitRate >= 60, edgePct >= 5,
                    (sweetSpotSide === side OR mispricedSide === side).
                    Exclude same player as Leg 1.
                    Sort by compositeScore DESC. Pick the best one.

Pass 3 (GREAT ODDS): Filter remaining for odds >= +120, L10 avg >= line * 1.15.
                      Prefer volumeCandidates. Exclude same player/game as Leg 1-2.
                      If alt line available, swap to higher line for plus money.
                      Sort by odds DESC then compositeScore.
```

Each leg gets tagged with `leg_role: 'safe' | 'balanced' | 'great_odds'` in the saved JSON.

**Fallback**: If any role can't fill, fall back to the existing greedy composite logic to ensure a parlay is still generated.

---

## Part 2: Role-Based Stacking in `bot-generate-daily-parlays`

Add a new execution profile `role_stacked_3leg` that uses the same 3-pass logic:

```typescript
{ legs: 3, strategy: 'role_stacked_3leg', sports: ['basketball_nba'],
  minHitRate: 60, sortBy: 'hit_rate', useAltLines: true }
```

In the parlay assembly loop, when `strategy === 'role_stacked_3leg'`:
- Leg 1: Pick from enrichedSweetSpots with `l10_hit_rate >= 0.70`, no defense hard-block, strongest composite
- Leg 2: Pick with `l10_hit_rate >= 0.60`, `isDoubleConfirmed || isMispriced`, composite >= 75
- Leg 3: Pick with plus-money alt line or highest `oddsValueScore`, volume candidate preferred

---

## Part 3: Replay Yesterday's Lottery Pattern

Add a `replay_mode` parameter to `nba-mega-parlay-scanner`. When `{ replay: true }` is passed:

1. Fetch yesterday's lottery parlay from `bot_daily_parlays` where `strategy_name = 'mega_lottery_scanner'` and `parlay_date = yesterday`
2. Extract the **pattern**: prop types used, sides, defense rank thresholds, odds ranges, hit rate ranges
3. Apply the same filters but with today's player data:
   - Same prop type distribution (e.g., if yesterday had 2 points + 1 threes, replicate)
   - Same side distribution (e.g., 2 OVER + 1 UNDER)
   - Same defense rank floor (e.g., all facing rank 18+ defense)
   - Same minimum hit rate floor
4. Save the replay parlay as `strategy_name: 'mega_lottery_replay'` to `bot_daily_parlays`
5. Send a Telegram report comparing the two patterns

---

## Files Modified

### 1. `supabase/functions/nba-mega-parlay-scanner/index.ts`
- Replace greedy loop (lines 585-636) with 3-pass role-based builder
- Add `leg_role` tag to each leg in saved JSON
- Add `replay_mode` handler that fetches yesterday's pattern and replicates it
- Save replay parlay separately as `mega_lottery_replay`

### 2. `supabase/functions/bot-generate-daily-parlays/index.ts`
- Add `role_stacked_3leg` profiles to execution tier (2 slots)
- Add role-based selection logic in the assembly loop when strategy matches
- Tag legs with `leg_role` in saved parlay data

---

## Leg Role Validation Checklist

Each leg must pass ALL of these before inclusion:

| Check | Safe | Balanced | Great Odds |
|-------|------|----------|------------|
| Defense rank (soft = rank 18+) | >= 15 | >= 18 | any |
| L10 hit rate | >= 70% | >= 60% | >= 55% |
| Mispriced edge | >= 3% | >= 5% | >= 3% |
| Sweet spot / mispriced agree | required | either | either |
| Odds | any | any | >= +120 |
| Alt line shopped | no | optional | yes (preferred) |
| L10 avg vs line buffer | >= 1.1x | >= 1.15x | >= 1.3x |
| `hasCorrelatedProp` check | yes | yes | yes |
| Different player per leg | yes | yes | yes |

