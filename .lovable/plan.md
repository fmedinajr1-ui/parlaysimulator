

# Blowout Game Strategy

## Current State

The system already has blowout awareness scattered across multiple functions:
- `fetch-vegas-lines` calculates `HARD_BLOWOUT` (spread 12+) and `SOFT_BLOWOUT` (spread 8+) game scripts with garbage time risk
- `game-environment-validator` downgrades favorite star overs and upgrades underdog role player rebounds in blowout scenarios
- `bot-matchup-defense-scanner` finds `bench_under` targets and the broadcast builds `bidirectional_bench_under` parlays
- `bot-game-context-analyzer` flags `blowout_risk` games

**What's missing:** No dedicated strategy in `bot-generate-daily-parlays` that identifies blowout games (spread 8+) and builds targeted parlays with:
1. **Losing team starters PRA unders** — starters get benched Q4, minutes capped
2. **Losing team role/bench player unders** — reduced garbage time opportunity when team is down big
3. **Winning team bench player overs** — garbage time minutes boost

Today's BKN vs OKC game: No spread data is in `game_bets` for this matchup (data gap), but the props are there (SGA, Chet, Dort, Ajay Mitchell, etc). The strategy needs to pull spread data to identify blowout candidates.

## Plan

### 1. New `blowout_script` Strategy in `bot-generate-daily-parlays/index.ts`

Add a new strategy handler `blowout_script` that:
- Queries `game_bets` or `whale_picks` for games with spreads 8+ (today's date)
- For each blowout game, identifies the **underdog team**
- Filters the sweet spots pool to only include players from that game
- Builds parlays with these rules:
  - **Underdog starters**: UNDER on points, PRA, assists (they'll sit Q4)
  - **Underdog bench/role players**: UNDER on points, rebounds (less floor time when trailing)
  - **Favorite bench players**: OVER on points, rebounds (garbage time minutes)
- Minimum 3 legs, all from the same blowout game
- Uses `_gameContext.blowoutRisk` flag when available

Add a new `ParlayProfile` field: `gameFilter?: 'blowout'` to signal this strategy.

### 2. Add Profiles Across Tiers

**Exploration (4 profiles):**
```
{ legs: 3, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'hit_rate', gameFilter: 'blowout' }
{ legs: 3, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 45, sortBy: 'shuffle', gameFilter: 'blowout' }
{ legs: 4, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 42, sortBy: 'hit_rate', gameFilter: 'blowout' }
{ legs: 3, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 48, sortBy: 'composite', gameFilter: 'blowout' }
```

**Execution (2 profiles):**
```
{ legs: 3, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'hit_rate', gameFilter: 'blowout' }
{ legs: 3, strategy: 'blowout_script', sports: ['basketball_nba'], minHitRate: 55, sortBy: 'shuffle', gameFilter: 'blowout' }
```

### 3. Strategy Logic (inside the profile loop)

When `strategy === 'blowout_script'`:

1. **Identify blowout games**: Query spreads from `game_bets` (bet_type = 'spreads') or `whale_picks` where |line| >= 8
2. **Classify players by team role**:
   - Use `_gameContext` or minutes data to determine PRIMARY/SECONDARY/ROLE/BENCH
   - Identify which team is the underdog (positive spread)
3. **Build leg pool**:
   - Underdog PRIMARY/SECONDARY players → force side to UNDER for points, assists, PRA
   - Underdog ROLE/BENCH players → force side to UNDER for all props
   - Favorite BENCH players → force side to OVER for points, rebounds
4. **Assemble parlay**: Pick 3-4 legs from the blowout pool, ensuring same-game correlation
5. **Tag**: `strategy_name: 'blowout_script'`, include spread and game script in rationale

### 4. Data Flow Fix

The `game_bets` table needs to have spread data for today's games. If the scraper isn't populating this for BKN vs OKC, check `whale_picks` as fallback. The strategy will try both sources.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add `blowout_script` strategy handler + 6 new profiles + `gameFilter` field on ParlayProfile |

