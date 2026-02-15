

# Fix the Bot's Learning Loop and Game Intelligence

## The Problem

The bot has a 25W-61L record (29% win rate) because of 4 broken systems working together:

1. **Leg-level outcomes are never tracked** -- All 315 settled legs have `hit = null`, so the bot cannot learn which prop types, sides, or categories actually win
2. **Category weights are stale** -- 33 of 59 categories have zero data; the learning adjustments barely fire
3. **No game-context awareness** -- The bot blindly picks without considering revenge games, back-to-backs, blowout risk, or thin slates
4. **Too many legs per parlay** -- 4-leg parlays lose 74% of the time, 5-leg lose 85%

## The Fix (4 Parts)

### Part 1: Fix Leg-Level Learning (Critical)

Update the settlement function (`bot-settle-and-learn`) to properly write `hit: true/false` on each leg when settling, and backfill all 315 existing settled legs that are missing hit data.

Database migration to backfill:
- Set `hit = true` on legs where `outcome = 'hit'`
- Set `hit = false` on legs where `outcome = 'miss'`

This unlocks the entire calibration and pattern replay pipeline.

### Part 2: Add Game Context Intelligence

Create a new function `bot-game-context-analyzer` that runs before generation and flags:

- **Revenge games**: Teams facing an opponent that beat them in the last 30 days
- **Back-to-back fatigue**: Teams playing their 2nd game in 2 days (already have fatigue data -- just need to wire it into generation scoring)
- **Thin slate risk**: When fewer than 6 games are available, reduce max legs to 3 and tighten thresholds
- **Blowout risk**: Spreads above 10 points flagged (starters may rest in 4th quarter, killing player props)

These flags get written to `bot_research_findings` so the generator can read and apply them as score boosts/penalties.

### Part 3: Enforce Stricter Leg Limits

Update the generation engine with hard caps based on what the data shows:

- **Execution tier**: Max 3 legs (currently winning at 35% for 3-leg)
- **Validation tier**: Max 3 legs (drop from 4-5)
- **Exploration tier**: Max 4 legs (drop from 5-6)

This alone should improve win rate by roughly 10-15 percentage points based on the current data.

### Part 4: Wire Fatigue and Context into Scoring

Update the parlay generator to consume the game context flags:

- **-8 penalty** for player props in blowout-risk games (spread > 10)
- **-6 penalty** for players on back-to-back teams
- **+5 boost** for revenge game team bets (motivated play)
- **Auto-reduce** parlay size on thin slates

## Technical Details

### Files to modify:
- `supabase/functions/bot-settle-and-learn/index.ts` -- Add `hit` field to leg updates
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- Enforce leg limits, consume context flags
- `supabase/functions/bot-review-and-optimize/index.ts` -- Add game context analysis before generation
- `supabase/functions/data-pipeline-orchestrator/index.ts` -- Add context analyzer to Phase 2

### New function:
- `supabase/functions/bot-game-context-analyzer/index.ts` -- Revenge, fatigue, blowout, thin-slate detection

### Database migration:
- Backfill `hit` field on all 315 existing settled legs in `bot_daily_parlays`

### Expected impact:
- Leg-level learning starts working immediately (calibration can now read real hit rates)
- 3-leg cap on execution parlays should push win rate from ~29% toward 35-40%
- Game context penalties should prevent the worst losses (blowout props, fatigued players)

