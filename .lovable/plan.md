

# Single Picks Fallback + Light-Slate Mode + Sunday Settlement Fix

## Problem Summary

Three issues to fix:

1. **Sunday (Feb 15) parlays stuck "pending"** -- The settlement pipeline can't find final scores for Belmont vs Murray St, Arizona vs Michigan, and Seton Hall vs Butler. These need manual settlement.

2. **Zero parlays generated for today (Feb 16)** -- NBA All-Star break means 0 player props. The ML Sniper's composite score floor (65) filtered 132 team picks down to ~7. Diversity constraints then prevented any 3-leg parlay from being built. The bot gave up entirely instead of adapting.

3. **Golf and Tennis are blocked** -- `BLOCKED_SPORTS` includes `baseball_ncaa` and `golf_pga`. Tennis profiles exist but may not have enough data flowing in. Golf is paused for data collection.

## Solution: Single Picks + Adaptive Light-Slate Mode

### Core Idea

When the bot can't build enough parlays, it should fall back to **single picks** (1-leg "straight bets") instead of producing nothing. On light-slate days (few sports available), it should also lower its thresholds and reduce parlay sizes.

### Changes to `supabase/functions/bot-generate-daily-parlays/index.ts`

#### A. Light-Slate Detection (enhanced)

After building the pool (~line 4342), detect not just thin slate (<25 picks) but also **sport-limited** days:

```text
Light slate triggers:
- Pool < 25 total picks (existing)
- 0 player props available (new - today's situation)
- Only 1-2 sports have data (new)
```

When light-slate triggers:
- Lower composite score floor from 65 to **55** for team picks
- Increase `maxTeamUsage` from 3 to **5** (exploration)
- Increase `maxCategoryUsage` from 6 to **8** (exploration)
- Cap all parlays at 3 legs max (existing thin-slate behavior)

#### B. Single Pick Generation (new feature)

Add a new generation phase after parlay generation. If total parlays generated < 10, the bot generates **single picks** (straight bets):

- Pull top-scoring picks from the pool (composite score > 60, sorted descending)
- Each single pick stored as a 1-leg "parlay" in `bot_daily_parlays` with `leg_count: 1`
- Strategy name: `single_pick_accuracy` for high-composite picks, `single_pick_value` for high-edge picks
- Generate up to 15 singles for exploration, 5 for validation, 3 for execution
- Singles use the same scoring gates (hit rate, edge) but skip parlay-specific gates (correlation tax, diversity constraints)

#### C. NCAAB Accuracy Profiles

Add dedicated NCAAB-only profiles that activate on any day (not just light-slate), prioritizing the highest-accuracy categories:

- 2-leg NCAAB totals (under-focused, highest hit rate category)
- 2-leg NCAAB spreads (composite-sorted)
- 2-leg NCAAB mixed (1 total + 1 spread)
- These smaller parlays are more achievable on sparse days

#### D. Golf and Tennis Unblocking

- Remove `golf_pga` from `BLOCKED_SPORTS` if there's enough data (check first)
- Tennis is already unblocked -- add more tennis-specific profiles to exploration tier for days when NBA/NHL are dark
- Add `golf_pga` outright profiles back (uncomment existing lines 98-100) if data supports it

### Settlement Fix for Sunday Pending Parlays

Force-settle the 2 pending Feb 15 parlays by looking up actual game scores and updating their outcomes in the database. This is a one-time manual fix.

### Post-Deploy: Trigger Generation

After deploying the updated function, manually invoke it to generate today's picks immediately.

## Technical Details

### Single Pick Data Structure

Stored in existing `bot_daily_parlays` table -- no schema changes needed:

```text
leg_count: 1
legs: [single_pick_object]
tier: 'exploration' | 'validation' | 'execution'
strategy_name: 'single_pick_accuracy'
combined_probability: (single leg implied prob)
simulated_edge: (from pick data)
```

### New Function: `generateSinglePicks()`

```text
Parameters: pool, tier config, target count
Logic:
  1. Merge player + team picks, sort by composite score
  2. Filter: composite > 60, hit_rate > 50%
  3. For execution tier: composite > 70, hit_rate > 58%
  4. Skip blocked sports and blocked combos
  5. Return top N as 1-leg parlay records
```

### ML Sniper Floor Adjustment (line ~3027)

```text
Current:  if (pick.compositeScore < 65) -> blocked
Light-slate: if (pick.compositeScore < 55) -> blocked
```

### New Profiles Added to Exploration Tier

```text
{ legs: 2, strategy: 'ncaab_accuracy_totals', sports: ['basketball_ncaab'], betTypes: ['total'], sortBy: 'composite' }
{ legs: 2, strategy: 'ncaab_accuracy_spreads', sports: ['basketball_ncaab'], betTypes: ['spread'], sortBy: 'composite' }
{ legs: 2, strategy: 'ncaab_accuracy_mixed', sports: ['basketball_ncaab'], betTypes: ['spread', 'total'], sortBy: 'composite' }
{ legs: 1, strategy: 'single_pick_accuracy', sports: ['all'], sortBy: 'composite' }
```

### Fallback Logic Flow

```text
1. Build pool
2. Detect light-slate (0 player props OR pool < 25 OR <= 2 sports)
3. If light-slate: relax ML Sniper floor, increase usage limits
4. Generate parlays as normal across tiers
5. After all tiers: count total generated
6. If total < 10: generate single picks to fill the gap
7. Store everything, send Telegram summary
```

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Light-slate detection, single pick generation, NCAAB 2-leg profiles, ML Sniper floor adjustment |

