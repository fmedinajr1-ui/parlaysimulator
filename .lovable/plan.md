

# Round Robin "Bankroll Doubler" Parlay

## What This Does
Creates a special high-confidence mega-parlay by combining the best individual legs from all three tiers (Execution, Validation, Exploration) into one large parlay designed to roughly double your bankroll. Think of it as cherry-picking the absolute best legs the bot has already identified and stacking them together.

## How It Works

1. **Pull the day's top legs** -- after normal generation runs, scan all existing parlays for the date and extract unique legs ranked by composite score + hit rate
2. **Apply strict quality filters** -- only legs with 60%+ hit rate, positive edge, and from non-blocked categories qualify
3. **Build the mega-parlay** -- select 6-10 of these elite legs (targeting ~+2000 to +5000 odds range, enough to 2x the bankroll at a reasonable stake)
4. **Round robin sub-parlays** -- in addition to the single mega-parlay, generate smaller 3-4 leg "round robin" combinations from the same pool as insurance (e.g., if you pick 6 legs, generate all possible 4-leg combos = 15 sub-parlays)
5. **Store with a new tier** called `"round_robin"` so it's visually distinct on the Bot Dashboard

## Technical Details

### Edge Function Changes (`bot-generate-daily-parlays/index.ts`)
- Add a new action `"round_robin"` alongside the existing `"generate"` and `"smart_generate"` actions
- New function `generateRoundRobinParlays()` that:
  - Queries all `bot_daily_parlays` for today to extract the best unique legs
  - Deduplicates by player/team + prop type
  - Ranks by `composite_score` descending, filtered to 60%+ confidence
  - Builds one "mega" parlay with the top 6-10 legs
  - Generates all C(n, k) sub-combinations (k = 3 or 4) as round robin entries
  - Calculates combined probability and expected odds for each combo
  - Inserts all with `tier: 'round_robin'` and `strategy_name: 'bankroll_doubler'`

### UI Changes

**Bot Dashboard (`BotDashboard.tsx`)**
- Add a "Doubler" button to the sticky bottom action bar that triggers the round robin generation

**Day Parlay Detail / Bot Parlay Card**
- Recognize `tier: 'round_robin'` with a distinct badge/color (e.g., gold/yellow)
- Show the mega-parlay prominently with a "Bankroll Doubler" label

### Hook Changes (`useBotEngine.ts`)
- Add a `generateRoundRobin()` mutation that calls the edge function with `action: 'round_robin'`

## Safety Rails
- Round robin generation only works AFTER the daily generation has run (needs legs to pick from)
- Stake remains at $20 (same flat unit) -- the payout multiplier does the heavy lifting
- Bankroll floor protection still applies
- Maximum of 1 mega-parlay + 15 sub-parlays per day to prevent spam

