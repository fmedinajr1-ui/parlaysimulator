

## Make the Bot Follow Winning Patterns: Smart Selection Overhaul

### The Problem

The bot has sophisticated infrastructure (7,600+ lines) but lacks a critical feedback loop: **it doesn't track which specific players and prop types are actually winning at the individual leg level**, then prioritize those proven winners in future parlays.

Currently the bot operates on **category-level** learning (e.g., "THREE_POINT_SHOOTER" category win rate) but misses granular patterns like:
- "Nikola Jokic Over Rebounds has hit 8 out of 10 times in our parlays"
- "player_rebounds as a prop type wins 65% of the time"
- "Picks against bottom-10 defenses hit at 72%"

### Root Causes

1. **No player-level performance tracking** -- The bot tracks category win rates (BIG_REBOUNDER, HIGH_ASSIST) but never asks "which specific players keep winning for us?"

2. **No prop-type-level win rate feedback** -- Categories like `player_steals` and `player_blocks` had to be manually blocked because there's no automated prop-type win rate loop

3. **No "proven winner" boost** -- A player who has hit 9/10 recent legs gets the same composite score as a first-timer

4. **Category weights are too coarse** -- `bot_category_weights` tracks archetype-level performance but doesn't drill down to the player+prop combinations that actually drive wins

### Solution: Three-Layer Winning Pattern System

#### Layer 1: Prop Type Performance Gate (Automated Blocking)
Instead of manually adding prop types to `BLOCKED_PROP_TYPES`, automatically compute prop-type win rates from settled leg data and block any prop type below a threshold.

- Query all settled parlays, extract individual leg outcomes by prop type
- Compute win rate per prop type (e.g., `player_points`: 58%, `player_steals`: 0%, `player_blocks`: 0%)
- Auto-block any prop type with 5+ settled legs and less than 25% win rate
- Auto-boost prop types with 10+ legs and greater than 60% win rate (1.2x composite multiplier)

#### Layer 2: Player Performance Scoring
Track individual player hit rates from settled parlay legs and feed them back into pick selection.

- Build a `playerPerformanceMap` from the last 30 days of settled leg outcomes
- For each player+prop_type combination, calculate: legs played, legs won, hit rate
- Apply scoring adjustments during composite score calculation:
  - Player with 5+ legs and 70%+ hit rate: +15 composite bonus ("proven winner")
  - Player with 5+ legs and 50-70% hit rate: +5 composite bonus ("reliable")
  - Player with 5+ legs and below 30% hit rate: -20 composite penalty ("avoid")
  - First-time player (0 legs): no adjustment (neutral)

#### Layer 3: Winning Combination Memory
Track which player+prop+side+matchup combinations produce wins and prioritize them.

- After settlement, log winning leg patterns: player, prop type, side, opponent defense rank tier
- During generation, check if a candidate pick matches a historically winning pattern
- Matching picks get a +10 "pattern match" bonus in composite scoring

### Technical Changes

**1. New database table: `bot_player_performance`**

Stores pre-computed player-level performance metrics, updated by the settlement pipeline.

```
- player_name (text)
- prop_type (text) 
- side (text)
- legs_played (int)
- legs_won (int)
- hit_rate (numeric)
- last_updated (date)
- avg_edge (numeric)
- streak (int) -- current win/loss streak
```

**2. New database table: `bot_prop_type_performance`**

Stores prop-type-level win rates for automated gating.

```
- prop_type (text)
- total_legs (int)
- legs_won (int)
- hit_rate (numeric)
- is_blocked (boolean)
- last_updated (date)
```

**3. `supabase/functions/bot-generate-daily-parlays/index.ts`**

- Add `loadPlayerPerformance()` function that queries `bot_player_performance` to build a player scoring map
- Add `loadPropTypePerformance()` function that queries `bot_prop_type_performance` for dynamic prop blocking
- Replace static `BLOCKED_PROP_TYPES` with dynamic prop-type gate loaded from the database
- Modify `calculateCompositeScore()` to accept an optional `playerBonus` parameter
- During pick enrichment (line ~3400), look up each player in the performance map and apply bonus/penalty
- Add logging: "[Bot] Proven winners boosted: 12 players, Avoided: 3 players"

**4. `supabase/functions/bot-settle-and-learn/index.ts`** (or equivalent settlement function)

- After grading each leg, upsert into `bot_player_performance` and `bot_prop_type_performance`
- Recalculate hit rates with a 30-day rolling window
- Auto-set `is_blocked = true` on prop types with 5+ legs and less than 25% win rate

**5. `supabase/functions/bot-force-fresh-parlays/index.ts`**

- Same dynamic prop-type blocking integration (replace static set with database query)
- Add player performance lookup for conviction scoring

### What This Fixes

| Before | After |
|--------|-------|
| Steals/blocks had to be manually blocked | Auto-blocked after 5 losing legs |
| All players scored equally regardless of track record | Proven winners get +15 boost, serial losers get -20 penalty |
| Bot picks random high-edge players with no history | Bot prioritizes players who have consistently delivered |
| Category-level learning only (BIG_REBOUNDER) | Player+prop granular learning (Jokic Over Rebounds) |
| Static hardcoded blocked lists | Self-updating performance gates |

### Implementation Order

1. Create `bot_player_performance` and `bot_prop_type_performance` tables (migration)
2. Update settlement pipeline to populate these tables after each grading cycle
3. Update `bot-generate-daily-parlays` to load and apply player/prop performance data
4. Update `bot-force-fresh-parlays` with same dynamic blocking
5. Backfill tables from existing settled parlay leg data
