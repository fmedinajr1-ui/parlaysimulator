
User wants to see accuracy stats for the cascade RBI parlay generator over the last two days. This is a data lookup task, not a build task.

Let me query `bot_daily_parlays` where `strategy_name = 'mlb_cascade_parlays'` for the last 2 days, looking at outcomes (win/loss/pending), by tier (GRIND/STACK/LONGSHOT), and ROI.

I'll present a plan to run the query and show the results.

# Pull Cascade RBI Parlay Accuracy — Last 2 Days

## What I'll do
Query `bot_daily_parlays` filtered to `strategy_name = 'mlb_cascade_parlays'` for the past 2 days (2026-04-14 and 2026-04-15) and report:

- **Per-day breakdown**: total tickets, wins/losses/pending, win rate, ROI
- **Per-tier breakdown** (GRIND 3-leg / STACK 5-leg / LONGSHOT 8-leg): tickets, hit rate, profit
- **Leg-level stats**: total legs, individual leg hit rate (how often the Under 0.5 RBI hits)
- **Net P/L**: total stake vs total payout

## Output
A single summary table posted in chat — no file changes, no UI build. Pure read-only diagnostic.
